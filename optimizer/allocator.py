"""
Stage 2: constrained allocator.

Takes the per-product price/feature state Stage 1 already computes
(main.py's build_bazaar_data_and_product_info) plus current trader state,
builds a set of candidate orders - selling off existing inventory vs buying
fresh and flipping it, each sized to fit within one bazaar slot - and solves
for the subset that maximizes TOTAL expected profit (not margin) subject to
every real constraint: 28 total slots, the current coin purse, the 15B/24h
order-worth cap (resets 7:00 PM America/Chicago; both buy and sell order worth
count toward it), the 71,680 per-slot size cap, and the per-item
inventory-holding cap (35 inventory slots x the item's max stack size).

This supersedes main.py's FindMaxProfit.find_max_profit_for_slot for
allocation purposes - that function scored every product independently with
no shared-constraint accounting at all (its own TODO said as much). The
expected fill of each candidate now comes from the trained fill model
(fill_model.py / fill_model.json, fit by fit_fill_model.py on the logged
order outcomes): a (side, 7-day-volume) -> units/minute table applied over the
~8h cancel horizon. The old EMA-vs-current weight heuristic (estimate_fillable_qty)
remains only as the fallback used when the model file is unavailable.

NOT wired up yet, deliberately: (1) current coin purse - no API source for
it exists (main.py has the same gap); (2) how much of the 15B/24h cap has
already been used today - needs a persistent counter updated wherever real
orders get placed, which doesn't exist yet since main.py never actually
calls anything like update_constraints; (3) the NPC sell channel as an
alternative to a bazaar sell order - no NPC price data is tracked anywhere
yet. All three are passed in as plain arguments for now so this module can
be validated and iterated on independently of that plumbing.
"""

import math
from dataclasses import dataclass

import pulp

import exit_drift
import fill_model
import price_history
import whitelist

# ---- Constants describing real Hypixel Bazaar constraints ----
TOTAL_SLOTS = 28
MAX_ORDER_SIZE = 71_680  # 1,120 stacks x 64 - the real per-order item cap
DAILY_ORDER_WORTH_CAP = 15_000_000_000

# Below this, a candidate isn't worth a slot at all - matches the user's own
# manual filter ("if it's more than 3k or so, I'll place an order").
MIN_PROFIT_PER_ORDER = 3_000

# How much of a single item you can physically hold to (re)sell: 35 inventory
# slots x that item's max stack size. This is the ceiling on the amount you can
# relist after a batch cancel, so it bounds how much it's worth buying/holding.
# Stack size is usually 64 but varies by product (16, 1, ...), so it's read
# per-product from info["max_stack_size"] when available; DEFAULT_MAX_STACK_SIZE
# is the fallback until product-list.json carries real stack sizes.
INVENTORY_SLOTS_FOR_SELLING = 35
DEFAULT_MAX_STACK_SIZE = 64


def max_hold_per_item(info):
    stack_size = info.get("max_stack_size") or DEFAULT_MAX_STACK_SIZE
    return INVENTORY_SLOTS_FOR_SELLING * stack_size


# Unstackable (stack-size-1) items cap at 256 per buy order, vs MAX_ORDER_SIZE for
# stackables. (Hold is already handled by max_hold_per_item: 35 x stack size, so
# 35 for unstackable.) The 16-stack case is ignored for now - treated as 64.
UNSTACKABLE_BUY_ORDER_SIZE = 256


def max_buy_order_size(info):
    stack_size = info.get("max_stack_size") or DEFAULT_MAX_STACK_SIZE
    return UNSTACKABLE_BUY_ORDER_SIZE if stack_size == 1 else MAX_ORDER_SIZE

# A second slot on the same product/side is only worth it if there's
# comfortably more demand than the first slot can hold - otherwise you're
# likely left with an awkward remainder that burns a slot on a relist next
# cycle instead of being deployed on a different product.
SECOND_SLOT_MIN_REMAINING_QTY = MAX_ORDER_SIZE * 0.5
MAX_SLOTS_PER_PRODUCT_SIDE = 2

