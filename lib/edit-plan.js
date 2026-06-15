// lib/edit-plan.js — the EditPlan IR (intermediate representation) the Director
// emits and the render engine executes. It's deliberately FLAT and FORGIVING:
// the LLM fills independent optional fields; normalizeEditPlan() rebuilds a
// strict, renderable plan server-side — it NEVER hard-rejects, it coerces and
// defaults, so a slightly-off LLM emission still renders something good.
//
// Two safety properties are enforced STRUCTURALLY here, not trusted from the
// prompt: (1) STOCK-FIRST / AI-OPT-IN — generative scenes (ai_video/avatar) are
// downgraded to free stock/card scenes unless the user explicitly asked for AI
// AND the provider is ready; the default plan is always 100% free. (2) bounded
// surface — scenes capped, enums clamped, durations clamped — every value the
// renderer sees is one it can render.

import { ANCHORS, clamp01 } from './overlay-coords'

export const SCENE_KINDS = ['clip', 'card', 'color', 'ai_video', 'avatar']
export const TRANSITIONS = ['cut', 'fade']
export const MOTIONS = ['none', 'kenBurns']
export const ASPECTS = ['vertical', 'square', 'wide']
export const CAPTION_MODES = ['off', 'auto']
export const STYLE_KEYS = ['bold', 'minimal', 'editorial', 'gradient', 'mint'] // = SLIDE_STYLES keys
export const MAX_SCENES = 6
export const GEN_CAP = 1 // at most one generative scene per worker pass (600s fits 900s)

// ── IR v2 (overlay/element model) — see normalizeEditPlanV2 below ────────────
export const ELEMENT_TYPES = ['text', 'image', 'clip']        // overlay kinds (clip=PiP, gated)
export const FONTS = ['anton', 'inter', 'playfair']           // == bundled assets/fonts; editor list MUST equal this
export const ANIM_IO = ['none', 'fade']
export const MAX_ELEMENTS = 6                                 // per scene; final value validated by the worker-timing probe
export const TRANSITIONS_V2 = ['cut', 'fade', 'dissolve', 'slideleft', 'slideright', 'slideup', 'wipeleft', 'circleopen'] // cut=concat-copy; rest=xfade names
export { ANCHORS }

// PHASE_GATES — the SINGLE source of truth shared by editor + normalizer. The
// editor mounts UI for a feature ONLY when its gate is true; the normalizer
// downgrades-and-warns anything whose gate is off — so the editor can never
// express what the renderer would silently drop. Flip a gate ON only when the
// render path for it ships (and, for filter-dependent ones, when the worker probe
// confirms the filter). Phase 1a = positioned/timed text + image overlays.
export const PHASE_GATES = {
  // UI gates (read by the editor):
  textElement: true, imageElement: true, animFade: true, resizeHandle: true, timelineTrim: true,
  // render gates (enforced by the normalizer; flip on per phase). xfade/kenBurns
  // ALSO require the worker-probe flag (workerFilters) at normalize time.
  rotation: false, xfade: true, kenBurns: true, clipTrim: true, moveAnim: false, wysiwygPng: false, musicBed: false, pip: false,
}
export const MAX_CLIP_DUR = 60   // a full clip can sit on the timeline; cards stay short
export const MAX_CARD_DUR = 15
const FONT_FOR_STYLE = { bold: 'anton', minimal: 'inter', editorial: 'playfair', gradient: 'anton', mint: 'anton', photo: 'anton' }

const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt }
const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max)
const oneOf = (v, set, dflt) => set.includes(v) ? v : dflt
const isHttp = u => /^https?:\/\//i.test(String(u || ''))
const HEX = /^#[0-9a-fA-F]{6}$/, HEXA = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/
const hexColor = (v, dflt) => HEX.test(String(v || '')) ? String(v).toUpperCase() : dflt
const hexaColor = (v, dflt) => HEXA.test(String(v || '')) ? String(v).toUpperCase() : dflt

