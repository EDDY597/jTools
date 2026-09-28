const { app } = require('electron')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')

const INDEX_VERSION = 3
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.gradle', '.m2', '.npm',
  '$RECYCLE.BIN', 'System Volume Information', 'AppData',
  'cache', 'Cache', 'CachedData', '.cache', '__pycache__',
  '.vscode', '.idea', '.gradle', 'venv', '.venv'
])
const SKIP_DIR_PREFIX = /[.$]/ // 以点或$开头的目录直接跳过
const EXTS_EXCLUDE = new Set(['.tmp', '.log', '.dmp'])
const MAX_FILE_SIZE_LIST = 30000

let indexing = null

function indexFile() {
  return path.join(app.getPath('userData'), 'files-index.json')
}

function defaultDirs() {
  const home = os.homedir()
  return [
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads')
  ].filter((d, i, arr) => d && arr.indexOf(d) === i)
}

function getDirs() {
  const settings = require('./settings').get()
  const custom = Array.isArray(settings.fileSearchDirs) ? settings.fileSearchDirs : []
  return custom.length ? custom : defaultDirs()
}

function isSkippableDir(name) {
  return SKIP_DIRS.has(name) || (name.length > 1 && SKIP_DIR_PREFIX.test(name[0]))
}

async function walkDir(root, out, state, depth) {
  if (depth > 8 || out.length >= state.max) return
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (out.length >= state.max) return
    const full = path.join(root, ent.name)
    if (ent.isSymbolicLink()) continue
    if (ent.isDirectory()) {
      if (isSkippableDir(ent.name)) continue
      out.push({ n: ent.name, p: full, d: 1 })
      await walkDir(full, out, state, depth + 1)
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase()
      if (EXTS_EXCLUDE.has(ext)) continue
      let size = -1
      try { size = (await fsp.stat(full)).size } catch { /* 读不到则保持未知 */ }
      out.push({ n: ent.name, p: full, d: 0, s: size })
    }
  }
}

async function buildIndex() {
  if (indexing) return indexing
  indexing = (async () => {
    const dirs = getDirs()
    const files = []
    const state = { max: require('./settings').get().fileIndexMaxEntries || MAX_FILE_SIZE_LIST }
    for (const dir of dirs) {
      if (fs.existsSync(dir)) await walkDir(dir, files, state, 0)
    }
    const payload = { version: INDEX_VERSION, builtAt: Date.now(), dirs, files }
    fs.writeFileSync(indexFile(), JSON.stringify(payload))
    return files
  })()
  try {
    return await indexing
  } finally {
    indexing = null
  }
}

async function getFiles() {
  try {
    const cached = JSON.parse(fs.readFileSync(indexFile(), 'utf8'))
    if (cached.version === INDEX_VERSION && Array.isArray(cached.files)) {
      // 超过 12 小时后台重建
      if (Date.now() - cached.builtAt < 12 * 3600 * 1000) return cached.files
      buildIndex().catch(() => {})
      return cached.files
    }
  } catch { /* no cache */ }
  return buildIndex()
}

function getIndexStatus() {
  try {
    const cached = JSON.parse(fs.readFileSync(indexFile(), 'utf8'))
    return { builtAt: cached.builtAt, count: cached.files.length, dirs: cached.dirs }
  } catch {
    return { builtAt: 0, count: 0, dirs: getDirs() }
  }
}

module.exports = { getFiles, buildIndex, getIndexStatus, defaultDirs }
