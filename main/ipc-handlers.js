const { ipcMain, shell } = require('electron');
const { collectAll } = require('./poll-manager');
const { kill } = require('./services/process-killer');
const { collect: collectDetails, getExecutablePath } = require('./collectors/detail-collector');
const { updateTooltip } = require('./tray-manager');
const notifier = require('./services/notifier');

function registerIpcHandlers() {
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

  ipcMain.handle('set-notifications-enabled', (_event, value) => {
    notifier.setEnabled(value);
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
}

module.exports = { registerIpcHandlers };
