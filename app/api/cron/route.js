// GET /api/cron  (Authorization: Bearer <CRON_SECRET>)
// The single heartbeat that drives every background engine. Order matters:
//   1. RECOVERY — release claims orphaned by crashes (engines, posts, clips)
//   2. DUE POSTS — the money path: publish what users already approved
//      (+ PRECISION: posts due within this tick's window fire at their exact
//       minute via in-process timers — a "9:00" post goes out at 9:00, not at
//       whenever the next tick lands; claimPost CAS makes double-fires safe)
//   3. ENGINES — campaigns, brand campaigns, X engagement, social auto-replies
//      (each claim-first, so overlapping ticks are harmless; each isolated so
//       one failure can't block the others)
//   4. CLIP SWEEP + METRICS — after the response (slow work doesn't hold it)
//   5. HOUSEKEEPING — expire stale oauth states
import { after } from 'next/server'
import { admin } from '@/lib/supabase'
import { postOne } from '@/lib/posting'
import { refreshPostMetrics } from '@/lib/post-metrics'
import { runDueBrandLearning } from '@/lib/brand-learning'
import { runDueCampaignSentiment } from '@/lib/campaign-sentiment'
import { runDueEngagement } from '@/lib/engagement'
import { runDueBrandCampaigns } from '@/lib/brand-campaigns'
import { runDueSocialEngagement } from '@/lib/social-engagement'
import { runDueFeederAgents } from '@/lib/feeder-agents'
import { harvestDueTrends } from '@/lib/trends-harvest'
import { runDueAutopilot } from '@/lib/autopilot'
import { runDueSlideshows } from '@/lib/slideshow-dispatch'
import { releaseStaleClaims, sweepInterruptedPosts } from '@/lib/engine'
import { isCron } from '@/lib/supabase'

// Threads publish root-first: order by time, then thread part order.
const fireOrder = (a, b) =>
  new Date(a.scheduled_for) - new Date(b.scheduled_for) || (a.thread_index || 0) - (b.thread_index || 0)

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
  for (const post of (duePosts || []).sort(fireOrder)) results.push(await postOne(post))

  // 2b. Precision firing: anything due before the NEXT tick gets an exact-time
  // timer inside this invocation (the function stays alive via after()).
  const { data: upcoming } = await admin.from('posts').select('*')
    .eq('status', 'queued').gt('scheduled_for', now)
    .lte('scheduled_for', new Date(Date.now() + 4.5 * 60e3).toISOString())
    .order('scheduled_for', { ascending: true }).limit(20)
  if (upcoming?.length) {
    after(async () => {
      for (const p of upcoming.sort(fireOrder)) {
        const wait = new Date(p.scheduled_for).getTime() - Date.now()
        if (wait > 0) await new Promise(r => setTimeout(r, wait))
        await postOne(p).catch(() => {}) // CAS-claimed: a parallel tick can't double-post
      }
    })
  }

  // 3. Engines — claim-first, individually isolated. (The X-only `campaigns`
  // engine was retired in favor of brand_campaigns, which targets X too.)
  const brand = await safe(runDueBrandCampaigns)
  const engagement = await safe(runDueEngagement)
  const social = await safe(runDueSocialEngagement)
  const agents = await safe(runDueFeederAgents)
  const autopilot = await safe(runDueAutopilot)
  const carousels = await safe(runDueSlideshows)

  // 4 + 5. After the response: clip sweep kick + metrics loop + housekeeping.
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  after(async () => {
    await fetch(`${base}/api/clips/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
    await fetch(`${base}/api/video/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {}) // render queued generated-video jobs (backstop)
    await fetch(`${base}/api/media/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {}) // analyze queued library videos
    await refreshPostMetrics().catch(() => {}) // pull engagement back onto published posts
    // Engagement → memory: distill fresh results (numbers + audience comments +
    // thumbs) into durable cross-platform learnings that shape every future post.
    // Runs AFTER the metrics refresh so it learns from the latest numbers.
    await runDueBrandLearning({ limit: 5 }).catch(() => {})
    // Campaign intelligence — qualitative half: classify audience comments on
    // each active campaign's posts (aspect-based sentiment + emotion + sarcasm
    // gate) so the campaign-learning loop and dashboard see what the audience feels.
    await runDueCampaignSentiment({ limit: 5 }).catch(() => {})
    // Intrinsic daily trend detection: harvest a few stale users' niches so
    // fresh viral formats feed generation without anyone pressing a button.
    await harvestDueTrends({ limit: 3, deepN: 2 }).catch(() => {})
    await admin.from('x_oauth_states').delete().lt('created_at', new Date(Date.now() - 3600 * 1000).toISOString()).then(() => {}, () => {})
  })

  return Response.json({
    posted: results.filter(r => r.status === 'posted').length,
    results, brand, engagement, social, agents, autopilot, carousels,
  })
}
