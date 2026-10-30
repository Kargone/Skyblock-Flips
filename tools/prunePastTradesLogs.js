// Trims pastTradesLogs.json down to its last 1000 trades, keeping a copy of the
// full file in pastTradesLogs.backup.json first.
//
//   node prunePastTradesLogs.js
//
// The backend keeps these logs in memory and writes them all back out on every
// trade, so it has to be stopped first or the next trade undoes the prune.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP = 1000;
const SERVER_URL = 'http://localhost:8000';
const testingDir = path.dirname(fileURLToPath(import.meta.url));
const logsPath = path.join(testingDir, '..', 'data', 'pastTradesLogs.json');
const backupPath = path.join(testingDir, '..', 'data', 'pastTradesLogs.backup.json');

async function serverIsRunning() {
    try {
        await fetch(`${SERVER_URL}/api/last-trade-time`, { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

async function main() {
    if (await serverIsRunning()) {
        console.error('The backend is running. Stop it first, or it will write the full logs back on the next trade.');
        process.exitCode = 1;
        return;
    }

    const logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
    if (logs.length <= KEEP) {
        console.log(`Only ${logs.length} trades logged, nothing to prune.`);
        return;
    }

    fs.copyFileSync(logsPath, backupPath);
    fs.writeFileSync(logsPath, JSON.stringify(logs.slice(-KEEP), null, 2));
    console.log(`Pruned ${logs.length} trades down to the last ${KEEP}. Full copy kept in pastTradesLogs.backup.json.`);
}

main().catch(error => console.error('Error pruning trade logs:', error));
