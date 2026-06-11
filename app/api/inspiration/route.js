// Inspiration accounts (read-only, no auth from the target): list/add/remove,
// and pull their recent content for the suggestions engine.
import { getUser } from '@/lib/supabase'
import { listInspiration, addInspiration, removeInspiration, pullXInspiration } from '@/lib/inspiration'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const accounts = await listInspiration(user.id, new URL(req.url).searchParams.get('platform') || 'x')
  return Response.json({ accounts })
}

// POST { platform, handle } → add;  POST { action:'pull', platform } → refresh content
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (b.action === 'pull') {
    if (b.platform === 'x') return Response.json(await pullXInspiration(user.id))
    return Response.json({ error: 'LinkedIn inspiration refreshes via its account slots.' }, { status: 400 })
  }
  const r = await addInspiration(user.id, b.platform || 'x', b.handle)
  return Response.json(r, { status: r.error ? 400 : 200 })
}

export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  return Response.json(await removeInspiration(user.id, id))
}
