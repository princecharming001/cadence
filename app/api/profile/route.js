// PATCH /api/profile  → update the user's profile / onboarding / settings
import { admin, getUser } from '@/lib/supabase'

const ALLOWED = ['full_name', 'role', 'goals', 'timezone', 'default_post_hour', 'include_image_default', 'onboarded', 'posting_windows', 'brand_brief']
const HHMM = /^\d{1,2}:\d{2}$/

export async function PATCH(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const patch = {}
  for (const k of ALLOWED) if (body[k] !== undefined) patch[k] = body[k]
  // posting_windows: up to 5 {start:'HH:MM', end:'HH:MM'} ranges.
  if (patch.posting_windows !== undefined) {
    const w = Array.isArray(patch.posting_windows) ? patch.posting_windows : []
    patch.posting_windows = w
      .filter(x => x && HHMM.test(x.start || '') && HHMM.test(x.end || ''))
      .slice(0, 5).map(x => ({ start: x.start, end: x.end }))
    if (!patch.posting_windows.length) delete patch.posting_windows
  }
  if (!Object.keys(patch).length) return Response.json({ error: 'Nothing to update.' }, { status: 400 })

  // Ensure a profile row exists, then update.
  await admin.from('profiles').upsert({ id: user.id, email: user.email }, { onConflict: 'id' })
  const { data, error } = await admin.from('profiles').update(patch).eq('id', user.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ profile: data })
}
