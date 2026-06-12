// lib/zernio.js — multi-tenant social publishing via Zernio (zernio.com, the
// renamed getlate.dev). Verified against docs.zernio.com: each Cadence user maps
// to one Zernio "profile" that holds their connected Instagram/TikTok/LinkedIn
// accounts; we post carousels by passing our public slide image URLs directly.
//
// Gated on ZERNIO_API_KEY — until the operator sets it, every call throws a
// friendly "not configured" error the routes turn into clear UI guidance.
import { admin } from './supabase'

const BASE = 'https://zernio.com/api/v1'

export function zernioEnabled() { return !!process.env.ZERNIO_API_KEY }

async function zfetch(path, { method = 'GET', body } = {}) {
  if (!zernioEnabled()) { const e = new Error('Social publishing is not configured yet (ZERNIO_API_KEY missing).'); e.notConfigured = true; throw e }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data; try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`Zernio ${method} ${path} failed (${res.status}): ${data.error || data.message || text}`.slice(0, 300))
  return data
}

// Return the user's Zernio profile id, creating + persisting it on first use so
// each Cadence user only ever connects their OWN accounts.
export async function ensureProfile(userId, label) {
  const { data: row } = await admin.from('social_profiles').select('zernio_profile_id').eq('user_id', userId).single()
  if (row?.zernio_profile_id) return row.zernio_profile_id
  const created = await zfetch('/profiles', { method: 'POST', body: { name: label || `cadence-${userId.slice(0, 8)}`, description: 'Cadence user' } })
  const pid = created.profile?._id || created._id || created.id
  if (!pid) throw new Error('Zernio did not return a profile id')
  await admin.from('social_profiles').upsert({ user_id: userId, zernio_profile_id: pid })
  return pid
}

// OAuth link URL the end-user visits to connect one platform to their profile.
// redirectUrl is where Zernio returns the user AFTER the platform OAuth — pass
// our own app URL so customers land back in Cadence, not on the zernio.com
// dashboard (the default). Verified param name: redirectUrl.
export async function connectUrl(userId, platform, redirectUrl) {
  const pid = await ensureProfile(userId)
  const qs = new URLSearchParams({ profileId: pid })
  if (redirectUrl) qs.set('redirectUrl', redirectUrl)
  const d = await zfetch(`/connect/${encodeURIComponent(platform)}?${qs.toString()}`)
  return d.authUrl || d.url
}

// Pull the profile's connected accounts from Zernio and cache them locally.
export async function syncAccounts(userId) {
  const pid = await ensureProfile(userId)
  const d = await zfetch(`/accounts?profileId=${encodeURIComponent(pid)}`)
  const accounts = (d.accounts || d || []).filter(a => a && (a._id || a.id || a.accountId))
  // MERGE, never delete-and-reinsert: row ids are referenced by feeder agents
  // (ON DELETE CASCADE) and posts, and rows carry state (unipile_account_id) —
  // a wholesale replace would orphan posts and silently kill agents.
  const { data: existing } = await admin.from('social_accounts').select('id, zernio_account_id').eq('user_id', userId)
  const byZid = new Map((existing || []).map(r => [r.zernio_account_id, r.id]))
  const liveIds = new Set()
  for (const a of accounts) {
    const zid = a._id || a.id || a.accountId
    liveIds.add(zid)
    const row = {
      user_id: userId, zernio_account_id: zid, platform: a.platform,
      username: a.username || a.displayName || a.name || null,
      avatar: a.profilePicture || a.avatar || a.profileImageUrl || null,
    }
    if (byZid.has(zid)) await admin.from('social_accounts').update(row).eq('id', byZid.get(zid))
    else await admin.from('social_accounts').insert(row)
  }
  // Accounts disconnected on the Zernio side go away (cascade cleans up agents
  // for accounts that genuinely no longer exist — that part is correct).
  const stale = (existing || []).filter(r => !liveIds.has(r.zernio_account_id)).map(r => r.id)
  if (stale.length) await admin.from('social_accounts').delete().in('id', stale)
  const { data } = await admin.from('social_accounts').select('*').eq('user_id', userId)
  return data || []
}

// Create (or schedule) a post across the given accounts. mediaUrls in order =
// an Instagram/LinkedIn carousel; omit scheduledFor to publish now.
//
// `title` is a short headline (the slideshow's cover hook). It matters because
// TikTok PHOTO posts use the post text as the slideshow TITLE, capped at 90
// chars — the full caption (with hashtags) blows past that and Zernio 400s. So
// each platform gets the right text via per-target `customContent`: TikTok gets
// the short title; everyone else keeps the full caption.
export async function createPost({ userId, accounts, content, mediaUrls = [], videoUrl, scheduledFor, timezone, title }) {
  await ensureProfile(userId)
  const fullCaption = content || ''
  const shortTitle = (title || fullCaption).replace(/\s+/g, ' ').trim().slice(0, 90)
  const platforms = accounts.map(a => {
    const item = { platform: a.platform, accountId: a.zernio_account_id }
    if (a.platform === 'tiktok' && !videoUrl) item.customContent = shortTitle // TikTok PHOTO title (<=90); video titles allow 2200
    if (a.platform === 'linkedin' && title) item.platformSpecificData = { documentTitle: title.slice(0, 100) }
    return item
  })
  const mediaItems = videoUrl ? [{ type: 'video', url: videoUrl }] : mediaUrls.map(url => ({ type: 'image', url }))
  const body = {
    content: fullCaption,
    platforms,
    mediaItems,
    ...(scheduledFor ? { scheduledFor, timezone: timezone || 'UTC' } : { publishNow: true }),
  }
  const d = await zfetch('/posts', { method: 'POST', body })
  return { id: d.post?._id || d._id || d.id, status: d.post?.status || d.status || 'submitted' }
}

// ── Inbox: comments read + reply (for the auto-engagement engine) ─────────────
// List the user's recent posts that have comments, for a platform/account.
export async function listCommentedPosts(userId, { platform, accountId, since, limit = 25 } = {}) {
  const pid = await ensureProfile(userId)
  const qs = new URLSearchParams({ profileId: pid, limit: String(limit) })
  if (platform) qs.set('platform', platform)
  if (accountId) qs.set('accountId', accountId)
  if (since) qs.set('since', since)
  const d = await zfetch(`/inbox/comments?${qs.toString()}`)
  return d.posts || d.items || d.data || (Array.isArray(d) ? d : [])
}

// Fetch the comment thread for one post.
export async function getPostComments(postId, accountId, limit = 50) {
  const qs = new URLSearchParams({ accountId, limit: String(limit) })
  const d = await zfetch(`/inbox/comments/${encodeURIComponent(postId)}?${qs.toString()}`)
  return d.comments || d.items || d.data || (Array.isArray(d) ? d : [])
}

// Post a public reply to a comment (or to the post if commentId omitted).
export async function replyToInboxComment({ postId, accountId, message, commentId }) {
  const d = await zfetch(`/inbox/comments/${encodeURIComponent(postId)}`, {
    method: 'POST', body: { accountId, message, ...(commentId ? { commentId } : {}) },
  })
  return d.reply?.commentId || d.commentId || d.id || 'posted'
}
