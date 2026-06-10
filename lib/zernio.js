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
  // Replace the cached set for this user.
  await admin.from('social_accounts').delete().eq('user_id', userId)
  if (accounts.length) {
    await admin.from('social_accounts').insert(accounts.map(a => ({
      user_id: userId,
      zernio_account_id: a._id || a.id || a.accountId,
      platform: a.platform,
      username: a.username || a.displayName || a.name || null,
      avatar: a.profilePicture || a.avatar || a.profileImageUrl || null,
    })))
  }
  const { data } = await admin.from('social_accounts').select('*').eq('user_id', userId)
  return data || []
}

// Create (or schedule) a post across the given accounts. mediaUrls in order =
// an Instagram carousel; omit scheduledFor to publish now.
export async function createPost({ userId, accounts, content, mediaUrls = [], scheduledFor, timezone }) {
  await ensureProfile(userId)
  const platforms = accounts.map(a => ({ platform: a.platform, accountId: a.zernio_account_id }))
  const body = {
    content: content || '',
    platforms,
    mediaItems: mediaUrls.map(url => ({ type: 'image', url })),
    ...(scheduledFor ? { scheduledFor, timezone: timezone || 'UTC' } : { publishNow: true }),
  }
  const d = await zfetch('/posts', { method: 'POST', body })
  return { id: d.post?._id || d._id || d.id, status: d.post?.status || d.status || 'submitted' }
}
