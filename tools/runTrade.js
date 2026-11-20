// Posts trade messages typed at the prompt to the backend, one at a time.
//
//   node runTrade.js
//
// Paste either a logged message from pastTradesLogs.json (old or new format) or
// just the chat line, e.g.  [Bazaar] Bought 64x Wheat for 150 coins!
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function runPrompt() {
    const rl = readline.createInterface({ input, output });
    let tradeMessage = (await rl.question('Trade message: ')).trim();
    rl.close();

    // A message copied out of the log comes with its quotes escaped.
    tradeMessage = tradeMessage.replace(/\\/g, '');

    // Anything that is not JSON is taken as the chat line itself.
    const body = /^[[{]/.test(tradeMessage) ? tradeMessage : JSON.stringify({ type: 'chat', text: tradeMessage });

    console.log(`Processing trade message: ${body}`);
    await runTrade(body);
    runPrompt();
}

async function runTrade(body) {
    const response = await fetch('http://localhost:8000/trades', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body
    });
    console.log(response.statusText);
}

runPrompt();
