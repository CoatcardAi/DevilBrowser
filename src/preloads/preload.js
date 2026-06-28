const { contextBridge, ipcRenderer } = require('electron');

const SAFE_CHANNELS = [
  'tab-created',
  'tab-activated',
  'tab-closed',
  'tab-title-updated',
  'tab-favicon-updated',
  'tab-url-updated',
  'tab-loading-state',
  'download-started',
  'download-updated',
  'download-completed',
  'focus-address-bar',
  'trigger-bookmark',
  'mic-routing-source-changed',
  'shortcut-toggle-routing',
  'shortcut-cycle-source',
  'shortcut-toggle-mix',
  'shortcut-toggle-protection',
  'tab-audio-settings-changed',
  'adblocker-state-changed',
  'always-ontop-state-changed',
  'stats-updated',
  'tab-metadata-updated',
  'tab-crashed',
  'find-results-updated'
];

const AI_SAFE_CHANNELS = [
  'toggle-bookmarks-bar',
  'toggle-bookmarks-panel',
  'toggle-downloads-panel',
  'open-clear-browsing-dialog',
  'focus-find-in-page',
  'ai-context-action',
  'ai-stream-chunk',
  'ai-stream-done',
  'ai-stream-error',
  'hud-data',
  'hud-cancel-triggered',
  'hud-pause-triggered',
  'hud-resume-triggered',
  'hud-user-response',
  'open-command-palette'
];

