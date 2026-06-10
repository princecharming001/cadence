// cron-runner.js — local posting loop for Cadence
// Run in a second terminal: node cron-runner.js
// Checks every minute for due posts and fires them to X via /api/cron

import 'dotenv/config'
import cron from 'node-cron'

const PORT       = process.env.PORT || 3000
const SECRET     = process.env.CRON_SECRET
const URL        = `http://localhost:${PORT}/api/cron`
const LINKEDIN_URL = `http://localhost:${PORT}/api/linkedin?scrape=1`

function timestamp() {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

async function runCron() {
  const t = timestamp()
  try {
    const res  = await fetch(URL, {
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    const data = await res.json()

    if (data.posted > 0) {
      console.log(`[${t}] ✅ Posted ${data.posted} tweet(s)`)
      for (const r of data.results || []) {
        if (r.status === 'posted')  console.log(`         → tweet id ${r.external_id}`)
        if (r.status === 'failed')  console.log(`         ⚠️  post ${r.id} failed: ${r.error}`)
      }
    } else {
      console.log(`[${t}] — nothing due`)
    }
  } catch (err) {
    console.error(`[${t}] ❌ cron error: ${err.message} (is the dev server running?)`)
  }
}

// ── LinkedIn scrape loop ──────────────────────────────────────────────────────
// Refreshes posts for all active LinkedIn accounts. Runs less often than the
// X poster since scraping is heavier and posts don't change minute-to-minute.
async function runLinkedIn() {
  const t = timestamp()
  try {
    const res  = await fetch(LINKEDIN_URL, {
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    const data = await res.json()

    if (data.accounts > 0) {
      const totalStored = (data.results || []).reduce((n, r) => n + (r.stored || 0), 0)
      console.log(`[${t}] 🔗 LinkedIn: scraped ${data.accounts} account(s), ${totalStored} post(s) stored`)
      for (const r of data.results || []) {
        if (r.error) console.log(`         ⚠️  ${r.profile_url}: ${r.error}`)
      }
    }
  } catch (err) {
    console.error(`[${t}] ❌ LinkedIn scrape error: ${err.message}`)
  }
}

console.log('🕐 Cadence cron-runner started')
console.log(`   X poster        → ${URL} (every minute)`)
console.log(`   LinkedIn scrape → ${LINKEDIN_URL} (daily at 6am PT)`)
console.log('   Press Ctrl+C to stop\n')

// X poster: run immediately, then every minute
runCron()
cron.schedule('* * * * *', runCron)

// LinkedIn scraper: once a day (6am) — pulls new posts for every connected account
cron.schedule('0 6 * * *', runLinkedIn)
