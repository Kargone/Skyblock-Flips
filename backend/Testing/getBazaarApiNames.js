import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BAZAAR_API_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const ITEMS_API_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';
const productListPath = path.join(__dirname, '..', 'production', 'product-list.json');
const outputPath = path.join(__dirname, 'bazaar-api-name-map.json');

function sortObjectByKey(object) {
    return Object.fromEntries(
        Object.entries(object).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    );
}

function buildDisplayNameToApiNameMap(productList, bazaarApiNames, apiNameToItemNameMap) {
    const map = {};

    console.log(`Building display name to API name map for ${Object.keys(productList).length} products and ${bazaarApiNames.size} bazaar API names.`);

    for (const [apiName, productData] of bazaarApiNames.entries()) {
        const displayName = Object.keys(productList).find(key => productList[key]['api-name'] === apiName);
        // console.log(`Mapping display name: ${displayName} to API name: ${apiName}, productData: ${JSON.stringify(productData)}`);

        if (!displayName && apiNameToItemNameMap[apiName]) {
            // find the display name from the bzaar data by looking for the product in the bazaar data that has the same api name
            map[apiNameToItemNameMap[apiName]] = apiName;
            // console.log(`Warning: Display name not found for API name: ${apiName}. Using item name from bazaar data: ${apiNameToItemNameMap[apiName]}`);
            continue;
        }

        // so we have to do special stuff for the shards since they arent in the item api list
        // just need to take the current api name, remove the SHARD_ at the beginning, and then add the word "Shard" to the end of the display name. and before adding shard make only the first letter capitalized and the rest lowercase. so for example SHARD_SWORD_OF_REVELATIONS would become Sword of Revelations Shard
        if (apiName.startsWith('SHARD_')) {
            const shardDisplayName = apiName.replace('SHARD_', '').replace(/_/g, ' ').trim() + ' Shard';
            // Capitalize the first letter of each word and make the rest lowercase
            const formattedShardDisplayName = shardDisplayName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            if (map.hasOwnProperty(formattedShardDisplayName)) {
                console.warn(`Warning: Duplicate display name found for API name: ${apiName}. Display name: ${formattedShardDisplayName}`);
                continue;
            }
            console.log(`Mapping display name: ${formattedShardDisplayName} to API name: ${apiName}`);
            map[formattedShardDisplayName] = apiName;
        }

        if (map.hasOwnProperty(displayName)) {
            console.warn(`Warning: Duplicate display name found for API name: ${apiName}. Display name: ${displayName}`);
            continue;
        }

        map[displayName] = apiName;
    }


    return sortObjectByKey(map);
}

async function main() {
    const productList = JSON.parse(fs.readFileSync(productListPath, 'utf8'));
    const response = await fetch(BAZAAR_API_URL);
    const responseItems = await fetch(ITEMS_API_URL);

    if (!response.ok || !responseItems.ok) {
        throw new Error(`Failed to fetch bazaar data: ${response.status} ${response.statusText}`);
    }

    const bazaarData = await response.json();
    const itemsData = await responseItems.json();

    if (!bazaarData.success || !bazaarData.products || !itemsData.success || !itemsData.items) {
        throw new Error('Hypixel bazaar endpoint returned an unexpected payload.');
    }

    const bazaarApiNames = new Set(Object.keys(bazaarData.products));
    const bazaarItemNames = Array.from(bazaarApiNames).sort((left, right) => left.localeCompare(right));
    
    let apiNameToItemNameMap = {};
    for (const [_, itemData] of Object.entries(itemsData.items)) apiNameToItemNameMap[itemData.id] = itemData.name;

    const displayNameToApiName = buildDisplayNameToApiNameMap(productList, bazaarApiNames, apiNameToItemNameMap);

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