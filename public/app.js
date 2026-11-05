// Yotsuba-IB client script. Everything here is optional sugar on top of plain server-rendered pages:
// with JavaScript off, boards, threads, posting and expansion links still work.
//
// All features are configured in the settings panel (top-right "settings"), grouped like 4chan's:
// Quotes & Replying, Monitoring, Filters & Post Hiding, Navigation, Images & Media, Miscellaneous.
// Preferences are stored per browser in localStorage.
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } },
  };
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // ======================================================================
  // Settings schema: builds the panel and supplies defaults
  // ======================================================================
  const SCHEMA = [
    ['Quotes & Replying', [
      ['quotePreview', 'bool', true, 'Quote previews', 'Show a post when hovering a >>link to it.'],
      ['quoteHighlight', 'bool', true, 'Quote highlighting', 'Highlight the quoted post while hovering its link.'],
      ['inlineQuotes', 'bool', false, 'Inline quote expansion', 'Clicking a >>link expands the post inline instead of jumping to it.'],
      ['backlinks', 'bool', true, 'Backlinks', 'Show links to the replies under each post.'],
      ['quickReply', 'bool', true, 'Quick Reply', 'Clicking a post number opens the floating reply box.'],
      ['persistentQR', 'bool', false, 'Persistent Quick Reply', 'Re-open the reply box after posting.'],
      ['markYou', 'bool', true, '(You) markers', 'Mark your own posts and quotes of them.'],
      ['highlightYou', 'bool', true, 'Highlight replies to (You)', 'Give posts that quote you a coloured edge.'],
    ]],
    ['Monitoring', [
      ['autoUpdate', 'bool', true, 'Thread updater', 'Fetch new replies automatically.'],
      ['updateInterval', 'number', 10, 'Update interval (seconds)', 'Slows down automatically while a thread is quiet.', { min: 5, max: 300 }],
      ['unreadTitle', 'bool', true, 'Unread count in tab title', 'Show "(3)" in the title while the tab is in the background.'],
      ['autoScroll', 'bool', false, 'Auto-scroll', 'Scroll to new replies if you are at the bottom of the thread.'],
      ['showWatcher', 'bool', true, 'Thread watcher', 'Show the list of watched threads.'],
      ['autoWatch', 'bool', true, 'Auto-watch', 'Watch threads you create or reply to.'],
      ['notifyYou', 'bool', false, 'Desktop notifications', 'Notify when someone replies to you (needs browser permission).'],
    ]],
    ['Filters & Post Hiding', [
      ['filters', 'textarea', '', 'Filters', 'One rule per line. Plain text or /regex/i hides matching posts; prefix with + to highlight instead. '
        + 'Field rules: name:Anon, trip:!abc123, id:Ab12Cd34, file:cat.jpg.'],
      ['stubs', 'bool', true, 'Show stubs', 'Leave a small "hidden" line where a post was hidden (off = remove it entirely).'],
      ['recursiveHide', 'bool', false, 'Recursive hiding', 'Also hide replies to hidden posts.'],
      ['hideButtons', 'bool', true, 'Hide buttons', 'Show the [–] button on posts.'],
      ['_clearHidden', 'button', null, 'Unhide all manually hidden posts'],
    ]],
    ['Navigation', [
      ['keybinds', 'bool', true, 'Keyboard shortcuts', 'Q reply · R update · J/K next/previous post · I expand images · S settings · Esc close.'],
      ['fixedHeader', 'bool', false, 'Fixed top bar', 'Keep the board list visible while scrolling.'],
      ['customNav', 'text', '', 'Custom board list', 'Space-separated boards for the top bar, e.g. "g v tv" (blank = all boards).'],
      ['threadExpansion', 'bool', true, 'Thread expansion', 'Expand omitted replies in place on the board index.'],
      ['unreadLine', 'bool', true, 'Last-read marker', 'Draw a line after the last post you saw in a thread.'],
      ['jumpUnread', 'bool', false, 'Jump to unread', 'Scroll to the last-read marker when opening a thread.'],
    ]],
    ['Images & Media', [
      ['hoverImages', 'bool', false, 'Image hover', 'Show the full image or video when hovering a thumbnail.'],
      ['fitWidth', 'bool', true, 'Fit width', 'Expanded images never exceed the window width.'],
      ['fitHeight', 'bool', false, 'Fit height', 'Expanded images never exceed the window height.'],
      ['revealSpoilers', 'bool', false, 'Reveal spoilers', 'Show thumbnails of spoilered images.'],
      ['hideThumbs', 'bool', false, 'Hide thumbnails', 'Text-only browsing; file links stay.'],
      ['autoplay', 'bool', true, 'Autoplay videos', 'Start videos when expanded.'],
      ['loopVideos', 'bool', true, 'Loop videos', ''],
      ['unmute', 'bool', false, 'Play videos with sound', ''],
      ['volume', 'range', 0.5, 'Default volume', '', { min: 0, max: 1, step: 0.05 }],
    ]],
    ['Miscellaneous', [
      ['theme', 'select', 'yotsuba-b', 'Theme', '', { options: [['yotsuba', 'Yotsuba'], ['yotsuba-b', 'Yotsuba B'], ['tomorrow', 'Tomorrow (dark)']] }],
      ['relativeDates', 'bool', false, 'Relative dates', 'Show "5 minutes ago" (hover for the exact time).'],
      ['localTime', 'bool', true, 'Local time', 'Show dates in your time zone instead of UTC.'],
      ['customCSS', 'textarea', '', 'Custom CSS', 'Applied to every page.'],
      ['_export', 'button', null, 'Export settings'],
      ['_import', 'button', null, 'Import settings'],
      ['_reset', 'button', null, 'Reset all settings'],
    ]],
  ];
  const DEFAULTS = {};
  for (const [, opts] of SCHEMA) for (const [key, type, def] of opts) if (type !== 'button') DEFAULTS[key] = def;
  const prefs = { ...DEFAULTS, ...store.get('prefs', {}) };
  const listeners = new Map(); // pref key -> [fn]
  const onPref = (key, fn) => { if (!listeners.has(key)) listeners.set(key, []); listeners.get(key).push(fn); };
  function setPref(key, value) {
    prefs[key] = value;
    store.set('prefs', prefs);
    (listeners.get(key) || []).forEach((fn) => fn(value));
  }

  // ---------- page context ----------
  const parts = location.pathname.split('/');
  const boardSlug = parts[1] || '';
  const thread = $('#thread');
  const threadId = thread ? parts[3] : null;
  const mainForm = $('#postform');
  const root = document.documentElement;

  // ======================================================================
  // Settings panel
  // ======================================================================
  const panel = $('#settings-panel');
  function buildPanel() {
    const tabs = SCHEMA.map(([name], i) => `<button type="button" class="tab${i ? '' : ' active'}" data-tab="${i}">${escHtml(name)}</button>`).join('');
    const pages = SCHEMA.map(([, opts], i) => `<div class="tabpage" data-page="${i}"${i ? ' hidden' : ''}>${opts.map(([key, type, , label, help, extra = {}]) => {
      const h = help ? `<small>${escHtml(help)}</small>` : '';
      if (type === 'bool') return `<label class="opt"><input type="checkbox" data-pref="${key}"> <b>${escHtml(label)}</b> ${h}</label>`;
      if (type === 'button') return `<button type="button" class="optbtn" data-action="${key}">${escHtml(label)}</button>`;
      if (type === 'select') {
        return `<label class="opt"><b>${escHtml(label)}</b> <select data-pref="${key}">${extra.options.map(([v, t]) => `<option value="${v}">${escHtml(t)}</option>`).join('')}</select> ${h}</label>`;
      }
      if (type === 'textarea') return `<label class="opt block"><b>${escHtml(label)}</b> ${h}<textarea data-pref="${key}" rows="5" spellcheck="false"></textarea></label>`;
      const attrs = Object.entries(extra).map(([k, v]) => `${k}="${v}"`).join(' ');
      return `<label class="opt"><b>${escHtml(label)}</b> <input type="${type}" data-pref="${key}" ${attrs}> ${h}</label>`;
    }).join('')}</div>`).join('');
    panel.innerHTML = `<div class="sp-head"><b>Settings</b> <small>saved in this browser</small><a href="#" class="sp-close" title="close">×</a></div>
      <div class="tabs">${tabs}</div>${pages}`;
    $$('[data-pref]', panel).forEach((el) => {
      const key = el.dataset.pref;
      if (el.type === 'checkbox') el.checked = !!prefs[key]; else el.value = prefs[key];
      el.addEventListener(el.tagName === 'TEXTAREA' || el.type === 'text' ? 'change' : 'input', () => {
        setPref(key, el.type === 'checkbox' ? el.checked : (el.type === 'range' || el.type === 'number') ? Number(el.value) : el.value);
      });
    });
    panel.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) {
        $$('.tab', panel).forEach((t) => t.classList.toggle('active', t === tab));
        $$('.tabpage', panel).forEach((p) => { p.hidden = p.dataset.page !== tab.dataset.tab; });
      }
      if (e.target.closest('.sp-close')) { e.preventDefault(); panel.hidden = true; }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === '_clearHidden') { hiddenPosts.clear(); store.set('hiddenPosts', []); applyHiding(); }
      if (action === '_export') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify({ prefs, watched, hiddenPosts: [...hiddenPosts] }, null, 2)], { type: 'application/json' }));
        a.download = 'yotsuba-settings.json';
        a.click();
      }
      if (action === '_import') {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
        input.onchange = async () => {
          try {
            const data = JSON.parse(await input.files[0].text());
            if (data.prefs) store.set('prefs', { ...DEFAULTS, ...data.prefs });
            if (data.watched) store.set('watched', data.watched);
            if (data.hiddenPosts) store.set('hiddenPosts', data.hiddenPosts);
            location.reload();
          } catch { alert('That file is not a Yotsuba-IB settings export.'); }
        };
        input.click();
      }
      if (action === '_reset' && confirm('Reset all settings to their defaults?')) { store.set('prefs', {}); location.reload(); }
    });
  }
  buildPanel();
  const toggleSettings = (show = panel.hidden) => { panel.hidden = !show; };
  $('#open-settings')?.addEventListener('click', (e) => { e.preventDefault(); toggleSettings(); });

  // ======================================================================
  // Miscellaneous: theme, custom CSS, dates, announcement
  // ======================================================================
  const applyTheme = () => { root.dataset.theme = prefs.theme; };
  applyTheme(); onPref('theme', applyTheme);

  const customStyle = document.createElement('style');
  customStyle.id = 'custom-css';
  document.head.appendChild(customStyle);
  const applyCss = () => { customStyle.textContent = prefs.customCSS; };
  applyCss(); onPref('customCSS', applyCss);

  // Body classes driven by simple boolean prefs (CSS does the rest)
  const CLASS_PREFS = { fixedHeader: 'fixed-header', hideThumbs: 'no-thumbs', fitWidth: 'fit-width', fitHeight: 'fit-height' };
  const NEG_CLASS_PREFS = { backlinks: 'no-backlinks', hideButtons: 'no-hide-buttons', markYou: 'no-you', highlightYou: 'no-you-highlight' };
  const applyClasses = () => {
    for (const [k, c] of Object.entries(CLASS_PREFS)) root.classList.toggle(c, !!prefs[k]);
    for (const [k, c] of Object.entries(NEG_CLASS_PREFS)) root.classList.toggle(c, !prefs[k]);
  };
  applyClasses();
  [...Object.keys(CLASS_PREFS), ...Object.keys(NEG_CLASS_PREFS)].forEach((k) => onPref(k, applyClasses));

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function relTime(ms) {
    const s = Math.round((ms - Date.now()) / 1000);
    for (const [unit, sec] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
    }
    return rtf.format(s, 'second');
  }
  function formatDates(scope = document) {
    $$('.date[data-time]', scope).forEach((el) => {
      const t = Number(el.dataset.time);
      const d = new Date(t);
      const abs = prefs.localTime ? d.toLocaleString() : `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
      el.textContent = prefs.relativeDates ? relTime(t) : abs;
      el.title = prefs.relativeDates ? abs : '';
    });
  }
  formatDates();
  onPref('relativeDates', () => formatDates()); onPref('localTime', () => formatDates());
  setInterval(() => { if (prefs.relativeDates) formatDates(); }, 60_000);

  const ann = $('.announcement');
  if (ann) {
    if (store.get('hiddenAnnouncement') === ann.dataset.hash) ann.remove();
    else $('.dismiss-announcement', ann).onclick = (e) => { e.preventDefault(); store.set('hiddenAnnouncement', ann.dataset.hash); ann.remove(); };
  }

  // ======================================================================
  // Navigation: custom board list
  // ======================================================================
  const navEl = $('.boardnav');
  const originalNav = navEl?.innerHTML;
  function applyNav() {
    if (!navEl) return;
    const list = String(prefs.customNav || '').split(/[\s,]+/).map((b) => b.replace(/\//g, '')).filter((b) => /^[a-z0-9]{1,16}$/.test(b));
    navEl.innerHTML = list.length ? `[ ${list.map((b) => `<a href="/${b}/">${b}</a>`).join(' / ')} ]` : originalNav;
  }
  applyNav(); onPref('customNav', applyNav);

  // ======================================================================
  // Deletion password + (You) tracking
  // ======================================================================
  let delpw = localStorage.getItem('delpw');
  if (!delpw) { delpw = Math.random().toString(36).slice(2, 12); localStorage.setItem('delpw', delpw); }
  const fillPw = (scope = document) => $$('input.delpw', scope).forEach((i) => { if (!i.value) i.value = delpw; });
  fillPw();

  const mine = new Set(store.get('myPosts', []));
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.classList.contains('postform')) return;
    const v = $('input.delpw', f)?.value;
    if (v) localStorage.setItem('delpw', v);
    sessionStorage.setItem('justPosted', '1');
    if (f.closest('#quick-reply')) sessionStorage.setItem('fromQR', '1');
  });
  const justPosted = sessionStorage.getItem('justPosted');
  sessionStorage.removeItem('justPosted');
  if (justPosted) {
    const m = /^#p(\d+)$/.exec(location.hash);
    const newest = m ? Number(m[1]) : Number($('#thread .post.op')?.dataset.id || 0);
    if (newest) { mine.add(newest); store.set('myPosts', [...mine].slice(-3000)); }
  }
  function markYou(scope = document) {
    $$('.post', scope).forEach((p) => {
      if (mine.has(Number(p.dataset.id))) p.classList.add('mine');
      if ([...$$('blockquote a.quotelink', p)].some((a) => mine.has(Number(a.dataset.id)))) p.classList.add('quotes-you');
    });
    $$('.quotelink', scope).forEach((a) => {
      if (mine.has(Number(a.dataset.id)) && !$('.you', a)) a.insertAdjacentHTML('beforeend', '<span class="you"> (You)</span>');
    });
  }
  markYou();

  // ======================================================================
  // Images & Media
  // ======================================================================
  const applyVideoPrefs = (v) => { v.muted = !prefs.unmute; v.volume = prefs.volume; v.loop = !!prefs.loopVideos; };
  onPref('unmute', () => $$('video').forEach(applyVideoPrefs));
  onPref('volume', () => $$('video').forEach(applyVideoPrefs));

  function revealSpoilers(scope = document) {
    if (!prefs.revealSpoilers) return;
    $$('.spoiler-img[data-thumb]', scope).forEach((s) => {
      const img = Object.assign(document.createElement('img'), { className: 'media', src: s.dataset.thumb, alt: '' });
      s.replaceWith(img);
    });
  }
  revealSpoilers(); onPref('revealSpoilers', () => revealSpoilers());

  function toggleImage(t, force) {
    if (t.dataset.type === 'video') return toggleVideo(t, force);
    const expand = force ?? !t.classList.contains('expanded');
    if (expand === t.classList.contains('expanded')) return;
    let img = $('img', t);
    if (!img) { // spoiler placeholder: replace it with the real image once opened
      if (!expand) return;
      $('.spoiler-img', t)?.remove();
      img = Object.assign(document.createElement('img'), { className: 'media', alt: '' });
      t.prepend(img);
    }
    if (expand) {
      if (!('thumb' in img.dataset)) img.dataset.thumb = img.getAttribute('src') || '';
      img.src = t.dataset.full;
    } else if (img.dataset.thumb) img.src = img.dataset.thumb;
    t.classList.toggle('expanded', expand);
  }
  function toggleVideo(t, force) {
    const open = t.nextElementSibling?.classList.contains('expanded-video');
    const expand = force ?? !open;
    if (expand === open) return;
    if (!expand) { t.nextElementSibling.remove(); t.hidden = false; return; }
    const wrap = document.createElement('div');
    wrap.className = 'expanded-video';
    wrap.innerHTML = '<a href="#" class="media-close">[close]</a><br>';
    const v = Object.assign(document.createElement('video'), { src: t.dataset.full, controls: true, autoplay: !!prefs.autoplay, className: 'media full' });
    applyVideoPrefs(v);
    v.addEventListener('volumechange', () => { if (!v.muted) setPref('volume', v.volume); });
    wrap.appendChild(v);
    t.hidden = true;
    t.after(wrap);
  }
  document.addEventListener('click', (e) => {
    const close = e.target.closest('.media-close');
    if (close) { e.preventDefault(); toggleVideo(close.parentElement.previousElementSibling, false); return; }
    const t = e.target.closest('a.thumb');
    if (!t || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    toggleImage(t);
    hideHover();
  });
  let allExpanded = false;
  function expandAll() {
    allExpanded = !allExpanded;
    $$('a.thumb[data-type="image"]').forEach((t) => toggleImage(t, allExpanded));
    $$('.expand-all').forEach((a) => { a.textContent = allExpanded ? '[Collapse images]' : '[Expand images]'; });
  }
  $$('.boardtabs').forEach((nav) => nav.insertAdjacentHTML('beforeend', ' <a href="#" class="expand-all">[Expand images]</a>'));
  document.addEventListener('click', (e) => { if (e.target.closest('.expand-all')) { e.preventDefault(); expandAll(); } });

  const hoverBox = Object.assign(document.createElement('div'), { id: 'hover-media' });
  document.body.appendChild(hoverBox);
  function hideHover() { hoverBox.replaceChildren(); hoverBox.hidden = true; }
  hideHover();
  document.addEventListener('mouseover', (e) => {
    if (!prefs.hoverImages || matchMedia('(hover: none)').matches) return;
    const t = e.target.closest('a.thumb');
    if (!t || t.classList.contains('expanded') || !$('img', t)) return;
    if (t.dataset.type === 'video') {
      const v = Object.assign(document.createElement('video'), { src: t.dataset.full, autoplay: true });
      applyVideoPrefs(v);
      hoverBox.replaceChildren(v);
    } else hoverBox.replaceChildren(Object.assign(document.createElement('img'), { src: t.dataset.full, alt: '' }));
    hoverBox.hidden = false;
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('a.thumb')) hideHover(); });

  // ======================================================================
  // Quotes: hover previews, highlighting, inline expansion
  // ======================================================================
  const postCache = new Map();
  async function findPost(board, id) {
    const local = document.getElementById(`p${id}`);
    if (local && (!board || board === boardSlug)) return local;
    const key = `${board}/${id}`;
    if (!postCache.has(key)) {
      postCache.set(key, fetch(`/${board}/post/${id}`).then((r) => (r.ok ? r.text() : null))
        .then((html) => (html ? new DOMParser().parseFromString(html, 'text/html').getElementById(`p${id}`) : null))
        .catch(() => null));
    }
    return postCache.get(key);
  }
  function cleanClone(post) {
    const c = post.cloneNode(true);
    c.removeAttribute('id');
    $$('form, details, .hide-post, .backlinks', c).forEach((x) => x.remove());
    c.classList.remove('highlight', 'user-hidden');
    return c;
  }
  const preview = Object.assign(document.createElement('div'), { id: 'quote-preview', hidden: true });
  document.body.appendChild(preview);
  document.addEventListener('mouseover', async (e) => {
    const a = e.target.closest('a.quotelink');
    if (!a) return;
    const local = document.getElementById(`p${a.dataset.id}`);
    if (prefs.quoteHighlight && local && !a.closest('#quote-preview')) local.classList.add('highlight');
    if (!prefs.quotePreview || matchMedia('(hover: none)').matches) return;
    const post = await findPost(a.dataset.board, a.dataset.id);
    if (!post || !a.matches(':hover')) return;
    preview.replaceChildren(cleanClone(post));
    preview.hidden = false;
    formatDates(preview);
    const r = a.getBoundingClientRect();
    const maxLeft = window.scrollX + document.documentElement.clientWidth - preview.offsetWidth - 10;
    preview.style.left = `${Math.max(window.scrollX + 4, Math.min(r.left + window.scrollX, maxLeft))}px`;
    preview.style.top = `${r.bottom + window.scrollY + 4}px`;
  });
  document.addEventListener('mouseout', (e) => {
    const a = e.target.closest('a.quotelink');
    if (!a) return;
    preview.hidden = true;
    document.getElementById(`p${a.dataset.id}`)?.classList.remove('highlight');
  });
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a.quotelink');
    if (!a || !prefs.inlineQuotes || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const next = a.nextElementSibling;
    if (next?.classList.contains('inline-quote')) { next.remove(); a.classList.remove('inlined'); return; }
    const post = await findPost(a.dataset.board, a.dataset.id);
    if (!post) { location.href = a.href; return; }
    const box = document.createElement('div');
    box.className = 'inline-quote';
    box.appendChild(cleanClone(post));
    formatDates(box);
    a.classList.add('inlined');
    a.after(box);
    preview.hidden = true;
  });

  // ======================================================================
  // Filters & post hiding
  // ======================================================================
  const hiddenPosts = new Set(store.get('hiddenPosts', []));
  const textOf = (post) => `${$('.subject', post)?.textContent || ''} ${$('blockquote', post)?.textContent || ''}`;
  function compileFilters() {
    return String(prefs.filters || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
      const highlight = line.startsWith('+');
      const rule = highlight ? line.slice(1).trim() : line;
      let test;
      const field = /^(name|trip|id|file):(.+)$/i.exec(rule);
      const re = /^\/(.+)\/([a-z]*)$/.exec(rule);
      if (field) {
        const want = field[2].trim().toLowerCase();
        const get = {
          name: (p) => p.dataset.name, trip: (p) => p.dataset.trip, id: (p) => p.dataset.poster,
          file: (p) => $('.fileinfo a', p)?.textContent,
        }[field[1].toLowerCase()];
        test = (p) => (get(p) || '').toLowerCase() === want;
      } else if (re) {
        try { const rx = new RegExp(re[1], re[2]); test = (p) => rx.test(textOf(p)); } catch { test = () => false; }
      } else {
        const needle = rule.toLowerCase();
        test = (p) => textOf(p).toLowerCase().includes(needle);
      }
      return { highlight, test };
    });
  }
  let filters = compileFilters();
  function setHidden(post, on, why = '') {
    post.classList.toggle('user-hidden', on);
    post.classList.toggle('no-stub', on && !prefs.stubs);
    $('.hidden-label', post)?.remove();
    if (on) $('.postinfo', post).insertAdjacentHTML('beforeend', `<span class="hidden-label">hidden${why ? ` (${escHtml(why)})` : ''}</span>`);
    const btn = $('.hide-post', post);
    if (btn) btn.textContent = on ? '[+]' : '[–]';
  }
  function applyHiding() {
    const posts = $$('.post').filter((p) => !p.closest('#quote-preview, .inline-quote'));
    const hiddenIds = new Set();
    for (const post of posts) {
      const isThreadOp = post.classList.contains('op') && post.closest('#thread');
      let why = '';
      if (hiddenPosts.has(`${post.dataset.board}/${post.dataset.id}`)) why = 'manually';
      const matches = isThreadOp ? [] : filters.filter((f) => f.test(post));
      if (!why && matches.some((f) => !f.highlight)) why = 'filtered';
      post.classList.toggle('filter-highlight', matches.some((f) => f.highlight));
      if (why) hiddenIds.add(post.dataset.id);
      setHidden(post, !!why, why === 'manually' ? '' : why);
    }
    if (prefs.recursiveHide) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const post of posts) {
          if (hiddenIds.has(post.dataset.id) || (post.classList.contains('op') && post.closest('#thread'))) continue;
          if ($$('blockquote a.quotelink', post).some((a) => hiddenIds.has(a.dataset.id))) {
            hiddenIds.add(post.dataset.id);
            setHidden(post, true, 'replies to a hidden post');
            changed = true;
          }
        }
      }
    }
  }
  document.addEventListener('click', (e) => {
    const h = e.target.closest('.hide-post');
    if (!h) return;
    e.preventDefault();
    const post = h.closest('.post');
    const key = `${post.dataset.board}/${post.dataset.id}`;
    if (post.classList.contains('user-hidden')) hiddenPosts.delete(key); else hiddenPosts.add(key);
    store.set('hiddenPosts', [...hiddenPosts].slice(-5000));
    applyHiding();
  });
  onPref('filters', () => { filters = compileFilters(); applyHiding(); });
  ['stubs', 'recursiveHide'].forEach((k) => onPref(k, applyHiding));
  applyHiding();

  // ======================================================================
  // Quick Reply
  // ======================================================================
  let qr = null;
  function openQuickReply(quoteId) {
    if (!thread || !mainForm) return false;
    if (!prefs.quickReply) { // fall back to the main form
      const ta = $('textarea[name="body"]', mainForm);
      if (quoteId) ta.value += `>>${quoteId}\n`;
      mainForm.scrollIntoView({ block: 'center' });
      ta.focus();
      return true;
    }
    if (!qr) {
      qr = document.createElement('div');
      qr.id = 'quick-reply';
      qr.innerHTML = `<div class="qr-head"><span>Reply to thread No.${threadId}</span><a href="#" class="qr-close" title="close">×</a></div>`;
      const form = mainForm.cloneNode(true);
      form.removeAttribute('id');
      form.classList.add('qr-form');
      $('input[name="name"]', form)?.setAttribute('placeholder', 'Name (Anonymous)');
      $('input[name="options"]', form)?.setAttribute('placeholder', 'Options (sage, nonoko)');
      $('textarea[name="body"]', form)?.setAttribute('placeholder', 'Comment');
      $('textarea[name="body"]', form)?.setAttribute('rows', '6');
      $('input[name="password"]', form)?.closest('tr')?.classList.add('qr-hidden-row');
      $('.formhelp', form)?.remove();
      qr.appendChild(form);
      document.body.appendChild(qr);
      fillPw(qr);
      $('.qr-close', qr).onclick = (ev) => { ev.preventDefault(); qr.hidden = true; };
      const head = $('.qr-head', qr);
      head.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('.qr-close')) return;
        const start = { x: ev.clientX, y: ev.clientY, l: qr.offsetLeft, t: qr.offsetTop };
        const move = (m) => Object.assign(qr.style, { left: `${start.l + m.clientX - start.x}px`, top: `${start.t + m.clientY - start.y}px`, right: 'auto', bottom: 'auto' });
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      });
    }
    qr.hidden = false;
    const ta = $('textarea', qr);
    if (quoteId && !ta.value.includes(`>>${quoteId}\n`)) {
      const sel = String(window.getSelection() || '').trim();
      ta.value += `>>${quoteId}\n${sel ? `${sel.split('\n').map((l) => `>${l}`).join('\n')}\n` : ''}`;
    }
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return true;
  }
  document.addEventListener('click', (e) => {
    if (!thread) return;
    const no = e.target.closest('a.postno');
    if (no) { if (openQuickReply(no.dataset.id)) e.preventDefault(); return; }
    if (e.target.closest('a.reply-link') && openQuickReply(null)) e.preventDefault();
  });
  if (thread) {
    const m = /^#q(\d+)$/.exec(location.hash);
    if (m) openQuickReply(m[1]);
    else if (location.hash === '#reply') openQuickReply(null);
    else if (justPosted && sessionStorage.getItem('fromQR') && prefs.persistentQR) openQuickReply(null);
  } else {
    $$('a.postno').forEach((a) => { a.href = a.href.replace(/#p(\d+)$/, '#q$1'); });
  }
  sessionStorage.removeItem('fromQR');

  // ======================================================================
  // Monitoring: thread watcher
  // ======================================================================
  const watched = store.get('watched', {});
  const saveWatched = () => store.set('watched', watched);
  const wBox = $('#watcher');
  const wList = $('#watcher-list');
  let wState = {};
  let wTimer = null;
  function renderWatcher() {
    const keys = Object.keys(watched);
    wBox.hidden = !prefs.showWatcher || keys.length === 0;
    wBox.classList.toggle('collapsed', !!store.get('watcherCollapsed', false));
    wList.replaceChildren();
    for (const key of keys) {
      const [b, id] = key.split(':');
      const st = wState[key] || {};
      const unread = st.replies != null && watched[key].seen != null ? Math.max(0, st.replies - watched[key].seen) : 0;
      const li = document.createElement('li');
      if (unread) li.className = 'new';
      if (st.deleted) li.className = 'dead';
      li.innerHTML = `<a href="#" class="w-del" title="unwatch">×</a> <a class="w-link" href="/${b}/thread/${id}">/${b}/ ${id}</a>`
        + `<span class="w-title"></span> ${unread ? `(${unread})` : ''}${st.archived ? ' [archived]' : ''}`;
      $('.w-title', li).textContent = ` - ${watched[key].title || ''}`;
      $('.w-del', li).onclick = (e) => { e.preventDefault(); delete watched[key]; saveWatched(); renderWatcher(); markWatchLinks(); };
      wList.appendChild(li);
    }
  }
  function markWatchLinks() {
    $$('a.watch').forEach((a) => {
      const post = a.closest('.post');
      const on = !!watched[`${post.dataset.board}:${post.dataset.id}`];
      a.classList.toggle('watching', on);
      a.textContent = on ? '[Unwatch]' : '[Watch]';
    });
  }
  async function pollWatcher() {
    clearTimeout(wTimer);
    const keys = Object.keys(watched);
    if (keys.length) {
      try {
        wState = await (await fetch(`/api/watch.json?t=${encodeURIComponent(keys.join(','))}`, { cache: 'no-store' })).json();
        const here = thread ? `${boardSlug}:${threadId}` : null;
        for (const k of keys) {
          const replies = wState[k]?.replies;
          if (replies != null && (watched[k].seen == null || k === here)) watched[k].seen = replies;
        }
        saveWatched();
      } catch { /* offline */ }
    }
    renderWatcher();
    wTimer = setTimeout(pollWatcher, 60_000);
  }
  const watchThread = (b, id, title) => { watched[`${b}:${id}`] = { title, seen: null }; saveWatched(); markWatchLinks(); pollWatcher(); };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.watch');
    if (!a) return;
    e.preventDefault();
    const post = a.closest('.post');
    const key = `${post.dataset.board}:${post.dataset.id}`;
    if (watched[key]) { delete watched[key]; saveWatched(); markWatchLinks(); pollWatcher(); } else watchThread(post.dataset.board, post.dataset.id, a.dataset.title);
  });
  $('#watcher-toggle')?.addEventListener('click', (e) => { e.preventDefault(); store.set('watcherCollapsed', !store.get('watcherCollapsed', false)); renderWatcher(); });
  onPref('showWatcher', renderWatcher);
  if (justPosted && thread && prefs.autoWatch && !watched[`${boardSlug}:${threadId}`]) {
    const op = $('.post.op', thread);
    watchThread(boardSlug, threadId, (op && ($('.subject', op)?.textContent || $('blockquote', op)?.textContent || '')).slice(0, 40));
  }
  markWatchLinks();
  pollWatcher();

  // ======================================================================
  // Monitoring: thread updater, last-read marker, notifications
  // ======================================================================
  const lastRead = store.get('lastRead', {});
  const threadKey = thread ? `${boardSlug}:${threadId}` : null;
  const lastPostId = () => Number($$('.post', thread).filter((p) => p.parentElement === thread).at(-1)?.dataset.id || 0);
  if (thread && prefs.unreadLine) {
    const seen = lastRead[threadKey];
    const marker = seen && document.getElementById(`p${seen}`);
    if (marker && seen < lastPostId()) {
      marker.insertAdjacentHTML('afterend', '<hr class="unread-line" title="new since your last visit">');
      if (prefs.jumpUnread && !location.hash) $('.unread-line').scrollIntoView({ block: 'center' });
    }
  }
  const saveLastRead = () => {
    if (!thread) return;
    lastRead[threadKey] = lastPostId();
    const keys = Object.keys(lastRead);
    if (keys.length > 500) delete lastRead[keys[0]];
    store.set('lastRead', lastRead);
  };
  addEventListener('pagehide', saveLastRead);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveLastRead(); });

  if (prefs.notifyYou && window.Notification && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }

  let updateNow = null;
  if (thread && $('#update-now')) {
    const status = $('#update-status');
    let last = Number(thread.dataset.last);
    let delay = prefs.updateInterval;
    let timer = null;
    let unseen = 0;
    const baseTitle = document.title;
    const addBacklinks = (post) => {
      $$('blockquote a.quotelink', post).forEach((q) => {
        if (q.dataset.board !== boardSlug) return;
        const target = document.getElementById(`p${q.dataset.id}`);
        if (!target) return;
        let bl = $('.backlinks', target);
        if (!bl) { bl = Object.assign(document.createElement('span'), { className: 'backlinks' }); $('.postinfo', target).appendChild(bl); }
        bl.insertAdjacentHTML('beforeend', ` <a class="quotelink" data-board="${boardSlug}" data-id="${post.dataset.id}" href="#p${post.dataset.id}">&gt;&gt;${post.dataset.id}</a>`);
      });
    };
    async function update(manual) {
      clearTimeout(timer);
      status.textContent = 'updating…';
      const atBottom = innerHeight + scrollY >= document.body.scrollHeight - 80;
      try {
        const r = await fetch(`/${boardSlug}/thread/${threadId}/updates?after=${last}`, { cache: 'no-store' });
        if (r.status === 404) { status.textContent = 'thread was deleted or pruned'; return; }
        const data = await r.json();
        let firstNew = null;
        for (const p of data.posts) {
          const tpl = document.createElement('template');
          tpl.innerHTML = p.html.trim();
          const el = tpl.content.firstElementChild;
          thread.appendChild(el);
          firstNew ||= el;
          addBacklinks(el); fillPw(el); markYou(el); formatDates(el); revealSpoilers(el);
          $$('video', el).forEach(applyVideoPrefs);
          last = Math.max(last, p.id);
          if (prefs.notifyYou && window.Notification && Notification.permission === 'granted' && el.classList.contains('quotes-you')) {
            const n = new Notification(`Reply to (You) in /${boardSlug}/`, { body: $('blockquote', el)?.textContent.slice(0, 140) || '', tag: `you-${p.id}` });
            n.onclick = () => { focus(); el.scrollIntoView({ block: 'center' }); };
          }
        }
        if (data.posts.length) { applyHiding(); markWatchLinks(); }
        $('#replycount').textContent = data.replies;
        if (data.posts.length) {
          delay = prefs.updateInterval;
          if (document.hidden && prefs.unreadTitle) { unseen += data.posts.length; document.title = `(${unseen}) ${baseTitle}`; }
          if (!document.hidden) saveLastRead();
          if (prefs.autoScroll && atBottom && firstNew) firstNew.scrollIntoView({ behavior: 'smooth', block: 'start' });
          status.textContent = `${data.posts.length} new`;
        } else {
          delay = Math.min(delay * 1.5, Math.max(120, prefs.updateInterval));
          status.textContent = manual ? 'no new replies' : '';
        }
        if (data.archived) { status.textContent = 'thread archived'; return; }
      } catch {
        status.textContent = 'update failed, retrying';
        delay = Math.min(delay * 2, 120);
      }
      if (prefs.autoUpdate) timer = setTimeout(update, delay * 1000);
    }
    updateNow = () => { delay = prefs.updateInterval; update(true); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { unseen = 0; document.title = baseTitle; } });
    $('#update-now').addEventListener('click', (e) => { e.preventDefault(); updateNow(); });
    onPref('autoUpdate', (on) => { clearTimeout(timer); if (on) timer = setTimeout(update, delay * 1000); });
    if (prefs.autoUpdate) timer = setTimeout(update, delay * 1000);
  }

  // ======================================================================
  // Navigation: thread expansion on the index
  // ======================================================================
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a.expand-thread');
    if (!a || !prefs.threadExpansion) return;
    e.preventDefault();
    const box = a.closest('.thread');
    if (box.dataset.expanded) {
      $$('.post.reply.expanded-reply', box).forEach((p) => p.remove());
      delete box.dataset.expanded;
      a.textContent = 'View thread';
      return;
    }
    a.textContent = 'loading…';
    try {
      const html = await (await fetch(a.href)).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const have = new Set($$('.post', box).map((p) => p.dataset.id));
      const omitted = a.closest('.omitted');
      const missing = $$('#thread > .post.reply', doc).filter((p) => !have.has(p.dataset.id));
      const firstShown = $('.post.reply', box);
      for (const p of missing) {
        const el = document.importNode(p, true);
        el.classList.add('expanded-reply');
        if (firstShown && Number(el.dataset.id) < Number(firstShown.dataset.id)) firstShown.before(el); else omitted.after(el);
        markYou(el); formatDates(el); revealSpoilers(el); fillPw(el);
      }
      applyHiding();
      box.dataset.expanded = '1';
      a.textContent = 'Collapse';
    } catch { location.href = a.href; }
  });

  // ======================================================================
  // Navigation: keyboard shortcuts
  // ======================================================================
  let cursor = -1;
  document.addEventListener('keydown', (e) => {
    if (!prefs.keybinds || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (qr && !qr.hidden) qr.hidden = true;
      panel.hidden = true;
      preview.hidden = true;
      if (isTyping(document.activeElement)) document.activeElement.blur();
      return;
    }
    if (isTyping(e.target)) return;
    const posts = $$('.post').filter((p) => p.offsetParent && !p.closest('#quote-preview, .inline-quote'));
    switch (e.key.toLowerCase()) {
      case 'q': if (openQuickReply(null)) e.preventDefault(); break;
      case 'r': if (updateNow) { e.preventDefault(); updateNow(); } break;
      case 'i': e.preventDefault(); expandAll(); break;
      case 's': e.preventDefault(); toggleSettings(); break;
      case 'j': case 'k': {
        e.preventDefault();
        if (cursor < 0 || !posts[cursor]) {
          cursor = posts.findIndex((p) => p.getBoundingClientRect().top >= 0);
          if (e.key.toLowerCase() === 'k') cursor = Math.max(0, cursor - 1);
        } else cursor = Math.max(0, Math.min(posts.length - 1, cursor + (e.key.toLowerCase() === 'j' ? 1 : -1)));
        $$('.post.kb-focus').forEach((p) => p.classList.remove('kb-focus'));
        posts[cursor]?.classList.add('kb-focus');
        posts[cursor]?.scrollIntoView({ block: 'center' });
        break;
      }
      default:
    }
  });

  // ======================================================================
  // Catalog filter + existing videos
  // ======================================================================
  const cf = $('#catalog-filter');
  cf?.addEventListener('input', () => {
    const q = cf.value.trim().toLowerCase();
    $$('.ctile').forEach((t) => { t.hidden = q && !t.dataset.text.includes(q); });
  });
  $$('video').forEach(applyVideoPrefs);
})();
