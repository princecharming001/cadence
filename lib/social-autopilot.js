// lib/social-autopilot.js — Instagram / TikTok content autopilot.
//
// X/LinkedIn autopilot (lib/autopilot.js) writes TEXT. IG/TikTok are visual, so
// this engine reads the user's content_plan (captured by the MCQ onboarding) and,
// on a cadence, produces the chosen FORMAT(S) in their niche + voice, rotating
// through them so the feed doesn't get samey:
//   carousel   → a rendered slide deck (generateSlideshow + the shared brand brain)
//   ugc_face   → a Higgsfield talking-head video using the user's OWN face photo
//   clip       → a short stock-B-roll video (the always-works edit path)
// Each output is queued (auto_post) or left as a draft for review (auto_post off).
// Video formats render async via video_jobs → a 'rendering' placeholder post →
// lib/video.js attachRenderedVideos fills it in. Research-grounded: archetype +
// goal set the format mix; carousels target saves, UGC targets trust, all lead
// with a strong hook.
import { admin } from './supabase'
import { getBrandMemory } from './brand-memory'
import { generateSlideshow } from './slideshow'
import { generateUgcScript } from './ugc-script'
import { videoProviderStatus } from './video-gen'
import { nextSmartSlot } from './scheduling'

const FORMATS = ['carousel', 'ugc_face', 'clip']
const CAROUSEL_STYLES = ['bold', 'minimal', 'editorial', 'gradient', 'mint']
const HOOKS = ['a direct question', 'a surprising statistic', 'a bold promise of the payoff', 'a numbered list teaser', 'a myth to bust', 'a curiosity gap / cliffhanger']
// Archetype → the carousel structure that fits it (research-mapped).
const ARCHETYPE_FORMAT = {
  educator: 'howto', entertainer: 'story', aesthetic: 'quotes', founder: 'story',
  commentator: 'myths', storyteller: 'story', insider: 'framework', promoter: 'listicle',
}

// When does a post go out? auto_post → a real smart slot; else now (it's a draft).
async function slotFor(userId, platform, after, autoPost) {
  if (!autoPost) return new Date().toISOString()
  try { return await nextSmartSlot(userId, { platform, after }) } catch { return new Date(Date.now() + 3600e3).toISOString() }
}

// Insert a finished IG/TikTok post (carousel) the way the poster expects it.
async function insertSocialPost(row, { content, imageUrls, status, scheduledFor }) {
  const { data } = await admin.from('posts').insert({
    user_id: row.user_id, platform: row.platform, social_account_id: row.social_account_id || null,
    content, image_urls: Array.isArray(imageUrls) && imageUrls.length ? imageUrls : null,
    image_url: imageUrls?.[0] || null, status, source: 'autopilot',
    scheduled_for: scheduledFor,
  }).select('id').single()
  return data?.id || null
}

// Enqueue a video render + a 'rendering' placeholder post; the cron reconciler
// (attachRenderedVideos) attaches the video and flips status when it lands.
async function enqueueVideoPost(row, { mode, imageUrl, script, prompt, stockQuery, caption }) {
  const { data: job } = await admin.from('video_jobs').insert({
    user_id: row.user_id, mode, image_url: imageUrl || null, script: script || null,
    prompt: prompt || null, stock_query: stockQuery || null, aspect: 'vertical', duration_sec: mode === 'ugc' ? 12 : 8, status: 'queued',
  }).select('id').single()
  if (!job?.id) return null
  const { data: post } = await admin.from('posts').insert({
    user_id: row.user_id, platform: row.platform, social_account_id: row.social_account_id || null,
    content: caption, status: 'rendering', source: 'autopilot', video_job_id: job.id,
    scheduled_for: new Date(Date.now() + 30 * 60e3).toISOString(),
  }).select('id').single()
  if (!post?.id) { await admin.from('video_jobs').delete().eq('id', job.id).then(() => {}, () => {}); return null }
  return post.id
}

