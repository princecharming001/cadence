// GET /api/x/stats — growth metrics for the user's PRIMARY X account.
//   newFollowers30d — follower delta vs the oldest snapshot in the 30d window
//                     (same account only; snapshots accrue from first visit)
//   impressions30d  — sum of impression_count over the last 30 days of tweets
//
// Cost discipline (X reads are pay-per-use):
//   - SNAPSHOT-FIRST: a fresh (<6h) snapshot answers with ZERO X calls.
//   - /users/me refresh at most every 6h; the 100-tweet timeline read at most
//     once per 6h per user (attempts tracked, so failures don't hot-retry),
//     and only when the shared daily read budget allows.
//   - On any X failure we serve the latest snapshot instead of nulls.
// Errors to the client are generic; detail goes to the server log.
import { admin, getUser } from '@/lib/supabase'
import { getValidAccessToken, fetchXUserMetrics, sumRecentImpressions, xReadEnabled } from '@/lib/x-oauth'

export const runtime = 'nodejs'
export const maxDuration = 60

const FRESH_MS = 6 * 3600 * 1000
const DAILY_READ_CAP = 2500 // mirrors lib/engagement.js — shared per-user budget

async function overReadBudget(userId, n) {
  const { data } = await admin.rpc('bump_x_reads', { p_user: userId, p_n: n })
  return typeof data === 'number' && data > DAILY_READ_CAP
}

const statsFrom = (row, baseline) => ({
  followers: row?.followers ?? null,
  newFollowers30d: row?.followers != null && baseline?.followers != null ? row.followers - baseline.followers : 0,
  impressions30d: row?.impressions_30d ?? null,
})

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: conn } = await admin
    .from('x_connections').select('*')
    .eq('user_id', user.id)
    .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
    .limit(1).single()
  if (!conn) return Response.json({ stats: null })

  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10)
  // Only this account's snapshots — switching primaries must not mix histories.
  const { data: snaps } = await admin.from('x_stat_snapshots')
    .select('captured_on, followers, impressions_30d, fetched_at, impressions_tried_at')
    .eq('user_id', user.id).eq('x_user_id', conn.x_user_id)
    .gte('captured_on', since)
    .order('captured_on', { ascending: true })

  const rows = snaps || []
  const todayRow = rows.find(s => s.captured_on === today)
  const baseline = rows[0]
  const latest = rows[rows.length - 1]

  // FAST PATH — fresh snapshot, complete data: no X calls at all.
  const fresh = todayRow?.fetched_at && Date.now() - new Date(todayRow.fetched_at).getTime() < FRESH_MS
  const impressionsSettled = todayRow?.impressions_30d != null ||
    (todayRow?.impressions_tried_at && Date.now() - new Date(todayRow.impressions_tried_at).getTime() < FRESH_MS)
  if (fresh && impressionsSettled) {
    return Response.json({ stats: statsFrom(todayRow, baseline) })
  }

  try {
    const token = await getValidAccessToken(conn)

    // Followers: reuse today's fresh number, else one /users/me read.
    let followers = fresh ? todayRow.followers : null
    if (followers == null) {
      followers = (await fetchXUserMetrics(token)).followers
    }

    // Impressions: reuse today's, else one timeline read per 6h, budget allowing.
    let impressions = todayRow?.impressions_30d ?? null
    let triedAt = todayRow?.impressions_tried_at || null
    const mayTry = impressions == null && xReadEnabled() && conn.x_user_id &&
      !(triedAt && Date.now() - new Date(triedAt).getTime() < FRESH_MS)
    if (mayTry && !(await overReadBudget(user.id, 1))) {
      triedAt = new Date().toISOString()
      try { impressions = await sumRecentImpressions(token, conn.x_user_id) }
      catch (e) { console.error('[x/stats] impressions read failed:', e.message) }
    }

    const row = {
      user_id: user.id, captured_on: today, x_user_id: conn.x_user_id,
      followers, impressions_30d: impressions,
      fetched_at: new Date().toISOString(), impressions_tried_at: triedAt,
    }
    await admin.from('x_stat_snapshots').upsert(row, { onConflict: 'user_id,captured_on' })
    return Response.json({ stats: statsFrom(row, baseline || row) })
  } catch (e) {
    console.error('[x/stats]', e.message)
    // Degrade to the most recent snapshot rather than blanking the tiles.
    if (latest) return Response.json({ stats: statsFrom(latest, baseline), stale: true })
    return Response.json({ stats: null, error: 'X stats are unavailable right now.' })
  }
}
