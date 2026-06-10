// Social accounts (via Zernio): list/sync the user's connected accounts, and
// get an OAuth link to connect a new one.
import { admin, getUser } from '@/lib/supabase'
import { connectUrl, syncAccounts, zernioEnabled } from '@/lib/zernio'

// GET /api/social            → cached connected accounts (+ whether posting is configured)
// GET /api/social?sync=1     → re-pull from Zernio first
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const sync = new URL(req.url).searchParams.get('sync')

  let accounts
  if (sync && zernioEnabled()) {
    try { accounts = await syncAccounts(user.id) }
    catch (e) { return Response.json({ accounts: [], configured: zernioEnabled(), error: e.message }) }
  } else {
    const { data } = await admin.from('social_accounts').select('*').eq('user_id', user.id)
    accounts = data || []
  }
  return Response.json({ accounts, configured: zernioEnabled() })
}

// POST /api/social { action:'connect', platform } → returns an OAuth authUrl to visit
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { action, platform } = await req.json().catch(() => ({}))

  if (action === 'connect') {
    if (!zernioEnabled()) return Response.json({ error: 'Connect a Zernio account first (set ZERNIO_API_KEY).' }, { status: 400 })
    const allowed = ['instagram', 'tiktok', 'linkedin', 'facebook', 'youtube', 'threads', 'pinterest']
    if (!allowed.includes(platform)) return Response.json({ error: 'Unsupported platform' }, { status: 400 })
    try { return Response.json({ authUrl: await connectUrl(user.id, platform) }) }
    catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// DELETE /api/social { id } → forget a cached account locally
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  await admin.from('social_accounts').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
