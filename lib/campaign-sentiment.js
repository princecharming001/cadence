// lib/campaign-sentiment.js — the QUALITATIVE half of campaign intelligence.
//
// For a campaign's published posts, gather the audience COMMENTS and classify each
// one (aspect-based sentiment + emotion + a sarcasm gate) into post_sentiment.
// The campaign-learning loop and the dashboard then read the rollup: what the
// audience feels, which ASPECT they're reacting to (hook/cta/topic/product/price),
// recurring questions (a content backlog), and negative themes (a guardrail so the
// fleet never optimizes into outrage).
//
// Research-grounded: 3-class polarity is not enough — we tie sentiment to an
// aspect (ABSA), add emotion, and a sarcasm flag, because sarcasm inverts surface
// sentiment and tanks naive classifiers. Comments come from a fresh, bounded
// Zernio/Unipile fetch for recent campaign posts PLUS whatever the auto-reply
// engine already harvested into social_replies (covers X). Stored deduped by
// platform comment_id, decoupled from the social_replies auto-reply gate.
import { admin } from './supabase'
import { generateJson } from './llm'
import { getPostComments, zernioEnabled } from './zernio'
import { listPostComments, unipileEnabled, unipileAccountId } from './unipile'

const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return null }
const commentId = c => pick(c, ['commentId', 'id', '_id', 'cid'])
const commentText = c => pick(c, ['text', 'content', 'message', 'body']) || ''
const commentAuthor = c => {
  const v = pick(c, ['authorUsername', 'username', 'author', 'from', 'fromName'])
  if (v && typeof v === 'object') return v.username || v.name || v.handle || ''
  return v || ''
}
const postIdOf = p => pick(p, ['id', '_id', 'postId', 'platformPostId'])

// Gather candidate comments for a campaign's recent published posts.
async function gatherComments(userId, campaignId) {
  const { data: posts } = await admin.from('posts')
    .select('id, external_id, platform, social_account_id, content')
    .eq('user_id', userId).eq('campaign_id', campaignId).eq('status', 'posted')
    .not('external_id', 'is', null)
    .order('posted_at', { ascending: false }).limit(12)
  if (!posts?.length) return []
  const extToPost = {}
  for (const p of posts) extToPost[String(p.external_id)] = p

  const out = []
  const seen = new Set()
  const push = (cid, text, author, platform, postUuid) => {
    const id = String(cid || '')
    const t = String(text || '').trim()
    if (!id || !t || seen.has(id)) return
    seen.add(id)
    out.push({ comment_id: id, comment_text: t.slice(0, 500), comment_author: String(author || '').slice(0, 80), platform, post_id: postUuid })
  }

  // Fresh fetch for the most recent posts (bounded). Zernio = IG/TikTok, Unipile = LinkedIn.
  let uAcct
  for (const p of posts.slice(0, 8)) {
    try {
      if ((p.platform === 'instagram' || p.platform === 'tiktok') && p.social_account_id && zernioEnabled()) {
        const { data: acct } = await admin.from('social_accounts').select('zernio_account_id').eq('id', p.social_account_id).single()
        if (acct?.zernio_account_id) {
          const cs = await getPostComments(p.external_id, acct.zernio_account_id, 30).catch(() => [])
          for (const c of cs) push(commentId(c), commentText(c), commentAuthor(c), p.platform, p.id)
        }
      } else if (p.platform === 'linkedin' && unipileEnabled()) {
        if (uAcct === undefined) uAcct = await unipileAccountId(userId).catch(() => null)
        if (uAcct) { const cs = await listPostComments(uAcct, p.external_id, 30).catch(() => []); for (const c of cs) push(commentId(c), commentText(c), commentAuthor(c), 'linkedin', p.id) }
      }
    } catch {}
  }

  // Plus whatever's already in social_replies for these posts (covers X + prior fetches).
  const exts = posts.map(p => String(p.external_id))
  const { data: replies } = await admin.from('social_replies')
    .select('comment_id, comment_text, comment_author, platform, post_id')
    .eq('user_id', userId).in('post_id', exts).limit(200)
  for (const r of replies || []) { const p = extToPost[String(r.post_id)]; push(r.comment_id, r.comment_text, r.comment_author, r.platform || p?.platform, p?.id) }

  return out
}

const SENT_SCHEMA = {
  type: 'object', required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', required: ['i', 'sentiment'],
        properties: {
          i: { type: 'integer', description: 'the comment index you are labeling' },
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'question'] },
          emotion: { type: 'string', enum: ['joy', 'surprise', 'curious', 'skeptical', 'concerned', 'anger', 'neutral'] },
          aspect: { type: 'string', enum: ['hook', 'cta', 'topic', 'format', 'product', 'price', 'other'] },
          is_sarcastic: { type: 'boolean' },
          confidence: { type: 'number', description: '0-1' },
        },
      },
    },
  },
}

// Classify a batch of comments. Returns a map index -> label.
async function classifyBatch(batch) {
  const sys = `You are a precise social-media comment analyst. For EACH numbered comment, output:
- sentiment: positive | neutral | negative | question (use "question" when the commenter is mainly asking something).
- emotion: joy | surprise | curious | skeptical | concerned | anger | neutral.
- aspect: what the comment is REACTING TO — hook (the opening/attention grab), cta (the ask/link), topic (the subject), format (the style/medium), product (the thing promoted), price, or other.
- is_sarcastic: true if the comment is ironic/sarcastic. SARCASM RULE: sarcasm inverts surface meaning and wrecks naive sentiment — when you suspect it, set is_sarcastic=true and LOWER confidence; never take a sarcastic comment at face value.
- confidence: 0-1.
Return one item per comment, echoing its index i.`
  const user = batch.map((c, i) => `[${i}] ${c.comment_text.slice(0, 240)}`).join('\n')
  const out = await generateJson({ system: sys, user, schema: SENT_SCHEMA, maxTokens: 1600, toolName: 'emit_sentiment' }).catch(() => ({ items: [] }))
  const map = {}
  for (const it of out.items || []) if (Number.isInteger(it.i)) map[it.i] = it
  return map
}

