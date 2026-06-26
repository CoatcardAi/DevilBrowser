const { app, BrowserWindow, BrowserView, ipcMain, Menu, dialog, session, desktopCapturer, Tray, globalShortcut, nativeImage, safeStorage } = require('electron');
const path = require('path');

// Enforce single instance lock to prevent cache/DB resource access conflicts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
  // Focus the main window of the primary instance
  for (const entry of windows.values()) {
    if (entry.win) {
      if (entry.win.isMinimized()) entry.win.restore();
      entry.win.show();
      entry.win.focus();
      break;
    }
  }
});

const Store = require('electron-store');
const { execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const http  = require('http');

function getUniqueSavePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let filePath = path.join(dir, filename);
  let counter = 1;
  while (fs.existsSync(filePath)) {
    filePath = path.join(dir, `${base} (${counter})${ext}`);
    counter++;
  }
  return filePath;
}

const store = new Store({ name: 'user-preferences' });

let adBlockerEnabled = store.get('adBlockerEnabled', false);
let alwaysOnTopEnabled = store.get('alwaysOnTopEnabled', false);
let browserMode = store.get('browserMode', 'tray'); // 'tray' | 'taskbar'

// Daily stats tracking and daily reset logic
const today = new Date().toDateString();
let statsDate = store.get('statsDate', today);
let adsBlockedToday = 0;
let tabsOpenedToday = 0;
let sitesVisitedToday = [];

if (statsDate !== today) {
  store.set('statsDate', today);
  store.set('adsBlockedToday', 0);
  store.set('tabsOpenedToday', 0);
  store.set('sitesVisitedToday', []);
} else {
  adsBlockedToday = store.get('adsBlockedToday', 0);
  tabsOpenedToday = store.get('tabsOpenedToday', 0);
  sitesVisitedToday = store.get('sitesVisitedToday', []);
}
const sessionStart = Date.now();

function broadcastStats() {
  const stats = {
    adsBlockedToday,
    tabsOpenedToday,
    sitesVisitedTodayCount: Array.isArray(sitesVisitedToday) ? sitesVisitedToday.length : 0,
    sessionDuration: Date.now() - sessionStart
  };
  for (const entry of windows.values()) {
    try {
      entry.win.webContents.send('stats-updated', stats);
    } catch (e) {}
  }
}

const AD_PATTERNS = [
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'adservice.google.com',
  'taboola.com',
  'outbrain.com',
  'adnxs.com',
  'amazon-adsystem.com',
  'popads.net',
  'adform.net',
  'scorecardresearch.com',
  'quantserve.com',
  'google-analytics.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.io'
];

// Track open windows and their state
// Key: window ID, Value: { win, tabs: [], activeTabId: null, closedTabsHistory: [], toolbarHeight: 86 }
const windows = new Map();

// Track active downloads
// Key: download ID, Value: DownloadItem
const activeDownloads = new Map();

// Mic Input Routing source state: 'mic' (physical mic) or 'system' (laptop audio loopback)
let micRoutingSource = 'mic';

// Tab-specific audio routing settings: tabId -> { enabled, source, destination }
const tabAudioSettings = new Map();
let globalAudioSettings = { enabled: false, source: 'mic' };

function getTabByWebContents(sender) {
  for (const entry of windows.values()) {
    const tab = entry.tabs.find(t => t.view.webContents === sender);
    if (tab) return { tab, windowEntry: entry };
  }
  return null;
}

function resolveAudioSettingsForTab(tab) {
  if (!tab) return { enabled: false, source: 'mic' };
  
  // 1. Check if global (All Tabs) routing is active
  if (globalAudioSettings && globalAudioSettings.enabled) {
    return { enabled: true, source: globalAudioSettings.source };
  }

  // 2. Check tab-specific configuration
  const tabSettings = tabAudioSettings.get(tab.id);
  if (tabSettings && tabSettings.enabled) {
    return { enabled: true, source: tabSettings.source };
  }

  // 3. Check domain-specific configuration
  try {
    if (tab.url && tab.url !== 'about:blank') {
      const hostname = new URL(tab.url).hostname;
      const domainSettingsStore = store.get('domainAudioSettings', {});
      const domainSettings = domainSettingsStore[hostname];
      if (domainSettings && domainSettings.enabled) {
        return { enabled: true, source: domainSettings.source };
      }
    }
  } catch (e) {
    console.error('Error parsing tab URL for audio settings:', e);
  }

  // Default fallback
  return { enabled: false, source: 'mic' };
}

function getAudioSettingsForTabId(tabId) {
  let tabEntry = null;
  for (const entry of windows.values()) {
    tabEntry = entry.tabs.find(t => t.id === tabId);
    if (tabEntry) break;
  }

  const tabSettings = tabAudioSettings.get(tabId);
  if (tabSettings) {
    return { ...tabSettings, resolved: resolveAudioSettingsForTab(tabEntry) };
  }

  if (tabEntry && tabEntry.url && tabEntry.url !== 'about:blank') {
    try {
      const hostname = new URL(tabEntry.url).hostname;
      const domainSettingsStore = store.get('domainAudioSettings', {});
      const domainSettings = domainSettingsStore[hostname];
      if (domainSettings) {
        return { ...domainSettings, resolved: resolveAudioSettingsForTab(tabEntry) };
      }
    } catch (e) {}
  }

  if (globalAudioSettings && globalAudioSettings.enabled) {
    return { enabled: true, source: globalAudioSettings.source, destination: 'all', resolved: globalAudioSettings };
  }

  return { enabled: false, source: 'mic', destination: 'tab', resolved: { enabled: false, source: 'mic' } };
}

function runAudioHelper(args) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'audio-helper.ps1');
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args];
    execFile('powershell.exe', psArgs, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: stderr || err.message });
      } else {
        resolve({ success: true, stdout: stdout.trim() });
      }
    });
  });
}

function getWindowEntry(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win) return null;
  return windows.get(win.id);
}

let tray = null;

function toggleWindowVisibility() {
  const entries = Array.from(windows.values());
  if (entries.length === 0) {
    createMainWindow();
    return;
  }
  
  const entry = entries[0];
  const win = entry.win;
  
  if (win.isVisible() && !win.isMinimized()) {
    win.minimize();
    win.hide();
  } else {
    win.show();
    win.restore();
    win.focus();
  }
}

function registerGlobalToggleShortcut() {
  let shortcuts = store.get('shortcuts', {});
  if (!shortcuts['toggle-window'] || shortcuts['toggle-window'] === 'Control+B') {
    shortcuts['toggle-window'] = 'Alt+B';
    store.set('shortcuts', shortcuts);
  }
  const toggleShortcut = shortcuts['toggle-window'];
  
  try {
    globalShortcut.unregisterAll();
  } catch (e) {
    console.error('Failed to unregister shortcuts:', e);
  }
  
  try {
    globalShortcut.register(toggleShortcut, () => {
      toggleWindowVisibility();
    });
  } catch (e) {
    console.error(`Failed to register global shortcut ${toggleShortcut}:`, e);
    try {
      globalShortcut.register('Alt+B', () => {
        toggleWindowVisibility();
      });
    } catch (e2) {}
  }
}

function createTray() {
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAY0lEQVQ4T2NkoAL8h1L/GZGFiTEKGHUAMeyH2sDKgCxgZMAD0A0gC/xHw8A/VIxRwGgC/0EWsDLgAegGkAX+o2HgHyrGKEAsA0gG/mNgoAFg9CChgFEHEMN+qA0wA1iwiOIBAPyRKiEs/f6FAAAAAElFTkSuQmCC');
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Browser', click: () => {
      const entries = Array.from(windows.values());
      if (entries.length > 0) {
        const win = entries[0].win;
        win.show();
        win.restore();
        win.focus();
      } else {
        createMainWindow();
      }
    }},
    { label: 'Minimize to Tray', click: () => {
      const entries = Array.from(windows.values());
      if (entries.length > 0) {
        const win = entries[0].win;
        win.minimize();
        win.hide();
      }
    }},
    { type: 'separator' },
    { label: 'Quit DevilBrowser', click: () => {
      app.isQuitting = true;
      app.quit();
    }}
  ]);
  
  tray.setToolTip('DevilBrowser');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    toggleWindowVisibility();
  });
}

