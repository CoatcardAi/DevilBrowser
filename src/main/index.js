const { app, Menu, session, globalShortcut, BrowserWindow } = require('electron');
const path = require('path');

const state = require('./core/state');
const adBlocker = require('./core/ad-blocker');
const preferences = require('./core/preferences');
const windowManager = require('./core/window-manager');
const tabManager = require('./core/tab-manager');

// Import services and IPC modules
const audioIPC = require('./services/audio/audio-ipc');
const bookmarksIPC = require('./services/bookmarks/bookmarks-ipc');
const downloadsIPC = require('./services/downloads/downloads-ipc');
const downloadService = require('./services/downloads/download-service');
const aiIPC = require('./services/ai/ai-ipc');
const hudIPC = require('./services/hud/hud-ipc');
const audioService = require('./services/audio/audio-service');

// Enforce single instance lock to prevent cache/DB resource access conflicts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
  // Focus the main window of the primary instance
  for (const entry of state.windows.values()) {
    if (entry.win) {
      if (entry.win.isMinimized()) entry.win.restore();
      entry.win.show();
      entry.win.focus();
      break;
    }
  }
});

// Initialize all app readiness settings
app.whenReady().then(() => {
  // Init core configurations
  adBlocker.init();
  preferences.init();
  
  // Register IPC handlers
  audioIPC.init();
  bookmarksIPC.init();
  downloadsIPC.init();
  aiIPC.init();
  hudIPC.init();
  tabManager.init();

  // Set Display Media request handler (Screen Sharing / Audio Loopback)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const requestingWebContents = request.webContents;
    const isMainWindow = Array.from(state.windows.values()).some(w => w.win.webContents === requestingWebContents);
    
    if (isMainWindow) {
      callback({
        video: request.videoRequested ? request.videoRequested : null,
        audio: request.audioRequested ? request.audioRequested : null
      });
      return;
    }

    const tabRes = tabManager.getTabByWebContents(requestingWebContents);
    if (tabRes) {
      const resolved = audioService.resolveAudioSettingsForTab(tabRes.tab);
      if (resolved && resolved.enabled) {
        callback({
          video: request.videoRequested ? request.videoRequested : null,
          audio: request.audioRequested ? request.audioRequested : null
        });
        return;
      }
    }

    if (state.store.get('contentProtection', true)) {
      callback({ video: null, audio: null });
    } else {
      callback({
        video: request.videoRequested ? request.videoRequested : null,
        audio: request.audioRequested ? request.audioRequested : null
      });
    }
  });

  // Intercept media device requests to route mic input dynamically
  session.defaultSession.on('select-media-device', (event, webContents, callback, deviceList) => {
    event.preventDefault();
    
    if (state.micRoutingSource === 'system') {
      const virtualDevice = deviceList.find(d => 
        d.label.toLowerCase().includes('cable') || 
        d.label.toLowerCase().includes('stereo mix') || 
        d.label.toLowerCase().includes('what u hear') || 
        d.label.toLowerCase().includes('virtual')
      );
      
      if (virtualDevice) {
        callback(virtualDevice.deviceId);
        return;
      }
    }
    
    const physicalMic = deviceList.find(d => 
      d.label.toLowerCase().includes('microphone') || 
      d.label.toLowerCase().includes('mic')
    );
    if (physicalMic) {
      callback(physicalMic.deviceId);
    } else if (deviceList.length > 0) {
      callback(deviceList[0].deviceId);
    } else {
      callback('');
    }
  });

  // Handle downloads across normal and incognito sessions
  app.on('session-created', (ses) => {
    downloadService.registerDownloadHandler(ses);
  });
  downloadService.registerDownloadHandler(session.defaultSession);

  // Build minimal native application menu
  const template = [
    {
      label: 'Application',
      submenu: [
        { label: 'New Window', accelerator: 'Ctrl+N', click() { windowManager.createMainWindow(); } },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Initialize System Tray and Global Shortcut
  if (state.browserMode === 'tray') {
    windowManager.createTray();
  }
  windowManager.registerGlobalToggleShortcut();

  // Create initial window
  const initialWin = windowManager.createMainWindow();
  
  // Wait for load to create tab
  initialWin.webContents.once('did-finish-load', () => {
    tabManager.createTab(initialWin.id, 'about:blank');
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (state.browserMode === 'taskbar') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow();
  }
});
