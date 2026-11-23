import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, formatBody, quotedIds, flagEmoji, mediaUrl } from '../src/format.js';
import { hamming, countLinks, normalizeText, hashDeletePw, checkDeletePw, RateMemory } from '../src/antispam.js';

test('esc escapes HTML', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('formatBody: greentext, quote links, cross-board links', () => {
  const html = formatBody('>be me\n>>12 hi\n>>>/g/34', 'b');
  assert.match(html, /<span class="greentext">&gt;be me<\/span>/);
  assert.match(html, /href="\/b\/post\/12"/);
  assert.match(html, /href="\/g\/post\/34"/);
});

test('formatBody: never lets HTML through', () => {
  const html = formatBody('<script>alert(1)</script> [code]<b>x</b>[/code]', 'b');
  assert.doesNotMatch(html, /<script>|<b>/);
});

test('formatBody: code blocks and spoilers', () => {
  const html = formatBody('a [spoiler]secret[/spoiler]\n[code]\nconst x = 1;\n[/code]', 'b');
  assert.match(html, /<span class="spoiler">secret<\/span>/);
  assert.match(html, /<pre class="code">const x = 1;<\/pre>/);
});

test('formatBody: only http(s) URLs are linked', () => {
  assert.match(formatBody('see https://example.com/x', 'b'), /<a href="https:\/\/example.com\/x"/);
  assert.doesNotMatch(formatBody('javascript:alert(1)', 'b'), /<a /);
});

test('quotedIds finds same-board quotes only', () => {
  assert.deepEqual([...quotedIds('>>1 >>2\n>>>/g/3')].sort(), [1, 2]);
});

test('flagEmoji', () => {
  assert.equal(flagEmoji('DE'), '🇩🇪');
  assert.equal(flagEmoji('nope'), '');
});

test('mediaUrl', () => assert.equal(mediaUrl(5, 'video/webm'), '/media/5.webm'));

test('hamming distance', () => {
  assert.equal(hamming('0000000000000000', '0000000000000000'), 0);
  assert.equal(hamming('0000000000000000', '000000000000000f'), 4);
  assert.equal(hamming('ffffffffffffffff', '0000000000000000'), 64);
});

test('spam helpers', () => {
  assert.equal(countLinks('http://a https://b www.c'), 3);
  assert.equal(normalizeText('  Hello,   WORLD!! '), 'hello world');
});

test('deletion passwords', () => {
  const h = hashDeletePw('hunter22');
  assert.ok(checkDeletePw('hunter22', h));
  assert.ok(!checkDeletePw('wrong', h));
  assert.ok(!checkDeletePw('x', null));
});

test('RateMemory', () => {
  const r = new RateMemory();
  r.hit('k', 1000); r.hit('k', 2000);
  assert.equal(r.last('k'), 2000);
  assert.equal(r.countSince('k', 1500), 1);
});
