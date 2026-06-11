// lib/brand-campaigns.js — cross-platform "brand campaigns". One campaign
// promotes a topic in the user's ONE voice across any mix of connected accounts
// and generates the right content per platform on a cadence:
//   X / LinkedIn  → a text post in voice (X queued via the X cron; LinkedIn via Zernio)
//   Instagram/TikTok → an AI carousel via the slideshow pipeline + Zernio
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'
import { generateImage } from './images'
import { generateSlideshow } from './slideshow'
import { createPost, zernioEnabled } from './zernio'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function setStatus(id, status_detail, running) {
  await admin.from('brand_campaigns').update({ status_detail, running, last_activity_at: new Date().toISOString() }).eq('id', id)
}

// Generate one on-voice text post for a platform.
async function writePost({ topic, platform, persona, recent = [] }) {
  const max = platform === 'x' ? 280 : 600
  const voice = persona
    ? `Voice — tone: ${persona.tone}; topics: ${(persona.topics || []).join(', ')}; rules: ${(persona.style_rules || []).join(' | ')}.`
    : 'Confident, human, specific.'
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 400,
    system: `Write ONE ${platform === 'x' ? 'tweet' : 'LinkedIn post'} (<=${max} chars) promoting the topic, in this person's voice. ${voice}\nSound human, lead with a hook, be concrete, no hashtags spam. Don't repeat these recent posts: ${recent.slice(0, 6).join(' / ')}. Output ONLY the post text.`,
    messages: [{ role: 'user', content: `Topic: ${topic}` }],
  })
  return (res.content.find(b => b.type === 'text')?.text || '').trim().replace(/^["']|["']$/g, '').slice(0, max)
}

async function processBrandCampaign(c) {
  const nowMs = Date.now()
  const intervalMs = (Number(c.interval_hours) || 24) * 3600 * 1000
  await setStatus(c.id, 'Starting…', true)

  const targets = Array.isArray(c.targets) ? c.targets : []
  if (!targets.length) { await setStatus(c.id, 'No target accounts', false); return { id: c.id, skipped: 'no targets' } }

  const { data: persona } = await admin.from('personas').select('*').eq('user_id', c.user_id).single()
  const { data: recentRows } = await admin.from('posts').select('content').eq('user_id', c.user_id).order('created_at', { ascending: false }).limit(10)
  const recent = (recentRows || []).map(r => r.content)

  // schedule a few minutes out so it's visible before it goes live
  const whenIso = new Date(nowMs + 5 * 60 * 1000).toISOString()
  let done = 0
  const results = []

  for (const t of targets) {
    try {
      if (t.kind === 'x') {
        await setStatus(c.id, 'Writing an X post…', true)
        const text = await writePost({ topic: c.topic, platform: 'x', persona, recent })
        let imageUrl = null
        if (c.include_image) { try { imageUrl = (await generateImage(text, { fromContent: true })).url } catch {} }
        await admin.from('posts').insert({ content: text, scheduled_for: whenIso, status: 'queued', source: 'campaign', user_id: c.user_id, x_connection_id: t.id, image_url: imageUrl, platform: 'x' })
        done++; results.push('x')
      } else if (t.platform === 'linkedin') {
        await setStatus(c.id, 'Writing a LinkedIn post…', true)
        const text = await writePost({ topic: c.topic, platform: 'linkedin', persona, recent })
        const { data: acct } = await admin.from('social_accounts').select('*').eq('id', t.id).single()
        if (acct && zernioEnabled()) { await createPost({ userId: c.user_id, accounts: [acct], content: text, scheduledFor: whenIso }); done++; results.push('linkedin') }
      } else if (t.platform === 'instagram' || t.platform === 'tiktok') {
        await setStatus(c.id, `Making a ${t.platform} carousel…`, true)
        const deck = await generateSlideshow({ topic: c.topic, format: c.carousel_format, style: c.carousel_style, slides: 6, persona, userId: c.user_id })
        const { data: acct } = await admin.from('social_accounts').select('*').eq('id', t.id).single()
        const row = { user_id: c.user_id, topic: c.topic, format: deck.format, style: deck.style, slides: deck.slides, caption: deck.caption, image_urls: deck.imageUrls, status: 'draft', campaign_id: null }
        if (acct && zernioEnabled()) {
          const r = await createPost({ userId: c.user_id, accounts: [acct], content: deck.caption, mediaUrls: deck.imageUrls, scheduledFor: whenIso, title: deck.slides?.[0]?.heading || c.topic })
          row.status = 'scheduled'; row.scheduled_for = whenIso; row.account_ids = [acct.id]; row.zernio_post_id = r.id
        }
        await admin.from('slideshows').insert(row)
        done++; results.push(t.platform)
      }
    } catch (e) { results.push(`${t.platform || t.kind}:err`) }
  }

  await admin.from('brand_campaigns').update({ last_run_at: new Date(nowMs).toISOString(), next_run_at: new Date(nowMs + intervalMs).toISOString(), running: false }).eq('id', c.id)
  await setStatus(c.id, done ? `Posted across ${done} account${done === 1 ? '' : 's'}` : 'Nothing posted', false)
  return { id: c.id, name: c.name, done, results }
}

export async function runDueBrandCampaigns() {
  const nowIso = new Date().toISOString()
  const { data: due } = await admin.from('brand_campaigns').select('*').eq('active', true).or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
  const out = []
  for (const c of due || []) { try { out.push(await processBrandCampaign(c)) } catch (e) { out.push({ id: c.id, error: e.message }) } }
  return out
}

export async function runBrandCampaignById(id, userId) {
  const { data: c } = await admin.from('brand_campaigns').select('*').eq('id', id).eq('user_id', userId).single()
  if (!c) return { error: 'not found' }
  return processBrandCampaign(c)
}
