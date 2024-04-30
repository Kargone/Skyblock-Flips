// Import the functions you need from the SDKs you need
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js'
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDrWRQ8CY4Saxuyuyq0Gh8Px6e1tIH0zFg",
    authDomain: "skyblock-flips.firebaseapp.com",
    projectId: "skyblock-flips",
    storageBucket: "skyblock-flips.appspot.com",
    messagingSenderId: "574210914225",
    appId: "1:574210914225:web:d1d543d3d2867edb4aaf90"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

class Main {
    constructor() {
        this.listenForTrades();
    }
    listenForTrades() {

    }
}

// finds the index of a substring in a string
// then returns the end of the substring within the string
// instead of the start of the substring
function findEnd(string, substring) {
    return string.indexOf(substring) + substring.length;
}

class ProcesTrade {
    constructor(trade_message) {
        this.message = trade_message;
        this.messageArray = this.message.split('');
        // determine message type
        if (this.message.includes('[Bazaar] Bought')) {
            this.type = "insta-buy";
            const amount_string_start = findEnd(this.message, 'Bought ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'for ');
            const price_string_end = this.message.indexOf(' coins')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' for');
            this.instaBuy(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Sold')) {
            this.type = "insta-sell";
            const amount_string_start = findEnd(this.message, 'Sold ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'for ');
            const price_string_end = this.message.indexOf(' coins')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' for');
            this.instaSell(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Buy Order Setup!')) {
            this.type = "buy-order-setup";
            const amount_string_start = findEnd(this.message, 'Setup! ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'for ');
            const price_string_end = this.message.indexOf(' coins')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' for');
            this.buyOrderSetup(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Your Buy Order for')) {
            this.type = "buy-order-fill";
            const amount_string_start = findEnd(this.message, 'for ');
            const amount_string_end = this.message.indexOf('x');
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' was');
            this.buyOrderFill(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Claimed') &&
                   this.message.includes('bought for')) {
            this.type = "buy-order-claim";
            const amount_string_start = findEnd(this.message, 'Claimed ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'bought for ');
            const price_string_end = this.message.indexOf(' each!')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' worth');
            this.buyOrderClaim(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Sell Offer Setup!')) {
            this.type = "sell-order-setup";
            const amount_string_start = findEnd(this.message, 'Setup! ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'for ');
            const price_string_end = this.message.indexOf(' coins')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' for');
            this.sellOrderSetup(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Your Sell Offer for')) {
            this.type = "sell-order-fill";
            const amount_string_start = findEnd(this.message, 'for ');
            const amount_string_end = this.message.indexOf('x');
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' was');
            this.sellOrderFill(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('[Bazaar] Claimed') &&
                   this.message.includes('from selling')) {
            this.type = "sell-order-claim";
            const amount_string_start = findEnd(this.message, 'selling ');
            const amount_string_end = this.message.indexOf('x');
            const price_string_start = findEnd(this.message, 'at ');
            const price_string_end = this.message.indexOf(' each!')
            const name_string_start = findEnd(this.message, 'x ');
            const name_string_end = this.message.indexOf(' at ');
            this.sellOrderClaim(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('You sold')) {
            this.type = "npc-sell";
            const amount_string_start = findEnd(this.message, ' x');
            const amount_string_end = this.message.indexOf(' for');
            const price_string_start = findEnd(this.message, ' for ');
            const price_string_end = this.message.indexOf(' Coins!')
            const name_string_start = findEnd(this.message, 'sold ');
            const name_string_end = this.message.indexOf(' x');
            this.npcSell(
                parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                parseFloat(this.message.slice(price_string_start, price_string_end))/parseInt(this.message.slice(amount_string_start, amount_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('created a BIN auction for')) {
            this.type = "auction-creation";
            const price_string_start = findEnd(this.message, 'at ');
            const price_string_end = this.message.indexOf(' coins!')
            const name_string_start = findEnd(this.message, 'for ');
            const name_string_end = this.message.indexOf(' at');
            this.auctionCreation(
                parseInt(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('You collected')) {
            this.type = "auction-claim";
            const price_string_start = findEnd(this.message, 'collected ');
            const price_string_end = this.message.indexOf(' coins ')
            const name_string_start = findEnd(this.message, 'selling ');
            const name_string_end = this.message.indexOf(' to ');
            this.auctionClaim(
                parseInt(this.message.slice(price_string_start, price_string_end).replaceAll(',', '')),
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('You cancelled your auction for')) {
            this.type = "auction-cancel";
            const name_string_start = findEnd(this.message, 'for ');
            const name_string_end = this.message.indexOf('!');
            this.auctionCancel(
                this.message.slice(name_string_start, name_string_end)
            );
        } else if (this.message.includes('You Supercrafted')) {
            this.type = "supercraft";
            const name_string_start = findEnd(this.message, 'Supercrafted ');
            const name_string_end = this.message.indexOf('!');
            this.supercraft(
                this.message.slice(name_string_start, name_string_end)
            );
        } else {
            throw 'Error: Invalid trade message.';
        }
        return 'Completed trade mesage';
    }
    instaBuy(amount, price, name) {

    }
    instaSell(amount, price, name) {
        
    }
    buyOrderSetup(amount, price, name) {
        
    }
    buyOrderFill(price, name) {
        
    }
    buyOrderClaim(amount, price, name) {
    }
    sellOrderSetup(amount, price, name) {
        
    }
    sellOrderFill(price, name) {
        
    }
    sellOrderClaim(amount, price, name) {
        
    }
    npcSell(amount, price, name) {
        
    }
    auctionCreation(price, name) {
        
    }
    auctionClaim(price, name) {
        
    }
    auctionCancel(name) {
        
    }
    supercraft(name) {

    }
}

new ProcesTrade('[Bazaar] Bought 1,000x Carrot for 123.1 coins!');