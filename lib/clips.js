// lib/clips.js — automated clipping: turn a long video into short, platform-
// ready clips for Instagram Reels / TikTok.
//
// Pipeline (each step degrades gracefully — see the failure notes inline):
//   1. download + ffprobe validate (caps: 2.5h / ~500MB direct, 3GB via yt-dlp)
//   2. find silence boundaries (so cuts never land mid-sentence)
//   3. pick highlights:
//        - if OPENAI_API_KEY: Whisper transcript -> Claude picks hook-worthy
//          moments + writes a title/caption per clip; captions burned in
//        - else: audio-energy scoring picks the liveliest speech blocks
//          (clips still ship; captions are simply unavailable)
//   4. cut + format with ffmpeg:
//        vertical       9:16 blur-pad   (default — whole frame stays visible)
//        vertical_crop  9:16 center-crop (fills the phone screen)
//        square         1:1 blur-pad
//        original       source aspect
//   5. upload mp4s to the public `clips` bucket
import { spawn } from 'child_process'
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MAX_DURATION = 150 * 60        // 2.5h — podcasts are the core use case
const LEN = { short: [15, 30], medium: [30, 60] }

export const CLIP_FORMATS = [
  { key: 'vertical', label: 'Vertical 9:16', desc: 'Blurred background — nothing gets cropped (Reels/TikTok)' },
  { key: 'vertical_crop', label: 'Vertical crop', desc: 'Center-cropped 9:16 — fills the whole phone screen' },
  { key: 'square', label: 'Square 1:1', desc: 'Feed-friendly square with blurred pad' },
  { key: 'original', label: 'Original', desc: 'Keep the source aspect ratio' },
]

// ── Edit formats v3 — researched against the 2026 standard ────────────────────
// Word-by-word ALL-CAPS karaoke captions with a yellow active sweep are the
// baseline (92% of mobile video plays muted); sludge split-screen adds a
// gameplay attention anchor; hook adds an AI title over captions. Users pick a
// SUBSET per job/campaign; clips rotate through the chosen formats.
export const EDIT_FORMATS = [
  { key: 'captions', label: 'Captions', desc: 'Word-by-word bold captions with a yellow highlight — the standard' },
  { key: 'sludge', label: 'Sludge split', desc: 'Your clip on top, gameplay underneath, captions at the seam' },
  { key: 'hook', label: 'Hook + captions', desc: 'Big AI title for the first seconds, captions throughout' },
  { key: 'clean', label: 'Clean', desc: 'Just your watermark' },
  // legacy keys (older jobs) — still render, no longer offered in the UI
  { key: 'meme_bar', legacy: true }, { key: 'banner', legacy: true }, { key: 'progress', legacy: true },
]

// Display font: bundled Anton (OFL) first — the punchy condensed display face
// the caption style calls for — then system fallbacks. CLIP_FONT overrides.
import { existsSync } from 'fs'
const ANTON = path.join(process.cwd(), 'assets', 'fonts', 'Anton.ttf')
const FONT = process.env.CLIP_FONT || [
  ANTON,
  '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
].find(f => existsSync(f)) || null

