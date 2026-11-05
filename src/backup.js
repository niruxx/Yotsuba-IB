import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * Automatic database snapshot (used by the server's scheduler). Writes
 * <data>/backups/auto-<time>.sqlite if the newest automatic snapshot is older than `every` hours,
 * and keeps only the newest `keep` snapshots. Uploads are not included (see `fullBackup`).
 */
export function snapshotDb(db, dataDir, { every, keep }) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const autos = fs.readdirSync(dir).filter((f) => /^auto-.*\.sqlite$/.test(f)).sort();
  const newest = autos.at(-1);
  if (newest && Date.now() - fs.statSync(path.join(dir, newest)).mtimeMs < every * 3600e3) return null;
  const file = path.join(dir, `auto-${stamp()}.sqlite`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = [...autos, path.basename(file)].sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old), { force: true });
  return file;
}

/**
 * Full backup: a consistent database snapshot plus uploads, banners and the GeoIP database,
 * packed into one .tar.gz. Safe to run while the server is running.
 */
export function fullBackup(dataDir, outFile) {
  const work = fs.mkdtempSync(path.join(dataDir, '.backup-'));
  try {
    const db = new DatabaseSync(path.join(dataDir, 'yotsuba.sqlite'));
    db.exec(`VACUUM INTO '${path.join(work, 'yotsuba.sqlite').replace(/'/g, "''")}'`);
    db.close();
    const out = path.resolve(outFile || path.join(dataDir, 'backups', `full-${stamp()}.tar.gz`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const extras = ['uploads', 'banners', 'geoip'].filter((d) => fs.existsSync(path.join(dataDir, d)));
    execFileSync('tar', ['-czf', out, '-C', work, 'yotsuba.sqlite', '-C', dataDir, ...extras], { stdio: 'inherit' });
    return out;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Restores a backup made by `fullBackup` (a .tar.gz) or a bare .sqlite snapshot.
 * The server must be stopped. The current data is moved aside to <data>/pre-restore-<time>/ first.
 */
export function restoreBackup(dataDir, file) {
  const src = path.resolve(file);
  if (!fs.existsSync(src)) throw new Error(`No such file: ${src}`);
  const aside = path.join(dataDir, `pre-restore-${stamp()}`);
  fs.mkdirSync(aside, { recursive: true });
  const isTar = /\.t(ar\.)?gz$/.test(src);
  const moving = isTar ? ['yotsuba.sqlite', 'yotsuba.sqlite-wal', 'yotsuba.sqlite-shm', 'uploads', 'banners', 'geoip']
    : ['yotsuba.sqlite', 'yotsuba.sqlite-wal', 'yotsuba.sqlite-shm'];
  for (const name of moving) {
    const p = path.join(dataDir, name);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(aside, name));
  }
  if (isTar) execFileSync('tar', ['-xzf', src, '-C', dataDir], { stdio: 'inherit' });
  else fs.copyFileSync(src, path.join(dataDir, 'yotsuba.sqlite'));
  return aside;
}
