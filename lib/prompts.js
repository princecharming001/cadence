// lib/prompts.js — THE prompt stack. Every generation surface in Cadence
// (suggestions, campaigns, replies, carousels, clips, chat) assembles its
// system prompt from these blocks, so the user's voice, learned feedback, and
// platform rules apply EVERYWHERE — including (especially) the paths that
// publish autonomously.
export { X_RUBRIC, REPLY_RUBRIC, CHAT_STYLE } from './rubric'
export { recentFeedback, feedbackBlock } from './feedback'
import { generateText } from './llm'

// ── Voice ─────────────────────────────────────────────────────────────────────
// One canonical rendering of the persona, all fields included (sample_hooks and
// signature_moves were generated-but-unused before this). `register` tunes the
// surface: a reply reads different from a LinkedIn essay in the same voice.
const REGISTERS = {
  post: 'Write like they write when publishing: full intent, their natural rhythm.',
  reply: 'Conversational register: looser, quicker, like them replying on their phone — but unmistakably the same person.',
  longform: 'Room to breathe: their voice at LinkedIn length — same rhythm and conviction, more development per idea.',
  headline: 'Compression register: their voice at maximum density — hooks, titles, single lines.',
}

export function voiceBlock(persona, { register = 'post' } = {}) {
  if (!persona) return 'VOICE: no learned voice yet — write in a confident, specific, human voice. No corporate filler.'
  const parts = [`THE VOICE (write as this person, never about them):`]
  if (persona.summary) parts.push(`Who: ${persona.summary}`)
  if (persona.tone) parts.push(`Tone: ${persona.tone}`)
  if (persona.topics?.length) parts.push(`Home topics: ${persona.topics.join(', ')}`)
  if (persona.style_rules?.length) parts.push(`Style rules:\n${persona.style_rules.map(r => `- ${r}`).join('\n')}`)
  if (persona.signature_moves?.length) parts.push(`Signature moves they reach for:\n${persona.signature_moves.map(m => `- ${m}`).join('\n')}`)
  if (persona.sample_hooks?.length) parts.push(`Openers that sound like them (for flavor, never to copy verbatim):\n${persona.sample_hooks.map(h => `- ${h}`).join('\n')}`)
  parts.push(REGISTERS[register] || REGISTERS.post)
  return parts.join('\n')
}

// ── Anti-repetition ───────────────────────────────────────────────────────────
export function antiRepetition(recent, { limit = 10 } = {}) {
  const items = (recent || []).map(r => (typeof r === 'string' ? r : r?.content) || '')
    .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, limit)
  if (!items.length) return ''
  return `\n\nDO NOT repeat angles, hooks, or phrasing from these recent posts:\n${items.map(s => `- ${s.slice(0, 90)}`).join('\n')}`
}

// ── Platform rules (single source of truth) ──────────────────────────────────
export const PLATFORM = {
  x: { cap: 280, label: 'X (Twitter)' },
  linkedin: { cap: 1300, min: 350, label: 'LinkedIn' },
  instagram: { cap: 2200, label: 'Instagram' },
  tiktok: { cap: 2200, titleCap: 90, label: 'TikTok' },
}

export const PROMO_RUBRIC = `HOW TO PROMOTE WITHOUT READING AS AN AD (follow literally):
1. The hook earns the read on its own — curiosity, a result, a contrarian take. Never open with the product name.
2. Lead with the value or story; the promotion is the natural conclusion, not the premise.
3. One soft call-to-action maximum, in the user's voice ("been building this — link below" energy, never "Don't miss out!").
4. Max one link. Zero hashtag walls (0-2 hashtags, only if the user's own posts use them).
5. No superlative salad ("game-changing", "revolutionary"), no urgency theater ("last chance").
6. If the post would still be worth reading with the product name deleted, it's right.`

// LinkedIn is a DIFFERENT writing discipline from X — research-distilled
// (2025-2026): the feed rewards developed first-person narrative + a
// professional takeaway, dwell time over hot takes, and punishes outbound
// links and engagement bait. A LinkedIn post is a 60-second read, not a
// one-liner.
export const LINKEDIN_RUBRIC = `HOW TO WRITE A GREAT LINKEDIN POST (follow literally — this is NOT an X post):
STRUCTURE
1. Line 1 (and only line 1) is the hook — it sits above the "…see more" fold (~200 chars visible). Make it a tension line: a result, a mistake, a contrarian claim, a moment. Then a LINE BREAK before anything else.
2. Develop the idea. LinkedIn rewards a built arc: setup → what happened → what it means. 600–1200 characters is the sweet spot; never compress to an X-style one-liner, never pad past ~1300.
3. One-or-two-sentence paragraphs with blank lines between them. White space is the pacing — a wall of text dies in the feed.
4. Story beats opinion: first-person experience ("I shipped / I lost / a client told me") with real numbers, names, timeframes. The lesson lands BECAUSE the story earned it.
5. Land the ending: ONE clean takeaway line, or ONE genuine question that a peer would actually answer. Never both, never "Agree?"/"Thoughts?" bait.
REGISTER (vs X)
6. Warmer and more reflective than X — composed, professional-peer voice. Less smirk, more substance. Vulnerability is welcome when it carries a business lesson; X-style dunking and rage-bait are not.
7. Complete sentences over fragments. The clipped, punchy X cadence reads as low-effort here — let ideas breathe.
HARD RULES
8. NO outbound links in the body (LinkedIn suppresses reach; if one is essential, say "link in comments").
9. No "I'm humbled/thrilled to announce," no "🚀 exciting news," no broetry one-word-per-line drama, no corporate buzzwords ("leverage," "synergy," "thought leader").
10. 0-3 hashtags at the very end, only if the user's own posts use them. Emojis: at most 1-2, only if the user's own posts use them.
11. Stay in the author's actual voice — their idioms and convictions, developed at LinkedIn length, never a generic "LinkedIn voice".`

// ── Length enforcement ────────────────────────────────────────────────────────
// Word-safe trim first; only if a hard cap is still exceeded do we pay for an
// LLM compression pass (X only — other platforms just trim at a word break).
export function trimAtWord(text, cap) {
  const t = (text || '').trim()
  if (t.length <= cap) return t
  const cut = t.slice(0, cap - 1)
  const brk = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'))
  return (brk > cap * 0.6 ? cut.slice(0, brk) : cut).trim() + '…'
}

export async function enforceLen(text, platform) {
  const rules = PLATFORM[platform] || PLATFORM.x
  const t = (text || '').trim()
  if (t.length <= rules.cap) return t
  if (platform !== 'x') return trimAtWord(t, rules.cap)
  try {
    const out = await generateText({
      system: `Rewrite the given X post to ${rules.cap} characters or fewer. Keep it a COMPLETE thought — never cut mid-sentence. Keep the hook and the punch. Output ONLY the post text.`,
      user: t, maxTokens: 220,
    })
    const clean = out.replace(/^["']|["']$/g, '').trim()
    if (clean && clean.length <= rules.cap) return clean
  } catch {}
  return trimAtWord(t, rules.cap)
}
