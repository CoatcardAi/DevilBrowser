const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const state = require('../../core/state');

function getUniqueSavePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let filePath = path.join(dir, filename);
  let counter = 1;
  while (fs.existsSync(filePath)) {
    filePath = path.join(dir, `${base} (${counter})${ext}`);
    counter++;
  }
  return filePath;
}

function registerDownloadHandler(ses) {
  ses.on('will-download', (event, item, webContents) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const fileName = item.getFilename();
    const total = item.getTotalBytes();
    
    const downloadDir = state.store.get('downloadDirectory') || app.getPath('downloads');
    const savePath = getUniqueSavePath(downloadDir, fileName);
    item.setSavePath(savePath);

    state.activeDownloads.set(id, item);

    let win = BrowserWindow.fromWebContents(webContents);
    if (!win) {
      for (const entry of state.windows.values()) {
        const tab = entry.tabs.find(t => t.view.webContents === webContents);
        if (tab) {
          win = entry.win;
          break;
        }
      }
    }

    if (win) {
      win.webContents.send('download-started', { id, fileName, total, savePath });
    }

    item.on('updated', (evt, itemState) => {
      const received = item.getReceivedBytes();
      if (win) {
        win.webContents.send('download-updated', {
          id,
          fileName,
          received,
          total,
          state: itemState === 'interrupted' ? 'paused' : itemState
        });
      }
    });

    item.once('done', (evt, itemState) => {
      state.activeDownloads.delete(id);
      if (win) {
        win.webContents.send('download-completed', { id, fileName, savePath, state: itemState });
      }
    });
  });
}

module.exports = {
  getUniqueSavePath,
  registerDownloadHandler
};
