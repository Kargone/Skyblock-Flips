"""
A manual blacklist of products the optimizer must never recommend (either side).

Reads blacklist.json (a list of names) and exposes is_blacklisted(name), which
matches a product's display name OR its api-name, case-insensitively. Used to
drop items the user never wants flipped regardless of what the numbers say
(e.g. Stock of Stonks). Hot-reloads on mtime change, so editing the json takes
effect without restarting the optimizer. If the file is missing/unreadable,
nothing is blacklisted (previous behavior).
"""

import json
import os
import pathlib

_PATH = pathlib.Path(__file__).parent / "blacklist.json"
_set = None
_mtime = None


def _blacklist_set():
    global _set, _mtime
    try:
        mtime = os.path.getmtime(_PATH)
    except OSError:
        if _set is None:
            _set = frozenset()
        return _set
    if _set is None or mtime != _mtime:
        try:
            names = json.loads(_PATH.read_text(encoding="utf-8")).get("blacklist", [])
            _set = frozenset(n.strip().casefold() for n in names if isinstance(n, str))
            _mtime = mtime
        except (OSError, ValueError):
            if _set is None:
                _set = frozenset()
    return _set


def is_blacklisted(*names):
    """True if any of the given names (display name and/or api-name) is blacklisted."""
    bl = _blacklist_set()
    return any(n and n.strip().casefold() in bl for n in names)
