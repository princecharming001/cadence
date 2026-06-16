// lib/weights.js — the ONE source of truth for how raw engagement becomes a
// comparable score. Shared by the learning loop (campaign-learning.js, the bandit
// reward) and the dashboard rollup (agent-campaigns route) so "what's winning" on
// the operator's screen can never disagree with what the bandit actually learns —
// a disagreement that silently drifts the posteriors toward the wrong angles.
//
// Per-platform weighting: a like is near-vanity; replies/comments and reposts/
// shares carry the real signal, and each platform values them differently
// (LinkedIn comments are king; X reposts/quotes travel; IG/TikTok shares+saves).

export const PLATFORM_W = {
  x:         { like: 1, reply: 3, repost: 3 }, // replies + reposts/quotes + bookmarks-proxy
  linkedin:  { like: 1, reply: 4, repost: 2 }, // comments (esp. substantive) are king
  instagram: { like: 1, reply: 2, repost: 3 }, // shares/saves proxied by reposts
  tiktok:    { like: 1, reply: 2, repost: 3 }, // shares/saves proxied by reposts
}

// Weighted engagement for a post row (likes/replies/reposts columns).
export function engScore(p) {
  const w = PLATFORM_W[p.platform] || PLATFORM_W.x
  return (Number(p.likes) || 0) * w.like + (Number(p.replies) || 0) * w.reply + (Number(p.reposts) || 0) * w.repost
}

// Below this many impressions a per-reach rate is noise. The learning loop raises
// it adaptively per platform (toward each account's own P10) but never lowers it.
export const MIN_IMPRESSION_FLOOR = 50
