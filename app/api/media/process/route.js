// Background worker: analyze queued video assets (download → ffprobe → frame
// vision → thumbnail). Kicked after a video upload and swept by the cron.
import { getUser, isCron } from '@/lib/supabase'
import { processQueuedMedia } from '@/lib/media-analysis'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req) {
  if (!isCron(req) && !(await getUser(req))) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  return Response.json(await processQueuedMedia(3))
}
