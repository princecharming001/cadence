// GET /api/x/status  (Authorization: Bearer <supabase token>)
// Returns the user's connected X accounts (no tokens exposed).
import { admin, getUser } from '@/lib/supabase'

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { data } = await admin
    .from('x_connections')
    .select('id, x_user_id, username, name, is_primary, needs_reconnect, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  return Response.json({ connections: data || [] })
}

// PATCH /api/x/status  { id, is_primary: true }  → make this account the primary
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id, is_primary } = await req.json().catch(() => ({}))
  if (!id || !is_primary) return Response.json({ error: 'id and is_primary required' }, { status: 400 })

  // Only one primary per user: clear the rest first (the partial unique index
  // would otherwise reject the second primary).
  await admin.from('x_connections').update({ is_primary: false }).eq('user_id', user.id).eq('is_primary', true)
  const { error } = await admin.from('x_connections').update({ is_primary: true }).eq('id', id).eq('user_id', user.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

// DELETE /api/x/status  { id }  → disconnect an X account
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json()

  const { data: gone } = await admin.from('x_connections')
    .delete().eq('id', id).eq('user_id', user.id).select('is_primary').single()

  // If we removed the primary, promote the earliest remaining account so the
  // user always has a primary.
  if (gone?.is_primary) {
    const { data: next } = await admin.from('x_connections')
      .select('id').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1)
    if (next?.[0]) await admin.from('x_connections').update({ is_primary: true }).eq('id', next[0].id)
  }
  return Response.json({ deleted: true })
}
