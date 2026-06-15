import Anthropic from '@anthropic-ai/sdk'
import { admin, getUser } from '@/lib/supabase'
import { generateImage, persistImage } from '@/lib/images'
import { X_RUBRIC, CHAT_STYLE } from '@/lib/rubric'
import { recentFeedback, feedbackBlock } from '@/lib/feedback'
import { voiceBlock, enforceLen, LINKEDIN_RUBRIC } from '@/lib/prompts'
import { generateSlideshow } from '@/lib/slideshow'
import { getBrandMemory } from '@/lib/brand-memory'
import { createPost, zernioEnabled } from '@/lib/zernio'
import { runSocialEngagement, SOCIAL_ENGAGEMENT_PLATFORMS } from '@/lib/social-engagement'
import { analyzeViralVideo, analyzeViralText, trendingBlock } from '@/lib/trends'
import { runTrendHarvest } from '@/lib/trends-harvest'
import { draftCampaignBrief, composeBrief } from '@/lib/campaign-brief'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Chat bubbles render as plain text — strip markdown the model sometimes adds
// (**bold**, ## headers, *-bullets) so it never shows as literal characters.
const cleanReply = s => String(s || '')
  .replace(/\*\*(.+?)\*\*/gs, '$1')
  .replace(/__(.+?)__/gs, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^[ \t]*[-*]\s+/gm, '· ')
  .trim()

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
    description: "List the user's scraped LinkedIn posts (their own or accounts they track). Use this to repurpose LinkedIn content into tweets. Returns content, engagement, posted date, source profile, AND post_url — a REAL LinkedIn permalink for each post. When you reference or list specific posts, CITE the source by linking post_url as a markdown link, e.g. [that 1.6k-like post](post_url). Never claim you can't link the source — post_url is the actual URL.",
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
    description: 'Generate an AI Instagram/TikTok/LinkedIn carousel ("slideshow") on a topic. The rendered slides + caption are shown INLINE in the chat for the user to preview, pick accounts, and schedule / post / save — you never publish it yourself. Use this whenever the user wants a carousel, slideshow, IG post, or TikTok photo post. Call it ONCE per request.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        format: { type: 'string', enum: ['listicle', 'howto', 'story', 'myths', 'framework', 'quotes'] },
        style: { type: 'string', enum: ['bold', 'minimal', 'editorial', 'gradient', 'mint', 'photo'] },
        slides: { type: 'integer', description: '3-10' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'make_clip',
    description: 'Turn a long video (a YouTube / TikTok / Instagram / .mp4 link) into short vertical clips with captions for Reels / TikTok. Rendering is asynchronous (a few minutes) — the finished clips land in the Clips tab to preview and post. Use when the user wants to clip a video, make Reels from a podcast/long-form, etc. Tell them it is rendering; do not claim it is ready.',
    input_schema: {
      type: 'object',
      properties: {
        source_url: { type: 'string', description: 'Direct link to the source video.' },
        source_name: { type: 'string' },
        edit_formats: { type: 'array', items: { type: 'string' }, description: 'Edit styles to render (e.g. captions, sludge, talking_head). Omit for captions.' },
        max_clips: { type: 'integer', description: '1-5 (default 3).' },
        target_len: { type: 'string', enum: ['short', 'medium'] },
      },
      required: ['source_url'],
    },
  },
  {
    name: 'set_replies',
    description: "Turn auto-replies (replying to comments on the user's OWN posts, in their voice) on or off for X, Instagram, TikTok, or LinkedIn. This is the 'Auto-reply' toggle on each platform tab. auto_post:true posts replies automatically; false drafts them for review.",
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['x', 'instagram', 'tiktok', 'linkedin'] },
        enabled: { type: 'boolean' },
        auto_post: { type: 'boolean' },
      },
      required: ['platform', 'enabled'],
    },
  },
  {
    name: 'set_autopilot',
    description: "Control Autopilot for X or LinkedIn — Cadence posting in the user's voice hands-free. This is the 'Autopilot' toggle on the X/LinkedIn tabs. Set enabled on/off, and optionally posts_per_day (1-3) and how often it runs.",
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['x', 'linkedin'] },
        enabled: { type: 'boolean' },
        posts_per_day: { type: 'integer', description: '1-3 posts each run-day.' },
        interval_hours: { type: 'number', description: 'Hours between autopilot runs (default 24).' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'set_niche_engagement',
    description: "Control 'Engage in your niche' on X — Cadence finds fresh posts matching keywords / from watched accounts and replies in the user's voice to get them in front of new audiences. This is X-only. Set enabled on/off and optionally the keywords, accounts to watch, replies_per_run, and auto_post (post vs draft).",
    input_schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Topics/terms to find posts about.' },
        accounts: { type: 'array', items: { type: 'string' }, description: 'X handles to watch (up to 3).' },
        replies_per_run: { type: 'integer', description: '1-5 replies per run.' },
        auto_post: { type: 'boolean', description: 'true = post replies; false = draft for review.' },
      },
      required: ['enabled'],
    },
  },
  {
    name: 'manage_campaign',
    description: "List or manage the user's own promo campaigns (recurring posts on their own X/LinkedIn/IG/TikTok — created by create_promo_campaign). action:'list' shows them; 'pause'/'resume'/'delete' need a campaign id. Use before pausing/resuming/deleting so you have the right id.",
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'pause', 'resume', 'delete'] },
        id: { type: 'string', description: 'Campaign id (required for pause/resume/delete).' },
      },
      required: ['action'],
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
    description: 'Create a feeder-agent campaign IMMEDIATELY with no review card (goes live, every agent joins). PREFER propose_campaign for normal requests — it shows an editable consent card the user launches themselves. Use this only when the user explicitly says to skip review ("just create it", "don\'t show me a card") or is iterating on an already-agreed campaign.',
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
    description: 'Update a feeder agent: activate/pause (active), let it post autonomously vs draft-for-review (auto_post), or assign it to a campaign (campaign_id — an agent can be on SEVERAL campaigns; this ADDS one; null removes it from all).',
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
    name: 'find_trends',
    description: "Scan the user's niche for what's going viral RIGHT NOW (Instagram/TikTok via scraping, plus active ad formats) and reverse-engineer the top formats into the library. Use when the user asks 'what's trending', 'find viral formats', 'what's working on TikTok', etc. Takes ~1-2 min. Costs a small scraping fee.",
    input_schema: {
      type: 'object',
      properties: { platforms: { type: 'array', items: { type: 'string', enum: ['tiktok', 'instagram'] }, description: 'Which to scan (default both).' } },
    },
  },
  {
    name: 'learn_trend',
    description: "Learn a viral FORMAT from a link or pasted post so Cadence can reuse it. For a video link (a TikTok/Reel/YouTube short), it reverse-engineers the HOOK and editing format (which render style reproduces it). For X/LinkedIn text (a link or pasted post), it extracts the reusable hook pattern, which then feeds the user's own post generation. Use when the user says 'study this', 'learn from this reel', 'what makes this viral', or pastes a post/video they admire.",
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Link to the viral video or post.' },
        text: { type: 'string', description: 'Or paste the post text directly (for X/LinkedIn).' },
        platform: { type: 'string', enum: ['x', 'linkedin', 'instagram', 'tiktok'], description: 'Platform of the example (inferred from a URL if omitted).' },
      },
    },
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
  {
    name: 'clarify',
    description: "Ask the user ONE structured multiple-choice question as an inline card — ONLY when a creative direction genuinely forks (which of 2-3 distinct creative angles) or an ESSENTIAL slot is missing (a from-scratch video/carousel has no subject; a clip/edit has no source). Length/style/format are NEVER a reason to ask — default them silently. NEVER use it to ask the topic of a TEXT post — for that, pick the strongest angle and draft. Tapping an option becomes the user's reply and continues the chat, so do NOT proceed until they answer. Use at most ONCE per request; never chain two.",
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'One short sentence, phrased as a creative choice.' },
        header: { type: 'string', description: '1-3 word eyebrow, e.g. "Angle", "Length".' },
        options: {
          type: 'array',
          description: '2-4 choices phrased as concrete creative directions (not jargon).',
          items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string', description: 'Text re-sent on pick (defaults to label).' }, description: { type: 'string', description: 'Optional one-line subtext.' } }, required: ['label'] },
        },
        allow_other: { type: 'boolean', description: 'Show a "Something else…" free-text row (default true).' },
      },
      required: ['question', 'options'],
    },
  },
  {
    name: 'propose_campaign',
    description: "Propose a feeder-agent campaign as an editable CONSENT card — does NOT create it. The user reviews/edits the brief and taps Launch. Use this (instead of create_feeder_campaign) whenever building a campaign through chat. Fill in as much of the brief as you can from what they said; leave the rest and it'll be auto-drafted.",
    input_schema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'What the agents promote.' },
        link: { type: 'string' },
        intensity: { type: 'string', enum: ['subtle', 'balanced', 'loud'] },
        objective: { type: 'string', enum: ['awareness', 'signups', 'installs', 'traffic', 'waitlist', 'launch_buzz'] },
        platforms: { type: 'array', items: { type: 'string', enum: ['x', 'linkedin', 'instagram', 'tiktok'] } },
        pitch: { type: 'string', description: 'One punchy sentence on what it is and why it matters.' },
        audience: { type: 'string', description: 'Who it is for, concretely.' },
        key_points: { type: 'array', items: { type: 'string' }, description: '3-4 concrete reasons it is worth talking about.' },
        cta: { type: 'string' },
        link_strategy: { type: 'string', enum: ['never', 'occasional', 'cta_only', 'every_promo'] },
      },
      required: ['product'],
    },
  },
  {
    name: 'generate_video',
    description: "Generate a brand-NEW short video (not cut from a source — that's make_clip). mode 'ai_video' = a cinematic text→video (or animate an attached Library image); mode 'ugc' = a talking spokesperson/avatar reads a script; mode 'edit' = a montage stitched from the user's Library media AND/OR stock B-roll from the content library. For EDIT, set stock_query to a few keywords (e.g. 'coffee pour cafe morning') and Cadence pulls matching clips from its cached stock library — so an edit works even when the user has NO clips of their own. Async (renders in minutes), shows up as an inline video card — say it's rendering, never claim it's ready.",
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['ai_video', 'ugc', 'edit'] },
        prompt: { type: 'string', description: 'What the video shows / its motion + scene (ai_video, edit).' },
        script: { type: 'string', description: 'The spoken script (ugc) — draft it yourself from their brief.' },
        image_url: { type: 'string', description: 'Optional Library image to animate (ai_video) or the avatar still (ugc).' },
        source_asset_ids: { type: 'array', items: { type: 'string' }, description: 'edit mode: Library asset ids to stitch.' },
        external_urls: { type: 'array', items: { type: 'string' }, description: 'edit mode: pasted external clip links.' },
        stock_query: { type: 'string', description: "edit mode: 2-5 keywords to pull stock B-roll from the content library (cached, no AI cost). Set this for any topical edit — it's how an edit works without the user's own clips." },
        aspect: { type: 'string', enum: ['vertical', 'square', 'wide'], description: 'Honored for edit montages; ai_video/ugc render vertical.' },
        duration_sec: { type: 'integer', description: 'ugc snaps to 5/10/15s; ai_video length is provider-set. Default 6.' },
      },
      required: ['mode'],
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
      const mem = await getBrandMemory(userId, { platform: 'instagram', includeTrends: false, includeContext: false })
      const deck = await generateSlideshow({ topic: input.topic, format: input.format || 'listicle', style: input.style || 'bold', slides: input.slides || 6, persona: mem.persona, userId, memory: mem.memoryBlock({ withContext: false, withTrends: false }) })
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
      if (!['x', ...SOCIAL_ENGAGEMENT_PLATFORMS].includes(input.platform)) return { error: 'platform must be x, instagram, tiktok, or linkedin' }
      const patch = { enabled: !!input.enabled }
      // Enabling defaults to auto-post (matches the tab toggle), unless told otherwise.
      patch.auto_post = 'auto_post' in input ? !!input.auto_post : !!input.enabled
      await admin.from('social_engagement').upsert({ user_id: userId, platform: input.platform, ...patch }, { onConflict: 'user_id,platform' })
      return { platform: input.platform, ...patch }
    }

    case 'set_autopilot': {
      if (!['x', 'linkedin'].includes(input.platform)) return { error: 'Autopilot is X or LinkedIn only.' }
      const patch = { user_id: userId, platform: input.platform }
      if (input.enabled !== undefined) { patch.enabled = !!input.enabled; if (input.enabled) patch.next_run_at = new Date().toISOString() }
      if (input.posts_per_day !== undefined) patch.per_run = Math.min(Math.max(Number(input.posts_per_day) || 1, 1), 3)
      if (input.interval_hours !== undefined) patch.interval_hours = Math.min(Math.max(Number(input.interval_hours) || 24, 1), 168)
      const { data, error } = await admin.from('autopilot').upsert(patch, { onConflict: 'user_id,platform' }).select().single()
      if (error) return { error: error.message }
      return { autopilot: { platform: data.platform, enabled: data.enabled, posts_per_day: data.per_run, every_hours: data.interval_hours }, note: data.enabled ? `Autopilot is on for ${input.platform} — first post is on its way into the queue.` : `Autopilot is off for ${input.platform}.` }
    }

    case 'set_niche_engagement': {
      // X "engage in your niche" lives in engagement_rules. Reuse the user's
      // existing rule (one per user in the UI) or create one.
      const { data: existing } = await admin.from('engagement_rules').select('*').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle()
      const patch = {}
      if (input.enabled !== undefined) { patch.active = !!input.enabled; if (input.enabled) patch.next_run_at = new Date().toISOString() }
      if (Array.isArray(input.keywords)) patch.target_keywords = input.keywords.map(s => String(s).trim()).filter(Boolean).slice(0, 12)
      if (Array.isArray(input.accounts)) patch.target_handles = input.accounts.map(s => String(s).replace(/^@/, '').trim()).filter(Boolean).slice(0, 3)
      if (input.replies_per_run !== undefined) patch.replies_per_run = Math.min(Math.max(Number(input.replies_per_run) || 1, 1), 5)
      if (input.auto_post !== undefined) patch.auto_post = !!input.auto_post
      let row
      if (existing) {
        const { data, error } = await admin.from('engagement_rules').update(patch).eq('id', existing.id).eq('user_id', userId).select().single()
        if (error) return { error: error.message }; row = data
      } else {
        const { data, error } = await admin.from('engagement_rules').insert({ user_id: userId, name: 'Niche engagement', auto_post: true, ...patch }).select().single()
        if (error) return { error: error.message }; row = data
      }
      return { engagement: { enabled: row.active, keywords: row.target_keywords || [], accounts: row.target_handles || [], replies_per_run: row.replies_per_run, auto_post: row.auto_post }, note: row.active && !(row.target_keywords?.length || row.target_handles?.length) ? 'On, but add keywords or accounts to watch or it finds nothing.' : undefined }
    }

    case 'manage_campaign': {
      if (input.action === 'list') {
        const { data } = await admin.from('brand_campaigns').select('id, name, topic, active, interval_hours, targets').eq('user_id', userId).order('created_at', { ascending: false })
        return { campaigns: (data || []).map(c => ({ id: c.id, name: c.name, active: c.active, every_hours: c.interval_hours, platforms: (c.targets || []).map(t => t.platform) })) }
      }
      if (!input.id) return { error: 'Need the campaign id — call manage_campaign with action:"list" first.' }
      if (input.action === 'delete') {
        const { error } = await admin.from('brand_campaigns').delete().eq('id', input.id).eq('user_id', userId)
        return error ? { error: error.message } : { deleted: true }
      }
      const active = input.action === 'resume'
      const { data, error } = await admin.from('brand_campaigns').update({ active, ...(active ? { next_run_at: new Date().toISOString() } : {}) }).eq('id', input.id).eq('user_id', userId).select('id, name, active').single()
      if (error || !data) return { error: error?.message || 'Campaign not found.' }
      return { campaign: { id: data.id, name: data.name, active: data.active } }
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
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'campaign',
        status: 'active', active: true,
      }).select().single()
      if (error) return { error: error.message }
      // Many-to-many: assign EVERY agent (an agent can be on several campaigns now).
      let assigned = []
      if (input.assign_all !== false) {
        const { data: all } = await admin.from('feeder_agents').select('id, name, persona').eq('user_id', userId)
        for (const a of all || []) {
          await admin.from('agent_campaign_assignments').upsert({ user_id: userId, feeder_agent_id: a.id, campaign_id: camp.id }, { onConflict: 'feeder_agent_id,campaign_id', ignoreDuplicates: true })
          await admin.from('feeder_agents').update({ campaign_id: camp.id }).eq('id', a.id) // deprecated mirror
          assigned.push(a.persona?.name || a.name)
        }
      }
      return { campaign: { id: camp.id, name: camp.name, intensity: camp.intensity }, agents_assigned: assigned, note: 'Live — agents weave it into their next cycles. They appear on the Campaigns tab.' }
    }

    case 'set_agent': {
      // Assignment is many-to-many: campaign_id ADDS the agent to that campaign
      // (it can be on several); null removes it from ALL. active/auto_post live
      // on the agent row.
      if (input.campaign_id !== undefined) {
        if (input.campaign_id) {
          const { data: camp } = await admin.from('agent_campaigns').select('id').eq('id', input.campaign_id).eq('user_id', userId).single()
          if (!camp) return { error: 'Campaign not found.' }
          await admin.from('agent_campaign_assignments').upsert({ user_id: userId, feeder_agent_id: input.id, campaign_id: input.campaign_id }, { onConflict: 'feeder_agent_id,campaign_id', ignoreDuplicates: true })
          await admin.from('feeder_agents').update({ campaign_id: input.campaign_id }).eq('id', input.id).eq('user_id', userId)
        } else {
          await admin.from('agent_campaign_assignments').delete().eq('user_id', userId).eq('feeder_agent_id', input.id)
          await admin.from('feeder_agents').update({ campaign_id: null }).eq('id', input.id).eq('user_id', userId)
        }
      }
      const patch = {}
      if (input.active !== undefined) patch.active = !!input.active
      if (input.auto_post !== undefined) patch.auto_post = !!input.auto_post
      if (patch.active === true) patch.next_run_at = new Date().toISOString()
      let data
      if (Object.keys(patch).length) {
        const r = await admin.from('feeder_agents').update(patch).eq('id', input.id).eq('user_id', userId).select('id, name, persona, active, auto_post').single()
        if (r.error || !r.data) return { error: r.error?.message || 'Agent not found.' }
        data = r.data
      } else {
        const r = await admin.from('feeder_agents').select('id, name, persona, active, auto_post').eq('id', input.id).eq('user_id', userId).single()
        if (!r.data) return { error: 'Agent not found.' }
        data = r.data
      }
      const { data: asg } = await admin.from('agent_campaign_assignments').select('campaign_id').eq('feeder_agent_id', input.id).eq('user_id', userId)
      return { agent: { id: data.id, name: data.persona?.name || data.name, active: data.active, autonomous: data.auto_post, campaign_ids: (asg || []).map(a => a.campaign_id) } }
    }

    case 'run_agent': {
      const { runFeederAgentById } = await import('@/lib/feeder-agents')
      return await runFeederAgentById(input.id, userId)
    }

    case 'find_trends': {
      try {
        const summary = await runTrendHarvest(userId, { platforms: Array.isArray(input.platforms) && input.platforms.length ? input.platforms : ['tiktok', 'instagram'], deepN: 3 })
        return { summary, note: 'Saved to your formats. Video formats map to a clip render style; text/ad patterns feed your drafts.' }
      } catch (e) { return { error: String(e.message || 'Harvest failed.').slice(0, 180) } }
    }

    case 'learn_trend': {
      try {
        if (input.url && /^https?:\/\//.test(String(input.url)) && /(tiktok|instagram|youtube|youtu\.be|\.mp4)/i.test(String(input.url))) {
          const f = await analyzeViralVideo(String(input.url), { userId, platform: input.platform })
          return { learned: { name: f.name, hook: f.summary, render_style: f.render_style, recipe: (f.pattern || '').slice(0, 400) }, note: 'Saved to your formats. Use this render style on a clip to reproduce it.' }
        }
        const f = await analyzeViralText({ text: input.text, url: input.url, platform: input.platform || 'x' }, { userId })
        if (f?.error) return { error: f.error }
        return { learned: { name: f.name, pattern: f.pattern, example: f.hook_text }, note: "Saved — this hook pattern now feeds your post suggestions on that platform." }
      } catch (e) { return { error: String(e.message || 'Could not learn from that.').slice(0, 180) } }
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

    const { messages, platform: rawPlatform, platforms: rawPlatforms, studio: rawStudio } = await req.json()
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

    // STUDIO context (the create composer): a format hint + attached library
    // assets the agent should build from. Sanitized to a small, safe shape.
    let studio = null
    if (rawStudio && typeof rawStudio === 'object') {
      const atts = (Array.isArray(rawStudio.attachments) ? rawStudio.attachments : []).slice(0, 6)
        .filter(a => a && typeof a.url === 'string')
        .map(a => ({ id: String(a.id || ''), type: a.type === 'video' ? 'video' : 'image', url: a.url.slice(0, 600), filename: String(a.filename || '').slice(0, 120) }))
      studio = {
        format: ['carousel', 'clip', 'video', 'ai_video', 'ugc', 'edit', 'remix', 'auto'].includes(rawStudio.format) ? rawStudio.format : 'auto',
        captions: rawStudio.captions !== false,
        attachments: atts,
      }
    }
    const { reply, proposals } = await runChatTurn({ user, messages: safeMessages, scope, studio })
    return Response.json({ reply, proposals, proposal: proposals[0] || null })
  } catch (err) {
    console.error('[chat]', err)
    return Response.json({ reply: 'Something went wrong on my end — try that again.' }, { status: 500 })
  }
}

