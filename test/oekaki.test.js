import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

test('oekaki scales pointer coordinates, supports undo and exports PNGs without losing selected files', async () => {
  const handlers = new Map(), strokes = [], restored = [];
  const context = { save() {}, restore() {}, fillRect() {}, beginPath() {}, closePath() {}, moveTo(x, y) { strokes.push(['move', x, y]); }, lineTo(x, y) { strokes.push(['line', x, y]); }, stroke() {}, getImageData() { return { snapshot: strokes.length }; }, putImageData(value) { restored.push(value); } };
  const elements = {
    '.oekaki-color': { value: '#123456' }, '.oekaki-size': { value: '6' }, '.oekaki-tool': { value: 'brush' },
    '.oekaki-status': { textContent: '' }, '[data-draw="undo"]': {}, '[data-draw="redo"]': {},
  };
  const canvas = {
    width: 640, height: 480, getContext: () => context, focus() {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 240 }),
    addEventListener: (name, handler) => handlers.set(name, handler),
    toBlob: (callback, type) => { assert.equal(type, 'image/png'); callback(new Blob(['png export'], { type })); },
  };
  elements.canvas = canvas;
  let workbenchClick, documentClick;
  const workbench = { hidden: true, querySelector: (selector) => elements[selector], addEventListener: (_, handler) => { workbenchClick = handler; } };
  const existing = new File(['existing'], 'existing.png', { type: 'image/png' });
  const input = { files: [existing], dispatchEvent() {} };
  const form = { dataset: { maxFiles: '2' }, querySelector: (selector) => selector === '.oekaki-workbench' ? workbench : selector === '.oekaki-open' ? button : input };
  const button = { closest: () => form, focus() {} };
  class Transfer {
    constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; }
  }
  const document = { addEventListener: (_, handler) => { documentClick = handler; }, createElement() { throw new Error('Should not download while attaching'); } };
  runInNewContext(fs.readFileSync(new URL('../public/oekaki.js', import.meta.url), 'utf8'), { document, DataTransfer: Transfer, File, Blob, Event, URL, setTimeout });
  documentClick({ target: { closest: () => button } });
  assert.equal(workbench.hidden, false);
  const action = async (name) => { await workbenchClick({ target: { closest: () => ({ dataset: { draw: name }, disabled: false }) } }); };
  await action('attach'); assert.match(elements['.oekaki-status'].textContent, /Draw something/);
  handlers.get('pointerdown')({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 20, clientY: 30, preventDefault() {} });
  handlers.get('pointermove')({ pointerId: 1, clientX: 40, clientY: 50, preventDefault() {} });
  handlers.get('pointerup')({ pointerId: 1 });
  assert.deepEqual(strokes[0], ['move', 40, 60]); assert.deepEqual(strokes.at(-1), ['line', 80, 100]);
  await action('undo'); assert.equal(restored.length, 1);
  await action('redo'); assert.equal(restored.length, 2);
  await action('attach');
  assert.equal(input.files.length, 2); assert.equal(input.files[0], existing);
  assert.match(input.files[1].name, /^drawing-\d+\.png$/); assert.equal(input.files[1].type, 'image/png');
  assert.equal(await input.files[1].text(), 'png export');
  await action('attach'); assert.equal(input.files.length, 2); assert.match(elements['.oekaki-status'].textContent, /already has 2 files/);
  await action('close'); assert.equal(workbench.hidden, true);
});
