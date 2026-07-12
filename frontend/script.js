// Trader Data Dashboard
class TraderDashboard {
    constructor() {
        this.traderData = null;
        this.productList = null;
        this.bazaarData = null;
        this.auctionData = [];
        this.lowestBinPrices = {};
        this.openSellOrders = new Set();
        this.activeTab = 'bazaar-orders';
        this.updateInterval = 1000; // 1 second
        this.bazaarUpdateInterval = 60000; // 1 minute
        this.auctionUpdateInterval = 300000; // 5 minutes
        this.init();
    }

    init() {
        this.setupTabs();
        this.fetchMarketData();
        this.fetchAndUpdateData();
        setInterval(() => this.fetchAndUpdateData(), this.updateInterval);
        setInterval(() => this.fetchBazaarData(), this.bazaarUpdateInterval);
        setInterval(() => this.fetchAuctionData(), this.auctionUpdateInterval);
    }

    async fetchAndUpdateData() {
        try {
            const traderDataResponse = await this.fetchTraderData();

            if (!traderDataResponse.ok) {
                throw new Error('Failed to fetch trader data');
            }

            this.traderData = await traderDataResponse.json();
            localStorage.setItem('traderData', JSON.stringify(this.traderData));

            if (!this.productList) {
                const productListResponse = await this.fetchProductList();
                if (productListResponse.ok) {
                    this.productList = await productListResponse.json();
                }
            }

            this.updateDashboard();
        } catch (error) {
            console.error('Error fetching trader data:', error);
        }
    }

    async fetchMarketData() {
        await Promise.all([
            this.fetchProductList().then(async response => {
                if (response.ok) {
                    this.productList = await response.json();
                }
            }).catch(() => {}),
            this.fetchBazaarData(),
            this.fetchAuctionData()
        ]);

        this.updateDashboard();
    }

    async fetchTraderData() {
        let response = await fetch('http://localhost:8000/api/trader-data');
        if (!response.ok) {
            response = await fetch('../backend/trader-data.json');
        }
        return response;
    }

    async fetchProductList() {
        let response = await fetch('../backend/product-list.json');
        if (!response.ok) {
            response = await fetch('./backend/product-list.json');
        }
        return response;
    }

    async fetchBazaarData() {
        try {
            const response = await fetch('http://localhost:8000/api/market-data');
            if (!response.ok) return;

            const payload = await response.json();
            this.bazaarData = payload.bazaarProducts || {};
            this.lowestBinPrices = payload.lowestBinPrices || {};
        } catch (error) {
            console.error('Error fetching bazaar data:', error);
        }
    }

    async fetchAuctionData() {
        try {
            const response = await fetch('http://localhost:8000/api/market-data');
            if (!response.ok) return;

            const payload = await response.json();
            this.lowestBinPrices = payload.lowestBinPrices || {};
        } catch (error) {
            console.error('Error fetching auction data:', error);
        }
    }

