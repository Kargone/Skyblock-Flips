"""
Stage 2: candidate builder for the buys-only whitelist policy.

Takes the per-product price/feature state Stage 1 already computes
(main.py's build_bazaar_data_and_product_info) and builds the candidate buy
orders main.py ranks. The policy is buys-only over a hand-curated whitelist:
build_buy_candidates emits one soft-ranked buy per whitelisted product, and
main.build_recommendation groups and sorts them into display buckets. There is
no ILP, no sell-order path, and no coin/affordability tracking - order size is
the whitelist's configured max_buy per product (capped at the per-order item
cap), and the user runs with plenty of coins and manages spend manually. The
15B/24h order-worth cap (resetting 7:00 PM America/Chicago, already-used amount
from main.py's compute_daily_cap_used) and the 71,680 per-slot size cap still
bound things downstream.

The expected fill of each candidate comes from the trained fill model
(fill_model.py / fill_model.json, fit by fit_fill_model.py on the logged order
outcomes): a (side, 7-day-volume) -> units/minute table applied over the ~8h
cancel horizon. If the model file is unavailable, expected_fill falls back to the
full order quantity.

Still out of scope: the NPC sell channel as an alternative exit - NPC prices feed
the buy-side NPC-floor check (npc_sell_price in whitelist.json) but there is no
NPC sell-order candidate.
"""

from dataclasses import dataclass

import exit_drift
import fill_model
import price_history
import whitelist

# ---- Constants describing real Hypixel Bazaar constraints ----
MAX_ORDER_SIZE = 71_680  # 1,120 stacks x 64 - the real per-order item cap
DAILY_ORDER_WORTH_CAP = 15_000_000_000

# Unstackable (stack-size-1) items cap at 256 per buy order, vs MAX_ORDER_SIZE for
# stackables. Stack size is read per-product from info["max_stack_size"] (main.py
# sets it from stack_sizes.stack_size); DEFAULT_MAX_STACK_SIZE is the fallback. The
# 16-stack case is ignored for now - treated as 64.
DEFAULT_MAX_STACK_SIZE = 64
UNSTACKABLE_BUY_ORDER_SIZE = 256


def max_buy_order_size(info):
    stack_size = info.get("max_stack_size") or DEFAULT_MAX_STACK_SIZE
    return UNSTACKABLE_BUY_ORDER_SIZE if stack_size == 1 else MAX_ORDER_SIZE


# A buy-flip is only real if the order book has two-sided depth: you can acquire it
# now AND offload it in ~8h. Thin/broken books show up as an implausible spread (a
# floor buy price against a huge sell price) and little or no volume on either side.
# The volume floor sits below the 5th percentile of the user's real flips. Both
# demote (not drop) a whitelisted buy.
MAX_BUY_FLIP_SPREAD = 2.0        # demote if sell_price > 2x buy_price
MIN_FLIP_VOLUME_7D = 20_000      # both bought_volume_7_day and sell_volume_7_day must exceed this

# --- Buys-only whitelist policy (soft-ranked) -------------------------------
# These thresholds are SOFT: a product that fails is demoted to the tail of its
# bucket (so the user still sees it), never deleted. Calibrated against the user's
# real placements in the trade log.
#
# Per-unit margin a buy should clear to rank as "qualified", keyed by the bucket
# (its max_buy). Smaller orders (pricier items) demand a fatter per-unit margin.
MARGIN_FLOOR_BY_BUCKET = {7000: 2500, 4000: 2500, 2000: 4000, 1000: 8000, 500: 8000}
# NPC-floor items (bid near their NPC sell value) have a near-guaranteed exit, so a
# thinner margin is fine and the ask-side book check is skipped (the user only
# watches the sell/bid side there).
NPC_FLOOR_MARGIN = 2500
# "NPC-floor" = current bid within this band of the item's npc_sell_price.
NPC_FLOOR_BAND = (0.80, 1.15)
# Book-sanity: demote when the current bid or ask is more than this far from its
# 7-day average (dislocated book -> the order likely won't fill as priced).
BOOK_SANITY_TOLERANCE = 0.30


def margin_floor(bucket, npc_floor):
    if npc_floor:
        return NPC_FLOOR_MARGIN
    return MARGIN_FLOOR_BY_BUCKET.get(bucket, MARGIN_FLOOR_BY_BUCKET[7000])


