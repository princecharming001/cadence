// lib/voice.js — one fetch for everything a generation surface needs about the
// user: persona, learned feedback, and recent content for anti-repetition.
// Engines call this ONCE per run instead of each prompt site doing its own
// (inconsistent) queries.
import { admin } from './supabase'
import { recentFeedback } from './feedback'

export async function getVoice(userId, { platform = null, recentLimit = 12 } = {}) {
  let recentQ = admin.from('posts').select('content, platform')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(recentLimit)
  if (platform) recentQ = recentQ.eq('platform', platform)
  const [{ data: persona }, fb, { data: recent }, { data: winners }] = await Promise.all([
    admin.from('personas').select('*').eq('user_id', userId).single(),
    recentFeedback(userId),
    recentQ,
    // Their published posts that actually performed (real metrics, not vibes).
    admin.from('posts').select('content, likes, replies, reposts, impressions')
      .eq('user_id', userId).eq('status', 'posted').not('metrics_at', 'is', null)
      .order('likes', { ascending: false }).limit(5),
  ])
  return {
    persona: persona || null, fb,
    recent: (recent || []).map(r => r.content).filter(Boolean),
    winners: (winners || []).filter(w => (w.likes || 0) + (w.replies || 0) + (w.reposts || 0) > 0),
  }
}

// Prompt block: what measurably worked for THIS user. The strongest signal a
// generator can get — write more in the vein of proven winners.
export function winnersBlock(winners) {
  if (!winners?.length) return ''
  return `\n\nTHEIR RECENT TOP PERFORMERS (real engagement — study the hook, angle, and format, and write more in this vein without repeating them):\n${winners
    .map(w => `- (${w.likes || 0}♥ ${w.reposts || 0}↻ ${w.replies || 0}💬${w.impressions ? ` ${w.impressions} views` : ''}) ${(w.content || '').replace(/\s+/g, ' ').slice(0, 140)}`)
    .join('\n')}`
}
