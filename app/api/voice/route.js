// Voice ingestion: pull a connected account's content into voice_samples, and
// report how many samples the voice is learning from per platform.
import { getUser } from '@/lib/supabase'
import { pullVoice, voiceSampleCounts } from '@/lib/voice-pull'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  return Response.json({ counts: await voiceSampleCounts(user.id) })
}

// POST { platform } → pull recent content from that platform's primary account
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { platform } = await req.json().catch(() => ({}))
  if (!['x', 'instagram', 'tiktok', 'linkedin'].includes(platform)) return Response.json({ error: 'Bad platform' }, { status: 400 })
  const r = await pullVoice(user.id, platform)
  return Response.json({ ...r, counts: await voiceSampleCounts(user.id) })
}
