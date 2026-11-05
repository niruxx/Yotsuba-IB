// Home page customisation: layout preset, section order/visibility/titles, renamable UI labels, logo.
// Stored as JSON in the settings table under "homepage". Edited at /admin/homepage (manage_settings).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { can } from './db.js';

export const SECTION_TYPES = {
  intro: 'Introduction box',
  boards: 'Board list',
  popular: 'Popular threads',
  latest: 'Latest posts',
  stats: 'Stats',
  custom1: 'Custom block 1',
  custom2: 'Custom block 2',
  custom3: 'Custom block 3',
};

// Renamable interface text. Keys are used in templates; values are what visitors see.
export const LABELS = {
  nav_search: ['Top bar: search link', 'search'],
  nav_settings: ['Top bar: settings link', 'settings'],
  nav_admin: ['Top bar: admin link', 'admin'],
  boards_heading: ['Board list heading', 'Boards'],
  boards_filter: ['Board list filter placeholder', 'Filter boards…'],
  col_board: ['Board table: board column', 'Board'],
  col_title: ['Board table: title column', 'Title'],
  col_pph: ['Board table: posts/hour column', 'PPH'],
  col_threads: ['Board table: threads column', 'Threads'],
  col_posts: ['Board table: total posts column', 'Total posts'],
  col_active: ['Board table: last activity column', 'Last activity'],
  nsfw_badge: ['NSFW badge', 'NSFW'],
  no_boards: ['Shown when there are no boards', 'No boards yet.'],
  stat_posts: ['Stats: total posts', 'Total posts'],
  stat_posters: ['Stats: posters in the last hour', 'Posters (last hour)'],
  stat_content: ['Stats: stored content', 'Active content'],
  stat_boards: ['Stats: number of boards', 'Boards'],
  footer: ['Footer text', 'Powered by Yotsuba-IB'],
};

export const DEFAULT_HOMEPAGE = {
  layout: 'legacy',            // 'legacy' (4chan-style) | 'standard' (8kun-style)
  tagline: '',
  logo: '',                    // file name in <data>/branding, served at /branding/logo
  columns: 3,                  // legacy board columns
  popularCount: 8,
  popularSfwOnly: true,        // keep NSFW boards out of "popular threads"
  latestCount: 10,
  sections: [
    { id: 'intro', enabled: true, title: 'What is {site}?', body: '{site} is a simple image-based bulletin board where anyone can post comments and share images. There are boards dedicated to a variety of topics. Users do not need to register an account before participating.' },
    { id: 'boards', enabled: true, title: 'Boards' },
    { id: 'popular', enabled: true, title: 'Popular Threads' },
    { id: 'latest', enabled: false, title: 'Latest Posts' },
    { id: 'stats', enabled: true, title: 'Stats' },
    { id: 'custom1', enabled: false, title: 'Rules', body: '' },
    { id: 'custom2', enabled: false, title: 'News', body: '' },
    { id: 'custom3', enabled: false, title: 'Links', body: '' },
  ],
  labels: {},
};

export const PRESETS = {
  legacy: { layout: 'legacy', order: ['intro', 'boards', 'popular', 'stats', 'latest', 'custom1', 'custom2', 'custom3'], enabled: ['intro', 'boards', 'popular', 'stats'] },
  standard: { layout: 'standard', order: ['intro', 'boards', 'latest', 'stats', 'popular', 'custom1', 'custom2', 'custom3'], enabled: ['intro', 'boards', 'stats'] },
};

