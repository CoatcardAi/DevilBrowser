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
    tabDiv.setAttribute('data-pinned', tab.pinned ? 'true' : 'false');
    tabDiv.setAttribute('data-discarded', tab.discarded ? 'true' : 'false');

    // Right-click context menu on tab element
    tabDiv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e.clientX, e.clientY, tab);
    });

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

    // Close tab on middle button click
    tabDiv.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.electronAPI.closeTab(tab.id);
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

  const trimmed = url.trim();
  if (trimmed.startsWith('ai:') || trimmed.startsWith('?')) {
    let query = trimmed;
    if (trimmed.startsWith('ai:')) {
      query = trimmed.slice(3).trim();
    } else if (trimmed.startsWith('?')) {
      query = trimmed.slice(1).trim();
    }
    
    // Dispatch custom event to ai-panel
    const event = new CustomEvent('ai-address-query', { detail: query });
    window.dispatchEvent(event);
    return;
  }

  window.electronAPI.navigateTab({ tabId: activeTabId, url });
}

addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleNavigationSubmit(addressInput.value);
    closeSuggestions();
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

// New Tab Page search input - redirect focus to omnibox
if (newTabSearch) {
  newTabSearch.addEventListener('focus', () => {
    addressInput.focus();
    addressInput.select();
  });
}

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
  // Badge number
  if (activeCount > 0) {
    downloadBadge.classList.remove('hidden');
    downloadBadge.innerText = activeCount;
  } else {
    downloadBadge.classList.add('hidden');
  }

  // Coatcard-like circular ring
  const ring = document.getElementById('dl-ring-progress');
  if (!ring) return;
  const CIRCUMFERENCE = 94.25;
  const activeDl = downloads.find(d => d.state === 'progressing');
  if (activeDl && activeDl.total > 0) {
    const pct = activeDl.received / activeDl.total;
    const offset = CIRCUMFERENCE - pct * CIRCUMFERENCE;
    ring.classList.remove('hidden', 'complete');
    ring.style.strokeDashoffset = offset;
  } else if (activeCount > 0) {
    // Indeterminate: spin
    ring.classList.remove('hidden', 'complete');
    ring.style.strokeDashoffset = CIRCUMFERENCE * 0.3;
  } else {
    const justCompleted = downloads.some(d => d.state === 'completed' && Date.now() - (d.completedAt || 0) < 2000);
    if (justCompleted) {
      ring.classList.remove('hidden');
      ring.classList.add('complete');
      ring.style.strokeDashoffset = 0;
    } else {
      ring.classList.add('hidden');
    }
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

// Expose addCompletedDownload for other modules (ai-image, ai-tools etc.)
window.addCompletedDownload = function({ fileName, filePath }) {
  const id = 'direct_' + Date.now() + Math.random().toString(36).substr(2, 4);
  const entry = {
    id,
    fileName: fileName || filePath.replace(/\\/g, '/').split('/').pop() || 'file',
    received: 1,
    total: 1,
    state: 'completed',
    savePath: filePath,
    completedAt: Date.now()
  };
  downloads.unshift(entry);
  updateDownloadBadge();
  renderDownloads();
  // Briefly show panel so user knows the file was saved
  if (downloadsPanel && downloadsPanel.classList.contains('hidden')) {
    downloadsPanel.classList.remove('hidden');
    updateLayout();
    setTimeout(() => {
      // Hide after 3 seconds unless user interacted
      if (!downloadsPanel._userOpened) {
        downloadsPanel.classList.add('hidden');
        updateLayout();
      }
    }, 3000);
  }
  // Flash complete ring for 2s
  const ring = document.getElementById('dl-ring-progress');
  if (ring) {
    ring.classList.remove('hidden');
    ring.classList.add('complete');
    ring.style.strokeDashoffset = 0;
    setTimeout(() => {
      ring.classList.add('hidden');
      ring.classList.remove('complete');
    }, 2000);
  }
};

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

  // Load Download Location
  try {
    const dirPathEl = document.getElementById('download-dir-path');
    if (dirPathEl && window.electronAPI.getDownloadDirectory) {
      const dir = await window.electronAPI.getDownloadDirectory();
      dirPathEl.textContent = dir;
      dirPathEl.title = dir;
    }
  } catch (err) {
    console.error('Failed to load download directory:', err);
  }
}

// Change download folder button
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btn-change-download-dir') {
    const result = await window.electronAPI.selectDownloadDirectory();
    if (!result.canceled) {
      const dirPathEl = document.getElementById('download-dir-path');
      if (dirPathEl) {
        dirPathEl.textContent = result.path;
        dirPathEl.title = result.path;
      }
      showToastNotification('✅ Download folder updated!');
    }
  }
});

function updateContentProtectionUI(enabled) {
  if (enabled) {
    statusProtection.innerText = 'Protection: On';
    statusProtection.classList.add('active');
  } else {
    statusProtection.innerText = 'Protection: Off';
    statusProtection.classList.remove('active');
  }
}

if (toggleContentProtection) {
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
}

