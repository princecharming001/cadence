// lib/campaigns.js — X marketing campaigns. A campaign promotes one thing (a
// topic, product, or link); while it's ACTIVE, Cadence keeps writing on-brand
// posts about it and queues them across the user's chosen X accounts on a
// cadence.
//
// Activating a campaign is the user's explicit, standing permission for it to
// queue posts — nothing here ever runs for an inactive campaign. Runs are
// CLAIM-FIRST (see lib/engine.js): next_run_at advances at claim time, so a
// crash can never produce a hot retry loop, and overlapping triggers (cron +
// run-now) can never double-generate a batch.
import { admin } from './supabase'
import { generateJson } from './llm'
import { voiceBlock, feedbackBlock, antiRepetition, PROMO_RUBRIC, X_RUBRIC, enforceLen } from './prompts'
import { getVoice } from './voice'
import { generateImage } from './images'
import { claimEngineRow, dueRows, setEngineStatus } from './engine'

const TABLE = 'campaigns'
const setStatus = (id, detail, running) => setEngineStatus(TABLE, id, detail, running)

// Write N distinct promo tweets for a campaign, in the user's voice, applying
// learned thumbs feedback. Returns an array of strings (<=280 each).
export async function writeCampaignTweets(campaign, { persona, fb, recentForCampaign, n = 1 }) {
  const out = await generateJson({
    system: `You write X (Twitter) posts that promote something WITHOUT sounding like an ad.

${voiceBlock(persona)}

${X_RUBRIC}

${PROMO_RUBRIC}${feedbackBlock(fb)}

Write exactly ${n} DISTINCT posts (<=280 chars each) promoting the campaign below. Vary the angle: educational, behind-the-scenes, contrarian, social proof. ${campaign.link ? `You may include the link ${campaign.link} in at most ONE of them.` : ''}`,
    user: `CAMPAIGN: ${campaign.name}\nWHAT TO PROMOTE:\n${campaign.topic}${campaign.link ? `\nLINK: ${campaign.link}` : ''}${antiRepetition(recentForCampaign, { limit: 12 })}\n\nWrite ${n} fresh promo posts.`,
    schema: {
      type: 'object',
      properties: { posts: { type: 'array', items: { type: 'string' }, description: `${n} distinct tweet texts` } },
      required: ['posts'],
    },
    maxTokens: 1200, toolName: 'emit_posts',
  }).catch(() => ({ posts: [] }))

  const posts = (out.posts || []).filter(t => typeof t === 'string' && t.trim()).slice(0, n)
  return Promise.all(posts.map(t => enforceLen(t, 'x')))
}

// Run one CLAIMED campaign end to end, reporting progress as it goes. Generates
// promo posts and QUEUES them across the campaign's chosen accounts; the normal
// poster publishes them when due.
async function processCampaign(c) {
  const nowMs = Date.now()
  const intervalMs = (Number(c.interval_hours) || 24) * 3600 * 1000

  try {
    await setStatus(c.id, 'Starting…', true)

    // Which accounts post for this campaign — chosen ones, else the primary (or
    // all, if no primary is set).
    let connIds = Array.isArray(c.connection_ids) ? c.connection_ids.filter(Boolean) : []
    if (!connIds.length) {
      const { data: conns } = await admin.from('x_connections').select('id, is_primary').eq('user_id', c.user_id)
      const primary = (conns || []).find(x => x.is_primary)
      connIds = primary ? [primary.id] : (conns || []).map(x => x.id)
    }
    if (!connIds.length) { await setStatus(c.id, 'No connected X accounts', false); return { id: c.id, skipped: 'no connected X accounts' } }

    const { persona, fb } = await getVoice(c.user_id)
    const { data: recent } = await admin.from('posts')
      .select('content').eq('campaign_id', c.id).order('created_at', { ascending: false }).limit(15)

    const perRun = Math.min(Math.max(c.posts_per_run || 1, 1), 5)
    await setStatus(c.id, `Writing ${perRun} post${perRun > 1 ? 's' : ''}…`, true)
    const tweets = await writeCampaignTweets(c, {
      persona, fb, recentForCampaign: (recent || []).map(r => r.content), n: perRun,
    })
    if (!tweets.length) { await setStatus(c.id, 'No posts generated — will retry next cycle', false); return { id: c.id, skipped: 'no tweets generated' } }

    const stepMs = intervalMs / tweets.length // stagger the batch across the interval
    let totalQueued = 0

    for (let j = 0; j < tweets.length; j++) {
      let imageUrl = null
      if (c.include_image) {
        await setStatus(c.id, `Generating image ${j + 1} of ${tweets.length}…`, true)
        try { imageUrl = (await generateImage(tweets[j], { fromContent: true })).url } catch {}
      }
      const when = new Date(nowMs + Math.round(j * stepMs)).toISOString()
      const rows = connIds.map(cid => ({
        content: tweets[j], scheduled_for: when, status: 'queued',
        source: 'campaign', user_id: c.user_id, campaign_id: c.id,
        x_connection_id: cid, image_url: imageUrl, platform: 'x',
      }))
      const { data: inserted } = await admin.from('posts').insert(rows).select('id')
      totalQueued += inserted?.length || 0
    }

    await setStatus(c.id, `Queued ${totalQueued} post${totalQueued === 1 ? '' : 's'}`, false)
    return { id: c.id, name: c.name, tweets: tweets.length, accounts: connIds.length, queued: totalQueued }
  } catch (e) {
    await setStatus(c.id, `Error: ${e.message}`, false)
    return { id: c.id, error: e.message }
  }
}

// Run every active campaign that is due. Claim-first per row.
export async function runDueCampaigns() {
  const due = await dueRows(TABLE)
  if (!due.length) return { campaigns: 0, queued: 0, results: [] }
  const results = []
  let totalQueued = 0
  for (const row of due) {
    const c = await claimEngineRow(TABLE, row)
    if (!c) continue // another sweep got it
    const r = await processCampaign(c)
    totalQueued += r.queued || 0
    results.push(r)
  }
  return { campaigns: results.length, queued: totalQueued, results }
}

// Run a single campaign now (the "Run now" button). Respects claims: if the
// campaign is mid-run, says so instead of double-generating.
export async function runCampaignById(id, userId) {
  const { data: row } = await admin.from(TABLE).select('*').eq('id', id).eq('user_id', userId).single()
  if (!row) return { error: 'not found' }
  const c = await claimEngineRow(TABLE, row)
  if (!c) return { error: 'Already running — give it a moment.' }
  return processCampaign(c)
}