# Fallback-only now: the trained fill model (fill_model.py / fill_model.json)
# is the live estimate of how much of an order fills. This haircut is used only
# when that model file is unavailable, to keep the old optimistic volume
# heuristic from over-committing coins on buy-flips (empirically ~80% of real
# orders don't fully fill). 1.0 = no haircut; applied to buys only.
EXPECTED_FILL_HAIRCUT = 0.5

# A buy-flip is only real if the order book has two-sided depth: you can acquire
# it now AND offload it in ~8h. Thin/broken books show up as an implausible spread
# (a floor buy price against a huge sell price) and little or no volume on either
# side - buying them loses coins on stock that never sells. The volume floor sits
# below the 5th percentile of the user's real flips (~40k buy / ~22k sell 7d
# volume), so it keeps their proven universe while cutting the fake-arbitrage
# books (whose sell-side volume is in the tens). These guard the buy side only;
# sells are listing stock already held, which carries no such risk.
MAX_BUY_FLIP_SPREAD = 2.0        # reject if sell_price > 2x buy_price
MIN_FLIP_VOLUME_7D = 20_000      # both bought_volume_7_day and sell_volume_7_day must exceed this

# Buy a buffer beyond the expected fill so a faster-than-expected fill captures the
# extra, capped by what's affordable/holdable. Profit is still ranked on the
# expected fill, not the buffered amount, so this doesn't inflate rankings - it
# just lists a bit more. 1.0 = no overshoot.
BUY_OVERSHOOT_FACTOR = 1.5

# Relisting-trap guard: skip a buy-flip when the product's current exit (ask) price
# has spiked more than this far above its recent baseline (median ask over the last
# ~2 days, from price_history.py). A run-up like that pulls in sellers who relist
# under it and drag the price back down, so the flip's projected sell price won't
# hold - e.g. Polished Pumpkin at 290k vs its usual ~255k is ~1.14x. Set to None to
# disable the filter entirely. Only applies when there's enough price history for
# the product; otherwise no filtering (degrades safely).
BUY_EXIT_SPIKE_RATIO = 1.08


@dataclass
class Candidate:
    product_name: str
    side: str  # "sell_inventory" or "buy"
    quantity: int        # units to LIST/place: the full holding for a sell, ~expected fill for a buy
    expected_fill: float # units expected to actually fill in the window - profit is based on this
    profit: float       # total expected profit if this candidate is taken (profit_per_unit x expected_fill)
    order_worth: float  # order_price x quantity (the full listing) - counts toward the 15B/24h cap
    coin_cost: float    # buy_price x quantity for buys (coins reserved on placement); 0 for sells
    slot_index: int      # 0 for the first slot taken on this product/side, 1 for the second


def weighted_avg_cost(sub_orders):
    """Weighted-average historical cost basis from a short-term-investments
    entry's sub-orders. Long-term investments are deliberately excluded from
    this whole model - the user manages those separately."""
    total_qty = sum(o["partial-amount"] for o in sub_orders)
    if total_qty <= 0:
        return None
    total_cost = sum(o["partial-amount"] * o["price-bought"] for o in sub_orders)
    return total_cost / total_qty


def damped_weight(weight_1, weight_2, weight_3):
    """Geometric mean instead of a raw product. The three EMA weights are
    correlated (all derived from the same underlying trading activity), so
    multiplying them compounds the same signal three times and produces
    unrealistically extreme swings on volatile items - three weights of 1.5
    each (all "50% hotter than usual") would otherwise compound to 3.375x
    instead of a sensible ~1.5x."""
    product = weight_1 * weight_2 * weight_3
    if product < 0:
        return 0.0
    return product ** (1 / 3)


def estimate_fillable_qty(past_quantity_per_hour, weight_1, weight_2, weight_3, time_between_trades_hours, cap_qty, haircut=1.0):
    weight = damped_weight(weight_1, weight_2, weight_3)
    return min(past_quantity_per_hour * time_between_trades_hours * weight * haircut, cap_qty)