// Does the user's request explicitly opt into generative AI / talking avatars?
// (If not, the normalizer keeps the plan free.) Used by the Director; exported
// so callers can compute it once.
export function wantsGenerative(text) {
  return /\b(ai[- ]?video|ai[- ]?gen|generate(d)? video|text[- ]?to[- ]?video|avatar|talking head|spokesperson|ugc|veo|sora|runway|higgsfield|cinematic ai|imagine|render me)\b/i.test(String(text || ''))
}

// normalizeEditPlan(raw, opts) → { plan, downgrades }
//   opts: { brief, wantsGen, genReady }
// brief    — the user's request, used to synthesize fallback copy.
// wantsGen — explicit AI opt-in (else generative scenes are downgraded).
// genReady — provider configured AND resume-not-resubmit wired (Phase 4). Until
//            then this is false, so AI scenes are ALWAYS downgraded regardless.
export function normalizeEditPlan(raw, { brief = '', wantsGen = false, genReady = false } = {}) {
  const downgrades = []
  const r = raw && typeof raw === 'object' ? raw : {}
  const allowGen = wantsGen && genReady

  let aspect = oneOf(r.aspect, ASPECTS, 'vertical')
  let captions = oneOf(r.captions, CAPTION_MODES, 'auto')
  const style_key = oneOf(r.style_key, STYLE_KEYS, null)

  const rawScenes = Array.isArray(r.scenes) ? r.scenes.slice(0, MAX_SCENES) : []
  const scenes = []
  let genCount = 0
  for (const raw of rawScenes) {
    const sc = raw && typeof raw === 'object' ? raw : {}
    let kind = oneOf(sc.kind, SCENE_KINDS, 'clip')

    // STOCK-FIRST: downgrade generative kinds unless explicitly allowed + capped.
    if ((kind === 'ai_video' || kind === 'avatar')) {
      if (!allowGen || genCount >= GEN_CAP) {
        if (kind === 'ai_video') { downgrades.push('ai_video→clip'); kind = 'clip'; if (!sc.query) sc.query = sc.prompt || brief }
        else { downgrades.push('avatar→card'); kind = 'card'; if (!sc.heading) sc.heading = str(sc.script, 80) || brief }
      } else { genCount++ }
    }

    const scene = {
      kind,
      transition: oneOf(sc.transition, TRANSITIONS, 'cut'),
      motion: oneOf(sc.motion, MOTIONS, null),
      duration: sc.duration == null ? null : clampNum(sc.duration, 1, 15, null),
      caption_text: str(sc.caption_text, 80) || null,
    }
    if (kind === 'clip' || kind === 'ai_video') {
      scene.query = str(sc.query || sc.prompt, 120) || null
      scene.asset_id = typeof sc.asset_id === 'string' && sc.asset_id ? sc.asset_id : null
      scene.url = isHttp(sc.url) ? str(sc.url, 600) : null
      // a clip with nothing to source from is dropped.
      if (kind === 'clip' && !scene.query && !scene.asset_id && !scene.url) { downgrades.push('clip(empty)→drop'); continue }
    } else if (kind === 'card') {
      scene.heading = str(sc.heading, 80) || str(brief, 80) || 'Watch'
      scene.body = str(sc.body, 160) || null
    } else if (kind === 'avatar') {
      scene.script = str(sc.script, 400) || null
      scene.asset_id = typeof sc.asset_id === 'string' && sc.asset_id ? sc.asset_id : null
    }
    scenes.push(scene)
  }

  // never an empty plan: one card from the brief.
  if (!scenes.length) scenes.push({ kind: 'card', heading: str(brief, 80) || 'Watch', body: null, transition: 'cut', motion: null, duration: 3, caption_text: null })

  // stable ids.
  scenes.forEach((s, i) => { s.id = `s${i}` })

  // captions need spoken audio; until VO/avatar audio exists, auto → off.
  const hasSpoken = scenes.some(s => s.kind === 'avatar' && s.script)
  if (captions === 'auto' && !hasSpoken) captions = 'off'
  // vertical-only captions (buildKaraokeAss is 1080x1920) — force vertical if captioned.
  if (captions !== 'off' && aspect !== 'vertical') { downgrades.push(`aspect ${aspect}→vertical (captions)`); aspect = 'vertical' }

  return { plan: { version: 1, aspect, captions, style_key, scenes }, downgrades }
}

