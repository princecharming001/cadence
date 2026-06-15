// lib/campaign-arms.js — the bandit that makes a campaign ADAPT.
//
// Each campaign keeps Beta(alpha,beta) posteriors per content "arm" (an angle
// lens, a hook type, …) per platform. To choose, we Thompson-sample each arm's
// posterior and take the best draw — which both EXPLOITS proven winners and keeps
// EXPLORING (the sampling variance also de-converges fleet agents: each agent's
// draw differs, so they don't all pick the same lens the same hour). The learning
// loop rewards arms (alpha on a win, beta on a loss) only when a post has real
// reach, and applies weekly recency decay so a stale winner fades.
//
// Research priors encode what's known to work so a fresh campaign isn't uniform:
// questions + side-by-side comparisons start ahead of generic angles.
import { admin } from './supabase'

// The angle lenses feeder agents rotate (kept in sync with feeder-agents.js).
export const ANGLE_LENSES = ['a personal story', 'a contrarian take', 'a concrete use-case', 'a question to your peers', 'a side-by-side comparison', 'a behind-the-scenes detail']

// Informative priors [alpha, beta] per lens (research: questions drive replies,
// comparisons out-pull tips; everything else starts mildly positive).
const ANGLE_PRIORS = {
  'a personal story': [2, 1],
  'a contrarian take': [2, 1],
  'a concrete use-case': [2, 1],
  'a question to your peers': [3, 1],
  'a side-by-side comparison': [3, 1],
  'a behind-the-scenes detail': [2, 1],
}
const priorFor = (dimension, value) => (dimension === 'angle_lens' && ANGLE_PRIORS[value]) || [1, 1]

// ── Beta sampler (Marsaglia-Tsang gamma → Beta). Normal app code, Math.random ok.
function gaussian() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
function gammaSample(k) {
  if (k <= 0) return 0
  if (k < 1) return gammaSample(1 + k) * Math.pow(Math.random() || 1e-9, 1 / k)
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d)
  for (let it = 0; it < 64; it++) {
    let x, v
    do { x = gaussian(); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
  return d
}
function betaSample(a, b) { const x = gammaSample(a), y = gammaSample(b); return (x + y) > 0 ? x / (x + y) : 0.5 }

// Thompson-sample the best value for a (campaign, platform, dimension) over the
// given candidate values. Reads stored posteriors, merges priors for unseen arms.
export async function sampleArm(campaignId, platform, dimension, values) {
  const cands = values && values.length ? values : ANGLE_LENSES
  let rows = []
  try {
    const { data } = await admin.from('campaign_arms').select('value, alpha, beta')
      .eq('campaign_id', campaignId).eq('platform', platform).eq('dimension', dimension)
    rows = data || []
  } catch {}
  const stored = Object.fromEntries(rows.map(r => [r.value, r]))
  let best = null, bestDraw = -1
  for (const v of cands) {
    const r = stored[v]
    const [pa, pb] = priorFor(dimension, v)
    const a = r ? Math.max(0.01, r.alpha) : pa
    const b = r ? Math.max(0.01, r.beta) : pb
    const draw = betaSample(a, b)
    if (draw > bestDraw) { bestDraw = draw; best = v }
  }
  return best || cands[0]
}

// Record an outcome for one arm: win → +alpha, loss → +beta. Applies weekly
// recency decay toward the prior before the bump (non-stationary world). Called
// from the campaign-learning loop, only for posts with a trustworthy impression
// count.
export async function recordArmOutcome(campaignId, platform, dimension, value, success, rewardRate) {
  if (!value) return
  const [pa, pb] = priorFor(dimension, value)
  const { data: existing } = await admin.from('campaign_arms').select('alpha, beta, obs, updated_at')
    .eq('campaign_id', campaignId).eq('platform', platform).eq('dimension', dimension).eq('value', value).maybeSingle()
  let alpha = existing ? existing.alpha : pa
  let beta = existing ? existing.beta : pb
  let obs = existing ? existing.obs : 0
  // Weekly decay toward prior: factor 0.7^weeks since last update.
  if (existing?.updated_at) {
    const weeks = (Date.now() - new Date(existing.updated_at).getTime()) / (7 * 864e5)
    if (weeks > 0.5) { const f = Math.pow(0.7, weeks); alpha = pa + (alpha - pa) * f; beta = pb + (beta - pb) * f }
  }
  if (success) alpha += 1; else beta += 1
  obs += 1
  await admin.from('campaign_arms').upsert({
    campaign_id: campaignId, platform, dimension, value,
    alpha, beta, obs, last_reward: rewardRate ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: 'campaign_id,platform,dimension,value' }).then(() => {}, () => {})
}

// For the dashboard: the leading arm per dimension per platform (posterior mean).
export async function topArms(campaignId) {
  const { data } = await admin.from('campaign_arms').select('platform, dimension, value, alpha, beta, obs')
    .eq('campaign_id', campaignId)
  const byKey = {}
  for (const r of data || []) {
    const mean = r.alpha / (r.alpha + r.beta)
    const k = `${r.platform}:${r.dimension}`
    if (!byKey[k] || mean > byKey[k].mean) byKey[k] = { platform: r.platform, dimension: r.dimension, value: r.value, mean, obs: r.obs }
  }
  return Object.values(byKey)
}
