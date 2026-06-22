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

// ── Brand brief ───────────────────────────────────────────────────────────────
// How the user WANTS to be portrayed (captured in onboarding) — distinct from
// the analyzed voice (how they currently write). This is intent: positioning,
// audience, content pillars, the persona angle, the goal, and boundaries. It
// steers autonomous generation so the brand stays on-strategy.
export function brandBriefBlock(brief) {
  if (!brief || typeof brief !== 'object') return ''
  const parts = []
  if (brief.positioning) parts.push(`Positioning (how they want to be seen): ${brief.positioning}`)
  if (brief.audience) parts.push(`Audience they're talking to: ${brief.audience}`)
  if (Array.isArray(brief.pillars) && brief.pillars.length) parts.push(`Content pillars (rotate across these): ${brief.pillars.join('; ')}`)
  if (Array.isArray(brief.tone) && brief.tone.length) parts.push(`Personality to project: ${brief.tone.join(', ')}`)
  if (brief.goal) parts.push(`Goal of posting: ${brief.goal}`)
  if (brief.avoid) parts.push(`Never: ${brief.avoid}`)
  if (!parts.length) return ''
  return `\n\nBRAND DIRECTION (how this person wants to be portrayed — honor it):\n${parts.map(p => `- ${p}`).join('\n')}`
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

// LinkedIn is a DIFFERENT writing discipline from X — research-distilled from
// 226K posts, 236 causal findings (2026). The most important structural insight:
// cross-sectional "best practices" are largely spurious (success → style, not
// the reverse). The findings below are within-creator causal effects — things
// that actually MOVE the needle when YOU change them.
export const LINKEDIN_RUBRIC = `HOW TO WRITE A GREAT LINKEDIN POST — 226K-post causal research, 2026:

HOOK (first line only — 4-15× more valuable per character than anything below the fold):
1. Open with a first-person "I" statement. This is causally +8-25% within-creator — not correlation, actual causation confirmed by three independent methods. Effect grows with experience. Best-performing pattern: (proud / honored / thrilled / grateful / excited) + specific action verb + real timeframe or number, all within the first 100 characters. Aim for a hook ≥100 chars — hooks under 60 chars measurably underperform.
2. Make it a tension line: a real result, a costly mistake, a counterintuitive claim, or a milestone. Then a blank LINE BREAK before anything else. No "I'm excited to announce" filler before the actual news.
3. NEVER open with a question. Opening questions are causally NEGATIVE (-5% OPR within-creator). They pattern-match as engagement bait; the algorithm penalizes them. Save questions for the very LAST line only, where closing questions drive comments.

BODY (the earned read):
4. Write 4-7 paragraphs with blank lines between each. 4+ paragraphs outperform single-paragraph by +26% within-creator. 1-2 sentences per paragraph — white space is pacing, walls of text die in the feed.
5. First-person story with real specifics: dollar amounts (+5% OPR), 3+ named entities / proper nouns (+5% OPR), timeframes, and named social proof (Forbes, YC, Harvard, 10K users) (+6-12% OPR). "I cut response time from 8 hours to 12 minutes" beats "I improved efficiency." Concrete specifics stack monotonically — every signal added increases OPR.
6. Use the personal triumph register — the most powerful tone on LinkedIn (d=+0.21): (proud / honored / grateful) + specific person, object, or event. Story + gratitude compound (d=+0.20) outperforms either alone. This is the highest-OPR content pattern in the dataset.
7. Parenthetical asides signal unfiltered humanity (d=+0.05). Use them naturally.
8. Use 3-5 exclamation marks across the body — causally positive (+5.6% for the first mark; peak performance at 3-5). Zero feels cold; 6+ reads frantic. Exclamation marks shift reactions toward "celebrate" which drives the highest OPR impact.
9. Never use prescriptive "you should / you need to / you must" framing (-6% OPR). Use first-person observation ("I found that…") instead of instructional voice ("you should…").

ENDING:
10. Exactly ONE of:
    a. End CTA: ask them to comment / share / save / tag / follow. Closing CTAs are causally positive (d=+0.09). The final-line question drives comments (r=+0.04); the opening question kills them.
    b. Punchline ending: last sentence ≤6 words after a longer body. Sharp landing, no CTA needed.
    Never both. Never "Agree?" or "Thoughts?" as a standalone closer.

TOPIC INTELLIGENCE (ranked by OPR, validated on held-out data):
TOP topics: career milestone / new job (OPR 2.08, 4.3× enriched among 10× posts), certification (OPR 1.20), excited announcement (OPR 1.20), gratitude / thanks (OPR 1.09). New job + gratitude together = +30% beyond milestone alone.
AVOID: contrarian opinions (OPR 0.894, worst risk-reward on LinkedIn — the professional audience punishes hot takes), generic praise posts (OPR 0.966), growth platitudes (OPR 0.968), join/register calls-to-action (OPR 0.862).
Stay close to the author's established topic territory per post — individual posts that stray far from their centroid underperform by up to -22%. Surprise the reader with the angle, not the topic.

FORMAT:
11. Length: 150-400 tokens (~600-1300 chars) is the sweet spot for text-only. Never go below ~60 tokens — there is a hard cliff at <15 tokens (-12% OPR). Longer posts with media can extend further without penalty.
12. NO outbound links in the body — LinkedIn suppresses off-platform reach. If a link is essential: "link in comments."
13. 0-3 hashtags at the very end only. 2026 algorithm uses semantic embeddings; hashtags are largely deprecated. Emojis: 0-2 max, only if the author's own posts already use them.

BANNED:
"I'm humbled / thrilled to announce," "🚀 exciting news," broetry (one word per line), "leverage," "synergy," "thought leader," "game-changer," "strategic," "innovative," "passionate about," "agree?" / "thoughts?" as the only closing. No corporate buzzwords.
Stay in the author's actual voice — their specific idioms and convictions at LinkedIn length, never a generic "LinkedIn voice."`

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
