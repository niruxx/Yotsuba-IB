import { esc, fmtSize, mediaUrl, thumbUrl } from './format.js';
import { page } from './adminViews.js';
import { SECTION_TYPES, LABELS } from './homepage.js';

// Plain text with blank-line paragraphs, line breaks, auto-linked URLs and {site}. No HTML allowed.
function richText(text, siteName) {
  return esc(String(text || '').replaceAll('{site}', siteName)).split(/\n{2,}/).map((para) => `<p>${para
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener" target="_blank">$1</a>')
    .replace(/(^|\s)\/([a-z0-9]{1,16})\//g, '$1<a href="/$2/">/$2/</a>')
    .replace(/\n/g, '<br>')}</p>`).join('');
}

const ago = (ms) => {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

function boardsLegacy(cfg, boards, L) {
  const groups = new Map();
  for (const b of boards) {
    const key = b.category || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  if (!boards.length) return `<p class="empty">${esc(L.no_boards)}</p>`;
  return `<div class="hp-columns" style="--hp-cols:${cfg.columns}">${[...groups].map(([cat, list]) => `<div class="hp-col">
    ${cat ? `<h3>${esc(cat)}</h3>` : ''}
    <ul>${list.map((b) => `<li><a href="/${esc(b.slug)}/" title="${esc(b.bio)}">${esc(b.title)}</a>${b.nsfw ? ` <small class="nsfw">${esc(L.nsfw_badge)}</small>` : ''}${b.hidden ? ' <small class="hiddenboard">(hidden)</small>' : ''}</li>`).join('')}</ul>
  </div>`).join('')}</div>`;
}

function boardsStandard(boards, L) {
  if (!boards.length) return `<p class="empty">${esc(L.no_boards)}</p>`;
  return `<input type="search" class="hp-board-filter" placeholder="${esc(L.boards_filter)}">
<table class="grid hp-board-table">
  <thead><tr>
    <th data-sort="text">${esc(L.col_board)}</th><th data-sort="text">${esc(L.col_title)}</th>
    <th data-sort="num">${esc(L.col_pph)}</th><th data-sort="num">${esc(L.col_threads)}</th>
    <th data-sort="num">${esc(L.col_posts)}</th><th data-sort="num">${esc(L.col_active)}</th>
  </tr></thead>
  <tbody>${boards.map((b) => `<tr data-text="${esc(`${b.slug} ${b.title} ${b.bio} ${b.category}`.toLowerCase())}">
    <td data-v="${esc(b.slug)}"><a href="/${esc(b.slug)}/">/${esc(b.slug)}/</a></td>
    <td data-v="${esc(b.title)}">${esc(b.title)}${b.nsfw ? ` <small class="nsfw">${esc(L.nsfw_badge)}</small>` : ''}${b.hidden ? ' <small class="hiddenboard">(hidden)</small>' : ''}
      ${b.bio ? `<br><small>${esc(b.bio)}</small>` : ''}</td>
    <td data-v="${b.pph}">${b.pph}</td><td data-v="${b.threads}">${b.threads}</td><td data-v="${b.posts}">${b.posts}</td>
    <td data-v="${b.last_post || 0}">${ago(b.last_post)}</td>
  </tr>`).join('')}</tbody>
</table>`;
}

function popular(list) {
  if (!list?.length) return '<p class="empty">Nothing yet.</p>';
  return `<div class="hp-popular">${list.map((t) => `<a class="hp-pop" href="/${esc(t.board)}/thread/${t.id}">
    <span class="hp-pop-board">/${esc(t.board)}/</span>
    ${t.spoiler ? '<span class="spoiler-img">Spoiler</span>'
    : `<img src="${t.thumb ? thumbUrl(t.id) : mediaUrl(t.id, t.file_mime)}" alt="" loading="lazy">`}
    <span class="hp-pop-text">${t.subject ? `<b>${esc(t.subject)}</b>: ` : ''}${esc(t.body.slice(0, 90))}</span>
    <small>${t.reply_count} replies</small>
  </a>`).join('')}</div>`;
}

function latest(list) {
  if (!list?.length) return '<p class="empty">Nothing yet.</p>';
  return `<ul class="hp-latest">${list.map((p) => `<li><a href="/${esc(p.board)}/post/${p.id}">/${esc(p.board)}/ No.${p.id}</a>
    <span class="date" data-time="${p.created}">${ago(p.created)}</span> ${esc((p.subject ? `[${p.subject}] ` : '') + p.body).slice(0, 120)}</li>`).join('')}</ul>`;
}

function stats(s, L) {
  return `<div class="hp-stats">
    <span><b>${esc(L.stat_posts)}:</b> ${s.posts.toLocaleString('en')}</span>
    <span><b>${esc(L.stat_posters)}:</b> ${s.posters}</span>
    <span><b>${esc(L.stat_content)}:</b> ${fmtSize(s.bytes)}</span>
    <span><b>${esc(L.stat_boards)}:</b> ${s.boards}</span>
  </div>`;
}

export function homePage(cfg, data, siteName) {
  const L = cfg.labels;
  const body = (s) => {
    switch (s.id) {
      case 'intro': return richText(s.body, siteName);
      case 'boards': return cfg.layout === 'standard' ? boardsStandard(data.boards, L) : boardsLegacy(cfg, data.boards, L);
      case 'popular': return popular(data.popular);
      case 'latest': return latest(data.latest);
      case 'stats': return data.stats ? stats(data.stats, L) : '';
      default: return richText(s.body, siteName);
    }
  };
  const title = (s) => esc(String(s.title || '').replaceAll('{site}', siteName));
  return `<div class="hp hp-${cfg.layout}">
  <header class="hp-logo">
    ${cfg.logo ? `<img src="/branding/logo" alt="${esc(siteName)}">` : `<h1>${esc(siteName)}</h1>`}
    ${cfg.tagline ? `<p class="hp-tagline">${esc(cfg.tagline)}</p>` : ''}
  </header>
  ${cfg.sections.filter((s) => s.enabled).map((s) => `<section class="hp-box hp-${s.id}">
    ${s.title ? `<h2 class="hp-box-title">${title(s)}</h2>` : ''}
    <div class="hp-box-body">${body(s)}</div>
  </section>`).join('\n')}
</div>`;
}

export function homepageEditor(a, cfg, msg) {
  const L = cfg.labels;
  return page(a, 'Homepage', msg, `
<section class="box">
  <h2>Quick presets</h2>
  <p><small>Applies a layout plus section order and visibility. Your titles, texts and renamed labels are kept.</small></p>
  <form method="post" action="/admin/homepage" enctype="multipart/form-data" class="inline">
    <button name="preset" value="legacy">4chan style (Legacy)</button>
    <button name="preset" value="standard">8kun style (Standard)</button>
  </form>
  <a href="/" target="_blank">View homepage ↗</a>
</section>
<form class="box hp-editor" method="post" action="/admin/homepage" enctype="multipart/form-data">
  <h2>Layout &amp; branding</h2>
  <label>Layout <select name="layout">
    <option value="legacy" ${cfg.layout === 'legacy' ? 'selected' : ''}>Legacy: logo, intro, boards in category columns, popular-thread grid</option>
    <option value="standard" ${cfg.layout === 'standard' ? 'selected' : ''}>Standard: sortable board table with posts/hour and activity</option>
  </select></label>
  <label>Tagline <input name="tagline" value="${esc(cfg.tagline)}" maxlength="200" placeholder="shown under the logo"></label>
  <label>Logo image <input type="file" name="logo" accept="image/png,image/jpeg,image/gif,image/webp">
    <small>Replaces the site name at the top of the home page. Max 2 MB.</small></label>
  ${cfg.logo ? '<p><img src="/branding/logo" alt="" class="hp-logo-preview"> <label class="check"><input type="checkbox" name="remove_logo"> Remove logo</label></p>' : ''}
  <label>Board columns (Legacy) <input type="number" name="columns" min="1" max="6" value="${cfg.columns}"></label>
  <label>Popular threads to show <input type="number" name="popularCount" min="1" max="24" value="${cfg.popularCount}"></label>
  <label>Latest posts to show <input type="number" name="latestCount" min="1" max="50" value="${cfg.latestCount}"></label>
  <label class="check"><input type="checkbox" name="popularSfwOnly" ${cfg.popularSfwOnly ? 'checked' : ''}> Keep NSFW boards out of Popular threads and Latest posts</label>

  <h2>Sections</h2>
  <p><small>Tick to show, number to order (lowest first). Titles and texts can use <code>{site}</code> for the site name.
  Texts are plain text: blank lines start paragraphs, URLs and /board/ names become links.</small></p>
  <table class="grid hp-sections">
    <tr><th>Show</th><th>Order</th><th>Section</th><th>Title</th></tr>
    ${cfg.sections.map((s, i) => `<tr>
      <td><input type="checkbox" name="enabled_${s.id}" ${s.enabled ? 'checked' : ''}></td>
      <td><input type="number" name="order_${s.id}" value="${i + 1}" min="1" max="20" style="width:50px"></td>
      <td>${esc(SECTION_TYPES[s.id])}</td>
      <td><input name="title_${s.id}" value="${esc(s.title)}" maxlength="100" placeholder="(no heading)">
        ${'body' in s ? `<textarea name="body_${s.id}" rows="4" maxlength="5000" placeholder="text">${esc(s.body)}</textarea>` : ''}</td>
    </tr>`).join('')}
  </table>

  <h2>Rename interface text</h2>
  <p><small>Leave a box empty to use the default shown in grey.</small></p>
  <div class="hp-labels">
  ${Object.entries(LABELS).map(([k, [desc, def]]) => `<label>${esc(desc)}
    <input name="label_${k}" value="${L[k] === def ? '' : esc(L[k])}" placeholder="${esc(def)}" maxlength="100"></label>`).join('')}
  </div>
  <button>Save homepage</button>
</form>`);
}
