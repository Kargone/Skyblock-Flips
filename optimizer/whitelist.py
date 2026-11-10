"""
Buys-only product whitelist (whitelist.json).

When the whitelist has entries, the allocator will ONLY build buy candidates for
products listed here (keyed by api-name), and sizes each buy to its max_buy. This
is the user's curated, high-volume universe - everything else is skipped on the
buy side. If the file is missing or empty, active() is False and no buy-side
restriction is applied (previous behavior). Hot-reloads on mtime change.
"""

import json
import os
import pathlib

_PATH = pathlib.Path(__file__).parent / "whitelist.json"
_map = None          # api_name -> max_buy (int)
_mtime = None


def _load():
    global _map, _mtime
    try:
        mtime = os.path.getmtime(_PATH)
    except OSError:
        if _map is None:
            _map = {}
        return _map
    if _map is None or mtime != _mtime:
        try:
            raw = json.loads(_PATH.read_text(encoding="utf-8")).get("buy_whitelist", {})
            m = {}
            for api_name, entry in raw.items():
                mb = (entry or {}).get("max_buy")
                if mb and int(mb) > 0:
                    m[api_name] = int(mb)
            _map = m
            _mtime = mtime
        except (OSError, ValueError, TypeError):
            if _map is None:
                _map = {}
    return _map


def active():
    """True if a non-empty whitelist is loaded (buy side is restricted)."""
    return bool(_load())


def allows(api_name):
    """True if this product may be bought. When no whitelist is active, everything
    is allowed; otherwise only whitelisted products are."""
    if not active():
        return True
    return api_name in _load()


def max_buy(api_name):
    """The configured buy quantity for this product, or None if not whitelisted."""
    return _load().get(api_name)
