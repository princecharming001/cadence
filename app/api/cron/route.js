// GET /api/cron  (Authorization: Bearer <CRON_SECRET>)
// The single heartbeat that drives every background engine. Order matters:
//   1. RECOVERY — release claims orphaned by crashes (engines, posts, clips)
//   2. DUE POSTS — the money path: publish what users already approved
//   3. ENGINES — campaigns, brand campaigns, X engagement, social auto-replies
//      (each claim-first, so overlapping ticks are harmless; each isolated so
//       one failure can't block the others)
//   4. CLIP SWEEP — kicked after the response (video work is too slow to hold
//      this request open)
//   5. HOUSEKEEPING — expire stale oauth states
import { after } from 'next/server'
import { admin } from '@/lib/supabase'
import { postOne } from '@/lib/posting'
import { runDueEngagement } from '@/lib/engagement'
import { runDueBrandCampaigns } from '@/lib/brand-campaigns'
import { runDueSocialEngagement } from '@/lib/social-engagement'
import { runDueFeederAgents } from '@/lib/feeder-agents'
import { releaseStaleClaims, sweepInterruptedPosts } from '@/lib/engine'
import { isCron } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 300

const safe = async fn => { try { return await fn() } catch (e) { return { error: e.message } } }

export async function GET(req) {
  if (!isCron(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Recovery sweeps — cheap, always first.
  await safe(() => sweepInterruptedPosts(10))
  for (const t of ['brand_campaigns', 'engagement_rules', 'social_engagement', 'feeder_agents']) {
    await safe(() => releaseStaleClaims(t, 30))
  }

  // 2. Due posts — publish before spending time on generation engines.
  const now = new Date().toISOString()
  const { data: duePosts, error } = await admin
    .from('posts')
    .select('*')
    .eq('status', 'queued')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(25)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const results = []
  for (const post of duePosts || []) results.push(await postOne(post))

  // 3. Engines — claim-first, individually isolated. (The X-only `campaigns`
  // engine was retired in favor of brand_campaigns, which targets X too.)
  const brand = await safe(runDueBrandCampaigns)
  const engagement = await safe(runDueEngagement)
  const social = await safe(runDueSocialEngagement)
  const agents = await safe(runDueFeederAgents)

  // 4 + 5. After the response: clip sweep kick + housekeeping.
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  after(async () => {
    await fetch(`${base}/api/clips/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
    await admin.from('x_oauth_states').delete().lt('created_at', new Date(Date.now() - 3600 * 1000).toISOString()).then(() => {}, () => {})
  })

  return Response.json({
    posted: results.filter(r => r.status === 'posted').length,
    results, brand, engagement, social, agents,
  })
}
