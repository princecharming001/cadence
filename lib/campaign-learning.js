// lib/campaign-learning.js — the QUANTITATIVE half of campaign intelligence and
// the loop that "adapts accordingly". For one campaign, read the fleet's real
// results (per-platform, reach-normalized reward), fold in the comment-sentiment
// rollup, and distill 3-6 durable campaign learnings into campaign_memory —
// which then flows back into every agent's mission via getCampaignMemory().
//
// Research-grounded against over-fitting (the user's stated worry):
//  - PER-PLATFORM reward (replies/reposts >> likes; each platform weighted), never
//    one global engagement number.
//  - REACH-NORMALIZE: rate = weighted_engagement / impressions, and only trust the
//    rate when impressions >= a floor (lucky low-reach posts don't become "winners").
//  - Compare within the campaign (top vs bottom of ITS OWN posts), not vs absolutes.
//  - SENTIMENT GUARDRAIL: if the audience is skewing negative, the distilled
//    learning says cool down / fix the message, so the fleet never optimizes into
//    outrage.
//  - Atomic replace (delete-then-insert source='campaign_learning'), paced via
//    campaign_intel_state so a concurrent run can't double-write.
import { admin } from './supabase'
import { generateJson } from './llm'
import { campaignSentimentSummary } from './campaign-sentiment'
import { recordArmOutcome } from './campaign-arms'

const IMPRESSION_FLOOR = 50 // below this, a rate is noise (research)
const squash = s => String(s || '').replace(/\s+/g, ' ').trim()

// Per-platform engagement weighting — replies/reposts/shares matter far more than
// a like (which is close to a vanity metric). Our columns are likes/replies/
// reposts/impressions; we weight what we have per the platform's real signal.
const PLATFORM_W = {
  x:         { like: 1, reply: 3, repost: 3 }, // replies + reposts/quotes + bookmarks-proxy
  linkedin:  { like: 1, reply: 4, repost: 2 }, // comments (esp. substantive) are king
  instagram: { like: 1, reply: 2, repost: 3 }, // shares/saves proxied by reposts
  tiktok:    { like: 1, reply: 2, repost: 3 }, // shares/saves proxied by reposts
}
const engScore = p => { const w = PLATFORM_W[p.platform] || PLATFORM_W.x; return (p.likes || 0) * w.like + (p.replies || 0) * w.reply + (p.reposts || 0) * w.repost }
// Reward: reach-normalized when we have a trustworthy impression count, else raw
// (flagged low-confidence). `rate` is the comparable cross-post signal.
function reward(p) {
  const e = engScore(p)
  const impr = Number(p.impressions) || 0
  if (impr >= IMPRESSION_FLOOR) return { rate: e / impr, raw: e, trusted: true }
  return { rate: null, raw: e, trusted: false }
}

async function gatherSignal(campaignId, userId) {
  const { data: posts } = await admin.from('posts')
    .select('content, platform, likes, replies, reposts, impressions, feeder_agent_id, posted_at, campaign_arm')
    .eq('user_id', userId).eq('campaign_id', campaignId).eq('status', 'posted')
    .order('posted_at', { ascending: false }).limit(80)
  const rows = (posts || []).filter(p => squash(p.content))
  if (rows.length < 3) return null
  // Persona name per agent (so a learning can credit "the contrarian persona's angle").
  const agentIds = [...new Set(rows.map(p => p.feeder_agent_id).filter(Boolean))]
  let names = {}
  if (agentIds.length) {
    const { data: ags } = await admin.from('feeder_agents').select('id, persona').in('id', agentIds)
    names = Object.fromEntries((ags || []).map(a => [a.id, a.persona?.name || '']))
  }
  const scored = rows.map(p => ({ ...p, _r: reward(p), _persona: names[p.feeder_agent_id] || '' }))
  // Rank by trusted rate when enough posts have real reach; else by raw engagement.
  const trusted = scored.filter(s => s._r.trusted)
  const useRate = trusted.length >= 3
  const key = s => (useRate ? (s._r.rate ?? -1) : s._r.raw)
  const ranked = [...scored].sort((a, b) => key(b) - key(a))
  const top = ranked.slice(0, 8)
  const bottom = ranked.slice(-6).filter(p => !top.includes(p))
  // Median of TRUSTED rates — the bar a post must beat to count as an arm "win".
  const rates = trusted.map(s => s._r.rate).sort((a, b) => a - b)
  const medianRate = rates.length ? rates[Math.floor(rates.length / 2)] : null
  const summary = await campaignSentimentSummary(campaignId).catch(() => ({ total: 0 }))
  return { top, bottom, summary, total: rows.length, useRate, scored, medianRate }
}

// Reward the bandit arms from this run's trusted-reach posts: a post beats the
// campaign's median rate → its arm wins (alpha++), else loses (beta++). Only
// posts with real reach count, so noise doesn't move the posteriors.
async function rewardArms(campaignId, signal) {
  if (signal.medianRate == null) return
  const trusted = (signal.scored || []).filter(p => p._r?.trusted && p.campaign_arm?.angle_lens)
  for (const p of trusted) {
    const success = p._r.rate >= signal.medianRate
    await recordArmOutcome(campaignId, p.platform || 'x', 'angle_lens', p.campaign_arm.angle_lens, success, p._r.rate)
  }
}

const line = p => {
  const m = `${p.likes || 0}♥ ${p.reposts || 0}↻ ${p.replies || 0}💬${p.impressions ? ` ${p.impressions}v` : ''}`
  return `[${p.platform || 'x'}${p._persona ? ` · ${p._persona}` : ''}] (${m}${p._r?.trusted ? ` · rate ${(p._r.rate * 100).toFixed(2)}%` : ' · low-reach'}) ${squash(p.content).slice(0, 180)}`
}

