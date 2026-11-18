import json
import logging
import math
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import blacklist
import stack_sizes
import whitelist
from allocator import DAILY_ORDER_WORTH_CAP, build_all_candidates
from api_client import get_market_data, get_mayor_data, get_product_list, get_trader_data, retry_forever

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("main")

# Anomalies (bad/missing data, crossed prices, etc) recur every poll for as long as
# the underlying condition holds, so log each one once when it first appears and
# stay quiet until it's cleared (i.e. the condition stops holding), at which point
# it can log again if it comes back.
_active_anomalies = set()


def log_once(key, level, message, *args, **kwargs):
    if key not in _active_anomalies:
        _active_anomalies.add(key)
        log.log(level, message, *args, **kwargs)


def clear_anomaly(key):
    _active_anomalies.discard(key)


# Fast beat: recompute the recommendation off fresh inventory/orders this often.
RECOMPUTE_INTERVAL_SECONDS = 5
# Slow beat: refresh the heavier bazaar/market data (and mayor tax) this often.
# Hypixel's bazaar only updates ~once a minute, so 30s is near its useful floor.
BAZAAR_REFRESH_SECONDS = 30
HOURS_PER_WEEK = 7 * 24

# The smallest amount a bazaar order price can be beaten by.
BAZAAR_PRICE_INCREMENT = 0.1

# Bazaar slot count, intentionally fixed at the user's permanent max of 28 (the
# upgradeable range is 14-28); not tracked in trader-data.json.
TOTAL_BAZAAR_SLOTS = 28

# Flip cadence used to size how much of an order is expected to fill per session.
# TODO (todo.md): make this user-settable; "~8h, sometimes 12".
TIME_BETWEEN_TRADES_HOURS = 8

# The 15B bazaar order-worth cap and the 500M NPC limit both reset at 7 PM in
# America/Chicago (the code's documented "7 PM CDT"; the zone handles CST/CDT).
DAILY_RESET_HOUR = 19


def _daily_reset_tz():
    """America/Chicago, so the 7 PM reset tracks the CST/CDT switch. zoneinfo
    needs the tzdata package on Windows (it's in requirements.txt); if it's
    somehow missing, fall back to a fixed CDT offset rather than crashing - the
    reset can then be an hour off during CST, which only shifts the cap window."""
    try:
        return ZoneInfo("America/Chicago")
    except ZoneInfoNotFoundError:
        log_once("tzdata-missing", logging.WARNING,
                 "tzdata not installed; using a fixed UTC-5 (CDT) offset for the daily reset. `pip install tzdata`")
        return timezone(timedelta(hours=-5))

# Base bazaar tax; the live rate is this x the mayor tax-multiplier (x4 Derpy).
BASE_BAZAAR_TAX = 0.01

# backend.mjs appends one "placed" event per order here (order_amount, order_price,
# place_time); summing those since the last reset reconstructs the 15B cap used.
TRADE_LOG_PATH = Path(__file__).parent.parent / "data" / "trade-outcomes.jsonl"

# Where the ranked advisory order list is written each poll for the mod to read.
RECOMMENDATION_PATH = Path(__file__).parent.parent / "data" / "recommendation.json"


def build_inventory(trader_data):
    inventory = trader_data.get("all-products")
    if inventory is None:
        log_once("inventory-missing", logging.ERROR, "trader_data is missing 'all-products'; treating inventory as empty")
        return {}
    clear_anomaly("inventory-missing")

    for product_name, product_info in inventory.items():
        current_amount = product_info.get("current-amount")
        max_amount = product_info.get("max-amount")

        if current_amount is None:
            log_once((product_name, "missing-current-amount"), logging.ERROR, "'%s' is missing current-amount", product_name)
        else:
            clear_anomaly((product_name, "missing-current-amount"))
            if current_amount < 0:
                log_once((product_name, "negative-current-amount"), logging.ERROR, "'%s' has a negative current-amount: %s", product_name, current_amount)
            else:
                clear_anomaly((product_name, "negative-current-amount"))

        if max_amount is None:
            log_once((product_name, "missing-max-amount"), logging.ERROR, "'%s' is missing max-amount", product_name)
        else:
            clear_anomaly((product_name, "missing-max-amount"))

        if current_amount is not None and max_amount is not None and current_amount > max_amount:
            log_once((product_name, "current-exceeds-max"), logging.ERROR, "'%s' current-amount (%s) exceeds max-amount (%s)", product_name, current_amount, max_amount)
        else:
            clear_anomaly((product_name, "current-exceeds-max"))

    return inventory


