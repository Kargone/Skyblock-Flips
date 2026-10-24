class FindMaxProfit:
    # DEPRECATED - superseded by allocator.py, which is the live ranking engine
    # wired into the poll loop below. This class scored every product
    # independently with no shared-constraint accounting and carries the old
    # pre-fix profit/weight math (compounded weights, (sell-buy)*(1-fee) tax).
    # Kept only for reference; it is no longer instantiated or called.
    def __init__(self, available_slots_in_bazaar, current_coins_amount, inventory, all_product_information, bazaar_data):
        self.current_coins_amount = current_coins_amount
        self.inventory = inventory
        self.all_product_information = all_product_information
        self.bazaar_data = bazaar_data

        self.bazaar_daily_limit_used = 0
        self.BAZAAR_DAILY_LIMIT = 15_000_000_000
        self.TRADES_PER_DAY = 3
        self.TIME_BETWEEN_TRADES = 8 # Hours
        self.MAX_TRADE_LIMIT_COINS_PER_SESSION = self.BAZAAR_DAILY_LIMIT // self.TRADES_PER_DAY

        self.npc_sell_limit_used = 0
        self.NPC_SELL_LIMIT = 500_000_000

        self.SLOTS_TOTAL = 28 # between 14 and 28 based on upgrades
        self.available_slots_in_bazaar = available_slots_in_bazaar


    def find_max_profit_for_slot(self, product_list):
        # look through every product on bz and rank them given constraints in self
        # TODO: Slot optimization and daily limit optimization

        max_profit_table = {}
        for product_name in product_list:
            max_profit_table[product_name] = self.find_expected_profit_per_slot(product_name)

        return max_profit_table

    def find_expected_profit_per_slot(self, product_name):
        expected_quantity_sold_per_item = self.find_expected_quantity_sold_per_slot(product_name)
        expected_profit_per_item = self.find_expected_profit_per_item(product_name)
        return expected_profit_per_item * expected_quantity_sold_per_item

    def find_expected_quantity_sold_per_slot(self, product_name):
        product_info = self.all_product_information[product_name]
        past_quantity_sold_per_hour = product_info["past_quantity_sold_per_hour"]

        # Each weight compares a current stat (7-day volume, 24-hour volume, new
        # listings/hour) against an EMA of its own recent past, computed server-side
        # in backend.mjs. >1 means running hotter than usual, <1 means cooler.
        weight_1 = product_info["sell_volume_7_day_weight"]
        weight_2 = product_info["sell_volume_24_hour_weight"]
        weight_3 = product_info["new_listings_per_hour_selling_weight"]

        # TODO: Slots not taken into account
        expected_bought_amount = self.find_expected_bought_amount(product_name)
        # A product you've never traded before won't have an inventory entry yet -
        # that just means you're holding 0 of it, not an error.
        current_held_amount = self.inventory.get(product_name, {}).get("current-amount", 0) + expected_bought_amount

        return min(past_quantity_sold_per_hour * self.TIME_BETWEEN_TRADES, current_held_amount) * weight_1 * weight_2 * weight_3

    def find_expected_bought_amount(self, product_name):
        product_info = self.all_product_information[product_name]
        past_quantity_bought_per_hour = product_info["past_quantity_bought_per_hour"]

        weight_1 = product_info["bought_volume_7_day_weight"]
        weight_2 = product_info["bought_volume_24_hour_weight"]
        weight_3 = product_info["new_listings_per_hour_buying_weight"]

        # TODO: Optimize this
        buy_order_quantity = 2000

        return min(past_quantity_bought_per_hour * self.TIME_BETWEEN_TRADES, buy_order_quantity) * weight_1 * weight_2 * weight_3

    def find_expected_profit_per_item(self, product_name):
        # determine if the order would go over the npc sell limit better. not if it's already reached, but if it would be reached if the order is sold
        npc_sell_limit_reached = self.npc_sell_limit_used >= self.NPC_SELL_LIMIT

        # TODO: Make this changeable
        bazaar_fee = 0.01 # between 1 and 6 (if derpy)

        # TODO: Fix this
        current_product_sell_price = self.bazaar_data[product_name]["sell_price"]
        current_product_buy_price = self.bazaar_data[product_name]["buy_price"]

        expected_change_sell_price = 0 # for now
        expected_change_buy_price = 0 # for now

        # doesn't do anything for now
        future_sell_price = current_product_sell_price + expected_change_sell_price
        future_buy_price = current_product_sell_price + expected_change_buy_price

        return (current_product_sell_price - current_product_buy_price) * (1 - bazaar_fee) if npc_sell_limit_reached else (current_product_sell_price - current_product_buy_price)

    def update_constraints(self, order_worth):
        if order_worth > self.current_coins_amount:
            print("ERROR: You dont have enough coins for that order")
        else:
            self.available_slots_in_bazaar -= 1
            self.bazaar_daily_limit_used += order_worth
            self.current_coins_amount -= order_worth

    def reset_for_new_session(self, coins_amount, inventory, all_product_information, bazaar_data):
        self.current_coins_amount = coins_amount
        self.bazaar_daily_limit_used = 0
        self.inventory = inventory
        self.all_product_information = all_product_information
        self.bazaar_data = bazaar_data

    def reset_npc_limit(self):
        self.npc_sell_limit_used = 0



