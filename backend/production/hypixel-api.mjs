// Every request to api.hypixel.net goes through fetchHypixel, so that one 403
// pauses all of them. A 403 (not a 429) that clears on its own after a while is
// Hypixel's Cloudflare front end blocking this IP; requests sent while blocked
// fail anyway, and may only keep the block going.

const PAUSE_AFTER_403_MS = 15 * 60 * 1000;

let pausedUntil = 0;

// True while requests are paused after a 403.
export function hypixelPaused() {
    return Date.now() < pausedUntil;
}

// fetch() for api.hypixel.net. Resolves to null without sending anything while
// paused, so callers just skip this round.
export async function fetchHypixel(url) {
    if (hypixelPaused()) return null;

    const response = await fetch(url);
    if (response.status === 403) {
        // Requests already in flight can 403 too; only the first one logs.
        if (!hypixelPaused()) {
            pausedUntil = Date.now() + PAUSE_AFTER_403_MS;
            const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
            console.error(`Hypixel API returned 403 Forbidden for ${url}; pausing all Hypixel requests for `
                + `${PAUSE_AFTER_403_MS / 60000}m, until ${new Date(pausedUntil).toLocaleTimeString()}. `
                + `server=${response.headers.get('server')} cf-ray=${response.headers.get('cf-ray')} body: ${body}`);
        }
        return null;
    }
    return response;
}
