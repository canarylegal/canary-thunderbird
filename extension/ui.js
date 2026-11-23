/* global globalThis */
;(function () {
  const ext = globalThis.messenger || globalThis.browser
  function node(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n }
  function matter(el, row) { el.replaceChildren(node('strong', [row.case_number, row.client_name].filter(Boolean).join(' · ') || row.id), node('small', row.matter_description || '')) }
  function review(title, lines, action = 'Continue') {
    return new Promise(resolve => {
      const d = node('dialog'); d.append(node('h2', title)); for (const line of lines) d.append(node('p', line))
      const actions = node('div', null, 'actions'), cancel = node('button', 'Back', 'ghost'), yes = node('button', action, 'primary')
      cancel.onclick = () => d.close('cancel'); yes.onclick = () => d.close('yes'); actions.append(cancel, yes); d.append(actions); document.body.append(d)
      d.addEventListener('close', () => { const ok = d.returnValue === 'yes'; d.remove(); resolve(ok) }, { once: true }); d.showModal(); cancel.focus()
    })
  }
  function keyboardSearch(input, results) {
    input.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { const first = results.querySelector('button'); if (first) { e.preventDefault(); first.focus() } } })
    results.addEventListener('keydown', e => { const rows = Array.from(results.querySelectorAll('button')); const i = rows.indexOf(document.activeElement); if (i < 0) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus() }
      if (e.key === 'Escape') { e.preventDefault(); input.focus() }
    })
  }
  async function preview(caseId, fileId) {
    const sh = globalThis.canaryShared, auth = await sh.getStoredAuth(ext)
    const base = sh.apiRoot(auth.origin) + '/cases/' + encodeURIComponent(caseId) + '/files/' + encodeURIComponent(fileId)
    const res = await sh.secureFetch(base + '/metadata', { headers: sh.authHeaders(auth.jwt) }); if (!res.ok) throw new Error('Document details are unavailable. Check access and try again.')
    const f = await res.json(); if (!['clean', 'unscanned'].includes(f.scan_state)) throw new Error('This document cannot be opened until its security check passes.')
    const d = node('dialog'), close = node('button', 'Close', 'ghost'); d.append(node('h2', f.original_filename || 'Document'), node('p', f.folder_path || 'Matter root')); let url
    close.onclick = () => d.close(); d.append(close); document.body.append(d); d.addEventListener('close', () => { if (url) URL.revokeObjectURL(url); d.remove() }, { once: true }); d.showModal()
    const mime = String(f.mime_type || '').split(';')[0]
    if (!['application/pdf','image/png','image/jpeg','image/gif','image/webp','text/plain'].includes(mime)) { d.insertBefore(node('p', 'Inline preview is not available for this file type.'), close); return }
    try {
      const data = await sh.secureFetch(base, { headers: sh.authHeaders(auth.jwt) }); if (!data.ok) throw new Error('Document could not be opened. It may still be scanning or your access may have changed.')
      if (!d.isConnected) return
      const blob = await data.blob(); if (!d.isConnected) return
      if (mime === 'text/plain') d.insertBefore(node('pre', await blob.text()), close)
      else { url = URL.createObjectURL(new Blob([blob], { type: mime })); const view = node(mime === 'application/pdf' ? 'iframe' : 'img'); if (view.tagName === 'IFRAME') { view.setAttribute('sandbox', ''); view.title = f.original_filename || 'Document preview' } else view.alt = f.original_filename || 'Document'; view.src = url; d.insertBefore(view, close) }
    } catch (e) { if (d.isConnected) d.insertBefore(node('p', e.message), close) }
  }
  document.querySelectorAll('[data-activity]').forEach(b => b.addEventListener('click', () => { void ext.tabs.create({ url: ext.runtime.getURL('activity.html') }) }))
  globalThis.canaryUi = { node, matter, review, keyboardSearch, preview }
})()
