import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createBoardStorage } from '../src/storage.js';

test('legacy upload migration, text-only replies, thread moves and log retention', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yotsuba-storage-'));
  const db = openDb(dir);
  try {
    db.prepare('INSERT INTO boards (slug, title, created) VALUES (?, ?, 1)').run('g', 'Technology');
    db.prepare('INSERT INTO boards (slug, title, created) VALUES (?, ?, 1)').run('v', 'Games');
    const legacy = 'threads/1-old/old.png';
    fs.mkdirSync(path.dirname(path.join(dir, 'uploads', legacy)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'uploads', legacy), 'media');
    fs.writeFileSync(path.join(dir, 'uploads', legacy) + '.thumb.jpg', 'thumbnail');
    db.prepare("INSERT INTO posts (id, board, name, ip_hash, created, bumped, file) VALUES (1, 'g', 'Anon', 'hash', 1, 1, ?)").run(legacy);
    db.prepare("INSERT INTO posts (id, board, thread_id, name, body, ip_hash, created, bumped) VALUES (2, 'g', 1, 'Reply', 'Text', 'hash', 1, 1)").run();
    const storage = createBoardStorage(dir, db);
    assert.equal(fs.readFileSync(path.join(storage.threadDir('g', 1), 'old.png'), 'utf8'), 'media');
    assert.ok(fs.existsSync(path.join(storage.threadDir('g', 1), 'old.png.thumb.jpg')));
    assert.ok(fs.existsSync(path.join(storage.threadDir('g', 1), '2.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'uploads', legacy)));
    const op = db.prepare('SELECT * FROM posts WHERE id = 1').get();
    storage.writePost(op, '127.0.0.1', { logging_enabled: '1', log_directory: '' });
    storage.moveThread(op, 'v');
    db.prepare("UPDATE posts SET board = 'v'").run();
    assert.ok(!fs.existsSync(storage.threadDir('g', 1)));
    const file = db.prepare('SELECT file FROM posts WHERE id = 1').get().file;
    assert.equal(fs.readFileSync(path.resolve(dir, 'uploads', file), 'utf8'), 'media');
    assert.equal(JSON.parse(fs.readFileSync(path.join(storage.threadDir('v', 1), '2.json'))).board, 'v');
    storage.purgeLogs('', Date.now() + 1000);
    assert.ok(!fs.existsSync(path.join(storage.threadDir('v', 1), '1.json.log.out')));
    assert.ok(fs.existsSync(path.join(storage.threadDir('v', 1), '1.json')));
    assert.throws(() => storage.configureLogs('', path.join(dir, 'branding'), false), /private/);
    createBoardStorage(dir, db); // restart is idempotent
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
