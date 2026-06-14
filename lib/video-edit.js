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
import { tmpdir } from 'os'
import path from 'path'

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

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len && len > MAX_BYTES) throw new Error('file too large')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error('file too large')
  await writeFile(dest, buf)
  return dest
}

// Reframe filter to fill the canvas: sharp foreground (fit-inside) over a
// blurred, zoomed copy of itself so nothing is cropped and there are no bars.
function reframe(W, H) {
  return `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:6[bg];` +
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p,fps=30`
}

// Normalize one input to a fixed-params, video-only mp4 segment.
async function normalizeSeg(input, isImage, W, H, out) {
  const vf = `[0:v]${reframe(W, H)}[v]`
  const base = ['-y']
  const args = isImage
    ? [...base, '-loop', '1', '-t', String(PHOTO_DUR), '-i', input, '-filter_complex', vf, '-map', '[v]']
    : [...base, '-t', String(PER_CLIP_MAX), '-i', input, '-filter_complex', vf, '-map', '[v]', '-an']
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-video_track_timescale', '30000', out)
  await run('ffmpeg', args)
  return out
}

// items: [{ type:'image'|'video', url }]. Returns a local path to the final mp4.
export async function buildMontage({ items = [], aspect = 'vertical', dir }) {
  const [W, H] = CANVAS[aspect] || CANVAS.vertical
  const own = !dir
  dir = dir || await mkdtemp(path.join(tmpdir(), 'vedit-'))
  try {
    const picks = items.filter(it => it && it.url).slice(0, MAX_INPUTS)
    if (!picks.length) throw new Error('No media to edit.')
    const segs = []
    for (let i = 0; i < picks.length; i++) {
      const it = picks[i]
      const isImage = it.type === 'image' || (it.type !== 'video' && IMG_EXT.test(it.url))
      const raw = path.join(dir, `in-${i}`)
      try {
        await download(it.url, raw)
        const seg = path.join(dir, `seg-${i}.mp4`)
        await normalizeSeg(raw, isImage, W, H, seg)
        if ((await stat(seg)).size > 0) segs.push(seg)
      } catch { /* skip a bad input, keep the montage going */ }
    }
    if (!segs.length) throw new Error('None of the media could be processed.')

    // Concat the identical-params segments, then lay a silent stereo track.
    const listFile = path.join(dir, 'list.txt')
    await writeFile(listFile, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'))
    const noaudio = path.join(dir, 'montage-noaudio.mp4')
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', noaudio])

    const final = path.join(dir, 'montage.mp4')
    await run('ffmpeg', ['-y', '-i', noaudio, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', final])
    return { file: final, buffer: await readFile(final), count: segs.length }
  } finally {
    if (own) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
