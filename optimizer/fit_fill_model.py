"""
Fits the fill-rate model the allocator uses to predict how much of an order
will actually fill, and writes it to fill_model.json (loaded by fill_model.py).

WHY A RATE MODEL. ~80% of the logged orders are right-censored: the user
batch-cancels most orders after ~8h rather than letting them run to
completion, so the final fill is never observed. A naive average fill
fraction is therefore meaningless (it mostly measures how early orders were
cancelled, not how fast they fill). The censoring is driven by elapsed time,
not by how a given order is doing, which is the benign case: pooling
    rate = sum(filled_units) / sum(minutes_the_order_was_alive)
over a regime is an unbiased estimate of that regime's fill throughput even
under heavy censoring (an order cancelled early simply contributes less to
both the numerator and the denominator).

REGIMES. Fill throughput is dominated by 7-day volume (empirically ~14x from
the lowest to highest volume quintile) and differs by side, so the table is
keyed on (side, volume bucket). Price-aggressiveness barely varies in the
data because the user almost always prices at the touch, so it isn't used.

INFERENCE. expected_fill = min(cap_qty, rate * horizon_minutes). The horizon
defaults to the user's ~8h cancel cycle, which is also where the training
fills concentrate, so this interpolates rather than extrapolates.

Run:  python optimizer/fit_fill_model.py
"""

import json
import pathlib
from collections import defaultdict
from datetime import datetime, timezone

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
CLEAN_PATH = DATA_DIR / "trade-outcomes.clean.jsonl"
OUTPUT_PATH = pathlib.Path(__file__).parent / "fill_model.json"

HORIZON_HOURS = 8                 # the user's batch-cancel cycle; the ranking horizon
MIN_EXPOSURE_MINUTES = 1.0        # ignore orders alive < 1 min (rate is ill-defined)
N_BUCKETS = 5                     # volume quantile buckets
MIN_BUCKET_ORDERS = 20            # below this, fall back to the side's overall rate


def load_orders(path):
    placed, resolved = {}, {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            oid = e["order_id"]
            if e["event"] == "placed":
                placed[oid] = e
            elif e["event"] == "resolved":
                resolved[oid] = e

    orders = []
    for oid, p in placed.items():
        r = resolved.get(oid)
        if not r:
            continue
        amt = p.get("order_amount") or 0
        alive_min = r.get("time_to_resolve_ms", 0) / 60000.0
        if amt <= 0 or alive_min < MIN_EXPOSURE_MINUTES:
            continue
        orders.append({
            "side": p.get("order_type"),
            "vol7": p.get("volume_7_day") or 0,
            "filled": min(r.get("filled_amount", 0), amt),
            "alive_min": alive_min,
        })
    return orders


def quantile_edges(values, n):
    s = sorted(values)
    return [s[int(q / n * (len(s) - 1))] for q in range(1, n)]


def bucket_of(vol, edges):
    for i, ed in enumerate(edges):
        if vol <= ed:
            return i
    return len(edges)


def pooled_rate(orders):
    filled = sum(o["filled"] for o in orders)
    minutes = sum(o["alive_min"] for o in orders)
    return (filled / minutes) if minutes > 0 else 0.0


def fit(orders):
    edges = quantile_edges([o["vol7"] for o in orders], N_BUCKETS)
    rates, counts = {}, {}
    overall = {}
    for side in ("sell", "buy"):
        side_orders = [o for o in orders if o["side"] == side]
        overall[side] = pooled_rate(side_orders)
        by_bucket = defaultdict(list)
        for o in side_orders:
            by_bucket[bucket_of(o["vol7"], edges)].append(o)
        side_rates, side_counts = [], []
        for b in range(N_BUCKETS):
            grp = by_bucket.get(b, [])
            # Guard thin buckets: fall back to the side's overall rate.
            rate = pooled_rate(grp) if len(grp) >= MIN_BUCKET_ORDERS else overall[side]
            side_rates.append(round(rate, 4))
            side_counts.append(len(grp))
        rates[side] = side_rates
        counts[side] = side_counts
    return edges, rates, counts, overall


def main():
    orders = load_orders(CLEAN_PATH)
    edges, rates, counts, overall = fit(orders)
    model = {
        "version": 1,
        "fitted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": CLEAN_PATH.name,
        "n_orders": len(orders),
        "horizon_hours": HORIZON_HOURS,
        "volume_edges": [round(e) for e in edges],
        "rates_per_min": rates,                 # units/minute, per side, per volume bucket
        "bucket_order_counts": counts,
        "fallback_rate_per_min": {k: round(v, 4) for k, v in overall.items()},
    }
    OUTPUT_PATH.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")

    print(f"fitted on {len(orders)} orders -> {OUTPUT_PATH.name}")
    h = HORIZON_HOURS * 60
    print(f"\nexpected fill in {HORIZON_HOURS}h by regime (units):")
    print(f"  {'bucket':24} {'SELL':>8} {'BUY':>8}")
    labels = ([f"<= {model['volume_edges'][0]:,}"]
              + [f"{model['volume_edges'][i-1]:,}-{model['volume_edges'][i]:,}" for i in range(1, N_BUCKETS - 1)]
              + [f"> {model['volume_edges'][-1]:,}"])
    for b in range(N_BUCKETS):
        print(f"  {labels[b]:24} {rates['sell'][b]*h:>8,.0f} {rates['buy'][b]*h:>8,.0f}")


if __name__ == "__main__":
    main()
