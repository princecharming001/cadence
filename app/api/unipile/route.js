// /api/unipile — LinkedIn engagement (Unipile) connect flow.
// GET  (authed)  → hosted-auth link the user visits to connect their LinkedIn
// POST (webhook) → Unipile notifies us with the new account id; `name` carries
//                  the Cadence user id we passed when creating the link.
import { admin, getUser } from '@/lib/supabase'
import { unipileEnabled, hostedAuthLink } from '@/lib/unipile'

export const runtime = 'nodejs'

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!unipileEnabled()) return Response.json({ error: 'LinkedIn engagement is not configured yet (UNIPILE_DSN / UNIPILE_API_KEY).' }, { status: 503 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  try {
    return Response.json({ url: await hostedAuthLink(user.id, appUrl) })
  } catch (e) {
    console.error('[unipile] link failed:', e.message)
    return Response.json({ error: 'Could not start the LinkedIn connection.' }, { status: 500 })
  }
}

export async function POST(req) {
  // Unipile's notify webhook. No auth header — validate shape + that `name`
  // is one of our user ids before writing anything.
  const body = await req.json().catch(() => ({}))
  const userId = body.name
  const accountId = body.account_id || body.accountId || body.id
  if (!userId || !accountId) return Response.json({ ok: true }) // not ours / malformed — ack and ignore
  const { data: profile } = await admin.from('profiles').select('id').eq('id', userId).single()
  if (!profile) return Response.json({ ok: true })
  // Attach to the LinkedIn social_accounts row (create a bare one if the user
  // hasn't connected LinkedIn through Zernio yet).
  const { data: acct } = await admin.from('social_accounts')
    .select('id').eq('user_id', userId).eq('platform', 'linkedin').limit(1).single()
  if (acct) {
    await admin.from('social_accounts').update({ unipile_account_id: String(accountId) }).eq('id', acct.id)
  } else {
    await admin.from('social_accounts').insert({
      user_id: userId, platform: 'linkedin', zernio_account_id: `unipile-${accountId}`,
      unipile_account_id: String(accountId), username: null,
    })
  }
  return Response.json({ ok: true })
}
