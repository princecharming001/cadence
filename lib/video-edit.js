// lib/video-edit.js — the "edit of you" montage builder (the always-works path
// for generated video: zero AI spend, deterministic ffmpeg). Takes the user's
// own Library media + any pasted external media and stitches a vertical (or
// square/wide) montage: each input is normalized + reframed to one canvas with
// a blurred-pad background, trimmed, then concatenated. A silent stereo track is
// added at the end so every platform accepts the upload.
//
// Self-contained (a small run()/download here) so it never couples to clips.js
// internals. Captions + music are intentionally left for a follow-up — a clean
// reframed cut is the solid v1.
import { spawn } from 'child_process'
import { mkdtemp, rm, readFile, writeFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// Social page hosts (TikTok/IG/YouTube/etc.) are downloaded via yt-dlp, not fetch
// — pasting one of these as edit footage pulls the actual clip. NOTE: yt-dlp is a
// binary, so this works on a real host (or locally) but NOT Vercel serverless.
const PAGE_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|twitch\.tv|loom\.com|x\.com|twitter\.com|facebook\.com|dailymotion\.com|reddit\.com)/i

const CANVAS = { vertical: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] }
const PER_CLIP_MAX = 6      // seconds kept from each source video
const PHOTO_DUR = 2.6       // seconds a still photo is held
const MAX_INPUTS = 12
const MAX_BYTES = 200 * 1024 * 1024
const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|avif)(\?|$)/i

function run(cmd, args, { timeoutMs = 8 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args)
    let err = ''
    const t = setTimeout(() => { ps.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)) }, timeoutMs)
    ps.stderr.on('data', d => { err += d.toString() })
    ps.on('error', e => { clearTimeout(t); reject(e) })
    ps.on('close', code => { clearTimeout(t); code === 0 ? resolve({ err }) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`)) })
  })
}

// SSRF guard — block requests to private/internal hosts (incl. cloud metadata).
function privateHost(hostname) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?|metadata)/i.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
}
function safeUrl(url) {
  let u; try { u = new URL(String(url)) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  if (privateHost(u.hostname)) return null
  return u
}

// Pull a video from a social page (TikTok/IG/YouTube/X/…) with yt-dlp.
async function ytDlp(url, dest) {
  const cookies = (process.env.YTDLP_COOKIES && existsSync(process.env.YTDLP_COOKIES)) ? ['--cookies', process.env.YTDLP_COOKIES] : []
  await run('yt-dlp', [...cookies,
    '-f', 'bv*[height<=1280][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b', '--merge-output-format', 'mp4',
    '--max-filesize', '200M', '--no-playlist', '--force-overwrites', '-o', dest, url,
  ], { timeoutMs: 5 * 60 * 1000 })
  return { path: dest, isImage: false }
}

// Returns { path, isImage } for the downloaded file. SSRF-guarded; classifies by
// content-type (not a fragile extension guess) so extensionless images render.
async function download(url, dest) {
  if (PAGE_HOSTS.test(url)) {
    const mp4 = dest.endsWith('.mp4') ? dest : `${dest}.mp4`
    return await ytDlp(url, mp4)
  }
  if (!safeUrl(url)) throw new Error('blocked or invalid url')
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  if (res.url && !safeUrl(res.url)) throw new Error('blocked redirect')
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (/text\/html|application\/xhtml/.test(ct)) throw new Error('url is a web page, not a media file')
  const isImage = ct.startsWith('image/') || (!ct.startsWith('video/') && IMG_EXT.test(url))
  const len = Number(res.headers.get('content-length') || 0)
  if (len && len > MAX_BYTES) throw new Error('file too large')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error('file too large')
  await writeFile(dest, buf)
  return { path: dest, isImage }
}

// Reframe filter to fill the canvas: sharp foreground (fit-inside) over a
// blurred, zoomed copy of itself so nothing is cropped and there are no bars.
// Final setsar=1 so concat -c copy can't stamp one segment's SAR on the montage.
function reframe(W, H) {
  return `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:6[bg];` +
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p,fps=30`
}

// Normalize one input to a fixed-params, video-only mp4 segment. `dur` overrides
// the default hold (image) / trim (video) length — the directed render engine
// passes a per-scene duration here.
async function normalizeSeg(input, isImage, W, H, out, dur) {
  const t = String(dur != null ? Math.min(Math.max(Number(dur), 0.5), 15) : (isImage ? PHOTO_DUR : PER_CLIP_MAX))
  const vf = `[0:v]${reframe(W, H)}[v]`
  const base = ['-y']
  const args = isImage
    ? [...base, '-loop', '1', '-t', t, '-i', input, '-filter_complex', vf, '-map', '[v]']
    : [...base, '-t', t, '-i', input, '-filter_complex', vf, '-map', '[v]', '-an']
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-video_track_timescale', '30000', out)
  await run('ffmpeg', args)
  return out
}

// Concat identical-params segments (-c copy) + a silent stereo track. The cut-
// montage path shared by buildMontage and the directed render engine.
async function concatSegments(segs, dir) {
  const listFile = path.join(dir, 'list.txt')
  await writeFile(listFile, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'))
  const noaudio = path.join(dir, 'concat-noaudio.mp4')
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', noaudio])
  const final = path.join(dir, 'final.mp4')
  await run('ffmpeg', ['-y', '-i', noaudio, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', final])
  return final
}

// Primitives the directed render engine (lib/render-engine.js) reuses.
export { reframe, normalizeSeg, download, run, concatSegments, CANVAS }
export const canvasFor = aspect => CANVAS[aspect] || CANVAS.vertical

// items: [{ type:'image'|'video', url }]. Returns a local path to the final mp4.
export async function buildMontage({ items = [], aspect = 'vertical', dir }) {
  const [W, H] = CANVAS[aspect] || CANVAS.vertical
  const own = !dir
  dir = dir || await mkdtemp(path.join(tmpdir(), 'vedit-'))
  try {
    const picks = items.filter(it => it && it.url).slice(0, MAX_INPUTS)
    if (!picks.length) throw new Error('No media to edit.')
    const segs = []
    const skipped = []
    for (let i = 0; i < picks.length; i++) {
      const it = picks[i]
      // caller-declared type wins; else download()'s content-type classification.
      const declared = it.type === 'image' ? true : it.type === 'video' ? false : null
      const raw = path.join(dir, `in-${i}`)
      try {
        const got = await download(it.url, raw)
        const isImage = declared != null ? declared : got.isImage
        const seg = path.join(dir, `seg-${i}.mp4`)
        await normalizeSeg(got.path, isImage, W, H, seg)
        if ((await stat(seg)).size > 0) segs.push(seg)
        else throw new Error('empty segment')
      } catch (e) { skipped.push({ url: it.url, reason: String(e.message || e).slice(0, 80) }) }
    }
    if (!segs.length) throw new Error(`None of the media could be processed${skipped[0] ? ` (e.g. ${skipped[0].reason})` : ''}.`)

    const final = await concatSegments(segs, dir)
    return { file: final, buffer: await readFile(final), count: segs.length, skipped }
  } finally {
    if (own) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
