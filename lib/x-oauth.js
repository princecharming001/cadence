// lib/x-oauth.js — X (Twitter) OAuth 2.0 PKCE flow + token lifecycle.
// Public client: no client secret; the PKCE code_verifier secures the exchange.

import crypto from 'crypto'
import { TwitterApi } from 'twitter-api-v2'
import { admin } from './supabase'

const CLIENT_ID    = process.env.X_OAUTH_CLIENT_ID
const REDIRECT_URI = process.env.X_OAUTH_REDIRECT_URI
// media.write lets us upload images and attach them to tweets on behalf of the user.
const SCOPES       = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']

// Use x.com (not twitter.com) for the authorize step: the user's X login session
// lives on the x.com cookie domain, so x.com recognizes it and shows the consent
// screen directly instead of an "you must be logged in" wall.
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
const TOKEN_URL     = 'https://api.twitter.com/2/oauth2/token'
const ME_URL        = 'https://api.twitter.com/2/users/me'

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Generate a PKCE verifier/challenge pair + random state.
export function makePkce() {
  const code_verifier  = base64url(crypto.randomBytes(32))
  const challenge      = base64url(crypto.createHash('sha256').update(code_verifier).digest())
  const state          = base64url(crypto.randomBytes(16))
  return { code_verifier, challenge, state }
}

// Build the X authorize URL the user is redirected to.
export function authorizeUrl({ challenge, state }) {
  const p = new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 SCOPES.join(' '),
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  })
  return `${AUTHORIZE_URL}?${p.toString()}`
}

// Exchange an authorization code for tokens (public-client: client_id in body, no secret).
export async function exchangeCode(code, code_verifier) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  REDIRECT_URI,
    client_id:     CLIENT_ID,
    code_verifier,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`)
  return res.json() // { access_token, refresh_token, expires_in, scope, token_type }
}

// Refresh an expired access token using the stored refresh token.
export async function refreshToken(refresh_token) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token,
    client_id:     CLIENT_ID,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`)
  return res.json()
}

// Fetch the connected X user's identity (id, username, name).
export async function fetchXUser(access_token) {
  const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${access_token}` } })
  if (!res.ok) throw new Error(`Fetch X user failed (${res.status}): ${await res.text()}`)
  const { data } = await res.json()
  return data // { id, name, username }
}

// Return a valid access token for a connection row, refreshing + persisting if
// expired (or if `force` is set, e.g. after a 401). Mutates the passed object's
// tokens so callers that retry use the fresh values.
export async function getValidAccessToken(connection, force = false) {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0
  if (!force && Date.now() < expiresAt - 60_000) {
    return connection.access_token
  }
  if (!connection.refresh_token) {
    throw new Error('reconnect_required')
  }
  const tok = await refreshToken(connection.refresh_token)
  const newExpiry = new Date(Date.now() + (tok.expires_in || 7200) * 1000).toISOString()
  // X rotates refresh tokens — always persist the new one.
  connection.access_token  = tok.access_token
  connection.refresh_token = tok.refresh_token || connection.refresh_token
  connection.expires_at    = newExpiry
  await admin.from('x_connections').update({
    access_token:  connection.access_token,
    refresh_token: connection.refresh_token,
    expires_at:    newExpiry,
    scope:         tok.scope || connection.scope,
    updated_at:    new Date().toISOString(),
  }).eq('id', connection.id)
  return connection.access_token
}

// Post a tweet on behalf of a connection, optionally with an image and/or as a
// reply to another tweet. Returns the tweet id.
export async function postTweet(access_token, text, imageUrl, replyToTweetId) {
  const reply = replyToTweetId ? { reply: { in_reply_to_tweet_id: String(replyToTweetId) } } : {}

  // Image path: use twitter-api-v2 (OAuth2 user token) to upload media + tweet.
  if (imageUrl) {
    try {
      const client = new TwitterApi(access_token)
      const resp   = await fetch(imageUrl)
      if (!resp.ok) throw new Error(`image fetch ${resp.status}`)
      const buf       = Buffer.from(await resp.arrayBuffer())
      const mediaType = resp.headers.get('content-type') || 'image/jpeg'
      const mediaId   = await client.v2.uploadMedia(buf, { media_type: mediaType })
      const tweet     = await client.v2.tweet({ text, media: { media_ids: [mediaId] }, ...reply })
      return tweet.data.id
    } catch (e) {
      // If media upload isn't permitted (e.g. missing media.write scope), fall back
      // to a text-only tweet rather than failing the whole post.
      console.error('[postTweet] media path failed, falling back to text-only:', e.message)
    }
  }

  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...reply }),
  })
  if (!res.ok) throw new Error(`Tweet failed (${res.status}): ${await res.text()}`)
  const { data } = await res.json()
  return data.id
}

// ── Read helpers (engagement discovery) ───────────────────────────────────────
// X reads are pay-per-usage, so these run ONLY when the operator sets
// X_READ_ENABLED=true. Errors are tagged `readBlocked` on 402/403/429 so the
// engagement engine can degrade to manual targets instead of failing the run.

export function xReadEnabled() { return process.env.X_READ_ENABLED === 'true' }

async function xGet(access_token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } })
  if (!res.ok) {
    const err = new Error(`X read failed (${res.status}): ${await res.text()}`)
    err.readBlocked = [402, 403, 429].includes(res.status)
    throw err
  }
  return res.json()
}

// Fetch one tweet's text + author (used to give the model real context for a
// pasted tweet link).
export async function lookupTweet(access_token, tweetId) {
  const d = await xGet(access_token,
    `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=author_id,text&expansions=author_id&user.fields=username`)
  if (!d.data) return null
  const author = d.includes?.users?.[0]
  return { tweet_id: d.data.id, text: d.data.text, author: author?.username || null }
}

// Recent tweets matching a query (last 7 days). Excludes retweets and replies
// so the agent targets original posts.
export async function searchRecent(access_token, query, max = 10) {
  // Parenthesize: X query syntax gives OR lower precedence, so without parens
  // the -is: filters would only bind to the last OR'd keyword.
  const q = encodeURIComponent(`(${query}) -is:retweet -is:reply lang:en`)
  const n = Math.min(Math.max(max, 10), 100) // API minimum is 10
  const d = await xGet(access_token,
    `https://api.twitter.com/2/tweets/search/recent?query=${q}&max_results=${n}&tweet.fields=author_id,text&expansions=author_id&user.fields=username`)
  const users = Object.fromEntries((d.includes?.users || []).map(u => [u.id, u.username]))
  return (d.data || []).map(t => ({ tweet_id: t.id, text: t.text, author: users[t.author_id] || null }))
}
