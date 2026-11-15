import { attachmentUrl } from './attachments.js';
import { t } from './i18n.js';
import { BOARD_TEMPLATES } from './templates.js';
import { esc, fmtDate, fmtSize, mediaUrl } from './format.js';
import { PERMISSIONS, can } from './db.js';

function nav(a) {
  const links = [['/admin', 'Dashboard']];
  if (can(a, 'view_alerts')) links.push(['/admin/alerts', 'Alerts']);
  if (can(a, 'manage_filters')) links.push(['/admin/filters', 'Keyword rules']);
  if (can(a, 'manage_bans')) links.push(['/admin/bans', 'Bans']);
  if (['manage_boards', 'edit_board', 'delete_board'].some((key) => can(a, key))) links.push(['/admin/boards', 'Boards']);
  if (can(a, 'view_logs')) links.push(['/admin/logs', 'Post logs']);
  if (can(a, 'manage_settings')) links.push(['/admin/settings', 'Settings'], ['/admin/homepage', 'Homepage'], ['/admin/discovery', 'Discovery / Webring'], ['/admin/network', 'Network controls'], ...((a.role === 'owner' || !a.boardList?.length) ? [['/admin/appearance', 'Appearance']] : []));
  if (a.role === 'owner') links.push(['/admin/accounts', 'Accounts'], ['/admin/audit', 'Staff activity']);
  links.push(['/admin/community', 'My boards'], ['/admin/account', 'My account']);
  return `<nav class="adminnav">${links.map(([h, label]) => `<a href="${h}">${esc(t(label))}</a>`).join(' · ')}</nav>`;
}

