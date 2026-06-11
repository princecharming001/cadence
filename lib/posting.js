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

async function markPosted(id, external_id) {
  await admin.from('posts').update({
    status: 'posted', posted_at: new Date().toISOString(), external_id, error: null,
  }).eq('id', id)
}

async function markFailed(id, error) {
  await admin.from('posts').update({ status: 'failed', error: String(error || '').slice(0, 300) }).eq('id', id)
}

// LinkedIn text posts publish through Zernio to the user's linked account.
async function postOneLinkedIn(post) {
  try {
    if (!zernioEnabled()) throw new Error('Publishing not connected (Zernio).')
    const { data: acct } = await admin.from('social_accounts').select('*')
      .eq('user_id', post.user_id).eq('platform', 'linkedin').limit(1).single()
    if (!acct) throw new Error('No LinkedIn account connected.')
    const r = await zernioCreatePost({
      userId: post.user_id, accounts: [acct], content: post.content,
      mediaUrls: post.image_url ? [post.image_url] : [],
    })
    await markPosted(post.id, r.id)
    return { id: post.id, status: 'posted', external_id: r.id, as: acct.username }
  } catch (e) {
    await markFailed(post.id, e.message)
    return { id: post.id, status: 'failed', error: e.message }
  }
}

export async function postOne(post) {
  // Atomic claim — drafts/paused/posting/posted rows all lose here, so this is
  // also the guard against posting something the user didn't queue.
  const claimed = await claimPost(post.id)
  if (!claimed) return { id: post.id, status: 'skipped', error: 'Already posting or no longer queued.' }
  post = claimed

  if (post.platform === 'linkedin') return postOneLinkedIn(post)

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
    await markFailed(post.id, e.message)
    // Auth truly dead (refresh retried and failed): FLAG the connection instead
    // of deleting it — deletion orphans every other scheduled post on this
    // account and erases the user's primary/feeder setup over a transient blip.
    if (isAuthErr(e)) {
      await admin.from('x_connections').update({ needs_reconnect: true }).eq('id', conn.id)
      return { id: post.id, status: 'failed', error: 'X connection expired — please reconnect your account.', reconnect: true }
    }
    return { id: post.id, status: 'failed', error: e.message }
  }
}