const wrapTitle = (t, width = 20) => {
  const words = String(t || '').trim().split(/\s+/)
  const lines = ['']
  for (const w of words) {
    if ((lines[lines.length - 1] + ' ' + w).trim().length > width && lines[lines.length - 1]) lines.push(w)
    else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim()
  }
  return lines.slice(0, 3).join('\n')
}
const escText = s => String(s || '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '')

// Overlay chain appended AFTER the base aspect filter. Uses textfile= for the
// title (escaping- and linebreak-safe); watermark is short, inlined.
function editFilter(edit, { titleFile, watermark, durSec }) {
  if (!FONT) return '' // no usable font on this box — ship clips un-overlaid rather than fail
  const f = `fontfile=${FONT}`
  const wm = watermark ? `,drawtext=${f}:text='${escText(watermark)}':fontsize=30:fontcolor=white@0.65:borderw=2:bordercolor=black@0.5:x=w-text_w-34:y=h-58` : ''
  switch (edit) {
    case 'meme_bar':
      return `,drawbox=x=0:y=0:w=iw:h=250:color=white:t=fill` +
        (titleFile ? `,drawtext=${f}:textfile=${titleFile}:fontsize=52:fontcolor=black:line_spacing=10:x=(w-text_w)/2:y=(250-text_h)/2` : '') + wm
    case 'hook':
      return (titleFile ? `,drawtext=${f}:textfile=${titleFile}:fontsize=68:fontcolor=white:borderw=7:bordercolor=black:line_spacing=12:x=(w-text_w)/2:y=h*0.16:enable='lt(t,3.5)'` : '') + wm
    case 'banner':
      return `,drawbox=x=0:y=h-190:w=iw:h=120:color=black@0.62:t=fill` +
        (titleFile ? `,drawtext=${f}:textfile=${titleFile}:fontsize=38:fontcolor=white:x=34:y=h-190+((120-text_h)/2)` : '') +
        (watermark ? `,drawtext=${f}:text='${escText(watermark)}':fontsize=28:fontcolor=white@0.75:x=w-text_w-34:y=h-190+((120-28)/2)` : '')
    case 'progress':
      return `,drawbox=x=0:y=h-12:w='max(1\\,iw*t/${Math.max(durSec, 1)})':h=12:color=white@0.85:t=fill` + wm
    default: // clean
      return wm
  }
}

// One humorous, scroll-stopping title per clip (Claude). With a transcript we
// title what's actually said; without, we riff on the source.
async function writeTitles(picks, { sourceName, segments }) {
  const ctx = picks.map((p, i) => {
    const said = segments?.length
      ? segments.filter(s => s.end > p.start && s.start < p.end).map(s => s.text).join(' ').slice(0, 400)
      : ''
    return `CLIP ${i + 1} (${Math.round(p.end - p.start)}s)${said ? `: "${said}"` : ''}`
  }).join('\n')
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 500,
      system: `You write the on-video TITLE TEXT for short-form clips (Reels/TikTok) — the white-bar meme-style headline. Funny, casual, scroll-stopping, human. <=9 words each, no quotes, no hashtags, no emojis. ${segments?.length ? 'Base each on what is said in that clip.' : `The clips are from "${sourceName || 'a video'}" — write playful curiosity hooks that fit any moment from it.`}
Respond ONLY JSON: {"titles":["...","..."]}`,
      messages: [{ role: 'user', content: `Write ${picks.length} titles:\n${ctx}` }],
    })
    const j = JSON.parse((res.content.find(b => b.type === 'text')?.text || '{}').replace(/^```json\s*|\s*```$/g, '').trim())
    return Array.isArray(j.titles) ? j.titles : []
  } catch { return [] }
}