export function page(a, title, msg, content) {
  return `<header class="hero"><h1>${esc(t(title))}</h1></header>
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
  const perms = a.role === 'owner' ? ['Everything (owner)'] : [...new Set([...(a.perms || []), ...(a.memberships || []).flatMap((m) => m.perms)])].map((p) => PERMISSIONS[p]);
  return page(a, 'Admin', msg, `<section class="box">
  <p>Logged in as <strong>${esc(a.username)}</strong> (${esc(a.role)}).</p>
  <p>Your permissions: ${perms.length ? perms.map(esc).join(', ') : '<em>none yet. Ask the owner to grant some.</em>'}</p>
  <p>${stats.boards} boards · ${stats.threads} threads · ${stats.posts} posts · post logging is <strong>${stats.logging ? 'ON' : 'OFF'}</strong></p>
</section>`);
}

export function boardsPage(a, boards, msg) {
  return page(a, 'Boards', msg, `<section class="box">
  ${a.role === 'owner' ? `<h2>Board templates</h2>
  <form method="post" action="/admin/templates">
  <label>Template <select name="template">${Object.entries(BOARD_TEMPLATES).map(([key, t]) => `<option value="${key}">${esc(t.title)} (${t.boards.length} boards)</option>`).join('')}</select></label>
  <p>Curated starter board sets, not live imports. Merge adds missing boards to your existing layout and preserves existing board settings and posts. Adult presets add only adult boards, all marked NSFW (18+) with entry warnings. Merge a starter preset followed by its adult preset to include both.</p>
  <label>Import mode <select name="mode"><option value="merge">Merge into existing layout</option><option value="replace">Overwrite all site settings and replace all boards</option></select></label>
  <p><strong>Replacement permanently removes every existing board and post and resets site settings and homepage design. Accounts, bans and moderation evidence are retained.</strong></p>
  <label>Type REPLACE for replacement <input name="confirm_replace" autocomplete="off"></label>
  <button>Apply template</button></form>` : ''}
  <p><a href="/admin/community">My owned boards / Create a community board</a></p>
  ${can(a, 'manage_boards') ? `<h2>Create board</h2>
  <form method="post" action="/admin/boards">
    <label>Slug <input name="slug" required pattern="[a-z0-9]{1,16}" placeholder="g"> <small>lowercase letters/numbers, becomes /slug/</small></label>
    <label>Title <input name="title" required maxlength="60" placeholder="Technology"></label>
    <label>Bio <textarea name="bio" rows="3" maxlength="500" placeholder="What this board is about"></textarea></label>
    <label>Content rating <select name="nsfw"><option value="0">SFW</option><option value="1">NSFW (show warning before entry)</option></select></label>
    <label class="check"><input type="checkbox" name="visible" checked> Visible to users</label>
    <label>Thread cooldown override (s) <input type="number" name="thread_cooldown" min="0" placeholder="site default"></label>
    <label>Reply cooldown override (s) <input type="number" name="reply_cooldown" min="0" placeholder="site default"></label>
    <label>Category <input name="category" maxlength="40" value="" placeholder="e.g. Japanese Culture"></label>
    <label>Position <input type="number" name="position" value="" placeholder="0" title="lower comes first"></label>
    <label>Rules <textarea name="rules" rows="3" maxlength="3000" placeholder="shown above the board"></textarea></label>
    <label class="check"><input type="checkbox" name="poster_ids"> Show per-thread poster IDs</label>
    <label class="check"><input type="checkbox" name="country_flags"> Show country flags</label>
    <button>Create</button>
  </form>` : ''}
</section>
<section class="box">
  <h2>Existing boards</h2>
  ${boards.map((b) => `<form class="boardedit" method="post" action="/admin/boards/${esc(b.slug)}">
    <strong>/${esc(b.slug)}/${b.hidden ? '<br><small class="hiddenboard">hidden</small>' : ''}</strong>
    <input name="title" value="${esc(b.title)}" required maxlength="60">
    <textarea name="bio" rows="2" maxlength="500">${esc(b.bio)}</textarea>
    <input type="hidden" name="embed_videos_present" value="1">
    <label class="check"><input type="checkbox" name="embed_videos"${b.embed_videos ? ' checked' : ''}> Allow supported external video embeds (click to load)</label>
    <label>Tor posting <select name="tor_mode">${['inherit', 'allow', 'captcha', 'block'].map((mode) => `<option value="${mode}"${b.tor_mode === mode ? ' selected' : ''}>${mode}</option>`).join('')}</select><small>Can strengthen the global Tor policy. CAPTCHA requires sharp.</small></label>
    <label>Board theme <select name="theme"><option value="">Use site appearance</option>${['yotsuba-b', 'yotsuba', 'tomorrow', 'midnight', 'sakura', 'forest', 'ocean'].map((theme) => `<option value="${theme}"${b.theme === theme ? ' selected' : ''}>${theme}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="visible" ${b.hidden ? '' : 'checked'}> Visible to users</label>
    <span class="cooldowns">Cooldowns (s): thread <input type="number" name="thread_cooldown" min="0" value="${b.thread_cooldown ?? ''}" placeholder="default">
      reply <input type="number" name="reply_cooldown" min="0" value="${b.reply_cooldown ?? ''}" placeholder="default"></span>
    <label class="wide">Category <input name="category" maxlength="40" value="${esc(b.category)}" placeholder="e.g. Japanese Culture"></label>
    <label class="wide">Position <input type="number" name="position" value="${b.position}" placeholder="0" title="lower comes first"></label>
    <label class="wide">Rules <textarea name="rules" rows="3" maxlength="3000" placeholder="shown above the board">${esc(b.rules)}</textarea></label>
    <label class="check"><input type="checkbox" name="poster_ids"${b.poster_ids ? ' checked' : ''}> Show per-thread poster IDs</label>
    <label class="check"><input type="checkbox" name="country_flags"${b.country_flags ? ' checked' : ''}> Show country flags</label>
    <label>Content rating <select name="nsfw"><option value="0"${b.nsfw ? '' : ' selected'}>SFW</option><option value="1"${b.nsfw ? ' selected' : ''}>NSFW (show warning before entry)</option></select></label>
    <details class="wide"><summary>Posting rules</summary>
      <label class="check"><input type="checkbox" name="text_only"${b.text_only ? ' checked' : ''}> Text-only (no files)</label>
      <label class="check"><input type="checkbox" name="require_subject"${b.require_subject ? ' checked' : ''}> Require a subject for new threads</label>
      <label class="check"><input type="checkbox" name="forced_anon"${b.forced_anon ? ' checked' : ''}> Forced anonymity (no names or tripcodes)</label>
      <label>Max file size (MB) <input type="number" step="any" min="0" name="max_file_mb" value="${b.max_file_mb ?? ''}" placeholder="site default"></label>
      <label>Allowed file types <input name="allowed_types" value="${esc(b.allowed_types)}" placeholder="all (or e.g. jpg,png,gif,webp,mp4,webm)"></label>
      <label>Bump limit <input type="number" min="1" name="bump_limit" value="${b.bump_limit ?? ''}" placeholder="300"></label>
      <label>Image limit per thread <input type="number" min="1" name="image_limit" value="${b.image_limit ?? ''}" placeholder="unlimited"></label>
      <label>Threads per page <input type="number" min="1" max="50" name="threads_per_page" value="${b.threads_per_page ?? ''}" placeholder="10"></label>
    </details>
    ${can(a, 'manage_members', b.slug) ? `<p><a href="/admin/board-staff/${esc(b.slug)}">Team and ownership</a></p>` : ''}
    <span><button name="action" value="save">Save</button>
    ${can(a, 'manage_boards', b.slug) || can(a, 'delete_board', b.slug) ? `<button name="action" value="delete" class="danger" onclick="return confirm('Delete /${esc(b.slug)}/ and ALL its posts?')">Delete</button>` : ''}</span>
  </form>
  <div class="banners"><strong>Banners for /${esc(b.slug)}/</strong> <small>(one is shown at random above the board; 300x100 recommended)</small><br>
    ${(b.banners || []).map((bn) => `<form method="post" action="/admin/banners/${bn.id}/delete" class="inline banner-item">
      <img src="/banner/${bn.id}" alt=""><button class="linkbtn danger">remove</button></form>`).join('')}
    <form method="post" action="/admin/boards/${esc(b.slug)}/banners" enctype="multipart/form-data" class="inline">
      <input type="file" name="banner" accept="image/png,image/jpeg,image/gif,image/webp" required> <button>Upload banner</button>
    </form>
  </div>`).join('') || '<p><em>No boards yet.</em></p>'}
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
  <td>${r.file_orig ? `${r.file_live ? `<a href="${r.attachment_id ? attachmentUrl(r.attachment_id) : mediaUrl(r.post_id, r.file_mime)}" target="_blank" title="${esc(r.file)}">${esc(r.file_orig)}</a>` : esc(r.file_orig)}<br><small>${esc(r.file_mime)} · ${fmtSize(r.file_size)}</small>` : ''}</td>
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
  <fieldset><legend>Community accounts</legend>
  <label class="check"><input type="checkbox" name="user_registration"${s.user_registration === '1' ? ' checked' : ''}> Allow public account registration</label>
  <label class="check"><input type="checkbox" name="user_board_creation"${s.user_board_creation === '1' ? ' checked' : ''}> Allow registered users to create and own boards</label>
  <label>Owned boards per user <input name="max_owned_boards" type="number" min="1" max="50" value="${esc(s.max_owned_boards)}"></label>
  </fieldset>
  <label class="check"><input type="checkbox" name="captcha_enabled" ${s.captcha_enabled === '1' ? 'checked' : ''}> Require image CAPTCHA for anonymous posting (requires sharp)</label>
  <label>Maximum files per post <input type="number" name="max_files_per_post" min="1" max="4" value="${esc(s.max_files_per_post)}"> <small>Up to four files, each subject to the board size and type limits.</small></label>
  <p><strong>Warning:</strong> Disabling logging stops creation of log.out files and recording uploader IP addresses and names. You will have no uploader oversight or details for new posts. Existing logs remain until retention expires.</p>
  <label class="check"><input type="checkbox" name="confirm_disable_logging" value="1"> I understand the loss of uploader oversight when disabling logging</label>
  <label>Private log directory <input name="log_directory" value="${esc(s.log_directory)}" placeholder="blank: alongside posts"> <small>Absolute path or relative to the data directory. Must be private and writable. New logs use this location.</small></label>
  <label class="check"><input type="checkbox" name="move_logs"> Move existing log.out files from the current location to this directory</label>
  ${num('thread_inactivity_days', 'Purge inactive threads after (days)', 'Threads with no replies/bumps for this long are deleted. 0 = never.')}
  ${num('file_retention_days', 'Keep uploaded files for (days)', 'Files older than this are deleted; the post text stays. 0 = forever.')}
  ${num('log_retention_days', 'Keep post logs for (days)', '0 = forever.')}
  ${num('archive_days', 'Keep archived threads for (days)', 'Pruned and inactive threads stay read-only in the board archive this long. 0 = delete them immediately.')}
  <label>Announcement <textarea name="announcement" rows="2" maxlength="1000" placeholder="shown at the top of every page (blank = none)">${esc(s.announcement)}</textarea></label>
  <label>FAQ page <textarea name="faq_text" rows="6" maxlength="20000" placeholder="content of /faq (blank = no FAQ page)">${esc(s.faq_text)}</textarea></label>
  <fieldset><legend>NSFW board warning</legend>
  <label>Warning title <input name="nsfw_warning_title" maxlength="120" value="${esc(s.nsfw_warning_title)}"></label>
  <label>Warning message <textarea name="nsfw_warning_text" rows="4" maxlength="3000">${esc(s.nsfw_warning_text)}</textarea></label>
  <small>Shown before entering an NSFW board. Confirmation lasts for the browser session, separately for each board. Blank fields restore the default text.</small>
  </fieldset>
  <fieldset><legend>Rate limits &amp; spam</legend>
  ${num('cooldown_thread_sec', 'New-thread cooldown (seconds)', 'Per IP, per board. Boards can override this.')}
  ${num('cooldown_reply_sec', 'Reply cooldown (seconds)', 'Per IP, per board. Boards can override this.')}
  ${num('cooldown_upload_sec', 'Upload cooldown (seconds)', 'Per IP, across the whole site, for posts with a file.')}
  ${num('max_links', 'Max links per post', '0 = unlimited.')}
  ${num('duplicate_window_min', 'Reject duplicate text for (minutes)', 'The same message posted again by anyone is rejected. 0 = off.')}
  ${num('board_flood_per_min', 'Board flood limit (posts per minute)', 'Across all IPs; staff get one alert when it trips. 0 = off.')}
  ${num('phash_threshold', 'Banned-image similarity (0-20)', 'How different (out of 64 bits) an image may be from a banned image and still be blocked. 8 is a good default; 0 = only pixel-identical.')}
  </fieldset>
  <fieldset><legend>Birthday hats 🎉</legend>
  <label>Birthday date (MM-DD) <input name="birthday_date" value="${esc(s.birthday_date)}" pattern="(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])" placeholder="e.g. 10-01 (blank = off)">
    <small>On this date every post image wears a hat (server time zone).</small></label>
  <label>Hat <select name="birthday_hat">${['party', 'crown', 'wizard'].map((h) => `<option value="${h}" ${s.birthday_hat === h ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
  <label>Hat colour <input type="color" name="birthday_color" value="${esc(s.birthday_color)}" style="width:80px"></label>
  </fieldset>
  ${num('backup_interval_hours', 'Automatic database snapshot every (hours)', 'Saved to the data folder under backups/. 0 = off. Use `yotsuba-ib backup` for full backups including uploads.')}
  ${num('backup_keep', 'Automatic snapshots to keep', '')}
  <label>Country header from your CDN <input name="geoip_header" value="${esc(s.geoip_header)}" maxlength="64" placeholder="CF-IPCountry">
    <small>Optional. Used for country bans when behind Cloudflare or a similar CDN. Requires --trust-proxy; leave blank to use the
    downloaded db-ip.com database (<code>yotsuba-ib update-geoip</code>).</small></label>
  <button>Save settings</button>
</form>`);
}

export function accountsPage(a, accounts, msg) {
  return page(a, 'Accounts', msg, `<section class="box">
  <h2>Create account</h2>
  <form method="post" action="/admin/accounts">
    <label>${esc(t('Username'))} <input name="username" required maxlength="32" pattern="[A-Za-z0-9_.\\-]{2,32}"></label>
    <label>${esc(t('Password'))} <input name="password" type="password" required minlength="8"></label>
    <label>Role <select name="role"><option value="user">User</option><option value="board_owner">Board owner (requires board assignments)</option><option value="moderator">Moderator</option><option value="staff">Staff</option></select></label>
    <label>Display name <input name="display_name" maxlength="50"></label>
    <label class="check"><input type="checkbox" name="donor"> Donor badge (does not grant moderation powers)</label>
    <label>Donor label <input name="donor_label" maxlength="24" value="Donor"></label>
    <fieldset><legend>Global permissions</legend>${permChecks([])}</fieldset>
    <p>Use each board team page to assign owners and moderators with individual permissions. Global staff permissions apply to Staff/Moderator roles; board creation can be granted to any account.</p>
    <label>Limit to boards <input name="boards" placeholder="e.g. g, v (blank = all boards)" maxlength="300">
      <small>Board-scoped staff ("janitors") can only act on posts, alerts and logs of these boards.</small></label>
    <button>Create account</button>
  </form>
</section>
<section class="box">
  <h2>All accounts</h2>
  ${accounts.map((u) => `<div class="account ${u.disabled ? 'disabled' : ''}">
    <p>Board assignments: ${(u.memberships || []).map((m) => `<a href="/admin/board-staff/${esc(m.board)}">/${esc(m.board)}/ (${esc(m.role)})</a>`).join(' | ') || 'none'} | <a href="/admin/boards">Assign through Boards / Team</a></p>
    <h3>${esc(u.username)} <small>${esc(u.role)}${u.disabled ? ' · DISABLED' : ''}</small></h3>
    ${u.disabled ? `<p class="error">Disabled: ${esc(u.disabled_reason || '(no reason given)')}</p>` : ''}
    <form method="post" action="/admin/accounts/${u.id}">
      <label>${esc(t('Username'))} <input name="username" value="${esc(u.username)}" required maxlength="32" pattern="[A-Za-z0-9_.\\-]{2,32}"></label>
      <label>${esc(t('New password'))} <input name="password" type="password" minlength="8" placeholder="leave blank to keep"></label>
      <label>Display name <input name="display_name" value="${esc(u.display_name)}" maxlength="50"></label>
      <label class="check"><input type="checkbox" name="donor"${u.donor ? ' checked' : ''}> Donor badge</label>
      <label>Donor label <input name="donor_label" value="${esc(u.donor_label || 'Donor')}" maxlength="24"></label>
      ${u.role === 'owner' ? '' : `<label>Role <select name="role">${['user', 'board_owner', 'moderator', 'staff'].map((role) => `<option value="${role}"${u.role === role ? ' selected' : ''}>${role}</option>`).join('')}</select></label><fieldset><legend>Permissions</legend>${permChecks(u.perms)}</fieldset>
      <label>Limit to boards <input name="boards" value="${esc(u.boards)}" placeholder="blank = all boards" maxlength="300"></label>`}
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
  return page(a, 'My account', msg, `<section class="box"><h2>Profile</h2><p>Role: ${esc(a.role)}${a.donor ? ` | ${esc(a.donor_label || 'Donor')}` : ''}. Verified account posting and donor badges are optional per post.</p><form method="post" action="/admin/profile"><label>Display name <input name="display_name" value="${esc(a.display_name)}" maxlength="50"></label><button>Save profile</button></form><p><a href="/admin/community">My boards and assignments</a></p></section><form class="box" method="post" action="/admin/account">
  <h2>${esc(t('Change password'))}</h2>
  <label>${esc(t('Current password'))} <input name="current" type="password" required></label>
  <label>${esc(t('New password'))} <input name="password" type="password" required minlength="8"></label>
  <button>${esc(t('Change password'))}</button>
  ${a.totp_secret ? `<label>${esc(t('Verification code'))} <input name="otp" autocomplete="one-time-code" required></label>` : ''}
</form>
<section class="box"><h2>${esc(t('Two-factor authentication'))}</h2>
<p>${a.totp_secret ? 'Enabled. Login requires your password and a fresh authenticator code or a single-use recovery code.' : 'Use an authenticator app to protect your staff account.'}</p>
<form method="post" action="/admin/account/2fa">
<input type="hidden" name="action" value="${a.totp_secret ? 'disable' : 'start'}">
<label>${esc(t('Current password'))} <input name="current" type="password" required autocomplete="current-password"></label>
${a.totp_secret ? `<label>${esc(t('Verification code'))} <input name="otp" required autocomplete="one-time-code"></label>` : ''}
<button>${esc(t(a.totp_secret ? 'Disable' : 'Enable'))}</button>
</form></section>`);
}

export function twoFactorPage(a, secret) {
  const uri = `otpauth://totp/${encodeURIComponent('Yotsuba-IB:' + a.username)}?secret=${secret}&issuer=Yotsuba-IB&algorithm=SHA1&digits=6&period=30`;
  return page(a, 'Two-factor authentication', null, `<section class="box">
  <p>Add this setup key to your authenticator app. Setup expires in ten minutes.</p><code>${esc(secret)}</code>
  <p><a href="${esc(uri)}">Open authenticator app</a></p>
  <form method="post" action="/admin/account/2fa"><input type="hidden" name="action" value="enable">
  <label>${esc(t('Current password'))} <input name="current" type="password" required></label>
  <label>${esc(t('Verification code'))} <input name="otp" inputmode="numeric" pattern="[0-9]{6}" required autocomplete="one-time-code"></label>
  <button>${esc(t('Enable'))}</button></form></section>`);
}
export function recoveryPage(a, codes) {
  return page(a, 'Two-factor authentication', null, `<section class="box"><h2>Save these recovery codes</h2>
  <p>Each code can be used once instead of an authenticator code. These codes are shown only now; keep them offline in a safe place. Previously signed-in sessions have been revoked.</p>
  <pre>${codes.map(esc).join('\n')}</pre><a href="/admin/account">${esc(t('My account'))}</a></section>`);
}

export function loginPage(error) {
  return `<header class="hero"><h1>${esc(t('Admin login'))}</h1></header>
<form class="box" method="post" action="/admin/login">
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <label>${esc(t('Username'))} <input name="username" required></label>
  <label>${esc(t('Password'))} <input name="password" type="password" required></label>
  <label>${esc(t('Authenticator or recovery code'))} <input name="otp" autocomplete="one-time-code" maxlength="32" placeholder="only if 2FA is enabled"></label>
  <button>${esc(t('Log in'))}</button>
</form>`;
}
