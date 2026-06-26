const { app, ipcMain, BrowserWindow, dialog } = require('electron');
const state = require('../../core/state');

function init() {
  ipcMain.handle('pause-download', (e, id) => {
    const item = state.activeDownloads.get(id);
    if (item) {
      item.pause();
      return true;
    }
    return false;
  });

  ipcMain.handle('resume-download', (e, id) => {
    const item = state.activeDownloads.get(id);
    if (item && item.isPaused()) {
      item.resume();
      return true;
    }
    return false;
  });

  ipcMain.handle('cancel-download', (e, id) => {
    const item = state.activeDownloads.get(id);
    if (item) {
      item.cancel();
      state.activeDownloads.delete(id);
      return true;
    }
    return false;
  });

  ipcMain.handle('get-download-directory', () => {
    return state.store.get('downloadDirectory') || app.getPath('downloads');
  });

  ipcMain.handle('select-download-directory', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose Download Folder',
      defaultPath: state.store.get('downloadDirectory') || app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const newDir = result.filePaths[0];
    state.store.set('downloadDirectory', newDir);
    return { canceled: false, path: newDir };
  });
}

module.exports = {
  init
};
