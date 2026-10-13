// Mayor reminders: what the current mayor and minister, the running election and
// recent terms mean for prices, served to the mod's Bazaar window and the dashboard
// from GET /api/mayor-data.
//
// A mayor's perks change from one election to the next, and a minister brings only
// one of them, so the notes are kept per perk and apply only when that perk is in.
//
//   mayor-info.json           your notes: { mayor: { notes, perks: { perk: lists } } }.
//                             Each perk has buy-before, sell-before, buy-during,
//                             sell-during, watch-during, buy-after ({ product: SkyBlock
//                             years }) and free-text notes. The mayor's own notes show
//                             whenever they are mayor, whatever their perks. Edit
//                             freely; it is re-read on every request.
//   mayor-history.json        each term this server has seen, written here and re-read
//                             on every request, so hand edits apply straight away. Hypixel's
//                             election API only ever returns the current mayor, so a
//                             term from before this file existed has to be added by
//                             hand: { "mayor": "Diana", "elected-year": 510 }. A term
//                             without "perks" counts as having every perk in the notes.
//                             The server also records "perks", "minister" and
//                             "minister-perk" for the terms it sees.
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

// Perk names compared without case or punctuation, so "QUAD TAXES!!!" from the API
// matches "QUAD TAXES" in the notes.
function perkKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function perkNames(perks) {
    return (perks || []).map(perk => perk.name).filter(Boolean);
}

// [perk, notes] for each of `person`'s noted perks that is in `names`, or for all of
// them when `names` is not known.
function notedPerks(info, person, names) {
    const perks = Object.entries(info[person]?.perks || {});
    if (!names) return perks;
    const wanted = new Set(names.map(perkKey));
    return perks.filter(([perk]) => wanted.has(perkKey(perk)));
}

function hasQuadTaxes(names) {
    return names.some(name => perkKey(name) === perkKey('QUAD TAXES'));
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

        setDerpyTaxMultiplier(currentTaxMultiplier());
    } catch (e) {
        console.error('Election fetch failed:', e?.message || e);
    }
}

// QUAD TAXES quadruples the tax whether the mayor or the minister brings it.
function currentTaxMultiplier() {
    const mayor = election?.mayor;
    if (!mayor) return 1;
    return hasQuadTaxes([...perkNames(mayor.perks), mayor.minister?.perk?.name]) ? 4 : 1;
}

