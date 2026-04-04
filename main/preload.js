const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getProcesses: () => ipcRenderer.invoke('get-processes'),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  setNotificationsEnabled: (value) => ipcRenderer.invoke('set-notifications-enabled', value),
  getNotificationsEnabled: () => ipcRenderer.invoke('get-notifications-enabled'),
  getProcessDetails: (pid) => ipcRenderer.invoke('get-process-details', pid),
  openFileLocation: (pid) => ipcRenderer.invoke('open-file-location', pid),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  onScrollToProcess: (callback) => {
    ipcRenderer.on('scroll-to-process', (_event, pid) => callback(pid));
  },
});
