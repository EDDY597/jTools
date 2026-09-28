/* jTools 渲染层：搜索、导航、插件宿主、设置 */
'use strict'

const $ = (id) => document.getElementById(id)
const input = $('search-input')
const placeholderEl = $('placeholder-text')
const typeFilterEl = $('type-filter')
const resultsEl = $('results')
const pluginView = $('plugin-view')
const pluginPill = $('plugin-pill')
const pillName = $('pill-name')
const pillLogo = $('pill-logo')
const escHint = $('esc-hint')
const settingsView = $('settings-view')

const pinyinOf = (text, pattern) => {
  try {
    const p = window.pinyinPro.pinyin(text, { toneType: 'none', type: 'string', pattern })
    return p.replace(/\s+/g, '').toLowerCase()
  } catch {
    return ''
  }
}

const state = {
  apps: [],
  plugins: [],
  files: [],
  history: [],
  pinned: [],
  typeFilter: 'all',   // 搜索类型过滤：all | app | file | dir | plugin（首页固定项不受影响）
  searchPrefs: {},   // query → 上次选中的条目路径（搜索偏好记忆）
  es: null,          // {available} Everything es.exe 状态
  esResults: null,   // 当前查询的 Everything 结果（数组）
  esQuery: '',       // esResults 对应的查询
  esType: '',        // esResults 对应的类型过滤（''=全部, file, dir）
  esTerm: '',        // esResults 对应的文件名搜索词（多词查询的第一段）
  flat: [],          // 当前渲染的扁平结果（含分组）
  selected: 0,
  mode: 'search',    // search | plugin | settings
  activePlugin: null,
  pluginReady: false,
  settings: {},
  filesIndexing: false
}

