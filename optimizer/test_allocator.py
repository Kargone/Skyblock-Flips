"""
Regression tests for the allocator + fill model. Run from anywhere:

    python optimizer/test_allocator.py
    (or)  python -m unittest optimizer/test_allocator.py

Covers the fill-model lookup/cap/hot-reload, the asymmetric order sizing
(sells list the full holding; buys size to expected fill; profit, cap worth and
coin cost billed correctly), the ILP constraints, the sells-first policy, and
that the committed fill_model.json is well-formed.
"""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import blacklist
import exit_drift
import fill_model
import price_history
import stack_sizes
import allocator as A
import main as M

KNOWN_MODEL = {
    "version": 2,
    "horizon_hours": 8,
    "breakpoints": {
        "sell": [[100, 0.1], [200, 0.2], [300, 0.3], [400, 0.4], [500, 0.5]],
        "buy": [[100, 1.0], [200, 1.0], [300, 1.0], [400, 1.0], [500, 1.0]],
    },
    "fallback_rate_per_min": {"sell": 0.3, "buy": 1.0},
}


def make_info(sell_vol=50_000, buy_vol=50_000, stack=64):  # default above the buy-flip liquidity floor
    return {
        "sell_volume_7_day": sell_vol, "bought_volume_7_day": buy_vol, "max_stack_size": stack,
        # fallback-path fields (unused while a model is available):
        "past_quantity_sold_per_hour": 0, "past_quantity_bought_per_hour": 0,
        "sell_volume_7_day_weight": 1, "sell_volume_24_hour_weight": 1, "new_listings_per_hour_selling_weight": 1,
        "bought_volume_7_day_weight": 1, "bought_volume_24_hour_weight": 1, "new_listings_per_hour_buying_weight": 1,
    }


