const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const DEFAULTS = {
  hotkey: 'Alt+Space',
  hotkeyCandidates: ['Alt+Space', 'Alt+Q', 'Alt+T', 'Ctrl+Alt+T', 'Ctrl+Space'],
  autoStart: false,
  fileSearchDirs: [], // 留空时用默认目录（桌面/文档/下载）
  fileIndexMaxEntries: 30000,
  translateProviderOrder: ['google', 'mymemory', 'baidu'],
  baiduAppid: '',
  baiduSecret: '',
  theme: 'system' // system | light | dark
}

let settings = null
const file = () => path.join(app.getPath('userData'), 'settings.json')

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'))
    settings = { ...DEFAULTS, ...raw }
  } catch {
    settings = { ...DEFAULTS }
  }
  return settings
}

function get() {
  if (!settings) load()
  return settings
}

function save(patch) {
  if (!settings) load()
  settings = { ...settings, ...patch }
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(settings, null, 2), 'utf8')
  return settings
}

module.exports = { load, get, save, DEFAULTS }
