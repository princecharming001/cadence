// POST { platform, n } → generate "ready to post" suggestions for a platform.
// Pulls fresh inspiration content first (X) so suggestions track what's working.
import { getUser } from '@/lib/supabase'
import { generateSuggestions } from '@/lib/suggestions'
import { pullXInspiration } from '@/lib/inspiration'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { platform = 'x', n = 3 } = await req.json().catch(() => ({}))
  try {
    if (platform === 'x') { try { await pullXInspiration(user.id) } catch {} }
    const posts = await generateSuggestions(user.id, platform, n)
    return Response.json({ posts })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
