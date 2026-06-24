// ----------------------------------------------------
// UI Elements Cache
// ----------------------------------------------------
const tabsEl = document.getElementById('tabs');
const btnNew = document.getElementById('btn-newtab');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnRefresh = document.getElementById('btn-refresh');
const addressInput = document.getElementById('address');
const sslBadge = document.getElementById('ssl-badge');
const loadingBar = document.getElementById('loading-bar');
const loadingProgress = document.getElementById('loading-progress');
const bookmarksList = document.getElementById('bookmarks-list');
const bookmarksBar = document.getElementById('bookmarks-bar');

const btnDownloadsToggle = document.getElementById('btn-downloads-toggle');
const btnMicRoutingToggle = document.getElementById('btn-mic-routing-toggle');
const downloadBadge = document.getElementById('download-badge');
const downloadsPanel = document.getElementById('downloads-panel');
const downloadsList = document.getElementById('downloads-list');
const btnClearDownloads = document.getElementById('btn-clear-downloads');
const btnCloseDownloads = document.getElementById('btn-close-downloads');

const btnBookmarksToggle = document.getElementById('btn-bookmarks-manager-toggle');
const bookmarksPanel = document.getElementById('bookmarks-panel');
const bookmarksManagerList = document.getElementById('bookmarks-manager-list');
const bookmarksSearchInput = document.getElementById('bookmarks-search-input');
const toggleSemanticBookmarks = document.getElementById('toggle-semantic-bookmarks');
const btnCloseBookmarks = document.getElementById('btn-close-bookmarks');
const btnBookmarkPage = document.getElementById('btn-bookmark-page');

const btnSettings = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const btnCloseSettings = document.getElementById('btn-close-settings');

const toggleContentProtection = document.getElementById('toggle-content-protection');
const protectionStatusBadge = document.getElementById('protection-status-badge');
const statusProtection = document.getElementById('status-protection');
const toggleAdBlocker = document.getElementById('toggle-adblocker');
const toggleAlwaysOnTop = document.getElementById('toggle-always-ontop');

const selectVirtualDevice = document.getElementById('select-virtual-device');
const btnEnableRouting = document.getElementById('btn-enable-routing');
const btnDisableRouting = document.getElementById('btn-disable-routing');
const routingStatusText = document.getElementById('routing-status-text');
const routingSourceText = document.getElementById('routing-source-text');
const statusRouting = document.getElementById('status-routing');

const shortcutsListContainer = document.getElementById('shortcuts-list');
const btnResetShortcuts = document.getElementById('btn-reset-shortcuts');

const permMedia = document.getElementById('perm-media');
const permNotifications = document.getElementById('perm-notifications');
const permGeolocation = document.getElementById('perm-geolocation');
const btnClearCache = document.getElementById('btn-clear-cache');

const newTabPage = document.getElementById('new-tab-page');
const newTabSearch = document.getElementById('new-tab-search');
const currentTimeEl = document.getElementById('current-time');
const loopbackAudio = document.getElementById('loopback-audio');

const selectBrowserMode = document.getElementById('select-browser-mode');
const accountEmail = document.getElementById('account-email');
const accountPlan = document.getElementById('account-plan');
const btnSignOut = document.getElementById('btn-sign-out');
const valTabs = document.getElementById('val-tabs');
const valSites = document.getElementById('val-sites');
const valAds = document.getElementById('val-ads');
const valSession = document.getElementById('val-session');

const audioRoutingPopover = document.getElementById('audio-routing-popover');
const popoverRouteEnable = document.getElementById('popover-route-enable');
const popoverAudioSource = document.getElementById('popover-audio-source');
const popoverAudioDest = document.getElementById('popover-audio-dest');
const popoverStatusVal = document.getElementById('popover-status-val');

// ----------------------------------------------------
// Core Browser State
// ----------------------------------------------------
let tabs = [];
let activeTabId = null;
let bookmarks = [];
let downloads = [];
let preferences = {};
let recordingShortcutKey = null; // Stores action name when recording a shortcut
let audioLoopbackStream = null;

// Expose states dynamically to window for other panels (e.g. AI panel context)
Object.defineProperty(window, '_tabs', { get: () => tabs, configurable: true });
Object.defineProperty(window, '_activeTabId', { get: () => activeTabId, configurable: true });

const SHORTCUT_NAMES = {
  'new-tab': 'New Tab',
  'close-tab': 'Close Tab',
  'reopen-tab': 'Reopen Closed Tab',
  'refresh': 'Refresh Page',
  'focus-address': 'Focus Address Bar',
  'new-window': 'New Window',
  'dev-tools': 'Developer Tools',
  'add-bookmark': 'Toggle Bookmark',
  'toggle-adblocker': 'Toggle Ad Blocker',
  'toggle-always-ontop': 'Toggle Always Active Window',
  'toggle-window': 'Show/Hide Window (Global)'
};

// ----------------------------------------------------
// Tab & Window Management
// ----------------------------------------------------

function renderTabs() {
  tabsEl.innerHTML = '';
  tabs.forEach(tab => {
    const tabDiv = document.createElement('div');
    tabDiv.className = `tab ${tab.id === activeTabId ? 'active' : ''}`;
    tabDiv.dataset.id = tab.id;

    // Favicon
    const img = document.createElement('img');
    img.className = 'tab-favicon';
    img.src = tab.favicon || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path fill="%239aa0a6" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';
    tabDiv.appendChild(img);

    // Title
    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.innerText = tab.title || 'New Tab';
    tabDiv.appendChild(titleSpan);

    // Speaker Mute/Unmute button
    const muteBtn = document.createElement('span');
    muteBtn.className = `tab-mute-btn ${tab.muted ? 'muted' : 'unmuted'}`;
    
    // Premium SVG speaker icons
    const speakerIcon = `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    const speakerMutedIcon = `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;

    muteBtn.innerHTML = tab.muted ? speakerMutedIcon : speakerIcon;
    muteBtn.title = tab.muted ? 'Unmute Tab' : 'Mute Tab';

    muteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const nextMute = !tab.muted;
      const res = await window.electronAPI.setTabMuted(tab.id, nextMute);
      if (res.success) {
        tab.muted = nextMute;
        renderTabs();
        showToastNotification(`Tab: ${nextMute ? 'Muted' : 'Unmuted'}`);
      }
    });
    tabDiv.appendChild(muteBtn);

    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close Tab';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.electronAPI.closeTab(tab.id);
    });
    tabDiv.appendChild(closeBtn);

    // Switch tab on click
    tabDiv.addEventListener('click', () => {
      if (activeTabId !== tab.id) {
        window.electronAPI.setActiveTab(tab.id);
      }
    });

    // Double click to close
    tabDiv.addEventListener('dblclick', () => {
      window.electronAPI.closeTab(tab.id);
    });

    tabsEl.appendChild(tabDiv);
  });
}

