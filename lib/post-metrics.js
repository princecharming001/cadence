// lib/post-metrics.js — the analytics → generation loop, half one.
// After a post fires, pull its real engagement back onto the posts row
// (likes/replies/reposts/impressions). lib/voice.js then surfaces the user's
// top performers into every generation prompt, lib/scheduling.js weights
// posting slots by which hours actually earned engagement, and the campaign
// learning loop reach-normalizes these numbers into bandit rewards + learnings.
//
// Cost discipline: ONE batched X read (up to 100 tweets) per user per sweep,
// only for posts <7 days old whose metrics are missing or >12h stale, gated
// on X_READ_ENABLED + the shared per-user daily read budget. Non-X platforms
// (IG/TikTok via Zernio, LinkedIn via Unipile) are pulled in a bounded sweep
// so MULTI-PLATFORM campaigns actually learn — before this, only X posts ever
// got metrics, so IG/TikTok/LinkedIn posts were never "trusted" by the loop.
import { admin } from './supabase'
import { getValidAccessToken, lookupTweetMetrics, xReadEnabled } from './x-oauth'
import { zernioEnabled, postInsights } from './zernio'
import { unipileEnabled, unipileAccountId, listOwnPosts } from './unipile'

const STALE_HOURS = 12
const WINDOW_DAYS = 7
const SOCIAL_LIMIT = 120 // non-X posts refreshed per sweep (cost bound)

async function overReadBudget(userId, n) {
  const { data } = await admin.rpc('bump_x_reads', { p_user: userId, p_n: n })
  return typeof data === 'number' && data > 2500
}

// Public entry: refresh X (gated, budgeted) AND non-X (Zernio/Unipile) metrics.
// The cron ignores the return; the shape is for logging/debugging only.
export async function refreshPostMetrics() {
  const x = await refreshXMetrics().catch(e => ({ error: e.message }))
  const social = await refreshSocialMetrics().catch(e => ({ error: e.message }))
  return { x, social }
}

async function refreshXMetrics() {
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

// ── Non-X engagement backfill (IG/TikTok via Zernio, LinkedIn via Unipile) ────
const N = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
// Pull counts off a Unipile LinkedIn post item (tolerant of field naming).
const liLikes = it => N(it.reaction_counter ?? it.reactions_count ?? it.likes ?? it.like_count ?? it.social_counts?.reactions)
const liComments = it => N(it.comment_counter ?? it.comments_count ?? it.comments ?? it.social_counts?.comments)
const liReposts = it => N(it.repost_counter ?? it.shares_count ?? it.reposts ?? it.share_count ?? it.social_counts?.reposts)
const liImpr = it => N(it.impression_counter ?? it.impressions ?? it.views ?? it.view_count)
const liId = it => String(it.id ?? it.post_id ?? it.social_id ?? it.share_id ?? '')

async function refreshSocialMetrics() {
  if (!zernioEnabled() && !unipileEnabled()) return { skipped: 'no social providers' }
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString()
  const staleCut = new Date(Date.now() - STALE_HOURS * 3600e3).toISOString()
  const { data: due } = await admin.from('posts')
    .select('id, user_id, external_id, platform, social_account_id, metrics_at')
    .eq('status', 'posted').in('platform', ['instagram', 'tiktok', 'linkedin']).not('external_id', 'is', null)
    .gte('posted_at', since)
    .or(`metrics_at.is.null,metrics_at.lt.${staleCut}`)
    .limit(SOCIAL_LIMIT)
  if (!due?.length) return { refreshed: 0 }
  const now = new Date().toISOString()
  let refreshed = 0

  // LinkedIn: ONE listOwnPosts call per user, matched to our rows by external_id.
  if (unipileEnabled()) {
    const li = due.filter(p => p.platform === 'linkedin')
    const byUser = {}
    for (const p of li) (byUser[p.user_id] ||= []).push(p)
    for (const [userId, posts] of Object.entries(byUser)) {
      try {
        const acct = await unipileAccountId(userId)
        if (!acct) continue
        const own = await listOwnPosts(acct, 50).catch(() => [])
        const byId = {}
        for (const it of own) { const k = liId(it); if (k) byId[k] = it }
        for (const p of posts) {
          const it = byId[String(p.external_id)]
          if (it) {
            await admin.from('posts').update({ likes: liLikes(it), replies: liComments(it), reposts: liReposts(it), impressions: liImpr(it), metrics_at: now }).eq('id', p.id)
            refreshed++
          } else {
            await admin.from('posts').update({ metrics_at: now }).eq('id', p.id) // not in recent set → stamp, don't re-pull
          }
        }
      } catch (e) { console.error('[post-metrics linkedin]', userId, e.message) }
    }
  }

  // IG/TikTok: per-post Zernio analytics, bounded by SOCIAL_LIMIT.
  if (zernioEnabled()) {
    const ig = due.filter(p => p.platform === 'instagram' || p.platform === 'tiktok')
    const acctIds = [...new Set(ig.map(p => p.social_account_id).filter(Boolean))]
    let zmap = {}
    if (acctIds.length) {
      const { data: as } = await admin.from('social_accounts').select('id, zernio_account_id').in('id', acctIds)
      zmap = Object.fromEntries((as || []).map(a => [a.id, a.zernio_account_id]))
    }
    for (const p of ig) {
      const zid = zmap[p.social_account_id]
      if (!zid) { await admin.from('posts').update({ metrics_at: now }).eq('id', p.id); continue }
      try {
        const m = await postInsights(p.platform, zid, p.external_id)
        await admin.from('posts').update({ likes: m.likes || 0, replies: m.replies || 0, reposts: m.reposts || 0, impressions: m.impressions || 0, metrics_at: now }).eq('id', p.id)
        if (m.likes || m.replies || m.reposts || m.impressions) refreshed++
      } catch {
        await admin.from('posts').update({ metrics_at: now }).eq('id', p.id) // unknown/erroring endpoint → stamp so we don't re-spend each sweep
      }
    }
  }
  return { refreshed }
}
