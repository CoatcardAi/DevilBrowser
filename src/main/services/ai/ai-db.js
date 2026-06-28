const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { AI_BASE } = require('./ai-fetch');

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.vbe', '.jse', '.wsf', '.wsh', '.msc', '.lnk', '.sh', '.msi', '.com', '.scr', '.hta', '.cpl', '.pif', '.jar', '.sys', '.reg', '.inf'];

function downloadUrlToFile(urlStr, resolve) {
  try {
    const url = new URL(urlStr);
    let filename = path.basename(url.pathname) || 'downloaded_file';
    if (!filename.includes('.')) {
      filename += '.pdf';
    }
    const downloadsPath = app.getPath('downloads');
    
    // Sanitize filename to prevent directory traversal
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = path.join(downloadsPath, safeFilename);

    if (!filePath.startsWith(downloadsPath)) {
      resolve({ success: false, error: 'Path traversal detected.' });
      return;
    }

    // Security check: Block executable/script files
    const ext = path.extname(safeFilename).toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      resolve({ success: false, error: 'File type blocked for security reasons.' });
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(filePath);
    const req = lib.get(urlStr, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        let redirectUrl = res.headers.location;
        try {
          redirectUrl = new URL(redirectUrl, urlStr).toString();
        } catch (e) {}
        file.on('close', () => {
          try { fs.unlinkSync(filePath); } catch(e){}
          downloadUrlToFile(redirectUrl, resolve);
        });
        file.close();
        return;
      }
      if (res.statusCode !== 200) {
        file.on('close', () => {
          try { fs.unlinkSync(filePath); } catch(e){}
          resolve({ success: false, error: `HTTP status ${res.statusCode}` });
        });
        file.close();
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve({ success: true, filePath, filename: safeFilename });
      });
      file.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  } catch (err) {
    resolve({ success: false, error: err.message });
  }
}

function downloadToolToFile(toolId, filename, token, resolve) {
  try {
    const urlStr = `${AI_BASE}/v1/tools/${toolId}/download`;
    const url = new URL(urlStr);
    const downloadsPath = app.getPath('downloads');
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = path.join(downloadsPath, safeFilename);

    if (!filePath.startsWith(downloadsPath)) {
      resolve({ success: false, error: 'Path traversal detected.' });
      return;
    }

    // Security check: Block executable/script files
    const ext = path.extname(safeFilename).toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      resolve({ success: false, error: 'File type blocked for security reasons.' });
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const headers = {
      'Authorization': 'Bearer ' + token
    };

    const req = lib.get({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      headers
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        let redirectUrl = res.headers.location;
        try {
          redirectUrl = new URL(redirectUrl, urlStr).toString();
        } catch (e) {}
        downloadUrlToFile(redirectUrl, resolve);
        return;
      }
      if (res.statusCode !== 200) {
        resolve({ success: false, error: `HTTP status ${res.statusCode}` });
        return;
      }

      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve({ success: true, filePath, filename: safeFilename });
      });
      file.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  } catch (err) {
    resolve({ success: false, error: err.message });
  }
}

function submitTicket({ subject, description, priority, screenshotBase64 }, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(AI_BASE + '/v1/tickets');
    const lib = url.protocol === 'https:' ? https : http;
    const boundary = '----DevilBrowserBoundary' + Math.random().toString(36).substr(2, 9);
    
    const parts = [];

    // Subject
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\n${subject}\r\n`));

    // Description
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}\r\n`));

    // Priority
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="priority"\r\n\r\n${priority || 'medium'}\r\n`));

    // Screenshot (optional)
    if (screenshotBase64) {
      const cleanBase64 = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(cleanBase64, 'base64');
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="screenshot"; filename="screenshot.png"\r\nContent-Type: image/png\r\n\r\n`));
      parts.push(imgBuffer);
      parts.push(Buffer.from('\r\n'));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const bodyBuffer = Buffer.concat(parts);

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': bodyBuffer.length
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers,
      timeout: 30000
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

module.exports = {
  downloadUrlToFile,
  downloadToolToFile,
  submitTicket
};
