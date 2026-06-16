// lib/video.js — the generated-video render engine, the lib/clips.js analog for
// brand-new videos (not cut from a source). Three modes:
//   ai_video : Higgsfield text/image -> video (lib/video-gen.js)
//   ugc      : a still avatar + TTS voice -> lip-synced talking clip (Speak)
//   edit     : an ffmpeg montage of the user's Library media + external media
//
// The worker mirrors clips.js exactly: a stale-job sweep keyed on heartbeat_at,
// an atomic queued->processing claim so the create-kick and the cron backstop
// never double-process, and per-step status_detail writes that double as the
// liveness heartbeat. AI modes are gated behind ENABLE_AI_VIDEO — when off /
// unconfigured / out of credits the job resolves to status='needs_provider'
// (a clean "coming soon" card), never a crash. EDIT mode needs no provider.
import { admin } from './supabase'
import { generateAiVideo, generateUgcVideo, videoProviderStatus } from './video-gen'
import { buildMontage } from './video-edit'
import { searchStock } from './stock'
import { renderEditPlan } from './render-engine'

// Every status write doubles as the liveness heartbeat the stale sweep keys on.
async function setDetail(id, status_detail) {
  await admin.from('video_jobs').update({ status_detail, heartbeat_at: new Date().toISOString() }).eq('id', id)
}

async function persistBuffer(buf, job) {
  const sp = `${job.user_id}/${job.id}/video.mp4`
  const { error } = await admin.storage.from('videos').upload(sp, buf, { contentType: 'video/mp4', upsert: true, cacheControl: '31536000' })
  if (error) throw new Error('Upload failed: ' + error.message)
  return admin.storage.from('videos').getPublicUrl(sp).data.publicUrl
}

// Provider URLs are time-limited CDN links — re-host immediately so saved cards
// never point at a dead URL. Size-capped (no OOM) and retried a few times so a
// transient blip doesn't discard an already-paid-for render.
const PERSIST_MAX_BYTES = 200 * 1024 * 1024
async function persistFromUrl(url, job) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1500 * attempt))
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
      if (!r.ok) throw new Error(`fetch ${r.status}`)
      const len = Number(r.headers.get('content-length') || 0)
      if (len && len > PERSIST_MAX_BYTES) throw new Error('rendered video too large')
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > PERSIST_MAX_BYTES) throw new Error('rendered video too large')
      return await persistBuffer(buf, job)
    } catch (e) { lastErr = e; if (/too large/.test(String(e.message))) break }
  }
  throw new Error('Could not save the rendered video: ' + String(lastErr?.message || 'unknown'))
}

// Best-effort TTS for UGC (OpenAI -> WAV, which is what Higgsfield Speak needs).
// Returns a hosted .wav URL, or null when no TTS is configured.
async function ttsWav(text, job) {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: job?.voice || 'alloy', input: String(text || '').slice(0, 1500), response_format: 'wav' }),
    })
    if (!r.ok) return null
    const sp = `${job.user_id}/${job.id}/voice.wav`
    const { error } = await admin.storage.from('videos').upload(sp, Buffer.from(await r.arrayBuffer()), { contentType: 'audio/wav', upsert: true })
    if (error) return null
    return admin.storage.from('videos').getPublicUrl(sp).data.publicUrl
  } catch { return null }
}

// Map a provider {status,...} onto the job row + return a short worker result.
async function resolveProvider(job, res, providerName) {
  if (res.status === 'done' && res.url) {
    const hosted = await persistFromUrl(res.url, job)
    await admin.from('video_jobs').update({ status: 'done', status_detail: 'Ready', video_url: hosted, provider: providerName, error: null }).eq('id', job.id)
    return { done: true }
  }
  if (res.status === 'needs_provider') {
    await admin.from('video_jobs').update({ status: 'needs_provider', status_detail: res.detail === 'needs_credits' ? 'needs_credits' : null, error: null }).eq('id', job.id)
    return { needs_provider: true }
  }
  await admin.from('video_jobs').update({ status: 'failed', error: String(res.error || 'render failed').slice(0, 200), status_detail: null }).eq('id', job.id)
  return { error: res.error }
}

