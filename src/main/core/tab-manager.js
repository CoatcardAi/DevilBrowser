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
    const windowManager = require('./window-manager');
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
        if (domain && !state.sitesVisitedToday.includes(domain)) {
          state.sitesVisitedToday.push(domain);
          state.store.set('sitesVisitedToday', state.sitesVisitedToday);
          state.broadcastStats();
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
    const accelerator = windowManager.getAcceleratorString(input);
    const handled = windowManager.handleShortcutAction(data, accelerator);
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
  const data = state.windows.get(winId);
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
    if (tabEntry) {
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
    if (tabEntry) {
      return tabEntry.view.webContents.isAudioMuted();
    }
    return false;
  });

  ipcMain.handle('navigate-tab', (e, { tabId, url }) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
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
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return;
    const t = winEntry.tabs.find(x => x.id === tabId);
    if (t && t.view.webContents.canGoBack()) {
      t.view.webContents.goBack();
    }
  });

  ipcMain.handle('tab-go-forward', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return;
    const t = winEntry.tabs.find(x => x.id === tabId);
    if (t && t.view.webContents.canGoForward()) {
      t.view.webContents.goForward();
    }
  });

  ipcMain.handle('tab-reload', (e, tabId) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return;
    const t = winEntry.tabs.find(x => x.id === tabId);
    if (t) {
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
