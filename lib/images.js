// lib/images.js — AI image generation for posts (pluggable provider).
//
// Priority: real AI provider if a key is configured, else a reliable seeded
// fallback image so the whole pipeline (draft → image → X media post) always works.
//
// To enable REAL prompt-driven AI images, add ONE of these to .env.local:
//   OPENAI_API_KEY=...     (DALL·E / gpt-image-1)
//   FAL_KEY=...            (fal.ai Flux — also supports reference photos for
//                           personal/face-consistent images via image-to-image)
// Until a key is set, posts get a tasteful seeded placeholder (flagged
// `placeholder: true`).
import Anthropic from '@anthropic-ai/sdk'

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

function hashSeed(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h) % 100000
}

// Turn a tweet (or rough idea) into a vivid, concrete visual prompt. This is what
// makes the "include image" toggle produce something APPROPRIATE to the post
// rather than a literal screenshot of the text.
export async function describeImage(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'abstract gradient, modern, minimal, editorial'
  if (!anthropic) return clean.slice(0, 320)
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 160,
      system: 'You write image-generation prompts. Given a social post, output ONE vivid, concrete visual prompt (subject, setting, style, mood, lighting, color) that would make a scroll-stopping companion image. No text/words in the image. Output ONLY the prompt, no preamble, under 60 words.',
      messages: [{ role: 'user', content: clean.slice(0, 600) }],
    })
    const out = (res.content.find(b => b.type === 'text')?.text || '').trim()
    return out || clean.slice(0, 320)
  } catch {
    return clean.slice(0, 320)
  }
}

// Generate an image.
//   prompt           — a visual description OR raw post text
//   opts.seed        — vary the result
//   opts.fromContent — true if `prompt` is raw post text that should be turned
//                      into a proper visual prompt first
//   opts.referenceImages — array of image URLs (e.g. the user's selfies) to keep
//                      the person consistent (fal image-to-image only)
export async function generateImage(prompt, opts = {}) {
  // Back-compat: generateImage(prompt, seedNumber)
  if (typeof opts === 'number') opts = { seed: opts }
  const { seed, fromContent = false, referenceImages = [] } = opts

  let clean = (prompt || 'abstract gradient, modern, minimal').replace(/\s+/g, ' ').trim()
  if (fromContent) clean = await describeImage(prompt)
  clean = clean.slice(0, 320)
  const s = seed != null ? seed : hashSeed(clean)
  const ref = (referenceImages || []).filter(Boolean)

  // 0) Higgsfield Soul — high-aesthetic photographic generation, the primary
  //    provider. opts.portrait=true returns 3:4 (carousel slides); a stable
  //    seed gives a whole deck one coherent look. Async API: submit, then poll.
  //    (Reference-photo requests skip to fal's image-to-image below.)
  if (process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET && !ref.length) {
    try {
      const auth = `Key ${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_API_SECRET}`
      // Body shape verified against the live API (the SDK README's enums are
      // wrong for raw REST): params wrapper, raw dimensions, 1080p, numeric batch.
      const r = await fetch('https://platform.higgsfield.ai/v1/text2image/soul', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          params: {
            prompt: clean,
            width_and_height: opts.portrait ? '1536x2048' : '1536x1536',
            quality: '1080p', batch_size: 1, seed: Math.abs(s) % 1000000,
          },
        }),
      })
      if (r.ok) {
        const sub = await r.json()
        const reqId = sub.request_id || sub.id || sub.jobs?.[0]?.request_id || sub.jobs?.[0]?.id
        if (reqId) {
          for (let i = 0; i < 45; i++) { // ~90s budget
            await new Promise(res => setTimeout(res, 2000))
            const p = await fetch(`https://platform.higgsfield.ai/requests/${reqId}/status`, { headers: { Authorization: auth } })
            if (!p.ok) break
            const d = await p.json()
            if (d.status === 'completed') {
              const url = d.images?.[0]?.url || d.jobs?.[0]?.results?.raw?.url
              if (url) return { url, prompt: clean, provider: 'higgsfield' }
              break
            }
            if (d.status === 'failed' || d.status === 'nsfw') break
          }
        }
      } else { console.error('[images] higgsfield submit failed:', r.status, (await r.text()).slice(0, 200)) }
    } catch (e) { console.error('[images] higgsfield failed:', e.message) }
  }

  // 1) OpenAI images (real, prompt-driven)
  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: clean, size: '1024x1024', n: 1 }),
      })
      if (r.ok) {
        const d = await r.json()
        const url = d.data?.[0]?.url
        const b64 = d.data?.[0]?.b64_json
        if (url) return { url, prompt: clean, provider: 'openai' }
        if (b64) return { url: `data:image/png;base64,${b64}`, prompt: clean, provider: 'openai' }
      }
    } catch (e) { console.error('[images] openai failed:', e.message) }
  }

  // 2) fal.ai Flux (real, prompt-driven). When reference photos are supplied,
  //    use the image-to-image endpoint so the user's likeness carries through.
  if (process.env.FAL_KEY) {
    try {
      const useRef = ref.length > 0
      const endpoint = useRef ? 'https://fal.run/fal-ai/flux/dev/image-to-image' : 'https://fal.run/fal-ai/flux/schnell'
      const body = useRef
        ? { prompt: clean, image_url: ref[0], strength: 0.65, image_size: 'square_hd', num_images: 1 }
        : { prompt: clean, image_size: 'square_hd', num_images: 1 }
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        const d = await r.json()
        const url = d.images?.[0]?.url
        if (url) return { url, prompt: clean, provider: 'fal', personal: useRef }
      }
    } catch (e) { console.error('[images] fal failed:', e.message) }
  }

  // 3) Fallback — a reliable seeded raster image so the pipeline always works.
  return { url: `https://picsum.photos/seed/${s}/1024/1024`, prompt: clean, provider: 'placeholder', placeholder: true }
}