class FillModelTests(unittest.TestCase):
    def setUp(self):
        self._orig_path = fill_model._MODEL_PATH
        self._tmp = Path(tempfile.mkdtemp()) / "fill_model.json"
        self._tmp.write_text(json.dumps(KNOWN_MODEL), encoding="utf-8")
        fill_model._MODEL_PATH = self._tmp
        fill_model._model = None
        fill_model._model_mtime = None

    def tearDown(self):
        fill_model._MODEL_PATH = self._orig_path
        fill_model._model = None
        fill_model._model_mtime = None

    def test_available(self):
        self.assertTrue(fill_model.available())

    def test_interpolates_by_volume(self):
        # vol 250 interpolates between (200,0.2) and (300,0.3) -> 0.25; 0.25*480 = 120
        self.assertAlmostEqual(fill_model.expected_fill("sell", 250, cap_qty=10**9), 120.0, places=6)
        # vol 50 below first breakpoint (100,0.1) -> scales from origin: 0.1*50/100=0.05 -> 24
        self.assertAlmostEqual(fill_model.expected_fill("sell", 50, cap_qty=10**9), 24.0, places=6)
        # vol 500 at/above last breakpoint -> 0.5 -> 240
        self.assertAlmostEqual(fill_model.expected_fill("sell", 500, cap_qty=10**9), 240.0, places=6)
        # distinct volumes give distinct fills (no bucket snapping)
        self.assertNotEqual(fill_model.expected_fill("sell", 210, cap_qty=10**9),
                            fill_model.expected_fill("sell", 290, cap_qty=10**9))

    def test_low_volume_band_is_continuous_not_flat(self):
        # Below the first breakpoint the rate must scale with volume (anchored at
        # the origin), NOT snap every product to one value - that snapping was what
        # made the allocator keep listing the same amount for many products.
        f10 = fill_model.expected_fill("sell", 10, cap_qty=10**9)
        f50 = fill_model.expected_fill("sell", 50, cap_qty=10**9)
        f90 = fill_model.expected_fill("sell", 90, cap_qty=10**9)
        self.assertLess(f10, f50)
        self.assertLess(f50, f90)
        self.assertAlmostEqual(f50 / f10, 5.0, places=6)      # linear in volume
        self.assertAlmostEqual(f10, 0.1 * 10 / 100 * 480, places=6)  # 4.8

    def test_high_volume_stays_flat_above_top_breakpoint(self):
        # Above the last breakpoint rate stays flat (no upward extrapolation).
        self.assertEqual(fill_model.expected_fill("sell", 600, cap_qty=10**9),
                         fill_model.expected_fill("sell", 5000, cap_qty=10**9))

    def test_cap_respected(self):
        self.assertEqual(fill_model.expected_fill("sell", 500, cap_qty=10), 10)

    def test_horizon_override(self):
        # vol 50 -> rate 0.05 (origin-anchored); 0.05*4*60 = 12
        self.assertAlmostEqual(fill_model.expected_fill("sell", 50, cap_qty=10**9, horizon_hours=4), 12.0, places=6)

    def test_unknown_side(self):
        self.assertIsNone(fill_model.rate_per_min("bogus", 100))
        self.assertEqual(fill_model.expected_fill("bogus", 100, cap_qty=10**9), 0.0)

    def test_missing_model_unavailable(self):
        fill_model._MODEL_PATH = Path(tempfile.mkdtemp()) / "nope.json"
        fill_model._model = None
        fill_model._model_mtime = None
        self.assertFalse(fill_model.available())
        self.assertEqual(fill_model.expected_fill("sell", 250, cap_qty=10**9), 0.0)

    def test_hot_reload_on_mtime_change(self):
        # vol 50 below bp (100,1.0) -> origin-anchored rate 0.5 -> 240
        self.assertAlmostEqual(fill_model.expected_fill("buy", 50, cap_qty=10**9), 240.0, places=6)
        changed = dict(KNOWN_MODEL)
        changed["breakpoints"] = {"sell": [[100, 0.1], [500, 0.1]], "buy": [[100, 2.0], [500, 2.0]]}
        self._tmp.write_text(json.dumps(changed), encoding="utf-8")
        os.utime(self._tmp, (time.time() + 10, time.time() + 10))  # bump mtime
        # vol 50 below bp (100,2.0) -> origin-anchored rate 1.0 -> 480
        self.assertAlmostEqual(fill_model.expected_fill("buy", 50, cap_qty=10**9), 480.0, places=6)


