// lib/stock.js — the stock content library. Pulls B-roll clips / photos from
// third-party libraries (Pexels primary, Pixabay fallback) on demand and CACHES
// them: every clip is downloaded once, re-hosted to our public 'stock' bucket,
// and recorded in stock_assets, so the same topic never re-fetches or
// AI-regenerates. Shared across all users (stock is public-domain-ish, CC0).
//
// Cache-first: a search checks stock_assets before ever hitting an API; the API
// is only called to TOP UP when the cache is short. With no PEXELS_API_KEY /
// PIXABAY_API_KEY set, it runs cache-only (returns whatever's already cached).
import { admin } from './supabase'

const PEXELS = process.env.PEXELS_API_KEY
const PIXABAY = process.env.PIXABAY_API_KEY
const BUCKET = 'stock'
const MAX_BYTES = 60 * 1024 * 1024  // keep cached stock clips modest

export const stockEnabled = () => !!(PEXELS || PIXABAY)

const norm = q => String(q || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
const terms = q => norm(q).split(' ').filter(w => w.length > 2)

// Re-host a remote file into our public bucket. Returns { url, storage_path } or null.
async function reHost(srcUrl, provider, providerId, type) {
  try {
    const res = await fetch(srcUrl, { redirect: 'follow', signal: AbortSignal.timeout(60000) })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > MAX_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) return null
    const ext = type === 'video' ? 'mp4' : 'jpg'
    const storage_path = `${provider}/${type}/${providerId}.${ext}`
    const { error } = await admin.storage.from(BUCKET).upload(storage_path, buf, {
      contentType: type === 'video' ? 'video/mp4' : 'image/jpeg', upsert: true, cacheControl: '31536000',
    })
    if (error) return null
    return { url: admin.storage.from(BUCKET).getPublicUrl(storage_path).data.publicUrl, storage_path }
  } catch { return null }
}

// ── Provider adapters → a normalized { provider_id, type, src_url, width, height,
//    duration_sec, thumb_url, orientation, author, author_url } ────────────────
async function pexelsSearch(query, type, n, orientation) {
  if (!PEXELS) return []
  const o = ['portrait', 'landscape', 'square'].includes(orientation) ? orientation : 'portrait'
  const base = type === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search'
  const url = `${base}?query=${encodeURIComponent(query)}&per_page=${Math.min(n, 15)}&orientation=${o}`
  let r
  try { r = await fetch(url, { headers: { Authorization: PEXELS }, signal: AbortSignal.timeout(15000) }) } catch { return [] }
  if (!r.ok) return []
  const d = await r.json().catch(() => ({}))
  if (type === 'video') {
    return (d.videos || []).map(v => {
      // Pick a file ≤1280px tall to keep cache size sane; fall back to the smallest.
      const files = (v.video_files || []).filter(f => f.link)
      const portrait = files.filter(f => (f.height || 0) >= (f.width || 0))
      const pool = portrait.length ? portrait : files
      const pick = pool.filter(f => (f.height || 9999) <= 1280).sort((a, b) => (b.height || 0) - (a.height || 0))[0] || pool[0]
      if (!pick) return null
      return { provider_id: String(v.id), type: 'video', src_url: pick.link, width: pick.width, height: pick.height, duration_sec: v.duration, thumb_url: v.image, orientation: o, author: v.user?.name, author_url: v.user?.url }
    }).filter(Boolean)
  }
  return (d.photos || []).map(p => ({
    provider_id: String(p.id), type: 'image', src_url: p.src?.portrait || p.src?.large || p.src?.original,
    width: p.width, height: p.height, thumb_url: p.src?.tiny || p.src?.medium, orientation: o,
    author: p.photographer, author_url: p.photographer_url,
  })).filter(p => p.src_url)
}

