// /api/agent-campaigns — promotion MISSIONS that feeder agents get assigned to.
// A campaign holds a rich, structured brief (objective, audience, pitch, key
// points, do/don't, CTA, link strategy, cadence). Agents are linked MANY-TO-MANY
// via agent_campaign_assignments — one agent can run several campaigns, one
// campaign can have many agents. Posts an agent makes for a campaign are stamped
// (posts.campaign_id/is_promo) so a company can measure what's working.
import { admin, getUser } from '@/lib/supabase'
import { draftCampaignBrief } from '@/lib/campaign-brief'
import { campaignSentimentSummary } from '@/lib/campaign-sentiment'
import { getCampaignInsights } from '@/lib/campaign-memory'
import { topArms } from '@/lib/campaign-arms'
import { engScore } from '@/lib/weights'

export const runtime = 'nodejs'
export const maxDuration = 30

const INTENSITIES = ['subtle', 'balanced', 'loud']
const OBJECTIVES = ['awareness', 'signups', 'installs', 'traffic', 'waitlist', 'launch_buzz']
const LINK_STRATS = ['never', 'occasional', 'cta_only', 'every_promo']
const STATUSES = ['draft', 'active', 'paused', 'ended']
const PLATFORMS = ['x', 'linkedin', 'instagram', 'tiktok']
const slugify = s => String(s || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'campaign'
const strArr = (v, n = 12, cap = 200) => (Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean).slice(0, n).map(x => x.slice(0, cap))

function cleanCampaign(body) {
  const p = {}
  if (body.name !== undefined) p.name = String(body.name).slice(0, 80).trim()
  if (body.product !== undefined) p.product = String(body.product).slice(0, 300).trim()
  if (body.link !== undefined) p.link = String(body.link || '').slice(0, 300).trim() || null
  if (body.brief !== undefined) p.brief = String(body.brief || '').slice(0, 600).trim() || null
  if (body.intensity !== undefined) p.intensity = INTENSITIES.includes(body.intensity) ? body.intensity : 'subtle'
  if (body.objective !== undefined) p.objective = OBJECTIVES.includes(body.objective) ? body.objective : 'awareness'
  if (body.priority !== undefined) p.priority = Math.min(10, Math.max(1, parseInt(body.priority, 10) || 5))
  if (body.platforms !== undefined) p.platforms = (Array.isArray(body.platforms) ? body.platforms : []).filter(x => PLATFORMS.includes(x))
  if (body.audience !== undefined) p.audience = String(body.audience || '').slice(0, 300).trim() || null
  if (body.pitch !== undefined) p.pitch = String(body.pitch || '').slice(0, 300).trim() || null
  if (body.key_points !== undefined) p.key_points = strArr(body.key_points, 6)
  if (body.do_say !== undefined) p.do_say = strArr(body.do_say, 8)
  if (body.dont_say !== undefined) p.dont_say = strArr(body.dont_say, 8)
  if (body.cta !== undefined) p.cta = String(body.cta || '').slice(0, 160).trim() || null
  if (body.link_strategy !== undefined) p.link_strategy = LINK_STRATS.includes(body.link_strategy) ? body.link_strategy : 'occasional'
  if (body.hashtags !== undefined) p.hashtags = strArr(body.hashtags, 8, 40).map(h => h.replace(/^#/, ''))
  if (body.weekly_promo_target !== undefined) p.weekly_promo_target = Math.min(200, Math.max(0, parseInt(body.weekly_promo_target, 10) || 0))
  if (body.max_promo_share !== undefined) p.max_promo_share = Math.min(1, Math.max(0.1, Number(body.max_promo_share) || 0.5))
  if (body.starts_at !== undefined) p.starts_at = body.starts_at || null
  if (body.ends_at !== undefined) p.ends_at = body.ends_at || null
  if (body.status !== undefined && STATUSES.includes(body.status)) { p.status = body.status; p.active = body.status === 'active' }
  if (body.active !== undefined && body.status === undefined) { p.active = !!body.active; p.status = body.active ? 'active' : 'paused' }
  return p
}

// Keep the deprecated feeder_agents.campaign_id scalar pointing at one of the
// agent's live assignments (back-compat for one release; join table is truth).
async function syncMirror(userId, agentId) {
  const { data } = await admin.from('agent_campaign_assignments').select('campaign_id').eq('feeder_agent_id', agentId).order('created_at', { ascending: false }).limit(1)
  await admin.from('feeder_agents').update({ campaign_id: data?.[0]?.campaign_id || null }).eq('id', agentId).eq('user_id', userId)
}

// Roll campaign performance up from attributed posts (the metrics spine) — now
// reach-normalized (engagement RATE, not raw counts) and enriched with the
// intelligence layer: per-platform + per-agent rates with each agent's best post,
// the audience-sentiment distribution, the leading bandit arms, and the distilled
// "what's working" insights. This is the campaign intelligence DASHBOARD payload.
// Use the SHARED per-platform weights (lib/weights.js) so the dashboard scores a
// post exactly as the bandit-reward loop does — otherwise "what's winning" on
// screen disagrees with what the bandit learns, and the operator optimizes against
// a different number than the system does.
const eng = engScore
const rate = r => (Number(r.impressions) || 0) >= 50 ? eng(r) / r.impressions : null

async function campaignMetrics(userId, campaignId) {
  const since = new Date(Date.now() - 7 * 24 * 3600e3).toISOString()
  // Only POSTED posts count: drafts/failed/rendering have no real reach and would
  // deflate eng_rate (denominator) and inflate post counts (the learning loop also
  // reads status='posted', so this keeps the two populations identical).
  const { data: posts } = await admin.from('posts')
    .select('feeder_agent_id, is_promo, status, likes, replies, reposts, impressions, platform, content, created_at, posted_at')
    .eq('user_id', userId).eq('campaign_id', campaignId).eq('status', 'posted')
  const rows = posts || []
  const sum = (k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0)
  const rateOf = (e, i) => i >= 50 ? +(e / i * 100).toFixed(2) : null

  const byAgent = {}
  for (const r of rows) {
    const a = (byAgent[r.feeder_agent_id] ||= { posts: 0, promo: 0, likes: 0, replies: 0, reposts: 0, impressions: 0, _eng: 0, best: null })
    a.posts++; if (r.is_promo) a.promo++
    a.likes += Number(r.likes) || 0; a.replies += Number(r.replies) || 0; a.reposts += Number(r.reposts) || 0; a.impressions += Number(r.impressions) || 0; a._eng += eng(r)
    const pr = rate(r)
    if (pr != null && (!a.best || pr > a.best.rate)) a.best = { rate: +(pr * 100).toFixed(2), content: String(r.content || '').slice(0, 120), likes: r.likes || 0, replies: r.replies || 0, impressions: r.impressions || 0 }
  }
  for (const id in byAgent) { const a = byAgent[id]; a.eng_rate = rateOf(a._eng, a.impressions); delete a._eng }

  const byPlatform = {}
  for (const r of rows) {
    const p = (byPlatform[r.platform || 'x'] ||= { posts: 0, impressions: 0, _eng: 0 })
    p.posts++; p.impressions += Number(r.impressions) || 0; p._eng += eng(r)
  }
  for (const k in byPlatform) { const p = byPlatform[k]; p.eng_rate = rateOf(p._eng, p.impressions); delete p._eng }

  // Time-of-day breakdown (4 six-hour UTC windows) so the operator can see when
  // results are timing-driven vs angle-driven. concentration = share of posts in
  // the busiest window; high concentration means angle comparisons are confounded.
  const WINDOWS = ['00–06', '06–12', '12–18', '18–24']
  const byHour = {}
  for (const r of rows) {
    if (!r.posted_at) continue
    const w = WINDOWS[Math.floor(new Date(r.posted_at).getUTCHours() / 6)]
    const h = (byHour[w] ||= { posts: 0, impressions: 0, _eng: 0 })
    h.posts++; h.impressions += Number(r.impressions) || 0; h._eng += eng(r)
  }
  let timed = 0
  for (const k in byHour) { const h = byHour[k]; h.eng_rate = rateOf(h._eng, h.impressions); delete h._eng; timed += h.posts }
  const timingConcentration = timed ? +(Math.max(0, ...Object.values(byHour).map(h => h.posts)) / timed).toFixed(2) : null

  const { count: clicks } = await admin.from('campaign_clicks').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId)
  const [sentiment, arms, insights] = await Promise.all([
    campaignSentimentSummary(campaignId).catch(() => ({ total: 0 })),
    topArms(campaignId).catch(() => []),
    getCampaignInsights(campaignId, null, 8).catch(() => []),
  ])
  return {
    posts: rows.length,
    promo_posts: rows.filter(r => r.is_promo).length,
    promo_7d: rows.filter(r => r.is_promo && r.created_at >= since).length,
    impressions: sum('impressions'), likes: sum('likes'), replies: sum('replies'), reposts: sum('reposts'),
    eng_rate: rateOf(rows.reduce((n, r) => n + eng(r), 0), sum('impressions')),
    clicks: clicks || 0,
    by_agent: byAgent, by_platform: byPlatform,
    by_hour: byHour, timing_concentration: timingConcentration,
    sentiment, top_arms: arms, insights,
  }
}

// GET → campaigns + agent_ids (from the JOIN table). ?metrics=1 adds a perf roll-up.
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const wantMetrics = new URL(req.url).searchParams.get('metrics') === '1'
  const [{ data: campaigns }, { data: assigns }] = await Promise.all([
    admin.from('agent_campaigns').select('*').eq('user_id', user.id).neq('status', 'ended').order('created_at', { ascending: true }),
    admin.from('agent_campaign_assignments').select('campaign_id, feeder_agent_id, weight, intensity, role, paused, promo_count, last_promo_at').eq('user_id', user.id),
  ])
  const byCamp = {}
  for (const a of assigns || []) (byCamp[a.campaign_id] ||= []).push(a)
  const out = await Promise.all((campaigns || []).map(async c => ({
    ...c,
    agent_ids: (byCamp[c.id] || []).map(a => a.feeder_agent_id),
    assignments: byCamp[c.id] || [],
    ...(wantMetrics ? { metrics: await campaignMetrics(user.id, c.id) } : {}),
  })))
  return Response.json({ campaigns: out })
}

// POST: create | draft | assign | unassign | set-assignment
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  if (body.action === 'draft') {
    try {
      // Fold in the company's saved brand brief so drafts stay on-brand + consistent
      // across campaigns (the thorough-onboarding payoff).
      const { data: prof } = await admin.from('profiles').select('brand_brief').eq('id', user.id).maybeSingle()
      return Response.json({ draft: await draftCampaignBrief({ product: body.product, link: body.link, company: prof?.brand_brief || null }) })
    } catch { return Response.json({ error: 'Could not draft that — fill it in manually.' }, { status: 200 }) }
  }

  // Many-to-many assignment management.
  if (body.action === 'assign') {
    const { data: camp } = await admin.from('agent_campaigns').select('id, platforms').eq('id', body.campaign_id).eq('user_id', user.id).single()
    if (!camp) return Response.json({ error: 'Campaign not found.' }, { status: 404 })
    const ids = Array.isArray(body.agent_ids) ? body.agent_ids : (body.agent_id ? [body.agent_id] : [])
    if (!ids.length) return Response.json({ error: 'Pick at least one agent.' }, { status: 400 })
    const { data: agents } = await admin.from('feeder_agents').select('id, platform').eq('user_id', user.id).in('id', ids)
    const plats = (camp.platforms || []).filter(Boolean)
    const ok = (agents || []).filter(a => !plats.length || plats.includes(a.platform || 'x'))
    if (!ok.length) return Response.json({ error: 'Those agents don\'t match the campaign\'s platforms.' }, { status: 400 })
    await admin.from('agent_campaign_assignments').upsert(
      ok.map(a => ({ user_id: user.id, feeder_agent_id: a.id, campaign_id: camp.id })),
      { onConflict: 'feeder_agent_id,campaign_id', ignoreDuplicates: true })
    for (const a of ok) await syncMirror(user.id, a.id)
    return Response.json({ assigned: ok.length })
  }
  if (body.action === 'unassign') {
    if (!body.campaign_id || !body.agent_id) return Response.json({ error: 'campaign_id + agent_id required.' }, { status: 400 })
    await admin.from('agent_campaign_assignments').delete().eq('user_id', user.id).eq('campaign_id', body.campaign_id).eq('feeder_agent_id', body.agent_id)
    await syncMirror(user.id, body.agent_id)
    return Response.json({ unassigned: true })
  }
  if (body.action === 'set-assignment') {
    const patch = {}
    if (body.weight !== undefined) patch.weight = Math.min(10, Math.max(1, parseInt(body.weight, 10) || 5))
    if (body.intensity !== undefined) patch.intensity = INTENSITIES.includes(body.intensity) ? body.intensity : null
    if (body.role !== undefined) patch.role = ['promoter', 'supporter', 'seeder'].includes(body.role) ? body.role : 'promoter'
    if (body.paused !== undefined) patch.paused = !!body.paused
    if (!Object.keys(patch).length) return Response.json({ error: 'Nothing to update.' }, { status: 400 })
    const { data, error } = await admin.from('agent_campaign_assignments').update(patch)
      .eq('user_id', user.id).eq('campaign_id', body.campaign_id).eq('feeder_agent_id', body.agent_id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ assignment: data })
  }

  const patch = cleanCampaign(body)
  if (!patch.name || !patch.product) return Response.json({ error: 'Give the campaign a name and what to promote.' }, { status: 400 })
  const row = { user_id: user.id, intensity: 'subtle', status: 'active', active: true, ...patch }
  row.slug = slugify(body.slug || row.name)
  let { data, error } = await admin.from('agent_campaigns').insert(row).select().single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) { row.slug = `${row.slug}-${Date.now().toString(36).slice(-4)}`; const retry = await admin.from('agent_campaigns').insert(row).select().single(); data = retry.data; error = retry.error }
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }
  // Auto-assign agents so the campaign actually runs (a campaign with no agents
  // is inert). Mirrors create_feeder_campaign: every agent on a matching platform
  // joins (many-to-many); no platforms set = all agents. assign_all defaults true.
  let agentsAssigned = 0
  if (body.assign_all !== false) {
    const { data: agents } = await admin.from('feeder_agents').select('id, platform').eq('user_id', user.id)
    const plats = Array.isArray(row.platforms) ? row.platforms : []
    const targets = (agents || []).filter(a => !plats.length || plats.includes(a.platform))
    for (const a of targets) {
      await admin.from('agent_campaign_assignments').upsert({ user_id: user.id, feeder_agent_id: a.id, campaign_id: data.id }, { onConflict: 'feeder_agent_id,campaign_id', ignoreDuplicates: true })
      await admin.from('feeder_agents').update({ campaign_id: data.id }).eq('id', a.id) // deprecated mirror
    }
    agentsAssigned = targets.length
  }
  return Response.json({ campaign: data, agents_assigned: agentsAssigned })
}

// PATCH { id, ...fields } → update / pause / resume / end
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  const patch = cleanCampaign(body)
  if (patch.name === '') delete patch.name
  if (patch.product === '') delete patch.product
  const { data, error } = await admin.from('agent_campaigns').update(patch).eq('id', body.id).eq('user_id', user.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ campaign: data })
}

// DELETE { id } → SOFT delete (status='ended') so attribution/history survive;
// frees the agents by removing their assignments.
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id, hard } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { data: freed } = await admin.from('agent_campaign_assignments').select('feeder_agent_id').eq('user_id', user.id).eq('campaign_id', id)
  await admin.from('agent_campaign_assignments').delete().eq('user_id', user.id).eq('campaign_id', id)
  for (const a of freed || []) await syncMirror(user.id, a.feeder_agent_id)
  if (hard) await admin.from('agent_campaigns').delete().eq('id', id).eq('user_id', user.id)
  else await admin.from('agent_campaigns').update({ status: 'ended', active: false }).eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