class SizingTests(unittest.TestCase):
    """Allocator sizing with a controlled fill estimate."""

    def setUp(self):
        self._orig = (fill_model.available, fill_model.expected_fill,
                      exit_drift.multiplier, price_history.baseline_ask)
        fill_model.available = lambda: True
        exit_drift.multiplier = lambda default=1.0: 1.0  # no exit drift unless a test sets it
        price_history.baseline_ask = lambda api_name: None  # no spike filter unless a test sets it

    def tearDown(self):
        (fill_model.available, fill_model.expected_fill,
         exit_drift.multiplier, price_history.baseline_ask) = self._orig

    def _set_fill(self, value):
        fill_model.expected_fill = lambda side, vol, cap_qty, horizon_hours=None: min(cap_qty, value)

    def _set_drift(self, m):
        exit_drift.multiplier = lambda default=1.0: m

    def test_sell_lists_full_holding(self):
        self._set_fill(1000)
        prices = {"sell_price": 100.0, "buy_price": 120.0}
        cands = A.build_sell_inventory_candidates("P", make_info(), prices, 0.01,
                                                  held_qty=5000, historical_cost=50.0, time_between_trades_hours=8)
        self.assertEqual(len(cands), 1)
        c = cands[0]
        self.assertEqual(c.quantity, 5000)            # lists the whole holding
        self.assertEqual(c.expected_fill, 1000)       # but only ~1000 fills
        ppu = 100.0 * 0.99 - 50.0                       # 49
        self.assertAlmostEqual(c.profit, ppu * 1000)   # profit on the fill, not the listing
        self.assertAlmostEqual(c.order_worth, 100.0 * 5000)  # cap billed on the full listing
        self.assertEqual(c.coin_cost, 0)

    def test_buy_overshoots_expected_fill(self):
        self._set_fill(1000)
        prices = {"sell_price": 100.0, "buy_price": 60.0}   # ratio 1.67, within the spread cap
        cands = A.build_buy_candidates("P", make_info(), prices, 0.01,
                                       purse_remaining=10**12, held_qty=0, time_between_trades_hours=8)
        self.assertEqual(len(cands), 1)
        c = cands[0]
        self.assertEqual(c.quantity, 1500)            # listed = 1.5x the expected fill (overshoot)
        self.assertEqual(c.expected_fill, 1000)       # profit still on the expected fill
        ppu = 100.0 * 0.99 - 60.0
        self.assertAlmostEqual(c.profit, ppu * 1000)
        self.assertAlmostEqual(c.order_worth, 60.0 * 1500)   # cap/coins billed on the listing
        self.assertAlmostEqual(c.coin_cost, 60.0 * 1500)

    def test_min_profit_is_on_fill_not_listing(self):
        # Lists 5000 but only 10 fill -> profit 49*10=490 < 3000 -> rejected.
        self._set_fill(10)
        prices = {"sell_price": 100.0, "buy_price": 120.0}
        cands = A.build_sell_inventory_candidates("P", make_info(), prices, 0.01,
                                                  held_qty=5000, historical_cost=50.0, time_between_trades_hours=8)
        self.assertEqual(cands, [])

    def test_sell_at_loss_no_candidate(self):
        self._set_fill(1000)
        prices = {"sell_price": 100.0, "buy_price": 120.0}
        cands = A.build_sell_inventory_candidates("P", make_info(), prices, 0.01,
                                                  held_qty=5000, historical_cost=200.0, time_between_trades_hours=8)
        self.assertEqual(cands, [])

    def test_held_zero_no_sell(self):
        self._set_fill(1000)
        prices = {"sell_price": 100.0, "buy_price": 120.0}
        cands = A.build_sell_inventory_candidates("P", make_info(), prices, 0.01,
                                                  held_qty=0, historical_cost=50.0, time_between_trades_hours=8)
        self.assertEqual(cands, [])

    def test_buy_no_margin_no_candidate(self):
        self._set_fill(1500)
        prices = {"sell_price": 100.0, "buy_price": 100.0}  # sell*(1-fee) - buy < 0
        cands = A.build_buy_candidates("P", make_info(), prices, 0.01,
                                       purse_remaining=10**12, held_qty=0, time_between_trades_hours=8)
        self.assertEqual(cands, [])

    def test_exit_drift_reduces_buy_profit(self):
        self._set_fill(1000)
        self._set_drift(0.9)
        prices = {"sell_price": 100.0, "buy_price": 55.0}   # ratio 1.82, within the spread cap
        cands = A.build_buy_candidates("P", make_info(), prices, 0.0,
                                       purse_remaining=10**12, held_qty=0, time_between_trades_hours=8)
        # exit = 100*0.9 = 90; profit_per_unit = 90 - 55 = 35 (fee 0)
        self.assertEqual(len(cands), 1)
        self.assertAlmostEqual(cands[0].profit, 35.0 * 1000)

    def test_exit_drift_can_make_thin_buy_unprofitable(self):
        self._set_fill(1000)
        prices = {"sell_price": 100.0, "buy_price": 95.0}
        self._set_drift(1.0)   # 100*0.99 - 95 = 4 > 0 -> candidate exists
        self.assertEqual(len(A.build_buy_candidates("P", make_info(), prices, 0.01,
                         purse_remaining=10**12, held_qty=0, time_between_trades_hours=8)), 1)
        self._set_drift(0.9)   # 100*0.9*0.99 - 95 = -5.9 < 0 -> rejected
        self.assertEqual(A.build_buy_candidates("P", make_info(), prices, 0.01,
                         purse_remaining=10**12, held_qty=0, time_between_trades_hours=8), [])

    def test_buy_rejected_wide_spread(self):
        self._set_fill(1000)
        prices = {"sell_price": 300.0, "buy_price": 100.0}  # ratio 3.0 > 2.0 cap -> fake/thin
        self.assertEqual(A.build_buy_candidates("P", make_info(), prices, 0.0,
                         purse_remaining=10**12, held_qty=0, time_between_trades_hours=8), [])

    def test_buy_rejected_thin_buy_side(self):
        self._set_fill(1000)
        prices = {"sell_price": 100.0, "buy_price": 70.0}
        info = make_info(sell_vol=50_000, buy_vol=1_000)    # can't acquire it
        self.assertEqual(A.build_buy_candidates("P", info, prices, 0.0,
                         purse_remaining=10**12, held_qty=0, time_between_trades_hours=8), [])

    def test_buy_rejected_thin_sell_side(self):
        self._set_fill(1000)
        prices = {"sell_price": 100.0, "buy_price": 70.0}
        info = make_info(sell_vol=1_000, buy_vol=50_000)    # can't offload it (no sell-side demand)
        self.assertEqual(A.build_buy_candidates("P", info, prices, 0.0,
                         purse_remaining=10**12, held_qty=0, time_between_trades_hours=8), [])

    def test_buy_kept_when_liquid_and_sane_spread(self):
        self._set_fill(1000)
        prices = {"sell_price": 100.0, "buy_price": 70.0}   # ratio 1.43, both vols 50k
        cands = A.build_buy_candidates("P", make_info(), prices, 0.0,
                                       purse_remaining=10**12, held_qty=0, time_between_trades_hours=8)
        self.assertEqual(len(cands), 1)

    def test_buy_rejected_when_exit_price_spiked(self):
        # Current exit (ask) 100 vs baseline 85 -> 1.18x > 1.08 cap -> relisting trap, skip.
        self._set_fill(1000)
        price_history.baseline_ask = lambda api_name: 85.0
        prices = {"sell_price": 100.0, "buy_price": 70.0}
        info = make_info(); info["api_name"] = "SOME_ITEM"
        self.assertEqual(A.build_buy_candidates("P", info, prices, 0.0,
                         purse_remaining=10**12, held_qty=0, time_between_trades_hours=8), [])

    def test_buy_kept_when_exit_price_near_baseline(self):
        # Current exit 100 vs baseline 98 -> 1.02x < 1.08 cap -> fine.
        self._set_fill(1000)
        price_history.baseline_ask = lambda api_name: 98.0
        prices = {"sell_price": 100.0, "buy_price": 70.0}
        info = make_info(); info["api_name"] = "SOME_ITEM"
        self.assertEqual(len(A.build_buy_candidates("P", info, prices, 0.0,
                         purse_remaining=10**12, held_qty=0, time_between_trades_hours=8)), 1)

    def test_spike_filter_noop_without_history(self):
        # No baseline for the product -> no spike filtering even on a big run-up.
        self._set_fill(1000)
        price_history.baseline_ask = lambda api_name: None
        prices = {"sell_price": 100.0, "buy_price": 70.0}
        info = make_info(); info["api_name"] = "SOME_ITEM"
        self.assertEqual(len(A.build_buy_candidates("P", info, prices, 0.0,
                         purse_remaining=10**12, held_qty=0, time_between_trades_hours=8)), 1)


