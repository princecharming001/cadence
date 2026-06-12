// lib/brand-campaigns.js — cross-platform "brand campaigns". One campaign
// promotes a topic in the user's ONE voice across any mix of connected accounts
// and generates the right content per platform on a cadence:
//   X / LinkedIn  → a text post in voice (X queued via the posts queue;
//                   LinkedIn via Zernio, with a local posts row for the queue)
//   Instagram/TikTok → an AI carousel via the slideshow pipeline + Zernio
//
// Claim-first (lib/engine.js): next_run_at advances at claim, overlapping
// triggers can't double-post. Every output carries provenance back to the
// campaign (posts.brand_campaign_id / slideshows.campaign_id), and per-target
// outcomes land in status_detail instead of vanishing.
import { admin } from './supabase'
import { generateText } from './llm'
import { voiceBlock, feedbackBlock, antiRepetition, PROMO_RUBRIC, X_RUBRIC, LINKEDIN_RUBRIC, enforceLen } from './prompts'
import { getVoice, winnersBlock } from './voice'
import { brandContextBlock } from './brand-context'
import { generateImage, persistImage } from './images'
import { generateSlideshow } from './slideshow'
import { createPost, zernioEnabled } from './zernio'
import { claimEngineRow, dueRows, setEngineStatus } from './engine'
import { nextSmartSlot } from './scheduling'

const TABLE = 'brand_campaigns'
const setStatus = (id, detail, running) => setEngineStatus(TABLE, id, detail, running)

