import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings, parsePerms, parseBoards, can, serverSecret } from './db.js';
import { storeMedia, thumbPath } from './media.js';
import { registerApi } from './api.js';
import { snapshotDb } from './backup.js';
import { registerAdmin } from './admin.js';
import { createModeration, registerModeration, normIp } from './moderation.js';
import {
  perceptualHash, hamming, countLinks, normalizeText, textHash, RateMemory, hashDeletePw, checkDeletePw,
} from './antispam.js';
import * as V from './views.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESERVED = new Set(['admin', 'static', 'uploads', 'media', 'api', 'search', 'faq', 'appeal', 'rss']);
const DAY = 24 * 3600 * 1000;

// Identify file type by magic bytes rather than trusting the client.
function sniff(buf) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return ['image/jpeg', 'jpg'];
  if (hex.startsWith('89504e47')) return ['image/png', 'png'];
  if (hex.startsWith('47494638')) return ['image/gif', 'gif'];
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  if (hex.startsWith('1a45dfa3')) return ['video/webm', 'webm'];
  if (buf.subarray(4, 8).toString() === 'ftyp') return ['video/mp4', 'mp4'];
  return null;
}

export function createServer(opts) {
  const {
    dataDir, siteName = 'Yotsuba-IB', maxFileMb = 20, threadsPerPage = 10,
    maxPages = 10, bumpLimit = 300, trustProxy = false, geo = null,
  } = opts;
  const db = openDb(dataDir);
  const mod = createModeration({ db, geo, trustProxy });
  const lastReport = new Map();
  const uploadDir = path.join(dataDir, 'uploads');
  const salt = crypto.randomBytes(16).toString('hex'); // per-process salt for the cooldown hash
  const rates = new RateMemory();       // cooldowns + flood counters
  const recentText = new Map();         // normalized-text hash -> last time posted (duplicate detection)
  const floodAlerted = new Map();       // board -> time a flood alert was last raised

  const app = express();
  const startedAt = Date.now();
  const httpCounts = new Map(); // status code -> count, for /metrics
  app.use((req, res, next) => {
    res.on('finish', () => httpCounts.set(res.statusCode, (httpCounts.get(res.statusCode) || 0) + 1));
    next();
  });
  if (trustProxy) app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/static', express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // --- session handling: disabled accounts are rejected even with a live cookie ---
  app.use((req, res, next) => {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    req.admin = null;
    if (m) {
      const s = db.prepare(`SELECT a.id, a.username, a.role, a.permissions, a.boards, s.csrf FROM sessions s JOIN admins a ON a.id = s.admin_id
                            WHERE s.token = ? AND s.expires > ? AND a.disabled = 0`).get(m[1], Date.now());
      if (s) {
        req.admin = { ...s, perms: parsePerms(s.permissions), boardList: parseBoards(s.boards) };
        req.sid = m[1];
        req.csrf = s.csrf;
        if (!req.csrf) {
          req.csrf = crypto.randomBytes(24).toString('hex');
          db.prepare('UPDATE sessions SET csrf = ? WHERE token = ?').run(req.csrf, m[1]);
        }
      }
    }
    next();
  });

  // CSRF: every form POST made with a staff session must carry the session's token.
  // (Multipart post forms are checked in the post handler, after the body is parsed.)
  const csrfOk = (req) => !req.admin || (typeof req.body?._csrf === 'string'
    && req.body._csrf.length === req.csrf.length
    && crypto.timingSafeEqual(Buffer.from(req.body._csrf), Buffer.from(req.csrf)));
  app.use((req, res, next) => {
    if (req.method !== 'POST' || !req.admin || req.is('multipart/form-data')) return next();
    if (!csrfOk(req)) return res.status(403).type('text').send('Invalid or missing CSRF token. Reload the page and try again.');
    next();
  });

  // Hidden boards are only listed for, and reachable by, logged-in staff.
  const listBoards = (req) => db.prepare(
    `SELECT slug, title, bio, hidden, category, nsfw FROM boards ${req.admin ? '' : 'WHERE hidden = 0'} ORDER BY position, slug`).all();
  const render = (req, res, title, body, status = 200) => {
    const alertCount = can(req.admin, 'view_alerts')
      ? db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE status = \'open\'').get().n : null;
    const st = getSettings(db);
    const today = new Date();
    const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const birthday = st.birthday_date && st.birthday_date === mmdd ? { hat: st.birthday_hat, color: st.birthday_color } : null;
    const html = V.layout({ title, siteName, admin: req.admin, boards: listBoards(req), alertCount, body,
      announcement: st.announcement, hasFaq: !!st.faq_text.trim(), birthday });
    res.status(status).type('html').send(withCsrf(req, html));
  };
  // Adds the staff CSRF token to every POST form in a chunk of HTML.
  const withCsrf = (req, html) => (req.csrf
    ? html.replace(/<form\b[^>]*method="post"[^>]*>/g, (tag) => `${tag}<input type="hidden" name="_csrf" value="${req.csrf}">`)
    : html);
  // Which staff controls to show on posts.
  const staffCaps = (req, board) => {
    const caps = { del: can(req.admin, 'delete_posts', board), ban: can(req.admin, 'manage_bans', board) };
    return caps.del || caps.ban ? caps : null;
  };
  const banned = (req, res, ban) => {
    const appeal = db.prepare('SELECT * FROM appeals WHERE ban_id = ? ORDER BY id DESC LIMIT 1').get(ban.id);
    render(req, res, 'Banned', V.bannedPage(ban, appeal), 403);
  };

  // Bans that block site access (e.g. country bans for legal reasons). Staff and the login page are exempt.
  app.use((req, res, next) => {
    if (req.admin || req.path.startsWith('/static/') || req.path.startsWith('/admin/login') || req.path === '/appeal') return next();
    const ban = mod.findBan(req, 'access');
    if (ban) return banned(req, res, ban);
    next();
  });
  const fail = (req, res, msg, status = 400) => render(req, res, 'Error', V.errorPage(msg), status);
  const getBoard = (slug) => db.prepare('SELECT * FROM boards WHERE slug = ?').get(slug);
  const getVisibleBoard = (req, slug) => {
    const b = getBoard(slug);
    return b && (!b.hidden || req.admin) ? b : undefined;
  };
  const boardMaxMb = (board) => Math.min(board.max_file_mb || maxFileMb, maxFileMb);
  const randomBanner = (slug) => db.prepare('SELECT id FROM banners WHERE board = ? ORDER BY RANDOM() LIMIT 1').get(slug)?.id ?? null;
  const rmUpload = (file) => {
    fs.rm(path.join(uploadDir, file), { force: true }, () => {});
    fs.rm(thumbPath(path.join(uploadDir, file)), { force: true }, () => {});
  };

  // On-disk layout (never served directly; files are served via /media/<postId>.<ext>):
  //   uploads/threads/<threadId>-<subject>.<op IP>/post-image-<IP>.<ext>        (the OP's file)
  //   uploads/threads/<threadId>-<subject>.<op IP>/<postId>.imagefile.<IP>.<ext> (reply files)
  // When post logging is off, "nolog" is written instead of the IP.
  const threadsDir = path.join(uploadDir, 'threads');
  fs.mkdirSync(threadsDir, { recursive: true });
  const safeIp = (ip) => String(ip || 'unknown').replace(/^::ffff:/, '').replace(/[^0-9A-Za-z.]/g, '_');
  const slugify = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40) || 'thread';
  const findThreadDir = (threadId) =>
    fs.readdirSync(threadsDir).find((d) => d.startsWith(`${threadId}-`));

  function deletePost(id) {
    const p = db.prepare('SELECT id, thread_id FROM posts WHERE id = ?').get(id);
    if (!p) return;
    const files = db.prepare('SELECT file FROM posts WHERE (id = ? OR thread_id = ?) AND file IS NOT NULL').all(id, id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    for (const { file } of files) rmUpload(file);
    if (!p.thread_id) {
      const dir = findThreadDir(id);
      if (dir) fs.rm(path.join(threadsDir, dir), { recursive: true, force: true }, () => {});
    }
  }

  // Pruned and inactive threads go to the read-only archive (or are deleted if archiving is off).
  function retireThread(id) {
    if (Number(getSettings(db).archive_days) > 0) {
      db.prepare('UPDATE posts SET archived = 1, locked = 1, sticky = 0, archived_at = ? WHERE id = ?').run(Date.now(), id);
    } else deletePost(id);
  }

  const perPage = (board) => board.threads_per_page || threadsPerPage;
  function pruneBoard(slug) {
    const keep = perPage(getBoard(slug)) * maxPages;
    const old = db.prepare(`SELECT id FROM posts WHERE board = ? AND thread_id IS NULL AND archived = 0
                            AND sticky = 0 ORDER BY bumped DESC LIMIT -1 OFFSET ?`).all(slug, keep);
    for (const { id } of old) retireThread(id);
  }

  // Applies the retention settings from the admin panel. 0 means "keep forever".
  function runPurge() {
    const s = getSettings(db);
    const now = Date.now();
    const threadDays = Number(s.thread_inactivity_days);
    const fileDays = Number(s.file_retention_days);
    const logDays = Number(s.log_retention_days);
    if (threadDays > 0) {
      const stale = db.prepare('SELECT id FROM posts WHERE thread_id IS NULL AND sticky = 0 AND archived = 0 AND bumped < ?').all(now - threadDays * DAY);
      for (const { id } of stale) retireThread(id);
    }
    const archiveDays = Number(s.archive_days);
    const expired = db.prepare('SELECT id FROM posts WHERE thread_id IS NULL AND archived = 1 AND archived_at < ?')
      .all(archiveDays > 0 ? now - archiveDays * DAY : now + DAY);
    for (const { id } of expired) deletePost(id);
    if (fileDays > 0) {
      const old = db.prepare('SELECT id, file FROM posts WHERE file IS NOT NULL AND created < ?').all(now - fileDays * DAY);
      const clear = db.prepare('UPDATE posts SET file = NULL WHERE id = ?');
      for (const { id, file } of old) { clear.run(id); rmUpload(file); }
    }
    if (logDays > 0) db.prepare('DELETE FROM post_logs WHERE created < ?').run(now - logDays * DAY);
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, `tmp-${crypto.randomBytes(12).toString('hex')}`),
    }),
    limits: { fileSize: maxFileMb * 1024 * 1024, files: 1, fields: 20 },
  });

  // --- media: looked up by post ID so file paths (which contain IPs) are never exposed ---
  app.get('/media/thumb/:name', (req, res, next) => {
    const p = db.prepare(`SELECT p.file, p.thumb, b.hidden FROM posts p JOIN boards b ON b.slug = p.board
                          WHERE p.id = ? AND p.file IS NOT NULL`).get(parseInt(req.params.name, 10));
    if (!p || !p.thumb || (p.hidden && !req.admin)) return next();
    res.sendFile(thumbPath(p.file), {
      root: uploadDir,
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': p.hidden ? 'private, no-store' : 'public, max-age=2592000' },
    }, (err) => err && !res.headersSent && next());
  });
  app.get('/media/:name', (req, res, next) => {
    const id = parseInt(req.params.name, 10);
    const p = db.prepare(`SELECT p.file, p.file_mime, b.hidden FROM posts p JOIN boards b ON b.slug = p.board
                          WHERE p.id = ? AND p.file IS NOT NULL`).get(id);
    if (!p || (p.hidden && !req.admin)) return next();
    res.sendFile(p.file, {
      root: uploadDir,
      headers: { 'Content-Type': p.file_mime, 'Cache-Control': p.hidden ? 'private, no-store' : 'public, max-age=2592000' },
    }, (err) => err && !res.headersSent && next());
  });

  // --- public routes ---
  app.get('/', (req, res) => {
    render(req, res, siteName, V.homePage(listBoards(req)));
  });

  app.get('/faq', (req, res, next) => {
    const text = getSettings(db).faq_text.trim();
    if (!text) return next();
    render(req, res, 'FAQ', V.faqPage(text));
  });

  // Search: subject + comment text, newest first. Hidden boards only for staff.
  app.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const boardSlug = String(req.query.board || '').trim();
    let results = [];
    if (q.length >= 2) {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const args = [like, like];
      let where = `(p.body LIKE ? ESCAPE '\\' OR p.subject LIKE ? ESCAPE '\\')`;
      if (!req.admin) where += ' AND b.hidden = 0';
      if (boardSlug) { where += ' AND p.board = ?'; args.push(boardSlug); }
      results = db.prepare(`SELECT p.* FROM posts p JOIN boards b ON b.slug = p.board WHERE ${where}
                            ORDER BY p.id DESC LIMIT 50`).all(...args);
    }
    render(req, res, q ? `Search: ${q}` : 'Search', V.searchPage(q, boardSlug, results, listBoards(req)));
  });

  const { audit } = registerAdmin(app, { db, render, fail, deletePost, uploadDir, getBoard, RESERVED, runPurge });
  registerModeration(app, { db, render, fail, deletePost, mod, audit, rmUpload, uploadDir });
  registerApi(app, { db, getVisibleBoard, listBoards, thumbPath });

  // --- health & metrics ---
  app.get('/healthz', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.set('Cache-Control', 'no-store').json({ status: 'ok', uptime_s: Math.round((Date.now() - startedAt) / 1000) });
    } catch (err) {
      res.status(503).json({ status: 'error', error: err.message });
    }
  });
  // Prometheus metrics. Requires YOTSUBA_METRICS_TOKEN as a bearer token, or a request from localhost.
  app.get('/metrics', (req, res) => {
    const token = process.env.YOTSUBA_METRICS_TOKEN;
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (token ? req.get('authorization') !== `Bearer ${token}` : !local) return res.status(403).type('text').send('forbidden\n');
    const lines = [];
    const metric = (name, help, type, rows) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [labels, v] of rows) lines.push(`${name}${labels} ${v}`);
    };
    const perBoard = db.prepare(`SELECT b.slug, COUNT(p.id) AS posts, SUM(p.thread_id IS NULL AND p.archived = 0) AS threads,
                                 SUM(p.file IS NOT NULL) AS files FROM boards b LEFT JOIN posts p ON p.board = b.slug GROUP BY b.slug`).all();
    metric('yotsuba_posts', 'Posts currently stored', 'gauge', perBoard.map((b) => [`{board="${b.slug}"}`, b.posts]));
    metric('yotsuba_threads', 'Live (non-archived) threads', 'gauge', perBoard.map((b) => [`{board="${b.slug}"}`, b.threads ?? 0]));
    metric('yotsuba_files', 'Stored uploads', 'gauge', perBoard.map((b) => [`{board="${b.slug}"}`, b.files ?? 0]));
    metric('yotsuba_open_alerts', 'Unresolved staff alerts', 'gauge',
      [['', db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'").get().n]]);
    metric('yotsuba_active_bans', 'Active bans', 'gauge',
      [['', db.prepare('SELECT COUNT(*) AS n FROM bans WHERE lifted = 0 AND (expires IS NULL OR expires > ?)').get(Date.now()).n]]);
    metric('yotsuba_http_responses_total', 'HTTP responses by status code', 'counter', [...httpCounts].map(([c, n]) => [`{code="${c}"}`, n]));
    metric('yotsuba_uptime_seconds', 'Process uptime', 'gauge', [['', Math.round((Date.now() - startedAt) / 1000)]]);
    metric('process_resident_memory_bytes', 'Resident memory', 'gauge', [['', process.memoryUsage().rss]]);
    res.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  });

  // --- board banners (uploaded by staff with manage_boards) ---
  const bannerDir = path.join(dataDir, 'banners');
  fs.mkdirSync(bannerDir, { recursive: true });
  const bannerUpload = multer({ dest: bannerDir, limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 } });
  app.get('/banner/:id', (req, res, next) => {
    const b = db.prepare('SELECT bn.*, bo.hidden FROM banners bn JOIN boards bo ON bo.slug = bn.board WHERE bn.id = ?').get(Number(req.params.id));
    if (!b || (b.hidden && !req.admin)) return next();
    res.sendFile(b.file, { root: bannerDir, headers: { 'Content-Type': b.mime, 'Cache-Control': 'public, max-age=86400' } },
      (err) => err && !res.headersSent && next());
  });
  app.post('/admin/boards/:slug/banners', bannerUpload.single('banner'), (req, res) => {
    const cleanup = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
    if (!req.admin) { cleanup(); return res.redirect('/admin/login'); }
    if (!csrfOk(req)) { cleanup(); return fail(req, res, 'Invalid or missing CSRF token. Reload the page and try again.', 403); }
    const board = getBoard(req.params.slug);
    if (!board || !can(req.admin, 'manage_boards', board.slug)) { cleanup(); return fail(req, res, 'No such board or no permission.', 403); }
    if (!req.file) return fail(req, res, 'Choose an image.');
    const head = Buffer.alloc(16);
    const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
    const kind = sniff(head);
    if (!kind || !kind[0].startsWith('image/')) { cleanup(); return fail(req, res, 'Banners must be jpg, png, gif or webp.'); }
    const name = `${crypto.randomBytes(8).toString('hex')}.${kind[1]}`;
    fs.renameSync(req.file.path, path.join(bannerDir, name));
    db.prepare('INSERT INTO banners (board, file, mime, created) VALUES (?, ?, ?, ?)').run(board.slug, name, kind[0], Date.now());
    audit(req, 'add_banner', `/${board.slug}/`);
    res.redirect('/admin/boards?msg=Banner+added');
  });
  app.post('/admin/banners/:id/delete', (req, res) => {
    if (!req.admin) return res.redirect('/admin/login');
    const b = db.prepare('SELECT * FROM banners WHERE id = ?').get(Number(req.params.id));
    if (!b || !can(req.admin, 'manage_boards', b.board)) return fail(req, res, 'No such banner or no permission.', 403);
    db.prepare('DELETE FROM banners WHERE id = ?').run(b.id);
    fs.rm(path.join(bannerDir, b.file), { force: true }, () => {});
    audit(req, 'remove_banner', `/${b.board}/`);
    res.redirect('/admin/boards?msg=Banner+removed');
  });

  // --- board routes (Express 5 matches /g and /g/ alike) ---
  app.get('/:slug', (req, res, next) => {
    const board = getVisibleBoard(req, req.params.slug);
    if (!board) return next();
    const total = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE board = ? AND thread_id IS NULL AND archived = 0').get(board.slug).n;
    const tpp = perPage(board);
    const pages = Math.max(1, Math.ceil(total / tpp));
    const page = Math.min(Math.max(0, parseInt(req.query.page, 10) || 0), pages - 1);
    const ops = db.prepare(`SELECT * FROM posts WHERE board = ? AND thread_id IS NULL AND archived = 0
                            ORDER BY sticky DESC, bumped DESC LIMIT ? OFFSET ?`).all(board.slug, tpp, page * tpp);
    const lastReplies = db.prepare('SELECT * FROM (SELECT * FROM posts WHERE thread_id = ? ORDER BY id DESC LIMIT 5) ORDER BY id');
    const threads = ops.map((op) => {
      const replies = lastReplies.all(op.id);
      return { op, replies, omitted: op.reply_count - replies.length };
    });
    render(req, res, `/${board.slug}/ - ${board.title}`,
      V.boardPage(board, threads, { admin: staffCaps(req, board.slug), loggedIn: !!req.admin, page, pages, maxMb: boardMaxMb(board), banner: randomBanner(board.slug) }));
  });
  app.get('/:slug/thread/:id', (req, res, next) => {
    const board = getVisibleBoard(req, req.params.slug);
    if (!board) return next();
    const op = db.prepare('SELECT * FROM posts WHERE id = ? AND board = ? AND thread_id IS NULL').get(Number(req.params.id), board.slug);
    if (!op) return fail(req, res, 'Thread not found (it may have been pruned or deleted).', 404);
    const replies = db.prepare('SELECT * FROM posts WHERE thread_id = ? ORDER BY id').all(op.id);
    render(req, res, `/${board.slug}/ - ${op.subject || op.body.slice(0, 40) || `No.${op.id}`}`,
      V.threadPage(board, op, replies, { admin: staffCaps(req, board.slug), loggedIn: !!req.admin, maxMb: boardMaxMb(board), banner: randomBanner(board.slug) }));
  });

  // Thread auto-update: returns rendered HTML for replies newer than ?after=<postId>.
  app.get('/:slug/thread/:id/updates', (req, res, next) => {
    const board = getVisibleBoard(req, req.params.slug);
    if (!board) return next();
    const op = db.prepare('SELECT id, locked, archived, reply_count FROM posts WHERE id = ? AND board = ? AND thread_id IS NULL')
      .get(Number(req.params.id), board.slug);
    if (!op) return res.status(404).json({ gone: true });
    const after = Number(req.query.after) || 0;
    const fresh = db.prepare('SELECT * FROM posts WHERE thread_id = ? AND id > ? ORDER BY id').all(op.id, after);
    const caps = staffCaps(req, board.slug);
    res.set('Cache-Control', 'no-store').json({
      posts: fresh.map((p) => ({ id: p.id, html: withCsrf(req, V.renderPost(p, board, { isOp: false, admin: caps })) })),
      replies: op.reply_count, locked: !!op.locked, archived: !!op.archived,
    });
  });

  // Catalog: every live thread as a grid tile.
  app.get('/:slug/catalog', (req, res, next) => {
    const board = getVisibleBoard(req, req.params.slug);
    if (!board) return next();
    const sort = ['bump', 'new', 'replies'].includes(req.query.sort) ? req.query.sort : 'bump';
    const order = { bump: 'p.bumped DESC', new: 'p.id DESC', replies: 'p.reply_count DESC' }[sort];
    const threads = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM posts r WHERE r.thread_id = p.id AND r.file IS NOT NULL) AS images
                                FROM posts p WHERE p.board = ? AND p.thread_id IS NULL AND p.archived = 0
                                ORDER BY p.sticky DESC, ${order}`).all(board.slug);
    render(req, res, `/${board.slug}/ - Catalog`, V.catalogPage(board, threads, sort));
  });

  app.get('/:slug/archive', (req, res, next) => {
    const board = getVisibleBoard(req, req.params.slug);
    if (!board) return next();
    const threads = db.prepare(`SELECT id, subject, body, archived_at, reply_count FROM posts
                                WHERE board = ? AND thread_id IS NULL AND archived = 1 ORDER BY archived_at DESC`).all(board.slug);
    render(req, res, `/${board.slug}/ - Archive`, V.archivePage(board, threads, Number(getSettings(db).archive_days)));
  });

  app.get('/:slug/rss.xml', (req, res, next) => {
    const board = getVisibleBoard(req, req.params.slug);
    if (!board || board.hidden) return next();
    const threads = db.prepare(`SELECT * FROM posts WHERE board = ? AND thread_id IS NULL AND archived = 0
                                ORDER BY id DESC LIMIT 30`).all(board.slug);
    const base = `${req.protocol}://${req.get('host')}`;
    res.type('application/rss+xml').send(V.rssFeed(siteName, board, threads, base));
  });
  app.get('/:slug/post/:id', (req, res, next) => {
    if (!getVisibleBoard(req, req.params.slug)) return next();
    const p = db.prepare('SELECT id, thread_id FROM posts WHERE id = ? AND board = ?').get(Number(req.params.id), req.params.slug);
    if (!p) return next();
    res.redirect(`/${req.params.slug}/thread/${p.thread_id ?? p.id}#p${p.id}`);
  });

  app.post('/:slug/post', upload.single('file'), async (req, res) => {
    const cleanup = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
    const bail = (msg, status) => { cleanup(); fail(req, res, msg, status); };
    if (req.admin && !csrfOk(req)) return bail('Invalid or missing CSRF token. Reload the page and try again.', 403);

    const board = getVisibleBoard(req, req.params.slug);
    if (!board) return bail('No such board.', 404);

    if (!req.admin) {
      const ban = mod.findBan(req, 'post');
      if (ban) { cleanup(); return banned(req, res, ban); }
    }

    const settings = getSettings(db);
    const num = (k) => Number(settings[k]) || 0;
    const ipHash = crypto.createHash('sha256').update(salt + req.ip).digest('hex').slice(0, 16);
    const now = Date.now();
    const threadId = req.body.thread ? Number(req.body.thread) : null;
    const kind = threadId ? 'reply' : 'thread';
    // Name field: "Name#pass" gives a tripcode (!abc), "Name##pass" a secure tripcode (!!abc) keyed by a server secret.
    const rawName = String(req.body.name || '').trim().slice(0, 80);
    const hashIdx = rawName.indexOf('#');
    const name = board.forced_anon ? 'Anonymous'
      : (hashIdx >= 0 ? rawName.slice(0, hashIdx) : rawName).trim().slice(0, 50) || 'Anonymous';
    let tripcode = null;
    if (!board.forced_anon && hashIdx >= 0 && rawName.length > hashIdx + 1) {
      const secure = rawName[hashIdx + 1] === '#';
      const pass = rawName.slice(hashIdx + (secure ? 2 : 1));
      if (pass) {
        tripcode = secure
          ? `!!${crypto.createHmac('sha256', serverSecret(db)).update(pass).digest('base64url').slice(0, 12)}`
          : `!${crypto.createHash('sha256').update(`yotsuba-trip:${pass}`).digest('base64url').slice(0, 10)}`;
      }
    }
    // Options field: "sage" = don't bump, "nonoko" = return to the board after posting.
    const options = String(req.body.options || '').toLowerCase();
    const sage = /\bsage\b/.test(options);
    const nonoko = /\bnonoko\b/.test(options);
    const spoiler = req.body.spoiler ? 1 : 0;
    const subject = threadId ? '' : String(req.body.subject || '').trim().slice(0, 100);
    const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
    const deletePw = String(req.body.password || '').slice(0, 64);
    // Staff capcode: logged-in staff tick "post as staff" to get a verified tag.
    const capcode = req.admin && req.body.capcode ? (req.admin.role === 'owner' ? 'Admin' : 'Mod') : null;

    // --- cooldowns (thread/reply per board, uploads site-wide); board settings override site defaults ---
    if (!req.admin) {
      const cd = (kind === 'thread' ? board.thread_cooldown : board.reply_cooldown) ?? num(`cooldown_${kind}_sec`);
      const waited = (now - rates.last(`${kind}:${board.slug}:${ipHash}`)) / 1000;
      if (cd > 0 && waited < cd) return bail(`Please wait ${Math.ceil(cd - waited)} more seconds before posting another ${kind} here.`, 429);
      const up = num('cooldown_upload_sec');
      const upWaited = (now - rates.last(`upload:${ipHash}`)) / 1000;
      if (req.file && up > 0 && upWaited < up) return bail(`Please wait ${Math.ceil(up - upWaited)} more seconds before uploading another file.`, 429);
    }

    let thread = null;
    if (threadId) {
      thread = db.prepare('SELECT * FROM posts WHERE id = ? AND board = ? AND thread_id IS NULL').get(threadId, board.slug);
      if (!thread) return bail('Thread not found.', 404);
      if (thread.archived) return bail('This thread is archived and read-only.', 403);
      if (thread.locked && !req.admin) return bail('This thread is locked.', 403);
    }
    // --- per-board posting rules ---
    if (board.text_only && req.file) return bail('This is a text-only board; files are not allowed.');
    if (!thread && board.require_subject && !subject) return bail('A subject is required for new threads on this board.');
    if (req.file && req.file.size > boardMaxMb(board) * 1024 * 1024) return bail(`File too large (max ${boardMaxMb(board)} MB on this board).`);
    if (thread && req.file && board.image_limit
        && db.prepare('SELECT COUNT(*) AS n FROM posts WHERE (id = ? OR thread_id = ?) AND file_orig IS NOT NULL').get(thread.id, thread.id).n >= board.image_limit) {
      return bail(`This thread has reached its image limit (${board.image_limit}). Post without a file.`);
    }
    if (!thread && !req.file && !board.text_only) return bail('A file is required to start a thread.');
    if (!req.file && !body) return bail('Post must contain a comment or a file.');

    const logging = settings.logging_enabled === '1';
    const loggedIp = logging ? normIp(req.ip) : null;
    const excerpt = `${subject ? `[${subject}] ` : ''}${body}`;
    const reject = (detail, msg) => {
      mod.createAlert({ kind: 'blocked', board: board.slug, thread_id: thread?.id, detail, excerpt, ip: loggedIp });
      return bail(msg, 403);
    };

    // --- spam heuristics (staff are exempt) ---
    if (!req.admin) {
      const maxLinks = num('max_links');
      if (maxLinks > 0 && countLinks(`${subject}\n${body}`) > maxLinks) {
        return bail(`Too many links (max ${maxLinks} per post).`, 403);
      }
      const dupMin = num('duplicate_window_min');
      if (dupMin > 0 && normalizeText(body).length >= 15) {
        const h = textHash(body);
        if (now - (recentText.get(h) || 0) < dupMin * 60e3) {
          return reject('duplicate text (spam heuristic)', 'This exact message was posted recently. Duplicate posts are not allowed.');
        }
      }
      const floodMax = num('board_flood_per_min');
      if (floodMax > 0 && rates.countSince(`board:${board.slug}`, now - 60e3) >= floodMax) {
        if (now - (floodAlerted.get(board.slug) || 0) > 10 * 60e3) {
          floodAlerted.set(board.slug, now);
          mod.createAlert({ kind: 'blocked', board: board.slug, detail: `flood: over ${floodMax} posts/minute on /${board.slug}/ from multiple IPs`, excerpt, ip: loggedIp });
        }
        return bail('This board is receiving too many posts right now. Try again in a minute.', 429);
      }
    }

    // --- keyword rules ---
    const matches = req.admin ? [] : mod.matchFilters(`${name}\n${subject}\n${body}`);
    const describe = (list) => list.map((f) => `"${f.pattern}"${f.is_regex ? ' (regex)' : ''}`).join(', ');
    const blocking = matches.filter((f) => f.action === 'block');
    if (blocking.length) return reject(describe(blocking), 'Your post was blocked by a content filter.');

    // --- file checks: type sniffing, exact-hash bans, perceptual-hash bans ---
    let mime = null, ext = null, fileSha = null, phash = null;
    if (req.file) {
      const fd = fs.openSync(req.file.path, 'r');
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      const sniffed = sniff(head);
      if (!sniffed) return bail('Unsupported file type. Allowed: jpg, png, gif, webp, mp4, webm.');
      const allowed = board.allowed_types.split(',').map((t) => t.trim()).filter(Boolean);
      if (allowed.length && !allowed.includes(sniffed[1])) return bail(`This board only accepts: ${allowed.join(', ')}.`);
      [mime, ext] = sniffed;
      fileSha = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
      const fileBan = db.prepare('SELECT reason FROM file_bans WHERE sha256 = ?').get(fileSha);
      if (fileBan) return reject(`banned file (exact match): ${fileBan.reason}`, `This file is banned: ${fileBan.reason}`);
      phash = await perceptualHash(req.file.path, mime);
      if (phash) {
        const threshold = num('phash_threshold');
        const near = db.prepare('SELECT reason, phash FROM file_bans WHERE phash IS NOT NULL').all()
          .find((f) => hamming(f.phash, phash) <= threshold);
        if (near) return reject(`banned file (similar image): ${near.reason}`, `This image is banned: ${near.reason}`);
      }
    }
    const fileOrig = req.file ? req.file.originalname.slice(0, 100) : null;
    const fileSize = req.file?.size ?? null;

    const country = board.country_flags ? mod.countryOf(req) : null;
    const r = db.prepare(`INSERT INTO posts (board, thread_id, name, subject, body, file, file_mime, file_orig, file_size, ip_hash,
                            created, bumped, capcode, delete_hash, file_phash, tripcode, spoiler, sage, country)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(board.slug, thread?.id ?? null, name, subject, body, null, mime, fileOrig, fileSize, ipHash, now, now,
        capcode, deletePw.length >= 4 ? hashDeletePw(deletePw) : null, phash, tripcode, req.file ? spoiler : 0, sage ? 1 : 0, country);
    const id = Number(r.lastInsertRowid);
    if (board.poster_ids) {
      // Per-thread poster ID: same IP gets the same ID within one thread, different IDs across threads.
      const pid = crypto.createHmac('sha256', serverSecret(db)).update(`${normIp(req.ip)}:${thread?.id ?? id}`).digest('base64url').slice(0, 8);
      db.prepare('UPDATE posts SET poster_id = ? WHERE id = ?').run(pid, id);
    }
    rates.hit(`${kind}:${board.slug}:${ipHash}`, now);
    rates.hit(`board:${board.slug}`, now);
    if (req.file) rates.hit(`upload:${ipHash}`, now);
    if (normalizeText(body).length >= 15) recentText.set(textHash(body), now);

    let file = null;
    if (req.file) {
      const ipTag = logging ? safeIp(req.ip) : 'nolog';
      const tid = thread?.id ?? id;
      let dir = thread ? findThreadDir(tid) : null;
      if (!dir) dir = `${tid}-${slugify(subject || body.split('\n')[0] || 'thread')}.${ipTag}`;
      fs.mkdirSync(path.join(threadsDir, dir), { recursive: true });
      const fname = thread ? `${id}.imagefile.${ipTag}.${ext}` : `post-image-${ipTag}.${ext}`;
      file = path.posix.join('threads', dir, fname);
      // Strips EXIF/GPS and video metadata, records dimensions, writes a thumbnail.
      const media = await storeMedia(req.file.path, path.join(uploadDir, file), mime);
      db.prepare('UPDATE posts SET file = ?, file_sha256 = ?, width = ?, height = ?, thumb = ? WHERE id = ?')
        .run(file, fileSha, media.width, media.height, media.thumb ? 1 : 0, id);
    }

    if (matches.length) {
      mod.createAlert({ kind: 'keyword', post_id: id, board: board.slug, thread_id: thread?.id ?? id, detail: describe(matches), excerpt, ip: loggedIp });
    }

    if (logging) {
      db.prepare(`INSERT INTO post_logs (post_id, board, thread_id, kind, name, subject, body, file, file_orig, file_mime, file_size, ip, user_agent, created)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, board.slug, thread?.id ?? id, kind, name, subject, body,
          file, fileOrig, mime, fileSize, req.ip, String(req.get('user-agent') || '').slice(0, 300), now);
    }

    if (thread) {
      const bump = !sage && thread.reply_count < (board.bump_limit || bumpLimit);
      db.prepare(`UPDATE posts SET reply_count = reply_count + 1 ${bump ? ', bumped = ?' : ''} WHERE id = ?`)
        .run(...(bump ? [now, thread.id] : [thread.id]));
      return res.redirect(nonoko ? `/${board.slug}/` : `/${board.slug}/thread/${thread.id}#p${id}`);
    }
    pruneBoard(board.slug);
    res.redirect(nonoko ? `/${board.slug}/` : `/${board.slug}/thread/${id}`);
  });

  // --- users deleting their own posts with the deletion password they posted with ---
  app.post('/:slug/delete', (req, res, next) => {
    const board = getVisibleBoard(req, req.params.slug);
    if (!board) return next();
    const p = db.prepare('SELECT * FROM posts WHERE id = ? AND board = ?').get(Number(req.body.id), board.slug);
    if (!p) return fail(req, res, 'Post not found.', 404);
    if (!checkDeletePw(String(req.body.password || ''), p.delete_hash)) return fail(req, res, 'Wrong deletion password.', 403);
    if (req.body.file_only) {
      if (!p.file) return fail(req, res, 'That post has no file.');
      db.prepare('UPDATE posts SET file = NULL WHERE id = ?').run(p.id);
      rmUpload(p.file);
      return res.redirect(`/${board.slug}/thread/${p.thread_id ?? p.id}#p${p.id}`);
    }
    deletePost(p.id);
    res.redirect(p.thread_id ? `/${board.slug}/thread/${p.thread_id}` : `/${board.slug}/`);
  });

  // --- ban appeals (one open appeal per ban, only from someone the ban applies to) ---
  app.post('/appeal', (req, res) => {
    const ban = mod.findBan(req, 'post');
    if (!ban || ban.id !== Number(req.body.ban_id)) return fail(req, res, 'That ban does not apply to you.', 403);
    if (db.prepare('SELECT 1 FROM appeals WHERE ban_id = ? AND status = \'open\'').get(ban.id)) {
      return fail(req, res, 'You already have an open appeal for this ban.');
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM appeals WHERE ban_id = ?').get(ban.id).n >= 2) {
      return fail(req, res, 'This ban has already been appealed twice.');
    }
    const text = String(req.body.text || '').trim().slice(0, 2000);
    if (text.length < 10) return fail(req, res, 'Please explain why the ban should be lifted.');
    db.prepare('INSERT INTO appeals (ban_id, text, ip, created) VALUES (?, ?, ?, ?)').run(ban.id, text, normIp(req.ip), Date.now());
    mod.createAlert({ kind: 'appeal', detail: `appeal for ban #${ban.id} (${ban.kind} ${ban.value}: ${ban.reason})`, excerpt: text,
      ip: getSettings(db).logging_enabled === '1' ? normIp(req.ip) : null });
    render(req, res, 'Appeal sent', V.messagePage('Your appeal has been sent to the moderators. Check back on this page for the result.', '/'));
  });

  // --- user reports: become alerts for staff ---
  app.post('/:slug/report', (req, res, next) => {
    const board = getVisibleBoard(req, req.params.slug);
    if (!board) return next();
    const p = db.prepare('SELECT * FROM posts WHERE id = ? AND board = ?').get(Number(req.body.id), board.slug);
    if (!p) return fail(req, res, 'Post not found.', 404);
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (!reason) return fail(req, res, 'Please give a reason for the report.');
    const key = normIp(req.ip);
    if (Date.now() - (lastReport.get(key) || 0) < 30_000) return fail(req, res, 'Please wait 30 seconds between reports.', 429);
    lastReport.set(key, Date.now());
    mod.createAlert({ kind: 'report', post_id: p.id, board: board.slug, thread_id: p.thread_id ?? p.id, detail: reason,
      excerpt: `${p.subject ? `[${p.subject}] ` : ''}${p.body}`,
      ip: db.prepare('SELECT ip FROM post_logs WHERE post_id = ? ORDER BY id DESC LIMIT 1').get(p.id)?.ip ?? null });
    render(req, res, 'Reported', V.messagePage('Thanks, the post has been reported to the moderators.', `/${board.slug}/post/${p.id}`));
  });

  // Housekeeping: cooldown map, expired sessions, every minute; retention purge every 10 minutes.
  let ticks = 0;
  runPurge();
  setInterval(() => {
    rates.sweep();
    for (const [k, t] of recentText) if (t < Date.now() - 24 * 3600e3) recentText.delete(k);
    for (const [k, t] of lastReport) if (t < Date.now() - 30_000) lastReport.delete(k);
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    if (++ticks % 10 === 0) runPurge();
    const st = getSettings(db);
    const every = Number(st.backup_interval_hours);
    if (every > 0 && ticks % 5 === 0) {
      try { snapshotDb(db, dataDir, { every, keep: Number(st.backup_keep) || 14 }); } catch (err) { console.error(`Automatic backup failed: ${err.message}`); }
    }
  }, 60_000).unref();

  app.use((req, res) => fail(req, res, 'Not found.', 404));
  app.use((err, req, res, _next) => {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    if (err instanceof multer.MulterError) {
      return fail(req, res, err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${maxFileMb} MB).` : err.message);
    }
    console.error(err);
    fail(req, res, 'Internal server error.', 500);
  });

  return { app, db };
}
