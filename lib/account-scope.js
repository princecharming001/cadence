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

// ── Per-account automation config (autopilot + auto-reply) ────────────────────
// The live autopilot/social_engagement rows are one-per-(user,platform) and always
// mirror the ACTIVE account. We SNAPSHOT the active account's config into its
// account_profiles row on every save, and RESTORE a target account's snapshot into
// the live rows when it becomes active — so each account keeps its own automation
// settings and switching never clobbers them.

export async function snapshotAccountConfig(userId, platform, acct) {
  if (!acct) return
  const [{ data: a }, { data: se }] = await Promise.all([
    admin.from('autopilot').select('enabled, auto_post, per_run, interval_hours, comments_per_day, content_plan').eq('user_id', userId).eq('platform', platform).maybeSingle(),
    admin.from('social_engagement').select('enabled, auto_post, instructions').eq('user_id', userId).eq('platform', platform).maybeSingle(),
  ])
  const onConflict = acct.kind === 'x' ? 'x_connection_id' : 'social_account_id'
  await admin.from('account_profiles').upsert({
    user_id: userId, platform, ...scopeCols(acct),
    autopilot: a || null, social_engagement: se || null, updated_at: new Date().toISOString(),
  }, { onConflict }).then(() => {}, () => {})
}

// Make the live rows reflect `acct`'s saved config. A not-yet-onboarded account
// has no snapshot → its automations come up DISABLED (so a fresh account never
// auto-runs with the previous account's settings) until its onboarding configures
// them.
export async function restoreAccountConfig(userId, platform, acct) {
  const prof = acct ? await accountProfile(acct) : null
  const ap = prof?.autopilot || {}
  await admin.from('autopilot').upsert({
    user_id: userId, platform,
    enabled: !!ap.enabled, auto_post: !!ap.auto_post,
    per_run: ap.per_run ?? 1, interval_hours: ap.interval_hours ?? 24,
    comments_per_day: ap.comments_per_day ?? 0, content_plan: ap.content_plan ?? null,
    running: false, next_run_at: ap.enabled ? new Date().toISOString() : null,
  }, { onConflict: 'user_id,platform' }).then(() => {}, () => {})
  const se = prof?.social_engagement || {}
  await admin.from('social_engagement').upsert({
    user_id: userId, platform,
    enabled: !!se.enabled, auto_post: !!se.auto_post, instructions: se.instructions ?? null,
    running: false, next_run_at: se.enabled ? new Date().toISOString() : null,
  }, { onConflict: 'user_id,platform' }).then(() => {}, () => {})
}
