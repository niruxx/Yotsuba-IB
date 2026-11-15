import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { createAdmin, getSettings, setSetting, hydrateAccount, can, permissionBoards } from '../src/db.js';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let dir, db, server, base, owner, artist, donor, moderator;
const form = (fields) => new URLSearchParams(fields);
const get = (url, actor) => fetch(base + url, { redirect: 'manual', headers: { cookie: actor?.cookie || '' } });
const post = (url, fields, actor) => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { cookie: actor?.cookie || '' }, body: form({ ...(actor ? { _csrf: actor.csrf } : {}), ...fields }) });
async function login(username) {
  const result = await post('/admin/login', { username, password: 'test-password' });
  assert.equal(result.status, 302);
  const actor = { cookie: result.headers.get('set-cookie').split(';')[0] };
  actor.csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await (await get('/admin/account', actor)).text())[1];
  return actor;
}
async function upload(board, actor, fields = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...(actor ? { _csrf: actor.csrf } : {}), ...fields })) data.append(key, value);
  data.append('file', new Blob([PNG], { type: 'image/png' }), 'drawing.png');
  return fetch(`${base}/${board}/post`, { method: 'POST', redirect: 'manual', headers: { cookie: actor?.cookie || '' }, body: data });
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yotsuba-community-'));
  const instance = createServer({ dataDir: dir }); db = instance.db;
  server = await new Promise((resolve) => { const handle = instance.app.listen(0, '127.0.0.1', () => resolve(handle)); });
  base = `http://127.0.0.1:${server.address().port}`;
  createAdmin(db, 'owner', 'test-password', 'owner'); owner = await login('owner');
  await post('/admin/boards', { slug: 'g', title: 'Public technology', visible: 'on' }, owner);
  await post('/admin/boards', { slug: 'private', title: 'Private section', bio: 'hidden test data' }, owner);
  for (const key of ['cooldown_thread_sec', 'cooldown_reply_sec', 'cooldown_upload_sec', 'duplicate_window_min']) setSetting(db, key, '0');
});
after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('site owner creates users and donors without granting staff powers', async () => {
  assert.equal((await post('/admin/accounts', { username: 'artist', password: 'test-password', role: 'board_owner', display_name: 'Artist' }, owner)).status, 302);
  assert.equal((await post('/admin/accounts', { username: 'supporter', password: 'test-password', role: 'user', donor: 'on', donor_label: 'Supporter', display_name: 'Patron' }, owner)).status, 302);
  artist = await login('artist'); donor = await login('supporter');
  assert.equal((await get('/admin/accounts', donor)).status, 403);
  assert.equal((await get('/admin/settings', artist)).status, 403);
  assert.equal((await get('/private/', donor)).status, 404);
  assert.doesNotMatch(await (await get('/', donor)).text(), /Private section/);
  assert.doesNotMatch(await (await get('/search?q=hidden', donor)).text(), /hidden test data/);
  assert.equal((await post('/admin/community/boards', { slug: 'art', title: 'Art' }, artist)).status, 403);
  const user = db.prepare("SELECT * FROM admins WHERE username = 'supporter'").get();
  assert.equal(user.donor, 1); assert.equal(user.role, 'user');
  assert.equal(can(hydrateAccount(db, user), 'manage_boards'), false);
});

test('independent owners create and customize only their own board', async () => {
  setSetting(db, 'user_board_creation', '1'); setSetting(db, 'max_owned_boards', '1');
  assert.equal((await post('/admin/community/boards', { slug: 'art', title: 'Community artwork', bio: 'Original art' }, artist)).status, 302);
  assert.equal((await post('/admin/community/boards', { slug: 'art2', title: 'Too many' }, artist)).status, 400);
  const member = db.prepare("SELECT * FROM board_members WHERE board = 'art'").get(); assert.equal(member.role, 'owner');
  assert.equal((await post('/admin/boards/art', { title: 'Artist studio', bio: 'Draw together', rules: 'Original artwork only', visible: 'on', theme: 'sakura' }, artist)).status, 302);
  const page = await (await get('/art/')).text(); assert.match(page, /Artist studio/); assert.match(page, /Original artwork only/); assert.match(page, /data-theme="sakura"/); assert.match(page, /Draw an image/);
  assert.equal((await post('/admin/boards/g', { title: 'Hijacked', visible: 'on' }, artist)).status, 403);
  assert.equal((await get('/admin/appearance', artist)).status, 403);
  assert.equal((await post('/admin/templates', { template: '4chan' }, artist)).status, 403);
  assert.match(await (await get('/admin/community', artist)).text(), /Manage owners and moderators/);
});

