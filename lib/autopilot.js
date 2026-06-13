// lib/autopilot.js — content autopilot. The brain writes posts in the user's
// voice on a cadence, with NO campaign needed. It reuses the same generation
// path as the Suggestions tab (voice + learned feedback + the live trending
// formats baked in), then either queues them into smart slots (auto_post) or
// leaves them as drafts for review.
import { admin } from './supabase'
import { generateSuggestions } from './suggestions'
import { nextSmartSlot } from './scheduling'
import { runEngagementById } from './engagement'

export const AUTOPILOT_PLATFORMS = ['x', 'linkedin']

// Run one due autopilot row.
export async function runAutopilot(row) {
  const per = Math.min(Math.max(row.per_run || 1, 1), 3)
  // Claim + advance next_run_at first so overlapping cron ticks can't double-run.
  const nextIso = new Date(Date.now() + (row.interval_hours || 24) * 3600 * 1000).toISOString()
  const { data: claimed } = await admin.from('autopilot')
    .update({ running: true, next_run_at: nextIso, last_run_at: new Date().toISOString(), status_detail: 'Writing posts…' })
    .eq('id', row.id).eq('running', false).select()
  if (!claimed?.[0]) return { skipped: 'already running' }
  try {
    // generateSuggestions writes status='draft' posts in voice (trends + feedback baked in).
    const drafts = await generateSuggestions(row.user_id, row.platform, per)
    let queued = 0
    if (row.auto_post && drafts?.length) {
      // Promote each draft to a queued post at the user's next smart slot.
      let after = null
      for (const d of drafts) {
        let when
        try { when = await nextSmartSlot(row.user_id, { platform: row.platform, after }) } catch { when = new Date(Date.now() + (queued + 1) * 3600e3).toISOString() }
        after = when
        await admin.from('posts').update({ status: 'queued', scheduled_for: when }).eq('id', d.id)
        queued++
      }
    }
    // Comments: drive the user's niche-engagement rule(s) for this platform up
    // to comments_per_day replies (posted immediately to ride the wave).
    let comments = 0
    if ((row.comments_per_day || 0) > 0 && row.platform === 'x') {
      const { data: rules } = await admin.from('engagement_rules').select('id').eq('user_id', row.user_id).eq('active', true).limit(2)
      for (const r of rules || []) {
        try { const res = await runEngagementById(r.id, row.user_id); comments += res?.replies || 0 } catch {}
        if (comments >= row.comments_per_day) break
      }
    }
    const postNote = row.auto_post ? `Queued ${queued} post${queued === 1 ? '' : 's'}` : `Drafted ${drafts?.length || 0} for review`
    await admin.from('autopilot').update({ running: false, status_detail: comments ? `${postNote} · ${comments} repl${comments === 1 ? 'y' : 'ies'}` : postNote }).eq('id', row.id)
    return { generated: drafts?.length || 0, queued, comments }
  } catch (e) {
    await admin.from('autopilot').update({ running: false, status_detail: `Failed: ${String(e.message).slice(0, 80)}` }).eq('id', row.id)
    return { error: e.message }
  }
}

// Cron entry: run every enabled autopilot whose slot has come due.
export async function runDueAutopilot() {
  const now = new Date().toISOString()
  const { data: due } = await admin.from('autopilot').select('*')
    .eq('enabled', true).eq('running', false)
    .or(`next_run_at.is.null,next_run_at.lte.${now}`)
    .limit(10)
  const out = []
  for (const row of due || []) out.push(await runAutopilot(row))
  return { ran: out.length, out }
}
