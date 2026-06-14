// Background worker: processes queued generated-video jobs. Called fire-and-
// forget on job creation, and swept by the cron as a backstop, so jobs never
// silently stall. Mirrors /api/clips/process.
import { isCron } from '@/lib/supabase'
import { processQueuedVideoJobs } from '@/lib/video'

export const runtime = 'nodejs'
export const maxDuration = 900 // AI renders + ffmpeg montage are slow by nature

export async function POST(req) {
  if (!isCron(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // One job per invocation — a generated video can take 6+ min, so a second job
  // in the same call would get killed mid-poll by maxDuration and stick in
  // 'processing' for 30 min. Process one, then fire a fresh invocation to drain
  // the next (mirrors the cron backstop, but immediate).
  const results = await processQueuedVideoJobs(1)
  if (results.length) {
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    fetch(`${base}/api/video/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
  }
  return Response.json({ results })
}