function run(cmd, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let out = '', err = ''
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)) }, timeoutMs)
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('error', e => { clearTimeout(t); reject(e) })
    p.on('close', c => { clearTimeout(t); c === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} failed: ${err.slice(-400)}`)) })
  })
}

async function probe(file) {
  // -v error (not quiet): when probing fails we want ffprobe's reason in the job error.
  const { out } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  const j = JSON.parse(out)
  const v = (j.streams || []).find(s => s.codec_type === 'video')
  if (!v) throw new Error('That file has no video stream.')
  return { duration: Number(j.format?.duration || 0), width: v.width, height: v.height, hasAudio: (j.streams || []).some(s => s.codec_type === 'audio') }
}

// Silence boundaries -> speech blocks. Cutting on these keeps sentences whole.
async function speechBlocks(file, duration) {
  const { err } = await run('ffmpeg', ['-i', file, '-af', 'silencedetect=noise=-32dB:d=0.45', '-f', 'null', '-'])
  const starts = [...err.matchAll(/silence_start: ([\d.]+)/g)].map(m => Number(m[1]))
  const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map(m => Number(m[1]))
  const blocks = []
  let cur = 0
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] - cur > 1.2) blocks.push([cur, starts[i]])
    cur = ends[i] ?? starts[i]
  }
  if (duration - cur > 1.2) blocks.push([cur, duration])
  return blocks
}

// Loudness variance per block — a cheap proxy for "lively moment".
async function energyScore(file, [s, e]) {
  try {
    const { err } = await run('ffmpeg', ['-ss', String(s), '-to', String(e), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { timeoutMs: 120000 })
    const mean = Number((err.match(/mean_volume: ([-\d.]+)/) || [])[1] ?? -50)
    const max = Number((err.match(/max_volume: ([-\d.]+)/) || [])[1] ?? -50)
    return (max - mean) + (mean + 50) / 4 // dynamics + overall presence
  } catch { return 0 }
}

// Merge/trim speech blocks into candidate windows of the target length, ending
// and starting on silence so nothing is cut mid-word.
function windowsFrom(blocks, [minL, maxL], duration) {
  const wins = []
  for (let i = 0; i < blocks.length; i++) {
    let [s, e] = blocks[i]
    let j = i
    while (e - s < minL && j + 1 < blocks.length && blocks[j + 1][1] - s <= maxL + 8) { j++; e = blocks[j][1] }
    if (e - s >= minL) wins.push([s, Math.min(e, s + maxL)])
  }
  // Music-only / no-silence fallback: slice evenly.
  if (!wins.length && duration > minL) {
    for (let s = 0; s + minL <= duration && wins.length < 6; s += maxL) wins.push([s, Math.min(s + maxL, duration)])
  }
  return wins
}

function overlap(a, b) { return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) > 2 }

// ── Transcription — provider chain, no required keys ──────────────────────────
// 1. OpenAI Whisper API when OPENAI_API_KEY is set.
// 2. LOCAL whisper.cpp (whisper-cli + a ggml model) — free, offline, fast on
//    Apple Silicon; gives word-level timestamps for karaoke captions.
// 3. null → callers fall back to audio-energy selection.
// Returns { segments:[{start,end,text}], words:[{start,end,text}] } (seconds).
const WHISPER_MODEL = process.env.WHISPER_MODEL ||
  path.join(process.env.HOME || '/root', '.cache/whisper/ggml-base.en.bin')

async function transcribeOpenAI(file, dir) {
  if (!process.env.OPENAI_API_KEY) return null
  const audio = path.join(dir, 'audio.mp3')
  await run('ffmpeg', ['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-y', audio])
  const form = new FormData()
  form.append('file', new Blob([await readFile(audio)], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form,
  })
  if (!res.ok) return null
  const j = await res.json()
  return {
    segments: (j.segments || []).map(s => ({ start: s.start, end: s.end, text: (s.text || '').trim() })),
    words: (j.words || []).map(w => ({ start: w.start, end: w.end, text: (w.word || '').trim() })),
  }
}

async function transcribeLocal(file, dir) {
  if (!existsSync(WHISPER_MODEL)) return null
  try { await run('whisper-cli', ['--help'], { timeoutMs: 15000 }) } catch { return null }
  const wav = path.join(dir, 'audio.wav')
  await run('ffmpeg', ['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-y', wav])
  const base = path.join(dir, 'transcript')
  await run('whisper-cli', ['-m', WHISPER_MODEL, '-f', wav, '--output-json-full', '-of', base, '--no-prints'], { timeoutMs: 25 * 60 * 1000 })
  const j = JSON.parse(await readFile(`${base}.json`, 'utf8'))
  const segs = j.transcription || []
  const segments = [], words = []
  for (const s of segs) {
    const text = (s.text || '').trim()
    if (text) segments.push({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text })
    // Tokens -> words: a token starting with a space begins a new word;
    // punctuation-only tokens glue onto the previous word.
    for (const t of s.tokens || []) {
      const tt = t.text || ''
      if (tt.startsWith('[_')) continue
      if (tt.startsWith(' ') || !words.length) words.push({ start: t.offsets.from / 1000, end: t.offsets.to / 1000, text: tt.trim() })
      else { const w = words[words.length - 1]; w.text += tt.trim(); w.end = t.offsets.to / 1000 }
    }
  }
  return { segments, words: words.filter(w => /\w/.test(w.text)) }
}

async function transcribe(file, dir) {
  try { return (await transcribeOpenAI(file, dir)) || (await transcribeLocal(file, dir)) } catch { return null }
}

// ── Karaoke captions (ASS/libass) — the 2026 standard ─────────────────────────
// Word-by-word ALL-CAPS pop with a yellow active-word sweep, display-black font
// (Anton, bundled in assets/fonts), heavy outline so it reads at thumb distance.
const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts')
const assTime = t => { const cs = Math.max(0, Math.round(t * 100)); const h = Math.floor(cs / 360000); const m = Math.floor(cs / 6000) % 60; const s = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}` }

