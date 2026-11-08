"""
Loads fill_model.json (produced by fit_fill_model.py) and turns an order's
side + 7-day volume into an expected fill quantity over a planning horizon.

The allocator calls expected_fill() to size candidates to what will realistically
fill in the user's ~8h cancel cycle, replacing the old optimistic volume
heuristic. If the model file is missing or unreadable, available() returns
False and the allocator falls back to its previous estimate.
"""

import json
import os
import pathlib

_MODEL_PATH = pathlib.Path(__file__).parent / "fill_model.json"
_model = None
_model_mtime = None


def _load():
    """Load (and hot-reload) fill_model.json. Re-reads whenever the file's mtime
    changes, so a retrain or a `git pull` of a new model is picked up by a
    running optimizer without a restart; otherwise returns the cached model."""
    global _model, _model_mtime
    try:
        mtime = os.path.getmtime(_MODEL_PATH)
    except OSError:
        _model, _model_mtime = None, None
        return None
    if _model is None or mtime != _model_mtime:
        try:
            _model = json.loads(_MODEL_PATH.read_text(encoding="utf-8"))
            _model_mtime = mtime
        except (OSError, ValueError):
            _model, _model_mtime = None, None
    return _model


def available():
    """True if a usable fill model is loaded."""
    return _load() is not None


def horizon_hours(default=8):
    m = _load()
    return m.get("horizon_hours", default) if m else default


def _interpolate(volume, breakpoints):
    """Linear interpolation of rate over [volume, rate] breakpoints.

    Below the lowest breakpoint the line is extended down to the origin (0, 0):
    a product with less volume genuinely fills slower, and anchoring at zero
    keeps the rate continuous across the whole low-volume band instead of
    snapping every product under the first breakpoint to one identical rate
    (which is what made the allocator keep listing the same amount). Above the
    highest breakpoint the rate stays flat - extrapolating fills UP past the
    observed range would over-size orders. breakpoints are sorted by volume
    (strictly increasing)."""
    v0, r0 = breakpoints[0]
    if volume <= v0:
        return r0 * volume / v0 if v0 > 0 else r0
    if volume >= breakpoints[-1][0]:
        return breakpoints[-1][1]
    for i in range(1, len(breakpoints)):
        v0, r0 = breakpoints[i - 1]
        v1, r1 = breakpoints[i]
        if volume <= v1:
            return r0 + (r1 - r0) * (volume - v0) / (v1 - v0) if v1 != v0 else r1
    return breakpoints[-1][1]


def rate_per_min(side, volume_7_day):
    """Fitted fill throughput (units/minute) for this side at this product's own
    7-day volume, interpolated between breakpoints. None if the model isn't
    loaded / the side is unknown."""
    m = _load()
    if not m:
        return None
    bps = (m.get("breakpoints") or {}).get(side)
    if not bps:
        return None
    rate = _interpolate(volume_7_day or 0, bps)
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
