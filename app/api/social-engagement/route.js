// Per-platform auto-reply settings + run trigger, plus drafted replies.
import { admin, getUser } from '@/lib/supabase'
import { runSocialEngagement, SOCIAL_ENGAGEMENT_PLATFORMS } from '@/lib/social-engagement'
import { replyToInboxComment, zernioEnabled } from '@/lib/zernio'

export const runtime = 'nodejs'
export const maxDuration = 120

// GET → settings rows (one per platform, created on demand) + recent replies
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data: existing } = await admin.from('social_engagement').select('*').eq('user_id', user.id)
  const byPlatform = Object.fromEntries((existing || []).map(r => [r.platform, r]))
  // Ensure a row exists for every platform so the UI has toggles.
  const missing = SOCIAL_ENGAGEMENT_PLATFORMS.filter(p => !byPlatform[p])
  if (missing.length) {
    const { data } = await admin.from('social_engagement').insert(missing.map(p => ({ user_id: user.id, platform: p }))).select()
    for (const r of data || []) byPlatform[r.platform] = r
  }
  const { data: replies } = await admin.from('social_replies').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(40)
  return Response.json({ settings: SOCIAL_ENGAGEMENT_PLATFORMS.map(p => byPlatform[p]), replies: replies || [], configured: zernioEnabled() })
}

// PATCH { platform, ...fields } → update a platform's settings (enable/auto_post/instructions)
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!SOCIAL_ENGAGEMENT_PLATFORMS.includes(b.platform)) return Response.json({ error: 'Bad platform' }, { status: 400 })
  const patch = {}
  for (const k of ['enabled', 'auto_post', 'instructions']) if (k in b) patch[k] = b[k]
  await admin.from('social_engagement').update(patch).eq('user_id', user.id).eq('platform', b.platform)
  return Response.json({ ok: true })
}

// POST
//   { action:'run', platform }        → run the engine now for a platform
//   { action:'post-draft', id }       → publish a drafted reply
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))

  if (b.action === 'run') {
    if (!zernioEnabled()) return Response.json({ error: 'Zernio not configured' }, { status: 400 })
    const r = await runSocialEngagement(user.id, b.platform)
    return Response.json(r)
  }
  if (b.action === 'post-draft') {
    const { data: row } = await admin.from('social_replies').select('*').eq('id', b.id).eq('user_id', user.id).single()
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
    try {
      await replyToInboxComment({ postId: row.post_id, accountId: row.account_id, message: row.reply_text, commentId: row.comment_id })
      await admin.from('social_replies').update({ status: 'posted' }).eq('id', row.id)
      return Response.json({ ok: true })
    } catch (e) {
      await admin.from('social_replies').update({ status: 'failed', error: e.message }).eq('id', row.id)
      return Response.json({ error: e.message }, { status: 500 })
    }
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
