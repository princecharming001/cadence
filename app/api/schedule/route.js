// GET /api/schedule?platform=x → the next smart posting slot for this user
// (inside their posting windows, weighted by their own engagement history,
// collision-free, jittered). The draft cards prefill from this.
import { getUser } from '@/lib/supabase'
import { nextSmartSlot } from '@/lib/scheduling'

export const runtime = 'nodejs'

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const platform = new URL(req.url).searchParams.get('platform') || 'x'
  try {
    return Response.json({ when: await nextSmartSlot(user.id, { platform }) })
  } catch (e) {
    return Response.json({ when: new Date(Date.now() + 3600e3).toISOString(), note: e.message })
  }
}
