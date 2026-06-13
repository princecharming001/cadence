// lib/slideshow.js — AI Instagram carousel ("slideshow") generation.
//
// Two halves, both provider-agnostic (they don't care how the post is published):
//   1. outlineSlideshow(): Claude turns a topic + format into structured slide
//      copy (a cover hook, content slides, a CTA) plus an IG caption.
//   2. renderSlideElement(): a Satori/next/og layout for one slide in a chosen
//      visual STYLE. Template styles draw clean typographic slides; the "photo"
//      style lays text over an AI-generated background image.
// generateSlideshow() ties them together: outline -> render every slide to PNG
// -> upload to the public `slideshows` bucket -> return image URLs + caption.
import { createElement as h } from 'react'
import { readFile } from 'fs/promises'
import path from 'path'
import { ImageResponse } from 'next/og'
import { admin } from './supabase'
import { generateJson } from './llm'
import { generateImage } from './images'

const BUCKET = 'slideshows'
const W = 1080, H = 1350 // Instagram 4:5 portrait — the best carousel ratio

// Real typography (bundled TTFs in assets/fonts) — the single biggest upgrade
// over the default Satori font. Cached per process.
const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts')
let FONT_CACHE = null
async function loadFonts() {
  if (FONT_CACHE) return FONT_CACHE
  const entries = [
    ['Anton', 'Anton.ttf', 400, 'normal'],
    ['Inter', 'Inter-Regular.ttf', 400, 'normal'],
    ['Inter', 'Inter-SemiBold.ttf', 600, 'normal'],
    ['Inter', 'Inter-ExtraBold.ttf', 800, 'normal'],
    ['Playfair Display', 'PlayfairDisplay-Bold.ttf', 700, 'normal'],
    ['Playfair Display', 'PlayfairDisplay-Italic.ttf', 500, 'italic'],
  ]
  const fonts = []
  for (const [name, file, weight, style] of entries) {
    const data = await readFile(path.join(FONTS_DIR, file)).catch(() => null)
    if (data) fonts.push({ name, data, weight, style })
  }
  FONT_CACHE = fonts
  return fonts
}

// ── Formats: how the slides are STRUCTURED ───────────────────────────────────
export const SLIDESHOW_FORMATS = [
  { key: 'listicle',  label: 'Listicle',      hint: 'A numbered list of sharp, standalone tips. Cover promises the list; each slide is one tip with a short payoff.' },
  { key: 'howto',     label: 'How-to steps',  hint: 'A step-by-step walkthrough. Cover states the outcome; each slide is one ordered step.' },
  { key: 'story',     label: 'Story arc',     hint: 'A narrative: hook, tension, turn, lesson. Cover is the hook; slides build the story; last is the takeaway.' },
  { key: 'myths',     label: 'Myth vs fact',  hint: 'Bust misconceptions. Cover names the topic; each slide pairs a myth with the fact.' },
  { key: 'framework', label: 'Framework',     hint: 'Teach a named mental model in parts. Cover names the framework; each slide is one component.' },
  { key: 'quotes',    label: 'Quote cards',   hint: 'A set of punchy, quotable lines on the theme. Cover sets the theme; each slide is one quote.' },
]

// ── Visual styles: how the slides LOOK ───────────────────────────────────────
// `ai` styles need an AI-generated background image per slide (slower/costlier);
// the rest are pure typographic templates (instant, crisp text).
// `display`: which font family carries the headings (Anton = loud condensed
// caps, Playfair = literary serif, Inter = clean neo-grotesque).
export const SLIDE_STYLES = {
  bold:      { label: 'Bold',      ai: false, bg: '#0B0B0E', fg: '#FFFFFF', accent: '#FFD24A', muted: '#6E7180', display: 'anton' },
  minimal:   { label: 'Minimal',   ai: false, bg: '#FAFAF8', fg: '#16161A', accent: '#1D4ED8', muted: '#9CA3AF', display: 'inter' },
  editorial: { label: 'Editorial', ai: false, bg: '#F7F1E5', fg: '#221C14', accent: '#B4540A', muted: '#8A7E6C', display: 'playfair' },
  gradient:  { label: 'Gradient',  ai: false, bg: 'linear-gradient(160deg,#170F3D 0%,#4F2ED0 58%,#7C3AED 100%)', fg: '#FFFFFF', accent: '#FFC53D', muted: '#B9B0E8', display: 'anton' },
  mint:      { label: 'Mint',      ai: false, bg: '#07261D', fg: '#ECFDF3', accent: '#4ADE80', muted: '#5E8C7B', display: 'anton' },
  photo:     { label: 'AI photo',  ai: true,  bg: '#0B0B0E', fg: '#FFFFFF', accent: '#FFD24A', muted: '#C9CBD4', display: 'anton' },
}

