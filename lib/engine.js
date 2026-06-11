// lib/engine.js — the shared claim/lease machinery every background engine
// runs on. The core idea: NOTHING does slow work (LLM calls, downloads,
// publishing) on a row it hasn't atomically claimed first. PostgREST UPDATEs
// with filters are single-statement compare-and-set, so `update(...).eq(id)
// .eq(running,false)` has exactly one winner under any concurrency — per-minute
// local cron, the daily Vercel cron, run-now buttons, and chat tools can all
// fire at once without double-generating or double-posting.
import { admin } from './supabase'

// Atomically claim one due engine row (campaigns / engagement_rules /
// brand_campaigns / social_engagement). Bumps next_run_at AT CLAIM TIME so a
// crash mid-run can never produce a hot retry loop, and sets running=true so
// overlapping sweeps skip it. Returns the claimed row or null if lost the race.
export async function claimEngineRow(table, row) {
  const intervalH = Number(row.interval_hours) || 24
  const { data } = await admin.from(table)
    .update({
      running: true,
      last_run_at: new Date().toISOString(),
      next_run_at: new Date(Date.now() + intervalH * 3600 * 1000).toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', row.id).eq('running', false)
    .select()
  return data?.[0] || null
}

// Due rows for an engine table (caller then claims each individually).
// activeCol: 'active' for campaigns/rules, 'enabled' for social_engagement.
export async function dueRows(table, { activeCol = 'active' } = {}) {
  const nowIso = new Date().toISOString()
  const { data } = await admin.from(table).select('*')
    .eq(activeCol, true).eq('running', false)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
  return data || []
}

// Unified live-status write. Always bumps last_activity_at — that doubles as
// the heartbeat the stale sweep keys on.
export async function setEngineStatus(table, id, detail, running) {
  await admin.from(table).update({
    status_detail: String(detail || '').slice(0, 200),
    running: !!running,
    last_activity_at: new Date().toISOString(),
  }).eq('id', id)
}

// Recover claims orphaned by a crash/kill: running=true with a heartbeat older
// than `minutes` goes back to runnable (next_run_at already advanced at claim,
// so recovery never causes a burst).
export async function releaseStaleClaims(table, minutes = 30) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()
  await admin.from(table)
    .update({ running: false, status_detail: 'Recovered after interruption' })
    .eq('running', true).lt('last_activity_at', cutoff)
}

// Atomically claim a queued post for publishing. The ONLY path to 'posting' —
// cron and the Post-now button both go through this, so a stale button click
// on an in-flight row simply loses the CAS and is rejected.
export async function claimPost(id) {
  const { data } = await admin.from('posts')
    .update({ status: 'posting', claimed_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'queued')
    .select()
  return data?.[0] || null
}

// Posts stuck in 'posting' past the window crashed mid-publish. They are NOT
// auto-retried: the tweet may have gone out before the crash, and a silent
// retry is how you double-post. Mark failed with an honest error instead.
export async function sweepInterruptedPosts(minutes = 10) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()
  await admin.from('posts')
    .update({ status: 'failed', error: 'Interrupted while posting — check the account before retrying.' })
    .eq('status', 'posting').lt('claimed_at', cutoff)
}
