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
import { ImageResponse } from 'next/og'
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'
import { generateImage } from './images'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const BUCKET = 'slideshows'
const W = 1080, H = 1350 // Instagram 4:5 portrait — the best carousel ratio

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
export const SLIDE_STYLES = {
  bold:      { label: 'Bold',      ai: false, bg: '#0E0F13', fg: '#FFFFFF', accent: '#FFD24A', muted: '#8A8F9C', font: 800, align: 'flex-start' },
  minimal:   { label: 'Minimal',   ai: false, bg: '#FFFFFF', fg: '#111113', accent: '#2D6CF6', muted: '#9AA1AD', font: 700, align: 'flex-start' },
  editorial: { label: 'Editorial', ai: false, bg: '#FBF7EF', fg: '#1A1714', accent: '#C2740A', muted: '#9B8E7C', font: 700, align: 'flex-start', serif: true },
  gradient:  { label: 'Gradient',  ai: false, bg: 'linear-gradient(135deg,#6D3BD0,#2D6CF6)', fg: '#FFFFFF', accent: '#FFE08A', muted: '#D9D6F5', font: 800, align: 'flex-start' },
  mint:      { label: 'Mint',      ai: false, bg: '#0B3D2E', fg: '#EAFBF2', accent: '#5FE3A1', muted: '#7FB6A0', font: 800, align: 'flex-start' },
  photo:     { label: 'AI photo',  ai: true,  bg: '#0E0F13', fg: '#FFFFFF', accent: '#FFD24A', muted: '#D6D6D6', font: 800, align: 'flex-start' },
}

const fam = s => (s.serif ? 'Georgia, "Times New Roman", serif' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif')

// Build the React element for one slide (Satori-friendly: flexbox + inline styles only).
export function renderSlideElement(styleKey, slide) {
  const s = SLIDE_STYLES[styleKey] || SLIDE_STYLES.bold
  const isCover = slide.kind === 'cover'
  const isCta = slide.kind === 'cta'
  const num = `${(slide.index ?? 0) + 1} / ${slide.total || 1}`

  // Background: AI photo style overlays a dark scrim on the supplied bg image.
  const rootStyle = {
    display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
    padding: 90, justifyContent: 'space-between', position: 'relative',
    fontFamily: fam(s), color: s.fg,
    ...(s.bg.startsWith('linear-gradient') ? { backgroundImage: s.bg } : { backgroundColor: s.bg }),
    ...(slide.bg ? { backgroundImage: `url(${slide.bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
  }

  const children = []
  // Scrim for photo legibility.
  if (slide.bg) {
    children.push(h('div', { key: 'scrim', style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', backgroundColor: 'rgba(8,9,13,0.55)' } }))
  }

  // Top row: page number + handle.
  children.push(h('div', { key: 'top', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 30, color: s.muted, fontWeight: 600 } },
    h('div', { style: { display: 'flex' } }, num),
    slide.handle ? h('div', { style: { display: 'flex' } }, `@${String(slide.handle).replace(/^@/, '')}`) : h('div', { style: { display: 'flex' } }, ''),
  ))

  // Middle: heading (+ body). Cover gets the biggest type.
  const headSize = isCover ? 104 : 76
  const mid = [
    h('div', { key: 'accent', style: { display: 'flex', width: 90, height: 10, backgroundColor: s.accent, borderRadius: 6, marginBottom: 34 } }),
    h('div', { key: 'head', style: { display: 'flex', fontSize: headSize, fontWeight: s.font, lineHeight: 1.04, letterSpacing: -1, maxWidth: 880 } }, slide.heading || ''),
  ]
  if (slide.body) {
    mid.push(h('div', { key: 'body', style: { display: 'flex', fontSize: 40, lineHeight: 1.3, color: isCover ? s.muted : s.fg, marginTop: 34, maxWidth: 840, fontWeight: 400 } }, slide.body))
  }
  children.push(h('div', { key: 'mid', style: { display: 'flex', flexDirection: 'column', alignItems: s.align, justifyContent: 'center', flex: 1 } }, ...mid))

  // Bottom: CTA arrow on non-final slides, a label on the CTA slide.
  children.push(h('div', { key: 'bot', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 34, color: s.accent, fontWeight: 700 } },
    h('div', { style: { display: 'flex' } }, isCta ? 'Save + follow for more' : ''),
    h('div', { style: { display: 'flex' } }, isCta ? '' : 'Swipe →'),
  ))

  return h('div', { style: rootStyle }, ...children)
}

// Render one slide to a PNG Buffer.
async function renderSlidePng(styleKey, slide) {
  const img = new ImageResponse(renderSlideElement(styleKey, slide), { width: W, height: H })
  return Buffer.from(await img.arrayBuffer())
}

// ── AI: topic + format -> structured slide copy ──────────────────────────────
export async function outlineSlideshow({ topic, format = 'listicle', slides = 6, persona, handle }) {
  const fmt = SLIDESHOW_FORMATS.find(f => f.key === format) || SLIDESHOW_FORMATS[0]
  const voice = persona
    ? `Write in this person's voice — tone: ${persona.tone}; topics: ${(persona.topics || []).join(', ')}; style: ${(persona.style_rules || []).join(' | ')}.`
    : 'Write in a confident, modern, human voice.'
  const n = Math.min(Math.max(Number(slides) || 6, 3), 10)

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: `You design high-performing Instagram CAROUSEL slideshows. Format = ${fmt.label}: ${fmt.hint}

${voice}

Rules:
- Exactly ${n} slides. Slide 1 is the COVER (a scroll-stopping hook, <=8 words heading, optional <=12 word subhead). The LAST slide is a CTA. The middle slides carry the value.
- Headings are punchy and concrete. Bodies are short (carousels are skimmed): <=20 words.
- No hashtags inside slides. No emojis in headings.
- Also write an Instagram CAPTION (2-4 sentences, natural, with a soft CTA) and 5-8 relevant hashtags.

Respond with ONLY this JSON:
{"slides":[{"kind":"cover|content|cta","heading":"...","body":"..."}],"caption":"...","hashtags":["...","..."]}`,
    messages: [{ role: 'user', content: `TOPIC: ${topic}\n\nDesign the ${n}-slide ${fmt.label} carousel.` }],
  })

  const txt = res.content.find(b => b.type === 'text')?.text || '{}'
  let data
  try { data = JSON.parse(txt.replace(/^```json\s*|\s*```$/g, '').trim()) } catch { data = {} }
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
    const slide = { ...outline.slides[i], index: i, total, handle: outline.handle, bg: backgrounds[i] }
    const png = await renderSlidePng(style, slide)
    const path = userId ? `${userId}/${stamp}/${i}.png` : `${stamp}/${i}.png`
    const { error } = await admin.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true })
    if (error) throw new Error(`slide upload failed: ${error.message}`)
    urls.push(admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
  }

  return { slides: outline.slides, caption: outline.caption, style, format, imageUrls: urls }
}

function hash(str) { let h = 0; for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return h }
