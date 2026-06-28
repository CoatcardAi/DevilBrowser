const { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const state = require('./state');

let tray = null;

function getWindowEntry(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win) return null;
  return state.windows.get(win.id);
}

function toggleWindowVisibility() {
  const entries = Array.from(state.windows.values());
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
  let shortcuts = state.store.get('shortcuts', {});
  if (!shortcuts['toggle-window'] || shortcuts['toggle-window'] === 'Control+B') {
    shortcuts['toggle-window'] = 'Alt+B';
    state.store.set('shortcuts', shortcuts);
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
      const entries = Array.from(state.windows.values());
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
      const entries = Array.from(state.windows.values());
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
    skipTaskbar: state.browserMode === 'tray',
    titleBarStyle: useFrameless ? 'hidden' : 'default',
    titleBarOverlay: useFrameless ? {
      color: '#0b0f19',
      symbolColor: '#a5b4fc',
      height: 38
    } : false,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'src', 'preloads', 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      partition: isIncognito ? 'incognito_session_' + Date.now() : undefined
    }
  });

  win.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'index.html'));

  const winId = win.id;
  state.windows.set(winId, {
    win,
    tabs: [],
    activeTabId: null,
    closedTabsHistory: [],
    toolbarHeight: 110,
    rightMargin: 0,
    hudWindow: null,
    isIncognito
  });

  // Apply saved content protection preference on startup (default true)
  const contentProtection = state.store.get('contentProtection', true);
  try {
    win.setContentProtection(contentProtection);
  } catch (e) {
    console.error('Failed to set content protection:', e);
  }

  // Apply saved always on top preference on startup (default false)
  const alwaysOnTop = state.store.get('alwaysOnTopEnabled', false);
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
      const entry = state.windows.get(winId);
      const isIncognitoWin = entry && entry.isIncognito;
      if (state.browserMode === 'tray' && !isIncognitoWin) {
        event.preventDefault();
        win.minimize();
        win.hide();
      }
    }
  });

  win.on('closed', () => {
    const data = state.windows.get(winId);
    if (data) {
      if (data.hudWindow && !data.hudWindow.isDestroyed()) {
        try { data.hudWindow.destroy(); } catch (e) {}
      }
      for (const t of data.tabs) {
        try {
          t.view.webContents.destroy();
        } catch (e) {}
      }
      state.windows.delete(winId);
    }
  });

  win.on('resize', () => {
    const tabManager = require('./tab-manager');
    tabManager.updateActiveViewBounds(winId);
  });

  win.on('minimize', () => {
    const entry = state.windows.get(winId);
    if (entry && entry.hudWindow && !entry.hudWindow.isDestroyed()) {
      entry.minimizedWhileWorking = true;
      win.hide();
    }
  });

  win.on('restore', () => {
    const entry = state.windows.get(winId);
    if (entry) {
      entry.minimizedWhileWorking = false;
    }
  });

  win.on('show', () => {
    const entry = state.windows.get(winId);
    if (entry) {
      entry.minimizedWhileWorking = false;
    }
  });

  // Main window keyboard interceptor
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type.toLowerCase() !== 'keydown') return;
    const entry = state.windows.get(winId);
    if (!entry) return;
    const accelerator = getAcceleratorString(input);
    const handled = handleShortcutAction(entry, accelerator);
    if (handled) {
      event.preventDefault();
    }
  });

  return win;
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
  const tabManager = require('./tab-manager');
  const preferences = require('./preferences');

  // 1. Static shortcuts (always active, hardcoded)
  if (normAcc === 'control+tab') {
    const activeIdx = winEntry.tabs.findIndex(t => t.id === winEntry.activeTabId);
    if (activeIdx !== -1 && winEntry.tabs.length > 1) {
      const nextIdx = (activeIdx + 1) % winEntry.tabs.length;
      tabManager.setActiveTab(winId, winEntry.tabs[nextIdx].id);
    }
    return true;
  }
  
  if (normAcc === 'control+shift+tab') {
    const activeIdx = winEntry.tabs.findIndex(t => t.id === winEntry.activeTabId);
    if (activeIdx !== -1 && winEntry.tabs.length > 1) {
      const prevIdx = (activeIdx - 1 + winEntry.tabs.length) % winEntry.tabs.length;
      tabManager.setActiveTab(winId, winEntry.tabs[prevIdx].id);
    }
    return true;
  }
  
  if (/^control\+[1-8]$/.test(normAcc)) {
    const tabNum = parseInt(normAcc.split('+').pop());
    if (winEntry.tabs.length >= tabNum) {
      tabManager.setActiveTab(winId, winEntry.tabs[tabNum - 1].id);
    }
    return true;
  }
  
  if (normAcc === 'control+9') {
    if (winEntry.tabs.length > 0) {
      tabManager.setActiveTab(winId, winEntry.tabs[winEntry.tabs.length - 1].id);
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
  if (normAcc === 'alt+p') {
    winEntry.win.webContents.send('shortcut-toggle-protection');
    return true;
  }

  // 2. Customizable shortcuts (merged from store and defaults)
  const shortcuts = state.store.get('shortcuts', {
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
      tabManager.createTab(winId, 'about:blank');
      winEntry.win.webContents.send('focus-address-bar');
      break;
    case 'close-tab':
      if (winEntry.activeTabId) {
        tabManager.closeTab(winId, winEntry.activeTabId);
      }
      break;
    case 'reopen-tab':
      if (winEntry.closedTabsHistory.length > 0) {
        const url = winEntry.closedTabsHistory.pop();
        tabManager.createTab(winId, url);
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
      const adBlockState = !state.adBlockerEnabled;
      state.adBlockerEnabled = adBlockState;
      winEntry.win.webContents.send('adblocker-state-changed', adBlockState);
      break;
    }
    case 'toggle-always-ontop': {
      const ontTopState = !state.alwaysOnTopEnabled;
      state.alwaysOnTopEnabled = ontTopState;
      preferences.updateAlwaysOnTopState(ontTopState);
      winEntry.win.webContents.send('always-ontop-state-changed', ontTopState);
      break;
    }
    default:
      return false;
  }
  return true;
}

module.exports = {
  createMainWindow,
  createTray,
  registerGlobalToggleShortcut,
  getWindowEntry,
  toggleWindowVisibility,
  getTray: () => tray,
  getAcceleratorString,
  handleShortcutAction
};
