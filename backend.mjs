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

/////////////////////////////////////////////////////////////////////////
// add weight adjustments, add a sorting thing by price, constanly update the sell/buy orders
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
        } else if (this.message.includes('[Bazaar] Cancelled!') &&
                   this.message.includes('Buy Order!')) {
            this.type = "buy-order-cancel";
            const amount_string_start = findEnd(this.message, 'Refunded ');
            const amount_string_end = this.message.indexOf(' coins');
            this.buyOrderCancel(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', ''))
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
        } else if (this.message.includes('[Bazaar] Cancelled!') &&
                   this.message.includes('Sell offer!')) {
            this.type = "sell-order-cancel";
            const amount_string_start = findEnd(this.message, 'Refunded ');
            const amount_string_end = this.message.indexOf('x ');
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' from ');
            this.sellOrderCancel(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
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
            // adjust the amounts to reflect the sel
            let suborders = trader_data[invesment_type][name]["sub-orders"];
            while (suborders.length > 0) {
                const subOrder = suborders[0];
                // go through each suborder
                if (subOrder["partial-amount"] > amount) {
                    // then just subtract from the current suborder
                    trader_data[invesment_type][name]["sub-orders"][0]["partial-amount"] -= amount;
                    
                    // calculate the profit from the sell order
                    date_bought = subOrder["time-bought"];
                    return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now());
                } else {
                    // determine if the last suborder is bought out
                    if (trader_data[invesment_type][name]["sub-orders"].length <= 1) {
                        // remove the whole order
                        trader_data[invesment_type][name] = undefined;

                        // calculate the profit from the sell order
                        date_bought = subOrder["time-bought"];
                        return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now());
                    } else {
                        // just remove the suborder
                        trader_data[invesment_type][name]["sub-orders"].splice(0, 1);

                        // calculate the profit for just this sell order
                        date_bought = subOrder["time-bought"];
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
        const profit_per_unit = (sell_price - buy_price);
        const profit = amount * profit_per_unit;
        
        // add the profit to the daily profits stuff
        trader_data["all-products"][name]["total-profit-made"] += profit;
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
                trader_data["daily-profits"]["date"]["trades"][tradeIndex]["total-profit"] = current_amount * profit_per_unit;
            }
        }
        // add a new trade since no if statments in for loop triggered
        trader_data["daily-profits"]["date"]["trades"].push({
            "item-name": name,
            "count": amount,
            "buy-price": buy_price,
            "sell-price": sell_price,
            "profit-per-unit": profit_per_unit,
            "total-profit": profit,
            "date-bought": date_bought,
            "date-sold": date_sold
        })

        return 'Instasell completed';
    }
    buyOrderSetup(amount, price, name) {
        // get the hypixel api name and the current sell order price
        const api_name = product_list[name]['api-name'];
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

        throw 'ERROR: Failed to fill a buy order';
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
            if (unbought_dollars - 1000 < dollars &&
                dollars < unbought_amount + 1000) {
                // remove that order
                trader_data['buy-order-overview']['buy-orders'][buyOrderIndex] = undefined;
                return 'Buy order claiming completed';
            }
        }

        throw 'ERROR: Failed to cancel a buy order';
    }
    sellOrderSetup(amount, price, name) {
        // get the hypixel api name and the current sell order price
        const api_name = product_list[name]['api-name'];
        const current_resell_price = bazaar_data[api_name]["quick_status"]["sellPrice"];
        const invesment_type = product_list[name]["type"] + "s"; 
        const earliest_time_bought = "0";

        let sell_sub_orders = [];
        let buy_sub_orders = trader_data[invesment_type][name]["sub-orders"];

        while (buy_sub_orders.length > 0) {
            const buySubOrder = buy_sub_orders[0];
            // go through each suborder
            if (buySubOrder["partial-amount"] > amount) {
                // then just subtract from the current suborder
                trader_data[invesment_type][name]["sub-orders"][0]["partial-amount"] -= amount;

                // add the new sub sell order
                const projected_profit_per_unit = current_resell_price - buySubOrder["price-bought"]; 
                sell_sub_orders.push({
                    "partial-sold-amount": 0,
                    "partial-selling-amount": trader_data[invesment_type][name]["sub-orders"][0]["partial-amount"],
                    "price-bought": buySubOrder["price-bought"],
                    "projected-profit": projected_profit_per_unit * trader_data[invesment_type][name]["sub-orders"][0]["partial-amount"],
                    "time-bought": buySubOrder["time-bought"],
                    "sell-order-place-time": Date.now()
                });

                // update earliest time bought
                if (parseInt(buySubOrder["time-bought"]) < parseInt(earliest_time_bought)) {
                    earliest_time_bought = buySubOrder["time-bought"];
                }
                
                // calculate the profit from the sell order
                date_bought = buySubOrder["time-bought"];
                this.addProfit(amount, name, buySubOrder["price-bought"], price, date_bought, Date.now());
                break;
            } else {
                // determine if the last suborder is bought out
                if (trader_data[invesment_type][name]["sub-orders"].length <= 1) {
                    // add the new sub sell order
                    const projected_profit_per_unit = current_resell_price - buySubOrder["price-bought"]; 
                    sell_sub_orders.push({
                        "partial-sold-amount": 0,
                        "partial-selling-amount": buySubOrder["partial-amount"],
                        "price-bought": buySubOrder["price-bought"],
                        "projected-profit": projected_profit_per_unit * buySubOrder["partial-amount"],
                        "time-bought": buySubOrder["time-bought"],
                        "sell-order-place-time": Date.now()
                    });

                    // update earliest time bought
                    if (parseInt(buySubOrder["time-bought"]) < parseInt(earliest_time_bought)) {
                        earliest_time_bought = buySubOrder["time-bought"];
                    }

                    // remove the whole order
                    trader_data[invesment_type][name] = undefined;
                    
                    // calculate the profit from the sell order
                    date_bought = buySubOrder["time-bought"];
                    this.addProfit(amount, name, buySubOrder["price-bought"], price, date_bought, Date.now());
                    break;
                } else {
                    // add the new sub sell order
                    const projected_profit_per_unit = current_resell_price - buySubOrder["price-bought"]; 
                    sell_sub_orders.push({
                        "partial-sold-amount": 0,
                        "partial-selling-amount": buySubOrder["partial-amount"],
                        "price-bought": buySubOrder["price-bought"],
                        "projected-profit": projected_profit_per_unit * buySubOrder["partial-amount"],
                        "time-bought": buySubOrder["time-bought"],
                        "sell-order-place-time": Date.now()
                    });

                    // update earliest time bought
                    if (parseInt(buySubOrder["time-bought"]) < parseInt(earliest_time_bought)) {
                        earliest_time_bought = buySubOrder["time-bought"];
                    }

                    // just remove the suborder
                    trader_data[invesment_type][name]["sub-orders"].splice(0, 1);

                    // calculate the profit for just this sell order
                    date_bought = buySubOrder["time-bought"];
                    this.addProfit(amount, name, buySubOrder["price-bought"], price, date_bought, Date.now());
                }
            }
        }

        // add the sell order
        trader_data['sell-order-overview']['sell-orders'].push({
            "item_name": name,
            "price-sold": price,
            "earliest-time-bought": earliest_time_bought,
            "sell-order-place-time": Date.now(),
            "sub-orders": sell_sub_orders
        });

        return 'Sell order setup completed';
    }
    sellOrderFill(price, name) {
        // get the current sell orders
        const sellOrders = trader_data['sell-order-overview']['sell-orders'];
        
        // find a current sell order that matches the name and selling price as an order already placed
        for (let sellOrderIndex = 0; sellOrderIndex < sellOrders.length; sellOrderIndex++) {
            const sellOrder = sellOrders[sellOrderIndex];
            if (sellOrder["item_name"] === name &&
                sellOrder["price-selling"] === price) {
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
    sellOrderClaim(amount, price, name) {
        // get the current sell orders
        const sellOrders = trader_data["sell-order-overview"]["sell-orders"];
        
        // index that the sell order that was claimed will be at
        let current_sell_order_index = -1;

        // find the index of the sell order that was just claimed
        for (const sellOrderIndex of Object.keys(sellOrders)) {
            const sellOrder = sellOrders[sellOrderIndex];
            if (sellOrder["item-name"] === name &&
                sellOrder["price-sold"] === price) {
                current_sell_order_index = sellOrderIndex;
            }
        }
        if (current_sell_order_index === -1 || sellOrders.length === 0) throw 'ERROR: No sell order found to claim';

        // adjust the amounts to reflect the sell claim
        let suborders = trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"];
        while (suborders.length > 0) {
            const subOrder = suborders[0];

            // go through each suborder
            if (subOrder["partial-amount"] > amount) {
                // then just subtract from the current suborder
                trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"][0]["partial-amount"] -= amount;
                
                // calculate the profit from the sell order
                date_bought = subOrder["time-bought"];
                return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now());
            } else {
                // determine if the last suborder is bought out
                if (trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].length <= 1) {
                    // remove the whole order
                    trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index] = undefined;

                    // calculate the profit from the sell order
                    date_bought = subOrder["time-bought"];
                    return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now());
                } else {
                    // just remove the suborder
                    trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].splice(0, 1);

                    // calculate the profit for just this sell order
                    date_bought = subOrder["time-bought"];
                    this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now());
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
        const invesment_type = product_list[name]["type"] + "s"; 
        for (const subSellOrder of currentSellOrder["sub-orders"]) {
            if (trader_data[invesment_type][name] != undefined) {
                trader_data[invesment_type][name]["sub-orders"].push({
                    "partial-amount": subSellOrder["partial-selling-amount"] - subSellOrder["partial-sold-amount"],
                    "price-bought": subSellOrder["price-bought"],
                    "time-bought": subSellOrder["time-bought"]
                });
            } else {
                trader_data[invesment_type][name] = {
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

        return 'Sell order cancelled';
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

for (const testMesage of [
    ''
]) {
    new ProcesTrade(testMesage);
    console.log(trader_data);
}