function createMainWindow(isIncognito = false) {
  const useFrameless = process.platform === 'win32' || process.platform === 'darwin';
  
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    skipTaskbar: browserMode === 'tray',
    titleBarStyle: useFrameless ? 'hidden' : 'default',
    titleBarOverlay: useFrameless ? {
      color: '#0b0f19',
      symbolColor: '#a5b4fc',
      height: 38
    } : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      partition: isIncognito ? 'incognito_session_' + Date.now() : undefined
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const winId = win.id;
  windows.set(winId, {
    win,
    tabs: [],
    activeTabId: null,
    closedTabsHistory: [],
    toolbarHeight: 110,
    rightMargin: 0,
    hudWindow: null
  });

  // Apply saved content protection preference on startup (default true)
  const contentProtection = store.get('contentProtection', true);
  try {
    win.setContentProtection(contentProtection);
  } catch (e) {
    console.error('Failed to set content protection:', e);
  }

  // Apply saved always on top preference on startup (default false)
  const alwaysOnTop = store.get('alwaysOnTopEnabled', false);
  try {
    win.setAlwaysOnTop(alwaysOnTop);
  } catch (e) {
    console.error('Failed to set always on top:', e);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (!app.isQuitting) {
      if (browserMode === 'tray') {
        event.preventDefault();
        win.minimize();
        win.hide();
      }
    }
  });

  win.on('closed', () => {
    const data = windows.get(winId);
    if (data) {
      if (data.hudWindow && !data.hudWindow.isDestroyed()) {
        try { data.hudWindow.destroy(); } catch (e) {}
      }
      for (const t of data.tabs) {
        try {
          t.view.webContents.destroy();
        } catch (e) {}
      }
      windows.delete(winId);
    }
  });

  win.on('resize', () => {
    updateActiveViewBounds(winId);
  });

  // Main window keyboard interceptor
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type.toLowerCase() !== 'keydown') return;
    const entry = windows.get(winId);
    if (!entry) return;
    const accelerator = getAcceleratorString(input);
    const handled = handleShortcutAction(entry, accelerator);
    if (handled) {
      event.preventDefault();
    }
  });

  return win;
}

