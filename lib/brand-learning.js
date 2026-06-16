// lib/brand-learning.js — the engagement → memory loop.
//
// Half one (lib/post-metrics.js) pulls real numbers back onto each post. This is
// half two: periodically read a user's actual results — which posts won and which
// flopped (numbers), what their audience is saying back (comment text), and what
// the user themself rated up/down — and distill them into a few durable, plain-
// English LEARNINGS in the brand_memory table. Those then flow through
// getBrandMemory() into every generation surface, on every platform, so future
// posts are shaped by what measurably worked rather than guesses.
//
// Cost discipline: paced per user via brand_learning_state + due_brand_learning()
// so an unchanged account never re-spends an LLM pass. One distillation call per
// due user per run; the whole engagement set is replaced atomically each run, so
// the insights are always the current best understanding (no stale accretion).
import { admin } from './supabase'
import { generateJson } from './llm'
import { engScore as eng } from './weights'

const squash = s => String(s || '').replace(/\s+/g, ' ').trim()
// `eng` is the SHARED per-platform weighting (lib/weights.js) — replies/comments
// and reposts/shares weigh more than a like, by platform — so the personal-brand
// loop ranks winners on the same scale as the campaign loop and the dashboard.

// Gather a user's real signal: top vs bottom scored posts, the comments their
// audience actually left, and explicit thumbs. Returns null when there isn't
// enough to learn from (so we never hallucinate insights from noise).
async function gatherSignal(userId) {
  const [{ data: scored }, { data: comments }, { data: feedback }] = await Promise.all([
    admin.from('posts').select('content, platform, likes, replies, reposts, impressions, posted_at')
      .eq('user_id', userId).eq('status', 'posted').not('metrics_at', 'is', null)
      .order('posted_at', { ascending: false }).limit(60),
    admin.from('social_replies').select('comment_text, comment_author, platform, created_at')
      .eq('user_id', userId).not('comment_text', 'is', null)
      .order('created_at', { ascending: false }).limit(40),
    admin.from('post_feedback').select('content, rating, note')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
  ])
  const posts = (scored || []).filter(p => squash(p.content))
  if (posts.length < 3) return null
  const ranked = [...posts].sort((a, b) => eng(b) - eng(a))
  const top = ranked.slice(0, 8)
  const bottom = ranked.slice(-6).filter(p => !top.includes(p))
  const cmts = (comments || []).map(c => squash(c.comment_text)).filter(Boolean).slice(0, 30)
  const fb = (feedback || []).filter(f => squash(f.content))
  // Need at least real performance spread OR comments to say anything useful.
  if (!top.length || (eng(top[0]) === 0 && !cmts.length)) return null
  return { top, bottom, cmts, fb, total: posts.length }
}

const line = p => `[${p.platform || 'x'}] (${p.likes || 0}♥ ${p.reposts || 0}↻ ${p.replies || 0}💬${p.impressions ? ` ${p.impressions}v` : ''}) ${squash(p.content).slice(0, 180)}`

