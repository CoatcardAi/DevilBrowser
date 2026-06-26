const { ipcMain } = require('electron');
const state = require('../../core/state');

function init() {
  ipcMain.handle('get-bookmarks', () => {
    return state.store.get('bookmarks', []);
  });

  ipcMain.handle('save-bookmarks', (e, bookmarks) => {
    state.store.set('bookmarks', bookmarks);
    return { success: true };
  });
}

module.exports = {
  init
};
