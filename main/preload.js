const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getProcesses: () => ipcRenderer.invoke('get-processes'),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  killProcesses: (pids) => ipcRenderer.invoke('kill-processes', pids),
  setNotificationsEnabled: (value) => ipcRenderer.invoke('set-notifications-enabled', value),
  getNotificationsEnabled: () => ipcRenderer.invoke('get-notifications-enabled'),
  getProcessDetails: (pid) => ipcRenderer.invoke('get-process-details', pid),
  openFileLocation: (pid) => ipcRenderer.invoke('open-file-location', pid),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  launchProfileService: (profileId, serviceId) => ipcRenderer.invoke('launch-service-command', { profileId, serviceId }),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  exportSnapshot: () => ipcRenderer.invoke('export-snapshot'),
  onScrollToProcess: (callback) => {
    ipcRenderer.on('scroll-to-process', (_event, pid) => callback(pid));
  },
  // Custom window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window-maximize-toggle'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  onWindowState: (callback) => {
    ipcRenderer.on('window-state', (_event, isMaximized) => callback(isMaximized));
  },
  // [anchor: feature methods] — new feature API methods go below this line
  // ── Adaptive polling
  onWindowVisibility: (callback) => {
    ipcRenderer.on('window-visibility', (_e, visible) => callback(visible));
  },
  // ── Docker actions
  dockerStop: (id) => ipcRenderer.invoke('docker-stop', id),
  dockerRestart: (id) => ipcRenderer.invoke('docker-restart', id),
  dockerLogs: (id, tail) => ipcRenderer.invoke('docker-logs', id, tail),
  // ── Profile logs
  getServiceLogs: (profileId, serviceId) => ipcRenderer.invoke('get-service-logs', { profileId, serviceId }),
});
