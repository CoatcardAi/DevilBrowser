const { app, BrowserView, Menu, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const state = require('./state');
const windowManager = require('./window-manager');

function getTabByWebContents(sender) {
  for (const entry of state.windows.values()) {
    const tab = entry.tabs.find(t => t.view.webContents === sender);
    if (tab) return { tab, windowEntry: entry };
  }
  return null;
}

function updateActiveViewBounds(winId) {
  const data = state.windows.get(winId);
  if (!data || !data.activeTabId) return;
  
  const activeTab = data.tabs.find(t => t.id === data.activeTabId);
  if (!activeTab) return;

  const bounds = data.win.getContentBounds();
  const topOffset = data.toolbarHeight || 86;
  const rightOffset = data.rightMargin || 0;
  
  if (activeTab.url === 'about:blank' || data.viewsHidden) {
    try {
      data.win.removeBrowserView(activeTab.view);
    } catch (e) {}
  } else {
    try {
      data.win.addBrowserView(activeTab.view);
    } catch (e) {}
    
    const bottomOffset = 26; // statusbar height
    activeTab.view.setBounds({
      x: 0,
      y: topOffset,
      width: bounds.width - rightOffset,
      height: Math.max(0, bounds.height - topOffset - bottomOffset)
    });
  }

  // Position worker tab off-screen if it exists and is not the active tab
  if (data.workerTabId && data.workerTabId !== data.activeTabId) {
    const workerTab = data.tabs.find(t => t.id === data.workerTabId);
    if (workerTab) {
      try {
        data.win.addBrowserView(workerTab.view);
      } catch (e) {}
      workerTab.view.setBounds({ x: -2500, y: -2500, width: 1024, height: 768 });
    }
  }
}

async function executeWithAttachedView(winEntry, tab, fn) {
  if (!winEntry || !tab || !tab.view) return await fn();
  const win = winEntry.win;
  const isAttached = win.getBrowserViews().includes(tab.view);
  if (!isAttached) {
    try {
      win.addBrowserView(tab.view);
      tab.view.setBounds({ x: -2000, y: -2000, width: 1024, height: 768 });
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error('Failed to temporarily attach BrowerView:', e);
    }
  }
  try {
    return await fn();
  } finally {
    if (!isAttached) {
      try {
        win.removeBrowserView(tab.view);
      } catch (e) {}
    }
  }
}

function sanitizeUrl(url) {
  let targetUrl = (url || '').trim();
  if (!targetUrl || targetUrl === 'about:blank') return 'about:blank';

  if (targetUrl.startsWith('view-source:')) {
    const originalUrl = targetUrl.replace('view-source:', '');
    return `file:///${path.join(app.getAppPath(), 'src', 'renderer', 'view-source.html').replace(/\\/g, '/')}?url=${encodeURIComponent(originalUrl)}`;
  }
  
  if (targetUrl.startsWith('ipfs://')) {
    const cid = targetUrl.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${cid}`;
  }

  if (targetUrl.startsWith('magnet:?')) {
    return `file:///${path.join(app.getAppPath(), 'src', 'renderer', 'security-warning.html').replace(/\\/g, '/')}?type=torrent&url=${encodeURIComponent(targetUrl)}`;
  }
  
  if (!/^https?:\/\//i.test(targetUrl) && !/^about:/i.test(targetUrl) && !targetUrl.startsWith('file:///')) {
    if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
      targetUrl = 'https://' + targetUrl;
    } else {
      targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
    }
  }
  return targetUrl;
}

