"""
Maps a bazaar product's api-name to its stack size (1 for unstackable, else 64),
from unstackable_items.json (produced by fetch_stack_sizes.py). The 16-stack case
is ignored for now. If the file is missing, everything defaults to stackable, i.e.
the previous behavior.
"""

import json
import os
import pathlib

_PATH = pathlib.Path(__file__).parent / "unstackable_items.json"
_set = None
_mtime = None

UNSTACKABLE = 1
STACKABLE = 64


def _unstackable_set():
    global _set, _mtime
    try:
        mtime = os.path.getmtime(_PATH)
    except OSError:
        if _set is None:
            _set = frozenset()
        return _set
    if _set is None or mtime != _mtime:
        try:
            _set = frozenset(json.loads(_PATH.read_text(encoding="utf-8")).get("unstackable", []))
            _mtime = mtime
        except (OSError, ValueError):
            if _set is None:
                _set = frozenset()
    return _set


def stack_size(api_name):
    if not api_name:
        return STACKABLE
    # Enchantment books don't stack and aren't listed in the items resource.
    if api_name.startswith("ENCHANTMENT_"):
        return UNSTACKABLE
    return UNSTACKABLE if api_name in _unstackable_set() else STACKABLE
