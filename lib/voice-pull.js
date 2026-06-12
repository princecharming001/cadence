// lib/voice-pull.js — pull a user's real content from their connected accounts
// into voice_samples, so the voice analysis learns from how they actually write
// across X/LinkedIn/Instagram/TikTok, not just LinkedIn.
import { admin } from './supabase'
import { getValidAccessToken, searchRecent, xReadEnabled } from './x-oauth'
import { ensureProfile, zernioEnabled } from './zernio'

const clean = s => (s || '').replace(/\s+/g, ' ').trim()

async function store(userId, platform, items) {
  const rows = items.filter(i => clean(i.text).length > 30).map(i => ({
    user_id: userId, platform, ref: String(i.ref || i.text.slice(0, 40)), text: clean(i.text), metric: i.metric || 0,
  }))
  if (!rows.length) return 0
  await admin.from('voice_samples').upsert(rows, { onConflict: 'user_id,platform,ref' })
  return rows.length
}

// Pull recent content for one platform's PRIMARY connected account.
export async function pullVoice(userId, platform) {
  if (platform === 'x') {
    if (!xReadEnabled()) return { error: 'X reading is off (set X_READ_ENABLED).' }
    const { data: conn } = await admin.from('x_connections').select('*').eq('user_id', userId).order('is_primary', { ascending: false }).limit(1).single()
    if (!conn) return { error: 'Connect an X account first.' }
    const token = await getValidAccessToken(conn)
    let tweets = []
    try { tweets = await searchRecent(token, `from:${conn.username} -is:retweet -is:reply`, 40) }
    catch (e) { return { error: `X read failed: ${e.message}` } }
    const n = await store(userId, 'x', tweets.map(t => ({ ref: t.tweet_id, text: t.text, metric: (t.metrics?.like_count || 0) + (t.metrics?.retweet_count || 0) })))
    return { pulled: n }
  }

  // Instagram / TikTok: the account's REAL post history via Apify (captions +
  // engagement) — not just what was published through Cadence. Falls back to
  // Zernio's published-posts list when no Apify token is configured.
  if (platform === 'instagram' || platform === 'tiktok') {
    const { data: acct } = await admin.from('social_accounts').select('*').eq('user_id', userId).eq('platform', platform).limit(1).single()
    if (!acct) return { error: `Connect a ${platform} account first.` }
    const username = (acct.username || '').replace(/^@/, '').trim()
    if (process.env.APIFY_TOKEN && username) {
      try {
        const items = platform === 'instagram'
          ? await apifyInstagramPosts(username)
          : await apifyTikTokPosts(username)
        const n = await store(userId, platform, items)
        if (n) return { pulled: n }
        // fall through to Zernio if the scrape came back empty
      } catch (e) { console.error(`[voice-pull] apify ${platform} failed:`, e.message) }
    }
    return pullViaZernio(userId, platform, acct)
  }

  // LinkedIn → published-through-Cadence posts via Zernio (the user's own
  // LinkedIn history comes through the Apify self-profile pipeline instead).
  const { data: acct } = await admin.from('social_accounts').select('*').eq('user_id', userId).eq('platform', platform).limit(1).single()
  if (!acct) return { error: `Connect a ${platform} account first.` }
  return pullViaZernio(userId, platform, acct)
}

// ── Apify history scrapers (captions + engagement, ~$1.5-1.7 per 1k posts) ────
const APIFY = (actor) => `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`

async function apifyInstagramPosts(username, max = 30) {
  const res = await fetch(APIFY('apify~instagram-scraper'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directUrls: [`https://www.instagram.com/${username}/`], resultsType: 'posts', resultsLimit: max }),
  })
  if (!res.ok) throw new Error(`Apify instagram (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const items = await res.json()
  return (Array.isArray(items) ? items : [])
    .filter(p => p && (p.caption || p.alt))
    .map(p => ({ ref: p.id || p.shortCode, text: p.caption || p.alt, metric: (p.likesCount || 0) + 2 * (p.commentsCount || 0) }))
}

async function apifyTikTokPosts(username, max = 30) {
  const res = await fetch(APIFY('clockworks~tiktok-scraper'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles: [username], resultsPerPage: max, shouldDownloadVideos: false, shouldDownloadCovers: false }),
  })
  if (!res.ok) throw new Error(`Apify tiktok (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const items = await res.json()
  return (Array.isArray(items) ? items : [])
    .filter(p => p && p.text)
    .map(p => ({ ref: p.id, text: p.text, metric: (p.diggCount || 0) + 2 * (p.commentCount || 0) + 3 * (p.shareCount || 0) }))
}

// Zernio fallback: only sees posts published through Cadence.
async function pullViaZernio(userId, platform, acct) {
  if (!zernioEnabled()) return { error: 'Publishing (Zernio) not connected.' }
  const pid = await ensureProfile(userId)
  try {
    const qs = new URLSearchParams({ profileId: pid, accountId: acct.zernio_account_id, limit: '40' })
    const res = await fetch(`https://zernio.com/api/v1/posts?${qs.toString()}`, { headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}` } })
    const d = await res.json().catch(() => ({}))
    const posts = d.posts || d.items || d.data || (Array.isArray(d) ? d : [])
    const items = posts.map(p => ({ ref: p._id || p.id, text: p.content || p.caption || p.text || '' }))
    const n = await store(userId, platform, items)
    return n ? { pulled: n } : { pulled: 0, note: `No ${platform} content Cadence can read yet. Add an APIFY_TOKEN to pull the account's real history, or publish a few posts through Cadence first.` }
  } catch (e) { return { error: e.message } }
}

// All connected platforms' content + counts (for showing what voice is learning from).
export async function voiceSampleCounts(userId) {
  const { data } = await admin.from('voice_samples').select('platform').eq('user_id', userId)
  return (data || []).reduce((a, r) => { a[r.platform] = (a[r.platform] || 0) + 1; return a }, {})
}
