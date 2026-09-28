// 翻译服务：多引擎回退，主进程内请求（无 CORS、无广告、无 key 依赖）
const settingsStore = require('./settings')

function detectLang(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN'
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/.test(text)) return 'ko'
  if (/[\u0400-\u04ff]/.test(text)) return 'ru'
  return 'en'
}

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// ---------- Google gtx ----------
async function translateGoogle(text, from, to) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t' +
    `&sl=${encodeURIComponent(from || 'auto')}&tl=${encodeURIComponent(to)}&q=${encodeURIComponent(text)}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error('google http ' + res.status)
  const data = await res.json()
  const out = (data[0] || []).map((seg) => seg && seg[0]).join('')
  if (!out) throw new Error('google empty')
  return { text: out, detected: (data[2] || from || 'auto'), provider: 'google' }
}

// ---------- MyMemory ----------
const MM_LANG = { 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en-GB', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', ru: 'ru', es: 'es' }
async function translateMyMemory(text, from, to) {
  const src = from && from !== 'auto' ? from : detectLang(text)
  const pair = `${MM_LANG[src] || src}|${MM_LANG[to] || to}`
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(pair)}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error('mymemory http ' + res.status)
  const data = await res.json()
  const out = data && data.responseData && data.responseData.translatedText
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error('mymemory quota/empty')
  return { text: out, detected: src, provider: 'mymemory' }
}

// ---------- Baidu（可选，需用户自己的 appid/secret） ----------
function md5(input) {
  // 紧凑纯 JS MD5（RFC 1321）
  const rl = (n, c) => (n << c) | (n >>> (32 - c))
  const au = (x, y) => {
    const l = (x & 0xffff) + (y & 0xffff)
    return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff)
  }
  const cm = (q, a, b, x, s, t) => au(rl(au(au(a, q), au(x, t)), s), b)
  const ff = (a, b, c, d, x, s, t) => cm((b & c) | (~b & d), a, b, x, s, t)
  const gg = (a, b, c, d, x, s, t) => cm((b & d) | (c & ~d), a, b, x, s, t)
  const hh = (a, b, c, d, x, s, t) => cm(b ^ c ^ d, a, b, x, s, t)
  const ii = (a, b, c, d, x, s, t) => cm(c ^ (b | ~d), a, b, x, s, t)
  const cvt = (s) => {
    const utf8 = unescape(encodeURIComponent(s))
    const n = ((utf8.length + 8) >> 6) + 1
    const blks = new Array(n * 16).fill(0)
    for (let i = 0; i < utf8.length; i++) blks[i >> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8)
    blks[utf8.length >> 2] |= 0x80 << ((utf8.length % 4) * 8)
    blks[n * 16 - 2] = utf8.length * 8
    return blks
  }
  const hex = (num) => {
    let s = ''
    for (let j = 0; j < 4; j++) s += ((num >> (j * 8 + 4)) & 0xf).toString(16) + ((num >> (j * 8)) & 0xf).toString(16)
    return s
  }
  let [a, b, c, d] = [1732584193, -271733879, -1732584194, 271733878]
  const x = cvt(input)
  for (let i = 0; i < x.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d]
    a=ff(a,b,c,d,x[i],7,-680876936); d=ff(d,a,b,c,x[i+1],12,-389564586); c=ff(c,d,a,b,x[i+2],17,606105819); b=ff(b,c,d,a,x[i+3],22,-1044525330)
    a=ff(a,b,c,d,x[i+4],7,-176418897); d=ff(d,a,b,c,x[i+5],12,1200080426); c=ff(c,d,a,b,x[i+6],17,-1473231341); b=ff(b,c,d,a,x[i+7],22,-45705983)
    a=ff(a,b,c,d,x[i+8],7,1770035416); d=ff(d,a,b,c,x[i+9],12,-1958414417); c=ff(c,d,a,b,x[i+10],17,-42063); b=ff(b,c,d,a,x[i+11],22,-1990404162)
    a=ff(a,b,c,d,x[i+12],7,1804603682); d=ff(d,a,b,c,x[i+13],12,-40341101); c=ff(c,d,a,b,x[i+14],17,-1502002290); b=ff(b,c,d,a,x[i+15],22,1236535329)
    a=gg(a,b,c,d,x[i+1],5,-165796510); d=gg(d,a,b,c,x[i+6],9,-1069501632); c=gg(c,d,a,b,x[i+11],14,643717713); b=gg(b,c,d,a,x[i],20,-373897302)
    a=gg(a,b,c,d,x[i+5],5,-701558691); d=gg(d,a,b,c,x[i+10],9,38016083); c=gg(c,d,a,b,x[i+15],14,-660478335); b=gg(b,c,d,a,x[i+4],20,-405537848)
    a=gg(a,b,c,d,x[i+9],5,568446438); d=gg(d,a,b,c,x[i+14],9,-1019803690); c=gg(c,d,a,b,x[i+3],14,-187363961); b=gg(b,c,d,a,x[i+8],20,1163531501)
    a=gg(a,b,c,d,x[i+13],5,-1444681467); d=gg(d,a,b,c,x[i+2],9,-51403784); c=gg(c,d,a,b,x[i+7],14,1735328473); b=gg(b,c,d,a,x[i+12],20,-1926607734)
    a=hh(a,b,c,d,x[i+5],4,-378558); d=hh(d,a,b,c,x[i+8],11,-2022574463); c=hh(c,d,a,b,x[i+11],16,1839030562); b=hh(b,c,d,a,x[i+14],23,-35309556)
    a=hh(a,b,c,d,x[i+1],4,-1530992060); d=hh(d,a,b,c,x[i+4],11,1272893353); c=hh(c,d,a,b,x[i+7],16,-155497632); b=hh(b,c,d,a,x[i+10],23,-1094730640)
    a=hh(a,b,c,d,x[i+13],4,681279174); d=hh(d,a,b,c,x[i],11,-358537222); c=hh(c,d,a,b,x[i+3],16,-722521979); b=hh(b,c,d,a,x[i+6],23,76029189)
    a=hh(a,b,c,d,x[i+9],4,-640364487); d=hh(d,a,b,c,x[i+12],11,-421815835); c=hh(c,d,a,b,x[i+15],16,530742520); b=hh(b,c,d,a,x[i+2],23,-995338651)
    a=ii(a,b,c,d,x[i],6,-198630844); d=ii(d,a,b,c,x[i+7],10,1126891415); c=ii(c,d,a,b,x[i+14],15,-1416354905); b=ii(b,c,d,a,x[i+5],21,-57434055)
    a=ii(a,b,c,d,x[i+12],6,1700485571); d=ii(d,a,b,c,x[i+3],10,-1894986606); c=ii(c,d,a,b,x[i+10],15,-1051523); b=ii(b,c,d,a,x[i+1],21,-2054922799)
    a=ii(a,b,c,d,x[i+8],6,1873313359); d=ii(d,a,b,c,x[i+15],10,-30611744); c=ii(c,d,a,b,x[i+6],15,-1560198380); b=ii(b,c,d,a,x[i+13],21,1309151649)
    a=ii(a,b,c,d,x[i+4],6,-145523070); d=ii(d,a,b,c,x[i+11],10,-1120210379); c=ii(c,d,a,b,x[i+2],15,718787259); b=ii(b,c,d,a,x[i+9],21,-343485551)
    a = au(a, oa); b = au(b, ob); c = au(c, oc); d = au(d, od)
  }
  return hex(a) + hex(b) + hex(c) + hex(d)
}

const BAIDU_LANG = { 'zh-CN': 'zh', 'zh-TW': 'cht', en: 'en', ja: 'jp', ko: 'kor', fr: 'fra', de: 'de', ru: 'ru', es: 'spa' }
async function translateBaidu(text, from, to) {
  const s = settingsStore.get()
  if (!s.baiduAppid || !s.baiduSecret) throw new Error('baidu not configured')
  const salt = String(Date.now())
  const src = from && from !== 'auto' ? from : detectLang(text)
  const q = text.slice(0, 2000)
  const sign = md5(s.baiduAppid + q + salt + s.baiduSecret)
  const url =
    'https://fanyi-api.baidu.com/api/trans/vip/translate?' +
    `q=${encodeURIComponent(q)}&from=${BAIDU_LANG[src] || src}&to=${BAIDU_LANG[to] || to}&appid=${s.baiduAppid}&salt=${salt}&sign=${sign}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error('baidu http ' + res.status)
  const data = await res.json()
  if (data.error_code) throw new Error('baidu ' + data.error_code + ' ' + (data.error_msg || ''))
  const out = (data.trans_result || []).map((r) => r.dst).join('\n')
  if (!out) throw new Error('baidu empty')
  return { text: out, detected: src, provider: 'baidu' }
}

