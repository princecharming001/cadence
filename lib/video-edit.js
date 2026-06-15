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
import { lookup } from 'dns/promises'
import path from 'path'

// Social page hosts (TikTok/IG/YouTube/etc.) are downloaded via yt-dlp, not fetch
// — pasting one of these as edit footage pulls the actual clip. NOTE: yt-dlp is a
// binary, so this works on a real host (or locally) but NOT Vercel serverless.
// Anchored to the END of the parsed hostname (never the raw URL string) so a
// metadata IP / look-alike domain can't smuggle a page-host token via path/query
// or a suffix like youtube.com.evil.com.
const PAGE_HOSTS = /(?:^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|twitch\.tv|loom\.com|x\.com|twitter\.com|facebook\.com|dailymotion\.com|reddit\.com)$/i

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

// SSRF guard — block requests to private/internal/cloud-metadata targets. The
// directed render engine downloads client-supplied scene urls, so this must hold
// against IPv4-mapped IPv6, ULA/link-local v6, shorthand IPs, and (via DNS) a
// public hostname that resolves to an internal address. Residual gap: a TOCTOU
// DNS-rebind between our lookup and undici's connect — the durable fix for that
// is a host allowlist, tracked separately.
function ipv4IsPrivate(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const o = m.slice(1).map(Number)
  if (o.some(n => n > 255)) return true                    // malformed → unsafe
  const [a, b] = o
  if (a === 0 || a === 10 || a === 127) return true        // this-net / private / loopback
  if (a === 169 && b === 254) return true                  // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true         // 172.16/12
  if (a === 192 && b === 168) return true                  // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true        // CGNAT 100.64/10 (incl. 100.100.100.200 Alibaba)
  if (a >= 224) return true                                // multicast / reserved
  return false
}
function ipIsPrivate(host) {
  let ip = String(host).trim().replace(/^\[|\]$/g, '').toLowerCase().split('%')[0] // strip [] + zone id
  if (ipv4IsPrivate(ip)) return true
  if (!ip.includes(':')) return false                      // plain v4 (checked) or a hostname
  if (ip === '::1' || ip === '::') return true             // loopback / unspecified
  const mapped = ip.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/) // ::ffff:1.2.3.4
  if (mapped) return ipv4IsPrivate(mapped[1])
  const hx = ip.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)    // ::ffff:aabb:ccdd
  if (hx) { const hi = parseInt(hx[1], 16), lo = parseInt(hx[2], 16); return ipv4IsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`) }
  const head = parseInt(ip.split(':')[0] || '0', 16)
  if ((head & 0xfe00) === 0xfc00) return true              // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true              // fe80::/10 link-local
  return false
}
function privateHost(hostname) {
  const h = String(hostname).replace(/^\[|\]$/g, '').toLowerCase()
  if (/(?:^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return true
  if (/(?:^|\.)metadata(?:\.|$)/.test(h)) return true      // metadata.google.internal etc.
  return ipIsPrivate(hostname)
}
function safeUrl(url) {
  let u; try { u = new URL(String(url)) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  if (privateHost(u.hostname)) return null
  return u
}
// Async tail of the guard: resolve a hostname and reject if ANY A/AAAA record is
// internal. Skips IP literals (already validated). Unresolvable → blocked (the
// fetch would fail anyway; failing closed is the safe default for an SSRF guard).
async function hostResolvesPrivate(hostname) {
  const bare = String(hostname).replace(/^\[|\]$/g, '')
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) return false // IP literal
  try { const addrs = await lookup(hostname, { all: true }); return addrs.some(a => ipIsPrivate(a.address)) }
  catch { return true }
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
  // Validate the HOST FIRST — before any dispatch — so the yt-dlp fast path can't
  // be used to reach an internal target whose hostname/path merely contains a
  // page-host token. PAGE_HOSTS is now matched against the PARSED hostname only.
  const u = safeUrl(url)
  if (!u || await hostResolvesPrivate(u.hostname)) throw new Error('blocked or invalid url')
  if (PAGE_HOSTS.test(u.hostname)) {
    const mp4 = dest.endsWith('.mp4') ? dest : `${dest}.mp4`
    return await ytDlp(u.href, mp4)
  }
  const res = await fetch(u.href, { redirect: 'follow', signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(res.status === 404 ? 'source no longer available' : `fetch ${res.status}`)
  if (res.url) { const ru = safeUrl(res.url); if (!ru || await hostResolvesPrivate(ru.hostname)) throw new Error('blocked redirect') }
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

// The EXACT encoder params every segment must share so concat -c copy stays
// byte-identical (the setsar=1 requirement above). normalizeSeg AND the directed
// render engine's compositeScene both end with these — never inline them.
const ENCODE_ARGS = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30', '-video_track_timescale', '30000']

// Normalize one input to a fixed-params, video-only mp4 segment. `dur` overrides
// the default hold (image) / trim (video) length. opts.ss = source in-point for a
// video (trim start, -ss before -i); opts.kenBurns = a slow zoom on a still.
async function normalizeSeg(input, isImage, W, H, out, dur, opts = {}) {
  const t = String(dur != null ? Math.min(Math.max(Number(dur), 0.5), 60) : (isImage ? PHOTO_DUR : PER_CLIP_MAX))
  const ss = !isImage && opts.ss != null && Number(opts.ss) > 0 ? ['-ss', String(Number(opts.ss))] : []
  let vf
  if (opts.kenBurns && isImage) {
    // Scale up, then a centered slow push via zoompan, back down to the canvas.
    // d=1 with a looped input (NOT d=frames — that multiplies every input frame).
    vf = `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
      `zoompan=z='min(zoom+0.0011,1.30)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,setsar=1,format=yuv420p[v]`
  } else {
    vf = `[0:v]${reframe(W, H)}[v]`
  }
  const base = ['-y']
  const args = isImage
    ? [...base, '-loop', '1', '-t', t, '-i', input, '-filter_complex', vf, '-map', '[v]']
    : [...base, ...ss, '-t', t, '-i', input, '-filter_complex', vf, '-map', '[v]', '-an']
  args.push('-t', t, ...ENCODE_ARGS, out) // output -t: hard cap the segment length
  await run('ffmpeg', args)
  return out
}

