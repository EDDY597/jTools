/* 快速翻译插件 */
'use strict'

const fromSel = document.getElementById('from')
const toSel = document.getElementById('to')
const swapBtn = document.getElementById('swap')
const resultEl = document.getElementById('result')
const detectedEl = document.getElementById('detected')
const providerEl = document.getElementById('provider')
const btnCopy = document.getElementById('btn-copy')
const btnOut = document.getElementById('btn-out')

const LANG_NAME = {
  auto: '自动', 'zh-CN': '中文', zh: '中文', en: '英语', ja: '日语', ko: '韩语',
  fr: '法语', de: '德语', ru: '俄语', es: '西语', 'en-GB': '英语'
}

let lastText = ''
let lastResultText = ''
let debounceTimer = null
let seq = 0

function scheduleTranslate(text) {
  clearTimeout(debounceTimer)
  if (!text.trim()) {
    lastResultText = ''
    resultEl.textContent = '输入文本即时翻译，中英自动互译'
    resultEl.className = ''
    detectedEl.textContent = ''
    providerEl.textContent = ''
    return
  }
  resultEl.textContent = '翻译中…'
  resultEl.className = 'loading'
  debounceTimer = setTimeout(() => doTranslate(text), 250)
}

async function doTranslate(text) {
  const mySeq = ++seq
  try {
    const r = await window.ztool.translate(text, { from: fromSel.value, to: toSel.value })
    if (mySeq !== seq) return // 已被更新的输入取代
    resultEl.textContent = r.text
    resultEl.className = ''
    lastResultText = r.text
    providerEl.textContent = r.provider === 'google' ? 'Google'
      : r.provider === 'mymemory' ? 'MyMemory' : '百度翻译'
    detectedEl.textContent = r.detected && LANG_NAME[r.detected]
      ? '检测到 ' + LANG_NAME[r.detected] : ''
  } catch (e) {
    if (mySeq !== seq) return
    resultEl.textContent = '翻译失败：' + e.message + '\n请检查网络，或在 设置→翻译 中更换引擎 / 配置百度 API。'
    resultEl.className = 'error'
    providerEl.textContent = ''
  }
}

fromSel.addEventListener('change', () => scheduleTranslate(lastTextFromInput()))
toSel.addEventListener('change', () => scheduleTranslate(lastTextFromInput()))

swapBtn.addEventListener('click', () => {
  const f = fromSel.value
  fromSel.value = toSel.value
  toSel.value = f === 'auto' ? 'en' : f
  scheduleTranslate(lastTextFromInput())
})

btnCopy.addEventListener('click', () => {
  if (lastResultText) window.ztool.copyText(lastResultText)
})
btnOut.addEventListener('click', () => window.ztool.outPlugin())

// 记录最近一次子输入内容（语言切换/交换时复翻）
let _lastSub = ''
function lastTextFromInput() {
  return _lastSub
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    window.ztool.esc()
  }
})

window.ztool
  .setSubInput('输入要翻译的文本…')
  .setHeight(430)

window.ztool.onInit((data) => {
  const payload = (data.payload || '').trim()
  _lastSub = payload
  if (payload) scheduleTranslate(payload)
})

window.ztool.onSubInput((value) => {
  _lastSub = value
  scheduleTranslate(value)
})