def count_available_bazaar_slots(trader_data, total_slots):
    sell_orders = trader_data.get("sell-order-overview", {}).get("sell-orders", [])
    buy_orders = trader_data.get("buy-order-overview", {}).get("buy-orders", [])
    used_slots = sum(1 for order in sell_orders if not order.get("has-been-claimed")) + \
        sum(1 for order in buy_orders if not order.get("has-been-claimed"))

    if used_slots > total_slots:
        log_once(
            "slots-exceeded", logging.ERROR,
            "used bazaar slots (%s) exceeds TOTAL_BAZAAR_SLOTS (%s); is TOTAL_BAZAAR_SLOTS set correctly?",
            used_slots, total_slots
        )
    else:
        clear_anomaly("slots-exceeded")

    return max(0, total_slots - used_slots)


def build_bazaar_data_and_product_info(bazaar_products, volume_stats, product_list, log_non_whitelisted=True):
    bazaar_data = {}
    all_product_information = {}

    for product_name, product_meta in product_list.items():
        # Auction-house items can carry an api-name but aren't on the bazaar, so a
        # missing bazaar entry for them is expected, not an error. Skip them quietly -
        # this models bazaar flips only (and stops the per-poll "no bazaar data" spam).
        if product_meta.get("type") == "auction-product":
            continue
        # Forge recipe entries ("Refined Titanium (forge)", etc.) are a separate
        # product-list row that reuses the underlying item's api-name (REFINED_TITANIUM).
        # Since whitelist/blacklist match on api-name, a whitelisted item would be
        # bought twice - once under its clean name and once under the "(forge)" name.
        # Drop the forge-display row; the clean bazaar row (if any) still trades.
        if "(forge)" in product_name.lower() or product_meta.get("type") == "forge-product":
            continue
        # Gemstone rows come in two forms: the clean name ("Fine Ruby Gemstone")
        # and a "? "-prefixed twin ("? Fine Ruby Gemstone"), where the in-game
        # gemstone symbol falls back to "?". Both reuse the same api-name, so - like
        # the forge rows above - a whitelisted gemstone would be bought twice. Every
        # "? " row has a clean twin with the same api-name (verified against
        # product-list.json), so dropping the "? " display row loses nothing; the
        # clean row still trades.
        if product_name.startswith("? "):
            continue
        api_name = product_meta.get("api-name")
        # Manual blacklist (blacklist.json): never flip these, either side. Drop
        # the product entirely so no buy/sell candidate is ever built for it.
        if blacklist.is_blacklisted(product_name, api_name):
            continue
        if not api_name:
            if product_meta.get("has-weights"):
                log_once((product_name, "missing-api-name"), logging.ERROR, "'%s' has no api-name in product-list.json; skipping", product_name)
            # else: an AH-only item (accessories, etc) with no bazaar presence by design.
            continue
        clear_anomaly((product_name, "missing-api-name"))

        # The advisory is buys-only over the whitelist, so once a whitelist is
        # active only whitelisted products matter here - stay quiet about
        # data-quality issues on everything else (the mod-facing optimizer passes
        # log_non_whitelisted=False; the labeled-data logger wants the full picture
        # and leaves it True). q_log is just log_once gated on that; clear_anomaly
        # stays unconditional so a product going quiet can't strand a stale anomaly.
        log_quality = log_non_whitelisted or whitelist.allows(api_name)

        def q_log(key, level, message, *args, **kwargs):
            if log_quality:
                log_once(key, level, message, *args, **kwargs)

        product = bazaar_products.get(api_name)
        if product is None:
            # Crafting/forge/accessory items carry an api-name but usually aren't on
            # the bazaar, so a missing entry is expected - only flag it for items we
            # actually track as bazaar flips (has-weights), where it's a real problem.
            if product_meta.get("has-weights"):
                q_log((product_name, "missing-bazaar-data"), logging.ERROR, "no bazaar data found for '%s' (api-name '%s')", product_name, api_name)
            continue
        clear_anomaly((product_name, "missing-bazaar-data"))

        # We only care about the price to actually place a buy/sell order (not
        # instant-buy/instant-sell), so derive it from the order book: a buy order
        # needs to beat the current best bid by one increment to be at the front of
        # the queue, and a sell order needs to beat the current best ask by one
        # increment the same way.
        #
        # Confusingly, Hypixel's field names are from the order book's own
        # perspective, not the trader's: "sell_summary" holds the active BUY orders
        # (bids) you'd sell into, and "buy_summary" holds the active SELL orders
        # (asks) you'd buy into. Confirmed empirically: quick_status.buyPrice always
        # equals min(buy_summary prices) exactly.
        sell_summary = product.get("sell_summary", [])
        buy_summary = product.get("buy_summary", [])

        if not sell_summary:
            q_log((product_name, "no-bids"), logging.WARNING, "'%s' has no active buy orders (bids); can't derive a sell order price", product_name)
        else:
            clear_anomaly((product_name, "no-bids"))
        if not buy_summary:
            q_log((product_name, "no-asks"), logging.WARNING, "'%s' has no active sell orders (asks); can't derive a buy order price", product_name)
        else:
            clear_anomaly((product_name, "no-asks"))

        best_bid = max((order["pricePerUnit"] for order in sell_summary), default=None)
        best_ask = min((order["pricePerUnit"] for order in buy_summary), default=None)

        sell_price = best_ask - BAZAAR_PRICE_INCREMENT if best_ask is not None else 0
        buy_price = best_bid + BAZAAR_PRICE_INCREMENT if best_bid is not None else 0

        if sell_price <= 0:
            q_log((product_name, "non-positive-sell-price"), logging.ERROR, "'%s' has a non-positive sell order price: %s", product_name, sell_price)
        else:
            clear_anomaly((product_name, "non-positive-sell-price"))
        if buy_price <= 0:
            q_log((product_name, "non-positive-buy-price"), logging.ERROR, "'%s' has a non-positive buy order price: %s", product_name, buy_price)
        else:
            clear_anomaly((product_name, "non-positive-buy-price"))
        if best_ask is not None and best_bid is not None and buy_price >= sell_price:
            q_log(
                (product_name, "crossed-spread"), logging.ERROR,
                "'%s' buy order price (%s) is not below its sell order price (%s); spread looks wrong",
                product_name, buy_price, sell_price
            )
        else:
            clear_anomaly((product_name, "crossed-spread"))

        bazaar_data[product_name] = {
            "sell_price": sell_price,
            "buy_price": buy_price,
        }

        quick_status = product.get("quick_status")
        if quick_status is None:
            q_log((product_name, "missing-quick-status"), logging.ERROR, "'%s' is missing quick_status", product_name)
            quick_status = {}
        else:
            clear_anomaly((product_name, "missing-quick-status"))

        sell_moving_week = quick_status.get("sellMovingWeek", 0)
        buy_moving_week = quick_status.get("buyMovingWeek", 0)
        if sell_moving_week < 0:
            q_log((product_name, "negative-sell-moving-week"), logging.ERROR, "'%s' has a negative sellMovingWeek: %s", product_name, sell_moving_week)
        else:
            clear_anomaly((product_name, "negative-sell-moving-week"))
        if buy_moving_week < 0:
            q_log((product_name, "negative-buy-moving-week"), logging.ERROR, "'%s' has a negative buyMovingWeek: %s", product_name, buy_moving_week)
        else:
            clear_anomaly((product_name, "negative-buy-moving-week"))

        # The server (backend.mjs) keeps a rolling history of quick_status samples and
        # computes real 1h/24h rates from it. Right after a server restarts, there won't
        # be enough history yet, so fall back to spreading the weekly volume evenly
        # until real rates are available.
        stats = volume_stats.get(api_name)
        if stats is None:
            q_log((product_name, "no-volume-stats"), logging.INFO, "no volumeStats yet for '%s'; falling back to weekly-average estimate", product_name)
            stats = {}
        else:
            clear_anomaly((product_name, "no-volume-stats"))

        sell_per_hour_1h = stats.get("sellVolumePerHour1h")
        sell_per_hour_24h = stats.get("sellVolumePerHour24h")
        buy_per_hour_1h = stats.get("buyVolumePerHour1h")
        buy_per_hour_24h = stats.get("buyVolumePerHour24h")

        all_product_information[product_name] = {
            "past_quantity_sold_per_hour": sell_per_hour_1h if sell_per_hour_1h is not None else sell_moving_week / HOURS_PER_WEEK,
            "sell_volume_7_day": sell_moving_week,
            "sell_volume_24_hour": sell_per_hour_24h * 24 if sell_per_hour_24h is not None else sell_moving_week / 7,
            "new_listings_per_hour_selling": stats.get("newSellListingsPerHour") or 0,
            "past_quantity_bought_per_hour": buy_per_hour_1h if buy_per_hour_1h is not None else buy_moving_week / HOURS_PER_WEEK,
            "bought_volume_7_day": buy_moving_week,
            "bought_volume_24_hour": buy_per_hour_24h * 24 if buy_per_hour_24h is not None else buy_moving_week / 7,
            "new_listings_per_hour_buying": stats.get("newBuyListingsPerHour") or 0,
            # Each weight is current-vs-EMA-of-past for that stat, computed server-side
            # (backend.mjs). Defaults to 1 (neutral) until the server has enough
            # history to produce a real baseline, e.g. right after a restart.
            "sell_volume_7_day_weight": stats.get("sellVolume7DayWeight", 1),
            "sell_volume_24_hour_weight": stats.get("sellVolume24HourWeight", 1),
            "new_listings_per_hour_selling_weight": stats.get("newSellListingsWeight", 1),
            "bought_volume_7_day_weight": stats.get("buyVolume7DayWeight", 1),
            "bought_volume_24_hour_weight": stats.get("buyVolume24HourWeight", 1),
            "new_listings_per_hour_buying_weight": stats.get("newBuyListingsWeight", 1),
            # Max inventory stack size for this item (used by the allocator's
            # 35-slots x stack-size hold cap). product-list.json doesn't carry
            # this yet, so it's usually None -> allocator falls back to 64.
            "max_stack_size": stack_sizes.stack_size(api_name),
            # Carried so the allocator can look up this product's price-history
            # baseline (relisting-trap / ask-spike guard), which is keyed by api-name.
            "api_name": api_name,
        }

    return bazaar_data, all_product_information


