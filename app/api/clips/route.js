// Clip jobs: list, create (kicks background processing), post a clip, delete.
import { admin, getUser } from '@/lib/supabase'
import { createPost, zernioEnabled } from '@/lib/zernio'
import { CLIP_FORMATS, EDIT_FORMATS } from '@/lib/clips'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { data } = await admin.from('clip_jobs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
  return Response.json({ jobs: data || [] })
}

// POST { source_url, source_name?, format, captions, target_len, max_clips } → queue a job
// POST { action:'post', job_id, clip_index, account_ids, caption?, scheduled_for? } → publish a clip
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const b = await req.json().catch(() => ({}))

  if (b.action === 'post') {
    if (!zernioEnabled()) return Response.json({ error: 'Connect publishing (Zernio) first.' }, { status: 400 })
    const { data: job } = await admin.from('clip_jobs').select('*').eq('id', b.job_id).eq('user_id', user.id).single()
    const clip = job?.clips?.[b.clip_index]
    if (!clip) return Response.json({ error: 'Clip not found' }, { status: 404 })
    const { data: accts } = await admin.from('social_accounts').select('*').eq('user_id', user.id).in('id', b.account_ids || [])
    if (!accts?.length) return Response.json({ error: 'Pick at least one account.' }, { status: 400 })
    try {
      const r = await createPost({
        userId: user.id, accounts: accts,
        content: b.caption ?? clip.caption ?? clip.title,
        mediaUrls: [], scheduledFor: b.scheduled_for || undefined, title: clip.title,
        videoUrl: clip.url,
      })
      return Response.json({ posted: true, id: r.id })
    } catch (e) { return Response.json({ error: e.message }, { status: 500 }) }
  }

  // Source can be a pasted/uploaded URL OR a video already in the user's Library.
  let source_url = String(b.source_url || '').trim()
  let source_name = b.source_name || null
  let source_asset_id = null
  if (b.source_asset_id) {
    const { data: asset } = await admin.from('media_assets').select('id, url, filename, type').eq('id', b.source_asset_id).eq('user_id', user.id).single()
    if (!asset || asset.type !== 'video' || !asset.url) return Response.json({ error: 'That library video is not available.' }, { status: 400 })
    source_url = asset.url; source_name = source_name || asset.filename; source_asset_id = asset.id
  }
  if (!/^https?:\/\//.test(source_url)) return Response.json({ error: 'Paste a direct video link, upload a file, or pick one from your Library.' }, { status: 400 })
  const format = CLIP_FORMATS.some(f => f.key === b.format) ? b.format : 'vertical'
  const edit_formats = (Array.isArray(b.edit_formats) ? b.edit_formats : []).filter(e => EDIT_FORMATS.some(f => f.key === e))
  const row = {
    user_id: user.id, source_url, source_name, source_asset_id,
    format, captions: b.captions !== false,
    target_len: ['short', 'medium'].includes(b.target_len) ? b.target_len : 'short',
    max_clips: Math.min(Math.max(Number(b.max_clips) || 3, 1), 5),
    edit_formats: edit_formats.length ? edit_formats : ['captions'],
    watermark: String(b.watermark || '').trim().slice(0, 40) || null,
    outro: !!b.outro,
    outro_logo_url: /^https?:\/\//.test(String(b.outro_logo_url || '')) ? String(b.outro_logo_url).slice(0, 500) : null,
  }
  const { data: job, error } = await admin.from('clip_jobs').insert(row).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Kick the background worker — don't block this request on processing.
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  fetch(`${base}/api/clips/process`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => {})
  return Response.json({ job })
}

export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  const { data: job } = await admin.from('clip_jobs').select('*').eq('id', id).eq('user_id', user.id).single()
  if (job) {
    const paths = (job.clips || []).map((_, i) => `${user.id}/${job.id}/clip-${i}.mp4`)
    // An uploaded source lives at .../clips/<user>/sources/<name>; derive its
    // real storage key from the URL instead of a path that was never written.
    const m = job.source_url && job.source_url.match(/\/clips\/(.+)$/)
    if (m) paths.push(decodeURIComponent(m[1].split('?')[0]))
    if (paths.length) await admin.storage.from('clips').remove(paths).catch(() => {})
    await admin.from('clip_jobs').delete().eq('id', id)
  }
  return Response.json({ deleted: true })
}
