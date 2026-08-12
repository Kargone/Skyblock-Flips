import { EventEmitter } from 'events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// // Import the functions you need from the SDKs you need
// import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js'
// // TODO: Add SDKs for Firebase products that you want to use
// // https://firebase.google.com/docs/web/setup#available-libraries

// // Your web app's Firebase configuration
// const firebaseConfig = {
//     apiKey: "AIzaSyDrWRQ8CY4Saxuyuyq0Gh8Px6e1tIH0zFg",
//     authDomain: "skyblock-flips.firebaseapp.com",
//     projectId: "skyblock-flips",
//     storageBucket: "skyblock-flips.appspot.com",
//     messagingSenderId: "574210914225",
//     appId: "1:574210914225:web:d1d543d3d2867edb4aaf90"
// };

// // Initialize Firebase
// const app = initializeApp(firebaseConfig);

// let trader_data = {
//     "username": "Kargone",
//     "sell-order-overview": {
//         "sell-orders": []
//     },
//     "buy-order-overview": {
//         "buy-orders": []
//     },
//     "short-term-investments": {},
//     "long-term-investments": {},
//     "auction-house-overview": {
//         "auctions": []
//     },
//     "forge": [],
//     "all-products": {},
//     "daily-profits": {}
// };

import product_list from './product-list.json' with { type: "json" };

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
    "Golden Plate",
    "Mana Vampire V",
    "Spirit Leap",
    "Soulflow",
    "Super Compactor 3000",
    "Strong Dragon Fragment",
    "Enchanted Bone",
    "Enchanted Hay Bale",
    "Unstable Dragon Fragment",
    "Young Dragon Fragment",
    "Enchanted Sugar",
    "Rusty Coin",
    "Ethereal Vine",
    "Hot Potato Book",
    "Iron Ingot",
    "Red Mushroom",
    "Brown Mushroom",
    "Power VI",
    "Enchanted Carrot",
    "Poisonous Potato",
    "Enchanted Golden Carrot",
    "Wolf Tooth",
    "Enchanted Pumpkin",
    "Mutant Nether Wart",
    "Enchanted Brown Mushroom",
    "Titanic Experience Bottle",
    "Scorched Books",
    "Enchanted Sugar Cane",
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
    "Enchanted Rotten Flesh",
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
];

const IGNORE_INSTA_BUY = [
    "Polished Pumpkin",
    "Plant Matter",
];

const IGNORE_INSTA_SELL = [
    "Enchanted Rotten Flesh",
];

const ALLOW_INSTA_SELL_BUY = [
];

// Load trader_data manually so we can modify and write it back
const traderDataPath = path.join(__dirname, 'trader-data.json');
let trader_data;

try {
    const data = fs.readFileSync(traderDataPath, 'utf8');
    trader_data = JSON.parse(data);
} catch (err) {
    console.error('Error loading trader data:', err);
    trader_data = {
        "username": "Kargone",
        "sell-order-overview": { "sell-orders": [] },
        "buy-order-overview": { "buy-orders": [] },
        "short-term-investments": {},
        "long-term-investments": {},
        "auction-house-overview": { "auctions": [] },
        "forge": [],
        "all-products": {},
        "daily-profits": {}
    };
}

