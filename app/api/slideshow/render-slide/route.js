// Re-render edited slides. The carousel text lives as structured data
// (heading/body per slide); when the user edits it, we re-rasterize just the
// changed slides and hand back fresh image URLs. Pure Satori — cheap, no LLM.
import { getUser } from '@/lib/supabase'
import { renderSlideToUrl } from '@/lib/slideshow'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST { style, format, handle, slides:[{kind,heading,body,bg?}], indices:[int] }
//   → { urls: [{ index, url }] }
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const slides = Array.isArray(b.slides) ? b.slides : []
  if (!slides.length) return Response.json({ error: 'No slides to render.' }, { status: 400 })
  const total = slides.length
  // Default to re-rendering every slide; callers pass `indices` to do just the edited ones.
  const indices = (Array.isArray(b.indices) && b.indices.length ? b.indices : slides.map((_, i) => i))
    .filter(i => Number.isInteger(i) && i >= 0 && i < total)

  try {
    const urls = await Promise.all(indices.map(async i => ({
      index: i,
      url: await renderSlideToUrl({
        style: b.style, format: b.format, handle: b.handle,
        slide: slides[i], index: i, total, userId: user.id,
      }),
    })))
    return Response.json({ urls })
  } catch (e) {
    return Response.json({ error: String(e.message || 'Render failed.').slice(0, 180) }, { status: 500 })
  }
}
