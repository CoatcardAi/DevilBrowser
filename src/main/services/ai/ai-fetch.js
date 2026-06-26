const https = require('https');
const http = require('http');

const AI_BASE = 'https://aimagicbackend.onrender.com';

function aiFetch(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(AI_BASE + apiPath);
    const lib = url.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 30000
    }, (res) => {
      const contentType = res.headers['content-type'] || '';
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode === 200 && contentType.startsWith('image/')) {
          const base64Data = buffer.toString('base64');
          resolve({
            status: res.statusCode,
            body: {
              images: [
                {
                  mimeType: contentType,
                  data: base64Data
                }
              ]
            }
          });
        } else {
          const data = buffer.toString('utf8');
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = {
  AI_BASE,
  aiFetch
};
