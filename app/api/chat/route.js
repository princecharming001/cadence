import Anthropic from '@anthropic-ai/sdk'
import { admin, getUser } from '@/lib/supabase'
import { generateImage, persistImage } from '@/lib/images'
import { X_RUBRIC, CHAT_STYLE } from '@/lib/rubric'
import { recentFeedback, feedbackBlock } from '@/lib/feedback'
import { voiceBlock, enforceLen } from '@/lib/prompts'
import { generateSlideshow } from '@/lib/slideshow'
import { createPost, zernioEnabled } from '@/lib/zernio'
import { runSocialEngagement, SOCIAL_ENGAGEMENT_PLATFORMS } from '@/lib/social-engagement'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const runtime = 'nodejs'
export const maxDuration = 120 // slideshow generation can render several slides

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
  {
    name: 'get_overview',
    description: "Snapshot of the user's whole setup across platforms: connected social accounts (Instagram/TikTok/LinkedIn/X), queue counts, campaigns, and which platforms have auto-replies on. Call when the user asks what's going on or before a cross-platform action.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'generate_slideshow',
    description: 'Generate an AI Instagram/TikTok carousel ("slideshow") on a topic and save it as a draft. Optionally schedule or post it to connected Instagram/TikTok/LinkedIn accounts. Returns the rendered slide image URLs + caption. Use this whenever the user wants a carousel, slideshow, IG post, or TikTok photo post.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        format: { type: 'string', enum: ['listicle', 'howto', 'story', 'myths', 'framework', 'quotes'] },
        style: { type: 'string', enum: ['bold', 'minimal', 'editorial', 'gradient', 'mint', 'photo'] },
        slides: { type: 'integer', description: '3-10' },
        post_to: { type: 'array', items: { type: 'string' }, description: 'Account usernames or platform names to publish to. Omit to just save a draft.' },
        when: { type: 'string', description: 'ISO datetime to schedule; "now" or omit to post immediately (only when post_to is set).' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'set_replies',
    description: 'Turn auto-replies (comment engagement in the user\'s voice) on or off for Instagram, TikTok, or LinkedIn. auto_post:true posts replies automatically; false drafts them for review.',
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: SOCIAL_ENGAGEMENT_PLATFORMS },
        enabled: { type: 'boolean' },
        auto_post: { type: 'boolean' },
      },
      required: ['platform', 'enabled'],
    },
  },
  {
    name: 'run_replies',
    description: 'Run the comment auto-reply engine right now for a platform (reads new comments on the user\'s posts, drafts or posts replies in their voice).',
    input_schema: { type: 'object', properties: { platform: { type: 'string', enum: SOCIAL_ENGAGEMENT_PLATFORMS } }, required: ['platform'] },
  },
]

// ── Tool executor — every query is scoped to the authenticated user ─────────────

