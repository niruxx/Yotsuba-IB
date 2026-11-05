import { esc, fmtDate, fmtSize } from './format.js';
import { PERMISSIONS, can } from './db.js';

function nav(a) {
  const links = [['/admin', 'Dashboard']];
  if (can(a, 'manage_boards')) links.push(['/admin/boards', 'Boards']);
  if (can(a, 'view_logs')) links.push(['/admin/logs', 'Post logs']);
  if (can(a, 'manage_settings')) links.push(['/admin/settings', 'Settings']);
  if (a.role === 'owner') links.push(['/admin/accounts', 'Accounts'], ['/admin/audit', 'Staff activity']);
  links.push(['/admin/account', 'My account']);
  return `<nav class="adminnav">${links.map(([h, t]) => `<a href="${h}">${t}</a>`).join(' · ')}</nav>`;
}

function page(a, title, msg, content) {
  return `<header class="hero"><h1>${esc(title)}</h1></header>
${nav(a)}
${msg ? `<p class="notice">${esc(msg)}</p>` : ''}
${content}`;
}

const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();

function pager(base, params, pageNo, hasMore) {
  const prev = pageNo > 0 ? `<a href="${base}?${qs({ ...params, page: pageNo - 1 })}">« newer</a>` : '';
  const next = hasMore ? `<a href="${base}?${qs({ ...params, page: pageNo + 1 })}">older »</a>` : '';
  return `<div class="pager">${prev} page ${pageNo} ${next}</div>`;
}

function permChecks(selected, disabled = false) {
  return Object.entries(PERMISSIONS).map(([k, label]) =>
    `<label class="check"><input type="checkbox" name="perm_${k}" ${selected.includes(k) ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${esc(label)}</label>`).join('');
}

export function dashboard(a, stats, msg) {
  const perms = a.role === 'owner' ? ['Everything (owner)'] : a.perms.map((p) => PERMISSIONS[p]);
  return page(a, 'Admin', msg, `<section class="box">
  <p>Logged in as <strong>${esc(a.username)}</strong> (${esc(a.role)}).</p>
  <p>Your permissions: ${perms.length ? perms.map(esc).join(', ') : '<em>none yet. Ask the owner to grant some.</em>'}</p>
  <p>${stats.boards} boards · ${stats.threads} threads · ${stats.posts} posts · post logging is <strong>${stats.logging ? 'ON' : 'OFF'}</strong></p>
</section>`);
}

export function boardsPage(a, boards, msg) {
  return page(a, 'Boards', msg, `<section class="box">
  <h2>Create board</h2>
  <form method="post" action="/admin/boards">
    <label>Slug <input name="slug" required pattern="[a-z0-9]{1,16}" placeholder="g"> <small>lowercase letters/numbers, becomes /slug/</small></label>
    <label>Title <input name="title" required maxlength="60" placeholder="Technology"></label>
    <label>Bio <textarea name="bio" rows="3" maxlength="500" placeholder="What this board is about"></textarea></label>
    <button>Create</button>
  </form>
</section>
<section class="box">
  <h2>Existing boards</h2>
  ${boards.map((b) => `<form class="boardedit" method="post" action="/admin/boards/${esc(b.slug)}">
    <strong>/${esc(b.slug)}/</strong>
    <input name="title" value="${esc(b.title)}" required maxlength="60">
    <textarea name="bio" rows="2" maxlength="500">${esc(b.bio)}</textarea>
    <span><button name="action" value="save">Save</button>
    <button name="action" value="delete" class="danger" onclick="return confirm('Delete /${esc(b.slug)}/ and ALL its posts?')">Delete</button></span>
  </form>`).join('') || '<p><em>No boards yet.</em></p>'}
</section>`);
}

export function logsPage(a, rows, { filters, pageNo, hasMore, logging }, msg) {
  return page(a, 'Post logs', msg, `
${logging ? '' : '<p class="error">Post logging is currently OFF. New posts are not being recorded.</p>'}
<form class="filters" method="get" action="/admin/logs">
  IP <input name="ip" value="${esc(filters.ip)}" placeholder="exact IP">
  Board <input name="board" value="${esc(filters.board)}" size="6">
  Type <select name="kind">
    ${['', 'thread', 'reply', 'upload'].map((k) => `<option value="${k}" ${filters.kind === k ? 'selected' : ''}>${k || 'all'}</option>`).join('')}
  </select>
  <button>Filter</button> <a href="/admin/logs">reset</a>
</form>
<table class="grid">
<tr><th>Time (UTC)</th><th>Type</th><th>Post</th><th>IP</th><th>Name</th><th>Content</th><th>Upload</th></tr>
${rows.map((r) => `<tr class="${r.live ? '' : 'gone'}">
  <td>${fmtDate(r.created)}</td>
  <td>${esc(r.kind)}</td>
  <td>${r.live ? `<a href="/${esc(r.board)}/post/${r.post_id}">/${esc(r.board)}/ ${r.post_id}</a>` : `/${esc(r.board)}/ ${r.post_id} <small>(deleted)</small>`}
      ${r.kind === 'reply' ? `<br><small>in thread ${r.thread_id}</small>` : ''}</td>
  <td><a href="/admin/logs?${qs({ ip: r.ip })}">${esc(r.ip)}</a><br><small title="${esc(r.user_agent)}">${esc((r.user_agent || '').slice(0, 40))}</small></td>
  <td>${esc(r.name)}</td>
  <td class="content">${r.subject ? `<strong>${esc(r.subject)}</strong><br>` : ''}${esc(r.body).slice(0, 300)}</td>
  <td>${r.file_orig ? `${r.file_live ? `<a href="/uploads/${esc(r.file)}" target="_blank">${esc(r.file_orig)}</a>` : esc(r.file_orig)}<br><small>${esc(r.file_mime)} · ${fmtSize(r.file_size)}</small>` : ''}</td>
</tr>`).join('') || '<tr><td colspan="7"><em>No log entries.</em></td></tr>'}
</table>
${pager('/admin/logs', filters, pageNo, hasMore)}`);
}

