// lib/scheduling.js — "right time" made real. Picks actual posting slots
// instead of whenever-cron-runs:
//   1. inside the user's posting WINDOWS (profiles.posting_windows, in their tz)
//   2. weighted by their own track record — hours where past posts earned the
//     most engagement win (the analytics → timing loop)
//   3. never colliding with something already queued (min gap), and
//   4. jittered off round numbers so a feed never looks machine-stamped.
import { admin } from './supabase'

// Per-platform minimum gap between posts. Research (226K LinkedIn posts, 2026):
//   - LinkedIn: 3-14 day gaps optimal (+13% vs <12h gap); 1-2/week = peak per-post OPR.
//     Posting gap effect is causal (97.7% positive CATEs). Use 24h as a hard floor so
//     autopilot never stacks LinkedIn posts on the same day. Spreading to Mon/Wed/Fri or
//     Tue/Wed/Thu beats same-day clustering by +8-14%.
//   - X: fast-moving feed; 45 min prevents spam while allowing normal cadence.
const MIN_GAP_MIN = 45         // default for X (between two posts on a platform)
const PLATFORM_MIN_GAP_MIN = {
  x:         45,
  linkedin:  24 * 60,   // 24h floor — research recommends 3-14 day cadence
  instagram: 4 * 60,
  tiktok:    4 * 60,
}
const DEFAULT_TZ = 'America/Los_Angeles'
const DEFAULT_WINDOWS = [
  { start: '08:30', end: '10:30' },
  { start: '12:00', end: '13:30' },
  { start: '17:00', end: '19:30' },
]

// What hour is it (and what minute) in the user's timezone, for a given Date?
function tzParts(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false })
    .formatToParts(date)
  const get = t => Number(parts.find(p => p.type === t)?.value || 0)
  return { hour: get('hour') % 24, minute: get('minute') }
}
const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0) }

// Engagement-by-hour from the user's own posted history (needs metrics rows).
// RECENCY-weighted (recent results count more — the audience/algorithm drifts)
// and split by day-of-week as well as hour, so Tuesday-morning ≠ Saturday-morning
// for data-rich users; sparse day buckets fall back to the hour-only average. All
// keyed in UTC (scoring and lookup are both UTC, so they're consistent).
async function bestHours(userId) {
  const { data } = await admin.from('posts')
    .select('posted_at, likes, replies, reposts, impressions')
    .eq('user_id', userId).eq('status', 'posted')
    .not('metrics_at', 'is', null)
    .order('posted_at', { ascending: false }).limit(120)
  const now = Date.now()
  const byHour = {}, byDow = {}
  for (const p of data || []) {
    if (!p.posted_at) continue
    const score = (p.likes || 0) + 2 * (p.replies || 0) + 2 * (p.reposts || 0) + (p.impressions || 0) / 200
    const weeks = Math.max(0, (now - new Date(p.posted_at).getTime()) / (7 * 864e5))
    const w = Math.pow(0.9, weeks) // recent posts weigh more
    const d = new Date(p.posted_at), h = d.getUTCHours(), k = `${d.getUTCDay()}-${h}`
    ;(byHour[h] ||= { n: 0, sum: 0 }).n += w; byHour[h].sum += score * w
    ;(byDow[k] ||= { n: 0, sum: 0 }).n += w; byDow[k].sum += score * w
  }
  const avgH = {}, avgD = {}
  for (const [h, v] of Object.entries(byHour)) if (v.n >= 1.5) avgH[h] = v.sum / v.n
  for (const [k, v] of Object.entries(byDow)) if (v.n >= 1.5) avgD[k] = v.sum / v.n
  return { byHour: avgH, byDow: avgD } // empty until metrics accumulate
}

// The next good moment to post, as an ISO string.
export async function nextSmartSlot(userId, { platform = 'x', after = null } = {}) {
  const [{ data: profile }, { data: queued }, hourScores] = await Promise.all([
    admin.from('profiles').select('timezone, posting_windows').eq('id', userId).single(),
    admin.from('posts').select('scheduled_for').eq('user_id', userId)
      .in('status', ['queued', 'posting']).eq('platform', platform)
      .gte('scheduled_for', new Date(Date.now() - 3600e3).toISOString()),
    bestHours(userId).catch(() => ({ byHour: {}, byDow: {} })),
  ])
  const tz = profile?.timezone || DEFAULT_TZ
  const windows = (Array.isArray(profile?.posting_windows) && profile.posting_windows.length
    ? profile.posting_windows : DEFAULT_WINDOWS)
    .map(w => ({ start: toMin(w.start), end: toMin(w.end) }))
    .filter(w => w.end > w.start)
  const taken = (queued || []).map(q => new Date(q.scheduled_for).getTime())

  // Walk forward in 5-minute steps from `after` (default: 10 min from now),
  // scoring each candidate; first in-window, collision-free minute wins —
  // preferring proven hours when we have the data.
  const startMs = Math.max(Date.now() + 10 * 60e3, after ? new Date(after).getTime() : 0)
  let best = null
  for (let i = 0; i < (7 * 24 * 60) / 5; i++) {
    const t = new Date(startMs + i * 5 * 60e3)
    const { hour, minute } = tzParts(t, tz)
    const m = hour * 60 + minute
    if (!windows.some(w => m >= w.start && m <= w.end)) continue
    const minGap = (PLATFORM_MIN_GAP_MIN[platform] ?? MIN_GAP_MIN) * 60e3
    if (taken.some(x => Math.abs(x - t.getTime()) < minGap)) continue
    // Prefer a proven (day-of-week, hour) slot; fall back to the hour-only average.
    const score = hourScores.byDow?.[`${t.getUTCDay()}-${t.getUTCHours()}`] ?? hourScores.byHour?.[t.getUTCHours()] ?? 0
    if (!best) best = { t, score }
    else if (score > best.score * 1.25 && t.getTime() - best.t.getTime() < 26 * 3600e3) best = { t, score }
    else if (best && score <= best.score * 1.25 && t.getTime() - best.t.getTime() > 4 * 3600e3) break
  }
  const chosen = best ? best.t : new Date(startMs + 30 * 60e3)
  // Humanize the timestamp: a machine-stamped HH:MM:00 on a 5-minute grid is a
  // textbook bot signal. Drift ±3 minutes off the grid AND land on a random
  // second, so published times look like a person tapping "post".
  chosen.setMinutes(chosen.getMinutes() + Math.floor(Math.random() * 7) - 3, Math.floor(Math.random() * 60), 0)
  return chosen.toISOString()
}