const DISPLAY = {
  anton:    { family: 'Anton',              weight: 400, caps: true,  cover: 124, head: 88, track: 0 },
  inter:    { family: 'Inter',              weight: 800, caps: false, cover: 100, head: 70, track: -2.5 },
  playfair: { family: 'Playfair Display',   weight: 700, caps: false, cover: 96,  head: 66, track: -1 },
}

// Build the React element for one slide (Satori-friendly: flexbox + inline styles only).
export function renderSlideElement(styleKey, slide) {
  const s = SLIDE_STYLES[styleKey] || SLIDE_STYLES.bold
  const d = DISPLAY[s.display] || DISPLAY.anton
  const isCover = slide.kind === 'cover'
  const isCta = slide.kind === 'cta'
  const isQuote = slide.format === 'quotes' && !isCover && !isCta
  const idx = slide.index ?? 0, total = slide.total || 1
  const handle = slide.handle ? `@${String(slide.handle).replace(/^@/, '')}` : ''
  const headText = d.caps ? String(slide.heading || '').toUpperCase() : (slide.heading || '')

  const rootStyle = {
    display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
    padding: 96, justifyContent: 'space-between', position: 'relative',
    fontFamily: 'Inter', color: s.fg,
    ...(s.bg.startsWith('linear-gradient') ? { backgroundImage: s.bg } : { backgroundColor: s.bg }),
    ...(slide.bg ? { backgroundImage: `url(${slide.bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
  }

  const children = []
  // Photo legibility: bottom-weighted scrim reads better than a flat wash.
  if (slide.bg) {
    children.push(h('div', { key: 'scrim', style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', backgroundImage: 'linear-gradient(180deg, rgba(8,9,13,0.38) 0%, rgba(8,9,13,0.45) 45%, rgba(8,9,13,0.82) 100%)' } }))
  }

  // Top row: handle chip (left) + progress dots (right).
  const dots = Array.from({ length: Math.min(total, 10) }, (_, i) =>
    h('div', { key: i, style: { display: 'flex', width: i === idx ? 30 : 11, height: 11, borderRadius: 999, backgroundColor: i === idx ? s.accent : s.muted, opacity: i === idx ? 1 : 0.38 } }))
  children.push(h('div', { key: 'top', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    h('div', { style: { display: 'flex', fontSize: 26, color: s.muted, fontWeight: 600, letterSpacing: 1 } }, handle),
    h('div', { style: { display: 'flex', gap: 9, alignItems: 'center' } }, ...dots),
  ))

  // Middle column.
  const mid = []
  if (isCover) {
    mid.push(h('div', { key: 'kicker', style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 40 } },
      h('div', { style: { display: 'flex', width: 54, height: 6, backgroundColor: s.accent, borderRadius: 4 } }),
      h('div', { style: { display: 'flex', fontSize: 27, fontWeight: 600, color: s.accent, letterSpacing: 5 } }, 'SWIPE'),
    ))
  } else if (isQuote) {
    mid.push(h('div', { key: 'q', style: { display: 'flex', fontSize: 170, lineHeight: 0.6, color: s.accent, fontFamily: d.family, fontWeight: d.weight, marginBottom: 8 } }, '“'))
  } else if (!isCta) {
    // Index badge grounds each content slide (works for every format).
    mid.push(h('div', { key: 'n', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 86, height: 86, borderRadius: 999, border: `5px solid ${s.accent}`, color: s.accent, fontSize: 42, fontWeight: 800, marginBottom: 42, fontFamily: 'Inter' } }, String(idx).padStart(2, '0')))
  }
  mid.push(h('div', { key: 'head', style: { display: 'flex', fontSize: isCover ? d.cover : d.head, fontFamily: d.family, fontWeight: d.weight, lineHeight: d.family === 'Anton' ? 1.04 : 1.08, letterSpacing: d.track, maxWidth: 888, ...(isCta ? { textAlign: 'center', justifyContent: 'center' } : {}) } }, headText))
  if (slide.body) {
    mid.push(h('div', { key: 'body', style: { display: 'flex', fontSize: 38, lineHeight: 1.45, color: isCover || isCta ? s.muted : s.fg, opacity: isCover || isCta ? 1 : 0.86, marginTop: 36, maxWidth: 820, fontWeight: 400, ...(isCta ? { textAlign: 'center', justifyContent: 'center' } : {}) } }, slide.body))
  }
  if (isCta) {
    mid.push(h('div', { key: 'pill', style: { display: 'flex', alignSelf: 'center', marginTop: 56, backgroundColor: s.accent, color: s.bg.startsWith('linear') ? '#1A1233' : s.bg, fontSize: 34, fontWeight: 800, padding: '24px 52px', borderRadius: 999 } }, handle ? `Follow ${handle}` : 'Save + follow'))
  }
  children.push(h('div', { key: 'mid', style: { display: 'flex', flexDirection: 'column', alignItems: isCta ? 'center' : 'flex-start', justifyContent: 'center', flex: 1 } }, ...mid))

  // Bottom row: quiet wordcount-free footer — swipe cue everywhere but the CTA.
  children.push(h('div', { key: 'bot', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' } },
    h('div', { style: { display: 'flex', fontSize: 26, color: s.muted, fontWeight: 600 } }, isCta ? (handle || '') : ''),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 30, color: s.accent, fontWeight: 800 } }, isCta ? '' : 'Swipe →'),
  ))

  return h('div', { style: rootStyle }, ...children)
}

// Render one slide to a PNG Buffer (with the bundled font set).
async function renderSlidePng(styleKey, slide) {
  const img = new ImageResponse(renderSlideElement(styleKey, slide), { width: W, height: H, fonts: await loadFonts() })
  return Buffer.from(await img.arrayBuffer())
}

// ── AI: topic + format -> structured slide copy ──────────────────────────────
export async function outlineSlideshow({ topic, format = 'listicle', slides = 6, persona, handle }) {
  const fmt = SLIDESHOW_FORMATS.find(f => f.key === format) || SLIDESHOW_FORMATS[0]
  const voice = persona
    ? `Write in this person's voice — tone: ${persona.tone}; topics: ${(persona.topics || []).join(', ')}; style: ${(persona.style_rules || []).join(' | ')}.`
    : 'Write in a confident, modern, human voice.'
  const n = Math.min(Math.max(Number(slides) || 6, 3), 10)

  // Forced tool-use (lib/llm.js) — no markdown-fence parsing, no truncated-JSON
  // failures surfacing to the user as "Could not generate slides".
  const data = await generateJson({
    system: `You design high-performing Instagram CAROUSEL slideshows. Format = ${fmt.label}: ${fmt.hint}

${voice}

Rules:
- Exactly ${n} slides. Slide 1 is the COVER (a scroll-stopping hook, <=8 words heading, optional <=12 word subhead). The LAST slide is a CTA. The middle slides carry the value.
- Headings are punchy and concrete. Bodies are short (carousels are skimmed): <=20 words.
- No hashtags inside slides. No emojis in headings.
- Also write an Instagram CAPTION (2-4 sentences, natural, with a soft CTA) and 5-8 relevant hashtags.`,
    user: `TOPIC: ${topic}\n\nDesign the ${n}-slide ${fmt.label} carousel.`,
    schema: {
      type: 'object',
      required: ['slides', 'caption'],
      properties: {
        slides: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['cover', 'content', 'cta'] }, heading: { type: 'string' }, body: { type: 'string' } }, required: ['heading'] } },
        caption: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
      },
    },
    maxTokens: 1500, toolName: 'emit_carousel',
  }).catch(() => ({}))
  let arr = Array.isArray(data.slides) ? data.slides : []
  if (!arr.length) throw new Error('Could not generate slides')
  // Normalize kinds: first=cover, last=cta.
  arr = arr.slice(0, n).map((s, i) => ({
    kind: i === 0 ? 'cover' : i === arr.length - 1 ? 'cta' : 'content',
    heading: String(s.heading || '').trim(),
    body: String(s.body || '').trim(),
  }))
  const caption = [String(data.caption || '').trim(), (data.hashtags || []).map(t => (t.startsWith('#') ? t : `#${t}`)).join(' ')].filter(Boolean).join('\n\n')
  return { slides: arr, caption, handle: handle || '' }
}

