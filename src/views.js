import {
  esc, formatBody, fmtSize, fmtDate, mediaUrl, thumbUrl, quotedIds, flagEmoji, idColor,
} from './format.js';

// Applied before first paint so the chosen theme doesn't flash.
const THEME_BOOT = `<script>try{const p=JSON.parse(localStorage.getItem('prefs')||'{}');
document.documentElement.dataset.theme=p.theme||'yotsuba-b';}catch{}</script>`;

export function layout({ title, siteName, admin, boards = [], alertCount = null, body, announcement = '', hasFaq = false, ctx = {}, birthday = null, labels = {} }) {
  const L = { nav_search: 'search', nav_settings: 'settings', nav_admin: 'admin', footer: 'Powered by Yotsuba-IB', ...labels };
  return `<!DOCTYPE html>
<html lang="en" data-theme="yotsuba-b"${birthday ? ` class="birthday" style="--hat-color:${esc(birthday.color)};--hat-url:url(/static/hats/${esc(birthday.hat)}.svg)"` : ''}><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${THEME_BOOT}
<link rel="stylesheet" href="/static/style.css">
</head><body${ctx.board ? ` data-board="${esc(ctx.board)}"` : ''}${ctx.thread ? ` data-thread="${ctx.thread}"` : ''}>
<nav class="topbar">
  <a href="/" class="sitename">${esc(siteName)}</a>
  <span class="boardnav">[ ${boards.map((b) => `<a href="/${esc(b.slug)}/" title="${esc(b.title)}"${b.hidden ? ' class="hiddenboard"' : ''}>${esc(b.slug)}</a>`).join(' / ')} ]</span>
  <span class="right">
    <a href="/search">${esc(L.nav_search)}</a> · <a href="#" id="open-settings">${esc(L.nav_settings)}</a>
    ${admin ? ` · ${alertCount !== null
    ? `<a href="/admin/alerts" class="alertbadge${alertCount ? ' hot' : ''}" id="alertbadge">alerts (<span id="alertcount">${alertCount}</span>)</a> · ` : ''}<a href="/admin">${esc(L.nav_admin)}</a> · <form method="post" action="/admin/logout" class="inline"><button class="linkbtn">logout</button></form>` : ''}
  </span>
</nav>
${announcement.trim() ? `<div class="announcement" data-hash="${esc(simpleHash(announcement))}">${esc(announcement)}
  <a href="#" class="dismiss-announcement" title="hide">×</a></div>` : ''}
<div id="settings-panel" class="settings-panel" hidden></div>
<div id="watcher" hidden><div class="w-head">Watched threads <a href="#" id="watcher-toggle">[–]</a></div><ul id="watcher-list"></ul></div>
${body}
<footer>${esc(L.footer)}${hasFaq ? ' · <a href="/faq">FAQ</a>' : ''}</footer>
<script src="/static/app.js" defer></script>
${alertCount !== null ? `<div id="toasts"></div>
<script>
// Live staff notifications: keyword matches, blocked posts, reports and appeals arrive over Server-Sent Events.
(() => {
  const labels = { keyword: 'Keyword match', blocked: 'Blocked post', report: 'User report', appeal: 'Ban appeal' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const es = new EventSource('/admin/events');
  es.addEventListener('alert', (e) => {
    const a = JSON.parse(e.data);
    const count = document.getElementById('alertcount');
    count.textContent = Number(count.textContent) + 1;
    document.getElementById('alertbadge').classList.add('hot');
    const link = a.post_id ? '/' + a.board + '/post/' + a.post_id : '/admin/alerts';
    const t = document.createElement('div');
    t.className = 'toast kind-' + a.kind;
    t.innerHTML = '<strong>' + labels[a.kind] + '</strong>' + (a.board ? ' on /' + esc(a.board) + '/' : '') + '<br><small>' + esc(a.detail) + '</small><br>'
      + esc(a.excerpt).slice(0, 140) + '<br><a href="' + link + '">view</a> · <a href="/admin/alerts">review</a> · <a href="#" class="dismiss">dismiss</a>';
    t.querySelector('.dismiss').onclick = (ev) => { ev.preventDefault(); t.remove(); };
    document.getElementById('toasts').prepend(t);
    if (window.Notification && Notification.permission === 'granted') {
      const n = new Notification(labels[a.kind] + (a.board ? ' on /' + a.board + '/' : ''), { body: a.detail + '\\n' + a.excerpt, tag: 'alert-' + a.id });
      n.onclick = () => { window.focus(); location.href = link; };
    }
  });
})();
</script>` : ''}
</body></html>`;
}

function simpleHash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return String(h >>> 0);
}

