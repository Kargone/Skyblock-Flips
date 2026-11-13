import { EventEmitter } from 'events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHypixel, hypixelPaused } from './hypixel-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import product_list from './product-list.json' with { type: "json" };

function timestampPrefix() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `[${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
}

for (const method of ['log', 'error', 'warn', 'info']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
        if (typeof args[0] === 'string') {
            args[0] = `${timestampPrefix()} ${args[0]}`;
        } else {
            args.unshift(timestampPrefix());
        }
        original(...args);
    };
}

// Base transaction fee rates. When mayor Derpy is active (quadruples bazaar
// tax, and here also scales auction fees), just bump DERPY_TAX_MULTIPLIER -
// e.g. to 4 - and set it back to 1 once Derpy is no longer mayor.
export let BAZAAR_TAX_RATE = 0.01;
export let AUCTION_FEE_RATE_LOW = 0.01;   // auctions selling for <= 10M
export let AUCTION_FEE_RATE_MID = 0.02;   // auctions selling for > 10M
export let AUCTION_FEE_RATE_HIGH = 0.025; // auctions selling for > 100M
export let DERPY_TAX_MULTIPLIER = 1;

// Set by mayor.mjs from the live election data: 4 while Derpy's QUAD TAXES perk is
// active, 1 otherwise, so the multiplier no longer has to be changed by hand.
export function setDerpyTaxMultiplier(multiplier) {
    if (DERPY_TAX_MULTIPLIER !== multiplier) console.log(`Bazaar tax multiplier set to ${multiplier}`);
    DERPY_TAX_MULTIPLIER = multiplier;
}

function getBazaarTaxRate() {
    return BAZAAR_TAX_RATE * DERPY_TAX_MULTIPLIER;
}

function getAuctionFeeRate(price) {
    const baseRate = price > 100000000 ? AUCTION_FEE_RATE_HIGH
        : price > 10000000 ? AUCTION_FEE_RATE_MID
        : AUCTION_FEE_RATE_LOW;
    return baseRate * DERPY_TAX_MULTIPLIER;
}

function calcAuctionFee(price_not_sold) {
    return price_not_sold * getAuctionFeeRate(price_not_sold);
}

export const marketData = {
    bazaarProducts: {},
    lowestBinPrices: {},
    lastUpdated: {
        'bazaar': null,
        'auctions': null
    }
};

const IGNORE_INSTA_SELL_BUY = [
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

const IGNORE_INSTA_BUY = [
    "Polished Pumpkin",
    "Plant Matter",
];

const IGNORE_INSTA_SELL = [
    "Enchanted Rotten Flesh",
    "Glacite Jewel",
    "Poisonous Potato",
];

const ALLOW_INSTA_SELL_BUY = [];

const DUMMY_TRADE_MESSAGES = [
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
    '[Bazaar] Couldn\'t find',
    '[Bazaar] There was an error claiming that order!',
    '[Bazaar] Please try again later!'
];

// Load trader_data manually so we can modify and write it back
const traderDataPath = path.join(__dirname, '..', 'data', 'trader-data.json');
let trader_data;

try {
    const data = fs.readFileSync(traderDataPath, 'utf8');
    trader_data = JSON.parse(data);
} catch (err) {
    // Do NOT fall back to an empty trader_data object here: the update loop
    // autosaves trader_data back to disk, so a silent empty fallback gets
    // written over the real file the next time it runs. Fail loudly instead
    // so a corrupted/missing file gets noticed and restored before that happens.
    console.error('FATAL: could not load trader-data.json, refusing to start with empty data:', err);
    throw err;
}

// The dashboard and the mod read trader data from memory through /api/trader-data,
// so a trade shows up as soon as it is processed rather than on the next save.
export function getTraderData() {
    return trader_data;
}

// Saves run one at a time since they share the temp file; a save asked for while
// one is running is done once it finishes, with whatever trader_data is by then.
let traderDataSaving = false;
let traderDataSaveQueued = false;

export function saveTraderData() {
    if (traderDataSaving) {
        traderDataSaveQueued = true;
        return;
    }
    traderDataSaving = true;

    // Atomic write: write to temp file first, then rename to avoid corruption on read
    const tempPath = traderDataPath + '.tmp';
    const backupPath = traderDataPath + '.backup.json';
    const done = function () {
        traderDataSaving = false;
        if (traderDataSaveQueued) {
            traderDataSaveQueued = false;
            saveTraderData();
        }
    };

    // Snapshot the last-known-good file before overwriting it, so a bad
    // save (or a crash/sleep leaving trader_data in a bad in-memory state)
    // can be recovered from without falling back to git history.
    fs.copyFile(traderDataPath, backupPath, function (copyErr) {
        if (copyErr) console.error('Error backing up trader data file:', copyErr);

        fs.writeFile(
            tempPath,
            JSON.stringify(trader_data, null, 2),
            function (err) {
                if (err) {
                    console.error('Error writing temp trader data file:', err);
                    done();
                    return;
                }
                // Atomic rename - replaces the original file
                fs.rename(tempPath, traderDataPath, function (renameErr) {
                    if (renameErr) {
                        console.error('Error renaming temp file');
                    }
                    done();
                });
            }
        );
    });
}

// Append-only log of order placements/progress/outcomes, used to train a model
// that predicts how much of an order will actually fill. Kept as JSONL (one JSON
// object per line) rather than a single growing JSON array so appending never
// requires reading/rewriting the whole file.
const tradeLogPath = path.join(__dirname, '..', 'data', 'trade-outcomes.jsonl');

function appendTradeLog(record) {
    fs.appendFile(tradeLogPath, JSON.stringify(record) + '\n', function (err) {
        if (err) console.error('Error appending to trade log:', err);
    });
}

function makeOrderId(orderType, name, placeTime) {
    return `${orderType}:${name}:${placeTime}`;
}

// Logged once when an order is placed: the order itself plus a snapshot of the
// market conditions (relevant side only - buy-side stats for a buy order, sell-side
// for a sell order) at that exact moment, so it can later be joined against the
// order's eventual outcome to train a fill-prediction model.
function logPlacedOrder(orderType, name, placeTime, orderAmount, orderPrice, currentHoldingAmount) {
    const apiName = product_list[name]?.["api-name"];
    const quickStatus = (apiName && bazaar_data[apiName]?.["quick_status"]) || {};
    const stats = (apiName && getVolumeStats()[apiName]) || {};
    const isBuy = orderType === "buy";

    appendTradeLog({
        event: "placed",
        order_id: makeOrderId(orderType, name, placeTime),
        order_type: orderType,
        item_name: name,
        place_time: placeTime,
        order_amount: orderAmount,
        order_price: orderPrice,
        current_buy_price: quickStatus.buyPrice ?? null,
        current_sell_price: quickStatus.sellPrice ?? null,
        volume_7_day: isBuy ? (quickStatus.buyMovingWeek ?? null) : (quickStatus.sellMovingWeek ?? null),
        volume_24_hour: isBuy
            ? (stats.buyVolumePerHour24h != null ? stats.buyVolumePerHour24h * 24 : null)
            : (stats.sellVolumePerHour24h != null ? stats.sellVolumePerHour24h * 24 : null),
        past_quantity_per_hour: isBuy ? (stats.buyVolumePerHour1h ?? null) : (stats.sellVolumePerHour1h ?? null),
        new_listings_per_hour: isBuy ? (stats.newBuyListingsPerHour ?? null) : (stats.newSellListingsPerHour ?? null),
        current_holding_amount: currentHoldingAmount ?? 0
    });
}

// Logged whenever UpdateOrderFillAmounts actually changes an open order's filled
// amount (not every poll tick - only on an actual change), giving a fill trajectory
// over time rather than a single before/after snapshot.
function logOrderProgress(orderType, name, placeTime, filledAmountSoFar) {
    appendTradeLog({
        event: "progress",
        order_id: makeOrderId(orderType, name, placeTime),
        timestamp: Date.now(),
        filled_amount_so_far: filledAmountSoFar
    });
}

// Logged once an order is done - either fully filled or cancelled beforehand.
function logResolvedOrder(orderType, name, placeTime, outcome, filledAmount) {
    const resolveTime = Date.now();
    appendTradeLog({
        event: "resolved",
        order_id: makeOrderId(orderType, name, placeTime),
        resolve_time: resolveTime,
        outcome: outcome,
        filled_amount: filledAmount,
        time_to_resolve_ms: resolveTime - placeTime
    });
}

class Main extends EventEmitter {
    constructor() {
        super();
        this.lastTradeTime = null;
        this.listenForTrades();
    }
    listenForTrades() {
        // Listen for 'tradeMessage' events and process them
        this.on('tradeMessage', (tradeMessage) => {
            // A trade that throws partway (a craft missing its third material, say)
            // has already changed trader_data, so it is put back as it was before the
            // trade rather than left half done.
            const before = structuredClone(trader_data);
            try {
                // The mod's forge snapshots are not chat messages; see processForgeSnapshot.
                const parsed = JSON.parse(tradeMessage);
                if (parsed?.type === 'forge-snapshot') {
                    const result = processForgeSnapshot(parsed);
                    if (result !== FORGE_SNAPSHOT_UNCHANGED) {
                        console.log(result);
                        saveTraderData();
                    }
                    return;
                }

                const trade = new ProcesTrade(tradeMessage);
                // console.log(`Successfully processed trade: ${tradeMessage}`);
                saveTraderData();
            } catch (error) {
                trader_data = before;
                consoleWarn(`Error processing trade message, nothing was changed: ${error}`);
            }
        });
        console.log('Trade listener initialized');
    }
    // Public method for HTTP server or other sources to submit trade messages
    submitTrade(tradeMessage) {
        // A forge snapshot is sent whenever the forge menu changes, which is not a trade.
        if (!tradeMessage.includes('"forge-snapshot"')) this.lastTradeTime = Date.now();
        this.emit('tradeMessage', tradeMessage);
    }
}

// finds the index of a substring in a string
// then returns the end of the substring within the string
// instead of the start of the substring
function findEnd(string, substring) {
    return string.indexOf(substring) + substring.length;
}

// copys a value to prevent linkage of objects
function copy(value) {
    return JSON.parse(JSON.stringify(value));
}

// returns the investment type where the product will be stored in trader data
function getInvestmentType(product_list_type) {
    if (product_list_type === "long-term-investment") {
        return "long-term-investments";
    } else if (product_list_type === "auction-product") {
        return "long-term-investments";
    } else if (product_list_type === "forge-product") {
        return "long-term-investments";
    } else if (product_list_type === "short-term-investment") {
        return "short-term-investments";
    } else if (product_list_type === "crafting-material") {
        return "long-term-investments";
    } else {
        throw "ERROR: Invalid Investment Type";
    }
}

// Create a function such that whatever utc time code is inputed
// it returns a date code such that it is the same day but 12:00 am
function morningTime(time_code) {
    const now = new Date(time_code);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function formatTradeMessage(trade_message) {
    trade_message = trade_message.split('�');
    for (const stringIndex in trade_message) {
        if (stringIndex == 0) continue;
        trade_message[stringIndex] = trade_message[stringIndex].slice(1);
    }
    return trade_message.join('');
}

// create a function that uses math.round, but for the case of 0.5, it rounds down instead of up
function roundDown(value) {
    const roundedValue = Math.round(value);
    if (Math.abs(value - roundedValue) === 0.5) {
        return Math.floor(value);
    } else {
        return roundedValue;
    }
}

//create a function that will replace console.error. this time you can actually have the yellow color 
function consoleError(message) {
    console.error('\x1b[33m%s\x1b[0m', message);
}

//create a function that will replace console.warn. this time you can actually have the red color
function consoleWarn(message) {
    console.warn('\x1b[31m%s\x1b[0m', message);
}

class Sort {
    constructor(object, increasing = true, key1, key2 = '') {
        if (key2 === '') {
            return object.sort(this.compareFn1(key1, increasing));
        } else {
            return object.sort(this.compareFn2(key1, key2, increasing));
        }
    }
    compareFn1(key1, increasing) {
        if (increasing) {
            return function (a, b) {
                if (a[key1] < b[key1]) {
                    return -1;
                } else if (a[key1] > b[key1]) {
                    return 1;
                }
                return 0;
            }
        } else {
            return function (a, b) {
                if (a[key1] < b[key1]) {
                    return 1;
                } else if (a[key1] > b[key1]) {
                    return -1;
                }
                return 0;
            }
        }
    }
    compareFn2(key1, key2, increasing) {
        if (increasing) {
            return function (a, b) {
                if (a[key1][key2] < b[key1][key2]) {
                    return -1;
                } else if (a[key1][key2] > b[key1][key2]) {
                    return 1;
                }
                return 0;
            }
        } else {
            return function (a, b) {
                if (a[key1][key2] < b[key1][key2]) {
                    return 1;
                } else if (a[key1][key2] > b[key1][key2]) {
                    return -1;
                }
                return 0;
            }
        }
    }
}

class ProcesTrade {
    constructor(tradeJSON) {
        // convert tradeJSON from string to object
        const tradeObject = JSON.parse(tradeJSON);
        const trade_message = formatTradeMessage(tradeObject[0]?.plainText || tradeObject.plainText);
        // console.log("Processing trade message: ", trade_message);

        const detectedRarity = tradeObject.detectedRarity;

        this.message = trade_message;
        this.messageArray = this.message.split('');
        // console.log("Processing trade message: ", this.message);

        let result = '';

        // determine message type
        if (this.message.includes('Guild >')) {
            result = 'Nontrade message';
            return "Nontrade message: " + this.message;
        } else if (this.message.includes('[Bazaar] Bought')) {
            this.type = "insta-buy";
            const amountStringStart = findEnd(this.message, 'Bought ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'for ');
            const priceStringEnd = this.message.indexOf(' coins');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' for');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const pricePerUnit = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', '')) / amount;
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.instaBuy(amount, pricePerUnit, nameString, Date.now(), true);
        } else if (this.message.includes('[Bazaar] Sold')) {
            this.type = "insta-sell";
            const amountStringStart = findEnd(this.message, 'Sold ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'for ');
            const priceStringEnd = this.message.indexOf(' coins');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' for');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const pricePerUnit = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', '')) / amount;
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.instaSell(amount, pricePerUnit, nameString, true, true);
        } else if (this.message.includes('[Bazaar] Buy Order Setup!')) {
            this.type = "buy-order-setup";
            const amountStringStart = findEnd(this.message, 'Setup! ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'for ');
            const priceStringEnd = this.message.indexOf(' coins');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' for');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const totalPrice = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.buyOrderSetup(amount, totalPrice / amount, nameString);
        } else if (this.message.includes('[Bazaar] Your Buy Order for')) {
            this.type = "buy-order-fill";
            const amountStringStart = findEnd(this.message, 'for ');
            const amountStringEnd = this.message.indexOf('x');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' was');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.buyOrderFill(amount, nameString);
        } else if (this.message.includes('[Bazaar] Claimed') &&
            this.message.includes('bought for')) {
            this.type = "buy-order-claim";
            const amountStringStart = findEnd(this.message, 'Claimed ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'bought for ');
            const priceStringEnd = this.message.indexOf(' each!');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' worth');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const pricePerUnit = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.buyOrderClaim(amount, pricePerUnit, nameString);
        } else if (this.message.includes('[Bazaar] Cancelled!') &&
            this.message.includes('Buy Order!')) {
            this.type = "buy-order-cancel";
            const amountStringStart = findEnd(this.message, 'Refunded ');
            const amountStringEnd = this.message.indexOf(' coins');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            result = this.buyOrderCancel(amount);
        } else if (this.message.includes('[Bazaar] Sell Offer Setup!')) {
            this.type = "sell-order-setup";
            const amountStringStart = findEnd(this.message, 'Setup! ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'for ');
            const priceStringEnd = this.message.indexOf(' coins')
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' for');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const totalPrice = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.sellOrderSetup(amount, Math.round(totalPrice / amount / (1 - getBazaarTaxRate()) * 10) / 10, nameString);
        } else if (this.message.includes('[Bazaar] Your Sell Offer for')) {
            this.type = "sell-order-fill";
            const amountStringStart = findEnd(this.message, 'for ');
            const amountStringEnd = this.message.indexOf('x');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' was');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.sellOrderFill(amount, nameString);
        } else if (this.message.includes('[Bazaar] Claimed') &&
            this.message.includes('from selling')) {
            this.type = "sell-order-claim";
            const coinsEarnedStart = findEnd(this.message, 'Claimed ');
            const coinsEarnedEnd = this.message.indexOf(' coins from selling');
            const amountStringStart = findEnd(this.message, 'selling ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, ' at ');
            const priceStringEnd = this.message.indexOf(' each!')
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' at ');
            const coinsEarned = parseFloat(this.message.slice(coinsEarnedStart, coinsEarnedEnd).replaceAll(',', ''));
            const hasDecimal = this.message.slice(priceStringStart, priceStringEnd).includes('.');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const pricePerUnit = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.sellOrderClaim(amount, pricePerUnit, nameString, coinsEarned, hasDecimal);
        } else if (this.message.includes('[Bazaar] Cancelled!') &&
            this.message.includes('Sell Offer!')) {
            this.type = "sell-order-cancel";
            const amountStringStart = findEnd(this.message, 'Refunded ');
            const amountStringEnd = this.message.indexOf('x ');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' from ');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.sellOrderCancel(amount, nameString);
        } else if (this.message.includes('[Bazaar] Order Flipped!')) {
            this.type = "order-flipped";
            const amountStringStart = findEnd(this.message, 'Flipped! ');
            const amountStringEnd = this.message.indexOf('x ');
            const profitStringStart = findEnd(this.message, 'for ');
            const profitStringEnd = this.message.indexOf(' coins')
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' for ');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const profitString = parseFloat(this.message.slice(profitStringStart, profitStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.orderFlipped(amount, nameString, profitString);
        } else if (this.message.includes('You sold')) {
            this.type = "npc-sell";
            const amountStringStart = findEnd(this.message, ' x');
            const amountStringEnd = this.message.indexOf(' for');
            const priceStringStart = findEnd(this.message, ' for ');
            const priceStringEnd = this.message.indexOf(' Coins!')
            const nameStringStart = findEnd(this.message, 'sold ');
            const nameStringEnd = this.message.indexOf(' x');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const totalPrice = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.npcSell(amount, totalPrice / amount, nameString);
        } else if (this.message.includes('You bought back')) {
            // You bought back Dirt x64 for 64 Coins!
            this.type = "npc-buy";
            const amountStringStart = findEnd(this.message, ' x');
            const amountStringEnd = this.message.indexOf(' for');
            const priceStringStart = findEnd(this.message, ' for ');
            const priceStringEnd = this.message.indexOf(' Coins!')
            const nameStringStart = findEnd(this.message, 'bought back ');
            const nameStringEnd = this.message.indexOf(' x');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const totalPrice = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.npcBuyBack(amount, totalPrice / amount, nameString);
        } else if (this.message.includes('created a BIN auction for')) {
            this.type = "auction-creation";
            // edge case: [MVP+] Kargone created a BIN auction for Bat Person Ring at 9,490,000 coins!
            const priceStringStart = findEnd(this.message, ' at ');
            const priceStringEnd = this.message.indexOf(' coins!')
            const nameStringStart = findEnd(this.message, 'auction for ');
            const nameStringEnd = this.message.indexOf(' at ');
            const pricePerUnit = parseInt(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.auctionCreation(pricePerUnit, nameString, detectedRarity);
        } else if (this.message.includes('You collected') && !this.message.includes('[NPC] Jacob')) {
            this.type = "auction-claim";
            const priceStringStart = findEnd(this.message, 'collected ');
            const priceStringEnd = this.message.indexOf(' coins ')
            const nameStringStart = findEnd(this.message, 'selling ');
            const nameStringEnd = this.message.indexOf(' to ');
            const pricePerUnit = parseInt(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.auctionClaim(pricePerUnit, nameString, detectedRarity);
        } else if (this.message.includes('cancelled an auction for')) {
            this.type = "auction-cancel";
            const nameStringStart = findEnd(this.message, 'for ');
            const nameStringEnd = this.message.indexOf('!');
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.auctionCancel(nameString, detectedRarity);
        } else if (this.message.includes('[Auction]')) {
            this.type = "auction-sold";
            const priceStringStart = findEnd(this.message, ' for ');
            const priceStringEnd = this.message.indexOf(' coins ')
            const nameStringStart = findEnd(this.message, ' bought ');
            const nameStringEnd = this.message.indexOf(' for ');
            const pricePerUnit = parseInt(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.auctionSold(pricePerUnit, nameString, detectedRarity);
        } else if (this.message.includes('You purchased')) {
            this.type = "auction-bought";
            const priceStringStart = findEnd(this.message, ' for ');
            const priceStringEnd = this.message.indexOf('!')
            const nameStringStart = findEnd(this.message, 'You purchased ');
            const nameStringEnd = this.message.indexOf(' for ');
            const pricePerUnit = parseInt(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.auctionBought(pricePerUnit, nameString, detectedRarity);
        } else if (this.message.includes('back from your expired auction!')) {
            this.type = "auction-expired";
            // Example: "You claimed Bait Ring back from your expired auction!"
            const nameStringStart = findEnd(this.message, 'You claimed ');
            const nameStringEnd = this.message.indexOf(' back from your expired auction!');
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.auctionExpired(nameString, detectedRarity);
        } else if (this.message.includes('You Supercrafted')) {
            this.type = "supercraft";
            // console.log("here");
            const nameStringStart = findEnd(this.message, 'Supercrafted ');
            const nameStringEnd = this.message.indexOf('!');
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.supercraft(nameString, detectedRarity);
        } else if (this.message.includes("xjk You removed")) {
            // "xjk You removed 1x Enchanted Ancient Claw from your inventory!"
            this.type = "item-removed";
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' from your inventory!');
            const amountStringStart = findEnd(this.message, 'removed ');
            const amountStringEnd = this.message.indexOf('x ');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            result = this.itemRemoved(nameString, amount, detectedRarity);
        } else if (DUMMY_TRADE_MESSAGES.some(dummyMessage => this.message.includes(dummyMessage))) {
            result = 'Nontrade message';
            return "Nontrade message: " + this.message;
        } else {
            return consoleError('ERROR: Invalid trade message: ' + this.message);
        }

        if (result.includes('ERROR')) {
            return consoleError(result + ' for trade message: ' + this.message);
        } else {
            console.log('SUCCESS: ' + this.message + ' Result: ' + result);
        }

        return 'Completed trade mesage';
    }
    trackProduct(name, transactionType) {
        // do the console.log, and return true or false if the product supposed to be tracked or not, based on the ignore lists and if the product is in a crafting recipe or has any buy or sell orders
        if (ALLOW_INSTA_SELL_BUY.includes(name)) {
            // console.log('Tracking product: ' + name + ' for transaction type: ' + transactionType);
            return true;
        }

        // Forged stock has no order history, but its sale still has to be counted.
        if (hasForgeStock(name)) return true;

        // first check if the product is in the ignore lists
        if (IGNORE_INSTA_SELL_BUY.includes(name)) {
            // consoleError('ERROR: Product is in ignore list: ' + name);
            return false;
        }
        if (IGNORE_INSTA_BUY.includes(name) && transactionType === 'buy') {
            // consoleError('ERROR: Product is in ignore list: ' + name);
            return false;
        }
        if (IGNORE_INSTA_SELL.includes(name) && transactionType === 'sell') {
            // consoleError('ERROR: Product is in ignore list: ' + name);
            return false;
        }

        // then check if the order has any buy or sell orders, if not then return, unless its in a crafting recipe, then we can track it anyway
        if (Object.keys(trader_data["all-products"]).indexOf(name) === -1 && !this.isItemInCraftingRecipe(name)) {
            // consoleError('ERROR: Product is not in a crafting recipe and not found in trader data: ' + name);
            return false;
        }

        if (trader_data["all-products"][name] && trader_data["all-products"][name]["buy-order-stats"]["total-buy-orders-created"] === 0 &&
            trader_data["all-products"][name]["sell-order-stats"]["total-sell-orders-created"] === 0 &&
            !this.isItemInCraftingRecipe(name)) {
            consoleError('ERROR: Product is not in a crafting recipe and has no buy or sell orders: ' + name);
            return false;
        }

        // console.log('Tracking product: ' + name + ' for transaction type: ' + transactionType);
        return true;
    }
    isItemInCraftingRecipe(name) {
        const productNames = Object.keys(product_list);
        for (const productName of productNames) {
            if (product_list[productName]["crafting-materials"] && Object.keys(product_list[productName]["crafting-materials"]).includes(name)) {
                // console.log('Product is in a crafting recipe: ' + name + ' is used to craft ' + productName);
                return true;
            }
        }
        return false;
    }
    instaBuy(amount, price, name, time_bought = Date.now(), ignoreListEnabled = false) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        if (ignoreListEnabled && this.trackProduct(name, 'buy') === false) return 'Rejected: Product not tracked for buy transactions.';

        // get the investment type but add "s" to format for trader_data
        const invesmentType = getInvestmentType(product_list[name]["type"]);

        // look for any invesments that might already be the same name
        if (Object.keys(trader_data[invesmentType]).indexOf(name) != -1) {
            let found = false;

            // append a new order to suborders
            for (const subOrderIndex of Object.keys(trader_data[invesmentType][name]["sub-orders"])) {
                if (trader_data[invesmentType][name]["sub-orders"][subOrderIndex]["price-bought"] === price &&
                    trader_data[invesmentType][name]["sub-orders"][subOrderIndex]["time-bought"] === time_bought) {
                    trader_data[invesmentType][name]["sub-orders"][subOrderIndex]["partial-amount"] += amount; //*
                    found = true;
                    break;
                }
            }

            if (!found) {
                trader_data[invesmentType][name]["sub-orders"].push({
                    "partial-amount": amount,
                    "price-bought": price,
                    "time-bought": time_bought
                });
            }
        } else {
            // create a new order
            trader_data[invesmentType][name] = {
                "type": product_list[name]["type"],
                "sub-orders": [
                    {
                        "partial-amount": amount,
                        "price-bought": price,
                        "time-bought": time_bought
                    }
                ]
            }
        }

        // add the amount to current amount
        if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
            trader_data["all-products"][name] = {
                "current-amount": amount,
                "buy-order-stats": {
                    "total-buy-orders-created": 0,
                    "total-buy-amount-claimed": 0,
                    "total-buy-amount-placed-for-buying": 0,
                    "buy-average": 0
                },
                "sell-order-stats": {
                    "total-sell-orders-created": 0,
                    "total-sell-amount-claimed": 0,
                    "total-sell-amount-placed-for-selling": 0,
                    "sell-average": 0
                },
                "max-amount": 2000,
                "total-profit-made": 0,
                "total-sold": 0,
                "crafting-materials": "none"
            };
        } else {
            trader_data["all-products"][name]["current-amount"] += amount;
        }

        return 'Instabuy completed';
    }
    instaSell(amount, price, name, doBazaarFees = true, ignoreListEnabled = false) {
        if (Object.keys(product_list).indexOf(name + " (forge)") != -1) {
            // console.log(`Supercrafting ${name} requires a forge, so supercrafting ${name} (forge) instead`);
            name = name + " (forge)";
        }


        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        if (ignoreListEnabled && this.trackProduct(name, 'buy') === false) return 'Rejected: Product not tracked for sell transactions.';

        const invesmentType = getInvestmentType(product_list[name]["type"]);

        // look for any invesments that might already be the same name
        if (Object.keys(trader_data[invesmentType]).indexOf(name) != -1) {
            // adjust the amounts to reflect the sel
            let suborders = trader_data[invesmentType][name]["sub-orders"];

            trader_data[invesmentType][name]["sub-orders"] = new Sort(trader_data[invesmentType][name]["sub-orders"], false, "price-bought");

            while (suborders.length > 0) {
                const subOrder = suborders[0];

                if (amount === 0) return "Insta sell completed";

                // go through each suborder
                if (subOrder["partial-amount"] > amount) {
                    // then just subtract from the current suborder
                    trader_data[invesmentType][name]["sub-orders"][0]["partial-amount"] -= amount;

                    // calculate the profit from the sell order
                    const date_bought = subOrder["time-bought"];

                    trader_data["all-products"][name]["current-amount"] -= amount;
                    return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees, profitTypeOf(subOrder, 'bazaar')) + " & Insta sell completed";
                } else {
                    // determine if the last suborder is bought out
                    if (trader_data[invesmentType][name]["sub-orders"].length <= 1) {
                        amount -= subOrder["partial-amount"];

                        if (amount > 0) throw new Error('ERROR: More instasold then found in investments');

                        // remove the whole order
                        delete trader_data[invesmentType][name];

                        // calculate the profit from the sell order
                        const date_bought = subOrder["time-bought"];

                        trader_data["all-products"][name]["current-amount"] -= subOrder["partial-amount"];
                        return this.addProfit(subOrder["partial-amount"], name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees, profitTypeOf(subOrder, 'bazaar')) + " & Insta sell completed";
                    } else {
                        amount -= subOrder["partial-amount"];

                        // just remove the suborder
                        trader_data[invesmentType][name]["sub-orders"].splice(0, 1);

                        // calculate the profit for just this sell order
                        const date_bought = subOrder["time-bought"];

                        trader_data["all-products"][name]["current-amount"] -= subOrder["partial-amount"];
                        this.addProfit(subOrder["partial-amount"], name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees, profitTypeOf(subOrder, 'bazaar'));
                    }
                }
            }
            throw new Error('ERROR: More insta selling that in investments');
        } else {
            throw new Error('ERROR: No investment found for insta sell');
        }
    }
    addProfit(amount, name, buy_price, sell_price, date_bought, date_sold, doFees, type = 'bazaar') {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        const now = new Date();
        const dateOfTransaction = morningTime(now.getTime()).toString();

        // calculate the current profit
        let profitPerUnit;
        // Auction sales pass doFees false and fold the auction fee into buy_price, so
        // this is bazaar tax on bazaar sales of anything, forged items included.
        if (doFees && type !== 'auction-house') {
            const bazaarFeesPerUnit = sell_price * getBazaarTaxRate();
            profitPerUnit = (sell_price - buy_price) - bazaarFeesPerUnit;
        } else {
            profitPerUnit = (sell_price - buy_price);
        }
        const profit = amount * profitPerUnit;

        // add the profit to the daily profits stuff
        if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
            trader_data["all-products"][name] = {
                "current-amount": 0,
                "buy-order-stats": {
                    "total-buy-orders-created": 1,
                    "total-buy-amount-claimed": 0,
                    "total-buy-amount-placed-for-buying": 0,
                    "buy-average": 0
                },
                "sell-order-stats": {
                    "total-sell-orders-created": 0,
                    "total-sell-amount-claimed": 0,
                    "total-sell-amount-placed-for-selling": 0,
                    "sell-average": 0
                },
                "max-amount": 2000,
                "total-profit-made": 0,
                "total-sold": 0,
                "crafting-materials": "none"
            };
        }

        trader_data["all-products"][name]["total-profit-made"] += profit;
        trader_data["all-products"][name]["total-sold"] += amount;

        if (Object.keys(trader_data["daily-profits"]).indexOf(dateOfTransaction) === -1) {
            trader_data["daily-profits"][dateOfTransaction] = {
                "daily-profit": 0,
                "forge-profit": 0,
                "auction-house-profit": 0,
                "bazaar-profit": 0,
                "trades": []
            };
        }

        trader_data["daily-profits"][dateOfTransaction]["daily-profit"] += profit;
        trader_data["daily-profits"][dateOfTransaction][`${type}-profit`] += profit;

        // update the trades for today
        for (const tradeIndex of Object.keys(trader_data["daily-profits"][dateOfTransaction]["trades"])) {
            const trade = trader_data["daily-profits"][dateOfTransaction]["trades"][tradeIndex];
            if (trade["item-name"] === name &&
                trade["buy-price"] === buy_price &&
                trade["sell-price"] === sell_price) {
                // update a trade that already exists
                trader_data["daily-profits"][dateOfTransaction]["trades"][tradeIndex]["count"] += amount;
                const current_amount = trader_data["daily-profits"][dateOfTransaction]["trades"][tradeIndex]["count"];
                trader_data["daily-profits"][dateOfTransaction]["trades"][tradeIndex]["total-profit"] = current_amount * profitPerUnit;

                return 'Addprofit completed';
            }
        }

        // add a new trade since no if statments in for loop triggered
        trader_data["daily-profits"][dateOfTransaction]["trades"].push({
            "item-name": name,
            "count": amount,
            "buy-price": buy_price,
            "sell-price": sell_price,
            "profit-per-unit": profitPerUnit,
            "total-profit": profit,
            "date-bought": date_bought,
            "date-sold": date_sold
        });

        return 'Addprofit completed';
    }
    buyOrderSetup(amount, price, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the hypixel api name and the current sell order price
        const apiName = product_list[name]["api-name"];
        const currentResellPrice = Math.round(bazaar_data[apiName]["quick_status"]["buyPrice"] * 10) / 10;
        const bazaarFees = currentResellPrice * getBazaarTaxRate() * amount;
        const placeTime = Date.now();

        // add the buy order
        trader_data['buy-order-overview']['buy-orders'].push({
            "item-name": name,
            "bought-amount": 0,
            "buying-amount": amount,
            "price-buying": price,
            "projected-profit": Math.round((currentResellPrice - price) * amount - bazaarFees),
            "has-been-claimed": false,
            "has-been-filled": false,
            "buy-order-place-time": placeTime,
            // cumulative amount ever claimed off this order across all partial claims -
            // unlike "bought-amount" (which resets to 0 on every partial claim), this
            // never resets, so the true lifetime fill total can be logged on resolution.
            "total-amount-claimed": 0
        });

        logPlacedOrder("buy", name, placeTime, amount, price, trader_data["all-products"][name]?.["current-amount"]);

        return 'Buy order setup completed';
    }
    buyOrderFill(amount, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the current buy orders
        const buyOrders = trader_data['buy-order-overview']['buy-orders'];

        // The fill message only gives us item name + remaining amount, not a unique
        // order id, so multiple open orders for the same item can share both (e.g.
        // two orders that started at 2240 and were each independently partially
        // claimed down to the same remaining amount). Pick the oldest still-open
        // match (FIFO) instead of whichever the array happens to iterate to first -
        // the array's order isn't reliably chronological since other flows re-sort it.
        let buyOrderIndex = -1;
        for (let index = 0; index < buyOrders.length; index++) {
            const candidate = buyOrders[index];
            if (candidate["item-name"] === name &&
                candidate["buying-amount"] === amount &&
                !candidate["has-been-filled"] &&
                (buyOrderIndex === -1 || candidate["buy-order-place-time"] < buyOrders[buyOrderIndex]["buy-order-place-time"])) {
                buyOrderIndex = index;
            }
        }
        if (buyOrderIndex !== -1) {
            const buyOrder = buyOrders[buyOrderIndex];
            // alter the bought and buying amounts to reflect that the order has filled
            trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["has-been-filled"] = true;
            trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["bought-amount"] =
                copy(trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["buying-amount"]);

            // "amount" here is just this final unclaimed chunk - add back whatever was
            // already claimed earlier in the order's life so filled_amount reflects the
            // true lifetime total, comparable against order_amount from the placed event.
            logResolvedOrder("buy", name, buyOrder["buy-order-place-time"], "filled", (buyOrder["total-amount-claimed"] || 0) + amount);

            return 'Buy order filling completed';
        }

        throw new Error('ERROR: Failed to fill a buy order');
    }
    buyOrderClaim(amount, price, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the current buy orders
        const buyOrders = trader_data['buy-order-overview']['buy-orders'];

        // find a current buy order that matches the name and buying price as an order already placed
        for (let buyOrderIndex = 0; buyOrderIndex < buyOrders.length; buyOrderIndex++) {
            const buyOrder = buyOrders[buyOrderIndex];
            if (buyOrder["item-name"] === name && (Math.ceil(buyOrder["price-buying"]) === price || buyOrder["price-buying"] === price || Math.floor(buyOrder["price-buying"]) === price)) {
                trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["has-been-claimed"] = true;
                trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["total-amount-claimed"] =
                    (buyOrder["total-amount-claimed"] || 0) + amount;

                // add the products claimed to the investments
                this.instaBuy(amount, price, name, buyOrder["buy-order-place-time"]);

                // if the buy order was filled
                if (buyOrder["buying-amount"] === amount) {
                    // then remove it
                    trader_data['buy-order-overview']['buy-orders'].splice(buyOrderIndex, 1);
                } else {
                    // alter the buying and bought amounts
                    trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["bought-amount"] = 0;
                    trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["buying-amount"] -= amount;
                }

                // add the buy order claim amounts
                if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
                    trader_data["all-products"][name] = {
                        "current-amount": 0, // will be added to in instaBuy
                        "buy-order-stats": {
                            "total-buy-orders-created": 1,
                            "total-buy-amount-claimed": 0,
                            "total-buy-amount-placed-for-buying": 0,
                            "buy-average": 0
                        },
                        "sell-order-stats": {
                            "total-sell-orders-created": 0,
                            "total-sell-amount-claimed": 0,
                            "total-sell-amount-placed-for-selling": 0,
                            "sell-average": 0
                        },
                        "max-amount": 2000,
                        "total-profit-made": 0,
                        "total-sold": 0,
                        "crafting-materials": "none"
                    };
                } else {
                    if (amount != 2240) trader_data["all-products"][name]["buy-order-stats"]["total-buy-orders-created"] += 1;
                    trader_data["all-products"][name]["buy-order-stats"]["total-buy-amount-claimed"] += amount;
                    trader_data["all-products"][name]["buy-order-stats"]["total-buy-amount-placed-for-buying"] += buyOrder["buying-amount"] + amount;
                    trader_data["all-products"][name]["buy-order-stats"]["buy-average"] =
                        trader_data["all-products"][name]["buy-order-stats"]["total-buy-amount-claimed"] /
                        trader_data["all-products"][name]["buy-order-stats"]["total-buy-orders-created"];
                }

                return 'Buy order claiming completed';
            }
        }

        throw new Error('ERROR: Failed to claim a buy order');
    }
    buyOrderCancel(dollars) {
        // this one's a little more sketchy bc it depends on the bought-amout being accurate

        // get the current buy orders
        let buyOrders = trader_data['buy-order-overview']['buy-orders'];

        // Debug, arachan's fang came through here. none was bought but it showed 64 on buy amount. the dollar amount would be computed exactlt correct
        // probably find a different way to find the order
        // [Bazaar] Cancelled! Refunded 33,067,219 coins from cancelling Buy Order!

        // filter the buyOrders by thoes that math the dollar amount (buying-amount * price-buying) within 10 coins of the dollar amount
        buyOrders = buyOrders.filter(buyOrder => {
            const unbought_amount = buyOrder["buying-amount"]; // assume bought amount is 0
            const unbought_dollars = unbought_amount * buyOrder["price-buying"];
            return (unbought_dollars - 1000 < dollars && dollars < unbought_dollars + 1000);
        });

        // if there are no buy orders that match the dollar amount, throw an error
        if (buyOrders.length === 0) {
            consoleWarn('WARNING: Failed to find a buy order to cancel for dollar amount: ' + dollars);
            return 'ERROR: Failed to find a buy order to cancel';
        }

        // if the length if more than 1, find the one with the closest dollar amount to the dollars variable
        let closestBuyOrder = buyOrders[0];
        if (buyOrders.length > 1) {
            let closestDifference = Math.abs((closestBuyOrder["buying-amount"] * closestBuyOrder["price-buying"]) - dollars);
            for (let buyOrderIndex = 1; buyOrderIndex < buyOrders.length; buyOrderIndex++) {
                const buyOrder = buyOrders[buyOrderIndex];
                const unbought_amount = buyOrder["buying-amount"]; // assume bought amount is 0
                const unbought_dollars = unbought_amount * buyOrder["price-buying"];
                const difference = Math.abs(unbought_dollars - dollars);
                if (difference < closestDifference) {
                    closestBuyOrder = buyOrder;
                    closestDifference = difference;
                }
            }
            buyOrders = [closestBuyOrder];
        }

        // now we should have a single buy order that matches the dollar amount
        // remove that order
        const buyOrderIndex = trader_data['buy-order-overview']['buy-orders'].indexOf(closestBuyOrder);
        const removedOrder = trader_data['buy-order-overview']['buy-orders'].splice(buyOrderIndex, 1)[0];

        // add back whatever was already claimed earlier in this order's life, since
        // "bought-amount" alone only reflects unclaimed progress since the last claim.
        logResolvedOrder(
            "buy", closestBuyOrder["item-name"], closestBuyOrder["buy-order-place-time"],
            "cancelled", (closestBuyOrder["total-amount-claimed"] || 0) + (closestBuyOrder["bought-amount"] || 0)
        );

        if (!(removedOrder["bought-amount"] === 0 || removedOrder["buying-amount"] === removedOrder["bought-amount"])) console.error("Strange, the buy order being cancelled has a bought amount that is not 0 or equal to the buying amount. This should not happen. The buy order is: ", removedOrder);

        if (!removedOrder["has-been-claimed"]) {
            const name = removedOrder["item-name"];

            if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
                trader_data["all-products"][name] = {
                    "current-amount": 0,
                    "buy-order-stats": {
                        "total-buy-orders-created": 1,
                        "total-buy-amount-claimed": 0,
                        "total-buy-amount-placed-for-buying": removedOrder["buying-amount"],
                        "buy-average": 0
                    },
                    "sell-order-stats": {
                        "total-sell-orders-created": 0,
                        "total-sell-amount-claimed": 0,
                        "total-sell-amount-placed-for-selling": 0,
                        "sell-average": 0
                    },
                    "max-amount": 2000,
                    "total-profit-made": 0,
                    "total-sold": 0,
                    "crafting-materials": "none"
                };
            } else {
                // console.log(trader_data["all-products"][name]);
                trader_data["all-products"][name]["buy-order-stats"]["total-buy-orders-created"] += 1;
                trader_data["all-products"][name]["buy-order-stats"]["total-buy-amount-placed-for-buying"] += removedOrder["buying-amount"];
                trader_data["all-products"][name]["buy-order-stats"]["buy-average"] =
                    trader_data["all-products"][name]["buy-order-stats"]["total-buy-amount-claimed"] /
                    trader_data["all-products"][name]["buy-order-stats"]["total-buy-orders-created"];
            }
        }
        return 'Buy order canceling completed';
    }
    sellOrderSetup(amount, price, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // The sell order message names the Bazaar item, but a forged one is held under
        // its "(forge)" entry, so sell from that when there is no plain stock.
        const sellOrderName = name;
        const forgeName = name + " (forge)";
        if (trader_data[getInvestmentType(product_list[name]["type"])][name] === undefined &&
            product_list[forgeName] !== undefined &&
            trader_data[getInvestmentType(product_list[forgeName]["type"])][forgeName] !== undefined) {
            name = forgeName;
        }

        const resellPrice = price;
        const invesmentType = getInvestmentType(product_list[name]["type"]);
        const sellOrderPlaceTime = Date.now();
        const currentHoldingAmountBeforeSell = trader_data["all-products"][name]?.["current-amount"];
        let earliest_time_bought = "10000000000000000000000000000";
        let total_selling_amount = 0;

        let sell_sub_orders = [];
        trader_data[invesmentType][name]["sub-orders"] = new Sort(trader_data[invesmentType][name]["sub-orders"], false, "price-bought");
        const investmentSubOrders = trader_data[invesmentType][name]["sub-orders"];

        while (investmentSubOrders.length > 0) {
            const investmentSubOrder = investmentSubOrders[0];
            if (amount === 0) break;

            // go through each suborder
            if (investmentSubOrder["partial-amount"] > amount) {
                // then just subtract from the current suborder
                trader_data[invesmentType][name]["sub-orders"][0]["partial-amount"] -= amount;

                // add the new sub sell order
                const bazaarFeesPerUnit = resellPrice * getBazaarTaxRate();
                const projectedProfitPerUnit = Math.round((resellPrice - investmentSubOrder["price-bought"] - bazaarFeesPerUnit) * 10) / 10;
                total_selling_amount += amount;
                sell_sub_orders.push({
                    "partial-sold-amount": 0,
                    "partial-selling-amount": amount,
                    "price-bought": investmentSubOrder["price-bought"],
                    "projected-profit": projectedProfitPerUnit * amount,
                    "time-bought": investmentSubOrder["time-bought"],
                    "sell-order-place-time": sellOrderPlaceTime,
                    "source": investmentSubOrder["source"]
                });

                // update earliest time bought
                if (parseInt(investmentSubOrder["time-bought"]) < parseInt(earliest_time_bought)) {
                    earliest_time_bought = investmentSubOrder["time-bought"];
                }

                trader_data["all-products"][name]["current-amount"] -= amount;
                break;
            } else {
                // determine if the last suborder is bought out
                if (trader_data[invesmentType][name]["sub-orders"].length <= 1) {
                    amount -= investmentSubOrder["partial-amount"];

                    if (amount > 0) throw new Error(`ERROR: Sell order setup requires more products then found in investments. amt: ${amount + investmentSubOrder["partial-amount"]} price: ${price} name: ${name} investment amount: ${investmentSubOrder["partial-amount"]}`);

                    // add the new sub sell order
                    const bazaarFeesPerUnit = resellPrice * getBazaarTaxRate();
                    const projectedProfitPerUnit = Math.round((resellPrice - investmentSubOrder["price-bought"] - bazaarFeesPerUnit) * 10) / 10;
                    total_selling_amount += investmentSubOrder["partial-amount"];
                    sell_sub_orders.push({
                        "partial-sold-amount": 0,
                        "partial-selling-amount": investmentSubOrder["partial-amount"],
                        "price-bought": investmentSubOrder["price-bought"],
                        "projected-profit": projectedProfitPerUnit * investmentSubOrder["partial-amount"],
                        "time-bought": investmentSubOrder["time-bought"],
                        "sell-order-place-time": sellOrderPlaceTime,
                        "source": investmentSubOrder["source"]
                    });

                    // update earliest time bought
                    if (parseInt(investmentSubOrder["time-bought"]) < parseInt(earliest_time_bought)) {
                        earliest_time_bought = investmentSubOrder["time-bought"];
                    }

                    // remove the whole order
                    delete trader_data[invesmentType][name];

                    trader_data["all-products"][name]["current-amount"] -= investmentSubOrder["partial-amount"];
                    break;
                } else {
                    amount -= investmentSubOrder["partial-amount"];

                    // add the new sub sell order
                    const bazaarFeesPerUnit = resellPrice * getBazaarTaxRate();
                    const projectedProfitPerUnit = Math.round((resellPrice - investmentSubOrder["price-bought"] - bazaarFeesPerUnit) * 10) / 10;
                    total_selling_amount += investmentSubOrder["partial-amount"];
                    sell_sub_orders.push({
                        "partial-sold-amount": 0,
                        "partial-selling-amount": investmentSubOrder["partial-amount"],
                        "price-bought": investmentSubOrder["price-bought"],
                        "projected-profit": projectedProfitPerUnit * investmentSubOrder["partial-amount"],
                        "time-bought": investmentSubOrder["time-bought"],
                        "sell-order-place-time": sellOrderPlaceTime,
                        "source": investmentSubOrder["source"]
                    });

                    // update earliest time bought
                    if (parseInt(investmentSubOrder["time-bought"]) < parseInt(earliest_time_bought)) {
                        earliest_time_bought = investmentSubOrder["time-bought"];
                    }

                    // just remove the suborder
                    trader_data[invesmentType][name]["sub-orders"].splice(0, 1);

                    trader_data["all-products"][name]["current-amount"] -= investmentSubOrder["partial-amount"];
                }
            }
        }

        // add the sell order
        trader_data['sell-order-overview']['sell-orders'].push({
            "item-name": sellOrderName,
            // where the stock came from, when that is not the item's own entry
            "investment-name": name !== sellOrderName ? name : undefined,
            "price-sold": price,
            "earliest-time-bought": earliest_time_bought,
            "total-selling-amount": total_selling_amount,
            "has-been-claimed": false,
            "has-been-filled": false,
            "sell-order-place-time": sellOrderPlaceTime,
            "sub-orders": sell_sub_orders,
            // cumulative amount ever claimed off this order across all partial claims -
            // unlike each sub-order's "partial-sold-amount" (which gets zeroed out on a
            // partial claim), this never resets, so the true lifetime fill total can be
            // logged on resolution.
            "total-amount-claimed": 0
        });

        logPlacedOrder("sell", name, sellOrderPlaceTime, total_selling_amount, price, currentHoldingAmountBeforeSell);

        return 'Sell order setup completed';
    }
    sellOrderFill(amount, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the current sell orders
        const sellOrders = trader_data['sell-order-overview']['sell-orders'];

        // The fill message only gives us item name + remaining amount, not a unique
        // order id, so multiple open orders for the same item can share both (e.g.
        // two orders that started at 2240 and were each independently partially
        // claimed down to the same remaining amount). Pick the oldest still-open
        // match (FIFO) instead of whichever the array happens to iterate to first -
        // the array's order isn't reliably chronological since sellOrderClaim re-sorts it.
        let sellOrderIndex = -1;
        for (let index = 0; index < sellOrders.length; index++) {
            const candidate = sellOrders[index];
            if (candidate["item-name"] === name &&
                candidate["total-selling-amount"] === amount &&
                !candidate["has-been-filled"] &&
                (sellOrderIndex === -1 || candidate["sell-order-place-time"] < sellOrders[sellOrderIndex]["sell-order-place-time"])) {
                sellOrderIndex = index;
            }
        }
        if (sellOrderIndex !== -1) {
            const sellOrder = sellOrders[sellOrderIndex];
            sellOrder["has-been-filled"] = true;
            sellOrder["sub-orders"].map(subOrder => {
                subOrder["partial-sold-amount"] = subOrder["partial-selling-amount"];
            });
            trader_data['sell-order-overview']['sell-orders'][sellOrderIndex] = sellOrder;

            // "amount" here is just this final unclaimed chunk - add back whatever was
            // already claimed earlier in the order's life so filled_amount reflects the
            // true lifetime total, comparable against order_amount from the placed event.
            logResolvedOrder("sell", name, sellOrder["sell-order-place-time"], "filled", (sellOrder["total-amount-claimed"] || 0) + amount);

            return 'Sell order filling completed';
        }

        consoleWarn('ERROR: Failed to fill a sell order');
        return 'ERROR: Failed to fill a sell order';
    }
    sellOrderClaim(amount, price_sold, name, coins_earned, has_decimal) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the current sell orders
        const sellOrders = new Sort(trader_data["sell-order-overview"]["sell-orders"], false, "sell-order-place-time");

        // index that the sell order that was claimed will be at
        let current_sell_order_index = this.determineNearestSellOrder(amount, price_sold, name, coins_earned, has_decimal);

        if (current_sell_order_index === -1 || sellOrders.length === 0) {
            consoleWarn('ERROR: Failed to find a sell order to claim for name: ' + name + ', amount: ' + amount + ', price_sold: ' + price_sold + ', coins_earned: ' + coins_earned + ', has_decimal: ' + has_decimal);
            return 'ERROR: Failed to find a sell order to claim';
        }

        trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["has-been-claimed"] = true;
        // capture the claim total now, before the loop below mutates "amount"
        trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["total-amount-claimed"] =
            (trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["total-amount-claimed"] || 0) + amount;

        // adjust the amounts to reflect the sell claim
        let suborders = trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"];

        // subtract the amount from the total selling amount
        trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["total-selling-amount"] -= amount;

        while (suborders.length > 0) {
            const subOrder = suborders[0];

            if (subOrder["partial-selling-amount"] === 0) return "Sell order claim completed";

            // go through each suborder
            if (subOrder["partial-selling-amount"] > amount) {
                // then just subtract from the current suborder
                trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"][0]["partial-selling-amount"] -= amount;
                trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"][0]["partial-sold-amount"] = 0;

                // calculate the profit from the sell order
                const date_bought = subOrder["time-bought"];

                addSellClaimToProducts(amount, name, subOrder["partial-selling-amount"], false);

                return this.addProfit(amount, name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true, profitTypeOf(subOrder, 'bazaar')) + " & Sell order claim completed";
            } else {
                // determine if the last suborder is bought out
                if (trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].length <= 1) {
                    amount -= subOrder["partial-selling-amount"];
                    if (amount > 0) throw new Error('ERROR: Amount still left over to claim from sell order after order has been completly filled');

                    // remove the whole order
                    trader_data["sell-order-overview"]["sell-orders"].splice(current_sell_order_index, 1);

                    // calculate the profit from the sell order
                    const date_bought = subOrder["time-bought"];

                    addSellClaimToProducts(subOrder["partial-selling-amount"], name, subOrder["partial-selling-amount"], true);

                    return this.addProfit(subOrder["partial-selling-amount"], name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true, profitTypeOf(subOrder, 'bazaar')) + " & Sell order claim completed";
                } else {
                    amount -= subOrder["partial-selling-amount"];

                    // just remove the suborder
                    trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].splice(0, 1);

                    // calculate the profit for just this sell order
                    const date_bought = subOrder["time-bought"];

                    addSellClaimToProducts(subOrder["partial-selling-amount"], name, subOrder["partial-selling-amount"], amount === 0);

                    this.addProfit(subOrder["partial-selling-amount"], name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true, profitTypeOf(subOrder, 'bazaar'));
                }
            }
        }

        consoleWarn('ERROR: More sell order claiming then that in the sell order');

        return 'ERROR: More sell order claiming then that in the sell order';

        function addSellClaimToProducts(amount, name, orderSellAmount, orderFilled) {
            // add the claim into the sell order stuff
            if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
                trader_data["all-products"][name] = {
                    "current-amount": 0, // will be added to in addProfit
                    "buy-order-stats": {
                        "total-buy-orders-created": 0,
                        "total-buy-amount-claimed": 0,
                        "total-buy-amount-placed-for-buying": 0,
                        "buy-average": 0
                    },
                    "sell-order-stats": {
                        "total-sell-orders-created": orderFilled ? 1 : 0,
                        "total-sell-amount-claimed": amount,
                        "total-sell-amount-placed-for-selling": orderFilled ? orderSellAmount : 0,
                        "sell-average": 0
                    },
                    "max-amount": 2000,
                    "total-profit-made": 0,
                    "total-sold": 0,
                    "crafting-materials": "none"
                };

                console.log('This is weird, im making product data on a sell order before its even been bought before.')
            } else {
                trader_data["all-products"][name]["sell-order-stats"]["total-sell-amount-claimed"] += amount;
                if (orderFilled) {
                    trader_data["all-products"][name]["sell-order-stats"]["total-sell-orders-created"] += 1;
                    trader_data["all-products"][name]["sell-order-stats"]["total-sell-amount-placed-for-selling"] += orderSellAmount;
                    trader_data["all-products"][name]["sell-order-stats"]["sell-average"] =
                        trader_data["all-products"][name]["sell-order-stats"]["total-sell-amount-claimed"] /
                        trader_data["all-products"][name]["sell-order-stats"]["total-sell-orders-created"];
                }
            }
        }
    }
    determineNearestSellOrder(amount, price_sold, name, coins_earned, has_decimal) {
        // console.log(`🔍 Searching for nearest sell order: Name=${name}, Amount=${amount}, Price Sold=${price_sold}, Coins Earned=${coins_earned}, Has Decimal=${has_decimal}`);

        let sellOrders = new Sort(trader_data["sell-order-overview"]["sell-orders"], false, "sell-order-place-time");

        const potentialMatches = sellOrders.filter(order => {
            const itemMatch = order["item-name"] === name;
            const remainingAmountMatch = order["total-selling-amount"] >= amount;
            // console.log(`Checking order: Name=${order["item-name"]}, Amount=${order["total-selling-amount"]}, Price=${order["price-sold"]} => Item Match: ${itemMatch}, Remaining Amount Match: ${remainingAmountMatch}`);
            return itemMatch && remainingAmountMatch;
        });

        let bestOrder;

        if (potentialMatches.length === 1) {
            bestOrder = potentialMatches[0];
        } else if (potentialMatches.length === 0) {
            consoleWarn(`❌ Tracker mismatch: No database profiles fit the parsed pricing signature.`);
            return -1;
        } else {
            bestOrder = findBestOrder(amount, price_sold, coins_earned, has_decimal, potentialMatches);
        }
        

        // console.log(`✅ Success! Linked to Order ID: ${name} (Database Entry Price was: ${bestOrder["price-sold"]})`); 
        // return the index of the best order in the original sellOrders array
        const bestOrderIndex = sellOrders.findIndex(order => order["price-sold"] === bestOrder["price-sold"]
            && order["item-name"] === bestOrder["item-name"]
            && order["total-selling-amount"] === bestOrder["total-selling-amount"]);
        return bestOrderIndex;

        function findBestOrder(amount, price_sold, coins_earned, has_decimal, potentialMatches) {
            // console.log(`Found ${potentialMatches} potential matches for sell order.`);
            const EPSILON = 0.05; // Threshold to handle standard JS floating-point issues
            let smallestScore = Infinity;
            const actualPrice = (coins_earned / amount) / (1 - getBazaarTaxRate());

            for (const order of potentialMatches) {
                // console.log(`🔍 Evaluating sell order: Name=${order["item-name"]}, Amount=${order["total-selling-amount"]}, Price=${order["price-sold"]}`);
                let currentScore;

                if (has_decimal) {
                    // Case A: Chat explicitly has a decimal. Use strict near-exact matching.
                    const priceDifference = Math.abs(order["price-sold"] - price_sold);
                    if (priceDifference <= 0.15) {
                        currentScore = priceDifference < EPSILON ? 0 : priceDifference * 10000;
                    }
                } else {
                    // Tie breaker: Calculate the difference between the underlying raw data fractions.
                    // We extract the fractional part (e.g. 26122.1 -> 0.1) to favor an exact matchup.
                    const decimalRemainder = Math.abs(order["price-sold"] - actualPrice);
                    currentScore = decimalRemainder * 10000; // Scale to prioritize exact matches over rounded ones
                }


                // Total score: Lowest score represents the absolute best match
                // console.log(`Evaluated Order: Name=${order["item-name"]}, Price=${order["price-sold"]}, Amount=${order["total-selling-amount"]}, Score=${currentScore.toFixed(4)}`);
                if (currentScore < smallestScore) {
                    smallestScore = currentScore;
                    bestOrder = order;
                }
            }

            return bestOrder;
        }
    }
    sellOrderCancel(amount, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the current sell orders
        const sellOrders = trader_data["sell-order-overview"]["sell-orders"];

        // index that the sell order that was claimed will be at
        let current_sell_order_index = -1;

        // The cancel message only gives us item name + refunded amount, not a unique
        // order id, so multiple open orders for the same item can share the same
        // unsold amount (e.g. two orders split off the same original order, each
        // independently partially filled down to the same remaining amount). Pick the
        // oldest match (FIFO) instead of whichever the array happens to put last.
        for (const sellOrderIndex of Object.keys(sellOrders)) {
            const sellOrder = sellOrders[sellOrderIndex];

            // total up the amount that is unsold for each suborder
            let totalUnsold = 0;
            for (const subSellOrderIndex of Object.keys(sellOrder["sub-orders"])) {
                totalUnsold += sellOrder["sub-orders"][subSellOrderIndex]["partial-selling-amount"];
            }

            // check that the unsold amounts and name are the same as the current sell order
            if (sellOrder["item-name"] === name &&
                totalUnsold === amount &&
                (current_sell_order_index === -1 ||
                    sellOrder["sell-order-place-time"] < sellOrders[current_sell_order_index]["sell-order-place-time"])) {
                current_sell_order_index = sellOrderIndex;
            }
        }
        if (current_sell_order_index === -1 || sellOrders.length === 0) {
            consoleWarn('ORDER NOT FOUND');
            return 'ERROR: No sell order found to cancel';
        }

        // Forged stock goes back under the "(forge)" entry it was sold from, and is
        // counted there, the same entry sellOrderSetup took it out of.
        name = sellOrders[current_sell_order_index]["investment-name"] || name;

        if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
            trader_data["all-products"][name] = {
                "current-amount": 0,
                "buy-order-stats": {
                    "total-buy-orders-created": 0,
                    "total-buy-amount-claimed": 0,
                    "total-buy-amount-placed-for-buying": 0,
                    "buy-average": 0
                },
                "sell-order-stats": {
                    "total-sell-orders-created": 1,
                    "total-sell-amount-claimed": 0,
                    "total-sell-amount-placed-for-selling": amount,
                    "sell-average": 0
                },
                "max-amount": 2000,
                "total-profit-made": 0,
                "total-sold": 0,
                "crafting-materials": "none"
            };

            consoleWarn('This is weird, im making product data on a sell order cancel before its even been bought before.')
        } else {
            trader_data["all-products"][name]["sell-order-stats"]["total-sell-orders-created"] += 1;
            trader_data["all-products"][name]["sell-order-stats"]["total-sell-amount-placed-for-selling"] += amount;
            trader_data["all-products"][name]["sell-order-stats"]["sell-average"] =
                trader_data["all-products"][name]["sell-order-stats"]["total-sell-amount-claimed"] /
                trader_data["all-products"][name]["sell-order-stats"]["total-sell-orders-created"];
            trader_data["all-products"][name]["current-amount"] += amount;
        }

        const currentSellOrder = sellOrders[current_sell_order_index];
        const invesmentType = getInvestmentType(product_list[name]["type"]);
        for (const subSellOrder of currentSellOrder["sub-orders"]) {
            const price = subSellOrder["price-bought"];
            const time_bought = subSellOrder["time-bought"];
            const subSellAmount = subSellOrder["partial-selling-amount"];
            if (subSellOrder["partial-sold-amount"] != 0) consoleWarn(`ERROR: Suborder has been partially sold, but the sell order is being cancelled. This should not happen. Some info: ${subSellAmount}, ${JSON.stringify(subSellOrder)}, ${JSON.stringify(currentSellOrder)}, ${name}, ${invesmentType}, ${price}`);

            if (trader_data[invesmentType][name] != undefined) {
                let found = false;

                // append a new order to suborders
                for (const subOrderIndex of Object.keys(trader_data[invesmentType][name]["sub-orders"])) {
                    if (trader_data[invesmentType][name]["sub-orders"][subOrderIndex]["price-bought"] === price &&
                        trader_data[invesmentType][name]["sub-orders"][subOrderIndex]["time-bought"] === time_bought) {
                        trader_data[invesmentType][name]["sub-orders"][subOrderIndex]["partial-amount"] += subSellAmount;
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    trader_data[invesmentType][name]["sub-orders"].push({
                        "partial-amount": subSellAmount,
                        "price-bought": price,
                        "time-bought": time_bought,
                        "source": subSellOrder["source"]
                    });
                }
            } else {
                trader_data[invesmentType][name] = {
                    "type": product_list[name]["type"],
                    "sub-orders": [
                        {
                            "partial-amount": subSellOrder["partial-selling-amount"],
                            "price-bought": subSellOrder["price-bought"],
                            "time-bought": subSellOrder["time-bought"],
                            "source": subSellOrder["source"]
                        }
                    ]
                }
            }
        }

        // add back whatever was already claimed earlier in this order's life, since
        // "partial-sold-amount" alone only reflects unclaimed progress since the last claim.
        const filledAmountBeforeCancel = (currentSellOrder["total-amount-claimed"] || 0) + currentSellOrder["sub-orders"].reduce(
            (acc, subOrder) => acc + (subOrder["partial-sold-amount"] || 0), 0
        );
        logResolvedOrder("sell", name, currentSellOrder["sell-order-place-time"], "cancelled", filledAmountBeforeCancel);

        trader_data["sell-order-overview"]["sell-orders"].splice(current_sell_order_index, 1);

        return 'Sell order cancelled';
    }
    orderFlipped(amount, name, profit) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the buy orders
        const buyOrders = trader_data["buy-order-overview"]["buy-orders"];
        let current_buy_order_index = -1;

        // The flip message only gives us item name + amount, not a unique order id, so
        // multiple open orders for the same item can share both (e.g. two orders that
        // started at 2240 and were each independently partially claimed down to the
        // same remaining amount). Pick the oldest still-unfilled match (FIFO) instead
        // of whichever the array happens to put last - if this order was already
        // filled and just left unclaimed, prefer that one since the flip is claiming it.
        for (const buyOrderIndex of Object.keys(buyOrders)) {
            const buyOrder = buyOrders[buyOrderIndex];
            if (buyOrder["item-name"] === name && buyOrder["buying-amount"] === amount) {
                if (current_buy_order_index === -1) {
                    current_buy_order_index = buyOrderIndex;
                    continue;
                }
                const current = buyOrders[current_buy_order_index];
                const candidateIsBetter =
                    (buyOrder["has-been-filled"] === current["has-been-filled"] &&
                        buyOrder["buy-order-place-time"] < current["buy-order-place-time"]) ||
                    (buyOrder["has-been-filled"] && !current["has-been-filled"]);
                if (candidateIsBetter) current_buy_order_index = buyOrderIndex;
            }
        }
        if (current_buy_order_index === -1 || buyOrders.length === 0) throw new Error('ERROR: No buy order found to flip');

        const currentBuyOrder = buyOrders[current_buy_order_index];
        const priceBought = currentBuyOrder["price-buying"];
        const profitPerUnit = profit / amount;

        // An order-flipped message usually means this buy order filled and was
        // immediately reused as a sell order, skipping the normal "[Bazaar] Your Buy
        // Order ... was filled!" message that buyOrderFill() logs a resolved event
        // from - so log it here instead, or the trade log would never see this order
        // resolve. But if the order was left unclaimed after a normal fill and only
        // flipped later, buyOrderFill() already logged it - the has-been-filled flag
        // still matches then, so skip logging again to avoid a duplicate.
        if (!currentBuyOrder["has-been-filled"]) {
            // add back whatever was already claimed earlier in this order's life, since
            // "amount" here is just this final flipped chunk.
            logResolvedOrder("buy", name, currentBuyOrder["buy-order-place-time"], "filled", (currentBuyOrder["total-amount-claimed"] || 0) + amount);
        }

        this.buyOrderClaim(amount, priceBought, name);
        this.sellOrderSetup(amount, (priceBought + profitPerUnit), name);

        return 'Buy order flipped';
    }
    npcSell(amount, price, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        this.instaSell(amount, price, name, false);

        return 'NPC sell completed';
    }
    npcBuyBack(amount, price, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';
        
        this.instaBuy(amount, price, name);

        return 'NPC buyback completed';
    }
    auctionCreation(price, name, detectedRarity) {
        // console.log(`Creating auction for ${name} at price ${price}`);
        name = this.fixRarity(name, detectedRarity);

        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Auction item name not found in product list';

        // automatically create product if none can already be found
        if (Object.keys(trader_data["long-term-investments"]).indexOf(name) === -1) {
            console.log(`Product was not found already in investments to create an auction for. Creating product ${name} in long-term investments.`);

            // console.log(`Supercrafting ${name}`);
            this.supercraft(name, detectedRarity);
        }

        // remove the product from the long term investments by highest cost
        trader_data["long-term-investments"][name]["sub-orders"] = new Sort(trader_data["long-term-investments"][name]["sub-orders"], false, "price-bought");
        const currentProducts = trader_data["long-term-investments"][name]["sub-orders"];
        // console.log(`Current products for ${name}: ${JSON.stringify(currentProducts)}`);
        const removedInvestment = currentProducts[0];
        // console.log(`Removing investment: ${name} - ${removedInvestment["price-bought"]}`);

        if (currentProducts.length <= 1) {
            delete trader_data["long-term-investments"][name];
        } else if (currentProducts[0]["partial-amount"] === 1) {
            trader_data["long-term-investments"][name]["sub-orders"].splice(0, 1);
        } else {
            trader_data["long-term-investments"][name]["sub-orders"][0]["partial-amount"] -= 1;
        }

        const auctionFees = calcAuctionFee(price);

        // console.log(JSON.stringify(removedInvestment));
        // console.log(auctionFees);

        trader_data["auction-house-overview"]["auctions"].push({
            "item-name": name,
            "auction-id": "idk",
            "material-cost": removedInvestment["price-crafted"] + auctionFees,
            "price-selling": price,
            "sold": false,
            "date-placed": Date.now(),
            "time-crafted": removedInvestment["time-bought"],
            "source": removedInvestment["source"]
        });

        trader_data["all-products"][name]["current-amount"] -= 1;

        return 'Auction created';
    }
    auctionClaim(price, name, detectedRarity) {
        name = this.fixRarity(name, detectedRarity);
        
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Auction item name not found in product list';

        const priceSold = price / (1 - AUCTION_FEE_RATE_LOW * DERPY_TAX_MULTIPLIER);

        // remove auction
        const auctions = trader_data["auction-house-overview"]["auctions"];
        let current_auction_index = -1;

        for (const auctionIndex in auctions) {
            const auction = auctions[auctionIndex];
            if (auction["item-name"] === name && auction["price-selling"] === Math.round(priceSold)) {
                current_auction_index = auctionIndex;
                break;
            }
        }

        if (current_auction_index === -1) {
            consoleWarn('ERROR: Auction not found to claim for name: ' + name + ', price: ' + price + ', priceSold: ' + priceSold);
            return 'ERROR: Auction not found to claim';
        }

        // remove the auction from 'auctions'
        const removedAuction = trader_data["auction-house-overview"]["auctions"].splice(current_auction_index, 1)[0];

        // add auction fee to daily profit
        const auctionFees = priceSold * AUCTION_FEE_RATE_LOW * DERPY_TAX_MULTIPLIER;
        this.addProfit(1, name, removedAuction["material-cost"] + auctionFees, priceSold, removedAuction["date-placed"], Date.now(), false, profitTypeOf(removedAuction, "auction-house"));

        return 'Auction claimed';
    }
    auctionCancel(name, detectedRarity) {
        name = this.fixRarity(name, detectedRarity);

        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Auction item name not found in product list';

        // find the first occurance of the auction
        const auctions = trader_data["auction-house-overview"]["auctions"];
        let current_auction_index = -1;
        // console.log(`Searching for auction to cancel: ${name}, Current Auctions: ${JSON.stringify(auctions)}`);

        // sort the auctions by date-placed to ensure we cancel the earliest one first
        auctions.sort((a, b) => a["date-placed"] - b["date-placed"]);
        for (const auctionIndex in auctions) {
            const auction = auctions[auctionIndex];
            if (auction["item-name"] === name) {
                current_auction_index = auctionIndex;
                break;
            }
        }

        if (current_auction_index === -1) {
            consoleWarn('ERROR: Auction not found to cancel for name: ' + name);
            return 'ERROR: Auction not found to cancel';
        }

        // remove the auction from 'auctions'
        const removedAuction = trader_data["auction-house-overview"]["auctions"].splice(current_auction_index, 1)[0];
        // console.log(`Auction cancelled for ${name} at price ${removedAuction["price-selling"]} and index ${current_auction_index}`);

        // Put the auction back into long term investments
        const productTypeAlreadyCreated = Object.keys(trader_data["long-term-investments"]).indexOf(name) != -1;
        if (productTypeAlreadyCreated) {
            trader_data["long-term-investments"][name]["sub-orders"].push({
                "partial-amount": 1,
                "price-crafted": removedAuction["material-cost"],
                "time-bought": removedAuction["time-crafted"],
                "source": removedAuction["source"]
            });
        } else {
            trader_data["long-term-investments"][name] = {
                "type": "auction-product",
                "sub-orders": [
                    {
                        "partial-amount": 1,
                        "price-crafted": removedAuction["material-cost"],
                        "time-bought": removedAuction["time-crafted"],
                        "source": removedAuction["source"]
                    }
                ]
            }
        }

        trader_data["all-products"][name]["current-amount"] += 1;

        // adjust for the add profit increasing it
        trader_data["all-products"][name]["total-sold"] -= 1;

        return ('Auction cancelled');
    }
    auctionSold(price, name, detectedRarity) {
        name = this.fixRarity(name, detectedRarity);

        // The "[Auction] X bought Y" message carries no rarity, so a tiered item like
        // Beastmaster Crest arrives as just "Beastmaster Crest". Match on the name
        // without its " - RARITY" instead, and let the price pick out the listing.
        // An exact name match still wins when there is one.
        const baseName = (itemName) => itemName.split(" - ")[0];

        // find the first occurance of the auction
        const auctions = trader_data["auction-house-overview"]["auctions"];
        let current_auction_index = -1;

        for (const auctionIndex in auctions) {
            const auction = auctions[auctionIndex];
            if (auction["item-name"] === name && auction["price-selling"] === price && !auction["sold"]) {
                current_auction_index = auctionIndex;
                break;
            }
        }
        if (current_auction_index === -1) {
            for (const auctionIndex in auctions) {
                const auction = auctions[auctionIndex];
                if (baseName(auction["item-name"]) === baseName(name) && auction["price-selling"] === price && !auction["sold"]) {
                    current_auction_index = auctionIndex;
                    break;
                }
            }
        }

        if (current_auction_index === -1) {
            consoleWarn('ERROR: Auction not found to set sold for name: ' + name + ', price: ' + price);
            return 'ERROR: Auction not found to set sold';
        }

        trader_data["auction-house-overview"]["auctions"][current_auction_index]["sold"] = true;

        return 'Auction successfully set sold';
    }
    auctionBought(price, name, detectedRarity) {
        name = this.fixRarity(name, detectedRarity);

        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Auction item name not found in product list';


        if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
            trader_data["all-products"][name] = {
                "current-amount": 0, // will be added in instabuy
                "max-amount": 2000,
                "total-profit-made": 0,
                "total-sold": 0,
                "crafting-materials": "none"
            };
        }

        this.instaBuy(1, price, name);

        return 'Auction successfully bought';
    }
    auctionExpired(name, detectedRarity) {
        // console.log(`Auction expired for ${name}`);
        const result = this.auctionCancel(name, detectedRarity);

        return result === "ERROR: Auction item name not found in product list" ? "ERROR: Auction item name not found in product list" : 'Auction successfully expired';
    }
    supercraft(name, detectedRarity) {
        // different naming function for this one
        name = this.fixRarity(name, detectedRarity);

        // console.log(`Supercrafting ${name}`);

        if (Object.keys(product_list).indexOf(name) === -1) return `ERROR: Product name not found in product list ${name}`;

        if (Object.keys(product_list).indexOf(name + " (forge)") != -1) {
            // console.log(`Supercrafting ${name} requires a forge, so supercrafting ${name} (forge) instead`);
            name = name + " (forge)";
        }

        // determine if product has already been created
        const productTypeAlreadyCreated = Object.keys(trader_data["long-term-investments"]).indexOf(name) != -1;

        // determine the crafting materials
        const craftingMaterials = product_list[name]["crafting-materials"];

        const dateSupercrafted = Date.now();

        let total_cost_of_product = 0;

        for (const craftingMaterialName of Object.keys(craftingMaterials)) {
            let productCost = removeCraftingMaterialFromInvestments(craftingMaterialName, craftingMaterials[craftingMaterialName], true);
            if (productCost === 0) {
                consoleWarn(`ERROR: Could not remove crafting material ${craftingMaterialName} from investments`);
                // if crafting material is another auction product, then supercraft that first
                if (Object.keys(product_list).indexOf(craftingMaterialName) === -1) throw new Error('ERROR: Crafting material not found in product list');
                if (product_list[craftingMaterialName]["type"] !== 'auction-product') throw new Error('ERROR: Crafting material is not an auction product, but was not found in investments (supercraft)');
                this.supercraft(craftingMaterialName);
                productCost = removeCraftingMaterialFromInvestments(craftingMaterialName, craftingMaterials[craftingMaterialName], false);
                if (productCost === 0) throw new Error('ERROR: Something went wrong with supercrafting auction crafting materials for supercrafting');
            }
            total_cost_of_product += productCost;
        }


        if (productTypeAlreadyCreated) {
            trader_data["long-term-investments"][name]["sub-orders"].push({
                "partial-amount": 1,
                "price-crafted": total_cost_of_product,
                "time-bought": dateSupercrafted
            });
        } else {
            trader_data["long-term-investments"][name] = {
                "type": "auction-product",
                "sub-orders": [
                    {
                        "partial-amount": 1,
                        "price-crafted": total_cost_of_product,
                        "time-bought": dateSupercrafted
                    }
                ]
            }
        }

        // add the buy order claim amounts
        if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
            trader_data["all-products"][name] = {
                "current-amount": 1,
                "total-profit-made": 0,
                "total-sold": 0,
                "crafting-materials": craftingMaterials
            };
        } else {
            trader_data["all-products"][name]["current-amount"] += 1;
        }

        return 'Supercraft successful';

        function removeCraftingMaterialFromInvestments(name, amount, returnFailed) {
            const invesmentType = getInvestmentType(product_list[name]["type"]);

            if (Object.keys(trader_data[invesmentType]).indexOf(name) === -1) {
                if (returnFailed) {
                    return 0;
                }
                throw new Error('ERROR: Crafting material not found in investments');
            }

            let suborders = trader_data[invesmentType][name]["sub-orders"];
            let material_cost = 0;

            trader_data["all-products"][name]["current-amount"] -= amount;

            const priceBoughtKey = product_list[name]["type"] === 'auction-product' ? 'price-crafted' : 'price-bought';
            trader_data[invesmentType][name]["sub-orders"] = new Sort(trader_data[invesmentType][name]["sub-orders"], false, priceBoughtKey);

            while (suborders.length > 0) {
                const subOrder = suborders[0];

                // go through each suborder
                if (subOrder["partial-amount"] > amount) {
                    material_cost += amount * subOrder[priceBoughtKey];

                    // then just subtract from the current suborder
                    trader_data[invesmentType][name]["sub-orders"][0]["partial-amount"] -= amount;

                    return material_cost;
                } else if (trader_data[invesmentType][name]["sub-orders"].length <= 1) {
                    material_cost += amount * subOrder[priceBoughtKey];

                    // remove the whole order
                    delete trader_data[invesmentType][name];

                    if (amount > subOrder["partial-amount"]) throw new Error('ERROR: More crafting materials needed then in investments');

                    return material_cost;
                } else {
                    amount -= subOrder["partial-amount"];
                    material_cost += subOrder["partial-amount"] * subOrder[priceBoughtKey];

                    // just remove the suborder
                    trader_data[invesmentType][name]["sub-orders"].splice(0, 1);
                }
            }

            throw new Error('ERROR: Something wrong with suborders when removing crafting materials from investments');
        }
    }
    itemRemoved(name, amount, detectedRarity) {
        // simply remove the item from the all-products list, and the short/term investments if it exists there
        name = this.fixRarity(name, detectedRarity);

        if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) return `ERROR: Product name not found in all-products list: ${name}`;
        
        // remove the amount from all products
        trader_data["all-products"][name]["current-amount"] -= amount;
        if (trader_data["all-products"][name]["current-amount"] < 0) {
            consoleWarn('ERROR: Current amount of product is less than 0 after item removal');
            return 'ERROR: Current amount of product is less than 0 after item removal';
        }

        // remove from long-term investments if it exists there
        const investmentType = getInvestmentType(product_list[name]["type"]);
        let suborders = [];
        if (Object.keys(trader_data[investmentType]).indexOf(name) !== -1) {
            suborders = trader_data[investmentType][name]["sub-orders"];
            trader_data[investmentType][name]["sub-orders"] = new Sort(suborders, false, "price-crafted");
        } else {
            consoleWarn('ERROR: Product name not found in investments list: ' + name);
            return 'ERROR: Product name not found in investments list: ' + name;
        }

        while (suborders.length > 0 && amount > 0) {
            const subOrder = suborders[0];
            if (subOrder["partial-amount"] > amount) {
                trader_data[investmentType][name]["sub-orders"][0]["partial-amount"] -= amount;
                amount = 0;
            } else {
                amount -= subOrder["partial-amount"];
                trader_data[investmentType][name]["sub-orders"].splice(0, 1);
            }
        }

        // change the total amount of the product in the order
        trader_data[investmentType][name]["total-amount"] -= amount;
        if (trader_data[investmentType][name]["total-amount"] < 0) {
            consoleWarn('ERROR: Total amount of product is less than 0 after item removal');
            return 'ERROR: Total amount of product is less than 0 after item removal';
        }

        // remove the order from the investments if there are no more suborders
        if (trader_data[investmentType][name]["sub-orders"].length === 0) delete trader_data[investmentType][name];

        if (amount > 0) {
            consoleWarn('ERROR: More items removed than in long-term investments');
            return 'ERROR: More items removed than in long-term investments';
        }

        return 'Item removed successfully';
    }
    fixRarity(name, detectedRarity) {
        if (name.includes(" - ")) return name; // already has a rarity
        if (detectedRarity != "") name = `${name} - ${detectedRarity}`;
        return name;
    }
    checkForForgeableItmes() {

    }
}

// ---------------------------------------------------------------------------
// Forge tracking
//
// Hypixel says nothing in chat about the forge, so the mod reads "The Forge"
// menu and posts a snapshot of its seven slots whenever one of them changes:
//
//   { "type": "forge-snapshot", "time": <ms>, "slots": [
//       { "slot": 1, "state": "forging", "item-name": "Drill Motor",
//         "item-id": "DRILL_ENGINE", "amount": 1, "remaining-seconds": 3600 } ] }
//
// state is "empty", "forging", "ready" or "unknown" (a slot the mod could not
// read, which is skipped). Comparing a snapshot with trader_data["forge"]:
//
//   empty -> item         a process started: its materials are used up
//   item  -> empty        it was claimed: the product moves into investments
//   item  -> other item   claimed and restarted while the menu was closed
//
// Finishing needs no event of its own: a process is ready once "time-ends" has
// passed. Items with no forge recipe in the product list are not tracked at all.
//
// Active processes live in trader_data["forge"], claimed ones move to
// trader_data["forge-history"]. A claimed product's sub-order is marked
// "source": "forge", and that mark follows it through sell orders and auctions so
// its sale counts as forge profit.
// ---------------------------------------------------------------------------

const FORGE_SNAPSHOT_UNCHANGED = 'Forge snapshot unchanged';
const FORGE_SUFFIX = ' (forge)';

// Slot number -> state in the last snapshot this server saw. Only used to tell a
// process that was just started (the slot was empty a moment ago) from one first
// seen part way through; not saved, so after a restart every process already in
// the forge counts as first seen.
const lastForgeSlotStates = new Map();

function processForgeSnapshot(snapshot) {
    if (!Array.isArray(snapshot.slots)) return 'ERROR: Forge snapshot has no slots';
    if (!Array.isArray(trader_data["forge"])) trader_data["forge"] = [];
    if (!Array.isArray(trader_data["forge-history"])) trader_data["forge-history"] = [];

    const now = Date.now();
    const results = [];

    for (const slot of snapshot.slots) {
        const wasEmpty = lastForgeSlotStates.get(slot.slot) === 'empty';
        lastForgeSlotStates.set(slot.slot, slot.state);

        if (slot.state !== 'empty' && slot.state !== 'forging' && slot.state !== 'ready') continue;

        const active = trader_data["forge"].find(process => process["slot"] === slot.slot);

        if (slot.state === 'empty') {
            if (active) results.push(claimForgeProcess(active, now));
            continue;
        }

        const recipeName = findForgeRecipe(slot["item-id"], slot["item-name"]);

        if (active && active["item-name"] === recipeName) {
            // The same process as last time. If it has finished, it finished no later
            // than now, which corrects an end time that was only estimated.
            if (slot.state === 'ready' && active["time-ends"] > now) active["time-ends"] = now;
            continue;
        }

        // Something else is in the slot, so whatever was tracked there got claimed.
        if (active) results.push(claimForgeProcess(active, now));

        // No recipe, nothing to track.
        if (!recipeName) continue;

        results.push(startForgeProcess(slot, recipeName, wasEmpty, now));
    }

    return results.length > 0 ? results.join(' & ') : FORGE_SNAPSHOT_UNCHANGED;
}

// The product list key of a forge recipe. The item id from the menu is matched
// against api names first, since some forge items are named differently in game
// (Drill Motor is DRILL_ENGINE); then the name, with and without " (forge)".
function findForgeRecipe(itemId, itemName) {
    const isForgeRecipe = (name) => product_list[name]?.["type"] === "forge-product";

    if (itemId) {
        for (const name of Object.keys(product_list)) {
            if (isForgeRecipe(name) && product_list[name]["api-name"] === itemId) return name;
        }
    }
    if (itemName && isForgeRecipe(itemName + FORGE_SUFFIX)) return itemName + FORGE_SUFFIX;
    if (itemName && isForgeRecipe(itemName)) return itemName;
    return null;
}

function startForgeProcess(slot, recipeName, wasEmpty, now) {
    const recipe = product_list[recipeName];
    const amount = Math.max(1, parseInt(slot["amount"]) || 1);
    const craftMs = (recipe["seconds-to-craft"] || 0) * 1000;
    const remainingMs = Number.isFinite(slot["remaining-seconds"]) ? slot["remaining-seconds"] * 1000 : null;

    // Started just now if the slot was empty in the previous snapshot. Otherwise it
    // was started while nothing was watching, and the start is worked back from the
    // recipe's duration (which Quick Forge shortens, hence "start-estimated").
    let timeStarted;
    let timeEnds;
    if (slot.state === 'forging' && remainingMs !== null) {
        timeEnds = now + remainingMs;
        timeStarted = wasEmpty ? now : Math.min(now, timeEnds - craftMs);
    } else {
        timeEnds = now;
        timeStarted = wasEmpty ? now : now - craftMs;
    }

    // A forge process uses its recipe once, however many items it makes.
    let materialCost = 0;
    for (const [materialName, quantity] of Object.entries(recipe["crafting-materials"] || {})) {
        materialCost += useForgeMaterial(materialName, quantity);
    }

    const process = {
        "forge-id": `${slot.slot}-${timeStarted}`,
        "slot": slot.slot,
        "item-name": recipeName,
        "item-id": slot["item-id"] || recipe["api-name"] || "",
        "amount": amount,
        "material-cost": roundPrice(materialCost),
        // what it should sell for right now, all items together; the dashboard sums this
        "sell-price": roundPrice(forgeMarketValue(recipeName) * amount),
        "time-started": timeStarted,
        "time-ends": timeEnds,
        "start-estimated": !wasEmpty
    };
    trader_data["forge"].push(process);

    return `Forge: started ${recipeName} in slot ${slot.slot} for ${process["material-cost"]} coins of materials`;
}

function claimForgeProcess(process, now) {
    trader_data["forge"].splice(trader_data["forge"].indexOf(process), 1);
    trader_data["forge-history"].push({ ...process, "time-claimed": now });

    const name = process["item-name"];
    const amount = process["amount"];
    const unitCost = amount > 0 ? process["material-cost"] / amount : 0;
    const productType = product_list[name]?.["type"] ?? "forge-product";
    const investmentType = getInvestmentType(productType);

    if (trader_data[investmentType][name] === undefined) {
        trader_data[investmentType][name] = { "type": productType, "sub-orders": [] };
    }
    // Both cost keys: bazaar flows read "price-bought", auction flows "price-crafted".
    trader_data[investmentType][name]["sub-orders"].push({
        "partial-amount": amount,
        "price-bought": unitCost,
        "price-crafted": unitCost,
        "time-bought": now,
        "source": "forge"
    });

    if (trader_data["all-products"][name] === undefined) {
        // The full shape: trackProduct reads the order stats on every insta sell.
        trader_data["all-products"][name] = {
            "current-amount": amount,
            "buy-order-stats": {
                "total-buy-orders-created": 0,
                "total-buy-amount-claimed": 0,
                "total-buy-amount-placed-for-buying": 0,
                "buy-average": 0
            },
            "sell-order-stats": {
                "total-sell-orders-created": 0,
                "total-sell-amount-claimed": 0,
                "total-sell-amount-placed-for-selling": 0,
                "sell-average": 0
            },
            "max-amount": 2000,
            "total-profit-made": 0,
            "total-sold": 0,
            "crafting-materials": product_list[name]?.["crafting-materials"] ?? "none"
        };
    } else {
        trader_data["all-products"][name]["current-amount"] += amount;
    }

    return `Forge: claimed ${amount}x ${name} from slot ${process["slot"]}`;
}

// Takes a forge material out of investments, most expensive lots first like
// supercraft, and returns what it cost. A material forged earlier is held under
// its "(forge)" entry, so that is drawn on once the plain stock runs out. Anything
// not in investments at all is costed at the current buy order price instead.
function useForgeMaterial(name, quantity) {
    let cost = 0;
    let remaining = quantity;

    for (const holdingName of [name, name + FORGE_SUFFIX]) {
        if (remaining <= 0) break;
        if (product_list[holdingName] === undefined) continue;

        const investmentType = getInvestmentType(product_list[holdingName]["type"]);
        const holding = trader_data[investmentType][holdingName];
        if (holding === undefined) continue;

        const subOrders = holding["sub-orders"];
        subOrders.sort((a, b) => subOrderUnitCost(b) - subOrderUnitCost(a));

        let taken = 0;
        while (remaining > 0 && subOrders.length > 0) {
            const subOrder = subOrders[0];
            const used = Math.min(remaining, subOrder["partial-amount"]);
            cost += used * subOrderUnitCost(subOrder);
            subOrder["partial-amount"] -= used;
            remaining -= used;
            taken += used;
            if (subOrder["partial-amount"] <= 0) subOrders.shift();
        }

        if (subOrders.length === 0) delete trader_data[investmentType][holdingName];
        if (trader_data["all-products"][holdingName] !== undefined) {
            trader_data["all-products"][holdingName]["current-amount"] -= taken;
        }
    }

    if (remaining > 0) {
        const unitPrice = forgeMaterialPrice(name);
        consoleWarn(`Forge: ${remaining}x ${name} was not in investments, costing it at ${unitPrice} each`);
        cost += remaining * unitPrice;
    }

    return cost;
}

function subOrderUnitCost(subOrder) {
    return subOrder["price-bought"] ?? subOrder["price-crafted"] ?? 0;
}

// Buy order price off the Bazaar (the dashboard's buy order cost), else lowest BIN.
function forgeMaterialPrice(name) {
    const apiName = product_list[name]?.["api-name"];
    const product = apiName ? bazaar_data[apiName] : undefined;
    if (product) return product["sell_summary"]?.[0]?.["pricePerUnit"] ?? product["quick_status"]?.["sellPrice"] ?? 0;

    return marketData.lowestBinPrices[normalizeName(name, product_list[name]?.["tier"])] ?? 0;
}

// Mirrors the dashboard's getCraftingMarketValue for a forge recipe: a "(forge)"
// product with a Bazaar listing is valued at its insta-sell price, anything else
// at its lowest BIN.
function forgeMarketValue(recipeName) {
    const entry = product_list[recipeName];
    const apiName = entry?.["api-name"];
    const product = apiName ? bazaar_data[apiName] : undefined;

    if (product) {
        const sellPrice = product["sell_summary"]?.[0]?.["pricePerUnit"] ?? 0;
        const buyPrice = product["buy_summary"]?.[0]?.["pricePerUnit"] ?? 0;
        if (recipeName.includes('forge')) return sellPrice;
        if (buyPrice !== 0) return buyPrice;
    }

    // Auction data is keyed by display name, never by api name.
    const displayName = recipeName.endsWith(FORGE_SUFFIX) ? recipeName.slice(0, -FORGE_SUFFIX.length) : recipeName;
    return marketData.lowestBinPrices[normalizeName(displayName, entry?.["tier"])] ?? 0;
}

// Whether any of a product's stock came out of the forge.
function hasForgeStock(name) {
    for (const investmentType of ["long-term-investments", "short-term-investments"]) {
        if (trader_data[investmentType][name]?.["sub-orders"]?.some(subOrder => subOrder["source"] === "forge")) return true;
    }
    return false;
}

// Which daily profit bucket a sale belongs in: forge for anything that came out of
// the forge, otherwise whatever the sale itself was.
function profitTypeOf(lot, saleType) {
    return lot?.["source"] === "forge" ? "forge" : saleType;
}

let bazaar_data = {};
let auction_data = [];

const update_seconds = 30;
setInterval(updateBazaarData, update_seconds * 1000);

// Rolling per-product history used to compute real 1h/6h/24h volume and new-listing
// rates, since Hypixel's quick_status only gives a 7-day rolling total and a current
// order count (not a listings-created rate). Each tick diffs the live order book
// (sell_summary/buy_summary) against the previous tick's snapshot: a price tier whose
// amount shrank, or that vanished entirely, means that quantity got traded (volume); a
// price tier whose order count grew, or that's brand new, means new orders were listed
// (new listings). Sampled every minute for finer granularity, at the cost of more
// memory - each product keeps up to ~25h of per-minute deltas instead of ~25h of 5-min
// deltas.
const BAZAAR_HISTORY_SAMPLE_INTERVAL_MS = 1 * 60 * 1000; // one sample per minute
const BAZAAR_HISTORY_RETENTION_MS = 25 * 60 * 60 * 1000; // a little over 24h of samples
const bazaarHistory = new Map(); // productId -> [{ timestamp, sellVolumeTick, buyVolumeTick, sellNewListingsTick, buyNewListingsTick, sellMovingWeek, buyMovingWeek }]
const lastOrderBook = new Map(); // productId -> { sell: sell_summary array, buy: buy_summary array } from the previous tick, for diffing only - not retained as history
let lastHistorySampleTime = 0;

function roundPrice(price) {
    return Math.round(price * 10) / 10;
}

// Diffs one side of the order book (an array of {pricePerUnit, amount, orders}) between
// two ticks. A shrunk price tier's decrease is counted as traded volume. A vanished
// tier is deliberately NOT counted as fully traded - Hypixel's summary only exposes the
// top ~20 price tiers, so at 1-minute granularity a tier disappearing usually means it
// got pushed out of that visible window by repricing/competition, not that it was
// consumed. Measured against volume_7_day, counting vanished tiers as full volume
// overcounted by up to ~40x; dropping it undercounts real full-consumption events
// instead (a smaller, safer error than the alternative). A grown price tier's
// order-count increase, or a brand-new tier's order count, is counted as new listings.
function diffOrderBookSide(oldEntries, newEntries) {
    const oldByPrice = new Map();
    for (const entry of oldEntries || []) oldByPrice.set(roundPrice(entry.pricePerUnit), entry);
    const newByPrice = new Map();
    for (const entry of newEntries || []) newByPrice.set(roundPrice(entry.pricePerUnit), entry);

    let volume = 0;
    for (const [price, oldEntry] of oldByPrice) {
        const newEntry = newByPrice.get(price);
        if (newEntry && newEntry.amount < oldEntry.amount) {
            volume += oldEntry.amount - newEntry.amount;
        }
    }

    let newListings = 0;
    for (const [price, newEntry] of newByPrice) {
        const oldEntry = oldByPrice.get(price);
        if (!oldEntry) {
            newListings += newEntry.orders;
        } else if (newEntry.orders > oldEntry.orders) {
            newListings += newEntry.orders - oldEntry.orders;
        }
    }

    return { volume, newListings };
}

function recordBazaarHistorySnapshot(products, now) {
    for (const [productId, product] of Object.entries(products)) {
        const quickStatus = product.quick_status;
        if (!quickStatus) continue;

        const sellBook = product.sell_summary || [];
        const buyBook = product.buy_summary || [];
        const previousBook = lastOrderBook.get(productId);

        let sellVolumeTick = 0, buyVolumeTick = 0, sellNewListingsTick = 0, buyNewListingsTick = 0;
        if (previousBook) {
            const sellDiff = diffOrderBookSide(previousBook.sell, sellBook);
            const buyDiff = diffOrderBookSide(previousBook.buy, buyBook);
            sellVolumeTick = sellDiff.volume;
            sellNewListingsTick = sellDiff.newListings;
            buyVolumeTick = buyDiff.volume;
            buyNewListingsTick = buyDiff.newListings;
        }
        lastOrderBook.set(productId, { sell: sellBook, buy: buyBook });

        let history = bazaarHistory.get(productId);
        if (!history) {
            history = [];
            bazaarHistory.set(productId, history);
        }

        history.push({
            timestamp: now,
            sellVolumeTick,
            buyVolumeTick,
            sellNewListingsTick,
            buyNewListingsTick,
            sellMovingWeek: quickStatus.sellMovingWeek || 0,
            buyMovingWeek: quickStatus.buyMovingWeek || 0,
        });

        while (history.length > 0 && now - history[0].timestamp > BAZAAR_HISTORY_RETENTION_MS) {
            history.shift();
        }
    }
}

// --- Price history for exit-price forecasting (issue #3) ---------------------
// bazaar-trend-data.json tracks volume only. This logs insta buy/sell prices so
// a model can later learn how a product's price drifts over the ~8h a buy-flip
// is held. Written to its own append-only JSONL (never into the trend file, which
// is already huge) and sampled coarsely - an 8h drift needs nothing finer than
// 15 min. This is the resilient backup to optimizer/labeled_data_logger.py: it
// runs on the always-on bazaar poll, so price history keeps accruing even if that
// separate logger dies. One line per sample:
//   {"t": <ms>, "p": {<productId>: [buyPrice, sellPrice], ...}}
const priceHistoryPath = path.join(__dirname, '..', 'data', 'price-history.jsonl');
const PRICE_HISTORY_SAMPLE_INTERVAL_MS = 15 * 60 * 1000;
let lastPriceSampleTime = 0;

function recordPriceSnapshot(products, now) {
    const prices = {};
    for (const [productId, product] of Object.entries(products)) {
        const quickStatus = product.quick_status;
        if (!quickStatus) continue;
        const buy = quickStatus.buyPrice, sell = quickStatus.sellPrice;
        if (!buy || !sell || buy <= 0 || sell <= 0) continue;
        prices[productId] = [Math.round(buy * 10) / 10, Math.round(sell * 10) / 10];
    }
    fs.appendFile(priceHistoryPath, JSON.stringify({ t: now, p: prices }) + '\n', (err) => {
        if (err) console.error('Error appending to price history:', err);
    });
}

// Sums a per-tick field (e.g. sellVolumeTick) across the trailing `hoursAgo` window.
// Returns null if the retained history doesn't yet cover close to that long - e.g.
// right after a restart, with only a few minutes of ticks recorded, summing that
// partial window and calling it a 24-hour (or 6-hour, or 1-hour) total would badly
// understate the true rate rather than just being imprecise.
function sumOverWindow(history, hoursAgo, field) {
    if (!history || history.length < 2) return null;

    const latest = history[history.length - 1];
    const oldest = history[0];
    const coveredHours = (latest.timestamp - oldest.timestamp) / (60 * 60 * 1000);
    if (coveredHours < hoursAgo * 0.8) return null;

    const windowStart = latest.timestamp - hoursAgo * 60 * 60 * 1000;
    let sum = 0;
    for (const entry of history) {
        if (entry.timestamp > windowStart) sum += entry[field] || 0;
    }
    return sum;
}

// EMAs used as a "typical past" baseline for the three trend weights (7-day
// volume, 24-hour volume, new-listings/hour), maintained per product and updated
// on the same 5-minute tick as bazaarHistory. Using an EMA instead of storing raw
// history for this means constant memory per product forever, rather than a log
// that grows with time. Memory lengths are starting points, not tuned.
const SAMPLES_PER_HOUR = 60 * 60 * 1000 / BAZAAR_HISTORY_SAMPLE_INTERVAL_MS;
const SEVEN_DAY_VOLUME_EMA_SAMPLES = 4 * 7 * 24 * SAMPLES_PER_HOUR; // ~4 weeks: slow, catches multi-week trend
const TWENTY_FOUR_HOUR_VOLUME_EMA_SAMPLES = 7 * 24 * SAMPLES_PER_HOUR; // ~1 week
const NEW_LISTINGS_EMA_SAMPLES = 2 * 7 * 24 * SAMPLES_PER_HOUR; // ~2 weeks

const TREND_WEIGHT_MIN = 0.5;
const TREND_WEIGHT_MAX = 2;

const bazaarEma = new Map(); // productId -> { sellVolume7d, buyVolume7d, sellVolume24h, buyVolume24h, newSellListings, newBuyListings }

// bazaarEma is the "typical past" baseline the trend weights compare against, and
// the slowest of the three (SEVEN_DAY_VOLUME_EMA_SAMPLES) takes ~4 weeks to converge.
// Without persisting it, every restart would reset every weight to neutral (1) and
// the anomaly protection those weights exist for would go blind for weeks at a time.
// bazaarHistory is persisted alongside it since it's cheap to include and lets the
// 1h/6h/24h rates (sumOverWindow) stay populated across a restart too, instead of
// returning null for the first ~24h while it re-accumulates.
const bazaarTrendDataPath = path.join(__dirname, '..', 'data', 'bazaar-trend-data.json');
const BAZAAR_TREND_SAVE_INTERVAL_MS = 5 * 60 * 1000; // this data doesn't need to be real-time on disk

function loadBazaarTrendData() {
    let raw;
    try {
        raw = fs.readFileSync(bazaarTrendDataPath, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('Error reading bazaar-trend-data.json, starting with empty trend history:', err);
        return;
    }

    try {
        const parsed = JSON.parse(raw);
        for (const [productId, history] of Object.entries(parsed.history || {})) bazaarHistory.set(productId, history);
        for (const [productId, ema] of Object.entries(parsed.ema || {})) bazaarEma.set(productId, ema);
        console.log(`Loaded persisted bazaar trend data: ${bazaarHistory.size} products with history, ${bazaarEma.size} with EMA baselines`);
    } catch (err) {
        console.error('Error parsing bazaar-trend-data.json, starting with empty trend history:', err);
    }
}

function saveBazaarTrendData() {
    const data = {
        history: Object.fromEntries(bazaarHistory),
        ema: Object.fromEntries(bazaarEma),
    };

    // Synchronous + atomic (write to temp, then rename) so a save either fully lands
    // or doesn't happen at all, and so it can be trusted to complete on process exit.
    const tempPath = bazaarTrendDataPath + '.tmp';
    try {
        fs.writeFileSync(tempPath, JSON.stringify(data));
        fs.renameSync(tempPath, bazaarTrendDataPath);
    } catch (err) {
        console.error('Error saving bazaar-trend-data.json:', err);
    }
}

loadBazaarTrendData();
setInterval(saveBazaarTrendData, BAZAAR_TREND_SAVE_INTERVAL_MS);
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        saveBazaarTrendData();
        process.exit();
    });
}

function emaAlpha(sampleCount) {
    return 2 / (sampleCount + 1);
}

function updateEma(previous, value, alpha) {
    if (value == null) return previous;
    if (previous == null) return value;
    return alpha * value + (1 - alpha) * previous;
}

function recordBazaarEmaSnapshot(products, volumeStats) {
    for (const productId of Object.keys(products)) {
        const quickStatus = products[productId].quick_status;
        if (!quickStatus) continue;

        let ema = bazaarEma.get(productId);
        if (!ema) {
            ema = {
                sellVolume7d: null, buyVolume7d: null,
                sellVolume24h: null, buyVolume24h: null,
                newSellListings: null, newBuyListings: null
            };
            bazaarEma.set(productId, ema);
        }

        const stats = volumeStats[productId] || {};
        const sellVolume24h = stats.sellVolumePerHour24h != null ? stats.sellVolumePerHour24h * 24 : null;
        const buyVolume24h = stats.buyVolumePerHour24h != null ? stats.buyVolumePerHour24h * 24 : null;

        ema.sellVolume7d = updateEma(ema.sellVolume7d, quickStatus.sellMovingWeek, emaAlpha(SEVEN_DAY_VOLUME_EMA_SAMPLES));
        ema.buyVolume7d = updateEma(ema.buyVolume7d, quickStatus.buyMovingWeek, emaAlpha(SEVEN_DAY_VOLUME_EMA_SAMPLES));
        ema.sellVolume24h = updateEma(ema.sellVolume24h, sellVolume24h, emaAlpha(TWENTY_FOUR_HOUR_VOLUME_EMA_SAMPLES));
        ema.buyVolume24h = updateEma(ema.buyVolume24h, buyVolume24h, emaAlpha(TWENTY_FOUR_HOUR_VOLUME_EMA_SAMPLES));
        ema.newSellListings = updateEma(ema.newSellListings, stats.newSellListingsPerHour, emaAlpha(NEW_LISTINGS_EMA_SAMPLES));
        ema.newBuyListings = updateEma(ema.newBuyListings, stats.newBuyListingsPerHour, emaAlpha(NEW_LISTINGS_EMA_SAMPLES));
    }
}

// current / baseline, clamped so one noisy or still-warming-up sample can't send
// the weight wild; neutral (1) until there's a real baseline to compare against.
function computeTrendWeight(current, baseline) {
    if (current == null || baseline == null || baseline <= 0) return 1;
    return Math.min(TREND_WEIGHT_MAX, Math.max(TREND_WEIGHT_MIN, current / baseline));
}

export function getVolumeStats() {
    const stats = {};
    for (const [productId, history] of bazaarHistory.entries()) {
        const sellVolume24hSum = sumOverWindow(history, 24, 'sellVolumeTick');
        const buyVolume24hSum = sumOverWindow(history, 24, 'buyVolumeTick');
        const sellVolumePerHour24h = sellVolume24hSum != null ? sellVolume24hSum / 24 : null;
        const buyVolumePerHour24h = buyVolume24hSum != null ? buyVolume24hSum / 24 : null;

        // new-listings rate is averaged over a trailing 6 hours instead of a single
        // hour, since raw per-tick listing counts are noisy from one hour to the next.
        const newSellListingsSum6h = sumOverWindow(history, 6, 'sellNewListingsTick');
        const newBuyListingsSum6h = sumOverWindow(history, 6, 'buyNewListingsTick');
        const newSellListingsPerHour = newSellListingsSum6h != null ? newSellListingsSum6h / 6 : null;
        const newBuyListingsPerHour = newBuyListingsSum6h != null ? newBuyListingsSum6h / 6 : null;

        const quickStatus = bazaar_data[productId]?.quick_status || {};
        const ema = bazaarEma.get(productId);

        stats[productId] = {
            sellVolumePerHour1h: sumOverWindow(history, 1, 'sellVolumeTick'),
            sellVolumePerHour24h,
            buyVolumePerHour1h: sumOverWindow(history, 1, 'buyVolumeTick'),
            buyVolumePerHour24h,
            newSellListingsPerHour,
            newBuyListingsPerHour,
            sellVolume7DayWeight: computeTrendWeight(quickStatus.sellMovingWeek, ema?.sellVolume7d),
            buyVolume7DayWeight: computeTrendWeight(quickStatus.buyMovingWeek, ema?.buyVolume7d),
            sellVolume24HourWeight: computeTrendWeight(sellVolumePerHour24h != null ? sellVolumePerHour24h * 24 : null, ema?.sellVolume24h),
            buyVolume24HourWeight: computeTrendWeight(buyVolumePerHour24h != null ? buyVolumePerHour24h * 24 : null, ema?.buyVolume24h),
            newSellListingsWeight: computeTrendWeight(newSellListingsPerHour, ema?.newSellListings),
            newBuyListingsWeight: computeTrendWeight(newBuyListingsPerHour, ema?.newBuyListings),
        };
    }
    return stats;
}

// Node's fetch throws a bare TypeError with the real reason nested in `cause`
// (DNS failures, connection refused, timeouts, etc.) - printing that whole
// object dumps a multi-line stack trace for what's usually just a transient
// network blip. Collapse those specific cases to one line; anything else
// (a genuine bug) still gets logged in full so it isn't silently flattened.
function formatFetchError(e) {
    if (e instanceof TypeError && e.cause?.code) {
        return `network error (${e.cause.code}${e.cause.hostname ? ' ' + e.cause.hostname : ''})`;
    }
    return e;
}

async function updateBazaarData() {
    try {
        const response = await fetchHypixel("https://api.hypixel.net/v2/skyblock/bazaar");
        if (!response) return; // paused after a 403
        if (!response.ok) {
            console.error(`Bazaar fetch failed: ${response.status} ${response.statusText}`);
            return;
        }
        bazaar_data = await response.json();
        marketData.lastUpdated.bazaar = bazaar_data.lastUpdated;
        bazaar_data = bazaar_data['products'];
        marketData.bazaarProducts = bazaar_data;

        const now = Date.now();
        if (now - lastHistorySampleTime >= BAZAAR_HISTORY_SAMPLE_INTERVAL_MS) {
            recordBazaarHistorySnapshot(bazaar_data, now);
            lastHistorySampleTime = now;
            recordBazaarEmaSnapshot(bazaar_data, getVolumeStats());
        }

        if (now - lastPriceSampleTime >= PRICE_HISTORY_SAMPLE_INTERVAL_MS) {
            recordPriceSnapshot(bazaar_data, now);
            lastPriceSampleTime = now;
        }

        new UpdateOrderFillAmounts().updateOrders();
    } catch (e) {
        console.error('Bazaar fetch failed:', formatFetchError(e));
    }
}

updateBazaarData();

const auctionUpdateSeconds = 300;
// How many auction pages are requested at once. Asking for every page together
// is the kind of burst Hypixel's Cloudflare front end answers with a 403.
const AUCTION_PAGE_CONCURRENCY = 4;
setInterval(updateAuctionData, auctionUpdateSeconds * 1000);
updateAuctionData();

// One page of auctions, or null when it failed or requests are paused.
async function fetchAuctionPage(page) {
    const response = await fetchHypixel(`https://api.hypixel.net/v2/skyblock/auctions?page=${page}`);
    if (!response) return null;
    if (!response.ok) {
        console.error(`Auction fetch (page ${page}) failed: ${response.status} ${response.statusText}`);
        return null;
    }
    return response.json();
}

