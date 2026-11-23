/* global globalThis */
'use strict'
// Background-owned uploads and scan completion. No document content is downloaded by polling.
;(function () {
  const ext = globalThis.messenger || globalThis.browser
  if (!ext) return
  const sh = globalThis.canaryShared
  const KEY = 'canary_pending_file_tags_v1'
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000
  let edits = Promise.resolve()
  let polling = false
  const uploads = new Map()
  function edit(fn) {
    const next = edits.then(async () => {
      const stored = await ext.storage.local.get(KEY)
      const rows = Array.isArray(stored[KEY]) ? stored[KEY] : []
      const before = JSON.stringify(rows)
      const result = await fn(rows)
      if (JSON.stringify(rows) !== before) await ext.storage.local.set({ [KEY]: rows })
      return result
    })
    edits = next.catch(() => {})
    return next
  }
  async function binding(auth) {
    if (!auth.jwt || !auth.origin) return null
    // This only scopes local work; the server still authenticates every metadata request.
    const payload = JSON.parse(atob(auth.jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Invalid sign-in identity.')
    const bytes = new TextEncoder().encode(auth.origin + '\n' + payload.sub)
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
  }
  function identity(header) {
    return JSON.stringify([header.headerMessageId || '', header.subject || '',
      header.date ? new Date(header.date).toISOString() : '', header.size || 0,
      header.folder && header.folder.accountId || ''])
  }
  async function remove(key) {
    await edit(rows => { const i = rows.findIndex(r => r.key === key); if (i !== -1) rows.splice(i, 1) })
  }
  async function tick() {
    if (polling) return
    polling = true
    try {
      const auth = await sh.getStoredAuth(ext)
      const bound = auth.jwt && auth.origin ? await binding(auth) : null
      const rows = await edit(rows => {
        for (let i = rows.length - 1; i >= 0; i--) if (Date.now() - rows[i].created > MAX_AGE) rows.splice(i, 1)
        return rows.slice()
      })
      for (const row of rows) {
        if (row.binding !== bound || row.next > Date.now()) continue
        // Save backoff first: crashes and failures cannot cause a tight retry loop.
        await edit(items => { const item = items.find(r => r.key === row.key); if (item) {
          item.attempts = (item.attempts || 0) + 1
          item.next = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(item.attempts - 1, 5))
        } })
        if (await binding(await sh.getStoredAuth(ext)) !== row.binding) continue
        const controller = new AbortController()
        try {
          const result = await sh.connectionStep((async () => {
            const response = await sh.secureFetch(sh.apiRoot(auth.origin) + '/cases/' + encodeURIComponent(row.caseId) + '/files/' + encodeURIComponent(row.fileId) + '/metadata', {
              headers: { Authorization: 'Bearer ' + auth.jwt }, cache: 'no-store', signal: controller.signal,
            })
            return { status: response.status, ok: response.ok, body: response.ok ? await response.json() : null }
          })(), 'Checking uploaded email', controller.signal, 10000)
          if ([403, 404, 410].includes(result.status)) { await remove(row.key); continue }
          if (!result.ok) continue
          const file = result.body
          if (!file || String(file.id) !== row.fileId) continue
          if (file.scan_state === 'blocked') { await remove(row.key); continue }
          if (!['clean', 'unscanned'].includes(file.scan_state)) continue
          // Recheck auth after the request: never finish another user's/site's queue.
          if (await binding(await sh.getStoredAuth(ext)) !== row.binding) continue
          const header = await sh.resolveMessageHeaderForLookup(ext, row.messageId)
          if (!header) { await remove(row.key); continue }
          if (identity(header) !== row.identity) { await remove(row.key); continue }
          const applied = await globalThis.canaryRunApplyFiledTag(row.messageId, { strict: true })
          if (!applied || !applied.ok) continue
          await sh.recordFiledTbMessage(ext, row.messageId, row.caseId, row.fileId, header.headerMessageId)
          await remove(row.key)
        } catch (_) { /* Offline, expired login, temporary scan or tag failure: retry with backoff. */ }
        finally { controller.abort() }
      }
    } finally { polling = false }
  }
  async function upload(message) {
    const auth = await sh.getStoredAuth(ext)
    if (!auth.jwt || !auth.origin || auth.origin !== message.origin) throw new Error('Connection changed. Reconnect before filing.')
    if (!Number.isInteger(message.messageId) || message.messageId < 1 || !message.caseId) throw new Error('Missing message or matter.')
    const key = await binding(auth) + ':' + message.caseId + ':' + message.messageId
    if (uploads.has(key)) return uploads.get(key)
    const task = (async () => {
      const filed = await sh.fileTbMessageById(ext, auth.jwt, auth.origin, message.caseId, message.messageId, {
        filename: message.filename, deferCompletion: true,
      })
      if (!filed.fileId) throw new Error('Upload returned no file ID.')
      if (filed.scanState !== 'blocked') {
        await edit(rows => {
          rows.push({ key: key + ':' + filed.fileId, binding: key.slice(0, 64),
            caseId: String(message.caseId), fileId: String(filed.fileId), messageId: message.messageId,
            identity: identity(filed.header), created: Date.now(), next: 0, attempts: 0 })
        })
        void tick().catch(() => {})
      }
      return { ok: true, filed: { fileId: filed.fileId, scanState: filed.scanState === 'blocked' ? 'blocked' : 'pending' } }
    })().finally(() => uploads.delete(key))
    uploads.set(key, task)
    return task
  }
  ext.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message && message.type === 'canary-file-message-background') {
      upload(message).then(respond, e => respond({ ok: false, detail: e.message }))
      return true
    }
  })
  globalThis.canaryPendingFileTags = { tick }
  setInterval(() => { void tick().catch(() => {}) }, 2000)
  void tick().catch(() => {})
})()
