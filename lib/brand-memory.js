// lib/brand-memory.js — THE shared memory context layer.
//
// Every generation surface (suggestions, autopilot, campaigns, carousels, the
// chat/Studio, the video director) used to assemble its own subset of the brand
// brain, so a learning that showed up on X never reached a LinkedIn post and a
// carousel was written with no voice at all. This is the single place that pulls
// the whole brain together — ONCE per run — and hands back consistent prompt
// blocks. Cross-platform by design: what's learned anywhere informs everywhere.
//
// The brain has two halves:
//   • LIVE signals (re-derived each run): persona/voice, the brand brief, learned
//     thumbs feedback, real top-performers, what the main accounts have been
//     saying, the live trending formats.
//   • DURABLE memory (the brand_memory table): distilled, long-lived learnings
//     written by the engagement + trend loops — "opening with a personal failure
//     gets 3× the replies", "the audience ignores generic advice". These survive
//     across runs and apply to every platform unless tagged to one.
import { admin } from './supabase'
import { getVoice, winnersBlock } from './voice'
import { voiceBlock, brandBriefBlock, feedbackBlock, antiRepetition } from './prompts'
import { brandContextBlock } from './brand-context'
import { trendingBlock } from './trends'
import { activeAccount, accountProfile } from './account-scope'

// Durable learnings: this account's own learnings + cross-account (null-account)
// learnings, this-platform + cross-platform, strongest signal first.
export async function getInsights(userId, platform = null, limit = 12, account = null) {
  const { data } = await admin.from('brand_memory')
    .select('kind, platform, text, weight, x_connection_id, social_account_id')
    .eq('user_id', userId).eq('active', true)
    .order('weight', { ascending: false }).order('updated_at', { ascending: false })
    .limit(60)
  const forAccount = r => {
    if (!r.x_connection_id && !r.social_account_id) return true // cross-account default
    if (account?.kind === 'x') return r.x_connection_id === account.id
    if (account?.kind === 'social') return r.social_account_id === account.id
    return false // an account-scoped row when we don't know the account → skip
  }
  return (data || [])
    .filter(forAccount)
    .filter(r => !platform || !r.platform || r.platform === platform)
    .slice(0, limit)
}

// Prompt block for the durable learnings.
export function insightsBlock(insights) {
  if (!insights?.length) return ''
  const fmt = r => `- ${String(r.text).replace(/\s+/g, ' ').trim()}${r.platform ? ` [${r.platform}]` : ''}`
  return `\n\nWHAT'S WORKING FOR THIS PERSON — learned from their own engagement, comments, and the trends in their niche (apply these, they beat generic best-practice):\n${insights.map(fmt).join('\n')}`
}

// Assemble the whole brain once. Returns the raw pieces AND helpers that render
// the prompt blocks in the canonical order every surface expects:
//   <voice()>  +  <rubric (caller supplies)>  +  <memoryBlock()>  +  <antiRepetition()>
// memoryBlock is everything that follows the platform rubric: intent (brief),
// durable learnings, thumbs feedback, proven winners, cross-account coherence,
// and live trends. Toggle parts off when a surface doesn't want them.
export async function getBrandMemory(userId, { platform = null, register = 'post', includeTrends = true, includeContext = true } = {}) {
  // Resolve the active account ONCE and thread it through, so persona, brief, and
  // insights are all this account's identity (with user-level fallback).
  const acct = platform ? await activeAccount(userId, platform) : null
  const [voice, aProf, { data: prof }, insights, trends, context] = await Promise.all([
    getVoice(userId, { platform, account: acct }),
    acct ? accountProfile(acct) : Promise.resolve(null),
    admin.from('profiles').select('brand_brief').eq('id', userId).maybeSingle(),
    getInsights(userId, platform, 12, acct),
    includeTrends ? trendingBlock(userId, platform).catch(() => '') : Promise.resolve(''),
    includeContext ? brandContextBlock(userId).catch(() => '') : Promise.resolve(''),
  ])
  const { persona, fb, recent, winners } = voice
  const brief = aProf?.brand_brief || prof?.brand_brief || null // per-account brief overrides the user default

  const memoryBlock = ({ withTrends = includeTrends, withContext = includeContext } = {}) =>
    [
      brandBriefBlock(brief),
      insightsBlock(insights),
      feedbackBlock(fb),
      winnersBlock(winners),
      withContext ? context : '',
      withTrends ? trends : '',
    ].filter(Boolean).join('')

  return {
    persona, brief, fb, recent, winners, insights, trends, context,
    voice: (reg = register) => voiceBlock(persona, { register: reg }),
    memoryBlock,
    antiRepetition: (opts) => antiRepetition(recent, opts),
  }
}
