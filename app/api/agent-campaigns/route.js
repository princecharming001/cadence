// /api/agent-campaigns — promotion MISSIONS that feeder agents get assigned to.
// A campaign holds what to promote (product, link, brief, intensity); agents
// carry it out in their own personas. CRUD only — agents run themselves.
import { admin, getUser } from '@/lib/supabase'

export const runtime = 'nodejs'

const INTENSITIES = ['subtle', 'balanced', 'loud']

function cleanCampaign(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = String(body.name).slice(0, 80).trim()
  if (body.product !== undefined) patch.product = String(body.product).slice(0, 300).trim()
  if (body.link !== undefined) patch.link = String(body.link || '').slice(0, 300).trim() || null
  if (body.brief !== undefined) patch.brief = String(body.brief || '').slice(0, 600).trim() || null
  if (body.intensity !== undefined) patch.intensity = INTENSITIES.includes(body.intensity) ? body.intensity : 'subtle'
  if (body.active !== undefined) patch.active = !!body.active
  return patch
}

// GET → campaigns with their agents' ids attached
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const [{ data: campaigns }, { data: agents }] = await Promise.all([
    admin.from('agent_campaigns').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
    admin.from('feeder_agents').select('id, campaign_id').eq('user_id', user.id),
  ])
  const byCamp = {}
  for (const a of agents || []) if (a.campaign_id) (byCamp[a.campaign_id] ||= []).push(a.id)
  return Response.json({ campaigns: (campaigns || []).map(c => ({ ...c, agent_ids: byCamp[c.id] || [] })) })
}

// POST { name, product, link?, brief?, intensity? } → create
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const patch = cleanCampaign(body)
  if (!patch.name || !patch.product) return Response.json({ error: 'Give the campaign a name and what to promote.' }, { status: 400 })
  const { data, error } = await admin.from('agent_campaigns')
    .insert({ user_id: user.id, intensity: 'subtle', ...patch }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ campaign: data })
}

// PATCH { id, ...fields } → update / pause / resume
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  const patch = cleanCampaign(body)
  if (patch.name === '') delete patch.name
  if (patch.product === '') delete patch.product
  const { data, error } = await admin.from('agent_campaigns')
    .update(patch).eq('id', body.id).eq('user_id', user.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ campaign: data })
}

// DELETE { id } → remove the mission; agents stay (campaign_id nulls via FK)
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  await admin.from('agent_campaigns').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