// ─────────────────────────────────────────────────────────────────────────────
// IR v2 — a BACKWARD-COMPATIBLE SUPERSET: a scene = ONE background (the v1 fields,
// kept inline) + 0..MAX_ELEMENTS timed/positioned overlay elements that render to
// a single ffmpeg filtergraph (drawtext for text, overlay for images). Coords are
// FRACTIONS (0..1) of the fixed render canvas; element start/end are SECONDS
// relative to the scene. Same forgiving contract as v1: coerce, clamp, downgrade,
// NEVER hard-reject. PHASE_GATES (above) downgrade anything whose render path
// isn't live yet, recording a downgrade string so the editor can warn. A v1 plan
// in → a clean v2 plan out (caption_text is LIFTED to a bottom-centered text
// element), so existing 'directed' jobs + the Director keep working untouched.
function normElement(raw, sceneDur, gates, downgrades) {
  const e = raw && typeof raw === 'object' ? raw : {}
  const type = oneOf(e.type, ELEMENT_TYPES, 'text')
  if (type === 'clip' && !gates.pip) { downgrades.push('pip(not-yet)→drop'); return null }
  const start = e.start == null ? null : clampNum(e.start, 0, sceneDur, null)
  let end = e.end == null ? null : clampNum(e.end, 0, sceneDur, null)
  if (start != null && end != null && end <= start) end = null
  const anim = { in: oneOf(e.anim?.in, ANIM_IO, 'none'), out: oneOf(e.anim?.out, ANIM_IO, 'none'), move: null }
  if (e.anim?.move && typeof e.anim.move === 'object') {
    if (gates.moveAnim) anim.move = { to_x: clamp01(e.anim.move.to_x), to_y: clamp01(e.anim.move.to_y) }
    else downgrades.push('moveAnim(not-yet)→drop')
  }
  if (!gates.rotation && Number(e.rotation)) downgrades.push('rotation(no-engine)→0')
  const el = {
    type, start, end, anim,
    x: clamp01(e.x === undefined ? 0.5 : e.x), y: clamp01(e.y === undefined ? 0.5 : e.y),
    anchor: oneOf(e.anchor, ANCHORS, 'center'),
    scale: clampNum(e.scale, 0.02, 1, type === 'text' ? 0.8 : 0.4),
    opacity: clampNum(e.opacity, 0, 1, 1),
    rotation: gates.rotation ? clampNum(e.rotation, -180, 180, 0) : 0,
  }
  if (type === 'text') {
    el.text = str(e.text, 200)
    if (!el.text) return null
    el.font = oneOf(e.font, FONTS, 'anton')
    el.size = clampNum(e.size, 0.02, 0.3, 0.07)
    el.color = hexColor(e.color, '#FFFFFF')
    el.stroke = e.stroke && typeof e.stroke === 'object' ? { color: hexColor(e.stroke.color, '#000000'), width: clampNum(e.stroke.width, 0, 30, 0) } : null
    el.box = e.box && typeof e.box === 'object' ? { color: hexaColor(e.box.color, '#000000B3'), pad: clampNum(e.box.pad, 0, 80, 16), radius: clampNum(e.box.radius, 0, 80, 0) } : null
    el.align = oneOf(e.align, ['left', 'center', 'right'], 'center')
    el.multiline = gates.wysiwygPng ? !!e.multiline : false
  } else if (type === 'image') {
    el.asset_id = typeof e.asset_id === 'string' && e.asset_id ? e.asset_id : null
    el.url = isHttp(e.url) ? str(e.url, 600) : null
    if (!el.asset_id && !el.url) { downgrades.push('image(no-src)→drop'); return null }
  }
  return el
}

