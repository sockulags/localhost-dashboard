const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

// Mirrors tray-manager's minimize-to-tray pattern: the HUD's close button
// hides the window (same as the toggle) instead of destroying it, except
// when the app is actually quitting.
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

const HUD_WIDTH = 320;
const HUD_HEIGHT = 220;
const HUD_MARGIN = 12;

let hudWindow = null;

function createHud() {
  const { workArea } = screen.getPrimaryDisplay();

  hudWindow = new BrowserWindow({
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    x: workArea.x + workArea.width - HUD_WIDTH - HUD_MARGIN,
    y: workArea.y + HUD_MARGIN,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    // A HUD should never steal focus (it would also become the parent for
    // dialogs picked via getFocusedWindow). Clicks still work unfocused.
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  hudWindow.loadFile(path.join(__dirname, '..', 'renderer', 'hud.html'));

  hudWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      hudWindow.hide();
    }
  });

  hudWindow.on('closed', () => {
    hudWindow = null;
  });
}

function toggleHud() {
  if (!hudWindow) {
    createHud();
    return;
  }
  if (hudWindow.isVisible()) {
    hudWindow.hide();
  } else {
    hudWindow.show();
  }
}

function destroyHud() {
  if (hudWindow) {
    hudWindow.destroy();
    hudWindow = null;
  }
}

module.exports = { toggleHud, destroyHud };
