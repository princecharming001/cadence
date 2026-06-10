// POST /api/slideshow/generate  → generate a full AI carousel.
// Body: { topic, format, style, slides, handle }
// Auth: the signed-in user, or Bearer CRON_SECRET (server/automation).
import { admin, getUser } from '@/lib/supabase'
import { generateSlideshow, SLIDE_STYLES, SLIDESHOW_FORMATS } from '@/lib/slideshow'

export const runtime = 'nodejs'
export const maxDuration = 120 // rendering several slides + AI can take a bit

export async function POST(req) {
  const body = await req.json().catch(() => ({}))

  // Resolve the owner (real user, or a server caller acting on a given user_id).
  let userId = null, persona = null
  const auth = req.headers.get('authorization') || ''
  if (auth === `Bearer ${process.env.CRON_SECRET}`) {
    userId = body.user_id || null
  } else {
    const user = await getUser(req)
    if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
    userId = user.id
  }
  if (userId) {
    const { data } = await admin.from('personas').select('*').eq('user_id', userId).single()
    persona = data || null
  }

  const topic = String(body.topic || '').trim()
  if (!topic) return Response.json({ error: 'Give the slideshow a topic.' }, { status: 400 })
  const style = SLIDE_STYLES[body.style] ? body.style : 'bold'
  const format = SLIDESHOW_FORMATS.find(f => f.key === body.format) ? body.format : 'listicle'

  try {
    const out = await generateSlideshow({
      topic, format, style,
      slides: body.slides, persona, handle: body.handle, userId,
    })
    return Response.json(out)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
