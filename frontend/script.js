// Trader Data Dashboard
class TraderDashboard {
    constructor() {
        this.traderData = null;
        this.productList = null;
        this.bazaarData = null;
        this.openSellOrders = new Set();
        this.updateInterval = 1000; // 1 second
        this.bazaarUpdateInterval = 30000; // 30 seconds
        this.init();
    }

    init() {
        this.fetchAndUpdateData();
        setInterval(() => this.fetchAndUpdateData(), this.updateInterval);
        setInterval(() => this.fetchBazaarData(), this.bazaarUpdateInterval);
    }

    async fetchAndUpdateData() {
        try {
            const [traderDataResponse, productListResponse] = await Promise.all([
                this.fetchTraderData(),
                this.fetchProductList()
            ]);

            if (!traderDataResponse.ok) {
                throw new Error('Failed to fetch trader data');
            }

            this.traderData = await traderDataResponse.json();
            localStorage.setItem('traderData', JSON.stringify(this.traderData));

            if (productListResponse.ok) {
                this.productList = await productListResponse.json();
            }

            await this.fetchBazaarData();
            this.updateDashboard();
        } catch (error) {
            console.error('Error fetching trader data:', error);
        }
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
            const response = await fetch('https://api.hypixel.net/v2/skyblock/bazaar');
            if (!response.ok) return;

            const payload = await response.json();
            this.bazaarData = payload.products || {};
        } catch (error) {
            console.error('Error fetching bazaar data:', error);
        }
    }

    updateDashboard() {
        if (!this.traderData) return;

        this.updateStats();
        this.updateBazaarSnapshot();
        this.updateBuyOrders();
        this.updateSellOrders();
        this.updateInvestments();
        this.updateAuctions();
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
        document.getElementById('totalProfit').textContent = this.formatCoin(totalProfit);

        // Total Order Worth
        const buyOrders = data['buy-order-overview']['buy-orders'] || [];
        const sellOrders = data['sell-order-overview']['sell-orders'] || [];
        const totalBuyWorth = buyOrders.reduce((sum, order) => {
            return sum + ((order['buying-amount'] || 0) * (order['price-buying'] || 0));
        }, 0);
        const totalSellWorth = sellOrders.reduce((sum, order) => {
            return sum + ((order['total-selling-amount'] || 0) * (order['price-sold'] || 0));
        }, 0);
        document.getElementById('totalOrderWorth').textContent = this.formatCoin(totalBuyWorth + totalSellWorth);

        // Total Items Flipped
        const allProducts = data['all-products'] || {};
        const totalSold = Object.values(allProducts).reduce((sum, p) => sum + (p['total-sold'] || 0), 0);
        document.getElementById('totalFlipped').textContent = this.formatCoin(totalSold);

        // Active Buy Orders
        document.getElementById('activeBuyOrders').textContent = buyOrders.length;

        // Active Sell Orders
        document.getElementById('activeSellOrders').textContent = sellOrders.length;
    }

    updateBazaarSnapshot() {
        const tbody = document.getElementById('bazaarSnapshotBody');
        if (!tbody) return;

        const trackedProducts = Object.keys(this.traderData?.['all-products'] || {})
            .map(name => ({ name, apiName: this.getApiName(name) }))
            .filter(entry => entry.apiName)
            .slice(0, 8);

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
            const buyPrice = quickStatus.buyPrice || 0;
            const sellPrice = quickStatus.sellPrice || 0;
            const spread = Math.abs(sellPrice - buyPrice);

            return `
                <tr>
                    <td>${name}</td>
                    <td>${this.formatCoin(buyPrice)}</td>
                    <td>${this.formatCoin(sellPrice)}</td>
                    <td class="${spread >= 0 ? 'profit-positive' : 'profit-negative'}">${this.formatCoin(spread)}</td>
                    <td>${this.formatCoin(quickStatus.buyVolume || 0)} / ${this.formatCoin(quickStatus.sellVolume || 0)}</td>
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

        tbody.innerHTML = buyOrders.map(order => `
            <tr>
                <td>${order['item-name']}</td>
                <td>${this.formatCoin(order['price-buying'])}</td>
                <td>${this.formatAmount(order['bought-amount'] || 0)} / ${this.formatAmount(order['buying-amount'] || 0)} (${this.formatPercent(order['bought-amount'] || 0, order['buying-amount'] || 0)})</td>
                <td>${this.formatCoin((order['buying-amount'] || 0) * (order['price-buying'] || 0))}</td>
                <td>${this.formatTimestamp(order['buy-order-place-time'])}</td>
                <td>
                    ${order['has-been-claimed'] ? 
                        '<span class="status-badge status-filled">Claimed</span>' :
                        (order['bought-amount'] >= order['buying-amount'] ? '<span class="status-badge status-filled">Filled</span>' : '<span class="status-badge status-pending">Pending</span>')
                    }
                </td>
            </tr>
        `).join('');
    }

    updateSellOrders() {
        const sellOrders = this.traderData['sell-order-overview']['sell-orders'] || [];
        const tbody = document.getElementById('sellOrdersBody');

        if (sellOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty">No sell orders</td></tr>';
            return;
        }

        const rows = [];

        sellOrders.forEach((order, index) => {
            const totalSold = this.getSellOrderSoldAmount(order);
            const totalAmount = order['total-selling-amount'] || 0;
            const orderKey = this.getSellOrderKey(order, index);
            const isOpen = this.openSellOrders.has(orderKey);
            const status = order['has-been-claimed'] ? 'Claimed' : 
                          totalSold === totalAmount ? 'Filled' : 'Active';

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

        tbody.innerHTML = investmentEntries.map(([name, inv]) => {
            const type = shortTermInv[name] ? 'Short-term' : 'Long-term';
            const totalAmount = inv['sub-orders'].reduce((sum, sub) => sum + sub['partial-amount'], 0);
            const avgPrice = inv['sub-orders'].length > 0 ?
                Math.max(...inv['sub-orders'].map(o => o["price-bought"])) : 0;

            return `
                <tr>
                    <td>${name}</td>
                    <td>${type}</td>
                    <td>${totalAmount}</td>
                    <td>${this.formatCoin(avgPrice)}</td>
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
        
        if (amount >= 1000000000) {
            return (amount / 1000000000).toFixed(2) + 'B';
        } else if (amount >= 1000000) {
            return (amount / 1000000).toFixed(2) + 'M';
        } else if (amount >= 1000) {
            return (amount / 1000).toFixed(2) + 'K';
        } else {
            return amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
        }
    }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new TraderDashboard();
});