function updateActiveViewBounds(winId) {
  const data = windows.get(winId);
  if (!data || !data.activeTabId) return;
  
  const activeTab = data.tabs.find(t => t.id === data.activeTabId);
  if (!activeTab) return;

  const bounds = data.win.getContentBounds();
  const topOffset = data.toolbarHeight || 86;
  const rightOffset = data.rightMargin || 0;
  
  if (activeTab.url === 'about:blank') {
    try {
      data.win.removeBrowserView(activeTab.view);
    } catch (e) {}
  } else {
    try {
      data.win.addBrowserView(activeTab.view);
    } catch (e) {}
    
    activeTab.view.setBounds({
      x: 0,
      y: topOffset,
      width: bounds.width - rightOffset,
      height: bounds.height - topOffset
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

function createTab(winId, url) {
  const data = windows.get(winId);
  if (!data) return null;

  const tabId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
  
  // Track tabs opened today
  tabsOpenedToday++;
  store.set('tabsOpenedToday', tabsOpenedToday);
  broadcastStats();

  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'tab-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  const resolvedUrl = url && url.trim() !== '' ? url : 'about:blank';
  view.webContents.loadURL(resolvedUrl);

  const tabEntry = {
    id: tabId,
    url: resolvedUrl,
    title: resolvedUrl === 'about:blank' ? 'New Tab' : 'Loading...',
    view,
    loading: resolvedUrl !== 'about:blank',
    canGoBack: false,
    canGoForward: false
  };

  data.tabs.push(tabEntry);

  // Set as active tab
  setActiveTab(winId, tabId);

  // Chrome-like context menu for tab webContents
  view.webContents.on('context-menu', (event, params) => {
    const menuTemplate = [];

    // Back / Forward / Reload
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

    // Link options
    if (params.linkURL) {
      menuTemplate.push({
        label: 'Open Link in New Tab',
        click: () => {
          createTab(winId, params.linkURL);
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

    // Image options
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

    // Selection options
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
      // General editing or page options
      if (params.isEditable) {
        menuTemplate.push({ role: 'undo' });
        menuTemplate.push({ role: 'redo' });
        menuTemplate.push({ type: 'separator' });
        menuTemplate.push({ role: 'cut' });
        menuTemplate.push({ role: 'copy' });
        menuTemplate.push({ role: 'paste' });
        menuTemplate.push({ role: 'selectAll' });
      } else {
        // Page level AI actions
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

  // Setup event listeners for tab updates
  view.webContents.on('did-start-loading', () => {
    tabEntry.loading = true;
    data.win.webContents.send('tab-loading-state', { id: tabId, loading: true });
  });

  view.webContents.on('did-stop-loading', () => {
    tabEntry.loading = false;
    data.win.webContents.send('tab-loading-state', { id: tabId, loading: false });
  });

  view.webContents.on('page-title-updated', (e, title) => {
    tabEntry.title = title;
    data.win.webContents.send('tab-title-updated', { id: tabId, title });
  });

  view.webContents.on('page-favicons-updated', (e, favicons) => {
    if (favicons && favicons.length > 0) {
      data.win.webContents.send('tab-favicon-updated', { id: tabId, favicon: favicons[0] });
    }
  });

  const updateNavigationState = () => {
    const currentUrl = view.webContents.getURL();
    tabEntry.url = currentUrl;
    tabEntry.canGoBack = view.webContents.canGoBack();
    tabEntry.canGoForward = view.webContents.canGoForward();
    
    try {
      if (currentUrl && currentUrl !== 'about:blank' && !currentUrl.startsWith('chrome-error://')) {
        const domain = new URL(currentUrl).hostname.toLowerCase();
        if (domain && !sitesVisitedToday.includes(domain)) {
          sitesVisitedToday.push(domain);
          store.set('sitesVisitedToday', sitesVisitedToday);
          broadcastStats();
        }
      }
    } catch (e) {
      console.error('Failed to parse domain for stats:', e);
    }
    
    updateActiveViewBounds(winId);

    data.win.webContents.send('tab-url-updated', {
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
    const accelerator = getAcceleratorString(input);
    const handled = handleShortcutAction(data, accelerator);
    if (handled) {
      event.preventDefault();
    }
  });

  // Notify renderer about the new tab
  data.win.webContents.send('tab-created', {
    id: tabId,
    title: tabEntry.title,
    url: tabEntry.url,
    loading: tabEntry.loading
  });

  return tabId;
}



function setActiveTab(winId, tabId) {
  const data = windows.get(winId);
  if (!data) return;

  const targetTab = data.tabs.find(t => t.id === tabId);
  if (!targetTab) return;

  data.activeTabId = tabId;
  
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
    canGoForward: targetTab.canGoForward
  });
}

function closeTab(winId, tabId) {
  const data = windows.get(winId);
  if (!data) return;

  const idx = data.tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  const [removedTab] = data.tabs.splice(idx, 1);

  if (data.workerTabId === tabId) {
    data.workerTabId = null;
  }
  
  // Clean up audio settings
  tabAudioSettings.delete(tabId);
  
  // Store closed tab in history
  if (removedTab.url && removedTab.url !== 'about:blank') {
    data.closedTabsHistory.push(removedTab.url);
  }

  // Destroy browser view
  try {
    data.win.removeBrowserView(removedTab.view);
    removedTab.view.webContents.destroy();
  } catch (e) {}

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

function getAcceleratorString(input) {
  const parts = [];
  if (input.control) parts.push('Control');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');
  if (input.meta) parts.push('Meta');
  
  let key = input.key;
  if (key === ' ') {
    key = 'Space';
  } else if (key === 'ArrowLeft') {
    key = 'Left';
  } else if (key === 'ArrowRight') {
    key = 'Right';
  } else if (key === 'ArrowUp') {
    key = 'Up';
  } else if (key === 'ArrowDown') {
    key = 'Down';
  } else if (key.length === 1) {
    key = key.toLowerCase();
  }
  parts.push(key);
  return parts.join('+');
}

function handleShortcutAction(winEntry, accelerator) {
  const winId = winEntry.win.id;
  const normAcc = accelerator.toLowerCase();

  // 1. Static shortcuts (always active, hardcoded)
  if (normAcc === 'control+tab') {
    const activeIdx = winEntry.tabs.findIndex(t => t.id === winEntry.activeTabId);
    if (activeIdx !== -1 && winEntry.tabs.length > 1) {
      const nextIdx = (activeIdx + 1) % winEntry.tabs.length;
      setActiveTab(winId, winEntry.tabs[nextIdx].id);
    }
    return true;
  }
  
  if (normAcc === 'control+shift+tab') {
    const activeIdx = winEntry.tabs.findIndex(t => t.id === winEntry.activeTabId);
    if (activeIdx !== -1 && winEntry.tabs.length > 1) {
      const prevIdx = (activeIdx - 1 + winEntry.tabs.length) % winEntry.tabs.length;
      setActiveTab(winId, winEntry.tabs[prevIdx].id);
    }
    return true;
  }
  
  if (/^control\+[1-8]$/.test(normAcc)) {
    const tabNum = parseInt(normAcc.split('+').pop());
    if (winEntry.tabs.length >= tabNum) {
      setActiveTab(winId, winEntry.tabs[tabNum - 1].id);
    }
    return true;
  }
  
  if (normAcc === 'control+9') {
    if (winEntry.tabs.length > 0) {
      setActiveTab(winId, winEntry.tabs[winEntry.tabs.length - 1].id);
    }
    return true;
  }
  
  if (normAcc === 'control+shift+r') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab) activeTab.view.webContents.reloadIgnoringCache();
    return true;
  }
  
  if (normAcc === 'escape') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab) activeTab.view.webContents.stop();
    return true;
  }
  
  if (normAcc === 'alt+left' || normAcc === 'alt+arrowleft') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab && activeTab.view.webContents.canGoBack()) {
      activeTab.view.webContents.goBack();
    }
    return true;
  }
  
  if (normAcc === 'alt+right' || normAcc === 'alt+arrowright') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab && activeTab.view.webContents.canGoForward()) {
      activeTab.view.webContents.goForward();
    }
    return true;
  }
  
  if (normAcc === 'f11') {
    const isFullScreen = winEntry.win.isFullScreen();
    winEntry.win.setFullScreen(!isFullScreen);
    return true;
  }
  
  if (normAcc === 'alt+f4') {
    winEntry.win.close();
    return true;
  }
  
  if (normAcc === 'control+shift+n') {
    createMainWindow(true);
    return true;
  }
  
  if (normAcc === 'control+shift+b') {
    winEntry.win.webContents.send('toggle-bookmarks-bar');
    return true;
  }
  
  if (normAcc === 'control+shift+o') {
    winEntry.win.webContents.send('toggle-bookmarks-panel');
    return true;
  }
  
  if (normAcc === 'control+j') {
    winEntry.win.webContents.send('toggle-downloads-panel');
    return true;
  }
  
  if (normAcc === 'control+shift+delete') {
    winEntry.win.webContents.send('open-clear-browsing-dialog');
    return true;
  }
  
  if (normAcc === 'control+f') {
    winEntry.win.webContents.send('focus-find-in-page');
    return true;
  }
  
  if (normAcc === 'control+=' || normAcc === 'control++') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab) {
      const wc = activeTab.view.webContents;
      wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    }
    return true;
  }
  
  if (normAcc === 'control+-') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab) {
      const wc = activeTab.view.webContents;
      wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    }
    return true;
  }
  
  if (normAcc === 'control+0') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab) {
      activeTab.view.webContents.setZoomLevel(0);
    }
    return true;
  }
  
  if (normAcc === 'alt+home') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab) {
      activeTab.view.webContents.loadURL('about:blank');
    }
    return true;
  }

  if (normAcc === 'f5') {
    const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
    if (activeTab) activeTab.view.webContents.reload();
    return true;
  }

  if (normAcc === 'alt+d' || normAcc === 'f6') {
    winEntry.win.webContents.send('focus-address-bar');
    return true;
  }

  if (normAcc === 'control+k') {
    winEntry.win.webContents.send('open-command-palette');
    return true;
  }

  if (normAcc === 'alt+a') {
    winEntry.win.webContents.send('shortcut-toggle-routing');
    return true;
  }
  if (normAcc === 'alt+shift+a') {
    winEntry.win.webContents.send('shortcut-cycle-source');
    return true;
  }
  if (normAcc === 'alt+m') {
    winEntry.win.webContents.send('shortcut-toggle-mix');
    return true;
  }

  // 2. Customizable shortcuts (merged from store and defaults)
  const shortcuts = store.get('shortcuts', {
    'new-tab': 'Control+t',
    'close-tab': 'Control+w',
    'reopen-tab': 'Control+Shift+t',
    'refresh': 'Control+r',
    'focus-address': 'Control+l',
    'new-window': 'Control+n',
    'dev-tools': 'Control+Shift+i',
    'add-bookmark': 'Control+d',
    'toggle-adblocker': 'Control+Shift+A',
    'toggle-always-ontop': 'Control+Shift+P',
    'toggle-window': 'Alt+B'
  });
  
  const action = Object.keys(shortcuts).find(key => {
    const val = shortcuts[key];
    return typeof val === 'string' && val.toLowerCase() === normAcc;
  });
  
  if (!action) return false;

  switch (action) {
    case 'new-tab':
      createTab(winId, 'about:blank');
      winEntry.win.webContents.send('focus-address-bar');
      break;
    case 'close-tab':
      if (winEntry.activeTabId) {
        closeTab(winId, winEntry.activeTabId);
      }
      break;
    case 'reopen-tab':
      if (winEntry.closedTabsHistory.length > 0) {
        const url = winEntry.closedTabsHistory.pop();
        createTab(winId, url);
      }
      break;
    case 'refresh':
      const activeTab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
      if (activeTab) {
        activeTab.view.webContents.reload();
      }
      break;
    case 'focus-address':
      winEntry.win.webContents.send('focus-address-bar');
      break;
    case 'new-window':
      createMainWindow();
      break;
    case 'dev-tools':
      const activeTabDT = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
      if (activeTabDT) {
        activeTabDT.view.webContents.toggleDevTools();
      }
      break;
    case 'add-bookmark':
      winEntry.win.webContents.send('trigger-bookmark');
      break;
    case 'toggle-adblocker': {
      const state = !store.get('adBlockerEnabled', false);
      store.set('adBlockerEnabled', state);
      adBlockerEnabled = state;
      winEntry.win.webContents.send('adblocker-state-changed', state);
      break;
    }
    case 'toggle-always-ontop': {
      const state = !store.get('alwaysOnTopEnabled', false);
      store.set('alwaysOnTopEnabled', state);
      alwaysOnTopEnabled = state;
      updateAlwaysOnTopState(state);
      winEntry.win.webContents.send('always-ontop-state-changed', state);
      break;
    }
    default:
      return false;
  }
  return true;
}

