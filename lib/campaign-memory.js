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
// Auto-learned rows DECAY with age (read-time freshness) so a campaign that stops
// learning doesn't keep injecting months-old, possibly-contradicted insights into
// every agent prompt forever; manual/trend rows are user/curated ground truth and
// don't decay. effectiveWeight ranks; very stale low-weight auto rows drop out.
const FRESH_HALF_LIFE_DAYS = 21
export async function getCampaignInsights(campaignId, platform = null, limit = 8) {
  const { data } = await admin.from('campaign_memory')
    .select('kind, platform, text, weight, source, updated_at')
    .eq('campaign_id', campaignId).eq('active', true)
    .order('weight', { ascending: false }).order('updated_at', { ascending: false }).limit(40)
  const now = Date.now()
  const scored = (data || [])
    .filter(r => !platform || !r.platform || r.platform === platform)
    .map(r => {
      const decays = r.source === 'campaign_learning' || r.source === 'engagement'
      const ageDays = r.updated_at ? (now - new Date(r.updated_at).getTime()) / 864e5 : 0
      const fresh = decays ? Math.pow(0.5, ageDays / FRESH_HALF_LIFE_DAYS) : 1
      return { ...r, _eff: (Number(r.weight) || 1) * fresh }
    })
    // Drop auto rows that have decayed to near-irrelevance (stale + low weight).
    .filter(r => !(r.source === 'campaign_learning' || r.source === 'engagement') || r._eff >= 0.6)
    .sort((a, b) => b._eff - a._eff)
  return scored.slice(0, limit)
}

const INSIGHT_CHARS = 140
export function campaignInsightsBlock(insights) {
  if (!insights?.length) return ''
  const lines = insights.slice(0, 6).map(r => `- ${String(r.text).replace(/\s+/g, ' ').trim().slice(0, INSIGHT_CHARS)}${r.platform ? ` [${r.platform}]` : ''}`)
  return `\n\nWHAT'S WORKING FOR THIS CAMPAIGN — learned from the whole fleet's real results (lean into these; they beat generic guesses):\n${lines.join('\n')}`
}

export function sentimentBlock(summary) {
  if (!summary?.total) return ''
  const total = summary.total
  const counts = summary.counts || {}
  const L = []
  if (summary.questions?.length) L.push(`The audience keeps ASKING about these — answer them in a post: ${summary.questions.slice(0, 4).map(q => `"${q.slice(0, 80)}"`).join(' · ')}`)
  // Negativity warning needs a REAL sample, not a 1-of-4 fluke: require >=12
  // comments AND >=3 actual negatives before telling the fleet to cool down.
  if (total >= 12 && (counts.negative || 0) >= 3 && (summary.neg_share || 0) >= 0.25 && summary.negatives?.length) {
    L.push(`CAUTION — real negative reaction; acknowledge/address rather than ignore (do NOT bait engagement off it): ${summary.negatives.slice(0, 3).map(n => `"${n.slice(0, 80)}"`).join(' · ')}`)
  }
  // Which aspect is drawing the most positive vs negative reaction — only call it
  // when that aspect has enough reactions (>=3) to be more than one person's mood.
  const score = summary.aspect_score || {}
  const best = Object.entries(score).sort((a, b) => (b[1].pos - b[1].neg) - (a[1].pos - a[1].neg))[0]
  const worst = Object.entries(score).sort((a, b) => (a[1].pos - a[1].neg) - (b[1].pos - b[1].neg))[0]
  if (best && best[1].pos >= 3) L.push(`The "${best[0]}" lands best with the audience — keep doing it.`)
  if (worst && worst[1].neg >= 3 && worst[1].neg > best?.[1]?.pos && worst[0] !== best?.[0]) L.push(`The "${worst[0]}" draws the most friction — tighten it.`)
  if (!L.length) return ''
  const note = total < 20 ? ' — small sample so far, treat as directional' : ''
  return `\n\nAUDIENCE SENTIMENT (from real comments on this campaign${note}):\n${L.map(x => `- ${x}`).join('\n')}`
}

// Promo angles the fleet already shipped this week — so each agent takes a fresh one.
export async function recentFleetAngles(campaignId, limit = 6) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString()
  const { data } = await admin.from('posts').select('content')
    .eq('campaign_id', campaignId).eq('is_promo', true).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(limit)
  return (data || []).map(p => String(p.content || '').replace(/\s+/g, ' ').slice(0, 160)).filter(Boolean)
}

export function antiSaturationBlock(angles) {
  if (!angles?.length) return ''
  return `\n\nALREADY IN MARKET this week from the fleet — take a genuinely DIFFERENT angle, do NOT echo these (near-duplicate fleet posts read as a coordinated bot net):\n${angles.slice(0, 5).map(a => `- ${a}`).join('\n')}`
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
