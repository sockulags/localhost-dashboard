const { ipcMain, shell, app, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { collectAll } = require('./poll-manager');
const { kill, killMultiple } = require('./services/process-killer');
const { launchCommand } = require('./services/profile-runner');
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

  // ── Profile IPC ──────────────────────────────────────────────
  ipcMain.handle('launch-service-command', (_event, { command, cwd }) => {
    return launchCommand(command, cwd);
  });

  // ── Open localhost URL in default browser ────────────────────
  ipcMain.handle('open-url', async (_event, url) => {
    // Only allow http(s) localhost URLs
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return { success: false, error: 'Only http(s) URLs allowed' };
      const host = u.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0') {
        return { success: false, error: 'Only localhost URLs allowed' };
      }
      await shell.openExternal(u.toString());
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Export current snapshot to JSON ──────────────────────────
  ipcMain.handle('export-snapshot', async () => {
    const data = await collectAll();
    if (!data) return { success: false, error: 'No data available' };

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultName = `localhost-snapshot-${ts}.json`;
    const res = await dialog.showSaveDialog(win, {
      title: 'Export snapshot',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { success: false, canceled: true };

    try {
      fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8');
      return { success: true, path: res.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
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
