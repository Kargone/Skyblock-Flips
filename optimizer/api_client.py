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


def get_mayor_data():
    response = requests.get(f"{BASE_URL}/api/mayor-data", timeout=10)
    response.raise_for_status()
    return response.json()


# --- Not wired into the poll loop yet ---------------------------------------
# Current coin purse from the Hypixel SkyBlock profile endpoint. Left here as a
# drop-in for when an API key + profile id + player uuid are configured; until
# then main.py reads the purse from the FLIP_PURSE env var (see get_configured_purse).
HYPIXEL_API_BASE = "https://api.hypixel.net/v2"


def get_purse_from_hypixel(api_key, profile_id, player_uuid):
    # Key goes in the API-Key header (the v2-documented method), not the query
    # string, so it never lands in a URL, log line, or exception message.
    response = requests.get(
        f"{HYPIXEL_API_BASE}/skyblock/profile",
        params={"profile": profile_id},
        headers={"API-Key": api_key},
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()
    members = (data.get("profile") or {}).get("members") or {}
    # Hypixel keys members by UNDASHED uuid; accept a dashed one too.
    member = members.get(player_uuid) or members.get(player_uuid.replace("-", ""))
    if member is None:
        return None
    return member.get("currencies", {}).get("coin_purse")