async function updateAuctionData() {
    try {
        // Page 0 carries lastUpdated and totalPages, so it doubles as the overview.
        const firstPage = await fetchAuctionPage(0);
        if (!firstPage) return;

        const totalPages = firstPage.totalPages || 1;
        const allAuctions = [...(firstPage.auctions || [])];

        // A few workers each take the next page until none are left.
        let nextPage = 1;
        const worker = async () => {
            while (nextPage < totalPages && !hypixelPaused()) {
                const page = await fetchAuctionPage(nextPage++);
                if (page?.auctions) allAuctions.push(...page.auctions);
            }
        };
        await Promise.all(Array.from({ length: AUCTION_PAGE_CONCURRENCY }, worker));

        // A 403 part way through leaves the scan incomplete; keep the last full one.
        if (hypixelPaused()) return;

        marketData.lastUpdated.auctions = firstPage.lastUpdated;
        auction_data = allAuctions;
        marketData.lowestBinPrices = buildLowestBinPrices(allAuctions);
        binPriceLists = buildBinPriceLists(allAuctions);
    } catch (error) {
        console.error('Auction fetch failed:', formatFetchError(error));
    }
}

// Every BIN price per normalised name, cheapest first, so the mod can tell where
// a listing sits among the others for the same item.
let binPriceLists = {};

