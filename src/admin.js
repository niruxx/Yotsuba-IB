import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  PERMISSIONS, SETTING_DEFAULTS, can, parsePerms, verifyPassword, createAdmin, setPassword,
  getSettings, setSetting,
} from './db.js';
import * as A from './adminViews.js';

const SESSION_MS = 7 * 24 * 3600 * 1000;
const PAGE = 100;
const USERNAME_RE = /^[A-Za-z0-9_.-]{2,32}$/;

export function registerAdmin(app, ctx) {
  const { db, render, fail, deletePost, uploadDir, getBoard, RESERVED } = ctx;

  // Records an action in the staff activity log (visible to the owner).
  const audit = (req, action, detail = '') => db.prepare(
    'INSERT INTO audit_log (admin_id, admin_name, action, detail, ip, created) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(req.admin?.id ?? null, req.admin?.username ?? '(anonymous)', action, detail, req.ip, Date.now());

  const requireLogin = (req, res, next) => (req.admin ? next() : res.redirect('/admin/login'));
  const requirePerm = (perm) => (req, res, next) => {
    if (!req.admin) return res.redirect('/admin/login');
    if (!can(req.admin, perm)) return fail(req, res, 'You do not have permission to do that.', 403);
    next();
  };
  const requireOwner = (req, res, next) => {
    if (!req.admin) return res.redirect('/admin/login');
    if (req.admin.role !== 'owner') return fail(req, res, 'Only the owner can do that.', 403);
    next();
  };
  const back = (res, to, msg) => res.redirect(`${to}?msg=${encodeURIComponent(msg)}`);
  const pageNo = (req) => Math.max(0, parseInt(req.query.page, 10) || 0);
  const permsFromBody = (body) => Object.keys(PERMISSIONS).filter((k) => body[`perm_${k}`]);

  // ---------- login ----------
  app.get('/admin/login', (req, res) => render(req, res, 'Login', A.loginPage()));
  app.post('/admin/login', (req, res) => {
    const { username = '', password = '' } = req.body;
    const a = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!a || !verifyPassword(password, a.password_hash)) {
      return render(req, res, 'Login', A.loginPage('Invalid credentials'), 401);
    }
    if (a.disabled) {
      return render(req, res, 'Login', A.loginPage(`This account is disabled: ${a.disabled_reason || 'no reason given'}`), 403);
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, admin_id, expires) VALUES (?, ?, ?)').run(token, a.id, Date.now() + SESSION_MS);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_MS });
    req.admin = a;
    audit(req, 'login');
    res.redirect('/admin');
  });
  app.post('/admin/logout', (req, res) => {
    if (req.sid) {
      audit(req, 'logout');
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sid);
    }
    res.clearCookie('sid');
    res.redirect('/');
  });

  // ---------- dashboard ----------
  app.get('/admin', requireLogin, (req, res) => {
    const count = (sql) => db.prepare(sql).get().n;
    const stats = {
      boards: count('SELECT COUNT(*) AS n FROM boards'),
      threads: count('SELECT COUNT(*) AS n FROM posts WHERE thread_id IS NULL'),
      posts: count('SELECT COUNT(*) AS n FROM posts'),
      logging: getSettings(db).logging_enabled === '1',
    };
    render(req, res, 'Admin', A.dashboard(req.admin, stats, req.query.msg));
  });

  // ---------- my account ----------
  app.get('/admin/account', requireLogin, (req, res) => render(req, res, 'My account', A.myAccountPage(req.admin, req.query.msg)));
  app.post('/admin/account', requireLogin, (req, res) => {
    const me = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
    if (!verifyPassword(String(req.body.current || ''), me.password_hash)) return fail(req, res, 'Current password is wrong.', 403);
    const pw = String(req.body.password || '');
    if (pw.length < 8) return fail(req, res, 'New password must be at least 8 characters.');
    setPassword(db, me.id, pw);
    audit(req, 'change_own_password');
    res.clearCookie('sid');
    res.redirect('/admin/login');
  });

  // ---------- boards ----------
  app.get('/admin/boards', requirePerm('manage_boards'), (req, res) => {
    const boards = db.prepare('SELECT * FROM boards ORDER BY slug').all();
    render(req, res, 'Boards', A.boardsPage(req.admin, boards, req.query.msg));
  });
  app.post('/admin/boards', requirePerm('manage_boards'), (req, res) => {
    const slug = String(req.body.slug || '').trim().toLowerCase();
    const title = String(req.body.title || '').trim().slice(0, 60);
    const bio = String(req.body.bio || '').trim().slice(0, 500);
    if (!/^[a-z0-9]{1,16}$/.test(slug) || RESERVED.has(slug)) return fail(req, res, 'Invalid or reserved slug.');
    if (!title) return fail(req, res, 'Title is required.');
    if (getBoard(slug)) return fail(req, res, `/${slug}/ already exists.`);
    db.prepare('INSERT INTO boards (slug, title, bio, created) VALUES (?, ?, ?, ?)').run(slug, title, bio, Date.now());
    audit(req, 'create_board', `/${slug}/ "${title}"`);
    back(res, '/admin/boards', `Created /${slug}/`);
  });
  app.post('/admin/boards/:slug', requirePerm('manage_boards'), (req, res) => {
    const board = getBoard(req.params.slug);
    if (!board) return fail(req, res, 'No such board.', 404);
    if (req.body.action === 'delete') {
      const files = db.prepare('SELECT file FROM posts WHERE board = ? AND file IS NOT NULL').all(board.slug);
      db.prepare('DELETE FROM boards WHERE slug = ?').run(board.slug);
      for (const { file } of files) fs.rm(path.join(uploadDir, file), { force: true }, () => {});
      audit(req, 'delete_board', `/${board.slug}/ "${board.title}"`);
      return back(res, '/admin/boards', `Deleted /${board.slug}/`);
    }
    const title = String(req.body.title || '').trim().slice(0, 60) || board.title;
    const bio = String(req.body.bio || '').trim().slice(0, 500);
    db.prepare('UPDATE boards SET title = ?, bio = ? WHERE slug = ?').run(title, bio, board.slug);
    audit(req, 'edit_board', `/${board.slug}/ title "${board.title}" → "${title}"${bio !== board.bio ? ', bio changed' : ''}`);
    back(res, '/admin/boards', `Saved /${board.slug}/`);
  });

  // ---------- moderation ----------
  app.post('/admin/delete-post', requirePerm('delete_posts'), (req, res) => {
    const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.body.id));
    if (!p) return fail(req, res, 'No such post.', 404);
    deletePost(p.id);
    audit(req, p.thread_id ? 'delete_reply' : 'delete_thread',
      `/${p.board}/ No.${p.id}${p.thread_id ? ` in thread ${p.thread_id}` : ` (${p.reply_count} replies)`}: ${p.subject ? `[${p.subject}] ` : ''}${p.body.slice(0, 120)}`);
    res.redirect(p.thread_id ? `/${p.board}/thread/${p.thread_id}` : `/${p.board}/`);
  });

  // ---------- post logs ----------
  app.get('/admin/logs', requirePerm('view_logs'), (req, res) => {
    const filters = {
      ip: String(req.query.ip || '').trim(),
      board: String(req.query.board || '').trim(),
      kind: ['thread', 'reply', 'upload'].includes(req.query.kind) ? req.query.kind : '',
    };
    const where = [];
    const args = [];
    if (filters.ip) { where.push('l.ip = ?'); args.push(filters.ip); }
    if (filters.board) { where.push('l.board = ?'); args.push(filters.board); }
    if (filters.kind === 'upload') where.push('l.file_orig IS NOT NULL');
    else if (filters.kind) { where.push('l.kind = ?'); args.push(filters.kind); }
    const n = pageNo(req);
    const rows = db.prepare(`SELECT l.*, (p.id IS NOT NULL) AS live, (p.file IS NOT NULL AND p.file = l.file) AS file_live
      FROM post_logs l LEFT JOIN posts p ON p.id = l.post_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(...args, PAGE + 1, n * PAGE);
    if (filters.ip) audit(req, 'lookup_ip', filters.ip);
    render(req, res, 'Post logs', A.logsPage(req.admin, rows.slice(0, PAGE),
      { filters, pageNo: n, hasMore: rows.length > PAGE, logging: getSettings(db).logging_enabled === '1' }, req.query.msg));
  });

  // ---------- settings ----------
  app.get('/admin/settings', requirePerm('manage_settings'), (req, res) =>
    render(req, res, 'Settings', A.settingsPage(req.admin, getSettings(db), req.query.msg)));
  app.post('/admin/settings', requirePerm('manage_settings'), (req, res) => {
    const before = getSettings(db);
    const next = { logging_enabled: req.body.logging_enabled ? '1' : '0' };
    for (const key of ['thread_inactivity_days', 'file_retention_days', 'log_retention_days']) {
      const v = Number(req.body[key]);
      next[key] = Number.isFinite(v) && v >= 0 ? String(v) : SETTING_DEFAULTS[key];
    }
    const changes = [];
    for (const [k, v] of Object.entries(next)) {
      if (before[k] !== v) { setSetting(db, k, v); changes.push(`${k}: ${before[k]} → ${v}`); }
    }
    if (changes.length) audit(req, 'change_settings', changes.join(', '));
    ctx.runPurge();
    back(res, '/admin/settings', changes.length ? 'Settings saved.' : 'No changes.');
  });

  // ---------- accounts (owner only) ----------
  const loadAccounts = () => db.prepare('SELECT * FROM admins ORDER BY role = \'owner\' DESC, username').all()
    .map((u) => ({ ...u, perms: parsePerms(u.permissions) }));

  app.get('/admin/accounts', requireOwner, (req, res) =>
    render(req, res, 'Accounts', A.accountsPage(req.admin, loadAccounts(), req.query.msg)));

  app.post('/admin/accounts', requireOwner, (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!USERNAME_RE.test(username)) return fail(req, res, 'Username must be 2-32 letters, numbers, _ . or -');
    if (password.length < 8) return fail(req, res, 'Password must be at least 8 characters.');
    if (db.prepare('SELECT 1 FROM admins WHERE username = ?').get(username)) return fail(req, res, 'Username taken.');
    const perms = permsFromBody(req.body);
    createAdmin(db, username, password, 'staff', perms);
    audit(req, 'create_account', `${username} with [${perms.join(', ') || 'no permissions'}]`);
    back(res, '/admin/accounts', `Created ${username}`);
  });

  app.post('/admin/accounts/:id', requireOwner, (req, res) => {
    const u = db.prepare('SELECT * FROM admins WHERE id = ?').get(Number(req.params.id));
    if (!u) return fail(req, res, 'No such account.', 404);
    const action = req.body.action;

    if (action === 'disable' || action === 'enable') {
      if (u.role === 'owner') return fail(req, res, 'The owner account cannot be disabled.');
      if (action === 'disable') {
        const reason = String(req.body.reason || '').trim().slice(0, 300);
        if (!reason) return fail(req, res, 'A reason is required.');
        db.prepare('UPDATE admins SET disabled = 1, disabled_reason = ? WHERE id = ?').run(reason, u.id);
        db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(u.id);
        audit(req, 'disable_account', `${u.username}: ${reason}`);
      } else {
        db.prepare('UPDATE admins SET disabled = 0, disabled_reason = \'\' WHERE id = ?').run(u.id);
        audit(req, 'enable_account', u.username);
      }
      return back(res, '/admin/accounts', `${action === 'disable' ? 'Disabled' : 'Enabled'} ${u.username}`);
    }

    const changes = [];
    const username = String(req.body.username || '').trim();
    if (username && username !== u.username) {
      if (!USERNAME_RE.test(username)) return fail(req, res, 'Username must be 2-32 letters, numbers, _ . or -');
      if (db.prepare('SELECT 1 FROM admins WHERE username = ?').get(username)) return fail(req, res, 'Username taken.');
      db.prepare('UPDATE admins SET username = ? WHERE id = ?').run(username, u.id);
      changes.push(`renamed ${u.username} → ${username}`);
    }
    const password = String(req.body.password || '');
    if (password) {
      if (password.length < 8) return fail(req, res, 'Password must be at least 8 characters.');
      setPassword(db, u.id, password);
      changes.push('password reset');
    }
    if (u.role !== 'owner') {
      const before = parsePerms(u.permissions);
      const after = permsFromBody(req.body);
      if (before.join() !== after.join()) {
        db.prepare('UPDATE admins SET permissions = ? WHERE id = ?').run(after.join(','), u.id);
        changes.push(`permissions [${before.join(', ')}] → [${after.join(', ')}]`);
      }
    }
    if (changes.length) audit(req, 'edit_account', `${u.username}: ${changes.join('; ')}`);
    if (u.id === req.admin.id && password) { res.clearCookie('sid'); return res.redirect('/admin/login'); }
    back(res, '/admin/accounts', changes.length ? `Updated ${username || u.username}` : 'No changes.');
  });

  app.get('/admin/audit', requireOwner, (req, res) => {
    const filters = { admin: req.query.admin ? Number(req.query.admin) : '' };
    const n = pageNo(req);
    const rows = filters.admin
      ? db.prepare('SELECT * FROM audit_log WHERE admin_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(filters.admin, PAGE + 1, n * PAGE)
      : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(PAGE + 1, n * PAGE);
    const accounts = db.prepare('SELECT id, username FROM admins ORDER BY username').all();
    render(req, res, 'Staff activity', A.auditPage(req.admin, rows.slice(0, PAGE), accounts,
      { filters, pageNo: n, hasMore: rows.length > PAGE }, req.query.msg));
  });
}
