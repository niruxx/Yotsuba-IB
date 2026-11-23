import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { can, getSettings, setSetting, serverSecret } from './db.js';
import { esc } from './format.js';
import { page } from './adminViews.js';

export const TOR_EXIT_URL = 'https://check.torproject.org/torbulkexitlist';
const normalize = (ip) => String(ip).replace(/^::ffff:/, '').toLowerCase();
export function reverseIp(value) {
  const ip = normalize(value), family = net.isIP(ip);
  if (family === 4) return ip.split('.').reverse().join('.');
  if (family !== 6) return null;
  let address = ip;
  if (address.includes('.')) {
    const split = address.lastIndexOf(':'), bytes = address.slice(split + 1).split('.').map(Number);
    address = address.slice(0, split + 1) + ((bytes[0] << 8) | bytes[1]).toString(16) + ':' + ((bytes[2] << 8) | bytes[3]).toString(16);
  }
  const halves = address.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups.map((group) => group.padStart(4, '0')).join('').split('').reverse().join('.');
}
export function publicIp(value) {
  const ip = normalize(value);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  return net.isIPv6(ip) && !/^(?:::|f[cd]|fe[89ab]|ff|2001:db8)/i.test(ip);
}
export function dnsblLists(text) {
  const rows = String(text || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows.length > 5) throw new Error('Configure at most five DNS blocklists.');
  return rows.map((row) => {
    const [zone, codeList, extra] = row.split('=');
    if (extra !== undefined || !zone || zone.length > 180 || !zone.includes('.') || !zone.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new Error('DNSBL entries use zone.example=127.0.0.2,127.0.0.3.');
    const codes = (codeList || '127.0.0.2').split(',').map((code) => code.trim());
    if (codes.length > 16 || codes.some((code) => !net.isIPv4(code) || !code.startsWith('127.0.'))) throw new Error('Use explicit positive DNSBL return codes in 127.0.0.0/16; provider error codes are not listings.');
    return { zone: zone.toLowerCase(), codes };
  });
}
export function torPolicy(settings, board) {
  const policies = ['allow', 'captcha', 'block'];
  return policies[Math.max(policies.indexOf(settings.tor_mode), policies.indexOf(board?.tor_mode))] || 'allow';
}
export function createNetwork({ db, dataDir, torListener = false, resolve4, fetcher = fetch }) {
  const file = path.join(dataDir, 'network', 'tor-exits.txt');
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const resolve = resolve4 || ((name) => resolver.resolve4(name));
  let exits = new Set(), updated = 0, pending = 0, lastError = '';
  const cache = new Map();
  const parseExits = (text) => new Set(String(text).split(/\r?\n/).map((line) => normalize(line.trim())).filter((line) => net.isIP(line)));
  if (fs.existsSync(file)) { exits = parseExits(fs.readFileSync(file, 'utf8')); updated = fs.statSync(file).mtimeMs; }
  function isTor(ip) {
    const manual = parseExits(getSettings(db).tor_extra_exits);
    return torListener || manual.has(normalize(ip)) || (Date.now() - updated < 7 * 86400000 && exits.has(normalize(ip)));
  }
  function middleware(req, res, next) {
    req.isTor = isTor(req.ip);
    if (req.isTor) {
      let token = /(?:^|;\s*)tor_client=([a-f0-9.]+)/.exec(req.headers.cookie || '')?.[1];
      const sign = (value) => crypto.createHmac('sha256', serverSecret(db)).update('tor-client:' + value).digest('hex');
      const parts = (token || '').split('.'), stamp = parseInt(parts[0], 16);
      const valid = parts.length === 3 && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{64}$/.test(parts[2]) && stamp <= Date.now() && stamp > Date.now() - 86400000 && crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(sign(parts[0] + '.' + parts[1])));
      if (!valid) {
        const value = Date.now().toString(16) + '.' + crypto.randomBytes(16).toString('hex');
        token = value + '.' + sign(value);
        res.cookie('tor_client', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
      }
      req.torClient = crypto.createHmac('sha256', serverSecret(db)).update(token).digest('hex');
    }
    next();
  }
  async function check(ip, settings, tor = false) {
    if (settings.dnsbl_enabled !== '1' || (tor && settings.dnsbl_check_tor !== '1') || !publicIp(ip)) return { listed: false, unavailable: false };
    let lists;
    try { lists = dnsblLists(settings.dnsbl_lists); } catch { return { listed: false, unavailable: true }; }
    const key = normalize(ip) + '\n' + settings.dnsbl_lists, now = Date.now();
    const existing = cache.get(key);
    if (existing && existing.expires > now) return existing.value;
    if (pending >= 20) return { listed: false, unavailable: true };
    pending++;
    const promise = (async () => {
      const answers = await Promise.all(lists.map(async ({ zone, codes }) => {
        try {
          const records = await resolve(reverseIp(ip) + '.' + zone);
          const listed = records.some((record) => codes.includes(record));
          const invalid = records.some((record) => !record.startsWith('127.0.'));
          if (invalid) lastError = 'A DNSBL returned an error or unexpected response; unmatched codes were ignored.';
          return { listed, unavailable: !listed && invalid };
        } catch (error) {
          if (['ENOTFOUND', 'ENODATA'].includes(error.code)) return { listed: false, unavailable: false };
          lastError = 'A DNSBL lookup failed or timed out.'; return { listed: false, unavailable: true };
        }
      }));
      return { listed: answers.some((answer) => answer.listed), unavailable: answers.some((answer) => answer.unavailable) };
    })().finally(() => { pending--; });
    if (cache.size >= 5000) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: now + 5 * 60_000, value: promise });
    return promise;
  }
  async function refreshTor() {
    const response = await fetcher(TOR_EXIT_URL, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('Could not download the official Tor exit list.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Tor exit list exceeded the download limit.'); }
      chunks.push(Buffer.from(item.value));
    }
    const parsed = parseExits(Buffer.concat(chunks).toString('utf8'));
    if (parsed.size < 10) throw new Error('The downloaded Tor exit list was invalid; the previous list was kept.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', [...parsed].join('\n') + '\n', { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    exits = parsed; updated = Date.now(); return exits.size;
  }
  return { isTor, middleware, check, refreshTor, status: () => ({ torListener, exits: exits.size, updated, expired: Date.now() - updated >= 7 * 86400000, lastError }) };
}
export function registerNetwork(app, { db, render, fail, audit, network }) {
  const allowed = (req, res, next) => {
    if (!req.admin) return res.redirect('/admin/login');
    if (!can(req.admin, 'manage_settings')) return fail(req, res, 'Site settings permission is required.', 403);
    next();
  };
  app.get('/admin/network', allowed, (req, res) => {
    const settings = getSettings(db), status = network.status();
    render(req, res, 'Network controls', page(req.admin, 'Network controls', req.query.msg, `<section class="box"><h2>Tor exit detection</h2>
      <p>Dedicated Tor listener: ${status.torListener ? 'yes' : 'no'}. Cached exits: ${status.exits}. Last update: ${status.updated ? new Date(status.updated).toISOString() : 'never'}. ${status.expired ? 'List expired or missing: refresh to detect clearnet Tor exits.' : ''}</p>
      <form method="post" action="/admin/network/tor-refresh"><button>Refresh official Tor exit list</button></form></section>
      <form class="box" method="post"><h2>DNS blocklists</h2>
      <label class="check"><input type="checkbox" name="dnsbl_enabled"${settings.dnsbl_enabled === '1' ? ' checked' : ''}> Check posting IPs against configured DNS blocklists</label>
      <label>Zones and positive return codes <textarea name="dnsbl_lists" rows="5">${esc(settings.dnsbl_lists)}</textarea></label>
      <p>One entry per line, e.g. dnsbl.example.org=127.0.0.2,127.0.0.3. Use the provider’s documented codes and authorized DNS resolver. DNS queries disclose the connecting IP to the resolver/provider. No blocklist provider is configured by default.</p>
      <label>On lookup failure <select name="dnsbl_failure"><option value="allow">Allow posting</option><option value="deny"${settings.dnsbl_failure === 'deny' ? ' selected' : ''}>Temporarily reject posting</option></select></label>
      <label class="check"><input type="checkbox" name="dnsbl_check_tor"${settings.dnsbl_check_tor === '1' ? ' checked' : ''}> Also check Tor exit addresses (may block shared Tor exits)</label>
      ${status.lastError ? `<p class="notice">${esc(status.lastError)}</p>` : ''}
      <h2>Tor posting</h2><label>Minimum site policy <select name="tor_mode">${['allow', 'captcha', 'block'].map((mode) => `<option${settings.tor_mode === mode ? ' selected' : ''}>${mode}</option>`).join('')}</select></label>
      <label>Tor client cooldown (seconds) <input name="tor_post_cooldown_sec" type="number" min="0" max="3600" value="${esc(settings.tor_post_cooldown_sec)}"></label>
      <label>Shared exit cooldown (seconds) <input name="tor_exit_cooldown_sec" type="number" min="0" max="60" value="${esc(settings.tor_exit_cooldown_sec)}"></label>
      <label>Additional known Tor/proxy IPs (one per line) <textarea name="tor_extra_exits" rows="4">${esc(settings.tor_extra_exits)}</textarea></label>
      <p>Boards may strengthen the site policy, not weaken it. Tor clients receive a signed session cookie for client cooldowns; a separate exit cooldown and board flood controls remain in effect. Tor headers and onion-looking Host headers are never trusted. Use --tor-listener only on a dedicated, loopback-bound onion service listener.</p>
      <button>Save network controls</button></form>`));
  });
  app.post('/admin/network', allowed, async (req, res) => {
    const next = {};
    try {
      dnsblLists(req.body.dnsbl_lists);
      if (req.body.dnsbl_enabled && !String(req.body.dnsbl_lists || '').trim()) throw new Error('Configure at least one DNS blocklist.');
      if (!['allow', 'captcha', 'block'].includes(req.body.tor_mode)) throw new Error('Choose a Tor posting policy.');
      if (req.body.tor_mode === 'captcha') { try { await import('sharp'); } catch { throw new Error('Install sharp before requiring Tor CAPTCHA.'); } }
      const extra = String(req.body.tor_extra_exits || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      if (extra.length > 1000 || extra.some((ip) => !net.isIP(ip))) throw new Error('Additional exits must be IP addresses, at most 1000.');
      for (const [key, maximum] of [['tor_post_cooldown_sec', 3600], ['tor_exit_cooldown_sec', 60]]) {
        const value = Number(req.body[key]);
        if (!Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`Invalid ${key}.`);
        next[key] = String(Math.floor(value));
      }
      Object.assign(next, { dnsbl_lists: String(req.body.dnsbl_lists || '').trim(), dnsbl_enabled: req.body.dnsbl_enabled ? '1' : '0', dnsbl_check_tor: req.body.dnsbl_check_tor ? '1' : '0', dnsbl_failure: req.body.dnsbl_failure === 'deny' ? 'deny' : 'allow', tor_mode: req.body.tor_mode, tor_extra_exits: extra.join('\n') });
    } catch (error) { return fail(req, res, error.message); }
    for (const [key, value] of Object.entries(next)) setSetting(db, key, value);
    audit(req, 'change_network_controls', `DNSBL: ${next.dnsbl_enabled}; Tor: ${next.tor_mode}`);
    res.redirect('/admin/network?msg=Network+controls+saved.');
  });
  app.post('/admin/network/tor-refresh', allowed, async (req, res) => {
    try { const count = await network.refreshTor(); audit(req, 'refresh_tor_exits', `${count} addresses`); res.redirect('/admin/network?msg=Tor+exit+list+updated.'); }
    catch (error) { fail(req, res, error.message, 502); }
  });
}
