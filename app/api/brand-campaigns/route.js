// Cross-platform brand campaigns: CRUD + run-now.
import { admin, getUser } from '@/lib/supabase'
import { runBrandCampaignById } from '@/lib/brand-campaigns'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('brand_campaigns').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  return Response.json({ campaigns: data || [] })
}

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))

  if (b.action === 'run') {
    const r = await runBrandCampaignById(b.id, user.id)
    return Response.json(r)
  }

  const targets = Array.isArray(b.targets) ? b.targets.filter(t => t && t.id && (t.kind === 'x' || t.platform)) : []
  if (!b.name?.trim() || !b.topic?.trim()) return Response.json({ error: 'Name and topic are required.' }, { status: 400 })
  if (!targets.length) return Response.json({ error: 'Pick at least one account to post to.' }, { status: 400 })
  const row = {
    user_id: user.id, name: b.name.trim(), topic: b.topic.trim(), targets,
    carousel_style: b.carousel_style || 'bold', carousel_format: b.carousel_format || 'listicle',
    include_image: !!b.include_image, interval_hours: Number(b.interval_hours) || 24,
    active: b.active !== false, next_run_at: new Date().toISOString(),
  }
  const { data, error } = await admin.from('brand_campaigns').insert(row).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ campaign: data })
}

export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id, ...patch } = await req.json().catch(() => ({}))
  const allow = {}
  for (const k of ['name', 'topic', 'targets', 'carousel_style', 'carousel_format', 'include_image', 'interval_hours', 'active']) if (k in patch) allow[k] = patch[k]
  await admin.from('brand_campaigns').update(allow).eq('id', id).eq('user_id', user.id)
  return Response.json({ ok: true })
}

export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  await admin.from('brand_campaigns').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