// The agent turn, extracted so it can be driven from tests and other server
// code. `messages` is the already-validated user/assistant list; `scope` is the
// platform focus (array) or null.
// `probe` (an array) is a TEST seam: when supplied, the create/action tools are
// recorded ({ tool, input }) and answered with a synthetic ok instead of running
// — so the agent's DECISION (which tool, what args, whether it clarifies) can be
// evaluated with zero side effects/cost. It is never passed in production.
const PROBE_READONLY = new Set(['list_queue', 'list_linkedin_posts', 'get_overview', 'list_agents'])
export async function runChatTurn({ user, messages: safeMessages, scope, studio = null, probe = null }) {
  try {
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

Cross-platform powers — you can do ANYTHING the user can do on the tabs themselves; the ENTIRE product is drivable from this chat. Whenever the user asks for something a tab does, just DO it with the tool instead of telling them where to click:
- get_overview: report connected accounts, queue, campaigns, and auto-reply status across all platforms.
- generate_slideshow: make an Instagram/TikTok/LinkedIn carousel on a topic. The slides render INLINE in the chat for the user to preview, pick accounts, and schedule/post/save — you never publish it. Use for any "carousel/slideshow/IG/TikTok post" request.
- make_clip: turn a long video link into short captioned vertical clips (Reels/TikTok). Renders asynchronously — tell the user it's processing and will appear in the Clips tab; don't claim it's ready.
- set_autopilot: turn Autopilot on/off for X or LinkedIn and set posts/day — Cadence posting in their voice hands-free (same as the tab's Autopilot toggle).
- set_replies / run_replies: turn on/off (and run now) auto-replies to comments on the user's OWN posts, in their voice — works for x, instagram, tiktok, linkedin.
- set_niche_engagement: turn on/off X "engage in your niche" and set the keywords / watched accounts / replies-per-run — Cadence replies to fresh in-niche posts to reach new audiences (X only).
- list_agents / set_agent / run_agent: see and manage the user's feeder agents (autonomous personas on their other accounts) — activate, pause, make autonomous, assign to campaigns, run a cycle now.
- propose_campaign: when building a feeder-agent campaign through chat ("set up a campaign promoting X", "have my agents push Y"), PREFER this — it shows an editable brief CONSENT card the user reviews and launches themselves. Fill in what you can; the rest auto-drafts.
- create_feeder_campaign: the immediate (no-consent-card) version — only when the user explicitly says "just launch it" / "create it now" or is clearly iterating on an already-agreed campaign.
- create_promo_campaign / manage_campaign: create a recurring promo on the user's OWN accounts (their voice, on a cadence), and list/pause/resume/delete those campaigns.
- find_trends: scan the niche for what's going viral now (IG/TikTok + ad formats) and bank the top formats. learn_trend: study one viral reel/post the user pastes — reverse-engineers its hook/editing format; text hook patterns then feed the user's own drafts.
The ONE thing you can't do is connect or disconnect a social account (that needs the user to log in through the platform) — for that, point them to the account buttons at the bottom-right. Everything else, do it yourself.
After any action, confirm what happened in one or two sentences. Never invent results — only report what tools returned.

${CHAT_STYLE}

You write for TWO platforms with DIFFERENT disciplines. Pick the rubric by the post's target platform (propose_post's platform field) — an X post is a compressed punch, a LinkedIn post is a developed 60-second read. NEVER write a LinkedIn post like a tweet or vice versa.

For X posts:
${X_RUBRIC}

For LinkedIn posts:
${LINKEDIN_RUBRIC}

CRITICAL RULE — you never queue or publish a NEW post yourself. To create ANY new post, you call propose_post, which shows the user an editable draft card (text editor + time picker + live countdown + 👍/👎 + Post-now/Schedule/Discard). The user — not you — decides whether it gets scheduled or posted. This applies even when the user says "post this now" or "schedule it": still call propose_post (you can mention you've set it up to post now / for a time, and they just confirm on the card). The same consent rule covers EVERY platform and content type: nothing goes live on X, LinkedIn, Instagram, or TikTok unless the user explicitly approved that exact content. generate_slideshow likewise only RENDERS the carousel into an inline preview card — the user picks the accounts and hits post/schedule themselves; you never publish it.

CRITICAL RULE — when asked to write, DRAFT IMMEDIATELY. Never reply with a clarifying question like "what should it be about?" or "what's the topic?". If the user doesn't give a topic, pick the strongest one yourself from their voice profile, niche, recent posts, or LinkedIn content (call list_linkedin_posts or get_overview if you need material) and call propose_post in your FIRST response. They'll edit the draft or tell you to change direction — a concrete draft is always more useful than a question. Ask a question only when the request is literally impossible to act on. This DRAFT-IMMEDIATELY rule governs TEXT posts and threads. In the Studio (see STUDIO MODE), the one exception is the "clarify" tool — a single tappable multiple-choice card, used ONLY when a creative direction genuinely forks or an essential slot is missing (a from-scratch video's/carousel's subject, a clip's source). Even there: prefer making it with a confident default over asking.

More rules:
- For "write/draft/make a tweet", "repurpose my LinkedIn post", "post about X", etc. → call propose_post with the full post text. Then reply in one short line, e.g. "Here's a draft — edit it and approve below."
- Asked for N posts or "a few options"? Call propose_post N times in the same turn — every draft must arrive as its own editable card, never as plain text in your reply.
- For "make a thread" / "turn this into a thread" → propose_thread with 2-8 parts: hook tweet, one point per tweet, closer with the payoff.
- When the user pastes a link to repurpose → ingest_url first, then draft from what it returns in THEIR voice (never copy the source verbatim).
- Set want_image:true + a vivid image_prompt ONLY when the user wants a visual/picture/image on the post.
- To repurpose LinkedIn content: call list_linkedin_posts, pick the relevant one, rewrite it for the target platform, then propose_post.
- The queue-management tools (reschedule, update, delete, set_status, pause/resume, set_cadence) act on posts the user already approved — those you may call directly when asked.
- Relative times like "tomorrow at noon" resolve against the current LA time given below. Show times in Pacific (PT).
- Be concise. If a tool errors, say plainly what went wrong.
- Your replies render as MARKDOWN. Use real links — [label](https://…) — whenever you reference a source (e.g. a LinkedIn post's post_url), so the user can click through; never paste raw IDs or claim you can't link something you have a URL for. Light formatting (bold, bullet "- " lists) is fine; keep it tight.`

    // Live trending hook patterns for the focused TEXT platforms feed the
    // drafts (video formats apply at clip-render time, not here).
    const trendPlats = (scope || ['x', 'linkedin']).filter(p => p === 'x' || p === 'linkedin')
    const trendBlocks = (await Promise.all(trendPlats.map(p => trendingBlock(user.id, p).catch(() => '')))).filter(Boolean).join('')

    const dynamicSystem = `Current date and time (America/Los_Angeles): ${now}
${accountsLine}
${scopeBlock}${liVoiceBlock}${trendBlocks}${feedbackBlock(fb)}`

    let convo = safeMessages
    let reply = ''
    const proposals = []  // every propose_post / propose_thread call becomes one editable card

    // Hard cap on agent hops — an unbounded loop is an unbounded token bill.
    // Block 1 (static) is cached across hops AND across requests; block 2
    // carries the volatile context and never busts the cache.
    // When invoked from the Studio composer, bias toward MAKING the thing and
    // wire up any attached Library assets so the agent builds from real media.
    const studioBlock = studio ? (() => {
      const atts = Array.isArray(studio.attachments) ? studio.attachments : []
      const vids = atts.filter(a => a.type === 'video')
      const imgs = atts.filter(a => a.type === 'image')
      const L = [`

STUDIO MODE — the user is in the create Studio, an agent composer. Turn one short description into a FINISHED thing shown inline (a carousel, a clip, a generated video, a UGC/avatar video, an edit/montage, a post, a thread). DEFAULT to MAKING it. You may ask AT MOST ONE short question, and ONLY via the clarify tool, and ONLY when an ESSENTIAL slot is missing or a creative direction genuinely forks. If every essential slot is filled and a confident default exists, do NOT ask — pick sane defaults for everything non-essential, state the assumption in one line, and make it.

STEP 1 — CREATE TYPE (from their words + any attached Library media). Types:
- CAROUSEL → generate_slideshow. Essential: a TOPIC. Format/style/slide-count ALWAYS default; never ask.
- CLIP → make_clip. For ONE source video the user wants trimmed/cut down/captioned/reframed into short clips. Essential: a SOURCE VIDEO (a link in the message OR an attached Library video). Length/edit-style default; never ask.
- AI_VIDEO (text/image→video from scratch) → generate_video mode:'ai_video'. Essential: a SUBJECT. If a Library image is attached and they want it animated, pass image_url. Length is provider-set — never ask it.
- UGC / AVATAR (a spokesperson reads a script) → generate_video mode:'ugc'. Essential: (1) a SPOKESPERSON PHOTO — an attached Library image of the person/face, passed as image_url; AND (2) a SCRIPT or PRODUCT/MESSAGE (draft the script yourself). The photo is REQUIRED — Higgsfield Speak lip-syncs a real image. If NO image is attached, do NOT call generate_video — ask the user (one short line) to attach a photo of the spokesperson via the Assets button, then generate.
- EDIT / MONTAGE → generate_video mode:'edit'. A montage from the user's Library media, STOCK B-ROLL, and/or clips pulled from SOCIAL LINKS. Sources: source_asset_ids (attached media), external_urls (pasted links — INCLUDING TikTok/Reel/Short/X links; Cadence downloads the actual clip), and stock_query (2-5 keywords → cached stock clips). For ANY topical edit, set stock_query from the topic so it works even with zero clips of their own.
- REMIX → take a viral video's HOOK + FORMAT and make the user's OWN version (transformative — never repost the original). Flow: call learn_trend with the pasted link to extract the format (it returns the hook, render_style, and a recipe), THEN immediately make the user's version applying that hook + recipe to THEIR topic/niche — a clip (make_clip with that render_style on their own footage/stock), a carousel (generate_slideshow in that structure), or an ai_video. If they gave no link, ask for one or offer find_trends to discover a trending format to remix.
- TEXT (post/tweet/thread) is NOT a create type → propose_post / propose_thread; draft immediately, never ask the topic.
(Disambiguation: ONE source video to shorten/caption = CLIP; MULTIPLE pieces to combine = EDIT; copy someone's FORMAT onto your own content = REMIX.)
SOURCING FROM SOCIAL: to find content worth remixing, call find_trends (scrapes the user's niche on TikTok/IG) then offer to remix the strongest format. You may use a social clip as B-ROLL in an edit (external_urls), but NEVER repost someone's clip as-is — remix = their hook/format on the user's own content.

STEP 2 — GATHER EVERY ESSENTIAL INPUT *BEFORE* GENERATING. Never start a render that's missing a required input and let it fail — check first, ask once, then make it. This is the ONLY time you may ask:
- UGC with NO attached spokesperson photo → ask: "Attach a photo of your spokesperson (tap Assets) and I'll make the talking video." Do NOT generate.
- EDIT with NO attached media → if it's a TOPICAL edit, just set stock_query from the topic and generate (stock B-roll). Only ask for media when they clearly mean an edit of THEIR OWN footage and attached none.
- AI_VIDEO/UGC with NO subject/script AND nothing inferable from their niche/voice/recent posts → clarify "What should the video be about?" with 2-3 tappable angle directions + Something else… But if a strong subject IS inferable (it usually is), pick it, say the assumption in one line, and make it — only a bare "make me a video" with nothing to go on warrants the card.
- CAROUSEL with no topic and nothing to infer → clarify "What's the carousel about?"
- CLIP with no source video and none attached → clarify "Drop the video link (or pick one from your Library) and I'll cut it."
- EVERY other case (every required input present, or confidently inferable) → DO NOT ASK. Make it.

STEP 3 — ONE QUESTION TOTAL. Across a single create request you may show AT MOST ONE blocking clarify card. If you already used it for the essential slot (subject/source), do NOT also ask length/style/angle — default everything else silently and surface alternatives only in the non-blocking STEP 4 menu. Length, style, format, slide count, edit style, captions are NEVER essential.

STEP 4 — DIRECTIONS, NOT INTERROGATION. Once the essential slot is filled, make your single best version, then in ONE short line offer up to three named directions the user can tap to regenerate ("Made a punchy one. Different angle? 1) slow-mo majestic 2) fast-cut hype 3) cute/funny"). The artifact leads; the menu follows, never blocks. Use the clarify card for a genuine fork BEFORE making; use this one-line menu AFTER a confident first draft.

GRACEFUL FALLBACK — generated video may be gated. generate_video returns an inline card that renders async; if generated video isn't enabled, the card itself shows a "coming soon — here's the nearest thing" state. So call generate_video confidently; do NOT pre-apologize.

NON-NEGOTIABLES: never publish (everything renders inline for the user to pick accounts and post/schedule themselves); one create tool call per request; after acting, confirm in one or two sentences; never claim an async render (clip/video) is ready — say it's processing.`]
      // studio.format is a HARD override on STEP 1 — the user picked a create-type
      // chip, so it wins over any read of their message as a text post.
      const FMT = {
        carousel: 'a CAROUSEL — call generate_slideshow; do NOT call make_clip / generate_video / propose_post',
        clip: 'a CLIP/REEL from ONE source video — call make_clip; do NOT call generate_slideshow / generate_video / propose_post',
        ai_video: 'a GENERATED AI VIDEO — call generate_video mode:\'ai_video\'; do NOT call make_clip / generate_slideshow / propose_post',
        ugc: `a UGC/AVATAR video — call generate_video mode:'ugc'. It needs a spokesperson photo. ${imgs.length ? `One IS attached ("${imgs[0].filename}") — pass its url (${imgs[0].url}) as image_url and generate; do NOT ask for a photo.` : 'NONE is attached — ask them to attach a photo (Assets) FIRST, do not generate.'} do NOT call other tools`,
        edit: `an EDIT/MONTAGE — call generate_video mode:'edit'. ${(vids.length || imgs.length) ? 'Media IS attached — pass it as source_asset_ids and generate (one source is fine).' : 'NO media attached — set stock_query to 2-5 keywords from their topic to pull stock B-roll, and generate. A pasted social link goes in external_urls.'} do NOT call other tools`,
        remix: `a REMIX — call learn_trend with the pasted social link to extract its hook + format + recipe, THEN make the user's OWN version applying that format to their topic/niche (a clip with the returned render_style, a carousel in that structure, or an ai_video). Never repost the original. If no link is in the message, ask them to paste the viral link they want to remix (or offer find_trends to discover one).`,
        video: 'a GENERATED VIDEO — call generate_video; pick the mode (ai_video / ugc / edit) from their words. do NOT call other tools',
      }[studio.format]
      if (FMT) L.unshift(`HARD OVERRIDE — the user explicitly selected this create-type, so you MUST make ${FMT}. This wins over reading their message as a plain post. Gather every required input first (see STEP 2): if one is missing, ask ONE short question; otherwise make it now.`)
      if (vids.length) L.push(`Attached video(s) from their Library: ${vids.map(v => `"${v.filename}" [id ${v.id}] → ${v.url}`).join(' ; ')}. For a CLIP, set make_clip source_url to one${studio.captions === false ? ' (captions off)' : ''}. For an EDIT, pass their ids as generate_video source_asset_ids.`)
      if (imgs.length) L.push(`Attached photo(s) from their Library: ${imgs.map(v => `"${v.filename}" [id ${v.id}] → ${v.url}`).join(' ; ')}. THIS COUNTS as the spokesperson photo for UGC — for mode:'ugc' pass the first one's url as image_url (do NOT ask for a photo, you already have one). Also usable: feature in a carousel, animate as ai_video (image_url), or include in an edit (source_asset_ids).`)
      return L.join('\n- ')
    })() : ''
    const systemBlocks = [
      { type: 'text', text: staticSystem, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicSystem + studioBlock },
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
          if (probe && !PROBE_READONLY.has(block.name)) {
            probe.push({ tool: block.name, input: block.input })
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: true, note: 'Done (probe).' }) })
            continue
          }
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
          } else if (block.name === 'generate_slideshow') {
            // Render the deck and show it INLINE in the chat (slides + caption)
            // for the user to pick accounts and schedule/post — never auto-post.
            if (!block.input.topic) { result = { error: 'topic required' } }
            else {
              try {
                const mem = await getBrandMemory(user.id, { platform: 'instagram', includeTrends: false, includeContext: false })
                const deck = await generateSlideshow({ topic: block.input.topic, format: block.input.format || 'listicle', style: block.input.style || 'bold', slides: block.input.slides || 6, persona: mem.persona, userId: user.id, memory: mem.memoryBlock({ withContext: false, withTrends: false }) })
                proposals.push({ slideshow: { topic: block.input.topic, format: deck.format, style: deck.style, handle: deck.handle, slides: deck.slides, caption: deck.caption, image_urls: deck.imageUrls } })
                result = { ok: true, slides: deck.imageUrls.length, note: 'Carousel rendered and shown inline for the user to review — they pick accounts and schedule/post/save. Do NOT also call generate_slideshow again.' }
              } catch (e) { result = { error: String(e.message || 'Could not build the carousel.').slice(0, 180) } }
            }
          } else if (block.name === 'make_clip') {
            // Clips render asynchronously (download + transcribe + ffmpeg take
            // minutes), so we kick a job and tell the user where it lands.
            const src = String(block.input.source_url || '').trim()
            if (!/^https?:\/\//.test(src)) { result = { error: 'Need a direct video URL (YouTube, TikTok, IG, or an .mp4 link).' } }
            else {
              const row = {
                user_id: user.id, source_url: src, source_name: block.input.source_name || null,
                format: ['vertical', 'square', 'wide'].includes(block.input.format) ? block.input.format : 'vertical',
                captions: studio ? studio.captions !== false : block.input.captions !== false,
                target_len: ['short', 'medium'].includes(block.input.target_len) ? block.input.target_len : 'short',
                max_clips: Math.min(Math.max(Number(block.input.max_clips) || 3, 1), 5),
                edit_formats: (Array.isArray(block.input.edit_formats) ? block.input.edit_formats : []).slice(0, 4),
              }
              if (!row.edit_formats.length) row.edit_formats = ['captions']
              const { data: job, error } = await admin.from('clip_jobs').insert(row).select('id').single()
              if (error) { result = { error: error.message } }
              else {
                const base = process.env.NEXT_PUBLIC_APP_URL || ''
                if (base) fetch(`${base}/api/clips/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
                result = { ok: true, job_id: job.id, note: 'Clip render started (takes a few minutes). The finished clips appear in the Clips tab where they can be previewed and posted. Tell the user it is rendering — do not claim it is ready yet.' }
              }
            }
          } else if (block.name === 'clarify') {
            // A single inline multiple-choice card. Tapping an option re-sends
            // that text as the next user turn, so the existing hop loop sees the
            // answer — no DB write, no resolve persistence (the choice already
            // lives in the transcript). Hard gate: tell the model to stop here.
            const opts = (Array.isArray(block.input.options) ? block.input.options : []).slice(0, 4)
              .map(o => ({ label: String(o.label || o.value || '').slice(0, 80), value: String(o.value || o.label || '').slice(0, 200), description: o.description ? String(o.description).slice(0, 120) : undefined }))
              .filter(o => o.label)
            if (opts.length < 2) { result = { error: 'clarify needs 2-4 options.' } }
            else if (proposals.some(p => p.question)) { result = { error: 'You already asked one question this turn — only ONE clarify card is allowed. Wait for the answer.' } }
            else {
              proposals.push({ question: { prompt: String(block.input.question || '').slice(0, 300), header: String(block.input.header || '').slice(0, 24), options: opts, allow_other: block.input.allow_other !== false } })
              result = { ok: true, note: 'Question card shown inline. The user will tap an option (or type) and you will see their choice as their NEXT message — STOP here and wait; do not call more tools or answer further in this turn.' }
            }
          } else if (block.name === 'propose_campaign') {
            // An editable consent card for a feeder-agent campaign. Auto-drafts
            // the missing brief pieces from product/link, but creates NOTHING —
            // the user reviews/edits and taps Launch on the card.
            const product = String(block.input.product || '').slice(0, 300).trim()
            if (!product) { result = { error: 'Say what to promote.' } }
            else {
              let draft = {}
              try { draft = await draftCampaignBrief({ product, link: block.input.link || '' }) } catch { /* best effort */ }
              const camp = {
                product, link: block.input.link || null,
                intensity: ['subtle', 'balanced', 'loud'].includes(block.input.intensity) ? block.input.intensity : 'balanced',
                objective: ['awareness', 'signups', 'installs', 'traffic', 'waitlist', 'launch_buzz'].includes(block.input.objective) ? block.input.objective : 'awareness',
                platforms: (Array.isArray(block.input.platforms) ? block.input.platforms : []).filter(p => ['x', 'linkedin', 'instagram', 'tiktok'].includes(p)),
                pitch: block.input.pitch || draft.pitch || '',
                audience: block.input.audience || draft.audience || '',
                key_points: (Array.isArray(block.input.key_points) && block.input.key_points.length ? block.input.key_points : (draft.key_points || [])).map(s => String(s).slice(0, 120)).slice(0, 6),
                cta: block.input.cta || '',
                link_strategy: ['never', 'occasional', 'cta_only', 'every_promo'].includes(block.input.link_strategy) ? block.input.link_strategy : 'occasional',
                dont_say: draft.avoid ? [String(draft.avoid).slice(0, 120)] : [],
              }
              camp.brief = composeBrief({ pitch: camp.pitch, audience: camp.audience, key_points: camp.key_points, avoid: draft.avoid })
              proposals.push({ campaign: camp })
              result = { ok: true, note: 'Campaign brief proposed inline — the user reviews/edits and taps Launch. Do NOT create it yourself; confirm in one short sentence and stop.' }
            }
          } else if (block.name === 'generate_video') {
            // Queue a generated-video job and show an inline card that polls until
            // the render lands (or shows a graceful 'coming soon' if AI video is
            // gated off). Mirrors make_clip's fire-and-forget worker kick.
            const mode = ['ai_video', 'ugc', 'edit'].includes(block.input.mode) ? block.input.mode : 'ai_video'
            const row = {
              user_id: user.id, mode,
              prompt: String(block.input.prompt || '').slice(0, 800) || null,
              script: String(block.input.script || '').slice(0, 2000) || null,
              image_url: /^https?:\/\//.test(String(block.input.image_url || '')) ? String(block.input.image_url).slice(0, 600) : null,
              aspect: ['vertical', 'square', 'wide'].includes(block.input.aspect) ? block.input.aspect : 'vertical',
              duration_sec: Math.min(Math.max(Number(block.input.duration_sec) || 6, 2), 15),
              source_asset_ids: (Array.isArray(block.input.source_asset_ids) ? block.input.source_asset_ids : []).slice(0, 8),
              external_urls: (Array.isArray(block.input.external_urls) ? block.input.external_urls : []).filter(u => /^https?:\/\//.test(String(u))).slice(0, 8),
              stock_query: String(block.input.stock_query || '').slice(0, 120).trim() || null,
              status: 'queued',
            }
            if (mode === 'edit' && !row.source_asset_ids.length && !row.external_urls.length && !row.stock_query) {
              result = { error: 'Edit mode needs media OR a stock_query — DO NOT retry. Either set stock_query to a few keywords (pulls stock B-roll from the library), or ask the user to attach clips/photos.' }
            } else if (mode === 'ugc' && !row.image_url) {
              result = { error: 'UGC needs a spokesperson photo — DO NOT retry without one. Ask the user (one short line) to attach a photo of the spokesperson via the Assets button, then call generate_video mode:ugc with image_url set to that photo.' }
            } else if (mode !== 'edit' && !row.prompt && !row.script && !row.image_url) {
              result = { error: 'Need a subject — pass a prompt (ai_video) or a script (ugc).' }
            } else {
              const { data: job, error } = await admin.from('video_jobs').insert(row).select('id').single()
              if (error) { result = { error: error.message } }
              else {
                const base = process.env.NEXT_PUBLIC_APP_URL || ''
                if (base) fetch(`${base}/api/video/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
                proposals.push({ video: { job_id: job.id, kind: 'generated', mode, status: 'rendering', caption: '' } })
                result = { ok: true, job_id: job.id, note: 'Video render started — it appears inline when ready (or shows a coming-soon state if generated video is not enabled). Tell the user it is rendering; do NOT claim it is ready.' }
              }
            }
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
    return { reply: cleanReply(reply), proposals }
  } catch (err) {
    console.error('[chat]', err)
    return { reply: 'Something went wrong on my end — try that again.', proposals: [] }
  }
}
