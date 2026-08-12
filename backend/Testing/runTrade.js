// create a file that sends a post request to the backend with the trade data and logs the response
// import fetch from 'node:fetch';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function runPrompt() {
    // 1. Create the interface linked to terminal input/output
    const rl = readline.createInterface({ input, output });

    // 2. Ask the question and wait for the user to hit Enter
    let tradeMessage = await rl.question('Trade message: ');

    // take out all of the "\" from the message and replace them with nothing
    tradeMessage = "[" + tradeMessage.replace(/\\/g, '') + "]";

    // 3. Use the inputs
    console.log(`Processing trade message: ${tradeMessage}`);

    // 4. Always close the interface when done, or the program will hang
    rl.close();

    await runTrade(tradeMessage);
    runPrompt();
}

async function runTrade(tradeMessage) {
    const response = await fetch('http://localhost:8000/trades', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: tradeMessage
    });
    const result = await response;
    console.log(result.statusText);
}

runPrompt();