// 插件仓库与市场（模仿 ZTools PluginsSetting/PluginMarket 的最小实现）：
// - 双目录扫描：应用内置 plugins/ + 用户目录 userData/plugins（同 id 用户版覆盖内置版）
// - 市场：拉取 marketplace.json（默认托管在 jTools 仓库），下载 zip → 校验 plugin.json → 解压安装
// - 卸载：仅允许删除用户目录里的插件，内置插件不可卸载
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const https = require('https')
const http = require('http')

const BUILTIN_DIR = path.join(__dirname, '../../plugins')
const USER_DIR = () => path.join(app.getPath('userData'), 'plugins')
const MARKET_URL = 'https://raw.githubusercontent.com/EDDY597/jTools/main/marketplace.json'

let cache = null

function invalidate() {
  cache = null
}

function readPluginManifest(dir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'))
    if (!cfg.name) return null
    let logo = ''
    if (cfg.logo) {
      const logoFile = path.join(dir, cfg.logo)
      try { logo = 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64') } catch { /* 无图标 */ }
    }
    return {
      id: path.basename(dir),
      name: cfg.name,
      version: cfg.version || '1.0.0',
      description: cfg.description || '',
      keywords: cfg.keywords || [],
      subInputPlaceholder: cfg.subInputPlaceholder || '',
      entry: path.join(dir, cfg.entry || 'index.html'),
      logo,
      dir
    }
  } catch {
    return null
  }
}

function scanDir(root, builtin) {
  const out = []
  try {
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name)
      try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
      const p = readPluginManifest(dir)
      if (p) out.push({ ...p, builtin })
    }
  } catch { /* 目录不存在 */ }
  return out
}

// 同 id：用户版覆盖内置版（内置被覆盖的不再单独列出）
function listPlugins() {
  if (cache) return cache
  const byId = new Map()
  for (const p of scanDir(BUILTIN_DIR, true)) byId.set(p.id, p)
  for (const p of scanDir(USER_DIR(), false)) byId.set(p.id, p)
  cache = Array.from(byId.values())
  return cache
}

function userPluginDir(id) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('非法插件 id')
  return path.join(USER_DIR(), id)
}

function uninstall(id) {
  const dir = userPluginDir(id)
  if (!fs.existsSync(dir)) throw new Error('该插件不是用户安装的（内置插件不可卸载）')
  fs.rmSync(dir, { recursive: true, force: true })
  invalidate()
  return listPlugins()
}

// GitHub 直连（raw.githubusercontent.com）在部分网络不可达，自动回退 jsDelivr 镜像
function candidatesFor(url) {
  const list = [String(url)]
  const m = String(url).match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/)
  if (m) list.push(`https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}`)
  return list
}

// Electron 主进程的 fetch 走 Chromium 网络栈，AbortSignal 对挂起连接不可靠；
// 这里用 Node 原生 https 直连。注意：socket 空闲超时对“连接阶段卡死”（SYN 黑洞）不生效，
// 必须用硬定时器强制销毁请求，否则市场会永远卡在加载中
function httpGetBuffer(url, timeoutMs, redirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        const r = httpGetBuffer(next, timeoutMs, redirects - 1)
        r.then(
          (buf) => { clearTimeout(hard); resolve(buf) },
          (e) => { clearTimeout(hard); reject(e) }
        )
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        clearTimeout(hard)
        return reject(new Error(`HTTP ${res.statusCode} (${url})`))
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => { clearTimeout(hard); resolve(Buffer.concat(chunks)) })
      res.on('error', () => { clearTimeout(hard); reject(new Error('响应读取失败')) })
    })
    const hard = setTimeout(() => req.destroy(new Error('请求超时')), timeoutMs)
    req.on('error', (e) => { clearTimeout(hard); reject(e) })
  })
}

// GitHub 直连（raw.githubusercontent.com）在部分网络不可达，jsDelivr 镜像优先、直连兜底
function candidatesFor(url) {
  const list = [String(url)]
  const m = String(url).match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/)
  if (m) list.unshift(`https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}`)
  return list
}

