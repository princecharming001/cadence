// lib/campaign-memory.js — THE shared context layer across a campaign's fleet.
//
// Every feeder agent on a campaign calls into this so the whole fleet shares one
// brain: what's working for THIS campaign (durable learnings), what the audience
// is saying (sentiment + recurring questions + negative themes), and what angles
// are ALREADY in market this week (so agents diversify instead of echoing each
// other — both a believability win and an anti-saturation win). Mirrors the
// user-level brand-memory.js, scoped to a campaign_id.
import { admin } from './supabase'
import { campaignSentimentSummary } from './campaign-sentiment'

// Durable campaign learnings: cross-platform rows + this platform's specific ones.
export async function getCampaignInsights(campaignId, platform = null, limit = 12) {
  const { data } = await admin.from('campaign_memory')
    .select('kind, platform, text, weight')
    .eq('campaign_id', campaignId).eq('active', true)
    .order('weight', { ascending: false }).order('updated_at', { ascending: false }).limit(40)
  return (data || []).filter(r => !platform || !r.platform || r.platform === platform).slice(0, limit)
}

export function campaignInsightsBlock(insights) {
  if (!insights?.length) return ''
  return `\n\nWHAT'S WORKING FOR THIS CAMPAIGN — learned from the whole fleet's real results (lean into these; they beat generic guesses):\n${insights.map(r => `- ${String(r.text).replace(/\s+/g, ' ').trim()}${r.platform ? ` [${r.platform}]` : ''}`).join('\n')}`
}

export function sentimentBlock(summary) {
  if (!summary?.total) return ''
  const L = []
  if (summary.questions?.length) L.push(`The audience keeps ASKING about these — answer them in a post: ${summary.questions.slice(0, 4).map(q => `"${q.slice(0, 80)}"`).join(' · ')}`)
  if ((summary.neg_share || 0) >= 0.25 && summary.negatives?.length) L.push(`CAUTION — real negative reaction; acknowledge/address rather than ignore (do NOT bait engagement off it): ${summary.negatives.slice(0, 3).map(n => `"${n.slice(0, 80)}"`).join(' · ')}`)
  // Which aspect is drawing the most positive vs negative reaction.
  const score = summary.aspect_score || {}
  const best = Object.entries(score).sort((a, b) => (b[1].pos - b[1].neg) - (a[1].pos - a[1].neg))[0]
  const worst = Object.entries(score).sort((a, b) => (a[1].pos - a[1].neg) - (b[1].pos - b[1].neg))[0]
  if (best && best[1].pos > 0) L.push(`The "${best[0]}" lands best with the audience — keep doing it.`)
  if (worst && worst[1].neg > best?.[1]?.pos && worst[0] !== best?.[0]) L.push(`The "${worst[0]}" draws the most friction — tighten it.`)
  if (!L.length) return ''
  return `\n\nAUDIENCE SENTIMENT (from real comments on this campaign):\n${L.map(x => `- ${x}`).join('\n')}`
}

// Promo angles the fleet already shipped this week — so each agent takes a fresh one.
export async function recentFleetAngles(campaignId, limit = 10) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString()
  const { data } = await admin.from('posts').select('content')
    .eq('campaign_id', campaignId).eq('is_promo', true).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(limit)
  return (data || []).map(p => String(p.content || '').replace(/\s+/g, ' ').slice(0, 240)).filter(Boolean)
}

export function antiSaturationBlock(angles) {
  if (!angles?.length) return ''
  return `\n\nALREADY IN MARKET this week from the fleet — take a genuinely DIFFERENT angle, do NOT echo these (near-duplicate fleet posts read as a coordinated bot net):\n${angles.map(a => `- ${a}`).join('\n')}`
}

// The whole campaign brain, assembled once. `block()` is appended to a mission's
// prompt for every agent on the campaign.
export async function getCampaignMemory(campaignId, { platform = null } = {}) {
  const [insights, summary, angles] = await Promise.all([
    getCampaignInsights(campaignId, platform),
    campaignSentimentSummary(campaignId).catch(() => ({ total: 0 })),
    recentFleetAngles(campaignId).catch(() => []),
  ])
  return {
    insights, summary, angles,
    block: () => [campaignInsightsBlock(insights), sentimentBlock(summary), antiSaturationBlock(angles)].filter(Boolean).join(''),
  }
}
