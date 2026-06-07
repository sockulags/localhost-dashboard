const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const { createTray, setQuitting, destroy: destroyTray } = require('./tray-manager');
const notifier = require('./services/notifier');
const config = require('./services/config');

let mainWindow;

// Minimal menu: keep clipboard/editing + reload/devtools accelerators working,
// but the bar is auto-hidden (Alt reveals it) so it doesn't clutter the window.
function buildAppMenu() {
  return Menu.buildFromTemplate([
    { label: 'Edit', role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    // Transparent bg + Mica so the Windows 11 backdrop shows through the
    // padding around our opaque cards. (Mica is ignored on Win10.)
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
    // Frameless: we draw our own minimal window controls in the header.
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Tell the renderer when the maximize state changes so it can swap the icon.
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', false));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildAppMenu());
  registerIpcHandlers();
  createWindow();
  createTray(mainWindow);

  // Apply autostart setting
  app.setLoginItemSettings({ openAtLogin: !!config.get('autostart') });

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
