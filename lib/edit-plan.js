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

export const SCENE_KINDS = ['clip', 'card', 'color', 'ai_video', 'avatar']
export const TRANSITIONS = ['cut', 'fade']
export const MOTIONS = ['none', 'kenBurns']
export const ASPECTS = ['vertical', 'square', 'wide']
export const CAPTION_MODES = ['off', 'auto']
export const STYLE_KEYS = ['bold', 'minimal', 'editorial', 'gradient', 'mint'] // = SLIDE_STYLES keys
export const MAX_SCENES = 6
export const GEN_CAP = 1 // at most one generative scene per worker pass (600s fits 900s)

const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt }
const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim().slice(0, max)
const oneOf = (v, set, dflt) => set.includes(v) ? v : dflt
const isHttp = u => /^https?:\/\//i.test(String(u || ''))

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
