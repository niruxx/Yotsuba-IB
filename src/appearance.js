import { esc } from './format.js';
import { can, setSetting } from './db.js';
import { page } from './adminViews.js';

export const COLOR_LABELS = {
  bg: 'Page background', fg: 'Text', panel: 'Panels and replies', border: 'Borders',
  link: 'Links', 'link-hover': 'Link hover', title: 'Headings', subject: 'Post subjects',
  name: 'Poster names', th: 'Form headings', muted: 'Secondary text', quote: 'Greentext',
  qlink: 'Quote links', highlight: 'Highlighted posts', 'input-bg': 'Input background', 'input-fg': 'Input text',
};
const colorKeys = Object.keys(COLOR_LABELS);
const palette = (values) => Object.fromEntries(colorKeys.map((key, i) => [key, values.split(' ')[i]]));
export const THEMES = {
  'yotsuba-b': { name: 'Yotsuba B', description: 'Classic lavender and blue.', colors: palette('#eef2ff #000000 #d6daf0 #b7c5d9 #34345c #dd0000 #af0a0f #0f0c5d #117743 #9988ee #707070 #789922 #dd0000 #d6bad0 #ffffff #000000') },
  yotsuba: { name: 'Yotsuba', description: 'Warm cream with traditional red accents.', colors: palette('#ffffee #800000 #f0e0d6 #d9bfb7 #0000ee #dd0000 #800000 #cc1105 #117743 #eeaa88 #707070 #789922 #000080 #f0c0b0 #ffffff #000000') },
  tomorrow: { name: 'Tomorrow (dark)', description: 'Familiar charcoal with soft violet.', colors: palette('#1d1f21 #c5c8c6 #282a2e #3a3d41 #81a2be #cc6666 #c5c8c6 #b294bb #c5c8c6 #3a3d41 #969896 #b5bd68 #5f89ac #3f4247 #282a2e #c5c8c6') },
  midnight: { name: 'Midnight', description: 'Deep navy, ice blue and warm gold.', colors: palette('#101827 #e2e8f0 #1b2940 #344760 #8ac7ff #ffd280 #f3cc80 #c4b5fd #82d9bf #263c59 #a2b1c7 #b4d880 #ffb4a2 #334b6b #111e31 #e2e8f0') },
  sakura: { name: 'Sakura', description: 'Soft rose, plum and pale cherry blossom.', colors: palette('#fff5f7 #4e3041 #f8e4ed #d9b4c7 #743d79 #a92860 #8b2856 #744189 #327361 #edcedf #826276 #537c39 #a73365 #eed1e6 #fffbfc #4e3041') },
  forest: { name: 'Forest', description: 'Dark evergreen with mint and fern accents.', colors: palette('#12231e #e1eee5 #1d352b #3d5e4c #9edbb9 #f1cd8e #c5e6a2 #c7c1f0 #9edbb9 #2d4939 #a3bba9 #b7d785 #f3bc9d #36583f #162b23 #e1eee5') },
  ocean: { name: 'Ocean', description: 'Airy sea glass with deep teal details.', colors: palette('#edf8fa #173f4c #d9edf1 #a2c7d1 #145b85 #b03c52 #155c68 #4c4c8a #226650 #c1dfe7 #4e727e #466d2f #a33550 #bfdde8 #faffff #173f4c') },
};
export const FONT_FAMILIES = { sans: 'Arial, Helvetica, sans-serif', serif: 'Georgia, serif', mono: 'Consolas, monospace' };
export const DIMENSIONS = {
  page_width: ['Board page maximum width', 1200, 640, 2400, 'px'],
  content_width: ['Homepage and panel maximum width', 880, 480, 1600, 'px'],
  page_padding: ['Page side padding', 10, 0, 40, 'px'],
  panel_padding: ['Panel padding', 12, 4, 40, 'px'],
  post_padding: ['Reply padding', 8, 4, 24, 'px'],
  post_gap: ['Space between replies', 4, 2, 24, 'px'],
  radius: ['Panel and reply corner rounding', 0, 0, 20, 'px'],
  font_size: ['Base text size', 13, 11, 20, 'px'],
  line_height: ['Text line height', 1.4, 1.2, 2, ''],
  catalog_size: ['Catalog tile minimum width', 165, 110, 260, 'px'],
};
export const DEFAULT_APPEARANCE = { default_theme: 'yotsuba-b', custom_colors: false, colors: { ...THEMES['yotsuba-b'].colors },
  font_family: 'sans', ...Object.fromEntries(Object.entries(DIMENSIONS).map(([key, [, value]]) => [key, value])) };

