import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the only problem with the output is the fact it has api names in its list

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const itemRecipesPath = 'C:\\Users\\karso\\NewCodingProjects\\NotEnoughUpdates-REPO\\items';
const newForgeItemsPath = 'C:\\Users\\karso\\NewCodingProjects\\Skyblock-Flips\\backend\\Testing\\forge-items.json';
const newCraftingRecipesFilePath = 'C:\\Users\\karso\\NewCodingProjects\\Skyblock-Flips\\backend\\Testing\\forge-crafting-recipes.json';
const productListFilePath = 'C:\\Users\\karso\\NewCodingProjects\\Skyblock-Flips\\backend\\production\\product-list.json';
const ITEMS_API_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';

function findDatas(itemNameLowerCase, itemsData) {
    for (const entry of itemsData) {
        if (entry.name.toLowerCase() === itemNameLowerCase) {
            return [entry.name, entry.id]
        }
    }

    return [0, 0]
}

async function main() {
    const forgesItemsList = JSON.parse(fs.readFileSync(newForgeItemsPath, 'utf8'));
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

    let craftingRecipesMap = {};

    for (const itemNameLowerCase of forgesItemsList) {
        const [itemName, itemId] = findDatas(itemNameLowerCase, itemsData);
        // const itemId = findId(itemNameLowerCase);
        if (itemName === 0) {console.log("No data: ", itemNameLowerCase); continue;}


        const itemPath = path.join(itemRecipesPath, `${itemId}.json`);
        if (fs.existsSync(itemPath)) {
            const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));

            // parse the crafting data in a different way to match the product-list format
            const craftingMaterials = {};

            if (itemData.recipes[0]?.inputs) {
                for (const [key, value] of Object.entries(itemData.recipes[0].inputs)) {
                    const [craftingMaterialItemId, amount] = value.split(':');
                    if (craftingMaterialItemId == "") continue; 

                    // change the crafting material ID to the item name using the product list for the bazaar items (since crafting materials are usually bazaar items)
                    // first find craftingMaterialItemId in the product list
                    const craftingMaterialItemName = Object.keys(productListData).find(key => productListData[key]["api-name"] === craftingMaterialItemId);

                    if (craftingMaterialItemName == "Razor-sharp Shark Tooth Necklace") {
                        console.error("wrong name", craftingMaterialItemName, craftingMaterialItemId, itemId, itemName);
                    }

                    // handle the case that the crafting material is an auction product instead of a bazaar item, in which case the craftingMaterialItemId will be determined 

                    // how to get the auction item name given an auction item id, if the auction item isnt in the product list. find the correct value with the api name and then use that to find the key in the product list. if the auction item is not in the product list, then skip it and log a warning
                    let auctionItemName;
                    
                    if (!craftingMaterialItemName) {
                        // there is a possiblitly that the auction item is already in the crafting material recipe map. so first check if the craftingMaterialItemId is already in the craftingRecipesMap, and if it is, then use that name instead of looking it up in the product list
                        const existingCraftingMaterial = Object.entries(craftingRecipesMap).find(([name, data]) => data["api-name"] === craftingMaterialItemId);
                        if (existingCraftingMaterial) {
                            auctionItemName = existingCraftingMaterial[0];
                        } else {
                            // if the crafting material is not in the product list, then look it up in the itemsData from the hypixel api v2 items endpoint
                            const auctionItemData = Object.values(itemsData).find(item => item.id === craftingMaterialItemId);
                            auctionItemName = auctionItemData ? auctionItemData.name : null;
                        }

                        if (!auctionItemName) {
                            console.warn(`Warning: Auction item ID ${craftingMaterialItemId} not found in product list for item ID: ${itemId}, Name: ${itemName}`);
                            continue;
                        } else {
                            // if the auction item is found, then also add this to the craftingRecipesMap with the correct api-name and type, and has-weights set to false
                            if (!craftingRecipesMap[auctionItemName]) {
                                craftingRecipesMap[auctionItemName] = {
                                    "api-name": craftingMaterialItemId,
                                    "type": "crafting-material",
                                    "has-weights": false
                                };
                            }
                        }
                    }


                    if (craftingMaterialItemName == "Razor-sharp Shark Tooth Necklace") {
                        console.error("wrong name", craftingMaterialItemName, craftingMaterialItemId, itemId, itemName);
                    }

                    // add to the current amount of craftingMaterialItemId in craftingMaterials, or set it to the amount if it doesn't exist yet
                    if (craftingMaterials[craftingMaterialItemName || auctionItemName]) {
                        craftingMaterials[craftingMaterialItemName || auctionItemName || "Unknown"] += parseInt(amount);
                    } else {
                        craftingMaterials[craftingMaterialItemName || auctionItemName || "Unknown"] = parseInt(amount);
                    }
                }

                craftingRecipesMap[itemName] = {
                    "api-name": itemId,
                    "seconds-to-craft": 0,
                    "type": "forge-product",
                    "has-weights": false,
                    "crafting-materials": craftingMaterials
                };
            } else {
                console.warn(`Warning: No crafting data found for item ID: ${itemId}, Name: ${itemName}`);
            }
        }
    }
    fs.writeFileSync(newCraftingRecipesFilePath, JSON.stringify(craftingRecipesMap, null, 2));
}

main().catch(console.error);