// Produce ONE piece of content in the given format. Returns an outcome string.
async function produce(row, plan, format, mem, autoPost, after) {
  const platform = row.platform
  const niche = plan.niche || (mem.brief?.positioning) || (mem.persona?.topics || [])[0] || 'your niche'
  const goalLine = plan.goal ? ` Goal: ${plan.goal.replace(/_/g, ' ')}.` : ''

  if (format === 'carousel') {
    const style = CAROUSEL_STYLES[Math.floor((row.cycle_seed || Date.now() / 36e5) ) % CAROUSEL_STYLES.length] || 'bold'
    const fmt = ARCHETYPE_FORMAT[plan.archetype] || 'listicle'
    const hook = HOOKS[Math.floor(Math.random() * HOOKS.length)]
    const deck = await generateSlideshow({
      topic: `${niche}${goalLine}`, format: fmt, style, slides: 6, hook,
      persona: mem.persona ? { tone: (plan.tone || []).join(', ') || mem.persona.tone, topics: mem.persona.topics, style_rules: mem.persona.style_rules } : { tone: (plan.tone || []).join(', ') },
      userId: row.user_id, memory: mem.memoryBlock({ withContext: false, withTrends: false }),
    }).catch(() => null)
    if (!deck?.imageUrls?.length) return null
    const when = await slotFor(row.user_id, platform, after, autoPost)
    const id = await insertSocialPost(row, { content: deck.caption, imageUrls: deck.imageUrls, status: autoPost ? 'queued' : 'draft', scheduledFor: when })
    return id ? { kind: 'carousel', when } : null
  }

  if (format === 'ugc_face') {
    // Needs: a face photo + the video provider (ENABLE_AI_VIDEO + Higgsfield) +
    // a TTS voice for the voiceover. Skip cleanly if any is missing so we never
    // mint a failing post every cycle (rather than enqueue a render that dies).
    if (!plan.face_photo_url || videoProviderStatus() !== 'ready' || !process.env.OPENAI_API_KEY) return null
    const script = await generateUgcScript({ persona: mem.persona || { name: 'You' }, mission: { eligible: false }, topic: niche }).catch(() => null)
    if (!script) return null
    const id = await enqueueVideoPost(row, { mode: 'ugc', imageUrl: plan.face_photo_url, script: script.script, prompt: `${(plan.tone || []).join(', ') || 'warm, natural'} direct-to-camera delivery`, caption: script.caption })
    return id ? { kind: 'ugc_face', rendering: true } : null
  }

  if (format === 'clip') {
    // Always-works short video: stock B-roll montage on the niche topic.
    const caption = `${niche}`.slice(0, 200)
    const id = await enqueueVideoPost(row, { mode: 'edit', stockQuery: niche, caption })
    return id ? { kind: 'clip', rendering: true } : null
  }
  return null
}

// Run one IG/TikTok autopilot row. Claim-first (next_run_at advanced) so
// overlapping cron ticks can't double-run.
export async function runSocialAutopilot(row) {
  const plan = row.content_plan || {}
  const formats = (Array.isArray(plan.formats) ? plan.formats : []).filter(f => FORMATS.includes(f))
  const per = Math.min(Math.max(row.per_run || 1, 1), 3)
  const nextIso = new Date(Date.now() + (row.interval_hours || 24) * 3600 * 1000).toISOString()
  const { data: claimed } = await admin.from('autopilot')
    .update({ running: true, next_run_at: nextIso, last_run_at: new Date().toISOString(), status_detail: 'Creating content…' })
    .eq('id', row.id).eq('running', false).select()
  if (!claimed?.[0]) return { skipped: 'already running' }
  try {
    if (!formats.length) { await finish(row.id, 'No formats chosen — open setup'); return { skipped: 'no formats' } }
    // Resolve the ACTIVE account for this platform at run time (autopilot is keyed
    // by user+platform today; targeting the active account — not an arbitrary
    // first row — ensures content lands on the account the user is managing).
    if (!row.social_account_id) {
      const { activeAccount } = await import('./account-scope')
      const acct = await activeAccount(row.user_id, row.platform)
      row.social_account_id = acct?.id || null
    }
    const autoPost = !!row.auto_post
    const mem = await getBrandMemory(row.user_id, { platform: row.platform, includeTrends: false, includeContext: false })
    const cycle = (row.cycles || 0)
    const outcomes = []
    let after = null
    for (let i = 0; i < per; i++) {
      // Rotate the chosen formats across cycles + this run's index.
      const format = formats[(cycle + i) % formats.length]
      try {
        const out = await produce({ ...row, cycle_seed: cycle + i }, plan, format, mem, autoPost, after)
        if (out) { outcomes.push(out.kind); if (out.when) after = out.when }
      } catch (e) { /* one format failing shouldn't kill the run */ }
    }
    await admin.from('autopilot').update({ cycles: cycle + 1 }).eq('id', row.id).then(() => {}, () => {})
    const videos = outcomes.filter(o => o === 'ugc_face' || o === 'clip').length
    const decks = outcomes.filter(o => o === 'carousel').length
    const detail = outcomes.length
      ? `${autoPost ? 'Queued' : 'Drafted'} ${decks ? `${decks} carousel${decks === 1 ? '' : 's'}` : ''}${decks && videos ? ' + ' : ''}${videos ? `${videos} video${videos === 1 ? '' : 's'}${videos ? ' (rendering)' : ''}` : ''}`.trim()
      : 'Nothing this cycle — will try again'
    await finish(row.id, detail)
    return { generated: outcomes.length, formats: outcomes }
  } catch (e) {
    await finish(row.id, `Failed: ${String(e.message).slice(0, 80)}`)
    return { error: e.message }
  }
}

async function finish(id, status_detail) {
  await admin.from('autopilot').update({ running: false, status_detail }).eq('id', id).then(() => {}, () => {})
}
