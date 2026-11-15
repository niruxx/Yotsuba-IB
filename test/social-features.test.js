import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { createAdmin, setSetting } from '../src/db.js';
let directory, db, server, base, owner, viewer, dnsCalls = 0, dnsMode = 'listed';
const form = (fields) => new URLSearchParams(fields);
const get = (url, actor, headers = {}) => fetch(base + url, { redirect: 'manual', headers: { cookie: actor?.cookie || '', ...headers } });
const post = (url, fields, actor, headers = {}) => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { cookie: actor?.cookie || '', ...headers }, body: form({ ...(actor ? { _csrf: actor.csrf } : {}), ...fields }) });
async function login(username) {
  const response = await post('/admin/login', { username, password: 'test-password' });
  const actor = { cookie: response.headers.getSetCookie().find((cookie) => cookie.startsWith('sid=')).split(';')[0] };
  actor.csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(await (await get('/admin/account', actor)).text())[1]; return actor;
}
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yotsuba-discovery-'));
  const instance = createServer({ dataDir: directory, trustProxy: true, networkOptions: { resolve4: async () => { dnsCalls++; if (dnsMode === 'outage') throw Object.assign(new Error('unavailable'), { code: 'EAI_AGAIN' }); return dnsMode === 'listed' ? ['127.0.0.2'] : []; } } });
  db = instance.db; server = await new Promise((resolve) => { const handle = instance.app.listen(0, '127.0.0.1', () => resolve(handle)); }); base = `http://127.0.0.1:${server.address().port}`;
  createAdmin(db, 'owner', 'test-password', 'owner'); createAdmin(db, 'viewer', 'test-password', 'user');
  owner = await login('owner'); viewer = await login('viewer');
  for (const slug of ['g', 'v', 'secret', 'adult']) await post('/admin/boards', { slug, title: slug, visible: slug === 'secret' ? '' : 'on', text_only: 'on', nsfw: slug === 'adult' ? 'on' : '' }, owner);
  for (const key of ['cooldown_thread_sec', 'cooldown_reply_sec', 'cooldown_upload_sec', 'duplicate_window_min']) setSetting(db, key, '0');
});
after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('rich posts render click-to-load embeds and respect site and board switches', async () => {
  const response = await post('/g/post', { body: '[b]Bold[/b] [i]Italic[/i] [u]Under[/u] [s]Strike[/s]\n[aa]  art  [/aa]\nhttps://youtu.be/dQw4w9WgXcQ' });
  assert.equal(response.status, 302); const location = response.headers.get('location');
  const html = await (await get(location)).text();
  assert.match(html, /<strong>Bold<\/strong>/); assert.match(html, /<em>Italic<\/em>/);
  assert.match(html, /class="ascii-art">  art  /); assert.match(html, /class="load-video"/); assert.doesNotMatch(html, /<iframe/);
  await post('/admin/boards/g', { title: 'g', visible: 'on', text_only: 'on', embed_videos_present: '1' }, owner);
  assert.doesNotMatch(await (await get(location)).text(), /class="load-video"/);
  await post('/admin/boards/g', { title: 'g', visible: 'on', text_only: 'on', embed_videos_present: '1', embed_videos: 'on' }, owner);
  setSetting(db, 'video_embeds_enabled', '0'); assert.doesNotMatch(await (await get(location)).text(), /class="load-video"/); setSetting(db, 'video_embeds_enabled', '1');
});

