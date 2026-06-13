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

  // Schedule/post an EXISTING saved draft by id (from the Slideshows list) —
  // dispatch it to Zernio and flip its status in place, no duplicate row.
  if (b.action === 'schedule' && b.id) {
    const { data: deck } = await admin.from('slideshows').select('*').eq('id', b.id).eq('user_id', user.id).single()
    if (!deck) return Response.json({ error: 'Slideshow not found.' }, { status: 404 })
    if (deck.status !== 'draft') return Response.json({ error: 'That deck has already gone out.' }, { status: 400 })
    if (!zernioEnabled()) return Response.json({ error: 'Connect a Zernio account first (set ZERNIO_API_KEY).' }, { status: 400 })
    const accountIds = Array.isArray(b.account_ids) ? b.account_ids : []
    if (!accountIds.length) return Response.json({ error: 'Pick at least one account to post to.' }, { status: 400 })
    if (!(deck.image_urls || []).length) return Response.json({ error: 'No slides to post.' }, { status: 400 })
    const { data: accts } = await admin.from('social_accounts').select('*').eq('user_id', user.id).in('id', accountIds)
      .in('platform', ['instagram', 'tiktok', 'linkedin', 'facebook'])
    if (!accts?.length) return Response.json({ error: 'Those accounts are not connected.' }, { status: 400 })
    const scheduledFor = b.scheduled_for || null
    try {
      const title = deck.slides?.[0]?.heading || deck.title || deck.topic
      const r = await createPost({ userId: user.id, accounts: accts, content: deck.caption || '', mediaUrls: deck.image_urls, scheduledFor: scheduledFor || undefined, title })
      const { data, error } = await admin.from('slideshows')
        .update({ status: scheduledFor ? 'scheduled' : 'posted', zernio_post_id: r.id, account_ids: accountIds, scheduled_for: scheduledFor, error: null })
        .eq('id', b.id).eq('user_id', user.id).select().single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ slideshow: data })
    } catch (e) {
      await admin.from('slideshows').update({ status: 'failed', error: e.message }).eq('id', b.id).eq('user_id', user.id)
      return Response.json({ error: e.message }, { status: 500 })
    }
  }

  const row = {
    user_id: user.id,
    topic: String(b.topic || '').trim() || 'Untitled',
    title: b.title ? String(b.title).trim().slice(0, 120) : null,
    format: b.format || 'listicle', style: b.style || 'bold',
    slides: Array.isArray(b.slides) ? b.slides : [],
    caption: b.caption || null,
    handle: b.handle || null, // who the carousel is for — lets edits re-render the handle chip
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
      .in('platform', ['instagram', 'tiktok', 'linkedin', 'facebook']) // carousel-capable only
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

// PATCH /api/slideshow { id, slides?, image_urls?, caption? } → edit a saved
// draft's text/images. Only drafts are editable: scheduled/posted decks have
// already been dispatched to Zernio, so changing them here would be a lie.
export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return Response.json({ error: 'id required' }, { status: 400 })
  const { data: row } = await admin.from('slideshows').select('status').eq('id', b.id).eq('user_id', user.id).single()
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
  const patch = {}
  // Title is just a memorable label — renameable at any status.
  if (typeof b.title === 'string') patch.title = b.title.trim().slice(0, 120) || null
  // Content edits only make sense before the deck has gone out.
  const wantsContent = Array.isArray(b.slides) || Array.isArray(b.image_urls) || typeof b.caption === 'string'
  if (wantsContent) {
    if (row.status !== 'draft') return Response.json({ error: 'Only draft slideshows can be edited — scheduled or posted decks are already out.' }, { status: 400 })
    if (Array.isArray(b.slides)) patch.slides = b.slides
    if (Array.isArray(b.image_urls)) patch.image_urls = b.image_urls
    if (typeof b.caption === 'string') patch.caption = b.caption
  }
  if (!Object.keys(patch).length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
  const { data, error } = await admin.from('slideshows').update(patch).eq('id', b.id).eq('user_id', user.id).select().single()
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
