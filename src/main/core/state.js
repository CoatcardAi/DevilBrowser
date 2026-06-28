const Store = require('electron-store');
const store = new Store({ name: 'user-preferences' });

const windows = new Map();
const activeDownloads = new Map();
const tabAudioSettings = new Map();

let micRoutingSource = 'mic';
let globalAudioSettings = { enabled: false, source: 'mic' };

let adBlockerEnabled = store.get('adBlockerEnabled', false);
let alwaysOnTopEnabled = store.get('alwaysOnTopEnabled', false);
let browserMode = store.get('browserMode', 'tray');

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

module.exports = {
  store,
  windows,
  activeDownloads,
  tabAudioSettings,
  
  get micRoutingSource() { return micRoutingSource; },
  set micRoutingSource(val) { micRoutingSource = val; },

  get globalAudioSettings() { return globalAudioSettings; },
  set globalAudioSettings(val) { globalAudioSettings = val; },

  get adBlockerEnabled() { return adBlockerEnabled; },
  set adBlockerEnabled(val) { adBlockerEnabled = val; store.set('adBlockerEnabled', val); },

  get alwaysOnTopEnabled() { return alwaysOnTopEnabled; },
  set alwaysOnTopEnabled(val) { alwaysOnTopEnabled = val; store.set('alwaysOnTopEnabled', val); },

  get browserMode() { return browserMode; },
  set browserMode(val) { browserMode = val; store.set('browserMode', val); },

  get adsBlockedToday() { return adsBlockedToday; },
  set adsBlockedToday(val) { adsBlockedToday = val; store.set('adsBlockedToday', val); broadcastStats(); },

  get tabsOpenedToday() { return tabsOpenedToday; },
  set tabsOpenedToday(val) { tabsOpenedToday = val; store.set('tabsOpenedToday', val); broadcastStats(); },

  get sitesVisitedToday() { return sitesVisitedToday; },
  set sitesVisitedToday(val) { sitesVisitedToday = val; store.set('sitesVisitedToday', val); broadcastStats(); },

  sessionStart,
  broadcastStats
};
