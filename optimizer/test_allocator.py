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
import whitelist
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


class StackSizeTests(unittest.TestCase):
    def test_buy_order_cap_by_stack(self):
        self.assertEqual(A.max_buy_order_size({"max_stack_size": 1}), 256)
        self.assertEqual(A.max_buy_order_size({"max_stack_size": 64}), A.MAX_ORDER_SIZE)


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
    """build_recommendation output: buys-only ranked menu of >=10 orders, in_plan flags."""

    # Products across buckets. price = (bid, ask); margin = ask - bid (fee 0 in tests).
    WORLD = {
        "A7A": (7000, 6000, 10000),   # bucket 7k, margin 4000 -> qualified
        "A7B": (7000, 6000,  9000),   # bucket 7k, margin 3000 -> qualified (lower)
        "A4":  (4000, 50000, 54000),  # bucket 4k, margin 4000 -> qualified
        "A2":  (2000, 150000, 156000),# bucket 2k, margin 6000 -> qualified
        "A1":  (1000, 300000, 312000),# bucket 1k, margin 12000 -> qualified
        "LOW": (7000, 6000,  6500),   # bucket 7k, margin 500 < 2500 -> DISCARDED
    }

    def setUp(self):
        self._orig = (fill_model.available, fill_model.expected_fill, exit_drift.multiplier,
                      price_history.baseline_ask, price_history.baseline_bid,
                      M.compute_daily_cap_used, whitelist._PATH, whitelist._map, whitelist._mtime)
        fill_model.available = lambda: True
        fill_model.expected_fill = lambda side, vol, cap_qty, horizon_hours=None: min(cap_qty, 500)
        exit_drift.multiplier = lambda default=1.0: 1.0
        price_history.baseline_ask = lambda api_name: None   # no book-sanity demotion in tests
        price_history.baseline_bid = lambda api_name: None
        M.compute_daily_cap_used = lambda reset_ms, path=None: 0
        tmp = Path(tempfile.mkdtemp()) / "whitelist.json"
        tmp.write_text(json.dumps({"buy_whitelist": {k: {"max_buy": v[0]} for k, v in self.WORLD.items()}}),
                       encoding="utf-8")
        whitelist._PATH = tmp
        whitelist._map = None
        whitelist._mtime = None

    def tearDown(self):
        (fill_model.available, fill_model.expected_fill, exit_drift.multiplier,
         price_history.baseline_ask, price_history.baseline_bid,
         M.compute_daily_cap_used, whitelist._PATH, whitelist._map, whitelist._mtime) = self._orig

    def _world(self):
        bazaar, info = {}, {}
        for api, (mb, bid, ask) in self.WORLD.items():
            bazaar[api] = {"buy_price": float(bid), "sell_price": float(ask)}
            i = make_info(); i["api_name"] = api
            info[api] = i
        return bazaar, info

    def _rec(self, slots=5):
        bazaar, info = self._world()
        return M.build_recommendation(bazaar, info, {"short-term-investments": {}}, 0.0, slots, 8)

    def test_buys_only_with_bucket_fields(self):
        o = self._rec()["orders"]
        self.assertEqual(len(o), len(self.WORLD))               # every whitelisted product emitted
        self.assertTrue(all(x["action"] == "buy" for x in o))
        self.assertFalse(any("in_plan" in x for x in o))        # ILP/in_plan removed
        self.assertTrue(all({"bucket", "qualified", "margin", "display_bucket"} <= x.keys() for x in o))

    def test_discarded_product_kept_but_after_qualified(self):
        o = self._rec()["orders"]
        names = [x["product_name"] for x in o]
        self.assertIn("LOW", names)                             # not deleted
        low = next(x for x in o if x["product_name"] == "LOW")
        self.assertFalse(low["qualified"])
        self.assertIn("margin", low["disqualify"])
        # within the 7k bucket, LOW (discarded) ranks behind the qualified 7k ones
        seven = [x for x in o if x["display_bucket"] == "7k"]
        self.assertEqual(seven[-1]["product_name"], "LOW")
        self.assertTrue(all(x["qualified"] for x in seven[:-1]))

    def test_bucket_ordering_and_margin_rank(self):
        o = self._rec()["orders"]
        # display buckets appear in order 7k, 4k, 2k, 1k+500
        seen = [x["display_bucket"] for x in o]
        order = [b for b in ["7k", "4k", "2k", "1k+500"] if b in seen]
        self.assertEqual([b for b in seen if b in order], sorted(seen, key=lambda b: order.index(b)))
        # qualified 7k ranked by margin desc: A7A(4000) before A7B(3000)
        seven_q = [x["product_name"] for x in o if x["display_bucket"] == "7k" and x["qualified"]]
        self.assertEqual(seven_q, ["A7A", "A7B"])

    def _rec_trader(self, trader_data, slots=5):
        bazaar, info = self._world()
        return M.build_recommendation(bazaar, info, trader_data, 0.0, slots, 8)

    def test_open_sell_order_skips_buy(self):
        # A live (unclaimed) sell order on A4 means we're already working that
        # product manually -> it must not be re-recommended as a buy.
        trader = {"short-term-investments": {},
                  "sell-order-overview": {"sell-orders": [{"item-name": "A4", "has-been-claimed": False}]}}
        names = [x["product_name"] for x in self._rec_trader(trader)["orders"]]
        self.assertNotIn("A4", names)
        self.assertIn("A2", names)                              # others unaffected

    def test_claimed_sell_order_does_not_skip(self):
        # A claimed sell order is finished, not a live position -> no skip.
        trader = {"short-term-investments": {},
                  "sell-order-overview": {"sell-orders": [{"item-name": "A4", "has-been-claimed": True}]}}
        names = [x["product_name"] for x in self._rec_trader(trader)["orders"]]
        self.assertIn("A4", names)

    def test_inventory_glut_skips_default_bucket(self):
        # Holding > 1500 of a non-small-bucket product (A7A is 7k bucket) -> skipped.
        trader = {"short-term-investments": {}, "all-products": {"A7A": {"current-amount": 1501}}}
        names = [x["product_name"] for x in self._rec_trader(trader)["orders"]]
        self.assertNotIn("A7A", names)
        self.assertIn("A7B", names)
        # exactly at the cap is still allowed
        trader["all-products"]["A7A"]["current-amount"] = 1500
        self.assertIn("A7A", [x["product_name"] for x in self._rec_trader(trader)["orders"]])

    def test_inventory_glut_tighter_for_small_bucket(self):
        # A1 is the 1k bucket -> cap is 500, not 1500. 600 held -> skipped; 500 -> kept.
        trader = {"short-term-investments": {}, "all-products": {"A1": {"current-amount": 600}}}
        self.assertNotIn("A1", [x["product_name"] for x in self._rec_trader(trader)["orders"]])
        trader["all-products"]["A1"]["current-amount"] = 500
        self.assertIn("A1", [x["product_name"] for x in self._rec_trader(trader)["orders"]])


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

    def test_forge_display_row_dropped_clean_row_kept(self):
        # A "(forge)" row reuses the item's api-name; it must be dropped so a
        # whitelisted item isn't bought twice, while the clean row still trades.
        product_list = {
            "Refined Titanium": {"api-name": "REFINED_TITANIUM", "type": "bazaar-product", "has-weights": True},
            "Refined Titanium (forge)": {"api-name": "REFINED_TITANIUM", "type": "forge-product"},
            "Mithril Plate (forge)": {"api-name": "MITHRIL_PLATE", "type": "forge-product"},
        }
        bp = {"sell_summary": [{"pricePerUnit": 100}], "buy_summary": [{"pricePerUnit": 110}],
              "quick_status": {"sellMovingWeek": 1, "buyMovingWeek": 1}}
        bazaar_products = {"REFINED_TITANIUM": bp, "MITHRIL_PLATE": bp}
        bazaar_data, info = M.build_bazaar_data_and_product_info(bazaar_products, {}, product_list)
        self.assertIn("Refined Titanium", bazaar_data)
        self.assertNotIn("Refined Titanium (forge)", bazaar_data)
        self.assertNotIn("Mithril Plate (forge)", bazaar_data)

    def test_gemstone_question_row_dropped_clean_row_kept(self):
        # A "? " -prefixed gemstone row reuses the clean row's api-name (the in-game
        # gemstone symbol renders as "?"); it must be dropped so a whitelisted
        # gemstone isn't bought twice, while the clean row still trades.
        product_list = {
            "Fine Ruby Gemstone": {"api-name": "FINE_RUBY_GEM", "type": "short-term-investment", "has-weights": True},
            "? Fine Ruby Gemstone": {"api-name": "FINE_RUBY_GEM", "type": "short-term-investment", "has-weights": True},
        }
        bp = {"sell_summary": [{"pricePerUnit": 100}], "buy_summary": [{"pricePerUnit": 110}],
              "quick_status": {"sellMovingWeek": 1, "buyMovingWeek": 1}}
        bazaar_products = {"FINE_RUBY_GEM": bp}
        bazaar_data, info = M.build_bazaar_data_and_product_info(bazaar_products, {}, product_list)
        self.assertIn("Fine Ruby Gemstone", bazaar_data)
        self.assertNotIn("? Fine Ruby Gemstone", bazaar_data)


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
        # 30 samples at ask 100 / bid 90, then one ask spike to 300: medians hold.
        rows = [{"t": i, "p": {"FOO": [100.0, 90.0]}} for i in range(30)]
        rows.append({"t": 99, "p": {"FOO": [300.0, 90.0]}})
        self._write(rows)
        self.assertAlmostEqual(price_history.baseline_ask("FOO"), 100.0)
        self.assertAlmostEqual(price_history.baseline_bid("FOO"), 90.0)   # bid = [1]

    def test_too_little_history_returns_none(self):
        self._write([{"t": i, "p": {"FOO": [100.0, 90.0]}} for i in range(5)])  # < MIN_SAMPLES
        self.assertIsNone(price_history.baseline_ask("FOO"))

    def test_missing_file_and_unknown_product(self):
        price_history._PATH = Path(tempfile.mkdtemp()) / "nope.jsonl"
        price_history._baselines = None
        price_history._sig = None
        self.assertIsNone(price_history.baseline_ask("FOO"))
        self.assertIsNone(price_history.baseline_ask(None))


