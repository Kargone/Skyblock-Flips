const http = require('node:http');

const option = {
    hostname: "localhost",
    port: 8000,
    method: "POST",
    headers: {
        "Content-type": "text/plain"
    },
    path: "/"
}

let request = http.request(option, function (res) {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
    res.on('end', () => {
        console.log('No more data in response.');
    });
});

request.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

request.write("[Bazaar] Cancelled! Refunded 197x Gold Magmafish from cancelling Sell Offer!");
request.end();