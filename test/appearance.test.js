import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, DEFAULT_APPEARANCE, validateAppearance, appearanceCss, themeCss } from '../src/appearance.js';
import { layout } from '../src/views.js';

test('appearance validation rejects unsafe CSS, unsupported themes and unusable dimensions', () => {
  assert.equal(Object.keys(THEMES).length, 7);
  for (const theme of Object.values(THEMES)) {
    assert.equal(Object.keys(theme.colors).length, 16);
    assert.ok(Object.values(theme.colors).every((color) => /^#[0-9a-f]{6}$/.test(color)));
  }
  for (const value of [
    { default_theme: '__proto__' }, { default_theme: ['midnight'] }, { default_theme: '" onload="alert(1)' },
    { colors: { bg: '#fff; color:red' } }, { colors: { bg: '</style><script>alert(1)</script>' } },
    { page_width: -1 }, { post_padding: 10000 }, { font_size: 'NaN' }, { line_height: 0 }, { font_family: 'url(https://example.test)' },
  ]) assert.throws(() => validateAppearance(value));
  const normalized = validateAppearance({ default_theme: 'ocean', custom_colors: 'on', colors: { bg: '#ABCDEF' }, radius: '8', font_family: 'serif' });
  assert.equal(normalized.colors.bg, '#abcdef');
  assert.equal(normalized.radius, 8);
  assert.match(appearanceCss(normalized), /:root\[data-theme-preference="site"\]\{--bg:#abcdef;/);
  assert.doesNotMatch(appearanceCss(DEFAULT_APPEARANCE), /data-theme-preference/);
  assert.match(themeCss(), /data-theme="forest"/);
});

test('new visitors receive the configured theme before scripts; explicit preferences are allowlisted', () => {
  const appearance = validateAppearance({ default_theme: 'midnight', page_padding: 20, custom_colors: true, colors: { bg: '#102030' } });
  const html = layout({ title: 'Test', siteName: 'Test', body: '<p>Hello</p>', appearance });
  assert.match(html, /data-theme="midnight" data-site-theme="midnight" data-theme-preference="site"/);
  assert.match(html, /--site-page-padding:20px/);
  assert.match(html, /value="site" selected/);
  for (const theme of ['midnight', 'sakura', 'forest', 'ocean']) assert.match(html, new RegExp(`value="${theme}"`));
  assert.ok(html.indexOf('window.YOTSUBA_APPEARANCE') < html.indexOf('/static/style.css'));
});

test('theme boot honors site changes, explicit visitor choices and malformed preferences', async () => {
  const { runInNewContext } = await import('node:vm');
  const html = layout({ title: 'Test', siteName: 'Test', body: '', appearance: validateAppearance({ default_theme: 'sakura' }) });
  const boot = /<script>(window\.YOTSUBA_APPEARANCE[\s\S]*?)<\/script>/.exec(html)[1];
  for (const [stored, expectedTheme, expectedPreference] of [
    [null, 'sakura', 'site'], [JSON.stringify({ theme: 'site' }), 'sakura', 'site'],
    [JSON.stringify({ theme: 'midnight' }), 'midnight', 'midnight'], [JSON.stringify({ theme: 'tomorrow' }), 'tomorrow', 'tomorrow'],
    [JSON.stringify({ theme: 'unknown' }), 'sakura', 'site'], ['bad json', 'sakura', 'site'], ['null', 'sakura', 'site'],
  ]) {
    const dataset = { theme: 'sakura', themePreference: 'site' };
    runInNewContext(boot, { window: {}, document: { documentElement: { dataset } }, localStorage: { getItem: () => stored } });
    assert.equal(dataset.theme, expectedTheme);
    assert.equal(dataset.themePreference, expectedPreference);
  }
});
