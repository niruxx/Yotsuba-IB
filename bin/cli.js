#!/usr/bin/env node
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { openDb, adminCount, createAdmin, setPassword } from '../src/db.js';
import { loadGeo, downloadGeoDb } from '../src/moderation.js';
import { fullBackup, restoreBackup } from '../src/backup.js';

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p', default: process.env.PORT || '8420' },
    host: { type: 'string', default: process.env.HOST || '0.0.0.0' },
    data: { type: 'string', short: 'd', default: process.env.YOTSUBA_DATA || './yotsuba-data' },
    name: { type: 'string', default: process.env.YOTSUBA_NAME || 'Yotsuba-IB' },
    'max-file-mb': { type: 'string', default: '20' },
    'trust-proxy': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});

if (a.help) {
  console.log(`Usage: yotsuba-ib [command] [options]

Commands:
  (none)        Start the server (prompts for an admin account on first run)
  add-admin             Create a staff account with no permissions (grant them in /admin/accounts)
  reset-password <user> Set a new password for an account (e.g. a locked-out owner)
  update-geoip          Download the free db-ip.com country database (for country bans; refresh monthly)
  backup [file]         Full backup (database + uploads + banners) to a .tar.gz; safe while running
  restore <file>        Restore a .tar.gz backup or .sqlite snapshot (stop the server first)

Options:
  -p, --port <n>        Port to listen on (default 8420, env PORT)
      --host <addr>     Bind address (default 0.0.0.0)
  -d, --data <dir>      Data directory for database + uploads (default ./yotsuba-data)
      --name <text>     Site name shown in the header
      --max-file-mb <n> Upload size limit (default 20)
      --trust-proxy     Use X-Forwarded-For (enable behind nginx/Caddy)

First-run admin can also be set non-interactively with
YOTSUBA_ADMIN_USER and YOTSUBA_ADMIN_PASS environment variables.`);
  process.exit(0);
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    }
    rl.question(question, (ans) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(ans.trim()); });
  });
}

async function promptAdmin(db, role) {
  let user = process.env.YOTSUBA_ADMIN_USER;
  let pass = process.env.YOTSUBA_ADMIN_PASS;
  if (!user || !pass) {
    if (!process.stdin.isTTY) {
      console.error('No admin account exists. Run interactively, or set YOTSUBA_ADMIN_USER and YOTSUBA_ADMIN_PASS.');
      process.exit(1);
    }
    console.log(role === 'owner' ? '\n== Owner account setup (full control) ==' : '\n== New staff account ==');
    while (!user) user = await ask('Admin username: ');
    for (;;) {
      pass = await ask('Admin password (min 8 chars): ', true);
      if (pass.length < 8) { console.log('Too short.'); continue; }
      if ((await ask('Confirm password: ', true)) === pass) break;
      console.log('Passwords do not match.');
    }
  }
  if (pass.length < 8) { console.error('Admin password must be at least 8 characters.'); process.exit(1); }
  createAdmin(db, user, pass, role);
  console.log(`${role === 'owner' ? 'Owner' : 'Staff'} account "${user}" created.`);
}

const dataDir = path.resolve(a.data);

if (positionals[0] === 'add-admin') {
  const db = openDb(dataDir);
  delete process.env.YOTSUBA_ADMIN_USER;
  delete process.env.YOTSUBA_ADMIN_PASS;
  await promptAdmin(db, adminCount(db) === 0 ? 'owner' : 'staff');
  process.exit(0);
} else if (positionals[0] === 'reset-password') {
  const db = openDb(dataDir);
  const u = db.prepare('SELECT id FROM admins WHERE username = ?').get(positionals[1] || '');
  if (!u) { console.error(`No account named "${positionals[1] || ''}".`); process.exit(1); }
  const pw = await ask('New password (min 8 chars): ', true);
  if (pw.length < 8) { console.error('Too short.'); process.exit(1); }
  setPassword(db, u.id, pw);
  db.prepare('UPDATE admins SET disabled = 0 WHERE id = ?').run(u.id);
  console.log('Password updated.');
  process.exit(0);
} else if (positionals[0] === 'backup') {
  const out = fullBackup(dataDir, positionals[1]);
  console.log(`Backup written to ${out}`);
  process.exit(0);
} else if (positionals[0] === 'restore') {
  if (!positionals[1]) { console.error('Usage: yotsuba-ib restore <backup.tar.gz | snapshot.sqlite>'); process.exit(1); }
  const answer = process.stdin.isTTY ? await ask(`Replace the data in ${dataDir} with ${positionals[1]}? The server must be stopped. [y/N] `) : 'y';
  if (!/^y/i.test(answer)) { console.log('Aborted.'); process.exit(1); }
  const aside = restoreBackup(dataDir, positionals[1]);
  console.log(`Restored. The previous data was moved to ${aside}`);
  process.exit(0);
} else if (positionals[0] === 'update-geoip') {
  try {
    const { url } = await downloadGeoDb(dataDir);
    console.log(`GeoIP database updated from ${url}`);
    console.log('IP geolocation by DB-IP (https://db-ip.com), licensed CC BY 4.0. Restart the server to load it.');
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
} else if (positionals.length) {
  console.error(`Unknown command: ${positionals[0]} (try --help)`);
  process.exit(1);
}

const setupDb = openDb(dataDir);
if (adminCount(setupDb) === 0) await promptAdmin(setupDb, 'owner');
setupDb.close();

const geo = await loadGeo(dataDir);
if (!geo) console.log('No GeoIP database found; country bans need `yotsuba-ib update-geoip` or a CDN country header.');
const { app } = createServer({
  dataDir,
  geo,
  siteName: a.name,
  maxFileMb: Number(a['max-file-mb']),
  trustProxy: a['trust-proxy'],
});
app.listen(Number(a.port), a.host, () => {
  console.log(`${a.name} running at http://localhost:${a.port}  (data: ${dataDir})`);
  console.log(`Admin panel: http://localhost:${a.port}/admin`);
});
