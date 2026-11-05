import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

// Permissions the owner can grant to staff accounts, one by one.
export const PERMISSIONS = {
  delete_posts: 'Delete posts and threads',
  view_logs: 'View post logs (IP addresses, uploads)',
  manage_boards: 'Create, edit and delete boards',
  manage_settings: 'Change site settings (logging, retention)',
};

export const SETTING_DEFAULTS = {
  logging_enabled: '1',        // record raw IP + content of every post
  thread_inactivity_days: '30', // purge threads not bumped for this long (0 = never)
  file_retention_days: '0',     // delete uploaded files older than this (0 = keep forever)
  log_retention_days: '90',     // delete post logs older than this (0 = keep forever)
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

export function can(admin, perm) {
  if (!admin) return false;
  if (admin.role === 'owner') return true;
  return admin.perms?.includes(perm) ?? false;
}

export function getSettings(db) {
  const out = { ...SETTING_DEFAULTS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) out[key] = value;
  return out;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
