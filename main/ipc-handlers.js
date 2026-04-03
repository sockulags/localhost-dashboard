const { ipcMain } = require('electron');
const { collectAll } = require('./poll-manager');
const { kill } = require('./services/process-killer');
const { updateTooltip } = require('./tray-manager');

function registerIpcHandlers() {
  ipcMain.handle('get-processes', async () => {
    const data = await collectAll();
    if (data && data.groups && data.groups.dev) {
      updateTooltip(data.groups.dev.processes.length);
    }
    return data;
  });

  ipcMain.handle('kill-process', async (_event, pid) => {
    return kill(pid);
  });
}

module.exports = { registerIpcHandlers };
