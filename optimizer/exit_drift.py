"""
Loads exit_drift.json (produced by fit_exit_drift.py): a single multiplier the
allocator applies to a buy-flip's projected sell price, correcting for the ~1%
downward drift of the order-sell price over the hold.

If the file is missing/unreadable, multiplier() returns 1.0 (no adjustment), so
the allocator degrades to using today's price exactly as before.
"""

import json
import os
import pathlib

_PATH = pathlib.Path(__file__).parent / "exit_drift.json"
_model = None
_mtime = None


def _load():
    global _model, _mtime
    try:
        mtime = os.path.getmtime(_PATH)
    except OSError:
        _model, _mtime = None, None
        return None
    if _model is None or mtime != _mtime:
        try:
            _model = json.loads(_PATH.read_text(encoding="utf-8"))
            _mtime = mtime
        except (OSError, ValueError):
            _model, _mtime = None, None
    return _model


def multiplier(default=1.0):
    """Exit-sell-price multiplier for buy-flip profit; 1.0 (no change) if unset."""
    m = _load()
    if not m:
        return default
    v = m.get("drift_multiplier")
    return v if isinstance(v, (int, float)) and v > 0 else default
