import { can, createAdmin, getSettings, PERMISSIONS, parsePerms, permissionBoards } from './db.js';
import { esc } from './format.js';
import { page } from './adminViews.js';

export const MEMBER_PERMISSIONS = ['edit_board', 'delete_board', 'manage_members', 'delete_posts', 'view_logs', 'view_alerts', 'manage_bans'];
export const OWNER_PERMISSIONS = ['edit_board', 'delete_board', 'manage_members', 'delete_posts', 'view_alerts', 'manage_bans'];
export const ACCOUNT_ROLES = ['user', 'board_owner', 'moderator', 'staff'];
export function canCreateBoard(db, account) {
  if (!account || account.disabled) return false;
  if (account.role === 'owner' || can(account, 'create_boards') || permissionBoards(account, 'manage_boards') === null) return true;
  return getSettings(db).user_board_creation === '1';
}
export function assignBoardOwner(db, board, accountId) {
  db.prepare("INSERT INTO board_members (board, admin_id, role, permissions) VALUES (?, ?, 'owner', ?)")
    .run(board, accountId, OWNER_PERMISSIONS.join(','));
}
export function registerCommunity(app, { db, render, fail, audit, RESERVED, storage, captchas, captchaIp }) {
  const registrations = new Map();
  app.get('/register', (req, res) => {
    if (getSettings(db).user_registration !== '1') return fail(req, res, 'Public registration is disabled. Ask the site owner for an account.', 403);
    render(req, res, 'Create account', `<section class="box"><h1>Create account</h1><form method="post" action="/register">
      <label>Username <input name="username" required pattern="[A-Za-z0-9_.\\-]{2,32}" maxlength="32" autocomplete="username"></label>
      <label>Password <input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label>
      <table><!--captcha--></table><button>Create account</button></form><p><a href="/admin/login">Sign in</a></p></section>`);
  });
  app.post('/register', (req, res) => {
    if (getSettings(db).user_registration !== '1') return fail(req, res, 'Public registration is disabled.', 403);
    if (req.admin) return fail(req, res, 'Sign out before registering another account.');
    const now = Date.now(), key = captchaIp(req);
    for (const [ip, bucket] of registrations) if (bucket.start < now - 15 * 60_000) registrations.delete(ip);
    const bucket = registrations.get(key) || { start: now, count: 0 };
    if (registrations.size >= 5000 || ++bucket.count > 5) return fail(req, res, 'Too many registration attempts. Try again in 15 minutes.', 429);
    registrations.set(key, bucket);
    const username = String(req.body.username || '').trim(), password = String(req.body.password || '');
    if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username) || password.length < 8 || password.length > 128) return fail(req, res, 'Choose a valid username and a password between 8 and 128 characters.');
    if (getSettings(db).captcha_enabled === '1' && !captchas.verify(req.body.captcha_token, req.body.captcha_answer, key)) return fail(req, res, 'Invalid CAPTCHA. Reload the registration page.', 403);
    if (db.prepare('SELECT id FROM admins WHERE username = ?').get(username)) return fail(req, res, 'Username is unavailable.');
    createAdmin(db, username, password, 'user');
    audit(req, 'register_user', username);
    res.redirect('/admin/login');
  });
  const login = (req, res, next) => req.admin ? next() : res.redirect('/admin/login');
  const allowed = (req, res, next) => {
    if (!req.admin) return res.redirect('/admin/login');
    if (!can(req.admin, 'manage_members', req.params.slug)) return fail(req, res, 'You cannot manage this board’s team.', 403);
    if (!db.prepare('SELECT slug FROM boards WHERE slug = ?').get(req.params.slug)) return fail(req, res, 'Board not found.', 404);
    next();
  };
  app.get('/admin/community', login, (req, res) => {
    const rows = db.prepare(`SELECT m.*, b.title FROM board_members m JOIN boards b ON b.slug = m.board
      WHERE m.admin_id = ? ORDER BY m.board`).all(req.admin.id);
    const create = canCreateBoard(db, req.admin);
    render(req, res, 'My boards', page(req.admin, 'My boards', req.query.msg, `<section class="box">
      <p>Manage your owned boards and moderator assignments here. Site-wide permissions and donor status are controlled by the site owner.</p>
      ${rows.map((row) => `<article><h2><a href="/${esc(row.board)}/">/${esc(row.board)}/ — ${esc(row.title)}</a></h2><p>${esc(row.role)} · ${parsePerms(row.permissions).map((key) => esc(PERMISSIONS[key])).join('; ') || 'No permissions'}</p>
      ${can(req.admin, 'edit_board', row.board) || can(req.admin, 'manage_boards', row.board) ? '<a href="/admin/boards">Customize board</a>' : ''}
      ${can(req.admin, 'manage_members', row.board) ? ` · <a href="/admin/board-staff/${esc(row.board)}">Manage owners and moderators</a>` : ''}</article>`).join('') || '<p>No board assignments yet.</p>'}
      </section>${create ? `<section class="box"><h2>Create your own board</h2><form method="post" action="/admin/community/boards">
      <label>Slug <input name="slug" required pattern="[a-z0-9]{1,16}" maxlength="16"></label>
      <label>Title <input name="title" required maxlength="60"></label><label>Description <textarea name="bio" maxlength="500"></textarea></label>
      <label class="check"><input type="checkbox" name="nsfw"> Adult / NSFW (18+ warning required)</label><button>Create board</button></form></section>` : '<section class="box">Board creation is not enabled for this account. Ask the site owner for access.</section>'}`));
  });
  app.post('/admin/community/boards', login, (req, res) => {
    if (!canCreateBoard(db, req.admin)) return fail(req, res, 'Board creation is not enabled for this account.', 403);
    const slug = String(req.body.slug || '').trim().toLowerCase();
    const title = String(req.body.title || '').trim().slice(0, 60);
    if (!/^[a-z0-9]{1,16}$/.test(slug) || RESERVED.has(slug) || !title) return fail(req, res, 'Choose a valid, unreserved slug and a title.');
    if (db.prepare('SELECT slug FROM boards WHERE slug = ?').get(slug)) return fail(req, res, 'That board already exists.');
    const count = db.prepare("SELECT COUNT(*) AS n FROM board_members WHERE admin_id = ? AND role = 'owner'").get(req.admin.id).n;
    if (req.admin.role !== 'owner' && count >= Number(getSettings(db).max_owned_boards)) return fail(req, res, 'You have reached your owned-board limit.');
    storage.boardDir(slug);
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO boards (slug, title, bio, nsfw, created) VALUES (?, ?, ?, ?, ?)')
        .run(slug, title, String(req.body.bio || '').trim().slice(0, 500), req.body.nsfw ? 1 : 0, Date.now());
      assignBoardOwner(db, slug, req.admin.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    audit(req, 'create_owned_board', `/${slug}/`);
    res.redirect('/admin/community?msg=Board+created.');
  });
  app.get('/admin/board-staff/:slug', allowed, (req, res) => {
    const members = db.prepare(`SELECT m.*, a.username, a.display_name FROM board_members m JOIN admins a ON a.id = m.admin_id
      WHERE m.board = ? ORDER BY m.role, a.username`).all(req.params.slug);
    const owner = req.admin.role === 'owner';
    const checks = (perms) => MEMBER_PERMISSIONS.filter((key) => can(req.admin, key, req.params.slug)).map((key) =>
      `<label class="check"><input type="checkbox" name="member_perm_${key}"${perms.includes(key) ? ' checked' : ''}> ${esc(PERMISSIONS[key])}</label>`).join('');
    const roleSelect = (role = 'moderator') => `<label>Board role <select name="member_role"><option value="moderator">Moderator</option>${owner ? `<option value="owner"${role === 'owner' ? ' selected' : ''}>Board owner</option>` : ''}</select></label>`;
    render(req, res, 'Board team', page(req.admin, `Board team: /${req.params.slug}/`, req.query.msg, `<section class="box">
    <p>Each assignment applies only to /${esc(req.params.slug)}/. Creating an account here does not grant site-wide staff or donor privileges. Only the site owner can assign board ownership. Board roles do not automatically grant capabilities: select the permissions below.</p>
    <h2>Add a user or moderator</h2><form method="post"><label>Username <input name="username" required maxlength="32"></label>
    <label>Password for a new account <input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="leave blank for an existing account"></label>
    ${roleSelect()}${checks(['delete_posts', 'view_alerts'])}<button>Add assignment</button></form></section>
    ${members.map((member) => `<section class="box"><h2>${esc(member.display_name || member.username)} (${esc(member.username)}) — ${esc(member.role)}</h2>
    ${!owner && (member.role === 'owner' || member.admin_id === req.admin.id) ? '<p>Only the site owner can change this assignment.</p>' : `<form method="post"><input type="hidden" name="username" value="${esc(member.username)}">${roleSelect(member.role)}${checks(parsePerms(member.permissions))}
    <button>Save permissions</button> <button name="action" value="remove">Remove assignment</button></form>`}</section>`).join('')}`));
  });
  app.post('/admin/board-staff/:slug', allowed, (req, res) => {
    const username = String(req.body.username || '').trim();
    if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) return fail(req, res, 'Choose a valid username.');
    let target = db.prepare('SELECT id, role FROM admins WHERE username = ?').get(username);
    const existing = target ? db.prepare('SELECT role FROM board_members WHERE board = ? AND admin_id = ?').get(req.params.slug, target.id) : null;
    const owner = req.admin.role === 'owner';
    if (!owner && (target?.role === 'owner' || target?.id === req.admin.id || existing?.role === 'owner')) return fail(req, res, 'Only the site owner can change this assignment.', 403);
    if (req.body.action === 'remove') {
      if (target) db.prepare('DELETE FROM board_members WHERE board = ? AND admin_id = ?').run(req.params.slug, target.id);
    } else {
      const role = req.body.member_role === 'owner' ? 'owner' : 'moderator';
      if (role === 'owner' && !owner) return fail(req, res, 'Only the site owner can appoint board owners.', 403);
      if (Object.keys(req.body).some((key) => key.startsWith('member_perm_') && !MEMBER_PERMISSIONS.includes(key.slice(12)))) return fail(req, res, 'Unsupported board permission.', 403);
      const perms = MEMBER_PERMISSIONS.filter((key) => req.body[`member_perm_${key}`]);
      if (perms.some((key) => !can(req.admin, key, req.params.slug))) return fail(req, res, 'You cannot grant a permission you do not hold.', 403);
      if (req.body.member_role && !['owner', 'moderator'].includes(req.body.member_role)) return fail(req, res, 'Invalid board role.');
      if (!owner && !existing && db.prepare('SELECT COUNT(*) AS n FROM board_members WHERE board = ?').get(req.params.slug).n >= 20) return fail(req, res, 'This board has reached its team limit. Ask the site owner to add more members.');
      const password = String(req.body.password || '');
      if (!target && password.length < 8) return fail(req, res, 'A password of at least eight characters is required for a new account.');
      db.exec('BEGIN');
      try {
        if (!target) { createAdmin(db, username, password, 'user'); target = db.prepare('SELECT id FROM admins WHERE username = ?').get(username); }
        db.prepare('INSERT INTO board_members (board, admin_id, role, permissions) VALUES (?, ?, ?, ?) ON CONFLICT(board, admin_id) DO UPDATE SET role = excluded.role, permissions = excluded.permissions')
          .run(req.params.slug, target.id, role, perms.join(','));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    audit(req, 'change_board_team', `/${req.params.slug}/ ${username}: ${req.body.action === 'remove' ? 'removed' : 'permissions updated'}`);
    res.redirect(`/admin/board-staff/${req.params.slug}?msg=Assignment+saved.`);
  });
}
