import crypto from 'node:crypto';

// ---------------- perceptual hashing (dHash) ----------------
// Resizes the image to 9x8 grayscale and records whether each pixel is brighter than its right-hand
// neighbour: 64 bits that survive resizing, re-encoding and small edits. Needs the optional `sharp` package.
let sharpLib;
async function getSharp() {
  if (sharpLib === undefined) {
    try { sharpLib = (await import('sharp')).default; } catch {
      sharpLib = null;
      console.error('sharp is not available; perceptual image bans are disabled (exact SHA-256 bans still work).');
    }
  }
  return sharpLib;
}

export async function perceptualHash(filePath, mime) {
  if (!mime?.startsWith('image/')) return null; // videos: exact-hash bans only
  const sharp = await getSharp();
  if (!sharp) return null;
  try {
    const px = await sharp(filePath, { animated: false, limitInputPixels: 100e6 })
      .grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let bits = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    }
    return bits.toString(16).padStart(16, '0');
  } catch {
    return null; // undecodable image: fall back to exact-hash checks
  }
}

export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

// ---------------- text heuristics ----------------
export const countLinks = (text) => (text.match(/https?:\/\/|www\./gi) || []).length;

export const normalizeText = (text) => text.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();

export const textHash = (text) => crypto.createHash('sha256').update(normalizeText(text)).digest('hex');

// ---------------- rate limiting ----------------
// Remembers recent timestamps per key; used for per-IP cooldowns and per-board flood counts.
export class RateMemory {
  constructor() { this.map = new Map(); }
  last(key) { const a = this.map.get(key); return a ? a[a.length - 1] : 0; }
  countSince(key, since) { return (this.map.get(key) || []).filter((t) => t > since).length; }
  hit(key, now = Date.now()) {
    const a = (this.map.get(key) || []).filter((t) => t > now - 3600e3);
    a.push(now);
    this.map.set(key, a.slice(-200));
  }
  sweep(now = Date.now()) {
    for (const [k, a] of this.map) if (!a.length || a[a.length - 1] < now - 3600e3) this.map.delete(k);
  }
}

// ---------------- deletion passwords ----------------
export const hashDeletePw = (pw) => {
  const salt = crypto.randomBytes(8).toString('hex');
  return `${salt}:${crypto.createHash('sha256').update(salt + pw).digest('hex')}`;
};
export const checkDeletePw = (pw, stored) => {
  if (!stored || !pw) return false;
  const [salt, hash] = stored.split(':');
  const actual = crypto.createHash('sha256').update(salt + pw).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(hash));
};
