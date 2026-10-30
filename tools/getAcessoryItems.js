import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// We have all accessorys on hypixel that have a recipe available
// Now we need to make sure i have the requirements met to craft all of them
// And they need to be remotely profitable


// there is some possibility that some of the accessorys are not on the items api**

/*

  "NIGHT_CRYSTAL": "Night Crystal -----------------------------",
  "DAY_CRYSTAL": "Day Crystal -----------------------------",
  
  "BLOOD_DONOR_ARTIFACT": "Blood Donor Artifact ----------------------------"


*/


const ITEMS_API_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';

const itemRecipesPath = 'C:\\Users\\karso\\NewCodingProjects\\NotEnoughUpdates-REPO\\items';

async function main() {
    const responseItems = await fetch(ITEMS_API_URL);

    if (!responseItems.ok) {
        throw new Error(`Failed to fetch items data: ${responseItems.status} ${responseItems.statusText}`);
    }
    const itemsData = await responseItems.json();

    if (!itemsData.success || !itemsData.items) {
        throw new Error('Hypixel bazaar endpoint returned an unexpected payload.');
    }

    let map = {};

    for (const [_, itemData] of Object.entries(itemsData.items)) {
        if (itemData.category === "ACCESSORY") {
            // detemrmine the item's recipe based on the itemRecipesPath and itemData.id
            const recipeFilePath = path.join(itemRecipesPath, `${itemData.id}.json`);
            
            let NEUItemData;
            try {
                if (!fs.existsSync(recipeFilePath)) {
                    // console.warn(`Warning: Recipe file not found for item ID: ${itemData.id}. Expected path: ${recipeFilePath}`);
                    continue;
                }
                NEUItemData = JSON.parse(fs.readFileSync(recipeFilePath, 'utf8'));
            } catch (error) {
                console.error(`Error reading recipe file for item ID: ${itemData.id}. Error: ${error.message}`);
                continue;
            }
            
            if (itemData.id === "EMERALD_RING") console.log(`Checking item ID: ${itemData.id}, Name: ${itemData.name}, Category: ${itemData.category}, Recipe file path: ${recipeFilePath}, Recipe: ${NEUItemData ? JSON.stringify(NEUItemData.recipe) : 'null'}, NEUItemData: ${NEUItemData ? JSON.stringify(NEUItemData) : 'null'}`);

            if (NEUItemData && NEUItemData.recipe) {
                map[itemData.id] = itemData.name;
                console.log(itemData.category, itemData.id, itemData.name);
            }
        }
    }

    console.log("Total ACCESSORY items:", Object.keys(map).length);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const outputFilePath = path.join(__dirname, 'accessory-items.json');

    // fs.writeFileSync(outputFilePath, `${JSON.stringify(map, null, 2)}\n`);
    console.log(`Wrote ${outputFilePath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});