import { admin, getUser, isCron } from '@/lib/supabase'
import { scrapeAndStore, scrapeAllActive } from '@/lib/linkedin'

export const maxDuration = 180 // Apify scrapes are slow

// GET /api/linkedin            → this user's accounts + recent posts
// GET /api/linkedin?scrape=1   → (Bearer CRON_SECRET) scrape ALL active accounts
export async function GET(req) {
  const url = new URL(req.url)

  if (url.searchParams.get('scrape') === '1') {
    if (!isCron(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    try {
      return Response.json(await scrapeAllActive())
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 })
    }
  }

  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: accounts } = await admin
    .from('linkedin_accounts').select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const ids = (accounts || []).map(a => a.id)
  let posts = []
  if (ids.length) {
    // Exclude `raw` — multi-MB of Apify JSON per post the UI never reads.
    const { data } = await admin
      .from('linkedin_posts')
      .select('id, account_id, content, likes, comments, reposts, posted_at, posted_ago, author_name, post_url')
      .in('account_id', ids)
      .order('posted_at', { ascending: false }).limit(200)
    posts = data || []
  }

  const self    = (accounts || []).filter(a => !a.is_mentor)
  const mentors = (accounts || []).filter(a => a.is_mentor)
  return Response.json({ accounts: accounts || [], self, mentors, posts })
}

// POST /api/linkedin  { profileUrl, maxPosts?, isMentor?, scrapeNow? }
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const body = await req.json()
    const { profileUrl, isMentor = false, scrapeNow = true } = body
    // Clamp — this flows straight into paid Apify scrapes (and a nightly re-scrape).
    const maxPosts = Math.min(Math.max(Number(body.maxPosts) || 50, 1), 100)
    if (!profileUrl || !/linkedin\.com\/in\//.test(profileUrl)) {
      return Response.json({ error: 'Provide a valid LinkedIn profile URL (linkedin.com/in/...)' }, { status: 400 })
    }
    const clean = profileUrl.split('?')[0].replace(/\/$/, '')

    // Cap mentors at 3 (don't count a re-add of an existing one).
    if (isMentor) {
      const { data: existing } = await admin.from('linkedin_accounts')
        .select('profile_url').eq('user_id', user.id).eq('is_mentor', true)
      const already = (existing || []).some(a => a.profile_url === clean)
      if (!already && (existing || []).length >= 3) {
        return Response.json({ error: 'You can study up to 3 creators. Remove one first.' }, { status: 400 })
      }
    }

    const { data: account, error } = await admin
      .from('linkedin_accounts')
      .upsert({ profile_url: clean, max_posts: maxPosts, active: true, user_id: user.id, is_mentor: isMentor }, { onConflict: 'user_id,profile_url' })
      .select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    let scrape = null
    if (scrapeNow) scrape = await scrapeAndStore(account)
    return Response.json({ account, scrape })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/linkedin  { id }
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json()
  await admin.from('linkedin_accounts').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
