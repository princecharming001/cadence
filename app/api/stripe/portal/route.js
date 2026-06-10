// POST /api/stripe/portal → open the Stripe billing portal for managing the sub.
import { getUser } from '@/lib/supabase'
import { getProfile } from '@/lib/profile'
import { stripe } from '@/lib/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!stripe) return Response.json({ error: 'Billing not configured' }, { status: 503 })

  const profile = await getProfile(user)
  if (!profile.stripe_customer_id) return Response.json({ error: 'No billing account yet.' }, { status: 400 })

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${APP_URL}/`,
  })
  return Response.json({ url: session.url })
}
