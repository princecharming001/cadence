// Background worker: processes queued clip jobs. Called fire-and-forget on job
// creation, and swept by the cron as a backstop, so jobs never silently stall.
import { processQueuedClipJobs } from '@/lib/clips'

export const runtime = 'nodejs'
export const maxDuration = 600 // video work is slow by nature

export async function POST(req) {
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ results: await processQueuedClipJobs(2) })
}
