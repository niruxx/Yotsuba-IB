export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Renders post bodies: escapes HTML, then adds [code] blocks, [spoiler] text, >>>/board/123 cross-board
// links, >>123 quote links, auto-linked URLs, >greentext and line breaks.
export function formatBody(body, board) {
  const parts = String(body).split(/\[code\]([\s\S]*?)\[\/code\]/gi);
  return parts.map((part, i) => (i % 2
    ? `<pre class="code">${esc(part.replace(/^\n+|\n+$/g, ''))}</pre>`
    : formatText(part, board))).join('');
}

function formatText(text, board) {
  if (!text) return '';
  const html = text.split('\n').map((line) => {
    let h = esc(line);
    h = h.replace(/&gt;&gt;&gt;\/([a-z0-9]{1,16})\/(\d+)?/g, (_, b, id) => (id
      ? `<a class="quotelink" data-board="${b}" data-id="${id}" href="/${b}/post/${id}">&gt;&gt;&gt;/${b}/${id}</a>`
      : `<a href="/${b}/">&gt;&gt;&gt;/${b}/</a>`));
    h = h.replace(/&gt;&gt;(\d+)/g,
      (_, id) => `<a class="quotelink" data-board="${board}" data-id="${id}" href="/${board}/post/${id}">&gt;&gt;${id}</a>`);
    h = h.replace(/(https?:\/\/[^\s<]+)/g,
      (url) => `<a href="${url}" rel="nofollow noopener noreferrer ugc" target="_blank">${url}</a>`);
    if (line.startsWith('>') && !line.startsWith('>>')) h = `<span class="greentext">${h}</span>`;
    return h;
  }).join('<br>');
  return html.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<span class="spoiler">$1</span>');
}

// IDs of posts quoted with >>123 (same board) in a body; used for backlinks.
export function quotedIds(body) {
  const out = new Set();
  for (const m of String(body).matchAll(/(?<!>)>>(\d+)/g)) out.add(Number(m[1]));
  return out;
}

// "DE" -> regional-indicator flag emoji
export function flagEmoji(cc) {
  if (!/^[A-Z]{2}$/.test(cc || '')) return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Stable colour for a poster ID
export function idColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 60% 45%)`;
}

// Public URL for a post's file. Never reveals the on-disk path.
export function mediaUrl(postId, mime) {
  return `/media/${postId}.${String(mime || '').split('/')[1] || 'bin'}`;
}
export const thumbUrl = (postId) => `/media/thumb/${postId}.jpg`;

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtDate(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
