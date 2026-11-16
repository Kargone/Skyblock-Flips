// Constants shared by the trade tracker: which products to ignore, which chat
// messages are noise, and the patterns that pick trade messages apart.
// Plain data only. Nothing in here imports from the rest of the server.

// Products whose insta-buys and insta-sells are never tracked.
export const IGNORE_INSTA_SELL_BUY = [
    "Salt Cube",
    "Enchanted Cookie",
    "Enchanted Sand",
    "Necromancer's Brooch",
    "Red Scarf",
    "Coal",
    "Enchanted Potato",
    "Enchanted Baked Potato",
    "Superior Dragon Fragment",
    "Dwarven O's Ore Oats",
    "Enchanted Pumpkin",
    "Mana Vampire V",
    "Spirit Leap",
    "Soulflow",
    "Super Compactor 3000",
    "Strong Dragon Fragment",
    "Enchanted Hay Bale",
    "Unstable Dragon Fragment",
    "Young Dragon Fragment",
    "Rusty Coin",
    "Ethereal Vine",
    "Hot Potato Book",
    "Iron Ingot",
    "Red Mushroom",
    "Brown Mushroom",
    "Power VI",
    "Enchanted Carrot",
    "Enchanted Golden Carrot",
    "Enchanted Pumpkin",
    "Mutant Nether Wart",
    "Enchanted Brown Mushroom",
    "Titanic Experience Bottle",
    "Scorched Books",
    "Fuming Potato Book",
    "Enchanted Cactus",
    "Enchanted Cookie",
    "Enchanted Hay Bale",
    "Cocoa Beans",
    "Enchanted Melon",
    "Enchanted Dandelion",
    "Fermento",
    "Enchanted Baked Potato",
    "Enchatend Wild Rose",
    "Wild Rose",
    "? Fine Citrine Gemstone",
    "Toxic Arrow Poison",
    "Supreme Chocolate Bar",
    "Sharpness VI",
    "Coalroot",
    "Crimson Essence",
    "Enchanted Red Mushroom",
    "Celestial Mason Jar",
    "Mutated Blaze Ashes",
    "Raw Cod",
    "Superboom TNT",
    "Sugar Cane",
    "Sulphur",
    "Gold Ingot",
    "Dustgrain",
    "Ashwreath",
    "Enchanted Wild Rose",
    "Enchanted Raw Rabbit",
    "Enchanted Poppy",
    "Enchanted Brown Mushroom Block",
    "Tasty Cheese",
    "Enchanted Sugar Cane",
    "Enchanted Sugar",
];

export const IGNORE_INSTA_BUY = [
    "Polished Pumpkin",
    "Plant Matter",
];

export const IGNORE_INSTA_SELL = [
    "Enchanted Rotten Flesh",
    "Glacite Jewel",
    "Poisonous Potato",
];

export const ALLOW_INSTA_SELL_BUY = [];

export const DUMMY_TRADE_MESSAGES = [
    'Claiming order...',
    'Putting goods in escrow...',
    'Submitting sell offer...',
    'Cancelling order...',
    'Executing instant sell...',
    'Submitting buy order...',
    'You cancelled the trade!',
    'Executing instant buy...',
    'BIN Auction started for',
    'You canceled your auction for',
    'You don\'t have anything to sell!',
    'You claimed ',
    'Cancelled parkour!',
    '[Bazaar] Somehow, there was nothing to claim!',
    '[Bazaar] You reached the daily limit of coins you may create orders for on the Bazaar!',
    '[NPC] Jacob',
    '[Bazaar] You reached your maximum of 28 Bazaar orders!',
    "Couldn't parse that price!",
    'is lower than the old price of',
    'Escrow refunded',
    'You are overbidding too much!',
    'Allowd unit price: ',
    'You don\'t have enough inventory space to fit all of those items!',
    '[Bazaar] You don\'t have the space required to claim that!',
    '[Bazaar] You have goods to claim on this order!',
    '[Bazaar] No items could be matched to buyers!',
    '[Bazaar] Couldn\'t find'
];