// Assemble segments with per-boundary transitions. transitions[i] = the transition
// INTO segment i+1 ({name,dur}); 'cut'/null = a hard join. If every boundary is a
// cut, take the cheap concat -c copy fast path; otherwise fold the whole timeline
// left-to-right with xfade (re-encode — xfade requires it). durations[i] = seg i s.
const XFADE_NAMES = new Set(['fade', 'dissolve', 'slideleft', 'slideright', 'slideup', 'slidedown', 'wipeleft', 'wiperight', 'circleopen', 'circleclose', 'radial', 'smoothleft', 'smoothright'])
async function assembleSegments(segs, transitions, durations, dir) {
  const anyX = (transitions || []).some(t => t && t.name && t.name !== 'cut')
  if (!anyX || segs.length < 2) return await concatSegments(segs, dir)
  const inputs = []; segs.forEach(s => inputs.push('-i', s))
  const fc = []
  let last = '0:v', acc = durations[0]
  for (let i = 1; i < segs.length; i++) {
    const tr = transitions[i - 1]
    const name = tr && tr.name && tr.name !== 'cut' && XFADE_NAMES.has(tr.name) ? tr.name : null
    const out = i === segs.length - 1 ? 'vout' : `x${i}`
    if (name) {
      const d = Math.min(Math.max(Number(tr.dur) || 0.4, 0.1), Math.min(durations[i - 1], durations[i]) - 0.05)
      const off = Math.max(0, acc - d)
      fc.push(`[${last}][${i}:v]xfade=transition=${name}:duration=${d.toFixed(3)}:offset=${off.toFixed(3)}[${out}]`)
      acc = acc + durations[i] - d
    } else {
      fc.push(`[${last}][${i}:v]concat=n=2:v=1:a=0[${out}]`)
      acc = acc + durations[i]
    }
    last = out
  }
  const noaudio = path.join(dir, 'xf-noaudio.mp4')
  await run('ffmpeg', ['-y', ...inputs, '-filter_complex', fc.join(';'), '-map', `[${last}]`, ...ENCODE_ARGS, noaudio])
  const final = path.join(dir, 'final.mp4')
  await run('ffmpeg', ['-y', '-i', noaudio, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', final])
  return final
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
export { reframe, normalizeSeg, download, run, concatSegments, assembleSegments, CANVAS, ENCODE_ARGS }
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
