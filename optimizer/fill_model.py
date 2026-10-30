"""
Loads fill_model.json (produced by fit_fill_model.py) and turns an order's
side + 7-day volume into an expected fill quantity over a planning horizon.

The allocator calls expected_fill() to size candidates to what will realistically
fill in the user's ~8h cancel cycle, replacing the old optimistic volume
heuristic. If the model file is missing or unreadable, available() returns
False and the allocator falls back to its previous estimate.
"""

import json
import pathlib

_MODEL_PATH = pathlib.Path(__file__).parent / "fill_model.json"
_model = None
_loaded = False


def _load():
    global _model, _loaded
    if _loaded:
        return _model
    _loaded = True
    try:
        _model = json.loads(_MODEL_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        _model = None
    return _model


def available():
    """True if a usable fill model is loaded."""
    return _load() is not None


def horizon_hours(default=8):
    m = _load()
    return m.get("horizon_hours", default) if m else default


def _bucket(volume, edges):
    for i, edge in enumerate(edges):
        if volume <= edge:
            return i
    return len(edges)


def rate_per_min(side, volume_7_day):
    """Fitted fill throughput (units/minute) for this side + volume regime,
    or None if the model isn't loaded / the side is unknown."""
    m = _load()
    if not m:
        return None
    rates = m["rates_per_min"].get(side)
    if rates is None:
        return None
    b = _bucket(volume_7_day or 0, m["volume_edges"])
    rate = rates[b]
    # A thin bucket is stored as 0 only if its fallback was also 0; guard anyway.
    if rate <= 0:
        rate = m.get("fallback_rate_per_min", {}).get(side, 0.0)
    return rate


def expected_fill(side, volume_7_day, cap_qty, horizon_hours=None):
    """Expected units filled over the horizon, capped at cap_qty.
    side is "sell" or "buy". Returns 0.0 when the model is unavailable so the
    caller can detect that via available() and fall back explicitly."""
    rate = rate_per_min(side, volume_7_day)
    if rate is None:
        return 0.0
    h = horizon_hours if horizon_hours is not None else _load().get("horizon_hours", 8)
    return min(cap_qty, rate * h * 60.0)
