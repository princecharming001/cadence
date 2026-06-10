// POST /api/feedback  { content, rating: 'up'|'down', postId?, note? }
// Records a thumbs up/down on a tweet so future generations learn the user's taste.
import { admin, getUser } from '@/lib/supabase'

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { content, rating, postId, note } = await req.json().catch(() => ({}))
  if (rating !== 'up' && rating !== 'down') return Response.json({ error: 'rating must be up or down' }, { status: 400 })

  const { data, error } = await admin.from('post_feedback')
    .insert({ user_id: user.id, content: content || null, rating, post_id: postId || null, note: note || null })
    .select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ feedback: data })
}

// GET /api/feedback → recent ratings (for the UI, optional)
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('post_feedback')
    .select('id, content, rating, note, created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
  return Response.json({ feedback: data || [] })
}
