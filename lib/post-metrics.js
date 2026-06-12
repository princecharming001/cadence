// lib/post-metrics.js — the analytics → generation loop, half one.
// After a post fires, pull its real engagement back onto the posts row
// (likes/replies/reposts/impressions). lib/voice.js then surfaces the user's
// top performers into every generation prompt, and lib/scheduling.js weights
// posting slots by which hours actually earned engagement.
//
// Cost discipline: ONE batched X read (up to 100 tweets) per user per sweep,
// only for posts <7 days old whose metrics are missing or >12h stale, gated
// on X_READ_ENABLED + the shared per-user daily read budget.
import { admin } from './supabase'
import { getValidAccessToken, lookupTweetMetrics, xReadEnabled } from './x-oauth'

const STALE_HOURS = 12
const WINDOW_DAYS = 7

async function overReadBudget(userId, n) {
  const { data } = await admin.rpc('bump_x_reads', { p_user: userId, p_n: n })
  return typeof data === 'number' && data > 2500
}

export async function refreshPostMetrics() {
  if (!xReadEnabled()) return { skipped: 'x reads off' }
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString()
  const staleCut = new Date(Date.now() - STALE_HOURS * 3600e3).toISOString()
  const { data: due } = await admin.from('posts')
    .select('id, user_id, external_id, metrics_at')
    .eq('status', 'posted').eq('platform', 'x').not('external_id', 'is', null)
    .gte('posted_at', since)
    .or(`metrics_at.is.null,metrics_at.lt.${staleCut}`)
    .limit(300)
  if (!due?.length) return { refreshed: 0 }

  const byUser = {}
  for (const p of due) (byUser[p.user_id] ||= []).push(p)

  let refreshed = 0
  for (const [userId, posts] of Object.entries(byUser)) {
    if (await overReadBudget(userId, 1)) continue
    const { data: conn } = await admin.from('x_connections').select('*')
      .eq('user_id', userId).order('is_primary', { ascending: false }).limit(1).single()
    if (!conn) continue
    try {
      const token = await getValidAccessToken(conn)
      const metrics = await lookupTweetMetrics(token, posts.map(p => p.external_id))
      const now = new Date().toISOString()
      for (const p of posts) {
        const m = metrics[p.external_id]
        // Deleted/protected tweets return nothing — stamp metrics_at anyway so
        // we don't re-spend reads on them every sweep.
        await admin.from('posts').update(m ? {
          likes: m.like_count || 0, replies: m.reply_count || 0,
          reposts: (m.retweet_count || 0) + (m.quote_count || 0),
          impressions: m.impression_count || 0, metrics_at: now,
        } : { metrics_at: now }).eq('id', p.id)
        if (m) refreshed++
      }
    } catch (e) { console.error('[post-metrics]', userId, e.message) }
  }
  return { refreshed }
}
