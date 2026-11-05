import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const THUMB = 250;

let sharpLib;
async function getSharp() {
  if (sharpLib === undefined) {
    try { sharpLib = (await import('sharp')).default; } catch { sharpLib = null; }
  }
  return sharpLib;
}

let ffmpegOk;
async function hasFfmpeg() {
  if (ffmpegOk === undefined) {
    try { await run('ffmpeg', ['-version']); await run('ffprobe', ['-version']); ffmpegOk = true; } catch { ffmpegOk = false; }
  }
  return ffmpegOk;
}

export async function mediaCapabilities() {
  return { sharp: !!(await getSharp()), ffmpeg: await hasFfmpeg() };
}

export const thumbPath = (fileAbs) => `${fileAbs}.thumb.jpg`;

/**
 * Moves an upload from tmpPath to destAbs, stripping metadata (EXIF/GPS, video tags) where possible,
 * and writes a JPEG thumbnail next to it. Never throws for processing problems: worst case the
 * original file is stored as-is without a thumbnail.
 * Returns { width, height, thumb }.
 */
export async function storeMedia(tmpPath, destAbs, mime) {
  const out = { width: null, height: null, thumb: false };
  const sharp = await getSharp();

  if (mime.startsWith('image/')) {
    if (sharp) {
      try {
        const meta = await sharp(tmpPath, { animated: true, limitInputPixels: 100e6 }).metadata();
        out.width = meta.width ?? null;
        out.height = meta.pageHeight ?? meta.height ?? null;
        if (mime === 'image/gif') {
          fs.renameSync(tmpPath, destAbs); // GIFs carry no EXIF; re-encoding animations would bloat them
        } else {
          // rotate() applies the EXIF orientation; sharp drops all metadata on output by default.
          const img = sharp(tmpPath, { limitInputPixels: 100e6 }).rotate();
          if (mime === 'image/jpeg') await img.jpeg({ quality: 92, mozjpeg: true }).toFile(destAbs);
          else if (mime === 'image/png') await img.png({ compressionLevel: 9 }).toFile(destAbs);
          else await img.webp({ quality: 92 }).toFile(destAbs);
          fs.rmSync(tmpPath, { force: true });
          if ([5, 6, 7, 8].includes(meta.orientation)) [out.width, out.height] = [out.height, out.width];
        }
        await sharp(destAbs, { limitInputPixels: 100e6 }).rotate()
          .resize(THUMB, THUMB, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toFile(thumbPath(destAbs));
        out.thumb = true;
        return out;
      } catch (err) {
        console.error(`Image processing failed (${err.message}); storing original.`);
      }
    }
    if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, destAbs);
    return out;
  }

  // Video
  if (await hasFfmpeg()) {
    try {
      await run('ffmpeg', ['-v', 'error', '-y', '-i', tmpPath, '-map', '0', '-map_metadata', '-1', '-c', 'copy',
        '-f', mime === 'video/webm' ? 'webm' : 'mp4', destAbs], { timeout: 120_000 });
      fs.rmSync(tmpPath, { force: true });
    } catch {
      if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, destAbs);
    }
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0:s=x', destAbs], { timeout: 30_000 });
      const [w, h] = stdout.trim().split('x').map(Number);
      if (w && h) { out.width = w; out.height = h; }
      await run('ffmpeg', ['-v', 'error', '-y', '-i', destAbs, '-frames:v', '1',
        '-vf', `scale='min(${THUMB},iw)':'min(${THUMB},ih)':force_original_aspect_ratio=decrease`, '-q:v', '4', thumbPath(destAbs)],
      { timeout: 60_000 });
      out.thumb = fs.existsSync(thumbPath(destAbs));
    } catch { /* no thumbnail */ }
    return out;
  }
  fs.renameSync(tmpPath, destAbs);
  return out;
}