// ── Full pipeline: outline -> render -> upload -> URLs ────────────────────────
export async function generateSlideshow({ topic, format, style = 'bold', slides = 6, persona, handle, userId }) {
  const styleDef = SLIDE_STYLES[style] || SLIDE_STYLES.bold
  const outline = await outlineSlideshow({ topic, format, slides, persona, handle })
  const total = outline.slides.length

  // For the AI-photo style, generate one background per slide from its heading.
  // Portrait (3:4) fills the 4:5 slide canvas, and ONE seed per deck keeps the
  // whole carousel looking like a single shoot instead of six random images.
  const deckSeed = Math.abs(hash(topic)) % 1000000
  const backgrounds = styleDef.ai
    ? await Promise.all(outline.slides.map(async sl => {
        try { return (await generateImage(`${topic} — ${sl.heading}`, { fromContent: false, portrait: true, seed: deckSeed })).url } catch { return null }
      }))
    : outline.slides.map(() => null)

  const stamp = `${Date.now().toString(36)}-${Math.abs(hash(topic)).toString(36)}`
  const urls = []
  for (let i = 0; i < total; i++) {
    const slide = { ...outline.slides[i], index: i, total, handle: outline.handle, bg: backgrounds[i], format }
    const png = await renderSlidePng(style, slide)
    const path = userId ? `${userId}/${stamp}/${i}.png` : `${stamp}/${i}.png`
    const { error } = await admin.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true, cacheControl: '31536000' })
    if (error) throw new Error(`slide upload failed: ${error.message}`)
    urls.push(admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
  }

  // Return slides enriched with their background URL + handle so a later text
  // EDIT can re-render any single slide identically (the photo style keeps its
  // image instead of regenerating a new one).
  const enriched = outline.slides.map((sl, i) => ({ ...sl, bg: backgrounds[i] || null }))
  return { slides: enriched, caption: outline.caption, style, format, handle: outline.handle, imageUrls: urls }
}

// Re-render ONE edited slide and upload it to a fresh path (the slides bucket
// caches for a year, so an in-place upsert would serve the stale image). Pure
// Satori — no LLM, no image-gen (the photo style reuses the slide's stored bg).
// Returns the new public URL. Used by /api/slideshow/render-slide when the user
// edits a slide's heading/body in the carousel editor.
export async function renderSlideToUrl({ style = 'bold', format, handle, slide, index = 0, total = 1, userId }) {
  const full = { ...slide, index, total, handle: handle || slide.handle || '', format: format || slide.format }
  const png = await renderSlidePng(style, full)
  const stamp = `${Date.now().toString(36)}-${Math.abs(hash(String(slide.heading) + index + Math.random())).toString(36)}`
  const dest = userId ? `${userId}/edits/${stamp}-${index}.png` : `edits/${stamp}-${index}.png`
  const { error } = await admin.storage.from(BUCKET).upload(dest, png, { contentType: 'image/png', upsert: true, cacheControl: '31536000' })
  if (error) throw new Error(`slide render failed: ${error.message}`)
  return admin.storage.from(BUCKET).getPublicUrl(dest).data.publicUrl
}

function hash(str) { let h = 0; for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return h }