class ExitDriftTests(unittest.TestCase):
    def setUp(self):
        self._orig_path = exit_drift._PATH
        self._tmp = Path(tempfile.mkdtemp()) / "exit_drift.json"
        exit_drift._PATH = self._tmp
        exit_drift._model = None
        exit_drift._mtime = None

    def tearDown(self):
        exit_drift._PATH = self._orig_path
        exit_drift._model = None
        exit_drift._mtime = None

    def test_multiplier(self):
        self._tmp.write_text(json.dumps({"drift_multiplier": 0.99}), encoding="utf-8")
        self.assertAlmostEqual(exit_drift.multiplier(), 0.99)

    def test_missing_defaults_to_one(self):
        exit_drift._PATH = Path(tempfile.mkdtemp()) / "nope.json"
        exit_drift._model = None
        exit_drift._mtime = None
        self.assertEqual(exit_drift.multiplier(), 1.0)

    def test_bad_value_defaults_to_one(self):
        self._tmp.write_text(json.dumps({"drift_multiplier": 0}), encoding="utf-8")
        self.assertEqual(exit_drift.multiplier(), 1.0)

    def test_hot_reload(self):
        self._tmp.write_text(json.dumps({"drift_multiplier": 0.99}), encoding="utf-8")
        self.assertAlmostEqual(exit_drift.multiplier(), 0.99)
        self._tmp.write_text(json.dumps({"drift_multiplier": 0.95}), encoding="utf-8")
        os.utime(self._tmp, (time.time() + 10, time.time() + 10))
        self.assertAlmostEqual(exit_drift.multiplier(), 0.95)

    def test_committed_exit_drift_well_formed(self):
        path = Path(exit_drift.__file__).parent / "exit_drift.json"
        self.assertTrue(path.exists(), "committed exit_drift.json is missing")
        m = json.loads(path.read_text(encoding="utf-8"))
        self.assertGreater(m["drift_multiplier"], 0)
        self.assertLessEqual(m["drift_multiplier"], 1.5)