function setupTabWebContentsHandlers(winId, tabEntry) {
  const data = state.windows.get(winId);
  if (!data) return;
  const view = tabEntry.view;
  const tabId = tabEntry.id;

  // Context menu for tab webContents
  view.webContents.on('context-menu', (event, params) => {
    const windowManager = require('./window-manager');
    const menuTemplate = [];

    menuTemplate.push({
      label: 'Back',
      enabled: view.webContents.canGoBack(),
      click: () => view.webContents.goBack()
    });
    menuTemplate.push({
      label: 'Forward',
      enabled: view.webContents.canGoForward(),
      click: () => view.webContents.goForward()
    });
    menuTemplate.push({
      label: 'Reload',
      click: () => view.webContents.reload()
    });
    menuTemplate.push({ type: 'separator' });

    if (params.linkURL) {
      menuTemplate.push({
        label: 'Open Link in New Tab',
        click: () => {
          createTab(winId, params.linkURL);
        }
      });
      menuTemplate.push({
        label: 'Open Link in Background Tab',
        click: () => {
          const newTabId = createTab(winId, params.linkURL);
          if (newTabId) {
            // Re-activate current tab to push the new tab to background
            setActiveTab(winId, tabId);
          }
        }
      });
      menuTemplate.push({
        label: 'Copy Link Address',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.linkURL);
        }
      });
      menuTemplate.push({ type: 'separator' });
    }

    if (params.mediaType === 'image') {
      menuTemplate.push({
        label: '✨ Analyze Image with AI',
        click: () => {
          view.webContents.send('ai-context-menu-trigger', 'analyse-image');
        }
      });
      menuTemplate.push({
        label: 'Copy Image Address',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.srcURL);
        }
      });
      menuTemplate.push({ type: 'separator' });
    }

    const hasSelection = params.selectionText && params.selectionText.trim() !== '';
    if (hasSelection) {
      menuTemplate.push({
        label: '✨ AI Explain Text',
        click: () => {
          view.webContents.send('ai-context-menu-trigger', 'explain');
        }
      });
      menuTemplate.push({
        label: '✨ AI Summarise Selection',
        click: () => {
          view.webContents.send('ai-context-menu-trigger', 'shorten');
        }
      });
      menuTemplate.push({
        label: '✨ AI Translate to Hindi/English',
        click: () => {
          view.webContents.send('ai-context-menu-trigger', 'translate');
        }
      });
      menuTemplate.push({
        label: '✨ AI Improve Style',
        click: () => {
          view.webContents.send('ai-context-menu-trigger', 'improve');
        }
      });
      menuTemplate.push({ type: 'separator' });

      menuTemplate.push({ role: 'copy' });
      menuTemplate.push({ role: 'selectAll' });
    } else {
      if (params.isEditable) {
        menuTemplate.push({ role: 'undo' });
        menuTemplate.push({ role: 'redo' });
        menuTemplate.push({ type: 'separator' });
        menuTemplate.push({ role: 'cut' });
        menuTemplate.push({ role: 'copy' });
        menuTemplate.push({ role: 'paste' });
        menuTemplate.push({ role: 'selectAll' });
      } else {
        menuTemplate.push({
          label: '✨ Summarise Whole Page',
          click: () => {
            data.win.webContents.send('ai-context-action', { action: 'chat', text: 'Please summarise the content of this page in 5 bullet points.' });
          }
        });
        menuTemplate.push({
          label: '✨ Extract Data from Page',
          click: () => {
            data.win.webContents.send('ai-context-action', { action: 'chat', text: 'Please extract all structured data from this page: tables, prices, emails, phone numbers, addresses. Format as a clean list.' });
          }
        });
        menuTemplate.push({
          label: '✨ Auto-Fill Forms on Page',
          click: () => {
            data.win.webContents.send('ai-context-action', { action: 'chat', text: 'Please find all input fields and forms on this page and fill them using my persona profile.' });
          }
        });
        menuTemplate.push({ type: 'separator' });
        menuTemplate.push({ role: 'selectAll' });
      }
    }

    menuTemplate.push({ type: 'separator' });
    menuTemplate.push({
      label: 'Inspect Element',
      click: () => {
        view.webContents.inspectElement(params.x, params.y);
      }
    });

    const menu = Menu.buildFromTemplate(menuTemplate);
    menu.popup({ window: data.win });
  });

  // Event listeners for tab updates
  view.webContents.on('did-start-loading', () => {
    const adBlocker = require('./ad-blocker');
    adBlocker.clearBlockedStats(view.webContents.id);
    tabEntry.loading = true;
    tabEntry.loadStartTime = Date.now();
    data.win.webContents.send('tab-metadata-updated', { id: tabId, loading: true, blockedCount: 0 });
  });

  view.webContents.on('did-stop-loading', () => {
    tabEntry.loading = false;
    const duration = tabEntry.loadStartTime ? (Date.now() - tabEntry.loadStartTime) : 0;
    data.win.webContents.send('tab-metadata-updated', { id: tabId, loading: false, loadDuration: duration });
  });

  view.webContents.on('page-title-updated', (e, title) => {
    tabEntry.title = title;
    data.win.webContents.send('tab-metadata-updated', { id: tabId, title });
  });

  view.webContents.on('page-favicons-updated', (e, favicons) => {
    if (favicons && favicons.length > 0) {
      data.win.webContents.send('tab-metadata-updated', { id: tabId, favicon: favicons[0] });
    }
  });

  const updateNavigationState = () => {
    const currentUrl = view.webContents.getURL();
    tabEntry.url = currentUrl;
    tabEntry.canGoBack = view.webContents.canGoBack();
    tabEntry.canGoForward = view.webContents.canGoForward();
    
    // Zoom persistence
    try {
      if (currentUrl && currentUrl !== 'about:blank') {
        const domain = new URL(currentUrl).hostname.toLowerCase();
        const savedZoom = state.store.get(`zoom_levels.${domain}`);
        if (savedZoom !== undefined) {
          view.webContents.setZoomLevel(savedZoom);
        }
      }
    } catch (e) {}

    try {
      if (currentUrl && currentUrl !== 'about:blank' && !currentUrl.startsWith('chrome-error://')) {
        const domain = new URL(currentUrl).hostname.toLowerCase();
        if (domain && !state.sitesVisitedToday.includes(domain)) {
          state.sitesVisitedToday = [...state.sitesVisitedToday, domain];
        }
      }
    } catch (e) {
      console.error('Failed to parse domain for stats:', e);
    }
    
    updateActiveViewBounds(winId);

    data.win.webContents.send('tab-metadata-updated', {
      id: tabId,
      url: currentUrl,
      canGoBack: tabEntry.canGoBack,
      canGoForward: tabEntry.canGoForward
    });
  };

  view.webContents.on('did-navigate', updateNavigationState);
  view.webContents.on('did-navigate-in-page', updateNavigationState);

  // Redirect standard new windows to browser tabs
  view.webContents.setWindowOpenHandler((details) => {
    createTab(winId, details.url);
    return { action: 'deny' };
  });

  // Tab-level keyboard interceptor
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type.toLowerCase() !== 'keydown') return;
    const windowManager = require('./window-manager');
    const accelerator = windowManager.getAcceleratorString(input);
    const handled = windowManager.handleShortcutAction(data, accelerator);
    if (handled) {
      event.preventDefault();
    }
  });

  // Tab crash/unresponsive handling
  view.webContents.on('render-process-gone', (event, details) => {
    console.error(`Tab renderer process gone: ${details.reason}`);
    data.win.webContents.send('tab-crashed', { id: tabId, reason: details.reason });
  });

  view.webContents.on('unresponsive', () => {
    console.error('Tab renderer process unresponsive');
    data.win.webContents.send('tab-crashed', { id: tabId, reason: 'unresponsive' });
  });

  // Find-in-page results event forwarding
  view.webContents.on('found-in-page', (event, result) => {
    data.win.webContents.send('find-results-updated', {
      activeMatchOrdinal: result.activeMatchOrdinal,
      numberOfMatches: result.numberOfMatches
    });
  });
}

