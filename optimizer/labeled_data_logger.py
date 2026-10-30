"""
Standalone data collector for the order model. Runs independently of the live
trading bot (backend.mjs) - only reads from the existing public HTTP API, so a
bug here can't destabilize live trading.

Every SNAPSHOT_INTERVAL_SECONDS, takes a feature snapshot of every bazaar
product (the same features main.py's heuristic already uses), then tracks what
actually happens to that product's volume and price over the next
HORIZONS_HOURS and writes the (features, realized outcome) pair to
labeled-order-data.jsonl once each horizon has elapsed. That JSONL file is the
training data for the order model discussed - dense, whole-catalog coverage
rather than only the handful of items that happened to get traded.

Realized volume is measured by diffing the order book between polls (same
method backend.mjs's diffOrderBookSide uses for its own trend history), NOT by
diffing quick_status.sellMovingWeek/buyMovingWeek. Empirically, movingWeek is
not a smooth monotonic counter - cross-checked against backend.mjs's own 25h
of order-book-diff history, it periodically drops (Hypixel appears to rotate
it in hourly buckets internally), which a naive diff silently undercounts
(clamped to 0). Measured bias on real data ranged from -1.5% to -53.6%
depending on the product. Order-book diffing needs short polling intervals to
stay accurate (a vanished price tier at low frequency is ambiguous between
"consumed" and "pushed out of the visible top ~20 tiers by repricing"), so
POLL_INTERVAL_SECONDS is much shorter here than the snapshot cadence.
"""

import json
import logging
import os
import time
from pathlib import Path

from api_client import get_market_data, get_product_list
from main import build_bazaar_data_and_product_info

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("labeled_data_logger")

# Matches backend.mjs's own fetch/record cadence - order-book diffing needs to
# stay this frequent to reliably tell "consumed" apart from "repriced out of
# the visible window" (see module docstring).
POLL_INTERVAL_SECONDS = 60

# How often a NEW snapshot is taken per product. Much coarser than the poll
# interval on purpose - polling every 60s is only there to keep the volume
# tally accurate; taking a fresh feature snapshot that often would produce
# near-duplicate, highly correlated rows for the same window.
SNAPSHOT_INTERVAL_SECONDS = 60 * 60

# Matches the stated flip cadence ("about every 8 hours, sometimes 12").
HORIZONS_HOURS = [8, 12]

# Checkpointing every poll would mean writing the whole pending-rows buffer to
# disk once a minute; that's wasted I/O for a risk we're fine accepting
# (losing at most a few minutes of accumulated ticks on a crash).
CHECKPOINT_INTERVAL_SECONDS = 5 * 60

# On restart, a pending row overdue by more than this can't be validly resolved:
# its horizon elapsed while the logger was down, so no order-book polls accumulated
# its realized volume and its "end" prices would be from long after the horizon.
# Such rows are dropped at startup (on a clean restart nothing is overdue).
STALE_PENDING_GRACE_MS = 60 * 60 * 1000

OUTPUT_PATH = Path(__file__).parent.parent / "data" / "labeled-order-data.jsonl"
CHECKPOINT_PATH = Path(__file__).parent.parent / "data" / "labeled-order-data.checkpoint.json"


def round_price(price):
    return round(price * 10) / 10


def diff_order_book_side(old_entries, new_entries):
    """Python port of backend.mjs's diffOrderBookSide. A shrunk price tier's
    decrease is counted as traded volume. A vanished tier is deliberately NOT
    counted as fully traded - see module docstring for why."""
    old_by_price = {}
    for entry in old_entries or []:
        old_by_price[round_price(entry["pricePerUnit"])] = entry
    new_by_price = {}
    for entry in new_entries or []:
        new_by_price[round_price(entry["pricePerUnit"])] = entry

    volume = 0
    for price, old_entry in old_by_price.items():
        new_entry = new_by_price.get(price)
        if new_entry is not None and new_entry["amount"] < old_entry["amount"]:
            volume += old_entry["amount"] - new_entry["amount"]
    return volume


