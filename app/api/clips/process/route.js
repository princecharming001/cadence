// Background worker: processes queued clip jobs. Called fire-and-forget on job
// creation, and swept by the cron as a backstop, so jobs never silently stall.
import { isCron } from '@/lib/supabase'
import { processQueuedClipJobs } from '@/lib/clips'

export const runtime = 'nodejs'
export const maxDuration = 900 // video work is slow by nature (podcast downloads especially)

export async function POST(req) {
  if (!isCron(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ results: await processQueuedClipJobs(2) })
}
