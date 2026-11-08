"""
One-off diagnostic: shows exactly what the Hypixel profile endpoint returns for
your purse and bank, so we can see why the combined spending power looks wrong.

Run on the machine that has secrets.json (the server):
    python optimizer/diagnose_purse.py

Prints the purse / bank split and whether the profile exposes a 'banking' object
at all. It never prints the API key. If banking_present is False, bank API access
is turned off in-game (SkyBlock menu -> Settings -> API Settings -> Banking) and
no code change can read the bank until that's enabled.
"""

from main import load_secrets
from api_client import get_purse_breakdown


def main():
    creds = load_secrets()
    missing = [k for k in ("hypixel_api_key", "profile_id", "player_uuid") if not creds.get(k)]
    if missing:
        print("Missing credentials in secrets.json / env:", ", ".join(missing))
        return
    try:
        b = get_purse_breakdown(creds["hypixel_api_key"], creds["profile_id"], creds["player_uuid"])
    except Exception as e:
        print("Request failed:", type(e).__name__, e)
        return

    if not b["member_found"]:
        print("Member (player_uuid) not found in this profile. Is profile_id the right profile,")
        print("and player_uuid your own uuid? (They were swapped once before.)")
        return

    print(f"  purse           : {b['purse']:,.0f}")
    print(f"  bank            : {b['bank']:,.0f}")
    print(f"  combined        : {b['combined']:,.0f}")
    print(f"  banking exposed : {b['banking_present']}")
    if not b["banking_present"]:
        print("\n-> No 'banking' object on the profile: bank API access is OFF in-game.")
        print("   Enable it: SkyBlock menu -> Settings -> API Settings -> Banking = ON,")
        print("   then rerun this. Until then the optimizer can only see your purse.")
    elif b["bank"] == 0:
        print("\n-> Banking is exposed but reads 0. Check this is the profile holding the 5.9b.")


if __name__ == "__main__":
    main()