function createTab(winId, url) {
  const data = state.windows.get(winId);
  if (!data) return null;

  const tabId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
  
  // Track tabs opened today
  state.tabsOpenedToday++;
  state.broadcastStats();

  const view = new BrowserView({
    webPreferences: {
      preload: path.join(app.getAppPath(), 'src', 'preloads', 'tab-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  const resolvedUrl = sanitizeUrl(url);
  view.webContents.loadURL(resolvedUrl);

  const tabEntry = {
    id: tabId,
    url: resolvedUrl,
    title: resolvedUrl === 'about:blank' ? 'New Tab' : 'Loading...',
    view,
    loading: resolvedUrl !== 'about:blank',
    canGoBack: false,
    canGoForward: false,
    pinned: false,
    discarded: false
  };

  data.tabs.push(tabEntry);

  setupTabWebContentsHandlers(winId, tabEntry);

  // Set as active tab
  setActiveTab(winId, tabId);

  // Notify renderer about the new tab
  data.win.webContents.send('tab-created', {
    id: tabId,
    title: tabEntry.title,
    url: tabEntry.url,
    loading: tabEntry.loading,
    pinned: tabEntry.pinned,
    discarded: tabEntry.discarded
  });

  return tabId;
}

function setActiveTab(winId, tabId) {
  const data = state.windows.get(winId);
  if (!data) return;

  const targetTab = data.tabs.find(t => t.id === tabId);
  if (!targetTab) return;

  data.activeTabId = tabId;

  // Restore if discarded
  if (targetTab.discarded || !targetTab.view) {
    const view = new BrowserView({
      webPreferences: {
        preload: path.join(app.getAppPath(), 'src', 'preloads', 'tab-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    targetTab.view = view;
    targetTab.discarded = false;
    setupTabWebContentsHandlers(winId, targetTab);
    view.webContents.loadURL(targetTab.url);
    data.win.webContents.send('tab-metadata-updated', { id: tabId, discarded: false });
  }
  
  const currentViews = data.win.getBrowserViews();
  currentViews.forEach(v => {
    const isWorker = data.workerTabId && data.tabs.find(t => t.id === data.workerTabId && t.view === v);
    if (v !== targetTab.view && !isWorker) {
      data.win.removeBrowserView(v);
    }
  });
  
  if (targetTab.url !== 'about:blank') {
    try {
      data.win.addBrowserView(targetTab.view);
    } catch (e) {
      // If already added, ignore
    }
  }
  
  updateActiveViewBounds(winId);
  
  if (targetTab.url !== 'about:blank') {
    targetTab.view.webContents.focus();
  } else {
    data.win.webContents.focus();
  }

  // Send update to renderer
  data.win.webContents.send('tab-activated', {
    id: tabId,
    url: targetTab.url,
    canGoBack: targetTab.canGoBack,
    canGoForward: targetTab.canGoForward,
    pinned: targetTab.pinned,
    discarded: targetTab.discarded
  });
}

function closeTab(winId, tabId) {
  const data = state.windows.get(winId);
  if (!data) return;

  const idx = data.tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  const [removedTab] = data.tabs.splice(idx, 1);

  if (data.workerTabId === tabId) {
    data.workerTabId = null;
  }
  
  // Clean up audio settings
  state.tabAudioSettings.delete(tabId);
  
  // Store closed tab in history
  if (removedTab.url && removedTab.url !== 'about:blank') {
    data.closedTabsHistory.push(removedTab.url);
    
    // Forget Me on Tab Close (isolated storage clearing)
    try {
      const u = new URL(removedTab.url);
      const host = u.hostname.toLowerCase();
      const domainKey = host.replace(/\./g, '_');
      const siteSettings = state.store.get(`site_settings.${domainKey}`, {});
      if (siteSettings.forgetOnClose) {
        const origin = u.origin;
        const ses = removedTab.view ? removedTab.view.webContents.session : null;
        if (ses) {
          ses.clearStorageData({
            origin: origin,
            storages: ['cookies', 'localstorage', 'websql', 'indexeddb']
          }).then(() => {
            console.log(`[ForgetMe] Cleared storage data for ${origin}`);
          }).catch(err => {
            console.error(`[ForgetMe] Failed to clear storage for ${origin}:`, err);
          });
        }
      }
    } catch (err) {}
  }

  // Destroy browser view
  if (removedTab.view) {
    try {
      data.win.removeBrowserView(removedTab.view);
      removedTab.view.webContents.destroy();
    } catch (e) {}
  }

  // Adjust active tab if we closed the active one
  if (data.activeTabId === tabId) {
    if (data.tabs.length > 0) {
      const nextActiveTab = data.tabs[Math.max(0, idx - 1)];
      setActiveTab(winId, nextActiveTab.id);
    } else {
      data.activeTabId = null;
      const currentViews = data.win.getBrowserViews();
      currentViews.forEach(v => {
        data.win.removeBrowserView(v);
      });
      // Reset tab and hide window
      createTab(winId, 'about:blank');
      data.win.minimize();
      data.win.hide();
    }
  } else {
    // Just refresh bounds
    updateActiveViewBounds(winId);
  }

  // Notify renderer
  data.win.webContents.send('tab-closed', { id: tabId });
}

function init() {
  const windowManager = require('./window-manager');
  
  ipcMain.handle('create-tab', (e, url) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return null;
    const id = createTab(winEntry.win.id, url);
    return { id };
  });

  ipcMain.handle('close-tab', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (winEntry) closeTab(winEntry.win.id, tabId);
  });

  ipcMain.handle('set-active-tab', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (winEntry) setActiveTab(winEntry.win.id, tabId);
  });

  ipcMain.handle('set-tab-muted', (e, { tabId, muted }) => {
    let tabEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) break;
    }
    if (tabEntry && tabEntry.view) {
      tabEntry.view.webContents.setAudioMuted(muted);
      return { success: true, muted: tabEntry.view.webContents.isAudioMuted() };
    }
    return { success: false, error: 'Tab not found' };
  });

  ipcMain.handle('is-tab-muted', (e, tabId) => {
    let tabEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) break;
    }
    if (tabEntry && tabEntry.view) {
      return tabEntry.view.webContents.isAudioMuted();
    }
    return false;
  });

  ipcMain.handle('navigate-tab', (e, { tabId, url }) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return;
    const t = winEntry.tabs.find(x => x.id === tabId);
    if (t) {
      const targetUrl = sanitizeUrl(url);
      t.url = targetUrl;
      updateActiveViewBounds(winEntry.win.id);
      if (t.view) {
        t.view.webContents.loadURL(targetUrl);
      }
    }
  });

  ipcMain.handle('tab-go-back', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return;
    const t = winEntry.tabs.find(x => x.id === tabId);
    if (t && t.view && t.view.webContents.canGoBack()) {
      t.view.webContents.goBack();
    }
  });

  ipcMain.handle('tab-go-forward', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return;
    const t = winEntry.tabs.find(x => x.id === tabId);
    if (t && t.view && t.view.webContents.canGoForward()) {
      t.view.webContents.goForward();
    }
  });

  ipcMain.handle('tab-reload', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return;
    const t = winEntry.tabs.find(x => x.id === tabId);
    if (t && t.view) {
      t.view.webContents.reload();
    }
  });

  ipcMain.handle('update-layout-margins', (e, { height, rightMargin }) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (winEntry) {
      winEntry.toolbarHeight = height;
      winEntry.rightMargin = rightMargin;
      updateActiveViewBounds(winEntry.win.id);
    }
  });

  ipcMain.handle('set-content-protection', (e, enabled) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win) {
        win.setContentProtection(Boolean(enabled));
        state.store.set('contentProtection', Boolean(enabled));
        return { success: true };
      }
      return { success: false, error: 'Window not found' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('set-views-visibility', (e, visible) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (winEntry) {
      winEntry.viewsHidden = !visible;
      updateActiveViewBounds(winEntry.win.id);
    }
  });

  // Duplicate Tab
  ipcMain.handle('duplicate-tab', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return null;
    const tab = winEntry.tabs.find(t => t.id === tabId);
    if (tab) {
      const newId = createTab(winEntry.win.id, tab.url);
      return { id: newId };
    }
    return null;
  });

  // Pin/Unpin Tab
  ipcMain.handle('toggle-pin-tab', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return { success: false };
    const tab = winEntry.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.pinned = !tab.pinned;
      // Re-order: push pinned tabs to the front
      winEntry.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      updateActiveViewBounds(winEntry.win.id);
      
      // Broadcast metadata update to renderer
      winEntry.win.webContents.send('tab-metadata-updated', { id: tabId, pinned: tab.pinned });
      return { success: true, pinned: tab.pinned };
    }
    return { success: false };
  });

  // Discard Tab
  ipcMain.handle('discard-tab', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return { success: false };
    const tab = winEntry.tabs.find(t => t.id === tabId);
    if (tab && !tab.pinned && tabId !== winEntry.activeTabId) {
      if (tab.view) {
        try {
          winEntry.win.removeBrowserView(tab.view);
          tab.view.webContents.destroy();
        } catch (err) {}
        tab.view = null;
        tab.discarded = true;
        winEntry.win.webContents.send('tab-metadata-updated', { id: tabId, discarded: true });
        return { success: true };
      }
    }
    return { success: false };
  });

  // Fetch Autocomplete Search Suggestions
  ipcMain.handle('get-search-suggestions', async (e, query) => {
    try {
      const response = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`);
      const data = await response.json();
      return data[1] || [];
    } catch (err) {
      console.error('Search suggestions error:', err);
      return [];
    }
  });

  // Mock Secure Certificate Details
  ipcMain.handle('get-certificate-info', (e, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') {
        const host = u.hostname;
        return {
          secure: true,
          subject: host,
          issuer: host.includes('google') ? 'Google Trust Services LLC' : 'Let\'s Encrypt',
          validFrom: new Date(Date.now() - 30 * 24 * 3600 * 1000).toDateString(),
          validTo: new Date(Date.now() + 60 * 24 * 3600 * 1000).toDateString(),
          protocol: 'TLS 1.3',
          cipher: 'AES_256_GCM'
        };
      }
    } catch (err) {}
    return { secure: false };
  });

  // App Metrics for Task Manager
  ipcMain.handle('get-app-metrics', () => {
    const metrics = app.getAppMetrics();
    return metrics.map(m => {
      let name = m.type;
      if (m.type === 'Tab') {
        for (const entry of state.windows.values()) {
          const tab = entry.tabs.find(t => {
            try {
              return t.view && t.view.webContents.getOSProcessId() === m.pid;
            } catch (e) {
              return false;
            }
          });
          if (tab) {
            name = `Tab: ${tab.title}`;
            break;
          }
        }
      }
      return {
        pid: m.pid,
        name,
        memory: m.memory ? m.memory.privateBytes * 1024 : 0,
        cpu: m.cpu ? m.cpu.percentCPUUsage : 0
      };
    });
  });

  // View Page Source
  ipcMain.handle('fetch-page-source', async (e, url) => {
    try {
      const response = await fetch(url);
      return await response.text();
    } catch (err) {
      return `Error loading source code: ${String(err)}`;
    }
  });

  // Print Page
  ipcMain.handle('print-page', (e, tabId) => {
    let tabEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) break;
    }
    if (tabEntry && tabEntry.view) {
      tabEntry.view.webContents.print();
      return { success: true };
    }
    return { success: false };
  });

  // Save Page As HTML
  ipcMain.handle('save-page', async (e, tabId) => {
    let tabEntry = null;
    let winEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) {
        winEntry = entry;
        break;
      }
    }
    if (tabEntry && tabEntry.view) {
      const { dialog } = require('electron');
      const { filePath } = await dialog.showSaveDialog(winEntry.win, {
        defaultPath: path.join(app.getPath('downloads'), `${tabEntry.title || 'page'}.html`),
        filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }]
      });
      if (filePath) {
        await tabEntry.view.webContents.savePage(filePath, 'HTMLComplete');
        return { success: true, filePath };
      }
    }
    return { success: false };
  });

  // Tab Zoom Level
  ipcMain.handle('get-zoom-level', (e, tabId) => {
    let tabEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) break;
    }
    if (tabEntry && tabEntry.view) {
      return tabEntry.view.webContents.getZoomLevel();
    }
    return 0;
  });

  ipcMain.handle('set-zoom-level', (e, { tabId, zoomLevel }) => {
    let tabEntry = null;
    let winEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) {
        winEntry = entry;
        break;
      }
    }
    if (tabEntry && tabEntry.view) {
      tabEntry.view.webContents.setZoomLevel(zoomLevel);
      try {
        const currentUrl = tabEntry.view.webContents.getURL();
        if (currentUrl && currentUrl !== 'about:blank') {
          const domain = new URL(currentUrl).hostname.toLowerCase();
          state.store.set(`zoom_levels.${domain}`, zoomLevel);
        }
      } catch (err) {}
      winEntry.win.webContents.send('tab-metadata-updated', { id: tabId, zoomLevel });
      return { success: true };
    }
    return { success: false };
  });

  // Custom Site Permissions / Toggles
  ipcMain.handle('get-site-settings', (e, domain) => {
    const key = `site_settings.${domain.replace(/\./g, '_')}`;
    return state.store.get(key, { jsEnabled: true, imagesEnabled: true });
  });

  ipcMain.handle('save-site-settings', (e, { domain, settings }) => {
    const key = `site_settings.${domain.replace(/\./g, '_')}`;
    state.store.set(key, settings);
    return { success: true };
  });

  ipcMain.handle('restart-browser', () => {
    app.relaunch();
    app.exit(0);
  });

  // Find in page handlers
  ipcMain.handle('find-in-page', (e, { tabId, text, options }) => {
    let tabEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) break;
    }
    if (tabEntry && tabEntry.view) {
      tabEntry.view.webContents.findInPage(text, options);
    }
  });

  ipcMain.handle('stop-find-in-page', (e, { tabId, action }) => {
    let tabEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) break;
    }
    if (tabEntry && tabEntry.view) {
      tabEntry.view.webContents.stopFindInPage(action);
    }
  });

  ipcMain.on('tab-scroll-progress', (e, pct) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (winEntry) {
      const tab = winEntry.tabs.find(t => t.view && t.view.webContents === e.sender);
      if (tab && tab.id === winEntry.activeTabId) {
        winEntry.win.webContents.send('active-tab-scroll', pct);
      }
    }
  });

  ipcMain.on('tab-online-status', (e, isOnline) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (winEntry) {
      winEntry.win.webContents.send('network-status-changed', isOnline);
    }
  });

  ipcMain.handle('is-incognito', (e) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    return winEntry ? !!winEntry.isIncognito : false;
  });

  ipcMain.handle('create-private-window', () => {
    windowManager.createMainWindow(true);
    return { success: true };
  });
}


module.exports = {
  getTabByWebContents,
  updateActiveViewBounds,
  executeWithAttachedView,
  createTab,
  setActiveTab,
  closeTab,
  init
};