test('board teams delegate selected powers and cannot escalate ownership or site access', async () => {
  assert.equal((await post('/admin/board-staff/art', { username: 'helper', password: 'test-password', member_role: 'moderator', member_perm_delete_posts: 'on', member_perm_view_alerts: 'on' }, artist)).status, 302);
  moderator = await login('helper');
  assert.equal(db.prepare("SELECT role FROM admins WHERE username = 'helper'").get().role, 'user');
  assert.equal((await post('/admin/boards/art', { title: 'No permission' }, moderator)).status, 403);
  assert.equal((await post('/admin/board-staff/g', { username: 'helper', member_perm_delete_posts: 'on' }, artist)).status, 403);
  assert.equal((await post('/admin/board-staff/art', { username: 'supporter', member_role: 'owner' }, artist)).status, 403);
  assert.equal((await post('/admin/board-staff/art', { username: 'helper', member_perm_view_logs: 'on' }, artist)).status, 403);
  assert.equal((await post('/admin/board-staff/art', { username: 'helper', member_perm_manage_settings: 'on' }, artist)).status, 403);
  assert.equal((await get('/admin/accounts', moderator)).status, 403);
  const created = await upload('art', artist, { capcode: 'on', subject: 'Moderation test' }); assert.equal(created.status, 302);
  const id = Number(/thread\/(\d+)/.exec(created.headers.get('location'))[1]);
  assert.equal(db.prepare('SELECT capcode FROM posts WHERE id = ?').get(id).capcode, 'Board Owner');
  assert.doesNotMatch(await (await get(`/admin/bans?post=${id}`, artist)).text(), /127\.0\.0\.1/);
  assert.equal((await post('/admin/bans', { kind: 'ip', post_id: String(id), board: 'art', duration: '1h', reason: 'Board rule violation' }, artist)).status, 302);
  assert.doesNotMatch(await (await get('/admin/bans', artist)).text(), /127\.0\.0\.1/);
  const ban = db.prepare("SELECT * FROM bans WHERE board = 'art'").get();
  assert.equal((await post('/appeal', { ban_id: String(ban.id), board: 'art', text: 'Please reconsider this board ban.' })).status, 200);
  assert.equal(db.prepare("SELECT board FROM alerts WHERE kind = 'appeal' ORDER BY id DESC LIMIT 1").get().board, 'art');
  assert.doesNotMatch(await (await get('/admin/alerts', artist)).text(), /127\.0\.0\.1/);
  assert.equal((await post('/admin/post-action', { action: 'lock', id: String(id) }, moderator)).status, 302);
  const outside = await upload('g', owner); const outsideId = /thread\/(\d+)/.exec(outside.headers.get('location'))[1];
  assert.equal((await post('/admin/post-action', { action: 'delete', id: outsideId }, moderator)).status, 403);
  assert.equal((await post('/admin/board-staff/art', { action: 'remove', username: 'helper' }, artist)).status, 302);
  assert.equal((await post('/admin/post-action', { action: 'unlock', id: String(id) }, moderator)).status, 403);
  // Site owner can explicitly assign another board and grant log access there.
  assert.equal((await post('/admin/board-staff/g', { username: 'supporter', member_role: 'owner', member_perm_edit_board: 'on' }, owner)).status, 302);
  assert.equal((await post('/admin/boards/g', { title: 'Owned technology', visible: 'on' }, donor)).status, 302);
  assert.equal((await post('/admin/boards/g', { action: 'delete' }, donor)).status, 403);
});

test('verified donor posting is optional and cannot spoof staff or bypass abuse controls', async () => {
  const response = await upload('g', donor, { subject: 'Donor artwork', post_as_account: 'on', capcode: 'on' }); assert.equal(response.status, 302);
  const row = db.prepare("SELECT * FROM posts WHERE subject = 'Donor artwork'").get(); assert.equal(row.name, 'Patron'); assert.equal(row.account_badge, 'Supporter'); assert.equal(row.account_verified, 1);
  assert.notEqual(row.capcode, 'Admin');
  // Remove the editing membership so this is an ordinary account again.
  await post('/admin/board-staff/g', { username: 'supporter', action: 'remove' }, owner);
  const ordinary = await upload('g', donor, { subject: 'Anonymous donation', capcode: 'on' }); assert.equal(ordinary.status, 302);
  const anon = db.prepare("SELECT * FROM posts WHERE subject = 'Anonymous donation'").get(); assert.equal(anon.capcode, null); assert.equal(anon.account_badge, null); assert.equal(anon.name, 'Anonymous');
  setSetting(db, 'captcha_enabled', '1');
  assert.equal((await upload('g', donor)).status, 403); setSetting(db, 'captcha_enabled', '0');
  await post('/admin/bans', { kind: 'ip', value: '127.0.0.1', board: 'g', scope: 'post', duration: '1h', reason: 'Account ban test' }, owner);
  assert.equal((await upload('g', donor)).status, 403);
});

test('optional registration never accepts caller-supplied roles or donor privileges', async () => {
  assert.equal((await get('/register')).status, 403);
  setSetting(db, 'user_registration', '1');
  assert.equal((await get('/register')).status, 200);
  assert.equal((await post('/register', { username: 'newuser', password: 'test-password', role: 'owner', donor: 'on', permissions: 'manage_settings' })).status, 302);
  const row = db.prepare("SELECT * FROM admins WHERE username = 'newuser'").get(); assert.equal(row.role, 'user'); assert.equal(row.donor, 0); assert.equal(row.permissions, '');
});

test('drawing tools only appear on boards that accept PNG uploads', async () => {
  assert.match(await (await get('/art/', artist)).text(), /oekaki-open/);
  await post('/admin/boards/art', { title: 'No drawings', text_only: 'on', visible: 'on' }, artist);
  assert.doesNotMatch(await (await get('/art/', artist)).text(), /oekaki-open/);
  await post('/admin/boards/art', { title: 'Only JPEG', allowed_types: 'jpg', visible: 'on' }, artist);
  assert.doesNotMatch(await (await get('/art/', artist)).text(), /oekaki-open/);
});

test('permission scopes do not leak through unrelated global privileges', () => {
  const account = { role: 'staff', perms: ['manage_settings'], globalBoardList: [], memberships: [{ board: 'art', perms: ['view_logs'] }] };
  assert.equal(can(account, 'manage_settings'), true);
  assert.equal(can(account, 'view_logs', 'g'), false); assert.equal(can(account, 'view_logs', 'art'), true);
  assert.deepEqual(permissionBoards(account, 'view_logs'), ['art']);
  assert.equal(can({ role: 'user', perms: ['manage_settings'] }, 'manage_settings'), false);
});
