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
  // Content types: which media this campaign pushes (IG/TikTok only — X/LinkedIn
  // always get a text post). 'carousel' needs a topic; 'clip' needs source videos.
  const types = (Array.isArray(b.content_types) ? b.content_types : ['carousel']).filter(t => ['carousel', 'clip'].includes(t))
  const contentTypes = types.length ? types : ['carousel']
  const clipSources = (Array.isArray(b.clip_sources) ? b.clip_sources : []).map(s => String(s).trim()).filter(s => /^https?:\/\//.test(s)).slice(0, 20)
  const hasText = targets.some(t => t.kind === 'x' || t.platform === 'linkedin')
  const needsTopic = contentTypes.includes('carousel') || hasText
  if (!b.name?.trim()) return Response.json({ error: 'Give the campaign a name.' }, { status: 400 })
  if (needsTopic && !b.topic?.trim()) return Response.json({ error: 'Add a topic for the carousels/posts to promote.' }, { status: 400 })
  if (contentTypes.includes('clip') && !clipSources.length) return Response.json({ error: 'Add at least one source video link to clip from.' }, { status: 400 })
  if (!targets.length) return Response.json({ error: 'Pick at least one account to post to.' }, { status: 400 })
  const albumIds = (Array.isArray(b.album_ids) ? b.album_ids : []).filter(x => typeof x === 'string').slice(0, 10)
  const row = {
    user_id: user.id, name: b.name.trim(), topic: (b.topic || b.name).trim(), targets,
    content_types: contentTypes, clip_sources: clipSources, clip_edit: b.clip_edit || 'captions', album_ids: albumIds,
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
  for (const k of ['name', 'topic', 'targets', 'content_types', 'clip_sources', 'clip_edit', 'album_ids', 'carousel_style', 'carousel_format', 'include_image', 'interval_hours', 'active']) if (k in patch) allow[k] = patch[k]
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
