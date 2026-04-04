const { ipcMain, shell, app } = require('electron');
const { collectAll } = require('./poll-manager');
const { kill, killMultiple } = require('./services/process-killer');
const { collect: collectDetails, getExecutablePath } = require('./collectors/detail-collector');
const { updateTooltip } = require('./tray-manager');
const notifier = require('./services/notifier');
const config = require('./services/config');

function registerIpcHandlers() {
  // Initialise notifier from saved config
  notifier.setEnabled(config.get('notifications'));

  ipcMain.handle('get-processes', async () => {
    const data = await collectAll();
    if (data) {
      if (data.groups && data.groups.dev) {
        updateTooltip(data.groups.dev.processes.length);
      }
      notifier.notify(data.warnings);
    }
    return data;
  });

  ipcMain.handle('kill-process', async (_event, pid) => {
    return kill(pid);
  });

  ipcMain.handle('kill-processes', async (_event, pids) => {
    return killMultiple(pids);
  });

  ipcMain.handle('set-notifications-enabled', (_event, value) => {
    notifier.setEnabled(value);
    config.set('notifications', value);
    return notifier.isEnabled();
  });

  ipcMain.handle('get-notifications-enabled', () => {
    return notifier.isEnabled();
  });

  ipcMain.handle('get-process-details', async (_event, pid) => {
    return collectDetails(pid);
  });

  ipcMain.handle('open-file-location', async (_event, pid) => {
    const exePath = getExecutablePath(pid);
    if (exePath) {
      shell.showItemInFolder(exePath);
      return { success: true };
    }
    return { success: false, error: 'Could not resolve executable path' };
  });

  // ── Config IPC ───────────────────────────────────────────────
  ipcMain.handle('get-config', () => {
    return config.getAll();
  });

  ipcMain.handle('set-config', (_event, key, value) => {
    const updated = config.set(key, value);

    // Side-effects when specific settings change
    if (key === 'notifications') {
      notifier.setEnabled(updated.notifications);
    }
    if (key === 'autostart') {
      app.setLoginItemSettings({ openAtLogin: !!value });
    }

    return updated;
  });
}

module.exports = { registerIpcHandlers };