// One on-voice promo post for a platform, through the full prompt stack.
async function writePost({ topic, platform, persona, fb, recent, brandCtx, winners }) {
  const rubric = platform === 'x' ? X_RUBRIC : LINKEDIN_RUBRIC
  const register = platform === 'x' ? 'post' : 'longform'
  const text = await generateText({
    system: `Write ONE ${platform === 'x' ? 'X (Twitter) post' : 'LinkedIn post'} promoting the topic — in this person's voice, never sounding like an ad.

${voiceBlock(persona, { register })}

${rubric}

${PROMO_RUBRIC}${feedbackBlock(fb)}${winnersBlock(winners || [])}${brandCtx || ''}${antiRepetition(recent)}

Output ONLY the post text.`,
    user: `Topic to promote: ${topic}`,
    maxTokens: 500,
  })
  return enforceLen(text.replace(/^["']|["']$/g, ''), platform)
}

async function processBrandCampaign(c) {
  const nowMs = Date.now()
  try {
    await setStatus(c.id, 'Starting…', true)

    const targets = Array.isArray(c.targets) ? c.targets : []
    if (!targets.length) { await setStatus(c.id, 'No target accounts', false); return { id: c.id, skipped: 'no targets' } }

    const [{ persona, fb, recent, winners }, brandCtx] = await Promise.all([getVoice(c.user_id), brandContextBlock(c.user_id)])

    // X/LinkedIn posts land in the user's next SMART slot (their windows +
    // engagement history) instead of "five minutes from whenever cron ran".
    // Carousels keep a short fuse so the user can see (and stop) them.
    let whenIso
    try { whenIso = await nextSmartSlot(c.user_id, { platform: 'x' }) } catch { whenIso = new Date(nowMs + 30 * 60 * 1000).toISOString() }
    const carouselWhenIso = new Date(nowMs + 5 * 60 * 1000).toISOString()
    let done = 0
    const outcomes = []

    for (const t of targets) {
      try {
        if (t.kind === 'x') {
          // Targets are stored client-supplied jsonb — re-verify ownership here.
          const { data: xc } = await admin.from('x_connections').select('id').eq('id', t.id).eq('user_id', c.user_id).single()
          if (!xc) { outcomes.push('x: account not yours/missing'); continue }
          await setStatus(c.id, 'Writing an X post…', true)
          const text = await writePost({ topic: c.topic, platform: 'x', persona, fb, recent, brandCtx, winners })
          let imageUrl = null
          if (c.include_image) {
            try {
              const img = await generateImage(text, { auto: true, userId: c.user_id })
              // Don't attach a stock placeholder; persist real images so they
              // survive until the post publishes.
              if (!img.skipped && !img.placeholder) imageUrl = await persistImage(img.url, c.user_id)
            } catch {}
          }
          await admin.from('posts').insert({
            content: text, scheduled_for: whenIso, status: 'queued', source: 'campaign',
            user_id: c.user_id, x_connection_id: t.id, image_url: imageUrl,
            platform: 'x', brand_campaign_id: c.id,
          })
          done++; outcomes.push('x ✓')
        } else if (t.platform === 'linkedin') {
          await setStatus(c.id, 'Writing a LinkedIn post…', true)
          const text = await writePost({ topic: c.topic, platform: 'linkedin', persona, fb, recent, brandCtx, winners })
          const { data: acct } = await admin.from('social_accounts').select('*').eq('id', t.id).eq('user_id', c.user_id).single()
          if (!acct) { outcomes.push('linkedin: account missing'); continue }
          if (!zernioEnabled()) { outcomes.push('linkedin: publishing not connected'); continue }
          const r = await createPost({ userId: c.user_id, accounts: [acct], content: text, scheduledFor: whenIso })
          // Local record so the queue shows it and provenance survives.
          await admin.from('posts').insert({
            content: text, scheduled_for: whenIso, status: 'posted', source: 'campaign',
            user_id: c.user_id, platform: 'linkedin', brand_campaign_id: c.id,
            external_id: r.id, posted_at: new Date().toISOString(),
          })
          done++; outcomes.push('linkedin ✓')
        } else if (t.platform === 'instagram' || t.platform === 'tiktok') {
          await setStatus(c.id, `Making a ${t.platform} carousel…`, true)
          const deck = await generateSlideshow({ topic: c.topic, format: c.carousel_format, style: c.carousel_style, slides: 6, persona, userId: c.user_id })
          const { data: acct } = await admin.from('social_accounts').select('*').eq('id', t.id).eq('user_id', c.user_id).single()
          const row = {
            user_id: c.user_id, topic: c.topic, format: deck.format, style: deck.style,
            slides: deck.slides, caption: deck.caption, image_urls: deck.imageUrls,
            status: 'draft', campaign_id: c.id,
          }
          if (acct && zernioEnabled()) {
            const r = await createPost({ userId: c.user_id, accounts: [acct], content: deck.caption, mediaUrls: deck.imageUrls, scheduledFor: carouselWhenIso, title: deck.slides?.[0]?.heading || c.topic })
            row.status = 'scheduled'; row.scheduled_for = carouselWhenIso; row.account_ids = [acct.id]; row.zernio_post_id = r.id
          }
          await admin.from('slideshows').insert(row)
          done++; outcomes.push(`${t.platform} ✓`)
        }
      } catch (e) {
        outcomes.push(`${t.platform || t.kind}: ${String(e.message || '').slice(0, 60)}`)
      }
    }

    await setStatus(c.id, done ? `Done — ${outcomes.join(' · ')}` : `Nothing posted — ${outcomes.join(' · ') || 'no usable targets'}`, false)
    return { id: c.id, name: c.name, done, outcomes }
  } catch (e) {
    await setStatus(c.id, `Error: ${e.message}`, false)
    return { id: c.id, error: e.message }
  }
}

export async function runDueBrandCampaigns() {
  const due = await dueRows(TABLE)
  const out = []
  for (const row of due) {
    const c = await claimEngineRow(TABLE, row)
    if (!c) continue
    out.push(await processBrandCampaign(c))
  }
  return out
}

export async function runBrandCampaignById(id, userId) {
  const { data: row } = await admin.from(TABLE).select('*').eq('id', id).eq('user_id', userId).single()
  if (!row) return { error: 'not found' }
  const c = await claimEngineRow(TABLE, row)
  if (!c) return { error: 'Already running — give it a moment.' }
  return processBrandCampaign(c)
}
