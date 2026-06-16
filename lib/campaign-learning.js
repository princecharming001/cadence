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
import { engScore, MIN_IMPRESSION_FLOOR } from './weights'

const squash = s => String(s || '').replace(/\s+/g, ' ').trim()

// A post's metrics keep moving for hours after it goes out; only finalize a
// bandit-arm outcome once they've settled, so we never reward on half-formed
// numbers and never reward the same post twice (the post is then stamped
// arm_rewarded_at). 24h captures the bulk of engagement on every platform.
const SETTLE_MS = 24 * 3600e3
// Within ±this fraction of the platform median is the noise band: the post is
// indistinguishable from typical, so it must NOT move the arm either way
// (effect-size gate — prevents a random walk of posteriors when the true effect
// is zero). It also subsumes the old strict-'>' anti-leakage rule.
const EFFECT_BAND = 0.15

// pth quantile of an ascending-sorted array (linear interpolation). null if empty.
function quantile(sorted, q) {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), frac = pos - lo
  return sorted[lo + 1] !== undefined ? sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]) : sorted[lo]
}

// Reward: reach-normalized when we have a trustworthy impression count, else raw
// (flagged low-confidence). `rate` is the comparable cross-post signal. The floor
// is per-platform and adaptive — a lucky 60-impression post isn't a "winner" for
// a large account, and a real 40-impression post isn't noise for a nano account.
function reward(p, floor) {
  const e = engScore(p)
  const impr = Number(p.impressions) || 0
  if (impr >= (floor || MIN_IMPRESSION_FLOOR)) return { rate: e / impr, raw: e, trusted: true }
  return { rate: null, raw: e, trusted: false }
}

// Per-platform adaptive impression floor: max(MIN, P10 of that platform's posts).
// Adaptive only TIGHTENS (P10 of a high-reach account raises the bar so a fluke
// low-reach post can't be a "winner"); it never drops below MIN, so noise on a
// small account still can't qualify.
function platformFloors(rows) {
  const byPlat = {}
  for (const p of rows) {
    const impr = Number(p.impressions) || 0
    if (impr > 0) (byPlat[p.platform || 'x'] ||= []).push(impr)
  }
  const floors = {}
  for (const k in byPlat) {
    const sorted = byPlat[k].sort((a, b) => a - b)
    floors[k] = Math.max(MIN_IMPRESSION_FLOOR, Math.round(quantile(sorted, 0.10) || 0))
  }
  return floors
}

// Per-platform median of trusted rates, with high-side IQR outlier rejection so a
// single lucky viral post can't ratchet the whole platform's win-threshold up and
// make every normal post register as a "loss". The bar a post must beat is its
// OWN platform's typical, not the campaign-wide mix.
function medianByPlatform(trusted) {
  const byPlat = {}
  for (const s of trusted) (byPlat[s.platform || 'x'] ||= []).push(s._r.rate)
  const out = {}
  for (const k in byPlat) {
    const rates = byPlat[k].sort((a, b) => a - b)
    const q1 = quantile(rates, 0.25), q3 = quantile(rates, 0.75)
    const hi = q1 != null && q3 != null ? q3 + 1.5 * (q3 - q1) : Infinity
    const kept = rates.filter(r => r <= hi)
    const use = kept.length ? kept : rates
    out[k] = quantile(use, 0.5)
  }
  return out
}

async function gatherSignal(campaignId, userId) {
  const { data: posts } = await admin.from('posts')
    .select('id, content, platform, likes, replies, reposts, impressions, feeder_agent_id, posted_at, arm_rewarded_at, campaign_arm')
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
  const floors = platformFloors(rows)
  const scored = rows.map(p => ({ ...p, _r: reward(p, floors[p.platform || 'x']), _persona: names[p.feeder_agent_id] || '' }))
  // Rank by trusted rate when enough posts have real reach; else by raw engagement.
  const trusted = scored.filter(s => s._r.trusted)
  const useRate = trusted.length >= 3
  const key = s => (useRate ? (s._r.rate ?? -1) : s._r.raw)
  const ranked = [...scored].sort((a, b) => key(b) - key(a))
  const top = ranked.slice(0, 8)
  const bottom = ranked.slice(-6).filter(p => !top.includes(p))
  // Per-platform medians are the arm thresholds; the global median is kept only as
  // a coarse display/back-compat signal.
  const medianRateByPlatform = medianByPlatform(trusted)
  const allRates = trusted.map(s => s._r.rate).sort((a, b) => a - b)
  const medianRate = quantile(allRates, 0.5)
  const summary = await campaignSentimentSummary(campaignId).catch(() => ({ total: 0 }))
  return { top, bottom, summary, total: rows.length, useRate, scored, medianRate, medianRateByPlatform, floors }
}