class WhitelistTests(unittest.TestCase):
    """Buys-only whitelist: gates which products are bought and sizes to max_buy."""

    def setUp(self):
        self._stub = (fill_model.available, fill_model.expected_fill, exit_drift.multiplier,
                      price_history.baseline_ask, price_history.baseline_bid)
        fill_model.available = lambda: True
        fill_model.expected_fill = lambda side, vol, cap_qty, horizon_hours=None: min(cap_qty, 10**6)
        exit_drift.multiplier = lambda default=1.0: 1.0
        price_history.baseline_ask = lambda api_name: None
        price_history.baseline_bid = lambda api_name: None
        self._orig_path, self._orig_map, self._orig_mtime = (whitelist._PATH, whitelist._map, whitelist._mtime)
        self._tmp = Path(tempfile.mkdtemp()) / "whitelist.json"
        self._tmp.write_text(json.dumps({"buy_whitelist": {
            "FOO": {"max_buy": 5000}, "BAR": {"max_buy": 400},
            "NPC": {"max_buy": 2000, "npc_sell_price": 100000}, "BK": {"max_buy": 4000}}}),
            encoding="utf-8")
        whitelist._PATH = self._tmp
        whitelist._map = None
        whitelist._mtime = None

    def tearDown(self):
        (fill_model.available, fill_model.expected_fill, exit_drift.multiplier,
         price_history.baseline_ask, price_history.baseline_bid) = self._stub
        whitelist._PATH, whitelist._map, whitelist._mtime = self._orig_path, self._orig_map, self._orig_mtime

    def _info(self, api_name):
        info = make_info()
        info["api_name"] = api_name
        return info

    def test_active_and_allows(self):
        self.assertTrue(whitelist.active())
        self.assertTrue(whitelist.allows("FOO"))
        self.assertFalse(whitelist.allows("ZZZ"))

    def test_non_whitelisted_buy_skipped(self):
        prices = {"sell_price": 1000.0, "buy_price": 600.0}
        self.assertEqual(A.build_buy_candidates("P", self._info("ZZZ"), prices, 0.0,
                         time_between_trades_hours=8), [])

    def test_whitelisted_buy_sizes_to_max_buy(self):
        # Stackable item: qty is exactly the configured max_buy (5000 < 71,680 cap).
        prices = {"sell_price": 1000.0, "buy_price": 600.0}
        cands = A.build_buy_candidates("P", self._info("FOO"), prices, 0.0,
                                       time_between_trades_hours=8)
        self.assertEqual(len(cands), 1)
        self.assertEqual(cands[0].quantity, 5000)

    def test_whitelisted_unstackable_capped_at_256(self):
        # FOO max_buy is 5000, but an unstackable (stack-1) item caps at 256/order.
        prices = {"sell_price": 1000.0, "buy_price": 600.0}
        info = make_info(stack=1)
        info["api_name"] = "FOO"
        cands = A.build_buy_candidates("P", info, prices, 0.0, time_between_trades_hours=8)
        self.assertEqual(cands[0].quantity, 256)

    def test_empty_whitelist_is_inactive(self):
        self._tmp.write_text(json.dumps({"buy_whitelist": {}}), encoding="utf-8")
        whitelist._map = None
        whitelist._mtime = None
        self.assertFalse(whitelist.active())
        self.assertTrue(whitelist.allows("ANYTHING"))   # no restriction when empty

    def test_every_whitelisted_product_is_emitted_with_flag(self):
        # FOO: margin 400 < floor -> emitted but qualified False (soft, not dropped).
        prices = {"sell_price": 1000.0, "buy_price": 600.0}
        c = A.build_buy_candidates("P", self._info("FOO"), prices, 0.0,
                                   time_between_trades_hours=8)[0]
        self.assertFalse(c.qualified)
        self.assertIn("margin", c.disqualify)

    def test_npc_floor_relaxes_margin(self):
        # NPC bucket is 2k (floor 4000), but bid near npc -> NPC floor 2500 applies.
        prices = {"sell_price": 102000.0, "buy_price": 99000.0}   # margin 3000; bid/npc=0.99
        c = A.build_buy_candidates("P", self._info("NPC"), prices, 0.0,
                                   time_between_trades_hours=8)[0]
        self.assertTrue(c.npc_floor)
        self.assertTrue(c.qualified)          # 3000 >= 2500 NPC floor (would fail the 4000 bucket floor)

    def test_npc_floor_skips_ask_sanity(self):
        price_history.baseline_ask = lambda a: 100000.0   # avg ask; current ask way above
        prices = {"sell_price": 190000.0, "buy_price": 99000.0}   # spread ok (190k<198k)
        c = A.build_buy_candidates("P", self._info("NPC"), prices, 0.0,
                                   time_between_trades_hours=8)[0]
        self.assertTrue(c.npc_floor)
        self.assertNotIn("ask_off", c.disqualify)   # ask side skipped for NPC-floor
        self.assertTrue(c.qualified)

    def test_book_sanity_demotes_on_bid_off(self):
        price_history.baseline_bid = lambda a: 100000.0   # current bid 40% below avg
        prices = {"sell_price": 110000.0, "buy_price": 60000.0}   # fat margin, but bid dislocated
        c = A.build_buy_candidates("P", self._info("BK"), prices, 0.0,
                                   time_between_trades_hours=8)[0]
        self.assertFalse(c.qualified)
        self.assertIn("bid_off", c.disqualify)

    def test_committed_whitelist_well_formed(self):
        whitelist._PATH, whitelist._map, whitelist._mtime = self._orig_path, None, None
        self.assertTrue(whitelist.active())
        self.assertEqual(whitelist.max_buy("WHALE_BAIT"), 7000)
        self.assertEqual(whitelist.max_buy("POLISHED_PUMPKIN"), 2000)   # hand override
        self.assertIsNone(whitelist.max_buy("SUMMONING_EYE"))           # dropped during triage
        self.assertEqual(whitelist.npc_sell_price("POLISHED_PUMPKIN"), 256000)   # npc data present


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
