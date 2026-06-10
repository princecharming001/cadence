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
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'
import { REPLY_RUBRIC } from './rubric'
import { recentFeedback, feedbackBlock } from './feedback'
import { styleByKey } from './comment-styles'
import { xReadEnabled, searchRecent, getValidAccessToken } from './x-oauth'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAX_READS_PER_RUN = 8        // cap on paid X read calls per rule per run
const PER_QUERY_FETCH = 40         // candidates pulled per search before ranking

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

  let token
  try { token = await getValidAccessToken(conn) } catch { return [] }

  const handles  = (rule.target_handles || []).map(h => String(h).replace(/^@/, '').trim()).filter(Boolean).slice(0, 3)
  const keywords = (rule.target_keywords || []).map(k => String(k).trim()).filter(Boolean)
  const candidates = []
  let reads = 0

  // Watched accounts: their recent original tweets (highly relevant by choice).
  for (const h of handles) {
    if (reads >= MAX_READS_PER_RUN) break
    reads++
    try {
      const found = await searchRecent(token, `from:${h}`, PER_QUERY_FETCH)
      candidates.push(...found.map(t => ({ ...t, relevance: 1.5 })))
    } catch (e) { if (e.readBlocked) break }
  }

  // Keyword search across X (last 7 days).
  if (keywords.length && reads < MAX_READS_PER_RUN) {
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
  const voice = persona
    ? `THEIR VOICE\ntone: ${persona.tone}\ntopics: ${(persona.topics || []).join(', ')}\nstyle rules: ${(persona.style_rules || []).join(' | ')}\nsignature moves: ${(persona.signature_moves || []).join(' | ')}`
    : 'Write in a natural, confident, human voice.'
  const s = styleByKey(style)

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `You write X (Twitter) REPLIES on behalf of a specific person, joining conversations to build genuine engagement.

${voice}

${REPLY_RUBRIC}${feedbackBlock(fb)}

COMMENT STYLE — ${s.label}: ${s.hint}${instructions ? `\n\nTHE USER'S OWN INSTRUCTIONS for how to comment (follow these): ${instructions}` : ''}

Respond with ONLY the reply text, nothing else.`,
    messages: [{ role: 'user', content: `Tweet${target.author ? ` by @${target.author}` : ''}:\n"${(target.text || '').slice(0, 600) || `(text unavailable — link: ${target.url})`}"\n\nWrite the reply.` }],
  })

  let text = (res.content.find(b => b.type === 'text')?.text || '').trim().replace(/^["']|["']$/g, '')
  text = text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim() // never link in replies
  if (text.length > 280) text = text.slice(0, 277).trimEnd() + '…'
  return text
}

// Run every active engagement rule that is due. Returns a summary.
export async function runDueEngagement() {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const { data: rules } = await admin
    .from('engagement_rules').select('*')
    .eq('active', true)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)

  if (!rules?.length) return { rules: 0, drafted: 0, queued: 0, results: [] }

  const results = []
  let drafted = 0, queued = 0

  for (const r of rules) {
    try {
      // Replies go out from ONE account per rule (multiple accounts replying to
      // the same tweet reads as spam, and the dedup index forbids it anyway).
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
      if (!conn) { results.push({ id: r.id, skipped: 'no connected X account' }); continue }

      const found = await discoverTargets(r, conn)
      if (!found.length) {
        await admin.from('engagement_rules').update({ last_run_at: nowIso, next_run_at: new Date(nowMs + (Number(r.interval_hours) || 24) * 3600 * 1000).toISOString() }).eq('id', r.id)
        results.push({ id: r.id, name: r.name, skipped: xReadEnabled() ? 'no relevant tweets found this run' : 'automatic discovery needs X read access (X_READ_ENABLED)' })
        continue
      }

      // Skip tweets we've already replied to (or drafted a reply for).
      const ids = found.map(t => t.tweet_id)
      const { data: existing } = await admin.from('posts')
        .select('reply_to_tweet_id').eq('user_id', r.user_id).in('reply_to_tweet_id', ids)
      const done = new Set((existing || []).map(p => p.reply_to_tweet_id))
      const fresh = found.filter(t => !done.has(t.tweet_id))
      if (!fresh.length) {
        await admin.from('engagement_rules').update({ last_run_at: nowIso, next_run_at: new Date(nowMs + (Number(r.interval_hours) || 24) * 3600 * 1000).toISOString() }).eq('id', r.id)
        results.push({ id: r.id, name: r.name, skipped: 'already replied to all targets' })
        continue
      }

      const { data: persona } = await admin.from('personas').select('*').eq('user_id', r.user_id).single()
      const fb = await recentFeedback(r.user_id)

      // The user can pick several comment styles; rotate through them across the
      // batch so the replies vary in approach.
      const styles = (Array.isArray(r.comment_styles) && r.comment_styles.length ? r.comment_styles : [r.comment_style || 'add_value'])

      const perRun = Math.max(Number(r.replies_per_run) || 1, 1)
      const batch = fresh.slice(0, perRun)
      const intervalMs = (Number(r.interval_hours) || 24) * 3600 * 1000
      const stepMs = intervalMs / Math.max(batch.length, 1)

      for (let j = 0; j < batch.length; j++) {
        const t = batch[j]
        const text = await writeReply(t, { persona, fb, style: styles[j % styles.length], instructions: r.instructions })
        if (!text) continue
        // auto_post=false (default) -> draft for the user to approve.
        // auto_post=true -> queued, staggered across the interval; the normal
        // cron publishes it. Flipping auto_post on was the user's explicit call.
        const auto = !!r.auto_post
        const row = {
          content: text, user_id: r.user_id, source: 'engagement',
          status: auto ? 'queued' : 'draft',
          scheduled_for: auto ? new Date(nowMs + Math.round(j * stepMs)).toISOString() : nowIso,
          x_connection_id: conn.id, engagement_rule_id: r.id,
          reply_to_tweet_id: t.tweet_id, target_tweet_text: t.text || null, target_tweet_url: t.url || null,
        }
        const { error } = await admin.from('posts').insert(row)
        if (!error) auto ? queued++ : drafted++
        // unique-index conflicts (someone replied meanwhile) are silently fine
      }

      await admin.from('engagement_rules').update({
        last_run_at: nowIso,
        next_run_at: new Date(nowMs + intervalMs).toISOString(),
      }).eq('id', r.id)
      results.push({ id: r.id, name: r.name, replies: batch.length, mode: r.auto_post ? 'auto' : 'propose' })
    } catch (e) {
      results.push({ id: r.id, error: e.message })
    }
  }

  return { rules: rules.length, drafted, queued, results }
}