def _slot_candidates(product_name, side, list_budget, fill_estimate, profit_per_unit, order_price, coin_cost_per_unit, max_order_size=MAX_ORDER_SIZE):
    """Split a product/side into up to MAX_SLOTS_PER_PRODUCT_SIDE bazaar orders.

    list_budget is how much to actually LIST (the full holding for a sell; the
    affordable/fittable amount for a buy). fill_estimate is how much of that is
    expected to fill in the window. Profit is on the fill; order_worth and
    coin_cost are on the full listing, because placing the order consumes the
    15B/24h cap (and, for buys, reserves coins) on the whole amount regardless
    of how much ends up filling.
    """
    candidates = []
    remaining_list = list_budget
    remaining_fill = fill_estimate
    for slot_index in range(MAX_SLOTS_PER_PRODUCT_SIDE):
        if slot_index > 0 and remaining_list < SECOND_SLOT_MIN_REMAINING_QTY:
            break
        list_qty = math.floor(min(max_order_size, remaining_list))
        if list_qty <= 0:
            break

        slot_fill = min(remaining_fill, list_qty)
        profit = profit_per_unit * slot_fill
        if profit < MIN_PROFIT_PER_ORDER:
            break  # later slots only get smaller/less certain, not worth continuing

        candidates.append(Candidate(
            product_name=product_name, side=side, quantity=list_qty, expected_fill=slot_fill,
            profit=profit, order_worth=order_price * list_qty,
            coin_cost=coin_cost_per_unit * list_qty, slot_index=slot_index,
        ))
        remaining_list -= list_qty
        remaining_fill -= slot_fill
    return candidates


def build_sell_inventory_candidates(product_name, info, prices, bazaar_fee, held_qty, historical_cost, time_between_trades_hours):
    if held_qty <= 0 or historical_cost is None:
        return []

    # Tax only reduces sell revenue - it is not a discount on the margin as a
    # whole, so it must not also apply to what you already paid to acquire
    # the stock (main.py's old formula did that: (sell - buy) * (1 - fee)).
    profit_per_unit = prices["sell_price"] * (1 - bazaar_fee) - historical_cost
    if profit_per_unit <= 0:
        return []  # selling this stock now would realize a loss - hold it instead, not a bug to "fix"

    if fill_model.available():
        expected_fillable = fill_model.expected_fill(
            "sell", info["sell_volume_7_day"], cap_qty=held_qty,
            horizon_hours=time_between_trades_hours,
        )
    else:
        expected_fillable = estimate_fillable_qty(
            info["past_quantity_sold_per_hour"],
            info["sell_volume_7_day_weight"], info["sell_volume_24_hour_weight"], info["new_listings_per_hour_selling_weight"],
            time_between_trades_hours, cap_qty=held_qty,
        )

    # List the whole holding (you want it all sold); only ~expected_fillable of
    # it sells in the window, which is what the profit is scored on.
    return _slot_candidates(product_name, "sell_inventory", list_budget=held_qty, fill_estimate=expected_fillable,
                            profit_per_unit=profit_per_unit, order_price=prices["sell_price"], coin_cost_per_unit=0)


