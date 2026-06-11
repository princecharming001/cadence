// POST /api/image  { prompt, seed?, fromContent?, personal? }  → { url }
// Generates an AI image for a post. When `personal` is set, the user's uploaded
// selfies are passed as reference photos so the image features them.
import { admin, getUser } from '@/lib/supabase'
import { generateImage, persistImage } from '@/lib/images'

export const maxDuration = 120 // Higgsfield/OpenAI generation can poll ~90s

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { prompt, seed, fromContent = false, personal = false } = await req.json().catch(() => ({}))

  let referenceImages = []
  if (personal) {
    const { data: photos } = await admin.from('user_photos').select('url').eq('user_id', user.id).limit(4)
    referenceImages = (photos || []).map(p => p.url).filter(Boolean)
  }

  try {
    const img = await generateImage(prompt, { seed, fromContent, referenceImages })
    // Persist to our bucket so a scheduled post's image is still live at post time.
    img.url = await persistImage(img.url, user.id)
    return Response.json(img)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
