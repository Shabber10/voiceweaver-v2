const http = require('http');

const data = JSON.stringify({
    text: "नमस्ते दुनिया", // Hindi text
    voice: "en-US-AriaNeural" // English voice
});

const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/tts-with-timings',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => console.log('BODY:', body.substring(0, 200)));
});

req.on('error', (e) => console.error(`problem with request: ${e.message}`));
req.write(data);
req.end();
