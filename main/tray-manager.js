const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const config = require('./services/config');

let tray = null;
let mainWindow = null;
let isQuitting = false;

function createTray(window) {
  mainWindow = window;

  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Localhost Dashboard');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: showWindow,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', showWindow);

  // Intercept window close: hide to tray if setting is enabled
  mainWindow.on('close', (event) => {
    if (!isQuitting && config.get('minimizeToTray')) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function updateTooltip(devProcessCount) {
  if (!tray) return;

  const suffix =
    devProcessCount > 0 ? ` — ${devProcessCount} dev process${devProcessCount === 1 ? '' : 'es'}` : '';
  tray.setToolTip(`Localhost Dashboard${suffix}`);
}

function setQuitting(value) {
  isQuitting = value;
}

function destroy() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, updateTooltip, setQuitting, destroy };
