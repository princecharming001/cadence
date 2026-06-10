// Personal reference photos (selfies) used to generate AI images of the user.
// Stored in the public `user-photos` Supabase Storage bucket; rows in user_photos.
import { admin, getUser } from '@/lib/supabase'

const BUCKET = 'user-photos'
const MAX_PHOTOS = 10

// GET /api/photos → user's uploaded photos
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('user_photos').select('*').eq('user_id', user.id).order('created_at', { ascending: true })
  return Response.json({ photos: data || [] })
}

// POST /api/photos  (multipart/form-data, field "file") → upload one photo
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { count } = await admin.from('user_photos').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  if ((count || 0) >= MAX_PHOTOS) return Response.json({ error: `Up to ${MAX_PHOTOS} photos.` }, { status: 400 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return Response.json({ error: 'No file provided.' }, { status: 400 })
  if (!/^image\//.test(file.type || '')) return Response.json({ error: 'Images only.' }, { status: 400 })

  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || 'image/jpeg', upsert: false,
  })
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
  const { data, error } = await admin.from('user_photos')
    .insert({ user_id: user.id, path, url: pub.publicUrl }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ photo: data })
}

// DELETE /api/photos  { id }
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  const { data: row } = await admin.from('user_photos').select('path').eq('id', id).eq('user_id', user.id).single()
  if (row?.path) await admin.storage.from(BUCKET).remove([row.path])
  await admin.from('user_photos').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