/* ---------------- 图标 ---------------- */
const svgIcon = (svg, color) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace('{c}', color || '#8a8a8a'))}`
const ICON_FILE = svgIcon(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.7"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>'
)
const ICON_FOLDER = svgIcon(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
)
const ICON_GEAR = svgIcon(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>'
)
const ICON_GLOBE = svgIcon(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>'
)
const LETTER_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']
function letterColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return LETTER_COLORS[h % LETTER_COLORS.length]
}

/* ---------------- 工具 ---------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function highlight(text, start, len) {
  if (start < 0 || !len) return escapeHtml(text)
  return (
    escapeHtml(text.slice(0, start)) +
    '<em>' + escapeHtml(text.slice(start, start + len)) + '</em>' +
    escapeHtml(text.slice(start + len))
  )
}
// 文件大小人性化显示（B/KB/MB/GB，小于 10 保留一位小数）
function formatSize(n) {
  if (!(n >= 0)) return ''
  if (n < 1024) return n + ' B'
  const kb = n / 1024
  if (kb < 1024) return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB'
  const mb = kb / 1024
  if (mb < 1024) return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB'
  const gb = mb / 1024
  return (gb < 10 ? gb.toFixed(1) : Math.round(gb)) + ' GB'
}

// 路径行高亮：多词查询的后续段在 sub（完整路径）里逐词标出
function highlightPathTerms(sub, terms) {
  if (!terms || !terms.length || !sub) return escapeHtml(sub || '')
  let html = escapeHtml(sub)
  for (const t of terms) {
    const lt = t.toLowerCase()
    if (!lt) continue
    const low = html.toLowerCase()
    let i = 0
    let out = ''
    while (true) {
      const hit = low.indexOf(lt, i)
      if (hit < 0) { out += html.slice(i); break }
      out += html.slice(i, hit) + '<em>' + html.slice(hit, hit + t.length) + '</em>'
      i = hit + t.length
    }
    html = out
  }
  return html
}

/* ---------------- 索引构建 ---------------- */
function buildAppIndex(apps) {
  return apps.map((a) => ({
    kind: 'app',
    name: a.name,
    path: a.path,
    type: a.type,
    // icon 为 jtools-icon:// 协议 URL（老缓存/历史里可能是 dataURL 或旧协议，<img> 都能直接渲染）
    iconData: a.icon || a.iconData || '',
    acronym: a.acronym || '',
    pinyin: '',
    pinyinAbbr: '',
    _pyDone: false
  }))
}
function ensurePinyin(item) {
  if (item._pyDone) return
  item.pinyin = pinyinOf(item.name)
  item.pinyinAbbr = pinyinOf(item.name, 'first')
  item._pyDone = true
}
function buildFileIndex(files) {
  const out = []
  for (const f of files) {
    out.push({
      kind: 'file',
      name: f.n,
      path: f.p,
      isDir: !!f.d,
      size: typeof f.s === 'number' ? f.s : -1,
      // 含 CJK 的文件名预计算首字母拼音，其余置空
      pinyinAbbr: /[\u4e00-\u9fff]/.test(f.n) ? pinyinOf(f.n, 'first') : ''
    })
    if (out.length >= 60000) break
  }
  return out
}

/* ---------------- 匹配 ---------------- */
// 简拼子序列容错匹配：query 逐字命中缩写串，相邻命中间最多跳过 2 个字符
// （对齐原版 uTools 行为：yb → 字符映射表 zfyysb 的 y…b；排除 Python 这类间隔过大的误匹配）
function isSubsequence(q, str, maxGap = 2) {
  let qi = 0
  let prevHit = -1
  for (let j = 0; j < str.length && qi < q.length; j++) {
    if (str[j] === q[qi]) {
      if (prevHit >= 0 && j - prevHit - 1 > maxGap) return false
      prevHit = j
      qi++
    }
  }
  return qi >= q.length
}

function bestMatch(q, item) {
  const name = item.name.toLowerCase()
  const idx = name.indexOf(q)
  let best = null
  const consider = (score, mt, start, len) => {
    if (!best || score > best.score) best = { score, mt, start, len }
  }
  if (idx >= 0) {
    if (name === q) consider(10000, 'name', idx, q.length)
    else if (idx === 0) consider(6000 + Math.max(0, 60 - name.length), 'name', 0, q.length)
    else consider(3800 - idx * 2, 'name', idx, q.length)
  }
  if (item.acronym) {
    const a = item.acronym.toLowerCase()
    if (a.startsWith(q)) consider(5000, 'acronym', -1, 0)
    else if (a.includes(q)) consider(3000, 'acronym', -1, 0)
  }
  if (item.pinyin) {
    if (item.pinyin.startsWith(q)) consider(4200, 'pinyin', -1, 0)
    else if (item.pinyin.includes(q)) consider(2800, 'pinyin', -1, 0)
  }
  if (item.pinyinAbbr) {
    if (item.pinyinAbbr.startsWith(q)) consider(4000, 'pinyinAbbr', -1, 0)
    else if (item.pinyinAbbr.includes(q)) consider(2600, 'pinyinAbbr', -1, 0)
    else if (q.length >= 2 && isSubsequence(q, item.pinyinAbbr)) consider(2200, 'pinyinAbbrSub', -1, 0)
  }
  return best
}

function searchApps(q) {
  const prefPath = state.searchPrefs[q]
  const out = []
  for (const it of state.apps) {
    ensurePinyin(it)
    const m = bestMatch(q, it)
    const isPref = !!(prefPath && it.path === prefPath)
    if (m || isPref) out.push({ item: it, score: (m ? m.score : 0) + (isPref ? 9000 : 0), m })
  }
  out.sort((x, y) => y.score - x.score || x.item.name.length - y.item.name.length)
  return out.slice(0, 8)
}

function searchFiles(q) {
  // 多词查询：第一段匹配文件名（打分与高亮），后续段在完整路径上收窄
  const terms = q.split(/\s+/).filter(Boolean)
  const nameQ = terms[0] || ''
  const pathTerms = terms.slice(1)
  const out = []
  for (const it of state.files) {
    const name = it.name.toLowerCase()
    const idx = name.indexOf(nameQ)
    if (idx < 0) {
      if (it.pinyinAbbr && it.pinyinAbbr.startsWith(nameQ)) {
        out.push({ item: it, score: 2500 - name.length })
      }
      continue
    }
    const score = name === nameQ ? 9000 : idx === 0 ? 5000 - name.length : 3400 - idx * 3 - name.length * 0.1
    out.push({ item: it, score, m: { start: idx, len: nameQ.length } })
  }
  out.sort((x, y) => y.score - x.score)
  const narrowed = pathTerms.length
    ? out.filter((r) => {
        const p = (r.item.path || '').toLowerCase()
        return pathTerms.every((t) => p.includes(t))
      })
    : out
  return narrowed.slice(0, 15)
}

// Everything 结果按名称相关度排序（精确同名 > 前缀 > 包含；同分比路径深度与短名，越浅越优先）
// 名称匹配只用查询词的第一段（后续段是路径过滤词，不参与文件名打分）
function sortEsResults(list) {
  const q = (state.esQuery || '').split(/\s+/).filter(Boolean)[0] || ''
  const scored = list.map((it) => {
    const name = (it.n || '').toLowerCase()
    const idx = q ? name.indexOf(q) : -1
    // 精确同名常有几十个同分项（如各级目录里嵌套的同名文件夹），按路径深度浅者优先：
    // D:\Agent(2段) 必然排在 C:\...\SF\EDR\agent\config\log\agent(9段) 之前
    const depth = (it.p || '').split(/[\\/]/).length
    const score = name === q ? 9000 - depth : idx === 0 ? 5000 - name.length : idx > 0 ? 3000 - idx * 3 : 1000
    return { it, score, m: idx >= 0 ? { start: idx, len: q.length } : null }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => ({
    kind: 'file',
    item: { kind: 'file', name: s.it.n, path: s.it.p, isDir: !!s.it.d, size: typeof s.it.s === 'number' ? s.it.s : -1 },
    name: s.it.n,
    sub: s.it.p,
    m: s.m
  }))
}

// 触发 Everything 异步搜索（结果到达且输入未变时刷新文件分区）
let esTimer = null
function requestEs(q) {
  clearTimeout(esTimer)
  if (!state.es || !state.es.available || !q) {
    state.esResults = null
    state.esQuery = ''
    state.esType = ''
    state.esTerm = ''
    return
  }
  // 文件/文件夹过滤下沉到 Everything（/a-d、/ad），避免同名文件夹淹没文件结果
  const type = state.typeFilter === 'file' || state.typeFilter === 'dir' ? state.typeFilter : ''
  const term = q.split(/\s+/).filter(Boolean)[0] || ''
  // 后续段只是路径过滤词，文件名搜索词没变就复用已有结果，无需重查
  if (term === state.esTerm && type === (state.esType || '') && Array.isArray(state.esResults)) {
    state.esQuery = q
    renderResults()
    return
  }
  esTimer = setTimeout(async () => {
    const r = await window.jtools.searchFiles(q, 30, type)
    if (input.value.trim().toLowerCase() === q && state.typeFilter === (type || 'all')) {
      state.esResults = Array.isArray(r) && r.length ? r : null
      state.esQuery = q
      state.esType = type
      state.esTerm = term
      if (state.mode === 'search') renderResults()
    }
  }, 120)
}

function searchPlugins(q) {
  const out = []
  for (const p of state.plugins) {
    const name = p.name.toLowerCase()
    let score = 0
    if (name === q || name.startsWith(q)) score = 9500
    else if (name.includes(q)) score = 7000
    else {
      for (const kw of p.keywords) {
        const k = kw.toLowerCase()
        if (k === q) { score = 9200; break }
        if (k.startsWith(q)) { score = Math.max(score, 8500) }
        else if (pinyinOf(k).startsWith(q) || (k.length <= 6 && pinyinOf(k, 'first').startsWith(q))) {
          score = Math.max(score, 8000)
        }
      }
    }
    if (score) out.push({ plugin: p, score })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

/* 智能动作：URL / 本地路径（路径存在性异步查主进程并缓存） */
const pathExistsCache = new Map()
function checkPathExistsAsync(p) {
  if (pathExistsCache.has(p)) return
  pathExistsCache.set(p, undefined) // pending
  window.jtools.pathExists(p).then((ok) => {
    pathExistsCache.set(p, ok)
    // 查询结果返回时输入若未变则重渲染
    if (state.mode === 'search' && input.value.trim().replace(/^"(.*)"$/, '$1') === p) renderResults()
  })
}
function smartActions(q) {
  const acts = []
  if (/^https?:\/\/\S+$/i.test(q)) {
    acts.push({
      kind: 'url', name: '打开网址', sub: q, path: q, icon: ICON_GLOBE,
      badge: '网址'
    })
  }
  // 绝对路径（带引号的去掉引号）
  const p = q.trim().replace(/^"(.*)"$/, '$1')
  if (/^[a-zA-Z]:[\\/][^?*<>|]*$/.test(p)) {
    const cached = pathExistsCache.get(p)
    if (cached === true) {
      acts.push({
        kind: 'path', name: '打开文件或文件夹', sub: p, path: p,
        icon: ICON_FILE, badge: '路径'
      })
    } else if (cached === undefined) {
      checkPathExistsAsync(p)
    }
  }
  return acts
}

/* ---------------- 渲染 ---------------- */
const TRANSLATE_KEYWORDS = ['fy', '翻译', 'fanyi', 'translate']
function extractTranslatePayload(q) {
  const lower = q.toLowerCase()
  for (const kw of TRANSLATE_KEYWORDS) {
    if (lower === kw) return { payload: '' }
    if (lower.startsWith(kw) && (q[kw.length] === ' ' || q[kw.length] === '　')) {
      return { payload: q.slice(kw.length).trim() }
    }
  }
  return null
}

function renderResults() {
  if (state.mode !== 'search') {
    syncHeight()
    return
  }
  const q = input.value.trim().toLowerCase()
  const qRaw = input.value.trim()
  const sections = []

  if (!qRaw) {
    // 空输入：仅显示已固定（uTools 首页图标网格风格，支持拖拽排序）
    if (state.pinned.length) sections.push({ title: '已固定', grid: true, reorder: true, items: state.pinned.map(pinnedToItem) })
  } else {
    const tr = extractTranslatePayload(qRaw)
    if (tr) {
      const tp = state.plugins.find((p) => p.id === 'translate')
      if (tp) {
        sections.push({
          title: '插件',
          items: [{
            kind: 'plugin', plugin: tp, name: '快速翻译', sub: tr.payload ? `翻译: ${tr.payload}` : '回车进入，输入文本即时翻译',
            icon: tp.logo || '', badge: '翻译', pluginId: tp.id, payload: tr.payload
          }]
        })
      }
    }
    // 智能动作
    const acts = smartActions(qRaw)
    if (acts.length) sections.push({ title: '操作', items: acts })

    // 插件
    if (!tr) {
      const pl = searchPlugins(q)
      if (pl.length) {
        sections.push({
          title: '插件',
          items: pl.map((r) => ({
            kind: 'plugin', plugin: r.plugin, name: r.plugin.name, sub: r.plugin.description,
            icon: r.plugin.logo || '', badge: '插件', pluginId: r.plugin.id
          }))
        })
      }
    }

    // 应用（uTools 搜索结果同样是图标网格）
    const apps = searchApps(q)
    if (apps.length) {
      sections.push({
        title: '应用',
        grid: true,
        items: apps.map((r) => ({
          kind: 'app', item: r.item, name: r.item.name,
          sub: r.item.type === 'uwp' ? '系统应用' : r.item.type === 'setting' ? '系统设置' : r.item.path,
          m: r.m
        }))
      })
    }

    // 文件（Everything 可用时走全盘实时搜索，否则内置索引）
    // 多词查询：第一段匹配文件名，后续段在完整路径上收窄（Everything 式用法）
    let fileItems = null
    let fileTitle = '文件'
    const qTerms = q.split(/\s+/).filter(Boolean)
    const pathTerms = qTerms.slice(1)
    if (state.es && state.es.available) {
      const esType = state.typeFilter === 'file' || state.typeFilter === 'dir' ? state.typeFilter : ''
      if (state.esQuery === q && (state.esType || '') === esType && Array.isArray(state.esResults)) {
        fileItems = sortEsResults(state.esResults)
        fileTitle = '文件 · Everything'
      }
      // else: Everything 结果尚未返回，本帧不显示文件分区
    } else {
      fileItems = searchFiles(q).map((r) => ({
        kind: 'file', item: r.item, name: r.item.name, sub: r.item.path, m: r.m
      }))
    }
    if (fileItems) {
      if (pathTerms.length) {
        fileItems = fileItems.filter((it) => {
          const p = (it.item.path || '').toLowerCase()
          return pathTerms.every((t) => p.includes(t))
        })
      }
      fileItems.forEach((it) => { it._pathTerms = pathTerms })
      fileItems = fileItems.slice(0, 15)
    }
    if (fileItems && fileItems.length) {
      sections.push({ title: fileTitle, items: fileItems })
    }

    // 按类型过滤（仅查询结果；首页空输入的固定项不受过滤影响）
    const f = state.typeFilter
    if (f !== 'all') {
      const keep = (it) =>
        f === 'app' ? it.kind === 'app'
          : f === 'plugin' ? it.kind === 'plugin'
            : f === 'file' ? it.kind === 'file' && !it.item.isDir
              : f === 'dir' ? it.kind === 'file' && it.item.isDir
                : true
      for (let i = sections.length - 1; i >= 0; i--) {
        sections[i].items = sections[i].items.filter(keep)
        if (!sections[i].items.length) sections.splice(i, 1)
      }
    }
  }

  // 扁平化 + 渲染
  state.flat = []
  let html = ''
  for (const sec of sections) {
    html += `<div class="section-title">${escapeHtml(sec.title)}</div>`
    for (const it of sec.items) {
      const idx = state.flat.length
      it._idx = idx
      it._reorderable = !!sec.reorder
      state.flat.push(it)
    }
    if (sec.grid) {
      html += `<div class="icon-grid">` + sec.items.map((it) => renderGridItemHtml(it, it._idx)).join('') + `</div>`
    } else {
      html += sec.items.map((it) => renderItemHtml(it, it._idx)).join('')
    }
  }
  if (!qRaw && state.flat.length) {
    html += `<div class="hint-line">拖拽图标排序 · 右键或 Ctrl+P 固定到列表 · 右键可打开所在位置</div>`
  }
  if (!state.flat.length) {
    html = !qRaw
      ? `<div class="section-title" style="text-align:center;padding:18px 0;line-height:1.8">暂无固定项<br>搜索到应用后右键 / Ctrl+P 固定，或在 设置 → 固定管理 中浏览选择添加</div>`
      : `<div class="section-title" style="text-align:center;padding:18px 0">无匹配结果</div>`
  }
  resultsEl.innerHTML = html
  // 恢复选中
  const prevSel = state._lastFirst && state._lastFirst === q ? state.selected : 0
  state.selected = Math.min(prevSel, Math.max(0, state.flat.length - 1))
  state._lastFirst = q
  updateSelected()
  syncHeight()
}

// 图标内容（列表与网格共用）
function iconInnerHtml(it, name) {
  if (it.kind === 'app') {
    if (it.item.type === 'setting') {
      return `<div class="item-icon" style="background:linear-gradient(160deg,#38bdf8,#2563eb)"><svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.9" style="width:19px;height:19px">${ICON_GEAR_SVG_PATHS}</svg></div>`
    }
    if (it.item.iconData) return `<img src="${it.item.iconData}" alt="">`
    return `<div class="item-icon" style="background:${letterColor(name)}">${escapeHtml(name[0] || '?')}</div>`
  }
  if (it.kind === 'plugin') {
    if (it.icon) return `<img src="${it.icon}" alt="">`
    return `<div class="item-icon" style="background:${letterColor(name)}">${escapeHtml(name[0] || '?')}</div>`
  }
  if (it.kind === 'settings') {
    return `<div class="item-icon" style="background:transparent"><svg viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" stroke-width="1.7" style="width:30px;height:30px">${ICON_GEAR_SVG_PATHS}</svg></div>`
  }
  const icon = it.icon || (it.item && it.item.isDir ? ICON_FOLDER : ICON_FILE)
  return `<img src="${icon}" alt="">`
}

