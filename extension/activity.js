;(function () {
  const ext = globalThis.messenger || globalThis.browser, ui = globalThis.canaryUi, list = document.getElementById('activity-list'), status = document.getElementById('activity-status')
  const labels = { filed:'Filed — sent copy unavailable for tagging', uploading:'Uploading email', pending:'Security check pending', retry:'Waiting to check again', tagging:'Filed — tag needs attention', clean:'Filed — Canary tag applied', blocked:'Upload blocked', failed:'Upload failed', unavailable:'Document no longer accessible', expired:'Tracking expired', missing:'Original email is no longer available' }
  let busy = false, last = ''
  async function refresh() {
    if (busy) return; busy = true
    try {
      const r = await ext.runtime.sendMessage({ type:'canary-file-activity' }); if (!r || !r.ok) throw new Error(r && r.detail || 'Activity unavailable. Sign in to Canary and try again.')
      const signature = JSON.stringify(r.rows); if (signature === last) return; last = signature; list.replaceChildren()
      status.textContent = r.rows.length ? 'Activity updated.' : 'No recent uploads for this account.'
      for (const row of r.rows) {
        const card = ui.node('article', null, 'activity-row'); card.dataset.state = row.state
        card.append(ui.node('strong', row.subject || 'Email'), ui.node('h3', labels[row.state] || 'Checking status'), ui.node('small', (row.matterLabel || 'Matter filing') + ' · ' + new Date(row.created).toLocaleString()))
        const steps = ui.node('ol'); for (const text of ['Upload: ' + (row.state === 'uploading' ? 'in progress' : row.state === 'failed' ? 'failed' : 'received'), 'Security scan: ' + (['clean','tagging','filed'].includes(row.state) ? 'passed' : row.state === 'blocked' ? 'blocked' : 'not yet confirmed'), 'Canary tag: ' + (row.state === 'clean' ? 'applied' : row.state === 'tagging' ? 'retrying' : 'not applied')]) steps.append(ui.node('li', text)); card.append(steps)
        if (['pending','uploading','retry'].includes(row.state)) card.append(ui.node('p', 'You can close this page. Checks continue in Thunderbird.', 'muted'))
        if (row.state === 'filed') card.append(ui.node('p', 'Canary has the email, but Thunderbird did not provide a sent-message ID to tag.', 'muted'))
        if (row.state === 'blocked') card.append(ui.node('p', 'The email or an attachment was flagged. Ask the sender for a safe replacement or contact your administrator.', 'muted'))
        if (['clean','tagging','filed'].includes(row.state)) { const view = ui.node('button','View document','ghost'); view.onclick = () => { void ui.preview(row.caseId,row.fileId).catch(e => { status.textContent = e.message }) }; card.append(view) }
        list.append(card)
      }
    } catch (e) { list.replaceChildren(); last = ''; status.textContent = e.message } finally { busy = false }
  }
  document.getElementById('activity-refresh').onclick = refresh
  ext.storage.onChanged.addListener(() => { void refresh() }); setInterval(() => { if (!document.hidden) void refresh() }, 3000); void refresh()
})()
