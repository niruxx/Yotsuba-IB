import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

// Permissions the owner can grant to staff accounts, one by one.
export const PERMISSIONS = {
  delete_posts: 'Delete posts/files, sticky, lock and move threads',
  view_logs: 'View post logs (IP addresses, uploads)',
  manage_boards: 'Create, edit and delete boards',
  manage_settings: 'Change site settings (logging, retention, GeoIP)',
  view_alerts: 'Receive keyword alerts and user reports (live notifications)',
  manage_filters: 'Manage keyword alert/block rules',
  manage_bans: 'Ban IPs, IP ranges, countries and files; handle ban appeals',
};

export const SETTING_DEFAULTS = {
  logging_enabled: '1',        // record raw IP + content of every post
  thread_inactivity_days: '30', // purge threads not bumped for this long (0 = never)
  file_retention_days: '0',     // delete uploaded files older than this (0 = keep forever)
  log_retention_days: '90',     // delete post logs older than this (0 = keep forever)
  geoip_header: '',             // trusted country header from a CDN, e.g. CF-IPCountry (needs --trust-proxy)
  cooldown_thread_sec: '60',    // per IP, per board (boards can override)
  cooldown_reply_sec: '15',     // per IP, per board (boards can override)
  cooldown_upload_sec: '30',    // per IP, site-wide, for posts with a file
  max_links: '3',               // max URLs in one post (0 = unlimited)
  duplicate_window_min: '10',   // reject identical text posted again within N minutes, from any IP (0 = off)
  board_flood_per_min: '30',    // max posts per board per minute across all IPs (0 = off)
  phash_threshold: '8',         // banned-image similarity: max differing bits out of 64 (0 = exact pixels only)
  archive_days: '7',            // pruned/inactive threads stay read-only in the archive this long (0 = delete immediately)
  announcement: '',             // banner text shown at the top of every page
  faq_text: '',                 // content of the /faq page (blank = no FAQ page)
  backup_interval_hours: '24',  // automatic database snapshots (0 = off)
  backup_keep: '14',            // how many automatic snapshots to keep
  birthday_date: '',            // MM-DD: party hats on post images that day (blank = off)
  birthday_hat: 'party',        // party | crown | wizard
  birthday_color: '#e0457b',    // hat colour
};

