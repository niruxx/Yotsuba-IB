import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32, totp, verifyTotp, recoveryCodes, recoveryHash, CaptchaStore } from '../src/security.js';
import { CATALOGS, LANGUAGES, t, withLanguage } from '../src/i18n.js';

test('TOTP matches RFC 6238 SHA-1 vectors and rejects replays', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']]) {
    assert.equal(totp(secret, seconds * 1000, 8), expected);
  }
  const now = 1234567890 * 1000;
  const code = totp(secret, now);
  const step = verifyTotp(secret, code, -1, now);
  assert.equal(step, Math.floor(now / 30000));
  assert.equal(verifyTotp(secret, code, step, now), null);
  assert.equal(verifyTotp(secret, 'invalid', -1, now), null);
  assert.equal(verifyTotp(secret, code, -1, now + 90000), null);
  const codes = recoveryCodes();
  assert.equal(new Set(codes).size, 8);
  assert.equal(recoveryHash(codes[0].toUpperCase()), recoveryHash(codes[0]));
});

test('CAPTCHA binds solutions to clients, expires, is single-use and limits issuance', () => {
  const store = new CaptchaStore();
  const now = Date.now();
  const token = store.issue('client', now);
  const answer = store.entries.get(token).answer;
  assert.equal(store.verify(token, answer.toLowerCase(), 'client', now), true);
  assert.equal(store.verify(token, answer, 'client', now), false);
  const other = store.issue('client', now);
  assert.equal(store.verify(other, store.entries.get(other).answer, 'other', now), false);
  const expired = store.issue('client', now);
  assert.equal(store.verify(expired, store.entries.get(expired).answer, 'client', now + 301000), false);
  const invalid = store.issue('client', now);
  assert.equal(store.verify(invalid, '\u00e9'.repeat(6), 'client', now), false);
  for (let i = 0; i < 30; i++) store.issue('flood', now);
  assert.equal(store.issue('flood', now), null);
  assert.ok(store.issue('flood', now + 61000));
});

test('all eight languages use consistent catalogs and preserve unknown text', () => {
  const keys = Object.keys(CATALOGS.es);
  assert.equal(Object.keys(LANGUAGES).length, 8);
  for (const [language, dictionary] of Object.entries(CATALOGS)) {
    assert.deepEqual(Object.keys(dictionary), keys);
    assert.ok(Object.values(dictionary).every(Boolean));
    withLanguage(language, () => {
      assert.equal(t('Theme'), dictionary.Theme);
      assert.equal(t('User-authored text stays unchanged'), 'User-authored text stays unchanged');
    });
  }
  assert.equal(t('Theme'), 'Theme');
});