// 首页/搜索图标网格项（图标在上、名称在下）；首页固定项可拖拽排序
function renderGridItemHtml(it, idx) {
  const name = it.name || ''
  const m = it.m
  const nameHtml = m && m.mt === 'name' ? highlight(name, m.start, m.len) : escapeHtml(name)
  return `<div class="icon-item${idx === state.selected ? ' selected' : ''}" data-idx="${idx}" draggable="${it._reorderable ? 'true' : 'false'}">
    <div class="icon-box">${iconInnerHtml(it, name)}</div>
    <div class="icon-name">${nameHtml}</div>
  </div>`
}

function renderItemHtml(it, idx) {
  const name = it.name || ''
  const m = it.m
  const nameHtml = m && m.mt === 'name' ? highlight(name, m.start, m.len) : escapeHtml(name)
  const badge = it.badge || (it.kind === 'app'
    ? (it.item.type === 'uwp' ? 'UWP' : it.item.type === 'setting' ? '设置' : '应用')
    : it.kind === 'file' ? '文件' : '')
  const sel = idx === state.selected ? ' selected' : ''
  const revealBtn = it.kind === 'file'
    ? `<button class="row-action" data-act="reveal" title="在资源管理器中显示">打开路径</button>`
    : ''
  const sizeHtml = it.kind === 'file' && !it.item.isDir && it.item.size >= 0
    ? `<span class="item-size">${formatSize(it.item.size)}</span>`
    : ''
  const subHtml = it.kind === 'file' && it._pathTerms && it._pathTerms.length
    ? highlightPathTerms(it.sub, it._pathTerms)
    : escapeHtml(it.sub || '')
  return `<div class="result-item${sel}" data-idx="${idx}">
    <div class="item-icon">${iconInnerHtml(it, name)}</div>
    <div class="item-text">
      <div class="item-name">${nameHtml}</div>
      <div class="item-sub">${subHtml}</div>
    </div>
    ${sizeHtml}
    ${revealBtn}
    ${badge ? `<span class="item-badge">${escapeHtml(badge)}</span>` : ''}
  </div>`
}

