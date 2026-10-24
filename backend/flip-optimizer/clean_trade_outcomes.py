"""
Cleanup pass for backend.mjs's trade-outcomes.jsonl before it's used as
training data for the fill-prediction model.

Never modifies the raw log - backend.mjs is appending to it live, so rewriting
it in place would race with the bot. Instead writes a cleaned copy
(trade-outcomes.clean.jsonl, same event format) plus a report of everything
that was changed or dropped (trade-outcomes.clean-report.json).

Fixes applied, per order_id:
  - Orphans (progress/resolved with no "placed" event - orders placed before
    the log started, or while placed-logging was broken) are dropped, since
    there are no features to train on.
  - Duplicate "resolved" events: only the first is kept.
  - Progress events after the resolve are dropped.
  - Progress that goes backwards is clamped to the running max (filled amount
    is cumulative and can't actually decrease); the order is flagged.
  - filled_amount above order_amount is clamped to order_amount.
  - Stale orders (placed, never resolved, no activity for STALE_AFTER_HOURS,
    and not still live in trader-data.json) get a synthetic resolved event with
    outcome "unknown" and filled_amount = the last known fill (a lower bound).
    These are usually orders claimed/cancelled while the bot was off.

Cleaned events carry a "flags" list when anything about them was changed, so
the model side can choose to exclude or down-weight them.

Fill-model censoring: every resolved event also gets a "censored" bool. A
"filled" order is fully observed (censored False); a "cancelled" or synthetic
"unknown" resolve only tells us how much had filled before observation stopped,
i.e. a right-censored lower bound (censored True) - train on these as censored
fills, NOT as "did not fill". The normal batch-cancel/relist cycle cancels on
the ~5.5-9h flip cadence (verified against the log), so a cancel far sooner than
that is a manual change-of-mind or a listed-before-stock mistake whose early
cancel time is informative, not a market signal; those get a
"likely_manual_cancel" flag so training can drop them.
"""

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

BACKEND_DIR = Path(__file__).parent.parent
RAW_PATH = BACKEND_DIR / "Testing" / "trade-outcomes.jsonl"
CLEAN_PATH = BACKEND_DIR / "Testing" / "trade-outcomes.clean.jsonl"
REPORT_PATH = BACKEND_DIR / "Testing" / "trade-outcomes.clean-report.json"
TRADER_DATA_PATH = BACKEND_DIR / "production" / "trader-data.json"

# Orders are relisted well within this window under the normal batch
# cancel/relist cycle, so anything quiet for longer has lost its resolve event.
STALE_AFTER_HOURS = 48

# Strategic relist cancels land on the ~5.5-9h flip cadence (empirically, 90% of
# cancels are >5.5h). A cancel sooner than this is a manual mistake (changed
# mind, listed before the stock was in inventory) - flagged, not trusted as a
# fill signal. Well below the strategic cluster, so it isolates the mistake tail.
MANUAL_CANCEL_MAX_MINUTES = 60


def event_time(e):
    return e.get("timestamp") or e.get("place_time") or e.get("resolve_time") or 0


def load_events(path):
    # Only read up to the last newline - the bot may be mid-append.
    text = path.read_text(encoding="utf-8")
    text = text[: text.rfind("\n") + 1]
    events, bad = [], []
    for lineno, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            bad.append(lineno)
    return events, bad