def load_checkpoint():
    if not CHECKPOINT_PATH.exists():
        return [], {}, 0
    try:
        data = json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
        return data["pending"], data["last_order_book"], data.get("last_snapshot_time", 0)
    except Exception:
        log.error("failed to load checkpoint, starting fresh", exc_info=True)
        return [], {}, 0


def save_checkpoint(pending, last_order_book, last_snapshot_time):
    tmp_path = CHECKPOINT_PATH.with_suffix(".tmp")
    tmp_path.write_text(
        json.dumps({
            "pending": pending,
            "last_order_book": last_order_book,
            "last_snapshot_time": last_snapshot_time,
        }),
        encoding="utf-8",
    )
    os.replace(tmp_path, CHECKPOINT_PATH)


def append_rows(rows):
    if not rows:
        return
    with OUTPUT_PATH.open("a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")


def take_snapshot(now_ms, product_name, info, prices, quick_status):
    entry = {
        "product_name": product_name,
        "snapshot_time": now_ms,
        "instant_buy_price": quick_status.get("buyPrice"),
        "instant_sell_price": quick_status.get("sellPrice"),
        "order_buy_price": prices["buy_price"],
        "order_sell_price": prices["sell_price"],
        "sell_volume_7d": info["sell_volume_7_day"],
        "buy_volume_7d": info["bought_volume_7_day"],
        "sell_per_hour_1h": info["past_quantity_sold_per_hour"],
        "sell_per_hour_24h": info["sell_volume_24_hour"],
        "buy_per_hour_1h": info["past_quantity_bought_per_hour"],
        "buy_per_hour_24h": info["bought_volume_24_hour"],
        "new_sell_listings_per_hour": info["new_listings_per_hour_selling"],
        "new_buy_listings_per_hour": info["new_listings_per_hour_buying"],
        "sell_volume_7d_weight": info["sell_volume_7_day_weight"],
        "sell_volume_24h_weight": info["sell_volume_24_hour_weight"],
        "new_sell_listings_weight": info["new_listings_per_hour_selling_weight"],
        "buy_volume_7d_weight": info["bought_volume_7_day_weight"],
        "buy_volume_24h_weight": info["bought_volume_24_hour_weight"],
        "new_buy_listings_weight": info["new_listings_per_hour_buying_weight"],
    }

    rows = []
    for horizon_hours in HORIZONS_HOURS:
        rows.append({
            **entry,
            "horizon_hours": horizon_hours,
            "resolve_time": now_ms + horizon_hours * 3600 * 1000,
            "realized_sell_volume": 0,
            "realized_buy_volume": 0,
            "data_gap": False,
        })
    return rows


def finalize_row(row, prices, quick_status):
    row = dict(row)
    row["end_instant_buy_price"] = quick_status.get("buyPrice") if quick_status else None
    row["end_instant_sell_price"] = quick_status.get("sellPrice") if quick_status else None
    row["end_order_buy_price"] = prices["buy_price"] if prices else None
    row["end_order_sell_price"] = prices["sell_price"] if prices else None
    if quick_status is None or prices is None:
        row["data_gap"] = True
    return row


