// POST /api/generate  { n? }  → (Pro) generate N X-post drafts in the user's voice
import { getUser } from '@/lib/supabase'
import { isPro } from '@/lib/profile'
import { generatePosts } from '@/lib/persona'

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!(await isPro(user))) return Response.json({ error: 'upgrade_required' }, { status: 402 })

  const { n = 5 } = await req.json().catch(() => ({}))
  try {
    const drafts = await generatePosts(user.id, Math.min(Math.max(n, 1), 10))
    return Response.json({ drafts })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 })
  }
}
