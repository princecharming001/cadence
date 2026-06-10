// lib/campaigns.js — marketing campaigns. A campaign promotes one thing (a topic,
// product, or link); while it's ACTIVE, Cadence keeps writing on-brand posts about
// it and queues them across the user's chosen X accounts on a cadence.
//
// Activating a campaign is the user's explicit, standing permission for it to
// queue posts — nothing here ever runs for an inactive campaign.
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'
import { X_RUBRIC } from './rubric'
import { recentFeedback, feedbackBlock } from './feedback'
import { generateImage } from './images'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Write N distinct promo tweets for a campaign, in the user's voice, applying
// learned thumbs feedback. Returns an array of strings (<=280 each).
export async function writeCampaignTweets(campaign, { persona, fb, recentForCampaign, n = 1 }) {
  const voice = persona
    ? `THEIR VOICE\ntone: ${persona.tone}\ntopics: ${(persona.topics || []).join(', ')}\nstyle rules: ${(persona.style_rules || []).join(' | ')}\nsignature moves: ${(persona.signature_moves || []).join(' | ')}`
    : 'Write in a natural, confident, human voice — not corporate or salesy.'

  const avoid = (recentForCampaign || []).length
    ? `\n\nALREADY POSTED for this campaign — do NOT repeat these angles or phrasings:\n${recentForCampaign.slice(0, 12).map(c => `• ${c.slice(0, 140)}`).join('\n')}`
    : ''

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 900,
    system: `You write X (Twitter) posts that promote something, WITHOUT sounding like an ad. Each post should earn attention on its own (insight, hook, story, or hot take) while naturally surfacing what's being promoted.

${voice}

${X_RUBRIC}${feedbackBlock(fb)}

Write exactly ${n} DISTINCT posts promoting the campaign below. Vary the angle (educational, behind-the-scenes, contrarian, social proof, direct CTA). ${campaign.link ? `You may include the link ${campaign.link} in at most one of them.` : ''} Respond with ONLY a JSON array of ${n} tweet strings (use \\n for line breaks), nothing else.`,
    messages: [{ role: 'user', content: `CAMPAIGN: ${campaign.name}\nWHAT TO PROMOTE:\n${campaign.topic}${campaign.link ? `\nLINK: ${campaign.link}` : ''}${avoid}\n\nWrite ${n} fresh promo posts.` }],
  })

  const txt = res.content.find(b => b.type === 'text')?.text || '[]'
  let arr
  try { arr = JSON.parse(txt.replace(/^```json\s*|\s*```$/g, '').trim()) } catch { arr = [] }
  return (Array.isArray(arr) ? arr : [])
    .filter(t => typeof t === 'string' && t.trim())
    .map(t => (t.trim().length > 280 ? t.trim().slice(0, 277).trimEnd() + '…' : t.trim()))
}

// Live status line so the UI can show what a campaign is doing right now.
async function setStatus(id, detail, running) {
  const patch = { status_detail: detail, last_activity_at: new Date().toISOString() }
  if (running !== undefined) patch.running = running
  await admin.from('campaigns').update(patch).eq('id', id)
}

// Run one campaign end to end, reporting progress as it goes. Generates promo
// posts and QUEUES them across the campaign's chosen accounts; the normal poster
// publishes them when due.
async function processCampaign(c) {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const intervalMs = (Number(c.interval_hours) || 24) * 3600 * 1000

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

  const { data: persona } = await admin.from('personas').select('*').eq('user_id', c.user_id).single()
  const fb = await recentFeedback(c.user_id)
  const { data: recent } = await admin.from('posts')
    .select('content').eq('campaign_id', c.id).order('created_at', { ascending: false }).limit(15)

  const perRun = Math.min(Math.max(c.posts_per_run || 1, 1), 5)
  await setStatus(c.id, `Writing ${perRun} post${perRun > 1 ? 's' : ''}…`, true)
  const tweets = await writeCampaignTweets(c, {
    persona, fb, recentForCampaign: (recent || []).map(r => r.content), n: perRun,
  })
  if (!tweets.length) { await setStatus(c.id, 'No posts generated', false); return { id: c.id, skipped: 'no tweets generated' } }

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
      x_connection_id: cid, image_url: imageUrl,
    }))
    const { data: inserted } = await admin.from('posts').insert(rows).select('id')
    totalQueued += inserted?.length || 0
  }

  await admin.from('campaigns').update({
    last_run_at: nowIso, next_run_at: new Date(nowMs + intervalMs).toISOString(), running: false,
  }).eq('id', c.id)
  await setStatus(c.id, `Queued ${totalQueued} post${totalQueued === 1 ? '' : 's'}`, false)
  return { id: c.id, name: c.name, tweets: tweets.length, accounts: connIds.length, queued: totalQueued }
}

// Run every active campaign that is due. Returns a summary.
export async function runDueCampaigns() {
  const nowIso = new Date().toISOString()
  const { data: camps } = await admin
    .from('campaigns').select('*')
    .eq('active', true)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)

  if (!camps?.length) return { campaigns: 0, queued: 0, results: [] }
  const results = []
  let totalQueued = 0
  for (const c of camps) {
    try { const r = await processCampaign(c); totalQueued += r.queued || 0; results.push(r) }
    catch (e) { await setStatus(c.id, `Error: ${e.message}`.slice(0, 200), false); results.push({ id: c.id, error: e.message }) }
  }
  return { campaigns: camps.length, queued: totalQueued, results }
}

// Run a single campaign now, ignoring its schedule (the "Run now" button).
export async function runCampaignById(id, userId) {
  const { data: c } = await admin.from('campaigns').select('*').eq('id', id).eq('user_id', userId).single()
  if (!c) return { error: 'not found' }
  try { return await processCampaign(c) }
  catch (e) { await setStatus(c.id, `Error: ${e.message}`.slice(0, 200), false); return { id: c.id, error: e.message } }
}
