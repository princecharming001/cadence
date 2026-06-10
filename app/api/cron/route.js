// GET /api/cron  (Authorization: Bearer <CRON_SECRET>)
// Runs active marketing campaigns (which top up the queue), then finds due posts
// across ALL users and posts each via that user's connected X account.
import { admin } from '@/lib/supabase'
import { postOne } from '@/lib/posting'
import { runDueCampaigns } from '@/lib/campaigns'

export async function GET(req) {
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // First, let active campaigns queue fresh promo posts that are now due.
  let campaigns = null
  try { campaigns = await runDueCampaigns() } catch (e) { campaigns = { error: e.message } }

  const now = new Date().toISOString()
  const { data: duePosts, error } = await admin
    .from('posts')
    .select('*')
    .eq('status', 'queued')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })

  if (error) return Response.json({ error: error.message, campaigns }, { status: 500 })
  if (!duePosts?.length) return Response.json({ posted: 0, message: 'No posts due.', campaigns })

  const results = []
  for (const post of duePosts) results.push(await postOne(post))

  return Response.json({ posted: results.filter(r => r.status === 'posted').length, results, campaigns })
}
