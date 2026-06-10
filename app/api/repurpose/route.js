// POST /api/repurpose  { content }  → Claude rewrites a LinkedIn post as a tweet draft.
import Anthropic from '@anthropic-ai/sdk'
import { getUser } from '@/lib/supabase'
import { X_RUBRIC } from '@/lib/rubric'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { content } = await req.json()
  if (!content) return Response.json({ error: 'Content required.' }, { status: 400 })

  const SYSTEM = `You rewrite a long LinkedIn post into a single, punchy tweet for X. Keep the author's voice but rewrite the format aggressively.

${X_RUBRIC}

Output ONLY the tweet text (use \\n for line breaks), nothing else.`

  async function draftTweet(extra = '') {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Rewrite this LinkedIn post as a tweet (≤270 chars):${extra}\n\n${content}` }],
    })
    return (res.content.find(b => b.type === 'text')?.text || '').trim().replace(/^["']|["']$/g, '')
  }

  let draft = await draftTweet()
  // One enforced shortening pass if the model overshot.
  if (draft.length > 280) {
    draft = await draftTweet(' Your previous attempt was too long — make it punchier and strictly under 270 characters.')
  }
  // Final hard safety net: never return >280.
  if (draft.length > 280) draft = draft.slice(0, 277).trimEnd() + '…'

  return Response.json({ draft })
}
