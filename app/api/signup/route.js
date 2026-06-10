// POST /api/signup  { email, password }
// Creates an already-confirmed user via the service role, so no email
// confirmation step is ever required. The client then signs in normally.
import { admin } from '@/lib/supabase'

export async function POST(req) {
  try {
    const { email, password } = await req.json()
    if (!email || !password || password.length < 6) {
      return Response.json({ error: 'Email and a password (6+ chars) are required.' }, { status: 400 })
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm — skip the email link entirely
    })

    if (created?.user) {
      // Seed a profile row so billing/plan state exists from day one.
      await admin.from('profiles').insert({ id: created.user.id, email }).select().maybeSingle()
    }

    if (error) {
      // Friendly message for the common "already exists" case.
      if (/already|registered|exists/i.test(error.message)) {
        return Response.json({ error: 'That email is already registered — try signing in.' }, { status: 409 })
      }
      return Response.json({ error: error.message }, { status: 400 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