def load_live_order_ids(path):
    """Order ids still open in trader-data.json, so they're never marked stale."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    live = set()
    for order in data.get("buy-order-overview", {}).get("buy-orders", []):
        place_time = order.get("buy-order-place-time")
        if place_time:
            live.add(f"buy:{order['item-name']}:{place_time}")
    for order in data.get("sell-order-overview", {}).get("sell-orders", []):
        place_time = order.get("sell-order-place-time")
        if place_time:
            live.add(f"sell:{order['item-name']}:{place_time}")
    return live


def clean(events, live_ids, now_ms, stale_after_ms, manual_cancel_max_ms):
    by_order = defaultdict(lambda: {"placed": None, "progress": [], "resolved": []})
    for e in events:
        o = by_order[e["order_id"]]
        if e["event"] == "placed":
            o["placed"] = e
        elif e["event"] == "progress":
            o["progress"].append(e)
        elif e["event"] == "resolved":
            o["resolved"].append(e)

    report = defaultdict(list)
    out = []

    for order_id, o in by_order.items():
        placed = o["placed"]
        if placed is None:
            report["dropped_orphans"].append(order_id)
            continue

        order_amount = placed["order_amount"]
        progress = sorted(o["progress"], key=event_time)
        resolved = sorted(o["resolved"], key=event_time)
        order_flags = []

        if len(resolved) > 1:
            report["dropped_duplicate_resolves"].append(order_id)
            order_flags.append("duplicate_resolve")
        resolve = dict(resolved[0]) if resolved else None

        if resolve:
            late = [p for p in progress if p["timestamp"] > resolve["resolve_time"]]
            if late:
                report["dropped_progress_after_resolve"].append(order_id)
                progress = [p for p in progress if p["timestamp"] <= resolve["resolve_time"]]

        cleaned_progress, running_max = [], 0
        for p in progress:
            p = dict(p)
            if p["filled_amount_so_far"] < running_max:
                p["filled_amount_so_far"] = running_max
                p["flags"] = ["clamped_regression"]
                if "progress_regressed" not in order_flags:
                    order_flags.append("progress_regressed")
                    report["clamped_progress_regressions"].append(order_id)
            running_max = p["filled_amount_so_far"]
            cleaned_progress.append(p)

        if resolve and resolve["filled_amount"] > order_amount:
            report["clamped_overfills"].append(order_id)
            resolve["filled_amount"] = order_amount
            order_flags.append("clamped_overfill")

        if resolve is None:
            last_seen = max([placed["place_time"]] + [p["timestamp"] for p in cleaned_progress])
            if order_id not in live_ids and now_ms - last_seen > stale_after_ms:
                resolve = {
                    "event": "resolved",
                    "order_id": order_id,
                    "resolve_time": last_seen,
                    "outcome": "unknown",
                    "filled_amount": min(running_max, order_amount),
                    "time_to_resolve_ms": last_seen - placed["place_time"],
                    "synthetic": True,
                }
                order_flags.append("synthetic_resolve")
                report["synthetic_resolves"].append(order_id)
            else:
                report["still_open"].append(order_id)

        # Right-censoring for the fill model (see module docstring): filled =
        # fully observed; cancelled / synthetic-unknown = censored lower bound.
        if resolve:
            resolve["censored"] = resolve.get("outcome") != "filled"
            if resolve.get("outcome") == "cancelled" and (resolve.get("time_to_resolve_ms") or 0) < manual_cancel_max_ms:
                order_flags.append("likely_manual_cancel")
                report["likely_manual_cancels"].append(order_id)

        if order_flags and resolve:
            resolve["flags"] = order_flags
        out.append(placed)
        out.extend(cleaned_progress)
        if resolve:
            out.append(resolve)

    out.sort(key=event_time)

    null_counts = defaultdict(int)
    for o in by_order.values():
        if o["placed"]:
            for k, v in o["placed"].items():
                if v is None:
                    null_counts[k] += 1

    return out, report, dict(null_counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--stale-hours", type=float, default=STALE_AFTER_HOURS)
    parser.add_argument("--manual-cancel-minutes", type=float, default=MANUAL_CANCEL_MAX_MINUTES)
    args = parser.parse_args()

    events, bad_lines = load_events(RAW_PATH)
    live_ids = load_live_order_ids(TRADER_DATA_PATH)
    now_ms = int(time.time() * 1000)
    out, report, null_counts = clean(
        events, live_ids, now_ms,
        args.stale_hours * 3600 * 1000,
        args.manual_cancel_minutes * 60 * 1000,
    )

    tmp = CLEAN_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for e in out:
            f.write(json.dumps(e) + "\n")
    tmp.replace(CLEAN_PATH)

    summary = {k: len(v) for k, v in report.items()}
    full_report = {
        "generated_at": now_ms,
        "raw_events": len(events),
        "clean_events": len(out),
        "unparseable_lines": bad_lines,
        "live_orders_in_trader_data": len(live_ids),
        "summary": summary,
        "null_feature_counts": null_counts,
        "order_ids": report,
    }
    REPORT_PATH.write_text(json.dumps(full_report, indent=2), encoding="utf-8")

    print(f"{len(events)} raw events -> {len(out)} clean events ({CLEAN_PATH.name})")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    if null_counts:
        print(f"  null features in placed (left as-is): {null_counts}")
    print(f"Report: {REPORT_PATH.name}")


if __name__ == "__main__":
    main()
