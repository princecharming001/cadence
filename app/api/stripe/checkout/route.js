// POST /api/stripe/checkout → start a subscription checkout, return the URL.
// Body: { plan: 'individual'|'team', interval: 'monthly'|'annual', seats?: number }
import { getUser, admin } from '@/lib/supabase'
import { getProfile } from '@/lib/profile'
import { stripe } from '@/lib/stripe'
import { PLANS, priceEnvKey } from '@/lib/plans'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!stripe) return Response.json({ error: 'Billing is not configured yet.' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const planKey = Object.hasOwn(PLANS, body.plan) ? body.plan : 'individual'
  const plan = PLANS[planKey]
  const interval = body.interval === 'annual' ? 'annual' : 'monthly'

  // Resolve the Stripe price: per-(plan,interval) var, with a fallback to the
  // legacy single STRIPE_PRICE_ID for individual/monthly so existing setups work.
  let priceId = process.env[priceEnvKey(planKey, interval)]
  if (!priceId && planKey === 'individual' && interval === 'monthly') priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) return Response.json({ error: `No price configured for ${plan.name} (${interval}).` }, { status: 503 })

  // Seats: 1 for individual; clamp to the plan's range for team.
  let seats = 1
  if (plan.perSeat) {
    seats = Math.min(Math.max(parseInt(body.seats, 10) || plan.minSeats, plan.minSeats), plan.maxSeats || 50)
  }

  try {
    const profile = await getProfile(user)

    // An active subscriber changing plans goes through the billing portal —
    // a fresh checkout would create a SECOND live subscription (double-billing).
    if (profile.is_pro && profile.stripe_subscription_id && profile.stripe_customer_id) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${APP_URL}/`,
      })
      return Response.json({ url: portal.url, portal: true })
    }

    // Reuse or create a Stripe customer for this user.
    let customerId = profile.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } })
      customerId = customer.id
      await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id)
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: seats }],
      allow_promotion_codes: true,
      success_url: `${APP_URL}/?billing=success`,
      cancel_url: `${APP_URL}/?billing=cancelled`,
      metadata: { user_id: user.id, plan: planKey, interval, seats: String(seats) },
      subscription_data: { metadata: { user_id: user.id, plan: planKey, interval, seats: String(seats) } },
    })
    return Response.json({ url: checkout.url })
  } catch (e) {
    console.error('[stripe/checkout]', e.message)
    return Response.json({ error: 'Could not start checkout — try again in a moment.' }, { status: 502 })
  }
}
