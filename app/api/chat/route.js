import Anthropic from '@anthropic-ai/sdk'
import { admin, getUser } from '@/lib/supabase'
import { generateImage, persistImage } from '@/lib/images'
import { X_RUBRIC, CHAT_STYLE } from '@/lib/rubric'
import { recentFeedback, feedbackBlock } from '@/lib/feedback'
import { voiceBlock, enforceLen, LINKEDIN_RUBRIC } from '@/lib/prompts'
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
    description: 'Propose a post to the user as an editable draft card in the chat. This is the ONLY way to create a new post — use it whenever the user wants to write, draft, repurpose, or "post" something (whether they say schedule it, post it now, or just "write a tweet about X"). It does NOT queue or publish anything: it shows the user an editable text editor with their post, a time picker, a live countdown, 👍/👎, and Post-now / Schedule / Discard buttons. The USER decides what happens to it. Always write the full post text yourself. If the user asks for SEVERAL posts ("write 3 posts", "give me some options"), call propose_post once PER post in the same turn — each call becomes its own editable card. Set want_image:true (and a vivid image_prompt) only if the user wants an image / a visual / a picture on the post. When repurposing a LinkedIn post, rewrite it to fit the target platform unless asked to keep it verbatim. After calling this, keep your text reply to one short line like "Here\'s a draft — edit it and approve below."',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The full post text (X <=280 chars; LinkedIn 600-1200 chars, line breaks between short paragraphs).' },
        platform: { type: 'string', enum: ['x', 'linkedin'], description: 'Where this post is for. X and LinkedIn are DIFFERENT writing disciplines — follow the matching rubric. Default x.' },
        want_image: { type: 'boolean', description: 'True if this post should have an AI-generated image.' },
        image_prompt: { type: 'string', description: 'If want_image, a vivid visual description (subject, style, mood, colors). No text in the image.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'propose_thread',
    description: 'Propose an X THREAD (2-8 connected tweets) as an editable draft card in the chat. Use whenever the user wants a thread, or asks to "turn this into a thread" — break ONE idea into sequential tweets: a hook tweet that earns the read, development tweets that each carry one point, and a closer with the payoff. Each part <=280 chars, numbered naturally only if it fits the voice. Like propose_post, the USER approves it from the card; nothing is queued by this call.',
    input_schema: {
      type: 'object',
      properties: {
        posts: { type: 'array', items: { type: 'string' }, description: 'The thread parts in order (2-8 items, each a complete tweet <=280 chars).' },
      },
      required: ['posts'],
    },
  },
  {
    name: 'ingest_url',
    description: 'Fetch a URL (article, blog post, LinkedIn post, YouTube page) and return its readable text + title, so you can repurpose existing content into posts. Use when the user pastes a link and wants posts made from it. After ingesting, draft via propose_post or propose_thread.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The http(s) URL to read.' } },
      required: ['url'],
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
    description: 'Generate an AI Instagram/TikTok carousel ("slideshow") on a topic and save it as a draft. Returns the rendered slide image URLs + caption. Use this whenever the user wants a carousel, slideshow, IG post, or TikTok photo post. IMPORTANT: only set post_to (publish/schedule) when the user EXPLICITLY said to publish it in this conversation — otherwise omit post_to so it saves as a draft they approve first.',
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
  {
    name: 'list_agents',
    description: 'List the user\'s feeder agents (autonomous personas living on their other accounts): id, name, platform, handle, active, autonomous, campaign. Use before managing agents or feeder campaigns.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_feeder_campaign',
    description: 'Create a feeder-agent campaign — a promotion MISSION the agents weave into their own posting in their own voices. Goes live immediately and (by default) every unassigned agent joins it. Use when the user says "launch a feeder campaign", "have my agents promote X", etc.',
    input_schema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'What the agents promote, e.g. "cherries".' },
        link: { type: 'string', description: 'Optional link to weave in.' },
        intensity: { type: 'string', enum: ['subtle', 'balanced', 'loud'], description: 'How often it shows up in their posting (default balanced).' },
        assign_all: { type: 'boolean', description: 'Assign every unassigned agent (default true). Set false to create empty and assign manually with set_agent.' },
      },
      required: ['product'],
    },
  },
  {
    name: 'set_agent',
    description: 'Update a feeder agent: activate/pause (active), let it post autonomously vs draft-for-review (auto_post), or put it on / pull it off a campaign (campaign_id; null unassigns).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        active: { type: 'boolean' },
        auto_post: { type: 'boolean' },
        campaign_id: { type: ['string', 'null'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'run_agent',
    description: 'Run a feeder agent\'s think-post cycle right now. Output lands as drafts (or queued when the agent is autonomous).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'create_promo_campaign',
    description: 'Create a recurring promo campaign on the user\'s OWN accounts (primary X / their LinkedIn / Instagram / TikTok): a topic posted on a cadence in THEIR voice. Different from feeder campaigns (those run on agent accounts).',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What to promote, written like a brief.' },
        platforms: { type: 'array', items: { type: 'string', enum: ['x', 'linkedin', 'instagram', 'tiktok'] } },
        interval_hours: { type: 'number', description: 'Hours between posts (default 24).' },
      },
      required: ['topic', 'platforms'],
    },
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

    case 'ingest_url': {
      // SSRF-guarded fetch → readable text. Enough for articles, LinkedIn
      // public posts, and YouTube titles/descriptions.
      let u
      try { u = new URL(String(input.url)) } catch { return { error: 'Not a valid URL.' } }
      if (!/^https?:$/.test(u.protocol)) return { error: 'Only http(s) URLs.' }
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\])/.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) {
        return { error: 'That host is not reachable.' }
      }
      try {
        const res = await fetch(u.toString(), {
          redirect: 'follow', signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CadenceBot/1.0)', Accept: 'text/html,application/xhtml+xml' },
        })
        const html = (await res.text()).slice(0, 400000)
        const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim()
        const desc = (html.match(/<meta[^>]+(?:name="description"|property="og:description")[^>]+content="([^"]*)"/i)?.[1] || '').trim()
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
          .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
        if (!text && !title) return { error: 'Could not read that page.' }
        return { title, description: desc, text: text.slice(0, 6000), note: 'Repurpose into the user\'s voice — never copy verbatim.' }
      } catch (e) { return { error: `Fetch failed: ${String(e.message || '').slice(0, 120)}` } }
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

    case 'list_agents': {
      const [{ data: agents }, { data: xs }, { data: ss }, { data: camps }] = await Promise.all([
        admin.from('feeder_agents').select('id, name, platform, active, auto_post, campaign_id, x_connection_id, social_account_id, persona').eq('user_id', userId),
        admin.from('x_connections').select('id, username').eq('user_id', userId),
        admin.from('social_accounts').select('id, username').eq('user_id', userId),
        admin.from('agent_campaigns').select('id, name').eq('user_id', userId),
      ])
      return {
        agents: (agents || []).map(a => ({
          id: a.id, name: a.persona?.name || a.name, platform: a.platform || 'x',
          handle: a.x_connection_id ? (xs || []).find(c => c.id === a.x_connection_id)?.username : (ss || []).find(s => s.id === a.social_account_id)?.username,
          active: !!a.active, autonomous: !!a.auto_post,
          campaign: a.campaign_id ? (camps || []).find(c => c.id === a.campaign_id)?.name || a.campaign_id : null,
        })),
      }
    }

    case 'create_feeder_campaign': {
      const product = String(input.product || '').slice(0, 300).trim()
      if (!product) return { error: 'Say what the agents should promote.' }
      const name = product.length > 42 ? product.slice(0, 42).trimEnd() + '…' : product
      const { data: camp, error } = await admin.from('agent_campaigns').insert({
        user_id: userId, name, product,
        link: String(input.link || '').slice(0, 300).trim() || null,
        intensity: ['subtle', 'balanced', 'loud'].includes(input.intensity) ? input.intensity : 'balanced',
        active: true,
      }).select().single()
      if (error) return { error: error.message }
      let assigned = []
      if (input.assign_all !== false) {
        const { data: free } = await admin.from('feeder_agents').select('id, name, persona').eq('user_id', userId).is('campaign_id', null)
        for (const a of free || []) {
          await admin.from('feeder_agents').update({ campaign_id: camp.id }).eq('id', a.id)
          assigned.push(a.persona?.name || a.name)
        }
      }
      return { campaign: { id: camp.id, name: camp.name, intensity: camp.intensity }, agents_assigned: assigned, note: 'Live — agents weave it into their next cycles. They appear on the Campaigns tab.' }
    }

    case 'set_agent': {
      const patch = {}
      if (input.active !== undefined) patch.active = !!input.active
      if (input.auto_post !== undefined) patch.auto_post = !!input.auto_post
      if (input.campaign_id !== undefined) {
        if (input.campaign_id) {
          const { data: camp } = await admin.from('agent_campaigns').select('id').eq('id', input.campaign_id).eq('user_id', userId).single()
          if (!camp) return { error: 'Campaign not found.' }
        }
        patch.campaign_id = input.campaign_id || null
      }
      if (patch.active === true) patch.next_run_at = new Date().toISOString()
      const { data, error } = await admin.from('feeder_agents').update(patch)
        .eq('id', input.id).eq('user_id', userId).select('id, name, persona, active, auto_post, campaign_id').single()
      if (error || !data) return { error: error?.message || 'Agent not found.' }
      return { agent: { id: data.id, name: data.persona?.name || data.name, active: data.active, autonomous: data.auto_post, campaign_id: data.campaign_id } }
    }

    case 'run_agent': {
      const { runFeederAgentById } = await import('@/lib/feeder-agents')
      return await runFeederAgentById(input.id, userId)
    }

    case 'create_promo_campaign': {
      const topic = String(input.topic || '').slice(0, 300).trim()
      const platforms = (Array.isArray(input.platforms) ? input.platforms : []).filter(p => ['x', 'linkedin', 'instagram', 'tiktok'].includes(p))
      if (!topic || !platforms.length) return { error: 'Need a topic and at least one platform.' }
      // Build targets exactly like the campaign UI: primary X connection for X,
      // the user's first connected account per social platform.
      const targets = [], missing = []
      for (const p of platforms) {
        if (p === 'x') {
          const { data: conn } = await admin.from('x_connections').select('id').eq('user_id', userId).order('is_primary', { ascending: false }).limit(1).single()
          if (conn) targets.push({ kind: 'x', id: conn.id, platform: 'x' }); else missing.push('x')
        } else {
          const { data: acct } = await admin.from('social_accounts').select('id').eq('user_id', userId).eq('platform', p).limit(1).single()
          if (acct) targets.push({ kind: 'social', id: acct.id, platform: p }); else missing.push(p)
        }
      }
      if (!targets.length) return { error: `No connected account for ${missing.join(', ')} — connect one first.` }
      const name = topic.length > 42 ? topic.slice(0, 42).trimEnd() + '…' : topic
      const { data, error } = await admin.from('brand_campaigns').insert({
        user_id: userId, name, topic, targets,
        carousel_style: 'bold', carousel_format: 'listicle', include_image: false,
        interval_hours: Math.min(Math.max(Number(input.interval_hours) || 24, 1), 168),
        active: true, next_run_at: new Date().toISOString(),
      }).select().single()
      if (error) return { error: error.message }
      return { campaign: { id: data.id, name: data.name, every_hours: data.interval_hours, platforms: targets.map(t => t.platform) }, ...(missing.length ? { skipped_platforms: missing } : {}), note: 'Live — first run is moments away; posts land in the queue.' }
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

    // Ground LinkedIn drafts in how the user ACTUALLY writes there — their own
    // scraped posts are the register reference (mentors are inspiration, not voice).
    let liVoiceBlock = ''
    if (!scope || scope.includes('linkedin')) {
      const { data: ownAccts } = await admin.from('linkedin_accounts').select('id')
        .eq('user_id', user.id).or('is_mentor.eq.false,is_mentor.is.null')
      const ids = (ownAccts || []).map(a => a.id)
      if (ids.length) {
        const { data: liPosts } = await admin.from('linkedin_posts').select('content')
          .in('account_id', ids).order('posted_at', { ascending: false }).limit(3)
        if (liPosts?.length) {
          liVoiceBlock = `\nHOW THEY ACTUALLY WRITE ON LINKEDIN (their real recent posts — match this register, structure, and rhythm in LinkedIn drafts; never copy them):\n${liPosts.map((p, i) => `[${i + 1}] ${String(p.content || '').replace(/\s+/g, ' ').trim().slice(0, 420)}`).join('\n')}`
        }
      }
    }

    const SCOPE_LABEL = { x: 'X (Twitter)', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' }
    const scopeNames = scope ? scope.map(s => SCOPE_LABEL[s]).join(' and ') : ''
    const single = scope && scope.length === 1
    const liScoped = single && scope[0] === 'linkedin'
    const scopeBlock = scope ? `
PLATFORM FOCUS — the user is currently working on ${scopeNames}. Focus is a DEFAULT, not a wall:
- When they ask for content without naming a platform, write it for ${scopeNames} (its format, length, and register).${liScoped ? ' LinkedIn drafts are long-form (up to 1300 chars), no 280 limit.' : ''}
- You keep FULL access to every tool and all cross-platform context — read the queue, LinkedIn corpus, overview, agents, campaigns from ANY platform whenever it helps.
- If the user explicitly asks for another platform or a cross-platform action (a feeder campaign, an X thread while focused on Instagram, anything), JUST DO IT. Never refuse because of focus and never tell them to change the Focus selector.
` : ''

    // Split for prompt caching: the big stable block is cacheable ACROSS
    // requests; everything volatile (clock, accounts, scope, feedback) goes in
    // a second uncached block so it can't bust the cache.
    const staticSystem = `You are Cadence — an agent that runs a user's entire social presence under ONE consistent voice across X, LinkedIn, Instagram, and TikTok, including AI carousels and feeder-account campaigns that promote their brand. You can actually DO things with tools; be decisive and take the action rather than describing it.

${voiceBlock(personaRow)}

Cross-platform powers (use the tools, don't just explain — the ENTIRE product is drivable from this chat):
- get_overview: report connected accounts, queue, campaigns, and auto-reply status across all platforms.
- generate_slideshow: make an Instagram/TikTok carousel on a topic; optionally schedule/post it (post_to + when). Use for any "carousel/slideshow/IG/TikTok post" request.
- set_replies / run_replies: turn on or off (and run) auto-replies to comments in the user's voice for instagram, tiktok, or linkedin.
- list_agents / set_agent / run_agent: see and manage the user's feeder agents (autonomous personas on their other accounts) — activate, pause, make autonomous, assign to campaigns, run a cycle now.
- create_feeder_campaign: launch a promotion mission the agents weave into their own posting ("launch a feeder campaign promoting X").
- create_promo_campaign: a recurring promo on the user's OWN accounts (their voice, their primary accounts, on a cadence).
After any action, confirm what happened in one or two sentences. Never invent results — only report what tools returned.

${CHAT_STYLE}

You write for TWO platforms with DIFFERENT disciplines. Pick the rubric by the post's target platform (propose_post's platform field) — an X post is a compressed punch, a LinkedIn post is a developed 60-second read. NEVER write a LinkedIn post like a tweet or vice versa.

For X posts:
${X_RUBRIC}

For LinkedIn posts:
${LINKEDIN_RUBRIC}

CRITICAL RULE — you never queue or publish a NEW post yourself. To create ANY new post, you call propose_post, which shows the user an editable draft card (text editor + time picker + live countdown + 👍/👎 + Post-now/Schedule/Discard). The user — not you — decides whether it gets scheduled or posted. This applies even when the user says "post this now" or "schedule it": still call propose_post (you can mention you've set it up to post now / for a time, and they just confirm on the card). The same consent rule covers EVERY platform: nothing goes live on X, LinkedIn, Instagram, or TikTok unless the user explicitly approved that exact content — never pass post_to to generate_slideshow unless the user clearly told you to publish it.

CRITICAL RULE — when asked to write, DRAFT IMMEDIATELY. Never reply with a clarifying question like "what should it be about?" or "what's the topic?". If the user doesn't give a topic, pick the strongest one yourself from their voice profile, niche, recent posts, or LinkedIn content (call list_linkedin_posts or get_overview if you need material) and call propose_post in your FIRST response. They'll edit the draft or tell you to change direction — a concrete draft is always more useful than a question. Ask a question only when the request is literally impossible to act on.

More rules:
- For "write/draft/make a tweet", "repurpose my LinkedIn post", "post about X", etc. → call propose_post with the full post text. Then reply in one short line, e.g. "Here's a draft — edit it and approve below."
- Asked for N posts or "a few options"? Call propose_post N times in the same turn — every draft must arrive as its own editable card, never as plain text in your reply.
- For "make a thread" / "turn this into a thread" → propose_thread with 2-8 parts: hook tweet, one point per tweet, closer with the payoff.
- When the user pastes a link to repurpose → ingest_url first, then draft from what it returns in THEIR voice (never copy the source verbatim).
- Set want_image:true + a vivid image_prompt ONLY when the user wants a visual/picture/image on the post.
- To repurpose LinkedIn content: call list_linkedin_posts, pick the relevant one, rewrite it for the target platform, then propose_post.
- The queue-management tools (reschedule, update, delete, set_status, pause/resume, set_cadence) act on posts the user already approved — those you may call directly when asked.
- Relative times like "tomorrow at noon" resolve against the current LA time given below. Show times in Pacific (PT).
- Be concise. If a tool errors, say plainly what went wrong.`

    const dynamicSystem = `Current date and time (America/Los_Angeles): ${now}
${accountsLine}
${scopeBlock}${liVoiceBlock}${feedbackBlock(fb)}`

    let convo = safeMessages
    let reply = ''
    const proposals = []  // every propose_post / propose_thread call becomes one editable card

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
          if (block.name === 'propose_thread') {
            const parts = (Array.isArray(block.input.posts) ? block.input.posts : [])
              .map(t => String(t || '').trim()).filter(Boolean).slice(0, 8)
            if (parts.length < 2) {
              result = { error: 'A thread needs 2-8 parts — call propose_thread again with the full parts array.' }
            } else {
              proposals.push({ thread: await Promise.all(parts.map(t => enforceLen(t, 'x'))), platform: 'x' })
              result = { ok: true, parts: parts.length, note: 'Thread proposed to the user for inline review — they will edit/schedule/post or discard it.' }
            }
          } else if (block.name === 'propose_post') {
            // Stash the proposal for the UI; never queue or publish here.
            // Platform: the model's declared platform always wins (focus is a
            // default, not a wall); undeclared falls back to the focus, then X.
            const propPlatform = block.input.platform === 'linkedin' ? 'linkedin'
              : block.input.platform === 'x' ? 'x'
              : liScoped ? 'linkedin' : 'x'
            const prop = { content: await enforceLen(String(block.input.content || ''), propPlatform), platform: propPlatform }
            if (block.input.want_image) {
              // Explicit image_prompt = the model/user knows what they want.
              // Otherwise the planner decides personal vs illustrative and
              // grounds the prompt in the post (skips degrade to illustrative
              // here — the user asked for an image).
              let img = block.input.image_prompt
                ? await generateImage(block.input.image_prompt, {})
                : await generateImage(block.input.content, { auto: true, userId: user.id })
              if (img.skipped) img = await generateImage(block.input.content, { fromContent: true })
              prop.image_url = await persistImage(img.url, user.id) // survive until publish
              prop.image_prompt = img.prompt
            }
            proposals.push(prop)
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

    // proposals = every draft card from this turn; proposal kept for compatibility.
    return Response.json({ reply, proposals, proposal: proposals[0] || null })
  } catch (err) {
    console.error('[chat]', err)
    return Response.json({ reply: 'Something went wrong on my end — try that again.' }, { status: 500 })
  }
}
