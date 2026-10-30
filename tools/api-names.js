import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the only problem with the output is the fact it has api names in its list

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const itemRecipesPath = 'C:\\Users\\karso\\NewCodingProjects\\NotEnoughUpdates-REPO\\items';
const newAccesoriesFilePath = 'C:\\Users\\karso\\NewCodingProjects\\Skyblock-Flips\\tools\\accessory-items.json';
const newCraftingRecipesFilePath = 'C:\\Users\\karso\\NewCodingProjects\\Skyblock-Flips\\tools\\accessory-crafting-recipes.json';
const productListFilePath = 'C:\\Users\\karso\\NewCodingProjects\\Skyblock-Flips\\server\\product-list.json';
const ITEMS_API_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';

async function main() {
    const accessoryItemsData = JSON.parse(fs.readFileSync(newAccesoriesFilePath, 'utf8'));
    const productListData = JSON.parse(fs.readFileSync(productListFilePath, 'utf8'));

    const responseItems = await fetch(ITEMS_API_URL);

    if (!responseItems.ok) {
        throw new Error(`Failed to fetch items data: ${responseItems.status} ${responseItems.statusText}`);
    }
    const allData = await responseItems.json();
    const itemsData = allData.items;

    if (!allData.success || !allData.items) {
        throw new Error('Hypixel bazaar endpoint returned an unexpected payload.');
    }

    let productListNew = productListData;

    for (const itemName of Object.keys(productListNew)) {
        // const itemName = accessoryItemsData[itemId];
        const itemIndex = itemsData.findIndex(item => {return item.name == itemName;});
        if (itemIndex === -1) continue;
        const itemId = itemsData[itemIndex].id;
        productListNew[itemName]['api-name'] = itemId;
        console.log(itemId);
    }
    // fs.writeFileSync(productListFilePath, JSON.stringify(productListNew, null, 2));
}

main().catch(console.error);