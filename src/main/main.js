const { app, ipcMain, clipboard, shell, session, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const settingsStore = require('./settings')
const windowManager = require('./windowManager')
const scanApps = require('./scanApps')
const fileIndex = require('./fileIndex')
const translateSvc = require('./translate')
const { registerIconScheme, registerIconProtocolForSession } = require('./iconProtocol')

// 必须在 app.ready 之前注册为特权协议
registerIconScheme()

let pluginsCache = null
function getPlugins() {
  if (pluginsCache) return pluginsCache
  const dir = path.join(__dirname, '../../plugins')
  const list = []
  try {
    for (const name of fs.readdirSync(dir)) {
      const mf = path.join(dir, name, 'plugin.json')
      if (!fs.existsSync(mf)) continue
      const cfg = JSON.parse(fs.readFileSync(mf, 'utf8'))
      let logo = ''
      const logoFile = path.join(dir, name, cfg.logo || '')
      if (cfg.logo && fs.existsSync(logoFile)) {
        logo = 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64')
      }
      list.push({
        id: name,
        name: cfg.name || name,
        version: cfg.version || '1.0.0',
        description: cfg.description || '',
        keywords: cfg.keywords || [],
        subInputPlaceholder: cfg.subInputPlaceholder || '',
        entry: path.join(dir, name, cfg.entry || 'index.html'),
        logo
      })
    }
  } catch { /* plugins dir missing */ }
  pluginsCache = list
  return list
}

async function launchItem(item) {
  const p = String(item.path || '')
  const { spawn } = require('child_process')
  try {
    if (p.startsWith('uwp:')) {
      spawn('explorer.exe', ['shell:AppsFolder\\' + p.slice(4)], { detached: true, stdio: 'ignore' }).unref()
      return true
    }
    // 协议（排除 Windows 盘符 C:\，要求冒号前至少一个字符）
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]+:/.test(p)) {
      await shell.openExternal(p)
      return true
    }
    // 系统设置/控制面板类命令（mmsys.cpl、rundll32 ...、control.exe keyboard 等）
    if (item.type === 'setting' && !/^[a-zA-Z]:[\\/]/.test(p)) {
      spawn('cmd.exe', ['/c', p], { detached: true, stdio: 'ignore' }).unref()
      return true
    }
    const r = await shell.openPath(p)
    if (r) throw new Error(r)
    return true
  } catch (e) {
    console.error('launch failed:', e.message)
    return false
  }
}

function historyFile() {
  return path.join(app.getPath('userData'), 'history.json')
}
function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(historyFile(), 'utf8'))
  } catch {
    return []
  }
}
function writeHistory(list) {
  fs.writeFileSync(historyFile(), JSON.stringify(list.slice(0, 30)))
}

/* ---------------- Everything 运行时 ----------------
 * 三级优先：设置里的 es.exe > 数据目录 es.exe（依赖用户已装的 Everything 服务）> 内置便携版。
 * 内置便携版用专属实例名 jtools（配置独立，不影响已装的 Everything），未运行时自动拉起后台实例。
 */
const BUNDLED_ES_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'everything')
  : path.join(__dirname, '../../resources/everything')

let esRuntime = null // { es, instance, mode } mode: external | bundled | none

// 探测 es 是否连得上 Everything（实例没跑时 es 会向 stdout 打 Error 且退出码为 0，需识别）
function probeEs(es, instance) {
  return new Promise((resolve) => {
    const args = []
    if (instance) args.push('-instance', instance)
    args.push('-n', '1')
    execFile(es, args, { timeout: 2500, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      const out = String(stdout || '')
      resolve(!err && /^[A-Za-z]:[\\/]/m.test(out) && !/^Error \d+:/m.test(out))
    })
  })
}