// ----------------------------------------------------
// IPC Event Registration
// ----------------------------------------------------

ipcMain.handle('create-tab', (e, url) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return null;
  const id = createTab(winEntry.win.id, url);
  return { id };
});

ipcMain.handle('close-tab', (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
  if (winEntry) closeTab(winEntry.win.id, tabId);
});

ipcMain.handle('set-active-tab', (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
  if (winEntry) setActiveTab(winEntry.win.id, tabId);
});

ipcMain.handle('set-tab-muted', (e, { tabId, muted }) => {
  let tabEntry = null;
  for (const entry of windows.values()) {
    tabEntry = entry.tabs.find(t => t.id === tabId);
    if (tabEntry) break;
  }
  if (tabEntry) {
    tabEntry.view.webContents.setAudioMuted(muted);
    return { success: true, muted: tabEntry.view.webContents.isAudioMuted() };
  }
  return { success: false, error: 'Tab not found' };
});

ipcMain.handle('is-tab-muted', (e, tabId) => {
  let tabEntry = null;
  for (const entry of windows.values()) {
    tabEntry = entry.tabs.find(t => t.id === tabId);
    if (tabEntry) break;
  }
  if (tabEntry) {
    return tabEntry.view.webContents.isAudioMuted();
  }
  return false;
});

ipcMain.handle('navigate-tab', (e, { tabId, url }) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return;
  const t = winEntry.tabs.find(x => x.id === tabId);
  if (t) {
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl) && !/^about:/i.test(targetUrl)) {
      if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
        targetUrl = 'https://' + targetUrl;
      } else {
        targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
      }
    }
    t.url = targetUrl;
    updateActiveViewBounds(winEntry.win.id);
    t.view.webContents.loadURL(targetUrl);
  }
});

ipcMain.handle('tab-go-back', (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return;
  const t = winEntry.tabs.find(x => x.id === tabId);
  if (t && t.view.webContents.canGoBack()) {
    t.view.webContents.goBack();
  }
});

ipcMain.handle('tab-go-forward', (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return;
  const t = winEntry.tabs.find(x => x.id === tabId);
  if (t && t.view.webContents.canGoForward()) {
    t.view.webContents.goForward();
  }
});

ipcMain.handle('tab-reload', (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return;
  const t = winEntry.tabs.find(x => x.id === tabId);
  if (t) {
    t.view.webContents.reload();
  }
});

ipcMain.on('hud-state-update', (e, data) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return;

  if (data.type === 'start') {
    if (!winEntry.hudWindow || winEntry.hudWindow.isDestroyed()) {
      winEntry.hudWindow = new BrowserWindow({
        width: 320,
        height: 180,
        parent: winEntry.win,
        modal: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
        }
      });
      winEntry.hudWindow.loadFile(path.join(__dirname, 'renderer', 'hud.html'));
      
      winEntry.hudWindow.once('ready-to-show', () => {
        const parentBounds = winEntry.win.getBounds();
        const x = parentBounds.x + parentBounds.width - 340;
        const y = parentBounds.y + parentBounds.height - 200;
        winEntry.hudWindow.setBounds({ x, y, width: 320, height: 180 });
        winEntry.hudWindow.show();
        
        setTimeout(() => {
          if (winEntry.hudWindow && !winEntry.hudWindow.isDestroyed()) {
            winEntry.hudWindow.webContents.send('hud-data', data);
          }
        }, 200);
      });
    } else {
      winEntry.hudWindow.show();
      winEntry.hudWindow.webContents.send('hud-data', data);
    }
  } else if (data.type === 'hide') {
    if (winEntry.hudWindow && !winEntry.hudWindow.isDestroyed()) {
      winEntry.hudWindow.close();
      winEntry.hudWindow = null;
    }
  } else {
    if (winEntry.hudWindow && !winEntry.hudWindow.isDestroyed()) {
      winEntry.hudWindow.webContents.send('hud-data', data);
    }
  }
});

ipcMain.on('hud-cancel-clicked', (e) => {
  for (const entry of windows.values()) {
    if (entry.hudWindow && entry.hudWindow.webContents === e.sender) {
      entry.win.webContents.send('hud-cancel-triggered');
      break;
    }
  }
});

ipcMain.handle('update-layout-margins', (e, { height, rightMargin }) => {
  const winEntry = getWindowEntry(e.sender);
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
      store.set('contentProtection', Boolean(enabled));
      return { success: true };
    }
    return { success: false, error: 'Window not found' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('get-preferences', () => ({
  contentProtection: store.get('contentProtection', true),
  adBlockerEnabled: store.get('adBlockerEnabled', false),
  alwaysOnTopEnabled: store.get('alwaysOnTopEnabled', false),
  shortcuts: store.get('shortcuts', {
    'new-tab': 'Control+t',
    'close-tab': 'Control+w',
    'reopen-tab': 'Control+Shift+t',
    'refresh': 'Control+r',
    'focus-address': 'Control+l',
    'new-window': 'Control+n',
    'dev-tools': 'Control+Shift+i',
    'add-bookmark': 'Control+d',
    'toggle-adblocker': 'Control+Shift+A',
    'toggle-always-ontop': 'Control+Shift+P',
    'toggle-window': 'Alt+B'
  }),
  permissions: store.get('permissions', {
    media: true,
    notifications: true,
    geolocation: false
  }),
  platform: process.platform
}));

ipcMain.handle('save-preferences', (e, prefs) => {
  if (prefs.shortcuts) {
    store.set('shortcuts', prefs.shortcuts);
    registerGlobalToggleShortcut();
  }
  if (prefs.permissions) store.set('permissions', prefs.permissions);
  if (prefs.contentProtection !== undefined) store.set('contentProtection', prefs.contentProtection);
  if (prefs.adBlockerEnabled !== undefined) {
    store.set('adBlockerEnabled', prefs.adBlockerEnabled);
    adBlockerEnabled = prefs.adBlockerEnabled;
  }
  if (prefs.alwaysOnTopEnabled !== undefined) {
    store.set('alwaysOnTopEnabled', prefs.alwaysOnTopEnabled);
    alwaysOnTopEnabled = prefs.alwaysOnTopEnabled;
    updateAlwaysOnTopState(prefs.alwaysOnTopEnabled);
  }
  return { success: true };
});

ipcMain.handle('set-browser-mode', (e, mode) => {
  if (mode !== 'tray' && mode !== 'taskbar') return { success: false, error: 'Invalid mode' };
  browserMode = mode;
  store.set('browserMode', mode);

  // Update skipTaskbar on all open windows
  for (const entry of windows.values()) {
    try {
      entry.win.setSkipTaskbar(mode === 'tray');
    } catch (err) {
      console.error('Failed to set skipTaskbar:', err);
    }
  }

  // Handle tray destruction/creation
  if (mode === 'taskbar') {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  } else {
    if (!tray) {
      createTray();
    }
  }

  return { success: true, mode };
});

ipcMain.handle('get-browser-mode', () => {
  return browserMode;
});

ipcMain.handle('get-stats', () => {
  return {
    adsBlockedToday,
    tabsOpenedToday,
    sitesVisitedTodayCount: Array.isArray(sitesVisitedToday) ? sitesVisitedToday.length : 0,
    sessionDuration: Date.now() - sessionStart
  };
});

// Bookmarks Handling
ipcMain.handle('get-bookmarks', () => store.get('bookmarks', []));

ipcMain.handle('save-bookmarks', (e, bookmarks) => {
  store.set('bookmarks', bookmarks);
  return { success: true };
});

ipcMain.handle('set-mic-routing-source', (e, source) => {
  micRoutingSource = source; // 'mic' or 'system'
  // Synchronize toggle buttons across all open windows
  for (const entry of windows.values()) {
    if (entry.win.webContents !== e.sender) {
      entry.win.webContents.send('mic-routing-source-changed', source);
    }
  }
  return { success: true, source };
});

ipcMain.handle('get-mic-routing-source', () => {
  return micRoutingSource;
});

// IPC handlers for active audio routing preferences
ipcMain.handle('get-tab-audio-settings', (event, tabId) => {
  return getAudioSettingsForTabId(tabId);
});

ipcMain.handle('set-tab-audio-settings', (event, { tabId, enabled, source, destination }) => {
  let tabEntry = null;
  let winEntry = null;
  for (const entry of windows.values()) {
    tabEntry = entry.tabs.find(t => t.id === tabId);
    if (tabEntry) {
      winEntry = entry;
      break;
    }
  }

  const settings = { enabled, source, destination };

  if (destination === 'all') {
    globalAudioSettings = { enabled, source };
  } else if (destination === 'domain' && tabEntry && tabEntry.url && tabEntry.url !== 'about:blank') {
    try {
      const hostname = new URL(tabEntry.url).hostname;
      const domainSettingsStore = store.get('domainAudioSettings', {});
      if (enabled) {
        domainSettingsStore[hostname] = { enabled, source, destination: 'domain' };
      } else {
        delete domainSettingsStore[hostname];
      }
      store.set('domainAudioSettings', domainSettingsStore);
    } catch (e) {
      console.error('Error saving domain audio settings:', e);
    }
  } else {
    if (enabled) {
      tabAudioSettings.set(tabId, { enabled, source, destination: 'tab' });
    } else {
      tabAudioSettings.delete(tabId);
    }
  }

  if (winEntry) {
    winEntry.win.webContents.send('tab-audio-settings-changed', { tabId, settings });
  }

  if (destination === 'all') {
    for (const entry of windows.values()) {
      if (entry !== winEntry) {
        entry.win.webContents.send('tab-audio-settings-changed', { tabId, settings });
      }
    }
  }

  return { success: true };
});

ipcMain.handle('get-active-tab-audio-settings', (event) => {
  const res = getTabByWebContents(event.sender);
  if (res) {
    return resolveAudioSettingsForTab(res.tab);
  }
  return { enabled: false, source: 'mic' };
});

// Audio Loopback Helpers
ipcMain.handle('get-desktop-audio-source-id', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  const primary = sources[0];
  return primary ? primary.id : null;
});

ipcMain.handle('list-audio-devices', async () => {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Audio device setting automation is currently only supported on Windows' };
  }
  const res = await runAudioHelper(['-Action', 'list']);
  if (!res.success) return res;
  try {
    const devices = JSON.parse(res.stdout);
    return { success: true, devices };
  } catch (e) {
    return { success: false, error: 'Failed to parse device list: ' + e.message };
  }
});