export function openDb(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'yotsuba.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS boards (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board TEXT NOT NULL REFERENCES boards(slug) ON DELETE CASCADE,
      thread_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      file TEXT,
      file_mime TEXT,
      file_orig TEXT,
      file_size INTEGER,
      ip_hash TEXT NOT NULL,
      created INTEGER NOT NULL,
      bumped INTEGER NOT NULL,
      reply_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_threads ON posts(board, thread_id, bumped DESC);
    CREATE INDEX IF NOT EXISTS idx_replies ON posts(thread_id, id);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- Post logs deliberately have no foreign keys: they survive post/board deletion as evidence.
    CREATE TABLE IF NOT EXISTS post_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      board TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      kind TEXT NOT NULL,            -- 'thread' | 'reply'
      name TEXT, subject TEXT, body TEXT,
      file TEXT, file_orig TEXT, file_mime TEXT, file_size INTEGER,
      ip TEXT NOT NULL,
      user_agent TEXT,
      created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_post_logs_ip ON post_logs(ip);
    CREATE INDEX IF NOT EXISTS idx_post_logs_created ON post_logs(created);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      admin_name TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      ip TEXT,
      created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_log(admin_id, created);
  `);

  // Migrate admin accounts from v0.1 (no roles). The first account becomes the owner.
  const cols = db.prepare('PRAGMA table_info(admins)').all().map((c) => c.name);
  if (!cols.includes('role')) {
    db.exec(`
      ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'staff';
      ALTER TABLE admins ADD COLUMN permissions TEXT NOT NULL DEFAULT '';
      ALTER TABLE admins ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE admins ADD COLUMN disabled_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE admins ADD COLUMN created INTEGER NOT NULL DEFAULT 0;
      UPDATE admins SET role = 'owner' WHERE id = (SELECT MIN(id) FROM admins);
    `);
  }
  const boardCols = db.prepare('PRAGMA table_info(boards)').all().map((c) => c.name);
  if (!boardCols.includes('hidden')) db.exec('ALTER TABLE boards ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
  const postCols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
  if (!postCols.includes('sticky')) {
    db.exec(`
      ALTER TABLE posts ADD COLUMN sticky INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE posts ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE posts ADD COLUMN file_sha256 TEXT;
    `);
  }
  const addCol = (table, col, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };
  addCol('posts', 'file_phash', 'TEXT');
  addCol('posts', 'capcode', 'TEXT');
  addCol('posts', 'delete_hash', 'TEXT');
  addCol('boards', 'thread_cooldown', 'INTEGER');
  addCol('boards', 'reply_cooldown', 'INTEGER');
  addCol('sessions', 'csrf', 'TEXT');
  addCol('posts', 'thumb', 'INTEGER NOT NULL DEFAULT 0');      // 1 = <file>.thumb.jpg exists
  addCol('posts', 'spoiler', 'INTEGER NOT NULL DEFAULT 0');
  addCol('posts', 'width', 'INTEGER');
  addCol('posts', 'height', 'INTEGER');
  addCol('posts', 'tripcode', 'TEXT');
  addCol('posts', 'poster_id', 'TEXT');
  addCol('posts', 'country', 'TEXT');
  addCol('posts', 'sage', 'INTEGER NOT NULL DEFAULT 0');
  addCol('posts', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  addCol('posts', 'archived_at', 'INTEGER');
  addCol('boards', 'category', "TEXT NOT NULL DEFAULT ''");
  addCol('boards', 'position', 'INTEGER NOT NULL DEFAULT 0');
  addCol('boards', 'rules', "TEXT NOT NULL DEFAULT ''");
  addCol('boards', 'poster_ids', 'INTEGER NOT NULL DEFAULT 0');
  addCol('boards', 'country_flags', 'INTEGER NOT NULL DEFAULT 0');
  // Per-board posting rules (NULL = site default where applicable)
  addCol('boards', 'nsfw', 'INTEGER NOT NULL DEFAULT 0');
  addCol('boards', 'max_file_mb', 'REAL');
  addCol('boards', 'allowed_types', "TEXT NOT NULL DEFAULT ''");   // e.g. "jpg,png,webm" ('' = all)
  addCol('boards', 'text_only', 'INTEGER NOT NULL DEFAULT 0');
  addCol('boards', 'require_subject', 'INTEGER NOT NULL DEFAULT 0');
  addCol('boards', 'bump_limit', 'INTEGER');
  addCol('boards', 'image_limit', 'INTEGER');
  addCol('boards', 'threads_per_page', 'INTEGER');
  addCol('boards', 'forced_anon', 'INTEGER NOT NULL DEFAULT 0');
  // Board-scoped staff: comma-separated board slugs ('' = all boards)
  addCol('admins', 'boards', "TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board TEXT NOT NULL REFERENCES boards(slug) ON DELETE CASCADE ON UPDATE CASCADE,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    created INTEGER NOT NULL
  )`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS appeals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ban_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      ip TEXT,
      status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'accepted' | 'denied'
      response TEXT NOT NULL DEFAULT '',
      handled_by TEXT,
      handled_at INTEGER,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,              -- 'ip' | 'range' | 'country'
      value TEXT NOT NULL,             -- 1.2.3.4 | 1.2.3.0/24 | DE
      scope TEXT NOT NULL,             -- 'post' (can read, can't post) | 'access' (can't view the site)
      reason TEXT NOT NULL,
      post_id INTEGER,
      created_by TEXT NOT NULL,
      created INTEGER NOT NULL,
      expires INTEGER,                 -- NULL = permanent
      lifted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      is_regex INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL,            -- 'alert' (post goes through, staff notified) | 'block' (post rejected, staff notified)
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,              -- 'keyword' | 'blocked' | 'report'
      post_id INTEGER,
      board TEXT,
      thread_id INTEGER,
      detail TEXT NOT NULL DEFAULT '', -- matched rules or report reason
      excerpt TEXT NOT NULL DEFAULT '',
      ip TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      handled_by TEXT,
      handled_at INTEGER,
      created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, id);
    CREATE TABLE IF NOT EXISTS file_bans (
      sha256 TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created INTEGER NOT NULL
    );
  `);
  addCol('file_bans', 'phash', 'TEXT');
  return db;
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(expected, actual);
}

export function adminCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
}

export function createAdmin(db, username, password, role = 'staff', permissions = []) {
  db.prepare('INSERT INTO admins (username, password_hash, role, permissions, created) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), role, permissions.join(','), Date.now());
}

export function setPassword(db, adminId, password) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(password), adminId);
  db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId);
}

export function parsePerms(str) {
  return String(str || '').split(',').filter((p) => p in PERMISSIONS);
}

// can(admin, perm) - has the permission anywhere.
// can(admin, perm, board) - has it for that board (staff can be limited to specific boards).
export function can(admin, perm, board) {
  if (!admin) return false;
  if (admin.role === 'owner') return true;
  if (!admin.perms?.includes(perm)) return false;
  if (board && admin.boardList?.length && !admin.boardList.includes(board)) return false;
  return true;
}

export const parseBoards = (str) => String(str || '').split(',').map((b) => b.trim()).filter(Boolean);

export function getSettings(db) {
  const out = { ...SETTING_DEFAULTS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) out[key] = value;
  return out;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// Persistent server secret (tripcodes, poster IDs). Generated once and stored in settings.
export function serverSecret(db) {
  let v = db.prepare("SELECT value FROM settings WHERE key = 'server_secret'").get()?.value;
  if (!v) {
    v = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO settings (key, value) VALUES ('server_secret', ?)").run(v);
  }
  return v;
}
