const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // IGDB
  fetchPopularGames: () => ipcRenderer.invoke('igdb:popular'),
  searchIGDB: (query) => ipcRenderer.invoke('igdb:search', query),

  // Biblioteca local
  getGames: () => ipcRenderer.invoke('games:get'),
  addGame: (game) => ipcRenderer.invoke('games:add', game),
  setExecutable: (id, data) => ipcRenderer.invoke('games:setExe', { id, ...data }),
  unlinkExecutable: (id) => ipcRenderer.invoke('games:unlink', id),
  launchGame: (id) => ipcRenderer.invoke('games:launch', id),
  markCompleted: (id) => ipcRenderer.invoke('games:completed', id),
  returnToLibrary: (id) => ipcRenderer.invoke('games:return', id),
  removeGame: (id) => ipcRenderer.invoke('games:remove', id),
  updateSortKey: (id, sortKey) => ipcRenderer.invoke('games:updateSortKey', { id, sortKey }),
  togglePlatinum: (id) => ipcRenderer.invoke('games:togglePlatinum', id),

  // Importar + carátulas
  importInstalledGames: (config) => ipcRenderer.invoke('games:importInstalled', config),
  enrichCovers: (opts) => ipcRenderer.invoke('games:enrichCovers', opts),

  // Diálogos
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openDirectoryDialog: (opts) => ipcRenderer.invoke('dialog:openDirectory', opts)
});