def most_recent_daily_reset_ms(now=None):
    """Epoch-ms of the most recent DAILY_RESET_HOUR in America/Chicago."""
    now = now or datetime.now(_daily_reset_tz())
    reset = now.replace(hour=DAILY_RESET_HOUR, minute=0, second=0, microsecond=0)
    if now < reset:
        reset -= timedelta(days=1)
    return int(reset.timestamp() * 1000)


def _sum_placed_worth_since(path, reset_ms, block_size=1 << 20):
    """Sum order_amount*order_price of 'placed' events with place_time >= reset_ms,
    reading the log from the end backward and stopping as soon as a placed event
    older than the reset is reached. 'placed' events are appended in place_time
    order, so this is O(recent activity): the never-pruned trade log can grow
    indefinitely without slowing the per-poll cap read (keeping the full log is
    deliberate - it's the fill model's ground truth, so it is not pruned)."""
    used = 0
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        head = b""  # partial leftmost line, completed by the next (earlier) block
        while pos > 0:
            size = min(block_size, pos)
            pos -= size
            f.seek(pos)
            parts = (f.read(size) + head).split(b"\n")
            head = parts[0]
            for raw in reversed(parts[1:]):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if event.get("event") != "placed":
                    continue
                if (event.get("place_time") or 0) < reset_ms:
                    return used  # everything earlier is older than the reset too
                used += (event.get("order_amount") or 0) * (event.get("order_price") or 0)
        raw = head.strip()
        if raw:
            try:
                event = json.loads(raw)
                if event.get("event") == "placed" and (event.get("place_time") or 0) >= reset_ms:
                    used += (event.get("order_amount") or 0) * (event.get("order_price") or 0)
            except json.JSONDecodeError:
                pass
    return used