class SolveTests(unittest.TestCase):
    def _c(self, name, side, profit, order_worth, coin_cost, qty=100):
        return A.Candidate(product_name=name, side=side, quantity=qty, expected_fill=qty,
                           profit=profit, order_worth=order_worth, coin_cost=coin_cost, slot_index=0)

    def test_coins_constraint_picks_higher_profit(self):
        c1 = self._c("A", "buy", profit=10000, order_worth=1000, coin_cost=1000)
        c2 = self._c("B", "buy", profit=8000, order_worth=1000, coin_cost=1000)
        chosen = A.solve([c1, c2], available_slots=5, coins_available=1000, daily_cap_remaining=10**12)
        self.assertEqual([c.product_name for c in chosen], ["A"])

    def test_daily_cap_constraint(self):
        c1 = self._c("A", "buy", profit=10000, order_worth=1000, coin_cost=0)
        c2 = self._c("B", "buy", profit=8000, order_worth=1000, coin_cost=0)
        chosen = A.solve([c1, c2], available_slots=5, coins_available=10**12, daily_cap_remaining=1000)
        self.assertEqual(len(chosen), 1)

    def test_slot_constraint(self):
        cs = [self._c(n, "buy", profit=1000 + i, order_worth=1, coin_cost=0) for i, n in enumerate("ABCD")]
        chosen = A.solve(cs, available_slots=2, coins_available=10**12, daily_cap_remaining=10**12)
        self.assertEqual(len(chosen), 2)

    def test_empty_or_no_slots(self):
        self.assertEqual(A.solve([], 5, 10**9, 10**9), [])
        c1 = self._c("A", "buy", 1000, 1, 0)
        self.assertEqual(A.solve([c1], 0, 10**9, 10**9), [])

    def test_sells_first_policy(self):
        # Buy has higher profit, but with one slot the sell is locked in first.
        sell = self._c("S", "sell_inventory", profit=5000, order_worth=1000, coin_cost=0)
        buy = self._c("B", "buy", profit=9000, order_worth=1000, coin_cost=500)
        chosen = A.solve_sells_first([sell, buy], available_slots=1, coins_available=10**9, daily_cap_remaining=10**9)
        self.assertEqual([c.product_name for c in chosen], ["S"])

    def test_blended_picks_highest_profit_across_sides(self):
        # The live policy: with one slot, blended solve() takes the higher-profit
        # buy over the sell (opposite of sells-first above).
        sell = self._c("S", "sell_inventory", profit=5000, order_worth=1000, coin_cost=0)
        buy = self._c("B", "buy", profit=9000, order_worth=1000, coin_cost=500)
        chosen = A.solve([sell, buy], available_slots=1, coins_available=10**9, daily_cap_remaining=10**9)
        self.assertEqual([c.product_name for c in chosen], ["B"])


