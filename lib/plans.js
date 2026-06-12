// lib/plans.js — subscription catalog. CLIENT-SAFE: display copy + prices only,
// no secrets. The actual Stripe price IDs live in env vars and are resolved
// server-side in the checkout route (see priceEnvKey).
//
// Pricing model:
//   Individual — flat, one user (quantity 1).
//   Team       — per-seat (quantity = seats), minimum 3 seats.
// Annual is billed once a year at ~2 months free vs monthly.

export const PLANS = {
  individual: {
    key: 'individual',
    name: 'Individual',
    tagline: 'For solo creators & founders',
    perSeat: false,
    minSeats: 1,
    monthly: 19,   // $/month
    annual: 182,   // $/year (~20% off)
    unit: '/mo',
    features: [
      'One user',
      'All your X, LinkedIn, Instagram & TikTok accounts',
      'Voice learned across every platform',
      'AI posts, carousels & video clips',
      'Auto-scheduling & auto-posting',
      'Auto-replies in your voice',
      'Cross-platform campaigns',
    ],
  },
  team: {
    key: 'team',
    name: 'Team',
    tagline: 'For teams & agencies',
    perSeat: true,
    minSeats: 3,
    maxSeats: 50,
    monthly: 15,   // $/seat/month
    annual: 144,   // $/seat/year (~20% off)
    unit: '/seat/mo',
    features: [
      'Everything in Individual, per seat',
      'Shared team workspace',
      'Multiple members & roles',
      'Centralized billing',
      'Priority support',
    ],
  },
}

export const PLAN_LIST = [PLANS.individual, PLANS.team]

// Effective monthly cost for the displayed price (annual shown as a /mo figure).
export function monthlyEquivalent(plan, interval) {
  return interval === 'annual' ? Math.round((plan.annual / 12) * 100) / 100 : plan.monthly
}

// Which Stripe price env var backs a (plan, interval). Falls back to the legacy
// single-price var so an existing STRIPE_PRICE_ID keeps working as individual/monthly.
export function priceEnvKey(planKey, interval) {
  const k = `STRIPE_PRICE_${String(planKey).toUpperCase()}_${interval === 'annual' ? 'ANNUAL' : 'MONTHLY'}`
  return k
}
