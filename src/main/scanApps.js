// 应用扫描（架构对齐 ZTools commandScanner）：
// - 快捷方式扫描与 .lnk 目标解析下沉到原生模块（独立 runner 子进程，native 崩溃不影响主进程）
// - 图标不再预提取落盘：只存图标源路径，渲染层通过 jtools-icon:// 协议按需现取
// - UWP/系统面板应用仍走 PowerShell Get-StartApps（覆盖桌面 AUMID），图标源优先用原生 getUwpApps
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile, fork } = require('child_process')

const CACHE_VERSION = 8
const SKIP_NAME = /^(uninstall|卸载|unins|website|帮助|help|readme|修复|repair|document|示例|samples|sdk|反馈|feedback)/i
const SKIP_FOLDERS = ['sdk', 'doc', 'docs', 'samples', 'sample', 'examples', 'example', 'demos', 'demo', 'documentation']

// 原生模块与 runner：打包后在 app.asar.unpacked，开发态在仓库 resources/
const ADDON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'lib', 'win', 'ztools_native.node')
  : path.join(__dirname, '../../resources/lib/win/ztools_native.node')
const RUNNER_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'windows-shortcut-scanner-runner.cjs')
  : path.join(__dirname, '../../resources/windows-shortcut-scanner-runner.cjs')

function userStartMenu() {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu')
}
function programDataStartMenu() {
  return path.join('C:', 'ProgramData', 'Microsoft', 'Windows', 'Start Menu')
}
function userDesktop() {
  try { return app.getPath('desktop') } catch { return path.join(os.homedir(), 'Desktop') }
}
function publicDesktop() {
  return path.join('C:', 'Users', 'Public', 'Desktop')
}

function cacheFile() {
  return path.join(app.getPath('userData'), 'apps-cache.json')
}

function extractAcronym(name) {
  return (name.match(/[A-Za-z0-9]+/g) || []).map((w) => w[0]).join('').toLowerCase()
}

function shouldSkip(name) {
  return SKIP_NAME.test(name.trim())
}

function toIconUrl(appPath) {
  if (!appPath) return ''
  return `jtools-icon://${encodeURIComponent(appPath)}`
}

// 加载原生模块（扫描 runner 用路径传参，主进程内兜底扫描与 UWP 图标合并需直接加载）
let addon = null
try {
  addon = require(ADDON_PATH)
} catch {
  addon = null
}

/* ---------------- 原生快捷方式扫描（runner 子进程隔离） ---------------- */
function scanSourceInRunner(scanPaths, rootScanPaths, skipFolders) {
  return new Promise((resolve) => {
    let settled = false
    let child
    try {
      child = fork(RUNNER_PATH, [ADDON_PATH], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      })
    } catch {
      return resolve(null)
    }
    const finish = (entries) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch { /* 已退出 */ }
      resolve(entries)
    }
    const timer = setTimeout(() => finish(null), 30000)
    child.on('message', (m) => {
      if (m && m.type === 'result') finish(Array.isArray(m.entries) ? m.entries : [])
      else if (m && m.type === 'error') finish(null)
    })
    child.on('exit', (code) => {
      if (code !== 0) finish(null)
    })
    child.send({ type: 'scan', scanPaths, rootScanPaths, skipFolders })
  })
}

// runner 不可用时主进程内直接扫描（native 访问冲突会带崩主进程，仅作兜底）
function scanSourceInProcess(scanPaths, rootScanPaths, skipFolders) {
  try {
    if (!addon) return []
    return addon.scanWindowsShortcuts(scanPaths, rootScanPaths, skipFolders) || []
  } catch {
    return []
  }
}

async function scanShortcutApps() {
  const recursive = [programDataStartMenu(), userStartMenu()].filter((d) => fs.existsSync(d))
  const flat = [...new Set([userDesktop(), publicDesktop()])]
  const entries = await scanSourceInRunner(recursive, flat, SKIP_FOLDERS)
  const raw = entries || scanSourceInProcess(recursive, flat, SKIP_FOLDERS)

  const seen = new Map()
  const results = []
  for (const e of raw) {
    if (!e || !e.name || !e.path) continue
    const name = String(e.name).trim()
    if (!name || shouldSkip(name)) continue
    // 同名同目标去重（用户/系统开始菜单重复的快捷方式只保留一个）
    const dedupeKey = name.toLowerCase() + '|' + String(e.targetPath || e.path).toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.set(dedupeKey, true)
    results.push({
      name,
      path: String(e.path),
      type: 'app',
      target: e.targetPath ? String(e.targetPath) : '',
      icon: toIconUrl(e.icon || e.path),
      acronym: extractAcronym(name)
    })
  }
  return results
}

/* ---------------- UWP/系统面板应用 ---------------- */
// PowerShell Get-StartApps：含桌面 AUMID（任务管理器、注册表编辑器等），名称已本地化
async function scanUwpApps() {
  const ps = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-StartApps | Where-Object { $_.AppID } |
  ForEach-Object { [PSCustomObject]@{ name = $_.Name; appid = $_.AppID } } |
  ConvertTo-Json -Compress -Depth 3
`.trim()

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err && !stdout) return resolve([])
        try {
          let data = JSON.parse(stdout || '[]')
          if (!Array.isArray(data)) data = [data]
          const seen = new Set()
          const list = data
            .filter((d) => d && d.name && d.appid)
            .map((d) => ({ name: String(d.name).trim(), appid: String(d.appid) }))
            .filter((d) => d.name && !seen.has(d.appid) && seen.add(d.appid))
          resolve(list)
        } catch {
          resolve([])
        }
      }
    )
  })
}

// 原生 getUwpApps：appId → manifest 图标 png 路径（Get-StartApps 解析不到图标时的补充源）
function nativeUwpIconMap() {
  try {
    if (!addon) return new Map()
    return new Map((addon.getUwpApps() || []).map((u) => [u.appId, u.icon ? String(u.icon) : '']))
  } catch {
    return new Map()
  }
}

let scanning = null

async function scanAndCache() {
  if (scanning) return scanning
  scanning = (async () => {
    const apps = await scanShortcutApps()

    const uwp = await scanUwpApps()
    const nativeIcons = nativeUwpIconMap()
    const seenUwp = new Set(apps.map((a) => a.name.toLowerCase()))
    for (const it of uwp) {
      if (shouldSkip(it.name)) continue
      // 同名应用快捷方式优先于 UWP
      if (seenUwp.has(it.name.toLowerCase())) continue
      seenUwp.add(it.name.toLowerCase())
      const iconSource = nativeIcons.get(it.appid) || ''
      apps.push({
        name: it.name,
        path: 'uwp:' + it.appid,
        type: 'uwp',
        target: '',
        icon: toIconUrl(iconSource),
        acronym: extractAcronym(it.name)
      })
    }

    const payload = { version: CACHE_VERSION, scannedAt: Date.now(), apps }
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify(payload))
    return apps
  })()
  try {
    return await scanning
  } finally {
    scanning = null
  }
}

async function getApps(force) {
  try {
    if (!force) {
      const cached = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
      if (cached.version === CACHE_VERSION && Array.isArray(cached.apps)) {
        // 超过 7 天自动重扫（后台）
        if (Date.now() - cached.scannedAt < 7 * 24 * 3600 * 1000) return cached.apps
      }
    }
  } catch { /* no cache */ }
  return scanAndCache()
}

// 给渲染层的数据：icon 为 jtools-icon:// URL，图标由协议按需提取（永远新鲜）
async function getAppsForRenderer(force) {
  return getApps(force)
}

module.exports = { getAppsForRenderer, scanAndCache }