_cap_cache = {}


def compute_daily_cap_used(reset_ms, path=TRADE_LOG_PATH):
    """Coin-worth of every order placed since the last reset, from the trade log.
    Both buy and sell 'placed' events count (they share the one 15B/24h pool).
    Cached on (file mtime, size, reset window) so repeated polls don't re-scan."""
    try:
        stat = path.stat()
    except OSError:
        log_once("trade-log-missing", logging.WARNING, "no trade log at %s; treating daily cap as unused", path)
        return 0
    clear_anomaly("trade-log-missing")

    key = (stat.st_mtime_ns, stat.st_size, reset_ms)
    if _cap_cache.get("key") == key:
        return _cap_cache["value"]

    try:
        used = _sum_placed_worth_since(path, reset_ms)
    except OSError:
        return _cap_cache.get("value", 0)

    _cap_cache["key"] = key
    _cap_cache["value"] = used
    return used


_last_tax_multiplier = None


def get_bazaar_fee():
    """Live bazaar tax: base 1% x the current mayor tax-multiplier (x4 Derpy).
    On a fetch failure, reuse the last-known multiplier rather than defaulting to
    1x - defaulting to 1x during a Derpy term (4x) would understate the fee and
    could make a losing flip look profitable."""
    global _last_tax_multiplier
    try:
        multiplier = get_mayor_data().get("tax-multiplier") or 1
        clear_anomaly("fetch-mayor-data-failed")
        _last_tax_multiplier = multiplier
    except Exception:
        if _last_tax_multiplier is not None:
            log_once(
                "fetch-mayor-data-failed", logging.WARNING,
                "couldn't fetch mayor-data; reusing last-known tax multiplier x%s", _last_tax_multiplier, exc_info=True
            )
            multiplier = _last_tax_multiplier
        else:
            log_once(
                "fetch-mayor-data-failed", logging.WARNING,
                "couldn't fetch mayor-data and have no cached multiplier; using base %.0f%% (optimistic under Derpy)",
                BASE_BAZAAR_TAX * 100, exc_info=True
            )
            return BASE_BAZAAR_TAX
    return BASE_BAZAAR_TAX * multiplier


