// lib/supabase.js — server-side Supabase helpers
import { createClient } from '@supabase/supabase-js'

// Service-role client: bypasses RLS. Use ONLY in server routes, never sent to the browser.
export const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
)

// Verify the Supabase access token from an incoming request and return the user.
// The browser sends it as `Authorization: Bearer <supabase access token>`.
export async function getUser(req) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}
