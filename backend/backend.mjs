import product_list from './product-list.json' with { type: "json" };
import trader_data from './trader-data.json' with { type: "json" };
import fs from 'node:fs';
import http from 'node:http';

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

function getInvestmentType(product_list_type) {
    if (product_list_type === "long-term-investment") {
        return "long-term-investments";
    } else if (product_list_type === "auction-product") {
        return "long-term-investments";
    } else if (product_list_type === "short-term-investment") {
        return "short-term-investments";
    } else if (product_list_type === "crafting-material") {
        return "short-term-investments";
    } else {
        throw "ERROR: Invalid Investment Type";
    }
}

// Create a function such that whatever utc time code is inputed
// it returns a date code such that it is the same day but 12:00 am
function morningTime(time_code) {
    const extraTime = time_code % (86400 * 1000);
    const offset = 3600 * 5 * 1000;
    return time_code - extraTime + offset;
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
            return function(a, b) {
                if (a[key1] < b[key1]) {
                    return -1;
                } else if (a[key1] > b[key1]) {
                    return 1;
                }
                return 0;
            }
        } else {
            return function(a, b) {
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
            return function(a, b) {
                if (a[key1][key2] < b[key1][key2]) {
                    return -1;
                } else if (a[key1][key2] > b[key1][key2]) {
                    return 1;
                }
                return 0;
            }
        } else {
            return function(a, b) {
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
        } else if (
            this.message.includes('Claiming order...') ||
            this.message.includes('Putting goods in escrow...') ||
            this.message.includes('Submitting sell offer...') ||
            this.message.includes('Cancelling order...') ||
            this.message.includes('Executing instant sell...') ||
            this.message.includes('Submitting buy order...')
        ) {
            return 'Nontrade message';
        } else {
            console.log("ERROR: Invalid trade message: ", this.message);
            return 'ERROR: Invalid trade message: ' + this.message;
        }

        console.log("Completed trade message: ", this.message);
        return 'Completed trade mesage';
    }
    instaBuy(amount, price, name, time_bought = Date.now()) {
        // get the investment type but add "s" to format for trader_data
        const invesmentType = getInvestmentType(product_list[name]["type"]);
        

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
    instaSell(amount, price, name, doBazaarFees = true) {
        const invesmentType = getInvestmentType(product_list[name]["type"]); 

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
                    return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees);
                } else {
                    // determine if the last suborder is bought out
                    if (trader_data[invesmentType][name]["sub-orders"].length <= 1) {
                        // remove the whole order
                        delete trader_data[invesmentType][name];

                        // calculate the profit from the sell order
                        const date_bought = subOrder["time-bought"];
                        return this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees);
                    } else {
                        // just remove the suborder
                        trader_data[invesmentType][name]["sub-orders"].splice(0, 1);

                        // calculate the profit for just this sell order
                        const date_bought = subOrder["time-bought"];
                        this.addProfit(amount, name, subOrder["price-bought"], price, date_bought, Date.now(), doBazaarFees);
                    }
                }
            }
            return 'ERROR: More insta selling that in investments';
        } else {
            return 'ERROR: No investment found for insta sell';
        }
    }
    addProfit(amount, name, buy_price, sell_price, date_bought, date_sold, doFees, type = 'bazaar') {
        const dateOfTransaction = morningTime(Date.now()).toString();

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
        } else {
            trader_data["all-products"][name]["current-amount"] -= amount;
        }

        trader_data["all-products"][name]["current-amount"] -= amount;
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

        return 'ERROR: Failed to fill a buy order';
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
                    trader_data["all-products"][name]["buy-order-stats"]["total-buy-orders-created"] += 1;
                    trader_data["all-products"][name]["buy-order-stats"]["total-buy-amount-claimed"] += amount;
                    trader_data["all-products"][name]["buy-order-stats"]["total-buy-amount-placed-for-buying"] += buyOrder["buying-amount"];
                    trader_data["all-products"][name]["buy-order-stats"]["buy-average"] += 
                        trader_data["all-products"][name]["buy-order-stats"]["total-buy-amount-claimed"] /
                        trader_data["all-products"][name]["buy-order-stats"]["total-buy-orders-created"];
                }

                return 'Buy order claiming completed';
            }
        }

        return 'ERROR: Failed to claim a buy order';
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

        return 'ERROR: Failed to cancel a buy order';
    }
    sellOrderSetup(amount, price, name) {
        const resellPrice = price;
        const invesmentType = getInvestmentType(product_list[name]["type"]); 
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

        return 'ERROR: Failed to fill a sell order';
    }
    sellOrderClaim(amount, price_sold, name) {
        // get the current sell orders
        const sellOrders = new Sort(trader_data["sell-order-overview"]["sell-orders"], false, "sell-order-place-time");
        
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
        if (current_sell_order_index === -1 || sellOrders.length === 0) return 'ERROR: No sell order found to claim';

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

                addSellClaimToProducts(name, amount, subOrder["partial-selling-amount"], true);

                return this.addProfit(amount, name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true);
            } else {
                // determine if the last suborder is bought out
                if (trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].length <= 1) {
                    // remove the whole order
                    trader_data["sell-order-overview"]["sell-orders"].splice(current_sell_order_index, 1);

                    // calculate the profit from the sell order
                    const date_bought = subOrder["time-bought"];

                    addSellClaimToProducts(name, amount, subOrder["partial-selling-amount"], true);

                    return this.addProfit(amount, name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true);
                } else {
                    // just remove the suborder
                    trader_data["sell-order-overview"]["sell-orders"][current_sell_order_index]["sub-orders"].splice(0, 1);

                    // calculate the profit for just this sell order
                    const date_bought = subOrder["time-bought"];

                    addSellClaimToProducts(name, amount, subOrder["partial-selling-amount"], false);

                    this.addProfit(amount, name, subOrder["price-bought"], price_sold, date_bought, Date.now(), true);
                }
            }
        }
        return 'ERROR: More insta selling that in investments';

        function addSellClaimToProducts(name, amount, orderSellAmount, orderFilled) {
            let changeOrderCountBy = 0
            if (orderFilled) changeOrderCountBy = 1;

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
                        "total-sell-orders-created": changeOrderCountBy,
                        "total-sell-amount-claimed": amount,
                        "total-sell-amount-placed-for-selling": orderSellAmount,
                        "sell-average": 0
                    },
                    "max-amount": 2000,
                    "total-profit-made": 0,
                    "total-sold": 0,
                    "crafting-materials": "none"
                };

                console.log('This is weird, im making product data on a sell order before its even been bought before.')
            } else {
                trader_data["all-products"][name]["sell-order-stats"]["total-sell-orders-created"] += changeOrderCountBy;
                trader_data["all-products"][name]["sell-order-stats"]["total-sell-amount-claimed"] += amount;
                trader_data["all-products"][name]["sell-order-stats"]["total-sell-amount-placed-for-selling"] += orderSellAmount;
                if (changeOrderCountBy === 1) {
                    trader_data["all-products"][name]["sell-order-stats"]["sell-average"] += 
                        trader_data["all-products"][name]["sell-order-stats"]["total-sell-amount-claimed"] /
                        trader_data["all-products"][name]["sell-order-stats"]["total-sell-orders-created"];
                }
            }
        }
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
        if (current_sell_order_index === -1 || sellOrders.length === 0) return 'ERROR: No sell order found to cancel';

        const currentSellOrder = sellOrders[current_sell_order_index];
        const invesmentType = getInvestmentType(product_list[name]["type"]); 
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
        if (current_buy_order_index === -1 || buyOrders.length === 0) return 'ERROR: No buy order found to flip';

        const currentBuyOrder = buyOrders[current_buy_order_index];
        const priceBought = currentBuyOrder["price-buying"];
        const profitPerUnit = profit / amount;

        this.buyOrderClaim(amount, priceBought, name);
        this.sellOrderSetup(amount, (priceBought + profitPerUnit), name);

        return 'Buy order flipped';
    }
    npcSell(amount, price, name) {
        this.instaSell(amount, price, name, false);

        return 'NPC sell completed';
    }
    auctionCreation(price, name) {
        /////////////////////// remove crafting materials from short term investments if no item can be found
        
        // remove the product from the long term investments by highest cost
        

        trader_data["auction-house-overview"]["auctions"].push({
            "item-name": name,
            "auction-id": "idk",
            "material-cost": 0,
            "price-selling": price,
            "sold": false,
            "date-placed": Date.now()
        });


        return 'Auction created';
    }
    auctionClaim(price, name) {
        // make sure to account for creation fee
    }
    auctionCancel(name) {
        
    }
    supercraft(name) {
        // determine if product has already been created
        if (Object.keys(trader_data["long-term-investments"]).indexOf(name) != -1) {
            trader_data["long-term-investments"][name]["sub-orders"].push({

            });
        } else {

        }


        return 'Supercraft successful';
    }
}

let bazaar_data = {};

const update_seconds = 5;
setInterval(updateBazaarData, update_seconds * 1000);

async function updateBazaarData() {
    try {
        const response = await fetch("https://api.hypixel.net/v2/skyblock/bazaar");
        bazaar_data = await response.json();
        bazaar_data = bazaar_data['products'];
    } catch (e) {
        console.log(e)
    }
}

updateBazaarData();

let server = http.createServer(function (request, response) {
    response.writeHead(200, { "Content-Type": "text\plain" });
    if (request.method == "GET") {
        response.end("received GET request.")
    }
    else if (request.method == "POST") {
        request.on('data', function(data) {
            console.log('Data from POST: ' + data)
            new ProcesTrade(data.toString());
            fs.writeFile(
                "./trader-data.json", 
                JSON.stringify(trader_data), 
                function(err) {
                    if (err) throw err;
                    // console.log('Completed file write for trader data');
                }
            );
        });
        response.end("received POST request.");
    }
    else {
        response.end("Undefined request .");
    }
});

server.listen(8000);
console.log("Server running on port 8000");

// some of the returns need to be changed back into throws