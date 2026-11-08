"""
Lists every SkyBlock profile on your account with its purse and bank, so you can
pick the profile_id that actually holds your coins and put it in secrets.json.

Run on the machine with secrets.json (the server):
    python optimizer/list_profiles.py

The profile marked [SELECTED] is the one you're currently playing - usually the
one you want. Copy its profile_id into secrets.json's "profile_id". Never prints
the API key.
"""

from main import load_secrets
from api_client import list_profiles


def main():
    creds = load_secrets()
    missing = [k for k in ("hypixel_api_key", "player_uuid") if not creds.get(k)]
    if missing:
        print("Missing credentials in secrets.json / env:", ", ".join(missing))
        return
    try:
        profiles = list_profiles(creds["hypixel_api_key"], creds["player_uuid"])
    except Exception as e:
        print("Request failed:", type(e).__name__, e)
        return

    if not profiles:
        print("No profiles returned. Is player_uuid your own uuid?")
        return

    configured = creds.get("profile_id")
    for p in profiles:
        tag = " [SELECTED]" if p["selected"] else ""
        tag += " [configured in secrets.json]" if p["profile_id"] == configured else ""
        print(f"\n{p['cute_name']}{tag}")
        print(f"  profile_id : {p['profile_id']}")
        print(f"  purse      : {p['purse']:,.0f}")
        print(f"  bank       : {p['bank']:,.0f}" + ("" if p["banking_present"] else "   (bank API off for this profile)"))
        print(f"  combined   : {p['combined']:,.0f}")

    best = max(profiles, key=lambda d: d["combined"])
    if best["profile_id"] != configured:
        print(f"\n-> Most coins are on '{best['cute_name']}' (profile_id {best['profile_id']}).")
        print("   Set that as \"profile_id\" in secrets.json if that's the account you trade on.")


if __name__ == "__main__":
    main()