export function normalizeEditPlanV2(raw, { brief = '', wantsGen = false, genReady = false, workerFilters = {} } = {}) {
  const downgrades = []
  const r = raw && typeof raw === 'object' ? raw : {}
  const allowGen = wantsGen && genReady
  const g = PHASE_GATES
  const wf = { xfade: !!workerFilters.xfade, zoompan: !!workerFilters.zoompan, acrossfade: !!workerFilters.acrossfade }

  let aspect = oneOf(r.aspect, ASPECTS, 'vertical')
  let captions = oneOf(r.captions, CAPTION_MODES, 'auto')
  const style_key = oneOf(r.style_key, STYLE_KEYS, null)

  const rawScenes = Array.isArray(r.scenes) ? r.scenes.slice(0, MAX_SCENES) : []
  const scenes = []
  let genCount = 0
  for (const rs of rawScenes) {
    const sc = rs && typeof rs === 'object' ? rs : {}
    let kind = oneOf(sc.kind, SCENE_KINDS, 'clip')
    if (kind === 'ai_video' || kind === 'avatar') {
      if (!allowGen || genCount >= GEN_CAP) {
        if (kind === 'ai_video') { downgrades.push('ai_video→clip'); kind = 'clip'; if (!sc.query) sc.query = sc.prompt || brief }
        else { downgrades.push('avatar→card'); kind = 'card'; if (!sc.heading) sc.heading = str(sc.script, 80) || brief }
      } else genCount++
    }
    const maxDur = (kind === 'clip' || kind === 'ai_video') ? MAX_CLIP_DUR : MAX_CARD_DUR
    const dur = sc.duration == null ? null : clampNum(sc.duration, 1, maxDur, null)
    const sceneDur = dur != null ? dur : (kind === 'card' || kind === 'color') ? 3 : 5

    let transition = oneOf(sc.transition, TRANSITIONS_V2, 'cut')
    if (transition !== 'cut' && !(g.xfade && wf.xfade)) { downgrades.push(`transition ${transition}→cut`); transition = 'cut' }
    let motion = oneOf(sc.motion, MOTIONS, null)
    if (motion === 'kenBurns' && !(g.kenBurns && wf.zoompan)) { downgrades.push('kenBurns→none'); motion = 'none' }

    const scene = {
      kind, transition, transition_dur: clampNum(sc.transition_dur, 0.1, 2, 0.3), motion,
      duration: dur, caption_text: str(sc.caption_text, 80) || null, elements: [],
    }
    if (kind === 'clip' || kind === 'ai_video') {
      scene.query = str(sc.query || sc.prompt, 120) || null
      scene.asset_id = typeof sc.asset_id === 'string' && sc.asset_id ? sc.asset_id : null
      scene.url = isHttp(sc.url) ? str(sc.url, 600) : null
      if (g.clipTrim) { scene.trim_start = sc.trim_start == null ? null : clampNum(sc.trim_start, 0, 600, null); scene.trim_end = sc.trim_end == null ? null : clampNum(sc.trim_end, 0, 600, null) }
      else { scene.trim_start = null; scene.trim_end = null; if (sc.trim_start != null || sc.trim_end != null) downgrades.push('clipTrim(not-yet)→ignored') }
      if (kind === 'clip' && !scene.query && !scene.asset_id && !scene.url) { downgrades.push('clip(empty)→drop'); continue }
    } else if (kind === 'card') {
      scene.eyebrow = str(sc.eyebrow, 60) || null
      scene.heading = str(sc.heading, 80) || str(brief, 80) || 'Watch'
      scene.body = str(sc.body, 160) || null
    } else if (kind === 'color') {
      scene.color = hexColor(sc.color, null)
    } else if (kind === 'avatar') {
      scene.script = str(sc.script, 400) || null
      scene.asset_id = typeof sc.asset_id === 'string' && sc.asset_id ? sc.asset_id : null
    }

    const rawEls = Array.isArray(sc.elements) ? sc.elements.slice(0, MAX_ELEMENTS) : []
    for (const re of rawEls) { const el = normElement(re, sceneDur, g, downgrades); if (el) scene.elements.push(el) }

    // LIFT v1 caption_text → a bottom-centered text element (renders via the same
    // overlay path), unless an equivalent element already carries it.
    if (scene.caption_text && !scene.elements.some(e => e.type === 'text' && e.text === scene.caption_text)) {
      scene.elements.push({
        type: 'text', text: scene.caption_text, x: 0.5, y: 0.84, anchor: 'center', scale: 0.84, size: 0.058,
        font: FONT_FOR_STYLE[style_key] || 'anton', color: '#FFFFFF', stroke: { color: '#000000', width: 7 },
        box: null, align: 'center', multiline: false, opacity: 1, rotation: 0, start: null, end: null,
        anim: { in: 'fade', out: 'none', move: null },
      })
    }
    scene.caption_text = null // consumed → element
    scene.elements = scene.elements.slice(0, MAX_ELEMENTS)
    scene.elements.forEach((e, i) => { e.id = `e${i}` })
    scenes.push(scene)
  }

  if (!scenes.length) scenes.push({ kind: 'card', heading: str(brief, 80) || 'Watch', body: null, eyebrow: null, transition: 'cut', transition_dur: 0.3, motion: null, duration: 3, caption_text: null, elements: [] })
  scenes.forEach((s, i) => { s.id = `s${i}` })

  const hasSpoken = scenes.some(s => s.kind === 'avatar' && s.script)
  if (captions === 'auto' && !hasSpoken) captions = 'off'
  if (captions !== 'off' && aspect !== 'vertical') { downgrades.push(`aspect ${aspect}→vertical (captions)`); aspect = 'vertical' }

  let audio = null
  if (r.audio && typeof r.audio === 'object' && r.audio.music) {
    if (g.musicBed) audio = r.audio // normalized in Phase 3
    else downgrades.push('music(not-yet)→silent')
  }

  return { plan: { version: 2, aspect, captions, style_key, audio, scenes }, downgrades }
}