// 与 ICON_GEAR 配套的内联路径（直接嵌入 svg 标签用）
const ICON_GEAR_SVG_PATHS =
  '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>'

function historyToItem(h) {
  return h.kind === 'file'
    ? { kind: 'file', item: { kind: 'file', name: h.name, path: h.path, isDir: h.isDir }, name: h.name, sub: h.path }
    : { kind: 'app', item: { kind: 'app', name: h.name, path: h.path, type: h.type || 'app', iconData: (state.appIconByPath && state.appIconByPath.get(h.path)) || h.icon || h.iconData || '' }, name: h.name, sub: h.path || '系统应用' }
}

/* ---------------- 固定（钉选） ---------------- */
function pinnedToItem(p) {
  return historyToItem(p)
}

// 从结果项构造可固定/入历史的数据结构
function entryOf(it) {
  if (it.kind === 'app') {
    return { kind: 'app', name: it.item.name, path: it.item.path, type: it.item.type, iconData: it.item.iconData || '' }
  }
  if (it.kind === 'file') {
    return { kind: 'file', name: it.item.name, path: it.item.path, isDir: it.item.isDir }
  }
  return null
}

function togglePin(entry) {
  if (!entry) return
  const idx = state.pinned.findIndex((p) => p.path === entry.path)
  if (idx >= 0) state.pinned.splice(idx, 1)
  else state.pinned = [entry, ...state.pinned].slice(0, 20)
  window.jtools.savePinned(state.pinned)
  renderResults()
}

/* ---------------- 右键菜单 ---------------- */
let ctxMenuEl = null
function closeCtxMenu() {
  if (ctxMenuEl) {
    ctxMenuEl.remove()
    ctxMenuEl = null
  }
}
function openCtxMenu(x, y, it) {
  closeCtxMenu()
  const entry = entryOf(it)
  if (!entry) return
  const isPinned = state.pinned.some((p) => p.path === entry.path)
  const canReveal = entry.path && !entry.path.startsWith('uwp:') && /^[a-zA-Z]:[\\/]/.test(entry.path)
  ctxMenuEl = document.createElement('div')
  ctxMenuEl.className = 'ctx-menu'
  ctxMenuEl.innerHTML = `
    <div class="ctx-item" data-act="pin">${isPinned ? '取消固定' : '固定到列表'}</div>
    ${canReveal ? '<div class="ctx-item" data-act="reveal">打开所在位置</div>' : ''}`
  document.body.appendChild(ctxMenuEl)
  const r = ctxMenuEl.getBoundingClientRect()
  ctxMenuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px'
  ctxMenuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px'
  ctxMenuEl.addEventListener('click', (ev) => {
    const act = ev.target.closest('.ctx-item') && ev.target.closest('.ctx-item').dataset.act
    if (act === 'pin') togglePin(entry)
    else if (act === 'reveal') window.jtools.reveal(entry.path)
    closeCtxMenu()
  })
}

resultsEl.addEventListener('contextmenu', (e) => {
  const node = e.target.closest('.result-item, .icon-item')
  if (!node) return
  e.preventDefault()
  const it = state.flat[Number(node.dataset.idx)]
  if (it) openCtxMenu(e.clientX, e.clientY, it)
})
document.addEventListener('mousedown', (e) => {
  if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu()
})

