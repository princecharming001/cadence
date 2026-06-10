// lib/linkedin.js — Apify-backed LinkedIn post scraper (cookie-free)
// Uses harvestapi/linkedin-profile-posts: only an Apify token is required.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR       = process.env.APIFY_LINKEDIN_ACTOR || 'harvestapi~linkedin-profile-posts'

// Run the actor synchronously and return the dataset items.
// run-sync-get-dataset-items blocks until the run finishes and returns the rows directly.
export async function scrapeProfilePosts(profileUrl, maxPosts = 50) {
  const endpoint = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetUrls: [profileUrl],
      maxPosts,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Apify run failed (${res.status}): ${body.slice(0, 300)}`)
  }

  const items = await res.json()
  // Filter out non-post rows (error markers, etc.)
  return Array.isArray(items) ? items.filter(it => it && it.type === 'post' && it.id) : []
}

// Map a raw Apify post object to our linkedin_posts row shape.
function mapPost(raw, accountId, profileUrl) {
  const eng    = raw.engagement || {}
  const posted = raw.postedAt || {}
  const author = raw.author || {}

  return {
    account_id:       accountId,
    linkedin_post_id: String(raw.entityId || raw.id),
    profile_url:      profileUrl,
    author_name:      author.name || null,
    author_headline:  author.info || null,
    content:          raw.content || null,
    likes:            eng.likes ?? 0,
    comments:         eng.comments ?? 0,
    reposts:          eng.shares ?? 0,
    reactions:        eng.reactions || null,
    posted_at:        posted.date || null,
    posted_ago:       posted.postedAgoShort || null,
    post_url:         raw.shareLinkedinUrl || raw.linkedinUrl || null,
    raw,
  }
}

// Scrape a profile and persist its posts. Returns a summary.
export async function scrapeAndStore(account) {
  const items = await scrapeProfilePosts(account.profile_url, account.max_posts || 50)
  const rows  = items.map(it => mapPost(it, account.id, account.profile_url))

  let stored = 0
  if (rows.length) {
    // Upsert on the natural key so re-scrapes update engagement counts instead of duplicating.
    const { error } = await supabase
      .from('linkedin_posts')
      .upsert(rows, { onConflict: 'account_id,linkedin_post_id' })
    if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
    stored = rows.length
  }

  // Pull author metadata off the first post to enrich the account record.
  const first = items[0]?.author || {}
  await supabase
    .from('linkedin_accounts')
    .update({
      name:              first.name || account.name,
      headline:          first.info || account.headline,
      public_identifier: first.publicIdentifier || account.public_identifier,
      avatar_url:        first.avatar?.url || account.avatar_url,
      last_scraped_at:   new Date().toISOString(),
    })
    .eq('id', account.id)

  return { profile_url: account.profile_url, scraped: items.length, stored }
}

// Scrape every active account. Used by the cron runner.
export async function scrapeAllActive() {
  const { data: accounts, error } = await supabase
    .from('linkedin_accounts')
    .select('*')
    .eq('active', true)

  if (error) throw new Error(error.message)
  if (!accounts?.length) return { accounts: 0, results: [] }

  const results = []
  for (const account of accounts) {
    try {
      results.push(await scrapeAndStore(account))
    } catch (err) {
      results.push({ profile_url: account.profile_url, error: err.message })
    }
  }
  return { accounts: accounts.length, results }
}
