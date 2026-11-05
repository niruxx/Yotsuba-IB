export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Renders post bodies: escapes HTML, then adds >>quote links, >greentext and line breaks.
export function formatBody(body, board) {
  return body.split('\n').map((line) => {
    let html = esc(line);
    html = html.replace(/&gt;&gt;(\d+)/g,
      (_, id) => `<a class="quotelink" href="/${board}/post/${id}">&gt;&gt;${id}</a>`);
    html = html.replace(/(https?:\/\/[^\s<]+)/g,
      (url) => `<a href="${url}" rel="nofollow noopener noreferrer" target="_blank">${url}</a>`);
    if (line.startsWith('>') && !line.startsWith('>>')) html = `<span class="greentext">${html}</span>`;
    return html;
  }).join('<br>');
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtDate(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
