class FindMaxProfit:
    def __init__(self, available_slots_in_bazaar, current_coins_amount, inventory, all_product_information, bazaar_data):
        self.current_coins_amount = current_coins_amount
        self.inventory = inventory
        self.all_product_information = all_product_information
        self.bazaar_data = bazaar_data

        self.bazaar_daily_limit_used = 0
        self.BAZAAR_DAILY_LIMIT = 15_000_000_000
        self.TRADES_PER_DAY = 3
        self.TIME_BETWEEN_TRADES = 8 # Hours
        self.MAX_TRADE_LIMIT_COINS_PER_SESSION = self.BAZAAR_DAILY_LIMIT // self.TRADES_PER_DAY

        self.npc_sell_limit_used = 0
        self.NPC_SELL_LIMIT = 500_000_000

        self.SLOTS_TOTAL = 28 # between 14 and 28 based on upgrades
        self.available_slots_in_bazaar = available_slots_in_bazaar


    def find_max_profit_for_slot(self, product_list):
        # look through every product on bz and rank them given constraints in self
        # TODO: Slot optimization and daily limit optimization

        max_profit_table = {}
        for product_name in product_list:
            max_profit_table[product_name] = self.find_expected_profit_per_slot(product_name)

        return max_profit_table

    def find_expected_profit_per_slot(self, product_name):
        expected_quantity_sold_per_item = self.find_expected_quantity_sold_per_slot(product_name)
        expected_profit_per_item = self.find_expected_profit_per_item(product_name)
        return expected_profit_per_item * expected_quantity_sold_per_item

    def find_expected_quantity_sold_per_slot(self, product_name):
        product_info = self.all_product_information[product_name]
        past_quantity_sold_per_hour = product_info["past_quantity_sold_per_hour"]

        # Each weight compares a current stat (7-day volume, 24-hour volume, new
        # listings/hour) against an EMA of its own recent past, computed server-side
        # in backend.mjs. >1 means running hotter than usual, <1 means cooler.
        weight_1 = product_info["sell_volume_7_day_weight"]
        weight_2 = product_info["sell_volume_24_hour_weight"]
        weight_3 = product_info["new_listings_per_hour_selling_weight"]

        # TODO: Slots not taken into account
        expected_bought_amount = self.find_expected_bought_amount(product_name)
        # A product you've never traded before won't have an inventory entry yet -
        # that just means you're holding 0 of it, not an error.
        current_held_amount = self.inventory.get(product_name, {}).get("current-amount", 0) + expected_bought_amount

        return min(past_quantity_sold_per_hour * self.TIME_BETWEEN_TRADES, current_held_amount) * weight_1 * weight_2 * weight_3

    def find_expected_bought_amount(self, product_name):
        product_info = self.all_product_information[product_name]
        past_quantity_bought_per_hour = product_info["past_quantity_bought_per_hour"]

        weight_1 = product_info["bought_volume_7_day_weight"]
        weight_2 = product_info["bought_volume_24_hour_weight"]
        weight_3 = product_info["new_listings_per_hour_buying_weight"]

        # TODO: Optimize this
        buy_order_quantity = 2000

        return min(past_quantity_bought_per_hour * self.TIME_BETWEEN_TRADES, buy_order_quantity) * weight_1 * weight_2 * weight_3

    def find_expected_profit_per_item(self, product_name):
        # determine if the order would go over the npc sell limit better. not if it's already reached, but if it would be reached if the order is sold
        npc_sell_limit_reached = self.npc_sell_limit_used >= self.NPC_SELL_LIMIT

        # TODO: Make this changeable
        bazaar_fee = 0.01 # between 1 and 6 (if derpy)

        # TODO: Fix this
        current_product_sell_price = self.bazaar_data[product_name]["sell_price"]
        current_product_buy_price = self.bazaar_data[product_name]["buy_price"]

        expected_change_sell_price = 0 # for now
        expected_change_buy_price = 0 # for now

        # doesn't do anything for now
        future_sell_price = current_product_sell_price + expected_change_sell_price
        future_buy_price = current_product_sell_price + expected_change_buy_price

        return (current_product_sell_price - current_product_buy_price) * (1 - bazaar_fee) if npc_sell_limit_reached else (current_product_sell_price - current_product_buy_price)

    def update_constraints(self, order_worth):
        if order_worth > self.current_coins_amount:
            print("ERROR: You dont have enough coins for that order")
        else:
            self.available_slots_in_bazaar -= 1
            self.bazaar_daily_limit_used += order_worth
            self.current_coins_amount -= order_worth

    def reset_for_new_session(self, coins_amount, inventory, all_product_information, bazaar_data):
        self.current_coins_amount = coins_amount
        self.bazaar_daily_limit_used = 0
        self.inventory = inventory
        self.all_product_information = all_product_information
        self.bazaar_data = bazaar_data

    def reset_npc_limit(self):
        self.npc_sell_limit_used = 0



