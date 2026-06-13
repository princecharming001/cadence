// lib/trends-harvest.js — the HARVEST layer: continuously discover what's
// trending in the user's niche and feed it into the format library.
//   • Instagram / TikTok → Apify actors (rank by views, deep-analyze the top
//     few through the vision pipeline in lib/trends.js).
//   • X / LinkedIn → existing reads (X search by engagement; LinkedIn mentor
//     corpus) → text hook distillation.
//   • Ads → Meta Ad Library API (free/official; gated on META_ADLIB_TOKEN).
// Provider keys: APIFY_TOKEN (have it), META_ADLIB_TOKEN (operator adds).
import { admin } from './supabase'
import { analyzeViralVideo, analyzeViralText } from './trends'
import { generateJson } from './llm'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTORS = {
  instagram: process.env.APIFY_INSTAGRAM_ACTOR || 'apify~instagram-scraper',
  tiktok: process.env.APIFY_TIKTOK_ACTOR || 'clockworks~tiktok-scraper',
}

async function apifyRun(actor, input, { timeoutMs = 180000 } = {}) {
  if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN not set')
  const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Apify ${actor} failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const items = await res.json()
  return Array.isArray(items) ? items : []
}

// Normalize wildly-varying actor outputs to {url, views, likes, caption}.
const num = v => (Number.isFinite(+v) ? +v : 0)
function normItem(it, platform) {
  const url = it.webVideoUrl || it.url || it.postUrl || it.videoUrl || it.shareUrl || null
  const views = num(it.playCount ?? it.videoViewCount ?? it.views ?? it.viewCount ?? it.diggCount)
  const likes = num(it.diggCount ?? it.likesCount ?? it.likes ?? it.likeCount)
  const caption = it.text || it.caption || it.description || it.title || ''
  const isVideo = (it.type ? /video|reel/i.test(it.type) : true) || !!it.webVideoUrl || !!it.videoUrl
  return url ? { platform, url, views, likes, caption: String(caption).slice(0, 500), isVideo } : null
}

