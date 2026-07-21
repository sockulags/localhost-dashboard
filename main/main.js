const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const { createTray, setQuitting, destroy: destroyTray } = require('./tray-manager');
const notifier = require('./services/notifier');
const config = require('./services/config');
const httpApi = require('./services/http-api');
const { getLastSnapshot } = require('./poll-manager');

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

  // Adaptive polling: tell the renderer when the window is hidden/shown so it
  // can slow down its poll loop while not visible.
  const sendVisibility = (visible) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-visibility', visible);
    }
  };
  mainWindow.on('hide', () => sendVisibility(false));
  mainWindow.on('minimize', () => sendVisibility(false));
  mainWindow.on('show', () => sendVisibility(true));
  mainWindow.on('restore', () => sendVisibility(true));

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

  // Opt-in local read-only HTTP API (off by default)
  if (config.get('httpApiEnabled')) {
    httpApi.start({ getSnapshot: getLastSnapshot, port: config.get('httpApiPort') });
  }
  // "Kill process" action button on warning notifications. On Windows the
  // button activation may not be routed by Electron (see notifier.js caveat);
  // when it is, kill the process and confirm with a small notification.
  notifier.onAction((pid) => {
    const pidNum = Number(pid);
    if (!Number.isInteger(pidNum) || pidNum <= 0) return;
    // Run inside a promise chain so a synchronous throw is captured too,
    // and so this keeps working if kill() ever becomes async.
    Promise.resolve()
      .then(() => require('./services/process-killer').kill(pidNum))
      .then((result) => {
        const { Notification } = require('electron');
        if (!Notification.isSupported()) return;
        const n = new Notification(
          result && result.success
            ? { title: 'Process killed', body: `Killed ${pidNum}`, silent: true }
            : {
                title: 'Failed to kill process',
                body: (result && result.error) || 'Unknown error',
                silent: true,
              }
        );
        n.show();
      })
      .catch((err) => {
        console.error('Kill-from-notification failed:', err);
      });
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
  httpApi.stop();
});
