// Renames the old "Beastmaster Crest - RARITY" names in trader-data.json to the
// names Hypixel gives each tier now. Every place a name appears is renamed: product
// keys, crafting materials, and the item names of past trades.
//
//   node renameOldCrestNames.js           shows what would change
//   node renameOldCrestNames.js --apply   changes trader-data.json
//
// The backend keeps trader data in memory and saves it over the file, so it has to
// be stopped first or it undoes the rename.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENAMES = {
    "Beastmaster Crest - COMMON": "Beastmaster Crest",
    "Beastmaster Crest - UNCOMMON": "Blessed Beastmaster Crest",
    "Beastmaster Crest - RARE": "Stalwart Beastmaster Crest",
    "Beastmaster Crest - EPIC": "Venerable Beastmaster Crest",
    "Beastmaster Crest - LEGENDARY": "Exalted Beastmaster Crest",
};

const SERVER_URL = 'http://localhost:8000';
const traderDataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'trader-data.json');
const backupPath = traderDataPath.replace(/\.json$/, '.before-crest-rename.json');

async function serverIsRunning() {
    try {
        await fetch(`${SERVER_URL}/api/last-trade-time`, { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

// Walks the whole of trader data, renaming keys (keeping their order) and string
// values. Returns where each change was made. A key whose new name is already taken
// in the same object is not renamed but reported, since the two would need merging.
function rename(value, where, changes, clashes) {
    if (Array.isArray(value)) {
        return value.map((item, index) => rename(item, `${where}[${index}]`, changes, clashes));
    }
    if (value && typeof value === 'object') {
        const renamed = {};
        for (const [key, child] of Object.entries(value)) {
            let newKey = key;
            if (RENAMES[key]) {
                if (Object.hasOwn(value, RENAMES[key])) {
                    clashes.push(`${where} has both "${key}" and "${RENAMES[key]}"`);
                } else {
                    newKey = RENAMES[key];
                    changes.push(`${where}: key "${key}" -> "${newKey}"`);
                }
            }
            renamed[newKey] = rename(child, `${where}.${newKey}`, changes, clashes);
        }
        return renamed;
    }
    if (typeof value === 'string' && RENAMES[value]) {
        changes.push(`${where}: "${value}" -> "${RENAMES[value]}"`);
        return RENAMES[value];
    }
    return value;
}

async function main() {
    const apply = process.argv.includes('--apply');
    if (apply && await serverIsRunning()) {
        console.error('The backend is running. Stop it first, or it will save its own copy over the rename.');
        process.exitCode = 1;
        return;
    }

    const traderData = JSON.parse(fs.readFileSync(traderDataPath, 'utf8'));
    const changes = [];
    const clashes = [];
    const renamed = rename(traderData, 'trader-data', changes, clashes);

    for (const change of changes) console.log(change);
    console.log(`\n${changes.length} names to rename.`);

    if (clashes.length > 0) {
        console.error('\nThese already have the new name as well, so nothing was changed:');
        for (const clash of clashes) console.error(`  ${clash}`);
        process.exitCode = 1;
        return;
    }
    if (changes.length === 0) {
        console.log('Nothing to rename.');
        return;
    }
    if (!apply) {
        console.log('Nothing changed. Run with --apply to save these.');
        return;
    }

    fs.copyFileSync(traderDataPath, backupPath);
    fs.writeFileSync(traderDataPath, JSON.stringify(renamed, null, 2));
    console.log(`\nSaved. The file as it was is in ${path.basename(backupPath)}.`);
}

main().catch(error => console.error('Error renaming crest names:', error));
