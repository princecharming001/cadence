// lib/video-gen.js — the AI-video provider abstraction. Higgsfield is the
// primary (its keys are already in .env.local and the auth/poll pattern is
// proven in lib/images.js). Everything is gated behind ENABLE_AI_VIDEO (default
// OFF) so the capability ships dark: when off / unconfigured / out of credits,
// the caller gets a clean { status:'needs_provider' } and the UI degrades to a
// "coming soon" card instead of crashing.
//
// Higgsfield contract (verified against the live API):
//   auth   : Authorization: Key <KEY>:<SECRET>   (NOT Bearer)
//   submit : POST https://platform.higgsfield.ai/v1/<path>  body { params:{...} }
//            -> { id, jobs:[{id,status,results}] }   (request_id is `id`)
//   poll   : GET  /requests/<id>/status -> { status, video?, images?, jobs? }
//            status: queued|in_progress|completed|failed|nsfw|canceled
//   no working text2video model slug exists, so "text -> video" is the chain
//   text2image/soul -> image2video/dop.

const BASE = 'https://platform.higgsfield.ai'
const ON = ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_AI_VIDEO || '').toLowerCase())
const KEYS = () => !!(process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET)
const auth = () => `Key ${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_API_SECRET}`

// 'disabled' (flag off), 'no_keys' (flag on but unconfigured), or 'ready'.
export function videoProviderStatus() {
  if (!ON) return 'disabled'
  if (!KEYS()) return 'no_keys'
  return 'ready'
}
export const videoEnabled = () => videoProviderStatus() === 'ready'

// Submit a Higgsfield job. Returns { reqId } or { error } where error is one of
// 'needs_provider' (capability/model unavailable), 'needs_credits', or a string.
async function submit(path, params) {
  let r
  try {
    r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    })
  } catch (e) { return { error: 'network: ' + String(e.message || e).slice(0, 120) } }
  if (r.status === 404) return { error: 'needs_provider' }      // model/plan not available
  if (r.status === 402) return { error: 'needs_credits' }
  if (!r.ok) {
    const t = (await r.text().catch(() => '')).slice(0, 300)
    if (/credit|insufficient|balance/i.test(t)) return { error: 'needs_credits' }
    if (/not found|no such model/i.test(t)) return { error: 'needs_provider' }
    return { error: `submit ${r.status}: ${t.slice(0, 140)}` }
  }
  const res = await r.json().catch(() => ({}))
  const reqId = res.id || res.request_id || res.jobs?.[0]?.id
  return reqId ? { reqId } : { error: 'no request_id in response' }
}

// Poll a request to completion. Returns { url } or { error }.
async function poll(reqId, budgetMs = 240000) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    await new Promise(res => setTimeout(res, 3000))
    let p
    try { p = await fetch(`${BASE}/requests/${reqId}/status`, { headers: { Authorization: auth() } }) } catch { continue }
    if (!p.ok) continue
    const d = await p.json().catch(() => ({}))
    if (d.status === 'completed') {
      const url = d.video?.url || d.images?.[0]?.url || d.jobs?.[0]?.results?.raw?.url || d.jobs?.[0]?.results?.url
      return url ? { url } : { error: 'completed but no output url' }
    }
    if (d.status === 'failed') return { error: 'provider_failed' }
    if (d.status === 'nsfw') return { error: 'nsfw' }
    if (d.status === 'canceled') return { error: 'canceled' }
  }
  return { error: 'timeout' }
}

// text2image/soul — one still, used as the seed frame for ai_video from a prompt.
async function textToImage(prompt, { portrait = true } = {}) {
  const sub = await submit('/v1/text2image/soul', {
    prompt: String(prompt || '').slice(0, 320),
    width_and_height: portrait ? '1536x2048' : '1536x1536',
    quality: '1080p', batch_size: 1, seed: Math.floor(Math.random() * 1000000),
  })
  if (sub.error) return sub
  return poll(sub.reqId, 120000)
}

// image2video/dop — animate a still with a motion/scene prompt.
async function imageToVideo(imageUrl, prompt) {
  const sub = await submit('/v1/image2video/dop', {
    model: 'dop-turbo',
    prompt: String(prompt || 'gentle cinematic motion, subtle camera move').slice(0, 320),
    input_images: [{ type: 'image_url', image_url: imageUrl }],
    enhance_prompt: true, check_nsfw: true,
  })
  if (sub.error) return sub
  return poll(sub.reqId, 240000)
}

// ── Public API the worker calls ─────────────────────────────────────────────
// Each returns { status:'done', url } | { status:'needs_provider'|'needs_credits'|'error', error? }.

const wrap = (r) => {
  if (r.url) return { status: 'done', url: r.url }
  if (r.error === 'needs_provider') return { status: 'needs_provider' }
  if (r.error === 'needs_credits') return { status: 'needs_provider', detail: 'needs_credits' }
  return { status: 'error', error: r.error || 'unknown' }
}

// ai_video: if an image is supplied, animate it; else text -> image -> video.
export async function generateAiVideo({ prompt, imageUrl }) {
  if (!videoEnabled()) return { status: 'needs_provider' }
  let seed = imageUrl
  if (!seed) {
    const img = await textToImage(prompt, { portrait: true })
    if (img.error) return wrap(img)
    seed = img.url
  }
  return wrap(await imageToVideo(seed, prompt))
}

// ugc: lip-sync a still to a WAV (the worker supplies a hosted .wav).
export async function generateUgcVideo({ imageUrl, audioUrl, prompt, duration = 5 }) {
  if (!videoEnabled()) return { status: 'needs_provider' }
  if (!imageUrl || !audioUrl) return { status: 'error', error: 'ugc needs an image and audio' }
  const sub = await submit('/v1/speak/higgsfield', {
    input_image: { type: 'image_url', image_url: imageUrl },
    input_audio: { type: 'audio_url', audio_url: audioUrl },
    prompt: String(prompt || 'natural, friendly delivery to camera').slice(0, 320),
    quality: 'mid', duration: [5, 10, 15].includes(Number(duration)) ? Number(duration) : 5,
  })
  if (sub.error) return wrap(sub)
  return wrap(await poll(sub.reqId, 300000))
}
