// lib/brand-context.js — the "brand brain": one compact block describing what
// the user's MAIN accounts have actually been saying lately, across platforms.
// Campaigns and feeder agents inject it so a business's whole fleet stays
// coherent with the primary accounts — without spending a single external
// API read (everything here comes from our own tables).
import { admin } from './supabase'

const squash = s => (s || '').replace(/\s+/g, ' ').trim()

// Raw material: recently PUBLISHED posts (all platforms) + the user's
// highest-signal pulled content (voice_samples) + fresh LinkedIn posts.
export async function brandContext(userId, { limit = 12 } = {}) {
  const [{ data: posted }, { data: samples }, { data: liAccounts }] = await Promise.all([
    admin.from('posts').select('content, platform, posted_at')
      .eq('user_id', userId).eq('status', 'posted')
      .order('posted_at', { ascending: false }).limit(limit),
    admin.from('voice_samples').select('platform, text, metric')
      .eq('user_id', userId).order('metric', { ascending: false }).limit(8),
    admin.from('linkedin_accounts').select('id').eq('user_id', userId).eq('is_mentor', false),
  ])
  let liPosts = []
  const liIds = (liAccounts || []).map(a => a.id)
  if (liIds.length) {
    const { data } = await admin.from('linkedin_posts').select('content, posted_at')
      .in('account_id', liIds).order('posted_at', { ascending: false }).limit(5)
    liPosts = data || []
  }

  // Merge + dedupe (same content can exist as a post row and a voice sample).
  const seen = new Set()
  const rows = []
  for (const p of posted || []) {
    const key = squash(p.content).slice(0, 80).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key); rows.push({ platform: p.platform || 'x', text: squash(p.content) })
  }
  for (const p of liPosts) {
    const key = squash(p.content).slice(0, 80).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key); rows.push({ platform: 'linkedin', text: squash(p.content) })
  }
  for (const s of samples || []) {
    const key = squash(s.text).slice(0, 80).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key); rows.push({ platform: s.platform, text: squash(s.text), top: true })
  }
  return rows.slice(0, limit + 6)
}

// The prompt block. `top: true` rows are the user's proven best content.
export async function brandContextBlock(userId, { limit = 12 } = {}) {
  const rows = await brandContext(userId, { limit })
  if (!rows.length) return ''
  return `\n\nBRAND CONTEXT — what the main accounts have been saying lately. Stay coherent with this: reinforce the same themes and positions, reference recent moves naturally when relevant, and never contradict it.\n${rows
    .map(r => `- [${r.platform}${r.top ? ' · top performer' : ''}] ${r.text.slice(0, 150)}`)
    .join('\n')}`
}