@dataclass
class Candidate:
    product_name: str
    quantity: int        # units to place - the whitelist's configured max_buy (capped per-order)
    expected_fill: float # units expected to actually fill in the window - profit is based on this
    profit: float        # total expected profit (per-unit margin x expected_fill)
    order_worth: float   # order_price x quantity - counts toward the 15B/24h cap
    coin_cost: float     # buy_price x quantity (coins reserved on placement)
    qualified: bool = True   # True = passes margin + book-sanity; False = demote to tail
    margin: float = 0.0      # per-unit expected margin (coins) after tax + exit drift
    npc_floor: bool = False  # NPC-backed item (thinner margin ok, ask-side sanity skipped)
    bucket: int = 0          # the max_buy bucket (7000/4000/2000/1000/500)
    disqualify: tuple = ()   # reasons it was demoted, for display/debug


def build_buy_candidates(product_name, info, prices, bazaar_fee, time_between_trades_hours):
    """One soft-ranked buy candidate per whitelisted product, or [] if the product
    isn't whitelisted or has no usable price. Every whitelisted, priced product is
    emitted at its configured max_buy (capped at the per-order item cap) - quality
    constraints only set the `qualified` flag (so the menu can demote failures to the
    tail), they never drop it. Price mapping: prices["buy_price"] is the BID (where
    you place the buy / what you pay), prices["sell_price"] is the ASK (where you
    later sell)."""
    api_name = info.get("api_name")
    mb = whitelist.max_buy(api_name)
    if mb is None:
        return []                                   # not on the (active) whitelist
    bid, ask = prices["buy_price"], prices["sell_price"]
    if bid <= 0 or ask <= 0:
        return []                                   # no usable price
    # Size to the configured amount, but never exceed the per-order item cap (256
    # for unstackable items, 71,680 for stackables).
    qty = int(min(mb, max_buy_order_size(info)))

    # Projected per-unit margin (after exit drift + tax).
    exit_price = ask * exit_drift.multiplier()
    margin = exit_price * (1 - bazaar_fee) - bid

    # NPC-floor: current bid sits near the item's NPC sell value -> backstopped exit.
    npc = whitelist.npc_sell_price(api_name)
    npc_floor = bool(npc and NPC_FLOOR_BAND[0] <= bid / npc <= NPC_FLOOR_BAND[1])

    # Soft quality checks -> reasons for demotion (not deletion).
    reasons = []
    if margin < margin_floor(mb, npc_floor):
        reasons.append("margin")
    avg_bid = price_history.baseline_bid(api_name)
    avg_ask = price_history.baseline_ask(api_name)
    if avg_bid and abs(bid / avg_bid - 1) > BOOK_SANITY_TOLERANCE:
        reasons.append("bid_off")
    if not npc_floor and avg_ask and abs(ask / avg_ask - 1) > BOOK_SANITY_TOLERANCE:
        reasons.append("ask_off")       # NPC-floor items skip the ask-side check
    if ask > MAX_BUY_FLIP_SPREAD * bid:
        reasons.append("spread")
    if info["bought_volume_7_day"] < MIN_FLIP_VOLUME_7D or info["sell_volume_7_day"] < MIN_FLIP_VOLUME_7D:
        reasons.append("thin")

    expected_fill = (fill_model.expected_fill("buy", info["bought_volume_7_day"], cap_qty=qty,
                     horizon_hours=time_between_trades_hours) if fill_model.available() else qty)

    return [Candidate(
        product_name=product_name, quantity=qty, expected_fill=expected_fill,
        profit=margin * expected_fill, order_worth=bid * qty, coin_cost=bid * qty,
        qualified=not reasons, margin=margin, npc_floor=npc_floor, bucket=mb, disqualify=tuple(reasons),
    )]


def build_all_candidates(bazaar_data, all_product_information, bazaar_fee,
                         time_between_trades_hours,
                         open_buy_products=frozenset(), open_sell_products=frozenset()):
    """Build a buy candidate for every priced, whitelisted product. A product is
    skipped if it already has a live (unclaimed) order on EITHER side: an open buy
    means we've already placed this buy; an open sell means we're already working
    that product manually, so the user doesn't want it re-recommended as a buy."""
    candidates = []
    for product_name, info in all_product_information.items():
        prices = bazaar_data.get(product_name)
        if prices is None or prices["buy_price"] <= 0 or prices["sell_price"] <= 0:
            continue
        if product_name in open_buy_products or product_name in open_sell_products:
            continue
        candidates += build_buy_candidates(product_name, info, prices, bazaar_fee, time_between_trades_hours)
    return candidates
