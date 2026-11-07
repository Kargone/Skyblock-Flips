"""
Fetches the set of UNSTACKABLE SkyBlock items from the Hypixel items resource and
writes unstackable_items.json (loaded by stack_sizes.py).

Stack size bounds order quantities: unstackable (stack 1) items cap at 256 per buy
order and 35 held for reselling, vs 71,680 / 2,240 for a normal 64-stack item.
The 16-stack case is ignored for now (treated as 64).

Note: SHARD_* and ENCHANTMENT_* bazaar items are NOT in the items resource.
Enchantment books don't stack, so stack_sizes.py also treats ENCHANTMENT_* as
unstackable; everything else missing defaults to stackable.

Run occasionally (the resource is near-static): python optimizer/fetch_stack_sizes.py
"""

import json
import pathlib
from datetime import datetime, timezone

import requests

OUTPUT_PATH = pathlib.Path(__file__).parent / "unstackable_items.json"
RESOURCE_URL = "https://api.hypixel.net/v2/resources/skyblock/items"


def main():
    items = requests.get(RESOURCE_URL, timeout=30).json().get("items", [])
    unstackable = sorted(it["id"] for it in items if it.get("unstackable") and it.get("id"))
    OUTPUT_PATH.write_text(json.dumps({
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_items": len(items),
        "unstackable": unstackable,
    }, indent=0) + "\n", encoding="utf-8")
    print(f"{len(items)} items -> {len(unstackable)} unstackable -> {OUTPUT_PATH.name}")


if __name__ == "__main__":
    main()
