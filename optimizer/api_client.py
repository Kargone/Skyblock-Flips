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


def get_purse_breakdown(api_key, profile_id, player_uuid):
    """Returns {"purse", "bank", "combined", "banking_present", "member_found"}.
    banking_present is False when the profile has no 'banking' object at all,
    which is what you see when bank API access is turned off in-game - the bank
    balance then reads as 0 and no code change can recover it."""
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
    profile = data.get("profile") or {}
    members = profile.get("members") or {}
    # Hypixel keys members by UNDASHED uuid; accept a dashed one too.
    member = members.get(player_uuid) or members.get(player_uuid.replace("-", ""))
    if member is None:
        return {"purse": 0, "bank": 0, "combined": 0, "banking_present": False, "member_found": False}
    # Spending power = coin purse + the (co-op) bank balance, which lives at the
    # profile level and may be absent on profiles with banking disabled.
    purse = member.get("currencies", {}).get("coin_purse") or 0
    banking = profile.get("banking")
    bank = (banking or {}).get("balance") or 0
    return {
        "purse": purse, "bank": bank, "combined": purse + bank,
        "banking_present": banking is not None, "member_found": True,
    }


def get_purse_from_hypixel(api_key, profile_id, player_uuid):
    """Combined spending power (purse + bank), or None if the member wasn't found."""
    b = get_purse_breakdown(api_key, profile_id, player_uuid)
    return b["combined"] if b["member_found"] else None


def list_profiles(api_key, player_uuid):
    """Every SkyBlock profile for this player with its purse + bank, so the right
    profile_id can be identified. Uses the plural /skyblock/profiles endpoint
    (keyed by player uuid). Returns a list of dicts sorted selected-first."""
    response = requests.get(
        f"{HYPIXEL_API_BASE}/skyblock/profiles",
        params={"uuid": player_uuid.replace("-", "")},
        headers={"API-Key": api_key},
        timeout=10,
    )
    response.raise_for_status()
    profiles = response.json().get("profiles") or []
    out = []
    for p in profiles:
        members = p.get("members") or {}
        member = members.get(player_uuid) or members.get(player_uuid.replace("-", "")) or {}
        purse = member.get("currencies", {}).get("coin_purse") or 0
        banking = p.get("banking")
        bank = (banking or {}).get("balance") or 0
        out.append({
            "profile_id": p.get("profile_id"),
            "cute_name": p.get("cute_name"),
            "selected": bool(p.get("selected")),
            "purse": purse, "bank": bank, "combined": purse + bank,
            "banking_present": banking is not None,
        })
    out.sort(key=lambda d: not d["selected"])  # selected profile first
    return out
