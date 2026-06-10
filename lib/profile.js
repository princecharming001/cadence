// lib/profile.js — user profile + plan/billing gating.
import { admin } from './supabase'

// Billing only "turns on" once Stripe keys are present. Until then, no paywall
// (every feature is unlocked) so the app is fully usable in dev.
export function billingConfigured() {
  return !!process.env.STRIPE_SECRET_KEY
}

export async function getProfile(user) {
  let { data } = await admin.from('profiles').select('*').eq('id', user.id).single()
  if (!data) {
    const ins = await admin.from('profiles')
      .insert({ id: user.id, email: user.email }).select().single()
    data = ins.data
  }
  return data
}

// Pro = has an active subscription, OR billing isn't configured yet (dev/demo).
export async function isPro(user) {
  if (!billingConfigured()) return true
  const p = await getProfile(user)
  return !!p?.is_pro
}