/* ---------------- 首页固定项拖拽排序 ---------------- */
let dragPath = null // 正在拖拽的固定项 path
let dropHint = null // drop 前后半区提示（true=插到目标前）
function clearDropHint() {
  resultsEl.querySelectorAll('.drag-src, .drag-over').forEach((n) => n.classList.remove('drag-src', 'drag-over'))
}
resultsEl.addEventListener('dragstart', (e) => {
  const node = e.target.closest('.icon-item')
  const it = node && state.flat[Number(node.dataset.idx)]
  if (!node || !it || !it._reorderable) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    return
  }
  dragPath = it.item.path
  dropHint = null
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', dragPath) // Firefox 必须 setData 才触发 drag
  }
  node.classList.add('drag-src')
})
resultsEl.addEventListener('dragover', (e) => {
  if (!dragPath) return
  const node = e.target.closest('.icon-item')
  if (!node) return
  const it = state.flat[Number(node.dataset.idx)]
  if (!it || !it._reorderable || it.item.path === dragPath) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  clearDropHint()
  node.classList.add('drag-over')
  const r = node.getBoundingClientRect()
  dropHint = e.clientX >= r.left + r.width / 2 // 右半区 → 插到目标之后
})
resultsEl.addEventListener('dragleave', (e) => {
  const node = e.target.closest('.icon-item')
  if (node && !node.contains(e.relatedTarget)) node.classList.remove('drag-over')
})
resultsEl.addEventListener('drop', (e) => {
  e.preventDefault()
  const node = e.target.closest('.icon-item')
  const target = node && state.flat[Number(node.dataset.idx)]
  const from = state.pinned.findIndex((p) => p.path === dragPath)
  const toIdx = target && target._reorderable ? state.pinned.findIndex((p) => p.path === target.item.path) : -1
  const after = dropHint
  dragPath = null
  dropHint = null
  clearDropHint()
  if (from < 0 || toIdx < 0) return
  // 先移除再插入：右半区插到目标之后
  let to = toIdx + (after ? 1 : 0)
  const [moved] = state.pinned.splice(from, 1)
  if (from < toIdx) to--
  state.pinned.splice(to, 0, moved)
  window.jtools.savePinned(state.pinned)
  renderResults()
})
resultsEl.addEventListener('dragend', () => {
  dragPath = null
  dropHint = null
  clearDropHint()
})

// 搜索类型过滤：只影响查询结果，首页固定项始终完整展示（启动即绑定，不依赖设置页渲染）
typeFilterEl.onchange = () => {
  state.typeFilter = typeFilterEl.value
  renderResults()
  const q = input.value.trim().toLowerCase()
  if (q) requestEs(q) // 文件/文件夹过滤下沉到 Everything，需要按新类型重查
}

function updateSelected() {
  const nodes = resultsEl.querySelectorAll('.result-item, .icon-item')
  nodes.forEach((n) => {
    const idx = Number(n.dataset.idx)
    n.classList.toggle('selected', idx === state.selected)
    if (idx === state.selected) {
      const r = n.getBoundingClientRect()
      const cr = resultsEl.getBoundingClientRect()
      if (r.top < cr.top + 4) n.scrollIntoView({ block: 'start' })
      else if (r.bottom > cr.bottom - 4) n.scrollIntoView({ block: 'end' })
    }
  })
}

function contentHeight(el, extra = 0) {
  let h = 0
  for (const k of el.children) h += k.offsetHeight
  return h + extra
}

function syncHeight() {
  let h = 58
  if (state.mode === 'plugin') {
    h = 58 + (state.pluginHeight || 420)
  } else if (state.mode === 'settings') {
    h = Math.min(58 + contentHeight(settingsView, 34), 58 + 541)
  } else {
    const content = contentHeight(resultsEl, 14)
    if (content > 20) h = 58 + Math.min(content, 541)
  }
  window.jtools.resizeWindow(h)
}

/* ---------------- 执行 ---------------- */
async function executeItem(it) {
  if (it.kind === 'app') {
    pushHistory({ kind: 'app', name: it.item.name, path: it.item.path, type: it.item.type, iconData: it.item.iconData })
    rememberPref(it.item.path)
    await window.jtools.launch({ path: it.item.path, type: 'app' })
    resetForNext()
  } else if (it.kind === 'file') {
    pushHistory({ kind: 'file', name: it.item.name, path: it.item.path, isDir: it.item.isDir })
    rememberPref(it.item.path)
    await window.jtools.launch({ path: it.item.path, type: 'file' })
    resetForNext()
  } else if (it.kind === 'url' || it.kind === 'path') {
    rememberPref(it.path)
    await window.jtools.launch({ path: it.path, type: it.kind })
    resetForNext()
  } else if (it.kind === 'plugin') {
    enterPlugin(it.pluginId, it.payload || '')
  } else if (it.kind === 'settings') {
    openSettings()
  }
}

// 记录当前搜索词 → 选中的条目（搜索偏好记忆）
function rememberPref(itemPath) {
  const q = input.value.trim().toLowerCase()
  if (!q || !itemPath) return
  state.searchPrefs[q] = itemPath
  window.jtools.saveSearchPref(q, itemPath)
}

function pushHistory(entry) {
  state.history = [entry, ...state.history.filter((h) => h.path !== entry.path)].slice(0, 30)
  window.jtools.saveHistory(state.history)
}

function resetForNext() {
  input.value = ''
  updatePlaceholder()
  state.esResults = null
  state.esQuery = ''
  state.esType = ''
  if (state.mode === 'search') renderResults()
}

/* ---------------- 插件宿主 ---------------- */
function enterPlugin(pluginId, payload) {
  const p = state.plugins.find((x) => x.id === pluginId)
  if (!p) return
  state.mode = 'plugin'
  state.activePlugin = p
  state.pluginReady = false
  state.pluginHeight = 420
  pluginPill.classList.remove('hidden')
  typeFilterEl.classList.add('hidden')
  pillName.textContent = p.name
  pillLogo.src = p.logo || ''
  resultsEl.classList.add('hidden')
  resultsEl.innerHTML = ''
  pluginView.classList.add('visible')
  pluginView.src = 'file:///' + encodeURI(p.entry.replace(/\\/g, '/'))
  input.value = payload || ''
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  updatePlaceholder(p.subInputPlaceholder || '输入内容…')
  syncHeight()
}

function outPlugin() {
  if (state.mode !== 'plugin') return
  state.mode = 'search'
  state.activePlugin = null
  state.pluginReady = false
  state.pluginHeight = 0
  pluginView.classList.remove('visible')
  pluginView.src = 'about:blank'
  pluginPill.classList.add('hidden')
  typeFilterEl.classList.remove('hidden')
  resultsEl.classList.remove('hidden')
  input.value = ''
  updatePlaceholder()
  renderResults()
  input.focus()
  syncHeight()
}