// Adds the current term to mayor-history.json the first time it is seen, with its
// perks and minister, and fills those in on a term recorded before they were kept.
function recordTerm(mayor) {
    const electedYear = mayor.election?.year;
    if (!electedYear) return;

    const details = {
        "perks": perkNames(mayor.perks),
        ...(mayor.minister?.name ? {
            "minister": mayor.minister.name,
            "minister-perk": mayor.minister.perk?.name ?? null
        } : {})
    };

    // Read fresh, so a term added by hand since the last check is kept.
    const history = readHistory();
    const existing = history.terms.find(term => term['elected-year'] === electedYear);
    if (existing) {
        if (existing.perks && (existing.minister || !details.minister)) return;
        Object.assign(existing, details);
        console.log(`Mayor history: recorded perks and minister for year ${electedYear}`);
    } else {
        history.terms.push({ "mayor": mayor.name, "elected-year": electedYear, ...details });
        history.terms.sort((a, b) => a['elected-year'] - b['elected-year']);
        console.log(`Mayor history: recorded ${mayor.name} for year ${electedYear}`);
    }
    saveJson(historyPath, history);
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
    for (const person of Object.keys(info)) {
        for (const [, notes] of notedPerks(info, person, null)) {
            for (const list of ['buy-before', 'sell-before', 'buy-during', 'sell-during', 'watch-during']) {
                for (const name of notes?.[list] || []) names.add(name);
            }
            for (const name of Object.keys(notes?.['buy-after'] || {})) names.add(name);
        }
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
    const minister = mayor?.minister?.name ? {
        "name": mayor.minister.name,
        "perk": mayor.minister.perk?.name ?? null
    } : null;
    const current = election?.current;
    const ranked = current?.candidates?.length
        ? [...current.candidates].sort((a, b) => b.votes - a.votes)
        : [];
    const leader = ranked[0] ?? null;
    // Second place becomes minister with the one perk marked as their minister perk.
    // Votes swing more there than at the top, so how far it is ahead of third is sent
    // along to show how sure it is.
    const runnerUp = ranked[1] ?? null;
    const runnerUpPerk = (runnerUp?.perks || []).find(perk => perk.minister)?.name ?? null;

    const reminders = [];
    const notes = [];
    const seenReminders = new Set();
    const remind = (timing, action, role, from, perk, product, extra = {}) => {
        // EZPZ and Marauder list the same products; a product shows once per section.
        const key = `${timing}|${role}|${from}|${action}|${product}`;
        if (seenReminders.has(key)) return;
        seenReminders.add(key);
        reminders.push({
            "timing": timing,
            "action": action,
            "role": role,
            "mayor": from,
            "perk": perk,
            "product": product,
            "price": priceOf(product),
            "trend": trendOf(product, extra.since),
            ...extra
        });
    };
    const note = (timing, role, from, perk, text) =>
        notes.push({ "timing": timing, "role": role, "mayor": from, "perk": perk, "text": text });

    // What one person's perks say for a timing. A mayor's own notes come along when
    // they are (or are about to be) mayor; a minister brings only their perk's.
    const addPerks = (timing, role, person, names) => {
        if (!person) return;
        const actions = timing === 'during'
            ? [['buy-during', 'buy'], ['sell-during', 'sell'], ['watch-during', 'watch']]
            : [['buy-before', 'buy'], ['sell-before', 'sell']];
        for (const [perk, perkNotes] of notedPerks(info, person, names)) {
            for (const [list, action] of actions) {
                for (const product of perkNotes[list] || []) remind(timing, action, role, person, perk, product);
            }
            for (const text of perkNotes['notes'] || []) note(timing, role, person, perk, text);
        }
        if (role === 'mayor') {
            for (const text of info[person]?.['notes'] || []) note(timing, role, person, null, text);
        }
    };

    // During: the mayor and minister in office now.
    if (mayor) addPerks('during', 'mayor', mayorName, perkNames(mayor.perks));
    if (minister?.perk) addPerks('during', 'minister', minister.name, [minister.perk]);

    // Before: whoever is leading the running election, and the runner-up as minister.
    // Prices move once it is clear who will win, so these are worth acting on while
    // the election is still open.
    if (leader && leader.name !== mayorName) addPerks('before', 'mayor', leader.name, perkNames(leader.perks));
    if (runnerUpPerk) addPerks('before', 'minister', runnerUp.name, [runnerUpPerk]);

    // After: the years following a term. The current term's show up already, as
    // upcoming, so the watch starts the moment it ends.
    const seen = new Set();
    const terms = readHistory().terms.map(termTimes).sort((a, b) => b['elected-year'] - a['elected-year']);
    const addAfter = (term, role, person, names) => {
        for (const [perk, perkNotes] of notedPerks(info, person, names)) {
            for (const [product, years] of Object.entries(perkNotes['buy-after'] || {})) {
                const key = `${person}|${product}`;
                if (seen.has(key)) continue;

                const windowStart = term['term-end'];
                const windowEnd = windowStart + years * SB_YEAR_MS;
                const isCurrentTerm = term['elected-year'] === electedYear;
                if (now >= windowEnd || (now < windowStart && !isCurrentTerm)) continue;

                seen.add(key);
                remind('after', 'buy', role, person, perk, product, {
                    "since": windowStart,
                    "window-starts": windowStart,
                    "window-ends": windowEnd
                });
            }
        }
    };
    for (const term of terms) {
        addAfter(term, 'mayor', term.mayor, term.perks ?? null);
        if (term.minister && term['minister-perk']) addAfter(term, 'minister', term.minister, [term['minister-perk']]);
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
            "term-end": electionEnd(electedYear + 1),
            "perks": perkNames(mayor.perks),
            "minister": minister
        } : null,
        "election": electedYear ? {
            "year": current?.year ?? electedYear + 1,
            "ends-at": electionEnd(current?.year ?? electedYear + 1),
            "leader": leader?.name ?? null,
            "runner-up": runnerUp ? {
                "name": runnerUp.name,
                "perk": runnerUpPerk,
                "lead": runnerUp.votes - (ranked[2]?.votes ?? 0),
                "lead-percent": runnerUp.votes > 0 ? (runnerUp.votes - (ranked[2]?.votes ?? 0)) / runnerUp.votes : 0
            } : null,
            "candidates": (current?.candidates || []).map(c => ({ "name": c.name, "votes": c.votes }))
        } : null,
        "spooky-festival": {
            "starts-at": festivalStart,
            "ends-at": festivalStart + SPOOKY_DURATION_MS
        },
        "ectoplasm": { "price": priceOf(ECTOPLASM), "trend": trendOf(ECTOPLASM) },
        "tax-multiplier": currentTaxMultiplier(),
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
