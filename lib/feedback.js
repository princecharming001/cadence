// lib/feedback.js — thumbs up/down memory so generations learn what the user likes.
import { admin } from './supabase'

// Most recent ratings for a user.
export async function recentFeedback(userId, limit = 16) {
  const { data } = await admin
    .from('post_feedback')
    .select('content, rating, note, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return data || []
}

// Render rated examples into a prompt block the model can learn from.
export function feedbackBlock(fb) {
  if (!fb?.length) return ''
  const fmt = f => `• ${(f.content || '').replace(/\s+/g, ' ').slice(0, 200)}${f.note ? `  — note: ${f.note}` : ''}`
  const liked    = fb.filter(f => f.rating === 'up').slice(0, 6).map(fmt)
  const disliked = fb.filter(f => f.rating === 'down').slice(0, 6).map(fmt)
  if (!liked.length && !disliked.length) return ''
  let s = '\n\nLEARNED PREFERENCES — the user has rated past posts. Lean HARD into the 👍 patterns and avoid anything resembling the 👎 ones:'
  if (liked.length)    s += `\n👍 LIKED:\n${liked.join('\n')}`
  if (disliked.length) s += `\n👎 DISLIKED:\n${disliked.join('\n')}`
  return s
}
