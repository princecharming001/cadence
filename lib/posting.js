// lib/posting.js — post a single queued post to its owner's connected account.
// X via the X API; LinkedIn via Zernio. Shared by the cron (scheduled) and the
// "Post now" button (manual).
import { admin } from './supabase'
import { getValidAccessToken, postTweet } from './x-oauth'
import { createPost as zernioCreatePost, zernioEnabled } from './zernio'

const isAuthErr = e => /\b401\b|reconnect_required|invalid_request|unauthorized/i.test(String(e?.message || ''))

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
    await admin.from('posts').update({ status: 'posted', posted_at: new Date().toISOString(), external_id: r.id }).eq('id', post.id)
    return { id: post.id, status: 'posted', external_id: r.id, as: acct.username }
  } catch (e) {
    await admin.from('posts').update({ status: 'failed' }).eq('id', post.id)
    return { id: post.id, status: 'failed', error: e.message }
  }
}

export async function postOne(post) {
  if (post.platform === 'linkedin') return postOneLinkedIn(post)
  // Prefer the post's explicitly chosen account; otherwise fall back to the
  // user's first connected account.
  let conn = null
  if (post.x_connection_id) {
    const { data } = await admin
      .from('x_connections').select('*')
      .eq('id', post.x_connection_id).eq('user_id', post.user_id).single()
    conn = data || null
  }
  if (!conn) {
    const { data: conns } = await admin
      .from('x_connections').select('*')
      .eq('user_id', post.user_id)
      .order('created_at', { ascending: true })
      .limit(1)
    conn = conns?.[0]
  }
  if (!conn) {
    await admin.from('posts').update({ status: 'failed' }).eq('id', post.id)
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

    await admin.from('posts').update({
      status: 'posted', posted_at: new Date().toISOString(), external_id: tweetId,
    }).eq('id', post.id)
    return { id: post.id, status: 'posted', external_id: tweetId, as: conn.username }
  } catch (e) {
    await admin.from('posts').update({ status: 'failed' }).eq('id', post.id)
    // If auth is truly dead (refresh also failed), drop the connection so the UI
    // prompts the user to reconnect.
    if (isAuthErr(e)) {
      await admin.from('x_connections').delete().eq('id', conn.id)
      return { id: post.id, status: 'failed', error: 'X connection expired — please reconnect your account.', reconnect: true }
    }
    return { id: post.id, status: 'failed', error: e.message }
  }
}