export function getHomepage(db) {
  let saved = {};
  try { saved = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'homepage'").get()?.value || '{}'); } catch { /* corrupt: defaults */ }
  const cfg = { ...DEFAULT_HOMEPAGE, ...saved };
  // Keep every known section exactly once, in the saved order, filling gaps from the defaults.
  const byId = new Map(DEFAULT_HOMEPAGE.sections.map((s) => [s.id, s]));
  const seen = new Set();
  cfg.sections = [...(saved.sections || []), ...DEFAULT_HOMEPAGE.sections]
    .filter((s) => byId.has(s.id) && !seen.has(s.id) && seen.add(s.id))
    .map((s) => ({ ...byId.get(s.id), ...s }));
  cfg.labels = Object.fromEntries(Object.entries(LABELS).map(([k, [, def]]) => [k, saved.labels?.[k] || def]));
  return cfg;
}

function saveHomepage(db, cfg) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('homepage', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(cfg));
}

// Everything the home page can show, gathered in one place. Hidden boards are excluded for visitors.
export function homepageData(db, req, cfg) {
  const now = Date.now();
  const vis = req.admin ? '' : 'AND b.hidden = 0';
  const boards = db.prepare(`SELECT b.slug, b.title, b.bio, b.category, b.nsfw, b.hidden,
      (SELECT COUNT(*) FROM posts p WHERE p.board = b.slug) AS posts,
      (SELECT COUNT(*) FROM posts p WHERE p.board = b.slug AND p.created > ?) AS pph,
      (SELECT COUNT(*) FROM posts p WHERE p.board = b.slug AND p.thread_id IS NULL AND p.archived = 0) AS threads,
      (SELECT MAX(created) FROM posts p WHERE p.board = b.slug) AS last_post
    FROM boards b WHERE 1 = 1 ${vis} ORDER BY b.position, b.slug`).all(now - 3600e3);
  const want = (id) => cfg.sections.some((s) => s.id === id && s.enabled);
  const out = { boards };
  if (want('popular')) {
    out.popular = db.prepare(`SELECT p.id, p.board, p.subject, p.body, p.reply_count, p.thumb, p.file, p.file_mime, p.spoiler
      FROM posts p JOIN boards b ON b.slug = p.board
      WHERE p.thread_id IS NULL AND p.archived = 0 AND p.file IS NOT NULL AND p.bumped > ? ${vis} ${cfg.popularSfwOnly ? 'AND b.nsfw = 0' : ''}
      ORDER BY p.reply_count DESC, p.bumped DESC LIMIT ?`).all(now - 7 * 86400e3, Math.max(1, Math.min(24, cfg.popularCount)));
  }
  if (want('latest')) {
    out.latest = db.prepare(`SELECT p.id, p.board, p.thread_id, p.subject, p.body, p.created FROM posts p JOIN boards b ON b.slug = p.board
      WHERE 1 = 1 ${vis} ${cfg.popularSfwOnly ? 'AND b.nsfw = 0' : ''} ORDER BY p.id DESC LIMIT ?`).all(Math.max(1, Math.min(50, cfg.latestCount)));
  }
  if (want('stats')) {
    out.stats = {
      posts: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
      posters: db.prepare('SELECT COUNT(DISTINCT ip_hash) AS n FROM posts WHERE created > ?').get(now - 3600e3).n,
      bytes: db.prepare('SELECT COALESCE(SUM(file_size), 0) AS n FROM posts WHERE file IS NOT NULL').get().n,
      boards: boards.length,
    };
  }
  return out;
}