ipcMain.handle('set-default-recording-device', async (e, deviceId) => {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Audio device setting automation is currently only supported on Windows' };
  }
  const res = await runAudioHelper(['-Action', 'set', '-DeviceId', deviceId]);
  return res;
});

// Downloads Handling
ipcMain.handle('pause-download', (e, id) => {
  const item = activeDownloads.get(id);
  if (item) {
    item.pause();
    return true;
  }
  return false;
});

ipcMain.handle('resume-download', (e, id) => {
  const item = activeDownloads.get(id);
  if (item && item.isPaused()) {
    item.resume();
    return true;
  }
  return false;
});

ipcMain.handle('cancel-download', (e, id) => {
  const item = activeDownloads.get(id);
  if (item) {
    item.cancel();
    activeDownloads.delete(id);
    return true;
  }
  return false;
});

ipcMain.handle('get-download-directory', () => {
  return store.get('downloadDirectory') || app.getPath('downloads');
});

ipcMain.handle('select-download-directory', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose Download Folder',
    defaultPath: store.get('downloadDirectory') || app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const newDir = result.filePaths[0];
  store.set('downloadDirectory', newDir);
  return { canceled: false, path: newDir };
});

// ----------------------------------------------------
// AI Integration — IPC Handlers
// ----------------------------------------------------

const AI_BASE = 'https://aimagicbackend.onrender.com';

/** Simple promisified HTTP/HTTPS request (returns parsed JSON) */
function aiFetch(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(AI_BASE + path);
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

// ── Auth ──
ipcMain.handle('ai-login', async (e, email) => {
  try {
    const res = await aiFetch('POST', '/auth/login', { email }, null);
    return res.body;
  } catch(err) { return { error: err.message }; }
});

ipcMain.handle('ai-verify-otp', async (e, { email, otp }) => {
  try {
    const res = await aiFetch('POST', '/auth/verify', { email, otp }, null);
    if (res.body && res.body.token) {
      store.set('ai-token', res.body.token);
      // Fetch me to return role info
      try {
        const meRes = await aiFetch('GET', '/auth/me', null, res.body.token);
        return { token: res.body.token, me: meRes.body };
      } catch { return { token: res.body.token }; }
    }
    return res.body;
  } catch(err) { return { error: err.message }; }
});

ipcMain.handle('ai-logout', async () => {
  const token = store.get('ai-token');
  if (token) {
    try { await aiFetch('POST', '/auth/logout', {}, token); } catch {}
    store.delete('ai-token');
  }
  return { success: true };
});

ipcMain.handle('ai-get-me', async () => {
  const token = store.get('ai-token');
  if (!token) return null;
  try {
    const res = await aiFetch('GET', '/auth/me', null, token);
    if (res.status === 401) { store.delete('ai-token'); return null; }
    return res.body;
  } catch { return null; }
});

ipcMain.handle('ai-get-token', () => store.get('ai-token') || null);

// ── Quota ──
ipcMain.handle('ai-get-quota', async () => {
  const token = store.get('ai-token');
  if (!token) return null;
  try {
    const res = await aiFetch('GET', '/v1/quota', null, token);
    return res.body;
  } catch { return null; }
});

// ── Models ──
ipcMain.handle('ai-get-models', async () => {
  const token = store.get('ai-token');
  if (!token) return { models: [] };
  try {
    const res = await aiFetch('GET', '/v1/models/available', null, token);
    return res.body;
  } catch { return { models: [] }; }
});

// ── Non-streaming Generate ──
ipcMain.handle('ai-generate', async (e, payload) => {
  const token = store.get('ai-token');
  if (!token) return { error: 'Not authenticated' };
  try {
    const res = await aiFetch('POST', '/v1/generate', payload, token);
    if (res.status === 401) { store.delete('ai-token'); return { error: '401' }; }
    return res.body;
  } catch(err) { return { error: err.message }; }
});

ipcMain.handle('save-image', async (e, { base64Data, defaultFilename }) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  try {
    const downloadDir = store.get('downloadDirectory') || app.getPath('downloads');
    const safeFilename = (defaultFilename || 'generated-image.png').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = getUniqueSavePath(downloadDir, safeFilename);

    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath, filename: path.basename(filePath) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Streaming Generate ──
ipcMain.handle('ai-generate-stream', async (e, payload) => {
  const token = store.get('ai-token');
  const sender = e.sender;
  if (!token) {
    sender.send('ai-stream-error', 'Not authenticated');
    return;
  }

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
      store.delete('ai-token');
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
          sender.send('ai-stream-done');
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) sender.send('ai-stream-chunk', text);
          // Check for error event in stream
          if (parsed?.error) sender.send('ai-stream-error', parsed.error);
        } catch {}
      }
    });
    res.on('end', () => sender.send('ai-stream-done'));
    res.on('error', (err) => sender.send('ai-stream-error', err.message));
  });

  req.on('error', (err) => sender.send('ai-stream-error', err.message));
  req.on('timeout', () => { req.destroy(); sender.send('ai-stream-error', 'Stream timed out'); });
  req.write(bodyStr);
  req.end();
});

