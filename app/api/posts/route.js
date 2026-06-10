// Direct queue CRUD + manual "post now", all scoped to the authenticated user.
import { admin, getUser } from '@/lib/supabase'
import { postOne } from '@/lib/posting'

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
    const result = await postOne(post)
    return Response.json(result, { status: result.status === 'posted' ? 200 : 500 })
  }

  const content = (body.content || '').trim()
  if (!content) return Response.json({ error: 'Content required.' }, { status: 400 })
  const scheduled = body.scheduledFor || new Date().toISOString()

  const { data, error } = await admin.from('posts')
    .insert({ content, scheduled_for: scheduled, status: 'queued', user_id: user.id, image_url: body.imageUrl || null, x_connection_id: body.xConnectionId || null })
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
  if (xConnectionId !== undefined) patch.x_connection_id = xConnectionId
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
