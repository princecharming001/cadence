// lib/style-tokens.js — the deck visual tokens, as PURE DATA (no next/og, no fs),
// so a 'use client' component (the video editor canvas) can import them to preview
// card/color backgrounds and text styling exactly as the server renders them.
// lib/slideshow.js re-exports these so there is ONE source of truth.

export const SLIDE_STYLES = {
  bold:      { label: 'Bold',      ai: false, bg: '#0B0B0E', fg: '#FFFFFF', accent: '#FFD24A', muted: '#6E7180', display: 'anton' },
  minimal:   { label: 'Minimal',   ai: false, bg: '#FAFAF8', fg: '#16161A', accent: '#1D4ED8', muted: '#9CA3AF', display: 'inter' },
  editorial: { label: 'Editorial', ai: false, bg: '#F7F1E5', fg: '#221C14', accent: '#B4540A', muted: '#8A7E6C', display: 'playfair' },
  gradient:  { label: 'Gradient',  ai: false, bg: 'linear-gradient(160deg,#170F3D 0%,#4F2ED0 58%,#7C3AED 100%)', fg: '#FFFFFF', accent: '#FFC53D', muted: '#B9B0E8', display: 'anton' },
  mint:      { label: 'Mint',      ai: false, bg: '#07261D', fg: '#ECFDF3', accent: '#4ADE80', muted: '#5E8C7B', display: 'anton' },
  photo:     { label: 'AI photo',  ai: true,  bg: '#0B0B0E', fg: '#FFFFFF', accent: '#FFD24A', muted: '#C9CBD4', display: 'anton' },
}

export const DISPLAY = {
  anton:    { family: 'Anton',            weight: 400, caps: true,  cover: 124, head: 88, track: 0 },
  inter:    { family: 'Inter',            weight: 800, caps: false, cover: 100, head: 70, track: -2.5 },
  playfair: { family: 'Playfair Display', weight: 700, caps: false, cover: 96,  head: 66, track: -1 },
}

// FONTS enum key → a browser font stack (matches the bundled TTFs the renderer
// uses; the editor loads Anton/Inter/Playfair as web fonts for a close preview).
export const FONT_CSS = {
  anton: "'Anton', system-ui, sans-serif",
  inter: "'Inter', system-ui, sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
}
export const FONT_CAPS = { anton: true, inter: false, playfair: false }
