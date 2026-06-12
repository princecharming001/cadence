// lib/clip-cards.js — pixel-real social cards rendered to PNG for clip overlays.
// A drawbox + subtitle approximation never reads as a real screenshot; these are
// laid out like the actual products (X light-mode card anatomy, Reddit post
// header) with the bundled Inter fonts, then ffmpeg overlays the PNG.
import { createElement as h } from 'react'
import { readFile } from 'fs/promises'
import path from 'path'
import { ImageResponse } from 'next/og'

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts')
let FONT_CACHE = null
async function loadFonts() {
  if (FONT_CACHE) return FONT_CACHE
  const entries = [
    ['Inter', 'Inter-Regular.ttf', 400], ['Inter', 'Inter-SemiBold.ttf', 600], ['Inter', 'Inter-ExtraBold.ttf', 800],
  ]
  const fonts = []
  for (const [name, file, weight] of entries) {
    const data = await readFile(path.join(FONTS_DIR, file)).catch(() => null)
    if (data) fonts.push({ name, data, weight, style: 'normal' })
  }
  FONT_CACHE = fonts
  return fonts
}

const hashOf = s => Math.abs([...String(s || 'x')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0))
// Deterministic believable engagement numbers (same text → same numbers).
const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n)

// Rough line estimate so card height fits the text (Satori needs fixed dims).
function linesFor(text, charsPerLine) {
  const words = String(text || '').split(/\s+/)
  let lines = 1, len = 0
  for (const w of words) {
    if (len + w.length + 1 > charsPerLine) { lines++; len = w.length }
    else len += w.length + 1
  }
  return lines
}

const VERIFIED = h('svg', { width: 30, height: 30, viewBox: '0 0 24 24', style: { marginLeft: 6 } },
  h('path', { fill: '#1D9BF0', d: 'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z' }))

const ticon = d => h('svg', { width: 34, height: 34, viewBox: '0 0 24 24' }, h('path', { fill: '#536471', d }))
const I_REPLY = ticon('M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z')
const I_RT = ticon('M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z')
const I_LIKE = ticon('M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z')

// Avatar: brand logo image when provided, else a deterministic colored initial.
function avatar(name, logoUrl, size = 92) {
  if (logoUrl) return h('img', { src: logoUrl, width: size, height: size, style: { borderRadius: 999, objectFit: 'cover' } })
  const hue = hashOf(name) % 360
  return h('div', { style: { display: 'flex', width: size, height: size, borderRadius: 999, backgroundColor: `hsl(${hue}, 55%, 45%)`, color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.46, fontWeight: 800 } }, (name[0] || 'c').toUpperCase())
}

// ── The tweet card — light-mode X screenshot anatomy ─────────────────────────
export async function renderTweetCard({ name, handle, text, logoUrl }) {
  const W = 920
  const tLines = linesFor(text, 40)
  const H = 200 + tLines * 56 + 96
  const n = hashOf(text)
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#FFFFFF', borderRadius: 28, padding: '34px 42px', fontFamily: 'Inter', boxShadow: '0 18px 50px rgba(0,0,0,0.35)' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 20 } },
      avatar(name, logoUrl),
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { style: { display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 800, color: '#0F1419' } }, name, VERIFIED),
        h('div', { style: { display: 'flex', fontSize: 28, color: '#536471' } }, `@${handle}`),
      ),
      h('div', { style: { display: 'flex', marginLeft: 'auto', marginTop: -14 } },
        h('svg', { width: 38, height: 38, viewBox: '0 0 24 24' }, h('path', { fill: '#0F1419', d: 'M18.9 1.2h3.7l-8 9.1L24 22.8h-7.4l-5.8-7.5-6.6 7.5H.5l8.5-9.7L0 1.2h7.6l5.2 6.9zM17.6 20.6h2L6.5 3.3H4.3z' }))),
    ),
    h('div', { style: { display: 'flex', fontSize: 40, lineHeight: 1.38, color: '#0F1419', marginTop: 24, fontWeight: 400 } }, text),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 22, borderTop: '2px solid #EFF3F4' } },
      I_REPLY, h('div', { style: { display: 'flex', fontSize: 27, color: '#536471', marginRight: 22 } }, fmtK(800 + n % 4200)),
      I_RT, h('div', { style: { display: 'flex', fontSize: 27, color: '#536471', marginRight: 22 } }, fmtK(2400 + n % 18000)),
      I_LIKE, h('div', { style: { display: 'flex', fontSize: 27, color: '#536471' } }, fmtK(31000 + n % 140000)),
      h('div', { style: { display: 'flex', marginLeft: 'auto', fontSize: 27, color: '#536471' } }, `${fmtK(400000 + n % 3000000)} views`),
    ),
  )
  const img = new ImageResponse(el, { width: W, height: H, fonts: await loadFonts() })
  return Buffer.from(await img.arrayBuffer())
}

// ── The reddit story card — r/ post header + title ───────────────────────────
export async function renderRedditCard({ subreddit, author, title }) {
  const W = 920
  const tLines = linesFor(title, 36)
  const H = 170 + tLines * 60 + 86
  const n = hashOf(title)
  const sub = String(subreddit || 'AskReddit').replace(/^r\//, '')
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#FFFFFF', borderRadius: 26, padding: '32px 40px', fontFamily: 'Inter', boxShadow: '0 18px 50px rgba(0,0,0,0.35)' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
      h('div', { style: { display: 'flex', width: 64, height: 64, borderRadius: 999, backgroundColor: '#FF4500', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800 } }, 'r/'),
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { style: { display: 'flex', fontSize: 30, fontWeight: 800, color: '#1A1A1B' } }, `r/${sub}`),
        h('div', { style: { display: 'flex', fontSize: 25, color: '#787C7E' } }, `u/${String(author || 'storyteller').replace(/^@/, '')} · ${3 + n % 20}h`),
      ),
    ),
    h('div', { style: { display: 'flex', fontSize: 44, lineHeight: 1.32, color: '#1A1A1B', marginTop: 22, fontWeight: 600 } }, title),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 'auto', paddingTop: 20 } },
      h('svg', { width: 32, height: 32, viewBox: '0 0 24 24' }, h('path', { fill: '#FF4500', d: 'M12 3l8 9h-5v9H9v-9H4l8-9z' })),
      h('div', { style: { display: 'flex', fontSize: 28, color: '#1A1A1B', fontWeight: 800, marginRight: 24 } }, fmtK(8000 + n % 90000)),
      h('svg', { width: 30, height: 30, viewBox: '0 0 24 24' }, h('path', { fill: 'none', stroke: '#787C7E', strokeWidth: 2.4, d: 'M21 11.5c0 4.14-4.03 7.5-9 7.5-1.02 0-2-.14-2.91-.4L4 20l1.42-3.55C4.52 15.1 4 13.36 4 11.5 4 7.36 8.03 4 13 4s8 3.36 8 7.5z' })),
      h('div', { style: { display: 'flex', fontSize: 28, color: '#787C7E' } }, fmtK(900 + n % 6000)),
    ),
  )
  const img = new ImageResponse(el, { width: W, height: H, fonts: await loadFonts() })
  return Buffer.from(await img.arrayBuffer())
}
