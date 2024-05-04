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

import product_list from './product-list.json' with { type: "json" };

let bazaar_data = {};
let trader_data = {
    "username": "Kargone",
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
    "all-products": {},
    "daily-profits": {
        "date": {
            "daily-profit": 0,
            "forge-profit": 0,
            "auction-house-profit": 0,
            "bazaar-profit": 0,
            "trades": []
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

class Sort {
    constructor(object, key1, key2 = '') {
        if (key2 === '') {
            return object.sort(this.compareFn1(key1));
        } else {
            return object.sort(this.compareFn2(key1, key2));
        }
    }
    compareFn1(key1) {
        return function(a, b) {
            if (a[key1] < b[key1]) {
                return -1;
            } else if (a[key1] > b[key1]) {
                return 1;
            }
            return 0;
        }
    }
    compareFn2(key1, key2) {
        return function(a, b) {
            if (a[key1][key2] < b[key1][key2]) {
                return -1;
            } else if (a[key1][key2] > b[key1][key2]) {
                return 1;
            }
            return 0;
        }
    }
}

class ProcesTrade {
    constructor(trade_message) {
        this.message = trade_message;
        this.messageArray = this.message.split('');
        // determine message type
        if (this.message.includes('[Bazaar] Bought')) {
            this.type = "insta-buy";
            const amountStringStart = findEnd(this.message, 'Bought ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'for ');
            const priceStringEnd = this.message.indexOf(' coins')
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' for');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const pricePerUnit = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.instaBuy(amount, pricePerUnit, nameString);
        } else if (this.message.includes('[Bazaar] Sold')) {
            this.type = "insta-sell";
            const amountStringStart = findEnd(this.message, 'Sold ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'for ');
            const priceStringEnd = this.message.indexOf(' coins')
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' for');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const pricePerUnit = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''))/amount;
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.instaSell(amount, pricePerUnit, nameString);
        } else if (this.message.includes('[Bazaar] Buy Order Setup!')) {
            this.type = "buy-order-setup";
            const amountStringStart = findEnd(this.message, 'Setup! ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'for ');
            const priceStringEnd = this.message.indexOf(' coins')
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' for');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const totalPrice = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.buyOrderSetup(amount, totalPrice/amount, nameString);
        } else if (this.message.includes('[Bazaar] Your Buy Order for')) {
            this.type = "buy-order-fill";
            const amountStringStart = findEnd(this.message, 'for ');
            const amountStringEnd = this.message.indexOf('x');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' was');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.buyOrderFill(amount, nameString);
        } else if (this.message.includes('[Bazaar] Claimed') &&
                   this.message.includes('bought for')) {
            this.type = "buy-order-claim";
            const amountStringStart = findEnd(this.message, 'Claimed ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'bought for ');
            const priceStringEnd = this.message.indexOf(' each!')
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' worth');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const pricePerUnit = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.buyOrderClaim(amount, pricePerUnit, nameString);
        } else if (this.message.includes('[Bazaar] Cancelled!') &&
                   this.message.includes('Buy Order!')) {
            this.type = "buy-order-cancel";
            const amountStringStart = findEnd(this.message, 'Refunded ');
            const amountStringEnd = this.message.indexOf(' coins');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            this.buyOrderCancel(amount);
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
            this.sellOrderSetup(amount, Math.round(totalPrice/amount/0.99*10)/10, nameString);
        } else if (this.message.includes('[Bazaar] Your Sell Offer for')) {
            this.type = "sell-order-fill";
            const amountStringStart = findEnd(this.message, 'for ');
            const amountStringEnd = this.message.indexOf('x');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' was');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.sellOrderFill(amount, nameString);
        } else if (this.message.includes('[Bazaar] Claimed') &&
                   this.message.includes('from selling')) {
            this.type = "sell-order-claim";
            const amountStringStart = findEnd(this.message, 'selling ');
            const amountStringEnd = this.message.indexOf('x');
            const priceStringStart = findEnd(this.message, 'at ');
            const priceStringEnd = this.message.indexOf(' each!')
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' at ');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const pricePerUnit = parseFloat(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.sellOrderClaim(amount, pricePerUnit, nameString);
        } else if (this.message.includes('[Bazaar] Cancelled!') &&
                   this.message.includes('Sell Offer!')) {
            this.type = "sell-order-cancel";
            const amountStringStart = findEnd(this.message, 'Refunded ');
            const amountStringEnd = this.message.indexOf('x ');
            const nameStringStart = findEnd(this.message, 'x ');
            const nameStringEnd = this.message.indexOf(' from ');
            const amount = parseInt(this.message.slice(amountStringStart, amountStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.sellOrderCancel(amount, nameString);
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
            this.orderFlipped(amount, nameString, profitString);
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
            this.npcSell(amount, totalPrice/amount, nameString);
        } else if (this.message.includes('created a BIN auction for')) {
            this.type = "auction-creation";
            const priceStringStart = findEnd(this.message, 'at ');
            const priceStringEnd = this.message.indexOf(' coins!')
            const nameStringStart = findEnd(this.message, 'for ');
            const nameStringEnd = this.message.indexOf(' at');
            const pricePerUnit = parseInt(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.auctionCreation(pricePerUnit, nameString);
        } else if (this.message.includes('You collected')) {
            this.type = "auction-claim";
            const priceStringStart = findEnd(this.message, 'collected ');
            const priceStringEnd = this.message.indexOf(' coins ')
            const nameStringStart = findEnd(this.message, 'selling ');
            const nameStringEnd = this.message.indexOf(' to ');
            const pricePerUnit = parseInt(this.message.slice(priceStringStart, priceStringEnd).replaceAll(',', ''));
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.auctionClaim(pricePerUnit, nameString);
        } else if (this.message.includes('You cancelled your auction for')) {
            this.type = "auction-cancel";
            const nameStringStart = findEnd(this.message, 'for ');
            const nameStringEnd = this.message.indexOf('!');
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.auctionCancel(nameString);
        } else if (this.message.includes('You Supercrafted')) {
            this.type = "supercraft";
            const nameStringStart = findEnd(this.message, 'Supercrafted ');
            const nameStringEnd = this.message.indexOf('!');
            const nameString = this.message.slice(nameStringStart, nameStringEnd);
            this.supercraft(nameString);
        } else {
            throw 'Error: Invalid trade message.';
        }

        console.log("Completed trade message", trade_message);
        return 'Completed trade mesage';
    }
    instaBuy(amount, price, name, time_bought = Date.now()) {
        // get the investment type but add "s" to format for trader_data
        const invesmentType = product_list[name]["type"] + "s"; 

        // look for any invesments that might already be the same name
        if (Object.keys(trader_data[invesmentType]).indexOf(name) != -1) {
            // apenend a new order to suborders
            trader_data[invesmentType][name]["sub-orders"].push({
                "partial-amount": amount,
                "price-bought": price,
                "time-bought": time_bought
            });
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

        return 'Instabuy completed';
    }
    instaSell(amount, price, name) {
        const invesmentType = product_list[name]["type"] + "s"; 

        // look for any invesments that might already be the same name
        if (Object.keys(trader_data[invesmentType]).indexOf(name) != -1) {
            // adjust the amounts to reflect the sel
            let suborders = trader_data[invesmentType][name]["sub-orders"];
            while (suborders.length > 0) {
                const subOrder = suborders[0];
                // go through each suborder
                if (subOrder["partial-amount"] > amount) {
                    // then just subtract from the current suborder
                    trader_data[invesmentType][name]["sub-orders"][0]["partial-amount"] -= amount;
                    
                    // calculate the profit from the sell order
                    const date_bought = subOrder["time-bought"];
                    return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now());
                } else {
                    // determine if the last suborder is bought out
                    if (trader_data[invesmentType][name]["sub-orders"].length <= 1) {
                        // remove the whole order
                        delete trader_data[invesmentType][name];

                        // calculate the profit from the sell order
                        const date_bought = subOrder["time-bought"];
                        return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now());
                    } else {
                        // just remove the suborder
                        trader_data[invesmentType][name]["sub-orders"].splice(0, 1);

                        // calculate the profit for just this sell order
                        const date_bought = subOrder["time-bought"];
                        this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now());
                    }
                }
            }
            throw 'ERROR: More insta selling that in investments';
        } else {
            throw 'ERROR: No investment found for insta sell';
        }
    }
    addProfit(amount, name, buy_price, sell_price, date_bought, date_sold, type = 'bazaar') {
        // calculate the current profit
        let profitPerUnit;
        if (type === 'bazaar') {
            const bazaarFeesPerUnit = sell_price * 0.01; 
            profitPerUnit = (sell_price - buy_price) - bazaarFeesPerUnit;
        } else {
            profitPerUnit = (sell_price - buy_price);
        }
        const profit = amount * profitPerUnit;
        
        // add the profit to the daily profits stuff
        if (Object.keys(trader_data["all-products"]).indexOf(name) === -1) {
            trader_data["all-products"][name] = {
                "total-amount": 0,
                "buy-weight": 0,
                "sell-weight": 0,
                "max-amount": 2000,
                "total-profit-made": 0,
                "total-sold": 0,
                "crafting-materials": "none"
            };
        }
        trader_data["all-products"][name]["total-profit-made"] += profit;
        trader_data["all-products"][name]["total-sold"] += amount;
        trader_data["daily-profits"]["date"]["daily-profit"] += profit;
        trader_data["daily-profits"]["date"][`${type}-profit`] += profit;
        
        // update the trades for today
        for (const tradeIndex of Object.keys(trader_data["daily-profits"]["date"]["trades"])) {
            const trade = trader_data["daily-profits"]["date"]["trades"][tradeIndex];
            if (trade["item-name"] === name &&
                trade["buy-price"] === buy_price &&
                trade["sell-price"] === sell_price) {
                // update a trade that already exists
                trader_data["daily-profits"]["date"]["trades"][tradeIndex]["count"] += amount; 
                const current_amount = trader_data["daily-profits"]["date"]["trades"][tradeIndex]["count"];
                trader_data["daily-profits"]["date"]["trades"][tradeIndex]["total-profit"] = current_amount * profitPerUnit;
                return 'Instasell completed';
            }
        }
        // add a new trade since no if statments in for loop triggered
        trader_data["daily-profits"]["date"]["trades"].push({
            "item-name": name,
            "count": amount,
            "buy-price": buy_price,
            "sell-price": sell_price,
            "profit-per-unit": profitPerUnit,
            "total-profit": profit,
            "date-bought": date_bought,
            "date-sold": date_sold
        })

        return 'Instasell completed';
    }
    buyOrderSetup(amount, price, name) {
        // get the hypixel api name and the current sell order price
        const api_name = product_list[name]['api-name'];
        const currentResellPrice = Math.round(bazaar_data[api_name]["quick_status"]["buyPrice"] * 10) / 10;
        const bazaarFees = currentResellPrice * 0.01 * amount;

        // add the buy order
        trader_data['buy-order-overview']['buy-orders'].push({
            "item-name": name,
            "bought-amount": 0,
            "buying-amount": amount,
            "price-buying": price,
            "projected-profit": Math.round((currentResellPrice - price) * amount - bazaarFees),
            "buy-order-place-time": Date.now()
        });

        return 'Buy order setup completed';
    }
    buyOrderFill(amount, name) {
        // get the current buy orders
        const buyOrders = trader_data['buy-order-overview']['buy-orders'];
        
        // find a current buy order that matches the name and buying amount as an order already placed
        for (let buyOrderIndex = 0; buyOrderIndex < buyOrders.length; buyOrderIndex++) {
            const buyOrder = buyOrders[buyOrderIndex];
            if (buyOrder["item-name"] === name &&
                buyOrder["buying-amount"] === amount) {
                // alter the bought and buying amounts to reflect that the order has filled
                trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["bought-amount"] = 
                    copy(trader_data['buy-order-overview']['buy-orders'][buyOrderIndex]["buying-amount"]);
                
                return 'Buy order filling completed';
            }
        }

        throw 'ERROR: Failed to fill a buy order';
    }
    buyOrderClaim(amount, price, name) {
        // get the current buy orders
        const buyOrders = trader_data['buy-order-overview']['buy-orders'];
        
        // find a current buy order that matches the name and buying price as an order already placed
        for (let buyOrderIndex = 0; buyOrderIndex < buyOrders.length; buyOrderIndex++) {
            const buyOrder = buyOrders[buyOrderIndex];
            if (buyOrder["item-name"] === name && (Math.ceil(buyOrder["price-buying"]) === price || buyOrder["price-buying"] === price || Math.floor(buyOrder["price-buying"]) === price)) {
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

        throw 'ERROR: Failed to claim a buy order';
    }
    buyOrderCancel(dollars) {
        // this one's a little more sketchy bc it depends on the bought-amout being accurate

        // get the current buy orders
        const buyOrders = trader_data['buy-order-overview']['buy-orders'];
        
        // find a current buy order that matches the coins that would be left on the order
        for (let buyOrderIndex = 0; buyOrderIndex < buyOrders.length; buyOrderIndex++) {
            const buyOrder = buyOrders[buyOrderIndex];
            const unbought_amount = buyOrder["buying-amount"] - buyOrder["bought-amount"];
            const unbought_dollars = unbought_amount * buyOrder["price-buying"];
            if (unbought_dollars - 1000 < dollars && dollars < unbought_dollars + 1000) {
                // remove that order
                trader_data['buy-order-overview']['buy-orders'].splice(buyOrderIndex, 1);
                return 'Buy order claiming completed';
            }
        }

        throw 'ERROR: Failed to cancel a buy order';
    }
    sellOrderSetup(amount, price, name) {
        const resellPrice = price;
        const invesmentType = product_list[name]["type"] + "s"; 
        const sellOrderPlaceTime = Date.now();
        let earliest_time_bought = "10000000000000000000000000000";
        let total_selling_amount = 0;

        let sell_sub_orders = [];
        const investmentSubOrders = trader_data[invesmentType][name]["sub-orders"];

        while (investmentSubOrders.length > 0) {
            const investmentSubOrder = investmentSubOrders[0];
            // go through each suborder
            if (investmentSubOrder["partial-amount"] > amount) {
                // then just subtract from the current suborder
                trader_data[invesmentType][name]["sub-orders"][0]["partial-amount"] -= amount;

                // add the new sub sell order
                const bazaarFeesPerUnit = resellPrice * 0.01;
                const projectedProfitPerUnit = Math.round((resellPrice - investmentSubOrder["price-bought"] - bazaarFeesPerUnit) * 10) / 10;
                total_selling_amount += trader_data[invesmentType][name]["sub-orders"][0]["partial-amount"];
                sell_sub_orders.push({
                    "partial-sold-amount": 0,
                    "partial-selling-amount": trader_data[invesmentType][name]["sub-orders"][0]["partial-amount"],
                    "price-bought": investmentSubOrder["price-bought"],
                    "projected-profit": projectedProfitPerUnit * trader_data[invesmentType][name]["sub-orders"][0]["partial-amount"],
                    "time-bought": investmentSubOrder["time-bought"],
                    "sell-order-place-time": sellOrderPlaceTime
                });

                // update earliest time bought
                if (parseInt(investmentSubOrder["time-bought"]) < parseInt(earliest_time_bought)) {
                    earliest_time_bought = investmentSubOrder["time-bought"];
                }
                break;
            } else {
                // determine if the last suborder is bought out
                if (trader_data[invesmentType][name]["sub-orders"].length <= 1) {
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
                    break;
                } else {
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
                }
            }
        }

        // add the sell order
        trader_data['sell-order-overview']['sell-orders'].push({
            "item-name": name,
            "price-sold": price,
            "earliest-time-bought": earliest_time_bought,
            "sell-order-place-time": sellOrderPlaceTime,
            "total-selling-amount": total_selling_amount,
            "sub-orders": sell_sub_orders
        });

        return 'Sell order setup completed';
    }
    sellOrderFill(amount, name) {
        // get the current sell orders
        const sellOrders = trader_data['sell-order-overview']['sell-orders'];
        
        // find a current sell order that matches the name and selling amount as an order already placed
        for (let sellOrderIndex = 0; sellOrderIndex < sellOrders.length; sellOrderIndex++) {
            const sellOrder = sellOrders[sellOrderIndex];
            if (sellOrder["item-name"] === name &&
                sellOrder["total-selling-amount"] === amount) {
                // alter the bought and selling amounts to reflect that the order has filled
                for (const subSellOrderIndex of Object.keys(trader_data['sell-order-overview']['sell-orders'][sellOrderIndex]["sub-orders"])) {
                    trader_data['sell-order-overview']['sell-orders'][sellOrderIndex]["sub-orders"][subSellOrderIndex]["partial-sold-amount"] =
                        trader_data['sell-order-overview']['sell-orders'][sellOrderIndex]["sub-orders"][subSellOrderIndex]["partial-selling-amount"];
                }
                
                return 'Buy order filling completed';
            }
        }

        throw 'ERROR: Failed to fill a sell order';
    }
    sellOrderClaim(amount, price_sold, name) {
        // get the current sell orders
        const sellOrders = trader_data["sell-order-overview"]["sell-orders"];
        
        // index that the sell order that was claimed will be at
        let current_sell_order_index = -1;

        // find the index of the sell order that was just claimed
        for (const sellOrderIndex of Object.keys(sellOrders)) {
            const sellOrder = sellOrders[sellOrderIndex];
            if (sellOrder["item-name"] === name && (Math.ceil(sellOrder["price-sold"]) === price_sold || sellOrder["price-sold"] === price_sold || Math.floor(sellOrder["price-sold"]) === price_sold)) {
                current_sell_order_index = sellOrderIndex;
                break;
            }
        }
        if (current_sell_order_index === -1 || sellOrders.length === 0) throw 'ERROR: No sell order found to claim';

        // adjust the amounts to reflect the sell claim
        let suborders = trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"];
        while (suborders.length > 0) {
            const subOrder = suborders[0];

            // go through each suborder
            if (subOrder["partial-selling-amount"] > amount) {
                // then just subtract from the current suborder
                trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"][0]["partial-selling-amount"] -= amount;
                trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"][0]["partial-sold-amount"] = 0;

                // calculate the profit from the sell order
                const date_bought = subOrder["time-bought"];
                return this.addProfit(amount, name, subOrder["price-bought"], price_sold, date_bought, Date.now());
            } else {
                // determine if the last suborder is bought out
                if (trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].length <= 1) {
                    // remove the whole order
                    trader_data["sell-order-overview"]["sell-orders"].splice(current_sell_order_index, 1);

                    // calculate the profit from the sell order
                    const date_bought = subOrder["time-bought"];
                    return this.addProfit(amount, name, subOrder["price-bought"], price_sold, date_bought, Date.now());
                } else {
                    // just remove the suborder
                    trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].splice(0, 1);

                    // calculate the profit for just this sell order
                    const date_bought = subOrder["time-bought"];
                    this.addProfit(amount, name, subOrder["price-bought"], price_sold, date_bought, Date.now());
                }
            }
        }
        throw 'ERROR: More insta selling that in investments';
    }
    sellOrderCancel(amount, name) {
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
                totalUnsold += sellOrder["sub-orders"][subSellOrderIndex]["partial-selling-amount"] - sellOrder["sub-orders"][subSellOrderIndex]["partial-sold-amount"];
            }

            // check that the unsold amounts and name are the same as the current sell order 
            if (sellOrder["item-name"] === name &&
                totalUnsold === amount) {
                current_sell_order_index = sellOrderIndex;
            }
        }
        if (current_sell_order_index === -1 || sellOrders.length === 0) throw 'ERROR: No sell order found to cancel';

        const currentSellOrder = sellOrders[current_sell_order_index];
        const invesmentType = product_list[name]["type"] + "s"; 
        for (const subSellOrder of currentSellOrder["sub-orders"]) {
            if (trader_data[invesmentType][name] != undefined) {
                trader_data[invesmentType][name]["sub-orders"].push({
                    "partial-amount": subSellOrder["partial-selling-amount"] - subSellOrder["partial-sold-amount"],
                    "price-bought": subSellOrder["price-bought"],
                    "time-bought": subSellOrder["time-bought"]
                });
            } else {
                trader_data[invesmentType][name] = {
                    "type": product_list[name]["type"],
                    "sub-orders": [
                        {
                            "partial-amount": subSellOrder["partial-selling-amount"] - subSellOrder["partial-sold-amount"],
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
        if (current_buy_order_index === -1 || buyOrders.length === 0) throw 'ERROR: No buy order found to flip';

        const currentBuyOrder = buyOrders[current_buy_order_index];
        const priceBought = currentBuyOrder["price-buying"];
        const profitPerUnit = profit / amount;

        this.buyOrderClaim(amount, priceBought, name);
        this.sellOrderSetup(amount, (priceBought + profitPerUnit), name);

        return 'Buy order flipped';
    }
    npcSell(amount, price, name) {
        this.instaSell(amount, price, name);

        return 'NPC sell completed';
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

updateBazaarData();
setTimeout(() => {
    for (const testMesage of [
        "[Bazaar] Buy Order Setup! 2,000x Golden Tooth for 162,974,600 coins.",
        "[Bazaar] Buy Order Setup! 8,000x Enchanted Leather for 51,104,000 coins.",
        "[Bazaar] Buy Order Setup! 1,000x Griffin Feather for 139,370,900 coins.",
        "[Bazaar] Buy Order Setup! 200x Poison Sample for 211,263,760 coins.",
        "[Bazaar] Buy Order Setup! 200x Arachne's Fang for 69,001,060 coins.",
        "[Bazaar] Buy Order Setup! 3,000x Silver Magmafish for 77,379,300 coins.",
        "[Bazaar] Buy Order Setup! 200x Gold Magmafish for 461,447,220 coins.",
        "[Bazaar] Buy Order Setup! 1,000x Ectoplasm for 154,574,700 coins.",
        "[Bazaar] Buy Order Setup! 4,000x Holy Dragon Fragment for 30,391,600 coins.",
        "[Bazaar] Buy Order Setup! 3,000x Enchanted Slime Block for 376,873,200 coins.",
        "[Bazaar] Buy Order Setup! 4,000x Tasty Cheese for 10,826,000 coins.",
        "[Bazaar] Buy Order Setup! 2,000x Enchanted Rabbit Hide for 33,033,000 coins.",
        "[Bazaar] Buy Order Setup! 2,000x ☘ Fine Jade Gemstone for 60,583,200 coins.",
        "[Bazaar] Buy Order Setup! 2,000x ✎ Fine Sapphire Gemstone for 60,347,400 coins.",
        "[Bazaar] Claimed 47x Arachne's Fang worth 16,215,249 coins bought for 345,005 each!",
        "[Bazaar] Cancelled! Refunded 52,785,811 coins from cancelling Buy Order!",
        "[Bazaar] Claimed 2,000x Golden Tooth worth 162,974,600 coins bought for 81,487 each!",
        "[Bazaar] Claimed 466x Griffin Feather worth 64,946,839 coins bought for 139,371 each!",
        "[Bazaar] Cancelled! Refunded 74,424,061 coins from cancelling Buy Order!",
        "[Bazaar] Sell Offer Setup! 466x Griffin Feather for 66,033,993 coins.",
        "[Bazaar] Order Flipped! 200x Gold Magmafish for 42,152,780 coins of total expected profit.",
        "[Bazaar] Cancelled! Refunded 211,263,760 coins from cancelling Buy Order!",
        "[Bazaar] Claimed 690x Silver Magmafish worth 17,797,239 coins bought for 25,793 each!",
        "[Bazaar] Sell Offer Setup! 690x Silver Magmafish for 18,990,043 coins.",
        "[Bazaar] Cancelled! Refunded 59,582,061 coins from cancelling Buy Order!",
        "[Bazaar] Claimed 535x ✎ Fine Sapphire Gemstone worth 16,142,930 coins bought for 30,174 each!",
        "[Bazaar] Sell Offer Setup! 535x ✎ Fine Sapphire Gemstone for 18,491,300 coins.",
        "[Bazaar] Cancelled! Refunded 44,204,470 coins from cancelling Buy Order!",
        "[Bazaar] Order Flipped! 2,000x ☘ Fine Jade Gemstone for 2,394,800 coins of total expected profit.",
        "[Bazaar] Claimed 511x Holy Dragon Fragment worth 3,882,527 coins bought for 7,597.9 each!",
        "[Bazaar] Cancelled! Refunded 26,509,073 coins from cancelling Buy Order!",
        "[Bazaar] Sell Offer Setup! 511x Holy Dragon Fragment for 4,402,154 coins.",
        "[Bazaar] Claimed 44x Ectoplasm worth 6,801,287 coins bought for 154,575 each!",
        "[Bazaar] Cancelled! Refunded 147,773,413 coins from cancelling Buy Order!",
        "[Bazaar] Claimed 956x Tasty Cheese worth 2,587,414 coins bought for 2,706.5 each!",
        "[Bazaar] Sell Offer Setup! 956x Tasty Cheese for 3,727,743 coins.",
        "[Bazaar] Cancelled! Refunded 8,238,586 coins from cancelling Buy Order!",
        "[Bazaar] Claimed 1,978x Enchanted Slime Block worth 248,485,063 coins bought for 125,624 each!",
        "You sold Enchanted Slime Block x58 for 7,424,000 Coins!",
        "You sold Enchanted Slime Block x64 for 8,192,000 Coins!",
        "[Bazaar] Cancelled! Refunded 128,388,137 coins from cancelling Buy Order!",
        "[Bazaar] Claimed 934x Enchanted Rabbit Hide worth 15,426,411 coins bought for 16,516 each!",
        "[Bazaar] Sell Offer Setup! 934x Enchanted Rabbit Hide for 17,229,467 coins.",
        "[Bazaar] Cancelled! Refunded 17,606,589 coins from cancelling Buy Order!",
        "[Bazaar] Claimed 2,176x Enchanted Leather worth 13,900,288 coins bought for 6,388 each!",
        "[Bazaar] Claimed 2,176x Enchanted Leather worth 13,900,288 coins bought for 6,388 each!",
        "[Bazaar] Claimed 2,176x Enchanted Leather worth 13,900,288 coins bought for 6,388 each!",
        "[Bazaar] Claimed 1,472x Enchanted Leather worth 9,403,136 coins bought for 6,388 each!",
        "[Bazaar] Sold 23x Enchanted Leather for 147,037 coins!",
        "[Bazaar] Claimed 3,727,743 coins from selling 956x Tasty Cheese at 3,938.7 each!",
        "[Bazaar] Claimed 18,990,043 coins from selling 690x Silver Magmafish at 27,800 each!",
        "[Bazaar] Claimed 7,478,460 coins from selling 3x Gold Magmafish at 2,518,000 each!",
        "[Bazaar] Cancelled! Refunded 197x Gold Magmafish from cancelling Sell Offer!",
        "[Bazaar] Claimed 4,402,154 coins from selling 511x Holy Dragon Fragment at 8,701.8 each!",
        "[Bazaar] Claimed 66,033,993 coins from selling 466x Griffin Feather at 143,135 each!",
        "[Bazaar] Claimed 18,491,300 coins from selling 535x ✎ Fine Sapphire Gemstone at 34,912 each!",
        "[Bazaar] Claimed 59,947,814 coins from selling 1,923x ☘ Fine Jade Gemstone at 31,489 each!",
        "[Bazaar] Cancelled! Refunded 77x ☘ Fine Jade Gemstone from cancelling Sell Offer!",
        "[Bazaar] Claimed 17,229,467 coins from selling 934x Enchanted Rabbit Hide at 18,633 each!",
        "[Bazaar] Sell Offer Setup! 197x Gold Magmafish for 475,828,928 coins."
    ]) {
        new ProcesTrade(testMesage);
    }
    console.log('Orders done successfully');
}, 1000);