import logging
import time

from api_client import get_last_trade_time, get_market_data, get_product_list, get_trader_data

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("main")

# Anomalies (bad/missing data, crossed prices, etc) recur every poll for as long as
# the underlying condition holds, so log each one once when it first appears and
# stay quiet until it's cleared (i.e. the condition stops holding), at which point
# it can log again if it comes back.
_active_anomalies = set()


def log_once(key, level, message, *args, **kwargs):
    if key not in _active_anomalies:
        _active_anomalies.add(key)
        log.log(level, message, *args, **kwargs)


def clear_anomaly(key):
    _active_anomalies.discard(key)


POLL_INTERVAL_SECONDS = 30
NEW_TRADE_GAP_RESET_MINUTES = 30
HOURS_PER_WEEK = 7 * 24

# The smallest amount a bazaar order price can be beaten by.
BAZAAR_PRICE_INCREMENT = 0.1

# TODO: Set this to your actual bazaar slot count (14-28 depending on upgrades).
# Not currently tracked anywhere in trader-data.json.
TOTAL_BAZAAR_SLOTS = 28


def build_inventory(trader_data):
    inventory = trader_data.get("all-products")
    if inventory is None:
        log_once("inventory-missing", logging.ERROR, "trader_data is missing 'all-products'; treating inventory as empty")
        return {}
    clear_anomaly("inventory-missing")

    for product_name, product_info in inventory.items():
        current_amount = product_info.get("current-amount")
        max_amount = product_info.get("max-amount")

        if current_amount is None:
            log_once((product_name, "missing-current-amount"), logging.ERROR, "'%s' is missing current-amount", product_name)
        else:
            clear_anomaly((product_name, "missing-current-amount"))
            if current_amount < 0:
                log_once((product_name, "negative-current-amount"), logging.ERROR, "'%s' has a negative current-amount: %s", product_name, current_amount)
            else:
                clear_anomaly((product_name, "negative-current-amount"))

        if max_amount is None:
            log_once((product_name, "missing-max-amount"), logging.ERROR, "'%s' is missing max-amount", product_name)
        else:
            clear_anomaly((product_name, "missing-max-amount"))

        if current_amount is not None and max_amount is not None and current_amount > max_amount:
            log_once((product_name, "current-exceeds-max"), logging.ERROR, "'%s' current-amount (%s) exceeds max-amount (%s)", product_name, current_amount, max_amount)
        else:
            clear_anomaly((product_name, "current-exceeds-max"))

    return inventory


def count_available_bazaar_slots(trader_data, total_slots):
    sell_orders = trader_data.get("sell-order-overview", {}).get("sell-orders", [])
    buy_orders = trader_data.get("buy-order-overview", {}).get("buy-orders", [])
    used_slots = sum(1 for order in sell_orders if not order.get("has-been-claimed")) + \
        sum(1 for order in buy_orders if not order.get("has-been-claimed"))

    if used_slots > total_slots:
        log_once(
            "slots-exceeded", logging.ERROR,
            "used bazaar slots (%s) exceeds TOTAL_BAZAAR_SLOTS (%s); is TOTAL_BAZAAR_SLOTS set correctly?",
            used_slots, total_slots
        )
    else:
        clear_anomaly("slots-exceeded")

    return max(0, total_slots - used_slots)