    normalizeName(name, tier) {
        return String(name || '')
            .replace(/§./g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase() + (tier ? `_${tier.toLowerCase()}` : '');
    }

    setupTabs() {
        const buttons = document.querySelectorAll('[data-tab-target]');

        const applyTab = (tabName) => {
            this.activeTab = tabName;

            document.querySelectorAll('[data-tab-group]').forEach(section => {
                const isActive = section.getAttribute('data-tab-group') === tabName;
                section.classList.toggle('active', isActive);
            });

            buttons.forEach(button => {
                const isActive = button.getAttribute('data-tab-target') === tabName;
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-selected', String(isActive));
            });
        };

        buttons.forEach(button => {
            button.addEventListener('click', () => {
                applyTab(button.getAttribute('data-tab-target'));
            });
        });

        applyTab(this.activeTab);
    }

    updateDashboard() {
        if (!this.traderData) return;

        this.updateStats();
        this.updateBazaarSnapshot();
        this.updateBuyOrders();
        this.updateSellOrders();
        this.updateInvestments();
        this.updateAuctions();
        this.updateAuctionCrafts();
        this.updateForgeCrafts();
        this.updateDailyProfits();
        this.updateAllProducts();
        this.updateLastUpdate();
    }

    updateStats() {
        const data = this.traderData;

        // Total Daily Profit
        const dailyProfits = data['daily-profits'] || {};
        const todayKey = Object.keys(dailyProfits).pop();
        const todayProfit = todayKey ? dailyProfits[todayKey]['daily-profit'] : 0;
        document.getElementById('totalDailyProfit').textContent = this.formatCoin(todayProfit);

        // Total Profit
        let totalProfit = 0;
        for (const [key, value] of Object.entries(data['daily-profits'] || {})) {
            totalProfit += value['daily-profit'] || 0;
        }
        document.getElementById('lifetimeProfit').textContent = this.formatCoin(totalProfit);

        // Total Order Worth
        const buyOrders = data['buy-order-overview']['buy-orders'] || [];
        const sellOrders = data['sell-order-overview']['sell-orders'] || [];
        const forgeOrders = data['forge'] || [];
        const auctionOrders = data['auction-house-overview']['auctions'] || [];
        const totalBuyWorth = buyOrders.reduce((sum, order) => {
            return sum + ((order['buying-amount'] || 0) * (order['price-buying'] || 0));
        }, 0);
        const totalSellWorth = sellOrders.reduce((sum, order) => {
            return sum + ((order['total-selling-amount'] || 0) * (order['price-sold'] || 0));
        }, 0);
        const totalForgeWorth = forgeOrders.reduce((sum, order) => {
            return sum + (order['sell-price'] || 0);
        }, 0);
        const totalAuctionWorth = auctionOrders.reduce((sum, order) => {
            return sum + (order['price-selling'] || 0);
        }, 0);
        document.getElementById('totalOrderWorth').textContent = this.formatCoin(totalBuyWorth + totalSellWorth + totalForgeWorth + totalAuctionWorth);

        document.getElementById('totalInvestmentWorth').textContent = this.formatCoin(this.calculateTotalInvestmentWorth());

        // Total Items Flipped
        const allProducts = data['all-products'] || {};
        const totalSold = Object.values(allProducts).reduce((sum, p) => sum + (p['total-sold'] || 0), 0);
        document.getElementById('totalFlipped').textContent = this.formatCoin(totalSold);

        // Average daily profit
        document.getElementById('averageDailyProfit').textContent = this.formatCoin(totalProfit / Math.max(Object.keys(dailyProfits).length, 1));

        // Average weekly profit
        document.getElementById('averageWeeklyProfit').textContent = this.formatCoin(totalProfit / Math.max(Object.keys(dailyProfits).length / 7, 1));

        // Active Buy Orders
        document.getElementById('activeBuyOrders').textContent = buyOrders.length;

        // Active Sell Orders
        document.getElementById('activeSellOrders').textContent = sellOrders.length;
    }

    updateBazaarSnapshot() {
        const tbody = document.getElementById('bazaarSnapshotBody');
        if (!tbody) return;

        // the tracked products should be all the products in the productList, filtered by the ones that have the highest spread and the 7-day instabuy and sell volume is more than 100k
        const minVolumeThreshold = 100000;
        const trackedProducts = Object.keys(this.productList || {}).filter(name => {
            const entry = this.productList[name];
            if (!entry || !entry['api-name']) return false;
            const bazaarProduct = this.bazaarData?.[entry['api-name']];
            if (!bazaarProduct) return false;
            if (!bazaarProduct.quick_status) return false;
            const quickStatus = bazaarProduct.quick_status;
            const buyOrders = bazaarProduct.sell_summary || [];
            const sellOrders = bazaarProduct.buy_summary || [];
            const buyPrice = buyOrders[0]?.pricePerUnit || 0;
            const sellPrice = sellOrders[0]?.pricePerUnit || 0;
            const spread = Math.abs((sellPrice * 0.99) - buyPrice);
            if (spread <= 0) return false;
            if ((quickStatus.buyMovingWeek || 0) < minVolumeThreshold || (quickStatus.sellMovingWeek || 0) < minVolumeThreshold) return false;
            // console.log(`Tracked product: ${name}, Spread: ${spread}, Buy Volume: ${quickStatus.buyMovingWeek}, Sell Volume: ${quickStatus.sellMovingWeek}`);
            return true;
        }).sort((a, b) => {
            const entryA = this.productList[a];
            const entryB = this.productList[b];
            const productA = this.bazaarData?.[entryA['api-name']];
            const productB = this.bazaarData?.[entryB['api-name']];
            const productABuyOrders = productA?.sell_summary || [];
            const productBBuyOrders = productB?.sell_summary || [];
            const productASellOrders = productA?.buy_summary || [];
            const productBSellOrders = productB?.buy_summary || [];
            const productABuyPrice = productABuyOrders[0]?.pricePerUnit || 0;
            const productBBuyPrice = productBBuyOrders[0]?.pricePerUnit || 0;
            const productASellPrice = productASellOrders[0]?.pricePerUnit || 0;
            const productBSellPrice = productBSellOrders[0]?.pricePerUnit || 0;
            const spreadA = productA?.quick_status ? Math.abs((productASellPrice || 0) * 0.99 - (productABuyPrice || 0)) : 0;
            const spreadB = productB?.quick_status ? Math.abs((productBSellPrice || 0) * 0.99 - (productBBuyPrice || 0)) : 0;
            return spreadB - spreadA;
        }).map((name) => ({ name, apiName: this.getApiName(name) })).slice(0, 20); // top 20 products by spread
        // console.log('Tracked products for bazaar snapshot:', trackedProducts);

        if (!this.bazaarData || trackedProducts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty">Bazaar data unavailable</td></tr>';
            return;
        }

        tbody.innerHTML = trackedProducts.map(({ name, apiName }) => {
            const product = this.bazaarData[apiName];
            if (!product) {
                return `
                    <tr>
                        <td>${name}</td>
                        <td colspan="4" class="empty">No bazaar entry found</td>
                    </tr>
                `;
            }

            const quickStatus = product.quick_status || {};
            const buyPrice = product.sell_summary[0]?.pricePerUnit || 0;
            const sellPrice = product.buy_summary[0]?.pricePerUnit || 0;
            const spread = Math.abs((sellPrice * 0.99) - buyPrice);

            return `
                <tr>
                    <td>${name}</td>
                    <td>${this.formatCoin(buyPrice)}</td>
                    <td>${this.formatCoin(sellPrice)}</td>
                    <td class="${spread >= 0 ? 'profit-positive' : 'profit-negative'}">${this.formatCoin(spread)}</td>
                    <td>${this.formatCoin(quickStatus.buyMovingWeek || 0)} / ${this.formatCoin(quickStatus.sellMovingWeek || 0)}</td>
                </tr>
            `;
        }).join('');
    }

    updateBuyOrders() {
        const buyOrders = this.traderData['buy-order-overview']['buy-orders'] || [];
        const tbody = document.getElementById('buyOrdersBody');

        if (buyOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty">No buy orders</td></tr>';
            return;
        }

        // sort buy orders by percent filled
        buyOrders.sort((a, b) => {
            const percentA = (a['bought-amount'] || 0) / (a['buying-amount'] || 1);
            const percentB = (b['bought-amount'] || 0) / (b['buying-amount'] || 1);
            return percentB - percentA;
        });

        tbody.innerHTML = buyOrders.map(order => `
            <tr>
                <td>${order['item-name']}</td>
                <td>${this.formatCoin(order['price-buying'])}</td>
                <td>${this.formatAmount(order['bought-amount'] || 0)} / ${this.formatAmount(order['buying-amount'] || 0)} (${this.formatPercent(order['bought-amount'] || 0, order['buying-amount'] || 0)})</td>
                <td>${this.formatCoin((order['buying-amount'] || 0) * (order['price-buying'] || 0))}</td>
                <td>${this.formatTimestamp(order['buy-order-place-time'])}</td>
                <td>
                    ${order['bought-amount'] >= order['buying-amount'] ? '<span class="status-badge status-filled">Filled</span>' : '<span class="status-badge status-pending">Pending</span>'}
                </td>
            </tr>
        `).join('');
        
        let totalSoldAmount = 0;
        let totalAmountAllOrders = 0;
        let totalValue = 0;

        // find some values of totals just like in the sell orders
        for (const buyOrder of buyOrders) {
            totalSoldAmount += buyOrder['bought-amount'] || 0;
            totalAmountAllOrders += buyOrder['buying-amount'] || 0;
            totalValue += (buyOrder['buying-amount'] || 0) * (buyOrder['price-buying'] || 0);
        }

        const percentFilled = totalAmountAllOrders > 0 ? (totalSoldAmount / totalAmountAllOrders) * 100 : 0;
        document.getElementById('buyOrdersTitle').textContent = `Active Buy Orders: Total Value: ${this.formatCoin(totalValue)}, Total Bought: ${this.formatAmount(totalSoldAmount)}/${this.formatAmount(totalAmountAllOrders)} (${percentFilled.toFixed(2)}%)`;
    }

    updateSellOrders() {
        const sellOrders = this.traderData['sell-order-overview']['sell-orders'] || [];
        const tbody = document.getElementById('sellOrdersBody');

        if (sellOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty">No sell orders</td></tr>';
            return;
        }

        // sort sell orders by profit projected, ('projected-profit'))
        sellOrders.sort((a, b) => {
            let projectedProfitA = 0;
            for (const subOrder of (a['sub-orders'] || [])) {
                projectedProfitA += subOrder['projected-profit'] || 0;
            }
            let projectedProfitB = 0;
            for (const subOrder of (b['sub-orders'] || [])) {
                projectedProfitB += subOrder['projected-profit'] || 0;
            }
            return (projectedProfitB || 0) - (projectedProfitA || 0);
        });

        const rows = [];
        let totalSoldAmount = 0;
        let totalAmountAllOrders = 0;
        let totalProfit = 0;
        let totalValue = 0;

        sellOrders.forEach((order, index) => {
            const totalSold = this.getSellOrderSoldAmount(order);
            const totalAmount = order['total-selling-amount'] || 0;
            const orderKey = this.getSellOrderKey(order, index);
            const isOpen = this.openSellOrders.has(orderKey);
            const status = totalSold === totalAmount ? 'Filled' : 'Active';
            totalSoldAmount += totalSold;
            totalAmountAllOrders += totalAmount;
            totalProfit += (order['sub-orders'] || []).reduce((sum, subOrder) => sum + (subOrder['projected-profit'] || 0), 0);
            totalValue += totalAmount * (order['price-sold'] || 0);

            rows.push(`
                <tr class="sell-order-row">
                    <td>
                        <button class="expand-button sell-order-toggle" data-order-key="${orderKey}" aria-expanded="${isOpen}">${isOpen ? '▾' : '▸'}</button>
                        ${order['item-name']}
                    </td>
                    <td>${this.formatCoin(order['price-sold'])}</td>
                    <td>${this.formatAmount(totalSold)} / ${this.formatAmount(totalAmount)} (${this.formatPercent(totalSold, totalAmount)})</td>
                    <td>${this.formatCoin(totalAmount * (order['price-sold'] || 0))}</td>
                    <td>${this.formatTimestamp(order['sell-order-place-time'])}</td>
                    <td>${this.formatTimestamp(order['earliest-time-bought'])}</td>
                    <td>
                        <span class="status-badge status-${status.toLowerCase()}">${status}</span>
                    </td>
                </tr>
            `);

            if (isOpen) {
                rows.push(`
                    <tr class="sell-order-details-row">
                        <td colspan="7">
                            <div class="sell-order-details">
                                <h4>Sub-orders</h4>
                                <table class="sub-orders-table">
                                    <thead>
                                        <tr>
                                            <th>Purchased</th>
                                            <th>Sold</th>
                                            <th>Buy Price</th>
                                            <th>Projected Profit</th>
                                            <th>Time Bought</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${(order['sub-orders'] || []).map(subOrder => `
                                            <tr>
                                                <td>${this.formatAmount(subOrder['partial-selling-amount'] || 0)}</td>
                                                <td>${this.formatAmount(subOrder['partial-sold-amount'] || 0)}</td>
                                                <td>${this.formatCoin(subOrder['price-bought'] || 0)}</td>
                                                <td>${this.formatCoin(subOrder['projected-profit'] || 0)}</td>
                                                <td>${this.formatTimestamp(subOrder['time-bought'])}</td>
                                            </tr>
                                        `).join('') || '<tr><td colspan="5" class="empty">No sub-orders</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </td>
                    </tr>
                `);
            }
        });

        tbody.innerHTML = rows.join('');

        tbody.querySelectorAll('.sell-order-toggle').forEach(button => {
            button.addEventListener('click', () => {
                const orderKey = button.getAttribute('data-order-key');
                if (this.openSellOrders.has(orderKey)) {
                    this.openSellOrders.delete(orderKey);
                } else {
                    this.openSellOrders.add(orderKey);
                }
                this.updateSellOrders();
            });
        });

        const percentFilled = totalAmountAllOrders > 0 ? (totalSoldAmount / totalAmountAllOrders) * 100 : 0;
        document.getElementById('sellOrdersTitle').textContent = `Active Sell Orders: Total Value: ${this.formatCoin(totalValue)}, Total Sold: ${this.formatAmount(totalSoldAmount)}/${this.formatAmount(totalAmountAllOrders)} (${percentFilled.toFixed(2)}%), Total Projected Profit: ${this.formatCoin(totalProfit)}`;
    }

    updateInvestments() {
        const tbody = document.getElementById('investmentsBody');
        const shortTermInv = this.traderData['short-term-investments'] || {};
        const longTermInv = this.traderData['long-term-investments'] || {};

        const allInvestments = { ...shortTermInv, ...longTermInv };
        const investmentEntries = Object.entries(allInvestments);

        if (investmentEntries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty">No investments</td></tr>';
            return;
        }

        // sort investments by highest profit
        investmentEntries.sort(([nameA, invA], [nameB, invB]) => {
            const totalAmountA = invA['sub-orders'].reduce((sum, sub) => sum + sub['partial-amount'], 0);
            const totalAmountB = invB['sub-orders'].reduce((sum, sub) => sum + sub['partial-amount'], 0);
            const highestPriceA = invA['sub-orders'].length > 0 ?
                Math.max(...invA['sub-orders'].map(o => o["price-bought"])) : 0;
            const highestPriceB = invB['sub-orders'].length > 0 ?
                Math.max(...invB['sub-orders'].map(o => o["price-bought"])) : 0;
            const currentSellPriceA = this.getCraftingMarketValue(nameA);
            const currentSellPriceB = this.getCraftingMarketValue(nameB);
            const marginA = currentSellPriceA * 0.99 - highestPriceA;
            const marginB = currentSellPriceB * 0.99 - highestPriceB;
            const currentProfitA = marginA * totalAmountA || 0;
            const currentProfitB = marginB * totalAmountB || 0;
            return currentProfitB - currentProfitA;
        });

        tbody.innerHTML = investmentEntries.map(([name, inv]) => {
            const type = shortTermInv[name] ? 'Short-term' : 'Long-term';
            const totalAmount = inv['sub-orders'].reduce((sum, sub) => sum + sub['partial-amount'], 0);
            const highestPrice = inv['sub-orders'].length > 0 ?
                Math.max(...inv['sub-orders'].map(o => o["price-bought"])) : 0;
            const currentSellPrice = this.getCraftingMarketValue(name);
            const margin = currentSellPrice * 0.99 - highestPrice;
            const currentProfit = margin * totalAmount || 0;
            // get the date-bought from the earliest sub-order
            const earliestSubOrder = inv['sub-orders'].reduce((earliest, sub) => {
                return !earliest || sub['time-bought'] < earliest['time-bought'] ? sub : earliest;
            }, null);
            const dateBought = earliestSubOrder ? new Date(earliestSubOrder['time-bought']).toLocaleDateString() : 'N/A';

            return `
                <tr>
                    <td>${name}</td>
                    <td>${type}</td>
                    <td>${totalAmount}</td>
                    <td>${this.formatCoin(highestPrice)}</td>
                    <td>${this.formatCoin(currentSellPrice)}</td>
                    <!-- color the text if positive or negative -->
                    <td>${margin ? this.formatCoin(margin) : 'N/A'}</td>
                    <td>${this.formatCoin(currentProfit)}</td>
                    <td>${dateBought}</td>
                </tr>
            `;
        }).join('');
    }

    updateAuctions() {
        const auctions = this.traderData['auction-house-overview']['auctions'] || [];
        const tbody = document.getElementById('auctionsBody');

        if (auctions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="empty">No active auctions</td></tr>';
            return;
        }

        tbody.innerHTML = auctions.map(auction => `
            <tr>
                <td>${auction['item-name']}</td>
                <td>${this.formatCoin(auction['price-selling'])}</td>
                <td>
                    <span class="status-badge ${auction['sold'] ? 'status-filled' : 'status-partial'}">
                        ${auction['sold'] ? 'Sold' : 'Active'}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    updateAuctionCrafts() {
        const tbody = document.getElementById('auctionCraftsBody');
        if (!tbody) return;

        const entries = this.getCraftingEntries('auction-product');
        this.renderCraftingSection(tbody, entries, false, 'auction');
    }

    updateForgeCrafts() {
        const tbody = document.getElementById('forgeCraftsBody');
        if (!tbody) return;

        const entries = this.getCraftingEntries('forge-product');
        this.renderCraftingSection(tbody, entries, true, 'forge');
    }

    getCraftingEntries(type) {
        if (!this.productList) return [];

        return Object.entries(this.productList)
            .filter(([, product]) => product?.type === type)
            .sort((a, b) => a[0].localeCompare(b[0]));
    }

    renderCraftingSection(tbody, entries, showCraftTime, sectionPrefix) {
        if (!entries.length) {
            tbody.innerHTML = `<tr><td colspan="${showCraftTime ? 8 : 7}" class="empty">No items found</td></tr>`;
            return;
        }

        const inventorySnapshot = this.buildInvestmentSnapshot();
        const rows = [];

        entries.sort((a, b) => {
            const costBreakdownA = this.getCraftingCostBreakdown(a[0], inventorySnapshot);
            const costBreakdownB = this.getCraftingCostBreakdown(b[0], inventorySnapshot);
            return costBreakdownB.margin - costBreakdownA.margin;
        });

        entries.forEach(([name, product], index) => {
            const orderKey = `${sectionPrefix}-${this.normalizeName(name, product?.tier)}-${index}`;
            const isOpen = this.openSellOrders.has(orderKey);
            const costBreakdown = this.getCraftingCostBreakdown(name, inventorySnapshot);
            const craftTime = product['seconds-to-craft'];

            rows.push(`
                <tr>
                    <td>
                        <button class="expand-button craft-toggle" data-order-key="${orderKey}" data-section="${sectionPrefix}" aria-expanded="${isOpen}">${isOpen ? '▾' : '▸'}</button>
                        ${name}
                    </td>
                    <td>${this.formatCoin(costBreakdown.buyOrder)} (+${this.formatCoin(costBreakdown.instaBuy - costBreakdown.buyOrder)})</td>
                    <td>${this.formatCoin(costBreakdown.owned) != 0 ? this.formatCoin(costBreakdown.owned) : ''}</td>
                    <td>${this.formatCoin(costBreakdown.marketValue) != 0 ? this.formatCoin(costBreakdown.marketValue) : ''}</td>
                    ${showCraftTime ? `<td>${this.formatDuration(craftTime || 0)}</td>` : ''}
                    <td class="${costBreakdown.margin >= 0 ? 'profit-positive' : 'profit-negative'}">${this.formatCoin(costBreakdown.margin)}</td>
                </tr>
            `);

            if (isOpen) {
                const materials = Object.entries(product['crafting-materials'] || {});
                rows.push(`
                    <tr class="sell-order-details-row">
                        <td colspan="${showCraftTime ? 8 : 7}">
                            <div class="sell-order-details">
                                <h4>Crafting Materials</h4>
                                <table class="sub-orders-table">
                                    <thead>
                                        <tr>
                                            <th>Material</th>
                                            <th>Qty</th>
                                            <th>Buy Order (Insta Buy)</th>
                                            <th>Owned</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${materials.map(([materialName, qty]) => {
                                            const directInsta = this.getProductUnitCost(materialName, 'insta-buy');
                                            const directBuy = this.getProductUnitCost(materialName, 'buy-order');
                                            const directOwned = this.getProductUnitCost(materialName, 'owned', this.cloneInventorySnapshot(inventorySnapshot));

                                            return `
                                                <tr>
                                                    <td>${materialName}</td>
                                                    <td>${this.formatAmount(qty)}</td>
                                                    <td>${this.formatCoin(directBuy * qty)} (+${this.formatCoin(directInsta * qty - directBuy * qty)})</td>
                                                    <td>${this.formatCoin(directOwned * qty) != 0 ? this.formatCoin(directOwned * qty) : ''}</td>
                                                </tr>
                                            `;
                                        }).join('') || '<tr><td colspan="5" class="empty">No materials listed</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </td>
                    </tr>
                `);
            }
        });

        tbody.innerHTML = rows.join('');

        tbody.querySelectorAll('.craft-toggle').forEach(button => {
            button.addEventListener('click', () => {
                const orderKey = button.getAttribute('data-order-key');
                if (this.openSellOrders.has(orderKey)) {
                    this.openSellOrders.delete(orderKey);
                } else {
                    this.openSellOrders.add(orderKey);
                }

                const section = button.getAttribute('data-section');
                if (section === 'auction') {
                    this.updateAuctionCrafts();
                } else {
                    this.updateForgeCrafts();
                }
            });
        });
    }

    getCraftingMarketValue(name) {
        const entry = this.getProductEntry(name);
        if (entry?.['api-name']) {
            const bazaarProduct = this.bazaarData?.[entry['api-name']];
            const quickStatus = bazaarProduct?.quick_status;
            if (quickStatus) {
                return quickStatus.sellPrice || 0;
            }
        }

        const apiName = entry?.['api-name'];
        const normalizedName = apiName ? this.normalizeName(apiName, entry?.tier) : this.normalizeName(name, entry?.tier);
        // console.log(`Market value for ${apiName} (${normalizedName} ${entry?.tier}) not found in bazaar data.`);
        return this.lowestBinPrices[normalizedName] || 0;
    }

    getCraftingCostBreakdown(name, inventorySnapshot = null) {
        const instaBuy = this.getRecipeCost(name, 'insta-buy');
        const buyOrder = this.getRecipeCost(name, 'buy-order');
        const owned = this.getRecipeCost(name, 'owned', this.cloneInventorySnapshot(inventorySnapshot));
        const marketValue = this.getCraftingMarketValue(name);
        const entry = this.getProductEntry(name);
        const isAuctionProduct = entry?.type === 'auction-product' || entry?.type === 'forge-product';
        const fee = isAuctionProduct ? (marketValue > 10000000 ? 0.02 : 0.01) : 0.01;
        const margin = marketValue * (1 - fee) - buyOrder;

        return {
            instaBuy,
            buyOrder,
            owned,
            marketValue,
            margin
        };
    }

    getBestCraftCost(costs) {
        const validCosts = costs.filter(cost => Number.isFinite(cost) && cost > 0);
        if (!validCosts.length) {
            return 0;
        }

        return Math.min(...validCosts);
    }

    updateDailyProfits() {
        const dailyProfits = this.traderData['daily-profits'] || {};
        const todayKey = Object.keys(dailyProfits).pop();
        
        if (!todayKey) {
            document.getElementById('bazaarProfit').textContent = '-';
            document.getElementById('auctionProfit').textContent = '-';
            document.getElementById('forgeProfit').textContent = '-';
            return;
        }

        const today = dailyProfits[todayKey];
        document.getElementById('bazaarProfit').textContent = this.formatCoin(today['bazaar-profit'] || 0);
        document.getElementById('auctionProfit').textContent = this.formatCoin(today['auction-house-profit'] || 0);
        document.getElementById('forgeProfit').textContent = this.formatCoin(today['forge-profit'] || 0);
    }

    updateAllProducts() {
        const allProducts = this.traderData['all-products'] || {};
        const tbody = document.getElementById('productsBody');
        const productEntries = Object.entries(allProducts);

        if (productEntries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty">No products</td></tr>';
            return;
        }

        tbody.innerHTML = productEntries
            .sort((a, b) => (b[1]['total-profit-made'] || 0) - (a[1]['total-profit-made'] || 0))
            .slice(0, 50) // Show top 50 products
            .map(([name, product]) => {
                const profit = product['total-profit-made'] || 0;
                const className = profit >= 0 ? 'profit-positive' : 'profit-negative';

                return `
                    <tr>
                        <td>${name}</td>
                        <td>${product['current-amount'] || 0}</td>
                        <td class="${className}">${this.formatCoin(profit)}</td>
                        <td>${product['total-sold'] || 0}</td>
                    </tr>
                `;
            }).join('');
    }

    updateLastUpdate() {
        const now = new Date();
        const timeString = now.toLocaleTimeString();
        document.getElementById('lastUpdate').textContent = timeString;
    }

    getApiName(name) {
        return this.productList?.[name]?.['api-name'] || null;
    }

    getSellOrderKey(order, index) {
        return `${order['item-name'] || 'unknown'}-${order['sell-order-place-time'] || index}`;
    }

    getSellOrderSoldAmount(order) {
        return (order['sub-orders'] || []).reduce((sum, subOrder) => sum + (subOrder['partial-sold-amount'] || 0), 0);
    }

    calculateTotalInvestmentWorth() {
        const inventorySnapshot = this.buildInvestmentSnapshot();
        let totalWorth = 0;

        for (const [name, record] of Object.entries(inventorySnapshot)) {
            totalWorth += record.amount * this.getMarketUnitCost(name);
        }

        return totalWorth;
    }

    buildInvestmentSnapshot() {
        const snapshot = {};
        const investmentBuckets = [
            this.traderData?.['short-term-investments'] || {},
            this.traderData?.['long-term-investments'] || {}
        ];

        for (const bucket of investmentBuckets) {
            for (const [name, investment] of Object.entries(bucket)) {
                const subOrders = investment['sub-orders'] || [];
                const amount = subOrders.reduce((sum, subOrder) => sum + (subOrder['partial-amount'] || 0), 0);
                const totalCost = subOrders.reduce((sum, subOrder) => {
                    const unitCost = subOrder['price-bought'] ?? subOrder['price-crafted'] ?? 0;
                    return sum + ((subOrder['partial-amount'] || 0) * unitCost);
                }, 0);

                if (!snapshot[name]) {
                    snapshot[name] = { amount: 0, totalCost: 0 };
                }

                snapshot[name].amount += amount;
                snapshot[name].totalCost += totalCost;
            }
        }

        return snapshot;
    }

    cloneInventorySnapshot(snapshot) {
        const cloned = {};
        for (const [name, record] of Object.entries(snapshot || {})) {
            cloned[name] = { ...record };
        }
        return cloned;
    }

    getProductEntry(name) {
        return this.productList?.[name] || null;
    }

    isCraftableProduct(name) {
        const entry = this.getProductEntry(name);
        return Boolean(entry?.['crafting-materials'] && Object.keys(entry['crafting-materials']).length > 0);
    }

    getProductUnitCost(name, mode = 'insta-buy', inventorySnapshot = null, path = new Set()) {
        const normalizedName = this.normalizeName(name);
        if (path.has(normalizedName)) {
            return 0;
        }

        const entry = this.getProductEntry(name);
        const ownedUnitCost = inventorySnapshot ? this.getOwnedUnitCost(name, inventorySnapshot) : null;
        if (ownedUnitCost != null) {
            return ownedUnitCost;
        }
        if (ownedUnitCost == null && mode === 'owned') {
            return 0; // If owned unit cost is -1, it means we have the material but no cost info, treat as infinite cost
        }

        if (entry?.['crafting-materials'] && Object.keys(entry['crafting-materials']).length > 0) {
            return this.getRecipeCost(name, mode, inventorySnapshot, path);
        }

        if (entry?.['api-name']) {
            const bazaarProduct = this.bazaarData?.[entry['api-name']];
            const quickStatus = bazaarProduct?.quick_status;
            if (quickStatus) {
                return mode === 'buy-order' ? (quickStatus.sellPrice || 0) : (quickStatus.buyPrice || 0);
            }
        }

        const auctionPrice = this.lowestBinPrices[normalizedName];
        if (auctionPrice != null) {
            return auctionPrice;
        }

        return 0;
    }

    getMarketUnitCost(name, inventorySnapshot = null, path = new Set()) {
        const normalizedName = this.normalizeName(name);
        if (path.has(normalizedName)) {
            return 0;
        }

        const entry = this.getProductEntry(name);
        const ownedUnitCost = inventorySnapshot ? this.getOwnedUnitCost(name, inventorySnapshot) : null;
        if (ownedUnitCost != null) {
            return ownedUnitCost;
        }

        if (entry?.['api-name']) {
            const bazaarProduct = this.bazaarData?.[entry['api-name']];
            const quickStatus = bazaarProduct?.quick_status;
            if (quickStatus) {
                return quickStatus.sellPrice || quickStatus.buyPrice || 0;
            }
        }

        const auctionPrice = this.lowestBinPrices[normalizedName];
        if (auctionPrice != null) {
            return auctionPrice;
        }

        if (entry?.['crafting-materials']) {
            return this.getRecipeCost(name, 'insta-buy', inventorySnapshot, path);
        }

        return 0;
    }

    getOwnedUnitCost(name, inventorySnapshot) {
        const record = inventorySnapshot?.[name];
        if (!record || !record.amount) return null;
        return record.totalCost / record.amount;
    }

    getRecipeCost(name, mode = 'insta-buy', inventorySnapshot = null, path = new Set()) {
        const entry = this.getProductEntry(name);
        if (!entry?.['crafting-materials']) {
            return this.getProductUnitCost(name, mode, inventorySnapshot, path);
        }

        const normalizedName = this.normalizeName(name, entry?.tier);
        if (path.has(normalizedName)) {
            return 0;
        }

        path.add(normalizedName);
        let totalCost = 0;

        for (const [materialName, quantity] of Object.entries(entry['crafting-materials'])) {
            let remainingQuantity = quantity;
            const ownedUnitCost = inventorySnapshot ? this.getOwnedUnitCost(materialName, inventorySnapshot) : null;

            if (ownedUnitCost == null && mode === 'owned') {
                return 0; // If owned unit cost is -1, it means we have the material but no cost info, treat as infinite cost
            }

            if (inventorySnapshot?.[materialName]?.amount > 0 && ownedUnitCost != null) {
                const usedOwnedQuantity = Math.min(remainingQuantity, inventorySnapshot[materialName].amount);
                totalCost += usedOwnedQuantity * ownedUnitCost;
                inventorySnapshot[materialName].amount -= usedOwnedQuantity;
                inventorySnapshot[materialName].totalCost -= usedOwnedQuantity * ownedUnitCost;
                remainingQuantity -= usedOwnedQuantity;
            }

            if (remainingQuantity > 0) {
                totalCost += this.getProductUnitCost(materialName, mode, inventorySnapshot, path) * remainingQuantity;
            }
        }

        path.delete(normalizedName);
        return totalCost;
    }

    formatDuration(seconds) {
        if (!seconds) return '-';
        const totalHours = Math.floor(seconds / 3600);
        const totalMinutes = Math.floor((seconds % 3600) / 60);
        if (totalHours > 0) {
            return `${totalHours}h ${totalMinutes}m`;
        }
        return `${totalMinutes}m`;
    }

    formatAmount(amount) {
        if (typeof amount !== 'number') return '0';
        return amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    formatPercent(current, total) {
        if (!total) return '0%';
        return `${Math.round((current / total) * 100)}%`;
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return '-';
        const date = new Date(Number(timestamp));
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString();
    }

    formatCoin(amount) {
        if (typeof amount !== 'number') return '0';

        const isNegative = amount < 0;
        amount = Math.abs(amount);
        
        if (amount >= 1000000000) {
            return (isNegative ? '-' : '') + (amount / 1000000000).toFixed(2) + 'B';
        } else if (amount >= 1000000) {
            return (isNegative ? '-' : '') + (amount / 1000000).toFixed(2) + 'M';
        } else if (amount >= 1000) {
            return (isNegative ? '-' : '') + (amount / 1000).toFixed(2) + 'K';
        } else {
            return (isNegative ? '-' : '') + amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
    }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new TraderDashboard();
});