// Permissions modification
[permMedia, permNotifications, permGeolocation].forEach(toggle => {
  if (toggle) {
    toggle.addEventListener('change', async () => {
      preferences.permissions = {
        media: permMedia ? permMedia.checked : true,
        notifications: permNotifications ? permNotifications.checked : true,
        geolocation: permGeolocation ? permGeolocation.checked : false
      };
      await window.electronAPI.savePreferences(preferences);
    });
  }
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
    'toggle-always-ontop': 'Control+Shift+P',
    'toggle-window': 'Alt+B'
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

    if (btnMicRoutingToggle) {
      btnMicRoutingToggle.classList.add('active');
      btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.add('hidden');
      btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.remove('hidden');
      btnMicRoutingToggle.title = 'Microphone set to Laptop Output (System Loopback). Click to switch to Mic.';
    }

    if (!skipIPC) {
      await window.electronAPI.setMicRoutingSource('system');
    }

  } catch (err) {
    alert('Audio loopback routing failed: ' + err.message);
    routingStatusText.innerText = 'Failed';
    routingStatusText.className = 'status-indicator inactive';
    routingSourceText.innerText = 'None';

    if (btnMicRoutingToggle) {
      btnMicRoutingToggle.classList.remove('active');
      btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.remove('hidden');
      btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.add('hidden');
      btnMicRoutingToggle.title = 'Switch Microphone to Laptop Output';
    }

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

  if (btnMicRoutingToggle) {
    btnMicRoutingToggle.classList.remove('active');
    btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.remove('hidden');
    btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.add('hidden');
    btnMicRoutingToggle.title = 'Switch Microphone to Laptop Output';
  }

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

if (btnMicRoutingToggle) {
  btnMicRoutingToggle.addEventListener('click', () => {
    audioRoutingPopover.classList.toggle('hidden');
    settingsPanel.classList.add('hidden');
    downloadsPanel.classList.add('hidden');
    bookmarksPanel.classList.add('hidden');
    updateAudioRoutingUIForActiveTab();
    updateLayout();
  });
}

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
    height = isBookmarksVisible ? 110 : 82;
  }
  
  // Set the CSS property to the base height of the topbar (WITHOUT suggestions)
  document.documentElement.style.setProperty('--topbar-height', height + 'px');
  
  // Now add suggestions height ONLY for the BrowserView top offset
  const suggestionsDropdown = document.getElementById('autocomplete-suggestions');
  const isSuggestionsOpen = suggestionsDropdown && !suggestionsDropdown.classList.contains('hidden');
  let viewTopOffset = height;
  if (isSuggestionsOpen) {
    viewTopOffset += suggestionsDropdown.offsetHeight;
  }
  
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
  
  window.electronAPI.updateLayoutMargins({ height: viewTopOffset, rightMargin });
}

window.updateLayout = updateLayout;

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
// Side Panels Drawer Coordinator
// ----------------------------------------------------
function closeAllSidePanels(exceptId = null) {
  const panels = [
    { id: 'settings-panel', el: document.getElementById('settings-panel'), class: 'hidden', addClass: true },
    { id: 'downloads-panel', el: document.getElementById('downloads-panel'), class: 'hidden', addClass: true },
    { id: 'bookmarks-panel', el: document.getElementById('bookmarks-panel'), class: 'hidden', addClass: true },
    { id: 'ai-panel', el: document.getElementById('ai-panel'), class: 'open', addClass: false },
    { id: 'ai-tools-panel', el: document.getElementById('ai-tools-panel'), class: 'open', addClass: false },
    { id: 'ai-history-panel', el: document.getElementById('ai-history-panel'), class: 'open', addClass: false },
    { id: 'ai-image-panel', el: document.getElementById('ai-image-panel'), class: 'open', addClass: false }
  ];

  panels.forEach(p => {
    if (p.el && p.id !== exceptId) {
      if (p.addClass) {
        p.el.classList.add(p.class);
      } else {
        p.el.classList.remove(p.class);
      }
    }
  });

  // Remove active styling on toggle buttons when closing respective panels
  const btnAiToggle = document.getElementById('btn-ai-toggle');
  if (btnAiToggle && exceptId !== 'ai-panel') btnAiToggle.classList.remove('active');
}
window.closeAllSidePanels = closeAllSidePanels;

// ----------------------------------------------------
// Window Slide Panel Panel Toggles
// ----------------------------------------------------

btnSettings.addEventListener('click', () => {
  const isOpening = settingsPanel.classList.contains('hidden');
  if (isOpening) {
    closeAllSidePanels('settings-panel');
    settingsPanel.classList.remove('hidden');
    updateAccountUI();
  } else {
    settingsPanel.classList.add('hidden');
  }
  updateLayout();
});
btnCloseSettings.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  updateLayout();
});

btnDownloadsToggle.addEventListener('click', () => {
  const isOpening = downloadsPanel.classList.contains('hidden');
  if (isOpening) {
    closeAllSidePanels('downloads-panel');
    downloadsPanel.classList.remove('hidden');
    renderDownloads();
  } else {
    downloadsPanel.classList.add('hidden');
  }
  updateLayout();
});
btnCloseDownloads.addEventListener('click', () => {
  downloadsPanel.classList.add('hidden');
  updateLayout();
});

