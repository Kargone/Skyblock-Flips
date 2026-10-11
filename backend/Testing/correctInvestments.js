// Sets investment amounts in trader-data.json to what is actually held in game,
// for when tracking has drifted. Lots are used up highest price first, the same way
// an insta-sell uses them, and no profit is recorded for what is taken off.
//
//   node correctInvestments.js           shows what would change
//   node correctInvestments.js --apply   changes trader-data.json
//
// The backend keeps trader data in memory and saves it over the file, so it has to
// be stopped first or it undoes the correction.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Item name (without the symbol some names, like gemstones, start with) -> amount held.
const CORRECTIONS = {
    "Enchanted Emerald": 161,
    "Enchanted Wet Sponge": 0,
    "Fine Jade Gemstone": 0,
    "Fine Amber Gemstone": 144,
    "Miner Zombie Shard": 0,
    "Enchanted Bone": 23,
    "Enchanted Diamond": 0,
    "Wolf Tooth": 184,
    "Null Ovoid": 0,
    "Enchanted Leather": 154,
    "Ancient Claw": 1109,
    "Golden Tooth": 3062,
    "Red Claw Egg": 24,
    "Griffin Feather": 16708,
};

const SERVER_URL = 'http://localhost:8000';
const traderDataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'production', 'trader-data.json');
const backupPath = traderDataPath.replace(/\.json$/, '.before-correction.json');
const INVESTMENT_TYPES = ["short-term-investments", "long-term-investments"];

async function serverIsRunning() {
    try {
        await fetch(`${SERVER_URL}/api/last-trade-time`, { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

function totalAmount(investment) {
    return investment["sub-orders"].reduce((sum, subOrder) => sum + subOrder["partial-amount"], 0);
}

// "Ancient Claw" must not also match "Enchanted Ancient Claw", so the match has to
// be the whole name or the name after a leading symbol.
function findInvestment(traderData, itemName) {
    for (const type of INVESTMENT_TYPES) {
        for (const name of Object.keys(traderData[type])) {
            if (name === itemName || name.replace(/^[^A-Za-z0-9\s]+ /, '') === itemName) return { type, name };
        }
    }
    return null;
}

async function main() {
    const apply = process.argv.includes('--apply');
    if (apply && await serverIsRunning()) {
        console.error('The backend is running. Stop it first, or it will save its own copy over the correction.');
        process.exitCode = 1;
        return;
    }

    const traderData = JSON.parse(fs.readFileSync(traderDataPath, 'utf8'));

    for (const [itemName, target] of Object.entries(CORRECTIONS)) {
        const found = findInvestment(traderData, itemName);
        if (!found) {
            console.log(`${itemName}: no investment found, skipped`);
            continue;
        }
        const { type, name } = found;
        const investment = traderData[type][name];
        const current = totalAmount(investment);

        if (target > current) {
            console.log(`${name}: holding ${current}, which is less than ${target}; adding lots needs a price, skipped`);
            continue;
        }
        if (target === current) {
            console.log(`${name}: already ${current}`);
            continue;
        }

        let toRemove = current - target;
        const subOrders = investment["sub-orders"].sort((a, b) => b["price-bought"] - a["price-bought"]);
        while (toRemove > 0 && subOrders.length > 0) {
            const taken = Math.min(subOrders[0]["partial-amount"], toRemove);
            subOrders[0]["partial-amount"] -= taken;
            toRemove -= taken;
            if (subOrders[0]["partial-amount"] === 0) subOrders.shift();
        }

        if (subOrders.length === 0) delete traderData[type][name];
        if (traderData["all-products"][name]) traderData["all-products"][name]["current-amount"] = target;

        console.log(`${name}: ${current} -> ${target}${target === 0 ? ' (removed)' : ''}`);
    }

    if (!apply) {
        console.log('\nNothing changed. Run with --apply to save these.');
        return;
    }

    fs.copyFileSync(traderDataPath, backupPath);
    fs.writeFileSync(traderDataPath, JSON.stringify(traderData, null, 2));
    console.log(`\nSaved. The file as it was is in ${path.basename(backupPath)}.`);
}

main().catch(error => console.error('Error correcting investments:', error));
