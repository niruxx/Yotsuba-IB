import crypto from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  return (bits.match(/.{1,5}/g) || []).map((part) => alphabet[parseInt(part.padEnd(5, '0'), 2)]).join('');
}
function decode32(secret) {
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) || []).map((part) => parseInt(part, 2)));
}
export const newTotpSecret = () => base32(crypto.randomBytes(20));
export function totp(secret, time = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const hash = crypto.createHmac('sha1', decode32(secret)).update(counter).digest();
  const offset = hash.at(-1) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
export function verifyTotp(secret, code, lastStep = -1, time = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const step = Math.floor(time / 30_000);
  for (const delta of [0, -1, 1]) {
    const candidate = step + delta;
    if (candidate > lastStep && candidate >= 0 && crypto.timingSafeEqual(Buffer.from(totp(secret, candidate * 30_000)), Buffer.from(String(code)))) return candidate;
  }
  return null;
}
export const recoveryHash = (code) => crypto.createHash('sha256').update(String(code).trim().toLowerCase().replace(/\s/g, '')).digest('hex');
export const recoveryCodes = () => Array.from({ length: 8 }, () => crypto.randomBytes(10).toString('hex'));
export function consumeSecondFactor(db, account, code) {
  if (!account.totp_secret) return true;
  const step = verifyTotp(account.totp_secret, code, account.totp_last_step);
  if (step !== null) {
    return db.prepare('UPDATE admins SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?').run(step, account.id, step).changes === 1;
  }
  const hashes = JSON.parse(account.totp_recovery || '[]');
  const hash = recoveryHash(code);
  if (!hashes.includes(hash)) return false;
  return db.prepare('UPDATE admins SET totp_recovery = ? WHERE id = ? AND totp_recovery = ?')
    .run(JSON.stringify(hashes.filter((value) => value !== hash)), account.id, account.totp_recovery).changes === 1;
}

// Bounded, expiring, single-use challenges. Solutions are never sent as text/SVG to browsers.
export class CaptchaStore {
  constructor() { this.entries = new Map(); this.requests = new Map(); }
  issue(ip, now = Date.now()) {
    for (const [key, value] of this.entries) if (value.expires < now) this.entries.delete(key);
    for (const [key, value] of this.requests) if (value.start < now - 60_000) this.requests.delete(key);
    const bucket = this.requests.get(ip) || { start: now, count: 0 };
    if (++bucket.count > 30 || this.entries.size >= 5000) return null;
    this.requests.set(ip, bucket);
    const token = crypto.randomBytes(24).toString('hex');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const answer = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join('');
    this.entries.set(token, { answer, ip, expires: now + 5 * 60_000 });
    return token;
  }
  verify(token, answer, ip, now = Date.now()) {
    const entry = this.entries.get(String(token));
    this.entries.delete(String(token));
    if (!entry || entry.ip !== ip || entry.expires < now) return false;
    const value = String(answer || '').trim().toUpperCase();
    return value.length === entry.answer.length && Buffer.byteLength(value) === entry.answer.length
      && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(entry.answer));
  }
  async image(token, ip) {
    const entry = this.entries.get(token);
    if (!entry || entry.ip !== ip || entry.expires < Date.now()) return null;
    if (entry.image) return entry.image;
    const { default: sharp } = await import('sharp');
    const chars = [...entry.answer].map((char, i) => `<text x="${18 + i * 29}" y="${36 + crypto.randomInt(10)}" transform="rotate(${crypto.randomInt(-15, 16)} ${18 + i * 29} 35)" font-family="sans-serif" font-size="30" font-weight="bold" fill="#243653">${char}</text>`).join('');
    const lines = Array.from({ length: 7 }, () => `<path d="M0 ${crypto.randomInt(60)} Q100 ${crypto.randomInt(60)} 210 ${crypto.randomInt(60)}" stroke="#7788aa" fill="none" opacity=".6"/>`).join('');
    entry.image = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="210" height="64"><rect width="210" height="64" fill="#eef2ff"/>${chars}${lines}</svg>`)).png().toBuffer();
    return entry.image;
  }
}