function updateNavigationControls(tab) {
  if (!tab) {
    btnBack.disabled = true;
    btnForward.disabled = true;
    return;
  }
  btnBack.disabled = !tab.canGoBack;
  btnForward.disabled = !tab.canGoForward;
}

// ----------------------------------------------------
// Navigation / Search Handlers
// ----------------------------------------------------

function handleNavigationSubmit(url) {
  if (!url || !activeTabId) return;
  window.electronAPI.navigateTab({ tabId: activeTabId, url });
}

addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleNavigationSubmit(addressInput.value);
    addressInput.blur();
  }
});

addressInput.addEventListener('focus', () => {
  addressInput.select();
});

btnBack.addEventListener('click', () => {
  if (activeTabId) window.electronAPI.goBack(activeTabId);
});

btnForward.addEventListener('click', () => {
  if (activeTabId) window.electronAPI.goForward(activeTabId);
});

btnRefresh.addEventListener('click', () => {
  if (activeTabId) window.electronAPI.reload(activeTabId);
});

btnNew.addEventListener('click', () => {
  window.electronAPI.createTab('about:blank');
});

// New Tab Page search input
newTabSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleNavigationSubmit(newTabSearch.value);
  }
});

// Update SSL badge state
function updateSSLBadge(url) {
  if (!url || url === 'about:blank') {
    sslBadge.className = '';
    sslBadge.innerHTML = '';
    return;
  }
  if (url.startsWith('https:')) {
    sslBadge.className = 'secure';
    sslBadge.title = 'Connection is secure';
    sslBadge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;
  } else {
    sslBadge.className = 'unsecure';
    sslBadge.title = 'Connection is not secure';
    sslBadge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="#ef4444" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
  }
}

// ----------------------------------------------------
// Bookmarks Logic
// ----------------------------------------------------

async function loadBookmarks() {
  bookmarks = await window.electronAPI.getBookmarks();
  renderBookmarksBar();
  renderBookmarksManager();
  updateBookmarkStarState();
}

function renderBookmarksBar() {
  bookmarksList.innerHTML = '';
  bookmarks.forEach(bm => {
    const a = document.createElement('a');
    a.className = 'bookmark-item';
    a.href = '#';
    a.title = bm.title;
    
    const initial = bm.title ? bm.title.charAt(0).toUpperCase() : 'B';
    a.innerHTML = `<span class="bookmark-icon">${initial}</span> ${bm.title}`;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      handleNavigationSubmit(bm.url);
    });
    bookmarksList.appendChild(a);
  });
}

async function renderBookmarksManager() {
  bookmarksManagerList.innerHTML = '';
  const query = bookmarksSearchInput.value.trim();

  if (toggleSemanticBookmarks && toggleSemanticBookmarks.checked) {
    if (!query) {
      bookmarksManagerList.innerHTML = `<div class="no-bookmarks">Type a search phrase (e.g. "React layout tutorial") to search visited history pages semantically.</div>`;
      return;
    }
    
    bookmarksManagerList.innerHTML = `<div class="no-bookmarks">Searching semantic vector database...</div>`;
    try {
      const results = await window.electronAPI.aiSemanticSearch(query);
      bookmarksManagerList.innerHTML = '';
      if (!results || results.length === 0) {
        bookmarksManagerList.innerHTML = `<div class="no-bookmarks">No matches found for "${query}"</div>`;
        return;
      }
      
      results.forEach(res => {
        const card = document.createElement('div');
        card.className = 'bookmark-manager-card semantic-card';
        const scorePct = Math.round(res.score * 100);
        card.innerHTML = `
          <div class="bookmark-manager-info">
            <span class="bookmark-manager-title">${res.title} <span class="similarity-badge">${scorePct}% Match</span></span>
            <span class="bookmark-manager-url">${res.url}</span>
            <span class="bookmark-manager-snippet">${res.snippet || ''}</span>
          </div>
        `;
        card.addEventListener('click', () => {
          handleNavigationSubmit(res.url);
          bookmarksPanel.classList.add('hidden');
        });
        bookmarksManagerList.appendChild(card);
      });
    } catch (e) {
      bookmarksManagerList.innerHTML = `<div class="no-bookmarks">⚠️ Error during semantic search: ${e.message}</div>`;
    }
    return;
  }

  // Standard keyword matching
  const lowerQuery = query.toLowerCase();
  const filtered = bookmarks.filter(bm => 
    bm.title.toLowerCase().includes(lowerQuery) || 
    bm.url.toLowerCase().includes(lowerQuery)
  );

  if (filtered.length === 0) {
    bookmarksManagerList.innerHTML = `<div class="no-bookmarks">No matching bookmarks found</div>`;
    return;
  }

  filtered.forEach(bm => {
    const card = document.createElement('div');
    card.className = 'bookmark-manager-card';
    card.innerHTML = `
      <div class="bookmark-manager-info">
        <span class="bookmark-manager-title">${bm.title}</span>
        <span class="bookmark-manager-url">${bm.url}</span>
      </div>
      <button class="bookmark-manager-delete" title="Delete Bookmark">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    `;
    card.querySelector('.bookmark-manager-delete').addEventListener('click', async () => {
      bookmarks = bookmarks.filter(x => x.id !== bm.id);
      await window.electronAPI.saveBookmarks(bookmarks);
      loadBookmarks();
    });
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.bookmark-manager-delete')) {
        handleNavigationSubmit(bm.url);
        bookmarksPanel.classList.add('hidden');
      }
    });
    bookmarksManagerList.appendChild(card);
  });
}