const PROVIDERS = { google: translateGoogle, mymemory: translateMyMemory, baidu: translateBaidu }

// 粘性引擎：记住上次成功的引擎，优先尝试；失败则其余引擎并行竞速
let sticky = ''

async function translate(text, { from = 'auto', to } = {}) {
  const s = settingsStore.get()
  const target = to || (detectLang(text) === 'zh-CN' ? 'en' : 'zh-CN')
  const order = (s.translateProviderOrder || ['google', 'mymemory', 'baidu']).filter(Boolean)

  if (sticky && order.includes(sticky) && PROVIDERS[sticky]) {
    try {
      const r = await PROVIDERS[sticky](text, from, target)
      return { ...r, target }
    } catch {
      sticky = ''
    }
  }
  // 其余引擎并行竞速：任一成功立即返回
  const names = order.filter((n) => PROVIDERS[n])
  return new Promise((resolve, reject) => {
    let failed = 0
    let settled = false
    for (const name of names) {
      PROVIDERS[name](text, from, target)
        .then((r) => {
          if (settled) return
          settled = true
          sticky = name
          resolve({ ...r, target })
        })
        .catch(() => {
          failed += 1
          if (failed === names.length && !settled) {
            settled = true
            reject(new Error('所有翻译引擎均失败'))
          }
        })
    }
  })
}

module.exports = { translate, detectLang }