class StackSizeTests(unittest.TestCase):
    def setUp(self):
        self._orig = (fill_model.available, fill_model.expected_fill, exit_drift.multiplier)
        fill_model.available = lambda: True
        exit_drift.multiplier = lambda default=1.0: 1.0

    def tearDown(self):
        fill_model.available, fill_model.expected_fill, exit_drift.multiplier = self._orig

    def test_hold_cap_by_stack(self):
        self.assertEqual(A.max_hold_per_item({"max_stack_size": 1}), 35)
        self.assertEqual(A.max_hold_per_item({"max_stack_size": 64}), 2240)

    def test_buy_order_cap_by_stack(self):
        self.assertEqual(A.max_buy_order_size({"max_stack_size": 1}), 256)
        self.assertEqual(A.max_buy_order_size({"max_stack_size": 64}), A.MAX_ORDER_SIZE)

    def test_unstackable_buy_limited_to_hold(self):
        # room = 35 (35 slots x stack 1) bounds the buy regardless of fill/overshoot
        fill_model.expected_fill = lambda side, vol, cap_qty, horizon_hours=None: min(cap_qty, 10**6)
        prices = {"sell_price": 1000.0, "buy_price": 600.0}   # ratio 1.67; 35 units x 400 ppu clears MIN_PROFIT
        cands = A.build_buy_candidates("P", make_info(stack=1), prices, 0.0,
                                       purse_remaining=10**12, held_qty=0, time_between_trades_hours=8)
        self.assertEqual(len(cands), 1)
        self.assertEqual(cands[0].quantity, 35)


class StackSizeModuleTests(unittest.TestCase):
    def test_enchantment_is_unstackable(self):
        self.assertEqual(stack_sizes.stack_size("ENCHANTMENT_SHARPNESS_7"), 1)

    def test_unknown_defaults_stackable(self):
        self.assertEqual(stack_sizes.stack_size("SOME_UNKNOWN_PRODUCT_XYZ"), 64)

    def test_none_defaults_stackable(self):
        self.assertEqual(stack_sizes.stack_size(None), 64)

    def test_override_takes_precedence(self):
        orig_path, orig_map, orig_mtime = (
            stack_sizes._OVERRIDE_PATH, stack_sizes._overrides, stack_sizes._override_mtime)
        tmp = Path(tempfile.mkdtemp()) / "stack_overrides.json"
        tmp.write_text(json.dumps({"stack_sizes": {"SOME_UNKNOWN_PRODUCT_XYZ": 16, "ENCHANTMENT_SHARPNESS_7": 64}}),
                       encoding="utf-8")
        stack_sizes._OVERRIDE_PATH = tmp
        stack_sizes._overrides = None
        stack_sizes._override_mtime = None
        try:
            self.assertEqual(stack_sizes.stack_size("SOME_UNKNOWN_PRODUCT_XYZ"), 16)   # 64 -> 16
            self.assertEqual(stack_sizes.stack_size("ENCHANTMENT_SHARPNESS_7"), 64)    # overrides the enchant rule
        finally:
            stack_sizes._OVERRIDE_PATH = orig_path
            stack_sizes._overrides = orig_map
            stack_sizes._override_mtime = orig_mtime

    def test_committed_summoning_eye_override(self):
        self.assertEqual(stack_sizes.stack_size("SUMMONING_EYE"), 1)