import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from allocator import DAILY_ORDER_WORTH_CAP, build_all_candidates, solve_sells_first
from api_client import get_market_data, get_mayor_data, get_product_list, get_purse_from_hypixel, get_trader_data

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


POLL_INTERVAL_SECONDS = 30
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
TRADE_LOG_PATH = Path(__file__).parent.parent / "Testing" / "trade-outcomes.jsonl"

# Where the ranked advisory order list is written each poll for the mod to read.
RECOMMENDATION_PATH = Path(__file__).parent / "recommendation.json"


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


def build_bazaar_data_and_product_info(bazaar_products, volume_stats, product_list):
    bazaar_data = {}
    all_product_information = {}

    for product_name, product_meta in product_list.items():
        api_name = product_meta.get("api-name")
        if not api_name:
            if product_meta.get("has-weights"):
                log_once((product_name, "missing-api-name"), logging.ERROR, "'%s' has no api-name in product-list.json; skipping", product_name)
            # else: an AH-only item (accessories, etc) with no bazaar presence by design.
            continue
        clear_anomaly((product_name, "missing-api-name"))

        product = bazaar_products.get(api_name)
        if product is None:
            log_once((product_name, "missing-bazaar-data"), logging.ERROR, "no bazaar data found for '%s' (api-name '%s')", product_name, api_name)
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
            log_once((product_name, "no-bids"), logging.WARNING, "'%s' has no active buy orders (bids); can't derive a sell order price", product_name)
        else:
            clear_anomaly((product_name, "no-bids"))
        if not buy_summary:
            log_once((product_name, "no-asks"), logging.WARNING, "'%s' has no active sell orders (asks); can't derive a buy order price", product_name)
        else:
            clear_anomaly((product_name, "no-asks"))

        best_bid = max((order["pricePerUnit"] for order in sell_summary), default=None)
        best_ask = min((order["pricePerUnit"] for order in buy_summary), default=None)

        sell_price = best_ask - BAZAAR_PRICE_INCREMENT if best_ask is not None else 0
        buy_price = best_bid + BAZAAR_PRICE_INCREMENT if best_bid is not None else 0

        if sell_price <= 0:
            log_once((product_name, "non-positive-sell-price"), logging.ERROR, "'%s' has a non-positive sell order price: %s", product_name, sell_price)
        else:
            clear_anomaly((product_name, "non-positive-sell-price"))
        if buy_price <= 0:
            log_once((product_name, "non-positive-buy-price"), logging.ERROR, "'%s' has a non-positive buy order price: %s", product_name, buy_price)
        else:
            clear_anomaly((product_name, "non-positive-buy-price"))
        if best_ask is not None and best_bid is not None and buy_price >= sell_price:
            log_once(
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
            log_once((product_name, "missing-quick-status"), logging.ERROR, "'%s' is missing quick_status", product_name)
            quick_status = {}
        else:
            clear_anomaly((product_name, "missing-quick-status"))

        sell_moving_week = quick_status.get("sellMovingWeek", 0)
        buy_moving_week = quick_status.get("buyMovingWeek", 0)
        if sell_moving_week < 0:
            log_once((product_name, "negative-sell-moving-week"), logging.ERROR, "'%s' has a negative sellMovingWeek: %s", product_name, sell_moving_week)
        else:
            clear_anomaly((product_name, "negative-sell-moving-week"))
        if buy_moving_week < 0:
            log_once((product_name, "negative-buy-moving-week"), logging.ERROR, "'%s' has a negative buyMovingWeek: %s", product_name, buy_moving_week)
        else:
            clear_anomaly((product_name, "negative-buy-moving-week"))

        # The server (backend.mjs) keeps a rolling history of quick_status samples and
        # computes real 1h/24h rates from it. Right after a server restarts, there won't
        # be enough history yet, so fall back to spreading the weekly volume evenly
        # until real rates are available.
        stats = volume_stats.get(api_name)
        if stats is None:
            log_once((product_name, "no-volume-stats"), logging.INFO, "no volumeStats yet for '%s'; falling back to weekly-average estimate", product_name)
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
            "max_stack_size": product_meta.get("max-stack-size"),
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


SECRETS_PATH = Path(__file__).parent / "secrets.json"
PURSE_TTL_SECONDS = 120
_purse_cache = {"value": None, "at": 0.0}


def load_secrets():
    """Hypixel credentials from the gitignored secrets.json (see
    secrets.example.json). Never commit secrets.json. Matching env vars override
    the file, so the tower can use either."""
    data = {}
    try:
        data = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        pass
    except (OSError, json.JSONDecodeError):
        log_once("bad-secrets", logging.ERROR, "couldn't read secrets.json; falling back to env/FLIP_PURSE", exc_info=True)
    return {
        "hypixel_api_key": os.environ.get("HYPIXEL_API_KEY") or data.get("hypixel_api_key"),
        "profile_id": os.environ.get("HYPIXEL_PROFILE_ID") or data.get("profile_id"),
        "player_uuid": os.environ.get("HYPIXEL_PLAYER_UUID") or data.get("player_uuid"),
    }


def _manual_purse():
    raw = os.environ.get("FLIP_PURSE")
    if not raw:
        return 0
    try:
        return float(raw)
    except ValueError:
        log_once("bad-purse-env", logging.ERROR, "FLIP_PURSE is not a number: %r; treating purse as 0", raw)
        return 0


def get_configured_purse():
    """Current coin purse. Prefers the live Hypixel profile endpoint when all
    three credentials are configured (cached PURSE_TTL_SECONDS so the profile
    API isn't hit every poll), reusing the last-known value on a transient
    failure. Falls back to the FLIP_PURSE env var, then 0 (sells-only)."""
    creds = load_secrets()
    if creds["hypixel_api_key"] and creds["profile_id"] and creds["player_uuid"]:
        now = time.time()
        if _purse_cache["value"] is not None and now - _purse_cache["at"] < PURSE_TTL_SECONDS:
            return _purse_cache["value"]
        try:
            purse = get_purse_from_hypixel(creds["hypixel_api_key"], creds["profile_id"], creds["player_uuid"])
            clear_anomaly("fetch-purse-failed")
            if purse is not None:
                _purse_cache.update(value=float(purse), at=now)
                return _purse_cache["value"]
        except Exception:
            log_once("fetch-purse-failed", logging.WARNING, "couldn't fetch purse from Hypixel; using last-known/fallback", exc_info=True)
        if _purse_cache["value"] is not None:
            return _purse_cache["value"]
    return _manual_purse()


def build_recommendation(bazaar_data, all_product_information, short_term_investments,
                         bazaar_fee, purse, available_slots, time_between_trades_hours):
    # Guard: inventory we hold but can't price this poll won't be offered for
    # sale by the allocator (it only ranks products in bazaar_data). Surface it
    # so stock never goes silently unsold - e.g. a held item missing from the
    # product-list/bazaar join, or one with no live order book right now.
    for name in short_term_investments:
        if name in bazaar_data:
            clear_anomaly((name, "held-but-unpriced"))
        else:
            log_once((name, "held-but-unpriced"), logging.WARNING,
                     "holding '%s' but it has no bazaar price this poll; it won't be offered for sale", name)

    reset_ms = most_recent_daily_reset_ms()
    cap_used = compute_daily_cap_used(reset_ms)
    cap_remaining = max(0, DAILY_ORDER_WORTH_CAP - cap_used)

    candidates = build_all_candidates(
        bazaar_data, all_product_information, short_term_investments,
        bazaar_fee, purse, time_between_trades_hours,
    )
    chosen = solve_sells_first(candidates, available_slots, purse, cap_remaining)
    chosen.sort(key=lambda c: c.profit, reverse=True)

    return {
        "available": True,
        "generated_at": int(time.time() * 1000),
        "bazaar_fee": bazaar_fee,
        "purse": purse,
        "available_slots": available_slots,
        "daily_cap_used": cap_used,
        "daily_cap_remaining": cap_remaining,
        "total_expected_profit": sum(c.profit for c in chosen),
        "orders": [
            {
                "action": "sell" if c.side == "sell_inventory" else "buy",
                "product_name": c.product_name,
                "quantity": c.quantity,
                "order_price": c.order_worth / c.quantity if c.quantity else 0,
                "expected_profit": c.profit,
                "order_worth": c.order_worth,
                "coin_cost": c.coin_cost,
            }
            for c in chosen
        ],
    }


def write_recommendation(recommendation):
    tmp_path = RECOMMENDATION_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(recommendation, indent=2), encoding="utf-8")
    os.replace(tmp_path, RECOMMENDATION_PATH)


