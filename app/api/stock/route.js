// /api/stock — stock search for the video editor's media picker (the browser
// can't import the server-only lib/stock.js). Returns cache-first, re-hosted,
// trusted URLs only. GET ?q=coffee&type=video|image&n=12
import { getUser } from '@/lib/supabase'
import { searchStock, stockEnabled } from '@/lib/stock'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!stockEnabled()) return Response.json({ enabled: false, hits: [] })
  const sp = new URL(req.url).searchParams
  const q = String(sp.get('q') || '').slice(0, 120).trim()
  if (!q) return Response.json({ enabled: true, hits: [] })
  const type = sp.get('type') === 'image' ? 'image' : 'video'
  const n = Math.min(Math.max(Number(sp.get('n')) || 12, 1), 24)
  const orientation = ['portrait', 'landscape', 'square'].includes(sp.get('orientation')) ? sp.get('orientation') : 'portrait'
  try {
    const hits = await searchStock(q, { type, n, orientation })
    return Response.json({ enabled: true, hits: (hits || []).map(h => ({ url: h.url, thumb: h.thumb_url || h.url, type: h.type || type })) })
  } catch (e) { return Response.json({ enabled: true, hits: [], error: String(e.message || e) }, { status: 200 }) }
}