btnBookmarksToggle.addEventListener('click', () => {
  const isOpening = bookmarksPanel.classList.contains('hidden');
  if (isOpening) {
    closeAllSidePanels('bookmarks-panel');
    bookmarksPanel.classList.remove('hidden');
    loadBookmarks();
  } else {
    bookmarksPanel.classList.add('hidden');
  }
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
  if (typeof updateShieldsUI === 'function') updateShieldsUI();
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
    if (typeof addToHistory === 'function') addToHistory(data.title, currentTab.url);
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
      if (typeof updateShieldsUI === 'function') updateShieldsUI();
    }
    if (typeof addToHistory === 'function') addToHistory(currentTab.title, data.url);
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
    if (btnMicRoutingToggle) {
      btnMicRoutingToggle.classList.remove('active');
      btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.remove('hidden');
      btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.add('hidden');
    }
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
    if (btnMicRoutingToggle) {
      btnMicRoutingToggle.classList.add('active');
      btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.add('hidden');
      btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.remove('hidden');
      btnMicRoutingToggle.title = `Audio routing active: ${resolved.source}. Click to configure.`;
    }
    
    statusRouting.innerText = `Audio Routing: Active (${resolved.source})`;
    statusRouting.classList.add('active');
  } else {
    if (btnMicRoutingToggle) {
      btnMicRoutingToggle.classList.remove('active');
      btnMicRoutingToggle.querySelector('.mic-icon-mic').classList.remove('hidden');
      btnMicRoutingToggle.querySelector('.mic-icon-routing').classList.add('hidden');
      btnMicRoutingToggle.title = 'Switch Microphone to Laptop Output / Virtual Audio Injection. Click to configure.';
    }
    
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
  const statusLeft = document.getElementById('status-left');
  
  if (statusLeft) statusLeft.innerText = text;
  
  if (!toast) return;
  toast.innerText = text;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    if (statusLeft) statusLeft.innerText = 'Ready';
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

window.electronAPI.on('shortcut-toggle-protection', async () => {
  const current = toggleContentProtection.checked;
  const next = !current;
  const res = await window.electronAPI.setContentProtection(next);
  if (res.success) {
    toggleContentProtection.checked = next;
    updateContentProtectionUI(next);
    showToastNotification(`Content Protection: ${next ? 'On' : 'Off'}`);
  } else {
    showToastNotification(`Failed to toggle Protection: ${res.error || 'unknown'}`);
  }
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
    dl.completedAt = Date.now();
  }
  updateDownloadBadge();
  renderDownloads();
  // Flash ring green for 2s on completion
  const ring = document.getElementById('dl-ring-progress');
  if (ring && data.state === 'completed') {
    ring.classList.remove('hidden');
    ring.classList.add('complete');
    ring.style.strokeDashoffset = 0;
    setTimeout(() => { ring.classList.add('hidden'); ring.classList.remove('complete'); }, 2000);
  }
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

// --- SECURE VAULT & PERSONA MANAGEMENT CONTROLLERS ---
let elsVault = {};

function savePersona() {
  const data = {
    name: elsVault.personaName ? elsVault.personaName.value.trim() : '',
    email: elsVault.personaEmail ? elsVault.personaEmail.value.trim() : '',
    phone: elsVault.personaPhone ? elsVault.personaPhone.value.trim() : '',
    location: elsVault.personaLocation ? elsVault.personaLocation.value.trim() : '',
    skills: elsVault.personaSkills ? elsVault.personaSkills.value.trim() : '',
    summary: elsVault.personaSummary ? elsVault.personaSummary.value.trim() : '',
    resumeName: (elsVault.resumeFile && elsVault.resumeFile.files && elsVault.resumeFile.files[0]) ? elsVault.resumeFile.files[0].name : (elsVault.resumeStatus ? elsVault.resumeStatus.innerText.replace('Resume: ', '') : '')
  };
  if (data.resumeName === 'None Loaded') data.resumeName = '';

  localStorage.setItem('devilbrowser-persona', JSON.stringify(data));
  showToastNotification('Persona Vault updated successfully');
}

function loadPersona() {
  try {
    const dataStr = localStorage.getItem('devilbrowser-persona');
    if (dataStr) {
      const data = JSON.parse(dataStr);
      if (elsVault.personaName) elsVault.personaName.value = data.name || '';
      if (elsVault.personaEmail) elsVault.personaEmail.value = data.email || '';
      if (elsVault.personaPhone) elsVault.personaPhone.value = data.phone || '';
      if (elsVault.personaLocation) elsVault.personaLocation.value = data.location || '';
      if (elsVault.personaSkills) elsVault.personaSkills.value = data.skills || '';
      if (elsVault.personaSummary) elsVault.personaSummary.value = data.summary || '';
      if (data.resumeName) {
        if (elsVault.resumeStatus) elsVault.resumeStatus.innerText = "Resume: " + data.resumeName;
      }
    }
  } catch (e) {
    console.error('Failed to load persona data:', e);
  }
}

async function loadCredentials() {
  if (!elsVault.credentialsList) return;
  try {
    const res = await window.electronAPI.listCredentials();
    if (res.success && res.list) {
      if (res.list.length === 0) {
        elsVault.credentialsList.innerHTML = `<div class="no-credentials" style="font-size: 11px; color: var(--text-faint); font-style: italic; padding: 4px;">No logins stored yet.</div>`;
        return;
      }
      elsVault.credentialsList.innerHTML = res.list.map(cred => `
        <div class="credential-item" style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.15); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border);">
          <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden; width: calc(100% - 60px);">
            <span style="font-size: 11px; font-weight: bold; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${cred.domain}</span>
            <span style="font-size: 10px; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${cred.username}</span>
          </div>
          <button class="delete-cred-btn danger-btn-outline" data-key="${cred.key}" style="padding: 3px 6px; font-size: 10px; min-width: auto; height: auto;">Delete</button>
        </div>
      `).join('');

      // Attach delete handlers
      const deleteBtns = elsVault.credentialsList.querySelectorAll('.delete-cred-btn');
      deleteBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const key = e.target.getAttribute('data-key');
          if (confirm(`Are you sure you want to delete the stored login for ${key.split(':')[0]}?`)) {
            const delRes = await window.electronAPI.deleteCredential(key);
            if (delRes.success) {
              showToastNotification('Credential deleted');
              loadCredentials();
            } else {
              alert('Failed to delete credential: ' + delRes.error);
            }
          }
        });
      });
    } else {
      elsVault.credentialsList.innerHTML = `<div style="font-size: 11px; color: var(--rose); padding: 4px;">Error: ${res.error}</div>`;
    }
  } catch (e) {
    console.error('Failed to load credentials:', e);
  }
}

async function saveCredential() {
  const domain = elsVault.credDomain ? elsVault.credDomain.value.trim() : '';
  const username = elsVault.credUsername ? elsVault.credUsername.value.trim() : '';
  const password = elsVault.credPassword ? elsVault.credPassword.value : '';

  if (!domain || !username || !password) {
    alert('Please fill out all fields (Domain, Username, Password)');
    return;
  }

  try {
    const res = await window.electronAPI.saveCredential({ domain, username, password });
    if (res.success) {
      showToastNotification('Secure login added successfully');
      if (elsVault.credDomain) elsVault.credDomain.value = '';
      if (elsVault.credUsername) elsVault.credUsername.value = '';
      if (elsVault.credPassword) elsVault.credPassword.value = '';
      loadCredentials();
    } else {
      alert('Failed to save credential: ' + res.error);
    }
  } catch (err) {
    console.error('Failed to save credential:', err);
  }
}