export function registerHomepage(app, { db, dataDir, render, fail, audit, csrfOk, views }) {
  const brandDir = path.join(dataDir, 'branding');
  fs.mkdirSync(brandDir, { recursive: true });
  const logoUpload = multer({ dest: brandDir, limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 200 } });
  const allowed = (req) => can(req.admin, 'manage_settings');

  app.get('/branding/logo', (req, res, next) => {
    const cfg = getHomepage(db);
    if (!cfg.logo) return next();
    res.sendFile(cfg.logo, { root: brandDir, headers: { 'Cache-Control': 'public, max-age=3600' } }, (err) => err && !res.headersSent && next());
  });

  app.get('/admin/homepage', (req, res) => {
    if (!req.admin) return res.redirect('/admin/login');
    if (!allowed(req)) return fail(req, res, 'You need the manage_settings permission.', 403);
    render(req, res, 'Homepage', views.homepageEditor(req.admin, getHomepage(db), req.query.msg));
  });

  // Multipart (logo upload), so CSRF is checked here after parsing.
  app.post('/admin/homepage', logoUpload.single('logo'), (req, res) => {
    const cleanup = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
    if (!req.admin) { cleanup(); return res.redirect('/admin/login'); }
    if (!csrfOk(req)) { cleanup(); return fail(req, res, 'Invalid or missing CSRF token. Reload the page and try again.', 403); }
    if (!allowed(req)) { cleanup(); return fail(req, res, 'You need the manage_settings permission.', 403); }
    const b = req.body;
    const cfg = getHomepage(db);

    if (b.preset && PRESETS[b.preset]) {
      // Apply a preset: layout + section order/visibility. Titles, bodies and labels are kept.
      const p = PRESETS[b.preset];
      cfg.layout = p.layout;
      const byId = new Map(cfg.sections.map((s) => [s.id, s]));
      cfg.sections = p.order.map((id) => ({ ...byId.get(id), enabled: p.enabled.includes(id) }));
      saveHomepage(db, cfg);
      cleanup();
      audit(req, 'homepage_preset', b.preset);
      return res.redirect(`/admin/homepage?msg=${encodeURIComponent(`Applied the ${b.preset} preset.`)}`);
    }

    cfg.layout = b.layout === 'standard' ? 'standard' : 'legacy';
    cfg.tagline = String(b.tagline || '').trim().slice(0, 200);
    cfg.columns = Math.max(1, Math.min(6, Number(b.columns) || 3));
    cfg.popularCount = Math.max(1, Math.min(24, Number(b.popularCount) || 8));
    cfg.latestCount = Math.max(1, Math.min(50, Number(b.latestCount) || 10));
    cfg.popularSfwOnly = !!b.popularSfwOnly;
    cfg.sections = cfg.sections
      .map((s, i) => ({
        ...s,
        enabled: !!b[`enabled_${s.id}`],
        title: String(b[`title_${s.id}`] ?? s.title).trim().slice(0, 100),
        ...('body' in s ? { body: String(b[`body_${s.id}`] ?? s.body).replace(/\r\n/g, '\n').slice(0, 5000) } : {}),
        _order: Number(b[`order_${s.id}`]) || i + 1,
      }))
      .sort((x, y) => x._order - y._order)
      .map(({ _order, ...s }) => s);
    cfg.labels = Object.fromEntries(Object.keys(LABELS)
      .map((k) => [k, String(b[`label_${k}`] || '').trim().slice(0, 100)])
      .filter(([k, v]) => v && v !== LABELS[k][1]));

    if (b.remove_logo) {
      if (cfg.logo) fs.rm(path.join(brandDir, cfg.logo), { force: true }, () => {});
      cfg.logo = '';
    }
    if (req.file) {
      const head = Buffer.alloc(12);
      const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
      const hex = head.toString('hex');
      const ext = hex.startsWith('89504e47') ? 'png' : hex.startsWith('ffd8ff') ? 'jpg' : hex.startsWith('47494638') ? 'gif'
        : (hex.startsWith('52494646') && head.subarray(8, 12).toString() === 'WEBP') ? 'webp' : null;
      if (!ext) { cleanup(); return fail(req, res, 'The logo must be a png, jpg, gif or webp image.'); }
      if (cfg.logo) fs.rm(path.join(brandDir, cfg.logo), { force: true }, () => {});
      cfg.logo = `logo-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.renameSync(req.file.path, path.join(brandDir, cfg.logo));
    }
    saveHomepage(db, cfg);
    audit(req, 'edit_homepage', `layout ${cfg.layout}; sections ${cfg.sections.filter((s) => s.enabled).map((s) => s.id).join(', ')}`);
    res.redirect('/admin/homepage?msg=Homepage+saved');
  });
}
