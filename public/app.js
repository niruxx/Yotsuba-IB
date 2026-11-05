// Yotsuba-IB client script: user preferences, media expansion, hover previews, (You) markers,
// poster-ID highlighting, quick reply, thread auto-update and catalog filtering.
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  };

  // ---------------- preferences ----------------
  const DEFAULTS = { theme: 'yotsuba-b', hoverImages: false, unmute: false, volume: 0.5, autoUpdate: true, filters: '' };
  const prefs = { ...DEFAULTS, ...store.get('prefs', {}) };
  const savePrefs = () => { store.set('prefs', prefs); document.documentElement.dataset.theme = prefs.theme; };
  document.documentElement.dataset.theme = prefs.theme;

  const panel = $('#settings-panel');
  $$('[data-pref]', panel).forEach((el) => {
    const key = el.dataset.pref;
    if (el.type === 'checkbox') el.checked = !!prefs[key]; else el.value = prefs[key];
    el.addEventListener('input', () => {
      prefs[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      savePrefs();
      if (key === 'volume' || key === 'unmute') $$('video').forEach(applyVideoPrefs);
    });
  });
  $('#open-settings')?.addEventListener('click', (e) => { e.preventDefault(); panel.hidden = !panel.hidden; });
  $('#close-settings')?.addEventListener('click', () => { panel.hidden = true; });

  function applyVideoPrefs(v) { v.muted = !prefs.unmute; v.volume = prefs.volume; }

  // ---------------- announcement ----------------
  const ann = $('.announcement');
  if (ann) {
    if (store.get('hiddenAnnouncement') === ann.dataset.hash) ann.remove();
    else $('.dismiss-announcement', ann).onclick = (e) => { e.preventDefault(); store.set('hiddenAnnouncement', ann.dataset.hash); ann.remove(); };
  }

  // ---------------- deletion password ----------------
  let pw = localStorage.getItem('delpw');
  if (!pw) { pw = Math.random().toString(36).slice(2, 12); localStorage.setItem('delpw', pw); }
  const fillPw = (root = document) => $$('input.delpw', root).forEach((i) => { if (!i.value) i.value = pw; });
  fillPw();

  // ---------------- (You) tracking ----------------
  const mine = new Set(store.get('myPosts', []));
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.classList.contains('postform')) return;
    const v = $('input.delpw', f)?.value;
    if (v) localStorage.setItem('delpw', v);
    sessionStorage.setItem('justPosted', '1');
  });
  if (sessionStorage.getItem('justPosted')) {
    sessionStorage.removeItem('justPosted');
    const m = /^#p(\d+)$/.exec(location.hash);
    const newest = m ? Number(m[1]) : Number($('#thread .post.op')?.dataset.id || 0);
    if (newest) { mine.add(newest); store.set('myPosts', [...mine].slice(-2000)); }
  }
  function markYou(root = document) {
    $$('.post', root).forEach((p) => { if (mine.has(Number(p.dataset.id))) p.classList.add('mine'); });
    $$('.quotelink', root).forEach((a) => {
      if (mine.has(Number(a.dataset.id)) && !a.dataset.you) { a.dataset.you = '1'; a.insertAdjacentText('beforeend', ' (You)'); }
    });
  }
  markYou();

  // ---------------- media: expand on click, hover preview ----------------
  document.addEventListener('click', (e) => {
    const close = e.target.closest('.media-close');
    if (close) {
      e.preventDefault();
      const wrap = close.parentElement;
      wrap.previousElementSibling.hidden = false;
      wrap.remove();
      return;
    }
    const t = e.target.closest('a.thumb');
    if (!t || e.ctrlKey || e.metaKey || e.button === 1) return;
    e.preventDefault();
    if (t.dataset.type === 'video') {
      const wrap = document.createElement('div');
      wrap.className = 'expanded-video';
      wrap.innerHTML = '<a href="#" class="media-close">[close]</a><br>';
      const v = document.createElement('video');
      v.src = t.dataset.full; v.controls = true; v.loop = true; v.autoplay = true; v.className = 'media full';
      applyVideoPrefs(v);
      v.addEventListener('volumechange', () => { if (!v.muted) { prefs.volume = v.volume; savePrefs(); } });
      wrap.appendChild(v);
      t.hidden = true;
      t.after(wrap);
      hideHover();
    } else {
      const img = $('img', t);
      if (!img) { t.classList.add('unspoiled'); t.innerHTML = `<img class="media" src="${t.dataset.full}" alt="">`; return; }
      if (t.classList.toggle('expanded')) { img.dataset.thumb = img.src; img.src = t.dataset.full; } else if (img.dataset.thumb) img.src = img.dataset.thumb;
      hideHover();
    }
  });

  const hoverBox = document.createElement('div');
  hoverBox.id = 'hover-media';
  document.body.appendChild(hoverBox);
  function hideHover() { hoverBox.innerHTML = ''; hoverBox.hidden = true; }
  hideHover();
  document.addEventListener('mouseover', (e) => {
    if (!prefs.hoverImages) return;
    const t = e.target.closest('a.thumb');
    if (!t || t.classList.contains('expanded') || !$('img', t)) return;
    if (t.dataset.type === 'video') {
      hoverBox.innerHTML = `<video src="${t.dataset.full}" autoplay loop></video>`;
      applyVideoPrefs($('video', hoverBox));
    } else hoverBox.innerHTML = `<img src="${t.dataset.full}" alt="">`;
    hoverBox.hidden = false;
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('a.thumb')) hideHover(); });

  // ---------------- quote-link hover previews ----------------
  const cache = new Map();
  const preview = document.createElement('div');
  preview.id = 'quote-preview';
  preview.hidden = true;
  document.body.appendChild(preview);
  async function findPost(board, id) {
    const local = document.getElementById(`p${id}`);
    if (local && (!board || location.pathname.startsWith(`/${board}/`))) return local.cloneNode(true);
    const key = `${board}/${id}`;
    if (!cache.has(key)) {
      cache.set(key, fetch(`/${board}/post/${id}`).then((r) => (r.ok ? r.text() : null)).then((html) => {
        if (!html) return null;
        return new DOMParser().parseFromString(html, 'text/html').getElementById(`p${id}`);
      }).catch(() => null));
    }
    const el = await cache.get(key);
    return el ? el.cloneNode(true) : null;
  }
  document.addEventListener('mouseover', async (e) => {
    const a = e.target.closest('a.quotelink');
    if (!a) return;
    const target = document.getElementById(`p${a.dataset.id}`);
    if (target && !a.closest('#quote-preview')) target.classList.add('highlight');
    const post = await findPost(a.dataset.board, a.dataset.id);
    if (!post || !a.matches(':hover')) return;
    post.removeAttribute('id');
    $$('form, details', post).forEach((f) => f.remove());
    preview.replaceChildren(post);
    preview.hidden = false;
    const r = a.getBoundingClientRect();
    preview.style.left = `${Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - preview.offsetWidth - 10)}px`;
    preview.style.top = `${r.bottom + window.scrollY + 4}px`;
  });
  document.addEventListener('mouseout', (e) => {
    const a = e.target.closest('a.quotelink');
    if (!a) return;
    preview.hidden = true;
    document.getElementById(`p${a.dataset.id}`)?.classList.remove('highlight');
  });

  // ---------------- poster ID highlighting ----------------
  document.addEventListener('click', (e) => {
    const idEl = e.target.closest('.posterid');
    if (!idEl) return;
    const id = idEl.closest('.post').dataset.poster;
    const on = !idEl.closest('.post').classList.contains('id-highlight');
    $$('.post').forEach((p) => p.classList.toggle('id-highlight', on && p.dataset.poster === id));
  });

  // ---------------- quick reply ----------------
  const thread = $('#thread');
  const mainForm = $('#postform');
  let qr = null;
  function openQuickReply(quoteId) {
    if (!thread || !mainForm) return false;
    if (!qr) {
      qr = document.createElement('div');
      qr.id = 'quick-reply';
      qr.innerHTML = '<div class="qr-head"><span>Quick Reply</span><a href="#" class="qr-close">×</a></div>';
      const form = mainForm.cloneNode(true);
      form.removeAttribute('id');
      qr.appendChild(form);
      document.body.appendChild(qr);
      fillPw(qr);
      $('.qr-close', qr).onclick = (ev) => { ev.preventDefault(); qr.hidden = true; };
      // drag by the header
      const head = $('.qr-head', qr);
      head.addEventListener('pointerdown', (ev) => {
        const start = { x: ev.clientX, y: ev.clientY, l: qr.offsetLeft, t: qr.offsetTop };
        const move = (m) => { qr.style.left = `${start.l + m.clientX - start.x}px`; qr.style.top = `${start.t + m.clientY - start.y}px`; qr.style.right = 'auto'; qr.style.bottom = 'auto'; };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      });
    }
    qr.hidden = false;
    const ta = $('textarea', qr);
    if (quoteId) {
      const sel = String(window.getSelection() || '').trim();
      ta.value += `>>${quoteId}\n${sel ? `${sel.split('\n').map((l) => `>${l}`).join('\n')}\n` : ''}`;
    }
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return true;
  }
  document.addEventListener('click', (e) => {
    const no = e.target.closest('a.postno');
    if (!no || !thread) return;
    if (openQuickReply(no.dataset.id)) e.preventDefault();
  });
  if (thread) {
    const m = /^#q(\d+)$/.exec(location.hash);
    if (m) openQuickReply(m[1]);
  } else {
    // On board pages, "No." links open the thread with a quick reply quoting that post.
    $$('a.postno').forEach((a) => { a.href = a.href.replace(/#p(\d+)$/, '#q$1'); });
  }

  // ---------------- thread auto-update ----------------
  if (thread && $('#update-now')) {
    const board = location.pathname.split('/')[1];
    const threadId = location.pathname.split('/')[3];
    const status = $('#update-status');
    let last = Number(thread.dataset.last);
    let delay = 10;
    let timer = null;
    let unseen = 0;
    const baseTitle = document.title;
    const addBacklinks = (post) => {
      $$('blockquote a.quotelink', post).forEach((q) => {
        if (q.dataset.board !== board) return;
        const target = document.getElementById(`p${q.dataset.id}`);
        if (!target) return;
        let bl = $('.backlinks', target);
        if (!bl) { bl = document.createElement('span'); bl.className = 'backlinks'; $('.postinfo', target).appendChild(bl); }
        bl.insertAdjacentHTML('beforeend', ` <a class="quotelink" data-board="${board}" data-id="${post.dataset.id}" href="#p${post.dataset.id}">&gt;&gt;${post.dataset.id}</a>`);
      });
    };
    async function update(manual) {
      clearTimeout(timer);
      status.textContent = 'updating…';
      try {
        const r = await fetch(`/${board}/thread/${threadId}/updates?after=${last}`, { cache: 'no-store' });
        if (r.status === 404) { status.textContent = 'thread was deleted or pruned'; return; }
        const data = await r.json();
        for (const p of data.posts) {
          const tpl = document.createElement('template');
          tpl.innerHTML = p.html.trim();
          const el = tpl.content.firstElementChild;
          thread.appendChild(el);
          addBacklinks(el);
          fillPw(el);
          markYou(el);
          last = Math.max(last, p.id);
        }
        $('#replycount').textContent = data.replies;
        if (data.posts.length) {
          delay = 10;
          if (document.hidden) { unseen += data.posts.length; document.title = `(${unseen}) ${baseTitle}`; }
          status.textContent = `${data.posts.length} new`;
        } else {
          delay = Math.min(delay * 1.5, 120);
          status.textContent = manual ? 'no new replies' : '';
        }
        if (data.archived) { status.textContent = 'thread archived'; return; }
      } catch {
        status.textContent = 'update failed, retrying';
        delay = Math.min(delay * 2, 120);
      }
      if (prefs.autoUpdate) timer = setTimeout(update, delay * 1000);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { unseen = 0; document.title = baseTitle; } });
    $('#update-now').addEventListener('click', (e) => { e.preventDefault(); delay = 10; update(true); });
    if (prefs.autoUpdate) timer = setTimeout(update, delay * 1000);
  }

  // ---------------- catalog filter ----------------
  const cf = $('#catalog-filter');
  if (cf) {
    cf.addEventListener('input', () => {
      const q = cf.value.trim().toLowerCase();
      $$('.ctile').forEach((t) => { t.hidden = q && !t.dataset.text.includes(q); });
    });
  }

  // ---------------- hiding & filtering posts ----------------
  // Manually hidden posts are remembered per browser; filter rules come from the settings panel.
  const hidden = new Set(store.get('hiddenPosts', []));
  const saveHidden = () => store.set('hiddenPosts', [...hidden].slice(-5000));
  const textOf = (post) => `${$('.subject', post)?.textContent || ''} ${$('blockquote', post)?.textContent || ''}`;
  function compileFilters() {
    return String(prefs.filters || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = /^(name|trip|id):(.+)$/i.exec(line);
      if (m) {
        const field = { name: 'name', trip: 'trip', id: 'poster' }[m[1].toLowerCase()];
        const want = m[2].trim().toLowerCase();
        return (post) => (post.dataset[field] || '').toLowerCase() === want;
      }
      const re = /^\/(.+)\/([a-z]*)$/.exec(line);
      if (re) {
        try { const rx = new RegExp(re[1], re[2]); return (post) => rx.test(textOf(post)); } catch { return () => false; }
      }
      const needle = line.toLowerCase();
      return (post) => textOf(post).toLowerCase().includes(needle);
    });
  }
  let filters = compileFilters();
  function setHidden(post, on, why) {
    post.classList.toggle('user-hidden', on);
    $('.hidden-label', post)?.remove();
    if (on) $('.postinfo', post).insertAdjacentHTML('beforeend', `<span class="hidden-label">hidden${why ? ` (${why})` : ''}</span>`);
    const toggle = $('.hide-post', post);
    if (toggle) toggle.textContent = on ? '[+]' : '[–]';
  }
  function applyHiding(root = document) {
    $$('.post', root).forEach((post) => {
      if (post.closest('#quote-preview')) return;
      if (hidden.has(`${post.dataset.board}/${post.dataset.id}`)) { setHidden(post, true); return; }
      // Never auto-hide the OP of the thread you're reading.
      const isThreadOp = post.classList.contains('op') && post.closest('#thread');
      const filtered = !isThreadOp && filters.some((f) => f(post));
      setHidden(post, filtered, filtered ? 'filtered' : '');
    });
  }
  document.addEventListener('click', (e) => {
    const h = e.target.closest('.hide-post');
    if (!h) return;
    e.preventDefault();
    const post = h.closest('.post');
    const key = `${post.dataset.board}/${post.dataset.id}`;
    const on = !post.classList.contains('user-hidden');
    if (on) hidden.add(key); else hidden.delete(key);
    saveHidden();
    setHidden(post, on);
  });
  $('[data-pref="filters"]')?.addEventListener('input', () => { filters = compileFilters(); applyHiding(); });
  $('#clear-hidden')?.addEventListener('click', () => { hidden.clear(); saveHidden(); applyHiding(); });
  applyHiding();
  // Apply hiding to posts added by the thread updater.
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType === 1 && n.classList.contains('post') && n.parentElement?.id === 'thread') { applyHiding(n.parentElement); markWatchLinks(); }
  }))).observe(document.body, { childList: true, subtree: true });

  // ---------------- thread watcher ----------------
  // Stored as { "board:id": { title, seen } }; reply counts come from /api/watch.json.
  const watched = store.get('watched', {});
  const saveWatched = () => store.set('watched', watched);
  const wBox = $('#watcher');
  const wList = $('#watcher-list');
  let wState = {};
  let wTimer = null;
  function renderWatcher() {
    const keys = Object.keys(watched);
    wBox.hidden = keys.length === 0;
    wBox.classList.toggle('collapsed', !!store.get('watcherCollapsed', false));
    wList.replaceChildren();
    for (const key of keys) {
      const [board, id] = key.split(':');
      const st = wState[key] || {};
      const unread = st.replies != null && watched[key].seen != null ? Math.max(0, st.replies - watched[key].seen) : 0;
      const li = document.createElement('li');
      if (unread) li.className = 'new';
      if (st.deleted) li.className = 'dead';
      li.innerHTML = `<a href="#" class="w-del" title="unwatch">×</a> <a class="w-link" href="/${board}/thread/${id}">/${board}/ ${id}</a>`
        + `<span class="w-title"></span> ${unread ? `(${unread})` : ''}${st.archived ? ' [archived]' : ''}`;
      li.querySelector('.w-title').textContent = ` - ${watched[key].title || ''}`;
      li.querySelector('.w-del').onclick = (e) => { e.preventDefault(); delete watched[key]; saveWatched(); renderWatcher(); markWatchLinks(); };
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
        const parts = location.pathname.split('/');
        const here = thread ? `${parts[1]}:${parts[3]}` : null;
        for (const k of keys) {
          const replies = wState[k]?.replies;
          // New watches start "seen"; the thread you're reading is always seen.
          if (replies != null && (watched[k].seen == null || k === here)) watched[k].seen = replies;
        }
        saveWatched();
      } catch { /* offline; try again later */ }
    }
    renderWatcher();
    wTimer = setTimeout(pollWatcher, 60_000);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.watch');
    if (!a) return;
    e.preventDefault();
    const post = a.closest('.post');
    const key = `${post.dataset.board}:${post.dataset.id}`;
    if (watched[key]) delete watched[key]; else watched[key] = { title: a.dataset.title, seen: null };
    saveWatched();
    markWatchLinks();
    pollWatcher();
  });
  $('#watcher-toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    store.set('watcherCollapsed', !store.get('watcherCollapsed', false));
    renderWatcher();
  });
  markWatchLinks();
  pollWatcher();

  // ---------------- videos already on the page ----------------
  $$('video').forEach(applyVideoPrefs);
})();
