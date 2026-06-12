// lib/social-engagement.js — auto-reply to comments on the user's own posts
// (X / Instagram / TikTok / LinkedIn) in their voice. X reads replies via the
// X API; the rest go through Zernio's inbox.
//
// Safety model:
// - Per-platform toggle (`enabled`) + auto_post vs draft-for-review.
// - Claim-first scheduling (lib/engine.js) — cron-driven now, with run-now
//   respecting claims.
// - Dedupe by GATE ROW: a social_replies row is inserted (status 'pending')
//   BEFORE anything is published; the unique(user_id, comment_id) index is the
//   lock, so a crash or a concurrent run can never reply to a comment twice.
// - replies_per_run caps each sweep so a viral post can't trigger a reply storm.
import { admin } from './supabase'
import { generateText } from './llm'
import { voiceBlock, feedbackBlock, REPLY_RUBRIC } from './prompts'
import { getVoice } from './voice'
import { listCommentedPosts, getPostComments, replyToInboxComment, zernioEnabled } from './zernio'
import { unipileEnabled, unipileAccountId, listOwnPosts, listPostComments, replyToComment } from './unipile'
import { getValidAccessToken, searchRecent, postTweet, xReadEnabled } from './x-oauth'
import { claimEngineRow, dueRows, setEngineStatus } from './engine'

const TABLE = 'social_engagement'
const PLATFORMS = ['x', 'instagram', 'tiktok', 'linkedin']
const setStatus = (id, detail, running) => setEngineStatus(TABLE, id, detail, running)

const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return null }
const commentId = c => pick(c, ['commentId', 'id', '_id', 'cid'])
const commentText = c => pick(c, ['text', 'content', 'message', 'body']) || ''
// Prefer plain string handles; some providers (Zernio IG) return the author as
// an object {id,name,username,...} — unwrap it so we never store "[object]" /
// a JSON blob in the comment_author text column.
const commentAuthor = c => {
  const v = pick(c, ['authorUsername', 'username', 'author', 'from', 'fromName'])
  if (v && typeof v === 'object') return v.username || v.name || v.handle || ''
  return v || ''
}
const postId = p => pick(p, ['id', '_id', 'postId', 'platformPostId'])

