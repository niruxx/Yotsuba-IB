import { esc, fmtDate } from './format.js';
import { can } from './db.js';
import { page } from './adminViews.js';

const KIND_LABEL = { keyword: 'Keyword match', blocked: 'Blocked post', report: 'User report', appeal: 'Ban appeal' };

export function alertsPage(a, rows, status, msg) {
  const showIp = can(a, 'view_logs');
  return page(a, 'Alerts', msg, `
<p class="filters">
  ${status === 'open' ? '<strong>Open</strong>' : '<a href="/admin/alerts">Open</a>'} ·
  ${status === 'resolved' ? '<strong>Resolved</strong>' : '<a href="/admin/alerts?status=resolved">Resolved</a>'}
  ${status === 'open' && rows.length ? `· <form class="inline" method="post" action="/admin/alerts-resolve-all"
      onsubmit="return confirm('Mark all open alerts as resolved?')"><button class="linkbtn">resolve all</button></form>` : ''}
  · <button type="button" class="linkbtn" id="enable-desktop">enable desktop notifications</button>
</p>
<div class="alerts">
${rows.map((r) => `<div class="alert kind-${esc(r.kind)}">
  <div class="alerthead">
    <strong>${KIND_LABEL[r.kind] || esc(r.kind)}</strong> · #${r.id} · ${fmtDate(r.created)}
    ${r.kind === 'appeal' ? '· <a href="/admin/bans">handle on the Bans page</a>' : r.post_id ? (r.live ? `· <a href="/${esc(r.board)}/post/${r.post_id}">/${esc(r.board)}/ No.${r.post_id}</a>` : `· /${esc(r.board)}/ No.${r.post_id} <small>(deleted)</small>`) : `· /${esc(r.board || '?')}/ <small>(post was not created)</small>`}
    ${showIp && r.ip ? `· IP <a href="/admin/logs?ip=${encodeURIComponent(r.ip)}">${esc(r.ip)}</a>` : ''}
    ${r.handled_by ? `· handled by ${esc(r.handled_by)} ${fmtDate(r.handled_at)}` : ''}
  </div>
  <div class="alertdetail">${r.kind === 'report' ? 'Reason: ' : 'Matched: '}${esc(r.detail)}</div>
  <blockquote>${esc(r.excerpt)}</blockquote>
  <form method="post" action="/admin/alerts/${r.id}" class="inline">
    ${status === 'open' ? '<button name="action" value="resolve">Resolve</button>' : '<button name="action" value="reopen">Reopen</button>'}
    ${r.live && can(a, 'delete_posts') ? `<button name="action" value="delete_post" class="danger" onclick="return confirm('Delete post ${r.post_id}?')">Delete post &amp; resolve</button>` : ''}
  </form>
  ${r.post_id && can(a, 'manage_bans') ? `<a href="/admin/bans?post=${r.post_id}">Ban poster…</a>` : ''}
</div>`).join('') || `<p class="empty">No ${status} alerts.</p>`}
</div>
<script>
document.getElementById('enable-desktop').onclick = () => Notification.requestPermission();
</script>`);
}

export function filtersPage(a, rows, msg) {
  return page(a, 'Keyword rules', msg, `<section class="box">
  <h2>Add rule</h2>
  <p><small>Rules are checked against the name, subject and comment of every new post (not case-sensitive).
  <strong>Alert</strong> lets the post through and notifies staff in real time. <strong>Block</strong> rejects the post and notifies staff.</small></p>
  <form method="post" action="/admin/filters">
    <label>Word, sentence or pattern <input name="pattern" required maxlength="300"></label>
    <label class="check"><input type="checkbox" name="is_regex"> Treat as a regular expression</label>
    <label>Action <select name="action"><option value="alert">Alert staff</option><option value="block">Block post + alert staff</option></select></label>
    <label>Note (optional) <input name="note" maxlength="200" placeholder="why this rule exists"></label>
    <button>Add rule</button>
  </form>
</section>
<table class="grid">
<tr><th>Pattern</th><th>Type</th><th>Action</th><th>Note</th><th>Added</th><th></th></tr>
${rows.map((f) => `<tr><td class="content">${esc(f.pattern)}</td><td>${f.is_regex ? 'regex' : 'text'}</td>
  <td>${f.action === 'block' ? '<strong class="danger">block</strong>' : 'alert'}</td><td>${esc(f.note)}</td>
  <td>${esc(f.created_by)}<br><small>${fmtDate(f.created)}</small></td>
  <td><form method="post" action="/admin/filters"><button name="delete" value="${f.id}" class="linkbtn danger">remove</button></form></td></tr>`).join('')
  || '<tr><td colspan="6"><em>No rules yet.</em></td></tr>'}
</table>`);
}

function banRow(b, active) {
  return `<tr><td>#${b.id}</td><td>${esc(b.kind)}</td><td>${esc(b.value)}</td>
  <td>${b.scope === 'access' ? '<strong>site access</strong>' : 'posting'}</td>
  <td class="content">${esc(b.reason)}${b.post_id ? `<br><small>post No.${b.post_id}</small>` : ''}</td>
  <td>${esc(b.created_by)}<br><small>${fmtDate(b.created)}</small></td>
  <td>${b.expires ? fmtDate(b.expires) : 'never'}${b.lifted ? '<br><small>lifted</small>' : ''}</td>
  <td>${active ? `<form method="post" action="/admin/bans/${b.id}/lift"><button class="linkbtn">lift</button></form>` : ''}</td></tr>`;
}

