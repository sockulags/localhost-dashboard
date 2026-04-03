const { ipcMain } = require('electron');
const { collectAll } = require('./poll-manager');
const { kill } = require('./services/process-killer');
const detailCollector = require('./collectors/detail-collector');
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
    return detailCollector.collect(pid);
  });
}

module.exports = { registerIpcHandlers };
