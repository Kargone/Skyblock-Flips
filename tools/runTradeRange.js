// Replays the trades in pastTradesLogs.json between two indices (both included)
// whose message mentions an item, by posting them to the backend one at a time.
//
//   node runTradeRange.js <start> <stop> <item name>
//   node runTradeRange.js 6555 6700 Enchanted Gold Block
//   node runTradeRange.js 6555 end Enchanted Gold Block
//
// Anything left off is asked for. The backend logs every trade it receives, so the
// replayed trades are added to the end of pastTradesLogs.json again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SERVER_URL = 'http://localhost:8000';
const logsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'pastTradesLogs.json');

async function main() {
    const rl = readline.createInterface({ input, output });
    const args = process.argv.slice(2);

    const logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));

    const start = parseInt(args[0] ?? await rl.question('Start index: '), 10);
    // "end" (or nothing, at the prompt) runs through to the last logged trade.
    const stopInput = (args[1] ?? await rl.question('Stop index (blank or "end" for the last trade): ')).trim();
    const stop = stopInput === '' || stopInput.toLowerCase() === 'end' ? logs.length - 1 : parseInt(stopInput, 10);
    const itemName = (args.length > 2 ? args.slice(2).join(' ') : await rl.question('Item name: ')).trim();

    if (Number.isNaN(start) || Number.isNaN(stop) || start < 0 || stop < start || !itemName) {
        console.error('Need a start index, a stop index no lower than it, and an item name.');
        rl.close();
        return;
    }

    const lowerName = itemName.toLowerCase();
    const matches = [];
    for (let index = start; index <= Math.min(stop, logs.length - 1); index++) {
        let plainText;
        try {
            plainText = JSON.parse(logs[index]).plainText;
        } catch {
            continue;
        }
        if (plainText && plainText.toLowerCase().includes(lowerName)) {
            matches.push({ index, trade: logs[index], plainText });
        }
    }

    for (const match of matches) console.log(`${match.index}: ${match.plainText}`);
    if (matches.length === 0) {
        console.log(`No trades mentioning "${itemName}" between ${start} and ${stop} (log has ${logs.length}).`);
        rl.close();
        return;
    }

    const answer = await rl.question(`Run these ${matches.length} trades? (y/n) `);
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') return;

    for (const match of matches) {
        await runTrade(match.trade);
        console.log(`Ran ${match.index}`);
    }
    console.log(`Done, ran ${matches.length} trades.`);
}

async function runTrade(tradeMessage) {
    const response = await fetch(`${SERVER_URL}/trades`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: tradeMessage
    });
    if (!response.ok) throw new Error(`Server answered ${response.status} ${response.statusText}`);
}

main().catch(error => console.error('Error replaying trades:', error));
