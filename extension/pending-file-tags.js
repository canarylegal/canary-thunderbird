/* global globalThis */
'use strict'
// Background-owned uploads and scan completion. No document content is downloaded by polling.
;(function () {
  const ext = globalThis.messenger || globalThis.browser
  if (!ext) return
  const sh = globalThis.canaryShared
  const KEY = 'canary_pending_file_tags_v1'
  const HISTORY = 'canary_file_activity_v1'
  let historyEdits = Promise.resolve()
  function history(row, state) {
    const task = historyEdits.then(async () => {
      const stored = await ext.storage.local.get(HISTORY)
      const rows = Array.isArray(stored[HISTORY]) ? stored[HISTORY] : []
      const old = rows.find(x => x.key === (row.activityKey || row.key))
      const item = Object.assign({}, old || {}, { key: row.activityKey || row.key, binding: row.binding, caseId: row.caseId, fileId: row.fileId || (old && old.fileId), subject: row.subject || (old && old.subject) || 'Email', matterLabel: row.matterLabel || (old && old.matterLabel) || '', created: row.created || (old && old.created) || Date.now(), state })
      const next = [item, ...rows.filter(x => x.key !== item.key && Date.now() - x.created < 7 * 86400000)].slice(0, 100)
      await ext.storage.local.set({ [HISTORY]: next })
    })
    historyEdits = task.catch(() => {}); return task
  }
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
          if ([403, 404, 410].includes(result.status)) { await history(row, 'unavailable'); await remove(row.key); continue }
          if (!result.ok) { await history(row, 'retry'); continue }
          const file = result.body
          if (!file || String(file.id) !== row.fileId) continue
          if (file.scan_state === 'blocked') { await history(row, 'blocked'); await remove(row.key); continue }
          if (!['clean', 'unscanned'].includes(file.scan_state)) { await history(row, file.scan_state === 'error' ? 'retry' : 'pending'); continue }
          // Recheck auth after the request: never finish another user's/site's queue.
          if (await binding(await sh.getStoredAuth(ext)) !== row.binding) continue
          if (row.messageId == null) { await history(row, 'filed'); await remove(row.key); continue }
          const header = await sh.resolveMessageHeaderForLookup(ext, row.messageId)
          if (!header) { await history(row, 'missing'); await remove(row.key); continue }
          if (identity(header) !== row.identity) { await history(row, 'missing'); await remove(row.key); continue }
          const applied = await globalThis.canaryRunApplyFiledTag(row.messageId, { strict: true })
          if (!applied || !applied.ok) { await history(row, 'tagging'); continue }
          await sh.recordFiledTbMessage(ext, row.messageId, row.caseId, row.fileId, header.headerMessageId)
          await history(row, 'clean')
          await remove(row.key)
        } catch (_) { await history(row, 'retry'); /* Offline, expired login, temporary scan or tag failure: retry with backoff. */ }
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
    const activity = { key: key + ':' + Date.now(), binding: key.slice(0,64), caseId: String(message.caseId), subject: message.filename || 'Email', matterLabel: message.matterLabel || '', created: Date.now() }
    const task = (async () => {
      await history(activity, 'uploading')
      const filed = await sh.fileTbMessageById(ext, auth.jwt, auth.origin, message.caseId, message.messageId, {
        filename: message.filename, folder: message.folder || '', deferCompletion: true,
      })
      if (!filed.fileId) throw new Error('Upload returned no file ID.')
      activity.fileId = String(filed.fileId)
      await history(activity, filed.scanState === 'blocked' ? 'blocked' : 'pending')
      if (filed.scanState !== 'blocked') {
        await edit(rows => {
          rows.push({ activityKey: activity.key, subject: activity.subject, matterLabel: activity.matterLabel, key: key + ':' + filed.fileId, binding: key.slice(0, 64),
            caseId: String(message.caseId), fileId: String(filed.fileId), messageId: message.messageId,
            identity: identity(filed.header), created: Date.now(), next: 0, attempts: 0 })
        })
        void tick().catch(() => {})
      }
      return { ok: true, filed: { fileId: filed.fileId, scanState: filed.scanState === 'blocked' ? 'blocked' : 'pending' } }
    })().catch(async e => { await history(activity, 'failed'); throw e }).finally(() => uploads.delete(key))
    uploads.set(key, task)
    return task
  }
  ext.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message && message.type === 'canary-file-activity') {
      void (async () => {
        const bound = await binding(await sh.getStoredAuth(ext))
        if (!bound) throw new Error('Sign in to see activity for your account.')
        await historyEdits
        const stored = await ext.storage.local.get(HISTORY)
        if (await binding(await sh.getStoredAuth(ext)) !== bound) throw new Error('Connection changed. Refresh activity.')
        return { ok: true, rows: (stored[HISTORY] || []).filter(r => r.binding === bound && Date.now() - r.created < MAX_AGE).map(({binding, ...r}) => r) }
      })().then(respond, e => respond({ ok: false, detail: e.message }))
      return true
    }
    if (message && message.type === 'canary-file-message-background') {
      upload(message).then(respond, e => respond({ ok: false, detail: e.message }))
      return true
    }
  })
  async function trackSent(auth, caseId, header, uploaded, subject, matterLabel) {
    const bound = await binding(auth)
    if (!bound || bound !== await binding(await sh.getStoredAuth(ext))) throw new Error('Connection changed during filing. Reconnect to check the result.')
    if (!uploaded || !uploaded.id) throw new Error('Upload returned no file ID.')
    const row = { key: bound + ':sent:' + uploaded.id, binding: bound, caseId: String(caseId), fileId: String(uploaded.id), messageId: header ? header.id : null, identity: header ? identity(header) : '', subject, matterLabel: matterLabel || '', created: Date.now(), next: 0, attempts: 0 }
    await history(row, uploaded.scan_state === 'blocked' ? 'blocked' : 'pending')
    if (uploaded.scan_state !== 'blocked') { await edit(rows => { if (!rows.some(x => x.key === row.key)) rows.push(row) }); void tick().catch(() => {}) }
  }
  globalThis.canaryPendingFileTags = { tick, trackSent }
  setInterval(() => { void tick().catch(() => {}) }, 2000)
  void tick().catch(() => {})
})()
