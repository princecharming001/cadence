// Direct queue CRUD + manual "post now", all scoped to the authenticated user.
import { randomUUID } from 'crypto'
import { admin, getUser } from '@/lib/supabase'
import { postOne } from '@/lib/posting'
import { nextSmartSlot } from '@/lib/scheduling'
import { PLATFORM } from '@/lib/prompts'

const capOf = p => (PLATFORM[p] || PLATFORM.x).cap

// POST  { content, scheduledFor }            → create a queued post
// POST  { id, action: 'post_now' }           → post one immediately
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json()

  if (body.action === 'post_now') {
    const { data: post } = await admin.from('posts').select('*')
      .eq('id', body.id).eq('user_id', user.id).single()
    if (!post) return Response.json({ error: 'Post not found.' }, { status: 404 })
    // The UI calls post_now to APPROVE a draft suggestion and to RETRY a failed
    // post — both must become 'queued' first (postOne only claims 'queued').
    // CAS on the observed status so a concurrent change can't double-publish.
    if (['draft', 'failed', 'paused'].includes(post.status)) {
      const { data: promoted } = await admin.from('posts')
        .update({ status: 'queued', error: null })
        .eq('id', post.id).eq('user_id', user.id).eq('status', post.status).select()
      if (!promoted?.[0]) return Response.json({ status: 'skipped', error: 'Post state changed — refresh and try again.' }, { status: 409 })
      post.status = 'queued'
    }
    const result = await postOne(post)
    const code = result.status === 'posted' ? 200 : result.status === 'skipped' ? 409 : 500
    return Response.json(result, { status: code })
  }

  // All four platforms are first-class queue citizens (IG/TikTok publish via
  // Zernio and need media; the poster enforces that at publish time).
  const platform = Object.hasOwn(PLATFORM, body.platform) ? body.platform : 'x'
  // scheduledFor 'auto' → the smart slot picker chooses the moment.
  const scheduled = !body.scheduledFor || body.scheduledFor === 'auto'
    ? (body.scheduledFor === 'auto' ? await nextSmartSlot(user.id, { platform }) : new Date().toISOString())
    : body.scheduledFor

  // THREAD: { thread: [part1, part2, ...] } → one row per part, chained at
  // publish time (each part replies to the previous; the poster enforces order).
  if (Array.isArray(body.thread) && body.thread.length > 1) {
    const parts = body.thread.map(t => String(t || '').trim()).filter(Boolean).slice(0, 8)
    if (parts.length < 2) return Response.json({ error: 'A thread needs at least 2 parts.' }, { status: 400 })
    for (const t of parts) if (t.length > capOf('x')) return Response.json({ error: 'A thread part is over 280 characters.' }, { status: 400 })
    const threadId = randomUUID()
    const rows = parts.map((content, i) => ({
      content, scheduled_for: scheduled, status: 'queued', user_id: user.id, platform: 'x',
      thread_id: threadId, thread_index: i,
      x_connection_id: body.xConnectionId || null,
      image_url: i === 0 ? (body.imageUrl || null) : null,
    }))
    const { data, error } = await admin.from('posts').insert(rows).select()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ post: data[0], thread: data })
  }

  const content = (body.content || '').trim()
  if (!content) return Response.json({ error: 'Content required.' }, { status: 400 })
  if (content.length > capOf(platform)) {
    return Response.json({ error: `Over the ${capOf(platform)}-character ${PLATFORM[platform].label} limit.` }, { status: 400 })
  }

  const { data, error } = await admin.from('posts')
    .insert({
      content, scheduled_for: scheduled, status: 'queued', user_id: user.id, platform,
      image_url: body.imageUrl || null,
      x_connection_id: platform === 'x' ? (body.xConnectionId || null) : null,
      social_account_id: platform !== 'x' ? (body.socialAccountId || null) : null,
    })
    .select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ post: data })
}

// PATCH  { id, content?, scheduledFor?, status? }  → edit a post
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id, content, scheduledFor, status, imageUrl, xConnectionId } = await req.json()
  const patch = {}
  if (content !== undefined)       patch.content = content
  if (scheduledFor !== undefined)  patch.scheduled_for = scheduledFor
  if (status !== undefined)        patch.status = status
  if (imageUrl !== undefined)      patch.image_url = imageUrl
  // The platform of the row being edited governs both length validation AND which
  // connection field is legal — never stamp an X connection onto a LinkedIn/IG/
  // TikTok post (the compose modal can default connId to an X account).
  if (content !== undefined || xConnectionId !== undefined) {
    const { data: row } = await admin.from('posts').select('platform').eq('id', id).eq('user_id', user.id).single()
    if (!row) return Response.json({ error: 'Post not found.' }, { status: 404 })
    const platform = row.platform || 'x'
    if (content !== undefined && String(content).length > capOf(platform)) {
      return Response.json({ error: `Over the ${capOf(platform)}-character limit.` }, { status: 400 })
    }
    if (xConnectionId !== undefined && platform === 'x') patch.x_connection_id = xConnectionId
  }
  const { data, error } = await admin.from('posts')
    .update(patch).eq('id', id).eq('user_id', user.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ post: data })
}

// DELETE  { id }
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json()
  await admin.from('posts').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
