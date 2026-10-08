// Mayor reminders: what the current mayor, the election leader and recent mayors
// mean for prices, served to the mod's Bazaar window and the dashboard from
// GET /api/mayor-data.
//
//   mayor-info.json           your notes, keyed by mayor name: buy-before, sell-before,
//                             buy-during, sell-during, watch-during, buy-after
//                             ({ product: SkyBlock years }) and free-text notes. Edit
//                             freely; it is re-read on every request.
//   mayor-history.json        each term this server has seen, written here and re-read
//                             on every request, so hand edits apply straight away. Hypixel's
//                             election API only ever returns the current mayor, so a
//                             term from before this file existed has to be added by
//                             hand: { "mayor": "Diana", "elected-year": 510 }
//   mayor-price-history.json  prices of every product in mayor-info.json, sampled every
//                             half hour and kept for two weeks, for the trend hints
//
// It also owns the SkyBlock calendar (election end, Spooky Festival) so the mod and
// the dashboard read one set of times instead of each doing the maths, and it sets
// the Bazaar tax multiplier while Derpy's QUAD TAXES perk is active.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import product_list from './product-list.json' with { type: "json" };
import { marketData, setDerpyTaxMultiplier } from './backend.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mayorInfoPath = path.join(__dirname, 'mayor-info.json');
const historyPath = path.join(__dirname, 'mayor-history.json');
const priceHistoryPath = path.join(__dirname, 'mayor-price-history.json');

// SkyBlock calendar, with the constants the dashboard's updateCalendar used.
const SB_EPOCH_MS = 1560275700000; // June 11, 2019, 17:55:00 UTC
const SB_YEAR_MS = 124 * 3600 * 1000;
const ELECTION_OFFSET_MS = 29 * 3600 * 1000 + 20 * 60 * 1000;
const SPOOKY_OFFSET_MS = 52 * 3600 * 1000 + 20 * 60 * 1000 + ELECTION_OFFSET_MS;
const SPOOKY_DURATION_MS = 60 * 60 * 1000; // three SkyBlock days

const ELECTION_REFRESH_MS = 5 * 60 * 1000;
const PRICE_SAMPLE_INTERVAL_MS = 30 * 60 * 1000;
const PRICE_RETENTION_MS = 14 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// Trend thresholds: a day-on-day move inside this is "flat", and a price within
// BOTTOM_MARGIN of its low over the window is sitting on the bottom.
const TREND_THRESHOLD = 0.03;
const BOTTOM_MARGIN = 0.05;

const ECTOPLASM = 'Ectoplasm';

let election = null;
let priceHistory = loadJson(priceHistoryPath, {});

export function skyblockYear(now = Date.now()) {
    return Math.floor((now - SB_EPOCH_MS) / SB_YEAR_MS) + 1;
}

// When the election held in `year` closes. Its winner serves from then until the
// next one closes, electionEnd(year + 1): one SkyBlock year.
function electionEnd(year) {
    return SB_EPOCH_MS + ELECTION_OFFSET_MS + year * SB_YEAR_MS;
}

function spookyStart(year) {
    return SB_EPOCH_MS + SPOOKY_OFFSET_MS + (year - 1) * SB_YEAR_MS;
}

function loadJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function saveJson(filePath, value) {
    const tempPath = filePath + '.tmp';
    fs.writeFile(tempPath, JSON.stringify(value, null, 2), (err) => {
        if (err) return console.error(`Error writing ${path.basename(filePath)}:`, err);
        fs.rename(tempPath, filePath, (renameErr) => {
            if (renameErr) console.error(`Error renaming ${path.basename(filePath)}:`, renameErr);
        });
    });
}

function readMayorInfo() {
    return loadJson(mayorInfoPath, {});
}

function readHistory() {
    const history = loadJson(historyPath, { terms: [] });
    if (!Array.isArray(history.terms)) history.terms = [];
    return history;
}

async function updateElection() {
    try {
        const response = await fetch('https://api.hypixel.net/v2/resources/skyblock/election');
        if (!response.ok) {
            console.error(`Election fetch failed: ${response.status} ${response.statusText}`);
            return;
        }
        const payload = await response.json();
        if (!payload.success || !payload.mayor) return;

        election = payload;
        recordTerm(payload.mayor);

        const quadTaxes = (payload.mayor.perks || []).some(perk => /QUAD TAXES/i.test(perk.name || ''));
        setDerpyTaxMultiplier(quadTaxes ? 4 : 1);
    } catch (e) {
        console.error('Election fetch failed:', e?.message || e);
    }
}

