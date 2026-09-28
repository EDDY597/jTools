const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, shell } = require('electron')
const path = require('path')

const WIDTH = 800
const HEADER_HEIGHT = 58
const MAX_RESULTS_HEIGHT = 541
const DEFAULT_HEIGHT = 600

let win = null
let tray = null
let quitting = false
let lastShowTime = 0
let lastBlurHideTime = 0
let shortcutRegistered = ''
let blurSuppressedUntil = 0
// 系统对话框（固定管理的浏览选择等）打开期间不因失焦隐藏主窗
let dialogOpen = false

// 由 main.js 注入，避免循环依赖
const hooks = {
  onSettingsChanged: () => {},
  quit: () => app.quit()
}

function isDev() {
  return !app.isPackaged
}

function getDisplayAtCursor() {
  const cursor = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(cursor)
}

function createWindow() {
  const { workArea } = getDisplayAtCursor()
  win = new BrowserWindow({
    width: WIDTH,
    height: Math.min(DEFAULT_HEIGHT, workArea.height - 40),
    x: workArea.x + Math.floor((workArea.width - WIDTH) / 2),
    y: workArea.y + Math.floor((workArea.height - Math.min(DEFAULT_HEIGHT, workArea.height - 40)) / 2),
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#f4f4f4',
    icon: path.join(__dirname, '../../assets/icon.png'),
    title: 'jTools',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, '../renderer/index.html'))

  // 关闭即隐藏，常驻
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      hide()
    }
  })

  // 失焦隐藏（呼出瞬间的瞬时失焦做抑制；UTOOL_NO_AUTOHIDE=1 供自动化测试）
  win.on('blur', () => {
    if (process.env.UTOOL_NO_AUTOHIDE === '1') return
    if (dialogOpen) return
    if (!win || !win.isVisible()) return
    if (Date.now() < blurSuppressedUntil) return
    if (Date.now() - lastShowTime < 200) {
      // 稍后复查一次，避免激活竞态导致刚弹出就被隐藏
      setTimeout(() => {
        if (dialogOpen) return
        if (win && win.isVisible() && !win.isFocused() && Date.now() >= blurSuppressedUntil) {
          hide()
          lastBlurHideTime = Date.now()
        }
      }, 260)
      return
    }
    hide()
    lastBlurHideTime = Date.now()
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('window-shown', { isDev: isDev() })
  })
}

function resizeWindow(height) {
  if (!win) return
  const { workArea } = getDisplayAtCursor()
  const maxH = Math.min(HEADER_HEIGHT + MAX_RESULTS_HEIGHT + 8, workArea.height - 24)
  const h = Math.max(HEADER_HEIGHT, Math.min(Number(height) || HEADER_HEIGHT, maxH))
  const [x] = win.getPosition()
  const [w] = win.getSize()
  // Windows 上 resizable:false 的窗口无法 setBounds，需临时开启
  win.setResizable(true)
  win.setBounds({ x, y: win.getBounds().y, width: w, height: h })
  win.setResizable(false)
}

function show() {
  if (!win) createWindow()
  lastShowTime = Date.now()
  // 抑制呼出瞬间的 blur
  blurSuppressedUntil = Date.now() + 350
  const { workArea } = getDisplayAtCursor()
  const current = win.getBounds()
  const maxH = Math.min(DEFAULT_HEIGHT, workArea.height - 40)
  win.setResizable(true)
  win.setBounds({
    x: workArea.x + Math.floor((workArea.width - WIDTH) / 2),
    y: workArea.y + Math.floor((workArea.height - maxH) / 2),
    width: WIDTH,
    height: Math.min(Math.max(current.height, HEADER_HEIGHT), workArea.height - 40)
  })
  win.setResizable(false)
  win.show()
  win.focus()
  win.webContents.send('window-shown', { isDev: isDev() })
}

function hide() {
  if (win) win.hide()
}

function toggle() {
  if (win && win.isVisible() && win.isFocused()) hide()
  else show()
}

function registerShortcut(acc = '') {
  const wanted = acc || require('./settings').get().hotkey || 'Alt+Space'
  if (shortcutRegistered === wanted) return true
  if (shortcutRegistered) globalShortcut.unregister(shortcutRegistered)
  const candidates = [wanted, ...require('./settings').get().hotkeyCandidates]
  for (const key of candidates) {
    try {
      if (globalShortcut.register(key, toggle)) {
        shortcutRegistered = key
        if (key !== wanted) require('./settings').save({ hotkey: key })
        return true
      }
    } catch { /* try next */ }
  }
  return false
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray.png')
  tray = new Tray(nativeImage.createFromPath(iconPath))
  const menu = Menu.buildFromTemplate([
    { label: '呼出 jTools', click: () => show() },
    { label: '设置', click: () => { show(); win.webContents.send('open-settings') } },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked })
        require('./settings').save({ autoStart: item.checked })
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  ])
  tray.setToolTip('jTools — 无广告启动器')
  tray.setContextMenu(menu)
  // 托盘左键 = 纯可见性切换；若刚因本次点击造成的失焦而隐藏，则不再重复显示
  tray.on('click', () => {
    if (win && win.isVisible()) { hide(); return }
    if (Date.now() - lastBlurHideTime < 300) return
    show()
  })
}

function init(hookFns = {}) {
  Object.assign(hooks, hookFns)
  createWindow()
  createTray()
  registerShortcut()
  if (process.argv.includes('--show-on-start')) show()

  app.on('second-instance', () => show())
  screen.on('display-removed', () => { if (win && win.isVisible()) show() })

  ipcMain.on('resize-window', (_e, h) => resizeWindow(h))
  ipcMain.on('hide-window', () => hide())
  ipcMain.on('suppress-blur-hide', (_e, ms) => { blurSuppressedUntil = Date.now() + (ms || 500) })
  ipcMain.handle('get-app-version', () => app.getVersion())
}

function onBeforeQuit() {
  quitting = true
  globalShortcut.unregisterAll()
}

function setBlurSuppressed(on) {
  dialogOpen = !!on
}

module.exports = {
  init,
  show,
  hide,
  toggle,
  resizeWindow,
  registerShortcut,
  onBeforeQuit,
  setBlurSuppressed,
  getWindow: () => win,
  isQuitting: () => quitting,
  WIDTH,
  HEADER_HEIGHT
}