function initSettingsVault() {
  elsVault = {
    personaName: document.getElementById('persona-name'),
    personaEmail: document.getElementById('persona-email'),
    personaPhone: document.getElementById('persona-phone'),
    personaLocation: document.getElementById('persona-location'),
    personaSkills: document.getElementById('persona-skills'),
    personaSummary: document.getElementById('persona-summary'),
    resumeStatus: document.getElementById('resume-status'),
    resumeFile: document.getElementById('persona-resume-file'),
    btnUploadResume: document.getElementById('btn-upload-resume'),
    btnSavePersona: document.getElementById('btn-save-persona'),
    
    credDomain: document.getElementById('cred-domain'),
    credUsername: document.getElementById('cred-username'),
    credPassword: document.getElementById('cred-password'),
    btnSaveCredential: document.getElementById('btn-save-credential'),
    credentialsList: document.getElementById('credentials-list')
  };

  if (elsVault.btnUploadResume && elsVault.resumeFile) {
    elsVault.btnUploadResume.addEventListener('click', () => elsVault.resumeFile.click());
  }
  if (elsVault.resumeFile) {
    elsVault.resumeFile.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        if (elsVault.resumeStatus) elsVault.resumeStatus.innerText = "Resume: " + file.name;
      }
    });
  }
  if (elsVault.btnSavePersona) {
    elsVault.btnSavePersona.addEventListener('click', savePersona);
  }
  if (elsVault.btnSaveCredential) {
    elsVault.btnSaveCredential.addEventListener('click', saveCredential);
  }

  loadPersona();
  loadCredentials();
}

// --- Core Renderer Orchestration for Coatcard Features ---

// Element cached references
const btnHome = document.getElementById('btn-home');
const btnClearAddress = document.getElementById('btn-clear-address');
const btnQrCode = document.getElementById('btn-qr-code');
const zoomBadge = document.getElementById('zoom-badge');
const autocompleteSuggestions = document.getElementById('autocomplete-suggestions');
const scrollProgressBar = document.getElementById('scroll-progress-bar');
const offlineBanner = document.getElementById('offline-banner');

const sslCertModal = document.getElementById('ssl-cert-modal');
const certHostLabel = document.getElementById('cert-host-label');
const certStatus = document.getElementById('cert-status');
const certIssuer = document.getElementById('cert-issuer');
const certFrom = document.getElementById('cert-from');
const certTo = document.getElementById('cert-to');
const certCipher = document.getElementById('cert-cipher');
const certToggleJs = document.getElementById('cert-toggle-js');
const certToggleImages = document.getElementById('cert-toggle-images');
const btnSaveSiteSettings = document.getElementById('btn-save-site-settings');
const btnCloseCert = document.getElementById('btn-close-cert');

const qrModal = document.getElementById('qr-modal');
const qrImage = document.getElementById('qr-image');
const btnCloseQr = document.getElementById('btn-close-qr');

const findInPageBox = document.getElementById('find-in-page-box');
const findInput = document.getElementById('find-input');
const findResults = document.getElementById('find-results');
const btnFindPrev = document.getElementById('btn-find-prev');
const btnFindNext = document.getElementById('btn-find-next');
const findCaseSensitive = document.getElementById('find-case-sensitive');
const findRegex = document.getElementById('find-regex');
const btnCloseFind = document.getElementById('btn-close-find');

const taskManagerModal = document.getElementById('task-manager-modal');
const taskManagerTbody = document.getElementById('task-manager-tbody');
const btnCloseTasks = document.getElementById('btn-close-tasks');

const readerView = document.getElementById('reader-view');
const readerTitle = document.getElementById('reader-title');
const readerBody = document.getElementById('reader-body');
const readerReadingTime = document.getElementById('reader-reading-time');
const btnCloseReader = document.getElementById('btn-close-reader');

// Tab Metadata Event Listener
window.electronAPI.on('tab-metadata-updated', (data) => {
  const tab = tabs.find(t => t.id === data.id);
  if (tab) {
    Object.assign(tab, data);
    renderTabs();
    if (data.id === activeTabId) {
      if (data.url !== undefined) {
        addressInput.value = data.url === 'about:blank' ? '' : data.url;
        updateProtocolBadge(data.url);
      }
      if (data.zoomLevel !== undefined) {
        showZoomBadge(data.zoomLevel);
      }
    }
  }
});

// Update protocol badge styling (Feature 30)
function updateProtocolBadge(url) {
  if (!url || url === 'about:blank') {
    sslBadge.style.display = 'none';
    return;
  }
  sslBadge.style.display = 'flex';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      sslBadge.className = 'secure';
      sslBadge.title = 'Secure Connection (HTTPS)';
      sslBadge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;
    } else {
      sslBadge.className = 'warning';
      sslBadge.title = 'Not Secure Connection (HTTP)';
      sslBadge.innerHTML = `⚠️ HTTP`;
    }
  } catch (e) {
    sslBadge.style.display = 'none';
  }
}

// Tab crashed event listener (Feature 93)
window.electronAPI.on('tab-crashed', (data) => {
  const tab = tabs.find(t => t.id === data.id);
  if (tab) {
    tab.crashed = true;
    showToastNotification(`Tab crashed: ${data.reason}`);
    renderTabs();
  }
});

