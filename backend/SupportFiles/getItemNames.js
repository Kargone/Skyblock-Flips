// get the api-to-display-name-map.json file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const api_to_display_name_map = JSON.parse(fs.readFileSync(path.join(__dirname, 'api-to-display-name-map.json'), 'utf8'));

//get the current product-list.json file
const product_list = JSON.parse(fs.readFileSync(path.join(__dirname, 'product-list.json'), 'utf8'));

// appened the new display names to the product_list
for (const apiName of Object.keys(api_to_display_name_map)) {
    const displayName = api_to_display_name_map[apiName];
    
    // check if the display name already exists in the product_list
    if (product_list[displayName]) {
        console.log(`Display name ${displayName} already exists in product_list, skipping...`);
        continue;
    }
    product_list[displayName] = {
        "api-name": apiName,
        "type": "short-term-investment",
        "has-weights": true
    };
}

// save the updated product-list.json file
fs.writeFileSync(path.join(__dirname, 'product-list.json'), JSON.stringify(product_list, null, 2));
console.log('Successfully updated product-list.json with display names');