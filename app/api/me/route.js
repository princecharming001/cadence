// GET /api/me  → everything the UI needs about the current user in one call.
import { admin, getUser } from '@/lib/supabase'
import { getProfile, billingConfigured } from '@/lib/profile'

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const profile = await getProfile(user)
  const { data: persona } = await admin.from('personas').select('*').eq('user_id', user.id).single()

  // Lightweight stats for the header.
  const { data: posts } = await admin.from('posts').select('status').eq('user_id', user.id)
  const stats = { draft: 0, queued: 0, posted: 0, failed: 0 }
  for (const p of posts || []) if (stats[p.status] !== undefined) stats[p.status]++

  return Response.json({
    profile,
    persona: persona || null,
    stats,
    billingConfigured: billingConfigured(),
    proPrice: process.env.NEXT_PUBLIC_PRO_PRICE || '19',
    // Legacy single-tier subscribers stored plan 'pro' — surface as individual
    // so the pricing UI marks their card current and routes changes to the portal.
    plan: (p => (p === 'pro' ? 'individual' : p))(profile?.plan || (profile?.is_pro ? 'individual' : 'free')),
    seats: profile?.seats || 1,
    planInterval: profile?.plan_interval || 'monthly',
    periodEnd: profile?.current_period_end || null,
    xReadEnabled: process.env.X_READ_ENABLED === 'true',
  })
}
