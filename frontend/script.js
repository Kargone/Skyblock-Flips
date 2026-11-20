// Base transaction fee rates. When mayor Derpy is active (quadruples bazaar
// tax, and here also scales auction fees), just bump DERPY_TAX_MULTIPLIER -
// e.g. to 4 - and set it back to 1 once Derpy is no longer mayor.
let BAZAAR_TAX_RATE = 0.01;
let AUCTION_FEE_RATE_LOW = 0.01;   // auctions selling for <= 10M
let AUCTION_FEE_RATE_MID = 0.02;   // auctions selling for > 10M
let AUCTION_FEE_RATE_HIGH = 0.025; // auctions selling for > 100M
let DERPY_TAX_MULTIPLIER = 1;

function getBazaarTaxRate() {
    return BAZAAR_TAX_RATE * DERPY_TAX_MULTIPLIER;
}

function getAuctionFeeRate(price) {
    const baseRate = price > 100000000 ? AUCTION_FEE_RATE_HIGH
        : price > 10000000 ? AUCTION_FEE_RATE_MID
        : AUCTION_FEE_RATE_LOW;
    return baseRate * DERPY_TAX_MULTIPLIER;
}

// The Skyblock Flips server. It is looked for on whichever computer served this page,
// so the dashboard keeps working when the server moves to another machine on the
// network; opened straight from disk (file://), it falls back to this computer.
const API_BASE = `http://karsonserver:8000`;

// Trader Data Dashboard
class TraderDashboard {
    constructor() {
        this.traderData = null;
        this.productList = null;
        this.bazaarData = null;
        this.mayorData = null;
        this.auctionData = [];
        this.lowestBinPrices = {};
        this.openBuyOrders = new Set();
        this.openSellOrders = new Set();
        this.openInvestments = new Set();
        this.activeTab = 'bazaar-orders';
        this.updateInterval = 500;
        this.bazaarUpdateInterval = 60000; // 1 minute
        this.auctionUpdateInterval = 300000; // 5 minutes
        this.mayorUpdateInterval = 300000; // 5 minutes
        this.init();
    }

