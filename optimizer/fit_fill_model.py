"""
Fits the fill-rate model the allocator uses to predict how much of an order will
actually fill, and writes it to fill_model.json (loaded by fill_model.py).

WHY A RATE MODEL. ~80% of the logged orders are right-censored: the user
batch-cancels most orders after ~8h rather than letting them run to completion,
so the final fill is never observed. Pooling
    rate = sum(filled_units) / sum(minutes_the_order_was_alive)
over a group is an unbiased estimate of that group's fill throughput even under
heavy time-driven censoring.

CONTINUOUS IN VOLUME. Fill throughput is dominated by 7-day volume and differs by
side, so the model is a set of (volume, units/min) breakpoints per side that the
allocator interpolates - a product's own volume maps to its own rate, instead of
snapping every low-volume item to one bucket value.

INFERENCE. expected_fill = min(cap_qty, rate(volume) * horizon_minutes), horizon
defaulting to the user's ~8h cancel cycle.

Run:  python optimizer/fit_fill_model.py
"""

import json
import pathlib
from collections import defaultdict
from datetime import datetime, timezone

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
CLEAN_PATH = DATA_DIR / "trade-outcomes.clean.jsonl"
OUTPUT_PATH = pathlib.Path(__file__).parent / "fill_model.json"

HORIZON_HOURS = 8
MIN_EXPOSURE_MINUTES = 1.0
N_POINTS = 10              # volume breakpoints per side


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
        alive = r.get("time_to_resolve_ms", 0) / 60000.0
        if amt <= 0 or alive < MIN_EXPOSURE_MINUTES:
            continue
        orders.append({"side": p.get("order_type"), "vol7": p.get("volume_7_day") or 0,
                       "filled": min(r.get("filled_amount", 0), amt), "alive_min": alive})
    return orders


def pooled_rate(group):
    minutes = sum(o["alive_min"] for o in group)
    return (sum(o["filled"] for o in group) / minutes) if minutes > 0 else 0.0


def fit_side(side_orders):
    """Breakpoints [volume, rate] at the median volume of each volume-quantile bin."""
    s = sorted(side_orders, key=lambda o: o["vol7"])
    n = len(s)
    overall = pooled_rate(s)
    pts = []
    for i in range(N_POINTS):
        grp = s[i * n // N_POINTS:(i + 1) * n // N_POINTS]
        if not grp:
            continue
        vmed = sorted(o["vol7"] for o in grp)[len(grp) // 2]
        rate = pooled_rate(grp) or overall
        if pts and vmed <= pts[-1][0]:      # keep volumes strictly increasing for interpolation
            continue
        pts.append([round(vmed), round(rate, 4)])
    return pts, round(overall, 4)


def main():
    orders = load_orders(CLEAN_PATH)
    breakpoints, fallback = {}, {}
    for side in ("sell", "buy"):
        breakpoints[side], fallback[side] = fit_side([o for o in orders if o["side"] == side])
    model = {
        "version": 2,
        "fitted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": CLEAN_PATH.name,
        "n_orders": len(orders),
        "horizon_hours": HORIZON_HOURS,
        "breakpoints": breakpoints,          # per side: [[volume, units/min], ...] interpolated
        "fallback_rate_per_min": fallback,
    }
    OUTPUT_PATH.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    print(f"fitted on {len(orders):,} orders -> {OUTPUT_PATH.name}")
    h = HORIZON_HOURS * 60
    for side in ("sell", "buy"):
        print(f"\n{side} fill @ {HORIZON_HOURS}h by volume breakpoint:")
        for v, r in breakpoints[side]:
            print(f"  vol {v:>10,}  ->  {r*h:>8,.0f} units")


if __name__ == "__main__":
    main()
