// lib/ugc-script.js — writes the spoken script for a fake-UGC-influencer's
// talking-head video, on the research-proven 4-part skeleton, with a HARD FTC
// guardrail.
//
// The skeleton (what actually performs): Hook 0-3s (pattern interrupt) → Problem
// → Solution/Demo → CTA, ~40-75 spoken words for a 15-30s clip, conversational,
// with minor natural imperfections so it reads like a person, not a brand avatar.
//
// FTC GUARDRAIL (the load-bearing safety rule): an AI creator is NOT a real
// customer, so it must never make a first-person EXPERIENTIAL product claim ("I
// used this and my skin cleared"). Only substantiated third-person claims are
// defensible. We forbid it in the prompt AND lint the output; if a first-person
// experiential claim survives, we do one corrective rewrite, and if it still
// trips we return null (skip the video) rather than publish a deceptive claim.
import { generateJson, generateText } from './llm'

// First-person experiential CLAIMS about a product/result — the FTC landmine.
// (Plain "I think / in my opinion" is fine; "I used/tried/bought ... and <result>"
// is not.) Kept deliberately broad on the experiential verbs.
const FP_EXPERIENTIAL = new RegExp([
  // "I used / I've tried / I started using ..." within a clause
  /\b(i|i've|ive|i'm|im)\b[^.!?]{0,60}\b(used|tried|bought|switched to|started using|been using|tested|ordered|wear|wore|take|took|drank|ate|after using)\b/.source,
  // a personal-result claim even without an explicit "I" ("this changed my routine",
  // "it doubled my engagement") — the result VERB is what makes it experiential.
  /\b(changed|transformed|fixed|saved|cleared|boosted|improved|doubled|tripled|grew) my\b/.source,
  // bare possessive-result nouns, limited to clearly PERSONAL/physical ones (skin,
  // hair, body, life, routine) — generic business metrics like "my engagement" are
  // dropped here because they appear in non-experiential advice and the verb branch
  // already catches a real claim ("doubled my engagement").
  /\bmy (skin|hair|body|face|life|routine|weight|gut)\b/.source,
].join('|'), 'i')

function lintFtc(text) { return FP_EXPERIENTIAL.test(String(text || '')) }

const SCRIPT_SCHEMA = {
  type: 'object',
  required: ['script', 'caption'],
  properties: {
    hook: { type: 'string', description: 'the 0-3s opening pattern-interrupt line' },
    script: { type: 'string', description: 'the FULL spoken script (hook→problem→solution→cta), 40-75 words, conversational' },
    caption: { type: 'string', description: 'the post caption to accompany the video (1-2 sentences + soft CTA)' },
  },
}

// Returns { script, caption, hook } or null if it can't be made FTC-safe.
export async function generateUgcScript({ persona, mission, topic, arm }) {
  const spec = persona?.spec || {}
  const personaLine = `You are "${persona?.name || 'a creator'}"${spec.age_range ? `, ${spec.age_range}` : ''}${spec.voice_profile ? `; you sound ${spec.voice_profile}` : ''}. Stay in character.`
  const promoting = mission?.eligible && mission?.campaign
  const sys = `You write a SPOKEN script for a short talking-head video by a content creator.
${personaLine}

STRUCTURE (follow exactly): HOOK (0-3s, a pattern interrupt — a bold claim, a question, or a relatable problem) → PROBLEM (the pain, 1 line) → SOLUTION/DEMO (the fix and the single clearest benefit) → CTA (one clear action). Total 40-75 spoken words for a 15-30 second clip. Conversational, second person, contractions, one idea per sentence; allow ONE small natural imperfection so it sounds human, not corporate.
${promoting ? `You are organically featuring "${mission.campaign.product}"${mission.campaign.pitch ? ` — ${mission.campaign.pitch}` : ''}. Make it feel native, not an ad.` : 'This is a pure persona/value video — no product push.'}
${arm ? `Angle it as ${arm}.` : ''}${mission?.block ? `\n\nWHAT'S WORKING FOR THIS CAMPAIGN (lean into these — they're learned from real results + audience reaction):${mission.block}` : ''}

HARD RULES (FTC compliance — you are an AI creator, NOT a real customer):
- NEVER make a first-person EXPERIENTIAL claim about a product or result ("I used this", "I tried it and...", "it changed my skin/life", "my results"). You have not personally used anything.
- State benefits as substantiated, third-person/general claims ("it helps people who...", "the idea is...", "users report..."), or speak about the PROBLEM and the APPROACH, not your personal experience.
- No fake testimonials, no invented numbers.
Output the spoken script, a short caption, and the hook line.`
  const user = `Topic/angle: ${topic || (persona?.interests || [])[0] || 'something in the niche'}`

  let out = await generateJson({ system: sys, user, schema: SCRIPT_SCHEMA, maxTokens: 600, toolName: 'emit_ugc_script' }).catch(() => null)
  if (!out?.script) return null

  // FTC lint → one corrective rewrite → skip if still non-compliant.
  if (lintFtc(out.script) || lintFtc(out.caption)) {
    const fixed = await generateText({
      system: `Rewrite this spoken video script + caption to REMOVE any first-person experiential product claim (the speaker is an AI creator who has NOT used the product). Keep the hook/problem/solution/cta shape, 40-75 words, conversational. Restate benefits in third-person/general terms. Output JSON: {"script":"...","caption":"..."}.`,
      user: `SCRIPT: ${out.script}\nCAPTION: ${out.caption}`,
      maxTokens: 500,
    }).catch(() => null)
    try { const j = JSON.parse((fixed || '').replace(/^[^{]*/, '').replace(/[^}]*$/, '')); if (j.script) out = { ...out, script: j.script, caption: j.caption || out.caption } } catch {}
    if (lintFtc(out.script) || lintFtc(out.caption)) return null // still non-compliant → don't publish
  }

  return {
    script: String(out.script).trim().slice(0, 800),
    caption: String(out.caption || out.script).trim().slice(0, 800),
    hook: String(out.hook || '').trim(),
  }
}

export { lintFtc }