async function pixabaySearch(query, type, n) {
  if (!PIXABAY) return []
  const base = type === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/'
  const extra = type === 'video' ? '' : '&image_type=photo'
  const url = `${base}?key=${PIXABAY}&q=${encodeURIComponent(query)}&per_page=${Math.min(Math.max(n, 3), 20)}${extra}`
  let r
  try { r = await fetch(url, { signal: AbortSignal.timeout(15000) }) } catch { return [] }
  if (!r.ok) return []
  const d = await r.json().catch(() => ({}))
  if (type === 'video') {
    return (d.hits || []).map(h => {
      const f = h.videos?.large?.url ? h.videos.large : (h.videos?.medium || h.videos?.small)
      if (!f?.url) return null
      return { provider_id: String(h.id), type: 'video', src_url: f.url, width: f.width, height: f.height, duration_sec: h.duration, thumb_url: (h.videos?.tiny || h.videos?.small)?.thumbnail, orientation: 'portrait', author: h.user, author_url: h.pageURL }
    }).filter(Boolean)
  }
  return (d.hits || []).map(h => ({ provider_id: String(h.id), type: 'image', src_url: h.largeImageURL || h.webformatURL, width: h.imageWidth, height: h.imageHeight, thumb_url: h.previewURL, orientation: 'portrait', author: h.user, author_url: h.pageURL })).filter(p => p.src_url)
}

// Read cached rows that match the query (tag-overlap OR substring), least-used first.
async function fromCache(query, type, n) {
  const ts = terms(query)
  let q = admin.from('stock_assets').select('*').eq('type', type).not('url', 'is', null)
  if (ts.length) q = q.or(`tags.ov.{${ts.join(',')}},query.ilike.%${norm(query)}%`)
  const { data } = await q.order('used_count', { ascending: true }).limit(n * 3)
  return (data || []).slice(0, n)
}

// searchStock(query, { type, n, orientation }) → up to n normalized stock assets,
// cache-first, topping up from a provider only when short. Always safe.
export async function searchStock(query, { type = 'video', n = 4, orientation = 'portrait' } = {}) {
  const Q = norm(query)
  if (!Q) return []
  let hits = await fromCache(Q, type, n)

  if (hits.length < n && stockEnabled()) {
    let fresh = await pexelsSearch(Q, type, (n - hits.length) + 2, orientation)
    let freshProvider = 'pexels'
    if (!fresh.length) { fresh = await pixabaySearch(Q, type, (n - hits.length) + 2); freshProvider = 'pixabay' }
    const have = new Set(hits.map(h => `${h.provider}:${h.provider_id}`))
    for (const f of fresh) {
      if (hits.length >= n) break
      const provider = freshProvider
      const key = `${provider}:${f.provider_id}`
      if (have.has(key)) continue
      const hosted = await reHost(f.src_url, provider, f.provider_id, f.type)
      if (!hosted) continue
      const row = {
        provider, provider_id: f.provider_id, type: f.type, query: Q, tags: terms(Q),
        url: hosted.url, src_url: f.src_url, storage_path: hosted.storage_path, thumb_url: f.thumb_url || null,
        width: f.width || null, height: f.height || null, duration_sec: f.duration_sec || null,
        orientation: f.orientation || null, author: f.author || null, author_url: f.author_url || null,
      }
      const { data: saved } = await admin.from('stock_assets').upsert(row, { onConflict: 'provider,provider_id', ignoreDuplicates: false }).select().single()
      if (saved) { hits.push(saved); have.add(key) }
    }
  }

  hits = hits.slice(0, n)
  if (hits.length) {
    await admin.from('stock_assets').update({ used_count: (hits[0].used_count || 0) + 1, last_used_at: new Date().toISOString() }).in('id', hits.map(h => h.id)).then(() => {}, () => {})
  }
  return hits.map(h => ({ id: h.id, url: h.url, type: h.type, thumb_url: h.thumb_url, width: h.width, height: h.height, duration_sec: h.duration_sec, provider: h.provider, author: h.author, author_url: h.author_url }))
}
