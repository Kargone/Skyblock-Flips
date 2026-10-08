import Main, { marketData, getVolumeStats } from './backend.mjs';
import { getMayorData } from './mayor.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const main = new Main();

let server = http.createServer(function (request, response) {
    // CORS headers for frontend access from port 8080
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS pre-flight requests
    if (request.method === 'OPTIONS') {
        response.writeHead(200);
        response.end();
        return;
    }

    // API endpoint for trader data
    if (request.url === '/api/trader-data' && request.method === 'GET') {
        response.writeHead(200, { "Content-Type": "application/json" });
        try {
            const fileContent = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'trader-data.json'), 'utf8');
            
            // Check if file is empty
            if (!fileContent || fileContent.trim() === '') {
                throw new Error('File is empty');
            }
            
            const trader_data = JSON.parse(fileContent);
            response.end(JSON.stringify(trader_data));
        } catch (error) {
            console.error('Error reading trader data:', error);
            // Return default empty structure if file is corrupted/empty
            const defaultData = {
                "username": "Kargone",
                "sell-order-overview": { "sell-orders": [] },
                "buy-order-overview": { "buy-orders": [] },
                "short-term-investments": {},
                "long-term-investments": {},
                "auction-house-overview": { "auctions": [] },
                "forge": [],
                "forge-history": [],
                "all-products": {},
                "daily-profits": {}
            };
            response.end(JSON.stringify(defaultData));
        }
        return;
    }

    if (request.url === '/api/market-data' && request.method === 'GET') {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
            bazaarProducts: marketData.bazaarProducts || {},
            lowestBinPrices: marketData.lowestBinPrices || {},
            lastUpdated: marketData.lastUpdated || null,
            volumeStats: getVolumeStats()
        }));
        return;
    }

    // API endpoint for the static product list (display name -> api-name/type/etc)
    // Mayor reminders and the SkyBlock calendar; see mayor.mjs
    if (request.url === '/api/mayor-data' && request.method === 'GET') {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(getMayorData()));
        return;
    }

    if (request.url === '/api/product-list' && request.method === 'GET') {
        response.writeHead(200, { "Content-Type": "application/json" });
        try {
            const fileContent = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'product-list.json'), 'utf8');
            response.end(fileContent);
        } catch (error) {
            console.error('Error reading product list:', error);
            response.end(JSON.stringify({}));
        }
        return;
    }

    // API endpoint for the timestamp of the most recently submitted trade,
    // used by main.py to detect a fresh trade after a period of inactivity
    if (request.url === '/api/last-trade-time' && request.method === 'GET') {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ lastTradeTime: main.lastTradeTime }));
        return;
    }

    // General GET requests
    if (request.method === 'GET') {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("received GET request.");
    }
    // Trade message submissions via POST
    else if (request.method === 'POST') {
        request.on('data', function(data) {
            // console.log('Data: ' + data, typeof data);

            data = JSON.parse(data.toString());

            if (!Array.isArray(data)) {
                main.submitTrade(JSON.stringify(data));
                pastTradesLogs.push(JSON.stringify(data));
            } else {
                for (const value of data) {
                    // console.log('Data value: ' + JSON.stringify(value));
                    pastTradesLogs.push(JSON.stringify(value));
                    main.submitTrade(JSON.stringify(value));
                }
            }

            fs.writeFile(
                path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Testing', 'pastTradesLogs.json'), 
                JSON.stringify(pastTradesLogs, null, 2), 
                function(err) {
                    if (err) {
                        console.error('Error writing pastTradesLogs data file:', err);
                    }
                }
            );
        });
        
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("received POST request.");
    }
    else {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Undefined request.");
    }
});

let pastTradesLogs = [];

try {
    const fileContent = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Testing', 'pastTradesLogs.json'), 'utf8');
    pastTradesLogs = JSON.parse(fileContent);
} catch (error) {
    console.error('Error occurred while processing past trade logs.', error);
}

// try {
//     const fileContent = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'trader-data.json'), 'utf8');
    
//     // Check if file is empty
//     if (!fileContent || fileContent.trim() === '') {
//         throw new Error('File is empty for the past');
//     }
    
//     const trader_data = JSON.parse(fileContent);
//     fs.writeFile(
//         path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Testing', 'trader-data-start.json'),
//         JSON.stringify(trader_data, null, 2), 
//         function(err) {
//             if (err) {
//                 console.error('Error writing start trader data file:', err);
//             }
//         }
//     );
// } catch (error) {
//     console.error('Error reading trader data for the past:', error);
//     // Return default empty structure if file is corrupted/empty
//     const defaultData = {
//         "username": "Kargone",
//         "sell-order-overview": { "sell-orders": [] },
//         "buy-order-overview": { "buy-orders": [] },
//         "short-term-investments": {},
//         "long-term-investments": {},
//         "auction-house-overview": { "auctions": [] },
//         "forge": [],
//         "all-products": {},
//         "daily-profits": {}
//     };
// }


server.listen(8000);
console.log("Server running on port 8000");

// make sure that the trader-data.json will update, and that localhost can access the dashboard.