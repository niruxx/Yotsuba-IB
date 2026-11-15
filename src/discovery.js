import { t } from './i18n.js';
import crypto from 'node:crypto';
import { can, getSettings, setSetting } from './db.js';
import { esc } from './format.js';
import { page } from './adminViews.js';

export function communityUrl(value) {
  const url = new URL(String(value));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname || url.hash || url.search) throw new Error('Use an HTTP(S) community URL without credentials, query strings or fragments.');
  return url.href.replace(/\/$/, '');
}
export function validatePeers(value) {
  const rows = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(rows) || rows.length > 30) throw new Error('Provide a JSON array with at most 30 communities.');
  const seen = new Set();
  return rows.map((row) => {
    if (!row || typeof row.name !== 'string' || !row.name.trim()) throw new Error('Each community needs a name.');
    const url = communityUrl(row.url);
    if (seen.has(url)) throw new Error('Duplicate community URL.');
    seen.add(url);
    return { name: row.name.trim().slice(0, 80), url, endpoint: row.endpoint ? communityUrl(row.endpoint) : url + '/webring.json',
      description: String(row.description || '').slice(0, 300), nsfw: row.nsfw === true };
  });
}
export function ringPeers(settings) {
  try { return validatePeers(settings.webring_peers || '[]'); } catch { return []; }
}
export function trendingBoards(db, settings, now = Date.now()) {
  if (settings.trending_enabled !== '1') return [];
  return db.prepare(`SELECT b.slug, b.title, b.nsfw,
    SUM(CASE WHEN p.created >= :recent THEN 1 ELSE 0 END) AS posts24h,
    SUM(CASE WHEN p.created >= :recent AND p.thread_id IS NULL THEN 1 ELSE 0 END) AS threads24h,
    SUM(CASE WHEN p.created < :recent THEN 1 ELSE 0 END) AS previous24h
    FROM boards b LEFT JOIN posts p ON p.board = b.slug AND p.created >= :previous
    WHERE b.hidden = 0 ${settings.trending_sfw_only === '1' ? 'AND b.nsfw = 0' : ''} GROUP BY b.slug`)
    .all({ recent: now - 86400000, previous: now - 172800000 }).map((board) => ({ ...board,
      score: Math.round((board.posts24h + 2 * board.threads24h) / Math.sqrt(1 + board.previous24h) * 100) / 100 }))
    .filter((board) => board.posts24h > 0).sort((a, b) => b.score - a.score || b.posts24h - a.posts24h || a.slug.localeCompare(b.slug)).slice(0, 10);
}
export function registerDiscovery(app, { db, render, fail, audit, siteName, listBoards, getVisibleBoard }) {
  const admin = (req, res, next) => {
    if (!req.admin) return res.redirect('/admin/login');
    if (!can(req.admin, 'manage_settings')) return fail(req, res, 'Site settings permission is required.', 403);
    next();
  };
  app.get('/admin/discovery', admin, (req, res) => {
    const settings = getSettings(db);
    render(req, res, 'Discovery and webring', page(req.admin, 'Discovery and webring', req.query.msg, `<form class="box" method="post">
      <label class="check"><input type="checkbox" name="video_embeds_enabled"${settings.video_embeds_enabled === '1' ? ' checked' : ''}> Enable click-to-load YouTube and Vimeo embeds in posts</label>
      <label class="check"><input type="checkbox" name="trending_enabled"${settings.trending_enabled === '1' ? ' checked' : ''}> Show trending boards</label>
      <label class="check"><input type="checkbox" name="trending_sfw_only"${settings.trending_sfw_only === '1' ? ' checked' : ''}> Restrict trending rankings to SFW boards</label>
      <label class="check"><input type="checkbox" name="webring_enabled"${settings.webring_enabled === '1' ? ' checked' : ''}> Enable community webring</label>
      <label>Your public site URL <input name="webring_url" value="${esc(settings.webring_url)}" placeholder="https://your-community.example"></label>
      <label>Approved communities (JSON) <textarea name="webring_peers" rows="12">${esc(JSON.stringify(ringPeers(settings), null, 2))}</textarea></label>
      <p>Example: [{"name":"Another community","url":"https://example.org","description":"A community about art","nsfw":false}]</p>
      <p>Only approved communities are listed. No remote logos, automatic crawling or background peer requests are made. Export is available at /webring.json; directory and previous/next/random navigation are at /webring.</p>
      <button>Save discovery settings</button></form>`));
  });
  app.post('/admin/discovery', admin, (req, res) => {
    let peers, url;
    try {
      peers = validatePeers(req.body.webring_peers || '[]');
      url = req.body.webring_url ? communityUrl(req.body.webring_url) : '';
      if (req.body.webring_enabled && !url) throw new Error('Set your public site URL before enabling the webring.');
    } catch (error) { return fail(req, res, error.message); }
    for (const key of ['video_embeds_enabled', 'trending_enabled', 'trending_sfw_only', 'webring_enabled']) setSetting(db, key, req.body[key] ? '1' : '0');
    setSetting(db, 'webring_url', url); setSetting(db, 'webring_peers', JSON.stringify(peers));
    audit(req, 'change_discovery', `${peers.length} approved communities`);
    res.redirect('/admin/discovery?msg=Discovery+settings+saved.');
  });
  app.get('/boards', (req, res) => {
    const settings = getSettings(db), trending = trendingBoards(db, settings);
    const boards = db.prepare('SELECT slug, title, bio, category, nsfw FROM boards WHERE hidden = 0 ORDER BY category, position, slug').all();
    render(req, res, 'Board directory', `<main class="board-discovery"><h1>${esc(t('Board directory'))}</h1>
      ${settings.trending_enabled === '1' ? `<section class="box"><h2>${esc(t('Trending boards'))}</h2><p>Recent posting activity relative to the previous day${settings.trending_sfw_only === '1' ? ' · SFW only' : ''}.</p><ol>${trending.map((board) => `<li><a href="/${esc(board.slug)}/">/${esc(board.slug)}/ — ${esc(board.title)}</a> · ${board.posts24h} posts in 24 hours</li>`).join('') || '<li>No recent activity yet.</li>'}</ol></section>` : ''}
      <section class="box"><h2>All boards</h2><label>Filter <input type="search" id="board-directory-filter" placeholder="Board name or topic"></label>
      <label class="check"><input type="checkbox" id="board-directory-favorites"> Favorites only</label>
      ${boards.map((board) => `<article class="directory-board" data-board="${board.slug}" data-search="${esc(`${board.slug} ${board.title} ${board.bio} ${board.category}`.toLowerCase())}"><h3><a href="/${board.slug}/">/${board.slug}/ — ${esc(board.title)}</a> ${board.nsfw ? '<small class="nsfw">18+ / NSFW</small>' : ''}</h3><p>${esc(board.bio)}</p><button type="button" class="board-favorite" data-favorite-board="${board.slug}" aria-pressed="false">Favorite</button></article>`).join('') || '<p>No public boards yet.</p>'}</section>
      ${settings.webring_enabled === '1' ? '<p><a href="/webring">Explore participating communities</a></p>' : ''}</main>`);
  });
  app.get('/api/trending.json', (req, res) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' });
    res.json({ boards: trendingBoards(db, getSettings(db)) });
  });
  app.get('/api/favorites', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.admin) return res.status(401).json({ error: 'Sign in to sync favorites.' });
    const visible = new Set(listBoards(req).map((board) => board.slug));
    res.json({ boards: db.prepare('SELECT board FROM favorites WHERE admin_id = ? ORDER BY board').all(req.admin.id).map((row) => row.board).filter((slug) => visible.has(slug)) });
  });
  app.post('/api/favorites/:slug', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.admin) return res.status(401).json({ error: 'Sign in to sync favorites.' });
    if (!getVisibleBoard(req, req.params.slug)) return res.status(404).json({ error: 'Board not found.' });
    if (!['0', '1'].includes(req.body?.enabled)) return res.status(400).json({ error: 'Choose whether to enable or remove the favorite.' });
    if (req.body.enabled === '1' && !db.prepare('SELECT board FROM favorites WHERE admin_id = ? AND board = ?').get(req.admin.id, req.params.slug) && db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE admin_id = ?').get(req.admin.id).n >= 100) return res.status(400).json({ error: 'At most 100 favorites are allowed.' });
    if (req.body.enabled === '1') db.prepare('INSERT OR IGNORE INTO favorites (admin_id, board) VALUES (?, ?)').run(req.admin.id, req.params.slug);
    else db.prepare('DELETE FROM favorites WHERE admin_id = ? AND board = ?').run(req.admin.id, req.params.slug);
    res.json({ ok: true });
  });
  app.get('/webring.json', (req, res) => {
    const settings = getSettings(db);
    if (settings.webring_enabled !== '1' || !settings.webring_url) return res.sendStatus(404);
    const peers = ringPeers(settings), url = settings.webring_url;
    res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' });
    res.json({ name: siteName, url, endpoint: url + '/webring.json', following: peers.map((peer) => peer.endpoint), known: peers,
      boards: db.prepare('SELECT slug, title, bio, nsfw FROM boards WHERE hidden = 0 ORDER BY slug').all().map((board) => ({ uri: board.slug, title: board.title, subtitle: board.bio, path: `/${board.slug}/`, nsfw: !!board.nsfw })) });
  });
  app.get('/webring', (req, res) => {
    const settings = getSettings(db);
    if (settings.webring_enabled !== '1') return fail(req, res, 'The webring is disabled.', 404);
    render(req, res, 'Community webring', `<section class="box"><h1>Community webring</h1><p>These communities are approved by this site’s administrator. Each has its own rules and content.</p>
      <nav><a href="/webring/previous">Previous community</a> · <a href="/webring/random">Random community</a> · <a href="/webring/next">Next community</a></nav>
      ${ringPeers(settings).map((peer) => `<article><h2><a href="${esc(peer.url)}" rel="noopener noreferrer">${esc(peer.name)}</a> ${peer.nsfw ? '<small class="nsfw">18+ / NSFW</small>' : ''}</h2><p>${esc(peer.description)}</p></article>`).join('') || '<p>No participating communities configured yet.</p>'}</section>`);
  });
  app.get('/webring/:direction', (req, res) => {
    const settings = getSettings(db), peers = ringPeers(settings);
    if (settings.webring_enabled !== '1' || !peers.length || !['previous', 'next', 'random'].includes(req.params.direction)) return fail(req, res, 'No matching webring destination.', 404);
    const peer = req.params.direction === 'previous' ? peers.at(-1) : req.params.direction === 'next' ? peers[0] : peers[crypto.randomInt(peers.length)];
    res.set('Cache-Control', 'no-store'); res.redirect(302, peer.url);
  });
}