# The advisory is buys-only (the user manages sells). Every whitelisted buy is
# ranked within its order-size bucket: qualifying ones (pass margin + book-sanity)
# first by margin, then the demoted/discarded ones. The mod shows the top 5 per
# display bucket. 1k and 500 share a display bucket.
DISPLAY_BUCKET = {7000: "7k", 4000: "4k", 2000: "2k", 1000: "1k+500", 500: "1k+500"}
DISPLAY_BUCKET_ORDER = ["7k", "4k", "2k", "1k+500"]

# Inventory-glut skip: stop recommending a buy once we already hold this many
# units of the product. Tighter for the small-order (1k/500) bucket - those are
# pricier items where a 500 position already ties up a lot of coins.
INVENTORY_CAP_DEFAULT = 1500
INVENTORY_CAP_SMALL_BUCKET = 500


def build_recommendation(bazaar_data, all_product_information, trader_data,
                         bazaar_fee, available_slots, time_between_trades_hours):
    # Products with a live (unclaimed) order in-game, so we don't re-recommend
    # something already placed (or already being worked on the sell side). Keyed
    # by display name (matches product names).
    open_buy_products = {o.get("item-name") for o in trader_data.get("buy-order-overview", {}).get("buy-orders", [])
                         if not o.get("has-been-claimed")}
    open_sell_products = {o.get("item-name") for o in trader_data.get("sell-order-overview", {}).get("sell-orders", [])
                          if not o.get("has-been-claimed")}

    reset_ms = most_recent_daily_reset_ms()
    cap_used = compute_daily_cap_used(reset_ms)
    cap_remaining = max(0, DAILY_ORDER_WORTH_CAP - cap_used)

    buys = build_all_candidates(
        bazaar_data, all_product_information,
        bazaar_fee, time_between_trades_hours,
        open_buy_products=open_buy_products, open_sell_products=open_sell_products,
    )

    # Inventory-glut skip: don't recommend buying more of something we're already
    # sitting on a lot of. Cap is 1500 held units normally, tightened to 500 for
    # the small-order (1k/500) bucket - those are pricier items where 500 is already
    # a big position. Held amount is the real inventory count (all-products'
    # current-amount), keyed by display name like the candidates.
    inventory = trader_data.get("all-products") or {}

    def _inventory_cap(bucket):
        return INVENTORY_CAP_SMALL_BUCKET if bucket in (1000, 500) else INVENTORY_CAP_DEFAULT

    def _held(product_name):
        entry = inventory.get(product_name) or {}
        return entry.get("current-amount") or 0

    buys = [c for c in buys if _held(c.product_name) <= _inventory_cap(c.bucket)]

    # Rank: group by display bucket (7k, 4k, 2k, 1k+500), and within each bucket put
    # the qualifying products first, then the demoted/discarded ones (they sort
    # behind every qualified one). Within a group, sort by a liquidity-weighted
    # score, margin x log10(volume): per-unit margin stays the dominant lever, but a
    # higher-volume (faster-filling) product is nudged up over a thinner one at
    # similar margin. log10 compresses volume so a ~10x volume gap only shifts the
    # multiplier by 1. The mod shows the top 5 per bucket, so failing products fall
    # off the visible list naturally without being thrown away.
    def _rank_score(c):
        return c.margin * math.log10(max(c.volume, 1.0))

    def _rank_key(c):
        display = DISPLAY_BUCKET.get(c.bucket, "1k+500")
        return (DISPLAY_BUCKET_ORDER.index(display) if display in DISPLAY_BUCKET_ORDER else 99,
                0 if c.qualified else 1,
                -_rank_score(c))
    buys.sort(key=_rank_key)

    n_qualified = sum(1 for c in buys if c.qualified)
    return {
        "available": True,
        "generated_at": int(time.time() * 1000),
        "bazaar_fee": bazaar_fee,
        "available_slots": available_slots,
        "daily_cap_used": cap_used,
        "daily_cap_remaining": cap_remaining,
        "n_qualified": n_qualified,
        "orders": [
            {
                "action": "buy",
                "product_name": c.product_name,
                "quantity": c.quantity,
                "expected_fill": round(c.expected_fill),
                "order_price": c.order_worth / c.quantity if c.quantity else 0,
                "buy_price": c.buy_price,
                "sell_price": c.sell_price,
                "margin": round(c.margin),
                "volume": round(c.volume),
                "rank_score": round(_rank_score(c)),
                "expected_profit": round(c.profit),
                "order_worth": c.order_worth,
                "coin_cost": c.coin_cost,
                "bucket": c.bucket,
                "display_bucket": DISPLAY_BUCKET.get(c.bucket, "1k+500"),
                "qualified": c.qualified,
                "npc_floor": c.npc_floor,
                "disqualify": list(c.disqualify),
            }
            for c in buys
        ],
    }


