import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { createAdmin, setSetting } from '../src/db.js';
import { totp, recoveryHash } from '../src/security.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let dir, db, server, base, cookie, csrf;
const form = (fields) => new URLSearchParams(fields);
const get = (url, headers = {}) => fetch(base + url, { redirect: 'manual', headers: { cookie, ...headers } });
const post = (url, fields) => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, ...fields }) });
const login = (fields) => fetch(base + '/admin/login', { method: 'POST', redirect: 'manual', body: form({ username: 'owner', password: 'test-password', ...fields }) });
async function upload(board, fields = {}, files = [PNG]) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  for (const [i, file] of files.entries()) data.append('file', new Blob([file], { type: 'image/png' }), `image-${i}.png`);
  return fetch(`${base}/${board}/post`, { method: 'POST', redirect: 'manual', body: data });
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yotsuba-features-'));
  const instance = createServer({ dataDir: dir }); db = instance.db;
  server = await new Promise((resolve) => { const handle = instance.app.listen(0, '127.0.0.1', () => resolve(handle)); });
  base = `http://127.0.0.1:${server.address().port}`;
  createAdmin(db, 'owner', 'test-password', 'owner');
  const response = await login(); cookie = response.headers.get('set-cookie').split(';')[0];
  csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await (await get('/admin/boards')).text())[1];
  for (const slug of ['g', 'v']) await post('/admin/boards', { slug, title: slug, visible: 'on' });
  for (const key of ['cooldown_thread_sec', 'cooldown_reply_sec', 'cooldown_upload_sec', 'duplicate_window_min']) setSetting(db, key, '0');
});
after(async () => {
  await new Promise((resolve) => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('shared bottom navigation, language cookie and safe return URLs', async () => {
  for (const url of ['/', '/g/', '/g/catalog', '/g/archive', '/search', '/admin/account', '/missing']) {
    const html = await (await get(url)).text();
    assert.match(html, /class="bottombar"/); assert.match(html, /id="bottom-theme"/); assert.match(html, /name="language"/);
    assert.match(html, /value="es"/); assert.match(html, /value="ja"/);
  }
  const response = await post('/language', { language: 'es', destination: '/g/' });
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/g/');
  assert.match(response.headers.get('set-cookie'), /language=es/);
  const html = await (await get('/g/', { cookie: 'language=es' })).text();
  assert.match(html, /<html lang="es"/); assert.match(html, /Nuevo hilo/); assert.match(html, /Idioma/); assert.match(html, /Tablones/);
  assert.equal((await post('/language', { language: 'es', destination: '//evil.example' })).headers.get('location'), '/');
  assert.equal((await post('/language', { language: 'invalid' })).status, 400);
});

test('multiple uploads render, log, obey limits, move and delete together', async () => {
  const response = await upload('g', { subject: 'Many images', password: 'delete-me' }, [PNG, PNG]);
  assert.equal(response.status, 302);
  const id = Number(/thread\/(\d+)/.exec(response.headers.get('location'))[1]);
  const extra = db.prepare('SELECT * FROM attachments WHERE post_id = ?').get(id);
  assert.ok(extra.file);
  const html = await (await get(`/g/thread/${id}`, { cookie: '' })).text();
  assert.match(html, new RegExp(`/media/attachments/${extra.id}`));
  assert.equal((await get(`/media/attachments/${extra.id}`, { cookie: '' })).status, 200);
  const api = await (await get(`/api/g/threads/${id}.json`)).json();
  assert.equal(api.posts[0].attachments.length, 1);
  assert.equal(api.posts[0].attachments[0].filename, 'image-1.png');
  const disk = path.resolve(dir, 'uploads', extra.file);
  assert.ok(fs.existsSync(disk + '.log.out'));
  assert.equal(JSON.parse(fs.readFileSync(disk + '.log.out')).name, 'Anonymous');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM post_logs WHERE post_id = ?').get(id).n, 2);
  assert.equal((await upload('g', { subject: 'Invalid' }, [PNG, Buffer.from('not an image')])).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE subject = 'Invalid'").get().n, 0);
  const crypto = await import('node:crypto');
  const banned = Buffer.concat([PNG, Buffer.from('banned extra')]);
  db.prepare("INSERT INTO file_bans (sha256, reason, created_by, created) VALUES (?, 'test extra', 'owner', ?)")
    .run(crypto.createHash('sha256').update(banned).digest('hex'), Date.now());
  assert.equal((await upload('g', { subject: 'Banned extra' }, [PNG, banned])).status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE subject = 'Banned extra'").get().n, 0);
  setSetting(db, 'max_files_per_post', '1');
  assert.equal((await upload('g', {}, [PNG, PNG])).status, 400);
  setSetting(db, 'max_files_per_post', '4');
  db.prepare('UPDATE boards SET image_limit = 2 WHERE slug = ?').run('g');
  assert.equal((await upload('g', { thread: String(id), body: 'too many' })).status, 400);
  assert.equal((await post(`/admin/move/${id}`, { board: 'v' })).status, 302);
  const moved = db.prepare('SELECT file FROM attachments WHERE id = ?').get(extra.id).file;
  assert.match(moved, /boards\/v\/threads/);
  assert.equal((await get(`/media/attachments/${extra.id}`)).status, 200);
  assert.equal((await fetch(base + '/v/delete', { method: 'POST', body: form({ id: String(id), password: 'delete-me', file_only: 'on' }), redirect: 'manual' })).status, 302);
  assert.equal(db.prepare('SELECT file FROM attachments WHERE id = ?').get(extra.id).file, null);
  assert.equal((await get(`/media/attachments/${extra.id}`)).status, 404);
});

test('board-scoped bans isolate posting, reading, media and appeals', async () => {
  await post('/admin/bans', { board: 'g', kind: 'ip', value: '127.0.0.1', scope: 'post', duration: '1h', reason: 'Board only' });
  assert.equal((await upload('g')).status, 403);
  assert.equal((await upload('v', { subject: 'Allowed elsewhere' })).status, 302);
  const ban = db.prepare("SELECT * FROM bans WHERE board = 'g'").get();
  const appeal = await fetch(base + '/appeal', { method: 'POST', body: form({ ban_id: String(ban.id), board: 'g', text: 'Please review this board ban.' }), redirect: 'manual' });
  assert.equal(appeal.status, 200);
  await post(`/admin/bans/${ban.id}/lift`, {});
  assert.equal((await upload('g')).status, 302);
  const postId = db.prepare("SELECT id FROM posts WHERE board = 'g' ORDER BY id DESC LIMIT 1").get().id;
  await post('/admin/bans', { board: 'g', kind: 'ip', value: '127.0.0.1', scope: 'access', duration: '1h', reason: 'Read restriction' });
  assert.equal((await get('/g/', { cookie: '' })).status, 403);
  assert.equal((await get(`/media/${postId}.png`, { cookie: '' })).status, 403);
  assert.equal((await get('/api/g/catalog.json', { cookie: '' })).status, 403);
  assert.equal((await get('/v/', { cookie: '' })).status, 200);
  for (const ban of db.prepare('SELECT id FROM bans WHERE lifted = 0').all()) await post(`/admin/bans/${ban.id}/lift`, {});
});

test('CAPTCHA is opt-in, renders a PNG and rejects missing or reused challenges', async () => {
  let sharp; try { sharp = await import('sharp'); } catch { return; }
  setSetting(db, 'captcha_enabled', '1');
  try {
    const response = await get('/v/', { cookie: '' }); const html = await response.text();
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const token = /name="captcha_token" value="([a-f0-9]+)"/.exec(html)[1];
    const image = await get(`/captcha/${token}.png`, { cookie: '' });
    assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /image\/png/);
    const bytes = Buffer.from(await image.arrayBuffer()); assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal((await upload('v')).status, 403);
    assert.equal((await upload('v', { captcha_token: token, captcha_answer: 'WRONG1' })).status, 403);
    assert.equal((await get(`/captcha/${token}.png`, { cookie: '' })).status, 404);
    assert.equal((await get('/captcha/new', { cookie: '' })).status, 200);
  } finally { setSetting(db, 'captcha_enabled', '0'); }
});

test('staff 2FA enrollment, login enforcement, replay rejection, recovery and disable', async () => {
  const setup = await post('/admin/account/2fa', { action: 'start', current: 'test-password' });
  assert.equal(setup.status, 200);
  assert.equal(setup.headers.get('cache-control'), 'private, no-store');
  const owner = db.prepare("SELECT * FROM admins WHERE username = 'owner'").get();
  assert.match(await setup.text(), /otpauth:\/\/totp/);
  assert.equal((await post('/admin/account/2fa', { action: 'enable', current: 'test-password', otp: 'wrong' })).status, 403);
  const enrollmentCode = totp(owner.totp_pending);
  const response = await post('/admin/account/2fa', { action: 'enable', current: 'test-password', otp: enrollmentCode });
  assert.equal(response.status, 200);
  const html = await response.text(); const codes = html.match(/\b[a-f0-9]{20}\b/g);
  assert.equal(codes.length, 8);
  const enabled = db.prepare('SELECT * FROM admins WHERE id = ?').get(owner.id);
  assert.ok(enabled.totp_secret); assert.ok(!enabled.totp_recovery.includes(codes[0]));
  assert.ok(JSON.parse(enabled.totp_recovery).includes(recoveryHash(codes[0])));
  assert.equal((await login()).status, 401);
  assert.equal((await login({ otp: enrollmentCode })).status, 401, 'enrollment code cannot be reused');
  const freshCode = totp(enabled.totp_secret, Date.now() + 30000);
  assert.equal((await login({ otp: freshCode })).status, 302);
  assert.equal((await login({ otp: freshCode })).status, 401);
  assert.equal((await login({ otp: codes[0] })).status, 302);
  assert.equal((await login({ otp: codes[0] })).status, 401);
  assert.equal((await post('/admin/account/2fa', { action: 'disable', current: 'wrong', otp: codes[1] })).status, 403);
  assert.equal((await post('/admin/account/2fa', { action: 'disable', current: 'test-password', otp: codes[1] })).status, 302);
  assert.equal((await login()).status, 302);
});

test('board-scoped staff cannot create, inspect or lift bans outside their boards', async () => {
  await post('/admin/bans', { board: 'v', kind: 'ip', value: '203.0.113.24', scope: 'post', duration: '1h', reason: 'private-other-board-reason' });
  const foreign = db.prepare("SELECT * FROM bans WHERE value = '203.0.113.24'").get();
  await post(`/admin/bans/${foreign.id}/lift`, {});
  db.prepare("INSERT INTO appeals (ban_id, text, ip, created) VALUES (?, 'private-other-appeal', '203.0.113.24', ?)").run(foreign.id, Date.now());
  const appeal = db.prepare('SELECT id FROM appeals WHERE ban_id = ?').get(foreign.id);
  createAdmin(db, 'boardmod', 'board-password', 'staff', ['manage_bans']);
  db.prepare("UPDATE admins SET boards = 'g' WHERE username = 'boardmod'").run();
  const signed = await fetch(base + '/admin/login', { method: 'POST', redirect: 'manual', body: form({ username: 'boardmod', password: 'board-password' }) });
  const staffCookie = signed.headers.get('set-cookie').split(';')[0];
  const html = await (await get('/admin/bans', { cookie: staffCookie })).text();
  const token = /name="_csrf" value="([a-f0-9]+)"/.exec(html)[1];
  const scopedPost = (url, fields) => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { cookie: staffCookie }, body: form({ _csrf: token, ...fields }) });
  assert.doesNotMatch(html, /private-other-board-reason|private-other-appeal/);
  const fields = { kind: 'ip', value: '203.0.113.9', scope: 'post', duration: '1h', reason: 'Scoped ban' };
  assert.equal((await scopedPost('/admin/bans', fields)).status, 403);
  assert.equal((await scopedPost('/admin/bans', { ...fields, board: 'v' })).status, 403);
  assert.equal((await scopedPost('/admin/bans', { ...fields, board: 'g' })).status, 302);
  assert.equal((await scopedPost(`/admin/bans/${foreign.id}/lift`, {})).status, 403);
  assert.equal((await scopedPost(`/admin/appeals/${appeal.id}`, { action: 'accept' })).status, 403);
  const otherPost = db.prepare("SELECT id FROM posts WHERE board = 'v' LIMIT 1").get();
  assert.equal((await get(`/admin/bans?post=${otherPost.id}`, { cookie: staffCookie })).status, 403);
});

test('appearance administration saves, validates, restores and enforces permissions', async () => {
  const page = await (await get('/admin/appearance')).text();
  assert.match(page, /Live preview/); assert.match(page, /value="midnight"/); assert.match(page, /name="panel_padding"/);
  const homepageBefore = db.prepare("SELECT value FROM settings WHERE key = 'homepage'").get()?.value;
  assert.equal((await post('/admin/appearance', { default_theme: 'forest', custom_colors: 'on', color_bg: '#102030', page_padding: '22', radius: '10', font_size: '16' })).status, 302);
  const saved = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'appearance'").get().value);
  assert.equal(saved.default_theme, 'forest'); assert.equal(saved.page_padding, 22); assert.equal(saved.colors.bg, '#102030');
  for (const url of ['/', '/g/', '/g/catalog', '/admin/account']) {
    const html = await (await get(url, url.startsWith('/admin') ? {} : { cookie: '' })).text();
    assert.match(html, /data-theme="forest"/); assert.match(html, /--site-page-padding:22px/);
    assert.match(html, /:root\[data-theme-preference="site"\]\{--bg:#102030;/);
  }
  const invalid = await post('/admin/appearance', { default_theme: 'forest', color_bg: '</style><script>oops</script>' });
  assert.equal(invalid.status, 400);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'appearance'").get().value, JSON.stringify(saved));
  const noCsrf = await fetch(base + '/admin/appearance', { method: 'POST', headers: { cookie }, body: form({ default_theme: 'ocean' }), redirect: 'manual' });
  assert.equal(noCsrf.status, 403);
  assert.equal((await get('/admin/appearance', { cookie: '' })).status, 302);
  createAdmin(db, 'appearance-limited', 'limited-password', 'staff', ['manage_settings']);
  db.prepare("UPDATE admins SET boards = 'g' WHERE username = 'appearance-limited'").run();
  const logged = await fetch(base + '/admin/login', { method: 'POST', body: form({ username: 'appearance-limited', password: 'limited-password' }), redirect: 'manual' });
  const limitedCookie = logged.headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/admin/appearance', { cookie: limitedCookie })).status, 403);
  assert.equal((await post('/admin/appearance', { action: 'reset' })).status, 302);
  assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'appearance'").get().value).default_theme, 'yotsuba-b');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'homepage'").get()?.value, homepageBefore);
  assert.ok(db.prepare("SELECT id FROM audit_log WHERE action = 'change_appearance'").get());
});