function buildKaraokeAss({ words, clipStart, clipEnd, alignment = 2, marginV = 480, fontSize = 92, title = null }) {
  const inRange = (words || []).filter(w => w.start >= clipStart - 0.2 && w.end <= clipEnd + 0.2)
  if (!inRange.length && !title) return null
  // Lines of <=3 words; break early on speech gaps so lines track the rhythm.
  const lines = [[]]
  for (const w of inRange) {
    const cur = lines[lines.length - 1]
    const gap = cur.length ? w.start - cur[cur.length - 1].end : 0
    if (cur.length >= 3 || (cur.length && gap > 0.8)) lines.push([w])
    else cur.push(w)
  }
  const events = lines.filter(l => l.length).map(l => {
    const t0 = l[0].start - clipStart, t1 = Math.min(l[l.length - 1].end - clipStart + 0.12, clipEnd - clipStart)
    const body = l.map(w => `{\\k${Math.max(8, Math.round((w.end - w.start) * 100))}}${w.text.toUpperCase().replace(/[{}\\]/g, '')} `).join('').trim()
    return `Dialogue: 0,${assTime(Math.max(0, t0))},${assTime(t1)},Cap,,0,0,0,,${body}`
  })
  // Hook title: rendered by libass too (drawtext mangled line breaks into
  // missing-glyph boxes) — top-center for the first 3.5s, \N line breaks.
  if (title) {
    const wrapped = wrapTitle(title, 18).split('\n').map(s => s.replace(/[{}\\]/g, '')).join('\\N')
    events.unshift(`Dialogue: 1,${assTime(0)},${assTime(Math.min(3.5, clipEnd - clipStart))},Hook,,0,0,0,,${wrapped}`)
  }
  if (!events.length) return null
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Anton,${fontSize},&H0000FFFF,&H00FFFFFF,&H00000000,&H7F000000,-1,0,0,0,100,100,1,0,1,6,2,${alignment},60,60,${marginV},1
Style: Hook,Anton,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H7F000000,-1,0,0,0,100,100,1,0,1,7,3,8,60,60,170,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`
}

// ── Filler footage (sludge bottom-half) ───────────────────────────────────────
// Free-to-use gameplay files dropped into assets/fillers/*.mp4 on the server.
const FILLERS_DIR = path.join(process.cwd(), 'assets', 'fillers')
async function pickFiller(clipDur) {
  try {
    const { readdir } = await import('fs/promises')
    const files = (await readdir(FILLERS_DIR)).filter(f => f.endsWith('.mp4'))
    if (!files.length) return null
    const file = path.join(FILLERS_DIR, files[Math.floor(Math.random() * files.length)])
    const meta = await probe(file).catch(() => null)
    if (!meta || meta.duration < clipDur + 5) return null
    const offset = 2 + Math.random() * (meta.duration - clipDur - 4)
    return { file, offset }
  } catch { return null }
}

// Claude picks the hook-worthy moments from the transcript. The transcript is
// STRIDE-SAMPLED to budget, never head-truncated — a 2h podcast's best moment
// is as likely at minute 90 as minute 3, and timestamps stay valid either way.
function sampleTranscript(segments, budgetChars = 22000) {
  const lines = segments.map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
  const total = lines.reduce((a, l) => a + l.length + 1, 0)
  if (total <= budgetChars) return lines.join('\n')
  const keepRatio = budgetChars / total
  const stride = Math.ceil(1 / keepRatio)
  // Keep every Nth segment across the WHOLE duration (with its neighbors for
  // local context), so picks can land anywhere in the video.
  const kept = []
  for (let i = 0; i < lines.length; i += stride) kept.push(lines[i], lines[i + 1])
  return kept.filter(Boolean).join('\n').slice(0, budgetChars)
}

async function pickHighlights(segments, n, [minL, maxL]) {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 900,
    system: `You pick the most scroll-stopping moments from a video transcript for short-form clips (Reels/TikTok). Each clip must be ${minL}-${maxL} seconds, self-contained (a hook, a payoff), and start/end at natural sentence boundaries from the given timestamps. Spread picks across the WHOLE video when quality allows — don't cluster in the opening minutes. Also write a punchy title (<=8 words) and a 1-2 sentence caption for each.
Respond ONLY JSON: {"clips":[{"start":sec,"end":sec,"title":"...","caption":"..."}]}`,
    messages: [{ role: 'user', content: `Pick the best ${n} clips:\n\n${sampleTranscript(segments)}` }],
  })
  try {
    const j = JSON.parse((res.content.find(b => b.type === 'text')?.text || '{}').replace(/^```json\s*|\s*```$/g, '').trim())
    return (j.clips || []).filter(c => c.end - c.start >= minL * 0.6 && c.end - c.start <= maxL * 1.5)
  } catch { return [] }
}

function srtFor(segments, start, end, file) {
  const fmt = t => { const ms = Math.round(t * 1000); const h = String(Math.floor(ms / 3600000)).padStart(2, '0'); const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0'); const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0'); return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}` }
  const within = segments.filter(s => s.end > start && s.start < end)
  if (!within.length) return null
  const srt = within.map((s, i) => `${i + 1}\n${fmt(Math.max(0, s.start - start))} --> ${fmt(Math.min(end - start, s.end - start))}\n${s.text}\n`).join('\n')
  return writeFile(file, srt).then(() => file)
}