// ── Logs ──
ipcMain.handle('ai-get-logs', async (e, params = {}) => {
  const token = store.get('ai-token');
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

// ── Page Text Extraction ──
ipcMain.handle('ai-get-page-text', async (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
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
      } catch (e) {
        console.error('Failed to detach BrowerView:', e);
      }
    }
  }
}

ipcMain.handle('ai-get-page-dom', async (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return '[]';
  const targetId = tabId || winEntry.activeTabId;
  if (!targetId) return '[]';
  const tab = winEntry.tabs.find(t => t.id === targetId);
  if (!tab) return '[]';
  try {
    const domJSON = await executeWithAttachedView(winEntry, tab, async () => {
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

function isAuthorizedSender(sender) {
  try {
    const url = sender.getURL();
    return url.startsWith('file://') && url.includes('index.html');
  } catch (e) {
    return false;
  }
}

ipcMain.handle('ai-execute-page-action', async (e, payload) => {
  if (!isAuthorizedSender(e.sender)) {
    return { success: false, error: 'Unauthorized IPC access.' };
  }
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return { success: false, error: 'No active window found' };
  
  const script = typeof payload === 'string' ? payload : payload.script;
  const tabId = typeof payload === 'object' ? payload.tabId : null;

  const targetId = tabId || winEntry.activeTabId;
  if (!targetId) return { success: false, error: 'No active tab found' };
  const tab = winEntry.tabs.find(t => t.id === targetId);
  if (!tab) return { success: false, error: 'Tab not found' };
  try {
    const result = await executeWithAttachedView(winEntry, tab, async () => {
      return await tab.view.webContents.executeJavaScript(script);
    });
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Track mouse state in main.js
let lastMouseX = 0;
let lastMouseY = 0;

async function moveMouseHumanized(dbg, startX, startY, endX, endY) {
  // Generate a control point for natural curved trajectory
  const controlX = startX + (endX - startX) / 2 + (Math.random() - 0.5) * 150;
  const controlY = startY + (endY - startY) / 2 + (Math.random() - 0.5) * 150;
  
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Quadratic Bezier formula
    const x = Math.round((1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * endX);
    const y = Math.round((1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY);
    
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await new Promise(r => setTimeout(r, 10 + Math.random() * 8)); // minor delay between move steps
  }
}

// Native CDP Debugger helper methods for OS-level input simulation
async function cdpClick(webContents, x, y) {
  const dbg = webContents.debugger;
  const isAttached = dbg.isAttached();
  if (!isAttached) {
    dbg.attach();
  }
  try {
    // Humanized Bezier pathing to coordinate
    await moveMouseHumanized(dbg, lastMouseX, lastMouseY, x, y);
    lastMouseX = x;
    lastMouseY = y;

    // Press down
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    // Hold click (50ms - 80ms)
    await new Promise(r => setTimeout(r, 50 + Math.random() * 30));
    // Release click
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return true;
  } catch (err) {
    console.error('CDP click failed:', err);
    return false;
  } finally {
    if (!isAttached) {
      try { dbg.detach(); } catch (e) {}
    }
  }
}

async function cdpType(webContents, text) {
  const dbg = webContents.debugger;
  const isAttached = dbg.isAttached();
  if (!isAttached) {
    dbg.attach();
  }
  try {
    // Typist Jitter Simulator (50ms - 150ms delays with keydown/keyup events)
    for (const char of text) {
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        unmodifiedText: char,
        key: char
      });
      await dbg.sendCommand('Input.insertText', { text: char });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char
      });
      await new Promise(r => setTimeout(r, 45 + Math.random() * 85));
    }
    return true;
  } catch (err) {
    console.error('CDP type failed:', err);
    return false;
  } finally {
    if (!isAttached) {
      try { dbg.detach(); } catch (e) {}
    }
  }
}

async function cdpPressKey(webContents, key) {
  const dbg = webContents.debugger;
  const isAttached = dbg.isAttached();
  if (!isAttached) {
    dbg.attach();
  }
  try {
    let windowsVirtualKeyCode = 0;
    let text = '';
    let code = '';
    let useChar = false;

    if (key === 'Enter') {
      windowsVirtualKeyCode = 13;
      text = '\r';
      code = 'Enter';
      useChar = true;
    } else if (key === 'Backspace') {
      windowsVirtualKeyCode = 8;
      code = 'Backspace';
    } else if (key === 'Tab') {
      windowsVirtualKeyCode = 9;
      code = 'Tab';
    } else if (key === 'Escape') {
      windowsVirtualKeyCode = 27;
      code = 'Escape';
    } else if (key === 'ArrowDown') {
      windowsVirtualKeyCode = 40;
      code = 'ArrowDown';
    } else if (key === 'ArrowUp') {
      windowsVirtualKeyCode = 38;
      code = 'ArrowUp';
    } else if (key === 'ArrowLeft') {
      windowsVirtualKeyCode = 37;
      code = 'ArrowLeft';
    } else if (key === 'ArrowRight') {
      windowsVirtualKeyCode = 39;
      code = 'ArrowRight';
    }

    if (useChar) {
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        windowsVirtualKeyCode,
        key,
        code,
        text,
        unmodifiedText: text
      });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'char',
        windowsVirtualKeyCode,
        key,
        code,
        text,
        unmodifiedText: text
      });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode,
        key,
        code
      });
    } else {
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        windowsVirtualKeyCode,
        key,
        code,
        text,
        unmodifiedText: text
      });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode,
        key,
        code
      });
    }
    return true;
  } catch (err) {
    console.error('CDP press key failed:', err);
    return false;
  } finally {
    if (!isAttached) {
      try { dbg.detach(); } catch (e) {}
    }
  }
}

