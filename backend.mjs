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

import product_list from './product-list.json' assert { type: 'json' };

let bazaar_data = {};
let trader_data = {
    "username": "",
    "sell-order-overview": {
        "sell-orders": []
    },
    "buy-order-overview": {
        "buy-orders": []
    },
    "short-term-investments": {},
    "long-term-investments": {},
    "auction-house-overview": {
        "auction-house": []
    },
    "forge": [],
    "all-products": {
        "item-name": {
            "total-amount": 0,
            "buy-weight": 0,
            "sell-weight": 0,
            "max-amount": 0,
            "total-profit-made": 0,
            "total-sold": 0,
            "crafting-materials": {
                "item-name": {
                    "amount": 0
                }
            }
        }
    },
    "daily-profits": {
        "date": {
            "daily-profit": 0,
            "forge-profit": 0,
            "auction-house-profit": 0,
            "bazaar-profit": 0,
            "trades": {
                "item-name": {
                    "count": 0,
                    "bought": 0,
                    "sold": 0,
                    "profit-per-unit": 0,
                    "total-profit": 0,
                    "date-bought": "",
                    "date-sold": ""
                }
            }
        }
    }
};

class Main {
    constructor() {
        this.listenForTrades();
    }
    listenForTrades() {

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

class ProcesTrade {
    constructor(trade_message) {
        this.message = trade_message;
        this.messageArray = this.message.split('');
        // determine message type
        if (this.message.includes('[Bazaar] Bought')) {
            this.type = "insta-buy";
            const amount_string_start = findEnd(this.message, 'Bought ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'for ');
            const price_string_end = this.message.indexOf(' coins')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' for');
            this.instaBuy(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Sold')) {
            this.type = "insta-sell";
            const amount_string_start = findEnd(this.message, 'Sold ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'for ');
            const price_string_end = this.message.indexOf(' coins')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' for');
            this.instaSell(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Buy Order Setup!')) {
            this.type = "buy-order-setup";
            const amount_string_start = findEnd(this.message, 'Setup! ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'for ');
            const price_string_end = this.message.indexOf(' coins')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' for');
            this.buyOrderSetup(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Your Buy Order for')) {
            this.type = "buy-order-fill";
            const amount_string_start = findEnd(this.message, 'for ');
            const amount_string_end = this.message.indexOf('x');
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' was');
            this.buyOrderFill(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Claimed') &&
                   this.message.includes('bought for')) {
            this.type = "buy-order-claim";
            const amount_string_start = findEnd(this.message, 'Claimed ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'bought for ');
            const price_string_end = this.message.indexOf(' each!')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' worth');
            this.buyOrderClaim(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Sell Offer Setup!')) {
            this.type = "sell-order-setup";
            const amount_string_start = findEnd(this.message, 'Setup! ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'for ');
            const price_string_end = this.message.indexOf(' coins')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' for');
            this.sellOrderSetup(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Your Sell Offer for')) {
            this.type = "sell-order-fill";
            const amount_string_start = findEnd(this.message, 'for ');
            const amount_string_end = this.message.indexOf('x');
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' was');
            this.sellOrderFill(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Claimed') &&
                   this.message.includes('from selling')) {
            this.type = "sell-order-claim";
            const amount_string_start = findEnd(this.message, 'selling ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'at ');
            const price_string_end = this.message.indexOf(' each!')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' at ');
            this.sellOrderClaim(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('You sold')) {
            this.type = "npc-sell";
            const amount_string_start = findEnd(this.message, ' x');
            const amount_string_end = this.message.indexOf(' for');
            const price_string_start = findEnd(this.message, ' for ');
            const price_string_end = this.message.indexOf(' Coins!')
            const name_string_start = findEnd(this.message, 'sold ');
            const name_string_end = this.message.indexOf(' x');
            this.npcSell(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end))/parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('created a BIN auction for')) {
            this.type = "auction-creation";
            const price_string_start = findEnd(this.message, 'at ');
            const price_string_end = this.message.indexOf(' coins!')
            const name_string_start = findEnd(this.message, 'for ');
            const name_string_end = this.message.indexOf(' at');
            this.auctionCreation(
                parseInt(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('You collected')) {
            this.type = "auction-claim";
            const price_string_start = findEnd(this.message, 'collected ');
            const price_string_end = this.message.indexOf(' coins ')
            const name_string_start = findEnd(this.message, 'selling ');
            const name_string_end = this.message.indexOf(' to ');
            this.auctionClaim(
                parseInt(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('You cancelled your auction for')) {
            this.type = "auction-cancel";
            const name_string_start = findEnd(this.message, 'for ');
            const name_string_end = this.message.indexOf('!');
            this.auctionCancel(
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('You Supercrafted')) {
            this.type = "supercraft";
            const name_string_start = findEnd(this.message, 'Supercrafted ');
            const name_string_end = this.message.indexOf('!');
            this.supercraft(
                this.message.slice(name_string_start, name_string_end)
            );
        } else {
            throw 'Error: Invalid trade message.';
        }
        return 'Completed trade mesage';
    }
    instaBuy(amount, price, name, time_bought = Date.now()) {
        // get the investment type but add "s" to format for trader_data
        const invesment_type = product_list[name]["type"] + "s"; 

        // look for any invesments that might already be the same name
        if (Object.keys(trader_data[invesment_type]).indexOf(name) != -1) {
            // apenend a new order to suborders
            trader_data[invesment_type][name]["sub-orders"].push({
                "partial-amount": amount,
                "price-bought": price,
                "time-bought": time_bought
            });
        } else {
            // create a new order
            trader_data[invesment_type][name] = {
                "type": product_list[name],
                "sub-orders": [
                    {
                        "partial-amount": amount,
                        "price-bought": price,
                        "time-bought": time_bought
                    }
                ]
            }
        }

        return 'Instabuy completed';
    }
    instaSell(amount, price, name) {
        const invesment_type = product_list[name]["type"] + "s"; 

        // look for any invesments that might already be the same name
        if (Object.keys(trader_data[invesment_type]).indexOf(name) != -1) {
            // apenend a new order to suborders
            trader_data[invesment_type][name]["sub-orders"].push({
                "partial-amount": amount,
                "price-bought": price,
                "time-bought": time_bought
            });
        } else {
            throw 'ERROR: No investment found for insta sell';
        }

        return 'Instasell completed';
    }
    buyOrderSetup(amount, price, name) {
        // get the hypixel api name and the current sell order price
        const api_name = product_list[name]['api_name'];
        const current_resell_price = bazaar_data[api_name]["quick_status"]["buyPrice"];

        // add the buy order
        trader_data['buy-order-overview']['buy-orders'].push({
            "item_name": name,
            "bought-amount": 0,
            "buying-amount": amount,
            "price-buying": price,
            "projected-profit": Math.round((current_resell_price - price) * amount),
            "buy-order-place-time": Date.now()
        });

        return 'Buy order setup completed';
    }
    buyOrderFill(price, name) {
        // get the current buy orders
        const buyOrders = trader_data['buy-order-overview']['buy-orders'];
        
        // find a current buy order that matches the name and buying price as an order already placed
        for (let buyOrderIndex = 0; buyOrderIndex < buyOrders.length; buyOrderIndex++) {
            const buyOrder = buyOrders[buyOrderIndex];
            if (buyOrder["item_name"] === name &&
                buyOrder["price-buying"] === price) {
                // alter the bought and buying amounts to reflect that the order has filled
                trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["bought-amount"] = 
                    copy(trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["buying-amount"]);
                
                return 'Buy order filling completed';
            }
        }

        throw 'Failed to fill a buy order';
    }
    buyOrderClaim(amount, price, name) {
        // get the current buy orders
        const buyOrders = trader_data['buy-order-overview']['buy-orders'];
        
        // find a current buy order that matches the name and buying price as an order already placed
        for (let buyOrderIndex = 0; buyOrderIndex < buyOrders.length; buyOrderIndex++) {
            const buyOrder = buyOrders[buyOrderIndex];
            if (buyOrder["item_name"] === name &&
                buyOrder["price-buying"] === price) {
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

                return 'Buy order claiming completed';
            }
        }

        throw 'Failed to claim a buy order';
    }
    sellOrderSetup(amount, price, name) {
        
    }
    sellOrderFill(price, name) {
        
    }
    sellOrderClaim(amount, price, name) {
        
    }
    npcSell(amount, price, name) {
        
    }
    auctionCreation(price, name) {
        
    }
    auctionClaim(price, name) {
        
    }
    auctionCancel(name) {
        
    }
    supercraft(name) {

    }
}

const update_seconds = 5;
setInterval(() => {
    updateBazaarData();
}, update_seconds * 1000);

async function updateBazaarData() {
    const response = await fetch("https://api.hypixel.net/v2/skyblock/bazaar");
    bazaar_data = await response.json();
    bazaar_data = bazaar_data['products'];
}
  

new ProcesTrade('[Bazaar] Bought 1,000x Carrot for 123.1 coins!');