// Analyze one campaign: gather → classify the new comments → store. Bounded to a
// few batches per run so cost stays predictable.
export async function analyzeCampaignSentiment(campaignId, userId) {
  if (!userId) { const { data: c } = await admin.from('agent_campaigns').select('user_id').eq('id', campaignId).single(); userId = c?.user_id }
  if (!userId) return { skipped: 'no user' }
  const comments = await gatherComments(userId, campaignId)
  if (!comments.length) { await markSentimentRun(campaignId, userId); return { analyzed: 0, found: 0 } }

  // Skip comments we've already classified for this campaign.
  const { data: known } = await admin.from('post_sentiment').select('comment_id').eq('campaign_id', campaignId).limit(2000)
  const seen = new Set((known || []).map(r => r.comment_id))
  const fresh = comments.filter(c => !seen.has(c.comment_id)).slice(0, 75) // bound per run
  if (!fresh.length) { await markSentimentRun(campaignId, userId); return { analyzed: 0, found: comments.length } }

  const rows = []
  for (let off = 0; off < fresh.length; off += 25) {
    const batch = fresh.slice(off, off + 25)
    const map = await classifyBatch(batch)
    batch.forEach((c, i) => {
      const l = map[i]
      if (!l) return
      let sentiment = ['positive', 'neutral', 'negative', 'question'].includes(l.sentiment) ? l.sentiment : 'neutral'
      const conf = Math.min(Math.max(Number(l.confidence) || 0.5, 0), 1)
      // Sarcasm INVERTS surface sentiment — store the corrected sentiment so the
      // rollup never reads a caustic "this is GREAT 🙄" as a genuine positive. Only
      // flip when we're confident it's sarcastic (low-confidence stays as-is, and
      // the rollup separately drops low-confidence sarcasm).
      if (l.is_sarcastic && conf >= 0.7) sentiment = sentiment === 'positive' ? 'negative' : sentiment === 'negative' ? 'positive' : sentiment
      rows.push({
        user_id: userId, campaign_id: campaignId, post_id: c.post_id || null, platform: c.platform || null,
        comment_id: c.comment_id, comment_text: c.comment_text, comment_author: c.comment_author,
        sentiment,
        emotion: l.emotion || 'neutral', aspect: l.aspect || 'other',
        is_sarcastic: !!l.is_sarcastic, confidence: conf,
      })
    })
  }
  if (rows.length) await admin.from('post_sentiment').upsert(rows, { onConflict: 'campaign_id,comment_id', ignoreDuplicates: true }).then(() => {}, () => {})
  // Mark AFTER the work lands — if classify/upsert threw, we never get here, so the
  // pacing gate stays open and the next cron tick retries instead of skipping 12h.
  await markSentimentRun(campaignId, userId)
  return { analyzed: rows.length, found: comments.length }
}

async function markSentimentRun(campaignId, userId) {
  await admin.from('campaign_intel_state')
    .upsert({ campaign_id: campaignId, user_id: userId, sentiment_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'campaign_id' })
    .then(() => {}, () => {})
}

// Rollup for getCampaignMemory + the dashboard. Recurring questions and negative
// themes are surfaced verbatim (a content backlog + a guardrail).
export async function campaignSentimentSummary(campaignId, { limit = 400 } = {}) {
  const { data } = await admin.from('post_sentiment')
    .select('sentiment, emotion, aspect, is_sarcastic, comment_text, confidence')
    .eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(limit)
  const rows = (data || []).filter(r => !r.is_sarcastic || (r.confidence ?? 0) >= 0.7) // drop low-confidence sarcasm
  const total = rows.length
  if (!total) return { total: 0 }
  const counts = { positive: 0, neutral: 0, negative: 0, question: 0 }
  const byAspect = {}
  for (const r of rows) {
    counts[r.sentiment] = (counts[r.sentiment] || 0) + 1
    const key = `${r.aspect}:${r.sentiment}`
    byAspect[key] = (byAspect[key] || 0) + 1
  }
  const questions = rows.filter(r => r.sentiment === 'question').map(r => r.comment_text).slice(0, 6)
  const negatives = rows.filter(r => r.sentiment === 'negative').map(r => r.comment_text).slice(0, 6)
  const negShare = total ? counts.negative / total : 0
  // Aspects drawing the most negativity (what to fix) and most positivity (what's landing).
  const aspectScore = {}
  for (const r of rows) { (aspectScore[r.aspect] ||= { pos: 0, neg: 0 }); if (r.sentiment === 'positive') aspectScore[r.aspect].pos++; if (r.sentiment === 'negative') aspectScore[r.aspect].neg++ }
  return { total, counts, neg_share: negShare, by_aspect: byAspect, aspect_score: aspectScore, questions, negatives }
}

// Cron entry: analyze the handful of active campaigns whose sentiment is stale.
export async function runDueCampaignSentiment({ limit = 5 } = {}) {
  const { data: due } = await admin.rpc('due_campaign_sentiment', { lim: limit })
  if (!due?.length) return { campaigns: 0 }
  let analyzed = 0
  for (const d of due) {
    try { const r = await analyzeCampaignSentiment(d.campaign_id, d.user_id); analyzed += r.analyzed || 0 } catch (e) { console.error('[campaign-sentiment]', d.campaign_id, e.message) }
  }
  return { campaigns: due.length, analyzed }
}