ipcMain.handle('ai-cdp-click', async (e, { tabId, x, y }) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return { success: false, error: 'Window not found' };
  const targetId = tabId || winEntry.activeTabId;
  const tab = winEntry.tabs.find(t => t.id === targetId);
  if (!tab) return { success: false, error: 'Tab not found' };

  try {
    const success = await executeWithAttachedView(winEntry, tab, async () => {
      return await cdpClick(tab.view.webContents, x, y);
    });
    return { success };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ai-cdp-type', async (e, { tabId, text }) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return { success: false, error: 'Window not found' };
  const targetId = tabId || winEntry.activeTabId;
  const tab = winEntry.tabs.find(t => t.id === targetId);
  if (!tab) return { success: false, error: 'Tab not found' };

  try {
    const success = await executeWithAttachedView(winEntry, tab, async () => {
      return await cdpType(tab.view.webContents, text);
    });
    return { success };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ai-cdp-press-key', async (e, { tabId, key }) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return { success: false, error: 'Window not found' };
  const targetId = tabId || winEntry.activeTabId;
  const tab = winEntry.tabs.find(t => t.id === targetId);
  if (!tab) return { success: false, error: 'Tab not found' };

  try {
    const success = await executeWithAttachedView(winEntry, tab, async () => {
      return await cdpPressKey(tab.view.webContents, key);
    });
    return { success };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ai-is-tab-loading', (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry) return false;
  const id = tabId || winEntry.activeTabId;
  const tab = winEntry.tabs.find(t => t.id === id);
  return tab ? tab.loading || tab.view.webContents.isLoading() : false;
});

ipcMain.handle('ai-set-worker-tab', (e, tabId) => {
  const winEntry = getWindowEntry(e.sender);
  if (winEntry) {
    winEntry.workerTabId = tabId;
    if (tabId) {
      const workerTab = winEntry.tabs.find(t => t.id === tabId);
      if (workerTab) {
        try { winEntry.win.addBrowserView(workerTab.view); } catch (e) {}
      }
    }
    updateActiveViewBounds(winEntry.win.id);
  }
});

ipcMain.handle('ai-save-file', async (e, { filename, content }) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  try {
    const downloadsPath = app.getPath('downloads');
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = path.join(downloadsPath, safeFilename);

    // Security check: Path traversal prevention
    if (!filePath.startsWith(downloadsPath)) {
      return { success: false, error: 'Path traversal detected.' };
    }

    // Security check: Block executable/script files
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

// ── Helper function to download tools securely ──
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
    const blockedExtensions = ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.vbe', '.jse', '.wsf', '.wsh', '.msc', '.lnk', '.sh', '.msi', '.com', '.scr', '.hta', '.cpl', '.pif', '.jar', '.sys', '.reg', '.inf'];
    if (blockedExtensions.includes(ext)) {
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
        const redirectUrl = res.headers.location;
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

// ── Helper function to submit tickets with multipart ──
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
      const imgBuffer = Buffer.from(screenshotBase64, 'base64');
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
    const blockedExtensions = ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.vbe', '.jse', '.wsf', '.wsh', '.msc', '.lnk', '.sh', '.msi', '.com', '.scr', '.hta', '.cpl', '.pif', '.jar', '.sys', '.reg', '.inf'];
    if (blockedExtensions.includes(ext)) {
      resolve({ success: false, error: 'File type blocked for security reasons.' });
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(filePath);
    const req = lib.get(urlStr, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        file.close();
        try { fs.unlinkSync(filePath); } catch(e){}
        downloadUrlToFile(redirectUrl, resolve);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(filePath); } catch(e){}
        resolve({ success: false, error: `HTTP status ${res.statusCode}` });
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

ipcMain.handle('ai-download-file', async (e, urlStr) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  return new Promise((resolve) => {
    downloadUrlToFile(urlStr, resolve);
  });
});

ipcMain.handle('ai-save-state', async (e) => {
  try {
    const winEntry = getWindowEntry(e.sender);
    if (!winEntry) return { success: false, error: 'No active window' };
    
    const tabStates = winEntry.tabs.map(t => ({
      url: t.url,
      title: t.title
    }));
    
    store.set('ai-saved-browser-state', {
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
    const winEntry = getWindowEntry(e.sender);
    if (!winEntry) return { success: false, error: 'No active window' };
    
    const savedState = store.get('ai-saved-browser-state');
    if (!savedState || !savedState.tabs || savedState.tabs.length === 0) {
      return { success: false, error: 'No saved state found' };
    }
    
    const originalTabs = [...winEntry.tabs];
    
    const createdTabIds = [];
    for (const t of savedState.tabs) {
      const id = createTab(winEntry.win.id, t.url);
      createdTabIds.push(id);
    }
    
    for (const t of originalTabs) {
      closeTab(winEntry.win.id, t.id);
    }
    
    if (createdTabIds.length > 0) {
      const activeIdx = savedState.tabs.findIndex(t => t.url === savedState.activeTabUrl);
      const targetTabId = activeIdx !== -1 ? createdTabIds[activeIdx] : createdTabIds[0];
      setActiveTab(winEntry.win.id, targetTabId);
    }
    
    return { success: true, restoredCount: createdTabIds.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


// ── Document Analysis ──
ipcMain.handle('ai-analyse-document', async (e, { filePath, mimeType, name }) => {
  const token = store.get('ai-token');
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

// ── Tools Marketplace ──
ipcMain.handle('ai-get-tools', async (e) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  const token = store.get('ai-token');
  if (!token) return { items: [] };
  try {
    const res = await aiFetch('GET', '/v1/tools?limit=100', null, token);
    return res.body;
  } catch { return { items: [] }; }
});

ipcMain.handle('ai-download-tool', async (e, { id, filename, type }) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  const token = store.get('ai-token');
  if (!token) return { error: 'Not authenticated' };

  return new Promise((resolve) => {
    downloadToolToFile(id, filename, token, resolve);
  });
});

// ── Semantic Search ──
// Stores page embeddings in electron-store, cosine-similarity search
ipcMain.handle('ai-index-page', async (e, { url, title, text }) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  const token = store.get('ai-token');
  if (!token || !text || text.length < 100) return;
  try {
    const snippet = text.slice(0, 4000); // keep within limits
    const res = await aiFetch('POST', '/v1/embeddings', { text: snippet }, token);
    if (res.body && res.body.embedding) {
      const cache = store.get('ai-page-embeddings', {});
      // Cap at 500 entries
      const keys = Object.keys(cache);
      if (keys.length >= 500) delete cache[keys[0]];
      cache[url] = {
        title,
        embedding: res.body.embedding.values,
        snippet: text.slice(0, 300),
        indexedAt: Date.now()
      };
      store.set('ai-page-embeddings', cache);
    }
  } catch {}
});

ipcMain.handle('ai-semantic-search', async (e, query) => {
  if (!isAuthorizedSender(e.sender)) return [];
  const token = store.get('ai-token');
  if (!token || !query) return [];
  try {
    const res = await aiFetch('POST', '/v1/embeddings', { text: query }, token);
    if (!res.body || !res.body.embedding) return [];
    const qVec = res.body.embedding.values;
    const cache = store.get('ai-page-embeddings', {});

    const results = Object.entries(cache).map(([url, entry]) => {
      const score = cosineSim(qVec, entry.embedding);
      return { url, title: entry.title, snippet: entry.snippet, score };
    });
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 8);
  } catch { return []; }
});

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom ? dot / denom : 0;
}

// ── Context Menu from tab (ai-tab-context-action) ──
ipcMain.on('ai-tab-context-action', (e, data) => {
  // Forward to all main windows
  for (const entry of windows.values()) {
    entry.win.webContents.send('ai-context-action', data);
  }
});

// ── Page indexing from tab (semantic search) ──
ipcMain.on('ai-index-page-from-tab', async (e, { url, title, text }) => {
  const tabInfo = getTabByWebContents(e.sender);
  if (!tabInfo) return; // unauthorized or not a browser tab
  const token = store.get('ai-token');
  if (!token || !text || text.length < 100 || !url || url.startsWith('about:')) return;
  try {
    const snippet = text.slice(0, 4000);
    const res = await aiFetch('POST', '/v1/embeddings', { text: snippet }, token);
    if (res.body && res.body.embedding) {
      const cache = store.get('ai-page-embeddings', {});
      const keys = Object.keys(cache);
      if (keys.length >= 500) delete cache[keys[0]];
      cache[url] = {
        title: title || url,
        embedding: res.body.embedding.values,
        snippet: text.slice(0, 300),
        indexedAt: Date.now()
      };
      store.set('ai-page-embeddings', cache);
    }
  } catch {}
});

ipcMain.handle('ai-get-page-screenshot', async (e, tabId) => {
  if (!isAuthorizedSender(e.sender)) return { error: 'Unauthorized IPC access.' };
  let targetTab = null;
  let targetWinEntry = null;
  for (const entry of windows.values()) {
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
    const result = await executeWithAttachedView(targetWinEntry, targetTab, async () => {
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
  const token = store.get('ai-token');
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

ipcMain.handle('ai-submit-ticket', async (e, payload) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  const token = store.get('ai-token');
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const res = await submitTicket(payload, token);
    return res.body;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ai-get-tickets', async (e) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  const token = store.get('ai-token');
  if (!token) return { success: false, error: 'Not authenticated' };
  try {
    const res = await aiFetch('GET', '/v1/tickets', null, token);
    return res.body;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ----------------------------------------------------
// App Lifecycle
// ----------------------------------------------------

function setupAdBlocker() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (!adBlockerEnabled) {
      callback({ cancel: false });
      return;
    }

    try {
      const url = new URL(details.url);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.toLowerCase();

      // Check hosts
      const isAdHost = AD_PATTERNS.some(domain => host.includes(domain));
      // Check for common ad script patterns in path
      const isAdPath = path.includes('/ads.js') || 
                       path.includes('/adsbygoogle') || 
                       path.includes('/adframe') || 
                       path.includes('google-analytics');

      if (isAdHost || isAdPath) {
        console.log(`[AdBlocker] Blocked request to: ${details.url}`);
        adsBlockedToday++;
        store.set('adsBlockedToday', adsBlockedToday);
        broadcastStats();
        callback({ cancel: true });
        return;
      }
    } catch (e) {
      // ignore invalid URLs
    }

    callback({ cancel: false });
  });
}

function updateAlwaysOnTopState(enabled) {
  BrowserWindow.getAllWindows().forEach(w => {
    try {
      w.setAlwaysOnTop(enabled);
    } catch (e) {
      console.error('Failed to set always on top:', e);
    }
  });
}

app.whenReady().then(() => {
  setupAdBlocker();
  
  // Content security sharing policies
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Find if the webContents that sent the request is a main window
    const requestingWebContents = request.webContents;
    const isMainWindow = Array.from(windows.values()).some(w => w.win.webContents === requestingWebContents);
    
    if (isMainWindow) {
      // Always allow the main browser shell to capture desktop audio/video for routing
      callback({
        video: request.videoRequested ? request.videoRequested : null,
        audio: request.audioRequested ? request.audioRequested : null
      });
      return;
    }

    // Check if this guest tab has active virtual audio routing
    const tabRes = getTabByWebContents(requestingWebContents);
    if (tabRes) {
      const resolved = resolveAudioSettingsForTab(tabRes.tab);
      if (resolved && resolved.enabled) {
        // Automatically allow loopback capture request
        callback({
          video: request.videoRequested ? request.videoRequested : null,
          audio: request.audioRequested ? request.audioRequested : null
        });
        return;
      }
    }

    // For websites, block display media requests if content protection is active
    if (store.get('contentProtection', true)) {
      callback({ video: null, audio: null });
    } else {
      callback({
        video: request.videoRequested ? request.videoRequested : null,
        audio: request.audioRequested ? request.audioRequested : null
      });
    }
  });

  // Default permissions request logic
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    // Automatically grant permissions to the main browser UI shell
    const isMainWindow = Array.from(windows.values()).some(w => w.win.webContents === webContents);
    if (isMainWindow) {
      callback(true);
      return;
    }

    // Auto grant permission if active tab virtual routing is enabled
    const tabRes = getTabByWebContents(webContents);
    if (tabRes) {
      const resolved = resolveAudioSettingsForTab(tabRes.tab);
      if (resolved && resolved.enabled) {
        callback(true);
        return;
      }
    }

    const allowed = store.get('permissions', {
      media: true,
      notifications: true,
      geolocation: false
    });

    if (permission === 'media') {
      callback(allowed.media);
    } else if (permission === 'notifications') {
      callback(allowed.notifications);
    } else if (permission === 'geolocation') {
      callback(allowed.geolocation);
    } else {
      callback(false);
    }
  });

  // Intercept media device requests to route mic input dynamically
  session.defaultSession.on('select-media-device', (event, webContents, callback, deviceList) => {
    event.preventDefault();
    
    if (micRoutingSource === 'system') {
      const virtualDevice = deviceList.find(d => 
        d.label.toLowerCase().includes('cable') || 
        d.label.toLowerCase().includes('stereo mix') || 
        d.label.toLowerCase().includes('what u hear') || 
        d.label.toLowerCase().includes('virtual')
      );
      
      if (virtualDevice) {
        callback(virtualDevice.deviceId);
        return;
      }
    }
    
    const physicalMic = deviceList.find(d => 
      d.label.toLowerCase().includes('microphone') || 
      d.label.toLowerCase().includes('mic')
    );
    if (physicalMic) {
      callback(physicalMic.deviceId);
    } else if (deviceList.length > 0) {
      callback(deviceList[0].deviceId);
    } else {
      callback('');
    }
  });

  // Handle downloads across normal and incognito sessions
  app.on('session-created', (ses) => {
    registerDownloadHandler(ses);
  });
  registerDownloadHandler(session.defaultSession);

  function registerDownloadHandler(ses) {
    ses.on('will-download', (event, item, webContents) => {
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      const fileName = item.getFilename();
      const total = item.getTotalBytes();
      
      const downloadDir = store.get('downloadDirectory') || app.getPath('downloads');
      const savePath = getUniqueSavePath(downloadDir, fileName);
      item.setSavePath(savePath);

      activeDownloads.set(id, item);

      const win = BrowserWindow.fromWebContents(webContents);
      if (win) {
        win.webContents.send('download-started', { id, fileName, total, savePath });
      }

      item.on('updated', (evt, state) => {
        const received = item.getReceivedBytes();
        if (win) {
          win.webContents.send('download-updated', {
            id,
            fileName,
            received,
            total,
            state: state === 'interrupted' ? 'paused' : state
          });
        }
      });

      item.once('done', (evt, state) => {
        activeDownloads.delete(id);
        if (win) {
          win.webContents.send('download-completed', { id, fileName, savePath, state });
        }
      });
    });
  }

  // Build minimal native application menu
  const template = [
    {
      label: 'Application',
      submenu: [
        { label: 'New Window', accelerator: 'Ctrl+N', click() { createMainWindow(); } },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Initialize System Tray and Global Shortcut
  if (browserMode === 'tray') {
    createTray();
  }
  registerGlobalToggleShortcut();

  // Create initial window
  const initialWin = createMainWindow();
  
  // Wait for load to create tab
  initialWin.webContents.once('did-finish-load', () => {
    createTab(initialWin.id, 'about:blank');
  });
});

// --- SECURE CREDENTIALS STORAGE API ---
const credentialStore = new Store({ name: 'secure-credentials' });

ipcMain.handle('save-credential', async (e, { domain, username, password }) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  try {
    if (!domain || !username || !password) {
      return { success: false, error: 'Missing required parameters: domain, username, or password' };
    }

    const key = `${domain.toLowerCase()}:${username}`;
    let storedPassword = password;

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(password);
      storedPassword = encrypted.toString('hex');
    } else {
      console.warn('Encryption is not available on this host. Saving in plain text (fallback).');
    }

    const credentials = credentialStore.get('credentials', {});
    credentials[key] = {
      domain: domain.toLowerCase(),
      username,
      password: storedPassword,
      encrypted: safeStorage.isEncryptionAvailable()
    };
    credentialStore.set('credentials', credentials);
    return { success: true, key };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('list-credentials', async (e) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  try {
    const credentials = credentialStore.get('credentials', {});
    const list = Object.entries(credentials).map(([key, data]) => ({
      key,
      domain: data.domain,
      username: data.username
    }));
    return { success: true, list };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-credential', async (e, key) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  try {
    const credentials = credentialStore.get('credentials', {});
    const data = credentials[key];
    if (!data) return { success: false, error: 'Credential not found' };

    let decryptedPassword = data.password;
    if (data.encrypted && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(data.password, 'hex');
      decryptedPassword = safeStorage.decryptString(buf);
    }
    return {
      success: true,
      credential: {
        domain: data.domain,
        username: data.username,
        password: decryptedPassword
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-credential', async (e, key) => {
  if (!isAuthorizedSender(e.sender)) return { success: false, error: 'Unauthorized IPC access.' };
  try {
    const credentials = credentialStore.get('credentials', {});
    if (!credentials[key]) return { success: false, error: 'Credential not found' };
    delete credentials[key];
    credentialStore.set('credentials', credentials);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (browserMode === 'taskbar') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
