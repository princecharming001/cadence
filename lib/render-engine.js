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

// Resolve an IMAGE overlay element to a local file (Library asset or pasted url).
async function resolveElementImg(el, job, dir, key) {
  let url = null
  if (el.asset_id) {
    const { data: a } = await admin.from('media_assets').select('url').eq('id', el.asset_id).eq('user_id', job.user_id).single()
    if (!a?.url) throw new Error('element asset missing')
    url = a.url
  } else if (el.url) url = el.url
  else throw new Error('element has no source')
  const got = await download(url, path.join(dir, key))
  return got.path
}

// Render ONE scene = a background + timed/positioned overlay elements → a single
// ffmpeg filtergraph segment. text → drawtext (brand fontfile, anchored via
// text_w/text_h, time-gated via enable=between(t,a,b), optional fade/stroke/box);
// image → scaled overlay (anchored via overlay_w/overlay_h). Encoder params ==
// normalizeSeg's (ENCODE_ARGS) so the segment stays concat -c copy compatible.
async function compositeScene(scene, src, job, dir, W, H, out, dur) {
  const els = scene.elements || []
  // Resolve image elements to inputs first (text needs none — drawtext is inline).
  const imgInputs = []
  for (const el of els) {
    if (el.type !== 'image') continue
    try { imgInputs.push({ el, path: await resolveElementImg(el, job, dir, `img-${scene.id}-${el.id}`) }) }
    catch { /* drop a broken image element, keep the scene */ }
  }
  const t = String(dur)
  const inArgs = ['-y']
  if (src.isImage) inArgs.push('-loop', '1', '-t', t, '-i', src.path)
  else inArgs.push('-t', t, '-i', src.path)
  for (const im of imgInputs) inArgs.push('-loop', '1', '-t', t, '-i', im.path)

  const fc = [`[0:v]${reframe(W, H)}[bg]`]
  // Pre-scale + fade/opacity each image input → [img0],[img1],…
  imgInputs.forEach((im, i) => {
    const start = im.el.start != null ? im.el.start : 0, end = im.el.end != null ? im.el.end : dur
    let chain = `[${i + 1}:v]scale=${elemWidthPx(im.el.scale, W)}:-1,format=rgba`
    if (im.el.anim?.in === 'fade') chain += `,fade=t=in:st=${start.toFixed(3)}:d=0.35:alpha=1`
    if (im.el.anim?.out === 'fade') chain += `,fade=t=out:st=${Math.max(start, end - 0.35).toFixed(3)}:d=0.35:alpha=1`
    if (im.el.opacity < 1) chain += `,colorchannelmixer=aa=${im.el.opacity}`
    fc.push(`${chain}[img${i}]`)
  })

  // Walk elements in z-order, chaining drawtext (text) + overlay (image) onto [bg].
  let last = 'bg', step = 0, imgI = 0
  for (const el of els) {
    const start = el.start != null ? el.start : 0, end = el.end != null ? el.end : dur
    const enable = `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`
    if (el.type === 'text') {
      const txtFile = path.join(dir, `txt-${scene.id}-${el.id}.txt`)
      await writeFile(txtFile, el.text)
      const fontfile = path.join(FONTS_DIR, FONT_FILE[el.font] || FONT_FILE.anton)
      const { x, y } = anchorExpr(el, 'text_w', 'text_h')
      let dt = `drawtext=fontfile='${fontfile}':textfile='${txtFile}':fontsize=${fontPx(el.size, H)}:fontcolor=${ffHex(el.color)}:x=${x}:y=${y}:${enable}`
      const fade = fadeAlphaExpr(el, start, end)
      const alpha = fade && el.opacity < 1 ? `(${fade})*${el.opacity}` : fade || (el.opacity < 1 ? String(el.opacity) : null)
      if (alpha) dt += `:alpha='${alpha}'`
      if (el.stroke && el.stroke.width > 0) dt += `:borderw=${Math.round(el.stroke.width)}:bordercolor=${ffHex(el.stroke.color)}`
      if (el.box) { const b = ffHexA(el.box.color); dt += `:box=1:boxcolor=${b.color}@${b.alpha.toFixed(2)}:boxborderw=${Math.round(el.box.pad)}` }
      fc.push(`[${last}]${dt}[v${step}]`); last = `v${step}`; step++
    } else if (el.type === 'image') {
      const im = imgInputs[imgI]
      if (!im || im.el !== el) continue // this image element was dropped (unresolved)
      const { x, y } = anchorExpr(el, 'overlay_w', 'overlay_h')
      fc.push(`[${last}][img${imgI}]overlay=x=${x}:y=${y}:${enable}[v${step}]`); last = `v${step}`; step++; imgI++
    }
  }
  await run('ffmpeg', [...inArgs, '-filter_complex', fc.join(';'), '-map', `[${last}]`, '-an', ...ENCODE_ARGS, out])
  return out
}

export async function renderEditPlan(rawPlan, job) {
  const dir = await mkdtemp(path.join(tmpdir(), 'direct-'))
  try {
    if (!rawPlan || !Array.isArray(rawPlan.scenes) || !rawPlan.scenes.length) throw new Error('Empty edit plan.')
    // Defense in depth: re-assert the IR bounds (scene cap, enum/duration clamps,
    // AI-scene downgrade) at render time, so any writer of edit_plan — now or
    // later — can't smuggle an un-normalized plan into ffmpeg. Idempotent on an
    // already-normalized plan.
    const { plan } = normalizeEditPlanV2(rawPlan, { brief: String(job.prompt || ''), wantsGen: false, genReady: false, workerFilters: WORKER_FILTERS })
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
        const dur = sceneDur(scene)
        // A scene with overlay elements goes through the compositing filtergraph;
        // a bare background reuses the proven, cheaper normalizeSeg. Both emit
        // ENCODE_ARGS-identical segments, so the concat -c copy fast path holds.
        if (Array.isArray(scene.elements) && scene.elements.length)
          await compositeScene(scene, src, job, dir, W, H, seg, dur)
        else
          await normalizeSeg(src.path, src.isImage, W, H, seg, dur)
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
