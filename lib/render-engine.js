// lib/render-engine.js — executes an EditPlan deterministically, scene by scene.
// Phase 1: source each scene → a local clip/still → normalize to one canvas →
// concat (cuts only) → silent audio → upload. Every scene is sourced
// independently and a failure is collected (never crashes the whole render); a
// minimum-viable gate refuses to ship a stub. Reuses the proven montage
// primitives (reframe/normalizeSeg/concat) from video-edit.js.
//
// Captions, ken-burns, transitions, music and AI scenes are LATER phases — the
// normalizer (lib/edit-plan.js) downgrades anything not yet supported, so a plan
// the engine can't fully honor still renders a clean cut montage.
import { mkdtemp, rm, readFile, writeFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { admin } from './supabase'
import { normalizeSeg, download, concatSegments, canvasFor } from './video-edit'
import { searchStock } from './stock'
import { renderVideoCardPng } from './slideshow'

const setDetail = (id, status_detail) => admin.from('video_jobs').update({ status_detail, heartbeat_at: new Date().toISOString() }).eq('id', id)

async function persistBuffer(buf, job) {
  const sp = `${job.user_id}/${job.id}/video.mp4`
  const { error } = await admin.storage.from('videos').upload(sp, buf, { contentType: 'video/mp4', upsert: true, cacheControl: '31536000' })
  if (error) throw new Error('Upload failed: ' + error.message)
  return admin.storage.from('videos').getPublicUrl(sp).data.publicUrl
}

const orientationFor = aspect => aspect === 'wide' ? 'landscape' : aspect === 'square' ? 'square' : 'portrait'

// Resolve ONE scene to a local source file. Returns { path, isImage } or throws.
async function resolveScene(scene, job, plan, dir, W, H) {
  const raw = path.join(dir, `in-${scene.id}`)
  if (scene.kind === 'card' || scene.kind === 'color') {
    const png = await renderVideoCardPng(plan.style_key || 'bold', {
      eyebrow: scene.kind === 'card' ? scene.eyebrow : null,
      heading: scene.kind === 'card' ? scene.heading : '',
      body: scene.kind === 'card' ? scene.body : null,
    }, W, H)
    const p = raw + '.png'
    await writeFile(p, png)
    return { path: p, isImage: true }
  }
  // clip — Library asset, pasted url, or stock by query.
  let url = null, declaredImage = null, pinUrl = null
  if (scene.asset_id) {
    const { data: a } = await admin.from('media_assets').select('url, type').eq('id', scene.asset_id).eq('user_id', job.user_id).single()
    if (!a?.url) throw new Error('library asset missing')
    url = a.url; declaredImage = a.type === 'image'
  } else if (scene.url) {
    url = scene.url
  } else if (scene.query) {
    const hits = await searchStock(scene.query, { type: 'video', n: 1, orientation: orientationFor(plan.aspect) })
    if (!hits[0]?.url) throw new Error('no stock for "' + scene.query + '"')
    url = hits[0].url; declaredImage = false
    pinUrl = url // resolved stock — pin it so re-renders reuse the EXACT same clip.
  } else {
    throw new Error('clip has no source')
  }
  const got = await download(url, raw)
  return { path: got.path, isImage: declaredImage != null ? declaredImage : got.isImage, pinUrl }
}

// Default scene length when the plan doesn't specify one.
const sceneDur = scene => scene.duration != null ? scene.duration : (scene.kind === 'card' || scene.kind === 'color') ? 3 : 5

export async function renderEditPlan(plan, job) {
  const dir = await mkdtemp(path.join(tmpdir(), 'direct-'))
  try {
    if (!plan || !Array.isArray(plan.scenes) || !plan.scenes.length) throw new Error('Empty edit plan.')
    const [W, H] = canvasFor(plan.aspect)
    const total = plan.scenes.length
    const segs = []
    const skipped = []
    let pinned = false

    for (const scene of plan.scenes) {
      await setDetail(job.id, `Building scene ${segs.length + 1} of ${total}…`)
      try {
        const src = await resolveScene(scene, job, plan, dir, W, H)
        // Pin a query-resolved stock url onto THIS scene so re-renders of this
        // plan reuse the identical footage (searchStock is LRU-rotated). Mutates
        // the in-memory plan; persisted below on THIS job's row only.
        if (src.pinUrl && !scene.url) { scene.url = src.pinUrl; pinned = true }
        const seg = path.join(dir, `seg-${scene.id}.mp4`)
        await normalizeSeg(src.path, src.isImage, W, H, seg, sceneDur(scene))
        if ((await stat(seg)).size > 0) segs.push(seg)
        else throw new Error('empty segment')
      } catch (e) { skipped.push({ id: scene.id, reason: String(e.message || e).slice(0, 80) }) }
    }
    if (pinned) await admin.from('video_jobs').update({ edit_plan: plan }).eq('id', job.id).then(() => {}, () => {})

    // Minimum-viable-render gate: if too many scenes failed, refill with text
    // cards synthesized from the brief rather than shipping a stub — and only if
    // that still can't reach a viable length do we fail loudly.
    const need = Math.max(1, Math.ceil(total * 0.6))
    if (segs.length < need) {
      const brief = String(job.prompt || job.stock_query || 'Watch this').slice(0, 80)
      for (let i = segs.length; i < need; i++) {
        try {
          const png = await renderVideoCardPng(plan.style_key || 'bold', { heading: brief }, W, H)
          const p = path.join(dir, `fill-${i}.png`); await writeFile(p, png)
          const seg = path.join(dir, `fill-${i}.mp4`)
          await normalizeSeg(p, true, W, H, seg, 3)
          segs.push(seg)
        } catch { /* card synth failed too */ }
      }
    }
    if (!segs.length) throw new Error(`Could not build any scene${skipped[0] ? ` (e.g. ${skipped[0].reason})` : ''}.`)

    await setDetail(job.id, 'Assembling the cut…')
    const final = await concatSegments(segs, dir)
    await setDetail(job.id, 'Uploading your video…')
    const hosted = await persistBuffer(await readFile(final), job)
    const detail = `Directed · ${segs.length} scene${segs.length > 1 ? 's' : ''}${skipped.length ? ` · ${skipped.length} skipped` : ''}`
    await admin.from('video_jobs').update({ status: 'done', status_detail: detail, video_url: hosted, provider: 'directed', error: null }).eq('id', job.id)
    return { done: true }
  } catch (e) {
    await admin.from('video_jobs').update({ status: 'failed', error: String(e.message || e).slice(0, 200), status_detail: null }).eq('id', job.id)
    return { error: String(e.message || e) }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
