import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function createBoardStorage(dataDir, db) {
  const root = path.join(dataDir, 'boards');
  const boardDir = (slug) => {
    if (!/^[a-z0-9]{1,16}$/.test(slug)) throw new Error('Invalid board directory');
    const dir = path.join(root, slug);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const threadDir = (board, id) => path.join(boardDir(board), 'threads', String(id));
  const logRoot = (setting) => setting ? path.resolve(dataDir, setting) : root;
  function writePost(post, ip, settings) {
    const dir = threadDir(post.board, post.thread_id || post.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${post.id}.json`), JSON.stringify(post, null, 2), { mode: 0o600 });
    if (settings.logging_enabled !== '1') return;
    const logs = path.join(logRoot(settings.log_directory), post.board, 'threads', String(post.thread_id || post.id));
    fs.mkdirSync(logs, { recursive: true });
    const record = JSON.stringify({ post_id: post.id, thread_id: post.thread_id || post.id, board: post.board,
      name: post.name, ip, created: post.created, file: post.file_orig }, null, 2) + '\n';
    fs.writeFileSync(path.join(logs, `${post.id}.json.log.out`), record, { mode: 0o600 });
    if (post.file) fs.writeFileSync(path.join(logs, `${path.basename(post.file)}.log.out`), record, { mode: 0o600 });
    for (const file of post.attachments || []) if (file.file) {
      const detail = JSON.stringify({ ...JSON.parse(record), file: file.file_orig, attachment_id: file.id }, null, 2) + '\n';
      fs.writeFileSync(path.join(logs, `${path.basename(file.file)}.log.out`), detail, { mode: 0o600 });
    }
  }
  function walk(dir, visit) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file, visit);
      else if (entry.isFile() && entry.name.endsWith('.log.out')) visit(file);
    }
  }
  function configureLogs(before, after, move) {
    const dest = logRoot(after);
    // Logs must never be placed in directories exposed as static assets.
    for (const publicDir of [path.resolve(dataDir, 'banners'), path.resolve(dataDir, 'branding'), fileURLToPath(new URL('../public', import.meta.url))]) {
      const rel = path.relative(publicDir, dest);
      if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('Choose a private log directory outside public assets and banners.');
    }
    fs.mkdirSync(dest, { recursive: true });
    fs.accessSync(dest, fs.constants.W_OK);
    const source = logRoot(before);
    if (move && source !== dest) {
      const files = [];
      walk(source, (file) => files.push(file));
      for (const file of files) {
        const target = path.join(dest, path.relative(source, file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const times = fs.statSync(file);
        fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
        fs.utimesSync(target, times.atime, times.mtime);
        fs.unlinkSync(file);
      }
    }
  }
  function moveThread(op, board) {
    const source = threadDir(op.board, op.id);
    const target = threadDir(board, op.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(source)) fs.renameSync(source, target);
    for (const post of db.prepare('SELECT * FROM posts WHERE id = ? OR thread_id = ?').all(op.id, op.id)) {
      if (post.file) {
        post.file = path.relative(path.join(dataDir, 'uploads'), path.join(target, path.basename(post.file))).split(path.sep).join('/');
        db.prepare('UPDATE posts SET file = ? WHERE id = ?').run(post.file, post.id);
      }
      for (const file of db.prepare('SELECT id, file FROM attachments WHERE post_id = ? AND file IS NOT NULL').all(post.id)) {
        const moved = path.relative(path.join(dataDir, 'uploads'), path.join(target, path.basename(file.file))).split(path.sep).join('/');
        db.prepare('UPDATE attachments SET file = ? WHERE id = ?').run(moved, file.id);
      }
      post.board = board;
      post.attachments = db.prepare('SELECT * FROM attachments WHERE post_id = ? ORDER BY id').all(post.id);
      fs.writeFileSync(path.join(target, `${post.id}.json`), JSON.stringify(post, null, 2), { mode: 0o600 });
    }
  }
  function purgeLogs(setting, cutoff) {
    walk(logRoot(setting), (file) => {
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    });
  }
  // Migrate existing media without changing public /media URLs; materialize text-only posts too.
  for (const { slug } of db.prepare('SELECT slug FROM boards').all()) boardDir(slug);
  for (const post of db.prepare('SELECT * FROM posts ORDER BY id').all()) {
    const dir = threadDir(post.board, post.thread_id || post.id);
    fs.mkdirSync(dir, { recursive: true });
    if (post.file) {
      const old = path.resolve(dataDir, 'uploads', post.file);
      const target = path.join(dir, path.basename(post.file));
      if (old !== target && fs.existsSync(old)) {
        fs.renameSync(old, target);
        if (fs.existsSync(`${old}.thumb.jpg`)) fs.renameSync(`${old}.thumb.jpg`, `${target}.thumb.jpg`);
        post.file = path.relative(path.join(dataDir, 'uploads'), target).split(path.sep).join('/');
        db.prepare('UPDATE posts SET file = ? WHERE id = ?').run(post.file, post.id);
      }
    }
    // IPs are kept exclusively in private logs, never in post snapshots.
    post.attachments = db.prepare('SELECT * FROM attachments WHERE post_id = ? ORDER BY id').all(post.id);
    fs.writeFileSync(path.join(dir, `${post.id}.json`), JSON.stringify(post, null, 2), { mode: 0o600 });
  }
  return { boardDir, threadDir, writePost, configureLogs, purgeLogs, moveThread };
}