    init() {
        this.setupTabs();
        this.fetchMarketData();
        this.fetchMayorData();
        this.fetchAndUpdateData();
        this.setupInvestmentDeletion();

        setInterval(() => this.fetchAndUpdateData(), this.updateInterval);
        setInterval(() => this.fetchBazaarData(), this.bazaarUpdateInterval);
        setInterval(() => this.fetchAuctionData(), this.auctionUpdateInterval);
        setInterval(() => this.fetchMayorData(), this.mayorUpdateInterval);
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
            }).catch(() => { }),
            this.fetchBazaarData(),
            this.fetchAuctionData()
        ]);
        await this.fetchMayorData();

        this.updateDashboard();
    }

    // Mayor, election and festival times come from the backend (mayor.mjs), which the
    // mod's Bazaar window reads too, so the two always show the same times. It also
    // says when Derpy's QUAD TAXES is on, which sets the tax multiplier here.
    async fetchMayorData() {
        try {
            const response = await fetch(`${API_BASE}/api/mayor-data`);
            if (!response.ok) return;

            const payload = await response.json();
            this.mayorData = payload;
            DERPY_TAX_MULTIPLIER = payload['tax-multiplier'] || 1;
        } catch (error) {
            console.error('Error fetching mayor data:', error);
        }
    }

    // From the server, falling back to the file on disk when the page is opened from
    // the repo and the server is not reachable.
    async fetchTraderData() {
        return this.fetchFirstAvailable([
            `${API_BASE}/api/trader-data`,
            '../data/trader-data.json'
        ]);
    }

    async fetchProductList() {
        return this.fetchFirstAvailable([
            `${API_BASE}/api/product-list`,
            '../server/product-list.json',
            './server/product-list.json'
        ]);
    }

    // The first of these that answers with a success, else the last response (or the
    // last error) so the caller sees why.
    async fetchFirstAvailable(urls) {
        let lastResponse = null;
        let lastError = null;
        for (const url of urls) {
            try {
                const response = await fetch(url);
                if (response.ok) return response;
                lastResponse = response;
            } catch (error) {
                lastError = error;
            }
        }
        if (lastResponse) return lastResponse;
        throw lastError;
    }

    async fetchBazaarData() {
        try {
            const response = await fetch(`${API_BASE}/api/market-data`);
            if (!response.ok) return;

            const payload = await response.json();
            this.lastUpdated = payload.lastUpdated || {};
            this.bazaarData = payload.bazaarProducts || {};
            this.lowestBinPrices = payload.lowestBinPrices || {};
        } catch (error) {
            console.error('Error fetching bazaar data:', error);
        }
    }

    async fetchAuctionData() {
        try {
            const response = await fetch(`${API_BASE}/api/market-data`);
            if (!response.ok) return;

            const payload = await response.json();
            this.lowestBinPrices = payload.lowestBinPrices || {};
        } catch (error) {
            console.error('Error fetching auction data:', error);
        }
    }

    normalizeName(name) {
        return String(name || '')
            .replace(/§./g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    getAllProductBuyOrderCount(itemName) {
        const allProducts = this.traderData?.['all-products'] || {};
        return allProducts[itemName]?.['buy-order-stats']?.['total-buy-orders-created'] || 0;
    }

    setupInvestmentDeletion() {
        async function handleDeleteClick(event) {
            const button = event.target.closest('.delete-investment-button');
            if (!button) return;

            const amount = Number(button.dataset.amount || 0);
            const itemName = button.dataset.itemName || '';
            console.log(`Delete investment clicked for ${itemName} with amount ${amount}`);
            // Here you would implement the logic to delete the investment, e.g., sending a request to the backend
            const response = await fetch(`${API_BASE}/trades`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 'chat', text: `xjk You removed ${amount}x ${itemName} from your inventory!` })
            });
            const result = await response;
            console.log(result.statusText);
        };

        document.getElementById('shorttermInvestmentsBody')?.addEventListener('click', handleDeleteClick);
        document.getElementById('longtermInvestmentsBody')?.addEventListener('click', handleDeleteClick);
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
        this.updateForge();
        this.updateDailyProfits();
        this.updateTodaysProducts();
        this.updateAllProducts();
        this.updateLastUpdate();
        this.updateCalendar();
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

        // Active Auctions
        document.getElementById('activeAuctions').textContent = auctionOrders.length;
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
            const spread = Math.abs((sellPrice * (1 - getBazaarTaxRate())) - buyPrice);
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
            const spreadA = productA?.quick_status ? Math.abs((productASellPrice || 0) * (1 - getBazaarTaxRate()) - (productABuyPrice || 0)) : 0;
            const spreadB = productB?.quick_status ? Math.abs((productBSellPrice || 0) * (1 - getBazaarTaxRate()) - (productBBuyPrice || 0)) : 0;
            return spreadB - spreadA;
        }).map((name) => ({ name, apiName: this.getApiName(name) })).slice(0, 40); // top 40 products by spread
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
            const spread = Math.abs((sellPrice * (1 - getBazaarTaxRate())) - buyPrice);

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
            document.getElementById('buyOrdersTitle').textContent = `Active Buy Orders: Total Value: 0, Total Bought: 0/0 (100%), Total Projected Profit: 0`;
            return;
        }

        // sort buy orders by percent filled
        buyOrders.sort((a, b) => {
            const percentA = (a['bought-amount'] || 0) / (a['buying-amount'] || 1);
            const percentB = (b['bought-amount'] || 0) / (b['buying-amount'] || 1);
            return percentB - percentA;
        });

        const rows = [];
        let totalSoldAmount = 0;
        let totalAmountAllOrders = 0;
        let totalValue = 0;
        let totalProjectedProfit = 0;

        buyOrders.forEach((order, index) => {
            const totalBought = order['bought-amount'] || 0;
            const totalAmount = order['buying-amount'] || 0;
            const orderKey = this.getBuyOrderKey(order, index);
            const isOpen = this.openBuyOrders.has(orderKey);
            const status = totalBought >= totalAmount ? 'Filled' : 'Pending';
            const bazaarPrice = this.getBazaarSellOrderPrice(order['item-name']);
            const margin = bazaarPrice ? (bazaarPrice * (1 - getBazaarTaxRate())) - (order['price-buying'] || 0) : 0;
            const projectedProfit = margin * totalAmount || 0;

            totalSoldAmount += totalBought;
            totalAmountAllOrders += totalAmount;
            totalValue += totalAmount * (order['price-buying'] || 0);
            totalProjectedProfit += projectedProfit;

            rows.push(`
                <tr class="buy-order-row">
                    <td>
                        <button class="expand-button buy-order-toggle" data-order-key="${orderKey}" aria-expanded="${isOpen}">${isOpen ? '▾' : '▸'}</button>
                        ${order['item-name']}
                    </td>
                    <td>${this.formatCoin(order['price-buying'])}</td>
                    <td>${this.formatAmount(totalBought)} / ${this.formatAmount(totalAmount)} (${this.formatPercent(totalBought, totalAmount)})</td>
                    <td>${this.formatCoin(totalAmount * (order['price-buying'] || 0))}</td>
                    <td>${this.formatTimestamp(order['buy-order-place-time'])}</td>
                    <td>
                        <span class="status-badge status-${status.toLowerCase()}">${status}</span>
                    </td>
                </tr>
            `);

            if (isOpen) {
                rows.push(`
                    <tr class="sell-order-details-row">
                        <td colspan="6">
                            <div class="sell-order-details">
                                <h4>Bazaar Price Breakdown</h4>
                                <table class="sub-orders-table">
                                    <thead>
                                        <tr>
                                            <th>Bazaar Price</th>
                                            <th>Order Price</th>
                                            <th>Margin</th>
                                            <th>Projected Profit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td>${bazaarPrice ? this.formatCoin(bazaarPrice) : 'N/A'}</td>
                                            <td>${this.formatCoin(order['price-buying'] || 0)}</td>
                                            <td class="${margin >= 0 ? 'profit-positive' : 'profit-negative'}">${bazaarPrice ? this.formatCoin(margin) : 'N/A'}</td>
                                            <td class="${projectedProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${bazaarPrice ? this.formatCoin(projectedProfit) : 'N/A'}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </td>
                    </tr>
                `);
            }
        });

        tbody.innerHTML = rows.join('');

        tbody.querySelectorAll('.buy-order-toggle').forEach(button => {
            button.addEventListener('click', () => {
                const orderKey = button.getAttribute('data-order-key');
                if (this.openBuyOrders.has(orderKey)) {
                    this.openBuyOrders.delete(orderKey);
                } else {
                    this.openBuyOrders.add(orderKey);
                }
                this.updateBuyOrders();
            });
        });

        const percentFilled = totalAmountAllOrders > 0 ? (totalSoldAmount / totalAmountAllOrders) * 100 : 0;
        document.getElementById('buyOrdersTitle').textContent = `Active Buy Orders: Total Value: ${this.formatCoin(totalValue)}, Total Bought: ${this.formatAmount(totalSoldAmount)}/${this.formatAmount(totalAmountAllOrders)} (${percentFilled.toFixed(2)}%), Total Projected Profit: ${this.formatCoin(totalProjectedProfit)}`;
    }

    updateSellOrders() {
        const sellOrders = this.traderData['sell-order-overview']['sell-orders'] || [];
        const tbody = document.getElementById('sellOrdersBody');

        if (sellOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty">No sell orders</td></tr>';
            document.getElementById('sellOrdersTitle').textContent = `Active Sell Orders: Total Value: 0, Total Sold: 0/0 (100%), Total Projected Profit: 0`;
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
                                                <td>${this.formatCoin(subOrder['price-bought'] || subOrder['price-crafted'] || 0)}</td>
                                                <td class="${subOrder['projected-profit'] >= 0 ? 'profit-positive' : 'profit-negative'}">${this.formatCoin(subOrder['projected-profit'] || 0)}</td>
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
        const shorttbody = document.getElementById('shorttermInvestmentsBody');
        const longtbody = document.getElementById('longtermInvestmentsBody');
        const shortTermInv = this.traderData['short-term-investments'] || {};
        const longTermInv = this.traderData['long-term-investments'] || {};

        const shortTermInvestmentEntries = Object.entries(shortTermInv);
        const longTermInvestmentEntries = Object.entries(longTermInv);

        if (shortTermInvestmentEntries.length === 0) {
            shorttbody.innerHTML = '<tr><td colspan="9" class="empty">No investments</td></tr>';
        } else {
            // Process short-term investments
            this.processInvestments(shortTermInvestmentEntries, shorttbody, 'Short-term');
        }

        if (longTermInvestmentEntries.length === 0) {
            longtbody.innerHTML = '<tr><td colspan="9" class="empty">No investments</td></tr>';
        } else {
            // Process long-term investments
            this.processInvestments(longTermInvestmentEntries, longtbody, 'Long-term');
        }
    }

    processInvestments(investmentEntries, tbody, investmentType) {
        // sort investments by highest profit
        investmentEntries.sort(([nameA, invA], [nameB, invB]) => {
            const totalAmountA = invA['sub-orders'].reduce((sum, sub) => sum + sub['partial-amount'], 0);
            const totalAmountB = invB['sub-orders'].reduce((sum, sub) => sum + sub['partial-amount'], 0);
            const highestPriceA = invA['sub-orders'].length > 0 ?
                Math.max(...invA['sub-orders'].map(o => o["price-bought"] || o["price-crafted"])) : 0;
            const highestPriceB = invB['sub-orders'].length > 0 ?
                Math.max(...invB['sub-orders'].map(o => o["price-bought"] || o["price-crafted"])) : 0;
            const currentSellPriceA = this.getCraftingMarketValue(nameA);
            const currentSellPriceB = this.getCraftingMarketValue(nameB);
            const marginA = currentSellPriceA * (1 - getBazaarTaxRate()) - highestPriceA;
            const marginB = currentSellPriceB * (1 - getBazaarTaxRate()) - highestPriceB;
            const currentProfitA = marginA * totalAmountA || 0;
            const currentProfitB = marginB * totalAmountB || 0;
            return currentProfitB - currentProfitA;
        });

        tbody.innerHTML = investmentEntries.map(([name, inv]) => {
            const type = investmentType;
            const investmentKey = `${investmentType}:${name}`;
            const isOpen = this.openInvestments.has(investmentKey);
            const totalAmount = inv['sub-orders'].reduce((sum, sub) => sum + sub['partial-amount'], 0);
            const highestPrice = inv['sub-orders'].length > 0 ?
                Math.max(...inv['sub-orders'].map(o => o["price-bought"] || o["price-crafted"])) : 0;
            const currentSellPrice = this.getCraftingMarketValue(name);

            const currentProfit = inv['sub-orders'].reduce((sum, subOrder) => {
                const margin = currentSellPrice * (1 - getBazaarTaxRate()) - (subOrder["price-bought"] || subOrder["price-crafted"]);
                const currentProfit = margin * subOrder['partial-amount'] || 0;
                return sum + currentProfit;
            }, 0);

            const margin = currentSellPrice * (1 - getBazaarTaxRate()) - highestPrice;
            const currentProfitWithHighestPrice = margin * totalAmount || 0;
            const rowClass = this.getAllProductBuyOrderCount(name) === 0 && investmentType === 'Short-term'? 'zero-buy-orders' : '';
            // get the date-bought from the earliest sub-order
            const earliestSubOrder = inv['sub-orders'].reduce((earliest, sub) => {
                return !earliest || sub['time-bought'] < earliest['time-bought'] ? sub : earliest;
            }, null);
            const dateBought = earliestSubOrder ? new Date(earliestSubOrder['time-bought']).toLocaleDateString() : 'N/A';
            const escapedName = this.escapeHtml(name);

            // Each lot priced at what it was bought or crafted for, most expensive first,
            // with its profit at the current sell price after tax.
            const subOrderRows = [...inv['sub-orders']]
                .sort((a, b) => (b["price-bought"] || b["price-crafted"] || 0) - (a["price-bought"] || a["price-crafted"] || 0))
                .map(subOrder => {
                    const pricePaid = subOrder["price-bought"] || subOrder["price-crafted"] || 0;
                    const subOrderMargin = currentSellPrice * (1 - getBazaarTaxRate()) - pricePaid;
                    const subOrderProfit = subOrderMargin * subOrder['partial-amount'] || 0;
                    return `
                        <tr>
                            <td>${this.formatAmount(subOrder['partial-amount'])}</td>
                            <td>${this.formatCoin(pricePaid)}</td>
                            <td class="${subOrderMargin >= 0 ? 'profit-positive' : 'profit-negative'}">${currentSellPrice ? this.formatCoin(subOrderMargin) : 'N/A'}</td>
                            <td class="${subOrderProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${currentSellPrice ? this.formatCoin(subOrderProfit) : 'N/A'}</td>
                            <td>${this.formatTimestamp(subOrder['time-bought'])}</td>
                        </tr>
                    `;
                }).join('');

            const detailsRow = !isOpen ? '' : `
                <tr class="sell-order-details-row">
                    <td colspan="9">
                        <div class="sell-order-details">
                            <h4>Sub-orders</h4>
                            <table class="sub-orders-table">
                                <thead>
                                    <tr>
                                        <th>Amount</th>
                                        <th>Price Paid</th>
                                        <th>Margin</th>
                                        <th>Profit</th>
                                        <th>Time Bought</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${subOrderRows || '<tr><td colspan="5" class="empty">No sub-orders</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            `;

            return `
                <tr class="${rowClass}">
                    <td>
                        <button class="expand-button investment-toggle" data-investment-key="${this.escapeHtml(investmentKey)}" aria-expanded="${isOpen}">${isOpen ? '▾' : '▸'}</button>
                        ${escapedName}
                    </td>
                    <td>${type}</td>
                    <td>${totalAmount}</td>
                    <td>${this.formatCoin(highestPrice)}</td>
                    <td>${this.formatCoin(currentSellPrice)}</td>
                    <!-- color the text if positive or negative -->
                    <td>${margin ? this.formatCoin(margin) : 'N/A'}</td>
                    <td class="${currentProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${this.formatCoin(currentProfitWithHighestPrice)} (${this.formatCoin(currentProfit)})</td>
                    <td>${dateBought}</td>
                    <td class="investment-delete-cell">
                        <button
                            type="button"
                            class="delete-investment-button"
                            data-item-name="${escapedName}"
                            data-amount="${totalAmount}"
                        >
                            Delete
                        </button>
                    </td>
                </tr>
                ${detailsRow}
            `;
        }).join('');

        tbody.querySelectorAll('.investment-toggle').forEach(button => {
            button.addEventListener('click', () => {
                const investmentKey = button.getAttribute('data-investment-key');
                if (this.openInvestments.has(investmentKey)) {
                    this.openInvestments.delete(investmentKey);
                } else {
                    this.openInvestments.add(investmentKey);
                }
                this.updateInvestments();
            });
        });
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
                <td>${this.formatCoin(this.getCraftingMarketValue(auction['item-name']))}</td>
                <td>${this.formatCoin(auction['price-selling'])}</td>
                <td>${this.formatCoin(auction['material-cost'])}</td>
                <td class="${auction['price-selling'] * (1 - getAuctionFeeRate(auction['price-selling'])) - auction['material-cost'] >= 0 ? 'profit-positive' : 'profit-negative'}">${this.formatCoin(auction['price-selling'] * (1 - getAuctionFeeRate(auction['price-selling'])) - auction['material-cost'])}<span class="${this.getCraftingMarketValue(auction['item-name']) * (1 - getAuctionFeeRate(auction['price-selling'])) - auction['material-cost'] - this.calcAuctionFee(auction['price-selling']) >= 0 ? 'profit-positive' : 'profit-negative'}"> (${this.formatCoin(this.getCraftingMarketValue(auction['item-name']) * (1 - getAuctionFeeRate(auction['price-selling'])) - auction['material-cost'] - this.calcAuctionFee(auction['price-selling']))})</span></td>
                <td>
                    <span class="status-badge ${auction['sold'] ? 'status-filled' : 'status-partial'}">
                        ${auction['sold'] ? 'Sold' : 'Active'}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    calcAuctionFee(price_not_sold) {
        return price_not_sold * getAuctionFeeRate(price_not_sold);
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
            const orderKey = `${sectionPrefix}-${this.normalizeName(name)}-${index}`;
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
                    <td class="${costBreakdown.margin >= 0 ? 'profit-positive' : 'profit-negative'}">${this.formatCoin(costBreakdown.margin)}<span class="${costBreakdown.margin - (costBreakdown.instaBuy - costBreakdown.buyOrder) >= 0 ? 'profit-positive' : 'profit-negative'}"> (${this.formatCoin(costBreakdown.margin - (costBreakdown.instaBuy - costBreakdown.buyOrder))})</span></td>
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
                                            <th>Have Mats</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${materials.map(([materialName, qty]) => {
                    const directInsta = this.getProductUnitCost(materialName, 'insta-buy');
                    const directBuy = this.getProductUnitCost(materialName, 'buy-order');
                    const directOwned = this.getProductUnitCost(materialName, 'owned', this.cloneInventorySnapshot(inventorySnapshot), qty);

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

        const bazaarProduct = this.getBazaarProduct(entry);
        if (bazaarProduct) {
            const buyPrice = bazaarProduct.buy_summary?.[0]?.pricePerUnit || 0;
            const sellPrice = bazaarProduct.sell_summary?.[0]?.pricePerUnit || 0;
            if (name.includes('forge')) return sellPrice;
            if (buyPrice) return buyPrice;
        }

        return this.getLowestBin(name) || 0;
    }

    getCraftingCostBreakdown(name, inventorySnapshot = null) {
        const instaBuy = this.getRecipeCost(name, 'insta-buy');
        const buyOrder = this.getRecipeCost(name, 'buy-order');
        const owned = this.getRecipeCost(name, 'owned', this.cloneInventorySnapshot(inventorySnapshot));
        const marketValue =this.getCraftingMarketValue(name);
        const margin = marketValue * (1 - this.getCraftingSaleFeeRate(name, marketValue)) - buyOrder;

        return {
            instaBuy,
            buyOrder,
            owned,
            marketValue,
            margin
        };
    }

    // The fee taken when a crafted product sells at marketValue: auction fees for
    // auction and forge products, Bazaar tax for everything else.
    getCraftingSaleFeeRate(name, marketValue) {
        const entry = this.getProductEntry(name);
        const isAuctionProduct = entry?.type === 'auction-product' || entry?.type === 'forge-product';
        // A "(forge)" product with a Bazaar listing is valued at its insta-sell price, so it pays Bazaar tax
        const isBazaarSale = name.includes('forge') && !!this.bazaarData?.[entry?.['api-name']];
        return isAuctionProduct && !isBazaarSale ? getAuctionFeeRate(marketValue) : getBazaarTaxRate();
    }

    getBestCraftCost(costs) {
        const validCosts = costs.filter(cost => Number.isFinite(cost) && cost > 0);
        if (!validCosts.length) {
            return 0;
        }

        return Math.min(...validCosts);
    }

    // The Forge tab: what is in the forge now, what came out of it, and what it made.
    // Processes are tracked by the mod reading the forge menu; a process is ready once
    // its "time-ends" has passed, and its sale counts as forge profit.
    updateForge() {
        const active = [...(this.traderData['forge'] || [])].sort((a, b) => a['slot'] - b['slot']);
        const history = this.traderData['forge-history'] || [];
        const now = Date.now();

        let readyCount = 0;
        let totalValue = 0;
        let totalProfit = 0;

        const slotsBody = document.getElementById('forgeSlotsBody');
        if (active.length === 0) {
            slotsBody.innerHTML = '<tr><td colspan="7" class="empty">Nothing forging</td></tr>';
        } else {
            slotsBody.innerHTML = active.map(process => {
                const name = process['item-name'];
                const amount = process['amount'] || 1;
                const cost = process['material-cost'] || 0;
                const marketValue = this.getCraftingMarketValue(name) * amount;
                const profit = marketValue * (1 - this.getCraftingSaleFeeRate(name, marketValue)) - cost;
                const msLeft = (process['time-ends'] || 0) - now;
                const ready = msLeft <= 0;

                if (ready) readyCount++;
                totalValue += marketValue;
                totalProfit += profit;

                const started = this.formatTimestamp(process['time-started']) + (process['start-estimated'] ? ' (est.)' : '');
                const timeLeft = ready
                    ? '<span class="status-badge status-filled">Ready</span>'
                    : `<span class="status-badge status-active">${this.formatCountdown(msLeft)}</span>`;

                return `
                    <tr>
                        <td>#${process['slot']}</td>
                        <td>${this.escapeHtml(this.getForgeDisplayName(name))}${amount > 1 ? ` x${amount}` : ''}</td>
                        <td>${started}</td>
                        <td>${timeLeft}</td>
                        <td>${this.formatCoin(cost)}</td>
                        <td>${this.formatCoin(marketValue)}</td>
                        <td class="${profit >= 0 ? 'profit-positive' : 'profit-negative'}">${this.formatCoin(profit)}</td>
                    </tr>
                `;
            }).join('');
        }

        document.getElementById('forgeActiveCount').textContent = String(active.length);
        document.getElementById('forgeReadyCount').textContent = String(readyCount);
        document.getElementById('forgeValue').textContent = this.formatCoin(totalValue);
        const projected = document.getElementById('forgeProjectedProfit');
        projected.textContent = this.formatCoin(totalProfit);
        projected.className = `value ${totalProfit >= 0 ? 'profit-positive' : 'profit-negative'}`;

        const dailyProfits = this.traderData['daily-profits'] || {};
        const todayKey = Object.keys(dailyProfits).pop();
        const allTime = Object.values(dailyProfits).reduce((sum, day) => sum + (day['forge-profit'] || 0), 0);
        document.getElementById('forgeProfitToday').textContent = this.formatCoin(todayKey ? dailyProfits[todayKey]['forge-profit'] || 0 : 0);
        document.getElementById('forgeProfitAllTime').textContent = this.formatCoin(allTime);

        const startOfToday = new Date().setHours(0, 0, 0, 0);
        document.getElementById('forgeClaimedToday').textContent =
            String(history.filter(process => process['time-claimed'] >= startOfToday).length);
        document.getElementById('forgeClaimedAllTime').textContent = String(history.length);

        const historyBody = document.getElementById('forgeHistoryBody');
        if (history.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="6" class="empty">Nothing claimed yet</td></tr>';
            return;
        }

        historyBody.innerHTML = [...history]
            .sort((a, b) => b['time-claimed'] - a['time-claimed'])
            .slice(0, 50) // the 50 most recent
            .map(process => {
                const amount = process['amount'] || 1;
                const took = process['time-claimed'] - process['time-started'];
                return `
                    <tr>
                        <td>${this.escapeHtml(this.getForgeDisplayName(process['item-name']))}${amount > 1 ? ` x${amount}` : ''}</td>
                        <td>#${process['slot']}</td>
                        <td>${this.formatTimestamp(process['time-started'])}${process['start-estimated'] ? ' (est.)' : ''}</td>
                        <td>${this.formatTimestamp(process['time-claimed'])}</td>
                        <td>${this.formatCountdown(took)}</td>
                        <td>${this.formatCoin(process['material-cost'] || 0)}</td>
                    </tr>
                `;
            }).join('');
    }

    // "Refined Diamond (forge)" is shown as "Refined Diamond".
    getForgeDisplayName(name) {
        return String(name || '').replace(/ \(forge\)$/i, '');
    }

    // A span of time as its two largest units: "1d 6h", "5h 3m", "2m 10s", "45s".
    formatCountdown(ms) {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
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

    updateTodaysProducts() {
        const todayKey = Object.keys(this.traderData['daily-profits'] || {}).pop();
        const todaysProducts = (this.traderData['daily-profits'] || {})[todayKey]?.['trades'] || {};
        const tbody = document.getElementById('todaysProductsBody');
        const productEntries = Object.entries(todaysProducts);

        if (productEntries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty">No products</td></tr>';
            return;
        }

        const totalProfit = productEntries.reduce((sum, [name, product]) => sum + (product['total-profit'] || 0), 0);

        tbody.innerHTML = productEntries
            .sort((a, b) => (b[1]['total-profit'] || 0) - (a[1]['total-profit'] || 0))
            .map(([name, product]) => {
                const itemName = product['item-name'] || name;
                const profit = product['total-profit'] || 0;
                const className = profit >= 0 ? 'profit-positive' : 'profit-negative';
                const profitPerItem = profit / (product['count'] || 1);
                const percentOfTotalProfit = (profit / (totalProfit || 1)) * 100;
                const totalSellOrders = product['sell-order-stats']?.['total-sell-orders-created'] || 0;

                return `
                    <tr>
                        <td>${itemName}</td>
                        <td class="${className}">${this.formatCoin(profit)}</td>
                        <td>${product['count'] || 0}</td>
                        <td>${this.formatCoin(profitPerItem)}</td>
                        <td>${percentOfTotalProfit.toFixed(2)}%</td>
                    </tr>
                `;
            }).join('');
    }

    updateAllProducts() {
        const allProducts = this.traderData['all-products'] || {};
        const tbody = document.getElementById('productsBody');
        const productEntries = Object.entries(allProducts);

        if (productEntries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty">No products</td></tr>';
            return;
        }

        let totalProfit = 0;
        for (const [key, value] of Object.entries(this.traderData['daily-profits'] || {})) {
            totalProfit += value['daily-profit'] || 0;
        }

        tbody.innerHTML = productEntries
            .sort((a, b) => (b[1]['total-profit-made'] || 0) - (a[1]['total-profit-made'] || 0))
            .slice(0, 50) // Show top 50 products
            .map(([name, product]) => {
                const profit = product['total-profit-made'] || 0;
                const className = profit >= 0 ? 'profit-positive' : 'profit-negative';
                const profitPerItem = profit / (product['total-sold'] || 1);
                const percentOfTotalProfit = (profit / (totalProfit || 1)) * 100;
                const totalSellOrders = product['sell-order-stats']?.['total-sell-orders-created'] || 0;

                return `
                    <tr>
                        <td>${name}</td>
                        <td class="${className}">${this.formatCoin(profit)}</td>
                        <td>${product['total-sold'] || 0}</td>
                        <td>${this.formatCoin(profitPerItem)}</td>
                        <td>${percentOfTotalProfit.toFixed(2)}%</td>
                        <td>${totalSellOrders}</td>
                    </tr>
                `;
            }).join('');
    }

    updateLastUpdate() {
        const now = new Date();
        const timeString = now.toLocaleTimeString();

        // console.log(this.lastUpdated);
        const lastUpdateAuctions = this.lastUpdated?.auctions;
        const lastUpdateBazaar = this.lastUpdated?.bazaar;
        document.getElementById('lastUpdate').textContent = `Last Update: Bazaar: ${lastUpdateBazaar ? this.formatTimestamp(lastUpdateBazaar) : 'N/A'}, Auctions: ${lastUpdateAuctions ? this.formatTimestamp(lastUpdateAuctions) : 'N/A'} (Current Time: ${timeString})`;
    }

    updateCalendar() {
        const formatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        const findtargetDate = (timestamp) => {
            if (!timestamp) return 'N/A';
            const date = new Date(timestamp);
            return date.toLocaleString(undefined, formatOptions);
        };
        const targetElectionDate = findtargetDate(this.mayorData?.election?.['ends-at']);
        const targetSpookyFestivalDate = findtargetDate(this.mayorData?.['spooky-festival']?.['starts-at']);

        const calendarElement = document.getElementById('calendar');
        calendarElement.innerHTML = `
            <h2>Mayor Information</h2>
            <div class="mayor-info">
                <p>Current Mayor: ${this.mayorData?.mayor?.name || 'N/A'}</p>
                <p>Current Minister: ${this.formatMinister(this.mayorData?.mayor?.minister)}</p>
                <p>Next Mayor: ${this.mayorData?.election?.leader || 'N/A'}</p>
                <p>Next Minister: ${this.formatMinister(this.mayorData?.election?.['runner-up'])}</p>
                <p>Election Ends: ${targetElectionDate}</p>
                <p>Next Spooky Festival: ${targetSpookyFestivalDate}</p>
                <p>Daily NPC Reset Time: 7:00 PM CDT</p>
            </div>
        `;
    }

    getApiName(name) {
        return this.productList?.[name]?.['api-name'] || null;
    }

    getBuyOrderKey(order, index) {
        return `${order['item-name'] || 'unknown'}-${order['buy-order-place-time'] || index}`;
    }

    getBazaarBuyOrderPrice(itemName) {
        const entry = this.getProductEntry(itemName);
        const apiName = entry?.['api-name'];
        if (!apiName) return 0;

        const bazaarProduct = this.bazaarData?.[apiName];
        return bazaarProduct?.sell_summary?.[0]?.pricePerUnit || 0;
    }

    getBazaarSellOrderPrice(itemName) {
        const entry = this.getProductEntry(itemName);
        const apiName = entry?.['api-name'];
        if (!apiName) return 0;

        const bazaarProduct = this.bazaarData?.[apiName];
        return bazaarProduct?.buy_summary?.[0]?.pricePerUnit || 0;
    }

    getSellOrderKey(order, index) {
        return `${order['item-name'] || 'unknown'}-${order['sell-order-place-time'] || index}`;
    }

    // "Cole (Mining Fiesta)"; works for both the minister and the election runner-up.
    formatMinister(minister) {
        if (!minister?.name) return 'N/A';
        const name = this.escapeHtml(minister.name);
        return minister.perk ? `${name} (${this.escapeHtml(minister.perk)})` : name;
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

    // The Bazaar listing for a product, or null when it has none. An api name alone
    // does not mean the Bazaar carries it: auction items have Hypixel ids too.
    getBazaarProduct(entry) {
        const apiName = entry?.['api-name'];
        return (apiName && this.bazaarData?.[apiName]) || null;
    }

    // Lowest BIN for a product. The auction data is keyed by display name, never by
    // api name, and the "(forge)" the product list uses to tell recipes apart is not
    // part of an item's name.
    getLowestBin(name) {
        return this.lowestBinPrices[this.normalizeName(String(name || '').replace(/ \(forge\)$/i, ''))];
    }

    isCraftableProduct(name) {
        const entry = this.getProductEntry(name);
        return Boolean(entry?.['crafting-materials'] && Object.keys(entry['crafting-materials']).length > 0);
    }

    getProductUnitCost(name, mode = 'insta-buy', inventorySnapshot = null, amountNeeded = 0, path = new Set()) {
        const normalizedName = this.normalizeName(name);
        if (path.has(normalizedName)) {
            return 0;
        }

        const entry = this.getProductEntry(name);
        const ownedUnitCost = inventorySnapshot ? this.getOwnedUnitCost(name, inventorySnapshot, amountNeeded) : null;
        if (ownedUnitCost != null) {
            return ownedUnitCost;
        }
        if (ownedUnitCost == null && mode === 'owned') {
            return 0; // If owned unit cost is -1, it means we have the material but no cost info, treat as infinite cost
        }

        if (entry?.['crafting-materials'] && Object.keys(entry['crafting-materials']).length > 0) {
            return this.getRecipeCost(name, mode, inventorySnapshot, path);
        }

        const bazaarProduct = this.getBazaarProduct(entry);
        if (bazaarProduct) {
            const buyOrders = bazaarProduct.sell_summary || [];
            const sellOrders = bazaarProduct.buy_summary || [];
            return mode === 'buy-order' ? (buyOrders[0]?.pricePerUnit || 0) : (sellOrders[0]?.pricePerUnit || 0);
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

        const bazaarProduct = this.getBazaarProduct(entry);
        if (bazaarProduct) {
            const instaSellOrders = bazaarProduct.buy_summary || [];
            const instaBuyOrders = bazaarProduct.sell_summary || [];
            return instaSellOrders[0]?.pricePerUnit || instaBuyOrders[0]?.pricePerUnit || 0;
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

    getOwnedUnitCost(name, inventorySnapshot, amountNeeded = 0) {
        const record = inventorySnapshot?.[name];
        
        // add functionality to calculate an auction if you dont have it in your inventory, but you could craft it with materials you do have in your inventory, and return that cost instead of null
        // console.log(`Debug: Getting owned unit cost for ${name} with amount needed: ${amountNeeded}`);
        
        if (this.isCraftableProduct(name)) {
            const craftCost = this.getRecipeCost(name, 'owned', inventorySnapshot);
            if (craftCost > 0) return craftCost;
        }
        
        if (!record || !record.amount) return null;
        // use the quantity needed to determine if it actually can be filled with owned items, if not, return null to indicate that we need to buy it
        if (amountNeeded > 0 && record.amount < amountNeeded) return null;

        return record.totalCost / record.amount;
    }

    getRecipeCost(name, mode = 'insta-buy', inventorySnapshot = null, path = new Set()) {
        const entry = this.getProductEntry(name);
        if (!entry?.['crafting-materials']) {
            return this.getProductUnitCost(name, mode, inventorySnapshot, path);
        }

        const normalizedName = this.normalizeName(name);
        if (path.has(normalizedName)) {
            return 0;
        }

        path.add(normalizedName);
        let totalCost = 0;

        for (const [materialName, quantity] of Object.entries(entry['crafting-materials'])) {
            let remainingQuantity = quantity;
            const ownedUnitCost = inventorySnapshot ? this.getOwnedUnitCost(materialName, inventorySnapshot, quantity) : null;

            if (ownedUnitCost == null && mode === 'owned') return 0;

            if (inventorySnapshot?.[materialName]?.amount > 0 && ownedUnitCost != null) {
                const usedOwnedQuantity = Math.min(remainingQuantity, inventorySnapshot[materialName].amount);
                totalCost += usedOwnedQuantity * ownedUnitCost;
                inventorySnapshot[materialName].amount -= usedOwnedQuantity;
                inventorySnapshot[materialName].totalCost -= usedOwnedQuantity * ownedUnitCost;
                remainingQuantity -= usedOwnedQuantity;
            }

            if (remainingQuantity > 0) {
                totalCost += this.getProductUnitCost(materialName, mode, inventorySnapshot, 0, path) * remainingQuantity;
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
