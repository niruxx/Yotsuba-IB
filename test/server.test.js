// End-to-end tests: start a real server on a random port with a temporary data directory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { createAdmin, setSetting } from '../src/db.js';

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let dir, server, base, db, cookie = '', csrf = '';

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yotsuba-test-'));
  ({ app: server, db } = createServer({ dataDir: dir }));
  createAdmin(db, 'owner', 'correct-horse', 'owner');
  for (const k of ['cooldown_thread_sec', 'cooldown_reply_sec', 'cooldown_upload_sec', 'duplicate_window_min']) setSetting(db, k, 0);
  await new Promise((resolve) => { server = server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (p, opts = {}) => fetch(base + p, { redirect: 'manual', headers: { cookie }, ...opts });
const form = (obj) => new URLSearchParams(obj);
async function staffPost(p, fields) {
  return fetch(base + p, { method: 'POST', redirect: 'manual', headers: { cookie }, body: form({ _csrf: csrf, ...fields }) });
}
async function anonPost(slug, fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('file', new Blob([file], { type: 'image/png' }), 'test.png');
  return fetch(`${base}/${slug}/post`, { method: 'POST', body: fd, redirect: 'manual' });
}

test('health check', async () => {
  const r = await get('/healthz');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, 'ok');
});

test('admin login, CSRF and board creation', async () => {
  const bad = await fetch(`${base}/admin/login`, { method: 'POST', body: form({ username: 'owner', password: 'nope' }) });
  assert.equal(bad.status, 401);

  const r = await fetch(`${base}/admin/login`, { method: 'POST', redirect: 'manual', body: form({ username: 'owner', password: 'correct-horse' }) });
  assert.equal(r.status, 302);
  cookie = r.headers.get('set-cookie').split(';')[0];

  const page = await (await get('/admin/boards')).text();
  csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(page)[1];

  const noToken = await fetch(`${base}/admin/boards`, { method: 'POST', headers: { cookie }, body: form({ slug: 'x', title: 'X' }) });
  assert.equal(noToken.status, 403, 'POST without CSRF token must be rejected');

  const created = await staffPost('/admin/boards', { slug: 'g', title: 'Technology', bio: 'tech talk', visible: 'on' });
  assert.equal(created.status, 302);
  const home = await (await fetch(base)).text();
  assert.match(home, /\/g\/ - Technology/);
});

test('threads need a file; posting works; replies render with backlinks', async () => {
  const noFile = await anonPost('g', { subject: 'hi', body: 'no file' });
  assert.equal(noFile.status, 400);

  const t = await anonPost('g', { subject: 'First thread', body: 'hello world' }, PNG);
  assert.equal(t.status, 302);
  const threadUrl = t.headers.get('location');
  assert.match(threadUrl, /^\/g\/thread\/\d+$/);
  const opId = Number(threadUrl.split('/').pop());

  const r = await anonPost('g', { thread: String(opId), body: `>>${opId}\n>implying` });
  assert.equal(r.status, 302);

  const html = await (await fetch(base + threadUrl)).text();
  assert.match(html, /First thread/);
  assert.match(html, /class="greentext">&gt;implying/);
  assert.match(html, /class="backlinks"/);
});

test('image processing: dimensions, thumbnail, metadata-free storage (needs sharp)', async (t) => {
  try { await import('sharp'); } catch { return t.skip('sharp not installed'); }
  const r = await anonPost('g', { subject: 'sharp test', body: 'img' }, PNG);
  const id = Number(r.headers.get('location').split('/').pop());
  const row = db.prepare('SELECT width, height, thumb FROM posts WHERE id = ?').get(id);
  assert.equal(row.width, 1);
  assert.equal(row.height, 1);
  assert.equal(row.thumb, 1, 'thumbnail should be generated');
  const thumb = await fetch(`${base}/media/thumb/${id}.jpg`);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
  const full = await fetch(`${base}/media/${id}.png`);
  assert.equal(full.status, 200);
  const api = await (await fetch(`${base}/api/g/threads/${id}.json`)).json();
  assert.equal(api.posts[0].w, 1);
});

test('tripcodes and sage', async () => {
  const t = await anonPost('g', { subject: 'trip test', body: 'x', name: 'Bob#secret' }, PNG);
  const id = Number(t.headers.get('location').split('/').pop());
  const html = await (await fetch(`${base}/g/thread/${id}`)).text();
  assert.match(html, /Bob <span class="trip">!/);
  assert.doesNotMatch(html, /secret/);
});

test('JSON API, catalog, search, RSS', async () => {
  const boards = await (await fetch(`${base}/api/boards.json`)).json();
  assert.equal(boards.boards[0].board, 'g');
  const catalog = await (await fetch(`${base}/api/g/catalog.json`)).json();
  assert.ok(catalog[0].threads.length >= 1);
  const tid = catalog[0].threads.at(-1).no;
  const thread = await (await fetch(`${base}/api/g/threads/${tid}.json`)).json();
  assert.equal(thread.posts[0].no, tid);
  assert.equal(thread.posts[0].ip, undefined, 'API must not leak IPs');

  assert.equal((await fetch(`${base}/g/catalog`)).status, 200);
  assert.match(await (await fetch(`${base}/search?q=hello`)).text(), /First thread|hello world/);
  assert.match(await (await fetch(`${base}/g/rss.xml`)).text(), /<rss version="2.0">/);
});

test('keyword block rules reject posts', async () => {
  await staffPost('/admin/filters', { pattern: 'buy cheap pills', action: 'block' });
  const r = await anonPost('g', { thread: '1', body: 'please BUY   cheap pills now' });
  assert.equal(r.status, 403);
  const alerts = await (await get('/admin/alerts')).text();
  assert.match(alerts, /Blocked post/);
});

test('hidden boards are invisible to visitors', async () => {
  await staffPost('/admin/boards', { slug: 'sec', title: 'Secret' });
  assert.equal((await fetch(`${base}/sec/`)).status, 404);
  assert.equal((await get('/sec/')).status, 200, 'staff can still see it');
});

test('bans block posting', async () => {
  await staffPost('/admin/bans', { kind: 'ip', value: '127.0.0.1', scope: 'post', duration: '1h', reason: 'testing' });
  const r = await anonPost('g', { thread: '1', body: 'am I banned?' });
  assert.equal(r.status, 403);
  assert.match(await r.text(), /You are banned/);
});
