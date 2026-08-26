import requests

BASE_URL = "http://localhost:8000"


def get_trader_data():
    response = requests.get(f"{BASE_URL}/api/trader-data", timeout=10)
    response.raise_for_status()
    return response.json()


def get_market_data():
    response = requests.get(f"{BASE_URL}/api/market-data", timeout=10)
    response.raise_for_status()
    return response.json()


def get_product_list():
    response = requests.get(f"{BASE_URL}/api/product-list", timeout=10)
    response.raise_for_status()
    return response.json()


def get_last_trade_time():
    response = requests.get(f"{BASE_URL}/api/last-trade-time", timeout=10)
    response.raise_for_status()
    return response.json()["lastTradeTime"]
