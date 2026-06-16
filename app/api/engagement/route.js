// Engagement rules CRUD + manual run, scoped to the authenticated user.
// Mirrors /api/campaigns.
import { admin, getUser, isCron } from '@/lib/supabase'

export const maxDuration = 120
import { runDueEngagement, runEngagementById } from '@/lib/engagement'

const FIELDS = ['name', 'target_keywords', 'target_handles', 'comment_styles', 'instructions', 'connection_ids', 'interval_hours', 'replies_per_run', 'auto_post', 'active']
const STYLE_KEYS = new Set(['add_value', 'question', 'agree_build', 'counter', 'witty', 'experience'])
const MAX_REPLIES_PER_RUN = 25 // generous safety bound against runaway cost/spam

const arr = v => (Array.isArray(v) ? v.filter(Boolean) : [])

// Not usernames: x.com paths that the profile-URL regex would otherwise match.
const RESERVED = new Set(['i', 'home', 'search', 'explore', 'notifications', 'messages', 'intent', 'status', 'hashtag', 'settings', 'compose'])

// Accept a pasted profile link (x.com/handle, twitter.com/handle) or a bare
// @handle and normalize to the username.
function toHandle(s) {
  const str = String(s || '').trim()
  const m = str.match(/(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,15})(?:[/?#]|$)/) || str.match(/^@?([A-Za-z0-9_]{1,15})$/)
  const h = m ? m[1].replace(/^@/, '') : null
  return h && !RESERVED.has(h.toLowerCase()) ? h : null
}

const MAX_WATCHED = 3 // accounts a rule can watch

function clean(body) {
  const patch = {}
  for (const k of FIELDS) if (body[k] !== undefined) patch[k] = body[k]
  // Niche-engage should be responsive (reply to a trending post within ~20 min),
  // not daily — allow sub-hour, default ~20 min. The X-read budget caps spend.
  if (patch.interval_hours !== undefined) patch.interval_hours = Math.max(0.05, Number(patch.interval_hours) || 0.33)
  if (patch.replies_per_run !== undefined) patch.replies_per_run = Math.min(MAX_REPLIES_PER_RUN, Math.max(1, Number(patch.replies_per_run) || 1))
  for (const k of ['target_keywords', 'target_handles', 'comment_styles', 'connection_ids']) {
    if (patch[k] !== undefined) patch[k] = arr(patch[k])
  }
  if (patch.target_handles !== undefined) {
    const seen = new Set()
    patch.target_handles = patch.target_handles
      .map(toHandle).filter(Boolean)
      .filter(h => !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase()))
      .slice(0, MAX_WATCHED)
  }
  if (patch.comment_styles !== undefined) {
    const styles = patch.comment_styles.filter(s => STYLE_KEYS.has(s))
    patch.comment_styles = styles.length ? styles : ['add_value']
    patch.comment_style = patch.comment_styles[0] // keep the legacy single column in sync
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
    if (isCron(req)) return Response.json(await runDueEngagement())
    const user = await getUser(req)
    if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
    if (!body.id) return Response.json({ error: 'Rule id required.' }, { status: 400 })
    return Response.json(await runEngagementById(body.id, user.id))
  }

  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const patch = clean(body)
  if (!patch.name) patch.name = 'Niche engagement'
  // Targets can be added after enabling (toggle-first UX) — an empty rule just
  // finds nothing until keywords/accounts are set.
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

  // Pausing/resuming a rule cascades to its still-pending replies (auto-mode
  // queued rows), matching the rule's state. Drafts await approval regardless.
  if (patch.active === false) {
    await admin.from('posts').update({ status: 'paused' })
      .eq('engagement_rule_id', body.id).eq('user_id', user.id).eq('status', 'queued')
  } else if (patch.active === true) {
    await admin.from('posts').update({ status: 'queued' })
      .eq('engagement_rule_id', body.id).eq('user_id', user.id).eq('status', 'paused')
  }
  return Response.json({ rule: data })
}

// DELETE /api/engagement { id }  → removes the rule and its not-yet-posted replies
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  await admin.from('posts').delete()
    .eq('engagement_rule_id', id).eq('user_id', user.id).in('status', ['draft', 'queued', 'paused'])
  await admin.from('engagement_rules').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
