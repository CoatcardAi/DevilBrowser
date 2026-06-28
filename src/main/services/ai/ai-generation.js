const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const state = require('../../core/state');
const { aiFetch, AI_BASE } = require('./ai-fetch');
const downloadService = require('../downloads/download-service');

let mammoth;
try {
  mammoth = require('mammoth');
} catch (e) {
  console.error("Failed to load mammoth parser:", e);
}

async function getQuota() {
  const token = state.store.get('ai-token');
  if (!token) return null;
  try {
    const res = await aiFetch('GET', '/v1/quota', null, token);
    return res.body;
  } catch { return null; }
}

async function getModels() {
  const token = state.store.get('ai-token');
  if (!token) return { models: [] };
  try {
    const res = await aiFetch('GET', '/v1/models/available', null, token);
    return res.body;
  } catch { return { models: [] }; }
}

async function preparePayloadFiles(payload) {
  if (payload && Array.isArray(payload.files)) {
    const textAttachments = [];
    const validFiles = [];

    for (const file of payload.files) {
      if (file.path) {
        try {
          if (fs.existsSync(file.path)) {
            const ext = path.extname(file.path).toLowerCase().replace('.', '');
            if (ext === 'docx') {
              if (mammoth) {
                const result = await mammoth.extractRawText({ path: file.path });
                textAttachments.push(`[Attached Document Content: ${file.name}]\n${result.value}\n`);
              } else {
                textAttachments.push(`[Attached Document Content: ${file.name}]\n(Mammoth parser unavailable. Could not parse DOCX.)\n`);
              }
            } else if (ext === 'doc') {
              textAttachments.push(`[Attached Document Content: ${file.name}]\n(Binary DOC file contents could not be parsed locally. Please convert to DOCX.)\n`);
            } else {
              const base64Data = fs.readFileSync(file.path).toString('base64');
              validFiles.push({
                mimeType: file.mimeType,
                name: file.name,
                data: base64Data
              });
            }
          } else {
            console.error(`File path does not exist: ${file.path}`);
          }
        } catch (err) {
          console.error(`Failed to read file for AI generation: ${file.path}`, err);
        }
      } else {
        validFiles.push(file);
      }
    }

    payload.files = validFiles;
    if (textAttachments.length > 0) {
      payload.prompt = textAttachments.join('\n') + '\n' + (payload.prompt || '');
    }
  }
}

async function generate(payload) {
  const token = state.store.get('ai-token');
  if (!token) return { error: 'Not authenticated' };
  try {
    await preparePayloadFiles(payload);
    const res = await aiFetch('POST', '/v1/generate', payload, token);
    if (res.status === 401) { state.store.delete('ai-token'); return { error: '401' }; }
    return res.body;
  } catch(err) { return { error: err.message }; }
}

async function saveImage(base64Data, defaultFilename) {
  try {
    const downloadDir = state.store.get('downloadDirectory') || app.getPath('downloads');
    const safeFilename = (defaultFilename || 'generated-image.png').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = downloadService.getUniqueSavePath(downloadDir, safeFilename);

    const cleanData = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanData, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath, filename: path.basename(filePath) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function generateStream(payload, sender) {
  const token = state.store.get('ai-token');
  if (!token) {
    sender.send('ai-stream-error', 'Not authenticated');
    return;
  }

  await preparePayloadFiles(payload);
  let streamDone = false;

  const url = new URL(AI_BASE + '/v1/generate/stream');
  const lib = url.protocol === 'https:' ? https : http;
  const bodyStr = JSON.stringify(payload);

  const req = lib.request({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'Authorization': 'Bearer ' + token,
      'Accept': 'text/event-stream'
    },
    timeout: 120000
  }, (res) => {
    if (res.statusCode === 401) {
      state.store.delete('ai-token');
      sender.send('ai-stream-error', '401 session expired');
      return;
    }
    if (res.statusCode !== 200) {
      let errData = '';
      res.on('data', c => errData += c);
      res.on('end', () => sender.send('ai-stream-error', errData || `HTTP ${res.statusCode}`));
      return;
    }

    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') {
          if (!streamDone) {
            streamDone = true;
            sender.send('ai-stream-done');
          }
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) sender.send('ai-stream-chunk', text);
          if (parsed?.error) sender.send('ai-stream-error', parsed.error);
        } catch {}
      }
    });
    res.on('end', () => {
      if (!streamDone) {
        streamDone = true;
        sender.send('ai-stream-done');
      }
    });
    res.on('error', (err) => sender.send('ai-stream-error', err.message));
  });

  req.on('error', (err) => sender.send('ai-stream-error', err.message));
  req.on('timeout', () => { req.destroy(); sender.send('ai-stream-error', 'Stream timed out'); });
  req.write(bodyStr);
  req.end();
}

module.exports = {
  getQuota,
  getModels,
  generate,
  saveImage,
  generateStream
};
