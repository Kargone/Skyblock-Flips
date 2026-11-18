import logging
import os
import time

import requests

# In docker the server is a separate service reachable by name (see
# docker-compose.yml); locally it's on localhost.
BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")

log = logging.getLogger(__name__)


def retry_forever(fn, what, delay_seconds=30):
    """Call fn() until it succeeds, sleeping between attempts. Used at startup so a
    server that is down (e.g. restarting) doesn't crash the script."""
    while True:
        try:
            return fn()
        except Exception as exc:
            log.warning("%s failed (%s); retrying in %ds", what, exc, delay_seconds)
            time.sleep(delay_seconds)


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


def get_mayor_data():
    response = requests.get(f"{BASE_URL}/api/mayor-data", timeout=10)
    response.raise_for_status()
    return response.json()