// ---------------------------------------------------------------------------
// Trade message patterns
// ---------------------------------------------------------------------------
// One entry per chat message the tracker understands. ProcesTrade tries them
// top to bottom and the first match wins. TRADE_HANDLERS in backend.mjs then
// reads the named groups, (?<amount>...) and so on, and calls the matching
// method, so the group names here have to stay in step with that table.
//
// The examples are real messages from data/pastTradesLogs.json, as they look
// after formatTradeMessage has stripped the colour codes.
//
// An entry with `re: null` has not been written yet. ProcesTrade skips it, so
// that message type is reported as an invalid trade message until it is filled in.
//
// Check any change against the logs with:   node tools/testTradePatterns.js
export const TRADE_PATTERNS = [
    // [Bazaar] Bought 2,048x Enchanted Leather for 2,249,201 coins!
    // coins is the total paid, not the price per unit.
    {
        type: 'insta-buy',
        re: /\[Bazaar\] Bought (?<amount>[\d,]+)x (?<name>.+?) for (?<coins>[\d,.]+) coins/,
    },

    // [Bazaar] Sold 12x Enchanted Sea Lumies for 614,903 coins!
    // [Bazaar] Sold 1x Agarimoo Tongue for 4,874.7 coins!
    // [Bazaar] Sold 1x ? Fine Sapphire Gemstone for 26,406 coins!
    // coins is the total received, and can have a decimal.
    {
        type: 'insta-sell',
        re: /\[Bazaar\] Sold (?<amount>[\d,]+)x (?<name>.+?) for (?<coins>[\d,.]+) coins!/,
    },

    // [Bazaar] Buy Order Setup! 2,000x Enchanted Hay Bale for 299,834,800 coins.
    {
        type: 'buy-order-setup',
        re: /\[Bazaar\] Buy Order Setup! (?<amount>[\d,]+)x (?<name>.+?) for (?<coins>[\d,.]+) coins/,
    },

    // [Bazaar] Your Buy Order for 2,000x Enchanted Cactus was filled!
    {
        type: 'buy-order-fill',
        re: /\[Bazaar\] Your Buy Order for (?<amount>[\d,]+)x (?<name>.+?) was filled!/,
    },

    // [Bazaar] Claimed 2,240x Extremely Real Shuriken worth 101,695,328 coins bought for 45,400 each!
    // [Bazaar] Claimed 2,240x Agarimoo Tongue worth 10,917,984 coins bought for 4,874.1 each!
    // The handler reads amount, name and total_price. The price per unit is
    // total_price / amount (45,399.7 in the first example), because the "each"
    // price in chat is rounded. The price group is captured but not used.
    {
        type: 'buy-order-claim',
        re: /\[Bazaar\] Claimed (?<amount>[\d,]+)x (?<name>.+?) worth (?<total_price>[\d,.]+) coins bought for (?<price>[\d,.]+) each!/,
    },

    // [Bazaar] Cancelled! Refunded 17,653,990 coins from cancelling Buy Order!
    {
        type: 'buy-order-cancel',
        re: /\[Bazaar\] Cancelled! Refunded (?<coins>[\d,.]+) coins from cancelling Buy Order!/,
    },

    // [Bazaar] Sell Offer Setup! 2,240x Enchanted Eye of Ender for 26,277,451 coins.
    {
        type: 'sell-order-setup',
        re: /\[Bazaar\] Sell Offer Setup! (?<amount>[\d,]+)x (?<name>.+?) for (?<coins>[\d,.]+) coins/,
    },

    // [Bazaar] Your Sell Offer for 1,792x Agarimoo Tongue was filled!
    {
        type: 'sell-order-fill',
        re: /\[Bazaar\] Your Sell Offer for (?<amount>[\d,]+)x (?<name>.+?) was filled!/,
    },

    // [Bazaar] Claimed 110,225,462 coins from selling 1,799x Enchanted Sea Lumies at 61,889 each!
    // [Bazaar] Claimed 12,079,533 coins from selling 1,792x Agarimoo Tongue at 6,808.9 each!
    // This is the pattern you wrote, with names added to its four groups.
    // The handler reads amount, name and coins. The price per unit is worked out
    // from coins / amount with the bazaar tax undone, because the "each" price in
    // chat is rounded. The price group is captured but not used.
    {
        type: 'sell-order-claim',
        re: /^\[Bazaar\] Claimed (?<coins>[\d,.]+) coins from selling (?<amount>[\d,]+)x (?<name>.+?) at (?<price>[\d,.]+) each!/,
    },

    // [Bazaar] Cancelled! Refunded 302x Can of Worms from cancelling Sell Offer!
    {
        type: 'sell-order-cancel',
        re: /\[Bazaar\] Cancelled! Refunded (?<amount>[\d,]+)x (?<name>.+?) from cancelling Sell Offer!/,
    },

    // [Bazaar] Order Flipped! 4,000x Can of Worms for 29,905,200 coins of total expected profit.
    // The -? allows a negative profit. No logged message has one, so that part is a guess.
    {
        type: 'order-flipped',
        re: /\[Bazaar\] Order Flipped! (?<amount>[\d,]+)x (?<name>.+?) for (?<profit>-?[\d,.]+) coins of total expected profit/,
    },

    // You sold Enchanted Cactus x64 for 6,553,600 Coins!
    // You sold Dandelion x1 for 1 Coin!
    // coins is the total for the whole stack.
    {
        type: 'npc-sell',
        re: /You sold (?<name>.+?) x(?<amount>[\d,]+) for (?<coins>[\d,.]+) Coins?!/,
    },

    // You bought back Dirt x64 for 64 Coins!
    // NOT CHECKED AGAINST REAL DATA: the logs hold no buy-back message. This is
    // built from the one example in the old constructor comment.
    {
        type: 'npc-buy',
        re: /You bought back (?<name>.+?) x(?<amount>[\d,]+) for (?<coins>[\d,.]+) Coins?!/,
    },

    // [MVP+] Kargone created a BIN auction for Beastmaster Crest at 6,890,000 coins!
    {
        type: 'auction-creation',
        re: /created a BIN auction for (?<name>.+?) at (?<price>[\d,]+) coins!/,
    },

    // You collected 7,068,595 coins from selling Hunter Talisman to [VIP] TheLoSCH in an auction!
    // "[NPC] Jacob: You collected 1,934,743 items!" does not match, as intended.
    {
        type: 'auction-claim',
        re: /You collected (?<price>[\d,]+) coins from selling (?<name>.+?) to .+ in an auction!/,
    },

    // [MVP+] Kargone cancelled an auction for Hunter Talisman!
    {
        type: 'auction-cancel',
        re: /cancelled an auction for (?<name>.+?)!/,
    },

    // [Auction] xMiniX1 bought Red Claw Artifact for 8,679,998 coins CLICK
    {
        type: 'auction-sold',
        re: /\[Auction\] .+? bought (?<name>.+?) for (?<price>[\d,]+) coins/,
    },

    // You purchased Red Claw Egg for 594,012 coins!
    // Shop lines from other game modes ("You purchased Wood") do not match.
    {
        type: 'auction-bought',
        re: /You purchased (?<name>.+?) for (?<price>[\d,]+) coins!/,
    },

    // You claimed Beastmaster Crest back from your expired auction!
    {
        type: 'auction-expired',
        re: /You claimed (?<name>.+?) back from your expired auction!/,
    },

    // You Supercrafted Beastmaster Crest!
    {
        type: 'supercraft',
        re: /You Supercrafted (?<name>.+?)!/,
    },

    // xjk You removed 1x Enchanted Ancient Claw from your inventory!
    // NOT CHECKED AGAINST REAL DATA: the logs hold no such message. This is
    // built from the one example in the old constructor comment.
    {
        type: 'item-removed',
        re: /xjk You removed (?<amount>[\d,]+)x (?<name>.+?) from your inventory!/,
    },
];
