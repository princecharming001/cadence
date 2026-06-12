// lib/unipile.js — LinkedIn engagement adapter (read comments on the user's
// posts + reply to them), backed by Unipile (unipile.com).
//
// WHY UNIPILE: Zernio publishes to LinkedIn fine but its LinkedIn comment
// inbox is unreliable, and LinkedIn's official API is locked behind a partner
// program. Unipile connects the USER'S OWN LinkedIn session (hosted auth),
// then exposes posts/comments/reactions per account at a flat ~€5.5/account/mo
// — no per-request fees, no scraping fragility on writes.
//
// Gating: everything no-ops unless UNIPILE_DSN + UNIPILE_API_KEY are set AND
// the account has been linked (social_accounts.unipile_account_id). The
// social-engagement engine falls back to the Zernio inbox otherwise.
//
// NOTE: endpoint shapes below follow Unipile's published v1 API; re-verify
// against docs.unipile.com when the API key is first configured.
import { admin } from './supabase'

export function unipileEnabled() {
  return !!(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY)
}

async function ufetch(path, { method = 'GET', body } = {}) {
  if (!unipileEnabled()) { const e = new Error('LinkedIn engagement not configured (UNIPILE_DSN / UNIPILE_API_KEY).'); e.notConfigured = true; throw e }
  const res = await fetch(`https://${process.env.UNIPILE_DSN}/api/v1${path}`, {
    method,
    headers: { 'X-API-KEY': process.env.UNIPILE_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data; try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`Unipile ${method} ${path} (${res.status}): ${(data.detail || data.message || text).slice(0, 200)}`)
  return data
}

// Hosted-auth link the user visits to connect their LinkedIn to Unipile.
// The notify webhook (/api/unipile) stores the resulting account id.
export async function hostedAuthLink(userId, appUrl) {
  const d = await ufetch('/hosted/accounts/link', {
    method: 'POST',
    body: {
      type: 'create',
      providers: ['LINKEDIN'],
      api_url: `https://${process.env.UNIPILE_DSN}`,
      expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      name: userId, // echoed back in the notify webhook → maps account to user
      success_redirect_url: `${appUrl}/?linkedin=connected`,
      notify_url: `${appUrl}/api/unipile`,
    },
  })
  return d.url
}

// The user's linked Unipile account id (null = not linked yet).
export async function unipileAccountId(userId) {
  const { data } = await admin.from('social_accounts')
    .select('unipile_account_id').eq('user_id', userId).eq('platform', 'linkedin')
    .not('unipile_account_id', 'is', null).limit(1).single()
  return data?.unipile_account_id || null
}

// Recent posts authored by the linked account.
export async function listOwnPosts(accountId, limit = 10) {
  const d = await ufetch(`/users/me/posts?account_id=${encodeURIComponent(accountId)}&limit=${limit}`)
  return d.items || []
}

// Comments on one post.
export async function listPostComments(accountId, postId, limit = 50) {
  const d = await ufetch(`/posts/${encodeURIComponent(postId)}/comments?account_id=${encodeURIComponent(accountId)}&limit=${limit}`)
  return d.items || []
}

// Reply to a comment (threaded when commentId given, top-level otherwise).
export async function replyToComment(accountId, postId, text, commentId) {
  const d = await ufetch(`/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    body: { account_id: accountId, text, ...(commentId ? { comment_id: commentId } : {}) },
  })
  return d.id || 'posted'
}