function fileBlock(p) {
  if (!p.file) return p.file_orig ? '<div class="fileinfo"><em>File deleted.</em></div>' : '';
  const src = mediaUrl(p.id, p.file_mime);
  const dims = p.width && p.height ? `, ${p.width}x${p.height}` : '';
  const info = `<div class="fileinfo">File: <a href="${src}" target="_blank">${p.spoiler ? 'Spoiler Image' : esc(p.file_orig)}</a> (${fmtSize(p.file_size)}${dims})</div>`;
  const isVideo = p.file_mime.startsWith('video/');
  const thumb = p.spoiler
    ? `<span class="media spoiler-img"${p.thumb ? ` data-thumb="${thumbUrl(p.id)}"` : ''}>Spoiler</span>`
    : `<img class="media" src="${p.thumb ? thumbUrl(p.id) : src}" loading="lazy" alt="">${isVideo ? '<span class="playicon">▶</span>' : ''}`;
  return `${info}<a class="thumb${isVideo ? ' video' : ''}" href="${src}" data-full="${src}" data-type="${isVideo ? 'video' : 'image'}">${thumb}</a>`;
}

export function renderPost(p, board, { isOp, admin, backlinks }) {
  const slug = board.slug;
  const links = backlinks?.get(p.id);
  return `<div class="post ${isOp ? 'op' : 'reply'}" id="p${p.id}" data-id="${p.id}" data-board="${esc(slug)}"${p.poster_id ? ` data-poster="${esc(p.poster_id)}"` : ''}${p.tripcode ? ` data-trip="${esc(p.tripcode)}"` : ''} data-name="${esc(p.name)}">
  ${isOp ? fileBlock(p) : ''}
  <div class="postinfo">
    <a href="#" class="hide-post" title="Hide this post">[–]</a>
    ${p.subject ? `<span class="subject">${esc(p.subject)}</span>` : ''}
    <span class="name${p.capcode ? ' capcode' : ''}">${esc(p.name)}${p.tripcode ? ` <span class="trip">${esc(p.tripcode)}</span>` : ''}${p.capcode ? ` <strong>## ${esc(p.capcode)}</strong>` : ''}</span>
    ${p.poster_id ? `<span class="posterid" style="background:${idColor(p.poster_id)}" title="Highlight posts by this ID">ID: ${esc(p.poster_id)}</span>` : ''}
    ${p.country ? `<span class="country" title="${esc(p.country)}">${flagEmoji(p.country)}</span>` : ''}
    <span class="date" data-time="${p.created}">${fmtDate(p.created)}</span>
    <a href="/${slug}/thread/${p.thread_id ?? p.id}#p${p.id}" class="postno" data-id="${p.id}">No.${p.id}</a>
    ${isOp && p.sticky ? '<span class="flag" title="Sticky">[Sticky]</span>' : ''}
    ${isOp && p.locked && !p.archived ? '<span class="flag" title="Locked">[Locked]</span>' : ''}
    ${isOp && p.archived ? '<span class="flag" title="Archived">[Archived]</span>' : ''}
    ${isOp ? `<a href="/${slug}/thread/${p.id}#reply" class="reply-link">[Reply]</a> <a href="#" class="watch" data-title="${esc((p.subject || p.body).slice(0, 40))}">[Watch]</a>` : ''}
    ${p.delete_hash ? `<details class="report"><summary>[delete]</summary>
      <form method="post" action="/${slug}/delete" class="selfdelete"><input type="hidden" name="id" value="${p.id}">
      <input type="password" name="password" required placeholder="deletion password" class="delpw">
      ${p.file ? '<label><input type="checkbox" name="file_only"> file only</label>' : ''} <button>Delete</button></form>
    </details>` : ''}
    <details class="report"><summary>[report]</summary>
      <form method="post" action="/${slug}/report"><input type="hidden" name="id" value="${p.id}">
      <input name="reason" required maxlength="300" placeholder="What rule does this break?"> <button>Report</button></form>
    </details>
    ${admin ? staffControls(p, isOp, admin) : ''}
    ${links?.length ? `<span class="backlinks">${links.map((id) => `<a class="quotelink" data-board="${slug}" data-id="${id}" href="#p${id}">&gt;&gt;${id}</a>`).join(' ')}</span>` : ''}
  </div>
  ${isOp ? '' : fileBlock(p)}
  <blockquote>${formatBody(p.body, slug)}</blockquote>
</div>`;
}

// Map of postId -> [ids of later posts that quote it], for "replies" links under each post.
function backlinkMap(posts) {
  const ids = new Set(posts.map((p) => p.id));
  const map = new Map();
  for (const p of posts) {
    for (const q of quotedIds(p.body)) {
      if (ids.has(q) && q !== p.id) {
        if (!map.has(q)) map.set(q, []);
        map.get(q).push(p.id);
      }
    }
  }
  return map;
}

function staffControls(p, isOp, caps) {
  const opts = [];
  if (caps.del) {
    opts.push(['delete', 'Delete post']);
    if (p.file) opts.push(['delete_file', 'Delete file only']);
    if (isOp) {
      opts.push(p.sticky ? ['unsticky', 'Unsticky'] : ['sticky', 'Sticky']);
      opts.push(p.locked ? ['unlock', 'Unlock'] : ['lock', 'Lock']);
      opts.push(['move', 'Move thread…']);
    }
  }
  if (caps.ban) {
    opts.push(['ban', 'Ban poster…']);
    if (p.file) opts.push(['ban_file', 'Ban this file (removes all copies)']);
  }
  return `<form method="post" action="/admin/post-action" class="inline staffctl"
    onsubmit="const s=this.elements.action; return s.value==='ban' || s.value==='move' || confirm(s.selectedOptions[0].text + ' – post ${p.id}?')">
    <input type="hidden" name="id" value="${p.id}">
    <select name="action">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select><button>go</button></form>`;
}

export function postForm(board, threadId, maxMb, loggedIn = false) {
  return `<form class="postform" id="postform" method="post" action="/${esc(board.slug)}/post" enctype="multipart/form-data">
  ${threadId ? `<input type="hidden" name="thread" value="${threadId}">` : ''}
  <table>
    ${board.forced_anon ? '' : '<tr><th>Name</th><td><input name="name" placeholder="Anonymous" maxlength="80" title="Name#password for a tripcode"></td></tr>'}
    <tr><th>Options</th><td><input name="options" maxlength="40" placeholder="sage / nonoko"></td></tr>
    ${threadId ? '' : `<tr><th>Subject</th><td><input name="subject" maxlength="100"${board.require_subject ? ' required' : ''}></td></tr>`}
    <tr><th>Comment</th><td><textarea name="body" rows="5" maxlength="4000" placeholder="Comment"></textarea></td></tr>
    ${board.text_only ? '' : `<tr><th>File</th><td><input type="file" name="file" accept="${acceptFor(board)}">
      <label class="inline-check"><input type="checkbox" name="spoiler"> Spoiler</label>
      <small>max ${maxMb} MB · ${typesFor(board).join(' ')}${threadId ? '' : ' · required for new threads'}</small></td></tr>`}
    <tr><th>Password</th><td><input type="password" name="password" class="delpw" maxlength="64" autocomplete="off">
      <small>for deleting your post later (saved in this browser)</small></td></tr>
    ${loggedIn ? '<tr><th>Staff</th><td><label><input type="checkbox" name="capcode"> Post with staff capcode</label></td></tr>' : ''}
    <tr><th></th><td><button>${threadId ? 'Post reply' : 'New thread'}</button>
      <small class="formhelp">[spoiler]…[/spoiler] · [code]…[/code] · &gt;&gt;123 · &gt;&gt;&gt;/board/123</small></td></tr>
  </table>
</form>`;
}

const ALL_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' };
const typesFor = (board) => {
  const allowed = String(board.allowed_types || '').split(',').filter((t) => t in ALL_TYPES);
  return allowed.length ? allowed : Object.keys(ALL_TYPES);
};
const acceptFor = (board) => typesFor(board).map((t) => ALL_TYPES[t]).join(',');

const hiddenNote = (board) => (board.hidden ? '<p class="error">This board is hidden. Only logged-in staff can see it.</p>' : '');

function boardHeader(board, current, banner = null) {
  const tab = (href, label, key) => (current === key ? `<strong>[${label}]</strong>` : `<a href="${href}">[${label}]</a>`);
  return `<header class="hero">${banner ? `<img class="banner" src="/banner/${banner}" alt="">` : ''}
  <h1>/${esc(board.slug)}/ - ${esc(board.title)}${board.nsfw ? ' <small class="nsfw">NSFW</small>' : ''}</h1>${hiddenNote(board)}
  ${board.bio ? `<p class="bio">${esc(board.bio)}</p>` : ''}</header>
<nav class="boardtabs">${tab(`/${board.slug}/`, 'Index', 'index')} ${tab(`/${board.slug}/catalog`, 'Catalog', 'catalog')}
  ${tab(`/${board.slug}/archive`, 'Archive', 'archive')} <a href="/search?board=${esc(board.slug)}">[Search]</a>
  ${board.hidden ? '' : `<a href="/${esc(board.slug)}/rss.xml">[RSS]</a>`}</nav>
${board.rules?.trim() ? `<details class="rules box"><summary>Board rules</summary><div>${esc(board.rules).replace(/\n/g, '<br>')}</div></details>` : ''}`;
}

export function boardPage(board, threads, { admin, loggedIn, page, pages, maxMb, banner }) {
  return `${boardHeader(board, 'index', banner)}
${postForm(board, null, maxMb, loggedIn)}
<hr>
${threads.map(({ op, replies, omitted }) => {
    const backlinks = backlinkMap([op, ...replies]);
    return `<div class="thread">
  ${renderPost(op, board, { isOp: true, admin, backlinks })}
  ${omitted ? `<div class="omitted">${omitted} replies omitted. <a href="/${board.slug}/thread/${op.id}" class="expand-thread" data-thread="${op.id}">View thread</a></div>` : ''}
  ${replies.map((r) => renderPost(r, board, { isOp: false, admin, backlinks })).join('')}
</div><hr>`;
  }).join('\n') || '<p class="empty">No threads yet. Start one!</p>'}
<div class="pager">${Array.from({ length: pages }, (_, i) =>
    i === page ? `[${i}]` : `<a href="/${board.slug}/?page=${i}">[${i}]</a>`).join(' ')}</div>`;
}

export function threadPage(board, op, replies, { admin, loggedIn, maxMb, banner }) {
  const backlinks = backlinkMap([op, ...replies]);
  const canReply = !op.archived && (!op.locked || admin || loggedIn);
  return `${boardHeader(board, 'thread', banner)}
<p><a href="/${board.slug}/">[Return]</a> <a href="/${board.slug}/catalog">[Catalog]</a> <a href="#bottom">[Bottom]</a>
  ${canReply ? '<a href="#reply" class="reply-link reply-button">[Post a Reply]</a>' : ''}</p>
${op.archived ? '<p class="error">This thread is archived. It is read-only and will be deleted later.</p>'
    : canReply ? postForm(board, op.id, maxMb, loggedIn) : '<p class="error">This thread is locked. You cannot reply.</p>'}
<hr>
<div class="thread" id="thread" data-last="${replies.length ? replies[replies.length - 1].id : op.id}">
  ${renderPost(op, board, { isOp: true, admin, backlinks })}
  ${replies.map((r) => renderPost(r, board, { isOp: false, admin, backlinks })).join('')}
</div>
<div class="threadstats" id="bottom">
  <span id="replycount">${op.reply_count}</span> replies ·
  ${op.archived ? 'archived' : `<a href="#" id="update-now">[Update]</a> <span id="update-status"></span>`}
  · <a href="#top">[Top]</a>${canReply ? ' · <a href="#reply" class="reply-link reply-button">[Post a Reply]</a>' : ''}
</div>`;
}

export function catalogPage(board, threads, sort) {
  const sortLink = (key, label) => (sort === key ? `<strong>${label}</strong>` : `<a href="?sort=${key}">${label}</a>`);
  return `${boardHeader(board, 'catalog')}
<p class="center">Sort by: ${sortLink('bump', 'bump order')} · ${sortLink('new', 'creation date')} · ${sortLink('replies', 'reply count')}
  · <input type="search" id="catalog-filter" placeholder="filter…"></p>
<div class="catalog">
${threads.map((t) => `<a class="ctile" href="/${board.slug}/thread/${t.id}" data-text="${esc(`${t.subject} ${t.body}`.toLowerCase())}">
  ${t.file && !t.spoiler ? `<img src="${t.thumb ? thumbUrl(t.id) : mediaUrl(t.id, t.file_mime)}" loading="lazy" alt="">` : `<span class="spoiler-img">${t.spoiler ? 'Spoiler' : 'No image'}</span>`}
  <div class="cmeta">R: <b>${t.reply_count}</b> / I: <b>${t.images}</b>${t.sticky ? ' · sticky' : ''}${t.locked ? ' · locked' : ''}</div>
  <div class="ctext">${t.subject ? `<b>${esc(t.subject)}</b>: ` : ''}${esc(t.body.slice(0, 150))}</div>
</a>`).join('') || '<p class="empty">No threads yet.</p>'}
</div>`;
}

export function archivePage(board, threads, days) {
  return `${boardHeader(board, 'archive')}
<p class="center">Threads stay here, read-only, for ${days} day${days === 1 ? '' : 's'} after they fall off the board.</p>
<table class="grid"><tr><th>No.</th><th>Excerpt</th><th>Replies</th><th>Archived (UTC)</th></tr>
${threads.map((t) => `<tr><td><a href="/${board.slug}/thread/${t.id}">${t.id}</a></td>
  <td class="content">${t.subject ? `<b>${esc(t.subject)}</b>: ` : ''}${esc(t.body.slice(0, 150))}</td>
  <td>${t.reply_count}</td><td>${fmtDate(t.archived_at)}</td></tr>`).join('') || '<tr><td colspan="4"><em>The archive is empty.</em></td></tr>'}
</table>`;
}

export function searchPage(q, boardSlug, results, boards) {
  return `<header class="hero"><h1>Search</h1></header>
<form class="filters" method="get" action="/search">
  <input type="search" name="q" value="${esc(q)}" placeholder="words in subject or comment" minlength="2" autofocus>
  <select name="board"><option value="">all boards</option>
    ${boards.map((b) => `<option value="${esc(b.slug)}" ${b.slug === boardSlug ? 'selected' : ''}>/${esc(b.slug)}/</option>`).join('')}
  </select> <button>Search</button>
</form>
${q.length >= 2 ? `<p class="center">${results.length}${results.length === 50 ? '+' : ''} result${results.length === 1 ? '' : 's'}</p>
<div class="results">${results.map((p) => `<div class="post reply">
  <div class="postinfo"><a href="/${esc(p.board)}/post/${p.id}">/${esc(p.board)}/ No.${p.id}</a>
    ${p.subject ? `<span class="subject">${esc(p.subject)}</span>` : ''} <span class="date">${fmtDate(p.created)}</span>
    ${p.archived ? '<span class="flag">[Archived]</span>' : ''}</div>
  <blockquote>${formatBody(p.body.slice(0, 600), p.board)}</blockquote></div>`).join('')}</div>` : ''}`;
}

export function faqPage(text) {
  return `<header class="hero"><h1>FAQ</h1></header>
<section class="box faq">${esc(text).replace(/\n/g, '<br>')}</section>`;
}

const xml = (s) => esc(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function rssFeed(siteName, board, threads, base) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${xml(`/${board.slug}/ - ${board.title} - ${siteName}`)}</title>
<link>${xml(`${base}/${board.slug}/`)}</link>
<description>${xml(board.bio || board.title)}</description>
${threads.map((t) => `<item>
  <title>${xml(t.subject || t.body.slice(0, 80) || `No.${t.id}`)}</title>
  <link>${xml(`${base}/${board.slug}/thread/${t.id}`)}</link>
  <guid isPermaLink="true">${xml(`${base}/${board.slug}/thread/${t.id}`)}</guid>
  <pubDate>${new Date(t.created).toUTCString()}</pubDate>
  <description>${xml(t.body.slice(0, 500))}</description>
</item>`).join('\n')}
</channel></rss>`;
}

