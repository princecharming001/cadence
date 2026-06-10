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
import { xReadEnabled, lookupTweet, searchRecent, getValidAccessToken } from './x-oauth'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAX_READS_PER_RUN = 6 // hard cap on paid X read calls per rule per run

// Pull a tweet id out of a pasted link or raw id.
export function parseTweetId(s) {
  const m = String(s || '').match(/status(?:es)?\/(\d{8,})/) || String(s || '').match(/^(\d{8,})$/)
  return m ? m[1] : null
}

// Each manual target line is a tweet link, optionally followed by the tweet's
// text pasted on the same line (gives the model real context without paid reads).
function parseManualTargets(urls) {
  const out = []
  for (const raw of urls || []) {
    const line = String(raw || '').trim()
    if (!line) continue
    const id = parseTweetId(line)
    if (!id) continue
    const rest = line.replace(/^\S+/, '').trim()
    const handle = line.match(/(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,15})\/status/)?.[1]?.replace(/^@/, '') || null
    out.push({ tweet_id: id, text: rest || null, author: handle, url: `https://x.com/i/web/status/${id}` })
  }
  return out
}

// Discovery ladder: manual links always work (free); keywords/handles only when
// the operator enabled paid X reads. Read errors degrade silently to manual.
export async function discoverTargets(rule, conn) {
  const targets = parseManualTargets(rule.target_tweet_urls)
  let reads = 0

  if (xReadEnabled() && conn) {
    try {
      const token = await getValidAccessToken(conn)
      // Fill in text for manual links the user didn't paste text for.
      // `reads` counts ATTEMPTS (not successes) so failures can't bypass the cost cap.
      for (const t of targets) {
        if (t.text || reads >= MAX_READS_PER_RUN) continue
        reads++
        try { const d = await lookupTweet(token, t.tweet_id); if (d) { t.text = d.text; t.author = d.author || t.author } }
        catch (e) { if (e.readBlocked) return targets; }
      }
      const handles  = (rule.target_handles || []).map(h => String(h).replace(/^@/, '').trim()).filter(Boolean)
      const keywords = (rule.target_keywords || []).map(k => String(k).trim()).filter(Boolean)
      const queries = [
        ...handles.map(h => `from:${h}`),
        ...(keywords.length ? [keywords.map(k => (/\s/.test(k) ? `"${k}"` : k)).join(' OR ')] : []),
      ]
      for (const q of queries) {
        if (reads >= MAX_READS_PER_RUN) break
        reads++
        try { const found = await searchRecent(token, q, 10); targets.push(...found.map(t => ({ ...t, url: `https://x.com/i/web/status/${t.tweet_id}` }))) }
        catch (e) { if (e.readBlocked) break; }
      }
    } catch { /* token trouble -> manual targets only */ }
  }

  // De-dup within the batch.
  const seen = new Set()
  return targets.filter(t => !seen.has(t.tweet_id) && seen.add(t.tweet_id))
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
        results.push({ id: r.id, name: r.name, skipped: xReadEnabled() ? 'no targets found' : 'no tweet links to reply to (add links, or enable X reads for keywords)' })
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

      const perRun = Math.min(Math.max(r.replies_per_run || 1, 1), 5)
      const batch = fresh.slice(0, perRun)
      const intervalMs = (Number(r.interval_hours) || 24) * 3600 * 1000
      const stepMs = intervalMs / Math.max(batch.length, 1)

      for (let j = 0; j < batch.length; j++) {
        const t = batch[j]
        const text = await writeReply(t, { persona, fb, style: r.comment_style, instructions: r.instructions })
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