window.addEventListener('message', (ev) => {
  const data = ev.data || {}
  if (state.mode !== 'plugin' || !state.activePlugin) return
  if (ev.source !== pluginView.contentWindow) return
  switch (data.type) {
    case 'ztool-ready': {
      state.pluginReady = true
      pluginView.contentWindow.postMessage(
        { type: 'init', payload: input.value, version: state.version || '' }, '*')
      break
    }
    case 'set-subinput':
      updatePlaceholder(data.placeholder || '输入内容…')
      break
    case 'set-height':
      state.pluginHeight = Math.max(120, Math.min(Number(data.height) || 420, 541))
      syncHeight()
      break
    case 'out-plugin':
      outPlugin()
      break
    case 'copy-text':
      window.jtools.copyText(data.text)
      break
    case 'request':
      window.jtools.netRequest(data.req).then((res) => {
        if (state.mode === 'plugin' && pluginView.contentWindow) {
          pluginView.contentWindow.postMessage({ type: 'request-reply', id: data.id, res }, '*')
        }
      })
      break
    case 'translate': {
      const send = (res) => {
        if (state.mode === 'plugin' && pluginView.contentWindow) {
          pluginView.contentWindow.postMessage({ type: 'translate-reply', id: data.id, res }, '*')
        }
      }
      window.jtools.translate(data.text, data.opts).then(send).catch((e) => send({ error: e.message }))
      break
    }
    case 'esc':
      handleEscape()
      break
  }
})

function forwardSubInput() {
  if (state.mode === 'plugin' && state.pluginReady && pluginView.contentWindow) {
    pluginView.contentWindow.postMessage({ type: 'subinput', value: input.value }, '*')
  }
}

/* ---------------- 设置页 ---------------- */
async function openSettings() {
  state.mode = 'settings'
  resultsEl.classList.add('hidden')
  settingsView.classList.add('visible')
  await renderSettings()
  input.value = ''
  updatePlaceholder('搜索（按 Esc 返回）')
  syncHeight()
}

function closeSettings() {
  state.mode = 'search'
  settingsView.classList.remove('visible')
  settingsView.innerHTML = ''
  resultsEl.classList.remove('hidden')
  updatePlaceholder()
  renderResults()
  input.focus()
  syncHeight()
}

