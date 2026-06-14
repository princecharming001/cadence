// lib/media-analysis.js — analyze uploaded library media so Cadence can use it
// TASTEFULLY in auto-generated content. Images get a vision pass (what's in it,
// mood, palette, orientation, and — crucially for carousels — how legible text
// overlaid on it would be). Videos get probed for dimensions/duration, a few
// frames sampled to vision for a scene read, and a thumbnail rendered.
//
// The analysis then drives SELECTION: when a slideshow/clip needs a real photo
// or clip, we pick the asset that best matches the topic, has the right shape,
// reads well under text, is high quality, and hasn't been used recently.
import { spawn } from 'child_process'
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const BUCKET = 'media'

// ── Image vision analysis ────────────────────────────────────────────────────
const IMAGE_SCHEMA = {
  type: 'object',
  required: ['scene', 'labels', 'subject', 'mood', 'orientation', 'text_overlay_score', 'quality'],
  properties: {
    scene: { type: 'string', description: 'One concrete sentence describing what is in the image.' },
    labels: { type: 'array', items: { type: 'string' }, description: '5-12 lowercase semantic tags (objects, themes, setting) for matching to post topics.' },
    subject: { type: 'string', enum: ['lifestyle', 'product', 'person', 'place', 'food', 'nature', 'screenshot', 'graphic', 'abstract', 'other'] },
    people: { type: 'integer', description: 'Number of clearly visible people (0 if none).' },
    mood: { type: 'string', enum: ['calm', 'energetic', 'professional', 'playful', 'moody', 'bright', 'minimal', 'warm', 'bold'] },
    palette: { type: 'array', items: { type: 'string' }, description: '2-4 dominant colors as hex.' },
    orientation: { type: 'string', enum: ['portrait', 'landscape', 'square'] },
    text_overlay_score: { type: 'number', description: '0-1: how well bold text overlaid on this image would READ — high when there is calm negative space and good contrast, low when busy/cluttered.' },
    text_safe_area: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'center', 'none'], description: 'Where overlaid text would be most legible.' },
    quality: { type: 'number', description: '0-1 overall aesthetic + technical quality (sharp, well-lit, well-composed).' },
    has_text: { type: 'boolean', description: 'Does the image already contain prominent text?' },
    caption: { type: 'string', description: 'A short, natural caption this image could carry.' },
    best_uses: { type: 'array', items: { type: 'string' }, description: 'e.g. "carousel background", "cover slide", "story", "product highlight".' },
    avoid: { type: 'boolean', description: 'true if this image is low quality, NSFW, or otherwise should NOT be auto-used.' },
  },
}

async function visionAnalyze(images, instruction, schema, toolName) {
  const content = images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }))
  content.push({ type: 'text', text: instruction })
  const r = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1024,
    tools: [{ name: toolName, description: 'Emit the structured analysis.', input_schema: schema }],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content }],
  })
  return r.content.find(b => b.type === 'tool_use')?.input || {}
}

async function fetchB64(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return { buf, b64: buf.toString('base64') }
}

export async function analyzeImage(asset) {
  const mime = asset.mime && asset.mime.startsWith('image/') ? asset.mime : 'image/jpeg'
  const { b64 } = await fetchB64(asset.url)
  const a = await visionAnalyze(
    [{ mime, b64 }],
    'Analyze this image for use as a VISUAL in auto-generated social carousels and posts. Judge honestly how well bold text would read over it (text_overlay_score) and its quality. Output the analysis.',
    IMAGE_SCHEMA, 'describe_image')
  // Trust real pixel dimensions for orientation when we have them.
  if (asset.width && asset.height) a.orientation = asset.width > asset.height * 1.15 ? 'landscape' : asset.height > asset.width * 1.15 ? 'portrait' : 'square'
  return a
}

