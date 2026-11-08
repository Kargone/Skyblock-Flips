"""
Per-product baseline of the insta-buy (ask) price from data/price-history.jsonl,
used to catch transient ask spikes - the "relisting trap".

When a product's current ask has run up well above where it normally sits (e.g.
Polished Pumpkin at 290k when it usually sits ~255k), that spike tends to pull in
sellers who relist under it and drag the price back down. Buying to flip into that
spike books phantom profit on an exit price that won't hold. The allocator uses
baseline_ask() to compare the current exit price against a robust recent baseline
(the MEDIAN ask over the recent window, which ignores the spike itself) and skips
the flip when the current price is too far above it.

The file is one JSON object per line: {"t": epoch_ms, "p": {API_NAME: [insta_buy,
insta_sell], ...}}. Only the insta_buy column [0] is used. Loaded once and cached;
reloaded when the file's mtime/size changes (it grows every ~15 min). If the file
is missing or a product has too little history, baseline_ask() returns None and the
allocator applies no spike filter for it (degrades safely).
"""

import json
import os
import pathlib
from statistics import median

_PATH = pathlib.Path(__file__).parent.parent / "data" / "price-history.jsonl"

# How many trailing samples define "recent" (15-min cadence -> 192 = ~2 days).
# A median over this window reflects the current regime without chasing a spike.
RECENT_SAMPLES = 192
# Need at least this many samples for a product before trusting a baseline, so a
# brand-new / thinly-recorded product isn't filtered on noise.
MIN_SAMPLES = 24  # ~6 hours

_baselines = None            # api_name -> median insta_buy over the recent window
_sig = None                  # (mtime, size) cache key


def _load():
    global _baselines, _sig
    try:
        stat = os.stat(_PATH)
    except OSError:
        _baselines = {}
        return _baselines
    sig = (stat.st_mtime_ns, stat.st_size)
    if _baselines is not None and _sig == sig:
        return _baselines

    # Collect the insta-buy series per product from the trailing RECENT_SAMPLES lines.
    recent = _tail_lines(_PATH, RECENT_SAMPLES)
    series = {}
    for raw in recent:
        try:
            p = json.loads(raw).get("p") or {}
        except ValueError:
            continue
        for name, pair in p.items():
            if pair and pair[0] and pair[0] > 0:
                series.setdefault(name, []).append(pair[0])
    _baselines = {name: median(vals) for name, vals in series.items() if len(vals) >= MIN_SAMPLES}
    _sig = sig
    return _baselines


def _tail_lines(path, n, block_size=1 << 20):
    """Last n non-empty lines of a file, read from the end so a large history
    file isn't fully parsed every reload."""
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        data = b""
        while pos > 0 and data.count(b"\n") <= n:
            size = min(block_size, pos)
            pos -= size
            f.seek(pos)
            data = f.read(size) + data
    lines = [ln for ln in data.split(b"\n") if ln.strip()]
    return [ln.decode("utf-8", "replace") for ln in lines[-n:]]


def available():
    return bool(_load())


def baseline_ask(api_name):
    """Median recent insta-buy (ask) price for this product, or None if unknown /
    too little history."""
    if not api_name:
        return None
    return _load().get(api_name)