async function toggleBookmarkActiveTab() {
  if (!activeTabId) return;
  const currentTab = tabs.find(t => t.id === activeTabId);
  if (!currentTab || currentTab.url === 'about:blank') return;

  const existingIdx = bookmarks.findIndex(bm => bm.url === currentTab.url);
  if (existingIdx !== -1) {
    // Remove it
    bookmarks.splice(existingIdx, 1);
  } else {
    // Add it
    bookmarks.push({
      id: Date.now().toString(),
      title: currentTab.title || currentTab.url,
      url: currentTab.url
    });
  }

  await window.electronAPI.saveBookmarks(bookmarks);
  loadBookmarks();
}

function updateBookmarkStarState() {
  if (!activeTabId) {
    btnBookmarkPage.classList.remove('active');
    return;
  }
  const currentTab = tabs.find(t => t.id === activeTabId);
  if (currentTab && bookmarks.some(bm => bm.url === currentTab.url)) {
    btnBookmarkPage.classList.add('active');
    btnBookmarkPage.querySelector('svg path').setAttribute('d', 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z');
  } else {
    btnBookmarkPage.classList.remove('active');
    btnBookmarkPage.querySelector('svg path').setAttribute('d', 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z');
  }
}

btnBookmarkPage.addEventListener('click', toggleBookmarkActiveTab);
bookmarksSearchInput.addEventListener('input', renderBookmarksManager);

// ----------------------------------------------------
// Downloads Logic
// ----------------------------------------------------

function updateDownloadBadge() {
  const activeCount = downloads.filter(d => d.state === 'progressing').length;
  if (activeCount > 0) {
    downloadBadge.classList.remove('hidden');
    downloadBadge.innerText = activeCount;
  } else {
    downloadBadge.classList.add('hidden');
  }
}

function renderDownloads() {
  downloadsList.innerHTML = '';
  if (downloads.length === 0) {
    downloadsList.innerHTML = `<div class="no-downloads">No recent downloads</div>`;
    return;
  }

  downloads.forEach(d => {
    const card = document.createElement('div');
    card.className = 'download-card';

    const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : 0;
    const isCompleted = d.state === 'completed';
    const isProgressing = d.state === 'progressing';
    const isPaused = d.state === 'paused';
    const isCancelled = d.state === 'cancelled';

    let statusText = d.state;
    if (isProgressing) statusText = `${pct}% - ${formatBytes(d.received)} / ${formatBytes(d.total)}`;
    else if (isCompleted) statusText = 'Completed';
    else if (isPaused) statusText = 'Paused';
    else if (isCancelled) statusText = 'Cancelled';

    card.innerHTML = `
      <div class="download-file-name" title="${d.fileName}">${d.fileName}</div>
      <div class="download-progress-container">
        <div class="download-progress-bar ${isPaused ? 'paused' : ''} ${isCancelled ? 'cancelled' : ''}" style="width: ${pct}%"></div>
      </div>
      <div class="download-info-row">
        <span>${statusText}</span>
        <span>${formatBytes(d.total)}</span>
      </div>
      <div class="download-controls">
        ${isProgressing ? `<button class="btn-dl-pause">Pause</button>` : ''}
        ${isPaused ? `<button class="btn-dl-resume">Resume</button>` : ''}
        ${(isProgressing || isPaused) ? `<button class="btn-dl-cancel">Cancel</button>` : ''}
      </div>
    `;

    // Hook buttons
    const btnPause = card.querySelector('.btn-dl-pause');
    const btnResume = card.querySelector('.btn-dl-resume');
    const btnCancel = card.querySelector('.btn-dl-cancel');

    if (btnPause) btnPause.addEventListener('click', () => window.electronAPI.pauseDownload(d.id));
    if (btnResume) btnResume.addEventListener('click', () => window.electronAPI.resumeDownload(d.id));
    if (btnCancel) btnCancel.addEventListener('click', () => window.electronAPI.cancelDownload(d.id));

    downloadsList.appendChild(card);
  });
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

btnClearDownloads.addEventListener('click', () => {
  downloads = downloads.filter(d => d.state === 'progressing');
  renderDownloads();
});

// ----------------------------------------------------
// System Settings Logic
// ----------------------------------------------------

async function loadPreferences() {
  preferences = await window.electronAPI.getPreferences();

  // Content Protection Check
  toggleContentProtection.checked = !!preferences.contentProtection;
  updateContentProtectionUI(!!preferences.contentProtection);

  const platform = preferences.platform || 'win32';
  if (platform === 'win32') {
    protectionStatusBadge.innerText = 'Windows: Fully Supported';
    protectionStatusBadge.className = 'platform-badge win';
  } else if (platform === 'darwin') {
    protectionStatusBadge.innerText = 'macOS: Fully Supported';
    protectionStatusBadge.className = 'platform-badge mac';
  } else {
    protectionStatusBadge.innerText = 'Linux: API Unsupported';
    protectionStatusBadge.className = 'platform-badge unsupported';
    toggleContentProtection.disabled = true;
  }

  // Permissions Toggles
  permMedia.checked = preferences.permissions.media !== false;
  permNotifications.checked = preferences.permissions.notifications !== false;
  permGeolocation.checked = !!preferences.permissions.geolocation;

  // Ad Blocker & Always On Top Checkboxes
  if (toggleAdBlocker) {
    toggleAdBlocker.checked = !!preferences.adBlockerEnabled;
  }
  if (toggleAlwaysOnTop) {
    toggleAlwaysOnTop.checked = !!preferences.alwaysOnTopEnabled;
  }

  // Load Browser Mode
  try {
    const mode = await window.electronAPI.getBrowserMode();
    if (selectBrowserMode) {
      selectBrowserMode.value = mode || 'tray';
    }
  } catch (err) {
    console.error('Failed to load browser mode:', err);
  }

  // Shortcuts Rendering
  renderShortcuts();

  // Load Audio devices
  await loadAudioDevices();

  // Sync mic routing source state on startup
  try {
    const currentMicSource = await window.electronAPI.getMicRoutingSource();
    if (currentMicSource === 'system') {
      await startAudioRouting(true);
    }
  } catch (err) {
    console.error('Error syncing mic routing source:', err);
  }
}

function updateContentProtectionUI(enabled) {
  if (enabled) {
    statusProtection.innerText = 'Protection: On';
    statusProtection.classList.add('active');
  } else {
    statusProtection.innerText = 'Protection: Off';
    statusProtection.classList.remove('active');
  }
}

toggleContentProtection.addEventListener('change', async (e) => {
  const checked = e.target.checked;
  const res = await window.electronAPI.setContentProtection(checked);
  if (res.success) {
    updateContentProtectionUI(checked);
  } else {
    alert('Content protection activation failed: ' + (res.error || 'unknown'));
    toggleContentProtection.checked = !checked;
  }
});

// Permissions modification
[permMedia, permNotifications, permGeolocation].forEach(toggle => {
  toggle.addEventListener('change', async () => {
    preferences.permissions = {
      media: permMedia.checked,
      notifications: permNotifications.checked,
      geolocation: permGeolocation.checked
    };
    await window.electronAPI.savePreferences(preferences);
  });
});

if (toggleAdBlocker) {
  toggleAdBlocker.addEventListener('change', async (e) => {
    preferences.adBlockerEnabled = e.target.checked;
    await window.electronAPI.savePreferences(preferences);
    showToastNotification(`Ad Blocker: ${preferences.adBlockerEnabled ? 'Enabled' : 'Disabled'}`);
  });
}

if (toggleAlwaysOnTop) {
  toggleAlwaysOnTop.addEventListener('change', async (e) => {
    preferences.alwaysOnTopEnabled = e.target.checked;
    await window.electronAPI.savePreferences(preferences);
    showToastNotification(`Always Active Window: ${preferences.alwaysOnTopEnabled ? 'Enabled' : 'Disabled'}`);
  });
}

if (selectBrowserMode) {
  selectBrowserMode.addEventListener('change', async (e) => {
    const val = e.target.value;
    const res = await window.electronAPI.setBrowserMode(val);
    if (res.success) {
      showToastNotification(`Browser Mode: ${val === 'tray' ? 'System Tray' : 'Taskbar'}`);
    } else {
      alert('Failed to set browser mode: ' + (res.error || 'unknown'));
      selectBrowserMode.value = val === 'tray' ? 'taskbar' : 'tray';
    }
  });
}

// Clear browsing cache placeholder
btnClearCache.addEventListener('click', () => {
  alert('Local cache and cookie state has been cleared.');
});

// ----------------------------------------------------
// Keyboard Shortcuts Manager
// ----------------------------------------------------

function renderShortcuts() {
  shortcutsListContainer.innerHTML = '';
  const shortcuts = preferences.shortcuts || {};
  
  Object.keys(shortcuts).forEach(actionKey => {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.innerHTML = `
      <span class="shortcut-label">${SHORTCUT_NAMES[actionKey] || actionKey}</span>
      <div class="shortcut-key-box ${recordingShortcutKey === actionKey ? 'recording' : ''}" data-action="${actionKey}">
        ${recordingShortcutKey === actionKey ? 'Press keys...' : formatAccelerator(shortcuts[actionKey])}
      </div>
    `;
    
    const keyBox = row.querySelector('.shortcut-key-box');
    keyBox.addEventListener('click', () => {
      if (recordingShortcutKey) return; // Wait for current recording to finish
      recordingShortcutKey = actionKey;
      keyBox.className = 'shortcut-key-box recording';
      keyBox.innerText = 'Press keys...';
    });
    
    shortcutsListContainer.appendChild(row);
  });
}

function formatAccelerator(acc) {
  return acc.replace(/Control/i, 'Ctrl')
            .replace(/Shift/i, 'Shift')
            .replace(/Alt/i, 'Alt')
            .replace(/Meta/i, 'Cmd')
            .replace(/\+/g, ' + ');
}

// Global window key interceptor for recording shortcuts
window.addEventListener('keydown', async (e) => {
  if (!recordingShortcutKey) return;
  e.preventDefault();
  e.stopPropagation();

  // Parse keys
  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');

  let key = e.key;
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') {
    // If user only pressed a modifier, wait for full combo
    return;
  }
  
  if (key === ' ') {
    key = 'Space';
  } else if (key.length === 1) {
    key = key.toLowerCase();
  }
  parts.push(key);

  const accelerator = parts.join('+');
  const action = recordingShortcutKey;
  recordingShortcutKey = null;

  preferences.shortcuts[action] = accelerator;
  await window.electronAPI.savePreferences(preferences);
  renderShortcuts();
});

btnResetShortcuts.addEventListener('click', async () => {
  preferences.shortcuts = {
    'new-tab': 'Control+t',
    'close-tab': 'Control+w',
    'reopen-tab': 'Control+Shift+t',
    'refresh': 'Control+r',
    'focus-address': 'Control+l',
    'new-window': 'Control+n',
    'dev-tools': 'Control+Shift+i',
    'add-bookmark': 'Control+d',
    'toggle-adblocker': 'Control+Shift+A',
    'toggle-always-ontop': 'Control+Shift+P'
  };
  await window.electronAPI.savePreferences(preferences);
  renderShortcuts();
});

// ----------------------------------------------------
// Audio Routing Functionality (Main Core)
// ----------------------------------------------------

async function loadAudioDevices() {
  selectVirtualDevice.innerHTML = '';
  
  // Try system helper (PowerShell list) on Windows
  const sysDev = await window.electronAPI.listAudioDevices();
  if (sysDev.success && Array.isArray(sysDev.devices)) {
    // Output Playback Devices to the select dropdown
    const playbacks = sysDev.devices.filter(d => d.Type === 'Playback');
    if (playbacks.length === 0) {
      const o = document.createElement('option');
      o.text = 'No Virtual Devices Detected';
      selectVirtualDevice.appendChild(o);
      return;
    }
    playbacks.forEach(d => {
      const o = document.createElement('option');
      o.value = d.Id;
      o.text = d.Name;
      if (d.Name.toLowerCase().includes('cable')) {
        o.selected = true; // Auto select VB Cable input if found
      }
      selectVirtualDevice.appendChild(o);
    });
  } else {
    // Fallback: use Chromium enumeration
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const playbacks = devices.filter(d => d.kind === 'audiooutput');
      if (playbacks.length === 0) {
        const o = document.createElement('option');
        o.text = 'Default Playback Device';
        selectVirtualDevice.appendChild(o);
        return;
      }
      playbacks.forEach(d => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.text = d.label || `Speakers (${d.deviceId.substr(0, 5)})`;
        if (d.label.toLowerCase().includes('cable') || d.label.toLowerCase().includes('virtual')) {
          o.selected = true;
        }
        selectVirtualDevice.appendChild(o);
      });
    } catch (e) {
      const o = document.createElement('option');
      o.text = 'Audio Devices Blocked (Check Permissions)';
      selectVirtualDevice.appendChild(o);
    }
  }
}

