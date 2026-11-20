// Runs every message in pastTradesLogs.json through TRADE_PATTERNS (server/consts.mjs)
// and reports, per message type, how many matched and what the groups captured.
// Changes nothing, and the backend does not need to be stopped.
//
//   node testTradePatterns.js
//
// A type is judged by a plain keyword test (the ones the old constructor used),
// so a pattern that misses messages it should have caught shows up as MISSED.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRADE_PATTERNS } from '../server/consts.mjs';
import { toTradeMessage } from '../server/trade-format.mjs';

const logsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'pastTradesLogs.json');
const MAX_EXAMPLES = 3;

// For each type: how to spot its messages without a regex, and the groups its
// handler in backend.mjs reads. Listed in the order the old constructor checked them.
const EXPECTED = [
    { type: 'insta-buy', groups: ['amount', 'name', 'coins'], looksLike: m => m.includes('[Bazaar] Bought') },
    { type: 'insta-sell', groups: ['amount', 'name', 'coins'], looksLike: m => m.includes('[Bazaar] Sold') },
    { type: 'buy-order-setup', groups: ['amount', 'name', 'coins'], looksLike: m => m.includes('[Bazaar] Buy Order Setup!') },
    { type: 'buy-order-fill', groups: ['amount', 'name'], looksLike: m => m.includes('[Bazaar] Your Buy Order for') },
    { type: 'buy-order-claim', groups: ['amount', 'name', 'total_price'], looksLike: m => m.includes('[Bazaar] Claimed') && m.includes('bought for') },
    { type: 'buy-order-cancel', groups: ['coins'], looksLike: m => m.includes('[Bazaar] Cancelled!') && m.includes('Buy Order!') },
    { type: 'sell-order-setup', groups: ['amount', 'name', 'coins'], looksLike: m => m.includes('[Bazaar] Sell Offer Setup!') },
    { type: 'sell-order-fill', groups: ['amount', 'name'], looksLike: m => m.includes('[Bazaar] Your Sell Offer for') },
    { type: 'sell-order-claim', groups: ['coins', 'amount', 'name'], looksLike: m => m.includes('[Bazaar] Claimed') && m.includes('from selling') },
    { type: 'sell-order-cancel', groups: ['amount', 'name'], looksLike: m => m.includes('[Bazaar] Cancelled!') && m.includes('Sell Offer!') },
    { type: 'order-flipped', groups: ['amount', 'name', 'profit'], looksLike: m => m.includes('[Bazaar] Order Flipped!') },
    { type: 'npc-sell', groups: ['name', 'amount', 'coins'], looksLike: m => m.includes('You sold') },
    { type: 'npc-buy', groups: ['name', 'amount', 'coins'], looksLike: m => m.includes('You bought back') },
    { type: 'auction-creation', groups: ['name', 'price'], looksLike: m => m.includes('created a BIN auction for') },
    { type: 'auction-claim', groups: ['price', 'name'], looksLike: m => m.includes('You collected') && !m.includes('[NPC] Jacob') },
    { type: 'auction-cancel', groups: ['name'], looksLike: m => m.includes('cancelled an auction for') },
    { type: 'auction-sold', groups: ['name', 'price'], looksLike: m => m.includes('[Auction]') },
    // " coins!" keeps out shop lines from other game modes, like "You purchased Wood"
    { type: 'auction-bought', groups: ['name', 'price'], looksLike: m => m.includes('You purchased') && m.includes(' coins!') },
    { type: 'auction-expired', groups: ['name'], looksLike: m => m.includes('back from your expired auction!') },
    { type: 'supercraft', groups: ['name'], looksLike: m => m.includes('You Supercrafted') },
    { type: 'item-removed', groups: ['amount', 'name'], looksLike: m => m.includes('xjk You removed') },
];

const NUMBER = /^-?\d[\d,]*(\.\d+)?$/;

// returns what is wrong with the captured groups, or null if they look right
function checkGroups(groups, wanted) {
    for (const name of wanted) {
        const value = groups?.[name];
        if (value === undefined) return `no group named "${name}"`;
        if (name === 'name') {
            if (value !== value.trim() || value === '') return `name is "${value}"`;
        } else if (!NUMBER.test(value)) {
            return `${name} is "${value}", which is not a number`;
        }
    }
    return null;
}

const messages = JSON.parse(fs.readFileSync(logsPath, 'utf8'))
    .map(entry => toTradeMessage(entry))
    .filter(message => message.type === 'chat') // forge snapshots have no chat text
    .map(message => message.text)
    .filter(message => !message.includes('Guild >'));

const stats = new Map(EXPECTED.map(e => [e.type, { seen: 0, matched: 0, sample: null, problems: [] }]));
const strays = []; // matched a pattern, but no keyword test says it is a trade

for (const message of messages) {
    const expected = EXPECTED.find(e => e.looksLike(message));
    let actual = null;
    for (const pattern of TRADE_PATTERNS) {
        const found = pattern.re && message.match(pattern.re);
        if (found) {
            actual = { type: pattern.type, groups: found.groups };
            break;
        }
    }

    if (!expected) {
        if (actual) strays.push(`${actual.type} matched: ${message}`);
        continue;
    }

    const stat = stats.get(expected.type);
    stat.seen++;
    if (!actual) {
        stat.problems.push(`MISSED: ${message}`);
    } else if (actual.type !== expected.type) {
        stat.problems.push(`WRONG TYPE (${actual.type}): ${message}`);
    } else {
        const problem = checkGroups(actual.groups, expected.groups);
        if (problem) {
            stat.problems.push(`BAD GROUPS (${problem}): ${message}`);
        } else {
            stat.matched++;
            stat.sample ??= { message, groups: { ...actual.groups } };
        }
    }
}

let failed = false;
console.log(`${messages.length} chat messages from pastTradesLogs.json\n`);

for (const { type, groups } of EXPECTED) {
    const stat = stats.get(type);
    const pattern = TRADE_PATTERNS.find(p => p.type === type);

    if (!pattern) {
        failed = true;
        console.log(`FAIL  ${type}: no entry in TRADE_PATTERNS`);
    } else if (!pattern.re) {
        console.log(`TODO  ${type}: not written yet, ${stat.seen} messages waiting. Groups needed: ${groups.join(', ')}`);
    } else if (stat.problems.length > 0) {
        failed = true;
        console.log(`FAIL  ${type}: ${stat.matched}/${stat.seen} matched`);
        for (const problem of stat.problems.slice(0, MAX_EXAMPLES)) console.log(`        ${problem}`);
        if (stat.problems.length > MAX_EXAMPLES) console.log(`        ...and ${stat.problems.length - MAX_EXAMPLES} more`);
    } else if (stat.seen === 0) {
        console.log(`----  ${type}: no messages of this type in the logs, so it is untested`);
    } else {
        console.log(`ok    ${type}: ${stat.matched}/${stat.seen} matched`);
        console.log(`        ${stat.sample.message}`);
        console.log(`        ${JSON.stringify(stat.sample.groups)}`);
    }
}

if (strays.length > 0) {
    failed = true;
    console.log(`\nFAIL  ${strays.length} messages matched a pattern they should not have:`);
    for (const stray of strays.slice(0, MAX_EXAMPLES)) console.log(`        ${stray}`);
}

process.exitCode = failed ? 1 : 0;
