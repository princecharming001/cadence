// lib/posting.js — post a single queued post to its owner's connected account.
// X via the X API; LinkedIn via Zernio. Shared by the cron (scheduled) and the
// "Post now" button (manual).
//
// Exactly-once discipline: postOne CLAIMS the row (queued -> posting, atomic
// CAS) before any network work. Overlapping cron ticks, a cron + a Post-now
// click, or two Post-now clicks all resolve to one winner; losers are told the
// post is already being handled. A success-then-crash leaves the row in
// 'posting' for the interrupted-sweep to mark failed WITHOUT retrying — a
// silent retry is how you tweet twice.
import { admin } from './supabase'
import { getValidAccessToken, postTweet } from './x-oauth'
import { createPost as zernioCreatePost, zernioEnabled } from './zernio'
import { claimPost } from './engine'

const isAuthErr = e => /\b401\b|reconnect_required|invalid_request|unauthorized/i.test(String(e?.message || ''))
// X 403: the target tweet's author limited who can reply (following/mentioned/
// verified). Permanent and not our fault — surface a human reason, never retry.
const isReplyForbidden = e => /reply to this conversation is not allowed|not allowed because you have not been mentioned/i.test(String(e?.message || ''))
// Transient = worth retrying (rate limits, server blips, network). Auth and
// content errors (duplicate, forbidden) are NOT — retrying those spams X.
const isTransientErr = e => /\b(429|500|502|503|504)\b|rate limit|timed? ?out|ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(String(e?.message || ''))
const RETRY_BACKOFF_MIN = [2, 8, 30] // minutes; then it stays failed

async function markPosted(id, external_id) {
  await admin.from('posts').update({
    status: 'posted', posted_at: new Date().toISOString(), external_id, error: null,
  }).eq('id', id)
}

async function markFailed(id, error) {
  await admin.from('posts').update({ status: 'failed', error: String(error || '').slice(0, 300) }).eq('id', id)
}

// Transient failure → automatic re-queue with backoff (max 3 tries), so a
// rate-limited 9:00 post fires at 9:02 instead of dying silently. Anything
// else (or retries exhausted) → failed, loudly, in the queue UI.
async function failOrRetry(post, e) {
  const tries = post.retry_count || 0
  if (isTransientErr(e) && tries < RETRY_BACKOFF_MIN.length) {
    const delayMin = RETRY_BACKOFF_MIN[tries]
    await admin.from('posts').update({
      status: 'queued', retry_count: tries + 1,
      scheduled_for: new Date(Date.now() + delayMin * 60e3).toISOString(),
      error: `Retry ${tries + 1}/${RETRY_BACKOFF_MIN.length} in ${delayMin}m — ${String(e.message || '').slice(0, 200)}`,
    }).eq('id', post.id)
    return { id: post.id, status: 'retrying', in_minutes: delayMin, error: e.message }
  }
  await markFailed(post.id, e.message)
  return { id: post.id, status: 'failed', error: e.message }
}

// LinkedIn / Instagram / TikTok posts publish through Zernio. A post pinned to
// a specific account (social_account_id — e.g. agent posts) goes to THAT
// account; otherwise the user's first account on the platform.
async function postOneZernio(post) {
  try {
    if (!zernioEnabled()) throw new Error('Publishing not connected (Zernio).')
    let acct = null
    if (post.social_account_id) {
      const { data } = await admin.from('social_accounts').select('*')
        .eq('id', post.social_account_id).eq('user_id', post.user_id).single()
      acct = data || null
      if (!acct) throw new Error(`The ${post.platform} account this post was scheduled for is no longer connected.`)
    } else {
      const { data } = await admin.from('social_accounts').select('*')
        .eq('user_id', post.user_id).eq('platform', post.platform).limit(1).single()
      acct = data || null
    }
    if (!acct) throw new Error(`No ${post.platform} account connected.`)
    // A rendered video (UGC talking-head / clip) takes precedence; else carousels
    // carry every slide in image_urls and single-image posts keep image_url.
    const hasVideo = !!post.video_url
    const media = Array.isArray(post.image_urls) && post.image_urls.length
      ? post.image_urls
      : (post.image_url ? [post.image_url] : [])
    if ((post.platform === 'instagram' || post.platform === 'tiktok') && !media.length && !hasVideo) {
      throw new Error(`${post.platform} posts need an image or video.`)
    }
    const r = await zernioCreatePost({
      userId: post.user_id, accounts: [acct], content: post.content,
      mediaUrls: hasVideo ? [] : media,
      videoUrl: hasVideo ? post.video_url : undefined,
      title: post.platform === 'tiktok' ? post.content.split('\n')[0].slice(0, 88) : undefined,
    })
    await markPosted(post.id, r.id)
    return { id: post.id, status: 'posted', external_id: r.id, as: acct.username }
  } catch (e) {
    return failOrRetry(post, e)
  }
}

