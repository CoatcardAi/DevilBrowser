const { ipcMain, desktopCapturer } = require('electron');
const state = require('../../core/state');
const audioService = require('./audio-service');

function init() {
  const windowManager = require('../../core/window-manager');
  const tabManager = require('../../core/tab-manager');

  ipcMain.handle('set-mic-routing-source', (e, source) => {
    state.micRoutingSource = source; // 'mic' or 'system'
    // Synchronize toggle buttons across all open windows
    for (const entry of state.windows.values()) {
      if (entry.win.webContents !== e.sender) {
        entry.win.webContents.send('mic-routing-source-changed', source);
      }
    }
    return { success: true, source };
  });

  ipcMain.handle('get-mic-routing-source', () => {
    return state.micRoutingSource;
  });

  ipcMain.handle('get-tab-audio-settings', (event, tabId) => {
    return audioService.getAudioSettingsForTabId(tabId);
  });

  ipcMain.handle('set-tab-audio-settings', (event, { tabId, enabled, source, destination }) => {
    let tabEntry = null;
    let winEntry = null;
    for (const entry of state.windows.values()) {
      tabEntry = entry.tabs.find(t => t.id === tabId);
      if (tabEntry) {
        winEntry = entry;
        break;
      }
    }

    const settings = { enabled, source, destination };

    if (destination === 'all') {
      state.globalAudioSettings = { enabled, source };
    } else if (destination === 'domain' && tabEntry && tabEntry.url && tabEntry.url !== 'about:blank') {
      try {
        const hostname = new URL(tabEntry.url).hostname;
        const domainSettingsStore = state.store.get('domainAudioSettings', {});
        if (enabled) {
          domainSettingsStore[hostname] = { enabled, source, destination: 'domain' };
        } else {
          delete domainSettingsStore[hostname];
        }
        state.store.set('domainAudioSettings', domainSettingsStore);
      } catch (e) {
        console.error('Error saving domain audio settings:', e);
      }
    } else {
      if (enabled) {
        state.tabAudioSettings.set(tabId, { enabled, source, destination: 'tab' });
      } else {
        state.tabAudioSettings.delete(tabId);
      }
    }

    if (winEntry) {
      winEntry.win.webContents.send('tab-audio-settings-changed', { tabId, settings });
    }

    if (destination === 'all') {
      for (const entry of state.windows.values()) {
        if (entry !== winEntry) {
          entry.win.webContents.send('tab-audio-settings-changed', { tabId, settings });
        }
      }
    }

    return { success: true };
  });

  ipcMain.handle('get-active-tab-audio-settings', (event) => {
    const res = tabManager.getTabByWebContents(event.sender);
    if (res) {
      return audioService.resolveAudioSettingsForTab(res.tab);
    }
    return { enabled: false, source: 'mic' };
  });

  ipcMain.handle('get-desktop-audio-source-id', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    const primary = sources[0];
    return primary ? primary.id : null;
  });

  ipcMain.handle('list-audio-devices', async () => {
    if (process.platform !== 'win32') {
      return { success: false, error: 'Audio device setting automation is currently only supported on Windows' };
    }
    const res = await audioService.runAudioHelper(['-Action', 'list']);
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
    const res = await audioService.runAudioHelper(['-Action', 'set', '-DeviceId', deviceId]);
    return res;
  });
}

module.exports = {
  init
};