export function validateAppearance(value) {
  const result = { ...DEFAULT_APPEARANCE, colors: { ...DEFAULT_APPEARANCE.colors } };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid appearance settings.');
  if (value.default_theme !== undefined) {
    if (typeof value.default_theme !== 'string' || !Object.hasOwn(THEMES, value.default_theme)) throw new Error('Choose a supported default theme.');
    result.default_theme = value.default_theme;
  }
  result.custom_colors = value.custom_colors === true || value.custom_colors === 'on';
  for (const key of colorKeys) {
    const color = value.colors?.[key];
    if (color === undefined) continue;
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid color: ${COLOR_LABELS[key]}.`);
    result.colors[key] = color.toLowerCase();
  }
  for (const [key, [label, , min, max]] of Object.entries(DIMENSIONS)) {
    if (value[key] === undefined) continue;
    const number = Number(value[key]);
    if (String(value[key]).trim() === '' || !Number.isFinite(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    result[key] = key === 'line_height' ? Math.round(number * 100) / 100 : Math.round(number);
  }
  if (value.font_family !== undefined) {
    if (typeof value.font_family !== 'string' || !Object.hasOwn(FONT_FAMILIES, value.font_family)) throw new Error('Choose a supported font.');
    result.font_family = value.font_family;
  }
  return result;
}
export function getAppearance(db) {
  try {
    const saved = db.prepare("SELECT value FROM settings WHERE key = 'appearance'").get()?.value;
    return validateAppearance(saved ? JSON.parse(saved) : {});
  } catch { return validateAppearance({}); }
}
export const themeCss = () => Object.entries(THEMES).map(([key, theme]) => `[data-theme="${key}"]{${Object.entries(theme.colors).map(([name, value]) => `--${name}:${value};`).join('')}}`).join('\n');
export function appearanceCss(settings) {
  const value = validateAppearance(settings);
  const spacing = Object.entries(DIMENSIONS).map(([key, [, , , , unit]]) => `--site-${key.replaceAll('_', '-')}:${value[key]}${unit};`).join('');
  const colors = value.custom_colors ? `:root[data-theme-preference="site"]{${colorKeys.map((key) => `--${key}:${value.colors[key]};`).join('')}}` : '';
  return `:root{${spacing}--site-font-family:${FONT_FAMILIES[value.font_family]};}\n${colors}`;
}

export function appearancePage(admin, settings, message) {
  return page(admin, 'Appearance', message, `<form class="appearance-editor" method="post" action="/admin/appearance">
  <section class="box"><h2>Default theme</h2><p>New visitors follow this site default. Visitors who choose another theme keep their choice. Select “Site default” in the bottom bar to follow future changes.</p>
  <div class="theme-grid">${Object.entries(THEMES).map(([key, theme]) => `<label class="theme-card" style="--swatch-bg:${theme.colors.bg};--swatch-panel:${theme.colors.panel};--swatch-link:${theme.colors.link};--swatch-fg:${theme.colors.fg}">
    <input type="radio" name="default_theme" value="${key}"${settings.default_theme === key ? ' checked' : ''}><span class="theme-swatch" aria-hidden="true"><i></i><b>Aa</b></span><strong>${esc(theme.name)}</strong><small>${esc(theme.description)}</small></label>`).join('')}</div></section>
  <div class="appearance-columns"><div>
  <section class="box"><h2>Layout and typography</h2>
  ${Object.entries(DIMENSIONS).map(([key, [label, , min, max, unit]]) => `<label>${label} (${unit || 'ratio'}) <input type="number" name="${key}" value="${settings[key]}" min="${min}" max="${max}" step="${key === 'line_height' ? '0.05' : '1'}" required></label>`).join('')}
  <label>Font family <select name="font_family">${Object.keys(FONT_FAMILIES).map((key) => `<option value="${key}"${settings.font_family === key ? ' selected' : ''}>${key}</option>`).join('')}</select></label>
  <p>These layout settings apply site-wide. Narrow screens adapt automatically.</p></section>
  <section class="box"><h2>Custom site colors</h2>
  <label class="check"><input type="checkbox" name="custom_colors"${settings.custom_colors ? ' checked' : ''}> Override the default theme’s colors</label>
  <p>Applies to visitors using Site default. Other theme choices keep their own colors.</p>
  <button type="button" id="appearance-reset-colors">Use selected theme colors</button>
  <div class="appearance-colors">${colorKeys.map((key) => `<label>${COLOR_LABELS[key]} <input type="color" name="color_${key}" value="${settings.custom_colors ? settings.colors[key] : THEMES[settings.default_theme].colors[key]}"></label>`).join('')}</div>
  </section></div>
  <aside class="appearance-preview-wrap"><h2>Live preview</h2><p>Preview changes here before saving. The public site changes only when you save.</p>
  <section class="appearance-preview" data-theme="${settings.default_theme}">
    <nav>[ /g/ /v/ /a/ ] <a href="#appearance-preview-content">Boards</a></nav>
    <div id="appearance-preview-content"><h2>Your community</h2><p>A place for conversation, ideas and images.</p>
    <article><strong class="subject">A new discussion</strong><p><span class="name">Anonymous</span> <span class="preview-muted">No.123</span></p><p>Hello, welcome to the board.</p><p class="greentext">&gt;Make yourself at home</p><a href="#appearance-preview-content">&gt;&gt;124</a></article>
    <article><strong class="subject">Reply</strong><p>Try different spacing and colors.</p><input value="Write a reply…" aria-label="Preview reply" readonly></article></div>
  </section><p id="appearance-preview-size" aria-live="polite"></p></aside></div>
  <div class="appearance-save"><button>Save appearance</button> <button name="action" value="reset" formnovalidate>Restore appearance defaults</button></div>
  </form>`);
}
export function registerAppearance(app, { db, render, fail, audit }) {
  const allowed = (req, res, next) => {
    if (!req.admin) return res.redirect('/admin/login');
    if (!can(req.admin, 'manage_settings') || (req.admin.role !== 'owner' && req.admin.boardList?.length)) return fail(req, res, 'Only staff with unrestricted site settings permission can edit appearance.', 403);
    next();
  };
  app.get('/admin/appearance', allowed, (req, res) => render(req, res, 'Appearance', appearancePage(req.admin, getAppearance(db), req.query.msg)));
  app.post('/admin/appearance', allowed, (req, res) => {
    let settings;
    try {
      settings = req.body.action === 'reset' ? validateAppearance({}) : validateAppearance({ ...req.body,
        colors: Object.fromEntries(colorKeys.map((key) => [key, req.body[`color_${key}`]])) });
    } catch (error) { return fail(req, res, error.message); }
    setSetting(db, 'appearance', JSON.stringify(settings));
    audit(req, 'change_appearance', req.body.action === 'reset' ? 'Restored appearance defaults' : `Default theme: ${settings.default_theme}; custom colors: ${settings.custom_colors}`);
    res.redirect('/admin/appearance?msg=Appearance+saved.');
  });
}
