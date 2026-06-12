// Voice ingestion: pull a connected account's content into voice_samples, and
// report how many samples the voice is learning from per platform.
import { getUser } from '@/lib/supabase'
import { pullVoice, voiceSampleCounts } from '@/lib/voice-pull'

export const runtime = 'nodejs'
export const maxDuration = 180 // Apify history scrapes block until done

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  return Response.json({ counts: await voiceSampleCounts(user.id) })
}

// POST { platform } → pull recent content from that platform's primary account.
// platform 'all' sweeps every platform in parallel (Apify scrapes take a bit).
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { platform } = await req.json().catch(() => ({}))
  const ALL = ['x', 'instagram', 'tiktok', 'linkedin']
  if (platform === 'all') {
    const results = await Promise.all(ALL.map(p => pullVoice(user.id, p).then(r => [p, r]).catch(e => [p, { error: e.message }])))
    const pulled = results.reduce((n, [, r]) => n + (r.pulled || 0), 0)
    return Response.json({ pulled, byPlatform: Object.fromEntries(results), counts: await voiceSampleCounts(user.id) })
  }
  if (!ALL.includes(platform)) return Response.json({ error: 'Bad platform' }, { status: 400 })
  const r = await pullVoice(user.id, platform)
  return Response.json({ ...r, counts: await voiceSampleCounts(user.id) })
}