export async function processVideoJob(job) {
  try {
    // Directed: an LLM-emitted EditPlan lowered through the render engine. The
    // engine renders stock/card/clip scenes only (no AI provider) — AI/avatar
    // scenes are downgraded by the normalizer before persist (Phase 4 will add the
    // provider path), so a directed job needs no provider, exactly like mode:'edit'.
    if (job.mode === 'directed') return await renderEditPlan(job.edit_plan, job)

    if (job.mode === 'edit') {
      // Always-works path: montage the user's media + external + cached stock B-roll.
      await setDetail(job.id, 'Gathering your media…')
      let items = []
      if (Array.isArray(job.source_asset_ids) && job.source_asset_ids.length) {
        const { data: assets } = await admin.from('media_assets').select('id, url, type').in('id', job.source_asset_ids).eq('user_id', job.user_id)
        items = (assets || []).filter(a => a.url).map(a => ({ type: a.type, url: a.url }))
      }
      for (const u of (job.external_urls || [])) if (/^https?:\/\//.test(String(u))) items.push({ url: String(u) })
      // Stock B-roll from the content library (cached; pulls from Pexels on a miss).
      // If the user gave nothing, build the whole montage from stock; otherwise mix
      // in a few for variety.
      if (job.stock_query) {
        await setDetail(job.id, 'Pulling stock B-roll from the library…')
        const want = items.length ? 3 : 6
        const stock = await searchStock(job.stock_query, { type: 'video', n: want, orientation: job.aspect === 'wide' ? 'landscape' : 'portrait' })
        for (const s of stock) if (s.url) items.push({ type: 'video', url: s.url })
      }
      if (!items.length) { await admin.from('video_jobs').update({ status: 'failed', error: job.stock_query ? 'No stock clips found — add a PEXELS_API_KEY or attach your own media.' : 'No media to edit — attach Library media, paste a link, or give a stock topic.', status_detail: null }).eq('id', job.id); return { error: 'no media' } }
      await setDetail(job.id, `Editing ${items.length} clip${items.length > 1 ? 's' : ''} together…`)
      const { buffer, count, skipped = [] } = await buildMontage({ items, aspect: job.aspect || 'vertical' })
      await setDetail(job.id, 'Uploading your video…')
      const hosted = await persistBuffer(buffer, job)
      const detail = `Montage of ${count} clip${count > 1 ? 's' : ''}${skipped.length ? ` · ${skipped.length} skipped` : ''}`
      await admin.from('video_jobs').update({ status: 'done', status_detail: detail, video_url: hosted, provider: 'ffmpeg', error: null }).eq('id', job.id)
      return { done: true }
    }

    // AI modes are gated. Surface the gate cleanly before spending anything.
    const ps = videoProviderStatus()
    if (ps !== 'ready') {
      await admin.from('video_jobs').update({ status: 'needs_provider', status_detail: ps === 'disabled' ? 'disabled' : 'no_keys', error: null }).eq('id', job.id)
      return { needs_provider: true }
    }

    if (job.mode === 'ugc') {
      if (!job.image_url) {
        await admin.from('video_jobs').update({ status: 'needs_provider', status_detail: 'needs_avatar', error: null }).eq('id', job.id)
        return { needs_provider: true }
      }
      await setDetail(job.id, 'Recording the voiceover…')
      const audioUrl = await ttsWav(job.script || job.prompt, job)
      if (!audioUrl) {
        await admin.from('video_jobs').update({ status: 'needs_provider', status_detail: 'needs_tts', error: null }).eq('id', job.id)
        return { needs_provider: true }
      }
      await setDetail(job.id, 'Lip-syncing your spokesperson…')
      const res = await generateUgcVideo({ imageUrl: job.image_url, audioUrl, prompt: job.prompt || 'natural friendly delivery to camera', duration: job.duration_sec || 5 })
      return resolveProvider(job, res, 'higgsfield')
    }

    // ai_video
    await setDetail(job.id, job.image_url ? 'Animating your image…' : 'Generating your video…')
    const res = await generateAiVideo({ prompt: job.prompt || 'a cinematic short', imageUrl: job.image_url || null })
    return resolveProvider(job, res, 'higgsfield')
  } catch (e) {
    await admin.from('video_jobs').update({ status: 'failed', error: String(e.message || e).slice(0, 200), status_detail: null }).eq('id', job.id)
    return { error: String(e.message || e) }
  }
}

// Reconcile 'rendering' placeholder posts (created by ugc_influencer agents) with
// their finished talking-head jobs: attach the video_url and flip to queued
// (auto-post agents) or draft (review agents). A failed/dead render fails the post
// loudly rather than leaving it stuck. Idempotent + bounded; runs from cron.
export async function attachRenderedVideos({ limit = 30 } = {}) {
  const { data: pending } = await admin.from('posts')
    .select('id, video_job_id, feeder_agent_id, user_id, platform, source, created_at')
    .eq('status', 'rendering').not('video_job_id', 'is', null).limit(limit)
  if (!pending?.length) return { attached: 0 }
  let attached = 0
  for (const p of pending) {
    const { data: job } = await admin.from('video_jobs').select('status, video_url').eq('id', p.video_job_id).single()
    if (!job) { await admin.from('posts').update({ status: 'failed', error: 'render job missing' }).eq('id', p.id); continue }
    if (job.status === 'done' && job.video_url) {
      // Auto-post intent: feeder agents carry it on the agent row; IG/TikTok
      // autopilot carries it on the autopilot row for that user+platform.
      let queue = false
      if (p.feeder_agent_id) { const { data: a } = await admin.from('feeder_agents').select('auto_post').eq('id', p.feeder_agent_id).single(); queue = !!a?.auto_post }
      else if (p.source === 'autopilot') { const { data: ap } = await admin.from('autopilot').select('auto_post').eq('user_id', p.user_id).eq('platform', p.platform).maybeSingle(); queue = !!ap?.auto_post }
      await admin.from('posts').update({ video_url: job.video_url, status: queue ? 'queued' : 'draft', scheduled_for: new Date(Date.now() + 60000).toISOString() }).eq('id', p.id)
      attached++
    } else if (job.status === 'needs_provider') {
      // A config gap (no credits / provider off), not the user's content — drop the
      // placeholder cleanly instead of leaving a failed post they can't action.
      await admin.from('posts').delete().eq('id', p.id).then(() => {}, () => {})
    } else if (job.status === 'failed') {
      await admin.from('posts').update({ status: 'failed', error: 'video render failed' }).eq('id', p.id)
    } else if (Date.now() - new Date(p.created_at).getTime() > 60 * 60 * 1000) {
      // Stuck >1h with no terminal job state — don't leave a zombie placeholder.
      await admin.from('posts').update({ status: 'failed', error: 'video render timed out' }).eq('id', p.id)
    }
  }
  return { attached }
}

export async function processQueuedVideoJobs(maxJobs = 2) {
  // Recover jobs orphaned mid-render (crash/restart): staleness is the heartbeat,
  // not created_at — an old-but-alive job is fine; a silent one for 30 min is dead.
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  await admin.from('video_jobs').update({ status: 'queued', status_detail: 'Retrying after interruption…' })
    .eq('status', 'processing').lt('heartbeat_at', stale)

  const out = []
  for (let i = 0; i < maxJobs; i++) {
    const { data: candidate } = await admin.from('video_jobs').select('id').eq('status', 'queued').order('created_at').limit(1).single()
    if (!candidate) break
    // Atomic claim: only one worker wins queued->processing.
    const { data: claimed } = await admin.from('video_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() })
      .eq('id', candidate.id).eq('status', 'queued')
      .select()
    if (!claimed?.[0]) continue
    out.push(await processVideoJob(claimed[0]))
  }
  return out
}
