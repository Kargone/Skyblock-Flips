import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BAZAAR_API_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const productListPath = path.join(__dirname, '..', 'product-list.json');
const outputPath = path.join(__dirname, 'bazaar-api-name-map.json');

function sortObjectByKey(object) {
    return Object.fromEntries(
        Object.entries(object).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    );
}

function buildDisplayNameToApiNameMap(productList, bazaarApiNames) {
    const map = {};

    for (const [displayName, entry] of Object.entries(productList)) {
        const apiName = entry['api-name'];
        if (!apiName || !bazaarApiNames.has(apiName)) {
            continue;
        }

        map[displayName] = apiName;
    }

    return sortObjectByKey(map);
}

async function main() {
    const productList = JSON.parse(fs.readFileSync(productListPath, 'utf8'));
    const response = await fetch(BAZAAR_API_URL);

    if (!response.ok) {
        throw new Error(`Failed to fetch bazaar data: ${response.status} ${response.statusText}`);
    }

    const bazaarData = await response.json();

    if (!bazaarData.success || !bazaarData.products) {
        throw new Error('Hypixel bazaar endpoint returned an unexpected payload.');
    }

    const bazaarApiNames = new Set(Object.keys(bazaarData.products));
    const bazaarItemNames = Array.from(bazaarApiNames).sort((left, right) => left.localeCompare(right));
    const displayNameToApiName = buildDisplayNameToApiNameMap(productList, bazaarApiNames);

    const output = {
        generatedAt: new Date().toISOString(),
        bazaarItemNames,
        displayNameToApiName
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

    console.log(`Found ${bazaarItemNames.length} bazaar items.`);
    console.log(`Mapped ${Object.keys(displayNameToApiName).length} display names to Hypixel API names.`);
    console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});