// Reward the bandit arms — ONCE per post, after its metrics have settled.
//
// A post wins (alpha++) if its reach-normalized rate beats its PLATFORM median by
// more than the noise band, loses (beta++) if it falls below by more than the
// band, and is a no-op inside the band (effect-size gate). Every post we finalize
// is stamped arm_rewarded_at so a later learning run can never re-reward it —
// without this, a post's posterior was bumped on EVERY run, inflating certainty
// and starving exploration (the core live bug). Only settled (>=24h) trusted-reach
// posts with an angle_lens tag are eligible.
async function rewardArms(campaignId, signal) {
  const byPlat = signal.medianRateByPlatform || {}
  const now = Date.now()
  const eligible = (signal.scored || []).filter(p =>
    p._r?.trusted && p.campaign_arm?.angle_lens && !p.arm_rewarded_at && p.id &&
    p.posted_at && (now - new Date(p.posted_at).getTime()) >= SETTLE_MS)
  const finalized = []
  for (const p of eligible) {
    const med = byPlat[p.platform || 'x']
    if (med == null || !(med > 0)) continue // no platform threshold yet → leave unstamped, revisit next run
    let success
    if (p._r.rate > med * (1 + EFFECT_BAND)) success = true
    else if (p._r.rate < med * (1 - EFFECT_BAND)) success = false
    else { finalized.push(p.id); continue } // within noise band: settled, but don't move the arm
    await recordArmOutcome(campaignId, p.platform || 'x', 'angle_lens', p.campaign_arm.angle_lens, success, p._r.rate)
    finalized.push(p.id)
  }
  if (finalized.length) {
    await admin.from('posts').update({ arm_rewarded_at: new Date(now).toISOString() })
      .in('id', finalized).then(() => {}, () => {})
  }
  return finalized.length
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

  // Mutex: only one distill per campaign at a time (two overlapping cron ticks must
  // not both rewrite the same campaign's brain). Lock is self-healing after 5 min.
  if (!(await acquireLock(campaignId, userId))) return { skipped: 'locked' }
  try {
    const signal = await gatherSignal(campaignId, userId)
    if (!signal) { await markLearned(campaignId, userId); return { skipped: 'not enough signal' } }
    await rewardArms(campaignId, signal).catch(() => {}) // bandit posteriors from settled trusted-reach posts (once each)
    const learnings = await distill(signal, campaign)
    // Distill failed/empty → KEEP the existing learnings (never go dark on a bad run).
    if (!learnings.length) { await markLearned(campaignId, userId); return { skipped: 'no learnings' } }

    // Insert-first atomic replace: write the new batch under a fresh run_id, and
    // only THEN delete the prior auto-learned rows. If the insert throws, the old
    // learnings survive untouched (the old delete-then-insert could wipe the brain
    // on any insert hiccup). Manual/trend rows (other sources) are never touched.
    const runId = (globalThis.crypto?.randomUUID?.() || `run-${Date.now()}-${Math.round(Math.random() * 1e9)}`)
    const { error: insErr } = await admin.from('campaign_memory').insert(learnings.map(l => ({
      user_id: userId, campaign_id: campaignId, kind: l.kind, platform: l.platform,
      text: l.text, weight: l.weight, source: 'campaign_learning', active: true, run_id: runId,
    })))
    if (insErr) { await markLearned(campaignId, userId); return { skipped: 'insert failed', error: insErr.message } }
    await admin.from('campaign_memory').delete()
      .eq('campaign_id', campaignId).eq('source', 'campaign_learning')
      .or(`run_id.is.null,run_id.neq.${runId}`)
      .then(() => {}, () => {})
    await markLearned(campaignId, userId)
    return { learned: learnings.length, from_posts: signal.total, comments: signal.summary?.total || 0 }
  } finally {
    await releaseLock(campaignId)
  }
}

// 5-minute self-healing mutex on campaign_intel_state. Returns true iff we took
// the lock. The conditional update only succeeds when the row is unlocked or its
// lock is stale, which is the atomic compare-and-set.
async function acquireLock(campaignId, userId) {
  const nowIso = new Date().toISOString()
  const staleIso = new Date(Date.now() - 5 * 60e3).toISOString()
  // Ensure the row exists (without disturbing an existing lock).
  await admin.from('campaign_intel_state')
    .upsert({ campaign_id: campaignId, user_id: userId }, { onConflict: 'campaign_id', ignoreDuplicates: true })
    .then(() => {}, () => {})
  const { data } = await admin.from('campaign_intel_state')
    .update({ learning_lock_at: nowIso })
    .eq('campaign_id', campaignId)
    .or(`learning_lock_at.is.null,learning_lock_at.lt.${staleIso}`)
    .select('campaign_id')
  return !!(data && data.length)
}

async function releaseLock(campaignId) {
  await admin.from('campaign_intel_state').update({ learning_lock_at: null }).eq('campaign_id', campaignId).then(() => {}, () => {})
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
