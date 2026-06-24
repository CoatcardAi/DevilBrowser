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
  'tab-audio-settings-changed',
  'adblocker-state-changed',
  'always-ontop-state-changed',
  'stats-updated'
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
  'ai-stream-error'
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

  // ── AI Auth ──
  aiLogin:      (email) => ipcRenderer.invoke('ai-login', email),
  aiVerifyOtp:  (email, otp) => ipcRenderer.invoke('ai-verify-otp', { email, otp }),
  aiLogout:     () => ipcRenderer.invoke('ai-logout'),
  aiGetMe:      () => ipcRenderer.invoke('ai-get-me'),
  aiGetToken:   () => ipcRenderer.invoke('ai-get-token'),

  // ── AI Generation ──
  aiGenerate:       (payload) => ipcRenderer.invoke('ai-generate', payload),
  aiGenerateStream: (payload) => ipcRenderer.invoke('ai-generate-stream', payload),
  aiGetModels:      () => ipcRenderer.invoke('ai-get-models'),
  aiGetQuota:       () => ipcRenderer.invoke('ai-get-quota'),
  aiGetLogs:        (params) => ipcRenderer.invoke('ai-get-logs', params),
  aiGetPageText:    (tabId) => ipcRenderer.invoke('ai-get-page-text', tabId),
  aiGetPageDOM:     (tabId) => ipcRenderer.invoke('ai-get-page-dom', tabId),
  aiExecutePageAction: (script, tabId) => ipcRenderer.invoke('ai-execute-page-action', { script, tabId }),
  aiGetPageScreenshot: () => ipcRenderer.invoke('ai-get-page-screenshot'),
  aiAnalyseDocument: (filePath, mimeType, name) => ipcRenderer.invoke('ai-analyse-document', { filePath, mimeType, name }),
  saveImage: (payload) => ipcRenderer.invoke('save-image', payload),
  aiSaveFile: (filename, content) => ipcRenderer.invoke('ai-save-file', { filename, content }),
  aiSaveState: () => ipcRenderer.invoke('ai-save-state'),
  aiRestoreState: () => ipcRenderer.invoke('ai-restore-state'),
  aiDownloadFile: (url) => ipcRenderer.invoke('ai-download-file', url),
  aiBatchGenerate: (payload) => ipcRenderer.invoke('ai-batch-generate', payload),

  // ── AI Tools Marketplace ──
  aiGetTools:     () => ipcRenderer.invoke('ai-get-tools'),
  aiDownloadTool: (id, filename, type) => ipcRenderer.invoke('ai-download-tool', { id, filename, type }),

  // ── AI Embeddings / Semantic Search ──
  aiSemanticSearch: (query) => ipcRenderer.invoke('ai-semantic-search', query),
  aiIndexPage:      (url, title, text) => ipcRenderer.invoke('ai-index-page', { url, title, text }),

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