def write_recommendation(recommendation):
    tmp_path = RECOMMENDATION_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(recommendation, indent=2), encoding="utf-8")
    os.replace(tmp_path, RECOMMENDATION_PATH)


if __name__ == "__main__":
    product_list = retry_forever(get_product_list, "fetching product list")

    # Two decoupled beats so the recommendation reacts to inventory fast without
    # re-pulling (and re-parsing) the whole bazaar payload every tick:
    #   - RECOMPUTE: fetch trader-data (inventory/orders change the instant an
    #     order fills) and recompute every RECOMPUTE_INTERVAL_SECONDS.
    #   - BAZAAR: refresh the heavier, slowly-changing market data (Hypixel's
    #     bazaar only updates ~1/min) every BAZAAR_REFRESH_SECONDS, reusing the
    #     cached parse in between. The mayor tax rarely changes, so it rides the
    #     bazaar beat too.
    bazaar_data = all_product_information = None
    bazaar_fee = BASE_BAZAAR_TAX
    last_bazaar_refresh = 0.0
    # Recompute runs every few seconds; only log the heartbeat when the summary
    # actually changes (new order/qualified counts, cap, or free slots) so an idle
    # market doesn't fill the console with identical lines.
    last_summary = None

    while True:
        now = time.monotonic()

        if bazaar_data is None or now - last_bazaar_refresh >= BAZAAR_REFRESH_SECONDS:
            try:
                market_data = get_market_data()
                bazaar_data, all_product_information = build_bazaar_data_and_product_info(
                    market_data.get("bazaarProducts", {}), market_data.get("volumeStats", {}), product_list,
                    log_non_whitelisted=False,  # advisory only cares about whitelisted products; stay quiet on the rest
                )
                bazaar_fee = get_bazaar_fee()
                last_bazaar_refresh = now
                clear_anomaly("fetch-market-data-failed")
            except Exception:
                log_once(
                    "fetch-market-data-failed", logging.ERROR,
                    "failed to refresh bazaar/market data; will retry (reusing last bazaar data if any)", exc_info=True
                )
                if bazaar_data is None:
                    time.sleep(RECOMPUTE_INTERVAL_SECONDS)
                    continue  # nothing to recommend against yet

        try:
            trader_data = get_trader_data()
        except Exception:
            log_once(
                "fetch-trader-data-failed", logging.ERROR,
                "failed to fetch trader data this tick; will retry next interval", exc_info=True
            )
            time.sleep(RECOMPUTE_INTERVAL_SECONDS)
            continue
        clear_anomaly("fetch-trader-data-failed")

        # build_inventory runs for its anomaly logging (negative/over-max amounts).
        build_inventory(trader_data)
        available_slots = count_available_bazaar_slots(trader_data, TOTAL_BAZAAR_SLOTS)

        recommendation = build_recommendation(
            bazaar_data,
            all_product_information,
            trader_data,
            bazaar_fee,
            available_slots,
            TIME_BETWEEN_TRADES_HOURS,
        )
        write_recommendation(recommendation)
        summary = (
            len(recommendation["orders"]),
            recommendation["n_qualified"],
            recommendation["daily_cap_remaining"],
            available_slots,
        )
        if summary != last_summary:
            log.info(
                "recommended %d buy orders (%d qualified), cap remaining %s, %d slots free",
                summary[0], summary[1], f"{summary[2]:,.0f}", summary[3],
            )
            last_summary = summary

        time.sleep(RECOMPUTE_INTERVAL_SECONDS)

    # TODO: Make sure there is no product name confusion between all the datasets using api vs normalized

