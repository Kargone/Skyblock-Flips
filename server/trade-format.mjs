// The messages the mod posts to the server, one object each (or an array of them):
//
//   { "type": "chat", "time": <ms>, "text": "[Bazaar] Bought 64x Wheat for 150 coins!" }
//   { "type": "forge-snapshot", "time": <ms>, "slots": [ ... ] }   (see backend.mjs)
//
// time is when the message showed up in game. The server fills it in with the
// time it arrived when it is missing, so every logged message has one.
//
// Older entries in pastTradesLogs.json are { "plainText", "fullJson", "detectedRarity" }
// with colour codes still in the text. They are turned into the chat shape here,
// so old logs can still be replayed.

// A colour code is a marker plus one character. The marker is § or, when the mod's
// text went through the wrong encoding, the replacement character.
const COLOUR_CODE = /[§�]./g;

export function stripColourCodes(text) {
    return String(text ?? '').replace(COLOUR_CODE, '');
}

// Takes a message as posted or logged (an object or its JSON) and returns it in
// the current shape. Throws on anything it does not recognise.
export function toTradeMessage(entry) {
    if (typeof entry === 'string') entry = JSON.parse(entry);
    if (Array.isArray(entry) && entry.length === 1) entry = entry[0];

    if (entry?.type === 'chat' && typeof entry.text === 'string') {
        return { ...entry, text: stripColourCodes(entry.text) };
    }
    if (entry?.type === 'forge-snapshot') return entry;
    if (!entry?.type && typeof entry?.plainText === 'string') {
        return { type: 'chat', text: stripColourCodes(entry.plainText) };
    }
    throw new Error(`Unrecognised trade message: ${JSON.stringify(entry)}`);
}
