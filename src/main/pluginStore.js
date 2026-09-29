// 插件仓库与市场（模仿 ZTools PluginsSetting/PluginMarket 的最小实现）：
// - 双目录扫描：应用内置 plugins/ + 用户目录 userData/plugins（同 id 用户版覆盖内置版）
// - 市场：拉取 marketplace.json（默认托管在 jTools 仓库），下载 zip → 校验 plugin.json → 解压安装
// - 卸载：仅允许删除用户目录里的插件，内置插件不可卸载
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

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

// 下载市场 zip 到临时文件
async function downloadZip(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
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
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`市场目录拉取失败 HTTP ${res.status}`)
  const data = JSON.parse(await res.text())
  if (!Array.isArray(data.plugins)) throw new Error('市场目录格式无效（缺少 plugins 数组）')
  return data
}

// 相对下载地址基于 marketplace.json 的 URL 解析
function resolveDownloadUrl(marketUrl, download) {
  if (!download) return ''
  if (/^https?:\/\//i.test(download)) return download
  const base = marketUrl.replace(/[^/]*$/, '')
  return base + download
}

module.exports = { listPlugins, invalidate, uninstall, installFromZip, importFromDir, fetchMarket, resolveDownloadUrl, MARKET_URL }
