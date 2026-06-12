// POST /api/stripe/webhook → Stripe events flip a user's plan/entitlements.
// This is the ONLY writer of billing columns. Failures return 500 so Stripe
// retries — a swallowed DB error here is a paying customer with no product.
import { admin } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'
import { PLANS, priceEnvKey } from '@/lib/plans'

// Reverse map: configured Stripe price id → { plan, interval }. Lets portal
// plan/interval switches persist even though they never pass our metadata.
function planFromPrice(priceId) {
  if (!priceId) return null
  for (const plan of Object.keys(PLANS)) {
    for (const interval of ['monthly', 'annual']) {
      if (process.env[priceEnvKey(plan, interval)] === priceId) return { plan, interval }
    }
  }
  if (process.env.STRIPE_PRICE_ID === priceId) return { plan: 'individual', interval: 'monthly' }
  return null
}

export async function POST(req) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: 'Billing not configured' }, { status: 503 })
  }

  const sig     = req.headers.get('stripe-signature')
  const rawBody = await req.text()

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return Response.json({ error: `Webhook signature failed: ${err.message}` }, { status: 400 })
  }

  let writeFailed = null
  async function setPro(customerId, { isPro, subId, periodEnd, plan, seats, interval }) {
    const patch = { is_pro: isPro }
    // Only write plan when we positively know it — never clobber with a guess.
    if (plan) patch.plan = plan
    else if (!isPro) patch.plan = 'free'
    if (subId !== undefined)     patch.stripe_subscription_id = subId
    if (periodEnd !== undefined) patch.current_period_end = periodEnd
    if (seats !== undefined)     patch.seats = seats
    if (interval)                patch.plan_interval = interval
    const { data, error } = await admin.from('profiles')
      .update(patch).eq('stripe_customer_id', customerId).select('id')
    if (error) writeFailed = error.message
    else if (!data?.length) writeFailed = `no profile row for customer ${customerId}`
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object
      const m = s.metadata || {}
      await setPro(s.customer, { isPro: true, subId: s.subscription, plan: m.plan, seats: m.seats ? Number(m.seats) : undefined, interval: m.interval })
      break
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object
      const active = ['active', 'trialing'].includes(sub.status)
      const item = sub.items?.data?.[0]
      // Live price beats stale metadata (portal switches change the price only).
      const fromPrice = planFromPrice(item?.price?.id)
      const m = sub.metadata || {}
      // Stripe API >= 2025-03-31 moved current_period_end onto the item.
      const periodEnd = sub.current_period_end ?? item?.current_period_end
      await setPro(sub.customer, {
        isPro: active,
        subId: sub.id,
        plan: fromPrice?.plan || m.plan,
        interval: fromPrice?.interval || m.interval,
        seats: item?.quantity != null ? item.quantity : (m.seats ? Number(m.seats) : undefined),
        periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
      })
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object
      await setPro(sub.customer, { isPro: false, subId: sub.id, plan: 'free' })
      break
    }
  }

  if (writeFailed) {
    console.error(`[stripe/webhook] ${event.type}: profile write failed — ${writeFailed}`)
    return Response.json({ error: 'Entitlement write failed' }, { status: 500 }) // Stripe retries
  }
  return Response.json({ received: true })
}