contextBridge.exposeInMainWorld('electronAPI', {
  // Tab Management
  createTab: (url) => ipcRenderer.invoke('create-tab', url),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  setActiveTab: (tabId) => ipcRenderer.invoke('set-active-tab', tabId),
  navigateTab: (payload) => ipcRenderer.invoke('navigate-tab', payload),
  goBack: (tabId) => ipcRenderer.invoke('tab-go-back', tabId),
  goForward: (tabId) => ipcRenderer.invoke('tab-go-forward', tabId),
  reload: (tabId) => ipcRenderer.invoke('tab-reload', tabId),
  updateLayoutMargins: (payload) => ipcRenderer.invoke('update-layout-margins', payload),
  
  // Settings & Preferences
  setContentProtection: (enabled) => ipcRenderer.invoke('set-content-protection', enabled),
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  savePreferences: (prefs) => ipcRenderer.invoke('save-preferences', prefs),
  setBrowserMode: (mode) => ipcRenderer.invoke('set-browser-mode', mode),
  getBrowserMode: () => ipcRenderer.invoke('get-browser-mode'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  
  // Audio Routing
  getDesktopAudioSourceId: () => ipcRenderer.invoke('get-desktop-audio-source-id'),
  listAudioDevices: () => ipcRenderer.invoke('list-audio-devices'),
  setDefaultRecordingDevice: (id) => ipcRenderer.invoke('set-default-recording-device', id),
  setMicRoutingSource: (source) => ipcRenderer.invoke('set-mic-routing-source', source),
  getMicRoutingSource: () => ipcRenderer.invoke('get-mic-routing-source'),
  getTabAudioSettings: (tabId) => ipcRenderer.invoke('get-tab-audio-settings', tabId),
  setTabAudioSettings: (payload) => ipcRenderer.invoke('set-tab-audio-settings', payload),
  setTabMuted: (tabId, muted) => ipcRenderer.invoke('set-tab-muted', { tabId, muted }),
  isTabMuted: (tabId) => ipcRenderer.invoke('is-tab-muted', tabId),
  
  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  saveBookmarks: (bookmarks) => ipcRenderer.invoke('save-bookmarks', bookmarks),
  
  // Downloads
  pauseDownload: (id) => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id) => ipcRenderer.invoke('resume-download', id),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  getDownloadDirectory: () => ipcRenderer.invoke('get-download-directory'),
  selectDownloadDirectory: () => ipcRenderer.invoke('select-download-directory'),

  // ── AI Auth ──
  aiLogin:      (email) => ipcRenderer.invoke('ai-login', email),
  aiVerifyOtp:  (email, otp) => ipcRenderer.invoke('ai-verify-otp', { email, otp }),
  aiLogout:     () => ipcRenderer.invoke('ai-logout'),
  aiGetMe:      () => ipcRenderer.invoke('ai-get-me'),
  aiGetToken:   () => ipcRenderer.invoke('ai-get-token'),

  // ── Secure Credentials Vault ──
  saveCredential: (payload) => ipcRenderer.invoke('save-credential', payload),
  listCredentials: () => ipcRenderer.invoke('list-credentials'),
  getCredential: (key) => ipcRenderer.invoke('get-credential', key),
  deleteCredential: (key) => ipcRenderer.invoke('delete-credential', key),

  // ── AI Generation ──
  aiGenerate:       (payload) => ipcRenderer.invoke('ai-generate', payload),
  aiGenerateStream: (payload) => ipcRenderer.invoke('ai-generate-stream', payload),
  aiGetModels:      () => ipcRenderer.invoke('ai-get-models'),
  aiGetQuota:       () => ipcRenderer.invoke('ai-get-quota'),
  aiGetLogs:        (params) => ipcRenderer.invoke('ai-get-logs', params),
  aiGetPageText:    (tabId) => ipcRenderer.invoke('ai-get-page-text', tabId),
  aiGetPageDOM:     (tabId) => ipcRenderer.invoke('ai-get-page-dom', tabId),
  aiExecutePageAction: (script, tabId) => ipcRenderer.invoke('ai-execute-page-action', { script, tabId }),
  aiGetPageScreenshot: (tabId) => ipcRenderer.invoke('ai-get-page-screenshot', tabId),
  aiFetchImageBase64: (url) => ipcRenderer.invoke('ai-fetch-image-base64', url),
  aiAnalyseDocument: (filePath, mimeType, name) => ipcRenderer.invoke('ai-analyse-document', { filePath, mimeType, name }),
  saveImage: (payload) => ipcRenderer.invoke('save-image', payload),
  aiSaveFile: (filename, content) => ipcRenderer.invoke('ai-save-file', { filename, content }),
  aiSaveState: () => ipcRenderer.invoke('ai-save-state'),
  aiRestoreState: () => ipcRenderer.invoke('ai-restore-state'),
  aiDownloadFile: (url) => ipcRenderer.invoke('ai-download-file', url),
  aiBatchGenerate: (payload) => ipcRenderer.invoke('ai-batch-generate', payload),
  aiGetTickets: () => ipcRenderer.invoke('ai-get-tickets'),
  aiSubmitTicket: (payload) => ipcRenderer.invoke('ai-submit-ticket', payload),

  // CDP input simulator APIs
  aiCDPClick: (payload) => ipcRenderer.invoke('ai-cdp-click', payload),
  aiCDPType: (payload) => ipcRenderer.invoke('ai-cdp-type', payload),
  aiCDPPressKey: (payload) => ipcRenderer.invoke('ai-cdp-press-key', payload),
  aiIsTabLoading: (tabId) => ipcRenderer.invoke('ai-is-tab-loading', tabId),
  aiSetWorkerTab: (tabId) => ipcRenderer.invoke('ai-set-worker-tab', tabId),

  // ── AI Tools Marketplace ──
  aiGetTools:     () => ipcRenderer.invoke('ai-get-tools'),
  aiDownloadTool: (id, filename, type) => ipcRenderer.invoke('ai-download-tool', { id, filename, type }),

  // ── AI Embeddings / Semantic Search ──
  aiSemanticSearch: (query) => ipcRenderer.invoke('ai-semantic-search', query),
  aiIndexPage:      (url, title, text) => ipcRenderer.invoke('ai-index-page', { url, title, text }),
  aiGetIndexedCount: () => ipcRenderer.invoke('ai-get-indexed-count'),
  aiClearIndexedPages: () => ipcRenderer.invoke('ai-clear-indexed-pages'),

  // ── standalone HUD window actions ──
  hudStateUpdate: (data) => ipcRenderer.send('hud-state-update', data),
  hudCancelClicked: () => ipcRenderer.send('hud-cancel-clicked'),
  hudPauseClicked: () => ipcRenderer.send('hud-pause-clicked'),
  hudResumeClicked: () => ipcRenderer.send('hud-resume-clicked'),
  sendHudResponse: (response) => ipcRenderer.send('hud-response', response),

  // ── Chrome-like Missing Features APIs ──
  duplicateTab: (tabId) => ipcRenderer.invoke('duplicate-tab', tabId),
  findInPage: (tabId, text, options) => ipcRenderer.invoke('find-in-page', { tabId, text, options }),
  stopFindInPage: (tabId, action) => ipcRenderer.invoke('stop-find-in-page', { tabId, action }),
  togglePinTab: (tabId) => ipcRenderer.invoke('toggle-pin-tab', tabId),
  discardTab: (tabId) => ipcRenderer.invoke('discard-tab', tabId),
  getSearchSuggestions: (query) => ipcRenderer.invoke('get-search-suggestions', query),
  getCertificateInfo: (url) => ipcRenderer.invoke('get-certificate-info', url),
  getAppMetrics: () => ipcRenderer.invoke('get-app-metrics'),
  fetchPageSource: (url) => ipcRenderer.invoke('fetch-page-source', url),
  getZoomLevel: (tabId) => ipcRenderer.invoke('get-zoom-level', tabId),
  setZoomLevel: (tabId, zoomLevel) => ipcRenderer.invoke('set-zoom-level', { tabId, zoomLevel }),
  getSiteSettings: (domain) => ipcRenderer.invoke('get-site-settings', domain),
  saveSiteSettings: (domain, settings) => ipcRenderer.invoke('save-site-settings', { domain, settings }),
  restartBrowser: () => ipcRenderer.invoke('restart-browser'),
  printPage: (tabId) => ipcRenderer.invoke('print-page', tabId),
  savePage: (tabId) => ipcRenderer.invoke('save-page', tabId),
  isIncognito: () => ipcRenderer.invoke('is-incognito'),
  createPrivateWindow: () => ipcRenderer.invoke('create-private-window'),
  setViewsVisibility: (visible) => ipcRenderer.invoke('set-views-visibility', visible),

  // ── Streaming event helpers ──
  onAiStream: (onChunk, onDone, onError) => {
    const chunkSub  = (event, text) => onChunk(text);
    const doneSub   = () => onDone();
    const errorSub  = (event, err) => onError(err);
    ipcRenderer.on('ai-stream-chunk', chunkSub);
    ipcRenderer.on('ai-stream-done',  doneSub);
    ipcRenderer.on('ai-stream-error', errorSub);
    // store refs for cleanup
    ipcRenderer._aiStreamSubs = { chunkSub, doneSub, errorSub };
  },
  offAiStream: () => {
    const subs = ipcRenderer._aiStreamSubs;
    if (!subs) return;
    ipcRenderer.removeListener('ai-stream-chunk', subs.chunkSub);
    ipcRenderer.removeListener('ai-stream-done',  subs.doneSub);
    ipcRenderer.removeListener('ai-stream-error', subs.errorSub);
    ipcRenderer._aiStreamSubs = null;
  },

  // Secure Event Pub/Sub
  on: (channel, cb) => {
    const all = [...SAFE_CHANNELS, ...AI_SAFE_CHANNELS];
    if (all.includes(channel)) {
      const subscription = (event, ...args) => cb(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  }
});
