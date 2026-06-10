// POST /api/stripe/webhook → Stripe events flip a user's Pro status.
import { admin } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'

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

  async function setPro(customerId, { isPro, subId, periodEnd, plan }) {
    const patch = { is_pro: isPro, plan: plan || (isPro ? 'pro' : 'free') }
    if (subId !== undefined)     patch.stripe_subscription_id = subId
    if (periodEnd !== undefined) patch.current_period_end = periodEnd
    await admin.from('profiles').update(patch).eq('stripe_customer_id', customerId)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object
      await setPro(s.customer, { isPro: true, subId: s.subscription })
      break
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object
      const active = ['active', 'trialing'].includes(sub.status)
      await setPro(sub.customer, {
        isPro: active,
        subId: sub.id,
        periodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : undefined,
      })
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object
      await setPro(sub.customer, { isPro: false, subId: sub.id, plan: 'free' })
      break
    }
  }

  return Response.json({ received: true })
}
