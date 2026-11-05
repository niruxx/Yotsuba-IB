import { esc, formatBody, fmtSize, fmtDate } from './format.js';

export function layout({ title, siteName, admin, body }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/static/style.css">
</head><body>
<nav class="topbar">
  <a href="/">${esc(siteName)}</a>
  ${admin ? `<span class="right"><a href="/admin">admin</a> · <form method="post" action="/admin/logout" class="inline"><button class="linkbtn">logout</button></form></span>` : ''}
</nav>
${body}
<footer>Powered by Yotsuba-IB</footer>
<script>
document.addEventListener('click', (e) => {
  const t = e.target.closest('.thumb');
  if (t) { e.preventDefault(); t.classList.toggle('expanded'); }
});
</script>
</body></html>`;
}

export function homePage(boards) {
  return `<header class="hero"><h1>Boards</h1></header>
<ul class="boardlist">
${boards.map((b) => `<li><a href="/${esc(b.slug)}/">/${esc(b.slug)}/ - ${esc(b.title)}</a>
  ${b.bio ? `<p>${esc(b.bio)}</p>` : ''}</li>`).join('\n') || '<li><em>No boards yet.</em></li>'}
</ul>`;
}

function fileBlock(p) {
  if (!p.file) return p.file_orig ? '<div class="fileinfo"><em>File expired and was deleted.</em></div>' : '';
  const src = `/uploads/${esc(p.file)}`;
  const info = `<div class="fileinfo">File: <a href="${src}" target="_blank">${esc(p.file_orig)}</a> (${fmtSize(p.file_size)})</div>`;
  if (p.file_mime.startsWith('video/')) {
    return `${info}<video class="media" src="${src}" controls loop preload="metadata"></video>`;
  }
  return `${info}<a class="thumb" href="${src}"><img class="media" src="${src}" loading="lazy" alt=""></a>`;
}

export function renderPost(p, board, { isOp, admin }) {
  return `<div class="post ${isOp ? 'op' : 'reply'}" id="p${p.id}">
  ${isOp ? fileBlock(p) : ''}
  <div class="postinfo">
    ${p.subject ? `<span class="subject">${esc(p.subject)}</span>` : ''}
    <span class="name">${esc(p.name)}</span>
    <span class="date">${fmtDate(p.created)}</span>
    <a href="/${board}/thread/${p.thread_id ?? p.id}#p${p.id}">No.${p.id}</a>
    ${isOp ? `<a href="/${board}/thread/${p.id}">[Reply]</a>` : ''}
    ${admin ? `<form method="post" action="/admin/delete-post" class="inline" onsubmit="return confirm('Delete post ${p.id}?')">
      <input type="hidden" name="id" value="${p.id}"><button class="linkbtn danger">[delete]</button></form>` : ''}
  </div>
  ${isOp ? '' : fileBlock(p)}
  <blockquote>${formatBody(p.body, board)}</blockquote>
</div>`;
}

export function postForm(board, threadId, maxMb) {
  return `<form class="postform" method="post" action="/${esc(board.slug)}/post" enctype="multipart/form-data">
  ${threadId ? `<input type="hidden" name="thread" value="${threadId}">` : ''}
  <table>
    <tr><th>Name</th><td><input name="name" placeholder="Anonymous" maxlength="50"></td></tr>
    ${threadId ? '' : '<tr><th>Subject</th><td><input name="subject" maxlength="100"></td></tr>'}
    <tr><th>Comment</th><td><textarea name="body" rows="5" maxlength="4000"></textarea></td></tr>
    <tr><th>File</th><td><input type="file" name="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm">
      <small>max ${maxMb} MB · jpg png gif webp mp4 webm${threadId ? '' : ' · required for new threads'}</small></td></tr>
    <tr><th></th><td><button>${threadId ? 'Post reply' : 'New thread'}</button></td></tr>
  </table>
</form>`;
}

export function boardPage(board, threads, { admin, page, pages, maxMb }) {
  return `<header class="hero"><h1>/${esc(board.slug)}/ - ${esc(board.title)}</h1>
  ${board.bio ? `<p class="bio">${esc(board.bio)}</p>` : ''}</header>
${postForm(board, null, maxMb)}
<hr>
${threads.map(({ op, replies, omitted }) => `<div class="thread">
  ${renderPost(op, board.slug, { isOp: true, admin })}
  ${omitted ? `<div class="omitted">${omitted} replies omitted. <a href="/${board.slug}/thread/${op.id}">View thread</a></div>` : ''}
  ${replies.map((r) => renderPost(r, board.slug, { isOp: false, admin })).join('')}
</div><hr>`).join('\n') || '<p class="empty">No threads yet. Start one!</p>'}
<div class="pager">${Array.from({ length: pages }, (_, i) =>
    i === page ? `[${i}]` : `<a href="/${board.slug}/?page=${i}">[${i}]</a>`).join(' ')}</div>`;
}

export function threadPage(board, op, replies, { admin, maxMb }) {
  return `<header class="hero"><h1>/${esc(board.slug)}/ - ${esc(board.title)}</h1></header>
<p><a href="/${board.slug}/">[Return]</a></p>
${postForm(board, op.id, maxMb)}
<hr>
<div class="thread">
  ${renderPost(op, board.slug, { isOp: true, admin })}
  ${replies.map((r) => renderPost(r, board.slug, { isOp: false, admin })).join('')}
</div>`;
}

export function errorPage(message) {
  return `<header class="hero"><h1>Error</h1></header><p class="error">${esc(message)}</p>
<p><a href="javascript:history.back()">Go back</a></p>`;
}