class Main extends EventEmitter {
    constructor() {
        super();
        this.listenForTrades();
    }
    listenForTrades() {
        // Listen for 'tradeMessage' events and process them
        this.on('tradeMessage', (tradeMessage) => {
            try {
                const trade = new ProcesTrade(tradeMessage);
                // console.log(`Successfully processed trade: ${tradeMessage}`);
            } catch (error) {
                console.error(`Error processing trade message: ${error}`);
            }
        });
        console.log('Trade listener initialized');
    }
    // Public method for HTTP server or other sources to submit trade messages
    submitTrade(tradeMessage) {
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
        if (this.message.includes('[Bazaar] Bought')) {
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
            result = this.sellOrderSetup(amount, Math.round(totalPrice / amount / 0.99 * 10) / 10, nameString);
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
        } else if (this.message.includes('You collected')) {
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
        } else if (
            this.message.includes('Claiming order...') ||
            this.message.includes('Putting goods in escrow...') ||
            this.message.includes('Submitting sell offer...') ||
            this.message.includes('Cancelling order...') ||
            this.message.includes('Executing instant sell...') ||
            this.message.includes('Submitting buy order...') ||
            this.message.includes('You cancelled the trade!') ||
            this.message.includes('Executing instant buy...') ||
            this.message.includes('BIN Auction started for') ||
            this.message.includes('You canceled your auction for') ||
            this.message.includes('You don\'t have anything to sell!')
        ) {
            result = 'Nontrade message';
            return "Nontrade message: " + this.message;
        } else {
            return consoleError('ERROR: Invalid trade message: ' + this.message);
        }

        if (result.includes('ERROR')) {
            return consoleError('ERROR: ' + result + ' for trade message: ' + this.message);
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

        if (trader_data["all-products"][name]["buy-order-stats"]["total-buy-orders-created"] === 0 &&
            trader_data["all-products"][name]["sell-order-stats"]["total-sell-orders-created"] === 0 &&
            !this.isItemInCraftingRecipe(name)) {
            // consoleError('ERROR: Product is not in a crafting recipe and has no buy or sell orders: ' + name);
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
                    return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees) + " & Insta sell completed";
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
                        return this.addProfit(subOrder["partial-amount"], name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees) + " & Insta sell completed";
                    } else {
                        amount -= subOrder["partial-amount"];

                        // just remove the suborder
                        trader_data[invesmentType][name]["sub-orders"].splice(0, 1);

                        // calculate the profit for just this sell order
                        const date_bought = subOrder["time-bought"];

                        trader_data["all-products"][name]["current-amount"] -= subOrder["partial-amount"];
                        this.addProfit(subOrder["partial-amount"], name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees);
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
        if (type === 'bazaar' && doFees) {
            const bazaarFeesPerUnit = sell_price * 0.01;
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
        const bazaarFees = currentResellPrice * 0.01 * amount;

        // add the buy order
        trader_data['buy-order-overview']['buy-orders'].push({
            "item-name": name,
            "bought-amount": 0,
            "buying-amount": amount,
            "price-buying": price,
            "projected-profit": Math.round((currentResellPrice - price) * amount - bazaarFees),
            "has-been-claimed": false,
            "has-been-filled": false,
            "buy-order-place-time": Date.now()
        });

        return 'Buy order setup completed';
    }
    buyOrderFill(amount, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the current buy orders
        const buyOrders = trader_data['buy-order-overview']['buy-orders'];

        // find a current buy order that matches the name and buying amount as an order already placed
        for (let buyOrderIndex = 0; buyOrderIndex < buyOrders.length; buyOrderIndex++) {
            const buyOrder = buyOrders[buyOrderIndex];
            if (buyOrder["item-name"] === name &&
                buyOrder["buying-amount"] === amount) {
                // alter the bought and buying amounts to reflect that the order has filled
                trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["has-been-filled"] = true;
                trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["bought-amount"] =
                    copy(trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["buying-amount"]);

                return 'Buy order filling completed';
            }
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
        const removedOrder = trader_data['buy-order-overview']['buy-orders'].splice(buyOrderIndex, 1);

        if (!(removedOrder["buying-amount"] === 0 || removedOrder["buying-amount"] === removedOrder["bought-amount"])) console.error("Strange, the buy order being cancelled has a bought amount that is not 0 or equal to the buying amount. This should not happen. The buy order is: ", removedOrder);

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

        const resellPrice = price;
        const invesmentType = getInvestmentType(product_list[name]["type"]);
        const sellOrderPlaceTime = Date.now();
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
                const bazaarFeesPerUnit = resellPrice * 0.01;
                const projectedProfitPerUnit = Math.round((resellPrice - investmentSubOrder["price-bought"] - bazaarFeesPerUnit) * 10) / 10;
                total_selling_amount += amount;
                sell_sub_orders.push({
                    "partial-sold-amount": 0,
                    "partial-selling-amount": amount,
                    "price-bought": investmentSubOrder["price-bought"],
                    "projected-profit": projectedProfitPerUnit * amount,
                    "time-bought": investmentSubOrder["time-bought"],
                    "sell-order-place-time": sellOrderPlaceTime
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

                    if (amount > 0) throw new Error('ERROR: Sell order setup requires more products then found in investments');

                    // add the new sub sell order
                    const bazaarFeesPerUnit = resellPrice * 0.01;
                    const projectedProfitPerUnit = Math.round((resellPrice - investmentSubOrder["price-bought"] - bazaarFeesPerUnit) * 10) / 10;
                    total_selling_amount += investmentSubOrder["partial-amount"];
                    sell_sub_orders.push({
                        "partial-sold-amount": 0,
                        "partial-selling-amount": investmentSubOrder["partial-amount"],
                        "price-bought": investmentSubOrder["price-bought"],
                        "projected-profit": projectedProfitPerUnit * investmentSubOrder["partial-amount"],
                        "time-bought": investmentSubOrder["time-bought"],
                        "sell-order-place-time": sellOrderPlaceTime
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
                    const bazaarFeesPerUnit = resellPrice * 0.01;
                    const projectedProfitPerUnit = Math.round((resellPrice - investmentSubOrder["price-bought"] - bazaarFeesPerUnit) * 10) / 10;
                    total_selling_amount += investmentSubOrder["partial-amount"];
                    sell_sub_orders.push({
                        "partial-sold-amount": 0,
                        "partial-selling-amount": investmentSubOrder["partial-amount"],
                        "price-bought": investmentSubOrder["price-bought"],
                        "projected-profit": projectedProfitPerUnit * investmentSubOrder["partial-amount"],
                        "time-bought": investmentSubOrder["time-bought"],
                        "sell-order-place-time": sellOrderPlaceTime
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
            "item-name": name,
            "price-sold": price,
            "earliest-time-bought": earliest_time_bought,
            "total-selling-amount": total_selling_amount,
            "has-been-claimed": false,
            "has-been-filled": false,
            "sell-order-place-time": sellOrderPlaceTime,
            "sub-orders": sell_sub_orders
        });

        return 'Sell order setup completed';
    }
    sellOrderFill(amount, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the current sell orders
        const sellOrders = trader_data['sell-order-overview']['sell-orders'];

        // find a current sell order that matches the name and selling amount as an order already placed
        for (let sellOrderIndex = 0; sellOrderIndex < sellOrders.length; sellOrderIndex++) {
            const sellOrder = sellOrders[sellOrderIndex];
            // console.log("Checking sell order: ", sellOrder, " against name: ", name, " and amount: ", amount);
            if (sellOrder["item-name"] === name &&
                sellOrder["total-selling-amount"] === amount) {
                
                sellOrder["has-been-filled"] = true;
                sellOrder["sub-orders"].map(subOrder => {
                    subOrder["partial-sold-amount"] = subOrder["partial-selling-amount"];
                });
                trader_data['sell-order-overview']['sell-orders'][sellOrderIndex] = sellOrder;

                // console.log("Filled sell order: ", trader_data['sell-order-overview']['sell-orders'][sellOrderIndex]);
                return 'Sell order filling completed';
            }
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

                return this.addProfit(amount, name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true) + " & Sell order claim completed";
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

                    return this.addProfit(subOrder["partial-selling-amount"], name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true) + " & Sell order claim completed";
                } else {
                    amount -= subOrder["partial-selling-amount"];

                    // just remove the suborder
                    trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].splice(0, 1);

                    // calculate the profit for just this sell order
                    const date_bought = subOrder["time-bought"];

                    addSellClaimToProducts(subOrder["partial-selling-amount"], name, subOrder["partial-selling-amount"], amount === 0);

                    this.addProfit(subOrder["partial-selling-amount"], name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true);
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
        const EPSILON = 0.05; // Threshold to handle standard JS floating-point issues

        // console.log(`🔍 Searching for nearest sell order: Name=${name}, Amount=${amount}, Price Sold=${price_sold}, Coins Earned=${coins_earned}, Has Decimal=${has_decimal}`);

        let sellOrders = new Sort(trader_data["sell-order-overview"]["sell-orders"], false, "sell-order-place-time");
        const actualPrice = (coins_earned / amount) / 0.99;

        const potentialMatches = sellOrders.filter(order => {
            const itemMatch = order["item-name"] === name;
            const remainingAmountMatch = order["total-selling-amount"] >= amount;
            // console.log(`Checking order: Name=${order["item-name"]}, Amount=${order["total-selling-amount"]}, Price=${order["price-sold"]} => Item Match: ${itemMatch}, Remaining Amount Match: ${remainingAmountMatch}`);
            return itemMatch && remainingAmountMatch;
        });

        // console.log(`Found ${potentialMatches} potential matches for sell order.`);
        let bestOrder = null;
        let smallestScore = Infinity;

        for (const order of potentialMatches) {
            // console.log(`🔍 Evaluating sell order: Name=${order["item-name"]}, Amount=${order["total-selling-amount"]}, Price=${order["price-sold"]}`);
            let isPriceMatch = false;
            let specializedPenalty = 0;
            const totalSoldAmount = order["sub-orders"].reduce((acc, subOrder) => acc + subOrder["partial-sold-amount"], 0);


            if (has_decimal) {
                // Case A: Chat explicitly has a decimal. Use strict near-exact matching.
                const priceDifference = Math.abs(order["price-sold"] - price_sold);
                if (priceDifference <= 0.15) {
                    isPriceMatch = true;
                    specializedPenalty = priceDifference < EPSILON ? 0 : priceDifference * 10000;
                }
            } else {
                // Case B: Chat lacks decimals (High Coinage). Use rounded matching with tie-breaker logic.
                // console.log(`Comparing rounded prices: DB=${order["price-sold"]}, Chat=${price_sold}`);
                // console.log(`Rounded DB Price: ${roundDown(order["price-sold"])}, Rounded Chat Price: ${roundDown(actualPrice)}, Chat Price Sold: ${price_sold}`);
                const dbRoundedPrice = roundDown(order["price-sold"]);
                if (dbRoundedPrice === roundDown(actualPrice) || Math.abs(order["price-sold"] - actualPrice) <= 0.15 || dbRoundedPrice === price_sold) {
                    isPriceMatch = true;

                    // Tie breaker: Calculate the difference between the underlying raw data fractions.
                    // We extract the fractional part (e.g. 26122.1 -> 0.1) to favor an exact matchup.
                    const decimalRemainder = Math.abs(order["price-sold"] - actualPrice);
                    specializedPenalty = decimalRemainder * 1000; // Scale to prioritize exact matches over rounded ones
                }
            }

            // If the price logic checks out, grade it alongside volume data
            if (isPriceMatch) {
                const volumeDifference = Math.abs(totalSoldAmount - amount);

                // Total score: Lowest score represents the absolute best match
                const currentScore = specializedPenalty + volumeDifference;
                // console.log(`Evaluated Order: Name=${order["item-name"]}, Price=${order["price-sold"]}, Amount=${order["total-selling-amount"]}, Score=${currentScore.toFixed(4)}`);

                if (currentScore < smallestScore) {
                    smallestScore = currentScore;
                    bestOrder = order;
                }
            }
        }

        if (bestOrder) {
            // console.log(`✅ Success! Linked to Order ID: ${name} (Database Entry Price was: ${bestOrder["price-sold"]})`); 
            // return the index of the best order in the original sellOrders array
            const bestOrderIndex = sellOrders.findIndex(order => order["price-sold"] === bestOrder["price-sold"]
                && order["item-name"] === bestOrder["item-name"]
                && order["total-selling-amount"] === bestOrder["total-selling-amount"]);
            return bestOrderIndex;
        } else {
            consoleWarn(`❌ Tracker mismatch: No database profiles fit the parsed pricing signature.`);
            return -1;
        }
    }
    sellOrderCancel(amount, name) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the current sell orders
        const sellOrders = trader_data["sell-order-overview"]["sell-orders"];

        // index that the sell order that was claimed will be at
        let current_sell_order_index = -1;

        // find the index of the sell order that was just claimed
        for (const sellOrderIndex of Object.keys(sellOrders)) {
            const sellOrder = sellOrders[sellOrderIndex];

            // total up the amount that is unsold for each suborder
            let totalUnsold = 0;
            for (const subSellOrderIndex of Object.keys(sellOrder["sub-orders"])) {
                totalUnsold += sellOrder["sub-orders"][subSellOrderIndex]["partial-selling-amount"];
            }

            // check that the unsold amounts and name are the same as the current sell order 
            if (sellOrder["item-name"] === name &&
                totalUnsold === amount) {
                current_sell_order_index = sellOrderIndex;
            }
        }
        if (current_sell_order_index === -1 || sellOrders.length === 0) throw new Error('ERROR: No sell order found to cancel');

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
            if (subSellOrder["partial-sold-amount"] != 0) consoleWarn("ERROR: Suborder has been partially sold, but the sell order is being cancelled. This should not happen. The suborder is: ", subSellOrder);

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
                        "time-bought": time_bought
                    });
                }
            } else {
                trader_data[invesmentType][name] = {
                    "type": product_list[name]["type"],
                    "sub-orders": [
                        {
                            "partial-amount": subSellOrder["partial-selling-amount"],
                            "price-bought": subSellOrder["price-bought"],
                            "time-bought": subSellOrder["time-bought"]
                        }
                    ]
                }
            }
        }

        trader_data["sell-order-overview"]["sell-orders"].splice(current_sell_order_index, 1);

        return 'Sell order cancelled';
    }
    orderFlipped(amount, name, profit) {
        if (Object.keys(product_list).indexOf(name) === -1) return 'ERROR: Product name not found in product list';

        // get the buy orders
        const buyOrders = trader_data["buy-order-overview"]["buy-orders"];
        let current_buy_order_index = -1;

        // go through each and find which one matches the flip
        for (const buyOrderIndex of Object.keys(buyOrders)) {
            const buyOrder = buyOrders[buyOrderIndex];
            if (buyOrder["item-name"] === name && buyOrder["buying-amount"] === amount) {
                current_buy_order_index = buyOrderIndex;
            }
        }
        if (current_buy_order_index === -1 || buyOrders.length === 0) throw new Error('ERROR: No buy order found to flip');

        const currentBuyOrder = buyOrders[current_buy_order_index];
        const priceBought = currentBuyOrder["price-buying"];
        const profitPerUnit = profit / amount;

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
            "time-crafted": removedInvestment["time-bought"]
        });