export function bansPage(a, { active, past, fileBans, appeals, prefill, geoSource, durations }, msg) {
  const head = '<tr><th>ID</th><th>Type</th><th>Value</th><th>Blocks</th><th>Reason</th><th>By</th><th>Expires (UTC)</th><th></th></tr>';
  return page(a, 'Bans', msg, `${appeals.length ? `<section class="box">
  <h2>Open appeals (${appeals.length})</h2>
  ${appeals.map((ap) => `<div class="account">
    <p><strong>Ban #${ap.ban_id}</strong>: ${esc(ap.kind)} ${esc(ap.value)}, ${ap.scope === 'access' ? 'site access' : 'posting'},
      expires ${ap.expires ? fmtDate(ap.expires) : 'never'}${ap.lifted ? ' (already lifted)' : ''}<br>
      <small>Ban reason: ${esc(ap.reason)} · appealed ${fmtDate(ap.created)}${can(a, 'view_logs') && ap.ip ? ` from ${esc(ap.ip)}` : ''}</small></p>
    <blockquote>${esc(ap.text)}</blockquote>
    <form method="post" action="/admin/appeals/${ap.id}" class="disableform">
      <input name="response" maxlength="500" placeholder="Response shown to the user (optional)">
      <button name="action" value="accept">Accept &amp; lift ban</button>
      <button name="action" value="deny" class="danger">Deny</button>
    </form>
  </div>`).join('')}
</section>` : ''}
<section class="box">
  <h2>New ban</h2>
  ${prefill ? `<p class="notice">Banning the poster of No.${prefill.post_id}${prefill.excerpt ? `: "${esc(prefill.excerpt)}"` : ''}</p>
    ${prefill.ip ? '' : '<p class="error">No IP was logged for this post (post logging was off). Enter one manually or use a country/range ban.</p>'}` : ''}
  <form method="post" action="/admin/bans">
    ${prefill ? `<input type="hidden" name="post_id" value="${prefill.post_id}">` : ''}
    <label>Type <select name="kind">
      <option value="ip">Single IP address</option>
      <option value="range">IP range (CIDR, e.g. 203.0.113.0/24)</option>
      <option value="country">Country (ISO code, e.g. DE)</option>
    </select></label>
    <label>Value <input name="value" required value="${esc(prefill?.ip || '')}"></label>
    <label>Blocks <select name="scope">
      <option value="post">Posting only (can still read)</option>
      <option value="access">All access to the site</option>
    </select></label>
    <label>Duration <select name="duration">
      ${durations.map((d) => `<option value="${d}" ${d === '3d' ? 'selected' : ''}>${d === 'perm' ? 'permanent' : d}</option>`).join('')}
    </select></label>
    <label>Reason (shown to the banned user) <input name="reason" required maxlength="500"></label>
    ${prefill && can(a, 'delete_posts') ? '<label class="check"><input type="checkbox" name="delete_post" checked> Also delete the post</label>' : ''}
    <button class="danger">Ban</button>
  </form>
  <p><small>Country detection: ${geoSource ? esc(geoSource) : '<strong class="danger">not configured</strong>. Run <code>yotsuba-ib update-geoip</code> or set a CDN header in Settings. Country bans do nothing until then.'}</small></p>
</section>
<h2 class="center">Active bans</h2>
<table class="grid">${head}${active.map((b) => banRow(b, true)).join('') || '<tr><td colspan="8"><em>None.</em></td></tr>'}</table>
<h2 class="center">Expired / lifted (last 50)</h2>
<table class="grid">${head}${past.map((b) => banRow(b, false)).join('') || '<tr><td colspan="8"><em>None.</em></td></tr>'}</table>
<h2 class="center">Banned files</h2>
<table class="grid"><tr><th>SHA-256</th><th>Reason</th><th>By</th><th></th></tr>
${fileBans.map((f) => `<tr><td><code>${esc(f.sha256.slice(0, 24))}…</code></td><td>${esc(f.reason)}</td>
  <td>${esc(f.created_by)}<br><small>${fmtDate(f.created)}</small></td>
  <td><form method="post" action="/admin/file-bans/remove"><input type="hidden" name="sha256" value="${esc(f.sha256)}"><button class="linkbtn">unban</button></form></td></tr>`).join('')
  || '<tr><td colspan="4"><em>None.</em></td></tr>'}
</table>`);
}

export function movePage(a, op, boards) {
  return page(a, 'Move thread', null, `<form class="box" method="post" action="/admin/move/${op.id}">
  <p>Thread No.${op.id} on /${esc(op.board)}/${op.subject ? `: <strong>${esc(op.subject)}</strong>` : ''} (${op.reply_count} replies)</p>
  <label>Move to <select name="board">${boards.map((b) => `<option value="${esc(b.slug)}">/${esc(b.slug)}/ - ${esc(b.title)}</option>`).join('')}</select></label>
  <button>Move thread</button>
</form>`);
}
