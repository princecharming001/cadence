// /api/autopilot — the content autopilot settings (one row per user+platform).
import { admin, getUser } from '@/lib/supabase'
import { runAutopilot, AUTOPILOT_PLATFORMS } from '@/lib/autopilot'
import { autopilotGate } from '@/lib/onboarding-gate'
import { activeAccount, accountProfile, markAccountOnboarded } from '@/lib/account-scope'

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

// Sanitize the IG/TikTok content plan from the MCQ onboarding (bounded enums +
// short strings) so a client can't stuff arbitrary jsonb onto the row.
const ARCHETYPES = ['educator', 'entertainer', 'aesthetic', 'founder', 'commentator', 'storyteller', 'insider', 'promoter']
const GOALS = ['grow', 'authority', 'sales', 'entertain', 'educate', 'personal_brand']
const PLAN_FORMATS = ['carousel', 'ugc_face', 'clip']
function cleanContentPlan(p) {
  if (!p || typeof p !== 'object') return {}
  const arr = (v, allow) => (Array.isArray(v) ? v : []).map(String).filter(x => allow.includes(x))
  return {
    archetype: ARCHETYPES.includes(p.archetype) ? p.archetype : null,
    goal: GOALS.includes(p.goal) ? p.goal : null,
    formats: [...new Set(arr(p.formats, PLAN_FORMATS))],
    niche: String(p.niche || '').slice(0, 200).trim(),
    tone: (Array.isArray(p.tone) ? p.tone : []).map(t => String(t).slice(0, 24)).filter(Boolean).slice(0, 5),
    face_photo_url: /^https?:\/\//.test(String(p.face_photo_url || '')) ? String(p.face_photo_url).slice(0, 600) : '',
  }
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
  const incomingPlan = b.content_plan !== undefined ? cleanContentPlan(b.content_plan) : undefined
  // The active account is its own identity: prefer its brand brief + persona
  // override for the readiness gate, falling back to the user-level defaults.
  const acct = await activeAccount(user.id, b.platform)
  const aProf = acct ? await accountProfile(acct) : null
  if (b.enabled === true || b.auto_post === true) {
    const { data: existing } = await admin.from('autopilot').select('auto_post, enabled, content_plan').eq('user_id', user.id).eq('platform', b.platform).maybeSingle()
    const willEnable = b.enabled !== undefined ? !!b.enabled : !!existing?.enabled
    const autoPost = b.auto_post !== undefined ? !!b.auto_post : !!existing?.auto_post
    if (willEnable) {
      const [{ data: prof }, { data: persona }, hasAccount] = await Promise.all([
        admin.from('profiles').select('brand_brief').eq('id', user.id).maybeSingle(),
        admin.from('personas').select('user_id').eq('user_id', user.id).maybeSingle(),
        platformHasAccount(user.id, b.platform),
      ])
      const brief = aProf?.brand_brief || prof?.brand_brief
      const hasPersona = !!(aProf?.persona || persona)
      const contentPlan = { ...(existing?.content_plan || {}), ...(incomingPlan || {}) }
      const gate = autopilotGate({ brief, hasPersona, hasAccount, autoPost, platform: b.platform, contentPlan })
      if (!gate.ok) {
        return Response.json({ error: 'Finish setting up before turning on Autopilot.', gate: { platform: b.platform, missing: gate.missing, autoPost } }, { status: 422 })
      }
    }
  }

  const patch = { user_id: user.id, platform: b.platform }
  if (b.enabled !== undefined) { patch.enabled = !!b.enabled; if (b.enabled) patch.next_run_at = new Date().toISOString() }
  if (b.auto_post !== undefined) patch.auto_post = !!b.auto_post
  if (incomingPlan !== undefined) patch.content_plan = incomingPlan
  if (b.per_run !== undefined) patch.per_run = Math.min(Math.max(Number(b.per_run) || 1, 1), 3)
  if (b.comments_per_day !== undefined) patch.comments_per_day = Math.min(Math.max(Number(b.comments_per_day) || 0, 0), 20)
  if (b.interval_hours !== undefined) patch.interval_hours = Math.min(Math.max(Number(b.interval_hours) || 24, 1), 168)

  const { data, error } = await admin.from('autopilot').upsert(patch, { onConflict: 'user_id,platform' }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Completing setup for a platform (the onboarding flows enable autopilot here)
  // marks the ACTIVE account onboarded AND persists its per-account brand brief
  // override (so each account keeps its own identity) — switching to it later
  // won't re-prompt, but switching to a DIFFERENT account still will.
  if (b.enabled === true) {
    const brief = (b.brand_brief && typeof b.brand_brief === 'object') ? b.brand_brief : undefined
    try { await markAccountOnboarded(user.id, acct, { brand_brief: brief }) } catch {}
  }

  if (b.action === 'run') {
    const r = await runAutopilot({ ...data, running: false })
    const { data: fresh } = await admin.from('autopilot').select('*').eq('id', data.id).single()
    return Response.json({ autopilot: fresh, result: r })
  }
  return Response.json({ autopilot: data })
}