// Tab right-click menu handler (Features 1-18)
function showTabContextMenu(x, y, tab) {
  const existing = document.getElementById('tab-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'tab-context-menu';
  menu.style.position = 'fixed';
  menu.style.top = `${y}px`;
  menu.style.left = `${x}px`;
  menu.style.background = 'var(--glass-bg)';
  menu.style.backdropFilter = 'var(--glass-blur)';
  menu.style.border = '1px solid var(--border-accent)';
  menu.style.borderRadius = 'var(--r-md)';
  menu.style.padding = '4px 0';
  menu.style.zIndex = '10000';
  menu.style.boxShadow = 'var(--shadow-lg), 0 0 10px rgba(139, 92, 246, 0.15)';
  menu.style.minWidth = '160px';

  const items = [
    { label: '✨ Duplicate Tab', action: () => window.electronAPI.duplicateTab(tab.id) },
    { label: tab.pinned ? '📌 Unpin Tab' : '📌 Pin Tab', action: () => window.electronAPI.togglePinTab(tab.id) },
    { label: '💤 Discard Tab', enabled: !tab.pinned && tab.id !== activeTabId, action: () => window.electronAPI.discardTab(tab.id) },
    { type: 'separator' },
    { label: 'Close Tab', action: () => window.electronAPI.closeTab(tab.id) },
    { label: 'Close Other Tabs', enabled: tabs.length > 1, action: () => {
        tabs.filter(t => t.id !== tab.id && !t.pinned).forEach(t => window.electronAPI.closeTab(t.id));
      } 
    },
    { label: 'Close Tabs to the Right', enabled: tabs.findIndex(t => t.id === tab.id) < tabs.length - 1, action: () => {
        const idx = tabs.findIndex(t => t.id === tab.id);
        tabs.slice(idx + 1).filter(t => !t.pinned).forEach(t => window.electronAPI.closeTab(t.id));
      } 
    },
    { type: 'separator' },
    { label: '⭐ Bookmark Tab', action: () => {
        bookmarks.push({ title: tab.title, url: tab.url });
        window.electronAPI.saveBookmarks(bookmarks);
        showToastNotification('Tab Bookmarked!');
        loadBookmarks();
      } 
    }
  ];

  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.style.height = '1px';
      sep.style.background = 'var(--border-subtle)';
      sep.style.margin = '4px 0';
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.style.width = '100%';
    btn.style.padding = '6px 12px';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.color = item.enabled === false ? 'var(--text-faint)' : 'var(--text-secondary)';
    btn.style.textAlign = 'left';
    btn.style.fontSize = '11px';
    btn.style.cursor = item.enabled === false ? 'not-allowed' : 'pointer';
    btn.innerText = item.label;

    if (item.enabled !== false) {
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(139, 92, 246, 0.18)'; btn.style.color = 'white'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = 'var(--text-secondary)'; });
      btn.addEventListener('click', () => {
        item.action();
        menu.remove();
      });
    }
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
    document.addEventListener('contextmenu', closeMenu);
  }, 50);
}

// Address bar clear button functionality
if (addressInput && btnClearAddress) {
  addressInput.addEventListener('input', () => {
    if (addressInput.value) {
      btnClearAddress.classList.remove('hidden');
    } else {
      btnClearAddress.classList.add('hidden');
    }
  });

  btnClearAddress.addEventListener('click', () => {
    addressInput.value = '';
    btnClearAddress.classList.add('hidden');
    if (typeof closeSuggestions === 'function') closeSuggestions();
    addressInput.focus();
  });
}

// Zoom level badge logic (Features 54, 55, 56)
function showZoomBadge(zoomLevel) {
  if (zoomLevel === 0) {
    zoomBadge.classList.add('hidden');
    return;
  }
  const percentage = Math.round(100 * Math.pow(1.2, zoomLevel));
  zoomBadge.innerText = `${percentage}%`;
  zoomBadge.classList.remove('hidden');
}

zoomBadge.addEventListener('click', () => {
  if (activeTabId) {
    window.electronAPI.setZoomLevel(activeTabId, 0);
  }
});

// SSL Certificate Viewer & Site settings popover (Feature 24, 27, 88, 89)
sslBadge.addEventListener('click', async () => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || activeTab.url === 'about:blank') return;

  try {
    const cert = await window.electronAPI.getCertificateInfo(activeTab.url);
    if (!cert.secure) {
      alert('This connection is not encrypted (HTTP)');
      return;
    }
    const domain = new URL(activeTab.url).hostname;
    const settings = await window.electronAPI.getSiteSettings(domain);

    certHostLabel.innerText = domain;
    certIssuer.innerText = cert.issuer;
    certFrom.innerText = cert.validFrom;
    certTo.innerText = cert.validTo;

    certToggleJs.checked = settings.jsEnabled;
    certToggleImages.checked = settings.imagesEnabled;

    window.electronAPI.setViewsVisibility(false);
    sslCertModal.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to get certificate details:', err);
  }
});

btnSaveSiteSettings.addEventListener('click', async () => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) return;
  try {
    const domain = new URL(activeTab.url).hostname;
    await window.electronAPI.saveSiteSettings(domain, {
      jsEnabled: certToggleJs.checked,
      imagesEnabled: certToggleImages.checked
    });
    sslCertModal.classList.add('hidden');
    window.electronAPI.setViewsVisibility(true);
    window.electronAPI.reload(activeTabId);
    showToastNotification('Site settings updated. Page reloaded.');
  } catch (err) {
    console.error(err);
  }
});

btnCloseCert.addEventListener('click', () => {
  sslCertModal.classList.add('hidden');
  window.electronAPI.setViewsVisibility(true);
});

