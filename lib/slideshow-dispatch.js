// Dispatch locally-scheduled carousels when their time comes. A scheduled deck
// lives in the slideshows table with status='scheduled' and NO zernio_post_id
// (decks already handed to Zernio carry an id and fire on Zernio's own clock —
// we skip those). Keeping the schedule local is what makes the time editable.
import { admin } from './supabase'
import { createPost, zernioEnabled } from './zernio'

export async function runDueSlideshows(limit = 10) {
  if (!zernioEnabled()) return { dispatched: 0 }
  const now = new Date().toISOString()
  const { data: due } = await admin.from('slideshows').select('*')
    .eq('status', 'scheduled').is('zernio_post_id', null).lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true }).limit(limit)
  let dispatched = 0, failed = 0
  for (const s of due || []) {
    // CAS claim so overlapping cron ticks can't double-post the same deck.
    const { data: claimed } = await admin.from('slideshows')
      .update({ status: 'posting' }).eq('id', s.id).eq('status', 'scheduled').select('id').single()
    if (!claimed) continue
    try {
      const { data: accts } = await admin.from('social_accounts').select('*')
        .eq('user_id', s.user_id).in('id', s.account_ids || [])
        .in('platform', ['instagram', 'tiktok', 'linkedin', 'facebook'])
      if (!accts?.length) throw new Error('No connected accounts for this carousel.')
      const title = s.slides?.[0]?.heading || s.title || s.topic
      const r = await createPost({ userId: s.user_id, accounts: accts, content: s.caption || '', mediaUrls: s.image_urls, title })
      await admin.from('slideshows').update({ status: 'posted', zernio_post_id: r.id, error: null }).eq('id', s.id)
      dispatched++
    } catch (e) {
      await admin.from('slideshows').update({ status: 'failed', error: String(e.message || 'dispatch failed').slice(0, 200) }).eq('id', s.id)
      failed++
    }
  }
  return { dispatched, failed }
}
