// lib/quality.js — generation quality intelligence.
//
// Until now nothing in Cadence checked its own output: every post shipped as a
// single-shot first draft. This adds an LLM JUDGE that scores candidates against
// the SAME rubric used to write them, so we can:
//   • bestOf()  — generate several (hot) and keep the judged best (variety + lift)
//   • gateOne() — catch a weak/sloppy single draft and regenerate it once
// The judge runs COLD (low temp) for stable scoring; generation runs hot for
// diversity. Everything degrades gracefully — a judge failure returns the input
// unchanged, never blocks a post.
import { generateJson } from './llm'

const SCORE_SCHEMA = {
  type: 'object', required: ['scores'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object', required: ['i', 'score'],
        properties: {
          i: { type: 'integer', description: 'candidate index you are scoring' },
          score: { type: 'number', description: '0-10 overall: would this stop the scroll and perform?' },
          hook: { type: 'number', description: '0-10 strength of the first line' },
          voice: { type: 'number', description: '0-10 sounds like THIS specific person, not generic AI' },
          slop: { type: 'boolean', description: 'true if it reads as templated AI / vague / trips banned tells / weak hook' },
          reason: { type: 'string', description: 'one terse clause — the single biggest flaw or strength' },
        },
      },
    },
  },
}

const isLinkedIn = rubric => /226K-post|LINKEDIN|linkedin/i.test(rubric)

const judgeSystem = (rubric, voice) => `You are a ruthless social-media editor scoring draft posts BEFORE they publish. For each candidate, score 0-10 overall, 0-10 hook strength, and 0-10 voice authenticity (does it sound like a real, specific person — not generic AI?). Set slop=true for anything templated, vague, hook-weak, or that trips the banned tells.

Judge against this exact bar:
${rubric}

The author's voice (drafts must sound like THIS, not a generic brand):
${voice}

Calibrate harshly: most AI drafts are a 5-6. Reserve 8+ for genuinely scroll-stopping, concrete, in-voice posts. Penalize candidates that are near-duplicates of each other (sameness is failure). Output one row per candidate, echoing its index i.${isLinkedIn(rubric) ? `

LINKEDIN-SPECIFIC SCORING (apply these on top of the rubric above — each is validated causal, not opinion):
- Hook starts with a question → hook score -3. Opening questions causally hurt LinkedIn OPR by -5%. Hard penalty.
- Hook is under 60 characters → hook score -2. Hooks ≥100 chars measurably outperform.
- No first-person "I" in the opening sentence → score -1. "I" openers are causally +8-25%.
- Zero exclamation marks in a 4+ paragraph post → score -1. 3-5 exclamations are causal positives.
- Post is a contrarian opinion / hot take / "unpopular opinion" format → score -3. Worst-performing archetype on LinkedIn (OPR 0.894, risk-reward 0.50).
- Post is "you should / you need to / you must" instructional without any personal story → score -2. Prescriptive framing underperforms by -6%.
- Post uses career milestone / new job / gratitude + specifics → score +1. These are the top-OPR archetypes (OPR 2.08 for new-job).
- Post has 4+ paragraphs with specific dollar amounts, named entities, or social proof → score +1.
- Post has a closing CTA or a closing question (not an opening question) → score +0.5.` : ''}`

// Score posts 0-10 against the rubric+voice. Returns [{text, score, hook, voice,
// slop, reason}] aligned to input order; missing scores default to a neutral 5.
export async function scorePosts(posts, { rubric = '', voice = '' } = {}) {
  const list = (posts || []).map(p => String(p || '').trim()).filter(Boolean)
  if (list.length < 2) return list.map(text => ({ text, score: 7, slop: false })) // nothing to compare → trust it
  const user = list.map((p, i) => `[${i}]\n${p}`).join('\n\n———\n\n')
  const out = await generateJson({
    system: judgeSystem(rubric, voice), user, schema: SCORE_SCHEMA,
    maxTokens: 1100, temperature: 0.2, toolName: 'emit_scores',
  }).catch(() => ({ scores: [] }))
  const byI = {}
  for (const s of out.scores || []) if (Number.isInteger(s.i)) byI[s.i] = s
  return list.map((text, i) => ({ text, score: 5, slop: false, ...(byI[i] || {}) }))
}

// Generate a POOL of candidates (the caller's hot generation), judge them, and
// return the best `n` distinct texts. Falls back to plain slice if judging fails.
export async function bestOf({ generate, n = 3, pool = 6, rubric, voice }) {
  const cands = await generate(pool).catch(() => [])
  const uniq = [...new Set((cands || []).map(s => String(s || '').trim()).filter(Boolean))]
  if (uniq.length <= n) return uniq
  const scored = await scorePosts(uniq, { rubric, voice })
  const ranked = [...scored].sort((a, b) => (b.score || 0) - (a.score || 0))
  const clean = ranked.filter(s => !s.slop)
  return (clean.length >= n ? clean : ranked).slice(0, n).map(s => s.text)
}

// Score ONE draft; if it's slop or below threshold, regenerate once (with the
// critique) and keep whichever scores higher. `regen(critique)` → fresh string.
export async function gateOne(draft, { rubric, voice, regen, threshold = 6.5 } = {}) {
  const text = String(draft || '').trim()
  if (!text || typeof regen !== 'function') return draft
  const [s0] = await scorePosts([text, text], { rubric, voice }) // dup so the judge engages (≥2)
  if (s0 && !s0.slop && (s0.score || 0) >= threshold) return text
  const critique = s0?.reason || 'too generic, weak hook — sharper, more specific, more in-voice'
  const better = await Promise.resolve(regen(critique)).catch(() => null)
  const cleaned = String(better || '').trim()
  if (!cleaned) return text
  const [a, b] = await scorePosts([text, cleaned], { rubric, voice })
  return (b?.score || 0) > (a?.score || 0) ? cleaned : text
}