test('favorites require authentication/CSRF for sync and never expose private boards', async () => {
  assert.equal((await get('/api/favorites')).status, 401);
  assert.equal((await post('/api/favorites/g', { enabled: '1' }, viewer)).status, 200);
  assert.deepEqual((await (await get('/api/favorites', viewer)).json()).boards, ['g']);
  assert.equal((await post('/api/favorites/secret', { enabled: '1' }, viewer)).status, 404);
  const noToken = await fetch(base + '/api/favorites/v', { method: 'POST', headers: { cookie: viewer.cookie }, body: form({ enabled: '1' }), redirect: 'manual' }); assert.equal(noToken.status, 403);
  assert.equal((await post('/api/favorites/g', { enabled: '0' }, viewer)).status, 200);
  assert.deepEqual((await (await get('/api/favorites', viewer)).json()).boards, []);
  const directory = await (await get('/boards', owner)).text(); assert.match(directory, /Trending boards/); assert.match(directory, /Favorites only/); assert.doesNotMatch(directory, /class="directory-board" data-board="secret"/);
  assert.doesNotMatch(await (await get('/boards', viewer)).text(), /\/secret\//);
});

test('trending ranks recent public activity and excludes hidden and adult boards by default', async () => {
  const insert = db.prepare("INSERT INTO posts (board, name, body, ip_hash, created, bumped) VALUES (?, 'Anon', 'Activity', 'hash', ?, ?)");
  for (const [board, count, ago] of [['g', 4, 1000], ['v', 1, 1000], ['v', 12, 25 * 3600000], ['secret', 20, 1000], ['adult', 20, 1000]]) for (let i = 0; i < count; i++) insert.run(board, Date.now() - ago, Date.now() - ago);
  const data = await (await get('/api/trending.json')).json(); assert.equal(data.boards[0].slug, 'g');
  assert.ok(!data.boards.some((board) => ['secret', 'adult'].includes(board.slug))); assert.ok(data.boards[0].posts24h >= 4);
  setSetting(db, 'trending_enabled', '0'); assert.deepEqual((await (await get('/api/trending.json')).json()).boards, []); setSetting(db, 'trending_enabled', '1');
});

test('webring directory/export only use approved destinations and omit hidden boards', async () => {
  assert.equal((await get('/webring.json')).status, 404);
  const settings = { video_embeds_enabled: 'on', trending_enabled: 'on', trending_sfw_only: 'on', webring_enabled: 'on', webring_url: 'https://our.example', webring_peers: JSON.stringify([{ name: 'Peer A', url: 'https://a.example', description: '<script>untrusted</script>' }, { name: 'Peer B', url: 'https://b.example', nsfw: true }]) };
  assert.equal((await post('/admin/discovery', settings, viewer)).status, 403);
  assert.equal((await post('/admin/discovery', settings, owner)).status, 302);
  const data = await (await get('/webring.json', null, { host: 'untrusted.example' })).json();
  assert.equal(data.url, 'https://our.example'); assert.deepEqual(data.following, ['https://a.example/webring.json', 'https://b.example/webring.json']); assert.ok(!data.boards.some((board) => board.uri === 'secret'));
  const html = await (await get('/webring')).text(); assert.match(html, /&lt;script&gt;untrusted/); assert.doesNotMatch(html, /<script>untrusted/);
  assert.equal((await get('/webring/next')).headers.get('location'), 'https://a.example'); assert.equal((await get('/webring/previous')).headers.get('location'), 'https://b.example');
  assert.equal((await post('/admin/discovery', { ...settings, webring_peers: '[{"name":"bad","url":"javascript:bad"}]' }, owner)).status, 400);
});

test('DNSBL checks reject exact listings, cache results and honor failure policy', async () => {
  const settings = { dnsbl_enabled: 'on', dnsbl_lists: 'dnsbl.example=127.0.0.2', dnsbl_failure: 'allow', tor_mode: 'allow', tor_post_cooldown_sec: '30', tor_exit_cooldown_sec: '3' };
  assert.equal((await post('/admin/network', settings, viewer)).status, 403);
  assert.equal((await post('/admin/network', settings, owner)).status, 302);
  const headers = { 'x-forwarded-for': '1.2.3.4' };
  assert.equal((await post('/g/post', { body: 'Blocked by DNS' }, null, headers)).status, 403); const before = dnsCalls;
  assert.equal((await post('/g/post', { body: 'Blocked again' }, null, headers)).status, 403); assert.equal(dnsCalls, before);
  dnsMode = 'outage'; setSetting(db, 'dnsbl_lists', 'outage.example=127.0.0.2');
  assert.equal((await post('/g/post', { body: 'Allowed on outage' }, null, headers)).status, 302);
  setSetting(db, 'dnsbl_failure', 'deny'); assert.equal((await post('/g/post', { body: 'Unavailable on outage' }, null, headers)).status, 503);
  setSetting(db, 'dnsbl_enabled', '0');
});

test('Tor policies ignore spoofed headers, enforce signed-client/shared-exit limits and strengthen board rules', async () => {
  setSetting(db, 'tor_extra_exits', '9.9.9.9'); setSetting(db, 'tor_mode', 'allow');
  const headers = { 'x-forwarded-for': '9.9.9.9' };
  const page = await get('/g/', null, headers); const torCookie = page.headers.getSetCookie().find((cookie) => cookie.startsWith('tor_client=')).split(';')[0];
  assert.match(await page.text(), /Tor connection detected/);
  const first = await post('/g/post', { body: 'Tor visitor' }, null, { ...headers, cookie: torCookie }); assert.equal(first.status, 302);
  const location = first.headers.get('location'); const id = Number(/thread\/(\d+)/.exec(location)[1]);
  assert.equal(db.prepare('SELECT is_tor FROM posts WHERE id = ?').get(id).is_tor, 1);
  assert.equal(db.prepare('SELECT is_tor FROM post_logs WHERE post_id = ?').get(id).is_tor, 1);
  assert.doesNotMatch(await (await get(location)).text(), /Tor \/ shared network/);
  assert.match(await (await get(location, owner)).text(), /Tor \/ shared network/);
  assert.equal((await post('/g/post', { body: 'Same client too soon' }, null, { ...headers, cookie: torCookie })).status, 429);
  assert.equal((await post('/g/post', { body: 'Reset cookie still shared exit' }, null, headers)).status, 429);
  setSetting(db, 'tor_exit_cooldown_sec', '0');
  assert.equal((await post('/g/post', { body: 'Independent Tor client' }, null, headers)).status, 302);
  setSetting(db, 'tor_mode', 'block'); db.prepare("UPDATE boards SET tor_mode = 'allow' WHERE slug = 'g'").run();
  assert.equal((await post('/g/post', { body: 'Global block overrides board' }, null, headers)).status, 403);
  assert.equal((await post('/g/post', { body: 'Spoofed Tor headers do nothing' }, null, { 'x-tor': '1', host: 'fake.onion' })).status, 302);
  setSetting(db, 'tor_mode', 'captcha');
  const challenge = await get('/g/', null, { ...headers, cookie: torCookie }); const html = await challenge.text(); assert.match(html, /name="captcha_token"/);
  assert.equal((await post('/g/post', { body: 'Tor requires verification' }, null, { ...headers, cookie: torCookie })).status, 403);
  setSetting(db, 'tor_mode', 'allow');
});
