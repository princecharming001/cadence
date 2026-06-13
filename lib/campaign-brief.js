// lib/campaign-brief.js — turn a product name and/or a link into a structured
// campaign brief the feeder agents can actually act on. The link is fetched
// (SSRF-guarded) for context; Claude distills a pitch, the audience, the
// talking points that make it land, and what to avoid.
import { generateJson } from './llm'

// Minimal, guarded readable-text fetch (mirrors the chat route's ingest_url).
async function readUrl(url) {
  let u
  try { u = new URL(String(url)) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\])/.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) return null
  try {
    const res = await fetch(u.toString(), {
      redirect: 'follow', signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CadenceBot/1.0)', Accept: 'text/html,application/xhtml+xml' },
    })
    const html = (await res.text()).slice(0, 300000)
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim()
    const desc = (html.match(/<meta[^>]+(?:name="description"|property="og:description")[^>]+content="([^"]*)"/i)?.[1] || '').trim()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
    return { title, desc, text: text.slice(0, 4000) }
  } catch { return null }
}

// Returns { product, pitch, audience, key_points: [..], avoid } — best effort.
export async function draftCampaignBrief({ product = '', link = '' }) {
  const page = link ? await readUrl(link) : null
  const ctx = [
    product ? `What they typed: ${product}` : '',
    page ? `From the link (${link}):\nTITLE: ${page.title}\nDESCRIPTION: ${page.desc}\nPAGE TEXT: ${page.text}` : (link ? `Link (unreadable, infer from URL): ${link}` : ''),
  ].filter(Boolean).join('\n\n')
  if (!ctx) return { error: 'Give a product name or a link to draft from.' }

  const out = await generateJson({
    system: `You write a tight brief that a fleet of social media personas will use to promote something in their OWN voices (never as ads). From the context, distill:
- product: the thing being promoted, as a short label (<=60 chars).
- pitch: one punchy sentence on what it is and why it matters.
- audience: who it's for, concretely (one short phrase).
- key_points: 3-4 specific, concrete reasons it's worth talking about (each <=90 chars, no fluff, no superlatives like "revolutionary").
- avoid: one short line on what would make the promo feel forced or off-brand (optional, '' if nothing obvious).
Be concrete and grounded in the context — never invent features or numbers that aren't supported.`,
    user: ctx,
    schema: {
      type: 'object',
      required: ['product', 'pitch', 'audience', 'key_points'],
      properties: {
        product: { type: 'string' },
        pitch: { type: 'string' },
        audience: { type: 'string' },
        key_points: { type: 'array', items: { type: 'string' } },
        avoid: { type: 'string' },
      },
    },
    maxTokens: 700, toolName: 'emit_brief',
  })
  return {
    product: String(out.product || product || '').slice(0, 60),
    pitch: String(out.pitch || '').trim(),
    audience: String(out.audience || '').trim(),
    key_points: (out.key_points || []).map(s => String(s).trim()).filter(Boolean).slice(0, 4),
    avoid: String(out.avoid || '').trim(),
  }
}

// Compose the structured pieces into the single `brief` string missionBlock reads.
export function composeBrief({ pitch, audience, key_points, avoid }) {
  const parts = []
  if (pitch) parts.push(pitch)
  if (audience) parts.push(`Who it's for: ${audience}`)
  if (key_points?.length) parts.push(`What lands: ${key_points.join('; ')}`)
  if (avoid) parts.push(`Avoid: ${avoid}`)
  return parts.join(' · ').slice(0, 600)
}
