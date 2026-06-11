// lib/engagement.js — the X engagement agent. Finds (or is handed) tweets
// relevant to the user, drafts replies in their voice in the comment style they
// chose, and either proposes them as drafts (default) or, when the user has
// explicitly turned on auto_post for a rule, queues them for the normal poster.
//
// Permission model mirrors campaigns: a rule only runs while `active`; even
// then it only ever creates DRAFTS unless the user flipped `auto_post` on.
// The unique index posts_one_reply_per_target guarantees at most one reply per
// target tweet per user (X automation policy), so replies always go out from a
// single account per rule.
import { admin } from './supabase'
import { generateText } from './llm'
import { voiceBlock, feedbackBlock, REPLY_RUBRIC } from './prompts'
import { getVoice } from './voice'
import { styleByKey } from './comment-styles'
import { xReadEnabled, searchRecent, getValidAccessToken } from './x-oauth'
import { claimEngineRow, dueRows, setEngineStatus } from './engine'

const MAX_READS_PER_RUN = 8        // cap on paid X read calls per rule per run
const PER_QUERY_FETCH = 15         // candidates pulled per search before ranking (only ~3 are used)
const DAILY_READ_CAP = 2500        // per-user paid X reads/day — keeps spend bounded

// Atomically add to today's read tally and report whether we're over budget.
async function overReadBudget(userId, n) {
  const { data } = await admin.rpc('bump_x_reads', { p_user: userId, p_n: n })
  return typeof data === 'number' && data > DAILY_READ_CAP
}

// Engagement-velocity score: rewards tweets that got a lot of engagement FAST,
// so the agent skews toward viral, recent posts (and decays older ones).
function viralScore(t) {
  const m = t.metrics || {}
  const eng = (m.like_count || 0) + 2 * (m.retweet_count || 0) + 1.5 * (m.quote_count || 0) + (m.reply_count || 0)
  const ageH = t.created_at ? Math.max((Date.now() - new Date(t.created_at).getTime()) / 3.6e6, 0.5) : 6
  return eng / Math.pow(ageH, 0.6)
}

// Automatically find relevant, recent tweets to reply to: pull originals from
// the (max 3) watched accounts and from keyword searches, then rank so the most
// viral + relevant rise to the top. Requires X read access (pay-per-use), so it
// no-ops when reads aren't enabled. Account tweets get a relevance boost since
// the user hand-picked those accounts.
export async function discoverTargets(rule, conn) {
  if (!xReadEnabled() || !conn) return []
  // Refuse to read past the user's daily paid-read budget.
  if (await overReadBudget(conn.user_id, 0)) return { __overBudget: true }

  let token
  try { token = await getValidAccessToken(conn) } catch { return [] }

  const handles  = (rule.target_handles || []).map(h => String(h).replace(/^@/, '').trim()).filter(Boolean).slice(0, 3)
  const keywords = (rule.target_keywords || []).map(k => String(k).trim()).filter(Boolean)
  const candidates = []
  let reads = 0

  // Watched accounts: their recent original tweets (highly relevant by choice).
  for (const h of handles) {
    if (reads >= MAX_READS_PER_RUN) break
    if (await overReadBudget(conn.user_id, PER_QUERY_FETCH)) break
    reads++
    try {
      const found = await searchRecent(token, `from:${h}`, PER_QUERY_FETCH)
      candidates.push(...found.map(t => ({ ...t, relevance: 1.5 })))
    } catch (e) { if (e.readBlocked) break }
  }

  // Keyword search across X (last 7 days).
  if (keywords.length && reads < MAX_READS_PER_RUN && !(await overReadBudget(conn.user_id, PER_QUERY_FETCH))) {
    reads++
    const q = keywords.map(k => (/\s/.test(k) ? `"${k}"` : k)).join(' OR ')
    try {
      const found = await searchRecent(token, q, PER_QUERY_FETCH)
      candidates.push(...found.map(t => ({ ...t, relevance: 1 })))
    } catch (e) { if (e.readBlocked) { /* keep account candidates */ } }
  }

  // De-dup, then rank by viral velocity weighted by relevance.
  const seen = new Set()
  return candidates
    .filter(t => t.tweet_id && !seen.has(t.tweet_id) && seen.add(t.tweet_id))
    .map(t => ({ ...t, _score: viralScore(t) * (t.relevance || 1) }))
    .sort((a, b) => b._score - a._score)
}