export async function postOne(post) {
  // Thread parts post IN ORDER, each replying to the previous part. A part
  // whose predecessor hasn't posted yet simply waits for the next tick (no
  // claim, no failure) — and a failed predecessor holds the rest of the
  // thread rather than publishing a beheaded tail.
  if (post.thread_id && post.thread_index > 0) {
    const { data: prev } = await admin.from('posts')
      .select('status, external_id').eq('thread_id', post.thread_id)
      .eq('thread_index', post.thread_index - 1).single()
    if (!prev || prev.status !== 'posted' || !prev.external_id) {
      return { id: post.id, status: 'waiting', error: 'Waiting for the previous thread part.' }
    }
    post.reply_to_tweet_id = prev.external_id
  }

  // Atomic claim — drafts/paused/posting/posted rows all lose here, so this is
  // also the guard against posting something the user didn't queue.
  const claimed = await claimPost(post.id)
  if (!claimed) return { id: post.id, status: 'skipped', error: 'Already posting or no longer queued.' }
  post = { ...claimed, reply_to_tweet_id: post.reply_to_tweet_id || claimed.reply_to_tweet_id }

  if (['linkedin', 'instagram', 'tiktok'].includes(post.platform)) return postOneZernio(post)

  // The post's explicitly chosen account is BINDING — if it's gone, fail loudly
  // rather than publish from whichever account happens to sort first. Only
  // legacy rows with no account chosen fall back to the user's first account.
  let conn = null
  if (post.x_connection_id) {
    const { data } = await admin
      .from('x_connections').select('*')
      .eq('id', post.x_connection_id).eq('user_id', post.user_id).single()
    conn = data || null
    if (!conn) {
      await markFailed(post.id, 'The X account this post was scheduled for is no longer connected.')
      return { id: post.id, status: 'failed', error: 'Scheduled account no longer connected.' }
    }
  } else {
    const { data: conns } = await admin
      .from('x_connections').select('*')
      .eq('user_id', post.user_id)
      .order('created_at', { ascending: true })
      .limit(1)
    conn = conns?.[0]
  }
  if (!conn) {
    await markFailed(post.id, 'No connected X account.')
    return { id: post.id, status: 'failed', error: 'No connected X account.' }
  }

  try {
    let token = await getValidAccessToken(conn)
    let tweetId
    try {
      tweetId = await postTweet(token, post.content, post.image_url, post.reply_to_tweet_id)
    } catch (e) {
      // Token may have been invalidated early — force a refresh and retry once.
      if (isAuthErr(e)) {
        token   = await getValidAccessToken(conn, true)
        tweetId = await postTweet(token, post.content, post.image_url, post.reply_to_tweet_id)
      } else throw e
    }

    await markPosted(post.id, tweetId)
    return { id: post.id, status: 'posted', external_id: tweetId, as: conn.username }
  } catch (e) {
    // Auth truly dead (refresh retried and failed): FLAG the connection instead
    // of deleting it — deletion orphans every other scheduled post on this
    // account and erases the user's primary/feeder setup over a transient blip.
    if (isAuthErr(e)) {
      await markFailed(post.id, 'X connection expired — please reconnect your account.')
      await admin.from('x_connections').update({ needs_reconnect: true }).eq('id', conn.id)
      return { id: post.id, status: 'failed', error: 'X connection expired — please reconnect your account.', reconnect: true }
    }
    // Reply blocked by the target's reply settings — permanent; give a clear reason
    // (we now pre-skip these via reply_settings, but settings can change after a
    // post is queued, and the support-primary path can hit a restricted own-tweet).
    if (post.reply_to_tweet_id && isReplyForbidden(e)) {
      const msg = 'Reply blocked by X — the author limited who can reply to that post.'
      await markFailed(post.id, msg)
      return { id: post.id, status: 'failed', error: msg }
    }
    return failOrRetry(post, e)
  }
}