// QR Code Generator (Feature 31)
btnQrCode.addEventListener('click', () => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || activeTab.url === 'about:blank') return;

  qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(activeTab.url)}`;
  window.electronAPI.setViewsVisibility(false);
  qrModal.classList.remove('hidden');
});

btnCloseQr.addEventListener('click', () => {
  qrModal.classList.add('hidden');
  window.electronAPI.setViewsVisibility(true);
});

// Find-in-page Ctrl+F Box handlers (Feature 53)
window.electronAPI.on('focus-find-in-page', () => {
  findInPageBox.classList.remove('hidden');
  findInput.focus();
  findInput.select();
  runFindInPage();
});

let findTimer = null;
function runFindInPage() {
  if (!activeTabId) return;
  const text = findInput.value;
  if (!text) {
    window.electronAPI.stopFindInPage(activeTabId, 'clearSelection');
    findResults.innerText = '0 / 0';
    return;
  }
  const isCaseSensitive = findCaseSensitive.checked;
  window.electronAPI.findInPage(activeTabId, text, {
    forward: true,
    findNext: false,
    matchCase: isCaseSensitive
  });
}

findInput.addEventListener('input', runFindInPage);
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!activeTabId) return;
    const text = findInput.value;
    if (!text) return;
    window.electronAPI.findInPage(activeTabId, text, {
      forward: !e.shiftKey,
      findNext: true,
      matchCase: findCaseSensitive.checked
    });
  } else if (e.key === 'Escape') {
    closeFindInPage();
  }
});

btnFindPrev.addEventListener('click', () => {
  if (!activeTabId) return;
  window.electronAPI.findInPage(activeTabId, findInput.value, {
    forward: false,
    findNext: true,
    matchCase: findCaseSensitive.checked
  });
});

btnFindNext.addEventListener('click', () => {
  if (!activeTabId) return;
  window.electronAPI.findInPage(activeTabId, findInput.value, {
    forward: true,
    findNext: true,
    matchCase: findCaseSensitive.checked
  });
});

findCaseSensitive.addEventListener('change', runFindInPage);
findRegex.addEventListener('change', runFindInPage);

function closeFindInPage() {
  findInPageBox.classList.add('hidden');
  if (activeTabId) {
    window.electronAPI.stopFindInPage(activeTabId, 'clearSelection');
  }
}
btnCloseFind.addEventListener('click', closeFindInPage);

window.electronAPI.on('find-results-updated', (data) => {
  findResults.innerText = `${data.activeMatchOrdinal} / ${data.numberOfMatches}`;
});

// Browser Task Manager (Feature 86)
let taskInterval = null;
async function updateTaskManager() {
  const metrics = await window.electronAPI.getAppMetrics();
  taskManagerTbody.innerHTML = metrics.map(m => `
    <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
      <td style="padding: 6px 8px; color: var(--text-primary); max-width: 250px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${m.name}</td>
      <td style="padding: 6px 8px; color: var(--text-muted);">${m.pid}</td>
      <td style="padding: 6px 8px; color: var(--accent-bright); font-weight: 500;">${(m.memory / 1024 / 1024).toFixed(1)} MB</td>
      <td style="padding: 6px 8px; color: var(--cyan);">${m.cpu.toFixed(1)}%</td>
    </tr>
  `).join('');
}

function openTaskManager() {
  window.electronAPI.setViewsVisibility(false);
  taskManagerModal.classList.remove('hidden');
  updateTaskManager();
  taskInterval = setInterval(updateTaskManager, 2000);
}

function closeTaskManager() {
  taskManagerModal.classList.add('hidden');
  window.electronAPI.setViewsVisibility(true);
  if (taskInterval) {
    clearInterval(taskInterval);
    taskInterval = null;
  }
}
btnCloseTasks.addEventListener('click', closeTaskManager);

// Reader View Mode (Feature 66)
async function toggleReaderMode() {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || activeTab.url === 'about:blank') return;

  if (!readerView.classList.contains('hidden')) {
    readerView.classList.add('hidden');
    return;
  }

  // Extract page content using AI DOM and Text fetchers
  try {
    const text = await window.electronAPI.aiGetPageText(activeTabId);
    const docLength = text.length;
    const readingTime = Math.max(1, Math.round(docLength / 1200));

    readerTitle.innerText = activeTab.title || 'Extracted Reader View';
    readerReadingTime.innerText = `⏱️ ${readingTime} min read`;
    
    // Format text into html blocks
    const blocks = text.split('\n\n').map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.length < 80 && !trimmed.endsWith('.')) {
        return `<h2 style="font-family: var(--font-header); font-size: 20px; color: white; margin-top: 24px; margin-bottom: 12px;">${trimmed}</h2>`;
      }
      return `<p style="margin-bottom: 16px;">${trimmed}</p>`;
    }).join('');

    readerBody.innerHTML = blocks;
    readerView.classList.remove('hidden');
  } catch (err) {
    showToastNotification('Reader mode failed: ' + String(err));
  }
}

btnCloseReader.addEventListener('click', () => {
  readerView.classList.add('hidden');
});

// Scroll progress line update (Feature 69)
window.electronAPI.on('active-tab-scroll', (pct) => {
  scrollProgressBar.style.width = `${pct}%`;
});

// Connection state listener (Feature 68)
window.electronAPI.on('network-status-changed', (isOnline) => {
  if (isOnline) {
    offlineBanner.classList.add('hidden');
  } else {
    offlineBanner.classList.remove('hidden');
  }
});

// Home button click handler (Feature 59)
btnHome.addEventListener('click', () => {
  if (activeTabId) {
    const homeUrl = localStorage.getItem('devilbrowser-homepage') || 'about:blank';
    window.electronAPI.navigateTab({ tabId: activeTabId, url: homeUrl });
  }
});



// Extends command palette listings with browser tasks & reader mode (Feature 86, 66)
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (window.cmdPalette) {
      const originalGetItems = window.cmdPalette.getItems ? window.cmdPalette.getItems.bind(window.cmdPalette) : null;
      if (originalGetItems) {
        window.cmdPalette.getItems = function() {
          const defaults = originalGetItems();
          defaults.push({
            id: 'task-manager',
            title: 'System: Open Task Manager',
            category: 'Diagnostics',
            action: () => openTaskManager()
          });
          defaults.push({
            id: 'reader-mode',
            title: 'View: Toggle Reader Mode',
            category: 'Accessibility',
            action: () => toggleReaderMode()
          });
          defaults.push({
            id: 'view-source',
            title: 'Developer: View Page Source',
            category: 'Developer Tools',
            action: () => {
              const activeTab = tabs.find(t => t.id === activeTabId);
              if (activeTab && activeTab.url !== 'about:blank') {
                window.electronAPI.createTab(`view-source:${activeTab.url}`);
              }
            }
          });
          return defaults;
        };
      }
    }
  }, 1000);
});

// Initializer
async function init() {
  initClock();
  watchTopbarHeight();
  await loadPreferences();
  loadBookmarks();
  await updateAudioRoutingUIForActiveTab();
  await updateAccountUI();
  await updateStatsUI();
  if (window.aiAuth) {
    await window.aiAuth.init();
  }
  initSettingsVault();
  if (typeof initNewTabWidgets === 'function') initNewTabWidgets();
  if (typeof updateShieldsUI === 'function') updateShieldsUI();
}

document.addEventListener('DOMContentLoaded', init);

// ==========================================================================
// HISTORY & AUTOCOMPLETE HELPER
// ==========================================================================
function addToHistory(title, url) {
  if (!url || url === 'about:blank' || url.startsWith('chrome-error://') || url.startsWith('file:///')) return;
  let history = JSON.parse(localStorage.getItem('browsing_history') || '[]');
  if (history.length > 0 && history[0].url === url) return;
  history.unshift({ title: title || url, url, timestamp: Date.now() });
  if (history.length > 2000) history.pop();
  localStorage.setItem('browsing_history', JSON.stringify(history));
}

// ==========================================================================
// COATCARD SHIELDS & UPGRADES (Features 1-15)
// ==========================================================================
const btnShields = document.getElementById('btn-shields');
const shieldsPopover = document.getElementById('shields-popover');
const shieldsEnable = document.getElementById('shields-enable');
const shieldsBlockedCount = document.getElementById('shields-blocked-count');
const shieldsFingerprinting = document.getElementById('shields-fingerprinting');
const shieldsBlockScripts = document.getElementById('shields-block-scripts');
const shieldsBlockSocial = document.getElementById('shields-block-social');
const shieldsBlockCookieBanners = document.getElementById('shields-block-cookie-banners');
const shieldsForgetTabClose = document.getElementById('shields-forget-tab-close');
const shieldsHttpsStatus = document.getElementById('shields-https-upgrade-status');

if (btnShields) {
  btnShields.addEventListener('click', (e) => {
    e.stopPropagation();
    shieldsPopover.classList.toggle('hidden');
    audioRoutingPopover.classList.add('hidden');
  });
}

// Close popovers on body click
document.body.addEventListener('click', () => {
  if (shieldsPopover) shieldsPopover.classList.add('hidden');
  if (audioRoutingPopover) audioRoutingPopover.classList.add('hidden');
});
if (shieldsPopover) {
  shieldsPopover.addEventListener('click', (e) => e.stopPropagation());
}

async function updateShieldsUI() {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || activeTab.url === 'about:blank') {
    shieldsBlockedCount.innerText = '0';
    return;
  }
  try {
    const u = new URL(activeTab.url);
    const host = u.hostname.toLowerCase();
    const settings = await window.electronAPI.getSiteSettings(host);

    shieldsEnable.checked = !!settings.shieldsEnabled;
    shieldsFingerprinting.value = settings.fingerprinting || 'standard';
    shieldsBlockScripts.checked = !!settings.blockScripts;
    shieldsBlockSocial.checked = !!settings.blockSocial;
    shieldsBlockCookieBanners.checked = !!settings.blockCookieBanners;
    shieldsForgetTabClose.checked = !!settings.forgetOnClose;
    shieldsBlockedCount.innerText = activeTab.blockedCount || 0;
  } catch (err) {
    shieldsBlockedCount.innerText = '0';
  }
}

async function saveShieldsSettings() {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || activeTab.url === 'about:blank') return;
  try {
    const u = new URL(activeTab.url);
    const host = u.hostname.toLowerCase();
    const settings = {
      jsEnabled: true,
      imagesEnabled: true,
      shieldsEnabled: shieldsEnable.checked,
      blockTrackers: shieldsEnable.checked,
      blockScripts: shieldsBlockScripts.checked,
      blockSocial: shieldsBlockSocial.checked,
      blockCookieBanners: shieldsBlockCookieBanners.checked,
      forgetOnClose: shieldsForgetTabClose.checked,
      fingerprinting: shieldsFingerprinting.value
    };
    await window.electronAPI.saveSiteSettings(host, settings);
    showToastNotification('Shields settings updated!');
    window.electronAPI.reload(activeTabId);
  } catch (err) {}
}

[shieldsEnable, shieldsFingerprinting, shieldsBlockScripts, shieldsBlockSocial, shieldsBlockCookieBanners, shieldsForgetTabClose].forEach(el => {
  if (el) el.addEventListener('change', saveShieldsSettings);
});

// Listen to stats update from adblocker
window.electronAPI.on('shields-stats-updated', (data) => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (activeTab) {
    activeTab.blockedCount = data.count;
    shieldsBlockedCount.innerText = data.count;
  }
});



// ==========================================================================
// OMNIBOX AUTOCOMPLETE & HISTORY (Features 50-60)
// ==========================================================================
const suggestionsDropdown = document.getElementById('autocomplete-suggestions');
let currentSuggestions = [];
let selectedSuggestionIndex = -1;

function closeSuggestions() {
  if (suggestionsDropdown) suggestionsDropdown.classList.add('hidden');
  selectedSuggestionIndex = -1;
  updateLayout();
}

async function handleOmniboxInput() {
  const query = addressInput.value.trim();
  if (!query) {
    closeSuggestions();
    return;
  }

  const searchSugg = await window.electronAPI.getSearchSuggestions(query);
  const history = JSON.parse(localStorage.getItem('browsing_history') || '[]');
  const matchedHist = history.filter(h => h.url.toLowerCase().includes(query.toLowerCase()) || h.title.toLowerCase().includes(query.toLowerCase())).slice(0, 3);
  const matchedBms = bookmarks.filter(b => b.url.toLowerCase().includes(query.toLowerCase()) || b.title.toLowerCase().includes(query.toLowerCase())).slice(0, 3);

  currentSuggestions = [];

  matchedBms.forEach(bm => {
    currentSuggestions.push({ type: 'bookmark', text: bm.url, label: bm.title, icon: '⭐' });
  });

  matchedHist.forEach(h => {
    currentSuggestions.push({ type: 'history', text: h.url, label: h.title, icon: '📜' });
  });

  searchSugg.forEach(s => {
    currentSuggestions.push({ type: 'search', text: s, label: s, icon: '🔍' });
  });

  renderSuggestions();
}

function renderSuggestions() {
  if (currentSuggestions.length === 0) {
    closeSuggestions();
    return;
  }
  if (!suggestionsDropdown) return;
  suggestionsDropdown.innerHTML = '';
  suggestionsDropdown.classList.remove('hidden');

  // Position dynamically below the address-container
  const container = document.getElementById('address-container');
  if (container) {
    const rect = container.getBoundingClientRect();
    suggestionsDropdown.style.left = rect.left + 'px';
    suggestionsDropdown.style.width = rect.width + 'px';
    suggestionsDropdown.style.top = rect.bottom + 'px';
  }

  currentSuggestions.forEach((s, idx) => {
    const item = document.createElement('div');
    item.className = `autocomplete-item ${idx === selectedSuggestionIndex ? 'selected' : ''}`;
    
    const query = addressInput.value.toLowerCase();
    let labelHTML = s.label;
    if (query) {
      const regex = new RegExp(`(${query})`, 'gi');
      labelHTML = s.label.replace(regex, '<strong style="color:var(--accent-bright);">$1</strong>');
    }

    item.innerHTML = `
      <span class="autocomplete-item-icon">${s.icon}</span>
      <span class="autocomplete-item-text">${labelHTML} <span style="font-size:10px; color:var(--text-muted); font-family:monospace; margin-left:8px;">${s.type === 'search' ? '' : s.text}</span></span>
      <span class="autocomplete-item-type">${s.type}</span>
      ${s.type === 'history' ? '<span class="autocomplete-item-delete" title="Delete from history">&times;</span>' : ''}
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('autocomplete-item-delete')) {
        e.stopPropagation();
        deleteHistoryItem(s.text);
        handleOmniboxInput();
        return;
      }
      addressInput.value = s.text;
      handleNavigationSubmit(s.text);
      closeSuggestions();
    });

    suggestionsDropdown.appendChild(item);
  });
  updateLayout();
}

