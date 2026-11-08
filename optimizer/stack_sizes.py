"""
Maps a bazaar product's api-name to its max stack size (1 unstackable, 16, or 64).

Hypixel's items resource only exposes an `unstackable` boolean (the 525 stack-1
items in unstackable_items.json, produced by fetch_stack_sizes.py). It does NOT
expose which items stack to 16 instead of 64, so those can't be detected
automatically - they're listed by hand in stack_overrides.json, which also lets
you force any item's stack size. Precedence: explicit override > ENCHANTMENT_* /
unstackable list > default 64. If a file is missing, that layer is simply empty
(previous behavior).
"""

import json
import os
import pathlib

_PATH = pathlib.Path(__file__).parent / "unstackable_items.json"
_set = None
_mtime = None

_OVERRIDE_PATH = pathlib.Path(__file__).parent / "stack_overrides.json"
_overrides = None
_override_mtime = None

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


def _override_map():
    """api-name -> explicit stack size, from stack_overrides.json. Hot-reloads."""
    global _overrides, _override_mtime
    try:
        mtime = os.path.getmtime(_OVERRIDE_PATH)
    except OSError:
        if _overrides is None:
            _overrides = {}
        return _overrides
    if _overrides is None or mtime != _override_mtime:
        try:
            raw = json.loads(_OVERRIDE_PATH.read_text(encoding="utf-8")).get("stack_sizes", {})
            _overrides = {k: int(v) for k, v in raw.items() if int(v) > 0}
            _override_mtime = mtime
        except (OSError, ValueError, TypeError):
            if _overrides is None:
                _overrides = {}
    return _overrides


def stack_size(api_name):
    if not api_name:
        return STACKABLE
    override = _override_map().get(api_name)
    if override:
        return override
    # Enchantment books don't stack and aren't listed in the items resource.
    if api_name.startswith("ENCHANTMENT_"):
        return UNSTACKABLE
    return UNSTACKABLE if api_name in _unstackable_set() else STACKABLE
