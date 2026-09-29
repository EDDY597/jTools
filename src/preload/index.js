const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jtools', {
  // 数据
  getApps: (force) => ipcRenderer.invoke('get-apps', force),
  rescanApps: () => ipcRenderer.invoke('rescan-apps'),
  getFiles: () => ipcRenderer.invoke('get-files'),
  rebuildFileIndex: () => ipcRenderer.invoke('rebuild-file-index'),
  getIndexStatus: () => ipcRenderer.invoke('get-index-status'),
  searchFiles: (q, limit, type) => ipcRenderer.invoke('search-files', q, limit, type),
  getEsStatus: (force) => ipcRenderer.invoke('get-es-status', force),
  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  uninstallPlugin: (id) => ipcRenderer.invoke('plugins:uninstall', id),
  importPluginDir: () => ipcRenderer.invoke('plugins:import-dir'),
  openPluginsDir: () => ipcRenderer.invoke('plugins:open-dir'),
  fetchMarket: (url) => ipcRenderer.invoke('market:fetch', url),
  installMarketPlugin: (download, marketUrl, marketId) => ipcRenderer.invoke('market:install', download, marketUrl, marketId),
  pickPinFiles: () => ipcRenderer.invoke('pick-pin-files'),
  pickPinDir: () => ipcRenderer.invoke('pick-pin-dir'),

  // 设置 / 历史
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveHistory: (list) => ipcRenderer.invoke('save-history', list),
  getSearchPrefs: () => ipcRenderer.invoke('get-search-prefs'),
  saveSearchPref: (q, p) => ipcRenderer.invoke('save-search-pref', q, p),
  getPinned: () => ipcRenderer.invoke('get-pinned'),
  savePinned: (list) => ipcRenderer.invoke('save-pinned', list),

  // 行为
  launch: (item) => ipcRenderer.invoke('launch-item', item),
  reveal: (p) => ipcRenderer.invoke('reveal-item', p),
  pathExists: (p) => ipcRenderer.invoke('path-exists', p),
  statPath: (p) => ipcRenderer.invoke('stat-path', p),
  getFileIcon: (p) => ipcRenderer.invoke('get-file-icon', p),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  copyText: (t) => ipcRenderer.invoke('copy-text', t),
  translate: (text, opts) => ipcRenderer.invoke('translate', text, opts),
  netRequest: (req) => ipcRenderer.invoke('net-request', req),

  // 窗口
  hideWindow: () => ipcRenderer.send('hide-window'),
  resizeWindow: (h) => ipcRenderer.send('resize-window', h),
  suppressBlur: (ms) => ipcRenderer.send('suppress-blur-hide', ms),
  onWindowShown: (cb) => ipcRenderer.on('window-shown', () => cb()),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
})
