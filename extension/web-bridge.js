/* global browser, messenger */
'use strict'
/**
 * Bridge Canary web UI → Thunderbird background (open filed .eml in a message window).
 * The web app postMessages; we forward to the background script.
 */
;(async function () {
  const ext = typeof messenger !== 'undefined' ? messenger : typeof browser !== 'undefined' ? browser : null
  if (!ext || !ext.runtime || !ext.runtime.sendMessage) return

  if (location.protocol !== 'https:') return
  // Host permissions cover every port; constrain both injection paths to the saved origin.
  try {
    const saved = await ext.storage.local.get('canaryApiOrigin')
    if (new URL(saved.canaryApiOrigin).origin !== location.origin) return
  } catch (_) { return }
  // Dynamic registration and existing-tab recovery may race or run repeatedly.
  if (globalThis.__canaryWebBridgeInstalled) return
  globalThis.__canaryWebBridgeInstalled = true

  function reply(requestId, payload) {
    window.postMessage(
      Object.assign({ type: 'canary-tb-open-eml-result', requestId: requestId }, payload || {}),
      '*',
    )
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return
    const data = ev.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'canary-tb-bridge-ping') {
      window.postMessage({ type: 'canary-tb-bridge-ready', version: 1 }, '*')
      return
    }
    if (data.type !== 'canary-tb-open-eml') return
    const requestId = data.requestId
    const url = data.url
    if (!requestId || !url || typeof url !== 'string') {
      reply(requestId, { ok: false, detail: 'Missing url.' })
      return
    }
    // Only allow Canary API open-token URLs (avoid turning the bridge into an open fetch proxy).
    if (!/\/files\/[^/]+\/eml-open\?/i.test(url) || !/[?&]token=/.test(url)) {
      reply(requestId, { ok: false, detail: 'Unsupported open URL.' })
      return
    }
    try {
      const u = new URL(url, location.href)
      if (u.protocol !== 'https:' || u.origin !== location.origin || u.username || u.password) {
        reply(requestId, { ok: false, detail: 'Unsupported URL scheme.' })
        return
      }
    } catch (_) {
      reply(requestId, { ok: false, detail: 'Invalid URL.' })
      return
    }
    void ext.runtime
      .sendMessage({
        type: 'canary-open-eml-url',
        url: url,
        filename: typeof data.filename === 'string' ? data.filename : 'message.eml',
      })
      .then(function (resp) {
        reply(requestId, resp && typeof resp === 'object' ? resp : { ok: false, detail: 'No response' })
      })
      .catch(function (e) {
        reply(requestId, { ok: false, detail: (e && e.message) || String(e) })
      })
  })

  window.postMessage({ type: 'canary-tb-bridge-ready', version: 1 }, '*')
})()
