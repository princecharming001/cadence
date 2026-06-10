// GET /api/x/callback?code=...&state=...
// X redirects here after the user authorizes. We exchange the code for tokens,
// fetch the X identity, and persist the connection for the originating user.
import { admin } from '@/lib/supabase'
import { exchangeCode, fetchXUser } from '@/lib/x-oauth'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

function redirect(path) {
  return Response.redirect(`${APP_URL}${path}`, 302)
}

export async function GET(req) {
  const url   = new URL(req.url)
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const err   = url.searchParams.get('error')

  if (err)            return redirect(`/?x=denied`)
  if (!code || !state) return redirect(`/?x=error`)

  // Look up the PKCE verifier + user for this state.
  const { data: row } = await admin
    .from('x_oauth_states')
    .select('*')
    .eq('state', state)
    .single()

  if (!row) return redirect(`/?x=expired`)

  try {
    const tok    = await exchangeCode(code, row.code_verifier)
    const xUser  = await fetchXUser(tok.access_token)
    const expiry = new Date(Date.now() + (tok.expires_in || 7200) * 1000).toISOString()

    await admin.from('x_connections').upsert({
      user_id:       row.user_id,
      x_user_id:     xUser.id,
      username:      xUser.username,
      name:          xUser.name,
      access_token:  tok.access_token,
      refresh_token: tok.refresh_token || null,
      scope:         tok.scope || null,
      expires_at:    expiry,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,x_user_id' })

    // One-time state — clean it up.
    await admin.from('x_oauth_states').delete().eq('state', state)

    return redirect(`/?x=connected&handle=${encodeURIComponent(xUser.username)}`)
  } catch (e) {
    console.error('[x/callback]', e)
    return redirect(`/?x=error`)
  }
}