// Adds the current mayor's term to mayor-history.json the first time it is seen.
function recordTerm(mayor) {
    const electedYear = mayor.election?.year;
    if (!electedYear) return;

    // Read fresh, so a term added by hand since the last check is kept.
    const history = readHistory();
    if (history.terms.some(term => term['elected-year'] === electedYear)) return;

    history.terms.push({ "mayor": mayor.name, "elected-year": electedYear });
    history.terms.sort((a, b) => a['elected-year'] - b['elected-year']);
    saveJson(historyPath, history);
    console.log(`Mayor history: recorded ${mayor.name} for year ${electedYear}`);
}

// A term with its start and end worked out from the year it was elected, so a
// hand-added term only needs the mayor and the year.
function termTimes(term) {
    return {
        ...term,
        "term-start": electionEnd(term['elected-year']),
        "term-end": electionEnd(term['elected-year'] + 1)
    };
}

// Every product named anywhere in mayor-info.json, plus Ectoplasm for the festival.
function watchedProducts(info) {
    const names = new Set([ECTOPLASM]);
    for (const notes of Object.values(info)) {
        for (const list of ['buy-before', 'sell-before', 'buy-during', 'sell-during', 'watch-during']) {
            for (const name of notes?.[list] || []) names.add(name);
        }
        for (const name of Object.keys(notes?.['buy-after'] || {})) names.add(name);
    }
    return names;
}

// Buy order and insta-buy price off the Bazaar. The reminders are about the Bazaar
// only, so a product it does not list has no price.
function priceOf(name) {
    const apiName = product_list[name]?.['api-name'];
    const product = apiName ? marketData.bazaarProducts?.[apiName] : undefined;
    if (!product) return null;

    return {
        "buy-order": product.sell_summary?.[0]?.pricePerUnit ?? null,
        "insta-buy": product.buy_summary?.[0]?.pricePerUnit ?? null
    };
}

function samplePrices() {
    const now = Date.now();
    let sampled = false;

    for (const name of watchedProducts(readMayorInfo())) {
        const samples = priceHistory[name] || (priceHistory[name] = []);
        const last = samples[samples.length - 1];
        if (last && now - last[0] < PRICE_SAMPLE_INTERVAL_MS) continue;

        const price = priceOf(name);
        if (!price || price['buy-order'] == null) continue;

        samples.push([now, price['buy-order'], price['insta-buy']]);
        while (samples.length > 0 && now - samples[0][0] > PRICE_RETENTION_MS) samples.shift();
        sampled = true;
    }

    if (sampled) saveJson(priceHistoryPath, priceHistory);
}

// Where a product's buy order price is heading, for the "bottoming out" hint:
//   falling    more than 3% below the same time yesterday
//   bottoming  not falling, and within 5% of its low since `since`
//   rising     more than 3% above yesterday
//   flat       none of those
//   collecting under a day of samples so far
function trendOf(name, since) {
    const now = Date.now();
    const current = priceOf(name)?.['buy-order'];
    const samples = priceHistory[name] || [];
    if (current == null || samples.length === 0) return { "state": "collecting" };

    const windowStart = Math.max(since ?? now - 7 * DAY_MS, now - PRICE_RETENTION_MS);
    const low = Math.min(current, ...samples.filter(sample => sample[0] >= windowStart).map(sample => sample[1]));

    if (now - samples[0][0] < DAY_MS) return { "state": "collecting", "low": low };

    const dayAgo = samples.filter(sample => now - sample[0] >= DAY_MS - 2 * 3600 * 1000 && now - sample[0] <= DAY_MS + 2 * 3600 * 1000);
    const dayAgoPrice = dayAgo.length > 0 ? dayAgo.reduce((sum, sample) => sum + sample[1], 0) / dayAgo.length : null;
    const change = dayAgoPrice ? current / dayAgoPrice - 1 : 0;

    let state = 'flat';
    if (change < -TREND_THRESHOLD) state = 'falling';
    else if (current <= low * (1 + BOTTOM_MARGIN)) state = 'bottoming';
    else if (change > TREND_THRESHOLD) state = 'rising';

    return { "state": state, "change": change, "low": low };
}

