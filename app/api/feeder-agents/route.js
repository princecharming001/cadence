// /api/feeder-agents — CRUD + run-now + persona re-roll for feeder-account agents.
import { admin, getUser, isCron } from '@/lib/supabase'
import { buildAgentPersona, runDueFeederAgents, runFeederAgentById } from '@/lib/feeder-agents'

export const runtime = 'nodejs'
export const maxDuration = 300 // a think-cycle does several LLM calls + X reads

const EDITABLE = ['interests', 'support_primary', 'posts_per_day', 'replies_per_day', 'interval_hours', 'auto_post', 'active']
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

// GET → the user's agents
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('feeder_agents').select('*').eq('user_id', user.id).order('created_at', { ascending: true })
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
    const { data: conn } = await admin.from('x_connections').select('username').eq('id', agent.x_connection_id).single()
    const persona = await buildAgentPersona({ interests: agent.interests, handle: conn?.username || 'feeder', previous: agent.persona })
    // Fresh identity → fresh memory; keep cycle count for evolution cadence.
    const { data, error } = await admin.from('feeder_agents')
      .update({ persona, name: persona.name, memory: [] }).eq('id', agent.id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ agent: data })
  }

  // Create: one agent per feeder connection, owner-verified.
  if (!body.x_connection_id) return Response.json({ error: 'x_connection_id required' }, { status: 400 })
  const { data: conn } = await admin.from('x_connections')
    .select('id, username, is_primary').eq('id', body.x_connection_id).eq('user_id', user.id).single()
  if (!conn) return Response.json({ error: 'That X account is not connected.' }, { status: 404 })
  if (conn.is_primary) return Response.json({ error: 'Agents run on feeder accounts — your primary stays yours.' }, { status: 400 })

  const interests = String(body.interests || '').slice(0, 400)
  const persona = await buildAgentPersona({ interests, handle: conn.username })
  const { data, error } = await admin.from('feeder_agents').insert({
    user_id: user.id, x_connection_id: conn.id, interests,
    persona, name: persona.name,
    active: false, // armed explicitly by the user
  }).select().single()
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
