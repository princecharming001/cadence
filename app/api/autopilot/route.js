// /api/autopilot — the content autopilot settings (one row per user+platform).
import { admin, getUser } from '@/lib/supabase'
import { runAutopilot, AUTOPILOT_PLATFORMS } from '@/lib/autopilot'

export const runtime = 'nodejs'
export const maxDuration = 120

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

  const patch = { user_id: user.id, platform: b.platform }
  if (b.enabled !== undefined) { patch.enabled = !!b.enabled; if (b.enabled) patch.next_run_at = new Date().toISOString() }
  if (b.auto_post !== undefined) patch.auto_post = !!b.auto_post
  if (b.per_run !== undefined) patch.per_run = Math.min(Math.max(Number(b.per_run) || 1, 1), 3)
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
