import Main from '../server/backend.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const main = new Main();

let pastTradesLogs = [];
let traderData = {};

try {
    const fileContent = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'pastTradesLogs.json'), 'utf8');
    pastTradesLogs = JSON.parse(fileContent);
} catch (error) {
    console.error('Error occurred while processing past trade logs.', error);
}

try {
    const fileContent = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'trader-data-start.json'), 'utf8');
    traderData = JSON.parse(fileContent);
} catch (error) {
    console.error('Error occurred while processing trader data.', error);
}

for (const trade of pastTradesLogs) {
    console.log('Submitting trade:', trade);
    main.submitTrade(trade);
}