// ── Video analysis (ffprobe + frame sampling + thumbnail) ────────────────────
function run(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let out = '', err = ''
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timeout`)) }, timeoutMs)
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d))
    p.on('error', reject)
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`${cmd} ${code}: ${err.slice(-200)}`)) })
  })
}

const VIDEO_SCHEMA = {
  type: 'object',
  required: ['scene', 'labels', 'subject', 'mood', 'quality'],
  properties: {
    scene: { type: 'string', description: 'One sentence describing the video content from these frames.' },
    labels: { type: 'array', items: { type: 'string' }, description: '5-12 lowercase tags for topic matching.' },
    subject: { type: 'string', enum: ['talking_head', 'b_roll', 'tutorial', 'product_demo', 'lifestyle', 'event', 'other'] },
    mood: { type: 'string', enum: ['calm', 'energetic', 'professional', 'playful', 'moody', 'bright', 'minimal', 'warm', 'bold'] },
    quality: { type: 'number', description: '0-1 visual quality (lighting, framing, sharpness).' },
    has_speech: { type: 'boolean', description: 'Does someone appear to be speaking to camera?' },
    best_uses: { type: 'array', items: { type: 'string' }, description: 'e.g. "reel", "clip source", "story".' },
    avoid: { type: 'boolean' },
  },
}

export async function analyzeVideo(asset) {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-'))
  try {
    const src = path.join(dir, 'in')
    const { buf } = await fetchB64(asset.url)
    await writeFile(src, buf)

    // Probe dimensions + duration.
    let width = asset.width, height = asset.height, duration = asset.duration_sec
    try {
      const probe = JSON.parse(await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', src]))
      const v = (probe.streams || []).find(s => s.codec_type === 'video')
      if (v) { width = v.width; height = v.height }
      duration = Number(probe.format?.duration) || duration
    } catch {}

    // Sample up to 3 frames across the clip → one vision read.
    const dur = Math.max(Number(duration) || 6, 1)
    const stamps = [dur * 0.15, dur * 0.5, dur * 0.85]
    const frames = []
    for (let i = 0; i < stamps.length; i++) {
      const f = path.join(dir, `f${i}.jpg`)
      try {
        await run('ffmpeg', ['-ss', String(stamps[i].toFixed(2)), '-i', src, '-frames:v', '1', '-vf', 'scale=512:-1', '-q:v', '4', '-y', f], { timeoutMs: 60000 })
        frames.push({ mime: 'image/jpeg', b64: (await readFile(f)).toString('base64') })
      } catch {}
    }

    // Thumbnail (mid frame) → store for the library grid.
    let thumb_url = asset.thumb_url
    try {
      const tf = path.join(dir, 'thumb.jpg')
      await run('ffmpeg', ['-ss', String((dur * 0.5).toFixed(2)), '-i', src, '-frames:v', '1', '-vf', 'scale=640:-1', '-q:v', '3', '-y', tf], { timeoutMs: 60000 })
      const tpath = `${asset.user_id}/thumbs/${asset.id}.jpg`
      const { error } = await admin.storage.from(BUCKET).upload(tpath, await readFile(tf), { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
      if (!error) thumb_url = admin.storage.from(BUCKET).getPublicUrl(tpath).data.publicUrl
    } catch {}

    let analysis = { scene: asset.filename || 'video', labels: [], subject: 'other', mood: 'calm', quality: 0.5 }
    if (frames.length) {
      try { analysis = await visionAnalyze(frames, 'These are sampled frames from a short video the user wants to reuse in auto-generated reels/clips. Describe the video and judge its quality. Output the analysis.', VIDEO_SCHEMA, 'describe_video') } catch {}
    }
    analysis.orientation = width && height ? (width > height * 1.15 ? 'landscape' : height > width * 1.15 ? 'portrait' : 'square') : 'portrait'
    return { analysis, width, height, duration_sec: duration, thumb_url }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ── Process pipeline: claim 'analyzing' assets and run analysis ──────────────
export async function processOneAsset(asset) {
  try {
    if (asset.type === 'image') {
      const analysis = await analyzeImage(asset)
      await admin.from('media_assets').update({ analysis, status: 'ready' }).eq('id', asset.id)
    } else {
      const { analysis, width, height, duration_sec, thumb_url } = await analyzeVideo(asset)
      await admin.from('media_assets').update({ analysis, width, height, duration_sec, thumb_url, status: 'ready' }).eq('id', asset.id)
    }
    return { id: asset.id, ok: true }
  } catch (e) {
    await admin.from('media_assets').update({ status: 'failed', error: String(e.message || '').slice(0, 200) }).eq('id', asset.id)
    return { id: asset.id, error: e.message }
  }
}

// Cron/worker sweep: process queued analyses (images are usually done inline at
// upload; this catches videos + retries).
export async function processQueuedMedia(max = 3) {
  const stale = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: due } = await admin.from('media_assets').select('*')
    .or(`status.eq.analyzing,and(status.eq.processing,created_at.lt.${stale})`)
    .order('created_at', { ascending: true }).limit(max)
  const out = []
  for (const a of due || []) {
    // CAS claim so overlapping ticks don't double-process.
    const { data: claimed } = await admin.from('media_assets').update({ status: 'processing' }).eq('id', a.id).eq('status', a.status).select('id').single()
    if (!claimed) continue
    out.push(await processOneAsset(a))
  }
  return { processed: out.length, out }
}

// ── TASTEFUL SELECTION — pick the best assets for a topic ────────────────────
// Heuristic (no extra LLM call): relevance (topic ∩ labels/scene) + the asset's
// own text-overlay suitability + quality, lightly penalized by recent use so the
// same photo doesn't show up in every post. Returns the top `n` urls.
function tokenize(s) { return String(s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [] }
function scoreAsset(asset, topicTokens, { wantOrientation } = {}) {
  const a = asset.analysis || {}
  if (a.avoid) return -1
  const hay = new Set([...(a.labels || []), ...tokenize(a.scene), ...tokenize(asset.filename)].map(s => String(s).toLowerCase()))
  let rel = 0
  for (const t of topicTokens) if (hay.has(t)) rel += 1
  rel = topicTokens.length ? rel / topicTokens.length : 0
  const quality = Number(a.quality) || 0.5
  const overlay = Number(a.text_overlay_score) || 0.5
  let s = rel * 2 + quality * 0.6 + overlay * 0.8
  if (wantOrientation && a.orientation && a.orientation !== wantOrientation) s -= 0.6 // wrong shape reads badly
  s -= Math.min((asset.used_count || 0) * 0.15, 0.6)                                  // freshness
  return s
}

export async function selectAssets(userId, { albumIds, type = 'image', topic = '', n = 1, orientation } = {}) {
  let q = admin.from('media_assets').select('*').eq('user_id', userId).eq('type', type).eq('status', 'ready')
  if (Array.isArray(albumIds) && albumIds.length) q = q.in('album_id', albumIds)
  const { data: assets } = await q
  if (!assets?.length) return []
  const topicTokens = [...new Set(tokenize(topic))]
  const ranked = assets
    .map(a => ({ a, s: scoreAsset(a, topicTokens, { wantOrientation: orientation }) }))
    .filter(x => x.s >= 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map(x => x.a)
  // Mark used so the next call rotates to fresher assets.
  if (ranked.length) {
    const now = new Date().toISOString()
    await Promise.all(ranked.map(a => admin.from('media_assets').update({ used_count: (a.used_count || 0) + 1, last_used_at: now }).eq('id', a.id)))
  }
  return ranked
}