async function resolveEsRuntime(force) {
  if (esRuntime && !force) return esRuntime
  esRuntime = { es: '', instance: '', mode: 'none' }
  const s = settingsStore.get()
  const candidates = []
  if (s.esPath && fs.existsSync(s.esPath)) candidates.push({ es: s.esPath, instance: '', mode: 'external' })
  const userEs = path.join(app.getPath('userData'), 'es.exe')
  if (fs.existsSync(userEs)) candidates.push({ es: userEs, instance: '', mode: 'external' })
  const bundledEs = path.join(BUNDLED_ES_DIR, 'es.exe')
  if (fs.existsSync(bundledEs) && fs.existsSync(path.join(BUNDLED_ES_DIR, 'Everything.exe'))) {
    candidates.push({ es: bundledEs, instance: 'jtools', mode: 'bundled' })
  }
  for (const cand of candidates) {
    if (cand.mode === 'bundled') {
      // 专属实例未运行则自动拉起（-startup 后台运行，索引渐进可用），内置版是最后兜底，直接采用
      if (!(await probeEs(cand.es, cand.instance))) {
        try {
          const { spawn } = require('child_process')
          spawn(path.join(BUNDLED_ES_DIR, 'Everything.exe'), ['-instance', 'jtools', '-startup'], {
            detached: true, stdio: 'ignore', windowsHide: true
          }).unref()
          await new Promise((r) => setTimeout(r, 800))
        } catch { /* 拉起失败则由探测失败兜底 */ }
      }
      esRuntime = cand
      break
    }
    if (await probeEs(cand.es, cand.instance)) {
      esRuntime = cand
      break
    }
  }
  return esRuntime
}

/* ---------------- Everything（es.exe CLI）文件搜索 ---------------- */

function pinnedFile() {
  return path.join(app.getPath('userData'), 'pinned.json')
}

