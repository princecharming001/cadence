// GET  /api/persona  → the stored voice profile
// POST /api/persona  → (Pro) re-learn the voice. Content is pulled from every
// connected platform automatically first — no manual "pull" step for the user.
import { admin, getUser } from '@/lib/supabase'
import { isPro } from '@/lib/profile'
import { analyzePersona } from '@/lib/persona'
import { pullVoice } from '@/lib/voice-pull'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('personas').select('*').eq('user_id', user.id).single()
  return Response.json({ persona: data || null })
}

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!(await isPro(user))) return Response.json({ error: 'upgrade_required' }, { status: 402 })

  try {
    // Best-effort fresh pull from everything connected; analysis proceeds with
    // whatever lands (LinkedIn scrape corpus is merged inside analyzePersona).
    await Promise.allSettled(['x', 'instagram', 'tiktok', 'linkedin'].map(p => pullVoice(user.id, p)))
    const persona = await analyzePersona(user.id)
    return Response.json({ persona })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 })
  }
}