async function fetchFirstOk(urls, timeoutMs) {
  let lastErr = new Error('无可用的源')
  for (const u of urls) {
    try {
      const buf = await httpGetBuffer(u, timeoutMs)
      return { buf, url: u }
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

// 下载市场 zip 到临时文件
async function downloadZip(zipUrl, dest) {
  const { buf } = await fetchFirstOk(candidatesFor(zipUrl), 10000)
  if (buf.length < 100) throw new Error('下载内容异常')
  fs.writeFileSync(dest, buf)
}

// 解压并定位 plugin.json 所在目录（zip 根目录或其唯一一级子目录）
function extractAndLocate(zipPath, workDir) {
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  return new Promise((resolve, reject) => {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${workDir.replace(/'/g, "''")}' -Force`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 60000, windowsHide: true }, (err) => {
      if (err) return reject(new Error('解压失败: ' + err.message))
      try {
        if (fs.existsSync(path.join(workDir, 'plugin.json'))) return resolve(workDir)
        const subs = fs.readdirSync(workDir).filter((n) => fs.statSync(path.join(workDir, n)).isDirectory())
        for (const sub of subs) {
          if (fs.existsSync(path.join(workDir, sub, 'plugin.json'))) return resolve(path.join(workDir, sub))
        }
        reject(new Error('zip 中未找到 plugin.json'))
      } catch (e) {
        reject(new Error('解压结果校验失败: ' + e.message))
      }
    })
  })
}

// 从 zip 安装：zipPath 为本地文件或 http(s) 地址；marketId 可指定安装目录名
async function installFromZip(zipSource, marketId) {
  const tmpZip = path.join(app.getPath('temp'), `jtools-plugin-${Date.now()}.zip`)
  const tmpDir = path.join(app.getPath('temp'), `jtools-plugin-${Date.now()}`)
  try {
    if (/^https?:\/\//i.test(zipSource)) await downloadZip(zipSource, tmpZip)
    else {
      if (!fs.existsSync(zipSource)) throw new Error('zip 文件不存在')
      fs.copyFileSync(zipSource, tmpZip)
    }
    const srcDir = await extractAndLocate(tmpZip, tmpDir)
    const cfg = JSON.parse(fs.readFileSync(path.join(srcDir, 'plugin.json'), 'utf8'))
    if (!cfg.name) throw new Error('plugin.json 缺少 name 字段')
    const id = marketId || path.basename(srcDir)
    const dest = userPluginDir(id)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(srcDir, dest, { recursive: true })
    invalidate()
    const installed = listPlugins().find((p) => p.id === id)
    return { ok: true, plugin: installed, list: listPlugins() }
  } finally {
    try { fs.rmSync(tmpZip, { force: true }) } catch { /* 忽略 */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

// 从本地文件夹导入（复制到用户插件目录）
function importFromDir(dirPath) {
  const src = path.resolve(String(dirPath || ''))
  if (!fs.existsSync(path.join(src, 'plugin.json'))) throw new Error('所选文件夹里没有 plugin.json')
  const cfg = JSON.parse(fs.readFileSync(path.join(src, 'plugin.json'), 'utf8'))
  if (!cfg.name) throw new Error('plugin.json 缺少 name 字段')
  const id = path.basename(src)
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('文件夹名只能包含字母、数字、点、下划线和连字符')
  const dest = userPluginDir(id)
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
  invalidate()
  return { ok: true, id, list: listPlugins() }
}

async function fetchMarket(url) {
  const base = String(url || MARKET_URL)
  const { buf, url: used } = await fetchFirstOk(candidatesFor(base), 10000)
  const data = JSON.parse(buf.toString('utf8'))
  if (!Array.isArray(data.plugins)) throw new Error('市场目录格式无效（缺少 plugins 数组）')
  return { data, marketUrl: used }
}

// 相对下载地址基于 marketplace.json 的 URL 解析
function resolveDownloadUrl(marketUrl, download) {
  if (!download) return ''
  if (/^https?:\/\//i.test(download)) return download
  const base = marketUrl.replace(/[^/]*$/, '')
  return base + download
}

module.exports = { listPlugins, invalidate, uninstall, installFromZip, importFromDir, fetchMarket, resolveDownloadUrl, MARKET_URL }
