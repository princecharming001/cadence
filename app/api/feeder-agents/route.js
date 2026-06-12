// /api/feeder-agents — CRUD + run-now + persona re-roll for feeder-account agents.
import { admin, getUser, isCron } from '@/lib/supabase'
import { buildAgentPersona, agentAvatar, refreshAgentStats, runDueFeederAgents, runFeederAgentById } from '@/lib/feeder-agents'

export const runtime = 'nodejs'
export const maxDuration = 300 // a think-cycle does several LLM calls + X reads

const EDITABLE = ['interests', 'support_primary', 'posts_per_day', 'replies_per_day', 'interval_hours', 'auto_post', 'active', 'campaign_id']
const clampInt = (v, lo, hi, dflt) => Math.min(hi, Math.max(lo, parseInt(v, 10) || dflt))

function clean(body) {
  const patch = {}
  for (const k of EDITABLE) if (body[k] !== undefined) patch[k] = body[k]
  if (patch.posts_per_day !== undefined) patch.posts_per_day = clampInt(patch.posts_per_day, 0, 6, 2)
  if (patch.replies_per_day !== undefined) patch.replies_per_day = clampInt(patch.replies_per_day, 0, 12, 4)
  if (patch.interval_hours !== undefined) patch.interval_hours = clampInt(patch.interval_hours, 1, 168, 6)
  for (const k of ['support_primary', 'auto_post', 'active']) if (patch[k] !== undefined) patch[k] = !!patch[k]
  if (typeof patch.interests === 'string') patch.interests = patch.interests.slice(0, 400)
  return patch
}

const ZERNIO_PLATFORMS = ['linkedin', 'instagram', 'tiktok']

// GET → the user's agents
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('feeder_agents').select('*').eq('user_id', user.id).order('created_at', { ascending: true })
  // Refresh follower stats / real profile pictures in the background (24h TTL
  // per agent) — this response stays fast; the next poll shows fresh numbers.
  refreshAgentStats(user.id).catch(() => {})
  return Response.json({ agents: data || [] })
}

// POST { x_connection_id, interests }      → spawn an agent (persona generated now)
// POST { action:'run' }                    → cron sweep (Bearer CRON_SECRET) or { action:'run', id } as the owner
// POST { action:'reroll', id }             → regenerate the persona from scratch
export async function POST(req) {
  const body = await req.json().catch(() => ({}))

  if (body.action === 'run') {
    if (isCron(req)) return Response.json(await runDueFeederAgents())
    const user = await getUser(req)
    if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
    if (!body.id) return Response.json({ error: 'Agent id required.' }, { status: 400 })
    return Response.json(await runFeederAgentById(body.id, user.id))
  }

  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  if (body.action === 'reroll') {
    const { data: agent } = await admin.from('feeder_agents').select('*').eq('id', body.id).eq('user_id', user.id).single()
    if (!agent) return Response.json({ error: 'Not found' }, { status: 404 })
    let handle = 'feeder'
    if (agent.x_connection_id) {
      const { data: conn } = await admin.from('x_connections').select('username').eq('id', agent.x_connection_id).single()
      handle = conn?.username || handle
    } else if (agent.social_account_id) {
      const { data: acct } = await admin.from('social_accounts').select('username').eq('id', agent.social_account_id).single()
      handle = acct?.username || handle
    }
    const persona = await buildAgentPersona({ interests: agent.interests, handle, previous: agent.persona, platform: agent.platform || 'x' })
    const avatar = await agentAvatar(persona, user.id) // new face for the new identity
    // Fresh identity → fresh memory; keep cycle count for evolution cadence.
    const { data, error } = await admin.from('feeder_agents')
      .update({ persona, name: persona.name, memory: [], avatar_url: avatar }).eq('id', agent.id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ agent: data })
  }

  // Create: one agent per account, owner-verified. X agents take a feeder
  // x_connection; LinkedIn/IG/TikTok agents take a Zernio social account.
  const interests = String(body.interests || '').slice(0, 400)
  const campaignId = body.campaign_id || null
  if (campaignId) {
    const { data: camp } = await admin.from('agent_campaigns').select('id').eq('id', campaignId).eq('user_id', user.id).single()
    if (!camp) return Response.json({ error: 'Campaign not found.' }, { status: 404 })
  }

  let insert
  if (body.social_account_id) {
    const { data: acct } = await admin.from('social_accounts')
      .select('id, username, platform').eq('id', body.social_account_id).eq('user_id', user.id).single()
    if (!acct) return Response.json({ error: 'That account is not connected.' }, { status: 404 })
    if (!ZERNIO_PLATFORMS.includes(acct.platform)) return Response.json({ error: 'Agents support X, LinkedIn, Instagram, and TikTok accounts.' }, { status: 400 })
    const persona = await buildAgentPersona({ interests, handle: acct.username || acct.platform, platform: acct.platform })
    insert = { user_id: user.id, social_account_id: acct.id, platform: acct.platform, interests, persona, name: persona.name, active: false, support_primary: false, avatar_url: await agentAvatar(persona, user.id) }
  } else {
    if (!body.x_connection_id) return Response.json({ error: 'Pick an account for the agent.' }, { status: 400 })
    const { data: conn } = await admin.from('x_connections')
      .select('id, username, is_primary').eq('id', body.x_connection_id).eq('user_id', user.id).single()
    if (!conn) return Response.json({ error: 'That X account is not connected.' }, { status: 404 })
    if (conn.is_primary) return Response.json({ error: 'Agents run on feeder accounts — your primary stays yours.' }, { status: 400 })
    const persona = await buildAgentPersona({ interests, handle: conn.username })
    insert = { user_id: user.id, x_connection_id: conn.id, platform: 'x', interests, persona, name: persona.name, active: false, avatar_url: await agentAvatar(persona, user.id) }
  }
  if (campaignId) insert.campaign_id = campaignId

  const { data, error } = await admin.from('feeder_agents').insert(insert).select().single()
  if (error) {
    const msg = /duplicate|unique/i.test(error.message) ? 'This account already has an agent.' : error.message
    return Response.json({ error: msg }, { status: 400 })
  }
  return Response.json({ agent: data })
}

// PATCH { id, ...fields } → settings / arm / pause
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  const patch = clean(body)
  // campaign_id: null unassigns; a value must be the user's own campaign.
  if (patch.campaign_id) {
    const { data: camp } = await admin.from('agent_campaigns').select('id').eq('id', patch.campaign_id).eq('user_id', user.id).single()
    if (!camp) return Response.json({ error: 'Campaign not found.' }, { status: 404 })
  }
  if (patch.active === true) patch.next_run_at = new Date().toISOString()
  const { data, error } = await admin.from('feeder_agents')
    .update(patch).eq('id', body.id).eq('user_id', user.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Pausing an agent pauses its not-yet-published queue; resuming releases it.
  if (patch.active === false) {
    await admin.from('posts').update({ status: 'paused' })
      .eq('feeder_agent_id', body.id).eq('user_id', user.id).eq('status', 'queued')
  } else if (patch.active === true) {
    await admin.from('posts').update({ status: 'queued' })
      .eq('feeder_agent_id', body.id).eq('user_id', user.id).eq('status', 'paused')
  }
  return Response.json({ agent: data })
}

// DELETE { id } → remove the agent + its unpublished output (posted stays)
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  await admin.from('posts').delete()
    .eq('feeder_agent_id', id).eq('user_id', user.id).in('status', ['draft', 'queued', 'paused'])
  await admin.from('feeder_agents').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