def build_buy_candidates(product_name, info, prices, bazaar_fee, purse_remaining, held_qty, time_between_trades_hours):
    api_name = info.get("api_name")
    # Buys-only whitelist: when active, only its products are bought at all. The
    # whitelist also sets the quantity to buy (max_buy), which replaces the fill-
    # model sizing below for whitelisted products.
    if whitelist.active() and not whitelist.allows(api_name):
        return []

    if prices["buy_price"] <= 0:
        return []
    room_left = max_hold_per_item(info) - held_qty
    mb = whitelist.max_buy(api_name) if whitelist.active() else None
    # A non-whitelisted (fallback) buy is still bounded by the inventory hold cap;
    # a whitelisted buy uses its explicit max_buy instead (applied below), which
    # the user chose deliberately, so the 35-slot relist heuristic doesn't gate it.
    if mb is None and room_left <= 0:
        return []

    # Two-sided liquidity + spread sanity: skip thin/broken books where the flip
    # isn't real (can't actually acquire or offload). See MAX_BUY_FLIP_SPREAD /
    # MIN_FLIP_VOLUME_7D. This is what keeps the allocator from dumping coins into
    # floor-priced, no-demand items when buys compete for slots.
    if prices["sell_price"] > MAX_BUY_FLIP_SPREAD * prices["buy_price"]:
        return []
    if info["bought_volume_7_day"] < MIN_FLIP_VOLUME_7D or info["sell_volume_7_day"] < MIN_FLIP_VOLUME_7D:
        return []

    # Relisting-trap guard: if the current exit (ask) price is spiked well above its
    # recent baseline, the run-up will likely revert as sellers relist under it, so
    # don't buy into it. No-op when the filter is disabled or we lack history.
    if BUY_EXIT_SPIKE_RATIO is not None:
        baseline = price_history.baseline_ask(info.get("api_name"))
        if baseline and prices["sell_price"] > BUY_EXIT_SPIKE_RATIO * baseline:
            return []

    # Projected exit price = today's sell price scaled by the fitted exit-drift
    # multiplier (exit_drift.json, from fit_exit_drift.py): a buy-flip is sold ~8h
    # later and that order-sell price drifts down ~1% over the hold, so today's
    # price overstates the margin. Multiplier is 1.0 (no change) if unfitted.
    exit_sell_price = prices["sell_price"] * exit_drift.multiplier()
    profit_per_unit = exit_sell_price * (1 - bazaar_fee) - prices["buy_price"]
    if profit_per_unit <= 0:
        return []

    affordable_qty = purse_remaining // prices["buy_price"]
    # Order-size cap: a whitelisted product buys its configured max_buy (bounded only
    # by what's affordable); otherwise it's bounded by the inventory hold cap.
    cap_qty = min(mb, affordable_qty) if mb is not None else min(room_left, affordable_qty)
    if cap_qty <= 0:
        return []
    if fill_model.available():
        expected_fillable = fill_model.expected_fill(
            "buy", info["bought_volume_7_day"], cap_qty=cap_qty,
            horizon_hours=time_between_trades_hours,
        )
    else:
        expected_fillable = estimate_fillable_qty(
            info["past_quantity_bought_per_hour"],
            info["bought_volume_7_day_weight"], info["bought_volume_24_hour_weight"], info["new_listings_per_hour_buying_weight"],
            time_between_trades_hours, cap_qty=cap_qty, haircut=EXPECTED_FILL_HAIRCUT,
        )

    # Whitelisted: list the full configured max_buy (profit is still scored on the
    # expected fill). Otherwise list a buffer beyond the expected fill (overshoot),
    # capped by affordable/holdable. Unstackable items also cap at 256 per buy order.
    list_budget = cap_qty if mb is not None else min(cap_qty, math.floor(expected_fillable * BUY_OVERSHOOT_FACTOR))
    return _slot_candidates(product_name, "buy", list_budget=list_budget, fill_estimate=expected_fillable,
                            profit_per_unit=profit_per_unit, order_price=prices["buy_price"],
                            coin_cost_per_unit=prices["buy_price"], max_order_size=max_buy_order_size(info))


def solve(candidates, available_slots, coins_available, daily_cap_remaining):
    if not candidates or available_slots <= 0:
        return []

    problem = pulp.LpProblem("bazaar_allocation", pulp.LpMaximize)
    x = {i: pulp.LpVariable(f"take_{i}", cat="Binary") for i in range(len(candidates))}

    problem += pulp.lpSum(candidates[i].profit * x[i] for i in range(len(candidates)))

    problem += pulp.lpSum(x[i] for i in range(len(candidates))) <= available_slots
    problem += pulp.lpSum(candidates[i].coin_cost * x[i] for i in range(len(candidates))) <= coins_available
    problem += pulp.lpSum(candidates[i].order_worth * x[i] for i in range(len(candidates))) <= daily_cap_remaining

    # Can't take a product's 2nd slot on a side without also taking its 1st.
    by_product_side = {}
    for i, c in enumerate(candidates):
        by_product_side.setdefault((c.product_name, c.side), {})[c.slot_index] = i
    for slots in by_product_side.values():
        if 0 in slots and 1 in slots:
            problem += x[slots[1]] <= x[slots[0]]

    problem.solve(pulp.PULP_CBC_CMD(msg=False))

    return [candidates[i] for i in range(len(candidates)) if x[i].value() == 1]


