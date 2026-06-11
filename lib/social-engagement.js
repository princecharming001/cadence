// lib/social-engagement.js — auto-reply to comments on Instagram/TikTok/LinkedIn
// posts in the user's voice, via Zernio's inbox. Mirrors the X engagement engine
// but works off comment threads instead of tweets.
//
// Flow per enabled platform: list the user's recently-commented posts -> pull
// each thread -> for every new comment we haven't handled, draft a reply in the
// user's voice -> post it (auto_post) or save it as a draft for review.
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'
import { listCommentedPosts, getPostComments, replyToInboxComment, zernioEnabled } from './zernio'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const PLATFORMS = ['instagram', 'tiktok', 'linkedin']

const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return null }
const commentId = c => pick(c, ['commentId', 'id', '_id', 'cid'])
const commentText = c => pick(c, ['text', 'content', 'message', 'body']) || ''
const commentAuthor = c => pick(c, ['authorUsername', 'author', 'username', 'from', 'fromName']) || ''
const postId = p => pick(p, ['id', '_id', 'postId', 'platformPostId'])

async function setStatus(id, status_detail, running) {
  await admin.from('social_engagement').update({ status_detail, running, last_activity_at: new Date().toISOString() }).eq('id', id)
}

async function writeReply({ platform, comment, postCaption, persona, instructions }) {
  const voice = persona
    ? `Voice — tone: ${persona.tone}; topics: ${(persona.topics || []).join(', ')}; rules: ${(persona.style_rules || []).join(' | ')}.`
    : 'Write in a warm, human, confident voice.'
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: `You reply to comments on a creator's ${platform} post, in THEIR voice, to build genuine engagement.
${voice}
${instructions ? `Extra instructions: ${instructions}` : ''}
Rules: sound human, never corporate. Be specific to what the commenter said. 1-2 sentences, under 200 chars. No hashtags. Match the platform's tone. Output ONLY the reply text.`,
    messages: [{ role: 'user', content: `POST: ${(postCaption || '').slice(0, 300)}\n\nCOMMENT from @${commentAuthor(comment)}: ${commentText(comment)}\n\nWrite the reply.` }],
  })
  return (res.content.find(b => b.type === 'text')?.text || '').trim().replace(/^["']|["']$/g, '')
}

// Run the engine for one platform for one user. Returns a short summary.
export async function runSocialEngagement(userId, platform) {
  if (!zernioEnabled()) return { error: 'Zernio not configured' }
  const { data: setting } = await admin.from('social_engagement').select('*').eq('user_id', userId).eq('platform', platform).single()
  if (!setting?.enabled) return { skipped: 'disabled' }

  await admin.from('social_engagement').update({ running: true, last_run_at: new Date().toISOString() }).eq('id', setting.id)
  try {
    const { data: persona } = await admin.from('personas').select('*').eq('user_id', userId).single()
    const { data: accts } = await admin.from('social_accounts').select('*').eq('user_id', userId).eq('platform', platform)
    if (!accts?.length) { await setStatus(setting.id, 'No connected account', false); return { skipped: 'no account' } }

    // Comments we've already handled (dedupe).
    const { data: handled } = await admin.from('social_replies').select('comment_id').eq('user_id', userId)
    const seen = new Set((handled || []).map(r => r.comment_id))

    let drafted = 0, posted = 0
    for (const acct of accts) {
      await setStatus(setting.id, `Reading ${platform} comments…`, true)
      let commentedPosts = []
      try { commentedPosts = await listCommentedPosts(userId, { platform, accountId: acct.zernio_account_id }) }
      catch (e) { await setStatus(setting.id, `Inbox read failed: ${e.message}`, false); return { error: e.message } }

      for (const post of commentedPosts) {
        const pid = postId(post)
        if (!pid) continue
        let comments = []
        try { comments = await getPostComments(pid, acct.zernio_account_id) } catch { continue }
        for (const c of comments) {
          const cid = commentId(c)
          if (!cid || seen.has(cid)) continue
          seen.add(cid)
          await setStatus(setting.id, `Replying to @${commentAuthor(c) || 'comment'}…`, true)
          let reply_text = ''
          try { reply_text = await writeReply({ platform, comment: c, postCaption: pick(post, ['content', 'caption', 'text']), persona, instructions: setting.instructions }) }
          catch { continue }
          if (!reply_text) continue

          const row = {
            user_id: userId, platform, account_id: acct.zernio_account_id,
            post_id: String(pid), comment_id: cid, comment_text: commentText(c),
            comment_author: commentAuthor(c), reply_text, status: 'draft',
          }
          if (setting.auto_post) {
            try {
              await replyToInboxComment({ postId: pid, accountId: acct.zernio_account_id, message: reply_text, commentId: cid })
              row.status = 'posted'; posted++
            } catch (e) { row.status = 'failed'; row.error = e.message }
          } else { drafted++ }
          await admin.from('social_replies').upsert(row, { onConflict: 'user_id,comment_id' })
        }
      }
    }
    await setStatus(setting.id, posted || drafted ? `Done — ${posted} posted, ${drafted} drafted` : 'No new comments', false)
    return { posted, drafted }
  } catch (e) {
    await setStatus(setting.id, `Error: ${e.message}`, false)
    return { error: e.message }
  }
}

// Run all enabled platforms for a user (used by the agent / "run now").
export async function runAllSocialEngagement(userId) {
  const out = {}
  for (const p of PLATFORMS) out[p] = await runSocialEngagement(userId, p)
  return out
}

export { PLATFORMS as SOCIAL_ENGAGEMENT_PLATFORMS }
