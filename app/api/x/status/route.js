// GET /api/x/status  (Authorization: Bearer <supabase token>)
// Returns the user's connected X accounts (no tokens exposed).
import { admin, getUser } from '@/lib/supabase'

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { data } = await admin
    .from('x_connections')
    .select('id, x_user_id, username, name, created_at')
    .eq('user_id', user.id)

  return Response.json({ connections: data || [] })
}

// DELETE /api/x/status  { id }  → disconnect an X account
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json()
  await admin.from('x_connections').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
