// lib/suggestions.js — "Ready to post": per-platform post suggestions in the
// user's voice, written from their persona + what's working for their
// inspiration accounts. Saved as draft posts (platform-tagged) the user can
// approve (post now / schedule) or discard from the tab.
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'
import { recentFeedback, feedbackBlock } from './feedback'
import { inspirationCorpus } from './inspiration'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PLATFORM_RULES = {
  x: 'X (Twitter) posts. HARD LIMIT 280 characters each. Punchy hook in line one, no hashtag spam, sound like a person.',
  linkedin: 'LinkedIn posts. 400-900 characters. A strong one-line hook, then short skimmable lines/paragraphs, end with a question or takeaway. No "I\'m humbled" corporate voice. No hashtag walls (0-3 max at the end).',
}

function parseJson(text, fallback) {
  try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim()) } catch { return fallback }
}

export async function generateSuggestions(userId, platform, n = 3) {
  if (!PLATFORM_RULES[platform]) throw new Error('Suggestions support x and linkedin.')
  const count = Math.min(Math.max(Number(n) || 3, 1), 5)

  const [{ data: persona }, fb, inspo, { data: recent }] = await Promise.all([
    admin.from('personas').select('*').eq('user_id', userId).single(),
    recentFeedback(userId),
    inspirationCorpus(userId, platform, 8),
    admin.from('posts').select('content').eq('user_id', userId).order('created_at', { ascending: false }).limit(12),
  ])
  if (!persona) throw new Error('Analyze your voice first (pull content or add your LinkedIn, then Analyze).')

  const voice = `VOICE — tone: ${persona.tone}; topics: ${(persona.topics || []).join(', ')}; rules: ${(persona.style_rules || []).join(' | ')}; signature moves: ${(persona.signature_moves || []).join(' | ')}.`
  const inspoBlock = inspo.length
    ? `\nWHAT'S WORKING for accounts they admire (study the angles/structures, do NOT copy):\n${inspo.map((p, i) => `[${i + 1}] (${p.metric}) ${String(p.text).slice(0, 280)}`).join('\n')}`
    : ''
  const avoid = (recent || []).map(r => (r.content || '').slice(0, 80)).filter(Boolean)

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1600,
    system: `You ghost-write ${PLATFORM_RULES[platform]}

${voice}${feedbackBlock(fb)}${inspoBlock}

Write ${count} DISTINCT posts, each on a different topic in their niche, each ready to publish as-is. Don't repeat angles from these recent posts: ${avoid.join(' / ') || '(none)'}.

Respond with ONLY JSON: {"posts":["...","..."]}`,
    messages: [{ role: 'user', content: `Write the ${count} ${platform} posts now.` }],
  })

  const txt = res.content.find(b => b.type === 'text')?.text || '{}'
  let posts = parseJson(txt, {}).posts
  if (!Array.isArray(posts) || !posts.length) throw new Error('No suggestions generated — try again.')
  posts = posts.map(p => String(p).trim()).filter(Boolean).slice(0, count)
  if (platform === 'x') posts = posts.map(p => p.slice(0, 280))

  const rows = posts.map(content => ({ user_id: userId, content, status: 'draft', platform, source: 'suggestion' }))
  const { data, error } = await admin.from('posts').insert(rows).select()
  if (error) throw new Error(error.message)
  return data
}
