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

    # Collect the insta-buy (ask, [0]) and insta-sell (bid, [1]) series per product
    # from the trailing RECENT_SAMPLES lines.
    recent = _tail_lines(_PATH, RECENT_SAMPLES)
    asks, bids = {}, {}
    for raw in recent:
        try:
            p = json.loads(raw).get("p") or {}
        except ValueError:
            continue
        for name, pair in p.items():
            if not pair:
                continue
            if pair[0] and pair[0] > 0:
                asks.setdefault(name, []).append(pair[0])
            if len(pair) > 1 and pair[1] and pair[1] > 0:
                bids.setdefault(name, []).append(pair[1])
    _baselines = {
        "ask": {n: median(v) for n, v in asks.items() if len(v) >= MIN_SAMPLES},
        "bid": {n: median(v) for n, v in bids.items() if len(v) >= MIN_SAMPLES},
    }
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
    b = _load()
    return bool(b.get("ask") or b.get("bid"))


def baseline_ask(api_name):
    """Median recent insta-buy (ask) price for this product, or None if unknown /
    too little history."""
    if not api_name:
        return None
    return _load().get("ask", {}).get(api_name)


def baseline_bid(api_name):
    """Median recent insta-sell (bid) price for this product, or None if unknown /
    too little history."""
    if not api_name:
        return None
    return _load().get("bid", {}).get(api_name)
