// lib/overlay-coords.js — the ANTI-DRIFT contract. Imported by BOTH the browser
// editor and the server render engine so an overlay element lands in the exact
// same place in the preview and in the ffmpeg output. Coordinates are FRACTIONS
// (0..1) of the fixed render canvas; (x,y) is where the element's ANCHOR point
// sits. ffmpeg's drawtext/overlay filters position the element's TOP-LEFT, so we
// convert anchor→top-left HERE, once, for both sides — never hand-mirror it.
//
// This file is pure data + string math: NO server-only imports, so a 'use client'
// component can import it directly.

export const ANCHORS = ['center', 'tl', 'tr', 'bl', 'br']
// fraction of the element box to subtract from (x,y) to get its top-left corner.
export const ANCHOR_FRAC = { center: [0.5, 0.5], tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] }

export const clamp01 = v => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0 }

// Element WIDTH in px from its width-fraction `scale` and the canvas width.
export const elemWidthPx = (scale, W) => Math.max(2, Math.round(clamp01(scale === undefined ? 0.5 : scale) * W))
// Text SIZE (height-fraction of the canvas) → font pixel size.
export const fontPx = (size, H) => Math.max(10, Math.round(clamp01(size === undefined ? 0.06 : size) * H))

// ── SERVER: ffmpeg position expressions ──────────────────────────────────────
// Returns {x,y} expression strings that place the element's anchor point at
// (el.x,el.y) of the frame. `owVar`/`ohVar` are the filter's own width/height vars:
//   drawtext → ('text_w','text_h');  overlay → ('overlay_w','overlay_h').
export function anchorExpr(el, owVar, ohVar) {
  const [ax, ay] = ANCHOR_FRAC[el.anchor] || ANCHOR_FRAC.center
  const x = clamp01(el.x).toFixed(5), y = clamp01(el.y).toFixed(5)
  return { x: `main_w*${x}-${ax}*${owVar}`, y: `main_h*${y}-${ay}*${ohVar}` }
}

// drawtext alpha expression for a fade in/out window (null = fully opaque, omit).
export function fadeAlphaExpr(el, start, end, fd = 0.35) {
  const fin = el.anim?.in === 'fade', fout = el.anim?.out === 'fade'
  if (!fin && !fout) return null
  const inE = `clip((t-${start.toFixed(3)})/${fd},0,1)`
  const outE = `clip((${end.toFixed(3)}-t)/${fd},0,1)`
  return fin && fout ? `min(${inE},${outE})` : fin ? inE : outE
}

// ── BROWSER: CSS placement ───────────────────────────────────────────────────
// The element box is positioned at (x*100%, y*100%) of the stage and then pulled
// back by its anchor via translate — so the SAME anchor fractions govern both the
// CSS preview and the ffmpeg output. Pass the result to a div's style.
export function cssAnchorStyle(el) {
  const [ax, ay] = ANCHOR_FRAC[el.anchor] || ANCHOR_FRAC.center
  return {
    left: `${clamp01(el.x) * 100}%`,
    top: `${clamp01(el.y) * 100}%`,
    transform: `translate(${-ax * 100}%, ${-ay * 100}%)`,
  }
}