async function startAudioRouting(skipIPC = false) {
  const selectedDeviceId = selectVirtualDevice.value;
  if (!selectedDeviceId || selectedDeviceId.startsWith('No')) {
    alert('Please select a valid virtual audio device first.');
    return;
  }

  try {
    routingStatusText.innerText = 'Initializing...';
    routingStatusText.className = 'status-indicator inactive';
    
    const sourceId = await window.electronAPI.getDesktopAudioSourceId();
    if (!sourceId) {
      throw new Error('Could not acquire system audio capture source. Ensure display sharing is enabled.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      }
    });

    audioLoopbackStream = stream;
    stream.getVideoTracks().forEach(t => t.stop());

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new Error('Desktop stream did not return an audio track.');
    }

    loopbackAudio.srcObject = new MediaStream([audioTrack]);
    
    if (typeof loopbackAudio.setSinkId === 'function') {
      await loopbackAudio.setSinkId(selectedDeviceId);
    }

    loopbackAudio.play();

    const selectedText = selectVirtualDevice.options[selectVirtualDevice.selectedIndex].text;
    const sysDev = await window.electronAPI.listAudioDevices();
    if (sysDev.success && Array.isArray(sysDev.devices)) {
      let matchName = 'cable';
      if (selectedText.toLowerCase().includes('cable')) matchName = 'cable';
      else if (selectedText.toLowerCase().includes('virtual')) matchName = 'virtual';
      
      const recordingMatch = sysDev.devices.find(d => d.Type === 'Recording' && d.Name.toLowerCase().includes(matchName));
      if (recordingMatch) {
        await window.electronAPI.setDefaultRecordingDevice(recordingMatch.Id);
      }
    }

    routingStatusText.innerText = 'Active (Routing)';
    routingStatusText.className = 'status-indicator active';
    routingSourceText.innerText = `System Loopback ➔ ${selectedText}`;
    
    statusRouting.innerText = 'Audio Routing: Active';
    statusRouting.classList.add('active');

    btnEnableRouting.disabled = true;
    btnDisableRouting.disabled = false;
    selectVirtualDevice.disabled = true;

    btnMicRoutingToggle.classList.add('active');
    btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.add('hidden');
    btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.remove('hidden');
    btnMicRoutingToggle.title = 'Microphone set to Laptop Output (System Loopback). Click to switch to Mic.';

    if (!skipIPC) {
      await window.electronAPI.setMicRoutingSource('system');
    }

  } catch (err) {
    alert('Audio loopback routing failed: ' + err.message);
    routingStatusText.innerText = 'Failed';
    routingStatusText.className = 'status-indicator inactive';
    routingSourceText.innerText = 'None';

    btnMicRoutingToggle.classList.remove('active');
    btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.remove('hidden');
    btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.add('hidden');
    btnMicRoutingToggle.title = 'Switch Microphone to Laptop Output';

    if (!skipIPC) {
      await window.electronAPI.setMicRoutingSource('mic');
    }
  }
}