function formatFilter(format, withSubs) {
  const subs = withSubs ? `,subtitles=subs.srt:force_style='FontSize=15,Bold=1,Outline=1,MarginV=40'` : ''
  switch (format) {
    case 'vertical': return `[0:v]split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:6[b];[fg]scale=1080:1920:force_original_aspect_ratio=decrease[f];[b][f]overlay=(W-w)/2:(H-h)/2${subs}`
    case 'vertical_crop': return `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920${subs}`
    case 'square': return `[0:v]split=2[bg][fg];[bg]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=24:6[b];[fg]scale=1080:1080:force_original_aspect_ratio=decrease[f];[b][f]overlay=(W-w)/2:(H-h)/2${subs}`
    default: return withSubs ? `[0:v]null${subs}` : null
  }
}

// Every status write doubles as the liveness heartbeat the stale sweep keys on.
async function setDetail(id, status_detail) {
  await admin.from('clip_jobs').update({ status_detail, heartbeat_at: new Date().toISOString() }).eq('id', id)
}

// ── Source cache ──────────────────────────────────────────────────────────────
// Re-running a job used to re-download the whole video — three downloads of one
// podcast in a day is exactly how we got YouTube's bot check. Sources cache on
// disk keyed by a NORMALIZED url (YouTube variants like &t=3s collapse to the
// video id), pruned LRU to the newest few.
import { createHash } from 'crypto'
const SRC_CACHE = path.join(process.cwd(), '.cache', 'clip-sources')

function cacheKey(url) {
  try {
    const u = new URL(url)
    let id = ''
    if (/youtube\.com$/.test(u.hostname.replace(/^www\./, ''))) id = u.searchParams.get('v') || u.pathname
    else if (/youtu\.be$/.test(u.hostname)) id = u.pathname
    const basis = id ? `youtube:${id}` : `${u.hostname}${u.pathname}`
    return createHash('sha1').update(basis).digest('hex')
  } catch { return createHash('sha1').update(String(url)).digest('hex') }
}

async function cacheGet(url) {
  const f = path.join(SRC_CACHE, `${cacheKey(url)}.mp4`)
  return existsSync(f) ? f : null
}

async function cachePut(url, tmpFile) {
  const { mkdir, rename, readdir, stat, unlink } = await import('fs/promises')
  await mkdir(SRC_CACHE, { recursive: true })
  const dest = path.join(SRC_CACHE, `${cacheKey(url)}.mp4`)
  try { await rename(tmpFile, dest) } catch { return tmpFile } // cross-device fallback: just use the tmp copy
  // LRU prune: keep the 5 newest sources.
  try {
    const files = await Promise.all((await readdir(SRC_CACHE)).filter(f => f.endsWith('.mp4'))
      .map(async f => ({ f: path.join(SRC_CACHE, f), m: (await stat(path.join(SRC_CACHE, f))).mtimeMs })))
    for (const old of files.sort((a, b) => b.m - a.m).slice(5)) await unlink(old.f).catch(() => {})
  } catch {}
  return dest
}

// ── Source ingestion ─────────────────────────────────────────────────────────
// Users paste three kinds of links: direct video files, video PAGES (YouTube,
// TikTok, Vimeo, Loom...), and things that aren't videos at all. Direct files
// are fetched; pages go through yt-dlp when it's installed; everything else
// fails with an error that says exactly what to do instead.
const PAGE_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|twitch\.tv|drive\.google\.com|loom\.com|x\.com|twitter\.com|facebook\.com|dailymotion\.com)/i

async function hasYtDlp() { try { await run('yt-dlp', ['--version'], { timeoutMs: 15000 }); return true } catch { return false } }