// One distillation pass → an array of learnings.
async function distill(signal) {
  const sys = `You are a social-media analyst studying ONE creator's real results to extract durable, reusable lessons that will make their future posts perform better.

You are given their best-performing posts, their worst, the comments their audience actually left, and posts they personally rated up/down. Find the PATTERNS — what about the winners earned engagement (hook style, format, topic, length, emotional register, structure), what sank the losers, and what the audience signals they want (from comments).

Write 3–6 learnings. Each must be:
- SPECIFIC and ACTIONABLE ("open with a concrete number or failure, not a general claim"), never generic ("post consistently", "use hashtags").
- Grounded in THIS data — reference what you actually saw, don't invent.
- Tagged with a platform ONLY if it's truly platform-specific; otherwise leave platform null so it applies across all their platforms (most voice/hook/topic lessons are cross-platform).
- Given a weight 1–5 for how strong the evidence is (5 = a clear, repeated pattern across many posts; 1 = a weak hint).
- One of kind: "insight" (what resonates / what to do more of), "tactic" (a concrete how-to), "audience" (what the audience wants/cares about), "format" (a structural/length/format rule).`

  const user = `THEIR TOP POSTS:\n${signal.top.map(line).join('\n')}

${signal.bottom.length ? `THEIR WEAKEST POSTS:\n${signal.bottom.map(line).join('\n')}\n` : ''}
${signal.cmts.length ? `WHAT THEIR AUDIENCE COMMENTED (recent):\n${signal.cmts.map(c => `- ${c.slice(0, 160)}`).join('\n')}\n` : ''}
${signal.fb.length ? `POSTS THEY RATED:\n${signal.fb.map(f => `${f.rating === 'up' ? '👍' : '👎'} ${squash(f.content).slice(0, 140)}${f.note ? ` — ${squash(f.note)}` : ''}`).join('\n')}\n` : ''}
Distill the durable learnings now.`

  const out = await generateJson({
    system: sys, user, maxTokens: 1100, toolName: 'emit_learnings',
    schema: {
      type: 'object', required: ['learnings'],
      properties: {
        learnings: {
          type: 'array',
          items: {
            type: 'object', required: ['text'],
            properties: {
              text: { type: 'string', description: 'one specific, actionable learning' },
              platform: { type: ['string', 'null'], enum: ['x', 'linkedin', 'instagram', 'tiktok', null], description: 'null = applies to all platforms' },
              kind: { type: 'string', enum: ['insight', 'tactic', 'audience', 'format'] },
              weight: { type: 'number', description: '1-5 evidence strength' },
            },
          },
        },
      },
    },
  }).catch(() => ({ learnings: [] }))

  return (out.learnings || [])
    .map(l => ({
      text: squash(l.text).slice(0, 280),
      platform: ['x', 'linkedin', 'instagram', 'tiktok'].includes(l.platform) ? l.platform : null,
      kind: ['insight', 'tactic', 'audience', 'format'].includes(l.kind) ? l.kind : 'insight',
      weight: Math.min(Math.max(Number(l.weight) || 2, 1), 5),
    }))
    .filter(l => l.text)
    .slice(0, 6)
}

// Learn for ONE user: gather → distill → atomically replace their engagement
// insights. Returns a small result. Trend-sourced rows are untouched.
export async function learnFromEngagement(userId) {
  const signal = await gatherSignal(userId)
  if (!signal) { await markRun(userId, 0); return { skipped: 'not enough signal' } }
  const learnings = await distill(signal)
  if (!learnings.length) { await markRun(userId, signal.total); return { skipped: 'no learnings' } }

  // Replace the previous engagement set (keep trend/manual rows). Done as
  // delete-then-insert; a concurrent run is prevented by the 20h pacing gate.
  await admin.from('brand_memory').delete().eq('user_id', userId).eq('source', 'engagement')
  const rows = learnings.map(l => ({
    user_id: userId, kind: l.kind, platform: l.platform, text: l.text,
    weight: l.weight, source: 'engagement', active: true,
  }))
  await admin.from('brand_memory').insert(rows)
  await markRun(userId, signal.total)
  return { learned: rows.length, from_posts: signal.total, comments: signal.cmts.length }
}

async function markRun(userId, postsSeen) {
  await admin.from('brand_learning_state')
    .upsert({ user_id: userId, last_run_at: new Date().toISOString(), posts_seen: postsSeen, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .then(() => {}, () => {})
}

// Cron entry: distill for the handful of users with fresh, unlearned signal.
export async function runDueBrandLearning({ limit = 5 } = {}) {
  const { data: due } = await admin.rpc('due_brand_learning', { lim: limit })
  if (!due?.length) return { learned: 0, users: 0 }
  let learned = 0
  for (const r of due) {
    try { const out = await learnFromEngagement(r.user_id); if (out.learned) learned += out.learned } catch (e) { console.error('[brand-learning]', r.user_id, e.message) }
  }
  return { users: due.length, learned }
}
