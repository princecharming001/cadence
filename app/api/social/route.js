// Social accounts (via Zernio): list/sync the user's connected accounts, and
// get an OAuth link to connect a new one.
import { admin, getUser } from '@/lib/supabase'
import { connectUrl, syncAccounts, zernioEnabled, disconnectAccount } from '@/lib/zernio'

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
    // Seed the voice automatically from whatever just connected (fire-and-forget).
    const { pullVoice } = await import('@/lib/voice-pull')
    const platforms = [...new Set((accounts || []).map(a => a.platform))]
    Promise.allSettled(platforms.map(p => pullVoice(user.id, p))).catch(() => {})
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
    // Reconnecting is an explicit choice — clear any tombstones for this platform
    // so a freshly re-linked account isn't blocked by an old disconnect.
    await admin.from('social_disconnects').delete().eq('user_id', user.id).eq('platform', platform).then(() => {}, () => {})
    // Return the customer to OUR app after they finish the platform OAuth.
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    const back = `${base}/?connected=${platform}`
    try { return Response.json({ authUrl: await connectUrl(user.id, platform, back) }) }
    catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// DELETE /api/social { id } → ACTUALLY disconnect: unlink at Zernio, tombstone the
// account so the next sync can't resurrect it, then remove the local row.
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { data: acct } = await admin.from('social_accounts').select('zernio_account_id, platform').eq('id', id).eq('user_id', user.id).single()
  if (!acct) return Response.json({ deleted: true }) // already gone
  // 1) Unlink at the provider (best-effort).
  let unlinked = false
  if (zernioEnabled() && acct.zernio_account_id) { try { unlinked = await disconnectAccount(acct.zernio_account_id, user.id) } catch {} }
  // 2) Tombstone so syncAccounts never re-adds it (even if the unlink lagged/failed).
  if (acct.zernio_account_id) {
    await admin.from('social_disconnects').upsert(
      { user_id: user.id, zernio_account_id: acct.zernio_account_id, platform: acct.platform },
      { onConflict: 'user_id,zernio_account_id', ignoreDuplicates: true }).then(() => {}, () => {})
  }
  // 3) Remove the local row (cascades to feeder agents bound to it).
  await admin.from('social_accounts').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true, unlinked })
}