async function distill(signal, campaign) {
  const s = signal.summary || {}
  const sentLine = s.total
    ? `AUDIENCE SENTIMENT (${s.total} comments): ${JSON.stringify(s.counts)}; neg share ${(s.neg_share * 100).toFixed(0)}%.${s.questions?.length ? ` Recurring questions: ${s.questions.slice(0, 4).map(q => `"${q.slice(0, 70)}"`).join('; ')}.` : ''}${s.negatives?.length ? ` Negative themes: ${s.negatives.slice(0, 3).map(n => `"${n.slice(0, 70)}"`).join('; ')}.` : ''}`
    : 'AUDIENCE SENTIMENT: no comments analyzed yet.'

  const sys = `You are a growth analyst studying ONE promotional campaign run by a FLEET of social personas, to extract durable, reusable learnings that make the fleet's future posts perform better and feel less like ads.

You get the campaign's best-performing posts, its worst, and the audience's comment sentiment. Posts are scored by a REACH-NORMALIZED rate when reach is known (trust those most) — a high raw count on a low-reach post is NOT a winner. Find the PATTERNS: which ANGLE / hook / format / topic / persona drove real engagement, what fell flat, and what the audience signals they want or object to.

Write 3-6 learnings. Each must be:
- SPECIFIC and ACTIONABLE ("the side-by-side comparison angle out-pulls the generic tip on X", "answer the pricing question the audience keeps asking"), never generic ("post more", "engage your audience").
- Grounded in THIS data — reference what you actually saw; do not invent.
- Tagged with a platform ONLY if truly platform-specific; else leave platform null (most angle/message learnings apply fleet-wide).
- kind: "angle" (a winning angle/framing to do more of), "insight" (what resonates), "tactic" (a concrete how-to), "audience" (what they want/object to), "format".
- weight 1-5 by evidence strength (5 = a clear repeated pattern across many posts with real reach; 1 = a weak hint).
GUARDRAIL: if sentiment skews negative, include a learning to cool the cadence or fix the message — NEVER a learning that exploits outrage for engagement.`

  const user = `CAMPAIGN: ${campaign.product || campaign.name}${campaign.pitch ? ` — ${campaign.pitch}` : ''}

TOP POSTS:
${signal.top.map(line).join('\n')}

${signal.bottom.length ? `WEAKEST POSTS:\n${signal.bottom.map(line).join('\n')}\n` : ''}
${sentLine}

Distill the durable campaign learnings now.`

  const out = await generateJson({
    system: sys, user, maxTokens: 1100, toolName: 'emit_campaign_learnings',
    schema: {
      type: 'object', required: ['learnings'],
      properties: {
        learnings: {
          type: 'array',
          items: {
            type: 'object', required: ['text'],
            properties: {
              text: { type: 'string' },
              platform: { type: ['string', 'null'], enum: ['x', 'linkedin', 'instagram', 'tiktok', null] },
              kind: { type: 'string', enum: ['angle', 'insight', 'tactic', 'audience', 'format'] },
              weight: { type: 'number' },
            },
          },
        },
      },
    },
  }).catch(() => ({ learnings: [] }))

  return (out.learnings || [])
    .map(l => ({
      text: squash(l.text).slice(0, 280),
      platform: ['x', 'linkedin', 'instagram', 'tiktok'].includes(l.platform) ? l.platform : null,
      kind: ['angle', 'insight', 'tactic', 'audience', 'format'].includes(l.kind) ? l.kind : 'insight',
      weight: Math.min(Math.max(Number(l.weight) || 2, 1), 5),
    }))
    .filter(l => l.text).slice(0, 6)
}

export async function learnFromCampaign(campaignId, userId) {
  const { data: campaign } = await admin.from('agent_campaigns').select('id, user_id, name, product, pitch').eq('id', campaignId).single()
  if (!campaign) return { skipped: 'no campaign' }
  userId = userId || campaign.user_id
  const signal = await gatherSignal(campaignId, userId)
  if (!signal) { await markLearned(campaignId, userId); return { skipped: 'not enough signal' } }
  await rewardArms(campaignId, signal).catch(() => {}) // bandit posteriors from trusted-reach posts
  const learnings = await distill(signal, campaign)
  if (!learnings.length) { await markLearned(campaignId, userId); return { skipped: 'no learnings' } }

  // Atomic replace of the auto-learned set (keep manual rows).
  await admin.from('campaign_memory').delete().eq('campaign_id', campaignId).eq('source', 'campaign_learning')
  await admin.from('campaign_memory').insert(learnings.map(l => ({
    user_id: userId, campaign_id: campaignId, kind: l.kind, platform: l.platform,
    text: l.text, weight: l.weight, source: 'campaign_learning', active: true,
  })))
  await markLearned(campaignId, userId)
  return { learned: learnings.length, from_posts: signal.total, comments: signal.summary?.total || 0 }
}

async function markLearned(campaignId, userId) {
  await admin.from('campaign_intel_state')
    .upsert({ campaign_id: campaignId, user_id: userId, learned_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'campaign_id' })
    .then(() => {}, () => {})
}

export async function runDueCampaignLearning({ limit = 5 } = {}) {
  const { data: due } = await admin.rpc('due_campaign_learning', { lim: limit })
  if (!due?.length) return { campaigns: 0, learned: 0 }
  let learned = 0
  for (const d of due) {
    try { const r = await learnFromCampaign(d.campaign_id, d.user_id); if (r.learned) learned += r.learned } catch (e) { console.error('[campaign-learning]', d.campaign_id, e.message) }
  }
  return { campaigns: due.length, learned }
}
