"""
Fits the exit-price drift multiplier the allocator applies to buy-flip profit,
and writes it to exit_drift.json (loaded by exit_drift.py).

A buy-flip is bought now and sold ~8h later, so the realistic exit price is the
ORDER sell price at the end of the hold, not today's. Empirically that price
drifts down a little over 8h (trimmed-mean end/start ~0.99, consistent across
volume), so using today's price overstates buy-flip margin. This fits one
calibrated multiplier (the outlier-trimmed mean drift) to correct it.

Reads the whole labeled-order-data set (active file + rotated archives). Run:
  python optimizer/fit_exit_drift.py
"""

import json
import pathlib
from datetime import datetime, timezone

DATA_DIR = pathlib.Path(__file__).parent.parent / "data"
OUTPUT_PATH = pathlib.Path(__file__).parent / "exit_drift.json"
HORIZON_HOURS = 8          # the allocator's planning horizon
TRIM = 0.05                # drop the extreme 5% each tail (illiquid near-zero-price noise)


def data_files():
    active = DATA_DIR / "labeled-order-data.jsonl"
    files = sorted(DATA_DIR.glob("labeled-order-data.*.jsonl"))  # rotated archives
    if active.exists():
        files.append(active)
    return files


def collect_drift(horizon):
    drifts = []
    for path in data_files():
        with path.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                r = json.loads(line)
                if r.get("horizon_hours") != horizon or r.get("data_gap"):
                    continue
                start, end = r.get("order_sell_price"), r.get("end_order_sell_price")
                if start and end and start > 0 and end > 0:
                    drifts.append(end / start)
    return drifts


def trimmed_mean(xs, trim):
    xs = sorted(xs)
    k = len(xs)
    lo, hi = int(trim * k), int((1 - trim) * k)
    core = xs[lo:hi] or xs
    return sum(core) / len(core)


def main():
    drifts = collect_drift(HORIZON_HOURS)
    if not drifts:
        raise SystemExit("no usable labeled-order-data rows found; is the data in data/ ?")
    mult = trimmed_mean(drifts, TRIM)
    model = {
        "version": 1,
        "fitted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "horizon_hours": HORIZON_HOURS,
        "n": len(drifts),
        "trim": TRIM,
        "drift_multiplier": round(mult, 4),
    }
    OUTPUT_PATH.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    print(f"fitted on {len(drifts):,} resolved {HORIZON_HOURS}h rows -> {OUTPUT_PATH.name}")
    print(f"exit-price drift multiplier = {model['drift_multiplier']} "
          f"(buy-flip exit sell price is scaled by this)")


if __name__ == "__main__":
    main()
