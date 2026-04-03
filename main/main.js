const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const { createTray, setQuitting, destroy: destroyTray } = require('./tray-manager');
const notifier = require('./services/notifier');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#1a1b26',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  createTray(mainWindow);

  notifier.onClick((pid) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (pid != null) {
      mainWindow.webContents.send('scroll-to-process', pid);
    }
  });
});

app.on('before-quit', () => {
  setQuitting(true);
});

app.on('window-all-closed', () => {
  // Don't quit — the tray icon keeps the app alive.
  // Quitting is handled explicitly via app.quit() from tray menu or keyboard shortcut.
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('will-quit', () => {
  destroyTray();
});
