import Anthropic from '@anthropic-ai/sdk'
import { admin, getUser } from '@/lib/supabase'
import { generateImage } from '@/lib/images'
import { X_RUBRIC } from '@/lib/rubric'
import { recentFeedback, feedbackBlock } from '@/lib/feedback'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Tool definitions ──────────────────────────────────────────────────────────

const tools = [
  {
    name: 'list_queue',
    description: 'List the user\'s posts in the queue. Returns id, content, scheduled_for, status ordered by scheduled_for.',
    input_schema: {
      type: 'object',
      properties: {
        status_filter: {
          type: 'string',
          enum: ['all', 'queued', 'paused', 'posted', 'failed'],
          description: 'Filter by status. Use "all" to return everything.',
        },
      },
      required: ['status_filter'],
    },
  },
  {
    name: 'list_linkedin_posts',
    description: 'List the user\'s scraped LinkedIn posts (their own or accounts they track). Use this to repurpose LinkedIn content into tweets. Returns content, engagement, posted date, and source profile.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'How many recent LinkedIn posts to return (default 10).' },
      },
    },
  },
  {
    name: 'propose_post',
    description: 'Propose a tweet to the user as an editable draft card in the chat. This is the ONLY way to create a new post — use it whenever the user wants to write, draft, repurpose, or "post" something (whether they say schedule it, post it now, or just "write a tweet about X"). It does NOT queue or publish anything: it shows the user an editable text editor with their tweet, a time picker, a live countdown, 👍/👎, and Post-now / Schedule / Discard buttons. The USER decides what happens to it. Always write the full tweet text yourself (<=280 chars). Set want_image:true (and a vivid image_prompt) only if the user wants an image / a visual / a picture on the post. When repurposing a LinkedIn post, rewrite it to fit X unless asked to keep it verbatim. After calling this, keep your text reply to one short line like "Here\'s a draft — edit it and approve below."',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The full tweet text (<=280 chars).' },
        want_image: { type: 'boolean', description: 'True if this post should have an AI-generated image.' },
        image_prompt: { type: 'string', description: 'If want_image, a vivid visual description (subject, style, mood, colors). No text in the image.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'reschedule_post',
    description: 'Move a post to a new time.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the post.' },
        scheduled_for: { type: 'string', description: 'New ISO 8601 datetime (UTC).' },
      },
      required: ['id', 'scheduled_for'],
    },
  },
  {
    name: 'update_post',
    description: 'Edit the text content of an existing post.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the post.' },
        content: { type: 'string', description: 'New text content (max 280 chars).' },
      },
      required: ['id', 'content'],
    },
  },
  {
    name: 'delete_post',
    description: 'Permanently remove a post from the queue.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'UUID of the post.' } },
      required: ['id'],
    },
  },
  {
    name: 'set_status',
    description: 'Set the status of a single post (pause or resume one post).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['queued', 'paused', 'failed'] },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'pause_all',
    description: 'Pause all queued posts (status queued -> paused).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'resume_all',
    description: 'Resume all paused posts (status paused -> queued).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_cadence',
    description: 'Evenly reschedule all queued posts to a new cadence from a start time.',
    input_schema: {
      type: 'object',
      properties: {
        start_from: { type: 'string', description: 'ISO 8601 datetime (UTC) to start.' },
        interval_hours: { type: 'number', description: 'Hours between posts (24 = daily).' },
      },
      required: ['start_from', 'interval_hours'],
    },
  },
]

// ── Tool executor — every query is scoped to the authenticated user ─────────────

