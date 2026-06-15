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
import { normalizeSeg, download, concatSegments, canvasFor, reframe, ENCODE_ARGS, run } from './video-edit'
import { searchStock } from './stock'
import { renderVideoCardPng } from './slideshow'
import { normalizeEditPlanV2 } from './edit-plan'
import { anchorExpr, fadeAlphaExpr, elemWidthPx, fontPx } from './overlay-coords'

// Worker ffmpeg capabilities (Phase-0 probe). Gates for xfade/zoompan also require
// the matching flag here — keep false until the PROD worker is probed; Phase-1a
// uses only proven primitives (drawtext/overlay/scale/fade) so these stay unused.
const WORKER_FILTERS = { xfade: false, zoompan: false, acrossfade: false }

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts')
const FONT_FILE = { anton: 'Anton.ttf', inter: 'Inter-ExtraBold.ttf', playfair: 'PlayfairDisplay-Bold.ttf' }
const ffHex = h => '0x' + String(h || '#FFFFFF').replace('#', '').slice(0, 6)
const ffHexA = h => { const m = String(h || '').replace('#', ''); return { color: '0x' + m.slice(0, 6), alpha: (m.length >= 8 ? parseInt(m.slice(6, 8), 16) / 255 : 1) } }

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

export async function renderEditPlan(rawPlan, job) {
  const dir = await mkdtemp(path.join(tmpdir(), 'direct-'))
  try {
    if (!rawPlan || !Array.isArray(rawPlan.scenes) || !rawPlan.scenes.length) throw new Error('Empty edit plan.')
    // Defense in depth: re-assert the IR bounds (scene cap, enum/duration clamps,
    // AI-scene downgrade) at render time, so any writer of edit_plan — now or
    // later — can't smuggle an un-normalized plan into ffmpeg. Idempotent on an
    // already-normalized plan.
    const { plan } = normalizeEditPlan(rawPlan, { brief: String(job.prompt || ''), wantsGen: false, genReady: false })
    if (!plan.scenes.length) throw new Error('Empty edit plan.')
    const [W, H] = canvasFor(plan.aspect)
    const total = plan.scenes.length
    // A scene that points at concrete footage (the user's own clip or a Library
    // asset) — if the ONLY such scene dies, a generic brief-card refill would
    // masquerade as the edit, so we fail loudly instead (see the gate below).
    const hadSourcedClip = plan.scenes.some(s => (s.kind === 'clip' || !s.kind) && (s.url || s.asset_id))
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

    // Honesty gate: if every scene failed and the plan was anchored to the user's
    // OWN footage (a lifted video / Library asset), don't dress up a generic text
    // card as their edit — fail with a clear, actionable message instead.
    if (!segs.length && hadSourcedClip) {
      const why = skipped.find(s => /no longer available/i.test(s.reason)) ? 'The original footage is no longer available.' : 'Could not load the footage for this edit.'
      throw new Error(`${why} Re-pick footage and try again.`)
    }

    // Minimum-viable-render gate: if too many scenes failed, refill with text
    // cards synthesized from the brief rather than shipping a stub — and only if
    // that still can't reach a viable length do we fail loudly. The refill card is
    // identical for every slot, so render it ONCE and reuse the seg file.
    const need = Math.max(1, Math.ceil(total * 0.6))
    if (segs.length < need) {
      const brief = String(job.prompt || job.stock_query || 'Watch this').slice(0, 80)
      let fillSeg = null
      try {
        const png = await renderVideoCardPng(plan.style_key || 'bold', { heading: brief }, W, H)
        const p = path.join(dir, 'fill.png'); await writeFile(p, png)
        fillSeg = path.join(dir, 'fill.mp4')
        await normalizeSeg(p, true, W, H, fillSeg, 3)
      } catch { fillSeg = null /* card synth failed too */ }
      if (fillSeg) for (let i = segs.length; i < need; i++) segs.push(fillSeg)
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
