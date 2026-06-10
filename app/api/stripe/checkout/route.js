// POST /api/stripe/checkout → start a Pro subscription checkout, return the URL.
import { getUser, admin } from '@/lib/supabase'
import { getProfile } from '@/lib/profile'
import { stripe } from '@/lib/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!stripe || !process.env.STRIPE_PRICE_ID) {
    return Response.json({ error: 'Billing is not configured yet.' }, { status: 503 })
  }

  const profile = await getProfile(user)

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
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${APP_URL}/?billing=success`,
    cancel_url: `${APP_URL}/?billing=cancelled`,
    metadata: { user_id: user.id },
  })

  return Response.json({ url: checkout.url })
}
