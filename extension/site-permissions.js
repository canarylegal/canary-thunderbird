/* global browser, messenger */
'use strict'
;(function () {
  const ext = globalThis.canaryShared.getGecko()
  let registration = null
  let queue = Promise.resolve()
  async function refresh() {
    if (registration) { await registration.unregister(); registration = null }
    const stored = await ext.storage.local.get('canaryApiOrigin')
    const origin = stored.canaryApiOrigin
    if (!origin) return
    const sh = globalThis.canaryShared
    const matches = [sh.sitePermission(origin)]
    if (!await ext.permissions.contains({ origins: matches })) return
    registration = await ext.contentScripts.register({ matches, js: [{ file: 'web-bridge.js' }], runAt: 'document_idle', allFrames: false })
    // Registration covers future loads; reconcile documents already open at startup/grant.
    for (const tab of await ext.tabs.query({})) {
      try {
        if (!tab.url || new URL(tab.url).origin !== sh.normalizeOrigin(origin)) continue
        const current = await ext.storage.local.get('canaryApiOrigin')
        if (current.canaryApiOrigin !== origin || !await ext.permissions.contains({ origins: matches })) return
        const live = await ext.tabs.get(tab.id)
        if (!live.url || new URL(live.url).origin !== sh.normalizeOrigin(origin)) continue
        await ext.tabs.executeScript(tab.id, { file: 'web-bridge.js', allFrames: false, runAt: 'document_idle' })
      } catch (e) {
        // Closed/navigating/restricted tabs must not prevent recovery in other tabs.
        console.debug('Canary bridge tab unavailable:', e.message)
      }
    }
  }
  function schedule() { queue = queue.then(refresh).catch(e => console.warn('Canary site access:', e.message)) }
  ext.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.canaryApiOrigin) schedule()
  })
  ext.permissions.onAdded.addListener(schedule)
  ext.permissions.onRemoved.addListener(schedule)
  schedule()
})()
