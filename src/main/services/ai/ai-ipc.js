const { ipcMain } = require('electron');
const state = require('../../core/state');
const { isAuthorizedSender } = require('../../core/security');
const { aiFetch } = require('./ai-fetch');
const aiAuth = require('./ai-auth');
const aiGeneration = require('./ai-generation');
const aiCredentials = require('./ai-credentials');
const aiHistory = require('./ai-history');
const aiDb = require('./ai-db');

function init() {
  const windowManager = require('../../core/window-manager');
  const tabManager = require('../../core/tab-manager');

  // AI Auth
  ipcMain.handle('ai-login', (e, email) => aiAuth.aiLogin(email));
  ipcMain.handle('ai-verify-otp', (e, { email, otp }) => aiAuth.aiVerifyOtp(email, otp));
  ipcMain.handle('ai-logout', () => aiAuth.aiLogout());
  ipcMain.handle('ai-get-me', () => aiAuth.aiGetMe());
  ipcMain.handle('ai-get-token', () => aiAuth.aiGetToken());

  // AI Quota & Models
  ipcMain.handle('ai-get-quota', () => aiGeneration.getQuota());
  ipcMain.handle('ai-get-models', () => aiGeneration.getModels());

  // AI Generation
  ipcMain.handle('ai-generate', (e, payload) => aiGeneration.generate(payload));
  ipcMain.handle('save-image', (e, { base64Data, defaultFilename }) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    return aiGeneration.saveImage(base64Data, defaultFilename);
  });
  ipcMain.handle('ai-generate-stream', (e, payload) => aiGeneration.generateStream(payload, e.sender));

  // AI Task Logs
  ipcMain.handle('ai-get-logs', async (e, params = {}) => {
    const token = state.store.get('ai-token');
    if (!token) return { logs: [], total: 0 };
    try {
      const qs = new URLSearchParams();
      if (params.limit)  qs.set('limit',  params.limit);
      if (params.skip)   qs.set('skip',   params.skip);
      if (params.status) qs.set('status', params.status);
      if (params.model)  qs.set('model',  params.model);
      const res = await aiFetch('GET', '/v1/logs?' + qs.toString(), null, token);
      return res.body;
    } catch { return { logs: [], total: 0 }; }
  });

  // AI DOM & Page Scraping
  ipcMain.handle('ai-get-page-text', async (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return '';
    const targetId = tabId || winEntry.activeTabId;
    if (!targetId) return '';
    const tab = winEntry.tabs.find(t => t.id === targetId);
    if (!tab) return '';
    try {
      const text = await tab.view.webContents.executeJavaScript(
        `(function(){ return document.body ? document.body.innerText.slice(0, 50000) : ''; })()`
      );
      return text || '';
    } catch { return ''; }
  });

  ipcMain.handle('ai-get-page-dom', async (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return '[]';
    const targetId = tabId || winEntry.activeTabId;
    if (!targetId) return '[]';
    const tab = winEntry.tabs.find(t => t.id === targetId);
    if (!tab) return '[]';
    try {
      const domJSON = await tabManager.executeWithAttachedView(winEntry, tab, async () => {
        return await tab.view.webContents.executeJavaScript(`
          (function() {
            const result = [];
            let currentAiId = 0;

            if (!window.__aiFindElement) {
              window.__aiFindElement = function(id, root = document) {
                if (!id) return null;
                let el = root.querySelector('[data-ai-id="' + id + '"]');
                if (el) return el;
                
                const iframes = Array.from(root.querySelectorAll('iframe'));
                for (const iframe of iframes) {
                  try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    el = window.__aiFindElement(id, iframeDoc);
                    if (el) return el;
                  } catch(e) {}
                }
                
                const all = Array.from(root.querySelectorAll('*'));
                for (const item of all) {
                  if (item.shadowRoot) {
                    el = window.__aiFindElement(id, item.shadowRoot);
                    if (el) return el;
                  }
                }
                return null;
              };
            }

            if (!window.__aiClick) {
              window.__aiClick = function(id) {
                const el = window.__aiFindElement(id);
                if (el) {
                  el.focus();
                  el.click();
                  return true;
                }
                return false;
              };
            }
            if (!window.__aiFill) {
              window.__aiFill = function(id, val) {
                const el = window.__aiFindElement(id);
                if (el) {
                  el.focus();
                  const nativeValueSetter = Object.getOwnPropertyDescriptor(
                    el.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
                    'value'
                  );
                  const tracker = el._valueTracker;

                  // Clear value
                  if (nativeValueSetter && nativeValueSetter.set) {
                    nativeValueSetter.set.call(el, '');
                  } else {
                    el.value = '';
                  }
                  if (tracker) tracker.setValue('');
                  el.dispatchEvent(new Event('input', { bubbles: true }));

                  // Set new value
                  if (nativeValueSetter && nativeValueSetter.set) {
                    nativeValueSetter.set.call(el, val);
                  } else {
                    el.value = val;
                  }
                  if (tracker) tracker.setValue(val);

                  // Dispatch framework events
                  el.dispatchEvent(new Event('keydown', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new Event('keypress', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('keyup', { bubbles: true, cancelable: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('blur', { bubbles: true }));
                  return true;
                }
                return false;
              };
            }
            if (!window.__aiSelect) {
              window.__aiSelect = function(id, val) {
                const el = window.__aiFindElement(id);
                if (el) {
                  el.focus();
                  if (el.tagName.toLowerCase() === 'select') {
                    el.value = val;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                  } else {
                    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                    if (nativeValueSetter && nativeValueSetter.set) {
                      nativeValueSetter.set.call(el, val);
                    } else {
                      el.value = val;
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                  }
                }
                return false;
              };
            }

            function scanElements(doc, parentFrameName = '', offset = { x: 0, y: 0 }) {
              if (!doc) return;
              const els = Array.from(doc.querySelectorAll('input, textarea, select, button, [role="button"], a, [contenteditable="true"], [contenteditable], [role="textbox"]'));
              
              els.forEach((el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                
                if (
                  rect.width <= 0 || rect.height <= 0 ||
                  style.display === 'none' ||
                  style.visibility === 'hidden' ||
                  parseFloat(style.opacity) === 0
                ) {
                  return;
                }
                
                let aiId = el.getAttribute('data-ai-id');
                if (!aiId) {
                  aiId = String(currentAiId++);
                  el.setAttribute('data-ai-id', aiId);
                }
                
                const label = el.labels && el.labels.length > 0 ? el.labels[0].innerText : (el.closest('label') ? el.closest('label').innerText : null);
                const x = Math.round(rect.left + rect.width / 2 + offset.x);
                const y = Math.round(rect.top + rect.height / 2 + offset.y);

                result.push({
                  aiId,
                  tagName: el.tagName.toLowerCase(),
                  type: el.type || el.getAttribute('type') || null,
                  id: el.id || null,
                  name: el.name || el.getAttribute('name') || null,
                  href: el.getAttribute('href') || el.href || null,
                  placeholder: el.placeholder || el.getAttribute('placeholder') || null,
                  labelText: label ? label.trim().slice(0, 100) : null,
                  innerText: (el.innerText || '').trim().slice(0, 100),
                  value: el.value || null,
                  role: el.getAttribute('role') || null,
                  ariaLabel: el.getAttribute('aria-label') || null,
                  frame: parentFrameName || null,
                  rect: {
                    x: Math.round(rect.left + offset.x),
                    y: Math.round(rect.top + offset.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                  },
                  center: { x, y }
                });
              });

              const iframes = Array.from(doc.querySelectorAll('iframe'));
              iframes.forEach((iframe, idx) => {
                try {
                  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                  const name = iframe.name || iframe.id || 'frame_' + idx;
                  const iframeRect = iframe.getBoundingClientRect();
                  const nextOffset = {
                    x: offset.x + iframeRect.left,
                    y: offset.y + iframeRect.top
                  };
                  scanElements(iframeDoc, name, nextOffset);
                } catch (e) {}
              });
              
              const allEls = Array.from(doc.querySelectorAll('*'));
              allEls.forEach(e => {
                if (e.shadowRoot) {
                  scanElements(e.shadowRoot, parentFrameName, offset);
                }
              });
            }

            scanElements(document);
            return JSON.stringify(result);
          })()
        `);
      });
      return domJSON || '[]';
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  });

  // AI Script Exec & CDP Emulation
  ipcMain.handle('ai-execute-page-action', async (e, payload) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return { success: false, error: 'No active window found' };
    
    const script = typeof payload === 'string' ? payload : payload.script;
    const tabId = typeof payload === 'object' ? payload.tabId : null;

    const targetId = tabId || winEntry.activeTabId;
    if (!targetId) return { success: false, error: 'No active tab found' };
    const tab = winEntry.tabs.find(t => t.id === targetId);
    if (!tab) return { success: false, error: 'Tab not found' };
    try {
      const result = await tabManager.executeWithAttachedView(winEntry, tab, async () => {
        return await tab.view.webContents.executeJavaScript(script);
      });
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  const aiAutomation = require('./ai-automation');

  ipcMain.handle('ai-cdp-click', async (e, { tabId, x, y }) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return { success: false, error: 'Window not found' };
    const targetId = tabId || winEntry.activeTabId;
    const tab = winEntry.tabs.find(t => t.id === targetId);
    if (!tab) return { success: false, error: 'Tab not found' };

    try {
      const success = await tabManager.executeWithAttachedView(winEntry, tab, async () => {
        return await aiAutomation.cdpClick(tab.view.webContents, x, y);
      });
      return { success };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ai-cdp-type', async (e, { tabId, text }) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return { success: false, error: 'Window not found' };
    const targetId = tabId || winEntry.activeTabId;
    const tab = winEntry.tabs.find(t => t.id === targetId);
    if (!tab) return { success: false, error: 'Tab not found' };

    try {
      const success = await tabManager.executeWithAttachedView(winEntry, tab, async () => {
        return await aiAutomation.cdpType(tab.view.webContents, text);
      });
      return { success };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ai-cdp-press-key', async (e, { tabId, key }) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return { success: false, error: 'Window not found' };
    const targetId = tabId || winEntry.activeTabId;
    const tab = winEntry.tabs.find(t => t.id === targetId);
    if (!tab) return { success: false, error: 'Tab not found' };

    try {
      const success = await tabManager.executeWithAttachedView(winEntry, tab, async () => {
        return await aiAutomation.cdpPressKey(tab.view.webContents, key);
      });
      return { success };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ai-is-tab-loading', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return false;
    const id = tabId || winEntry.activeTabId;
    const tab = winEntry.tabs.find(t => t.id === id);
    return tab ? tab.loading || tab.view.webContents.isLoading() : false;
  });

  ipcMain.handle('ai-set-worker-tab', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (winEntry) {
      winEntry.workerTabId = tabId;
      if (tabId) {
        const workerTab = winEntry.tabs.find(t => t.id === tabId);
        if (workerTab) {
          try { winEntry.win.addBrowserView(workerTab.view); } catch (err) {}
        }
      }
      tabManager.updateActiveViewBounds(winEntry.win.id);
    }
  });

  // AI Security and File Operations
  ipcMain.handle('ai-save-file', async (e, { filename, content }) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    try {
      const downloadsPath = app.getPath('downloads');
      const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const filePath = path.join(downloadsPath, safeFilename);

      if (!filePath.startsWith(downloadsPath)) {
        return { success: false, error: 'Path traversal detected.' };
      }

      const ext = path.extname(safeFilename).toLowerCase();
      const blockedExtensions = ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.vbe', '.jse', '.wsf', '.wsh', '.msc', '.lnk', '.sh', '.msi', '.com', '.scr', '.hta', '.cpl', '.pif', '.jar', '.sys', '.reg', '.inf'];
      if (blockedExtensions.includes(ext)) {
        return { success: false, error: 'File type blocked for security reasons.' };
      }

      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ai-download-file', async (e, urlStr) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    return new Promise((resolve) => {
      aiDb.downloadUrlToFile(urlStr, resolve);
    });
  });

  ipcMain.handle('ai-save-state', async (e) => {
    try {
      const winEntry = windowManager.getWindowEntry(e.sender);
      if (!winEntry) return { success: false, error: 'No active window' };
      
      const tabStates = winEntry.tabs.map(t => ({
        url: t.url,
        title: t.title
      }));
      
      state.store.set('ai-saved-browser-state', {
        tabs: tabStates,
        activeTabUrl: winEntry.tabs.find(t => t.id === winEntry.activeTabId)?.url || 'about:blank'
      });
      
      return { success: true, savedCount: tabStates.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ai-restore-state', async (e) => {
    try {
      const winEntry = windowManager.getWindowEntry(e.sender);
      if (!winEntry) return { success: false, error: 'No active window' };
      
      const savedState = state.store.get('ai-saved-browser-state');
      if (!savedState || !savedState.tabs || savedState.tabs.length === 0) {
        return { success: false, error: 'No saved state found' };
      }
      
      const originalTabs = [...winEntry.tabs];
      
      const createdTabIds = [];
      for (const t of savedState.tabs) {
        const id = tabManager.createTab(winEntry.win.id, t.url);
        createdTabIds.push(id);
      }
      
      for (const t of originalTabs) {
        tabManager.closeTab(winEntry.win.id, t.id);
      }
      
      if (createdTabIds.length > 0) {
        const activeIdx = savedState.tabs.findIndex(t => t.url === savedState.activeTabUrl);
        const targetTabId = activeIdx !== -1 ? createdTabIds[activeIdx] : createdTabIds[0];
        tabManager.setActiveTab(winEntry.win.id, targetTabId);
      }
      
      return { success: true, restoredCount: createdTabIds.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // AI Document Analysis
  ipcMain.handle('ai-analyse-document', async (e, { filePath, mimeType, name }) => {
    const token = state.store.get('ai-token');
    if (!token) return { error: 'Not authenticated' };
    try {
      const data = fs.readFileSync(filePath).toString('base64');
      const res = await aiFetch('POST', '/v1/generate', {
        prompt: `Please analyse this document called "${name}" and provide a comprehensive summary. Highlight key points, data, and conclusions.`,
        files: [{ mimeType, data, name }]
      }, token);
      return res.body;
    } catch(err) { return { error: err.message }; }
  });

  // AI Tools Marketplace
  ipcMain.handle('ai-get-tools', async (e) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    const token = state.store.get('ai-token');
    if (!token) return { items: [] };
    try {
      const res = await aiFetch('GET', '/v1/tools?limit=100', null, token);
      return res.body;
    } catch { return { items: [] }; }
  });

  ipcMain.handle('ai-download-tool', async (e, { id, filename, type }) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    const token = state.store.get('ai-token');
    if (!token) return { error: 'Not authenticated' };

    return new Promise((resolve) => {
      aiDb.downloadToolToFile(id, filename, token, resolve);
    });
  });

  // AI Semantic Search
  ipcMain.handle('ai-index-page', (e, { url, title, text }) => {
    if (!isAuthorizedSender(e.sender)) return;
    return aiHistory.indexPage({ url, title, text });
  });

  ipcMain.handle('ai-semantic-search', (e, query) => {
    if (!isAuthorizedSender(e.sender)) return [];
    return aiHistory.semanticSearch(query);
  });

  // AI Credentials Vault
  ipcMain.handle('save-credential', (e, { domain, username, password }) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    return aiCredentials.saveCredential({ domain, username, password });
  });

  ipcMain.handle('list-credentials', (e) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    return aiCredentials.listCredentials();
  });

  ipcMain.handle('get-credential', (e, key) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    return aiCredentials.getCredential(key);
  });

  ipcMain.handle('delete-credential', (e, key) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    return aiCredentials.deleteCredential(key);
  });

  // AI Support Tickets
  ipcMain.handle('ai-submit-ticket', (e, payload) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    return aiDb.submitTicket(payload);
  });

  ipcMain.handle('ai-get-tickets', async (e) => {
    if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
    const token = state.store.get('ai-token');
    if (!token) return { success: false, error: 'Not authenticated' };
    try {
      const res = await aiFetch('GET', '/v1/tickets', null, token);
      return res.body;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // AI Context Menu Integration
  ipcMain.on('ai-tab-context-action', (e, data) => {
    for (const entry of state.windows.values()) {
      entry.win.webContents.send('ai-context-action', data);
    }
  });

  ipcMain.on('ai-index-page-from-tab', (e, { url, title, text }) => {
    const tabInfo = tabManager.getTabByWebContents(e.sender);
    if (!tabInfo) return; // unauthorized or not a browser tab
    return aiHistory.indexPage({ url, title, text });
  });

  ipcMain.handle('ai-get-page-screenshot', async (e, tabId) => {
    if (!isAuthorizedSender(e.sender)) return { error: 'Unauthorized IPC access.' };
    let targetTab = null;
    let targetWinEntry = null;
    for (const entry of state.windows.values()) {
      const id = tabId || entry.activeTabId;
      targetTab = entry.tabs.find(t => t.id === id);
      if (targetTab) {
        targetWinEntry = entry;
        break;
      }
    }

    if (!targetTab || !targetTab.view) {
      return { error: 'No tab view found' };
    }

    try {
      const result = await tabManager.executeWithAttachedView(targetWinEntry, targetTab, async () => {
        const image = await targetTab.view.webContents.capturePage();
        return { base64Data: image.toPNG().toString('base64'), success: true };
      });
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('ai-batch-generate', async (e, { prompts, systemInstruction }) => {
    if (!isAuthorizedSender(e.sender)) return { error: 'Unauthorized IPC access.' };
    const token = state.store.get('ai-token');
    if (!token) return { error: 'Not authenticated' };

    try {
      const requests = prompts.map(p => ({ prompt: p }));
      const submitRes = await aiFetch('POST', '/v1/generate/batch', { requests, systemInstruction }, token);
      
      if (!submitRes.body || !submitRes.body.batchId) {
        return { error: 'Failed to submit batch: ' + JSON.stringify(submitRes.body) };
      }

      const batchId = submitRes.body.batchId;
      console.log(`[Batch AI] Submitted batch ${batchId}. Polling queue...`);

      const maxPolls = 60; // 2 minutes max
      for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const pollRes = await aiFetch('GET', `/v1/queue/batch/${batchId}`, null, token);
        
        if (!pollRes.body) continue;
        
        const status = pollRes.body.status;
        if (status === 'completed') {
          return { success: true, results: pollRes.body.results };
        } else if (status === 'failed') {
          return { error: 'Batch execution failed on server' };
        }
        
        console.log(`[Batch AI] Batch ${batchId} status: ${status} (${pollRes.body.completed_requests}/${pollRes.body.total_requests})`);
      }

      return { error: 'Batch request timed out' };
    } catch (err) {
      return { error: err.message };
    }
  });
}

module.exports = {
  init
};