async function renderSettings() {
  const s = await window.jtools.getSettings()
  state.settings = s
  const idx = await window.jtools.getIndexStatus()
  const ver = await window.jtools.getAppVersion()
  const dirsText = (s.fileSearchDirs || []).join('\n')
  settingsView.innerHTML = `
    <div class="settings-nav">
      <span class="tab active" data-tab="general">通用</span>
      <span class="tab" data-tab="pins">固定管理</span>
      <span class="tab" data-tab="files">文件搜索</span>
      <span class="tab" data-tab="translate">翻译</span>
      <span class="tab" data-tab="about">关于</span>
    </div>

    <div class="settings-pane active" data-pane="general">
      <div class="set-row">
        <span class="set-label">呼出快捷键</span>
        <select id="set-hotkey">
          ${(s.hotkeyCandidates || ['Alt+Space']).map((k) =>
            `<option value="${k}" ${k === s.hotkey ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
        <span class="set-desc">全局呼出 / 隐藏窗口</span>
      </div>
      <div class="set-row">
        <span class="set-label">开机自启</span>
        <input type="checkbox" id="set-autostart" ${s.autoStart ? 'checked' : ''} />
      </div>
    </div>

    <div class="settings-pane" data-pane="pins">
      <div class="set-row"><span class="set-label">添加固定</span>
        <button class="btn" id="btn-pick-pin">选择应用 / 快捷方式…</button>
        <button class="btn secondary" id="btn-pick-dir">选择文件夹…</button>
      </div>
      <div class="set-row"><span class="set-desc">打开系统对话框浏览文件夹选取，快捷方式(.lnk)可直接选择并使用其图标；添加后显示在首页「已固定」</span>
        <span class="status-text" id="pin-status"></span></div>
      <div id="pin-list"></div>
    </div>

    <div class="settings-pane" data-pane="files">
      <div class="set-row"><span class="set-label">Everything</span>
        <span class="status-text" id="es-status">检测中…</span>
        <button class="btn secondary" id="btn-es-detect">重新检测</button>
      </div>
      <div class="set-row"><span class="set-label">es.exe 路径</span>
        <input type="text" id="set-es-path" style="flex:1;max-width:none;width:auto" value="${escapeHtml(s.esPath || '')}" placeholder="留空使用数据目录下的 es.exe"/>
        <button class="btn" id="btn-save-es">保存</button>
      </div>
      <div class="set-row"><span class="set-desc">接入 Everything 后文件搜索为全盘实时（需 Everything 正在运行）；未接入时回退内置索引</span></div>
      <div class="set-row"><span class="set-label">索引目录</span>
        <span class="set-desc">每行一个目录；留空使用默认（桌面 / 文档 / 下载）</span></div>
      <textarea id="set-dirs" placeholder="C:\\Users\\you\\Projects">${escapeHtml(dirsText)}</textarea>
      <div class="set-row">
        <button class="btn" id="btn-save-dirs">保存目录</button>
        <button class="btn secondary" id="btn-rebuild">重建索引</button>
        <span class="status-text" id="idx-status">${idx.count} 个条目 · ${idx.builtAt ? new Date(idx.builtAt).toLocaleString() : '尚未建立'}</span>
      </div>
    </div>

    <div class="settings-pane" data-pane="translate">
      <div class="set-row"><span class="set-label">优先引擎</span>
        <select id="set-provider">
          <option value="google" ${s.translateProviderOrder[0] === 'google' ? 'selected' : ''}>Google（默认）</option>
          <option value="mymemory" ${s.translateProviderOrder[0] === 'mymemory' ? 'selected' : ''}>MyMemory</option>
          <option value="baidu" ${s.translateProviderOrder[0] === 'baidu' ? 'selected' : ''}>百度翻译</option>
        </select>
        <span class="set-desc">失败自动回退其他引擎</span></div>
      <div class="set-row"><span class="set-label">百度 APPID</span>
        <input type="text" id="set-baidu-id" value="${escapeHtml(s.baiduAppid || '')}" placeholder="可选"/></div>
      <div class="set-row"><span class="set-label">百度密钥</span>
        <input type="text" id="set-baidu-key" value="${escapeHtml(s.baiduSecret || '')}" placeholder="可选"/></div>
      <div class="set-row">
        <button class="btn" id="btn-save-trans">保存</button>
        <button class="btn secondary" id="btn-test-trans">测试翻译</button>
        <span class="status-text" id="trans-status"></span>
      </div>
    </div>

    <div class="settings-pane" data-pane="about">
      <div class="set-row"><span class="set-label">版本</span><span class="set-desc">jTools v${escapeHtml(ver)} · 无广告 · 无追踪</span></div>
      <div class="set-row"><span class="set-label">快捷键</span><span class="set-desc">Alt+Space 呼出 / Esc 隐藏 / 输入 fy 快速翻译</span></div>
      <div class="set-row"><button class="btn secondary" id="btn-open-data">打开数据目录</button></div>
    </div>`

  // tab 切换
  settingsView.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      settingsView.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t))
      settingsView.querySelectorAll('.settings-pane').forEach((p) =>
        p.classList.toggle('active', p.dataset.pane === t.dataset.tab))
      syncHeight()
    }
  })
  $('set-hotkey').onchange = (e) => window.jtools.saveSettings({ hotkey: e.target.value })
  $('set-autostart').onchange = (e) => window.jtools.saveSettings({ autoStart: e.target.checked })

  // 固定管理：浏览选择添加 / 移除
  const pinList = $('pin-list')
  const pinIcon = (p) => (state.appIconByPath && state.appIconByPath.get(p.path)) || p.icon || p.iconData || ''
  const renderPinList = () => {
    pinList.innerHTML = state.pinned.length
      ? state.pinned.map((p, i) => `
        <div class="pin-row">
          <div class="item-icon" style="width:26px;height:26px">
            ${pinIcon(p)
                ? `<img src="${pinIcon(p)}" alt="" style="width:26px;height:26px;border-radius:5px">`
                : `<span style="color:#fff;font-size:12px;font-weight:700;background:${letterColor(p.name || '?')};width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center">${escapeHtml((p.name || '?')[0])}</span>`}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name || '')}</div>
            <div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.path || '')}</div>
          </div>
          <button class="btn secondary pin-remove" data-i="${i}">移除</button>
        </div>`).join('')
      : `<div class="set-desc" style="padding:6px 0">暂无固定项</div>`
    pinList.querySelectorAll('.pin-remove').forEach((b) => {
      b.onclick = async () => {
        state.pinned.splice(Number(b.dataset.i), 1)
        await window.jtools.savePinned(state.pinned)
        renderResults()
        renderPinList()
      }
    })
  }
  renderPinList()
  // 浏览选择添加：系统对话框（快捷方式可多选）→ 使用所选快捷方式的图标
  const addToPinned = (entry) => {
    if (state.pinned.some((x) => x.path === entry.path)) return false
    state.pinned = [entry, ...state.pinned]
    return true
  }
  const savePinsAndRender = async (statusEl, msg) => {
    await window.jtools.savePinned(state.pinned)
    statusEl.textContent = msg
    renderResults()
    renderPinList()
  }
  $('btn-pick-pin').onclick = async () => {
    const statusEl = $('pin-status')
    const files = await window.jtools.pickPinFiles()
    if (!files.length) return
    let added = 0
    for (const p of files) {
      const base = p.split(/[\\/]/).pop() || p
      const name = base.replace(/\.(lnk|url|exe)$/i, '') || base
      // 图标走 jtools-icon 协议按需提取（原生层跟随 .lnk 到目标 exe，永远新鲜）
      if (addToPinned({ kind: 'app', name, path: p, type: 'app', icon: 'jtools-icon://' + encodeURIComponent(p), iconData: '' })) added++
    }
    await savePinsAndRender(statusEl, added ? `已添加 ${added} 项 ✓` : '所选条目已在固定列表中')
  }
  $('btn-pick-dir').onclick = async () => {
    const statusEl = $('pin-status')
    const p = await window.jtools.pickPinDir()
    if (!p) return
    const base = p.split(/[\\/]/).pop() || p
    const ok = addToPinned({ kind: 'file', name: base, path: p, isDir: true })
    await savePinsAndRender(statusEl, ok ? '已添加 ✓' : '已在固定列表中')
  }
  $('btn-save-dirs').onclick = async () => {
    const dirs = $('set-dirs').value.split('\n').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean)
    await window.jtools.saveSettings({ fileSearchDirs: dirs })
    state.filesIndexing = true
    $('idx-status').textContent = '正在重建索引…'
    const st = await window.jtools.rebuildFileIndex()
    state.filesIndexing = false
    $('idx-status').textContent = `${st.count} 个条目 · ${new Date(st.builtAt).toLocaleString()}`
    window.jtools.getFiles().then((f) => { state.files = buildFileIndex(f) })
  }
  // Everything 状态
  const refreshEsStatus = async (force) => {
    const es = await window.jtools.getEsStatus(force)
    state.es = es
    $('es-status').textContent =
      es.mode === 'bundled' ? '已接入（内置 Everything 实例）✓'
        : es.available ? '已接入（外部 Everything）✓'
          : '未检测到 · 使用内置索引'
  }
  refreshEsStatus()
  $('btn-es-detect').onclick = () => refreshEsStatus(true)
  $('btn-save-es').onclick = async () => {
    await window.jtools.saveSettings({ esPath: $('set-es-path').value.trim() })
    await refreshEsStatus()
  }
  $('btn-rebuild').onclick = async () => {
    $('idx-status').textContent = '正在重建索引…'
    const st = await window.jtools.rebuildFileIndex()
    $('idx-status').textContent = `${st.count} 个条目 · ${new Date(st.builtAt).toLocaleString()}`
    window.jtools.getFiles().then((f) => { state.files = buildFileIndex(f) })
  }
  $('btn-save-trans').onclick = async () => {
    const first = $('set-provider').value
    const order = first === 'google' ? ['google', 'mymemory', 'baidu']
      : first === 'mymemory' ? ['mymemory', 'google', 'baidu'] : ['baidu', 'google', 'mymemory']
    await window.jtools.saveSettings({
      translateProviderOrder: order,
      baiduAppid: $('set-baidu-id').value.trim(),
      baiduSecret: $('set-baidu-key').value.trim()
    })
    $('trans-status').textContent = '已保存 ✓'
  }
  $('btn-test-trans').onclick = async () => {
    $('trans-status').textContent = '翻译中…'
    try {
      const r = await window.jtools.translate('Hello, world!')
      $('trans-status').textContent = `结果: ${r.text}（${r.provider}）`
    } catch (e) {
      $('trans-status').textContent = '失败: ' + e.message
    }
  }
  $('btn-open-data').onclick = () => window.jtools.openDataDir()
}

/* ---------------- 输入与键盘 ---------------- */
function updatePlaceholder(text) {
  const t = text !== undefined ? text
    : state.mode === 'plugin' ? (state.activePlugin && state.activePlugin.subInputPlaceholder) || '输入内容…'
    : '搜索应用、文件、插件 — 输入 fy 快速翻译'
  placeholderEl.textContent = t
  if (!input.value) placeholderEl.style.display = ''
  placeholderEl.style.display = input.value ? 'none' : ''
}

function handleEscape() {
  if (ctxMenuEl) { closeCtxMenu(); return }
  if (state.mode === 'settings') { closeSettings(); return }
  if (state.mode === 'plugin') {
    if (input.value) {
      input.value = ''
      updatePlaceholder()
      forwardSubInput()
    } else {
      outPlugin()
    }
    return
  }
  if (input.value) {
    input.value = ''
    updatePlaceholder()
    renderResults()
  } else {
    window.jtools.hideWindow()
  }
}

input.addEventListener('input', () => {
  updatePlaceholder()
  if (state.mode === 'plugin') { forwardSubInput(); return }
  if (state.mode === 'settings') return
  const q = input.value.trim().toLowerCase()
  requestEs(q)
  renderResults()
})

input.addEventListener('compositionstart', () => { state.composing = true })
input.addEventListener('compositionend', () => {
  state.composing = false
  if (state.mode === 'plugin') forwardSubInput()
  else if (state.mode === 'search') {
    const q = input.value.trim().toLowerCase()
    requestEs(q)
    renderResults()
  }
})

input.addEventListener('keydown', (e) => {
  if (state.composing) return
  if (e.key === 'Escape') { e.preventDefault(); handleEscape(); return }
  if (e.key === 'Enter') {
    e.preventDefault()
    const it = state.flat[state.selected]
    if (it) executeItem(it)
    return
  }
  // Ctrl+P：固定 / 取消固定选中项
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault()
    const it = state.flat[state.selected]
    if (it) togglePin(entryOf(it))
    return
  }
  // Ctrl+O：在资源管理器中显示选中文件
  if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault()
    const it = state.flat[state.selected]
    if (it && it.kind === 'file') window.jtools.reveal(it.item.path)
    return
  }
  if (state.mode !== 'search') return
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault()
    if (state.flat.length) {
      state.selected = (state.selected + 1) % state.flat.length
      updateSelected()
    }
  } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
    e.preventDefault()
    if (state.flat.length) {
      state.selected = (state.selected - 1 + state.flat.length) % state.flat.length
      updateSelected()
    }
  } else if (e.key === 'ArrowRight') {
    // 网格行内右移（到行尾则跳到下一行首）
    e.preventDefault()
    if (state.flat.length) {
      state.selected = Math.min(state.selected + 1, state.flat.length - 1)
      updateSelected()
    }
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    if (state.flat.length) {
      state.selected = Math.max(state.selected - 1, 0)
      updateSelected()
    }
  }
})

resultsEl.addEventListener('click', (e) => {
  const actBtn = e.target.closest('.row-action')
  if (actBtn) {
    e.stopPropagation()
    const row = actBtn.closest('[data-idx]')
    const it = row && state.flat[Number(row.dataset.idx)]
    if (it) window.jtools.reveal(it.kind === 'file' ? it.item.path : it.path)
    return
  }
  const node = e.target.closest('.result-item, .icon-item')
  if (!node) return
  const it = state.flat[Number(node.dataset.idx)]
  if (it) executeItem(it)
})

$('pill-close').addEventListener('click', outPlugin)

$('settings-btn').addEventListener('click', () => {
  if (state.mode === 'plugin') outPlugin()
  if (state.mode === 'settings') closeSettings()
  else openSettings()
})

settingsView.addEventListener('click', (e) => {
  // 点击设置页输入框时避免失焦隐藏
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    window.jtools.suppressBlur(800)
  }
})

/* ---------------- 启动 ---------------- */
async function boot() {
  updatePlaceholder()
  renderResults() // 占位（数据未到）

  const [apps, plugins, history, settings, pinned, searchPrefs] = await Promise.all([
    window.jtools.getApps(),
    window.jtools.getPlugins(),
    window.jtools.getHistory(),
    window.jtools.getSettings(),
    window.jtools.getPinned(),
    window.jtools.getSearchPrefs()
  ])
  state.apps = buildAppIndex(apps || [])
  // 应用 path → 图标 URL，供历史/固定项渲染时动态解析（旧条目存的 dataURL 可能已过期）
  state.appIconByPath = new Map((apps || []).map((a) => [a.path, a.icon || a.iconData || '']))
  state.plugins = plugins || []
  state.history = history || []
  state.pinned = pinned || []
  state.searchPrefs = searchPrefs || {}
  state.settings = settings || {}
  state.es = await window.jtools.getEsStatus()
  state.version = await window.jtools.getAppVersion()

  // 清理已失效的固定项（uwp 始终保留）
  try {
    const checks = await Promise.all(state.pinned.map((p) =>
      p.kind === 'file' || (p.kind === 'app' && !String(p.path).startsWith('uwp:'))
        ? window.jtools.pathExists(p.path)
        : Promise.resolve(true)))
    const valid = state.pinned.filter((_p, i) => checks[i])
    if (valid.length !== state.pinned.length) {
      state.pinned = valid
      window.jtools.savePinned(valid)
    }
  } catch { /* ignore */ }

  renderResults()
  input.focus()

  // 文件索引后台加载
  window.jtools.getFiles().then((f) => {
    state.files = buildFileIndex(f || [])
    if (state.mode === 'search' && input.value.trim()) renderResults()
  })

  window.jtools.onWindowShown(() => {
    closeCtxMenu()
    state.esResults = null
    state.esQuery = ''
    state.esType = ''
    if (state.mode === 'plugin') outPlugin()
    if (state.mode === 'settings') closeSettings()
    input.value = ''
    updatePlaceholder()
    renderResults()
    input.focus()
  })
  window.jtools.onOpenSettings(() => {
    if (state.mode === 'plugin') outPlugin()
    openSettings()
  })
}

boot()