def build_bazaar_data_and_product_info(bazaar_products, volume_stats, product_list):
    bazaar_data = {}
    all_product_information = {}

    for product_name, product_meta in product_list.items():
        api_name = product_meta.get("api-name")
        if not api_name:
            if product_meta.get("has-weights"):
                log_once((product_name, "missing-api-name"), logging.ERROR, "'%s' has no api-name in product-list.json; skipping", product_name)
            # else: an AH-only item (accessories, etc) with no bazaar presence by design.
            continue
        clear_anomaly((product_name, "missing-api-name"))

        product = bazaar_products.get(api_name)
        if product is None:
            log_once((product_name, "missing-bazaar-data"), logging.ERROR, "no bazaar data found for '%s' (api-name '%s')", product_name, api_name)
            continue
        clear_anomaly((product_name, "missing-bazaar-data"))

        # We only care about the price to actually place a buy/sell order (not
        # instant-buy/instant-sell), so derive it from the order book: a buy order
        # needs to beat the current best bid by one increment to be at the front of
        # the queue, and a sell order needs to beat the current best ask by one
        # increment the same way.
        #
        # Confusingly, Hypixel's field names are from the order book's own
        # perspective, not the trader's: "sell_summary" holds the active BUY orders
        # (bids) you'd sell into, and "buy_summary" holds the active SELL orders
        # (asks) you'd buy into. Confirmed empirically: quick_status.buyPrice always
        # equals min(buy_summary prices) exactly.
        sell_summary = product.get("sell_summary", [])
        buy_summary = product.get("buy_summary", [])

        if not sell_summary:
            log_once((product_name, "no-bids"), logging.WARNING, "'%s' has no active buy orders (bids); can't derive a sell order price", product_name)
        else:
            clear_anomaly((product_name, "no-bids"))
        if not buy_summary:
            log_once((product_name, "no-asks"), logging.WARNING, "'%s' has no active sell orders (asks); can't derive a buy order price", product_name)
        else:
            clear_anomaly((product_name, "no-asks"))

        best_bid = max((order["pricePerUnit"] for order in sell_summary), default=None)
        best_ask = min((order["pricePerUnit"] for order in buy_summary), default=None)

        sell_price = best_ask - BAZAAR_PRICE_INCREMENT if best_ask is not None else 0
        buy_price = best_bid + BAZAAR_PRICE_INCREMENT if best_bid is not None else 0

        if sell_price <= 0:
            log_once((product_name, "non-positive-sell-price"), logging.ERROR, "'%s' has a non-positive sell order price: %s", product_name, sell_price)
        else:
            clear_anomaly((product_name, "non-positive-sell-price"))
        if buy_price <= 0:
            log_once((product_name, "non-positive-buy-price"), logging.ERROR, "'%s' has a non-positive buy order price: %s", product_name, buy_price)
        else:
            clear_anomaly((product_name, "non-positive-buy-price"))
        if best_ask is not None and best_bid is not None and buy_price >= sell_price:
            log_once(
                (product_name, "crossed-spread"), logging.ERROR,
                "'%s' buy order price (%s) is not below its sell order price (%s); spread looks wrong",
                product_name, buy_price, sell_price
            )
        else:
            clear_anomaly((product_name, "crossed-spread"))

        bazaar_data[product_name] = {
            "sell_price": sell_price,
            "buy_price": buy_price,
        }

        quick_status = product.get("quick_status")
        if quick_status is None:
            log_once((product_name, "missing-quick-status"), logging.ERROR, "'%s' is missing quick_status", product_name)
            quick_status = {}
        else:
            clear_anomaly((product_name, "missing-quick-status"))

        sell_moving_week = quick_status.get("sellMovingWeek", 0)
        buy_moving_week = quick_status.get("buyMovingWeek", 0)
        if sell_moving_week < 0:
            log_once((product_name, "negative-sell-moving-week"), logging.ERROR, "'%s' has a negative sellMovingWeek: %s", product_name, sell_moving_week)
        else:
            clear_anomaly((product_name, "negative-sell-moving-week"))
        if buy_moving_week < 0:
            log_once((product_name, "negative-buy-moving-week"), logging.ERROR, "'%s' has a negative buyMovingWeek: %s", product_name, buy_moving_week)
        else:
            clear_anomaly((product_name, "negative-buy-moving-week"))

        # The server (backend.mjs) keeps a rolling history of quick_status samples and
        # computes real 1h/24h rates from it. Right after a server restarts, there won't
        # be enough history yet, so fall back to spreading the weekly volume evenly
        # until real rates are available.
        stats = volume_stats.get(api_name)
        if stats is None:
            log_once((product_name, "no-volume-stats"), logging.INFO, "no volumeStats yet for '%s'; falling back to weekly-average estimate", product_name)
            stats = {}
        else:
            clear_anomaly((product_name, "no-volume-stats"))

        sell_per_hour_1h = stats.get("sellVolumePerHour1h")
        sell_per_hour_24h = stats.get("sellVolumePerHour24h")
        buy_per_hour_1h = stats.get("buyVolumePerHour1h")
        buy_per_hour_24h = stats.get("buyVolumePerHour24h")

        all_product_information[product_name] = {
            "past_quantity_sold_per_hour": sell_per_hour_1h if sell_per_hour_1h is not None else sell_moving_week / HOURS_PER_WEEK,
            "sell_volume_7_day": sell_moving_week,
            "sell_volume_24_hour": sell_per_hour_24h * 24 if sell_per_hour_24h is not None else sell_moving_week / 7,
            "new_listings_per_hour_selling": stats.get("newSellListingsPerHour") or 0,
            "past_quantity_bought_per_hour": buy_per_hour_1h if buy_per_hour_1h is not None else buy_moving_week / HOURS_PER_WEEK,
            "bought_volume_7_day": buy_moving_week,
            "bought_volume_24_hour": buy_per_hour_24h * 24 if buy_per_hour_24h is not None else buy_moving_week / 7,
            "new_listings_per_hour_buying": stats.get("newBuyListingsPerHour") or 0,
            # Each weight is current-vs-EMA-of-past for that stat, computed server-side
            # (backend.mjs). Defaults to 1 (neutral) until the server has enough
            # history to produce a real baseline, e.g. right after a restart.
            "sell_volume_7_day_weight": stats.get("sellVolume7DayWeight", 1),
            "sell_volume_24_hour_weight": stats.get("sellVolume24HourWeight", 1),
            "new_listings_per_hour_selling_weight": stats.get("newSellListingsWeight", 1),
            "bought_volume_7_day_weight": stats.get("buyVolume7DayWeight", 1),
            "bought_volume_24_hour_weight": stats.get("buyVolume24HourWeight", 1),
            "new_listings_per_hour_buying_weight": stats.get("newBuyListingsWeight", 1),
        }

    return bazaar_data, all_product_information


