const { app, ipcMain, session, BrowserWindow } = require('electron');
const state = require('./state');

function updateAlwaysOnTopState(enabled) {
  BrowserWindow.getAllWindows().forEach(w => {
    try {
      w.setAlwaysOnTop(enabled);
    } catch (e) {
      console.error('Failed to set always on top:', e);
    }
  });
}

function init() {
  // Permission Request Handler
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    // Automatically grant permissions to the main browser UI shell
    const isMainWindow = Array.from(state.windows.values()).some(w => w.win.webContents === webContents);
    if (isMainWindow) {
      callback(true);
      return;
    }

    // Resolve dependencies dynamically to avoid circular requires
    const tabManager = require('./tab-manager');
    const audioService = require('../services/audio/audio-service');

    // Auto grant permission if active tab virtual routing is enabled
    const tabRes = tabManager.getTabByWebContents(webContents);
    if (tabRes) {
      const resolved = audioService.resolveAudioSettingsForTab(tabRes.tab);
      if (resolved && resolved.enabled) {
        callback(true);
        return;
      }
    }

    const allowed = state.store.get('permissions', {
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

  // Register Preferences IPC Handlers
  ipcMain.handle('get-preferences', () => ({
    adBlockerEnabled: state.adBlockerEnabled,
    alwaysOnTopEnabled: state.alwaysOnTopEnabled,
    browserMode: state.browserMode,
    downloadDirectory: state.store.get('downloadDirectory') || app.getPath('downloads'),
    permissions: state.store.get('permissions', { media: true, notifications: true, geolocation: false }),
    contentProtection: state.store.get('contentProtection', true)
  }));

  ipcMain.handle('save-preferences', (e, prefs) => {
    if (prefs.adBlockerEnabled !== undefined) {
      state.adBlockerEnabled = prefs.adBlockerEnabled;
      for (const entry of state.windows.values()) {
        try { entry.win.webContents.send('adblocker-state-changed', prefs.adBlockerEnabled); } catch (e) {}
      }
    }
    if (prefs.alwaysOnTopEnabled !== undefined) {
      state.alwaysOnTopEnabled = prefs.alwaysOnTopEnabled;
      updateAlwaysOnTopState(prefs.alwaysOnTopEnabled);
      for (const entry of state.windows.values()) {
        try { entry.win.webContents.send('always-ontop-state-changed', prefs.alwaysOnTopEnabled); } catch (e) {}
      }
    }
    if (prefs.browserMode !== undefined) {
      state.browserMode = prefs.browserMode;
    }
    if (prefs.downloadDirectory !== undefined) {
      state.store.set('downloadDirectory', prefs.downloadDirectory);
    }
    if (prefs.permissions !== undefined) {
      state.store.set('permissions', prefs.permissions);
    }
    if (prefs.contentProtection !== undefined) {
      state.store.set('contentProtection', prefs.contentProtection);
    }
    return { success: true };
  });

  ipcMain.handle('set-browser-mode', (e, mode) => {
    state.browserMode = mode;
    return { success: true };
  });

  ipcMain.handle('get-browser-mode', () => {
    return state.browserMode;
  });

  ipcMain.handle('get-stats', () => {
    return {
      adsBlockedToday: state.adsBlockedToday,
      tabsOpenedToday: state.tabsOpenedToday,
      sitesVisitedTodayCount: Array.isArray(state.sitesVisitedToday) ? state.sitesVisitedToday.length : 0,
      sessionDuration: Date.now() - state.sessionStart
    };
  });
}

module.exports = {
  init,
  updateAlwaysOnTopState
};
