import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { can, getSettings } from './db.js';
import * as M from './moderationViews.js';
import { perceptualHash, hamming } from './antispam.js';

const DURATIONS = { '1h': 3600e3, '1d': 86400e3, '3d': 3 * 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, '365d': 365 * 86400e3, perm: null };

export const normIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

// ---------------- GeoIP (country lookup) ----------------
// Uses, in order: a trusted CDN header (e.g. CF-IPCountry) if configured, then the
// db-ip.com "IP to Country Lite" database (CC BY 4.0) downloaded by `yotsuba-ib update-geoip`.
export const geoDbPath = (dataDir) => path.join(dataDir, 'geoip', 'country.mmdb');

export async function loadGeo(dataDir) {
  const file = geoDbPath(dataDir);
  if (!fs.existsSync(file)) return null;
  try {
    const m = await import('maxmind');
    const Reader = m.Reader ?? m.default?.Reader;
    return new Reader(fs.readFileSync(file));
  } catch (err) {
    console.error(`GeoIP database could not be loaded (${err.message}); country bans only work via a CDN header.`);
    return null;
  }
}

export async function downloadGeoDb(dataDir) {
  const file = geoDbPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = new Date();
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const url = `https://download.db-ip.com/free/dbip-country-lite-${stamp}.mmdb.gz`;
    const res = await fetch(url, { headers: { 'User-Agent': 'yotsuba-ib' } });
    if (!res.ok) continue;
    const data = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
    fs.writeFileSync(`${file}.tmp`, data);
    fs.renameSync(`${file}.tmp`, file);
    return { url, bytes: data.length };
  }
  throw new Error('Could not download the db-ip.com country database (tried the last 3 months).');
}

