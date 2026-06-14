// /api/media — the content Library. Users upload images + videos (direct to the
// `media` bucket via a signed URL, so large videos bypass the serverless body
// limit), organize them into albums, and Cadence analyzes each asset so it can
// be reused TASTEFULLY in slideshows/clips. Images analyze inline (one vision
// call); videos analyze async via /api/media/process.
import { admin, getUser } from '@/lib/supabase'
import { analyzeImage } from '@/lib/media-analysis'

export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = 'media'
const extOf = (name, mime) => {
  const e = String(name || '').split('.').pop()
  if (e && e.length <= 5 && /^[a-z0-9]+$/i.test(e)) return e.toLowerCase()
  if (mime?.includes('png')) return 'png'; if (mime?.includes('webp')) return 'webp'
  if (mime?.includes('quicktime')) return 'mov'; if (mime?.startsWith('video')) return 'mp4'
  return 'jpg'
}

// GET → the user's albums + assets
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const [{ data: albums }, { data: assets }] = await Promise.all([
    admin.from('media_albums').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
    admin.from('media_assets').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500),
  ])
  // Counts per album for the sidebar.
  const counts = {}
  for (const a of assets || []) counts[a.album_id || '_none'] = (counts[a.album_id || '_none'] || 0) + 1
  return Response.json({ albums: (albums || []).map(a => ({ ...a, count: counts[a.id] || 0 })), assets: assets || [], unfiled: counts._none || 0 })
}

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))

  // 1) Ask for a signed upload URL — creates the asset row in 'uploading'.
  if (b.action === 'sign') {
    const mime = String(b.mime || '')
    const type = mime.startsWith('video') ? 'video' : 'image'
    if (!mime.startsWith('image') && !mime.startsWith('video')) return Response.json({ error: 'Only images and videos.' }, { status: 400 })
    const { data: asset, error } = await admin.from('media_assets').insert({
      user_id: user.id, album_id: b.album_id || null, type,
      filename: String(b.filename || 'upload').slice(0, 160), mime,
      size_bytes: Number(b.size) || null, width: Number(b.width) || null, height: Number(b.height) || null,
      status: 'uploading',
    }).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const storage_path = `${user.id}/${asset.id}.${extOf(b.filename, mime)}`
    const { data: signed, error: sErr } = await admin.storage.from(BUCKET).createSignedUploadUrl(storage_path)
    if (sErr) return Response.json({ error: sErr.message }, { status: 500 })
    const url = admin.storage.from(BUCKET).getPublicUrl(storage_path).data.publicUrl
    await admin.from('media_assets').update({ storage_path, url }).eq('id', asset.id)
    return Response.json({ asset: { ...asset, storage_path, url }, upload: { path: storage_path, token: signed.token } })
  }

  // 2) The client finished uploading → analyze. Images inline; videos async.
  if (b.action === 'uploaded') {
    const { data: asset } = await admin.from('media_assets').select('*').eq('id', b.id).eq('user_id', user.id).single()
    if (!asset) return Response.json({ error: 'Not found' }, { status: 404 })
    const patch = {}
    if (b.width) patch.width = Number(b.width); if (b.height) patch.height = Number(b.height)
    if (asset.type === 'image') {
      try {
        const analysis = await analyzeImage({ ...asset, ...patch })
        await admin.from('media_assets').update({ ...patch, analysis, status: 'ready' }).eq('id', asset.id)
        return Response.json({ ok: true, status: 'ready' })
      } catch (e) {
        await admin.from('media_assets').update({ ...patch, status: 'failed', error: String(e.message || '').slice(0, 200) }).eq('id', asset.id)
        return Response.json({ ok: false, error: String(e.message || 'analysis failed').slice(0, 180) })
      }
    }
    // Video → queue for the worker + kick it.
    await admin.from('media_assets').update({ ...patch, status: 'analyzing' }).eq('id', asset.id)
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    fetch(`${base}/api/media/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
    return Response.json({ ok: true, status: 'analyzing' })
  }

  // Album create.
  if (b.action === 'album') {
    const name = String(b.name || '').slice(0, 80).trim()
    if (!name) return Response.json({ error: 'Name the album.' }, { status: 400 })
    const { data, error } = await admin.from('media_albums').insert({ user_id: user.id, name, description: String(b.description || '').slice(0, 300) || null }).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ album: data })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// PATCH { id, album_id } → move asset(s); { albumId, name|description } → rename album
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (b.albumId) {
    const patch = {}
    if (typeof b.name === 'string') patch.name = b.name.slice(0, 80).trim()
    if (typeof b.description === 'string') patch.description = b.description.slice(0, 300)
    await admin.from('media_albums').update(patch).eq('id', b.albumId).eq('user_id', user.id)
    return Response.json({ ok: true })
  }
  // Favorite toggle.
  if (b.id && typeof b.favorite === 'boolean') {
    await admin.from('media_assets').update({ is_favorite: b.favorite }).eq('id', b.id).eq('user_id', user.id)
    return Response.json({ ok: true })
  }
  const ids = Array.isArray(b.ids) ? b.ids : (b.id ? [b.id] : [])
  if (!ids.length) return Response.json({ error: 'id required' }, { status: 400 })
  await admin.from('media_assets').update({ album_id: b.album_id || null }).in('id', ids).eq('user_id', user.id)
  return Response.json({ ok: true })
}

// DELETE { id } asset (+ storage) | { albumId } album (assets keep, album_id nulled)
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (b.albumId) {
    await admin.from('media_albums').delete().eq('id', b.albumId).eq('user_id', user.id)
    return Response.json({ deleted: true })
  }
  if (!b.id) return Response.json({ error: 'id required' }, { status: 400 })
  const { data: asset } = await admin.from('media_assets').select('storage_path').eq('id', b.id).eq('user_id', user.id).single()
  if (asset?.storage_path) await admin.storage.from(BUCKET).remove([asset.storage_path, `${user.id}/thumbs/${b.id}.jpg`]).catch(() => {})
  await admin.from('media_assets').delete().eq('id', b.id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