async function ingest(job, src) {
  // Cached source from a previous run? Skip the network entirely (and spare
  // YouTube's bot-check trigger-happiness).
  const cached = await cacheGet(job.source_url)
  if (cached) { await setDetail(job.id, 'Using cached download…'); return cached }

  // Direct file path: fetch and make sure it's actually a video, not a webpage.
  if (!PAGE_HOSTS.test(job.source_url)) {
    const res = await fetch(job.source_url).catch(() => null)
    if (res?.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      const head = buf.subarray(0, 256).toString('utf8').trimStart().toLowerCase()
      const isHtml = head.startsWith('<!doctype') || head.startsWith('<html') || (res.headers.get('content-type') || '').includes('text/html')
      if (!isHtml) {
        if (buf.length > 520 * 1024 * 1024) throw new Error('Video is over 500MB — trim it down first.')
        await writeFile(src, buf)
        return src
      }
    } else if (res) {
      throw new Error(`Could not fetch the video (${res.status}).`)
    }
    // fall through: unreachable or served HTML — maybe yt-dlp knows the site
  }

  // Video-page path (YouTube etc.).
  if (!(await hasYtDlp())) {
    throw new Error('That link is a video page (YouTube, TikTok, etc.), not a video file. Upload the file or paste a direct .mp4 link — or install yt-dlp on the server to clip straight from links like this.')
  }

  // YouTube intermittently bot-checks anonymous downloads ("Sign in to confirm
  // you're not a bot") — that is NOT a private video. Recovery: an explicit
  // cookies file when the operator has set one up (YTDLP_COOKIES env →
  // exported cookies.txt). Deliberately NOT --cookies-from-browser: on macOS
  // that pops a keychain-password prompt to decrypt the browser's cookie
  // store, which an automated pipeline has no business asking for.
  const isBotCheck = m => /confirm you.{0,3}re not a bot/i.test(m)
  const isGated = m => /private video|video is private|members.only|age.restricted|login required/i.test(m)
  const runYt = async (args, timeoutMs) => {
    const ladders = [[]]
    if (process.env.YTDLP_COOKIES && existsSync(process.env.YTDLP_COOKIES)) ladders.push(['--cookies', process.env.YTDLP_COOKIES])
    let lastErr
    for (const extra of ladders) {
      try { return await run('yt-dlp', [...extra, ...args], { timeoutMs }) }
      catch (e) {
        lastErr = e
        const msg = String(e.message || '')
        if (isGated(msg)) throw new Error('That video is actually private, members-only, or age-restricted — Cadence can only clip videos it can watch.')
        if (!isBotCheck(msg)) throw e // real error — don't burn the ladder on it
      }
    }
    if (isBotCheck(String(lastErr?.message || ''))) {
      throw new Error('YouTube is rate-limiting downloads from this machine right now (its bot check). It usually clears in 15–60 minutes — your job stays here, just hit retry later or upload the file directly.')
    }
    throw lastErr
  }

  // Metadata first: reject over-long videos BEFORE the (slow) download, and pick
  // a lighter source for long ones — clips don't need 1080p of a 2h podcast.
  let pageDuration = 0
  try {
    const { out } = await runYt(['--no-playlist', '--print', 'duration', job.source_url], 120000)
    pageDuration = Number(out.trim().split('\n').pop()) || 0
  } catch (e) {
    if (/actually private|rate-limiting/.test(String(e.message))) throw e
    throw new Error(`Could not read that video page: ${String(e.message || '').slice(-220)}`)
  }
  if (pageDuration > MAX_DURATION) throw new Error(`That video is ${Math.round(pageDuration / 60)} minutes — the cap is ${MAX_DURATION / 60}. Clip something shorter.`)
  const maxH = pageDuration > 45 * 60 ? 720 : 1080
  await setDetail(job.id, 'Downloading from the video page…')
  await runYt([
    '-f', `bv*[height<=${maxH}][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b`,
    '--merge-output-format', 'mp4', '--max-filesize', '3000M', '--no-playlist',
    '--force-overwrites', '-o', src, job.source_url,
  ], 20 * 60 * 1000).catch(e => {
    const msg = String(e.message || '')
    if (/actually private|rate-limiting/.test(msg)) throw e
    if (/max-filesize/i.test(msg)) throw new Error('That video is too large to download — clip something shorter.')
    throw new Error(`Could not download that video: ${msg.slice(-220)}`)
  })
  return cachePut(job.source_url, src)
}

