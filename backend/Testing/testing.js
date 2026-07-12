const BAZAAR_TAX_RATE = 0.01; // Your 1% maxed out Flipper Tax
const EPSILON = 0.05;         // Threshold to handle standard JS floating-point issues

/**
 * Parses raw text lines directly from your chat logger.
 */
function parseBazaarChatMessage(chatLine) {
    if (!chatLine) return null;

    const cleanLine = chatLine.replace(/,/g, '');

    const buyMatch = cleanLine.match(/Buy Order Setup!\s+(\d+)x\s+(.+?)\s+for\s+(\d+)\s+coins/i);
    if (buyMatch) {
        const amount = parseInt(buyMatch[1], 10);
        const itemName = buyMatch[2].trim();
        const displayTotal = parseInt(buyMatch[3], 10);
        const calculatedPricePerUnit = displayTotal / amount;

        return {
            action: 'BUY_ORDER',
            itemName: itemName,
            amount: amount,
            chatCoins: displayTotal,
            pricePerUnit: Math.round(calculatedPricePerUnit * 10) / 10,
            hasDecimal: chatLine.includes('.') // Flag to check if game printed a decimal
        };
    }

    const sellMatch = cleanLine.match(/Claimed\s+(\d+)\s+coins\s+from\s+selling\s+(\d+)x\s+(.+?)\s+at\s+([\d.]+)\s+each/i);
    if (sellMatch) {
        const displayTotal = parseInt(sellMatch[1], 10);
        const amount = parseInt(sellMatch[2], 10);
        let itemName = sellMatch[3].trim().replace(/^\?\s*/, ''); 
        const listedPricePerUnit = parseFloat(sellMatch[4]);

        return {
            action: 'SELL_CLAIM',
            itemName: itemName,
            amount: amount,
            chatCoins: displayTotal,
            pricePerUnit: listedPricePerUnit,
            hasDecimal: sellMatch[4].includes('.') // Track if the printed string has a dot
        };
    }

    return null;
}

/**
 * Advanced matching algorithm that safely connects floored chat integers to .1 database entries
 */
function matchAndAdjustTrackedOrders(chatLine, activeOrdersArray) {
    const parsedData = parseBazaarChatMessage(chatLine);
    if (!parsedData) return null;

    console.log(`\n🔍 Scanning chat log for: ${parsedData.amount}x ${parsedData.itemName} at ${parsedData.pricePerUnit}/ea (Has Decimal: ${parsedData.hasDecimal})`);

    const potentialMatches = activeOrdersArray.filter(order => {
        const itemMatch = order.itemName.toLowerCase() === parsedData.itemName.toLowerCase();
        const actionMatch = (parsedData.action === 'BUY_ORDER' && order.type === 'BUY') ||
                            (parsedData.action === 'SELL_CLAIM' && order.type === 'SELL');
        const statusMatch = order.status !== "FULLY_CLAIMED" && order.remainingAmount > 0;
        
        return itemMatch && actionMatch && statusMatch;
    });

    let bestOrder = null;
    let smallestScore = Infinity;

    for (const order of potentialMatches) {
        let isPriceMatch = false;
        let specializedPenalty = 0;

        if (parsedData.hasDecimal) {
            // Case A: Chat explicitly has a decimal. Use strict near-exact matching.
            const priceDifference = Math.abs(order.pricePerUnit - parsedData.pricePerUnit);
            if (priceDifference <= 0.15) {
                isPriceMatch = true;
                specializedPenalty = priceDifference < EPSILON ? 0 : priceDifference * 10000;
            }
        } else {
            // Case B: Chat lacks decimals (High Coinage). 
            // Check if the floor of your database price matches the integer from chat.
            const dbFlooredPrice = Math.floor(order.pricePerUnit);
            if (dbFlooredPrice === parsedData.pricePerUnit) {
                isPriceMatch = true;
                
                // Tie breaker: Calculate the difference between the underlying raw data fractions.
                // We extract the fractional part (e.g. 26122.1 -> 0.1) to favor an exact matchup.
                const decimalRemainder = order.pricePerUnit - dbFlooredPrice;
                specializedPenalty = decimalRemainder * 10; 
            }
        }

        // If the price logic checks out, grade it alongside volume data
        if (isPriceMatch) {
            const volumeDifference = Math.abs(order.remainingAmount - parsedData.amount);
            
            // Total score: Lowest score represents the absolute best match
            const currentScore = specializedPenalty + volumeDifference;

            if (currentScore < smallestScore) {
                smallestScore = currentScore;
                bestOrder = order;
            }
        }
    }

    if (bestOrder) {
        console.log(`✅ Success! Linked to Order ID: ${bestOrder.id} (Database Entry Price was: ${bestOrder.pricePerUnit})`);
        
        if (parsedData.action === 'SELL_CLAIM') {
            bestOrder.remainingAmount -= parsedData.amount;
            if (bestOrder.remainingAmount <= 0) {
                bestOrder.remainingAmount = 0;
                bestOrder.status = "FULLY_CLAIMED";
            }
        } else if (parsedData.action === 'BUY_ORDER') {
            bestOrder.status = "ACTIVE_ORDER";
        }
        
        return bestOrder;
    } else {
        console.log(`❌ Tracker mismatch: No database profiles fit the parsed pricing signature.`);
        return null;
    }
}

// Database state tracking your orders precisely
const myTrackerDatabase = [
    { id: "cheaper_126k_order", type: "SELL", itemName: "Fine Onyx Gemstone", pricePerUnit: 126122.0, remainingAmount: 1000, status: "OPEN" },
    { id: "pricier_126k_order", type: "SELL", itemName: "Fine Onyx Gemstone", pricePerUnit: 126122.1, remainingAmount: 1000, status: "OPEN" }
];

// High coinage logs without decimal strings printed
const logLines = [
    "[Bazaar] Claimed 124,860,879 coins from selling 1,000x ? Fine Onyx Gemstone at 126,122 each!", 
    "[Bazaar] Claimed 124,860,780 coins from selling 1,000x ? Fine Onyx Gemstone at 126,122 each!"
];

// Process first log line
matchAndAdjustTrackedOrders(logLines[0], myTrackerDatabase);
// Process second log line
matchAndAdjustTrackedOrders(logLines[1], myTrackerDatabase);

