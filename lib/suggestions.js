// lib/suggestions.js — "Ready to post": per-platform post suggestions in the
// user's voice, written from their persona + what's working for their
// inspiration accounts. Saved as draft posts (platform-tagged) the user can
// approve (post now / schedule) or discard from the tab.
import { admin } from './supabase'
import { generateJson } from './llm'
import { X_RUBRIC, LINKEDIN_RUBRIC, enforceLen } from './prompts'
import { getBrandMemory } from './brand-memory'
import { inspirationCorpus } from './inspiration'
import { bestOf } from './quality'

const SURFACE = {
  x: { rubric: X_RUBRIC, register: 'post', brief: 'X (Twitter) posts. HARD LIMIT 280 characters each.' },
  linkedin: { rubric: LINKEDIN_RUBRIC, register: 'longform', brief: 'LinkedIn posts, 600-1200 characters each — developed first-person narrative with a takeaway, NOT compressed one-liners.' },
}

export async function generateSuggestions(userId, platform, n = 3) {
  const surface = SURFACE[platform]
  if (!surface) throw new Error('Suggestions support x and linkedin.')
  const count = Math.min(Math.max(Number(n) || 3, 1), 5)

  // ONE pull of the shared brain (voice + brief + durable insights + feedback +
  // winners + cross-account coherence + live trends), then the platform's own
  // inspiration corpus.
  const [mem, inspo] = await Promise.all([
    getBrandMemory(userId, { platform, register: surface.register }),
    inspirationCorpus(userId, platform, 8),
  ])
  if (!mem.persona) throw new Error('Analyze your voice first (pull content or add your LinkedIn, then Analyze).')

  const inspoBlock = inspo.length
    ? `\n\nWHAT'S WORKING for accounts they admire (study the angles/structures, do NOT copy):\n${inspo.map((p, i) => `[${i + 1}] (${p.metric}) ${String(p.text).slice(0, 280)}`).join('\n')}`
    : ''

  // Generate a POOL of candidates HOT (for diversity), then an LLM judge scores
  // each against the same rubric + voice and keeps the best `count` — instead of
  // shipping a single-shot first draft. LinkedIn posts are long, so a smaller pool.
  const pool = platform === 'linkedin' ? Math.min(count + 2, 5) : Math.min(count * 2 + 1, 8)
  const genSystem = `You ghost-write ${surface.brief}

${mem.voice(surface.register)}

${surface.rubric}${mem.memoryBlock()}${inspoBlock}${mem.antiRepetition()}

Write ${pool} DISTINCT posts, each on a different topic in their niche, each ready to publish as-is. Push for range — different hooks, angles, and energy across them, not variations on one idea.`
  const generate = async (k) => {
    const out = await generateJson({
      system: genSystem,
      user: `Write the ${k} ${platform} posts now.`,
      schema: {
        type: 'object',
        properties: { posts: { type: 'array', items: { type: 'string' }, description: `${k} distinct ready-to-publish posts` } },
        required: ['posts'],
      },
      maxTokens: platform === 'linkedin' ? 3600 : 2400, toolName: 'emit_posts', temperature: 1,
    })
    return (out.posts || []).map(p => String(p).trim()).filter(Boolean)
  }

  let posts = await bestOf({ generate, n: count, pool, rubric: surface.rubric, voice: mem.voice(surface.register) })
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
