import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, getSettings, setSetting } from '../src/db.js';
import { createNetwork, dnsblLists, reverseIp, publicIp, torPolicy, TOR_EXIT_URL } from '../src/network.js';
import { videoEmbed, renderVideoEmbeds } from '../src/embeds.js';
import { formatBody } from '../src/format.js';
import { validatePeers } from '../src/discovery.js';

test('rich formatting nests safely and preserves code/ASCII whitespace literally', () => {
  const html = formatBody('[b]bold [i]italic[/i][/b] [u]under[/u] [s]gone[/s]\n[aa]  /\\\n ( o )  >>1 [b]literal[/b]\n[/aa]', 'g');
  assert.match(html, /<strong>bold <em>italic<\/em><\/strong>/);
  assert.match(html, /class="underline">under/); assert.match(html, /<s>gone<\/s>/);
  assert.match(html, /<pre class="ascii-art">  \/\\\n \( o \)  &gt;&gt;1 \[b\]literal\[\/b\]<\/pre>/);
  assert.doesNotMatch(formatBody('[b]<script>alert(1)</script>[/b] [i]x[/b]', 'g'), /<script>/);
  assert.doesNotMatch(formatBody('https://example.org/" onmouseover="bad', 'g'), /<a[^>]+onmouseover=/);
  assert.match(formatBody('[code][b]literal[/b][/code]', 'g'), /\[b\]literal\[\/b\]/);
  assert.ok(formatBody('[b]'.repeat(100) + 'text' + '[/b]'.repeat(100), 'g').length < 10000);
});

test('video allowlist rejects lookalikes and markup; no iframe or remote images are emitted before consent', () => {
  assert.equal(videoEmbed('https://youtu.be/dQw4w9WgXcQ?t=12').src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=12');
  assert.equal(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ').provider, 'YouTube');
  assert.equal(videoEmbed('https://vimeo.com/1234567').src, 'https://player.vimeo.com/video/1234567?dnt=1');
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ', 'https://evil@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:444/watch?v=dQw4w9WgXcQ', 'https://youtu.be/<script>']) assert.equal(videoEmbed(url), null);
  const html = renderVideoEmbeds('https://youtu.be/dQw4w9WgXcQ https://youtube.com/watch?v=dQw4w9WgXcQ [aa]https://vimeo.com/123[/aa]');
  assert.equal((html.match(/class="load-video"/g) || []).length, 1);
  assert.doesNotMatch(html, /<iframe|<img|vimeo/);
  assert.equal(renderVideoEmbeds('[spoiler]https://youtu.be/dQw4w9WgXcQ[/spoiler]'), '');
});

test('DNSBL validates zones/codes and reverses IPv4 and IPv6 without querying local addresses', () => {
  assert.equal(reverseIp('1.2.3.4'), '4.3.2.1');
  assert.equal(reverseIp('::ffff:1.2.3.4'), '4.3.2.1');
  assert.equal(reverseIp('2001:db8::1').split('.').reverse().join(''), '20010db8000000000000000000000001');
  assert.equal(reverseIp('invalid'), null);
  assert.ok(publicIp('8.8.8.8')); assert.ok(publicIp('2606:4700::1111'));
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '::1', 'fc00::1', 'fe80::1', 'invalid']) assert.ok(!publicIp(ip));
  assert.deepEqual(dnsblLists('dnsbl.example=127.0.0.2,127.0.0.3')[0].codes, ['127.0.0.2', '127.0.0.3']);
  for (const list of ['https://bad.example', 'bad..example', 'dnsbl.example=127.255.255.254', 'dnsbl.example=8.8.8.8']) assert.throws(() => dnsblLists(list));
});

test('network checks cache, ignore provider errors, bound refreshes and retain valid Tor data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yotsuba-network-')), db = openDb(directory);
  let calls = 0, response = ['127.0.0.2'], refreshed = true;
  try {
    const network = createNetwork({ db, dataDir: directory, resolve4: async (name) => { calls++; assert.match(name, /^4\.3\.2\.1\./); if (response instanceof Error) throw response; return response; },
      fetcher: async (url) => { assert.equal(url, TOR_EXIT_URL); return new Response(refreshed ? Array.from({ length: 12 }, (_, i) => `1.2.3.${i + 1}`).join('\n') : '<html>bad response</html>'); } });
    const settings = { ...getSettings(db), dnsbl_enabled: '1', dnsbl_lists: 'listed.example=127.0.0.2' };
    assert.equal((await network.check('1.2.3.4', settings)).listed, true);
    assert.equal((await network.check('1.2.3.4', settings)).listed, true); assert.equal(calls, 1);
    response = ['127.255.255.254']; settings.dnsbl_lists = 'error.example=127.0.0.2';
    assert.deepEqual(await network.check('1.2.3.4', settings), { listed: false, unavailable: true });
    response = Object.assign(new Error('no record'), { code: 'ENOTFOUND' }); settings.dnsbl_lists = 'clear.example';
    assert.deepEqual(await network.check('1.2.3.4', settings), { listed: false, unavailable: false });
    const before = calls; await network.check('127.0.0.1', settings); await network.check('1.2.3.4', settings, true); assert.equal(calls, before);
    assert.equal(await network.refreshTor(), 12); assert.equal(network.isTor('1.2.3.4'), true);
    refreshed = false; await assert.rejects(network.refreshTor(), /invalid/); assert.equal(network.isTor('1.2.3.4'), true);
    assert.equal(torPolicy({ tor_mode: 'block' }, { tor_mode: 'allow' }), 'block');
    assert.equal(torPolicy({ tor_mode: 'allow' }, { tor_mode: 'captcha' }), 'captcha');
    setSetting(db, 'tor_extra_exits', '8.8.8.8'); assert.equal(network.isTor('8.8.8.8'), true);
    const cookies = [];
    const request = { ip: '8.8.8.8', headers: {}, secure: false };
    network.middleware(request, { cookie: (key, value) => cookies.push(`${key}=${value}`) }, () => {});
    assert.ok(request.isTor); assert.match(request.torClient, /^[a-f0-9]{64}$/);
    const second = { ip: '8.8.8.8', headers: { cookie: cookies[0] }, secure: false };
    network.middleware(second, { cookie: () => { throw new Error('Valid cookie should be reused'); } }, () => {});
    assert.equal(second.torClient, request.torClient);
    const third = { ip: '8.8.8.8', headers: { cookie: cookies[0] + '.forged' }, secure: false };
    network.middleware(third, { cookie: () => {} }, () => {}); assert.notEqual(third.torClient, request.torClient);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('webring accepts approved HTTP(S) metadata and rejects script destinations and duplicate peers', () => {
  assert.equal(validatePeers([{ name: 'Community', url: 'https://example.org/' }])[0].endpoint, 'https://example.org/webring.json');
  assert.throws(() => validatePeers([{ name: 'bad', url: 'javascript:alert(1)' }]));
  assert.throws(() => validatePeers([{ name: 'bad', url: 'https://user:pass@example.org/' }]));
  assert.throws(() => validatePeers([{ name: 'one', url: 'https://example.org' }, { name: 'two', url: 'https://example.org/' }]));
});
