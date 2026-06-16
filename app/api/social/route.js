// Social accounts (via Zernio): list/sync the user's connected accounts, and
// get an OAuth link to connect a new one.
import { admin, getUser } from '@/lib/supabase'
import { connectUrl, syncAccounts, zernioEnabled, disconnectAccount } from '@/lib/zernio'

// Guarantee exactly one active account per (user, platform). A freshly-synced
// platform with no active account gets its earliest one promoted.
async function ensureActivePerPlatform(userId, accounts) {
  const byPlat = {}
  for (const a of accounts || []) (byPlat[a.platform] ||= []).push(a)
  for (const plat in byPlat) {
    const list = byPlat[plat].sort((x, y) => new Date(x.created_at || 0) - new Date(y.created_at || 0))
    if (!list.some(a => a.active)) {
      await admin.from('social_accounts').update({ active: true }).eq('id', list[0].id).then(() => {}, () => {})
      list[0].active = true
    }
  }
}

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
  // Make sure each platform has exactly one active account (a freshly-synced one
  // may have none yet — pick the earliest), then tag each account with whether it
  // has completed its own onboarding (per-account identity).
  await ensureActivePerPlatform(user.id, accounts)
  const { data: profs } = await admin.from('account_profiles').select('social_account_id, onboarded_at').eq('user_id', user.id)
  const onboarded = new Set((profs || []).filter(p => p.onboarded_at && p.social_account_id).map(p => p.social_account_id))
  accounts = (accounts || []).map(a => ({ ...a, onboarded: onboarded.has(a.id) }))
  return Response.json({ accounts, configured: zernioEnabled() })
}

// POST /api/social { action:'connect', platform } → returns an OAuth authUrl to visit
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { action, platform, id } = await req.json().catch(() => ({}))

  // Switch the ACTIVE account for a platform (the social equivalent of X's
  // "make primary"). One active per (user, platform); the client then re-scopes
  // the whole app to this account. Returns whether it still needs onboarding.
  if (action === 'set-active') {
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const { data: acct } = await admin.from('social_accounts').select('id, platform').eq('id', id).eq('user_id', user.id).single()
    if (!acct) return Response.json({ error: 'Account not found.' }, { status: 404 })
    // Only one active per (user, platform).
    await admin.from('social_accounts').update({ active: false }).eq('user_id', user.id).eq('platform', acct.platform)
    await admin.from('social_accounts').update({ active: true }).eq('id', id).eq('user_id', user.id)
    const { data: prof } = await admin.from('account_profiles').select('onboarded_at').eq('social_account_id', id).maybeSingle()
    return Response.json({ ok: true, onboarded: !!prof?.onboarded_at })
  }

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
  const { data: acct } = await admin.from('social_accounts').select('zernio_account_id, platform, active').eq('id', id).eq('user_id', user.id).single()
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
  // 3) Clean up THIS account's derived data so a future account on the same
  //    platform never inherits stale posts/replies (the "new account shows
  //    1 posted / 1 queued" bug) and orphaned pending posts don't clog the queue.
  //    Pending posts (can't fire without the account) go; posted history stays.
  await admin.from('posts').delete().eq('user_id', user.id).eq('social_account_id', id)
    .in('status', ['draft', 'queued', 'paused', 'posting', 'rendering', 'failed']).then(() => {}, () => {})
  if (acct.zernio_account_id) {
    await admin.from('social_replies').delete().eq('user_id', user.id).eq('account_id', acct.zernio_account_id).then(() => {}, () => {})
  }
  // 4) Remove the local row (cascades to feeder agents + account_profiles bound to it).
  await admin.from('social_accounts').delete().eq('id', id).eq('user_id', user.id)
  // 5) If we removed the ACTIVE account for this platform, promote the earliest
  //    remaining one so the platform always has an active account.
  if (acct.active) {
    const { data: next } = await admin.from('social_accounts')
      .select('id').eq('user_id', user.id).eq('platform', acct.platform)
      .order('created_at', { ascending: true }).limit(1)
    if (next?.[0]) await admin.from('social_accounts').update({ active: true }).eq('id', next[0].id).then(() => {}, () => {})
  }
  return Response.json({ deleted: true, unlinked })
}
