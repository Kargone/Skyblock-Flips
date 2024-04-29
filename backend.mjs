// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
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
    processTrade(trade_message) {

    }
}

class Trade {
    constructor(trade_message) {

    }
    instaBuy(amount, price, name) {

    }
    instaSell(amount, price, name) {

    }
    buyOrderSetup(amount, price, name) {

    }
    sellOrderSetup(amount, price, name) {

    }
    
}