function deleteHistoryItem(url) {
  let history = JSON.parse(localStorage.getItem('browsing_history') || '[]');
  history = history.filter(h => h.url !== url);
  localStorage.setItem('browsing_history', JSON.stringify(history));
  showToastNotification('Removed from history');
}

if (addressInput) {
  addressInput.addEventListener('input', handleOmniboxInput);

  addressInput.addEventListener('keydown', (e) => {
    if (!suggestionsDropdown || suggestionsDropdown.classList.contains('hidden')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
      renderSuggestions();
      addressInput.value = currentSuggestions[selectedSuggestionIndex].text;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedSuggestionIndex = (selectedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
      renderSuggestions();
      addressInput.value = currentSuggestions[selectedSuggestionIndex].text;
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });
}

document.addEventListener('click', (e) => {
  if (addressInput && e.target !== addressInput && suggestionsDropdown && !suggestionsDropdown.contains(e.target)) {
    closeSuggestions();
  }
});

// ==========================================================================
// NEW TAB WIDGETS & SETUP (Features 31-45)
// ==========================================================================
const quoteEl = document.getElementById('new-tab-quote');
const greetingEl = document.getElementById('new-tab-greeting');
const timeEl = document.getElementById('current-time');

const quotes = [
  '"Security is not a product, but a process." - Bruce Schneier',
  '"The web as I envisaged it, we have not seen it yet. The future is still so much bigger." - Tim Berners-Lee',
  '"Privacy is not an option, and it shouldn\'t be the price we pay for just getting on the Internet." - Gary Kovacs',
  '"The only secure computer is one that is turned off, locked in a safe." - J. H. Carlin',
  '"With great power comes great responsibility." - Uncle Ben'
];

function initNewTabWidgets() {
  const hours = new Date().getHours();
  let greeting = 'Good Day';
  if (hours < 12) greeting = 'Good Morning';
  else if (hours < 18) greeting = 'Good Afternoon';
  else greeting = 'Good Evening';
  if (greetingEl) greetingEl.innerText = greeting;

  if (quoteEl) {
    const idx = Math.floor(Math.random() * quotes.length);
    quoteEl.innerText = quotes[idx];
  }

  if (timeEl) {
    timeEl.addEventListener('click', () => {
      const is24 = localStorage.getItem('clock_24h') === 'true';
      localStorage.setItem('clock_24h', !is24);
      initClock();
    });
  }

  const btnAddQuickLink = document.getElementById('btn-add-quick-link');
  if (btnAddQuickLink) {
    btnAddQuickLink.addEventListener('click', () => {
      const label = prompt('Enter shortcut name:');
      if (!label) return;
      const url = prompt('Enter URL (e.g. https://google.com):');
      if (!url) return;
      
      const linksContainer = document.getElementById('ntp-quick-links');
      const newLink = document.createElement('a');
      newLink.className = 'quick-link-item';
      newLink.href = url;
      newLink.innerHTML = `
        <div class="icon-wrap">${label[0].toUpperCase()}</div>
        <span>${label}</span>
      `;
      linksContainer.insertBefore(newLink, btnAddQuickLink);
      showToastNotification('Shortcut added successfully!');
    });
  }
}

let clockInterval = null;
function initClock() {
  if (clockInterval) clearInterval(clockInterval);
  if (!timeEl) return;
  const update = () => {
    const is24 = localStorage.getItem('clock_24h') === 'true';
    const date = new Date();
    if (is24) {
      const hrs = String(date.getHours()).padStart(2, '0');
      const mins = String(date.getMinutes()).padStart(2, '0');
      timeEl.innerText = `${hrs}:${mins}`;
    } else {
      let hrs = date.getHours();
      const ampm = hrs >= 12 ? 'PM' : 'AM';
      hrs = hrs % 12;
      hrs = hrs ? hrs : 12;
      const mins = String(date.getMinutes()).padStart(2, '0');
      timeEl.innerText = `${hrs}:${mins} ${ampm}`;
    }
  };
  update();
  clockInterval = setInterval(update, 1000);
}