async function writeReply({ platform, comment, postCaption, persona, fb, instructions }) {
  const raw = await generateText({
    system: `You reply to comments on this person's own ${platform} post, in THEIR voice, to build genuine engagement with their audience.

${voiceBlock(persona, { register: 'reply' })}

${REPLY_RUBRIC}${feedbackBlock(fb)}
${instructions ? `\nTHE USER'S OWN INSTRUCTIONS (follow these): ${instructions}` : ''}
Rules: be specific to what the commenter said. 1-2 sentences, under 240 chars. No links, no hashtags. Output ONLY the reply text.`,
    user: `THEIR POST: ${(postCaption || '').slice(0, 300) || '(caption unavailable)'}\n\nCOMMENT from @${commentAuthor(comment)}: ${commentText(comment)}\n\nWrite the reply.`,
    maxTokens: 200,
  })
  return raw.replace(/^["']|["']$/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 280)
}

// Insert the dedupe gate row. Returns the row id, or null if this comment was
// already handled (unique conflict) — the caller skips it.
async function claimComment(base) {
  const { data, error } = await admin.from('social_replies')
    .insert({ ...base, status: 'pending' }).select('id').single()
  if (error) return null // unique(user_id, comment_id) conflict = already handled
  return data.id
}

// ── X branch: replies to the user's posts are tweets at them ─────────────────
async function runXEngagement(setting, persona, fb) {
  const userId = setting.user_id
  if (!xReadEnabled()) { await setStatus(setting.id, 'X reading is off (X_READ_ENABLED)', false); return { skipped: 'x reads off' } }
  const { data: conn } = await admin.from('x_connections').select('*').eq('user_id', userId).order('is_primary', { ascending: false }).limit(1).single()
  if (!conn) { await setStatus(setting.id, 'No connected X account', false); return { skipped: 'no account' } }
  const token = await getValidAccessToken(conn)

  await setStatus(setting.id, 'Reading replies to your posts…', true)
  let replies = []
  // includeReplies is load-bearing: `to:` only matches replies, so the default
  // -is:reply filter would return nothing, forever.
  try { replies = await searchRecent(token, `to:${conn.username} -from:${conn.username}`, 25, { includeReplies: true }) }
  catch (e) { await setStatus(setting.id, `X read failed: ${e.message}`, false); return { error: e.message } }

  const cap = Math.max(Number(setting.replies_per_run) || 5, 1)
  let drafted = 0, posted = 0
  for (const t of replies) {
    if (posted + drafted >= cap) break
    if (!t.tweet_id) continue
    const gateId = await claimComment({
      user_id: userId, platform: 'x', account_id: conn.id, post_id: t.tweet_id,
      comment_id: t.tweet_id, comment_text: t.text, comment_author: t.author || '',
    })
    if (!gateId) continue
    await setStatus(setting.id, `Replying to @${t.author || 'someone'}…`, true)
    try {
      const reply_text = await writeReply({ platform: 'x', comment: { text: t.text, authorUsername: t.author }, postCaption: '', persona, fb, instructions: setting.instructions })
      if (!reply_text) { await admin.from('social_replies').update({ status: 'failed', error: 'empty draft' }).eq('id', gateId); continue }
      if (setting.auto_post) {
        await postTweet(token, reply_text, null, t.tweet_id)
        await admin.from('social_replies').update({ reply_text, status: 'posted' }).eq('id', gateId)
        posted++
      } else {
        await admin.from('social_replies').update({ reply_text, status: 'draft' }).eq('id', gateId)
        drafted++
      }
    } catch (e) {
      await admin.from('social_replies').update({ status: 'failed', error: String(e.message || '').slice(0, 200) }).eq('id', gateId)
    }
  }
  await setStatus(setting.id, posted || drafted ? `Done — ${posted} posted, ${drafted} drafted` : 'No new replies', false)
  return { posted, drafted }
}

// ── Zernio branch: Instagram / TikTok / LinkedIn comment inboxes ─────────────
async function runZernioEngagement(setting, persona, fb) {
  const userId = setting.user_id
  const platform = setting.platform
  if (!zernioEnabled()) { await setStatus(setting.id, 'Publishing (Zernio) not connected', false); return { error: 'Zernio not configured' } }
  const { data: accts } = await admin.from('social_accounts').select('*').eq('user_id', userId).eq('platform', platform)
  if (!accts?.length) { await setStatus(setting.id, 'No connected account', false); return { skipped: 'no account' } }

  const cap = Math.max(Number(setting.replies_per_run) || 5, 1)
  let drafted = 0, posted = 0
  for (const acct of accts) {
    if (posted + drafted >= cap) break
    await setStatus(setting.id, `Reading ${platform} comments…`, true)
    let commentedPosts = []
    try { commentedPosts = await listCommentedPosts(userId, { platform, accountId: acct.zernio_account_id }) }
    catch (e) { await setStatus(setting.id, `Inbox read failed: ${e.message}`, false); return { error: e.message } }

    for (const post of commentedPosts) {
      if (posted + drafted >= cap) break
      const pid = postId(post)
      if (!pid) continue
      let comments = []
      try { comments = await getPostComments(pid, acct.zernio_account_id) } catch { continue }
      for (const c of comments) {
        if (posted + drafted >= cap) break
        const cid = commentId(c)
        if (!cid) continue
        const gateId = await claimComment({
          user_id: userId, platform, account_id: acct.zernio_account_id,
          post_id: String(pid), comment_id: cid,
          comment_text: commentText(c), comment_author: commentAuthor(c),
        })
        if (!gateId) continue
        await setStatus(setting.id, `Replying to @${commentAuthor(c) || 'comment'}…`, true)
        try {
          const reply_text = await writeReply({ platform, comment: c, postCaption: pick(post, ['content', 'caption', 'text']), persona, fb, instructions: setting.instructions })
          if (!reply_text) { await admin.from('social_replies').update({ status: 'failed', error: 'empty draft' }).eq('id', gateId); continue }
          if (setting.auto_post) {
            await replyToInboxComment({ postId: pid, accountId: acct.zernio_account_id, message: reply_text, commentId: cid })
            await admin.from('social_replies').update({ reply_text, status: 'posted' }).eq('id', gateId)
            posted++
          } else {
            await admin.from('social_replies').update({ reply_text, status: 'draft' }).eq('id', gateId)
            drafted++
          }
        } catch (e) {
          await admin.from('social_replies').update({ status: 'failed', error: String(e.message || '').slice(0, 200) }).eq('id', gateId)
        }
      }
    }
  }
  await setStatus(setting.id, posted || drafted ? `Done — ${posted} posted, ${drafted} drafted` : 'No new comments', false)
  return { posted, drafted }
}

// ── LinkedIn via Unipile: the user's real comment inbox, reply as them ───────
async function runUnipileLinkedIn(setting, persona, fb, accountId) {
  const userId = setting.user_id
  const cap = Math.max(Number(setting.replies_per_run) || 5, 1)
  let drafted = 0, posted = 0
  await setStatus(setting.id, 'Reading LinkedIn comments…', true)
  let posts = []
  try { posts = await listOwnPosts(accountId, 8) }
  catch (e) { await setStatus(setting.id, `LinkedIn read failed: ${e.message}`, false); return { error: e.message } }
  for (const post of posts) {
    if (posted + drafted >= cap) break
    const pid = post.id || post.social_id
    if (!pid || !(post.comment_counter ?? post.comments_count ?? 1)) continue
    let comments = []
    try { comments = await listPostComments(accountId, pid) } catch { continue }
    for (const c of comments) {
      if (posted + drafted >= cap) break
      const cid = c.id || c.comment_id
      if (!cid) continue
      const author = c.author?.name || c.author_name || ''
      // Skip our own comments (replies we already made show up in the thread).
      if (c.is_author || c.author?.is_self) continue
      const gateId = await claimComment({
        user_id: userId, platform: 'linkedin', account_id: accountId,
        post_id: String(pid), comment_id: String(cid),
        comment_text: c.text || c.message || '', comment_author: author,
      })
      if (!gateId) continue
      await setStatus(setting.id, `Replying to ${author || 'a comment'}…`, true)
      try {
        const reply_text = await writeReply({ platform: 'linkedin', comment: { text: c.text || c.message, authorUsername: author }, postCaption: post.text || post.commentary || '', persona, fb, instructions: setting.instructions })
        if (!reply_text) { await admin.from('social_replies').update({ status: 'failed', error: 'empty draft' }).eq('id', gateId); continue }
        if (setting.auto_post) {
          await replyToComment(accountId, pid, reply_text, cid)
          await admin.from('social_replies').update({ reply_text, status: 'posted' }).eq('id', gateId)
          posted++
        } else {
          await admin.from('social_replies').update({ reply_text, status: 'draft' }).eq('id', gateId)
          drafted++
        }
      } catch (e) {
        await admin.from('social_replies').update({ status: 'failed', error: String(e.message || '').slice(0, 200) }).eq('id', gateId)
      }
    }
  }
  await setStatus(setting.id, posted || drafted ? `Done — ${posted} posted, ${drafted} drafted` : 'No new comments', false)
  return { posted, drafted, via: 'unipile' }
}

async function processSetting(setting) {
  try {
    const { persona, fb } = await getVoice(setting.user_id)
    if (setting.platform === 'x') return await runXEngagement(setting, persona, fb)
    // LinkedIn prefers the Unipile inbox (real comment data) when the user has
    // linked it; Zernio's inbox is the fallback for IG/TikTok and unlinked LI.
    if (setting.platform === 'linkedin' && unipileEnabled()) {
      const accountId = await unipileAccountId(setting.user_id)
      if (accountId) return await runUnipileLinkedIn(setting, persona, fb, accountId)
    }
    return await runZernioEngagement(setting, persona, fb)
  } catch (e) {
    await setStatus(setting.id, `Error: ${e.message}`, false)
    return { error: e.message }
  }
}

// Run the engine for one platform for one user (run-now path). Claim-first.
export async function runSocialEngagement(userId, platform) {
  const { data: row } = await admin.from(TABLE).select('*').eq('user_id', userId).eq('platform', platform).single()
  if (!row?.enabled) return { skipped: 'disabled' }
  const claimed = await claimEngineRow(TABLE, row)
  if (!claimed) return { error: 'Already running — give it a moment.' }
  return processSetting(claimed)
}

// Cron sweep: every enabled platform setting that is due.
export async function runDueSocialEngagement() {
  const due = await dueRows(TABLE, { activeCol: 'enabled' })
  const out = []
  for (const row of due) {
    const s = await claimEngineRow(TABLE, row)
    if (!s) continue
    out.push({ platform: s.platform, ...(await processSetting(s)) })
  }
  return out
}

export { PLATFORMS as SOCIAL_ENGAGEMENT_PLATFORMS }
