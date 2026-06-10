// Renders ONE carousel slide to a 1080x1350 PNG via next/og (Satori).
// This is the provider-agnostic render core: given a style + slide copy it
// produces a real Instagram-ready image. Used both directly (preview) and by
// the generator (which uploads each rendered slide to storage).
//
// GET /api/slideshow/render?style=bold&kind=cover&heading=...&body=...&index=0&total=5[&bg=<url>]
import { ImageResponse } from 'next/og'
import { SLIDE_STYLES, renderSlideElement } from '@/lib/slideshow'

export const runtime = 'nodejs'

export async function GET(req) {
  const p = new URL(req.url).searchParams
  const style = SLIDE_STYLES[p.get('style')] ? p.get('style') : 'bold'
  const slide = {
    kind: p.get('kind') || 'content',
    heading: p.get('heading') || 'Your slide heading',
    body: p.get('body') || '',
    bg: p.get('bg') || null,
    index: Number(p.get('index') || 0),
    total: Number(p.get('total') || 1),
    handle: p.get('handle') || '',
  }
  return new ImageResponse(renderSlideElement(style, slide), { width: 1080, height: 1350 })
}
