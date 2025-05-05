const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  launchGame: (path) => ipcRenderer.invoke('launch-game', path),
});