def run():
    product_list = get_product_list()
    pending, last_order_book, last_snapshot_time = load_checkpoint()

    # Discard rows whose horizon elapsed while the logger was down (see
    # STALE_PENDING_GRACE_MS) - resolving them now would poison the training set.
    startup_ms = int(time.time() * 1000)
    fresh_pending = [row for row in pending if row["resolve_time"] > startup_ms - STALE_PENDING_GRACE_MS]
    if len(fresh_pending) != len(pending):
        log.warning("dropping %d stale pending rows overdue after a logging gap", len(pending) - len(fresh_pending))
    pending = fresh_pending

    last_checkpoint_time = 0
    log.info("starting with %d pending rows, %d tracked order books", len(pending), len(last_order_book))

    while True:
        time.sleep(POLL_INTERVAL_SECONDS)

        try:
            market_data = get_market_data()
        except Exception:
            log.error("failed to fetch market data this poll; will retry next interval", exc_info=True)
            continue

        bazaar_products = market_data.get("bazaarProducts", {})
        bazaar_data, all_product_information = build_bazaar_data_and_product_info(
            bazaar_products, market_data.get("volumeStats", {}), product_list
        )

        current_order_book = {}
        current_quick_status = {}
        for product_name in all_product_information:
            api_name = product_list[product_name]["api-name"]
            product = bazaar_products.get(api_name)
            if product is None:
                continue
            quick_status = product.get("quick_status")
            if quick_status is not None:
                current_quick_status[product_name] = quick_status
            current_order_book[product_name] = {
                "sell": product.get("sell_summary", []),
                "buy": product.get("buy_summary", []),
            }

        now_ms = int(time.time() * 1000)

        # Accumulate realized volume into every still-open pending row. The
        # order book is from the trader's own perspective naming (see main.py's
        # comment on this): sell_summary holds active BUY orders (bids) you'd
        # sell into, buy_summary holds active SELL orders (asks) you'd buy into.
        for product_name, book in current_order_book.items():
            prev_book = last_order_book.get(product_name)
            if prev_book is None:
                continue
            sell_tick = diff_order_book_side(prev_book["sell"], book["sell"])
            buy_tick = diff_order_book_side(prev_book["buy"], book["buy"])
            for row in pending:
                if row["product_name"] == product_name and now_ms < row["resolve_time"]:
                    row["realized_sell_volume"] += sell_tick
                    row["realized_buy_volume"] += buy_tick

        # Any product missing this poll had a data gap - mark its open rows so
        # training can filter/weight them accordingly instead of trusting a
        # silently-undercounted realized volume.
        missing_products = set(last_order_book) - set(current_order_book)
        for row in pending:
            if row["product_name"] in missing_products and now_ms < row["resolve_time"]:
                row["data_gap"] = True

        last_order_book = current_order_book

        # Resolve anything whose horizon has passed.
        still_pending = []
        finished = []
        for row in pending:
            if now_ms >= row["resolve_time"]:
                prices = bazaar_data.get(row["product_name"])
                quick_status = current_quick_status.get(row["product_name"])
                finished.append(finalize_row(row, prices, quick_status))
            else:
                still_pending.append(row)
        pending = still_pending
        append_rows(finished)
        if finished:
            log.info("resolved %d rows, %d still pending", len(finished), len(pending))

        # Take a fresh snapshot for every product on the coarser snapshot cadence.
        if now_ms - last_snapshot_time >= SNAPSHOT_INTERVAL_SECONDS * 1000:
            new_rows = 0
            snapshotted = 0
            for product_name, info in all_product_information.items():
                # Skip auction-house items - this models bazaar flips only.
                if product_list.get(product_name, {}).get("type") == "auction-product":
                    continue
                prices = bazaar_data.get(product_name)
                quick_status = current_quick_status.get(product_name)
                if prices is None or quick_status is None:
                    continue
                # Skip anything with a 0/absent price (no active bids/asks): a 0 coin
                # price isn't a real tradeable state worth a training row. Checks both
                # the order-book prices and the instant buy/sell prices.
                if prices["buy_price"] <= 0 or prices["sell_price"] <= 0:
                    continue
                if not quick_status.get("buyPrice") or not quick_status.get("sellPrice"):
                    continue
                pending.extend(take_snapshot(now_ms, product_name, info, prices, quick_status))
                snapshotted += 1
                new_rows += len(HORIZONS_HOURS)
            last_snapshot_time = now_ms
            log.info("took snapshots for %d of %d products (skipped auction-house + zero-price); %d pending rows added",
                     snapshotted, len(all_product_information), new_rows)

        if now_ms - last_checkpoint_time >= CHECKPOINT_INTERVAL_SECONDS * 1000:
            save_checkpoint(pending, last_order_book, last_snapshot_time)
            last_checkpoint_time = now_ms


if __name__ == "__main__":
    run()