function registerIpc() {
  // 系统设置面板项（移植自 ZTools 的 windowsSettings/msSettingsUris 列表）
  let windowsSettingsCache = null
  const getWindowsSettings = () => {
    if (windowsSettingsCache) return windowsSettingsCache
    try {
      windowsSettingsCache = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'data', 'windowsSettings.json'), 'utf8')
      )
    } catch {
      windowsSettingsCache = []
    }
    return windowsSettingsCache
  }

  ipcMain.handle('get-apps', async (_e, force) => {
    const apps = await scanApps.getAppsForRenderer(!!force)
    const nameSet = new Set(apps.map((a) => a.name.toLowerCase()))
    const settings = getWindowsSettings()
      .filter((s) => !nameSet.has(s.name.toLowerCase()))
      .map((s) => ({
        name: s.name,
        path: s.uri,
        type: 'setting',
        icon: '',
        acronym: ''
      }))
    return apps.concat(settings)
  })
  ipcMain.handle('rescan-apps', async () => {
    await scanApps.scanAndCache()
    return scanApps.getAppsForRenderer(false)
  })
  ipcMain.handle('get-files', () => fileIndex.getFiles())
  ipcMain.handle('rebuild-file-index', () => fileIndex.buildIndex().then(() => fileIndex.getIndexStatus()))
  ipcMain.handle('get-index-status', () => fileIndex.getIndexStatus())
  ipcMain.handle('get-plugins', () => getPlugins())

  // 固定管理：系统对话框浏览选择（.lnk 快捷方式可多选；文件夹单独选择）
  // 对话框打开期间抑制失焦隐藏，关闭后恢复，主窗保持呼出状态
  const dialogParent = () => windowManager.getWindow() || undefined
  ipcMain.handle('pick-pin-files', async () => {
    windowManager.setBlurSuppressed(true)
    try {
      const res = await dialog.showOpenDialog(dialogParent(), {
        title: '选择要固定的应用或快捷方式',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '应用 / 快捷方式 (lnk, exe, url)', extensions: ['lnk', 'exe', 'url'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      return res.canceled ? [] : res.filePaths
    } finally {
      windowManager.setBlurSuppressed(false)
    }
  })
  ipcMain.handle('pick-pin-dir', async () => {
    windowManager.setBlurSuppressed(true)
    try {
      const res = await dialog.showOpenDialog(dialogParent(), {
        title: '选择要固定的文件夹',
        properties: ['openDirectory']
      })
      return res.canceled ? '' : res.filePaths[0] || ''
    } finally {
      windowManager.setBlurSuppressed(false)
    }
  })

  // Everything 文件搜索：通过 es.exe CLI（需 Everything 在运行）；失败返回 null 由渲染层回退本地索引
  const ES_NOISE = /(\$RECYCLE\.BIN|System Volume Information)/i
  const isEsNoise = (p) =>
    ES_NOISE.test(p) ||
    /\\Start Menu\\/i.test(p) ||                                  // 开始菜单快捷方式 → 应用区已覆盖
    /\\Users\\Public\\Desktop\\[^\\]*\.lnk$/i.test(p) ||           // 公共桌面快捷方式 → 应用区已覆盖
    /\\Desktop\\[^\\]*\.lnk$/i.test(p)                            // 用户桌面快捷方式 → 应用区已覆盖

  ipcMain.handle('search-files', async (_e, q, limit = 30, type = '') => {
    const rt = await resolveEsRuntime()
    if (!rt.es) return null
    const query = String(q || '').trim()
    if (!query) return null
    try {
      const stdout = await new Promise((resolve, reject) => {
        const { execFile } = require('child_process')
        // es 按名称升序返回、符号/数字开头的匹配会占掉大量前置位置（如搜 "agent" 时
        // D:\Agent 排在第 92 位），多抓一些交给渲染层按相关度重新排序；
        // type=file/dir 时用属性搜索只取文件/文件夹（ES 1.1 不支持 file: 修饰符）；
        // 多词查询只把第一段给 es（按文件名搜），后续段是渲染层的路径过滤词
        const args = []
        if (rt.instance) args.push('-instance', rt.instance)
        args.push('-cp', '65001', '-n', String(limit * 100), '-sort', 'name')
        if (type === 'file') args.push('/a-d')
        else if (type === 'dir') args.push('/ad')
        args.push(query.split(/\s+/).filter(Boolean)[0] || query)
        execFile(rt.es, args, {
          timeout: 4000, windowsHide: true, maxBuffer: 4 * 1024 * 1024
        }, (err, so) => (err && !so) ? reject(err) : resolve(so || ''))
      })
      // 实例未就绪时 es 会向 stdout 打 Error（退出码 0），视为本轮无结果
      if (/^Error \d+:/m.test(stdout)) return null
      const paths = stdout.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length > 3 && !isEsNoise(x))
      const out = []
      // 返回窗口比展示位数（15）大一个量级，stat 逐个判定目录/文件并取文件大小
      for (const full of paths.slice(0, limit * 10)) {
        let isDir = false
        let size = -1
        try {
          const st = fs.statSync(full)
          isDir = st.isDirectory()
          if (!isDir) size = st.size
        } catch { /* 读不到则保持未知 */ }
        out.push({ n: path.basename(full) || full, p: full, d: isDir, s: size })
      }
      return out
    } catch {
      return null
    }
  })
  ipcMain.handle('get-es-status', async (_e, force) => {
    const rt = await resolveEsRuntime(!!force)
    return { available: !!rt.es, mode: rt.mode }
  })

  ipcMain.handle('get-settings', () => settingsStore.get())
  ipcMain.handle('save-settings', (_e, patch) => {
    const s = settingsStore.save(patch || {})
    if (patch && patch.hotkey) windowManager.registerShortcut(patch.hotkey)
    if (patch && typeof patch.autoStart === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: patch.autoStart })
    }
    if (patch && patch.esPath !== undefined) esRuntime = null // es 路径变更后重新探测
    return s
  })

  ipcMain.handle('get-history', () => readHistory())
  ipcMain.handle('save-history', (_e, list) => {
    writeHistory(Array.isArray(list) ? list : [])
    return true
  })

  // 搜索偏好：query → 上次选中的条目路径（对齐原版 uTools 行为）
  function searchPrefsFile() {
    return path.join(app.getPath('userData'), 'search-prefs.json')
  }
  ipcMain.handle('get-search-prefs', () => {
    try {
      return JSON.parse(fs.readFileSync(searchPrefsFile(), 'utf8'))
    } catch {
      return {}
    }
  })
  ipcMain.handle('save-search-pref', (_e, q, p) => {
    let prefs = {}
    try {
      prefs = JSON.parse(fs.readFileSync(searchPrefsFile(), 'utf8'))
    } catch { /* first time */ }
    prefs[String(q || '').trim().toLowerCase()] = String(p || '')
    const keys = Object.keys(prefs)
    if (keys.length > 50) delete prefs[keys[0]] // 简单容量控制
    fs.writeFileSync(searchPrefsFile(), JSON.stringify(prefs))
    return true
  })

  ipcMain.handle('get-pinned', () => {
    try {
      const list = JSON.parse(fs.readFileSync(pinnedFile(), 'utf8'))
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  })
  ipcMain.handle('save-pinned', (_e, list) => {
    fs.writeFileSync(pinnedFile(), JSON.stringify((Array.isArray(list) ? list : []).slice(0, 20)))
    return true
  })

  ipcMain.handle('launch-item', async (_e, item) => {
    const ok = await launchItem(item)
    if (ok) windowManager.hide()
    return ok
  })
  ipcMain.handle('reveal-item', (_e, p) => {
    shell.showItemInFolder(String(p))
    return true
  })
  ipcMain.handle('path-exists', (_e, p) => {
    try {
      const st = fs.statSync(String(p || ''))
      return st.isFile() || st.isDirectory()
    } catch {
      return false
    }
  })
  ipcMain.handle('stat-path', (_e, p) => {
    try {
      const st = fs.statSync(String(p || ''))
      return { exists: true, isDir: st.isDirectory() }
    } catch {
      return { exists: false, isDir: false }
    }
  })
  ipcMain.handle('get-file-icon', async (_e, p) => {
    try {
      const icon = await app.getFileIcon(String(p || ''), { size: 'large' })
      return icon && !icon.isEmpty() ? 'data:image/png;base64,' + icon.toPNG().toString('base64') : ''
    } catch {
      return ''
    }
  })
  ipcMain.handle('open-data-dir', () => {
    shell.openPath(app.getPath('userData'))
    return true
  })
  ipcMain.handle('copy-text', (_e, text) => {
    clipboard.writeText(String(text || ''))
    return true
  })
  ipcMain.handle('translate', (_e, text, opts) => translateSvc.translate(String(text || ''), opts || {}))
  ipcMain.handle('net-request', async (_e, req) => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(req.url, {
        method: req.method || 'GET',
        headers: req.headers || {},
        body: req.body,
        signal: ctrl.signal
      })
      clearTimeout(t)
      const text = await res.text()
      return { status: res.status, ok: res.ok, body: text.slice(0, 2 * 1024 * 1024) }
    } catch (e) {
      return { status: 0, ok: false, body: '', error: e.message }
    }
  })
}

