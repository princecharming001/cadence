// lib/account-scope.js — the ONE place that answers "which account is active for
// this platform, and what is its identity?" Each managed account (an x_connection
// for X, a social_account for the others) is its own brand identity: its own
// onboarding, brand brief, persona, autopilot, and auto-replies. Switching the
// active account re-scopes the whole app to it.
//
// Back-compat: when an account has no per-account override (account_profiles row),
// callers fall back to the user-level persona + profiles.brand_brief, so existing
// single-account setups keep working untouched.
import { admin } from './supabase'

// The ACTIVE account for a platform. X = the primary connection; the rest = the
// social_account flagged active (earliest as a fallback). Normalized shape with a
// `kind` + the right scope id, so callers don't branch on platform everywhere.
export async function activeAccount(userId, platform) {
  if ((platform || 'x') === 'x') {
    const { data } = await admin.from('x_connections')
      .select('id, username, x_user_id, is_primary, created_at')
      .eq('user_id', userId)
      .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
      .limit(1).maybeSingle()
    return data ? { kind: 'x', id: data.id, x_connection_id: data.id, social_account_id: null, username: data.username, x_user_id: data.x_user_id, platform: 'x' } : null
  }
  const { data } = await admin.from('social_accounts')
    .select('id, username, active, created_at')
    .eq('user_id', userId).eq('platform', platform)
    .order('active', { ascending: false }).order('created_at', { ascending: true })
    .limit(1).maybeSingle()
  return data ? { kind: 'social', id: data.id, x_connection_id: null, social_account_id: data.id, username: data.username, platform } : null
}

// The per-account override row (brand_brief / persona / onboarded_at), if any.
export async function accountProfile(acct) {
  if (!acct) return null
  const col = acct.kind === 'x' ? 'x_connection_id' : 'social_account_id'
  const { data } = await admin.from('account_profiles').select('*').eq(col, acct.id).maybeSingle()
  return data || null
}

// The scope columns to stamp on a per-account row for this account.
export const scopeCols = acct => (acct ? (acct.kind === 'x' ? { x_connection_id: acct.id } : { social_account_id: acct.id }) : {})

// Mark an account onboarded (idempotent upsert of its account_profiles row).
// Optionally persist a per-account brand_brief and/or persona override at the same
// time (what the onboarding flow gathers for THIS account).
export async function markAccountOnboarded(userId, acct, { brand_brief, persona } = {}) {
  if (!acct) return
  const row = {
    user_id: userId, platform: acct.platform, ...scopeCols(acct),
    onboarded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
  if (brand_brief !== undefined) row.brand_brief = brand_brief
  if (persona !== undefined) row.persona = persona
  const onConflict = acct.kind === 'x' ? 'x_connection_id' : 'social_account_id'
  await admin.from('account_profiles').upsert(row, { onConflict }).then(() => {}, () => {})
}

// Has this account completed onboarding? (a profile row with onboarded_at set)
export async function isAccountOnboarded(acct) {
  const p = await accountProfile(acct)
  return !!p?.onboarded_at
}