function stopAudioRouting(skipIPC = false) {
  if (audioLoopbackStream) {
    audioLoopbackStream.getTracks().forEach(t => t.stop());
    audioLoopbackStream = null;
  }
  loopbackAudio.srcObject = null;

  routingStatusText.innerText = 'Disabled';
  routingStatusText.className = 'status-indicator inactive';
  routingSourceText.innerText = 'None';

  statusRouting.innerText = 'Audio Routing: Inactive';
  statusRouting.classList.remove('active');

  btnEnableRouting.disabled = false;
  btnDisableRouting.disabled = true;
  selectVirtualDevice.disabled = false;

  btnMicRoutingToggle.classList.remove('active');
  btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.remove('hidden');
  btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.add('hidden');
  btnMicRoutingToggle.title = 'Switch Microphone to Laptop Output';

  if (!skipIPC) {
    window.electronAPI.setMicRoutingSource('mic');
  }
}

btnEnableRouting.addEventListener('click', async () => {
  await startAudioRouting();
});

btnDisableRouting.addEventListener('click', () => {
  stopAudioRouting();
});

btnMicRoutingToggle.addEventListener('click', () => {
  audioRoutingPopover.classList.toggle('hidden');
  settingsPanel.classList.add('hidden');
  downloadsPanel.classList.add('hidden');
  bookmarksPanel.classList.add('hidden');
  updateAudioRoutingUIForActiveTab();
  updateLayout();
});

// ----------------------------------------------------
// Window Layout and Margin Management
// ----------------------------------------------------
function updateLayout() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  
  let height = topbar.offsetHeight;
  if (height < 50) {
    const bookmarksBar = document.getElementById('bookmarks-bar');
    const isBookmarksVisible = bookmarksBar && !bookmarksBar.classList.contains('hidden');
    height = isBookmarksVisible ? 138 : 104;
  }
  
  document.documentElement.style.setProperty('--topbar-height', height + 'px');
  
  const isAudioRoutingOpen = audioRoutingPopover && !audioRoutingPopover.classList.contains('hidden');
  const isSettingsOpen = settingsPanel && !settingsPanel.classList.contains('hidden');
  const isDownloadsOpen = downloadsPanel && !downloadsPanel.classList.contains('hidden');
  const isBookmarksOpen = bookmarksPanel && !bookmarksPanel.classList.contains('hidden');
  
  const aiPanel = document.getElementById('ai-panel');
  const aiToolsPanel = document.getElementById('ai-tools-panel');
  const aiHistoryPanel = document.getElementById('ai-history-panel');
  const aiImagePanel = document.getElementById('ai-image-panel');
  
  const isAiOpen = aiPanel && aiPanel.classList.contains('open');
  const isAiToolsOpen = aiToolsPanel && aiToolsPanel.classList.contains('open');
  const isAiHistoryOpen = aiHistoryPanel && aiHistoryPanel.classList.contains('open');
  const isAiImageOpen = aiImagePanel && aiImagePanel.classList.contains('open');
  
  let rightMargin = 0;
  if (isAiImageOpen) {
    rightMargin = aiImagePanel.offsetWidth || 480;
  } else if (isAiHistoryOpen) {
    rightMargin = aiHistoryPanel.offsetWidth || 480;
  } else if (isAiToolsOpen) {
    rightMargin = aiToolsPanel.offsetWidth || 480;
  } else if (isAiOpen) {
    rightMargin = aiPanel.offsetWidth || 380;
  } else if (isSettingsOpen) {
    rightMargin = settingsPanel.offsetWidth || 380;
  } else if (isDownloadsOpen) {
    rightMargin = downloadsPanel.offsetWidth || 380;
  } else if (isBookmarksOpen) {
    rightMargin = bookmarksPanel.offsetWidth || 380;
  } else if (isAudioRoutingOpen) {
    rightMargin = 380;
  }
  
  window.electronAPI.updateLayoutMargins({ height, rightMargin });
}