def solve_sells_first(candidates, available_slots, coins_available, daily_cap_remaining):
    """Lexicographic 'sells first, then buys' policy. NOT the live default - main.py
    uses the blended solve() (top total expected profit across both sides) now that
    buys are risk-adjusted and liquidity-filtered. Kept as an alternative: first lock
    in every worthwhile inventory sell we can, then spend whatever slots / coins /
    daily cap are left on buy-to-flip candidates.

    Inventory sells are realized this cycle; buy-flips only pay off next cycle
    and carry fill risk on both legs, so they never displace a profitable sell.
    Both order sides draw from the same 15B daily cap, so phase 2 sees only what
    phase 1 left behind. Sells cost 0 coins, so the purse is untouched by phase 1."""
    sells = [c for c in candidates if c.side == "sell_inventory"]
    buys = [c for c in candidates if c.side == "buy"]

    chosen_sells = solve(sells, available_slots, coins_available, daily_cap_remaining)
    slots_used = len(chosen_sells)
    cap_used = sum(c.order_worth for c in chosen_sells)

    chosen_buys = solve(
        buys,
        available_slots - slots_used,
        coins_available,
        daily_cap_remaining - cap_used,
    )
    return chosen_sells + chosen_buys


def build_all_candidates(bazaar_data, all_product_information, short_term_investments, bazaar_fee,
                         purse_remaining, time_between_trades_hours,
                         open_buy_products=frozenset(), open_sell_products=frozenset()):
    """open_buy_products / open_sell_products are product names that already have a
    live (unclaimed) order in-game on that side; they're skipped so the optimizer
    doesn't re-recommend an order you've already placed."""
    candidates = []
    for product_name, info in all_product_information.items():
        prices = bazaar_data.get(product_name)
        if prices is None or prices["buy_price"] <= 0 or prices["sell_price"] <= 0:
            continue

        investment = short_term_investments.get(product_name)
        held_qty = 0
        historical_cost = None
        if investment is not None:
            sub_orders = investment.get("sub-orders", [])
            held_qty = sum(o["partial-amount"] for o in sub_orders)
            historical_cost = weighted_avg_cost(sub_orders)

        if product_name not in open_sell_products:
            candidates += build_sell_inventory_candidates(
                product_name, info, prices, bazaar_fee, held_qty, historical_cost, time_between_trades_hours
            )
        if product_name not in open_buy_products:
            candidates += build_buy_candidates(
                product_name, info, prices, bazaar_fee, purse_remaining, held_qty, time_between_trades_hours
            )
    return candidates


if __name__ == "__main__":
    from api_client import get_market_data, get_product_list, get_trader_data
    from main import build_bazaar_data_and_product_info

    product_list = get_product_list()
    trader_data = get_trader_data()
    market_data = get_market_data()

    bazaar_data, all_product_information = build_bazaar_data_and_product_info(
        market_data.get("bazaarProducts", {}), market_data.get("volumeStats", {}), product_list
    )

    # TODO: same gap as main.py - no API source yet for the current coin
    # purse. Update manually for now.
    current_coins_amount = 0
    # TODO: no persistent tracking yet of how much of the 15B/24h cap has
    # been used since the last 7PM CDT reset. Assume nothing used yet.
    daily_cap_remaining = DAILY_ORDER_WORTH_CAP
    # Live rate comes from /api/mayor-data's tax-multiplier in the main.py loop
    # (x4 under Derpy); 1% is the non-Derpy baseline for this standalone harness.
    bazaar_fee = 0.01

    candidates = build_all_candidates(
        bazaar_data, all_product_information, trader_data.get("short-term-investments", {}),
        bazaar_fee, current_coins_amount, time_between_trades_hours=8,
    )
    print(f"generated {len(candidates)} candidates")

    chosen = solve_sells_first(candidates, TOTAL_SLOTS, current_coins_amount, daily_cap_remaining)
    chosen.sort(key=lambda c: c.profit, reverse=True)

    total_profit = sum(c.profit for c in chosen)
    print(f"chose {len(chosen)}/{TOTAL_SLOTS} slots, total expected profit: {total_profit:,.0f}")
    for c in chosen:
        print(f"  [{c.side:14s}] {c.product_name:35s} list={c.quantity:>7d} fill~{c.expected_fill:>7,.0f}  profit={c.profit:>12,.0f}  worth={c.order_worth:>14,.0f}")
