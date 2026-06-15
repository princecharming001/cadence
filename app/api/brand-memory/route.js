// /api/brand-memory — the user's shared brand brain, surfaced.
//   GET            → the durable learnings Cadence has distilled (what's working),
//                    grouped so the UI can show "what Cadence knows about you".
//   POST {action:'learn'} → distill now from the latest engagement (manual refresh
//                    of the loop that otherwise runs on cron).
import { admin, getUser } from '@/lib/supabase'
import { learnFromEngagement } from '@/lib/brand-learning'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('brand_memory')
    .select('id, kind, platform, text, weight, source, updated_at')
    .eq('user_id', user.id).eq('active', true)
    .order('weight', { ascending: false }).order('updated_at', { ascending: false })
  const { data: state } = await admin.from('brand_learning_state')
    .select('last_run_at, posts_seen').eq('user_id', user.id).maybeSingle()
  return Response.json({ insights: data || [], last_learned_at: state?.last_run_at || null })
}

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (b.action === 'learn') {
    const out = await learnFromEngagement(user.id)
    const { data } = await admin.from('brand_memory')
      .select('id, kind, platform, text, weight, source, updated_at')
      .eq('user_id', user.id).eq('active', true)
      .order('weight', { ascending: false }).order('updated_at', { ascending: false })
    return Response.json({ result: out, insights: data || [] })
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
