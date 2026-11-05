import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings, parsePerms, can } from './db.js';
import { registerAdmin } from './admin.js';
import * as V from './views.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESERVED = new Set(['admin', 'static', 'uploads', 'api']);
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
    maxPages = 10, bumpLimit = 300, cooldownSec = 15, trustProxy = false,
  } = opts;
  const db = openDb(dataDir);
  const uploadDir = path.join(dataDir, 'uploads');
  const salt = crypto.randomBytes(16).toString('hex'); // per-process salt for the cooldown hash
  const lastPost = new Map();

  const app = express();
  if (trustProxy) app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/static', express.static(path.join(__dirname, '..', 'public')));
  app.use('/uploads', express.static(uploadDir, { maxAge: '30d', immutable: true }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // --- session handling: disabled accounts are rejected even with a live cookie ---
  app.use((req, res, next) => {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    req.admin = null;
    if (m) {
      const s = db.prepare(`SELECT a.id, a.username, a.role, a.permissions FROM sessions s JOIN admins a ON a.id = s.admin_id
                            WHERE s.token = ? AND s.expires > ? AND a.disabled = 0`).get(m[1], Date.now());
      if (s) { req.admin = { ...s, perms: parsePerms(s.permissions) }; req.sid = m[1]; }
    }
    next();
  });

  const render = (req, res, title, body, status = 200) =>
    res.status(status).type('html').send(V.layout({ title, siteName, admin: req.admin, body }));
  const fail = (req, res, msg, status = 400) => render(req, res, 'Error', V.errorPage(msg), status);
  const getBoard = (slug) => db.prepare('SELECT * FROM boards WHERE slug = ?').get(slug);
  const rmUpload = (file) => fs.rm(path.join(uploadDir, file), { force: true }, () => {});

  function deletePost(id) {
    const files = db.prepare('SELECT file FROM posts WHERE (id = ? OR thread_id = ?) AND file IS NOT NULL').all(id, id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    for (const { file } of files) rmUpload(file);
  }

  function pruneBoard(slug) {
    const keep = threadsPerPage * maxPages;
    const old = db.prepare(`SELECT id FROM posts WHERE board = ? AND thread_id IS NULL
                            ORDER BY bumped DESC LIMIT -1 OFFSET ?`).all(slug, keep);
    for (const { id } of old) deletePost(id);
  }

  // Applies the retention settings from the admin panel. 0 means "keep forever".
  function runPurge() {
    const s = getSettings(db);
    const now = Date.now();
    const threadDays = Number(s.thread_inactivity_days);
    const fileDays = Number(s.file_retention_days);
    const logDays = Number(s.log_retention_days);
    if (threadDays > 0) {
      const stale = db.prepare('SELECT id FROM posts WHERE thread_id IS NULL AND bumped < ?').all(now - threadDays * DAY);
      for (const { id } of stale) deletePost(id);
    }
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
    limits: { fileSize: maxFileMb * 1024 * 1024, files: 1, fields: 10 },
  });

  // --- public routes ---
  app.get('/', (req, res) => {
    const boards = db.prepare('SELECT * FROM boards ORDER BY slug').all();
    render(req, res, siteName, V.homePage(boards));
  });

  registerAdmin(app, { db, render, fail, deletePost, uploadDir, getBoard, RESERVED, runPurge });

  // --- board routes (Express 5 matches /g and /g/ alike) ---
  app.get('/:slug', (req, res, next) => {
    const board = getBoard(req.params.slug);
    if (!board) return next();
    const total = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE board = ? AND thread_id IS NULL').get(board.slug).n;
    const pages = Math.max(1, Math.ceil(total / threadsPerPage));
    const page = Math.min(Math.max(0, parseInt(req.query.page, 10) || 0), pages - 1);
    const ops = db.prepare(`SELECT * FROM posts WHERE board = ? AND thread_id IS NULL
                            ORDER BY bumped DESC LIMIT ? OFFSET ?`).all(board.slug, threadsPerPage, page * threadsPerPage);
    const lastReplies = db.prepare('SELECT * FROM (SELECT * FROM posts WHERE thread_id = ? ORDER BY id DESC LIMIT 5) ORDER BY id');
    const threads = ops.map((op) => {
      const replies = lastReplies.all(op.id);
      return { op, replies, omitted: op.reply_count - replies.length };
    });
    render(req, res, `/${board.slug}/ - ${board.title}`,
      V.boardPage(board, threads, { admin: can(req.admin, 'delete_posts'), page, pages, maxMb: maxFileMb }));
  });
  app.get('/:slug/thread/:id', (req, res, next) => {
    const board = getBoard(req.params.slug);
    if (!board) return next();
    const op = db.prepare('SELECT * FROM posts WHERE id = ? AND board = ? AND thread_id IS NULL').get(Number(req.params.id), board.slug);
    if (!op) return fail(req, res, 'Thread not found (it may have been pruned or deleted).', 404);
    const replies = db.prepare('SELECT * FROM posts WHERE thread_id = ? ORDER BY id').all(op.id);
    render(req, res, `/${board.slug}/ - ${op.subject || op.body.slice(0, 40) || `No.${op.id}`}`,
      V.threadPage(board, op, replies, { admin: can(req.admin, 'delete_posts'), maxMb: maxFileMb }));
  });
  app.get('/:slug/post/:id', (req, res, next) => {
    const p = db.prepare('SELECT id, thread_id FROM posts WHERE id = ? AND board = ?').get(Number(req.params.id), req.params.slug);
    if (!p) return next();
    res.redirect(`/${req.params.slug}/thread/${p.thread_id ?? p.id}#p${p.id}`);
  });

  app.post('/:slug/post', upload.single('file'), (req, res) => {
    const cleanup = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
    const bail = (msg, status) => { cleanup(); fail(req, res, msg, status); };

    const board = getBoard(req.params.slug);
    if (!board) return bail('No such board.', 404);

    const ipHash = crypto.createHash('sha256').update(salt + req.ip).digest('hex').slice(0, 16);
    const now = Date.now();
    if (!req.admin && now - (lastPost.get(ipHash) || 0) < cooldownSec * 1000) {
      return bail(`Please wait ${cooldownSec} seconds between posts.`, 429);
    }

    const threadId = req.body.thread ? Number(req.body.thread) : null;
    const name = String(req.body.name || '').trim().slice(0, 50) || 'Anonymous';
    const subject = threadId ? '' : String(req.body.subject || '').trim().slice(0, 100);
    const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);

    let thread = null;
    if (threadId) {
      thread = db.prepare('SELECT * FROM posts WHERE id = ? AND board = ? AND thread_id IS NULL').get(threadId, board.slug);
      if (!thread) return bail('Thread not found.', 404);
    }
    if (!thread && !req.file) return bail('A file is required to start a thread.');
    if (!req.file && !body) return bail('Post must contain a comment or a file.');

    let file = null, mime = null;
    if (req.file) {
      const fd = fs.openSync(req.file.path, 'r');
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      const kind = sniff(head);
      if (!kind) return bail('Unsupported file type. Allowed: jpg, png, gif, webp, mp4, webm.');
      [mime] = kind;
      file = `${now}${crypto.randomBytes(3).toString('hex')}.${kind[1]}`;
      fs.renameSync(req.file.path, path.join(uploadDir, file));
    }
    const fileOrig = req.file ? req.file.originalname.slice(0, 100) : null;
    const fileSize = req.file?.size ?? null;

    const r = db.prepare(`INSERT INTO posts (board, thread_id, name, subject, body, file, file_mime, file_orig, file_size, ip_hash, created, bumped)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(board.slug, thread?.id ?? null, name, subject, body, file, mime, fileOrig, fileSize, ipHash, now, now);
    lastPost.set(ipHash, now);
    const id = Number(r.lastInsertRowid);

    if (getSettings(db).logging_enabled === '1') {
      db.prepare(`INSERT INTO post_logs (post_id, board, thread_id, kind, name, subject, body, file, file_orig, file_mime, file_size, ip, user_agent, created)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, board.slug, thread?.id ?? id, thread ? 'reply' : 'thread', name, subject, body,
          file, fileOrig, mime, fileSize, req.ip, String(req.get('user-agent') || '').slice(0, 300), now);
    }

    if (thread) {
      const bump = thread.reply_count < bumpLimit;
      db.prepare(`UPDATE posts SET reply_count = reply_count + 1 ${bump ? ', bumped = ?' : ''} WHERE id = ?`)
        .run(...(bump ? [now, thread.id] : [thread.id]));
      return res.redirect(`/${board.slug}/thread/${thread.id}#p${id}`);
    }
    pruneBoard(board.slug);
    res.redirect(`/${board.slug}/thread/${id}`);
  });

  // Housekeeping: cooldown map, expired sessions, every minute; retention purge every 10 minutes.
  let ticks = 0;
  runPurge();
  setInterval(() => {
    const cutoff = Date.now() - cooldownSec * 1000;
    for (const [k, t] of lastPost) if (t < cutoff) lastPost.delete(k);
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    if (++ticks % 10 === 0) runPurge();
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
