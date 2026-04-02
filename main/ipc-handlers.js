const { ipcMain } = require('electron');
const { collectAll } = require('./poll-manager');
const { kill } = require('./services/process-killer');

function registerIpcHandlers() {
  ipcMain.handle('get-processes', async () => {
    return await collectAll();
  });

  ipcMain.handle('kill-process', async (_event, pid) => {
    return kill(pid);
  });
}

module.exports = { registerIpcHandlers };
