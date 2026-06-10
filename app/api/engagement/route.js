// Engagement rules CRUD + manual run, scoped to the authenticated user.
// Mirrors /api/campaigns.
import { admin, getUser } from '@/lib/supabase'
import { runDueEngagement } from '@/lib/engagement'

const FIELDS = ['name', 'target_keywords', 'target_handles', 'target_tweet_urls', 'comment_style', 'instructions', 'connection_ids', 'interval_hours', 'replies_per_run', 'auto_post', 'active']

const arr = v => (Array.isArray(v) ? v.filter(Boolean) : [])

function clean(body) {
  const patch = {}
  for (const k of FIELDS) if (body[k] !== undefined) patch[k] = body[k]
  if (patch.interval_hours !== undefined) patch.interval_hours = Math.max(1, Number(patch.interval_hours) || 24)
  if (patch.replies_per_run !== undefined) patch.replies_per_run = Math.min(5, Math.max(1, Number(patch.replies_per_run) || 1))
  for (const k of ['target_keywords', 'target_handles', 'target_tweet_urls', 'connection_ids']) {
    if (patch[k] !== undefined) patch[k] = arr(patch[k])
  }
  if (patch.auto_post !== undefined) patch.auto_post = !!patch.auto_post
  if (patch.active !== undefined) patch.active = !!patch.active
  return patch
}

// GET /api/engagement → user's rules
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('engagement_rules').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  return Response.json({ rules: data || [] })
}

// POST /api/engagement                  → create a rule
// POST /api/engagement { action:'run' } → run all due rules now (Bearer CRON_SECRET, or the owner)
export async function POST(req) {
  const body = await req.json().catch(() => ({}))

  if (body.action === 'run') {
    const auth = req.headers.get('authorization') || ''
    if (auth === `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json(await runDueEngagement())
    }
    const user = await getUser(req)
    if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
    return Response.json(await runDueEngagement())
  }

  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const patch = clean(body)
  if (!patch.name) return Response.json({ error: 'Give the rule a name.' }, { status: 400 })
  if (!arr(patch.target_tweet_urls).length && !arr(patch.target_keywords).length && !arr(patch.target_handles).length) {
    return Response.json({ error: 'Add at least one target: tweet links, keywords, or accounts to watch.' }, { status: 400 })
  }
  const next_run_at = patch.active ? new Date().toISOString() : null
  const { data, error } = await admin.from('engagement_rules')
    .insert({ ...patch, user_id: user.id, next_run_at }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ rule: data })
}

// PATCH /api/engagement { id, ...fields } → update (e.g. toggle active / auto_post)
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  const patch = clean(body)
  if (patch.active === true) patch.next_run_at = new Date().toISOString()
  const { data, error } = await admin.from('engagement_rules')
    .update(patch).eq('id', body.id).eq('user_id', user.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ rule: data })
}

// DELETE /api/engagement { id }
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  await admin.from('engagement_rules').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