class MenuTests(unittest.TestCase):
    """build_recommendation output: >=10 ranked orders, both sides, sell rule."""

    def setUp(self):
        self._orig = (fill_model.available, fill_model.expected_fill,
                      exit_drift.multiplier, M.compute_daily_cap_used)
        fill_model.available = lambda: True
        fill_model.expected_fill = lambda side, vol, cap_qty, horizon_hours=None: min(cap_qty, 500)
        exit_drift.multiplier = lambda default=1.0: 1.0
        M.compute_daily_cap_used = lambda reset_ms, path=None: 0

    def tearDown(self):
        (fill_model.available, fill_model.expected_fill,
         exit_drift.multiplier, M.compute_daily_cap_used) = self._orig

    def _world(self, n=15):
        bazaar, info = {}, {}
        for i in range(n):
            name = f"P{i}"
            bazaar[name] = {"buy_price": 100.0, "sell_price": 140.0}  # ratio 1.4
            info[name] = make_info()
        return bazaar, info

    def _trader(self, held):
        return {"short-term-investments": {"P0": {"sub-orders": [{"partial-amount": held, "price-bought": 50.0}]}}}

    def test_menu_has_min_orders_both_sides_and_plan(self):
        bazaar, info = self._world(15)
        rec = M.build_recommendation(bazaar, info, self._trader(50_000), 0.0, 10**12, 5, 8)
        o = rec["orders"]
        self.assertGreaterEqual(len(o), 10)
        self.assertTrue(any(x["action"] == "buy" for x in o))
        self.assertTrue(any(x["action"] == "sell" for x in o))   # qualifying sell surfaced
        self.assertTrue(any(x["in_plan"] for x in o))

    def test_small_sell_excluded(self):
        bazaar, info = self._world(15)
        rec = M.build_recommendation(bazaar, info, self._trader(100), 0.0, 10**12, 5, 8)  # 140*100 < 2M
        self.assertFalse(any(x["action"] == "sell" for x in rec["orders"]))

    def test_assumes_at_least_one_slot(self):
        bazaar, info = self._world(15)
        rec = M.build_recommendation(bazaar, info, self._trader(50_000), 0.0, 10**12, 0, 8)  # 0 free slots
        self.assertGreaterEqual(len(rec["orders"]), 10)
        self.assertTrue(any(x["in_plan"] for x in rec["orders"]))   # still picks >=1


class BlacklistTests(unittest.TestCase):
    def setUp(self):
        self._orig_path = blacklist._PATH
        self._tmp = Path(tempfile.mkdtemp()) / "blacklist.json"
        self._tmp.write_text(json.dumps({"blacklist": ["Stock of Stonks", "FOO_BAR"]}), encoding="utf-8")
        blacklist._PATH = self._tmp
        blacklist._set = None
        blacklist._mtime = None

    def tearDown(self):
        blacklist._PATH = self._orig_path
        blacklist._set = None
        blacklist._mtime = None

    def test_matches_display_name_case_insensitive(self):
        self.assertTrue(blacklist.is_blacklisted("stock of stonks"))
        self.assertTrue(blacklist.is_blacklisted("Stock of Stonks", "STOCK_OF_STONKS"))

    def test_matches_api_name(self):
        self.assertTrue(blacklist.is_blacklisted("Whatever Display", "FOO_BAR"))

    def test_not_blacklisted(self):
        self.assertFalse(blacklist.is_blacklisted("Enchanted Diamond", "ENCHANTED_DIAMOND"))
        self.assertFalse(blacklist.is_blacklisted(None))

    def test_missing_file_blacklists_nothing(self):
        blacklist._PATH = Path(tempfile.mkdtemp()) / "nope.json"
        blacklist._set = None
        blacklist._mtime = None
        self.assertFalse(blacklist.is_blacklisted("Stock of Stonks"))

    def test_committed_blacklist_has_stonks(self):
        blacklist._PATH = self._orig_path
        blacklist._set = None
        blacklist._mtime = None
        self.assertTrue(blacklist.is_blacklisted("Stock of Stonks"))
        self.assertTrue(blacklist.is_blacklisted("x", "STOCK_OF_STONKS"))