async function executeTool(name, input, userId) {
  switch (name) {
    case 'list_queue': {
      // Only the columns the model needs, capped + truncated — selecting '*'
      // dumped the entire posts table into context on every hop.
      let q = admin.from('posts')
        .select('id, content, scheduled_for, status, platform')
        .eq('user_id', userId).order('scheduled_for', { ascending: true }).limit(50)
      if (input.status_filter && input.status_filter !== 'all') q = q.eq('status', input.status_filter)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { posts: (data || []).map(p => ({ ...p, content: (p.content || '').slice(0, 140) })) }
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

    case 'get_overview': {
      const [{ data: accts }, { data: posts }, { data: camps }, { data: bcamps }, { data: eng }] = await Promise.all([
        admin.from('social_accounts').select('platform,username').eq('user_id', userId),
        admin.from('posts').select('status').eq('user_id', userId),
        admin.from('campaigns').select('name,active').eq('user_id', userId),
        admin.from('brand_campaigns').select('name,active').eq('user_id', userId),
        admin.from('social_engagement').select('platform,enabled,auto_post').eq('user_id', userId),
      ])
      const counts = (posts || []).reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a }, {})
      return {
        social_accounts: (accts || []).map(a => `${a.platform}:@${a.username}`),
        queue: counts,
        campaigns: [...(camps || []), ...(bcamps || [])].map(c => `${c.name}${c.active ? ' (active)' : ''}`),
        auto_replies_on: (eng || []).filter(e => e.enabled).map(e => `${e.platform}${e.auto_post ? ' (auto-post)' : ' (review)'}`),
        publishing_connected: zernioEnabled(),
      }
    }

    case 'generate_slideshow': {
      if (!input.topic) return { error: 'topic required' }
      const { data: persona } = await admin.from('personas').select('*').eq('user_id', userId).single()
      const deck = await generateSlideshow({ topic: input.topic, format: input.format || 'listicle', style: input.style || 'bold', slides: input.slides || 6, persona, userId })
      const row = { user_id: userId, topic: input.topic, format: deck.format, style: deck.style, slides: deck.slides, caption: deck.caption, image_urls: deck.imageUrls, status: 'draft' }
      let result = 'saved as a draft in the Slideshows tab'
      if (input.post_to?.length) {
        if (!zernioEnabled()) result = 'saved as draft (publishing not connected)'
        else {
          const { data: all } = await admin.from('social_accounts').select('*').eq('user_id', userId)
          const want = input.post_to.map(s => String(s).toLowerCase().replace('@', ''))
          const accts = (all || []).filter(a => want.includes(a.platform) || want.includes((a.username || '').toLowerCase()))
          if (!accts.length) result = 'saved as draft (no matching connected account)'
          else {
            try {
              const sched = input.when && input.when !== 'now' ? new Date(input.when).toISOString() : undefined
              const r = await createPost({ userId, accounts: accts, content: deck.caption, mediaUrls: deck.imageUrls, scheduledFor: sched, title: deck.slides?.[0]?.heading || input.topic })
              row.status = sched ? 'scheduled' : 'posted'; row.account_ids = accts.map(a => a.id); row.scheduled_for = sched || null; row.zernio_post_id = r.id
              result = `${row.status} to ${accts.map(a => '@' + a.username).join(', ')}`
            } catch (e) { row.status = 'failed'; row.error = e.message; result = `post failed: ${e.message}` }
          }
        }
      }
      await admin.from('slideshows').insert(row)
      return { slides: deck.imageUrls.length, image_urls: deck.imageUrls, caption: deck.caption, result }
    }

    case 'set_replies': {
      if (!SOCIAL_ENGAGEMENT_PLATFORMS.includes(input.platform)) return { error: 'platform must be instagram, tiktok, or linkedin' }
      const patch = { enabled: !!input.enabled }
      if ('auto_post' in input) patch.auto_post = !!input.auto_post
      await admin.from('social_engagement').upsert({ user_id: userId, platform: input.platform, ...patch }, { onConflict: 'user_id,platform' })
      return { platform: input.platform, ...patch }
    }

    case 'run_replies': {
      if (!zernioEnabled()) return { error: 'Publishing/inbox not connected (Zernio).' }
      return await runSocialEngagement(userId, input.platform)
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

    const { messages, platform: rawPlatform, platforms: rawPlatforms } = await req.json()
    // Optional platform scope from the chat UI. The agent is locked to the chosen
    // platform(s) (e.g. on the LinkedIn tab → only LinkedIn; or X + Instagram).
    const SCOPES = ['x', 'linkedin', 'instagram', 'tiktok']
    const scopeList = [...new Set([
      ...(Array.isArray(rawPlatforms) ? rawPlatforms : []),
      ...(rawPlatform ? [rawPlatform] : []),
    ].filter(p => SCOPES.includes(p)))]
    const scope = scopeList.length ? scopeList : null
    // The conversation comes from the client — validate the shape so nobody can
    // stuff fake tool results or unbounded payloads into the agent's context.
    if (!Array.isArray(messages) || messages.length > 60) {
      return Response.json({ reply: 'Conversation too long — start a fresh chat.' }, { status: 400 })
    }
    const safeMessages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))
    if (!safeMessages.length) return Response.json({ reply: 'Say something first.' }, { status: 400 })

    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles', dateStyle: 'full', timeStyle: 'short',
    })

    const [fb, { data: personaRow }] = await Promise.all([
      recentFeedback(user.id),
      admin.from('personas').select('*').eq('user_id', user.id).single(),
    ])
    const { data: conns } = await admin.from('x_connections').select('username').eq('user_id', user.id)
    const accountsLine = conns?.length
      ? `The user has ${conns.length} connected X account(s): ${conns.map(c => '@' + c.username).join(', ')}.`
      : 'The user has not connected an X account yet.'

    const SCOPE_LABEL = { x: 'X (Twitter)', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' }
    const scopeNames = scope ? scope.map(s => SCOPE_LABEL[s]).join(' and ') : ''
    const single = scope && scope.length === 1
    const liScoped = single && scope[0] === 'linkedin'
    const scopeBlock = scope ? `
PLATFORM FOCUS — this conversation is scoped to ${scopeNames} ONLY. The user is working on their ${scopeNames} account${single ? '' : 's'}.
- Everything you draft, suggest, schedule, or act on is for ${scopeNames} and the user's own personal/primary account${single ? '' : 's'} there.
- Do NOT bring up, draft for, or take actions on any platform outside that set.${(scope.includes('x') || scope.includes('linkedin')) ? ' Use propose_post for X/LinkedIn posts.' : ''}${(scope.includes('instagram') || scope.includes('tiktok')) ? ' Use generate_slideshow for Instagram/TikTok carousels.' : ''}
${liScoped ? '- propose_post drafts here are LINKEDIN posts: long-form is welcome (up to 1300 chars), no 280 limit.' : ''}
- If the user clearly asks for something on a platform outside this focus, tell them to add that platform in the chat's Focus selector first.
` : ''

    // Split for prompt caching: the big stable block is cacheable ACROSS
    // requests; everything volatile (clock, accounts, scope, feedback) goes in
    // a second uncached block so it can't bust the cache.
    const staticSystem = `You are Cadence — an agent that runs a user's entire social presence under ONE consistent voice across X, LinkedIn, Instagram, and TikTok, including AI carousels and feeder-account campaigns that promote their brand. You can actually DO things with tools; be decisive and take the action rather than describing it.

${voiceBlock(personaRow)}

Cross-platform powers (use the tools, don't just explain):
- get_overview: report connected accounts, queue, campaigns, and auto-reply status across all platforms.
- generate_slideshow: make an Instagram/TikTok carousel on a topic; optionally schedule/post it (post_to + when). Use for any "carousel/slideshow/IG/TikTok post" request.
- set_replies / run_replies: turn on or off (and run) auto-replies to comments in the user's voice for instagram, tiktok, or linkedin.
After any action, confirm what happened in one or two sentences. Never invent results — only report what tools returned.

${CHAT_STYLE}

Whenever you write or rewrite a post, follow this rubric:
${X_RUBRIC}

CRITICAL RULE — you never queue or publish a NEW post yourself. To create ANY new post, you call propose_post, which shows the user an editable draft card (text editor + time picker + live countdown + 👍/👎 + Post-now/Schedule/Discard). The user — not you — decides whether it gets scheduled or posted. This applies even when the user says "post this now" or "schedule it": still call propose_post (you can mention you've set it up to post now / for a time, and they just confirm on the card).

More rules:
- For "write/draft/make a tweet", "repurpose my LinkedIn post", "post about X", etc. → call propose_post with the full post text. Then reply in one short line, e.g. "Here's a draft — edit it and approve below."
- Set want_image:true + a vivid image_prompt ONLY when the user wants a visual/picture/image on the post.
- To repurpose LinkedIn content: call list_linkedin_posts, pick the relevant one, rewrite it for the target platform, then propose_post.
- The queue-management tools (reschedule, update, delete, set_status, pause/resume, set_cadence) act on posts the user already approved — those you may call directly when asked.
- Relative times like "tomorrow at noon" resolve against the current LA time given below. Show times in Pacific (PT).
- Be concise. If a tool errors, say plainly what went wrong.`

    const dynamicSystem = `Current date and time (America/Los_Angeles): ${now}
${accountsLine}
${scopeBlock}${feedbackBlock(fb)}`

    let convo = safeMessages
    let reply = ''
    let proposal = null   // set when the model proposes a draft-with-image

    // Hard cap on agent hops — an unbounded loop is an unbounded token bill.
    // Block 1 (static) is cached across hops AND across requests; block 2
    // carries the volatile context and never busts the cache.
    const systemBlocks = [
      { type: 'text', text: staticSystem, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicSystem },
    ]

    for (let hop = 0; hop < 8; hop++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemBlocks,
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
            // Platform follows the chat's scope (LinkedIn focus → LinkedIn post,
            // 1300-char cap); the length limit is enforced server-side.
            const propPlatform = liScoped ? 'linkedin' : 'x'
            proposal = { content: await enforceLen(String(block.input.content || ''), propPlatform), platform: propPlatform }
            if (block.input.want_image) {
              // Explicit image_prompt = the model/user knows what they want.
              // Otherwise the planner decides personal vs illustrative and
              // grounds the prompt in the post (skips degrade to illustrative
              // here — the user asked for an image).
              let img = block.input.image_prompt
                ? await generateImage(block.input.image_prompt, {})
                : await generateImage(block.input.content, { auto: true, userId: user.id })
              if (img.skipped) img = await generateImage(block.input.content, { fromContent: true })
              proposal.image_url = await persistImage(img.url, user.id) // survive until publish
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
    if (!reply) reply = 'I hit my action limit for one message — tell me to continue.'

    return Response.json({ reply, proposal })
  } catch (err) {
    console.error('[chat]', err)
    return Response.json({ reply: 'Something went wrong on my end — try that again.' }, { status: 500 })
  }
}