if __name__ == "__main__":
    product_list = get_product_list()

    while True:
        try:
            trader_data = get_trader_data()
            market_data = get_market_data()
        except Exception:
            log_once(
                "fetch-trader-market-data-failed", logging.ERROR,
                "failed to fetch data from the server this poll; will retry next interval", exc_info=True
            )
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        clear_anomaly("fetch-trader-market-data-failed")

        # build_inventory still runs for its anomaly logging; the allocator reads
        # held quantities from short-term-investments directly (cost basis lives there).
        build_inventory(trader_data)
        available_slots = count_available_bazaar_slots(trader_data, TOTAL_BAZAAR_SLOTS)
        bazaar_data, all_product_information = build_bazaar_data_and_product_info(
            market_data.get("bazaarProducts", {}), market_data.get("volumeStats", {}), product_list
        )

        recommendation = build_recommendation(
            bazaar_data,
            all_product_information,
            trader_data.get("short-term-investments", {}),
            get_bazaar_fee(),
            get_configured_purse(),
            available_slots,
            TIME_BETWEEN_TRADES_HOURS,
        )
        write_recommendation(recommendation)
        log.info(
            "recommended %d orders, total expected profit %s (cap remaining %s, %d slots free)",
            len(recommendation["orders"]),
            f"{recommendation['total_expected_profit']:,.0f}",
            f"{recommendation['daily_cap_remaining']:,.0f}",
            available_slots,
        )

        time.sleep(POLL_INTERVAL_SECONDS)

    # TODO: Make sure there is no product name confusion between all the datasets using api vs normalized