// The most prices sent per item; a listing past this is shown as off the ladder.
const BIN_LADDER_LENGTH = 100;

function buildBinPriceLists(auctions) {
    const lists = {};
    for (const auction of auctions) {
        if (!auction.bin || !auction.item_name) continue;
        if (auction.item_lore.includes('§k')) continue;
        const normalizedName = normalizeName(auction.item_name, auction.item_name === 'Beastmaster Crest' ? auction.tier : null);
        const price = auction.starting_bid || 0;
        if (!normalizedName || !price) continue;
        (lists[normalizedName] ??= []).push(price);
    }
    for (const prices of Object.values(lists)) prices.sort((a, b) => a - b);
    return lists;
}

// The BIN price ladders of the items the trader has up for auction, keyed the same
// way as lowestBinPrices. Only these are sent; the full set is far too big.
export function getBinLadders() {
    const ladders = {};
    for (const auction of trader_data["auction-house-overview"]?.["auctions"] ?? []) {
        if (auction["sold"]) continue;
        const name = auction["item-name"] || '';
        const baseName = name.replace(/ - .+$/, '');
        const tier = baseName === 'Beastmaster Crest' ? name.match(/ - (.+)$/)?.[1] : null;
        const key = normalizeName(baseName, tier);
        const prices = binPriceLists[key];
        if (prices && !ladders[key]) ladders[key] = prices.slice(0, BIN_LADDER_LENGTH);
    }
    return ladders;
}

