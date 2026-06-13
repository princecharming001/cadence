// /api/trends — the Trend Engine surface.
//   GET                → the user's saved formats library
//   POST {url}         → analyze a viral reel/video (vision) and save the format
//   POST {text|posts, platform}     → distill a viral text hook pattern and save
//   DELETE {id}        → forget a format
import { admin, getUser } from '@/lib/supabase'
import { analyzeViralVideo, analyzeViralText } from '@/lib/trends'
import { runTrendHarvest } from '@/lib/trends-harvest'

export const runtime = 'nodejs'
export const maxDuration = 300 // video download + transcription + vision

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const platform = new URL(req.url).searchParams.get('platform')
  let q = admin.from('trend_formats').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(60)
  if (platform) q = q.eq('platform', platform)
  const { data } = await q
  return Response.json({ formats: data || [] })
}

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  try {
    if (b.action === 'harvest') {
      const summary = await runTrendHarvest(user.id, { platforms: b.platforms, deepN: Math.min(Math.max(Number(b.deepN) || 3, 1), 5) })
      return Response.json({ summary })
    }
    if (b.url && /^https?:\/\//.test(String(b.url))) {
      const format = await analyzeViralVideo(String(b.url), { userId: user.id, platform: b.platform })
      return Response.json({ format })
    }
    if (b.text || (Array.isArray(b.posts) && b.posts.length)) {
      const format = await analyzeViralText({ text: b.text, posts: b.posts, platform: b.platform || 'x', url: b.url }, { userId: user.id })
      if (format?.error) return Response.json({ error: format.error }, { status: 400 })
      return Response.json({ format })
    }
    return Response.json({ error: 'Paste a video link, or a post to analyze.' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: String(e.message || 'Could not analyze that.').slice(0, 200) }, { status: 200 })
  }
}

export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  await admin.from('trend_formats').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
