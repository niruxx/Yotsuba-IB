import { t } from './i18n.js';
import { esc } from './format.js';

export function videoEmbed(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id;
  if (host === 'youtu.be') id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
  else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts|live)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
  }
  if (id && /^[\w-]{11}$/.test(id)) {
    const raw = url.searchParams.get('start') || url.searchParams.get('t') || '';
    const seconds = /^\d{1,5}s?$/.test(raw) ? Math.min(86400, parseInt(raw, 10)) : 0;
    return { provider: 'YouTube', key: `youtube:${id}`, src: `https://www.youtube-nocookie.com/embed/${id}${seconds ? '?start=' + seconds : ''}` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = /^\/(?:video\/)?(\d{1,12})(?:\/([a-f0-9]{10}))?\/?$/.exec(url.pathname);
    if (match) {
      const hash = match[2] || url.searchParams.get('h');
      return { provider: 'Vimeo', key: `vimeo:${match[1]}`, src: `https://player.vimeo.com/video/${match[1]}?dnt=1${hash && /^[a-f0-9]{10}$/.test(hash) ? '&h=' + hash : ''}` };
    }
  }
  return null;
}
export function renderVideoEmbeds(body) {
  const text = String(body).replace(/\[(code|aa|spoiler)\][\s\S]*?\[\/\1\]/gi, '');
  const seen = new Set(), videos = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'\[\]]+/gi)) {
    const video = videoEmbed(match[0].replace(/[.,!?;:)]+$/, ''));
    if (!video || seen.has(video.key)) continue;
    seen.add(video.key);
    videos.push(`<div class="video-embed"><button type="button" class="load-video" data-embed-src="${esc(video.src)}">${esc(t('Load video'))} (${video.provider})</button><small>${esc(t('External player: loading shares your IP with this provider.'))}</small></div>`);
    if (videos.length === 3) break;
  }
  return videos.join('');
}
