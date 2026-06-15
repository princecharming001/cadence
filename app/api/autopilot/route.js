// /api/autopilot — the content autopilot settings (one row per user+platform).
import { admin, getUser } from '@/lib/supabase'
import { runAutopilot, AUTOPILOT_PLATFORMS } from '@/lib/autopilot'
import { autopilotGate } from '@/lib/onboarding-gate'

export const runtime = 'nodejs'
export const maxDuration = 120

// Does this user have a connected account they can actually post to on `platform`?
// X lives in its own OAuth table; the rest are unified in social_accounts.
async function platformHasAccount(userId, platform) {
  if (platform === 'x') {
    const { count } = await admin.from('x_connections').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    return (count || 0) > 0
  }
  const { count } = await admin.from('social_accounts').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('platform', platform)
  return (count || 0) > 0
}

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('autopilot').select('*').eq('user_id', user.id)
  return Response.json({ autopilot: data || [] })
}

// POST { platform, enabled?, auto_post?, per_run?, interval_hours?, action? }
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!AUTOPILOT_PLATFORMS.includes(b.platform)) return Response.json({ error: 'Unsupported platform' }, { status: 400 })

  // Readiness gate — the trust boundary for hands-off posting. The client mirrors
  // this for UX, but a direct POST can't bypass it. Fires when ENABLING, or when
  // switching an enabled autopilot to hands-free auto-posting (the higher-stakes
  // tier, which additionally needs a learned voice + content pillars). Turning
  // things OFF is always allowed. Per-platform: each platform's account is its own
  // requirement, so finishing X never unlocks LinkedIn.
  if (b.enabled === true || b.auto_post === true) {
    const { data: existing } = await admin.from('autopilot').select('auto_post, enabled').eq('user_id', user.id).eq('platform', b.platform).maybeSingle()
    const willEnable = b.enabled !== undefined ? !!b.enabled : !!existing?.enabled
    const autoPost = b.auto_post !== undefined ? !!b.auto_post : !!existing?.auto_post
    if (willEnable) {
      const [{ data: prof }, { data: persona }, hasAccount] = await Promise.all([
        admin.from('profiles').select('brand_brief').eq('id', user.id).maybeSingle(),
        admin.from('personas').select('user_id').eq('user_id', user.id).maybeSingle(),
        platformHasAccount(user.id, b.platform),
      ])
      const gate = autopilotGate({ brief: prof?.brand_brief, hasPersona: !!persona, hasAccount, autoPost, platform: b.platform })
      if (!gate.ok) {
        return Response.json({ error: 'Finish setting up before turning on Autopilot.', gate: { platform: b.platform, missing: gate.missing, autoPost } }, { status: 422 })
      }
    }
  }

  const patch = { user_id: user.id, platform: b.platform }
  if (b.enabled !== undefined) { patch.enabled = !!b.enabled; if (b.enabled) patch.next_run_at = new Date().toISOString() }
  if (b.auto_post !== undefined) patch.auto_post = !!b.auto_post
  if (b.per_run !== undefined) patch.per_run = Math.min(Math.max(Number(b.per_run) || 1, 1), 3)
  if (b.comments_per_day !== undefined) patch.comments_per_day = Math.min(Math.max(Number(b.comments_per_day) || 0, 0), 20)
  if (b.interval_hours !== undefined) patch.interval_hours = Math.min(Math.max(Number(b.interval_hours) || 24, 1), 168)

  const { data, error } = await admin.from('autopilot').upsert(patch, { onConflict: 'user_id,platform' }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (b.action === 'run') {
    const r = await runAutopilot({ ...data, running: false })
    const { data: fresh } = await admin.from('autopilot').select('*').eq('id', data.id).single()
    return Response.json({ autopilot: fresh, result: r })
  }
  return Response.json({ autopilot: data })
}
