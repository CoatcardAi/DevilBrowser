const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const state = require('../../core/state');

function init() {
  const windowManager = require('../../core/window-manager');

  ipcMain.on('hud-state-update', (e, data) => {
    const winEntry = windowManager.getWindowEntry(e.sender);
    if (!winEntry) return;

    if (data.type === 'start') {
      if (!winEntry.hudWindow || winEntry.hudWindow.isDestroyed()) {
        winEntry.hudWindow = new BrowserWindow({
          width: 320,
          height: 180,
          frame: false,
          resizable: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          show: false,
          webPreferences: {
            preload: path.join(app.getAppPath(), 'src', 'preloads', 'preload.js'),
            contextIsolation: true,
            sandbox: false
          }
        });
        winEntry.hudWindow.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'hud.html'));
        winEntry.hudWindow.once('ready-to-show', () => {
          const bounds = winEntry.win.getBounds();
          const x = bounds.x + 20;
          const y = bounds.y + bounds.height - 200;
          winEntry.hudWindow.setBounds({ x, y, width: 320, height: 180 });
          winEntry.hudWindow.show();
          // Send initial data to HUD window
          setTimeout(() => {
            if (winEntry.hudWindow && !winEntry.hudWindow.isDestroyed()) {
              winEntry.hudWindow.webContents.send('hud-data', data);
            }
          }, 300);
        });
      } else {
        winEntry.hudWindow.show();
        winEntry.hudWindow.webContents.send('hud-data', data);
      }
    } else if (data.type === 'stop' || data.type === 'hide') {
      if (winEntry.hudWindow && !winEntry.hudWindow.isDestroyed()) {
        winEntry.hudWindow.close();
        winEntry.hudWindow = null;
      }
      if (winEntry.minimizedWhileWorking) {
        winEntry.minimizedWhileWorking = false;
        if (winEntry.win && !winEntry.win.isDestroyed()) {
          winEntry.win.show();
          winEntry.win.restore();
          winEntry.win.focus();
        }
      }
    } else {
      if (winEntry.hudWindow && !winEntry.hudWindow.isDestroyed()) {
        winEntry.hudWindow.webContents.send('hud-data', data);
      }
      if ((data.type === 'done' || data.type === 'error') && winEntry.minimizedWhileWorking) {
        winEntry.minimizedWhileWorking = false;
        if (winEntry.win && !winEntry.win.isDestroyed()) {
          winEntry.win.show();
          winEntry.win.restore();
          winEntry.win.focus();
        }
      }
    }
  });

  ipcMain.on('hud-cancel-clicked', (e) => {
    // Find which window this HUD belongs to
    for (const entry of state.windows.values()) {
      if (entry.hudWindow && entry.hudWindow.webContents === e.sender) {
        entry.win.webContents.send('hud-cancel-triggered');
        break;
      }
    }
  });

  ipcMain.on('hud-pause-clicked', (e) => {
    for (const entry of state.windows.values()) {
      if (entry.hudWindow && entry.hudWindow.webContents === e.sender) {
        entry.win.webContents.send('hud-pause-triggered');
        break;
      }
    }
  });

  ipcMain.on('hud-resume-clicked', (e) => {
    for (const entry of state.windows.values()) {
      if (entry.hudWindow && entry.hudWindow.webContents === e.sender) {
        entry.win.webContents.send('hud-resume-triggered');
        break;
      }
    }
  });

  ipcMain.on('hud-response', (e, response) => {
    for (const entry of state.windows.values()) {
      if (entry.hudWindow && entry.hudWindow.webContents === e.sender) {
        entry.win.webContents.send('hud-user-response', response);
        break;
      }
    }
  });
}

module.exports = {
  init
};
