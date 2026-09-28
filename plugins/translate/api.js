/* 插件宿主桥：通过 postMessage 与父页面（jTools 壳）通信 */
;(function () {
  'use strict'
  let seq = 0
  const pending = new Map()
  const initListeners = []
  const subInputListeners = []
  let initialized = false

  window.addEventListener('message', (ev) => {
    const data = ev.data || {}
    if (ev.source !== window.parent) return
    switch (data.type) {
      case 'init':
        initialized = true
        initListeners.forEach((cb) => cb(data))
        break
      case 'subinput':
        subInputListeners.forEach((cb) => cb(data.value || ''))
        break
      case 'request-reply':
      case 'translate-reply': {
        const p = pending.get(data.id)
        if (p) {
          pending.delete(data.id)
          if (data.res && data.res.error) p.reject(new Error(data.res.error))
          else p.resolve(data.res)
        }
        break
      }
    }
  })

  function post(msg) {
    window.parent.postMessage(msg, '*')
  }

  function call(msgType, payload) {
    const id = ++seq
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      post({ type: msgType, id, ...payload })
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error('timeout'))
        }
      }, 30000)
    })
  }

  window.ztool = {
    ready() {
      post({ type: 'ztool-ready' })
      return this
    },
    onInit(cb) {
      initListeners.push(cb)
      return this
    },
    onSubInput(cb) {
      subInputListeners.push(cb)
      return this
    },
    setSubInput(placeholder) {
      post({ type: 'set-subinput', placeholder })
      return this
    },
    setHeight(h) {
      post({ type: 'set-height', height: h })
      return this
    },
    outPlugin() {
      post({ type: 'out-plugin' })
      return this
    },
    copyText(text) {
      post({ type: 'copy-text', text })
      return this
    },
    esc() {
      post({ type: 'esc' })
      return this
    },
    translate(text, opts) {
      return call('translate', { text, opts: opts || {} })
    },
    request(req) {
      return call('request', { req })
    }
  }

  window.ztool.ready()
})()
