// /api/video — generated-video jobs (ai_video / ugc / edit). Mirrors /api/clips:
// list, create (kicks the background worker), post a finished video, delete.
import { admin, getUser } from '@/lib/supabase'
import { createPost, zernioEnabled } from '@/lib/zernio'
import { normalizeEditPlanV2, wantsGenerative } from '@/lib/edit-plan'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODES = ['ai_video', 'ugc', 'edit', 'directed']
const ASPECTS = ['vertical', 'square', 'wide']

// GET            → recent jobs (for refresh)
// GET ?id=<uuid> → one job (the inline card polls this while rendering)
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (id) {
    const { data } = await admin.from('video_jobs').select('*').eq('id', id).eq('user_id', user.id).single()
    return Response.json({ job: data || null })
  }
  const { data } = await admin.from('video_jobs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
  return Response.json({ jobs: data || [] })
}

export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))

  // Publish a finished video to IG Reels / TikTok.
  if (b.action === 'post') {
    if (!zernioEnabled()) return Response.json({ error: 'Connect publishing (Zernio) first.' }, { status: 400 })
    const { data: job } = await admin.from('video_jobs').select('*').eq('id', b.job_id).eq('user_id', user.id).single()
    if (!job || !job.video_url) return Response.json({ error: 'Video not ready.' }, { status: 404 })
    const { data: accts } = await admin.from('social_accounts').select('*').eq('user_id', user.id).in('id', b.account_ids || [])
    if (!accts?.length) return Response.json({ error: 'Pick at least one account.' }, { status: 400 })
    // Caption default: never publish a blank Reel/TikTok — fall back to the job's
    // prompt/script (what the gallery already shows as the title) when the client
    // omits a caption.
    const caption = String(b.caption ?? job.prompt ?? job.script ?? '').slice(0, 2200)
    try {
      const r = await createPost({
        userId: user.id, accounts: accts,
        content: caption, mediaUrls: [],
        scheduledFor: b.scheduled_for || undefined, title: (caption || 'Video').slice(0, 80),
        videoUrl: job.video_url,
      })
      return Response.json({ posted: true, id: r.id })
    } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }

  // Directed: a (possibly edited) EditPlan → a render job. The plan is normalized
  // SERVER-SIDE (the render engine has no bounds of its own — scene cap, enums,
  // duration clamps all live in normalizeEditPlan), and every directed create is
  // a FRESH job_id (non-destructive: a re-render never clobbers the proven
  // original; parent_job_id carries lineage so the gallery replaces in place).
  if (b.mode === 'directed') {
    const brief = String(b.prompt || '').slice(0, 300)
    // Bound runaway spend (each render is a long ffmpeg pass + stock re-hosting):
    // cap concurrent in-flight directed renders per user. Also dedupes a double
    // click on Re-render, which would otherwise queue identical clones.
    const { count: inflight } = await admin.from('video_jobs').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('mode', 'directed').in('status', ['queued', 'processing', 'rendering'])
    if ((inflight || 0) >= 3) return Response.json({ error: 'A couple of edits are still rendering — give them a moment, then try again.' }, { status: 429 })
    // genReady stays false: the render engine has no AI-scene renderer yet (Phase 4),
    // so the normalizer downgrades ai_video/avatar scenes to stock/cards. We return
    // the downgrades so the editor can tell the user when the result will differ
    // from what they composed (never a silent swap).
    const { plan, downgrades } = normalizeEditPlanV2(b.edit_plan, { brief, wantsGen: wantsGenerative(brief), genReady: false })
    if (!plan.scenes.length) return Response.json({ error: 'The edit has no scenes.' }, { status: 400 })
    let parent = typeof b.parent_job_id === 'string' && b.parent_job_id ? b.parent_job_id : null
    if (parent) { const { data: p } = await admin.from('video_jobs').select('id').eq('id', parent).eq('user_id', user.id).single(); if (!p) parent = null }
    const { data: job, error } = await admin.from('video_jobs').insert({
      user_id: user.id, mode: 'directed', edit_plan: plan, style_key: plan.style_key || null,
      aspect: plan.aspect, prompt: brief || null, parent_job_id: parent, status: 'queued',
    }).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    fetch(`${base}/api/video/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
    return Response.json({ job, downgrades })
  }

  // Create a render job.
  const mode = MODES.includes(b.mode) ? b.mode : 'ai_video'
  const row = {
    user_id: user.id, mode,
    prompt: String(b.prompt || '').slice(0, 800) || null,
    script: String(b.script || '').slice(0, 2000) || null,
    image_url: /^https?:\/\//.test(String(b.image_url || '')) ? String(b.image_url).slice(0, 600) : null,
    aspect: ASPECTS.includes(b.aspect) ? b.aspect : 'vertical',
    duration_sec: Math.min(Math.max(Number(b.duration_sec) || 6, 2), 15),
    source_asset_ids: (Array.isArray(b.source_asset_ids) ? b.source_asset_ids : []).slice(0, 8),
    external_urls: (Array.isArray(b.external_urls) ? b.external_urls : []).filter(u => /^https?:\/\//.test(String(u))).slice(0, 8),
    stock_query: String(b.stock_query || '').slice(0, 120).trim() || null,
    status: 'queued',
  }
  if (mode !== 'edit' && !row.prompt && !row.script && !row.image_url) {
    return Response.json({ error: 'Describe the video (a prompt, a script, or an image).' }, { status: 400 })
  }
  const { data: job, error } = await admin.from('video_jobs').insert(row).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Kick the worker — don't block this request on the render.
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  fetch(`${base}/api/video/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
  return Response.json({ job })
}

export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  const { data: job } = await admin.from('video_jobs').select('id').eq('id', id).eq('user_id', user.id).single()
  if (job) {
    await admin.storage.from('videos').remove([`${user.id}/${id}/video.mp4`, `${user.id}/${id}/voice.wav`]).catch(() => {})
    await admin.from('video_jobs').delete().eq('id', id).eq('user_id', user.id)
  }
  return Response.json({ deleted: true })
}
