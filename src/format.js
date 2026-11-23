export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only known formatting tags become markup. User text is always escaped, including protected blocks.
export function formatBody(body, board) {
  const source = String(body), blocks = /\[(code|aa)\]([\s\S]*?)\[\/\1\]/gi;
  let result = '', offset = 0;
  for (const match of source.matchAll(blocks)) {
    result += formatInline(source.slice(offset, match.index), board);
    result += `<pre class="${match[1].toLowerCase() === 'aa' ? 'ascii-art' : 'code'}">${esc(match[2].replace(/^\n+|\n+$/g, ''))}</pre>`;
    offset = match.index + match[0].length;
  }
  return result + formatInline(source.slice(offset), board);
}
function formatInline(source, board) {
  const tags = { b: ['<strong>', '</strong>'], i: ['<em>', '</em>'], u: ['<span class="underline">', '</span>'], s: ['<s>', '</s>'], spoiler: ['<span class="spoiler">', '</span>'] };
  const stack = [{ tag: '', parts: [] }];
  const emit = (html) => stack.at(-1).parts.push(html);
  const text = (value, start) => {
    let offset = start;
    return value.split('\n').map((line) => {
      const beginning = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
      const green = source.startsWith('>', beginning) && !source.startsWith('>>', beginning);
      offset += line.length + 1;
      return green ? `<span class="greentext">${esc(line)}</span>` : esc(line);
    }).join('<br>');
  };
  const tokens = /\[(\/?)(b|i|u|s|spoiler)\]|https?:\/\/[^\s<>"'\[\]]+|>>>\/[a-z0-9]{1,16}\/\d*|(?<!>)>>\d+/gi;
  let offset = 0;
  for (const match of source.matchAll(tokens)) {
    emit(text(source.slice(offset, match.index), offset));
    const value = match[0];
    if (match[2]) {
      const tag = match[2].toLowerCase();
      if (!match[1] && stack.length < 17) stack.push({ tag, parts: [] });
      else if (match[1] && stack.at(-1).tag === tag) { const frame = stack.pop(); emit(tags[tag][0] + frame.parts.join('') + tags[tag][1]); }
      else emit(esc(value));
    } else if (/^https?:/i.test(value)) {
      const url = value.replace(/[.,!?;:)]+$/, '');
      emit(`<a href="${esc(url)}" rel="nofollow noopener noreferrer ugc" target="_blank">${esc(url)}</a>${esc(value.slice(url.length))}`);
    } else if (value.startsWith('>>>/')) {
      const [, slug, id] = /^>>>\/([a-z0-9]{1,16})\/(\d*)$/i.exec(value);
      emit(id ? `<a class="quotelink" data-board="${esc(slug)}" data-id="${id}" href="/${esc(slug)}/post/${id}">${esc(value)}</a>` : `<a href="/${esc(slug)}/">${esc(value)}</a>`);
    } else {
      const id = value.slice(2);
      emit(`<a class="quotelink" data-board="${esc(board)}" data-id="${id}" href="/${esc(board)}/post/${id}">${esc(value)}</a>`);
    }
    offset = match.index + value.length;
  }
  emit(text(source.slice(offset), offset));
  while (stack.length > 1) { const frame = stack.pop(); emit(esc('[' + frame.tag + ']') + frame.parts.join('')); }
  return stack[0].parts.join('');
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