// Harvest one IG/TikTok niche term set → ranked candidate videos.
async function harvestVideos(platform, terms, perTerm = 12) {
  const actor = ACTORS[platform]
  const tags = terms.map(t => String(t).replace(/^#/, '').replace(/\s+/g, '').toLowerCase()).filter(Boolean).slice(0, 4)
  if (!tags.length) return []
  let input
  if (platform === 'tiktok') input = { hashtags: tags, resultsPerPage: perTerm, shouldDownloadVideos: false, shouldDownloadCovers: false }
  else input = { search: tags[0], searchType: 'hashtag', resultsLimit: perTerm * 2, addParentData: false } // apify instagram-scraper
  const items = await apifyRun(actor, input).catch(() => [])
  const norm = items.map(it => normItem(it, platform)).filter(Boolean).filter(v => v.isVideo)
  // Dedupe by url, rank by views.
  const seen = new Set(); const out = []
  for (const v of norm.sort((a, b) => b.views - a.views)) { if (!seen.has(v.url)) { seen.add(v.url); out.push(v) } }
  return out
}

// Meta Ad Library — active ads matching the niche → distill the ad FORMAT.
async function harvestMetaAds(userId, terms) {
  const token = process.env.META_ADLIB_TOKEN
  if (!token) return { skipped: 'META_ADLIB_TOKEN not set' }
  const term = terms[0] || ''
  if (!term) return { skipped: 'no niche term' }
  const fields = 'ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,page_name'
  const url = `https://graph.facebook.com/v21.0/ads_archive?search_terms=${encodeURIComponent(term)}&ad_type=ALL&ad_active_status=ACTIVE&ad_reached_countries=["US"]&fields=${fields}&limit=20&access_token=${token}`
  let ads = []
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    const j = await res.json()
    if (j.error) return { skipped: `Meta Ad Library: ${j.error.message?.slice(0, 120)}` }
    ads = (j.data || []).filter(a => (a.ad_creative_bodies || []).length)
  } catch (e) { return { skipped: `Meta Ad Library unreachable` } }
  if (!ads.length) return { saved: 0 }
  const corpus = ads.slice(0, 12).map((a, i) => `[${i + 1}] ${a.page_name ? `(${a.page_name}) ` : ''}${(a.ad_creative_bodies || []).join(' / ').slice(0, 300)}`).join('\n')
  const out = await generateJson({
    system: `You analyze ad creative to find the whole AD FORMAT that's working — not just the hook. Return: name (short label), format_archetype (problem-agitate-solve, testimonial, founder-story, before/after, listicle, UGC-style, etc.), structure (the full arc: hook → problem → proof/payoff → CTA), payoff (the proof or promise that converts), pattern (a reusable fill-in-the-blank template for the whole ad), why_it_works, suggested_hook (an ad opener in this format).`,
    user: corpus,
    schema: { type: 'object', required: ['name', 'pattern'], properties: { name: { type: 'string' }, format_archetype: { type: 'string' }, structure: { type: 'string' }, payoff: { type: 'string' }, pattern: { type: 'string' }, why_it_works: { type: 'string' }, suggested_hook: { type: 'string' } } },
    maxTokens: 700, toolName: 'emit_ad',
  }).catch(() => null)
  if (!out) return { saved: 0 }
  const pattern = [
    out.format_archetype ? `Format: ${out.format_archetype}` : '',
    out.structure ? `Structure: ${out.structure}` : '',
    out.payoff ? `Payoff: ${out.payoff}` : '',
    out.pattern ? `Template: ${out.pattern}` : '',
  ].filter(Boolean).join('\n').slice(0, 1800)
  await admin.from('trend_formats').insert({
    user_id: userId, platform: 'meta_ads', kind: 'ad',
    name: String(out.name || 'Ad format').slice(0, 120),
    archetype: String(out.format_archetype || '').slice(0, 80) || null,
    payoff: String(out.payoff || '').slice(0, 300) || null,
    summary: String(out.why_it_works || '').slice(0, 600),
    pattern,
    hook_text: String(out.suggested_hook || '').slice(0, 400) || null,
    example_text: corpus.slice(0, 600), source: 'harvest',
  })
  return { saved: 1, ads: ads.length }
}

// Niche terms from the user's persona, distilled into real hashtag-shaped
// search terms (persona.topics are full sentences — useless as hashtags).
async function deriveNiche(userId) {
  const { data: persona } = await admin.from('personas').select('topics, summary').eq('user_id', userId).single()
  const topics = (persona?.topics || []).map(t => String(t)).filter(Boolean)
  if (!topics.length) return ['startup', 'creator', 'marketing']
  try {
    const out = await generateJson({
      system: 'Turn these content topics into 4 short, REAL hashtag search terms people actually use on TikTok/Instagram (single words or tight 2-word compounds, lowercase, no spaces, no # — e.g. "startup", "creatortips", "founderlife"). Pick the ones with real reach.',
      user: topics.join('\n'),
      schema: { type: 'object', required: ['hashtags'], properties: { hashtags: { type: 'array', items: { type: 'string' } } } },
      maxTokens: 200, toolName: 'emit_tags',
    })
    const tags = (out.hashtags || []).map(t => String(t).replace(/^#/, '').replace(/\s+/g, '').toLowerCase()).filter(Boolean).slice(0, 4)
    if (tags.length) return tags
  } catch {}
  return ['startup', 'creator', 'marketing']
}

// Full harvest: niche → IG/TikTok ranked videos (deep-analyze top N each) +
// Meta ads → saved formats. deepN keeps vision cost bounded.
export async function runTrendHarvest(userId, { platforms = ['tiktok', 'instagram'], deepN = 3, onStep } = {}) {
  const terms = await deriveNiche(userId)
  const summary = { niche: terms, formats: 0, byPlatform: {}, notes: [] }
  // De-dupe against what we already analyzed recently.
  const { data: existing } = await admin.from('trend_formats').select('example_url').eq('user_id', userId).not('example_url', 'is', null).limit(200)
  const known = new Set((existing || []).map(r => r.example_url))

  for (const platform of platforms.filter(p => ACTORS[p])) {
    onStep?.(`Scanning ${platform} for what's trending…`)
    let vids = []
    try { vids = await harvestVideos(platform, terms) } catch (e) { summary.notes.push(`${platform}: ${e.message?.slice(0, 80)}`); continue }
    const fresh = vids.filter(v => !known.has(v.url)).slice(0, deepN)
    let saved = 0
    for (let i = 0; i < fresh.length; i++) {
      onStep?.(`Reverse-engineering ${platform} format ${i + 1}/${fresh.length}…`)
      try {
        const f = await analyzeViralVideo(fresh[i].url, { userId, platform })
        if (f) { await admin.from('trend_formats').update({ source: 'harvest', metrics: { views: fresh[i].views, likes: fresh[i].likes } }).eq('id', f.id); saved++ }
      } catch (e) { summary.notes.push(`${platform} analyze: ${String(e.message).slice(0, 60)}`) }
    }
    summary.byPlatform[platform] = { found: vids.length, analyzed: saved }
    summary.formats += saved
  }

  onStep?.('Checking active ad formats…')
  const ads = await harvestMetaAds(userId, terms)
  if (ads.saved) summary.formats += ads.saved
  if (ads.skipped) summary.notes.push(ads.skipped)
  summary.ads = ads

  return summary
}

// Daily sweep (called from cron): harvest a few users whose trend radar is
// stale (>22h), so detection is intrinsic — fresh formats feed generation
// every day without anyone pressing a button. Self-throttles (few per tick,
// dedupes by known URL) to keep Apify + vision cost bounded.
export async function harvestDueTrends({ limit = 3, deepN = 2 } = {}) {
  if (!APIFY_TOKEN) return { ran: 0, skipped: 'no APIFY_TOKEN' }
  const stale = new Date(Date.now() - 22 * 3600 * 1000).toISOString()
  const { data: due } = await admin.from('personas')
    .select('user_id, trend_harvested_at')
    .or(`trend_harvested_at.is.null,trend_harvested_at.lt.${stale}`)
    .order('trend_harvested_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  let ran = 0
  for (const p of due || []) {
    // Claim first (advance the timestamp) so overlapping ticks don't double-run.
    await admin.from('personas').update({ trend_harvested_at: new Date().toISOString() }).eq('user_id', p.user_id)
    try { await runTrendHarvest(p.user_id, { platforms: ['tiktok', 'instagram'], deepN }); ran++ } catch {}
  }
  return { ran }
}
