// Upload a source video into the clips bucket, returning a URL the clipper can
// process. Kept separate from job creation so big uploads don't tie up the API.
import { admin, getUser } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return Response.json({ error: 'No file' }, { status: 400 })
  const isImage = /^image\//.test(file.type) // brand-outro logos ride the same route
  if (!isImage && !/^video\//.test(file.type)) return Response.json({ error: 'Upload a video file (mp4/mov) or an image (logo).' }, { status: 400 })
  if (isImage && file.size > 8 * 1024 * 1024) return Response.json({ error: 'Logo is over 8MB — use a smaller image.' }, { status: 400 })
  if (!isImage && file.size > 520 * 1024 * 1024) return Response.json({ error: 'Video is over 500MB — trim it down first.' }, { status: 400 })

  const stamp = Date.now().toString(36)
  const ext = (file.name?.split('.').pop() || (isImage ? 'png' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '') || (isImage ? 'png' : 'mp4')
  const path = `${user.id}/${isImage ? 'logos' : 'sources'}/${stamp}.${ext}`
  const { error } = await admin.storage.from('clips').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ url: admin.storage.from('clips').getPublicUrl(path).data.publicUrl, name: file.name })
}