if __name__ == "__main__":
    product_list = get_product_list()

    trader_data = get_trader_data()
    market_data = get_market_data()

    inventory = build_inventory(trader_data)
    available_slots_in_bazaar = count_available_bazaar_slots(trader_data, TOTAL_BAZAAR_SLOTS)
    bazaar_data, all_product_information = build_bazaar_data_and_product_info(
        market_data.get("bazaarProducts", {}), market_data.get("volumeStats", {}), product_list
    )

    # TODO: No API source yet for the current coin purse (needs the Hypixel
    # SkyBlock profile endpoint + an API key, which isn't wired up anywhere yet).
    # Update this manually for now.
    current_coins_amount = 0

    app = FindMaxProfit(available_slots_in_bazaar, current_coins_amount, inventory, all_product_information, bazaar_data)

    last_trade_time_seen = get_last_trade_time()

    while True:
        time.sleep(POLL_INTERVAL_SECONDS)

        try:
            trader_data = get_trader_data()
            market_data = get_market_data()
        except Exception:
            log_once(
                "fetch-trader-market-data-failed", logging.ERROR,
                "failed to fetch data from the server this poll; will retry next interval", exc_info=True
            )
            continue
        clear_anomaly("fetch-trader-market-data-failed")

        inventory = build_inventory(trader_data)
        available_slots_in_bazaar = count_available_bazaar_slots(trader_data, TOTAL_BAZAAR_SLOTS)
        bazaar_data, all_product_information = build_bazaar_data_and_product_info(
            market_data.get("bazaarProducts", {}), market_data.get("volumeStats", {}), product_list
        )
        app.available_slots_in_bazaar = available_slots_in_bazaar
        app.inventory = inventory
        app.all_product_information = all_product_information
        app.bazaar_data = bazaar_data

        # If no trade happened for 30+ minutes and one just came in, start a fresh session.
        try:
            last_trade_time = get_last_trade_time()
            clear_anomaly("fetch-last-trade-time-failed")
        except Exception:
            log_once(
                "fetch-last-trade-time-failed", logging.ERROR,
                "failed to fetch last trade time this poll; skipping the gap check for now", exc_info=True
            )
            last_trade_time = last_trade_time_seen

        if last_trade_time_seen is not None and last_trade_time is not None and last_trade_time != last_trade_time_seen:
            gap_minutes = (last_trade_time - last_trade_time_seen) / 1000 / 60
            if gap_minutes >= NEW_TRADE_GAP_RESET_MINUTES:
                app.reset_for_new_session(current_coins_amount, inventory, all_product_information, bazaar_data)
        last_trade_time_seen = last_trade_time

        # Only rank products that actually made it into bazaar_data/all_product_information -
        # build_bazaar_data_and_product_info already filters product_list down to the
        # subset with real bazaar presence (skipping AH-only accessories, items missing
        # from the live bazaar, etc).
        # TODO: Send this back to the api
        MAX_PROFIT_TABLE = app.find_max_profit_for_slot(list(bazaar_data.keys()))

    # TODO: Make sure there is no product name confusion between all the datasets using api vs normalized

