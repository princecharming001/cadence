// lib/inspiration.js — read-only "inspiration accounts" (up to 3 per platform).
// Public accounts the AI studies for what's working in the user's niche. No
// connection or auth from those accounts — we just read their public posts.
//
// X: read via the X API search (from:handle) using the user's own token —
//    reads any public account, target never connects anything.
// LinkedIn: handled by the existing Apify mentor pipeline (linkedin_accounts
//    is_mentor + linkedin_posts) — not duplicated here.
import { admin } from './supabase'
import { getValidAccessToken, searchRecent, xReadEnabled } from './x-oauth'

export const INSPO_LIMIT = 3

export async function listInspiration(userId, platform) {
  const { data } = await admin.from('inspiration_accounts').select('*').eq('user_id', userId).eq('platform', platform).order('created_at')
  return data || []
}

export async function addInspiration(userId, platform, rawHandle) {
  const handle = String(rawHandle || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?]/)[0]
  if (!handle) return { error: 'Enter a handle or profile URL.' }
  const existing = await listInspiration(userId, platform)
  if (existing.some(a => a.handle.toLowerCase() === handle.toLowerCase())) return { added: false, note: 'Already added.' }
  if (existing.length >= INSPO_LIMIT) return { error: `Up to ${INSPO_LIMIT} inspiration accounts per platform.` }
  await admin.from('inspiration_accounts').insert({ user_id: userId, platform, handle })
  return { added: true, handle }
}

export async function removeInspiration(userId, id) {
  const { data: row } = await admin.from('inspiration_accounts').select('*').eq('id', id).eq('user_id', userId).single()
  if (row) {
    await admin.from('inspiration_accounts').delete().eq('id', id)
    await admin.from('inspiration_posts').delete().eq('user_id', userId).eq('platform', row.platform).eq('handle', row.handle)
  }
  return { deleted: true }
}

// Pull recent top posts from every X inspiration account into inspiration_posts.
export async function pullXInspiration(userId) {
  if (!xReadEnabled()) return { error: 'X reading is off (X_READ_ENABLED).' }
  const accounts = await listInspiration(userId, 'x')
  if (!accounts.length) return { pulled: 0, note: 'No X inspiration accounts yet.' }
  const { data: conn } = await admin.from('x_connections').select('*').eq('user_id', userId).order('is_primary', { ascending: false }).limit(1).single()
  if (!conn) return { error: 'Connect an X account first (used only to read).' }
  const token = await getValidAccessToken(conn)

  let pulled = 0
  for (const a of accounts) {
    let tweets = []
    try { tweets = await searchRecent(token, `from:${a.handle} -is:retweet -is:reply`, 15) } catch { continue }
    const rows = tweets.filter(t => (t.text || '').length > 30).map(t => ({
      user_id: userId, platform: 'x', handle: a.handle, ref: t.tweet_id,
      text: t.text, metric: (t.metrics?.like_count || 0) + 2 * (t.metrics?.retweet_count || 0),
    }))
    if (rows.length) { await admin.from('inspiration_posts').upsert(rows, { onConflict: 'user_id,platform,ref' }); pulled += rows.length }
  }
  return { pulled }
}

// Top inspiration corpus for a platform (for the suggestions engine).
// LinkedIn pulls from the mentor pipeline; X from inspiration_posts.
export async function inspirationCorpus(userId, platform, k = 8) {
  if (platform === 'linkedin') {
    const { data: mentors } = await admin.from('linkedin_accounts').select('id').eq('user_id', userId).eq('is_mentor', true)
    const ids = (mentors || []).map(m => m.id)
    if (!ids.length) return []
    const { data } = await admin.from('linkedin_posts').select('content, likes').in('account_id', ids).order('likes', { ascending: false }).limit(k)
    return (data || []).map(p => ({ text: p.content, metric: p.likes || 0 }))
  }
  const { data } = await admin.from('inspiration_posts').select('text, metric').eq('user_id', userId).eq('platform', platform).order('metric', { ascending: false }).limit(k)
  return data || []
}
