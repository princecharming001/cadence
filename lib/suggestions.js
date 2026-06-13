// lib/suggestions.js — "Ready to post": per-platform post suggestions in the
// user's voice, written from their persona + what's working for their
// inspiration accounts. Saved as draft posts (platform-tagged) the user can
// approve (post now / schedule) or discard from the tab.
import { admin } from './supabase'
import { generateJson } from './llm'
import { voiceBlock, feedbackBlock, antiRepetition, X_RUBRIC, LINKEDIN_RUBRIC, enforceLen, brandBriefBlock } from './prompts'
import { getVoice, winnersBlock } from './voice'
import { inspirationCorpus } from './inspiration'
import { trendingBlock } from './trends'

const SURFACE = {
  x: { rubric: X_RUBRIC, register: 'post', brief: 'X (Twitter) posts. HARD LIMIT 280 characters each.' },
  linkedin: { rubric: LINKEDIN_RUBRIC, register: 'longform', brief: 'LinkedIn posts, 600-1200 characters each — developed first-person narrative with a takeaway, NOT compressed one-liners.' },
}

export async function generateSuggestions(userId, platform, n = 3) {
  const surface = SURFACE[platform]
  if (!surface) throw new Error('Suggestions support x and linkedin.')
  const count = Math.min(Math.max(Number(n) || 3, 1), 5)

  const [{ persona, fb, recent, winners }, inspo, trending, { data: prof }] = await Promise.all([
    getVoice(userId),
    inspirationCorpus(userId, platform, 8),
    trendingBlock(userId, platform).catch(() => ''),
    admin.from('profiles').select('brand_brief').eq('id', userId).single(),
  ])
  if (!persona) throw new Error('Analyze your voice first (pull content or add your LinkedIn, then Analyze).')
  const brand = brandBriefBlock(prof?.brand_brief)

  const inspoBlock = inspo.length
    ? `\nWHAT'S WORKING for accounts they admire (study the angles/structures, do NOT copy):\n${inspo.map((p, i) => `[${i + 1}] (${p.metric}) ${String(p.text).slice(0, 280)}`).join('\n')}`
    : ''

  const out = await generateJson({
    system: `You ghost-write ${surface.brief}

${voiceBlock(persona, { register: surface.register })}

${surface.rubric}${brand}${feedbackBlock(fb)}${winnersBlock(winners)}${inspoBlock}${trending}${antiRepetition(recent)}

Write ${count} DISTINCT posts, each on a different topic in their niche, each ready to publish as-is.`,
    user: `Write the ${count} ${platform} posts now.`,
    schema: {
      type: 'object',
      properties: { posts: { type: 'array', items: { type: 'string' }, description: `${count} distinct ready-to-publish posts` } },
      required: ['posts'],
    },
    maxTokens: 1800, toolName: 'emit_posts',
  })

  let posts = (out.posts || []).map(p => String(p).trim()).filter(Boolean).slice(0, count)
  if (!posts.length) throw new Error('No suggestions generated — try again.')
  posts = await Promise.all(posts.map(p => enforceLen(p, platform)))

  // scheduled_for is NOT NULL — drafts get "now" as a placeholder; the real
  // time is chosen when the user approves (schedule picker / smart slot).
  const now = new Date().toISOString()
  const rows = posts.map(content => ({ user_id: userId, content, status: 'draft', platform, source: 'suggestion', scheduled_for: now }))
  const { data, error } = await admin.from('posts').insert(rows).select()
  if (error) throw new Error(error.message)
  return data
}