        trader_data["all-products"][name]["current-amount"] -= 1;

        return 'Auction created';

        function calcAuctionFee(price_not_sold) {
            if (price_not_sold > 100000000) {
                return price_not_sold * 0.025;
            } else if (price_not_sold > 10000000) {
                return price_not_sold * 0.02;
            } else {
                return price_not_sold * 0.01;
            }
        }
    }
    auctionClaim(price, name, detectedRarity) {
        name = this.fixRarity(name, detectedRarity);

        const priceSold = price / 0.99;

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
        const auctionFees = priceSold * 0.01;
        this.addProfit(1, name, removedAuction["material-cost"] + auctionFees, priceSold, removedAuction["date-placed"], Date.now(), false, "auction-house");

        return 'Auction claimed';
    }
    auctionCancel(name, detectedRarity) {
        name = this.fixRarity(name, detectedRarity);

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
                "time-bought": removedAuction["time-crafted"]
            });
        } else {
            trader_data["long-term-investments"][name] = {
                "type": "auction-product",
                "sub-orders": [
                    {
                        "partial-amount": 1,
                        "price-crafted": removedAuction["material-cost"],
                        "time-bought": removedAuction["time-crafted"]
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
            consoleWarn('ERROR: Auction not found to set sold for name: ' + name + ', price: ' + price);
            return 'ERROR: Auction not found to set sold';
        }

        trader_data["auction-house-overview"]["auctions"][current_auction_index]["sold"] = true;

        return 'Auction successfully set sold';
    }
    auctionBought(price, name, detectedRarity) {
        name = this.fixRarity(name, detectedRarity);

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
        this.auctionCancel(name, detectedRarity);

        return 'Auction successfully expired';
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

let bazaar_data = {};
let auction_data = [];

const update_seconds = 3;
setInterval(updateBazaarData, update_seconds * 1000);

async function updateBazaarData() {
    try {
        const response = await fetch("https://api.hypixel.net/v2/skyblock/bazaar");
        bazaar_data = await response.json();
        marketData.lastUpdated.bazaar = bazaar_data.lastUpdated;
        bazaar_data = bazaar_data['products'];
        marketData.bazaarProducts = bazaar_data;
        new UpdateOrderFillAmounts().updateOrders();
    } catch (e) {
        console.error('Fetch failed', e);
    }
}

updateBazaarData();

const auctionUpdateSeconds = 300;
setInterval(updateAuctionData, auctionUpdateSeconds * 1000);
updateAuctionData();

async function updateAuctionData() {
    try {
        const response = await fetch("https://api.hypixel.net/v2/skyblock/auctions");
        if (!response.ok) return;
        const data = await response.json();
        marketData.lastUpdated.auctions = await data.lastUpdated;

        const firstPageResponse = await fetch('https://api.hypixel.net/v2/skyblock/auctions?page=0');
        if (!firstPageResponse.ok) return;

        const firstPage = await firstPageResponse.json();
        const totalPages = firstPage.totalPages || 1;
        const allAuctions = [...(firstPage.auctions || [])];

        const pageRequests = [];
        for (let page = 1; page < totalPages; page += 1) {
            pageRequests.push(fetch(`https://api.hypixel.net/v2/skyblock/auctions?page=${page}`).then(response => response.ok ? response.json() : null));
        }

        const remainingPages = await Promise.all(pageRequests);
        for (const page of remainingPages) {
            if (page?.auctions) {
                allAuctions.push(...page.auctions);
            }
        }

        auction_data = allAuctions;
        marketData.lowestBinPrices = buildLowestBinPrices(allAuctions);
    } catch (error) {
        console.error('Auction fetch failed', error);
    }
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

function normalizeName(name, tier) {
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

        // Atomic write: write to temp file first, then rename to avoid corruption on read
        const tempPath = traderDataPath + '.tmp';
        fs.writeFile(
            tempPath,
            JSON.stringify(trader_data, null, 2),
            function (err) {
                if (err) {
                    console.error('Error writing temp trader data file:', err);
                } else {
                    // Atomic rename - replaces the original file
                    fs.rename(tempPath, traderDataPath, function (renameErr) {
                        if (renameErr) {
                            console.error('Error renaming temp file:', renameErr);
                        }
                    });
                }
            }
        );
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

        if (sell_order_sell_summary_index === -1) {
            const amountSold = sellOrder["total-selling-amount"];

            trader_data["sell-order-overview"]["sell-orders"][sellOrderIndex] = this.updateSellOrderTraderData(amountSold, sellOrder);

            return 'Completed the amount update for the sell order';
        }

        if (sellSummary[sell_order_sell_summary_index]["orders"] > 1) return ('Sell order has multi order, not updating', sellOrder);

        const amountLeftOnSellOrder = sellSummary[sell_order_sell_summary_index]["amount"];
        const amountSold = sellOrder["total-selling-amount"] - amountLeftOnSellOrder;

        trader_data["sell-order-overview"]["sell-orders"][sellOrderIndex] = this.updateSellOrderTraderData(amountSold, sellOrder);

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

            if (sellOrder["sub-orders"][subOrderIndex]["partial-sold-amount"] < 0) console.error('ERROR: Partial sold amount is less than 0, this should not happen', sellOrder, amountSold);
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

        if (buy_order_buy_summary_index === -1) {
            const amountSold = buyOrder["buying-amount"];

            trader_data["buy-order-overview"]["buy-orders"][buyOrderIndex]["bought-amount"] = amountSold;

            return 'Completed the amount update for the buy order';
        }

        if (buySummary[buy_order_buy_summary_index]["orders"] > 1) return ('Buy order has multi order, not updating', buyOrder);

        const amountLeftOnBuyOrder = buySummary[buy_order_buy_summary_index]["amount"];
        const amountSold = buyOrder["buying-amount"] - amountLeftOnBuyOrder;

        trader_data["buy-order-overview"]["buy-orders"][buyOrderIndex]["bought-amount"] = amountSold;

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