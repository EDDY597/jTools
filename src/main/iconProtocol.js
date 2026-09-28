// 应用图标动态协议（架构移植自 ZTools iconProtocol.ts）：
// 渲染层 <img src="jtools-icon://编码路径">，主进程收到请求时现场提取图标，
// 进程内 LRU 缓存（无磁盘缓存），坏图标不会被永久写盘。
const { protocol, app } = require('electron')
const path = require('path')
const fsp = require('fs/promises')

const SCHEME = 'jtools-icon'
// 旧版程序名(uTool)数据里存的 URL 协议，注册为同处理器的兼容别名
const LEGACY_SCHEME = 'utool-icon'
const MAX_ICON_CACHE = 128

// ZTools 的 Win32 原生图标提取模块（N-API，MIT）；打包后在 app.asar.unpacked
const ADDON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'lib', 'win', 'ztools_native.node')
  : path.join(__dirname, '../../resources/lib/win/ztools_native.node')
let addon = null
try {
  addon = require(ADDON_PATH)
} catch (e) {
  console.error('[IconProtocol] 原生模块加载失败，回退 Electron getFileIcon:', e.message)
}

/* ---------------- 图标内存缓存（LRU 淘汰） ---------------- */
const iconMemoryCache = new Map()

function setIconCache(key, buffer) {
  if (iconMemoryCache.has(key)) iconMemoryCache.delete(key)
  else if (iconMemoryCache.size >= MAX_ICON_CACHE) {
    const oldest = iconMemoryCache.keys().next().value
    if (oldest !== undefined) iconMemoryCache.delete(oldest)
  }
  iconMemoryCache.set(key, buffer)
}

/* ---------------- 提取 ---------------- */
function isPngBuffer(buffer) {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
}

// PNG 源（UWP manifest 图标）直接读文件，避免拿到“PNG 文件类型”的通用图标；
// 其余交给原生提取器（内部会跟随 .lnk 到目标 exe）。
async function extractIcon(iconPath) {
  if (path.extname(iconPath).toLowerCase() === '.png') {
    try {
      const imageBuffer = await fsp.readFile(iconPath)
      if (isPngBuffer(imageBuffer)) return imageBuffer
    } catch {
      // 文件不可读时继续尝试图标提取
    }
  }

  if (addon) {
    const buf = await addon.getFileIcon(iconPath)
    if (buf && buf.length) return Buffer.from(buf)
    throw new Error('native getFileIcon 返回空')
  }
  // 原生模块不可用时的兜底（对部分 exe 会得到默认程序图标）
  const icon = await app.getFileIcon(iconPath, { size: 'large' })
  if (!icon || icon.isEmpty()) throw new Error('Failed to extract icon')
  return icon.toPNG()
}

// 串行提取队列：原生图标 API 高并发下可能返回空，逐个执行
let extractionQueue = Promise.resolve()
function extractIconQueued(iconPath) {
  const task = extractionQueue.then(() => extractIcon(iconPath))
  extractionQueue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

/* ---------------- 协议 ---------------- */
function createIconResponse(buffer) {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': buffer.length.toString(),
      'access-control-allow-origin': '*'
    }
  })
}

// 必须在 app.ready 之前调用
function registerIconScheme() {
  const privileges = {
    bypassCSP: true,
    secure: true,
    standard: false,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: false
  }
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges },
    { scheme: LEGACY_SCHEME, privileges }
  ])
}

function registerIconProtocolForSession(targetSession) {
  for (const scheme of [SCHEME, LEGACY_SCHEME]) {
    if (targetSession.protocol.isProtocolHandled(scheme)) continue
    targetSession.protocol.handle(scheme, async (request) => {
      try {
        const iconPath = decodeURIComponent(request.url.replace(scheme + '://', ''))
        const cached = iconMemoryCache.get(iconPath)
        if (cached) {
          setIconCache(iconPath, cached)
          return createIconResponse(cached)
        }
        const buffer = await extractIconQueued(iconPath)
        setIconCache(iconPath, buffer)
        return createIconResponse(buffer)
      } catch (error) {
        console.error('[IconProtocol] 图标提取失败:', error.message)
        return new Response('Icon Error', { status: 404 })
      }
    })
  }
}

module.exports = { registerIconScheme, registerIconProtocolForSession }
