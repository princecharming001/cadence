// lib/voice.js — one fetch for everything a generation surface needs about the
// user: persona, learned feedback, and recent content for anti-repetition.
// Engines call this ONCE per run instead of each prompt site doing its own
// (inconsistent) queries.
import { admin } from './supabase'
import { recentFeedback } from './feedback'
import { activeAccount, accountProfile } from './account-scope'

// Voice is now per-ACCOUNT: the active account's persona/recent/winners, falling
// back to the user-level persona when an account has no override yet. Pass an
// already-resolved `account` to avoid a second lookup (getBrandMemory does this).
export async function getVoice(userId, { platform = null, recentLimit = 12, account = undefined } = {}) {
  const acct = account !== undefined ? account : (platform ? await activeAccount(userId, platform) : null)
  // Scope recent + winners to THIS account (its own anti-repetition + proven
  // winners). For the active account, unstamped posts (x_connection_id/
  // social_account_id null — they publish as the active account) count too.
  const scope = q => {
    if (acct?.kind === 'x') return q.or(`x_connection_id.eq.${acct.id},x_connection_id.is.null`)
    if (acct?.kind === 'social') return q.or(`social_account_id.eq.${acct.id},social_account_id.is.null`)
    return platform ? q.eq('platform', platform) : q
  }
  const recentQ = scope(admin.from('posts').select('content, platform')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(recentLimit))
  const winQ = scope(admin.from('posts').select('content, likes, replies, reposts, impressions')
    .eq('user_id', userId).eq('status', 'posted').not('metrics_at', 'is', null)
    .order('likes', { ascending: false }).limit(5))
  const [{ data: personaRow }, aProf, fb, { data: recent }, { data: winners }] = await Promise.all([
    admin.from('personas').select('*').eq('user_id', userId).maybeSingle(),
    acct ? accountProfile(acct) : Promise.resolve(null),
    recentFeedback(userId),
    recentQ,
    winQ,
  ])
  return {
    persona: aProf?.persona || personaRow || null, fb, account: acct, // per-account override wins
    recent: (recent || []).map(r => r.content).filter(Boolean),
    winners: (winners || []).filter(w => (w.likes || 0) + (w.replies || 0) + (w.reposts || 0) > 0),
  }
}

// Prompt block: what measurably worked for THIS user — as VERBATIM few-shot
// exemplars, not truncated bullets. Pasting full proven posts is the single most
// effective voice-transfer technique: the model pattern-matches the real cadence,
// structure, and idiom instead of inferring voice from a rule-list.
export function winnersBlock(winners) {
  if (!winners?.length) return ''
  return `\n\nPOSTS THAT ARE UNMISTAKABLY THEM AND PERFORMED (real engagement). These are your voice + structure target — match how these read (rhythm, length, hook, point of view). Do NOT reuse their topics or repeat them; write NEW posts that feel like they came from the same person:\n${winners
    .map((w, i) => `${i + 1}. (${w.likes || 0}♥ ${w.reposts || 0}↻ ${w.replies || 0}💬${w.impressions ? ` ${w.impressions} views` : ''})\n"${(w.content || '').replace(/\s+/g, ' ').trim().slice(0, 500)}"`)
    .join('\n\n')}`
}
