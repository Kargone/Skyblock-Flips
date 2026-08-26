// write a file that updates the product list by using the api names and display names from the bazaar-api-name-map.json file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// go back one directory and then go to the product-list.json file
const __dirname = path.dirname(__filename);

const productListPath = path.join(__dirname, '..', 'production', 'product-list.json');
const bazaarApiNameMapPath = path.join(__dirname, 'bazaar-api-name-map.json');

const bazaarApiNameMap = await JSON.parse(fs.readFileSync(bazaarApiNameMapPath, 'utf8'));
const productList = await JSON.parse(fs.readFileSync(productListPath, 'utf8'));

console.log(`Loaded ${Object.keys(productList).length} products from product-list.json`);

for (const [displayName, apiName] of Object.entries(bazaarApiNameMap.displayNameToApiName)) {
    if (!productList.hasOwnProperty(displayName)) {
        productList[displayName] = {
            "api-name": apiName,
            "type": "short-term-investment",
            "has-weights": true
        };
        console.log(`Added ${displayName} with API name ${apiName} to product list.`);
    }
}

console.log(`Updated product list with ${Object.keys(productList).length} items.`);
fs.writeFileSync(path.join(__dirname, 'updated-product-list.json'), JSON.stringify(productList, null, 2));