export async function processClipJob(job) {
  const dir = await mkdtemp(path.join(tmpdir(), 'clip-'))
  try {
    await admin.from('clip_jobs').update({ status: 'processing', status_detail: 'Downloading video…' }).eq('id', job.id)

    const src = await ingest(job, path.join(dir, 'source.mp4'))

    await setDetail(job.id, 'Analyzing video…')
    const meta = await probe(src)
    if (!meta.hasAudio) throw new Error('That video has no audio track — clipping needs speech or sound.')
    if (meta.duration > MAX_DURATION) throw new Error(`Video is over ${Math.round(MAX_DURATION / 60)} minutes — clip something shorter.`)
    if (meta.duration < 20) throw new Error('Video is under 20 seconds — it already is a clip.')
    await admin.from('clip_jobs').update({ duration_sec: meta.duration }).eq('id', job.id)

    const range = LEN[job.target_len] || LEN.short
    const n = Math.min(Math.max(job.max_clips || 3, 1), 5)

    // Transcript (local Whisper or OpenAI) → Claude picks moments and the words
    // drive the karaoke captions. Audio-energy selection is the no-ASR fallback.
    await setDetail(job.id, 'Transcribing…')
    const tr = await transcribe(src, dir)
    const segments = tr?.segments || null
    await setDetail(job.id, 'Finding the best moments…')
    let picks = []
    if (segments?.length) {
      picks = await pickHighlights(segments, n, range)
      // Snap AI picks to silence boundaries so cuts feel natural.
      const blocks = await speechBlocks(src, meta.duration)
      const edges = blocks.flat()
      const snap = (t, dirn) => edges.reduce((best, e) => (dirn === 'start' ? e <= t + 0.5 : e >= t - 0.5) && Math.abs(e - t) < Math.abs(best - t) ? e : best, t)
      picks = picks.map(p => ({ ...p, start: Math.max(0, snap(p.start, 'start')), end: Math.min(meta.duration, snap(p.end, 'end')) }))
    }
    if (!picks.length) {
      const blocks = await speechBlocks(src, meta.duration)
      const wins = windowsFrom(blocks, range, meta.duration)
      // Sample candidates ACROSS the whole video — slicing the first N would
      // mean a 2h podcast only ever gets clips from its intro.
      let cands = wins
      if (cands.length > 24) {
        const step = cands.length / 24
        cands = Array.from({ length: 24 }, (_, i) => wins[Math.floor(i * step)])
      }
      await setDetail(job.id, `Scoring ${cands.length} moments across the video…`)
      const scored = []
      for (const w of cands) scored.push({ w, score: await energyScore(src, w) })
      scored.sort((a, b) => b.score - a.score)
      const chosen = []
      for (const s of scored) { if (!chosen.some(c => overlap(c.w, s.w))) chosen.push(s); if (chosen.length >= n) break }
      picks = chosen.map((c, i) => ({ start: c.w[0], end: c.w[1], title: `Clip ${i + 1}`, caption: '' }))
    }
    if (!picks.length) throw new Error('Could not find clippable moments in this video.')

    // Humorous on-video titles (Claude), then rotate clips through the user's
    // chosen edit formats.
    await setDetail(job.id, 'Writing titles…')
    const titles = await writeTitles(picks, { sourceName: job.source_name, segments })
    picks = picks.map((p, i) => ({ ...p, title: titles[i] || p.title || `Clip ${i + 1}` }))
    const edits = (Array.isArray(job.edit_formats) && job.edit_formats.length ? job.edit_formats : ['clean'])
      .filter(e => EDIT_FORMATS.some(f => f.key === e))

    const enc = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']
    // One filler pick per job (long enough to cover the longest clip); if none
    // is available, sludge clips gracefully render as captions instead.
    const longest = Math.max(...picks.map(p => p.end - p.start))
    const sludgeFiller = edits.includes('sludge') ? await pickFiller(longest) : null
    const clips = []
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i]
      const edit = edits[i % edits.length] || 'clean'
      const durSec = p.end - p.start
      await setDetail(job.id, `Cutting clip ${i + 1} of ${picks.length}…`)
      const outFile = path.join(dir, `clip${i}.mp4`)

      // Karaoke captions for caption-bearing formats (needs word timestamps).
      let assFile = null
      if ((tr?.words?.length || edit === 'hook') && ['captions', 'sludge', 'hook'].includes(edit)) {
        const ass = buildKaraokeAss({
          words: tr?.words || [], clipStart: p.start, clipEnd: p.end,
          alignment: edit === 'sludge' ? 5 : 2, marginV: edit === 'sludge' ? 0 : 460,
          title: edit === 'hook' ? p.title : null,
        })
        if (ass) { assFile = path.join(dir, `subs${i}.ass`); await writeFile(assFile, ass) }
      }
      const subs = assFile ? `,subtitles=filename='${assFile}':fontsdir='${FONTS_DIR}'` : ''
      const titleFile = path.join(dir, `title${i}.txt`)
      await writeFile(titleFile, wrapTitle(p.title))

      const buildArgs = (withSubs) => {
        const a = ['-ss', String(p.start), '-to', String(p.end), '-i', src]
        let chain
        if (edit === 'sludge' && sludgeFiller) {
          // Main clip top half, gameplay bottom half, captions at the seam.
          a.push('-ss', String(sludgeFiller.offset), '-t', String(durSec), '-i', sludgeFiller.file)
          chain = `[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[top];` +
            `[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[bot];` +
            `[top][bot]vstack=2${withSubs ? subs : ''}` +
            editFilter('clean', { watermark: job.watermark, durSec })
        } else {
          const base = formatFilter(job.format, false) || '[0:v]null'
          // 'hook' titles render inside the ASS layer now (libass handles line
          // breaks; drawtext drew them as missing-glyph boxes). 'captions' is
          // captions + watermark; legacy keys keep their old drawtext overlays.
          const overlay = editFilter(['captions', 'sludge', 'hook'].includes(edit) ? 'clean' : edit, { titleFile, watermark: job.watermark, durSec })
          chain = base + (withSubs ? subs : '') + overlay
        }
        a.push('-filter_complex', `${chain}[vout]`, '-map', '[vout]', '-map', '0:a?', ...enc, '-y', outFile)
        return a
      }
      // Subtitle/drawtext filters can fail on odd fonts/paths — retry plainer.
      await run('ffmpeg', buildArgs(true), { timeoutMs: 8 * 60 * 1000 })
        .catch(() => run('ffmpeg', buildArgs(false), { timeoutMs: 8 * 60 * 1000 }))

      await setDetail(job.id, `Uploading clip ${i + 1}…`)
      const storagePath = `${job.user_id}/${job.id}/clip-${i}.mp4`
      const { error: upErr } = await admin.storage.from('clips').upload(storagePath, await readFile(outFile), { contentType: 'video/mp4', upsert: true, cacheControl: '31536000' })
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`)
      clips.push({
        url: admin.storage.from('clips').getPublicUrl(storagePath).data.publicUrl,
        start: Math.round(p.start), end: Math.round(p.end),
        title: p.title || `Clip ${i + 1}`, caption: p.caption || '', edit,
      })
    }

    await admin.from('clip_jobs').update({ status: 'done', status_detail: `${clips.length} clips ready`, clips }).eq('id', job.id)
    return { done: clips.length }
  } catch (e) {
    await admin.from('clip_jobs').update({ status: 'failed', error: e.message, status_detail: null }).eq('id', job.id)
    return { error: e.message }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Process queued jobs one at a time (called by the worker route + cron sweep).
export async function processQueuedClipJobs(maxJobs = 2) {
  // Recover jobs orphaned mid-processing (server restart/crash): staleness is
  // judged by the HEARTBEAT (bumped on every status write), not created_at —
  // an old-but-alive job is fine; a silent one for 30 min is dead. Whisper's
  // own timeout (25 min) sits safely inside that window.
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  await admin.from('clip_jobs').update({ status: 'queued', status_detail: 'Retrying after interruption…' })
    .eq('status', 'processing').lt('heartbeat_at', stale)

  const out = []
  for (let i = 0; i < maxJobs; i++) {
    const { data: candidate } = await admin.from('clip_jobs').select('id').eq('status', 'queued').order('created_at').limit(1).single()
    if (!candidate) break
    // Atomic claim: only one worker wins the queued->processing transition,
    // so the job-create kick and the cron sweep can never process the same job.
    const { data: claimed } = await admin.from('clip_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() })
      .eq('id', candidate.id).eq('status', 'queued')
      .select()
    if (!claimed?.[0]) continue
    out.push(await processClipJob(claimed[0]))
  }
  return out
}