class BlacklistIntegrationTests(unittest.TestCase):
    """A blacklisted product is dropped from build_bazaar_data_and_product_info
    entirely, so no candidate (buy or sell) can ever be built for it."""

    def test_blacklisted_product_dropped(self):
        product_list = {
            "Stock of Stonks": {"api-name": "STOCK_OF_STONKS", "type": "short-term-investment", "has-weights": True},
            "Enchanted Flint": {"api-name": "ENCHANTED_FLINT", "type": "bazaar-product", "has-weights": True},
        }
        bazaar_products = {
            "STOCK_OF_STONKS": {"sell_summary": [{"pricePerUnit": 100}], "buy_summary": [{"pricePerUnit": 110}],
                                "quick_status": {"sellMovingWeek": 1, "buyMovingWeek": 1}},
            "ENCHANTED_FLINT": {"sell_summary": [{"pricePerUnit": 100}], "buy_summary": [{"pricePerUnit": 110}],
                                "quick_status": {"sellMovingWeek": 1, "buyMovingWeek": 1}},
        }
        bazaar_data, info = M.build_bazaar_data_and_product_info(bazaar_products, {}, product_list)
        self.assertNotIn("Stock of Stonks", bazaar_data)
        self.assertNotIn("Stock of Stonks", info)
        self.assertIn("Enchanted Flint", bazaar_data)     # others unaffected


class PriceHistoryTests(unittest.TestCase):
    def setUp(self):
        self._orig_path = price_history._PATH
        self._tmp = Path(tempfile.mkdtemp()) / "price-history.jsonl"
        price_history._PATH = self._tmp
        price_history._baselines = None
        price_history._sig = None

    def tearDown(self):
        price_history._PATH = self._orig_path
        price_history._baselines = None
        price_history._sig = None

    def _write(self, rows):
        self._tmp.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")

    def test_baseline_is_median_ignoring_spike(self):
        # 30 samples at ask 100, then one spike to 300: median stays ~100.
        rows = [{"t": i, "p": {"FOO": [100.0, 90.0]}} for i in range(30)]
        rows.append({"t": 99, "p": {"FOO": [300.0, 90.0]}})
        self._write(rows)
        self.assertAlmostEqual(price_history.baseline_ask("FOO"), 100.0)

    def test_too_little_history_returns_none(self):
        self._write([{"t": i, "p": {"FOO": [100.0, 90.0]}} for i in range(5)])  # < MIN_SAMPLES
        self.assertIsNone(price_history.baseline_ask("FOO"))

    def test_missing_file_and_unknown_product(self):
        price_history._PATH = Path(tempfile.mkdtemp()) / "nope.jsonl"
        price_history._baselines = None
        price_history._sig = None
        self.assertIsNone(price_history.baseline_ask("FOO"))
        self.assertIsNone(price_history.baseline_ask(None))


class CommittedModelTests(unittest.TestCase):
    def test_committed_model_well_formed(self):
        path = Path(fill_model.__file__).parent / "fill_model.json"
        self.assertTrue(path.exists(), "committed fill_model.json is missing")
        m = json.loads(path.read_text(encoding="utf-8"))
        self.assertIn("horizon_hours", m)
        for side in ("sell", "buy"):
            bps = m["breakpoints"][side]
            self.assertGreaterEqual(len(bps), 2)                    # need >=2 points to interpolate
            self.assertEqual(bps, sorted(bps))                      # volumes strictly increasing
            self.assertTrue(all(v > 0 and r >= 0 for v, r in bps))


if __name__ == "__main__":
    unittest.main(verbosity=2)
