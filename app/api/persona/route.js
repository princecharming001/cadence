// GET  /api/persona  → the stored voice profile
// POST /api/persona  → (Pro) analyze LinkedIn posts and (re)build the voice profile
import { admin, getUser } from '@/lib/supabase'
import { isPro } from '@/lib/profile'
import { analyzePersona } from '@/lib/persona'

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
    const persona = await analyzePersona(user.id)
    return Response.json({ persona })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 })
  }
}
