/* global messenger, browser */
'use strict'
;(function () {
  const sh = () => globalThis.canaryShared
  const cs = () => globalThis.canaryComposeStore
  const attachUi = () => globalThis.canaryComposeAttachUi

  let composeTabId = null
  let allCases = []
  let caseFiles = []
  let caseContacts = []
  let precedents = []
  let selectedCase = null
  let caseLoadGeneration = 0
  let caseLoading = false
  let attachBrowseFolder = ''
  let selectedAttachIds = []
  /** User changed Matter dropdown; do not overwrite from background prefill/store sync. */
  let userMatterModeDirty = false
  /** @type {{ kind: 'none'|'all_clients'|'matter', matterId?: string, label?: string }} */
  let recipientPick = { kind: 'none' }
  /** Reply/forward — do not change To or enable recipient picker. */
  let isReplyCompose = false

  function sendRuntimeMessage(ext, payload) {
    return new Promise(function (resolve) {
      if (!ext.runtime || !ext.runtime.sendMessage) {
        resolve({ ok: false, detail: 'Runtime messaging not available.' })
        return
      }
      ext.runtime.sendMessage(payload, function (resp) {
        if (ext.runtime.lastError) {
          resolve({ ok: false, detail: String(ext.runtime.lastError.message) })
          return
        }
        resolve(resp || { ok: false })
      })
    })
  }

  function $(id) {
    return document.getElementById(id)
  }

  function out(text, isErr) {
    const el = $('out')
    if (!el) return
    el.className = isErr ? 'err' : text ? 'ok' : ''
    el.textContent = text || ''
  }

  function composeTabIdFromUrl() {
    try {
      const params = new URLSearchParams(String(globalThis.location.search || ''))
      const tid = params.get('composeTabId')
      if (tid == null || String(tid).trim() === '') return null
      const n = Number(tid)
      return Number.isFinite(n) ? n : tid
    } catch (_) {
      return null
    }
  }

  async function resolveComposeTabId(ext) {
    const fromUrl = composeTabIdFromUrl()
    if (fromUrl != null) return fromUrl
    const panelTab = await sh().getComposePanelTabId(ext)
    if (panelTab != null) {
      if (ext.compose && typeof ext.compose.getComposeDetails === 'function') {
        try {
          await ext.compose.getComposeDetails(panelTab)
          return panelTab
        } catch (_) {
          /* stale session tab id */
        }
      } else {
        return panelTab
      }
    }
    if (ext.tabs && typeof ext.tabs.getCurrent === 'function') {
      try {
        const cur = await ext.tabs.getCurrent()
        if (cur && cur.id != null && ext.compose && typeof ext.compose.getComposeDetails === 'function') {
          try {
            await ext.compose.getComposeDetails(cur.id)
            return cur.id
          } catch (_) {
            /* not a compose tab */
          }
        }
      } catch (_) {
        /* ignore */
      }
    }
    let id = await cs().getActiveComposeTab(ext)
    if (id != null) return id
    if (ext.tabs && ext.tabs.query) {
      try {
        const composeTabs = await ext.tabs.query({ type: 'messageCompose' })
        if (composeTabs && composeTabs.length) {
          let pick = null
          for (let i = 0; i < composeTabs.length; i++) {
            if (composeTabs[i].active) {
              pick = composeTabs[i]
              break
            }
          }
          if (!pick) pick = composeTabs[composeTabs.length - 1]
          if (pick && pick.id != null) return pick.id
        }
      } catch (_) {
        /* ignore */
      }
    }
    return null
  }

  async function loadAuth(ext) {
    const { jwt, origin } = await sh().getStoredAuth(ext)
    if (!jwt || !origin) throw new Error('Sign in via Canary toolbar (Server & sign-in).')
    return { jwt, origin }
  }

  function authErrorHint(err) {
    const msg = err && err.message ? String(err.message) : ''
    if (sh().isAuthSessionErrorMessage(msg)) {
      return 'Session expired or the Canary site changed — open Server & sign-in on the toolbar and sign in again.'
    }
    return msg || 'Request failed.'
  }

  async function apiGet(ext, jwt, origin, path) {
    const res = await globalThis.canaryShared.secureFetch(sh().apiRoot(origin) + path, { headers: sh().authHeaders(jwt) })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = body && body.detail
      const msg = typeof detail === 'string' ? detail : 'Request failed (' + res.status + ')'
      if (res.status === 401 && sh().isAuthSessionErrorMessage(msg)) {
        await sh().clearStoredJwt(ext)
      }
      throw new Error(msg)
    }
    return body
  }

  function appendRowLabel(row, icon, label, checked) {
    const glyph = document.createElement('span')
    glyph.className = 'tb-row-icon'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = icon
    const text = document.createElement('span')
    text.className = 'tb-row-label'
    text.textContent = label
    row.append(glyph, text)
    if (checked) {
      const tick = document.createElement('span')
      tick.className = 'tb-row-check'
      tick.setAttribute('aria-hidden', 'true')
      tick.textContent = '✓'
      row.append(tick)
    }
  }

  function renderCaseResults() {
    const box = $('case-results')
    const input = $('case-search')
    if (!box || !input) return
    const q = String(input.value || '').trim().toLowerCase()
    box.replaceChildren()
    if (!q) {
      box.hidden = true
      return
    }
    const matches = allCases.filter((c) => sh().matterLabel(c).toLowerCase().includes(q))
    if (!matches.length) {
      box.textContent = 'No matches.'
      box.hidden = false
      return
    }
    for (const c of matches.slice(0, 40)) {
      const id = String(c.id)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'case-result-row' + (selectedCase && String(selectedCase.id) === id ? ' is-selected' : '')
      globalThis.canaryUi.matter(btn, c)
      btn.onclick = () => {
        void selectCase(c).catch(e => out(authErrorHint(e), true))
      }
      box.appendChild(btn)
    }
    box.hidden = false
  }

  function contactLabel(cc) {
    const parts = [cc.name || 'Contact']
    if (cc.email) parts.push(cc.email)
    if (cc.matter_contact_reference) parts.push('Ref: ' + cc.matter_contact_reference)
    return parts.join(' — ')
  }

  function setRecipientPick(pick) {
    recipientPick = pick
    const el = $('recipient-selected')
    if (!el) return
    if (pick.kind === 'none') {
      el.textContent = 'Recipient: none (fill To yourself)'
    } else if (pick.kind === 'all_clients') {
      el.textContent = 'Recipient: all clients (merge fields only)'
    } else {
      el.textContent = 'Recipient: ' + (pick.label || pick.kind)
    }
    const box = $('recipient-pick')
    if (box) {
      box.querySelectorAll('[data-recipient]').forEach((btn) => {
        btn.classList.remove('is-selected')
      })
      if (pick.kind === 'none' || pick.kind === 'all_clients') {
        const b = box.querySelector('[data-recipient="' + pick.kind + '"]')
        if (b) b.classList.add('is-selected')
      } else if (pick.kind === 'matter' && pick.matterId) {
        const b = box.querySelector('[data-recipient="matter:' + pick.matterId + '"]')
        if (b) b.classList.add('is-selected')
      }
    }
  }

  function renderRecipientPick() {
    const box = $('recipient-pick')
    if (!box) return
    box.replaceChildren()
    const noneBtn = document.createElement('button')
    noneBtn.type = 'button'
    noneBtn.className = 'case-result-row'
    noneBtn.dataset.recipient = 'none'
    noneBtn.textContent = 'None'
    noneBtn.onclick = () => {
      setRecipientPick({ kind: 'none' })
      void persistState(sh().getGecko())
    }
    box.appendChild(noneBtn)

    const allBtn = document.createElement('button')
    allBtn.type = 'button'
    allBtn.className = 'case-result-row'
    allBtn.dataset.recipient = 'all_clients'
    allBtn.textContent = 'All clients (merge only)'
    allBtn.onclick = () => {
      setRecipientPick({ kind: 'all_clients' })
      void persistState(sh().getGecko())
    }
    box.appendChild(allBtn)

    if (!caseContacts.length) {
      const hint = document.createElement('div')
      hint.className = 'muted'
      hint.style.padding = '6px'
      hint.textContent = 'No matter contacts on this case — add contacts in Canary first.'
      box.appendChild(hint)
    }
    for (const cc of caseContacts) {
      const id = String(cc.id)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'case-result-row'
      btn.dataset.recipient = 'matter:' + id
      btn.textContent = contactLabel(cc)
      btn.onclick = () => {
        setRecipientPick({ kind: 'matter', matterId: id, label: contactLabel(cc) })
        void persistState(sh().getGecko())
      }
      box.appendChild(btn)
    }
    setRecipientPick(recipientPick)
  }

  function fillFolderSelect() {
    const sel = $('folder')
    const ui = attachUi()
    if (!sel || !ui) return
    const prev = sel.value
    sel.replaceChildren()
    const o0 = document.createElement('option')
    o0.value = ''
    o0.textContent = 'None (matter root)'
    sel.appendChild(o0)
    for (const path of ui.collectAllFolderPaths(caseFiles)) {
      const o = document.createElement('option')
      o.value = path
      o.textContent = path
      sel.appendChild(o)
    }
    if (prev && Array.from(sel.options).some(function (o) {
      return o.value === prev
    })) {
      sel.value = prev
    }
  }

  function updateAttachSummary() {
    const section = $('attach-section')
    const summary = $('attach-selected-summary')
    const btn = $('btn-attach-from-file')
    if (!selectedCase) {
      if (section) section.hidden = true
      return
    }
    if (section) section.hidden = false
    if (btn) btn.disabled = false
    if (!summary) return
    const n = selectedAttachIds.length
    if (n === 0) {
      summary.textContent = 'No Canary documents selected.'
      return
    }
    const names = []
    for (let i = 0; i < selectedAttachIds.length && names.length < 4; i++) {
      const id = selectedAttachIds[i]
      const f = caseFiles.find(function (x) {
        return String(x.id) === String(id)
      })
      names.push(f && f.original_filename ? f.original_filename : id)
    }
    let text = n + ' file' + (n === 1 ? '' : 's') + ' selected'
    if (names.length) text += ': ' + names.join(', ')
    if (n > names.length) text += '…'
    summary.textContent = text
  }

  function setAttachPickerVisible(show) {
    const view = $('attach-picker-view')
    const wrap = document.querySelector('.wrap')
    if (!view) {
      out('Attach picker UI missing — reload the Canary add-on.', true)
      return
    }
    view.hidden = !show
    if (wrap) wrap.hidden = !!show
  }

  function updateAttachPickerFooter() {
    const line = $('attach-selection-line')
    const btn = $('btn-attach-confirm')
    const n = selectedAttachIds.length
    const max = (attachUi() && attachUi().MAX_ATTACH) || 25
    if (line) {
      line.textContent =
        n === 0
          ? 'Click files to select (up to ' + max + ').'
          : n + ' file' + (n === 1 ? '' : 's') + ' selected'
    }
    if (btn) { btn.disabled = n === 0; btn.textContent = n ? 'Attach ' + n + (n === 1 ? ' file' : ' files') : 'Attach to message' }
  }

  function toggleAttachFile(id) {
    const sid = String(id)
    const f = caseFiles.find(x => String(x.id) === sid)
    if (!f || (f.scan_state && !['clean','unscanned'].includes(f.scan_state))) return
    const max = (attachUi() && attachUi().MAX_ATTACH) || 25
    const idx = selectedAttachIds.indexOf(sid)
    if (idx >= 0) {
      selectedAttachIds = selectedAttachIds.filter(function (x) {
        return x !== sid
      })
    } else {
      if (selectedAttachIds.length >= max) {
        out('At most ' + max + ' attachments.', true)
        return
      }
      selectedAttachIds = selectedAttachIds.concat([sid])
    }
    updateAttachPickerFooter()
    renderInlineAttachPicker()
  }

  function renderInlineAttachPicker() {
    const root = $('attach-picker-root')
    const ui = attachUi()
    if (!root || !ui) return
    root.replaceChildren()

    const crumbs = document.createElement('div')
    crumbs.className = 'attach-crumbs'
    const home = document.createElement('button')
    home.type = 'button'
    home.className = 'attach-crumb'
    home.textContent = 'All files'
    home.onclick = function () {
      attachBrowseFolder = ''
      renderInlineAttachPicker()
    }
    crumbs.appendChild(home)
    const parts = String(attachBrowseFolder || '')
      .split('/')
      .filter(Boolean)
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      const sep = document.createElement('span')
      sep.className = 'attach-crumb-sep'
      sep.textContent = ' / '
      crumbs.appendChild(sep)
      acc = acc ? acc + '/' + parts[i] : parts[i]
      const seg = acc
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'attach-crumb'
      btn.textContent = ui.decodeFolderSegment(parts[i])
      btn.onclick = function () {
        attachBrowseFolder = seg
        renderInlineAttachPicker()
      }
      crumbs.appendChild(btn)
    }
    root.appendChild(crumbs)

    const query = $('attach-search').value.trim().toLowerCase()
    const folders = query ? [] : ui.childFolders(caseFiles, attachBrowseFolder)
    let docs = query ? ui.allAttachableFiles(caseFiles).filter(f => String(f.original_filename || '').toLowerCase().includes(query)) : ui.filesInBrowseFolder(caseFiles, attachBrowseFolder)
    if (!query && !folders.length && !docs.length && attachBrowseFolder === '') {
      docs = ui.allAttachableFiles(caseFiles)
    }
    if (!folders.length && !docs.length) {
      const empty = document.createElement('div')
      empty.className = 'attach-picker-empty muted'
      empty.textContent = 'No attachable files in this matter.'
      root.appendChild(empty)
      return
    }
    for (let i = 0; i < folders.length; i++) {
      const name = folders[i]
      const next = attachBrowseFolder ? attachBrowseFolder + '/' + name : name
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'tb-list-row tb-list-row--folder'
      appendRowLabel(row, '📁', ui.decodeFolderSegment(name))
      row.onclick = function () {
        attachBrowseFolder = next
        renderInlineAttachPicker()
      }
      root.appendChild(row)
    }
    for (let j = 0; j < docs.length; j++) {
      const f = docs[j]
      const id = String(f.id)
      const row = globalThis.canaryUi.node('div', null, 'tb-list-row tb-list-row--file')
      const available = !f.scan_state || ['clean','unscanned'].includes(f.scan_state)
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selectedAttachIds.includes(id); cb.disabled = !available; cb.setAttribute('aria-label', f.original_filename || id)
      cb.onchange = () => toggleAttachFile(id)
      const text = globalThis.canaryUi.node('span', f.original_filename || id)
      text.append(globalThis.canaryUi.node('small', available ? ((f.mime_type || 'Document') + (f.size_bytes ? ' · ' + (f.size_bytes / 1024).toFixed(0) + ' KB' : '')) : f.scan_state === 'blocked' ? 'Blocked by security scan' : 'Security check pending — cannot attach yet', 'file-meta'))
      row.append(cb, text)
      if (available) { const preview = globalThis.canaryUi.node('button', 'Preview', 'link'); preview.onclick = () => { void globalThis.canaryUi.preview(String(selectedCase.id), id).catch(e => { $('attach-status').textContent = e.message }) }; row.append(preview) }
      root.appendChild(row)
    }
  }

  async function openAttachPickerInline() {
    if (!selectedCase) {
      out('Select a matter first.', true)
      return
    }
    if (!attachUi()) {
      out('Attach UI failed to load. Reload the Canary add-on.', true)
      return
    }
    try {
      const auth = await loadAuth(sh().getGecko())
      const latest = await apiGet(sh().getGecko(), auth.jwt, auth.origin, '/cases/' + encodeURIComponent(selectedCase.id) + '/files')
      caseFiles = latest
      selectedAttachIds = selectedAttachIds.filter(id => latest.some(f => String(f.id) === id && (!f.scan_state || ['clean','unscanned'].includes(f.scan_state))))
      $('attach-retry').hidden = true
    } catch (e) { setAttachPickerVisible(true); $('attach-picker-root').replaceChildren(); $('attach-status').textContent = 'Could not load documents. Your selections have been kept. ' + authErrorHint(e); $('attach-retry').hidden = false; return }
    const line = $('attach-matter-line')
    if (line) {
      line.textContent =
        caseFiles.length === 0
          ? 'No files in this matter'
          : caseFiles.length + ' file' + (caseFiles.length === 1 ? '' : 's') + ' in matter'
    }
    $('attach-search').value = ''
    $('attach-status').textContent = ''
    attachBrowseFolder = ''
    updateAttachPickerFooter()
    renderInlineAttachPicker()
    setAttachPickerVisible(true)
    out('', false)
  }

  async function confirmInlineAttach() {
    if (!selectedCase || composeTabId == null || !selectedAttachIds.length) return
    const btn = $('btn-attach-confirm')
    if (btn) btn.disabled = true
    const ext = sh().getGecko()
    try {
      await persistState(ext)
      const r = await sendRuntimeMessage(ext, {
        type: 'canary-apply-compose-attachments',
        composeTabId: composeTabId,
        caseId: String(selectedCase.id),
      })
      if (!r || !r.ok) {
        throw new Error((r && r.detail) || 'Could not attach files to the message.')
      }
      setAttachPickerVisible(false)
      updateAttachSummary()
      out('Attached ' + selectedAttachIds.length + ' file(s) from Canary.', false)
    } catch (e) {
      $('attach-status').textContent = (e && e.message) || String(e)
      if (btn) btn.disabled = selectedAttachIds.length === 0
    }
  }

  async function loadAttachSelectionFromStore(ext) {
    if (composeTabId == null) {
      selectedAttachIds = []
      return
    }
    const st = await cs().getTabState(ext, composeTabId)
    selectedAttachIds = (st && st.attachmentFileIds) || []
  }

  async function selectCase(c) {
    const generation = ++caseLoadGeneration
    caseLoading = true
    $('btn-apply').disabled = true
    userMatterModeDirty = true
    const changed = selectedCase && String(selectedCase.id) !== String(c.id)
    selectedCase = c
    if (changed) { selectedAttachIds = []; recipientPick = { kind: 'none' }; await cs().setTabState(sh().getGecko(), composeTabId, { attachmentFileIds: [], caseContactId: null, precedentId: null, folder: '' }) }
    attachBrowseFolder = ''
    const sel = $('case-selected')
    if (sel) { sel.hidden = false; globalThis.canaryUi.matter(sel, c) }
    $('compose-change-matter').hidden = false
    $('case-search').closest('label').hidden = true
    $('case-results').hidden = true
    if ($('matter-mode')) $('matter-mode').value = 'pick'
    updateMatterPickVisibility()
    const ext = sh().getGecko()
    const { jwt, origin } = await loadAuth(ext)
    const nextFiles = await apiGet(ext, jwt, origin, '/cases/' + encodeURIComponent(c.id) + '/files')
    const nextContacts = await apiGet(ext, jwt, origin, '/cases/' + encodeURIComponent(c.id) + '/contacts')
    let nextPrecedents
    if (c.matter_sub_type_id) {
      nextPrecedents = await apiGet(
        ext,
        jwt,
        origin,
        '/precedents?kind=email&matter_sub_type_id=' + encodeURIComponent(c.matter_sub_type_id),
      )
    } else {
      nextPrecedents = await apiGet(ext, jwt, origin, '/precedents?kind=email')
    }
    if (generation !== caseLoadGeneration) return
    caseLoading = false
    caseFiles = nextFiles; caseContacts = nextContacts; precedents = nextPrecedents
    $('btn-apply').disabled = false
    fillMatterFields()
    fillFolderSelect()
    renderRecipientPick()
    await loadAttachSelectionFromStore(ext)
    updateMatterPickVisibility()
    updateAttachSummary()
    await persistState(ext)
  }

  function fillMatterFields() {
    const prec = $('precedent')
    if (prec) {
      prec.replaceChildren(new Option('None', ''))
      for (const p of precedents) {
        const o = document.createElement('option')
        o.value = String(p.id)
        o.textContent = p.name || p.reference || p.id
        prec.appendChild(o)
      }
    }
  }

  function readFormState() {
    const mode = ($('matter-mode') && $('matter-mode').value) || 'none'
    let caseContactId = null
    let mergeAll = false
    if (recipientPick.kind === 'all_clients') mergeAll = true
    else if (recipientPick.kind === 'matter' && recipientPick.matterId) caseContactId = recipientPick.matterId
    return {
      caseId: mode === 'pick' && selectedCase ? String(selectedCase.id) : null,
      folder: ($('folder') && $('folder').value) || '',
      parentFileId: null,
      precedentId: ($('precedent') && $('precedent').value) || null,
      caseContactId,
      globalContactId: null,
      mergeAllClients: mergeAll,
      attachmentFileIds: selectedAttachIds.slice(),
      fileOnSend: $('file-on-send').checked, bodyMode: $('body-mode').value, updateRecipient: $('update-recipient').checked,
    }
  }

  /** Merge background prefill (tab store) with visible form — prefill often sets caseId before selectedCase exists. */
  async function readFormStateFromStore(ext) {
    const base = readFormState()
    if (composeTabId == null) return base
    const st = await cs().getTabState(ext, composeTabId)
    const mode = ($('matter-mode') && $('matter-mode').value) || 'none'
    if (mode === 'pick' && st.caseId && !base.caseId) {
      base.caseId = String(st.caseId)
    }
    if (st.parentFileId) base.parentFileId = st.parentFileId
    if (!selectedCase && !base.attachmentFileIds.length && st.attachmentFileIds && st.attachmentFileIds.length) {
      base.attachmentFileIds = st.attachmentFileIds
    }
    return base
  }

  async function persistState(ext) {
    if (composeTabId == null) return
    const ui = readFormState()
    const prev = await cs().getTabState(ext, composeTabId)
    const mode = ($('matter-mode') && $('matter-mode').value) || 'none'
    const patch = {
      folder: ui.folder,
      precedentId: ui.precedentId,
      caseContactId: ui.caseContactId,
      globalContactId: null,
      mergeAllClients: ui.mergeAllClients,
      attachmentFileIds: ui.attachmentFileIds, fileOnSend: ui.fileOnSend, bodyMode: ui.bodyMode, updateRecipient: ui.updateRecipient,
    }
    if (mode === 'none') {
      patch.caseId = null
      patch.parentFileId = null
      patch.userOverridden = true
      patch.prefilledFromReply = false
    } else if (ui.caseId) {
      patch.caseId = ui.caseId
      patch.userOverridden = false
      patch.prefilledFromReply = false
      patch.prefilledFromPending = false
    } else if (prev.caseId) {
      patch.caseId = prev.caseId
      patch.parentFileId = prev.parentFileId
      patch.userOverridden = false
    }
    await cs().setTabState(ext, composeTabId, patch)
  }

  function caseObjectFromStore(st) {
    if (!st || !st.caseId) return null
    const found = allCases.find((x) => String(x.id) === String(st.caseId))
    if (found) return found
    return {
      id: st.caseId,
      case_number: st.prefilledCaseNumber || '',
      client_name: st.prefilledClientName || '',
      matter_description: st.prefilledMatterTitle || '',
    }
  }

  async function maybeAutoApplyFromStore() {
    /* Reply prefill disabled — user must click Apply to message after choosing a matter. */
  }

  function updatePrefillHint(st) {
    const hint = $('prefill-hint')
    const statusEl = $('prefill-status')
    const s = st && st.prefillStatus ? String(st.prefillStatus) : ''
    const isReplyHint = s === 'reply-manual' || s.indexOf('waiting-type') === 0
    if (hint) hint.hidden = !isReplyHint
    if (!statusEl) return
    if (s === 'not-signed-in') {
      statusEl.hidden = false
      statusEl.textContent =
        'Sign in via Canary toolbar (Server & sign-in) to file this message to a matter.'
    } else if (s === 'pending-send' && st && st.caseId) {
      statusEl.hidden = false
      const label = sh().matterLabel({
        case_number: st.prefilledCaseNumber,
        client_name: st.prefilledClientName,
        matter_description: st.prefilledMatterTitle,
      })
      statusEl.textContent = 'Matter from Canary: ' + label + '. Attachments and Apply are ready.'
    } else if (s.indexOf('waiting-type') === 0) {
      statusEl.hidden = false
      statusEl.textContent = 'Waiting for Thunderbird to finish opening the reply…'
    } else if (s === 'reply-manual') {
      statusEl.hidden = true
      statusEl.textContent = ''
    } else if (s.indexOf('not-reply') === 0) {
      statusEl.hidden = true
      statusEl.textContent = ''
    } else if (s) {
      statusEl.hidden = true
      statusEl.textContent = ''
    } else {
      statusEl.hidden = true
      statusEl.textContent = ''
    }
  }

  function updateMatterPickVisibility() {
    const mode = ($('matter-mode') && $('matter-mode').value) || 'none'
    const pick = $('matter-pick')
    const fields = $('matter-fields')
    if (pick) pick.hidden = mode !== 'pick'
    if (fields) fields.hidden = mode !== 'pick' || !selectedCase
    $('btn-apply').disabled = mode === 'pick' && (!selectedCase || caseLoading)
    $('matter-mode').closest('label').hidden = !!selectedCase
    if (!selectedCase) { $('case-selected').hidden = true; $('compose-change-matter').hidden = true; $('case-search').closest('label').hidden = false }
  }

  async function clearMatterBecauseUserChoseNone() {
    selectedCase = null
    attachBrowseFolder = ''
    selectedAttachIds = []
    recipientPick = { kind: 'none' }
    const section = $('attach-section')
    if (section) section.hidden = true
    updatePrefillHint(null)
    updateMatterPickVisibility()
    const ext = sh().getGecko()
    if (composeTabId == null) return
    try {
      const { jwt, origin } = await loadAuth(ext)
      await sh().syncPendingSend(jwt, origin, null, null)
      await cs().setTabState(
        ext,
        composeTabId,
        Object.assign(cs().blankState(), { userOverridden: true }),
      )
    } catch (_) {
      await cs().setTabState(ext, composeTabId, Object.assign(cs().blankState(), { userOverridden: true }))
    }
  }

  async function applyCaseFromStore(ext, st) {
    const c = caseObjectFromStore(st)
    if (c) await selectCase(c)
    await cs().setTabState(ext, composeTabId, {
      parentFileId: st.parentFileId,
      folder: st.folder || '',
      prefilledFromReply: st.prefilledFromReply,
      prefilledFromPending: st.prefilledFromPending,
      mergeAllClients: st.mergeAllClients,
      userOverridden: false,
    })
    if ($('folder')) {
      fillFolderSelect()
      $('folder').value = st.folder || ''
    }
    if ($('precedent') && st.precedentId) $('precedent').value = st.precedentId
    if (st.mergeAllClients || st.composeAutoApplied || st.prefilledFromReply) {
      setRecipientPick({ kind: 'all_clients' })
    } else if (st.caseContactId) {
      const cc = caseContacts.find((x) => String(x.id) === String(st.caseContactId))
      setRecipientPick({
        kind: 'matter',
        matterId: st.caseContactId,
        label: cc ? contactLabel(cc) : st.caseContactId,
      })
    } else {
      setRecipientPick({ kind: 'none' })
    }
    renderRecipientPick()
    selectedAttachIds = (st && st.attachmentFileIds) || []
    updateAttachSummary()
    await maybeAutoApplyFromStore(ext)
  }

  function shouldApplyStoredMatter(st) {
    if (!st || !st.caseId || st.userOverridden) return false
    return !!(st.prefilledFromPending || st.prefilledFromReply || st.composeAutoApplied)
  }

  async function detectReplyCompose(ext) {
    if (composeTabId == null || !ext.compose || typeof ext.compose.getComposeDetails !== 'function') {
      return false
    }
    try {
      const details = await ext.compose.getComposeDetails(composeTabId)
      const t = details && details.type ? String(details.type).toLowerCase() : ''
      if (t === 'new' || t === 'draft') return false
      return (
        t === 'reply' ||
        t === 'forward' ||
        t.indexOf('reply') >= 0 ||
        t.indexOf('forward') >= 0
      )
    } catch (_) {
      return false
    }
  }

  function updateComposeKindUi() {
    const section = $('recipient-section')
    if (section) section.classList.remove('is-disabled')
    const replyNote = $('recipient-reply-note')
    const newNote = $('recipient-new-note')
    if (replyNote) replyNote.hidden = !isReplyCompose
    if (newNote) newNote.hidden = isReplyCompose
  }

  async function closeComposePanelAfterDone(ext) {
    await sh().closeExtensionWindow(ext)
  }

  async function ensureNewComposeDefaults(ext) {
    if (composeTabId == null || !ext.compose || typeof ext.compose.getComposeDetails !== 'function') {
      return
    }
    try {
      const details = await ext.compose.getComposeDetails(composeTabId)
      const t = details && details.type ? String(details.type).toLowerCase() : ''
      if (t !== 'new' && t !== 'draft') return
      const st = await cs().getTabState(ext, composeTabId)
      // Keep Canary→mailto pending matter; do not wipe UI before restoreState applies it.
      if (st && st.caseId && st.prefilledFromPending && !st.userOverridden) {
        userMatterModeDirty = false
        if ($('matter-mode')) $('matter-mode').value = 'pick'
        return
      }
      userMatterModeDirty = false
      selectedCase = null
      if ($('matter-mode')) $('matter-mode').value = 'pick'
      const search = $('case-search')
      if (search) search.value = ''
      const box = $('case-results')
      if (box) {
        box.hidden = true
        box.replaceChildren()
      }
      updateMatterPickVisibility()
      updatePrefillHint(null)
    } catch (_) {
      /* ignore */
    }
  }

  async function restoreState(ext, options) {
    if (composeTabId == null) return
    const st = await cs().getTabState(ext, composeTabId)
    $('file-on-send').checked = st.fileOnSend !== false
    $('body-mode').value = st.bodyMode || 'append'
    $('update-recipient').checked = !isReplyCompose && !!st.updateRecipient
    updatePrefillHint(st)
    selectedAttachIds = (st && st.attachmentFileIds) || []

    const modeEl = $('matter-mode')

    if (!userMatterModeDirty && modeEl) {
      if (st.userOverridden) {
        modeEl.value = 'none'
      } else if (shouldApplyStoredMatter(st)) {
        modeEl.value = 'pick'
      } else {
        modeEl.value = 'pick'
      }
      updateMatterPickVisibility()
    }

    const uiMode = modeEl ? modeEl.value : 'pick'

    if (uiMode === 'none') {
      selectedCase = null
      updateMatterPickVisibility()
      updateAttachSummary()
      return
    }

    if (uiMode === 'pick' && shouldApplyStoredMatter(st)) {
      await applyCaseFromStore(ext, st)
      return
    }

    const restoreFromStore =
      options && options.fromStorage && st.caseId && !st.userOverridden && !userMatterModeDirty
    if (uiMode === 'pick' && restoreFromStore && !selectedCase) {
      await applyCaseFromStore(ext, st)
      return
    }

    if (uiMode === 'pick' && selectedCase) {
      updateMatterPickVisibility()
      updateAttachSummary()
      return
    }

    if (uiMode === 'pick') {
      const search = $('case-search')
      const keepSearch =
        search &&
        (document.activeElement === search ||
          userMatterModeDirty ||
          String(search.value || '').trim().length > 0)
      if (search && !keepSearch) search.value = ''
      renderCaseResults()
      updateMatterPickVisibility()
    }
    updateAttachSummary()
  }

  async function updateSetupButtonVisibility(ext) {
    const btn = $('btn-setup')
    if (!btn) return
    try {
      const { jwt, origin } = await sh().getStoredAuth(ext)
      btn.hidden = !!(jwt && origin)
    } catch (_) {
      btn.hidden = false
    }
  }

  async function applyAttachmentsFromCanary(ext) {
    if (composeTabId == null || !globalThis.canaryApplyComposeAttachments) return
    const form = await readFormStateFromStore(ext)
    if (!form.caseId || !form.attachmentFileIds || !form.attachmentFileIds.length) return
    try {
      const { jwt, origin } = await loadAuth(ext)
      const body = {
        folder: form.folder || '',
        precedent_id: form.precedentId || null,
        case_contact_id: form.caseContactId || null,
        global_contact_id: null,
        precedent_merge_all_clients: form.mergeAllClients,
        attachment_file_ids: form.attachmentFileIds,
      }
      const bundle = await globalThis.canaryShared.secureFetch(
        sh().apiRoot(origin) + '/mail-plugin/cases/' + encodeURIComponent(form.caseId) + '/compose-bundle',
        { method: 'POST', headers: sh().jsonAuthHeaders(jwt), body: JSON.stringify(body) },
      ).then(async function (res) {
        const data = await res.json().catch(function () {
          return null
        })
        if (!res.ok) {
          const detail = data && data.detail
          throw new Error(typeof detail === 'string' ? detail : 'Compose bundle failed')
        }
        return data
      })
      await globalThis.canaryApplyComposeAttachments(ext, composeTabId, bundle)
      out('Attached ' + form.attachmentFileIds.length + ' file(s) from Canary.', false)
    } catch (e) {
      out(authErrorHint(e), true)
    }
  }

  function startPrefillSync() {
    /* Automatic reply prefill disabled — no background sync of matter selection. */
  }

  function onMatterModeChange() {
    userMatterModeDirty = true
    const mode = ($('matter-mode') && $('matter-mode').value) || 'none'
    updateMatterPickVisibility()
    void (async function () {
      const ext = sh().getGecko()
      if (mode === 'none') {
        await clearMatterBecauseUserChoseNone()
        out('Matter set to none — sent mail will not be filed.', false)
        return
      }
      const search = $('case-search')
      if (search) {
        search.value = ''
        search.focus()
      }
      renderCaseResults()
      if (!allCases.length) {
        out('No matters loaded — sign in via Server & sign-in.', true)
      } else {
        out('', false)
      }
    })()
  }

  async function main() {
    const ext = sh().getGecko()
    if (!ext) {
      out('Extension APIs not available.', true)
      return
    }
    sh().wirePopoutCloseButton('btn-close')
    composeTabId = await resolveComposeTabId(ext)
    if (composeTabId != null) await cs().setActiveComposeTab(ext, composeTabId)
    isReplyCompose = await detectReplyCompose(ext)
    $('update-recipient').disabled = isReplyCompose
    $('attach-search').addEventListener('input', renderInlineAttachPicker)
    $('attach-retry').onclick = () => { void openAttachPickerInline() }
    globalThis.canaryUi.keyboardSearch($('case-search'), $('case-results'))
    $('compose-change-matter').onclick = () => { $('case-search').closest('label').hidden = false; $('case-search').focus() }
    for (const id of ['file-on-send','body-mode','update-recipient']) $(id).addEventListener('change', () => { void persistState(ext) })
    updateComposeKindUi()

    try {
      const { jwt, origin } = await loadAuth(ext)
      allCases = await apiGet(ext, jwt, origin, '/cases')
      out('', false)
      await updateSetupButtonVisibility(ext)
    } catch (e) {
      out(authErrorHint(e), true)
      await updateSetupButtonVisibility(ext)
    }

    function withExt(fn) {
      return function () {
        void fn(sh().getGecko())
      }
    }
    $('matter-mode').addEventListener('change', onMatterModeChange)
    $('case-search').addEventListener('input', function () {
      userMatterModeDirty = true
      renderCaseResults()
    })
    ;['folder', 'precedent'].forEach((id) => {
      const el = $(id)
      if (el) el.addEventListener('change', withExt(persistState))
    })

    $('btn-setup').addEventListener('click', () => {
      void ext.runtime.sendMessage({ type: 'canary-open-connection-settings' }).then(r => { if (r && r.ok) globalThis.close() })
    })

    const btnAttach = $('btn-attach-from-file')
    if (btnAttach && !btnAttach.dataset.canaryAttachBound) {
      btnAttach.dataset.canaryAttachBound = '1'
      btnAttach.addEventListener('click', function (ev) {
        if (ev) {
          ev.preventDefault()
          ev.stopPropagation()
        }
        void openAttachPickerInline()
      })
    }
    const btnAttachCancel = $('btn-attach-cancel')
    if (btnAttachCancel && !btnAttachCancel.dataset.canaryAttachBound) {
      btnAttachCancel.dataset.canaryAttachBound = '1'
      btnAttachCancel.addEventListener('click', function () {
        setAttachPickerVisible(false)
        updateAttachSummary()
      })
    }
    const btnAttachConfirm = $('btn-attach-confirm')
    if (btnAttachConfirm && !btnAttachConfirm.dataset.canaryAttachBound) {
      btnAttachConfirm.dataset.canaryAttachBound = '1'
      btnAttachConfirm.addEventListener('click', function (ev) {
        if (ev) {
          ev.preventDefault()
          ev.stopPropagation()
        }
        void confirmInlineAttach()
      })
    }

    $('btn-apply').addEventListener('click', () => {
      void (async function () {
        out('Preparing review…', false)
        $('btn-apply').disabled = true
        try {
          if (composeTabId == null) throw new Error('No compose tab found. Click in the message body, then reopen Canary.')
          const { jwt, origin } = await loadAuth(ext)
          const form = await readFormStateFromStore(ext)
          if (!form.caseId) {
            if (!await globalThis.canaryUi.review('Filing preference', ['This email will not be filed on send. Your draft remains unchanged.'], 'Save preference')) return
            await sh().syncPendingSend(jwt, origin, null, null)
            out('Matter set to none — sent mail will not be filed.', false)
            await closeComposePanelAfterDone(ext)
            return
          }
          const body = {
            folder: form.folder,
            precedent_id: form.precedentId || null,
            case_contact_id: form.caseContactId || null,
            global_contact_id: null,
            precedent_merge_all_clients: form.mergeAllClients,
            attachment_file_ids: form.attachmentFileIds,
          }
          const bundle = await globalThis.canaryShared.secureFetch(
            sh().apiRoot(origin) + '/mail-plugin/cases/' + encodeURIComponent(form.caseId) + '/compose-bundle',
            { method: 'POST', headers: sh().jsonAuthHeaders(jwt), body: JSON.stringify(body) },
          ).then(async (res) => {
            const data = await res.json().catch(() => null)
            if (!res.ok) {
              const detail = data && data.detail
              throw new Error(typeof detail === 'string' ? detail : 'Compose bundle failed')
            }
            return data
          })
          const before = await ext.compose.getComposeDetails(composeTabId)
          const lines = [
            'Matter: ' + sh().matterLabel(selectedCase || { id: form.caseId }),
            'Recipients: ' + (isReplyCompose || !form.updateRecipient ? 'Keep current recipients' : (bundle.to || 'Keep current recipients')),
            'Subject: Keep current subject',
            'Body: ' + (!form.precedentId ? 'No changes' : form.bodyMode === 'replace' ? 'REPLACE your existing draft with the selected precedent' : 'Insert precedent below your existing draft'),
            'Attachments: ' + ((bundle.attachments || []).map(a => a.filename).join(', ') || 'No additions'),
            'On send: ' + (form.fileOnSend ? 'File to selected matter / ' + (form.folder || 'Matter root') : 'Do not file'),
            'This updates your draft. It does not send the email.',
          ]
          if (!await globalThis.canaryUi.review('Review draft changes', lines, 'Apply to draft')) { out('No changes applied.', false); return }
          const current = await ext.compose.getComposeDetails(composeTabId)
          if (['subject','body','plainTextBody','to','cc','bcc'].some(k => JSON.stringify(before[k]) !== JSON.stringify(current[k]))) throw new Error('Your draft changed while reviewing. Review the latest draft again.')
          await globalThis.canaryApplyComposeBundle(ext, composeTabId, bundle, {
            skipTo: isReplyCompose || !form.updateRecipient, preserveSubject: true,
            bodyMode: form.precedentId ? form.bodyMode : 'none',
          })
          await cs().setTabState(ext, composeTabId, {
            caseId: form.caseId,
            folder: form.folder,
            parentFileId: null,
            precedentId: form.precedentId,
            caseContactId: isReplyCompose ? null : form.caseContactId,
            mergeAllClients: form.mergeAllClients,
            attachmentFileIds: form.attachmentFileIds,
            composeAutoApplied: true, fileOnSend: form.fileOnSend,
          })
          await sh().syncPendingSend(jwt, origin, form.fileOnSend ? form.caseId : null, null)
          out(form.fileOnSend ? 'Draft updated. Your sent email will file to the selected matter.' : 'Draft updated. This email will not be filed on send.', false)
        } catch (e) {
          out(authErrorHint(e), true)
        } finally {
          $('btn-apply').disabled = false
        }
      })()
    })

    globalThis.addEventListener('focus', function () {
      void (async function () {
        if (composeTabId != null) {
          const st = await cs().getTabState(ext, composeTabId)
          selectedAttachIds = (st && st.attachmentFileIds) || []
          updateAttachSummary()
          if (!userMatterModeDirty && !selectedCase) {
            await restoreState(ext, { fromStorage: true })
          }
        }
      })()
    })

    if (ext.storage && ext.storage.onChanged) {
      ext.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return
        if (changes.canary_jwt || changes.canaryApiOrigin) {
          void updateSetupButtonVisibility(ext)
        }
        if (!changes.canary_compose_tab_state || composeTabId == null) return
        void (async function () {
          const st = await cs().getTabState(ext, composeTabId)
          if (userMatterModeDirty || (selectedCase && st.caseId && String(selectedCase.id) === String(st.caseId))) {
            await loadAttachSelectionFromStore(ext)
            updateAttachSummary()
            return
          }
          await restoreState(ext, { fromStorage: true })
        })()
      })
    }

    await ensureNewComposeDefaults(ext)
    await restoreState(ext, { fromStorage: true })
    startPrefillSync()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main)
  } else {
    main()
  }
})()