async function executeTool(name, input, userId) {
  switch (name) {
    case 'list_queue': {
      let q = admin.from('posts').select('*').eq('user_id', userId).order('scheduled_for', { ascending: true })
      if (input.status_filter && input.status_filter !== 'all') q = q.eq('status', input.status_filter)
      const { data, error } = await q
      return error ? { error: error.message } : { posts: data }
    }

    case 'list_linkedin_posts': {
      // Only this user's tracked accounts' posts.
      const { data: accounts } = await admin
        .from('linkedin_accounts').select('id').eq('user_id', userId)
      const ids = (accounts || []).map(a => a.id)
      if (!ids.length) return { posts: [], note: 'No LinkedIn accounts connected yet.' }
      const { data, error } = await admin
        .from('linkedin_posts')
        .select('content, likes, comments, reposts, posted_at, posted_ago, author_name, post_url')
        .in('account_id', ids)
        .order('posted_at', { ascending: false })
        .limit(input.limit || 10)
      return error ? { error: error.message } : { posts: data }
    }

    case 'reschedule_post': {
      const { data, error } = await admin.from('posts')
        .update({ scheduled_for: input.scheduled_for }).eq('id', input.id).eq('user_id', userId)
        .select().single()
      return error ? { error: error.message } : { updated: data }
    }

    case 'update_post': {
      const { data, error } = await admin.from('posts')
        .update({ content: input.content }).eq('id', input.id).eq('user_id', userId)
        .select().single()
      return error ? { error: error.message } : { updated: data }
    }

    case 'delete_post': {
      const { error } = await admin.from('posts').delete().eq('id', input.id).eq('user_id', userId)
      return error ? { error: error.message } : { deleted: true }
    }

    case 'set_status': {
      const { data, error } = await admin.from('posts')
        .update({ status: input.status }).eq('id', input.id).eq('user_id', userId)
        .select().single()
      return error ? { error: error.message } : { updated: data }
    }

    case 'pause_all': {
      const { data, error } = await admin.from('posts')
        .update({ status: 'paused' }).eq('user_id', userId).eq('status', 'queued').select()
      return error ? { error: error.message } : { paused_count: data.length }
    }

    case 'resume_all': {
      const { data, error } = await admin.from('posts')
        .update({ status: 'queued' }).eq('user_id', userId).eq('status', 'paused').select()
      return error ? { error: error.message } : { resumed_count: data.length }
    }

    case 'set_cadence': {
      const { data: posts, error } = await admin.from('posts')
        .select('id').eq('user_id', userId).eq('status', 'queued').order('scheduled_for', { ascending: true })
      if (error) return { error: error.message }
      if (!posts.length) return { message: 'No queued posts to reschedule.' }
      const startMs = new Date(input.start_from).getTime()
      const stepMs  = input.interval_hours * 3600 * 1000
      for (let i = 0; i < posts.length; i++) {
        await admin.from('posts')
          .update({ scheduled_for: new Date(startMs + i * stepMs).toISOString() })
          .eq('id', posts[i].id)
      }
      return { rescheduled_count: posts.length }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req) {
  try {
    const user = await getUser(req)
    if (!user) return Response.json({ reply: 'Please sign in first.' }, { status: 401 })

    const { messages } = await req.json()

    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles', dateStyle: 'full', timeStyle: 'short',
    })

    const fb = await recentFeedback(user.id)
    const { data: conns } = await admin.from('x_connections').select('username').eq('user_id', user.id)
    const accountsLine = conns?.length
      ? `The user has ${conns.length} connected X account(s): ${conns.map(c => '@' + c.username).join(', ')}.`
      : 'The user has not connected an X account yet.'

    const system = `You are Cadence, a personal assistant for managing a user's X (Twitter) post queue. You write and repurpose posts, and you schedule, reschedule, pause, resume, and edit queued posts.

Current date and time (America/Los_Angeles): ${now}
${accountsLine}

Whenever you write or rewrite a post, follow this rubric:
${X_RUBRIC}${feedbackBlock(fb)}

CRITICAL RULE — you never queue or publish a NEW post yourself. To create ANY new post, you call propose_post, which shows the user an editable draft card (text editor + time picker + live countdown + 👍/👎 + Post-now/Schedule/Discard). The user — not you — decides whether it gets scheduled or posted. This applies even when the user says "post this now" or "schedule it": still call propose_post (you can mention you've set it up to post now / for a time, and they just confirm on the card).

More rules:
- For "write/draft/make a tweet", "repurpose my LinkedIn post", "post about X", etc. → call propose_post with the full tweet text. Then reply in one short line, e.g. "Here's a draft — edit it and approve below."
- Set want_image:true + a vivid image_prompt ONLY when the user wants a visual/picture/image on the post.
- To repurpose LinkedIn content: call list_linkedin_posts, pick the relevant one, rewrite it as a tweet (<=280 chars) unless asked to keep verbatim, then propose_post.
- The queue-management tools (reschedule, update, delete, set_status, pause/resume, set_cadence) act on posts the user already approved — those you may call directly when asked.
- "tomorrow at noon" resolves relative to the current LA time above. Show times in Pacific (PT).
- Be concise. If a tool errors, say plainly what went wrong.`

    let convo = messages.map(m => ({ role: m.role, content: m.content }))
    let reply = ''
    let proposal = null   // set when the model proposes a draft-with-image

    while (true) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        tools,
        messages: convo,
      })

      if (response.stop_reason === 'tool_use') {
        convo.push({ role: 'assistant', content: response.content })
        const toolResults = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          let result
          if (block.name === 'propose_post') {
            // Stash the proposal for the UI; never queue or publish here.
            proposal = { content: block.input.content }
            if (block.input.want_image) {
              const img = await generateImage(block.input.image_prompt || block.input.content, { fromContent: !block.input.image_prompt })
              proposal.image_url = img.url
              proposal.image_prompt = img.prompt
            }
            result = { ok: true, note: 'Draft proposed to the user for inline review — the user will edit/schedule/post or discard it.' }
          } else {
            result = await executeTool(block.name, block.input, user.id)
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
        }
        convo.push({ role: 'user', content: toolResults })
        continue
      }

      const textBlock = response.content.find(b => b.type === 'text')
      reply = textBlock?.text || 'Done.'
      break
    }

    return Response.json({ reply, proposal })
  } catch (err) {
    console.error('[chat]', err)
    return Response.json({ reply: `Error: ${err.message}` }, { status: 500 })
  }
}
