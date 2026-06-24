const { app, BrowserWindow, BrowserView, ipcMain, Menu, dialog, session, desktopCapturer, Tray, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { execFile } = require('child_process');

const store = new Store({ name: 'user-preferences' });

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
    skipTaskbar: true,
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
    toolbarHeight: 138,
    rightMargin: 0
  });

  // Apply saved content protection preference on startup (default true)
  const contentProtection = store.get('contentProtection', true);
  try {
    win.setContentProtection(contentProtection);
  } catch (e) {
    console.error('Failed to set content protection:', e);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.minimize();
      win.hide();
    }
  });

  win.on('closed', () => {
    const data = windows.get(winId);
    if (data) {
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
}

function createTab(winId, url) {
  const data = windows.get(winId);
  if (!data) return null;

  const tabId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
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
    if (v !== targetTab.view) {
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
    'add-bookmark': 'Control+d'
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
  shortcuts: store.get('shortcuts', {
    'new-tab': 'Control+t',
    'close-tab': 'Control+w',
    'reopen-tab': 'Control+Shift+t',
    'refresh': 'Control+r',
    'focus-address': 'Control+l',
    'new-window': 'Control+n',
    'dev-tools': 'Control+Shift+i',
    'add-bookmark': 'Control+d'
  }),
  permissions: store.get('permissions', {
    media: true,
    notifications: true,
    geolocation: false
  }),
  platform: process.platform
}));

ipcMain.handle('save-preferences', (e, prefs) => {
  if (prefs.shortcuts) store.set('shortcuts', prefs.shortcuts);
  if (prefs.permissions) store.set('permissions', prefs.permissions);
  return { success: true };
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

// ----------------------------------------------------
// AI Integration — IPC Handlers
// ----------------------------------------------------

const AI_BASE = 'https://aimagicbackend.onrender.com';
const https = require('https');
const http  = require('http');
const fs    = require('fs');

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
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { success: false, error: 'Window not found' };
    
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('downloads'), defaultFilename || 'generated-image.png'),
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]
    });
    
    if (canceled || !filePath) {
      return { success: false, error: 'Canceled' };
    }
    
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
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
ipcMain.handle('ai-get-page-text', async (e) => {
  // Find the active tab's webContents
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry || !winEntry.activeTabId) return '';
  const tab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
  if (!tab) return '';
  try {
    const text = await tab.view.webContents.executeJavaScript(
      `(function(){ return document.body ? document.body.innerText.slice(0, 50000) : ''; })()`
    );
    return text || '';
  } catch { return ''; }
});

ipcMain.handle('ai-get-page-dom', async (e) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry || !winEntry.activeTabId) return '[]';
  const tab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
  if (!tab) return '[]';
  try {
    const domJSON = await tab.view.webContents.executeJavaScript(`
      (function() {
        const els = Array.from(document.querySelectorAll('input, textarea, select, button, [role="button"], a'));
        return JSON.stringify(els.map(el => ({
          tagName: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('type') || null,
          id: el.id || null,
          name: el.name || el.getAttribute('name') || null,
          placeholder: el.placeholder || el.getAttribute('placeholder') || null,
          labelText: el.labels && el.labels.length > 0 ? el.labels[0].innerText : (el.closest('label') ? el.closest('label').innerText : null),
          innerText: (el.innerText || '').trim().slice(0, 100),
          value: el.value || null,
          role: el.getAttribute('role') || null,
          ariaLabel: el.getAttribute('aria-label') || null
        })));
      })()
    `);
    return domJSON || '[]';
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
});

ipcMain.handle('ai-execute-page-action', async (e, script) => {
  const winEntry = getWindowEntry(e.sender);
  if (!winEntry || !winEntry.activeTabId) return { success: false, error: 'No active window/tab found' };
  const tab = winEntry.tabs.find(t => t.id === winEntry.activeTabId);
  if (!tab) return { success: false, error: 'No active tab found' };
  try {
    const result = await tab.view.webContents.executeJavaScript(script);
    return { success: true, result };
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
ipcMain.handle('ai-get-tools', async () => {
  const token = store.get('ai-token');
  if (!token) return { items: [] };
  try {
    const res = await aiFetch('GET', '/v1/tools?limit=100', null, token);
    return res.body;
  } catch { return { items: [] }; }
});

ipcMain.handle('ai-download-tool', async (e, { id, filename, type }) => {
  const token = store.get('ai-token');
  if (!token) return { error: 'Not authenticated' };
  const downloadPath = path.join(app.getPath('downloads'), filename);

  return new Promise((resolve) => {
    const url = new URL(AI_BASE + `/v1/tools/${id}/download`);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }, (res) => {
      if (res.statusCode === 302) {
        // External redirect — open in browser tab
        const winEntry = Array.from(windows.values())[0];
        if (winEntry) createTab(winEntry.win.id, res.headers.location);
        resolve({ success: true, type: 'external' });
        return;
      }
      const file = fs.createWriteStream(downloadPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve({ success: true, path: downloadPath }); });
      file.on('error', err => resolve({ error: err.message }));
    });
    req.on('error', err => resolve({ error: err.message }));
    req.end();
  });
});

// ── Semantic Search ──
// Stores page embeddings in electron-store, cosine-similarity search
ipcMain.handle('ai-index-page', async (e, { url, title, text }) => {
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

// ----------------------------------------------------
// App Lifecycle
// ----------------------------------------------------

app.whenReady().then(() => {
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

  // Handle downloads
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const fileName = item.getFilename();
    const total = item.getTotalBytes();
    const savePath = path.join(app.getPath('downloads'), fileName);
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
  createTray();
  globalShortcut.register('CommandOrControl+B', () => {
    toggleWindowVisibility();
  });

  // Create initial window
  const initialWin = createMainWindow();
  
  // Wait for load to create tab
  initialWin.webContents.once('did-finish-load', () => {
    createTab(initialWin.id, 'about:blank');
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Do not quit - let app run in system tray
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
