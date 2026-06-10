// POST /api/x/connect  (Authorization: Bearer <supabase token>)
// Starts the X OAuth 2.0 flow: stores PKCE verifier keyed by state, returns the authorize URL.
import { admin, getUser } from '@/lib/supabase'
import { makePkce, authorizeUrl } from '@/lib/x-oauth'

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { code_verifier, challenge, state } = makePkce()

  const { error } = await admin
    .from('x_oauth_states')
    .insert({ state, user_id: user.id, code_verifier })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ url: authorizeUrl({ challenge, state }) })
}
