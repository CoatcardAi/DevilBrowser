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
  'tab-audio-settings-changed'
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

  // Secure Event Pub/Sub
  on: (channel, cb) => {
    if (SAFE_CHANNELS.includes(channel)) {
      const subscription = (event, ...args) => cb(...args);
      ipcRenderer.on(channel, subscription);
      // Return a cleanup function
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
  }
});
