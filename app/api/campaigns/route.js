// Marketing campaigns CRUD + manual run, scoped to the authenticated user.
import { admin, getUser } from '@/lib/supabase'
import { runDueCampaigns } from '@/lib/campaigns'

const FIELDS = ['name', 'topic', 'link', 'connection_ids', 'interval_hours', 'posts_per_run', 'include_image', 'active']

function clean(body) {
  const patch = {}
  for (const k of FIELDS) if (body[k] !== undefined) patch[k] = body[k]
  if (patch.interval_hours !== undefined) patch.interval_hours = Math.max(1, Number(patch.interval_hours) || 24)
  if (patch.posts_per_run !== undefined) patch.posts_per_run = Math.min(5, Math.max(1, Number(patch.posts_per_run) || 1))
  if (patch.connection_ids !== undefined && !Array.isArray(patch.connection_ids)) patch.connection_ids = []
  return patch
}

// GET /api/campaigns → user's campaigns
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('campaigns').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  return Response.json({ campaigns: data || [] })
}

// POST /api/campaigns                  → create
// POST /api/campaigns { action:'run' } → run all due campaigns now (Bearer CRON_SECRET, or the owner)
export async function POST(req) {
  const body = await req.json().catch(() => ({}))

  if (body.action === 'run') {
    const auth = req.headers.get('authorization') || ''
    if (auth === `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json(await runDueCampaigns())
    }
    const user = await getUser(req)
    if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
    return Response.json(await runDueCampaigns())
  }

  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const patch = clean(body)
  if (!patch.name || !patch.topic) return Response.json({ error: 'Name and what-to-promote are required.' }, { status: 400 })
  // If active on creation, make it due immediately so the first batch goes out.
  const next_run_at = patch.active ? new Date().toISOString() : null
  const { data, error } = await admin.from('campaigns')
    .insert({ ...patch, user_id: user.id, next_run_at }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ campaign: data })
}

// PATCH /api/campaigns { id, ...fields } → update (e.g. toggle active)
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  const patch = clean(body)
  // Turning a campaign on schedules its first run for now.
  if (patch.active === true) patch.next_run_at = new Date().toISOString()
  const { data, error } = await admin.from('campaigns')
    .update(patch).eq('id', body.id).eq('user_id', user.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ campaign: data })
}

// DELETE /api/campaigns { id }
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  await admin.from('campaigns').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
