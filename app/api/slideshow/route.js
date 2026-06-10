// Saved slideshows: list, save a generated deck, schedule/post it via Zernio.
import { admin, getUser } from '@/lib/supabase'
import { createPost, zernioEnabled } from '@/lib/zernio'

// GET /api/slideshow → the user's saved slideshows (newest first)
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('slideshows').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
  return Response.json({ slideshows: data || [] })
}

// POST /api/slideshow
//   save a deck (default)            → { topic, format, style, slides, caption, image_urls }
//   schedule/post it { action:'schedule', ...deck, account_ids, scheduled_for? }
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))

  const row = {
    user_id: user.id,
    topic: String(b.topic || '').trim() || 'Untitled',
    format: b.format || 'listicle', style: b.style || 'bold',
    slides: Array.isArray(b.slides) ? b.slides : [],
    caption: b.caption || null,
    image_urls: Array.isArray(b.image_urls) ? b.image_urls : [],
    account_ids: Array.isArray(b.account_ids) ? b.account_ids : [],
    status: 'draft',
    scheduled_for: b.scheduled_for || null,
  }

  if (b.action === 'schedule') {
    if (!zernioEnabled()) return Response.json({ error: 'Connect a Zernio account first (set ZERNIO_API_KEY).' }, { status: 400 })
    if (!row.account_ids.length) return Response.json({ error: 'Pick at least one account to post to.' }, { status: 400 })
    if (!row.image_urls.length) return Response.json({ error: 'No slides to post.' }, { status: 400 })
    const { data: accts } = await admin.from('social_accounts').select('*').eq('user_id', user.id).in('id', row.account_ids)
    if (!accts?.length) return Response.json({ error: 'Those accounts are not connected.' }, { status: 400 })
    try {
      // The cover slide's hook is the natural short title (used for TikTok's
      // 90-char slideshow title and LinkedIn's document title).
      const title = row.slides?.[0]?.heading || row.topic
      const r = await createPost({
        userId: user.id, accounts: accts, content: row.caption || '',
        mediaUrls: row.image_urls, scheduledFor: row.scheduled_for || undefined, title,
      })
      row.status = row.scheduled_for ? 'scheduled' : 'posted'
      row.zernio_post_id = r.id
    } catch (e) {
      row.status = 'failed'; row.error = e.message
      const { data } = await admin.from('slideshows').insert(row).select().single()
      return Response.json({ error: e.message, slideshow: data }, { status: 500 })
    }
  }

  const { data, error } = await admin.from('slideshows').insert(row).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ slideshow: data })
}

// DELETE /api/slideshow { id }
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  await admin.from('slideshows').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
