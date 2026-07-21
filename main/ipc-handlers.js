const { ipcMain, shell, app, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { collectAll, getLastSnapshot } = require('./poll-manager');
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
    const exePath = await getExecutablePath(pid);
    if (exePath) {
      shell.showItemInFolder(exePath);
      return { success: true };
    }
    return { success: false, error: 'Could not resolve executable path' };
  });

  // ── Profile IPC ──────────────────────────────────────────────
  // The renderer only sends profile/service identifiers; the command and
  // cwd are looked up in the main-process config so an untrusted renderer
  // can never execute arbitrary command strings.
  ipcMain.handle('launch-service-command', (_event, { profileId, serviceId } = {}) => {
    if (typeof profileId !== 'string' || typeof serviceId !== 'string') {
      return { success: false, error: 'Invalid profile or service id' };
    }

    const profiles = config.get('profiles') || [];
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) {
      return { success: false, error: `Unknown profile: ${profileId}` };
    }

    const service = profile.services.find((s) => s.id === serviceId);
    if (!service) {
      return { success: false, error: `Unknown service: ${serviceId}` };
    }

    if (typeof service.command !== 'string' || !service.command.trim()) {
      return { success: false, error: 'No command configured for service' };
    }

    return launchCommand(service.command, service.cwd);
  });

  // ── Open localhost URL in default browser ────────────────────
  ipcMain.handle('open-url', async (_event, url) => {
    // Only allow http(s) localhost URLs
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return { success: false, error: 'Only http(s) URLs allowed' };
      const host = u.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
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
    // collectAll() returns null when a poll is already in flight;
    // fall back to the latest successful snapshot instead of failing.
    const data = (await collectAll()) || getLastSnapshot();
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

  // ── Custom window controls (frameless) ───────────────────────
  const winFrom = (e) => BrowserWindow.fromWebContents(e.sender);

  ipcMain.handle('window-minimize', (e) => {
    winFrom(e)?.minimize();
  });

  ipcMain.handle('window-maximize-toggle', (e) => {
    const win = winFrom(e);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle('window-is-maximized', (e) => !!winFrom(e)?.isMaximized());

  ipcMain.handle('window-close', (e) => {
    winFrom(e)?.close();
  });

  // [anchor: feature handlers] — new feature IPC handlers go below this line
}

module.exports = { registerIpcHandlers };