function makePanelResizable(panel) {
  if (!panel) return;
  
  // Prevent duplicate handles
  if (panel.querySelector('.resize-handle')) return;
  
  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  panel.appendChild(handle);

  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = parseInt(document.defaultView.getComputedStyle(panel).width, 10);
    handle.classList.add('resizing');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    function doDrag(dragEvent) {
      // Pinned to right, so drag direction is opposite to clientX movement
      const width = startWidth + (startX - dragEvent.clientX);
      if (width >= 280 && width <= 800) {
        panel.style.width = width + 'px';
        updateLayout();
      }
    }

    function stopDrag() {
      handle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', doDrag);
      window.removeEventListener('mouseup', stopDrag);
    }

    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);
  });
}

// Initialize panel drag resizes immediately
setTimeout(() => {
  const panelsToResize = [
    settingsPanel,
    downloadsPanel,
    bookmarksPanel,
    document.getElementById('ai-panel'),
    document.getElementById('ai-tools-panel'),
    document.getElementById('ai-history-panel'),
    document.getElementById('ai-image-panel')
  ];
  panelsToResize.forEach(p => {
    if (p) makePanelResizable(p);
  });
}, 100);


// ----------------------------------------------------
// Window Slide Panel Panel Toggles
// ----------------------------------------------------

btnSettings.addEventListener('click', () => {
  const isOpening = settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden');
  downloadsPanel.classList.add('hidden');
  bookmarksPanel.classList.add('hidden');
  audioRoutingPopover.classList.add('hidden');
  if (isOpening) {
    updateAccountUI();
  }
  updateLayout();
});
btnCloseSettings.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  updateLayout();
});

btnDownloadsToggle.addEventListener('click', () => {
  downloadsPanel.classList.toggle('hidden');
  settingsPanel.classList.add('hidden');
  bookmarksPanel.classList.add('hidden');
  audioRoutingPopover.classList.add('hidden');
  renderDownloads();
  updateLayout();
});
btnCloseDownloads.addEventListener('click', () => {
  downloadsPanel.classList.add('hidden');
  updateLayout();
});

btnBookmarksToggle.addEventListener('click', () => {
  bookmarksPanel.classList.toggle('hidden');
  settingsPanel.classList.add('hidden');
  downloadsPanel.classList.add('hidden');
  audioRoutingPopover.classList.add('hidden');
  loadBookmarks();
  updateLayout();
});
btnCloseBookmarks.addEventListener('click', () => {
  bookmarksPanel.classList.add('hidden');
  updateLayout();
});

if (bookmarksSearchInput) {
  bookmarksSearchInput.addEventListener('input', () => {
    renderBookmarksManager();
  });
}
if (toggleSemanticBookmarks) {
  toggleSemanticBookmarks.addEventListener('change', () => {
    renderBookmarksManager();
  });
}

// ----------------------------------------------------
// Background IPC Sync Listeners
// ----------------------------------------------------

window.electronAPI.on('tab-created', (tab) => {
  tabs.push({
    id: tab.id,
    title: tab.title || 'New Tab',
    url: tab.url,
    favicon: null,
    loading: tab.loading,
    canGoBack: false,
    canGoForward: false,
    muted: false
  });
  renderTabs();
});

window.electronAPI.on('tab-activated', (data) => {
  activeTabId = data.id;
  const currentTab = tabs.find(t => t.id === data.id);
  if (currentTab) {
    currentTab.url = data.url;
    currentTab.canGoBack = data.canGoBack;
    currentTab.canGoForward = data.canGoForward;
    
    // Update Address and homepage views
    addressInput.value = data.url === 'about:blank' ? '' : data.url;
    updateSSLBadge(data.url);
    updateNavigationControls(currentTab);

    if (data.url === 'about:blank') {
      newTabPage.classList.add('active');
      updateStatsUI();
    } else {
      newTabPage.classList.remove('active');
    }

    // Sync progress bar
    if (currentTab.loading) {
      startLoadingProgress();
    } else {
      stopLoadingProgress();
    }
  }
  renderTabs();
  updateBookmarkStarState();
  updateAudioRoutingUIForActiveTab();
});

window.electronAPI.on('tab-closed', (data) => {
  tabs = tabs.filter(t => t.id !== data.id);
  if (activeTabId === data.id) {
    activeTabId = null;
  }
  renderTabs();
});

window.electronAPI.on('tab-title-updated', (data) => {
  const currentTab = tabs.find(t => t.id === data.id);
  if (currentTab) {
    currentTab.title = data.title;
    renderTabs();
  }
});

window.electronAPI.on('tab-favicon-updated', (data) => {
  const currentTab = tabs.find(t => t.id === data.id);
  if (currentTab) {
    currentTab.favicon = data.favicon;
    renderTabs();
  }
});

window.electronAPI.on('tab-url-updated', (data) => {
  const currentTab = tabs.find(t => t.id === data.id);
  if (currentTab) {
    currentTab.url = data.url;
    currentTab.canGoBack = data.canGoBack;
    currentTab.canGoForward = data.canGoForward;

    if (activeTabId === data.id) {
      addressInput.value = data.url === 'about:blank' ? '' : data.url;
      updateSSLBadge(data.url);
      updateNavigationControls(currentTab);
      
      if (data.url === 'about:blank') {
        newTabPage.classList.add('active');
      } else {
        newTabPage.classList.remove('active');
      }
      updateBookmarkStarState();
      updateAudioRoutingUIForActiveTab();
    }
  }
});

let loadingInterval = null;
let currentProgress = 0;

function startLoadingProgress() {
  if (loadingInterval) clearInterval(loadingInterval);
  loadingBar.classList.remove('hidden');
  currentProgress = 10;
  loadingProgress.style.width = currentProgress + '%';
  
  loadingInterval = setInterval(() => {
    if (currentProgress < 90) {
      // Simulate diminishing increments
      const increment = Math.max(1, (90 - currentProgress) * 0.08);
      currentProgress += increment;
      loadingProgress.style.width = currentProgress + '%';
    }
  }, 150);
}