export function settingsPage(a, s, msg) {
  const num = (key, label, help) => `<label>${label}
    <input type="number" name="${key}" min="0" step="any" value="${esc(s[key])}"> <small>${help}</small></label>`;
  return page(a, 'Settings', msg, `<form class="box" method="post" action="/admin/settings">
  <label class="check"><input type="checkbox" name="logging_enabled" ${s.logging_enabled === '1' ? 'checked' : ''}>
    Post logging: record the IP address, user agent, content and upload of every new thread and reply</label>
  ${num('thread_inactivity_days', 'Purge inactive threads after (days)', 'Threads with no replies/bumps for this long are deleted. 0 = never.')}
  ${num('file_retention_days', 'Keep uploaded files for (days)', 'Files older than this are deleted; the post text stays. 0 = forever.')}
  ${num('log_retention_days', 'Keep post logs for (days)', '0 = forever.')}
  <button>Save settings</button>
</form>`);
}

export function accountsPage(a, accounts, msg) {
  return page(a, 'Accounts', msg, `<section class="box">
  <h2>Create staff account</h2>
  <form method="post" action="/admin/accounts">
    <label>Username <input name="username" required maxlength="32" pattern="[A-Za-z0-9_.\\-]{2,32}"></label>
    <label>Password <input name="password" type="password" required minlength="8"></label>
    <fieldset><legend>Permissions</legend>${permChecks([])}</fieldset>
    <button>Create account</button>
  </form>
</section>
<section class="box">
  <h2>All accounts</h2>
  ${accounts.map((u) => `<div class="account ${u.disabled ? 'disabled' : ''}">
    <h3>${esc(u.username)} <small>${esc(u.role)}${u.disabled ? ' · DISABLED' : ''}</small></h3>
    ${u.disabled ? `<p class="error">Disabled: ${esc(u.disabled_reason || '(no reason given)')}</p>` : ''}
    <form method="post" action="/admin/accounts/${u.id}">
      <label>Username <input name="username" value="${esc(u.username)}" required maxlength="32" pattern="[A-Za-z0-9_.\\-]{2,32}"></label>
      <label>New password <input name="password" type="password" minlength="8" placeholder="leave blank to keep"></label>
      ${u.role === 'owner' ? '' : `<fieldset><legend>Permissions</legend>${permChecks(u.perms)}</fieldset>`}
      <button name="action" value="save">Save</button>
      <a href="/admin/audit?admin=${u.id}">View activity</a>
    </form>
    ${u.role === 'owner' ? '' : u.disabled
      ? `<form method="post" action="/admin/accounts/${u.id}"><button name="action" value="enable">Re-enable account</button></form>`
      : `<form method="post" action="/admin/accounts/${u.id}" class="disableform">
          <input name="reason" required maxlength="300" placeholder="Reason for disabling">
          <button name="action" value="disable" class="danger">Disable account</button></form>`}
  </div>`).join('')}
</section>`);
}

export function auditPage(a, rows, accounts, { filters, pageNo, hasMore }, msg) {
  return page(a, 'Staff activity', msg, `<form class="filters" method="get" action="/admin/audit">
  Account <select name="admin"><option value="">all</option>
    ${accounts.map((u) => `<option value="${u.id}" ${String(filters.admin) === String(u.id) ? 'selected' : ''}>${esc(u.username)}</option>`).join('')}
  </select> <button>Filter</button>
</form>
<table class="grid">
<tr><th>Time (UTC)</th><th>Account</th><th>Action</th><th>Detail</th><th>IP</th></tr>
${rows.map((r) => `<tr><td>${fmtDate(r.created)}</td><td>${esc(r.admin_name)}</td><td>${esc(r.action)}</td>
  <td class="content">${esc(r.detail)}</td><td>${esc(r.ip)}</td></tr>`).join('') || '<tr><td colspan="5"><em>No activity.</em></td></tr>'}
</table>
${pager('/admin/audit', filters, pageNo, hasMore)}`);
}

export function myAccountPage(a, msg) {
  return page(a, 'My account', msg, `<form class="box" method="post" action="/admin/account">
  <h2>Change password</h2>
  <label>Current password <input name="current" type="password" required></label>
  <label>New password <input name="password" type="password" required minlength="8"></label>
  <button>Change password</button>
</form>`);
}

export function loginPage(error) {
  return `<header class="hero"><h1>Admin login</h1></header>
<form class="box" method="post" action="/admin/login">
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <label>Username <input name="username" required></label>
  <label>Password <input name="password" type="password" required></label>
  <button>Log in</button>
</form>`;
}
