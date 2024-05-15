async function getItemNames(name_array) {
    const response = await fetch("https://api.hypixel.net/resources/skyblock/items");
    const product_list = {};
    const items = await response.json();
    for (const item_index in Object.keys(items['items'])) {
        const item = items['items'][item_index];
        const name_index = name_array.indexOf(item["name"]);
        if (name_index != -1) {
            const name = name_array[name_index];
            product_list[name] = {
                "api-name": item["id"],
                "type": "short-term-investment",
                "has-weights": true
            }
        }
    }
    console.log(JSON.stringify(product_list))
}

getItemNames([
    "Mutant Nether Wart"
]);