function stopLoadingProgress() {
  if (loadingInterval) clearInterval(loadingInterval);
  currentProgress = 100;
  loadingProgress.style.width = '100%';
  setTimeout(() => {
    if (currentProgress === 100) {
      loadingBar.classList.add('hidden');
      setTimeout(() => {
        if (currentProgress === 100) {
          loadingProgress.style.width = '0%';
        }
      }, 300);
    }
  }, 450);
}

window.electronAPI.on('tab-loading-state', (data) => {
  const currentTab = tabs.find(t => t.id === data.id);
  if (currentTab) {
    currentTab.loading = data.loading;
  }
  if (activeTabId === data.id) {
    if (data.loading) {
      startLoadingProgress();
    } else {
      stopLoadingProgress();
    }
  }
});

// Focus address bar event (from shortcuts)
window.electronAPI.on('focus-address-bar', () => {
  addressInput.focus();
  addressInput.select();
});

// Bookmark active page event (from shortcuts)
window.electronAPI.on('trigger-bookmark', () => {
  toggleBookmarkActiveTab();
});

// Synchronize mic routing state updates across windows
window.electronAPI.on('mic-routing-source-changed', async (source) => {
  if (source === 'system' && !audioLoopbackStream) {
    await startAudioRouting(true);
  } else if (source === 'mic' && audioLoopbackStream) {
    stopAudioRouting(true);
  }
});

// Tab-Level Audio Input Routing & Popover Interactivity

async function updateAudioRoutingUIForActiveTab() {
  if (!activeTabId) {
    btnMicRoutingToggle.classList.remove('active');
    btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.remove('hidden');
    btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.add('hidden');
    statusRouting.innerText = 'Audio Routing: Inactive';
    statusRouting.classList.remove('active');
    return;
  }

  const settings = await window.electronAPI.getTabAudioSettings(activeTabId);
  const resolved = settings.resolved || { enabled: false, source: 'mic' };

  popoverRouteEnable.checked = !!settings.enabled;
  popoverAudioSource.value = settings.source || 'mic';
  popoverAudioDest.value = settings.destination || 'tab';

  if (settings.enabled) {
    popoverStatusVal.innerText = `Active (${settings.source})`;
    popoverStatusVal.className = 'active';
  } else {
    popoverStatusVal.innerText = 'Disabled';
    popoverStatusVal.className = 'inactive';
  }

  if (resolved.enabled) {
    btnMicRoutingToggle.classList.add('active');
    btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.add('hidden');
    btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.remove('hidden');
    btnMicRoutingToggle.title = `Audio routing active: ${resolved.source}. Click to configure.`;
    
    statusRouting.innerText = `Audio Routing: Active (${resolved.source})`;
    statusRouting.classList.add('active');
  } else {
    btnMicRoutingToggle.classList.remove('active');
    btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.remove('hidden');
    btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.add('hidden');
    btnMicRoutingToggle.title = 'Switch Microphone to Laptop Output / Virtual Audio Injection. Click to configure.';
    
    statusRouting.innerText = 'Audio Routing: Inactive';
    statusRouting.classList.remove('active');
  }
}

async function savePopoverAudioSettings() {
  if (!activeTabId) return;
  const enabled = popoverRouteEnable.checked;
  const source = popoverAudioSource.value;
  const destination = popoverAudioDest.value;

  await window.electronAPI.setTabAudioSettings({
    tabId: activeTabId,
    enabled,
    source,
    destination
  });
  await updateAudioRoutingUIForActiveTab();
}

popoverRouteEnable.addEventListener('change', savePopoverAudioSettings);
popoverAudioSource.addEventListener('change', savePopoverAudioSettings);
popoverAudioDest.addEventListener('change', savePopoverAudioSettings);

let toastTimeout = null;
function showToastNotification(text) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.innerText = text;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 300);
  }, 2500);
}

// Alt Shortcuts Event Listeners
const sourcesList = ['mic', 'system', 'browser', 'combined'];

window.electronAPI.on('shortcut-toggle-routing', async () => {
  if (!activeTabId) return;
  const settings = await window.electronAPI.getTabAudioSettings(activeTabId);
  const newEnabled = !settings.enabled;
  await window.electronAPI.setTabAudioSettings({
    tabId: activeTabId,
    enabled: newEnabled,
    source: settings.source === 'mic' ? 'system' : (settings.source || 'system'),
    destination: settings.destination || 'tab'
  });
  showToastNotification(`Audio Routing: ${newEnabled ? 'Enabled' : 'Disabled'}`);
  await updateAudioRoutingUIForActiveTab();
});

window.electronAPI.on('shortcut-cycle-source', async () => {
  if (!activeTabId) return;
  const settings = await window.electronAPI.getTabAudioSettings(activeTabId);
  const currentIdx = sourcesList.indexOf(settings.source || 'mic');
  const nextIdx = (currentIdx + 1) % sourcesList.length;
  const nextSource = sourcesList[nextIdx];
  const newEnabled = nextSource !== 'mic' ? true : settings.enabled;
  await window.electronAPI.setTabAudioSettings({
    tabId: activeTabId,
    enabled: newEnabled,
    source: nextSource,
    destination: settings.destination || 'tab'
  });
  showToastNotification(`Audio Source: ${nextSource === 'mic' ? 'Microphone' : nextSource === 'system' ? 'System Audio' : nextSource === 'browser' ? 'Browser Audio' : 'Combined Audio'}`);
  await updateAudioRoutingUIForActiveTab();
});

window.electronAPI.on('shortcut-toggle-mix', async () => {
  if (!activeTabId) return;
  const settings = await window.electronAPI.getTabAudioSettings(activeTabId);
  let nextSource = settings.source;
  if (settings.source === 'system' || settings.source === 'browser') {
    nextSource = 'combined';
  } else if (settings.source === 'combined') {
    nextSource = 'system';
  } else {
    nextSource = 'combined';
  }
  await window.electronAPI.setTabAudioSettings({
    tabId: activeTabId,
    enabled: true,
    source: nextSource,
    destination: settings.destination || 'tab'
  });
  showToastNotification(`Mix Mode: ${nextSource === 'combined' ? 'Combined (Mix)' : 'Replace (System Only)'}`);
  await updateAudioRoutingUIForActiveTab();
});

