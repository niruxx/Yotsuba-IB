(() => {
  'use strict';
  const translate = (key) => window.YOTSUBA_I18N?.[key] || key;
  const html = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const metadata = new Map((window.YOTSUBA_BOARDS || []).map((board) => [board.slug, board]));
  const signedIn = document.body.dataset.account === '1';
  let favorites = new Set();
  const loadLocal = () => {
    try { const rows = JSON.parse(localStorage.getItem('favoriteBoards') || '[]'); return new Set(Array.isArray(rows) ? rows.filter((slug) => typeof slug === 'string' && metadata.has(slug)).slice(0, 100) : []); }
    catch { return new Set(); }
  };
  const filter = () => {
    const query = (document.querySelector('#board-directory-filter')?.value || '').toLowerCase();
    const favoritesOnly = document.querySelector('#board-directory-favorites')?.checked;
    for (const row of document.querySelectorAll('.directory-board')) row.hidden = !row.dataset.search.includes(query) || (!!favoritesOnly && !favorites.has(row.dataset.board));
  };
  const render = () => {
    for (const button of document.querySelectorAll('[data-favorite-board]')) {
      const selected = favorites.has(button.dataset.favoriteBoard);
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = (selected ? '★ ' : '☆ ') + translate(selected ? 'Unfavorite' : 'Favorite');
    }
    for (const nav of document.querySelectorAll('.favorites-nav')) {
      const visible = [...favorites].filter((slug) => metadata.has(slug));
      nav.hidden = !visible.length;
      nav.innerHTML = `<strong>${html(translate('Favorites'))}:</strong> ${visible.map((slug) => `<a href="/${slug}/" title="${html(metadata.get(slug).title)}">/${slug}/</a>`).join(' ')}`;
    }
    filter();
  };
  if (signedIn) {
    fetch('/api/favorites', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json(); favorites = new Set((data.boards || []).filter((slug) => metadata.has(slug))); render();
    }).catch(() => {});
  } else favorites = loadLocal();
  render();
  document.querySelector('#board-directory-filter')?.addEventListener('input', filter);
  document.querySelector('#board-directory-favorites')?.addEventListener('change', filter);
  window.addEventListener('storage', (event) => { if (!signedIn && event.key === 'favoriteBoards') { favorites = loadLocal(); render(); } });
  document.addEventListener('click', async (event) => {
    const formatting = event.target.closest('[data-format]');
    if (formatting) {
      const tag = formatting.dataset.format;
      if (!['b', 'i', 'u', 's', 'aa', 'code'].includes(tag)) return;
      const area = formatting.closest('form')?.querySelector('textarea[name="body"]');
      if (!area) return;
      const start = area.selectionStart, end = area.selectionEnd;
      const value = `[${tag}]${area.value.slice(start, end) || formatting.textContent}[/${tag}]`;
      if (area.value.length - (end - start) + value.length > area.maxLength) { alert('The formatted comment would be too long.'); return; }
      area.setRangeText(value, start, end, 'select'); area.focus(); area.dispatchEvent(new Event('input', { bubbles: true })); return;
    }
    const favorite = event.target.closest('[data-favorite-board]');
    if (favorite) {
      const slug = favorite.dataset.favoriteBoard;
      if (!metadata.has(slug)) return;
      const enabled = !favorites.has(slug);
      if (enabled && favorites.size >= 100) { alert('You can save up to 100 favorite boards.'); return; }
      favorite.disabled = true;
      try {
        if (signedIn) {
          const csrf = document.querySelector('form[action="/admin/logout"] input[name="_csrf"]')?.value;
          const response = await fetch(`/api/favorites/${slug}`, { method: 'POST', body: new URLSearchParams({ enabled: enabled ? '1' : '0', _csrf: csrf || '' }) });
          if (!response.ok) throw new Error('Could not save favorites. Reload the page and try again.');
        }
        if (enabled) favorites.add(slug); else favorites.delete(slug);
        if (!signedIn) localStorage.setItem('favoriteBoards', JSON.stringify([...favorites]));
        render();
      } catch (error) { alert(error.message); }
      finally { favorite.disabled = false; }
      return;
    }
    const load = event.target.closest('.load-video');
    if (load) {
      let url;
      try { url = new URL(load.dataset.embedSrc); } catch { return; }
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
      if (!(url.hostname === 'www.youtube-nocookie.com' && /^\/embed\/[\w-]{11}$/.test(url.pathname)) &&
          !(url.hostname === 'player.vimeo.com' && /^\/video\/\d{1,12}$/.test(url.pathname))) return;
      const frame = document.createElement('iframe');
      frame.src = url.href; frame.title = 'External video player'; frame.loading = 'lazy';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      frame.setAttribute('allow', 'encrypted-media; fullscreen; picture-in-picture'); frame.allowFullscreen = true;
      const close = document.createElement('button'); close.type = 'button'; close.className = 'unload-video'; close.textContent = translate('Unload video');
      load.hidden = true; load.parentElement.append(frame, close);
      return;
    }
    const close = event.target.closest('.unload-video');
    if (close) { const box = close.closest('.video-embed'); box.querySelector('iframe')?.remove(); box.querySelector('.load-video').hidden = false; close.remove(); }
  });
})();