export function bannedPage(ban, appeal) {
  const what = ban.scope === 'access' ? 'from accessing this site' : 'from posting';
  return `<header class="hero"><h1>You are banned</h1></header>
<section class="box">
  ${ban.kind === 'country'
    ? `<p>Visitors from your country (${esc(ban.country || ban.value)}) are blocked ${what}.</p>`
    : `<p>Your IP address has been blocked ${what}.</p>`}
  <p><strong>Reason:</strong> ${esc(ban.reason)}</p>
  <p><strong>Expires:</strong> ${ban.expires ? `${fmtDate(ban.expires)} UTC` : 'never'}</p>
  <p><small>Ban #${ban.id}</small></p>
</section>
<section class="box">
  <h2>Appeal</h2>
  ${appeal?.status === 'open' ? `<p>Your appeal from ${fmtDate(appeal.created)} UTC is waiting for a moderator.</p>`
    : appeal?.status === 'denied' ? `<p class="error">Your appeal was denied.${appeal.response ? ` Moderator's response: ${esc(appeal.response)}` : ''}</p>` : ''}
  ${appeal?.status === 'open' ? '' : `<form method="post" action="/appeal">
    <input type="hidden" name="ban_id" value="${ban.id}">
    <label>Why should this ban be lifted? <textarea name="text" rows="5" required minlength="10" maxlength="2000"></textarea></label>
    <button>Send appeal</button>
  </form>`}
</section>`;
}

export function messagePage(message, link) {
  return `<header class="hero"><h1>Done</h1></header><p class="notice">${esc(message)}</p>
<p class="center"><a href="${esc(link)}">Continue</a></p>`;
}

export function errorPage(message) {
  return `<header class="hero"><h1>Error</h1></header><p class="error">${esc(message)}</p>
<p><a href="javascript:history.back()">Go back</a></p>`;
}