export function getMayorData() {
    const now = Date.now();
    const info = readMayorInfo();
    const year = skyblockYear(now);

    const mayor = election?.mayor;
    const mayorName = mayor?.name ?? null;
    const electedYear = mayor?.election?.year ?? null;
    const current = election?.current;
    const leader = current?.candidates?.length
        ? [...current.candidates].sort((a, b) => b.votes - a.votes)[0]
        : null;

    const reminders = [];
    const notes = [];
    const remind = (timing, action, from, product, extra = {}) => reminders.push({
        "timing": timing,
        "action": action,
        "mayor": from,
        "product": product,
        "price": priceOf(product),
        "trend": trendOf(product, extra.since),
        ...extra
    });

    // During: the mayor in office now.
    const inOffice = info[mayorName];
    if (inOffice) {
        for (const product of inOffice['buy-during'] || []) remind('during', 'buy', mayorName, product);
        for (const product of inOffice['sell-during'] || []) remind('during', 'sell', mayorName, product);
        for (const product of inOffice['watch-during'] || []) remind('during', 'watch', mayorName, product);
        for (const text of inOffice['notes'] || []) notes.push({ "timing": "during", "mayor": mayorName, "text": text });
    }

    // Before: whoever is leading the running election. Prices move once it is clear
    // who will win, so these are worth acting on while the election is still open.
    if (leader && leader.name !== mayorName && info[leader.name]) {
        for (const product of info[leader.name]['buy-before'] || []) remind('before', 'buy', leader.name, product);
        for (const product of info[leader.name]['sell-before'] || []) remind('before', 'sell', leader.name, product);
        for (const text of info[leader.name]['notes'] || []) notes.push({ "timing": "before", "mayor": leader.name, "text": text });
    }

    // After: the years following a term. The current mayor's show up already, as
    // upcoming, so the watch starts the moment their term ends.
    const seen = new Set();
    const terms = readHistory().terms.map(termTimes).sort((a, b) => b['elected-year'] - a['elected-year']);
    for (const term of terms) {
        for (const [product, years] of Object.entries(info[term.mayor]?.['buy-after'] || {})) {
            const key = `${term.mayor}|${product}`;
            if (seen.has(key)) continue;

            const windowStart = term['term-end'];
            const windowEnd = windowStart + years * SB_YEAR_MS;
            const isCurrentTerm = term['elected-year'] === electedYear;
            if (now >= windowEnd || (now < windowStart && !isCurrentTerm)) continue;

            seen.add(key);
            remind('after', 'buy', term.mayor, product, {
                "since": windowStart,
                "window-starts": windowStart,
                "window-ends": windowEnd
            });
        }
    }

    // The next festival, or the one running now.
    let spookyYear = year;
    if (now >= spookyStart(spookyYear) + SPOOKY_DURATION_MS) spookyYear++;
    const festivalStart = spookyStart(spookyYear);

    return {
        "sb-year": year,
        "mayor": mayor ? {
            "name": mayorName,
            "elected-year": electedYear,
            "term-end": electionEnd(electedYear + 1)
        } : null,
        "election": electedYear ? {
            "year": current?.year ?? electedYear + 1,
            "ends-at": electionEnd(current?.year ?? electedYear + 1),
            "leader": leader?.name ?? null,
            "candidates": (current?.candidates || []).map(c => ({ "name": c.name, "votes": c.votes }))
        } : null,
        "spooky-festival": {
            "starts-at": festivalStart,
            "ends-at": festivalStart + SPOOKY_DURATION_MS
        },
        "ectoplasm": { "price": priceOf(ECTOPLASM), "trend": trendOf(ECTOPLASM) },
        "tax-multiplier": (mayor?.perks || []).some(perk => /QUAD TAXES/i.test(perk.name || '')) ? 4 : 1,
        "reminders": reminders,
        "notes": notes,
        "last-updated": election?.lastUpdated ?? null
    };
}

updateElection();
setInterval(updateElection, ELECTION_REFRESH_MS);
// Market data arrives a few seconds after startup; checking every minute picks it up
// and keeps each product to one sample per half hour.
setInterval(samplePrices, 60 * 1000);
