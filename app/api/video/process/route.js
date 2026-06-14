// Background worker: processes queued generated-video jobs. Called fire-and-
// forget on job creation, and swept by the cron as a backstop, so jobs never
// silently stall. Mirrors /api/clips/process.
import { isCron } from '@/lib/supabase'
import { processQueuedVideoJobs } from '@/lib/video'

export const runtime = 'nodejs'
export const maxDuration = 900 // AI renders + ffmpeg montage are slow by nature

export async function POST(req) {
  if (!isCron(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ results: await processQueuedVideoJobs(2) })
}