// Hand-written JSON Schema for the emit_directed_plan tool (the Director, Phase 3).
// Matches this codebase's convention (tools use plain input_schema objects). The
// normalizer is the real contract; this just shapes what the LLM emits.
export const editPlanJsonSchema = {
  type: 'object',
  properties: {
    aspect: { type: 'string', enum: ASPECTS, description: 'vertical (default, for Reels/TikTok), square, or wide.' },
    captions: { type: 'string', enum: CAPTION_MODES, description: 'auto = burn word-by-word captions on spoken scenes; off otherwise.' },
    style_key: { type: 'string', enum: STYLE_KEYS, description: 'the visual look for text cards + captions. Pick what fits the brand/voice; omit to auto-derive.' },
    scenes: {
      type: 'array',
      description: '2-6 scenes in order. Open on a hook, vary the shots, end on a card/CTA. Each scene: ONE visual.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: SCENE_KINDS, description: "clip = real b-roll (stock by query, or a Library asset_id, or a pasted url). card = a full-screen text card (heading/body) for intros/stats/CTAs. color = a solid-color beat. ai_video/avatar = ONLY if the user explicitly asked for AI/a spokesperson." },
          query: { type: 'string', description: 'clip: 2-5 CONCRETE VISUAL nouns of what the camera sees (e.g. "barista pouring latte cafe morning") — NOT the narration. ai_video: the scene/motion prompt.' },
          heading: { type: 'string', description: 'card: the big line (≤80 chars).' },
          body: { type: 'string', description: 'card: the supporting line (≤160 chars).' },
          asset_id: { type: 'string', description: "clip/avatar: a Library media_assets id to use." },
          url: { type: 'string', description: 'clip: a direct https link or a TikTok/Reel/YouTube link to pull footage from.' },
          script: { type: 'string', description: 'avatar: the line the spokesperson says.' },
          duration: { type: 'number', description: 'seconds (1-15). Optional — paced by default.' },
          transition: { type: 'string', enum: TRANSITIONS, description: 'cut (default) or fade into the next scene.' },
          motion: { type: 'string', enum: MOTIONS, description: 'kenBurns = slow push on stills/cards; none = static.' },
          caption_text: { type: 'string', description: 'an optional baked title line on this scene (≤80), distinct from spoken captions.' },
        },
        required: ['kind'],
      },
    },
  },
  required: ['scenes'],
}