export function createModeration({ db, geo, trustProxy }) {
  // ---------- bans (cached, rebuilt when changed and every minute for expiries) ----------
  let cache = null;
  const invalidate = () => { cache = null; };
  function activeBans() {
    if (cache && cache.at > Date.now() - 60_000) return cache;
    const rows = db.prepare('SELECT * FROM bans WHERE lifted = 0 AND (expires IS NULL OR expires > ?) ORDER BY id DESC').all(Date.now());
    cache = { at: Date.now(), rows };
    return cache;
  }

  function countryOf(req) {
    const header = getSettings(db).geoip_header.trim();
    if (header && trustProxy) {
      const v = String(req.get(header) || '').trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(v)) return v;
    }
    if (geo) {
      try { return geo.get(normIp(req.ip))?.country?.iso_code ?? null; } catch { return null; }
    }
    return null;
  }

  function ipMatches(ban, ip) {
    const family = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
    const list = new net.BlockList();
    try {
      if (ban.kind === 'ip') {
        const v = normIp(ban.value);
        list.addAddress(v, net.isIPv6(v) ? 'ipv6' : 'ipv4');
      } else {
        const [addr, prefix] = ban.value.split('/');
        list.addSubnet(addr, Number(prefix), net.isIPv6(addr) ? 'ipv6' : 'ipv4');
      }
      return list.check(ip, family);
    } catch { return false; }
  }

  // scope 'access': only bans that block viewing. scope 'post': every active ban.
  function findBan(req, scope) {
    const ip = normIp(req.ip);
    let country;
    for (const ban of activeBans().rows) {
      if (scope === 'access' && ban.scope !== 'access') continue;
      if (ban.kind === 'country') {
        if (country === undefined) country = countryOf(req);
        if (country && country === ban.value) return { ...ban, country };
      } else if (net.isIP(ip) && ipMatches(ban, ip)) return ban;
    }
    return null;
  }

  // ---------- keyword filters ----------
  let filterCache = null;
  function filters() {
    if (!filterCache) {
      filterCache = db.prepare('SELECT * FROM filters ORDER BY id').all().map((f) => {
        let test;
        if (f.is_regex) {
          try { const re = new RegExp(f.pattern, 'iu'); test = (t) => re.test(t); } catch { test = () => false; }
        } else {
          const needle = f.pattern.toLowerCase().replace(/\s+/g, ' ');
          test = (t) => t.includes(needle);
        }
        return { ...f, test };
      });
    }
    return filterCache;
  }
  const invalidateFilters = () => { filterCache = null; };
  function matchFilters(text) {
    const plain = text.toLowerCase().replace(/\s+/g, ' ');
    return filters().filter((f) => (f.is_regex ? f.test(text) : f.test(plain)));
  }

  // ---------- alerts + live push (Server-Sent Events) ----------
  const clients = new Set();
  function createAlert(a) {
    const r = db.prepare(`INSERT INTO alerts (kind, post_id, board, thread_id, detail, excerpt, ip, created)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(a.kind, a.post_id ?? null, a.board ?? null, a.thread_id ?? null, a.detail ?? '', (a.excerpt ?? '').slice(0, 500), a.ip ?? null, Date.now());
    const alert = { id: Number(r.lastInsertRowid), kind: a.kind, board: a.board, post_id: a.post_id, thread_id: a.thread_id,
      detail: a.detail, excerpt: (a.excerpt ?? '').slice(0, 200) };
    const msg = `event: alert\ndata: ${JSON.stringify(alert)}\n\n`;
    for (const c of clients) c.write(msg);
  }
  setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25_000).unref();

  return { findBan, countryOf, matchFilters, createAlert, invalidate, invalidateFilters, clients, hasGeo: !!geo };
}

// ---------------- admin routes ----------------
export function registerModeration(app, ctx) {
  const { db, render, fail, deletePost, mod, audit, rmUpload, uploadDir } = ctx;
  const need = (perm) => (req, res, next) => {
    if (!req.admin) return res.redirect('/admin/login');
    if (!can(req.admin, perm)) return fail(req, res, 'You do not have permission to do that.', 403);
    next();
  };
  const back = (res, to, msg) => res.redirect(`${to}${to.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}`);
  const postIp = (postId) => db.prepare('SELECT ip FROM post_logs WHERE post_id = ? ORDER BY id DESC LIMIT 1').get(postId)?.ip
    ?? db.prepare('SELECT ip FROM alerts WHERE post_id = ? AND ip IS NOT NULL ORDER BY id DESC LIMIT 1').get(postId)?.ip;

  // ---------- live notifications ----------
  app.get('/admin/events', need('view_alerts'), (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(': connected\n\n');
    mod.clients.add(res);
    req.on('close', () => mod.clients.delete(res));
  });

  app.get('/admin/alerts', need('view_alerts'), (req, res) => {
    const status = req.query.status === 'resolved' ? 'resolved' : 'open';
    const rows = db.prepare(`SELECT a.*, p.id AS live FROM alerts a LEFT JOIN posts p ON p.id = a.post_id
                             WHERE a.status = ? ORDER BY a.id DESC LIMIT 500`).all(status)
      .filter((a) => !req.admin.boardList?.length || req.admin.role === 'owner' || (a.board && req.admin.boardList.includes(a.board)))
      .slice(0, 200);
    render(req, res, 'Alerts', M.alertsPage(req.admin, rows, status, req.query.msg));
  });
  app.post('/admin/alerts/:id', need('view_alerts'), (req, res) => {
    const a = db.prepare('SELECT * FROM alerts WHERE id = ?').get(Number(req.params.id));
    if (!a) return fail(req, res, 'No such alert.', 404);
    const action = req.body.action;
    if (action === 'delete_post') {
      if (!can(req.admin, 'delete_posts', a.board)) return fail(req, res, 'You do not have permission to delete posts there.', 403);
      if (a.post_id) deletePost(a.post_id);
      audit(req, 'delete_post_from_alert', `alert #${a.id}, post No.${a.post_id}: ${a.excerpt.slice(0, 120)}`);
    }
    const status = action === 'reopen' ? 'open' : 'resolved';
    db.prepare('UPDATE alerts SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?').run(status, req.admin.username, Date.now(), a.id);
    audit(req, status === 'open' ? 'reopen_alert' : 'resolve_alert', `alert #${a.id} (${a.kind}) post No.${a.post_id ?? '-'}`);
    back(res, '/admin/alerts', `Alert #${a.id} ${status === 'open' ? 'reopened' : 'resolved'}.`);
  });
  app.post('/admin/alerts-resolve-all', need('view_alerts'), (req, res) => {
    const r = db.prepare('UPDATE alerts SET status = \'resolved\', handled_by = ?, handled_at = ? WHERE status = \'open\'')
      .run(req.admin.username, Date.now());
    audit(req, 'resolve_all_alerts', `${r.changes} alerts`);
    back(res, '/admin/alerts', `Resolved ${r.changes} alerts.`);
  });

  // ---------- keyword filters ----------
  app.get('/admin/filters', need('manage_filters'), (req, res) => {
    const rows = db.prepare('SELECT * FROM filters ORDER BY id DESC').all();
    render(req, res, 'Keyword rules', M.filtersPage(req.admin, rows, req.query.msg));
  });
  app.post('/admin/filters', need('manage_filters'), (req, res) => {
    if (req.body.delete) {
      const f = db.prepare('SELECT * FROM filters WHERE id = ?').get(Number(req.body.delete));
      if (f) {
        db.prepare('DELETE FROM filters WHERE id = ?').run(f.id);
        audit(req, 'delete_filter', `${f.action}: ${f.pattern}`);
      }
      mod.invalidateFilters();
      return back(res, '/admin/filters', 'Rule removed.');
    }
    const pattern = String(req.body.pattern || '').trim().slice(0, 300);
    const isRegex = req.body.is_regex ? 1 : 0;
    const action = req.body.action === 'block' ? 'block' : 'alert';
    const note = String(req.body.note || '').trim().slice(0, 200);
    if (!pattern) return fail(req, res, 'Enter a word, sentence or pattern.');
    if (isRegex) { try { new RegExp(pattern, 'iu'); } catch (e) { return fail(req, res, `Invalid regular expression: ${e.message}`); } }
    db.prepare('INSERT INTO filters (pattern, is_regex, action, note, created_by, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(pattern, isRegex, action, note, req.admin.username, Date.now());
    mod.invalidateFilters();
    audit(req, 'create_filter', `${action}${isRegex ? ' (regex)' : ''}: ${pattern}`);
    back(res, '/admin/filters', 'Rule added.');
  });

  // ---------- bans ----------
  app.get('/admin/bans', need('manage_bans'), (req, res) => {
    let prefill = null;
    if (req.query.post) {
      const postId = Number(req.query.post);
      const p = db.prepare('SELECT id, board, body, subject FROM posts WHERE id = ?').get(postId);
      prefill = { post_id: postId, ip: postIp(postId) || '', excerpt: p ? `${p.subject} ${p.body}`.trim().slice(0, 200) : '' };
    }
    const now = Date.now();
    const active = db.prepare('SELECT * FROM bans WHERE lifted = 0 AND (expires IS NULL OR expires > ?) ORDER BY id DESC').all(now);
    const past = db.prepare('SELECT * FROM bans WHERE lifted = 1 OR (expires IS NOT NULL AND expires <= ?) ORDER BY id DESC LIMIT 50').all(now);
    const fileBans = db.prepare('SELECT * FROM file_bans ORDER BY created DESC').all();
    const appeals = db.prepare(`SELECT ap.*, b.kind, b.value, b.reason, b.scope, b.expires, b.lifted FROM appeals ap
                                JOIN bans b ON b.id = ap.ban_id WHERE ap.status = 'open' ORDER BY ap.id`).all();
    const geoSource = getSettings(db).geoip_header ? `header ${getSettings(db).geoip_header}` : (mod.hasGeo ? 'db-ip.com database' : null);
    render(req, res, 'Bans', M.bansPage(req.admin, { active, past, fileBans, appeals, prefill, geoSource, durations: Object.keys(DURATIONS) }, req.query.msg));
  });

  app.post('/admin/bans', need('manage_bans'), (req, res) => {
    const kind = ['ip', 'range', 'country'].includes(req.body.kind) ? req.body.kind : null;
    let value = String(req.body.value || '').trim();
    const scope = req.body.scope === 'access' ? 'access' : 'post';
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    const dur = Object.hasOwn(DURATIONS, req.body.duration) ? DURATIONS[req.body.duration] : undefined;
    const postId = req.body.post_id ? Number(req.body.post_id) : null;
    if (!kind) return fail(req, res, 'Choose a ban type.');
    if (!reason) return fail(req, res, 'A reason is required.');
    if (dur === undefined) return fail(req, res, 'Choose a duration.');
    if (kind === 'ip') {
      value = normIp(value);
      if (!net.isIP(value)) return fail(req, res, 'Not a valid IP address.');
    } else if (kind === 'range') {
      const [addr, prefix] = value.split('/');
      const max = net.isIPv6(addr) ? 128 : 32;
      if (!net.isIP(addr) || !/^\d+$/.test(prefix || '') || Number(prefix) > max) {
        return fail(req, res, 'Ranges use CIDR notation, e.g. 203.0.113.0/24 or 2001:db8::/32.');
      }
    } else {
      value = value.toUpperCase();
      if (!/^[A-Z]{2}$/.test(value)) return fail(req, res, 'Use a two-letter ISO country code, e.g. DE, US, RU.');
    }
    const now = Date.now();
    db.prepare(`INSERT INTO bans (kind, value, scope, reason, post_id, created_by, created, expires)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(kind, value, scope, reason, postId, req.admin.username, now, dur === null ? null : now + dur);
    mod.invalidate();
    audit(req, 'ban', `${kind} ${value} (${scope === 'access' ? 'block site access' : 'block posting'}, ${req.body.duration}): ${reason}${postId ? ` [post No.${postId}]` : ''}`);
    if (postId && req.body.delete_post && can(req.admin, 'delete_posts')) {
      deletePost(postId);
      audit(req, 'delete_post', `No.${postId} (with ban)`);
    }
    back(res, '/admin/bans', `Banned ${kind} ${value}.`);
  });

  app.post('/admin/bans/:id/lift', need('manage_bans'), (req, res) => {
    const b = db.prepare('SELECT * FROM bans WHERE id = ?').get(Number(req.params.id));
    if (!b) return fail(req, res, 'No such ban.', 404);
    db.prepare('UPDATE bans SET lifted = 1 WHERE id = ?').run(b.id);
    mod.invalidate();
    audit(req, 'lift_ban', `#${b.id} ${b.kind} ${b.value}`);
    back(res, '/admin/bans', `Lifted ban #${b.id}.`);
  });

  app.post('/admin/appeals/:id', need('manage_bans'), (req, res) => {
    const ap = db.prepare('SELECT * FROM appeals WHERE id = ? AND status = \'open\'').get(Number(req.params.id));
    if (!ap) return fail(req, res, 'No such open appeal.', 404);
    const accept = req.body.action === 'accept';
    const response = String(req.body.response || '').trim().slice(0, 500);
    db.prepare('UPDATE appeals SET status = ?, response = ?, handled_by = ?, handled_at = ? WHERE id = ?')
      .run(accept ? 'accepted' : 'denied', response, req.admin.username, Date.now(), ap.id);
    if (accept) { db.prepare('UPDATE bans SET lifted = 1 WHERE id = ?').run(ap.ban_id); mod.invalidate(); }
    audit(req, accept ? 'accept_appeal' : 'deny_appeal', `appeal #${ap.id} for ban #${ap.ban_id}${response ? `: ${response}` : ''}`);
    back(res, '/admin/bans', `Appeal #${ap.id} ${accept ? 'accepted, ban lifted' : 'denied'}.`);
  });

  // ---------- moving threads ----------
  app.get('/admin/move/:id', need('delete_posts'), (req, res) => {
    const op = db.prepare('SELECT * FROM posts WHERE id = ? AND thread_id IS NULL').get(Number(req.params.id));
    if (!op) return fail(req, res, 'No such thread.', 404);
    if (!can(req.admin, 'delete_posts', op.board)) return fail(req, res, `You are not a moderator of /${op.board}/.`, 403);
    const boards = db.prepare('SELECT slug, title FROM boards WHERE slug != ? ORDER BY slug').all(op.board)
      .filter((b) => can(req.admin, 'delete_posts', b.slug));
    render(req, res, 'Move thread', M.movePage(req.admin, op, boards));
  });
  app.post('/admin/move/:id', need('delete_posts'), (req, res) => {
    const op = db.prepare('SELECT * FROM posts WHERE id = ? AND thread_id IS NULL').get(Number(req.params.id));
    if (!op) return fail(req, res, 'No such thread.', 404);
    const target = db.prepare('SELECT slug FROM boards WHERE slug = ?').get(String(req.body.board || ''));
    if (!target || target.slug === op.board) return fail(req, res, 'Choose a different, existing board.');
    if (!can(req.admin, 'delete_posts', op.board) || !can(req.admin, 'delete_posts', target.slug)) {
      return fail(req, res, 'You must moderate both boards to move this thread.', 403);
    }
    db.prepare('UPDATE posts SET board = ? WHERE id = ? OR thread_id = ?').run(target.slug, op.id, op.id);
    db.prepare('UPDATE post_logs SET board = ? WHERE thread_id = ?').run(target.slug, op.id);
    audit(req, 'move_thread', `No.${op.id} /${op.board}/ → /${target.slug}/${op.subject ? ` [${op.subject}]` : ''}`);
    res.redirect(`/${target.slug}/thread/${op.id}`);
  });

  app.post('/admin/file-bans/remove', need('manage_bans'), (req, res) => {
    const sha = String(req.body.sha256 || '');
    db.prepare('DELETE FROM file_bans WHERE sha256 = ?').run(sha);
    audit(req, 'unban_file', sha);
    back(res, '/admin/bans', 'File unbanned.');
  });

  // ---------- per-post staff actions (from the dropdown on each post) ----------
  const POST_ACTIONS = {
    delete: 'delete_posts', delete_file: 'delete_posts', sticky: 'delete_posts', unsticky: 'delete_posts',
    lock: 'delete_posts', unlock: 'delete_posts', move: 'delete_posts', ban: 'manage_bans', ban_file: 'manage_bans',
  };
  app.post('/admin/post-action', async (req, res) => {
    if (!req.admin) return res.redirect('/admin/login');
    const action = req.body.action;
    const perm = POST_ACTIONS[action];
    if (!perm) return fail(req, res, 'Unknown action.');
    if (!can(req.admin, perm)) return fail(req, res, 'You do not have permission to do that.', 403);
    const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.body.id));
    if (!p) return fail(req, res, 'No such post.', 404);
    if (!can(req.admin, perm, p.board)) return fail(req, res, `You are not a moderator of /${p.board}/.`, 403);
    const threadUrl = `/${p.board}/thread/${p.thread_id ?? p.id}`;
    const where = `/${p.board}/ No.${p.id}`;

    switch (action) {
      case 'ban':
        return res.redirect(`/admin/bans?post=${p.id}`);
      case 'move':
        return res.redirect(`/admin/move/${p.id}`);
      case 'delete':
        deletePost(p.id);
        audit(req, p.thread_id ? 'delete_reply' : 'delete_thread',
          `${where}${p.thread_id ? ` in thread ${p.thread_id}` : ` (${p.reply_count} replies)`}: ${p.subject ? `[${p.subject}] ` : ''}${p.body.slice(0, 120)}`);
        return res.redirect(p.thread_id ? threadUrl : `/${p.board}/`);
      case 'delete_file':
      case 'ban_file': {
        if (!p.file) return fail(req, res, 'That post has no file.');
        if (action === 'ban_file') {
          if (!p.file_sha256) return fail(req, res, 'This file was uploaded before hashing was added; delete it instead.');
          const reason = String(req.body.reason || '').trim() || `banned from ${where}`;
          const phash = p.file_phash || await perceptualHash(path.join(uploadDir, p.file), p.file_mime);
          db.prepare('INSERT OR IGNORE INTO file_bans (sha256, reason, created_by, created, phash) VALUES (?, ?, ?, ?, ?)')
            .run(p.file_sha256, reason, req.admin.username, Date.now(), phash);
          // Remove every live copy of the same file, and visually similar images.
          const threshold = Number(getSettings(db).phash_threshold) || 0;
          const copies = db.prepare('SELECT id, file, file_sha256, file_phash FROM posts WHERE file IS NOT NULL').all()
            .filter((c) => c.file_sha256 === p.file_sha256 || (phash && c.file_phash && hamming(c.file_phash, phash) <= threshold));
          for (const c of copies) { db.prepare('UPDATE posts SET file = NULL WHERE id = ?').run(c.id); rmUpload(c.file); }
          audit(req, 'ban_file', `${p.file_orig} (${p.file_sha256.slice(0, 16)}…) from ${where}, ${copies.length} copies removed`);
        } else {
          db.prepare('UPDATE posts SET file = NULL WHERE id = ?').run(p.id);
          rmUpload(p.file);
          audit(req, 'delete_file', `${p.file_orig} from ${where}`);
        }
        return res.redirect(`${threadUrl}#p${p.id}`);
      }
      default: {
        if (p.thread_id) return fail(req, res, 'Only threads can be stickied or locked.');
        const [col, val] = { sticky: ['sticky', 1], unsticky: ['sticky', 0], lock: ['locked', 1], unlock: ['locked', 0] }[action];
        db.prepare(`UPDATE posts SET ${col} = ? WHERE id = ?`).run(val, p.id);
        audit(req, `${action}_thread`, where);
        return res.redirect(threadUrl);
      }
    }
  });
}