// 程序改名(uTool → jTools)后 productName 变化导致 userData 目录变化，
// 首次启动从旧目录迁移用户数据（固定项/历史/设置/索引/es.exe），迁移后打标记不重复执行
function migrateUserDataFromOldDir() {
  try {
    const cur = app.getPath('userData')
    const marker = path.join(cur, '.migrated-from-utool')
    if (fs.existsSync(marker)) return
    const old = path.join(app.getPath('appData'), 'uTool')
    if (fs.existsSync(old) && old.toLowerCase() !== cur.toLowerCase()) {
      fs.mkdirSync(cur, { recursive: true })
      for (const f of ['settings.json', 'history.json', 'pinned.json', 'search-prefs.json', 'files-index.json', 'es.exe']) {
        try { fs.copyFileSync(path.join(old, f), path.join(cur, f)) } catch { /* 旧目录没有该文件则跳过 */ }
      }
    }
    fs.writeFileSync(marker, String(Date.now()))
  } catch { /* 迁移失败不影响启动 */ }
}

app.whenReady().then(() => {
  migrateUserDataFromOldDir()
  const s = settingsStore.load()
  if (s.autoStart) app.setLoginItemSettings({ openAtLogin: true })

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  // 已有实例常驻时（托盘/桌面快捷方式再次启动），第二实例退出并呼出既有窗口，而不是静默无反应
  app.on('second-instance', () => windowManager.show())

  windowManager.init({
    onSettingsChanged: () => {}
  })
  registerIconProtocolForSession(session.defaultSession)
  registerIpc()

  app.on('before-quit', () => windowManager.onBeforeQuit())
  app.on('window-all-closed', () => {
    // 常驻托盘，不退出
  })
})