function buildLowestBinPrices(auctions) {
    const prices = {};
    for (const auction of auctions) {
        if (!auction.bin || !auction.item_name) continue;
        if (auction.item_lore.includes('§k')) continue; // Skip items with obfuscated lore
        const normalizedName = normalizeName(auction.item_name, auction.item_name === 'Beastmaster Crest' ? auction.tier : null);
        const price = auction.starting_bid || 0;
        if (!normalizedName || !price) continue;

        if (prices[normalizedName] == null || price < prices[normalizedName]) {
            prices[normalizedName] = price;
        }
    }

    return prices;
}

export function normalizeName(name, tier) {
    return String(name || '')
        .replace(/§./g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/ - .+$/, '') // Remove existing rarity
        .toLowerCase() + (tier ? ` - ${tier}` : '');
}

// Export the Main class for use in other modules
export default Main;

// price floats incorrect
class UpdateOrderFillAmounts {
    constructor() { }
    updateOrders() {
        const sellOrders = trader_data["sell-order-overview"]["sell-orders"];
        for (const sellOrderIndex in sellOrders) this.updateSellOrderFillAmount(sellOrderIndex, sellOrders);

        const buyOrders = trader_data["buy-order-overview"]["buy-orders"];
        for (const buyOrderIndex in buyOrders) this.updateBuyOrderFillAmount(buyOrderIndex, buyOrders);

        const longTermInvestments = trader_data["long-term-investments"];
        for (const investmentName in longTermInvestments) this.checkForAllProductAndInvestmentMatches(investmentName);

        const shortTermInvestments = trader_data["short-term-investments"];
        for (const investmentName in shortTermInvestments) {
            this.checkForAllProductAndInvestmentMatches(investmentName);
            // this.makeShortTermInvestmentLongTerm(investmentName);
        }

        saveTraderData();
    }
    updateSellOrderFillAmount(sellOrderIndex, sellOrders) {
        const sellOrder = sellOrders[sellOrderIndex];
        const apiName = product_list[sellOrder["item-name"]]["api-name"];
        const sellSummary = bazaar_data[apiName]["buy_summary"];

        // check the price range and if it is already filled
        // if (sellOrder["total-selling-amount"] === this.findTotalSold(sellOrder)) return ('Sell order already filled', sellOrder);

        if (sellOrder["has-been-filled"]) return ('Sell order has been filled', sellOrder);

        if (sellSummary.length === 0) return ('No sell summary found for item', sellOrder["item-name"]);

        if (sellOrder["price-sold"] < sellSummary[0]["pricePerUnit"]) return ('Price sold is under the selling range', sellOrder);

        if (sellOrder["price-sold"] > sellSummary[sellSummary.length - 1]["pricePerUnit"]) return ('Price sold is over the selling range', sellOrder);

        let sell_order_sell_summary_index = -1;

        for (const sellOrderIndex in sellSummary) {
            const sellOrderSummary = sellSummary[sellOrderIndex];
            if (Math.round(sellOrderSummary["pricePerUnit"] * 10) / 10 === Math.round(sellOrder["price-sold"] * 10) / 10) {
                sell_order_sell_summary_index = sellOrderIndex;
                break;
            }
        }

        const previousSoldTotal = this.findTotalSold(sellOrder);

        if (sell_order_sell_summary_index === -1) {
            const amountSold = sellOrder["total-selling-amount"];

            trader_data["sell-order-overview"]["sell-orders"][sellOrderIndex] = this.updateSellOrderTraderData(amountSold, sellOrder);
            if (amountSold !== previousSoldTotal) {
                logOrderProgress("sell", sellOrder["item-name"], sellOrder["sell-order-place-time"], amountSold);
            }

            return 'Completed the amount update for the sell order';
        }

        if (sellSummary[sell_order_sell_summary_index]["orders"] > 1) return ('Sell order has multi order, not updating', sellOrder);

        const amountLeftOnSellOrder = sellSummary[sell_order_sell_summary_index]["amount"];
        const rawAmountSold = sellOrder["total-selling-amount"] - amountLeftOnSellOrder;
        // The matched order-book tier can belong to a different player's order resting
        // at the same price (e.g. bazaar_data is up to 3s stale right after placing, or
        // another order coincidentally lands on the same price) - clamp so a bad read
        // can't push the sold amount backwards or past the order's own size.
        const amountSold = Math.min(sellOrder["total-selling-amount"], Math.max(previousSoldTotal, rawAmountSold));

        trader_data["sell-order-overview"]["sell-orders"][sellOrderIndex] = this.updateSellOrderTraderData(amountSold, sellOrder);
        if (amountSold !== previousSoldTotal) {
            logOrderProgress("sell", sellOrder["item-name"], sellOrder["sell-order-place-time"], amountSold);
        }

        return 'Completed the amount update for the sell order';
    }
    findTotalSold(sellOrder) {
        const subOrders = sellOrder["sub-orders"];

        let current_total = 0;

        for (const subOrder of subOrders) {
            current_total += subOrder["partial-sold-amount"]
        }

        return current_total;
    }
    updateSellOrderTraderData(amountSold, sellOrder) {
        sellOrder["sub-orders"] = new Sort(sellOrder["sub-orders"], false, "price-bought");

        const subOrders = sellOrder["sub-orders"];

        for (const subOrderIndex in subOrders) {
            const subOrder = subOrders[subOrderIndex];
            if (subOrder["partial-selling-amount"] > amountSold) {
                sellOrder["sub-orders"][subOrderIndex]["partial-sold-amount"] = amountSold;
                amountSold = 0;
            } else {
                sellOrder["sub-orders"][subOrderIndex]["partial-sold-amount"] = subOrder["partial-selling-amount"];
                amountSold -= subOrder["partial-selling-amount"];
            }

            if (sellOrder["sub-orders"][subOrderIndex]["partial-sold-amount"] < 0) console.error('ERROR: Partial sold amount is less than 0, this should not happen: ', subOrderIndex, sellOrder["item-name"], sellOrder["price-sold"], amountSold);
            if (amountSold === 0) break;
        }

        return sellOrder;
    }
    updateBuyOrderFillAmount(buyOrderIndex, buyOrders) {
        const buyOrder = buyOrders[buyOrderIndex];
        const apiName = product_list[buyOrder["item-name"]]["api-name"];
        const buySummary = bazaar_data[apiName]["sell_summary"];

        // check the price range and if it is already filled
        // if (buyOrder["buying-amount"] === buyOrder["bought-amount"]) return ('Buy order already filled', buyOrder);

        if (buyOrder["has-been-filled"]) return ('Buy order has been filled', buyOrder);

        if (buySummary.length === 0) return ('No buy summary found for item', buyOrder["item-name"]);

        if (buyOrder["price-buying"] < buySummary[buySummary.length - 1]["pricePerUnit"]) return ('Price buying is under the buying range', buyOrder);

        if (buyOrder["price-buying"] > buySummary[0]["pricePerUnit"]) return ('Price buying is over the buying range', buyOrder);

        let buy_order_buy_summary_index = -1;

        for (const buyOrderIndex in buySummary) {
            const buyOrderSummary = buySummary[buyOrderIndex];
            // round the price to 1 decimal place to avoid floating point issues
            if (Math.round(buyOrderSummary["pricePerUnit"] * 10) / 10 === Math.round(buyOrder["price-buying"] * 10) / 10) {
                buy_order_buy_summary_index = buyOrderIndex;
                break;
            }
        }

        const previousBoughtAmount = buyOrder["bought-amount"];

        if (buy_order_buy_summary_index === -1) {
            const amountSold = buyOrder["buying-amount"];

            trader_data["buy-order-overview"]["buy-orders"][buyOrderIndex]["bought-amount"] = amountSold;
            if (amountSold !== previousBoughtAmount) {
                logOrderProgress("buy", buyOrder["item-name"], buyOrder["buy-order-place-time"], amountSold);
            }

            return 'Completed the amount update for the buy order';
        }

        if (buySummary[buy_order_buy_summary_index]["orders"] > 1) return ('Buy order has multi order, not updating', buyOrder);

        const amountLeftOnBuyOrder = buySummary[buy_order_buy_summary_index]["amount"];
        const rawAmountSold = buyOrder["buying-amount"] - amountLeftOnBuyOrder;
        // The matched order-book tier can belong to a different player's order resting
        // at the same price (e.g. bazaar_data is up to 3s stale right after placing, or
        // another order coincidentally lands on the same price) - clamp so a bad read
        // can't push the bought amount backwards or past the order's own size.
        const amountSold = Math.min(buyOrder["buying-amount"], Math.max(previousBoughtAmount, rawAmountSold));

        trader_data["buy-order-overview"]["buy-orders"][buyOrderIndex]["bought-amount"] = amountSold;
        if (amountSold !== previousBoughtAmount) {
            logOrderProgress("buy", buyOrder["item-name"], buyOrder["buy-order-place-time"], amountSold);
        }

        return 'Completed the amount update for the buy order';
    }
    checkForAllProductAndInvestmentMatches(itemName) {
        // make sure that for a given item, the total amount in all-products matches the total amount in long-term or short-term investments
        const allProductsAmount = trader_data["all-products"][itemName]?.["current-amount"];
        const shortTermAmount = trader_data["short-term-investments"][itemName]?.["sub-orders"].reduce((acc, subOrder) => acc + subOrder["partial-amount"], 0) || 0
        const longTermAmount = trader_data["long-term-investments"][itemName]?.["sub-orders"].reduce((acc, subOrder) => acc + subOrder["partial-amount"], 0) || 0;
        const investmentAmount = shortTermAmount + longTermAmount;
        if (allProductsAmount !== investmentAmount) {
            console.error(`ERROR: Amount mismatch for item ${itemName}. All products: ${allProductsAmount}, Investment: ${investmentAmount}`);
        }
    }
    makeShortTermInvestmentLongTerm(itemName) {
        // move an investment into long term if conditions is met (it is a short term invesment, it has been 6 days, and its worth more than 10 million)
        const investmentType = getInvestmentType(product_list[itemName]["type"]);
        if (investmentType !== "short-term-investments") return (`ERROR: Item ${itemName} is not a short term investment`);
        const subOrders = trader_data[investmentType][itemName]["sub-orders"];
        const currentTime = Date.now();

        // Check if it has been 5 days since the investment was made
        for (const subOrder of subOrders) {
            const timeSinceBought = currentTime - subOrder["time-bought"];
            const sixDaysInMilliseconds = 5 * 24 * 60 * 60 * 1000;

            if (timeSinceBought >= sixDaysInMilliseconds) {
                // Check if the investment is worth more than 5 million
                const priceBought = subOrder["price-bought"];
                const orderWorth = priceBought * subOrder["partial-amount"];

                if (orderWorth > 5_000_000) {
                    // Move the investment to long term
                    if (!trader_data["long-term-investments"][itemName]) {
                        trader_data["long-term-investments"][itemName] = {
                            "type": product_list[itemName]["type"],
                            "sub-orders": []
                        };
                    }
                    trader_data["long-term-investments"][itemName]["sub-orders"].push(subOrder);

                    // Remove the investment from short term
                    const index = trader_data[investmentType][itemName]["sub-orders"].indexOf(subOrder);
                    if (index > -1) {
                        trader_data[investmentType][itemName]["sub-orders"].splice(index, 1);
                    }

                    // if there is no more sub-orders for this item, remove it from short-term investments
                    if (trader_data[investmentType][itemName]["sub-orders"].length === 0) {
                        delete trader_data[investmentType][itemName];
                    }

                    console.log(`Moved ${itemName} suborder ${subOrder} from short term to long term investment.`);
                }
            }
        }
    }
}