// Draft one reply in the user's voice, in the chosen comment style.
export async function writeReply(target, { persona, fb, style, instructions }) {
  const s = styleByKey(style)
  const raw = await generateText({
    system: `You write X (Twitter) REPLIES on behalf of a specific person, joining conversations to build genuine engagement.

${voiceBlock(persona, { register: 'reply' })}

${REPLY_RUBRIC}${feedbackBlock(fb)}

COMMENT STYLE — ${s.label}: ${s.hint}${instructions ? `\n\nTHE USER'S OWN INSTRUCTIONS for how to comment (follow these): ${instructions}` : ''}

Respond with ONLY the reply text, nothing else.`,
    user: `Tweet${target.author ? ` by @${target.author}` : ''}:\n"${(target.text || '').slice(0, 600) || `(text unavailable — link: ${target.url})`}"\n\nWrite the reply.`,
    maxTokens: 300,
  })
  let text = raw.replace(/^["']|["']$/g, '')
  text = text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim() // never link in replies
  if (text.length > 280) text = text.slice(0, 277).trimEnd() + '…'
  return text
}

// Live status via the shared engine convention.
const setStatus = (id, detail, running) => setEngineStatus('engagement_rules', id, detail, running)

// Run one CLAIMED engagement rule end to end, reporting progress as it goes.
// next_run_at was already advanced at claim time — no bump needed here, and a
// crash mid-run can't cause a hot retry loop of paid X reads.
async function processRule(r) {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const intervalMs = (Number(r.interval_hours) || 24) * 3600 * 1000

  await setStatus(r.id, 'Starting…', true)

  // Replies go out from ONE account per rule (multiple accounts replying to the
  // same tweet reads as spam, and the dedup index forbids it anyway).
  let conn = null
  const wantId = Array.isArray(r.connection_ids) ? r.connection_ids[0] : null
  if (wantId) {
    const { data } = await admin.from('x_connections').select('*').eq('id', wantId).eq('user_id', r.user_id).single()
    conn = data || null
  }
  if (!conn) {
    const { data } = await admin.from('x_connections').select('*').eq('user_id', r.user_id).order('created_at', { ascending: true }).limit(1)
    conn = data?.[0] || null
  }
  if (!conn) { await setStatus(r.id, 'No connected X account', false); return { id: r.id, skipped: 'no connected X account' } }

  await setStatus(r.id, 'Finding relevant tweets…', true)
  const found = await discoverTargets(r, conn)
  if (found?.__overBudget) {
    await setStatus(r.id, 'Daily X read limit reached — resumes tomorrow', false)
    return { id: r.id, name: r.name, skipped: 'daily X read limit' }
  }
  if (!found.length) {
    const msg = xReadEnabled() ? 'No relevant tweets found this run' : 'Needs X read access (X_READ_ENABLED)'
    await setStatus(r.id, msg, false)
    return { id: r.id, name: r.name, skipped: msg }
  }

  // Skip tweets we've already replied to (or drafted a reply for).
  const ids = found.map(t => t.tweet_id)
  const { data: existing } = await admin.from('posts')
    .select('reply_to_tweet_id').eq('user_id', r.user_id).in('reply_to_tweet_id', ids)
  const done = new Set((existing || []).map(p => p.reply_to_tweet_id))
  const fresh = found.filter(t => !done.has(t.tweet_id))
  if (!fresh.length) {
    await setStatus(r.id, 'Already replied to all targets', false)
    return { id: r.id, name: r.name, skipped: 'already replied to all targets' }
  }

  const { persona, fb } = await getVoice(r.user_id)

  // The user can pick several comment styles; rotate through them across the
  // batch so the replies vary in approach.
  const styles = (Array.isArray(r.comment_styles) && r.comment_styles.length ? r.comment_styles : [r.comment_style || 'add_value'])
  const perRun = Math.max(Number(r.replies_per_run) || 1, 1)
  const batch = fresh.slice(0, perRun)
  const stepMs = intervalMs / Math.max(batch.length, 1)
  const auto = !!r.auto_post

  let made = 0
  for (let j = 0; j < batch.length; j++) {
    const t = batch[j]
    await setStatus(r.id, `Writing reply ${j + 1} of ${batch.length}…`, true)
    const text = await writeReply(t, { persona, fb, style: styles[j % styles.length], instructions: r.instructions })
    if (!text) continue
    // auto_post=false (default) -> draft for the user to approve.
    // auto_post=true -> queued, staggered across the interval; the normal cron
    // publishes it. Flipping auto_post on was the user's explicit call.
    const row = {
      content: text, user_id: r.user_id, source: 'engagement',
      status: auto ? 'queued' : 'draft',
      scheduled_for: auto ? new Date(nowMs + Math.round(j * stepMs)).toISOString() : nowIso,
      x_connection_id: conn.id, engagement_rule_id: r.id,
      reply_to_tweet_id: t.tweet_id, target_tweet_text: t.text || null, target_tweet_url: t.url || null,
    }
    const { error } = await admin.from('posts').insert(row)
    if (!error) made++
    // unique-index conflicts (someone replied meanwhile) are silently fine
  }

  await setStatus(r.id, auto ? `Queued ${made} repl${made === 1 ? 'y' : 'ies'}` : `Drafted ${made} repl${made === 1 ? 'y' : 'ies'} for approval`, false)
  return { id: r.id, name: r.name, replies: made, mode: auto ? 'auto' : 'propose' }
}

// Run every active engagement rule that is due. Claim-first per row.
export async function runDueEngagement() {
  const due = await dueRows('engagement_rules')
  if (!due.length) return { rules: 0, results: [] }
  const results = []
  for (const row of due) {
    const r = await claimEngineRow('engagement_rules', row)
    if (!r) continue
    try { results.push(await processRule(r)) }
    catch (e) { await setStatus(r.id, `Error: ${e.message}`, false); results.push({ id: r.id, error: e.message }) }
  }
  return { rules: results.length, results }
}

// Run a single rule now (the "Run now" button). Scoped to the owner; respects
// claims so a rule mid-run can't be double-fired.
export async function runEngagementById(id, userId) {
  const { data: row } = await admin.from('engagement_rules').select('*').eq('id', id).eq('user_id', userId).single()
  if (!row) return { error: 'not found' }
  const r = await claimEngineRow('engagement_rules', row)
  if (!r) return { error: 'Already running — give it a moment.' }
  try { return await processRule(r) }
  catch (e) { await setStatus(r.id, `Error: ${e.message}`, false); return { id: r.id, error: e.message } }
}