window.electronAPI.on('tab-audio-settings-changed', () => {
  updateAudioRoutingUIForActiveTab();
});

window.electronAPI.on('adblocker-state-changed', (enabled) => {
  preferences.adBlockerEnabled = enabled;
  if (toggleAdBlocker) toggleAdBlocker.checked = enabled;
  showToastNotification(`Ad Blocker: ${enabled ? 'Enabled' : 'Disabled'}`);
});

window.electronAPI.on('always-ontop-state-changed', (enabled) => {
  preferences.alwaysOnTopEnabled = enabled;
  if (toggleAlwaysOnTop) toggleAlwaysOnTop.checked = enabled;
  showToastNotification(`Always Active Window: ${enabled ? 'Enabled' : 'Disabled'}`);
});

// Toggle elements from shortcuts
window.electronAPI.on('toggle-bookmarks-bar', () => {
  bookmarksBar.classList.toggle('hidden');
  updateLayout();
});

window.electronAPI.on('toggle-bookmarks-panel', () => {
  bookmarksPanel.classList.toggle('hidden');
  settingsPanel.classList.add('hidden');
  downloadsPanel.classList.add('hidden');
  loadBookmarks();
  updateLayout();
});

window.electronAPI.on('toggle-downloads-panel', () => {
  downloadsPanel.classList.toggle('hidden');
  settingsPanel.classList.add('hidden');
  bookmarksPanel.classList.add('hidden');
  renderDownloads();
  updateLayout();
});

window.electronAPI.on('open-clear-browsing-dialog', () => {
  settingsPanel.classList.remove('hidden');
  downloadsPanel.classList.add('hidden');
  bookmarksPanel.classList.add('hidden');
  updateLayout();
  setTimeout(() => {
    btnClearCache.scrollIntoView({ behavior: 'smooth' });
    btnClearCache.focus();
  }, 100);
});

window.electronAPI.on('focus-find-in-page', () => {
  alert('Find in page requested. Use page scrolling or standard in-page search.');
});

// Download progress listeners
window.electronAPI.on('download-started', (data) => {
  downloads.unshift({
    id: data.id,
    fileName: data.fileName,
    received: 0,
    total: data.total,
    state: 'progressing',
    savePath: data.savePath
  });
  updateDownloadBadge();
  renderDownloads();
  downloadsPanel.classList.remove('hidden'); // Reveal download panel
  updateLayout();
});

window.electronAPI.on('download-updated', (data) => {
  const dl = downloads.find(d => d.id === data.id);
  if (dl) {
    dl.received = data.received;
    dl.total = data.total;
    dl.state = data.state;
  }
  updateDownloadBadge();
  renderDownloads();
});

window.electronAPI.on('download-completed', (data) => {
  const dl = downloads.find(d => d.id === data.id);
  if (dl) {
    dl.state = data.state;
    dl.received = dl.total;
  }
  updateDownloadBadge();
  renderDownloads();
});

// ----------------------------------------------------
// Startup / Clock Initialization
// ----------------------------------------------------

function initClock() {
  function updateClock() {
    const d = new Date();
    currentTimeEl.innerText = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (newTabPage && newTabPage.classList.contains('active')) {
      updateStatsUI();
    }
  }
  updateClock();
  setInterval(updateClock, 1000);
}

// Measure topbar height dynamically to offset the BrowserView bounds
function watchTopbarHeight() {
  const resizeObserver = new ResizeObserver(entries => {
    updateLayout();
  });
  resizeObserver.observe(document.getElementById('topbar'));
}

async function updateAccountUI() {
  if (!accountEmail || !accountPlan) return;
  try {
    const user = await window.electronAPI.aiGetMe();
    if (user && user.email) {
      accountEmail.innerText = user.email;
      accountPlan.innerText = user.plan || 'Free';
      const char = user.email.charAt(0).toUpperCase();
      const avatarCharEl = document.getElementById('account-avatar-char');
      if (avatarCharEl) avatarCharEl.innerText = char;
      if (btnSignOut) btnSignOut.disabled = false;
    } else {
      accountEmail.innerText = 'Not Logged In';
      accountPlan.innerText = 'Free';
      const avatarCharEl = document.getElementById('account-avatar-char');
      if (avatarCharEl) avatarCharEl.innerText = 'U';
      if (btnSignOut) btnSignOut.disabled = true;
    }
  } catch (err) {
    console.error('Failed to get account details:', err);
    accountEmail.innerText = 'Not Logged In';
    accountPlan.innerText = 'Free';
    const avatarCharEl = document.getElementById('account-avatar-char');
    if (avatarCharEl) avatarCharEl.innerText = 'U';
    if (btnSignOut) btnSignOut.disabled = true;
  }
}

async function updateStatsUI() {
  try {
    const stats = await window.electronAPI.getStats();
    renderStatsData(stats);
  } catch (err) {
    console.error('Failed to get stats:', err);
  }
}

function renderStatsData(stats) {
  if (!stats) return;
  if (valTabs) valTabs.innerText = stats.tabsOpenedToday || 0;
  if (valSites) valSites.innerText = stats.sitesVisitedTodayCount || 0;
  if (valAds) valAds.innerText = stats.adsBlockedToday || 0;
  if (valSession) valSession.innerText = formatDuration(stats.sessionDuration || 0);
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

// Background stats updates listener
window.electronAPI.on('stats-updated', (stats) => {
  renderStatsData(stats);
});

// AI Account sign out listener
if (btnSignOut) {
  btnSignOut.addEventListener('click', async () => {
    try {
      await window.electronAPI.aiLogout();
      // Dispatch ai-session-expired event so AI panel resets
      window.dispatchEvent(new Event('ai-session-expired'));
      await updateAccountUI();
      showToastNotification('Signed out of AI Account');
    } catch (err) {
      console.error('Failed to sign out:', err);
    }
  });
}

async function init() {
  initClock();
  watchTopbarHeight();
  await loadPreferences();
  await loadBookmarks();
  await updateAudioRoutingUIForActiveTab();
  await updateAccountUI();
  await updateStatsUI();
  if (window.aiAuth) {
    await window.aiAuth.init();
  }
}

document.addEventListener('DOMContentLoaded', init);
