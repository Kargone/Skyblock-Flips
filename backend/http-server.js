import Main from './backend.mjs';
import http from 'node:http';

const main = new Main();

let server = http.createServer(function (request, response) {
    response.writeHead(200, { "Content-Type": "text\plain" });
    if (request.method == "GET") {
        response.end("received GET request.")
    }
    else if (request.method == "POST") {
        request.on('data', function(data) {
            console.log('Data: ' + data);

            main.submitTrade(data.toString());
        });
        response.end("received POST request.");
    }
    else {
        response.end("Undefined request .");
    }
});

server.listen(8000);
console.log("Server running on port 8000");