import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

test('guest favorites persist locally and external players load only after an allowed click', async () => {
  let click, saved = '["g","private"]', createdFrames = 0;
  const nav = { hidden: true, innerHTML: '' };
  const favorite = { dataset: { favoriteBoard: 'g' }, setAttribute(key, value) { this[key] = value; } };
  const video = { dataset: { embedSrc: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' }, hidden: false };
  let frame, close;
  const box = { append(...nodes) { [frame, close] = nodes; }, querySelector(selector) { return selector === 'iframe' ? frame : video; } }; video.parentElement = box;
  const document = {
    body: { dataset: { account: '0' } },
    querySelector: () => null,
    querySelectorAll: (selector) => selector === '[data-favorite-board]' ? [favorite] : selector === '.favorites-nav' ? [nav] : [],
    addEventListener: (_, handler) => { click = handler; },
    createElement: (tag) => {
      if (tag === 'iframe') { createdFrames++; return { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, remove() {} }; }
      return { remove() {}, closest: () => box };
    },
  };
  runInNewContext(fs.readFileSync(new URL('../public/discovery.js', import.meta.url), 'utf8'), {
    document, window: { YOTSUBA_BOARDS: [{ slug: 'g', title: '<unsafe title>' }], addEventListener() {} },
    localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
    alert: (message) => { throw new Error(message); }, URL, URLSearchParams,
    fetch: () => { throw new Error('Guest favorites must not make network requests'); },
  });
  assert.equal(createdFrames, 0); assert.match(nav.innerHTML, /&lt;unsafe title&gt;/); assert.doesNotMatch(nav.innerHTML, /private/);
  const event = (selector, target) => ({ target: { closest: (query) => query === selector ? target : null } });
  await click(event('[data-favorite-board]', favorite)); assert.deepEqual(JSON.parse(saved), []);
  await click(event('[data-favorite-board]', favorite)); assert.deepEqual(JSON.parse(saved), ['g']);
  video.dataset.embedSrc = 'https://evil.example/embed/video'; await click(event('.load-video', video)); assert.equal(createdFrames, 0);
  video.dataset.embedSrc = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
  await click(event('.load-video', video)); assert.equal(createdFrames, 1); assert.equal(video.hidden, true);
  assert.match(frame.attrs.sandbox, /allow-scripts/); assert.equal(frame.referrerPolicy, 'strict-origin-when-cross-origin'); assert.ok(!frame.src.includes('autoplay=1'));
  await click(event('.unload-video', close)); assert.equal(video.hidden, false);
});
