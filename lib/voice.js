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
  const [{ data: persona }, fb, { data: recent }] = await Promise.all([
    admin.from('personas').select('*').eq('user_id', userId).single(),
    recentFeedback(userId),
    recentQ,
  ])
  return { persona: persona || null, fb, recent: (recent || []).map(r => r.content).filter(Boolean) }
}
