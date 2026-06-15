'use client'
// app/components/VideoEditor.js — a CapCut-style video editor over the EditPlan
// IR v2. Layout: a tabbed tools panel (Media/Text/Stickers/Transitions/Audio) ·
// a scaled 9:16 preview with MOVEABLE + RESIZABLE elements · a properties panel ·
// and a full-width MULTI-TRACK TIMELINE (a video roll of the scene clips + text /
// sticker / audio rolls) with a ruler, playhead, zoom, drag-to-trim, reorder, and
// a split (razor) tool. Coordinates are 0..1 fractions of the fixed 1080x1920
// canvas via lib/overlay-coords (the module the renderer also uses), and the UI
// mounts only what PHASE_GATES says the renderer honors — so nothing in the editor
// can be expressed that the export would drop. Export → the proven directed render.
import { useReducer, useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X as LX, Type, Image as LImage, Film, Plus, Trash2, Undo2, Redo2, Play, Pause, ChevronDown, Search, Layers, Sparkles, Loader2, Scissors, ZoomIn, ZoomOut, Music, Wand2, SkipBack } from 'lucide-react'
import { normalizeEditPlanV2, FONTS, ANCHORS, MAX_ELEMENTS, MAX_SCENES, STYLE_KEYS, TRANSITIONS_V2, PHASE_GATES, MAX_CLIP_DUR } from '@/lib/edit-plan'
import { clamp01, cssAnchorStyle } from '@/lib/overlay-coords'
import { SLIDE_STYLES, FONT_CSS, FONT_CAPS } from '@/lib/style-tokens'

const spring = { type: 'spring', stiffness: 380, damping: 32 }
const clone = p => (typeof structuredClone === 'function' ? structuredClone(p) : JSON.parse(JSON.stringify(p)))
const clampN = (v, lo, hi) => Math.min(Math.max(Number(v) || 0, lo), hi)
const sceneSecs = s => s.duration != null ? s.duration : (s.kind === 'card' || s.kind === 'color') ? 3 : 5
const maxDurFor = s => (s.kind === 'clip' || s.kind === 'ai_video') ? MAX_CLIP_DUR : 15
const uid = pfx => pfx + Math.random().toString(36).slice(2, 8)
const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s / 60), ss = Math.floor(s % 60), f = Math.floor((s % 1) * 30); return `${m}:${String(ss).padStart(2, '0')}.${String(f).padStart(2, '0')}` }

const updScene = (plan, i, fn) => ({ ...plan, scenes: plan.scenes.map((s, j) => j === i ? fn(s) : s) })
const updEl = (plan, i, id, patch) => updScene(plan, i, s => ({ ...s, elements: s.elements.map(e => e.id === id ? { ...e, ...patch } : e) }))

const blankText = () => ({ id: uid('e'), type: 'text', text: 'Your text', font: 'anton', size: 0.08, color: '#FFFFFF', stroke: { color: '#000000', width: 8 }, box: null, align: 'center', multiline: false, x: 0.5, y: 0.5, anchor: 'center', scale: 0.8, opacity: 1, rotation: 0, start: null, end: null, anim: { in: 'none', out: 'none', move: null } })
const blankImage = url => ({ id: uid('e'), type: 'image', url, asset_id: null, x: 0.5, y: 0.5, anchor: 'center', scale: 0.35, opacity: 1, rotation: 0, start: null, end: null, anim: { in: 'none', out: 'none', move: null } })
const blankClipScene = () => ({ id: uid('s'), kind: 'clip', query: '', url: null, asset_id: null, duration: 5, transition: 'cut', transition_dur: 0.4, motion: null, trim_start: null, trim_end: null, elements: [] })
const blankCardScene = () => ({ id: uid('s'), kind: 'card', eyebrow: null, heading: 'New scene', body: null, duration: 3, transition: 'cut', transition_dur: 0.4, motion: null, elements: [] })

// cumulative scene start times + total duration
function timeline(plan) {
  const starts = []; let acc = 0
  for (const s of plan.scenes) { starts.push(acc); acc += sceneSecs(s) }
  return { starts, total: acc }
}

function reducer(s, a) {
  switch (a.type) {
    case 'snapshot': return { ...s, past: [...s.past, s.plan].slice(-80), future: [] }
    case 'live': return { ...s, plan: a.plan }
    case 'commit': return { ...s, past: [...s.past, s.plan].slice(-80), plan: a.plan, future: [] }
    case 'undo': return s.past.length ? { plan: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.plan, ...s.future].slice(0, 80) } : s
    case 'redo': return s.future.length ? { plan: s.future[0], future: s.future.slice(1), past: [...s.past, s.plan].slice(-80) } : s
    default: return s
  }
}

function usePoll(jobId, authed, onTerminal) {
  const [job, setJob] = useState(null)
  useEffect(() => {
    if (!jobId) return
    let alive = true, tries = 0, timer
    const tick = async () => {
      try { const r = await authed(`/api/video?id=${jobId}`); const j = (await r.json()).job; if (alive && j) { setJob(j); if (['done', 'failed', 'needs_provider'].includes(j.status)) { onTerminal && onTerminal(j); return } } } catch { /* keep polling */ }
      if (alive && ++tries < 200) timer = setTimeout(tick, 4000)
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [jobId]) // eslint-disable-line
  return job
}

export default function VideoEditor({ job, authed, onRerendered, onClose }) {
  const initial = useMemo(() => {
    if (job.edit_plan?.scenes?.length) return job.edit_plan.version === 2 ? clone(job.edit_plan) : normalizeEditPlanV2(job.edit_plan, {}).plan
    return { version: 2, aspect: job.aspect || 'vertical', captions: 'off', style_key: job.style_key || 'bold', audio: null,
      scenes: [{ id: 's0', kind: 'clip', url: job.video_url || null, query: null, asset_id: null, duration: null, transition: 'cut', transition_dur: 0.4, motion: null, trim_start: null, trim_end: null, elements: [] }] }
  }, [job])

  const [state, dispatch] = useReducer(reducer, null, () => ({ plan: initial, past: [], future: [] }))
  const { plan } = state
  const { starts, total } = useMemo(() => timeline(plan), [plan])

  const [globalT, setGlobalT] = useState(0)
  const [selEl, setSelEl] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [pps, setPps] = useState(26)          // timeline pixels per second (zoom)
  const [tab, setTab] = useState('media')
  const [picker, setPicker] = useState(null)
  const [exportId, setExportId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState('')
  const [downgrades, setDowngrades] = useState([])
  const stageRef = useRef(null)
  const videoRef = useRef(null)
  const tlRef = useRef(null)
  const doneRef = useRef(false)

  // active scene = the one under the playhead
  const activeIdx = useMemo(() => { let i = 0; for (let j = 0; j < starts.length; j++) if (globalT >= starts[j] - 1e-6) i = j; return Math.min(i, plan.scenes.length - 1) }, [starts, globalT, plan.scenes.length])
  const scene = plan.scenes[activeIdx] || plan.scenes[0]
  const localT = Math.max(0, globalT - (starts[activeIdx] || 0))
  const dur = sceneSecs(scene)
  const selectedEl = scene.elements.find(e => e.id === selEl) || null

  const commit = useCallback(p => dispatch({ type: 'commit', plan: p }), [])
  const live = useCallback(p => dispatch({ type: 'live', plan: p }), [])
  const snapshot = useCallback(() => dispatch({ type: 'snapshot' }), [])

  // stage scale published as css vars so element px math divides by the live size
  useEffect(() => {
    const el = stageRef.current; if (!el) return
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); el.style.setProperty('--stage-w', r.width + 'px'); el.style.setProperty('--stage-h', r.height + 'px') })
    ro.observe(el); return () => ro.disconnect()
  }, [])

  // a lifted clip with unknown length: adopt the real duration once metadata loads
  const onBgMeta = e => {
    if (scene.kind === 'clip' && scene.url && scene.duration == null && e.target.duration) {
      commit(updScene(plan, activeIdx, s => ({ ...s, duration: clampN(Math.round(e.target.duration), 1, MAX_CLIP_DUR) })))
    }
  }

  // ── global playback: a wall clock drives the playhead + element timing; the
  // active scene's <video> is seeked on scene-change / scrub (not every frame) ──
  useEffect(() => {
    if (!playing) return
    let raf, prev = null, acc = 0
    const loop = ts => {
      if (prev == null) prev = ts
      const dt = (ts - prev) / 1000; prev = ts; acc += dt
      if (acc >= 0.05) { setGlobalT(g => { let n = g + acc; if (n >= total) n = 0; return n }); acc = 0 }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, total])
  useEffect(() => { // sync the preview <video> on scene change / play toggle
    const v = videoRef.current
    if (!v || !scene.url) return
    const target = (scene.trim_start || 0) + localT
    if (Math.abs(v.currentTime - target) > 0.4) { try { v.currentTime = target } catch {} }
    if (playing && v.paused) v.play().catch(() => {}); if (!playing && !v.paused) v.pause()
  }, [activeIdx, playing]) // eslint-disable-line

  function scrubTo(g) { setPlaying(false); setGlobalT(clampN(g, 0, total)) }

  // ── element drag on the canvas (pointer deltas ÷ stage px → fractions) ──
  function startDrag(e, el) {
    if (playing) return
    e.stopPropagation(); setSelEl(el.id)
    const rect = stageRef.current.getBoundingClientRect()
    const ox = el.x, oy = el.y, sx = e.clientX, sy = e.clientY; let moved = false
    const onMove = ev => {
      if (!moved) { moved = true; snapshot() }
      live(updEl(plan, activeIdx, el.id, { x: clamp01(ox + (ev.clientX - sx) / rect.width), y: clamp01(oy + (ev.clientY - sy) / rect.height) }))
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }
  // ── element resize via a corner handle (distance-from-anchor ratio → size/scale) ──
  function startResize(e, el) {
    if (playing) return
    e.stopPropagation(); setSelEl(el.id)
    const rect = stageRef.current.getBoundingClientRect()
    const cx = rect.left + el.x * rect.width, cy = rect.top + el.y * rect.height
    const d0 = Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy))
    const base = el.type === 'text' ? el.size : el.scale; let moved = false
    const onMove = ev => {
      if (!moved) { moved = true; snapshot() }
      const ratio = Math.max(8, Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0
      live(updEl(plan, activeIdx, el.id, el.type === 'text' ? { size: clampN(base * ratio, 0.02, 0.3) } : { scale: clampN(base * ratio, 0.03, 1) }))
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  // ── element / scene ops ──
  const addText = () => { if (scene.elements.length >= MAX_ELEMENTS) return; const el = blankText(); commit(updScene(plan, activeIdx, s => ({ ...s, elements: [...s.elements, el] }))); setSelEl(el.id) }
  const addImage = url => { if (scene.elements.length >= MAX_ELEMENTS) return; const el = blankImage(url); commit(updScene(plan, activeIdx, s => ({ ...s, elements: [...s.elements, el] }))); setSelEl(el.id); setPicker(null) }
  const delEl = id => { commit(updScene(plan, activeIdx, s => ({ ...s, elements: s.elements.filter(e => e.id !== id) }))); if (selEl === id) setSelEl(null) }
  const setEl = patch => commit(updEl(plan, activeIdx, selEl, patch))
  const setElLive = patch => live(updEl(plan, activeIdx, selEl, patch))

  const addScene = kind => { if (plan.scenes.length >= MAX_SCENES) return; const s = kind === 'card' ? blankCardScene() : blankClipScene(); commit({ ...plan, scenes: [...plan.scenes, s] }); setGlobalT(total + 0.01) }
  const delScene = i => { if (plan.scenes.length <= 1) return; commit({ ...plan, scenes: plan.scenes.filter((_, j) => j !== i) }); setSelEl(null); setGlobalT(Math.max(0, (starts[i] || 0) - 0.01)) }
  const setSceneLive = patch => live(updScene(plan, activeIdx, s => ({ ...s, ...patch })))
  const setSceneCommit = patch => commit(updScene(plan, activeIdx, s => ({ ...s, ...patch })))
  const setStyle = k => commit({ ...plan, style_key: k })
  const setBackground = sel => { commit(updScene(plan, activeIdx, s => ({ ...s, kind: sel.kind, url: sel.url ?? null, query: sel.query ?? null, asset_id: null, duration: sel.kind === 'card' ? (s.duration || 3) : s.duration, heading: sel.kind === 'card' ? (s.heading || 'New scene') : s.heading }))); setPicker(null) }

  // split the active scene at the playhead into two scenes (razor)
  function splitAtPlayhead() {
    if (localT < 0.3 || localT > dur - 0.3) return
    snapshot()
    const A = clone(scene), B = clone(scene)
    A.id = uid('s'); B.id = uid('s')
    A.duration = Math.round(localT * 10) / 10
    B.duration = Math.round((dur - localT) * 10) / 10
    if (scene.kind === 'clip') B.trim_start = (scene.trim_start || 0) + A.duration
    A.elements = []; B.elements = []
    for (const el of scene.elements) {
      const s0 = el.start ?? 0, e0 = el.end ?? dur
      if (s0 < localT) A.elements.push({ ...el, id: uid('e'), end: el.end == null ? null : Math.min(e0, localT) })
      if (e0 > localT) B.elements.push({ ...el, id: uid('e'), start: Math.max(0, s0 - localT), end: el.end == null ? null : (e0 - localT) })
    }
    commit({ ...plan, scenes: [...plan.scenes.slice(0, activeIdx), A, B, ...plan.scenes.slice(activeIdx + 1)] })
  }

  // keyboard
  useEffect(() => {
    const onKey = e => {
      const t = (document.activeElement?.tagName || '').toLowerCase()
      if (t === 'input' || t === 'textarea' || document.activeElement?.isContentEditable) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); setSelEl(null) }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selEl) { e.preventDefault(); delEl(selEl) }
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'Escape') setSelEl(null)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line

  // export
  async function doExport() {
    if (exporting) return
    setExporting(true); setExportErr(''); setDowngrades([])
    try {
      const r = await authed('/api/video', { method: 'POST', body: JSON.stringify({ mode: 'directed', edit_plan: plan, prompt: job.prompt || '', parent_job_id: job.id || null }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) { setExportErr(d.error || 'Could not start the render.'); setExporting(false); return }
      if (Array.isArray(d.downgrades) && d.downgrades.length) setDowngrades(d.downgrades)
      setExportId(d.job.id)
    } catch { setExportErr('Could not reach the server — try again.'); setExporting(false) }
  }
  const exportJob = usePoll(exportId, authed, j => { if (j.status === 'done' && !doneRef.current) { doneRef.current = true; onRerendered && onRerendered() } })
  const style = SLIDE_STYLES[plan.style_key] || SLIDE_STYLES.bold

  return (
    <motion.div className="ve-overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <VeStyles />
      <motion.div className="ve" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.99 }} transition={spring}>
        <div className="ve-top">
          <div className="ve-top-l"><Layers size={15} /><b>Video editor</b></div>
          <div className="ve-top-c">
            <button className="ve-ic" title="Undo (⌘Z)" disabled={!state.past.length} onClick={() => { dispatch({ type: 'undo' }); setSelEl(null) }}><Undo2 size={15} /></button>
            <button className="ve-ic" title="Redo (⇧⌘Z)" disabled={!state.future.length} onClick={() => { dispatch({ type: 'redo' }); setSelEl(null) }}><Redo2 size={15} /></button>
          </div>
          <div className="ve-top-r">
            <div className="ve-style">{STYLE_KEYS.map(k => <button key={k} className={'ve-sw' + (plan.style_key === k ? ' on' : '')} title={k} style={{ background: (SLIDE_STYLES[k] || {}).bg }} onClick={() => setStyle(k)} />)}</div>
            <button className="ve-export" disabled={exporting} onClick={doExport}>{exporting ? <Loader2 size={14} className="ve-spin" /> : <Sparkles size={14} />} Export</button>
            <button className="ve-ic" onClick={onClose}><LX size={17} /></button>
          </div>
        </div>

        {exportId ? (
          <ExportView job={exportJob} downgrades={downgrades} onBack={() => { doneRef.current = false; setExportId(null); setExporting(false) }} onClose={onClose} />
        ) : (
          <>
            <div className="ve-main">
              {/* tools panel */}
              <div className="ve-tools">
                <div className="ve-tabs">
                  {[['media', Film, 'Media'], ['text', Type, 'Text'], ['sticker', LImage, 'Sticker'], ['fx', Wand2, 'Transitions'], ['audio', Music, 'Audio']].map(([k, Ic, lbl]) => (
                    <button key={k} className={'ve-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}><Ic size={17} /><span>{lbl}</span></button>
                  ))}
                </div>
                <div className="ve-tabbody">
                  {tab === 'media' && <>
                    <button className="ve-btn full" onClick={() => setPicker({ for: 'background' })}><Film size={13} /> Change footage</button>
                    <button className="ve-btn full" onClick={() => addScene('clip')}><Plus size={13} /> Add clip scene</button>
                    <button className="ve-btn full" onClick={() => addScene('card')}><Plus size={13} /> Add text card</button>
                    <div className="ve-muted">{plan.scenes.length}/{MAX_SCENES} scenes · {fmtT(total)} total</div>
                  </>}
                  {tab === 'text' && <>
                    <button className="ve-btn full" disabled={scene.elements.length >= MAX_ELEMENTS} onClick={addText}><Type size={13} /> Add text</button>
                    <div className="ve-muted">Adds to the scene under the playhead. Drag it on the canvas; drag a corner to resize.</div>
                  </>}
                  {tab === 'sticker' && <>
                    <button className="ve-btn full" disabled={scene.elements.length >= MAX_ELEMENTS} onClick={() => setPicker({ for: 'image' })}><LImage size={13} /> Add image / logo</button>
                    <div className="ve-muted">A PNG/logo or a stock image, placed over the scene.</div>
                  </>}
                  {tab === 'fx' && <>
                    <label className="ve-lab">Transition into the next scene</label>
                    <div className="ve-grid2">{TRANSITIONS_V2.map(tr => <button key={tr} className={'ve-chip' + (scene.transition === tr ? ' on' : '')} disabled={activeIdx >= plan.scenes.length - 1} onClick={() => setSceneCommit({ transition: tr })}>{tr}</button>)}</div>
                    <label className="ve-f wide"><span>Length {scene.transition_dur ?? 0.4}s</span><input type="range" min={0.2} max={1.5} step={0.1} value={scene.transition_dur ?? 0.4} onPointerDown={snapshot} onChange={e => setSceneLive({ transition_dur: Number(e.target.value) })} /></label>
                    {PHASE_GATES.kenBurns && (scene.kind === 'card' || scene.kind === 'color') && <button className={'ve-btn full' + (scene.motion === 'kenBurns' ? ' on' : '')} onClick={() => setSceneCommit({ motion: scene.motion === 'kenBurns' ? null : 'kenBurns' })}><ZoomIn size={13} /> Ken Burns zoom {scene.motion === 'kenBurns' ? '✓' : ''}</button>}
                  </>}
                  {tab === 'audio' && <div className="ve-muted">The clip's own audio is muted in the export for now. A music track + per-clip audio land in the next update.</div>}
                </div>
              </div>

              {/* preview */}
              <div className="ve-stagewrap">
                <div className="ve-stage" ref={stageRef} onPointerDown={() => setSelEl(null)}>
                  <Background scene={scene} style={style} videoRef={videoRef} onMeta={onBgMeta} />
                  {scene.elements.map(el => {
                    const visible = (el.start == null || localT >= el.start) && (el.end == null || localT < el.end)
                    return <CanvasEl key={el.id} el={el} selected={selEl === el.id} dimmed={!visible} onDrag={e => startDrag(e, el)} onResize={e => startResize(e, el)} />
                  })}
                  {scene.kind === 'clip' && !scene.url && <div className="ve-hint">Pick footage in “Media,” then add text or a logo</div>}
                </div>
                <div className="ve-transport">
                  <button className="ve-ic" title="Start" onClick={() => scrubTo(0)}><SkipBack size={14} /></button>
                  <button className="ve-ic" onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
                  <span className="ve-time">{fmtT(globalT)} / {fmtT(total)}</span>
                </div>
              </div>

              {/* properties */}
              <div className="ve-props">
                {selectedEl ? <ElementProps el={selectedEl} onLive={setElLive} onCommit={setEl} onSnap={snapshot} onDelete={() => delEl(selectedEl.id)} dur={dur} />
                  : <SceneProps scene={scene} onLive={setSceneLive} onCommit={setSceneCommit} onSnap={snapshot} onBackground={() => setPicker({ for: 'background' })} canTransition={activeIdx < plan.scenes.length - 1} />}
              </div>
            </div>

            {/* ── TIMELINE ── */}
            <div className="ve-tl">
              <div className="ve-tl-bar">
                <button className="ve-ic" title="Split at playhead" onClick={splitAtPlayhead}><Scissors size={14} /></button>
                <button className="ve-ic" title="Delete scene" disabled={plan.scenes.length <= 1} onClick={() => delScene(activeIdx)}><Trash2 size={13} /></button>
                <span className="ve-tl-t">{fmtT(globalT)}</span>
                <span style={{ flex: 1 }} />
                <button className="ve-ic" onClick={() => setPps(p => Math.max(8, p - 6))}><ZoomOut size={14} /></button>
                <button className="ve-ic" onClick={() => setPps(p => Math.min(80, p + 6))}><ZoomIn size={14} /></button>
              </div>
              <Timeline plan={plan} starts={starts} total={total} pps={pps} globalT={globalT} activeIdx={activeIdx} selEl={selEl} tlRef={tlRef}
                onScrub={scrubTo} onSelectScene={i => scrubTo((starts[i] || 0) + 0.01)}
                onSelectEl={(i, id) => { scrubTo((starts[i] || 0) + ((plan.scenes[i].elements.find(e => e.id === id)?.start) || 0) + 0.01); setSelEl(id) }}
                snapshot={snapshot} live={live} commit={commit} updScene={updScene} updEl={updEl} clampN={clampN} maxDurFor={maxDurFor} sceneSecs={sceneSecs} />
            </div>
          </>
        )}
      </motion.div>

      {picker && <MediaPicker kind={picker.for} authed={authed} onClose={() => setPicker(null)} onPick={sel => picker.for === 'image' ? addImage(sel.url) : setBackground(sel)} onCard={() => setBackground({ kind: 'card' })} />}
    </motion.div>
  )
}

// ── multi-track timeline ──
function Timeline({ plan, starts, total, pps, globalT, activeIdx, selEl, tlRef, onScrub, onSelectScene, onSelectEl, snapshot, live, commit, updScene, updEl, clampN, maxDurFor, sceneSecs }) {
  const innerRef = useRef(null)
  const W = Math.max(total * pps + 40, 200)
  const xToT = clientX => { const r = innerRef.current.getBoundingClientRect(); return (clientX - r.left) / pps }

  function rulerDown(e) {
    if (e.target.closest('.ve-clip') || e.target.closest('.ve-elbar')) return
    onScrub(xToT(e.clientX))
    const onMove = ev => onScrub(xToT(ev.clientX))
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  // drag a scene clip: body = reorder; left/right edge = trim/duration
  function sceneDown(e, i, edge) {
    e.stopPropagation()
    const sc = plan.scenes[i]; onSelectScene(i)
    const sx = e.clientX; const oDur = sceneSecs(sc); const oTrim = sc.trim_start || 0; let moved = false
    const onMove = ev => {
      const dT = (ev.clientX - sx) / pps
      if (!moved && Math.abs(ev.clientX - sx) > 3) { moved = true; snapshot() }
      if (!moved) return
      if (edge === 'right') live(updScene(plan, i, s => ({ ...s, duration: clampN(oDur + dT, 1, sc.kind === 'clip' || sc.kind === 'ai_video' ? maxDurFor(s) : 15) })))
      else if (edge === 'left') {
        const nd = clampN(oDur - dT, 1, maxDurFor(sc))
        const delta = oDur - nd
        live(updScene(plan, i, s => ({ ...s, duration: nd, ...(sc.kind === 'clip' ? { trim_start: Math.max(0, oTrim + delta) } : {}) })))
      }
    }
    const onUp = ev => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
      if (edge === 'body' && moved) { // reorder by drop position
        const dropT = (starts[i] || 0) + sceneSecs(plan.scenes[i]) / 2 + (ev.clientX - sx) / pps
        let ni = 0; for (let j = 0; j < starts.length; j++) if (dropT > (starts[j] || 0)) ni = j
        if (ni !== i) { const a = plan.scenes.slice(); const [m] = a.splice(i, 1); a.splice(ni, 0, m); commit({ ...plan, scenes: a }) }
      }
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  // drag a text/image element bar: body = retime; edges = start/end (within scene)
  function elDown(e, i, el, edge) {
    e.stopPropagation()
    onSelectEl(i, el.id)
    const sc = plan.scenes[i]; const sd = sceneSecs(sc)
    const s0 = el.start ?? 0, e0 = el.end ?? sd; const span = e0 - s0; const sx = e.clientX; let moved = false
    const onMove = ev => {
      const dT = (ev.clientX - sx) / pps
      if (!moved && Math.abs(ev.clientX - sx) > 3) { moved = true; snapshot() }
      if (!moved) return
      if (edge === 'body') { const ns = clampN(s0 + dT, 0, sd - span); live(updEl(plan, i, el.id, { start: ns, end: ns + span })) }
      else if (edge === 'left') { const ns = clampN(s0 + dT, 0, e0 - 0.2); live(updEl(plan, i, el.id, { start: ns })) }
      else { const ne = clampN(e0 + dT, s0 + 0.2, sd); live(updEl(plan, i, el.id, { end: ne })) }
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  const texts = [], imgs = []
  plan.scenes.forEach((s, i) => s.elements.forEach(el => (el.type === 'image' ? imgs : texts).push({ i, el })))
  const ticks = []; const step = pps < 16 ? 5 : pps < 34 ? 2 : 1
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(t)

  return (
    <div className="ve-tl-body">
      <div className="ve-tl-labels">
        <div className="ve-tl-lab" style={{ height: 22 }} />
        <div className="ve-tl-lab">Video</div><div className="ve-tl-lab">Text</div><div className="ve-tl-lab">Sticker</div><div className="ve-tl-lab">Audio</div>
      </div>
      <div className="ve-tl-scroll" ref={tlRef}>
        <div className="ve-tl-inner" ref={innerRef} style={{ width: W }} onPointerDown={rulerDown}>
          <div className="ve-ruler">{ticks.map(t => <span key={t} className="ve-tick" style={{ left: t * pps }}>{fmtT(t).replace(/\.\d+$/, '')}</span>)}</div>
          <div className="ve-playhead" style={{ left: globalT * pps }} />
          {/* video roll */}
          <div className="ve-track">
            {plan.scenes.map((s, i) => (
              <div key={s.id} className={'ve-clip' + (i === activeIdx ? ' on' : '')} style={{ left: (starts[i] || 0) * pps, width: Math.max(14, sceneSecs(s) * pps) }} onPointerDown={e => sceneDown(e, i, 'body')}>
                <span className="ve-clip-h" onPointerDown={e => sceneDown(e, i, 'left')} />
                <span className="ve-clip-lbl">{s.kind === 'card' ? (s.heading || 'Card') : s.kind === 'color' ? 'Color' : 'Clip'}{s.motion === 'kenBurns' ? ' ⤢' : ''}</span>
                <span className="ve-clip-h r" onPointerDown={e => sceneDown(e, i, 'right')} />
                {i < plan.scenes.length - 1 && s.transition !== 'cut' && <span className="ve-xf" title={s.transition} />}
              </div>
            ))}
          </div>
          {/* text roll */}
          <div className="ve-track">
            {texts.map(({ i, el }) => { const s0 = (starts[i] || 0) + (el.start ?? 0), s1 = (starts[i] || 0) + (el.end ?? sceneSecs(plan.scenes[i])); return (
              <div key={el.id} className={'ve-elbar text' + (selEl === el.id ? ' on' : '')} style={{ left: s0 * pps, width: Math.max(12, (s1 - s0) * pps) }} onPointerDown={e => elDown(e, i, el, 'body')}>
                <span className="ve-elbar-h" onPointerDown={e => elDown(e, i, el, 'left')} /><span className="ve-elbar-lbl">{el.text || 'text'}</span><span className="ve-elbar-h r" onPointerDown={e => elDown(e, i, el, 'right')} />
              </div>) })}
          </div>
          {/* sticker roll */}
          <div className="ve-track">
            {imgs.map(({ i, el }) => { const s0 = (starts[i] || 0) + (el.start ?? 0), s1 = (starts[i] || 0) + (el.end ?? sceneSecs(plan.scenes[i])); return (
              <div key={el.id} className={'ve-elbar img' + (selEl === el.id ? ' on' : '')} style={{ left: s0 * pps, width: Math.max(12, (s1 - s0) * pps) }} onPointerDown={e => elDown(e, i, el, 'body')}>
                <span className="ve-elbar-h" onPointerDown={e => elDown(e, i, el, 'left')} /><span className="ve-elbar-lbl">image</span><span className="ve-elbar-h r" onPointerDown={e => elDown(e, i, el, 'right')} />
              </div>) })}
          </div>
          {/* audio roll (display-only until the audio update) */}
          <div className="ve-track audio"><div className="ve-elbar audio" style={{ left: 0, width: Math.max(12, total * pps) }}><span className="ve-elbar-lbl">audio · muted in export</span></div></div>
        </div>
      </div>
    </div>
  )
}

function Background({ scene, style, videoRef, onMeta }) {
  if (scene.kind === 'card' || scene.kind === 'color') {
    const bg = scene.kind === 'color' && scene.color ? scene.color : style.bg
    const caps = FONT_CAPS[style.display]
    return (
      <div className="ve-bg" style={{ background: bg.startsWith('linear') ? bg : undefined, backgroundColor: bg.startsWith('linear') ? undefined : bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '8%', textAlign: 'center' }}>
        {scene.kind === 'card' && <>
          <div style={{ fontFamily: FONT_CSS[style.display], color: style.fg, fontSize: 'calc(var(--stage-h) * 0.06)', lineHeight: 1.05, textTransform: caps ? 'uppercase' : 'none', fontWeight: 800 }}>{scene.heading || ''}</div>
          {scene.body && <div style={{ fontFamily: FONT_CSS.inter, color: style.muted, fontSize: 'calc(var(--stage-h) * 0.026)', marginTop: '4%' }}>{scene.body}</div>}
        </>}
      </div>
    )
  }
  if (scene.url) return <video className="ve-bg" ref={videoRef} src={scene.url} muted playsInline preload="metadata" onLoadedMetadata={onMeta} style={{ objectFit: 'cover' }} />
  return <div className="ve-bg ve-bg-empty"><Film size={28} />{scene.query ? <span>{scene.query}</span> : <span>No footage yet</span>}</div>
}

function CanvasEl({ el, selected, dimmed, onDrag, onResize }) {
  const common = { position: 'absolute', ...cssAnchorStyle(el), opacity: dimmed ? 0.25 : el.opacity, cursor: 'move', touchAction: 'none' }
  const handle = selected && PHASE_GATES.resizeHandle ? <span className="ve-rh" onPointerDown={onResize} /> : null
  if (el.type === 'text') {
    const caps = FONT_CAPS[el.font]
    const box = el.box ? { background: el.box.color, padding: `calc(var(--stage-w) * ${el.box.pad / 1080})`, borderRadius: `calc(var(--stage-w) * ${(el.box.radius || 0) / 1080})` } : {}
    const stroke = el.stroke && el.stroke.width > 0 ? { WebkitTextStroke: `calc(var(--stage-w) * ${el.stroke.width / 1080}) ${el.stroke.color}`, paintOrder: 'stroke fill' } : {}
    return (
      <div className={'ve-el' + (selected ? ' sel' : '')} style={common} onPointerDown={onDrag}>
        <div style={{ fontFamily: FONT_CSS[el.font], color: el.color, fontSize: `calc(var(--stage-h) * ${el.size})`, lineHeight: 1.05, whiteSpace: 'nowrap', textTransform: caps ? 'uppercase' : 'none', textAlign: el.align, fontWeight: el.font === 'inter' ? 800 : 400, ...stroke, ...box }}>{el.text || ' '}</div>
        {handle}
      </div>
    )
  }
  return (
    <div className={'ve-el' + (selected ? ' sel' : '')} style={{ ...common, width: `calc(var(--stage-w) * ${el.scale})` }} onPointerDown={onDrag}>
      <img src={el.url} alt="" draggable={false} style={{ width: '100%', height: 'auto', display: 'block', pointerEvents: 'none' }} />
      {handle}
    </div>
  )
}

function ElementProps({ el, onLive, onCommit, onSnap, onDelete, dur }) {
  const num = (label, key, min, max, step, scale = 1) => (
    <label className="ve-f"><span>{label}</span>
      <input type="number" inputMode="decimal" min={min} max={max} step={step} value={Math.round((el[key] ?? 0) * scale * 100) / 100}
        onFocus={onSnap} onChange={e => onLive({ [key]: Math.min(Math.max((Number(e.target.value) || 0) / scale, min / scale), max / scale) })} />
    </label>
  )
  return (
    <div className="ve-panel">
      <div className="ve-panel-h">{el.type === 'text' ? 'Text' : 'Image'}<button className="ve-ic sm danger" onClick={onDelete}><Trash2 size={13} /></button></div>
      {el.type === 'text' && <>
        <textarea className="ve-input" rows={2} value={el.text} onFocus={onSnap} onChange={e => onLive({ text: e.target.value.slice(0, 200) })} placeholder="Text…" />
        <div className="ve-row">{FONTS.map(f => <button key={f} className={'ve-chip' + (el.font === f ? ' on' : '')} style={{ fontFamily: FONT_CSS[f] }} onClick={() => onCommit({ font: f })}>{f}</button>)}</div>
        <div className="ve-row">
          <label className="ve-f"><span>Color</span><input type="color" value={el.color} onFocus={onSnap} onChange={e => onLive({ color: e.target.value })} /></label>
          <label className="ve-f"><span>Outline</span><input type="color" value={el.stroke?.color || '#000000'} onFocus={onSnap} onChange={e => onLive({ stroke: { color: e.target.value, width: el.stroke?.width ?? 8 } })} /></label>
        </div>
        <div className="ve-row">{num('Size', 'size', 2, 30, 0.5, 100)}
          <label className="ve-f"><span>Outline w</span><input type="number" min={0} max={30} step={1} value={el.stroke?.width ?? 0} onFocus={onSnap} onChange={e => onLive({ stroke: { color: el.stroke?.color || '#000000', width: Math.min(Math.max(Number(e.target.value) || 0, 0), 30) } })} /></label>
        </div>
        <div className="ve-row">{['left', 'center', 'right'].map(a => <button key={a} className={'ve-chip' + (el.align === a ? ' on' : '')} onClick={() => onCommit({ align: a })}>{a}</button>)}</div>
      </>}
      <div className="ve-row">{num('X %', 'x', 0, 100, 1, 100)}{num('Y %', 'y', 0, 100, 1, 100)}</div>
      <div className="ve-row">
        <label className="ve-f"><span>Anchor</span><select value={el.anchor} onChange={e => onCommit({ anchor: e.target.value })}>{ANCHORS.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
        {num('Opacity', 'opacity', 0, 100, 5, 100)}
      </div>
      {el.type === 'image' && num('Size %', 'scale', 3, 100, 1, 100)}
      <div className="ve-row">
        <label className="ve-f"><span>Start s</span><input type="number" min={0} max={dur} step={0.1} value={el.start ?? ''} placeholder="0" onFocus={onSnap} onChange={e => onLive({ start: e.target.value === '' ? null : Math.min(Math.max(Number(e.target.value) || 0, 0), dur) })} /></label>
        <label className="ve-f"><span>End s</span><input type="number" min={0} max={dur} step={0.1} value={el.end ?? ''} placeholder={String(dur)} onFocus={onSnap} onChange={e => onLive({ end: e.target.value === '' ? null : Math.min(Math.max(Number(e.target.value) || 0, 0), dur) })} /></label>
      </div>
      {PHASE_GATES.animFade && <div className="ve-row">
        <button className={'ve-chip' + (el.anim?.in === 'fade' ? ' on' : '')} onClick={() => onCommit({ anim: { ...el.anim, in: el.anim?.in === 'fade' ? 'none' : 'fade' } })}>Fade in</button>
        <button className={'ve-chip' + (el.anim?.out === 'fade' ? ' on' : '')} onClick={() => onCommit({ anim: { ...el.anim, out: el.anim?.out === 'fade' ? 'none' : 'fade' } })}>Fade out</button>
      </div>}
      <div className="ve-muted">Drag on the canvas to move · drag the corner dot to resize · drag the bar ends on the timeline to retime.</div>
    </div>
  )
}

function SceneProps({ scene, onLive, onCommit, onSnap, onBackground, canTransition }) {
  return (
    <div className="ve-panel">
      <div className="ve-panel-h">Scene</div>
      <button className="ve-btn full" onClick={onBackground}><Film size={13} /> Change background</button>
      {scene.kind === 'card' && <>
        <label className="ve-lab">Heading</label><input className="ve-input" value={scene.heading || ''} maxLength={80} onFocus={onSnap} onChange={e => onLive({ heading: e.target.value })} />
        <label className="ve-lab">Subtext</label><input className="ve-input" value={scene.body || ''} maxLength={160} onFocus={onSnap} onChange={e => onLive({ body: e.target.value })} />
      </>}
      {scene.kind === 'clip' && <><label className="ve-lab">Footage search (if no clip picked)</label><input className="ve-input" value={scene.query || ''} onFocus={onSnap} onChange={e => onLive({ query: e.target.value })} placeholder="e.g. coffee pour cafe" /></>}
      <label className="ve-f wide"><span>Duration {scene.duration ?? sceneSecs(scene)}s</span><input type="range" min={1} max={maxDurFor(scene)} step={0.5} value={scene.duration ?? sceneSecs(scene)} onPointerDown={onSnap} onChange={e => onLive({ duration: Number(e.target.value) })} /></label>
      {(scene.kind === 'card' || scene.kind === 'color') && PHASE_GATES.kenBurns && <button className={'ve-btn full' + (scene.motion === 'kenBurns' ? ' on' : '')} onClick={() => onCommit({ motion: scene.motion === 'kenBurns' ? null : 'kenBurns' })}><ZoomIn size={13} /> Ken Burns {scene.motion === 'kenBurns' ? '✓' : ''}</button>}
      {canTransition && <>
        <label className="ve-lab">Transition → next</label>
        <select className="ve-input" value={scene.transition} onChange={e => onCommit({ transition: e.target.value })}>{TRANSITIONS_V2.map(tr => <option key={tr} value={tr}>{tr}</option>)}</select>
      </>}
      <div className="ve-muted">Trim on the timeline: drag a clip’s ends. Split with the scissors. Drag the clip body to reorder.</div>
    </div>
  )
}

function MediaPicker({ kind, authed, onClose, onPick, onCard }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]); const [loading, setLoading] = useState(false); const [enabled, setEnabled] = useState(true); const [url, setUrl] = useState('')
  const type = kind === 'image' ? 'image' : 'video'
  async function search() {
    if (!q.trim()) return
    setLoading(true)
    try { const r = await authed(`/api/stock?q=${encodeURIComponent(q)}&type=${type}&n=12`); const d = await r.json(); setEnabled(d.enabled !== false); setHits(d.hits || []) } catch { setHits([]) }
    setLoading(false)
  }
  return (
    <motion.div className="ve-overlay" style={{ zIndex: 120 }} onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="ve-picker" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="ve-top"><div className="ve-top-l"><Search size={14} /><b>{kind === 'image' ? 'Add an image' : 'Choose footage'}</b></div><button className="ve-ic" onClick={onClose}><LX size={16} /></button></div>
        <div className="ve-pk-search"><input className="ve-input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder={kind === 'image' ? 'Search stock images…' : 'Search stock video…'} autoFocus /><button className="ve-btn" onClick={search} disabled={loading}>{loading ? <Loader2 size={13} className="ve-spin" /> : 'Search'}</button></div>
        {!enabled && <div className="ve-muted" style={{ padding: '0 14px' }}>Stock search needs a Pexels key — paste a direct media URL below, or use a text card.</div>}
        <div className="ve-pk-grid">
          {hits.map((h, i) => <button key={i} className="ve-pk-cell" onClick={() => onPick({ kind: 'clip', url: h.url, query: q })}>{type === 'video' ? <video src={h.url} muted preload="metadata" /> : <img src={h.thumb || h.url} alt="" />}</button>)}
          {!hits.length && !loading && <div className="ve-muted" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 20 }}>Search to find {type === 'image' ? 'images' : 'clips'}.</div>}
        </div>
        <div className="ve-pk-foot"><input className="ve-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="…or paste a direct media URL" /><button className="ve-btn" disabled={!/^https?:\/\//.test(url)} onClick={() => onPick(kind === 'image' ? { url } : { kind: 'clip', url })}>Use</button>{kind === 'background' && onCard && <button className="ve-btn ghost" onClick={onCard}>Text card</button>}</div>
      </motion.div>
    </motion.div>
  )
}

function ExportView({ job, downgrades, onBack, onClose }) {
  const s = job?.status
  return (
    <div className="ve-export-view">
      {downgrades?.length > 0 && s !== 'failed' && <div className="ve-note">Some things were adjusted to render: {downgrades.slice(0, 3).join('; ')}.</div>}
      {s === 'done' ? (<><video className="ve-export-vid" src={job.video_url} controls playsInline preload="metadata" /><div className="ve-muted">Your edited video is ready — it’s in Projects.</div><button className="ve-export" onClick={onClose}>Done</button></>)
        : s === 'failed' ? (<><div className="ve-err">{job.error || 'The render failed.'}</div><button className="ve-btn" onClick={onBack}>Back to edit</button></>)
          : s === 'needs_provider' ? (<div className="ve-muted">Generated video isn’t switched on for this edit.</div>)
            : (<div className="ve-rendering"><Loader2 size={26} className="ve-spin" /><span>Rendering your video…{job?.status_detail ? ` ${job.status_detail}` : ''}</span><span className="ve-muted">A minute or two — it’ll appear in Projects.</span></div>)}
    </div>
  )
}

function VeStyles() {
  return <style>{`
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;800&family=Playfair+Display:wght@700&display=swap');
.ve-overlay{position:fixed;inset:0;z-index:110;background:rgba(12,12,16,.66);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:14px}
.ve{width:min(1240px,98vw);height:min(94vh,920px);background:#141418;color:#ECECEF;border:1px solid #2A2A33;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.ve-top{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-bottom:1px solid #232329;gap:10px;flex:none}
.ve-top-l{display:flex;align-items:center;gap:7px;font-size:13.5px}.ve-top-c{display:flex;gap:4px}.ve-top-r{display:flex;align-items:center;gap:8px}
.ve-ic{width:30px;height:28px;border-radius:8px;border:1px solid #2E2E38;background:#1E1E25;color:#C9C9D2;display:flex;align-items:center;justify-content:center;cursor:pointer}
.ve-ic:hover:not(:disabled){background:#26262F}.ve-ic:disabled{opacity:.35;cursor:default}.ve-ic.sm{width:24px;height:22px}.ve-ic.danger:hover{color:#FF6B6B}
.ve-style{display:flex;gap:4px;margin-right:4px}.ve-sw{width:20px;height:20px;border-radius:6px;border:2px solid transparent;cursor:pointer}.ve-sw.on{border-color:#FFD24A}
.ve-export{display:inline-flex;align-items:center;gap:6px;background:#FFD24A;color:#161616;border:none;border-radius:9px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}.ve-export:disabled{opacity:.6}
.ve-main{flex:1;display:flex;min-height:0}
.ve-tools{width:212px;flex:none;border-right:1px solid #232329;display:flex;flex-direction:column}
.ve-tabs{display:flex;border-bottom:1px solid #232329;overflow-x:auto}
.ve-tab{flex:1;min-width:52px;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;border-bottom:2px solid transparent;color:#9a9aa6;padding:9px 2px;cursor:pointer;font-size:9.5px;font-family:inherit}
.ve-tab.on{color:#FFD24A;border-bottom-color:#FFD24A}
.ve-tabbody{padding:12px;display:flex;flex-direction:column;gap:9px;overflow-y:auto}
.ve-stagewrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;gap:10px;min-width:0;background:radial-gradient(circle at 50% 30%,#1A1A21,#121217)}
.ve-stage{position:relative;height:100%;max-height:50vh;aspect-ratio:9/16;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.ve-bg{position:absolute;inset:0;width:100%;height:100%}
.ve-bg-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#5a5a66;font-size:12px;text-align:center;padding:20px}
.ve-hint{position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#cfcfd6;font-size:11px;opacity:.85}
.ve-el{will-change:transform}.ve-el.sel{outline:2px solid #FFD24A;outline-offset:2px;border-radius:3px}
.ve-rh{position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;border-radius:50%;background:#FFD24A;border:2px solid #161616;cursor:nwse-resize;touch-action:none}
.ve-transport{display:flex;align-items:center;gap:10px}
.ve-time{font-size:11px;color:#9a9aa6;font-variant-numeric:tabular-nums;min-width:118px;text-align:center}
.ve-props{width:248px;flex:none;border-left:1px solid #232329;overflow-y:auto;padding:12px}
.ve-panel{display:flex;flex-direction:column;gap:9px}
.ve-panel-h{display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:13px;text-transform:capitalize}
.ve-input{width:100%;background:#1C1C23;border:1px solid #2E2E38;border-radius:8px;color:#ECECEF;padding:7px 9px;font-size:12.5px;font-family:inherit;resize:vertical}
.ve-lab{font-size:11px;color:#8e8e9a;margin-top:2px}
.ve-row{display:flex;gap:7px;flex-wrap:wrap}.ve-grid2{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.ve-f{display:flex;flex-direction:column;gap:3px;font-size:10.5px;color:#9a9aa6;flex:1;min-width:60px}.ve-f.wide{width:100%}
.ve-f input,.ve-f select{background:#1C1C23;border:1px solid #2E2E38;border-radius:7px;color:#ECECEF;padding:5px 7px;font-size:12px;font-family:inherit}
.ve-f input[type=color]{padding:2px;height:28px}
.ve-chip{background:#1C1C23;border:1px solid #2E2E38;border-radius:7px;color:#C2C2CC;padding:5px 8px;font-size:11px;cursor:pointer;text-transform:capitalize;font-family:inherit}
.ve-chip.on{background:#FFD24A;color:#161616;border-color:#FFD24A;font-weight:700}.ve-chip:disabled{opacity:.4}
.ve-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#26262F;border:1px solid #33333d;border-radius:8px;color:#ECECEF;padding:7px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.ve-btn.full{width:100%}.ve-btn.on{background:#FFD24A;color:#161616;border-color:#FFD24A;font-weight:700}.ve-btn.ghost{background:none}.ve-btn:disabled{opacity:.45;cursor:default}
.ve-muted{font-size:11px;color:#80808c;line-height:1.5}
/* timeline */
.ve-tl{flex:none;height:33%;min-height:188px;display:flex;flex-direction:column;border-top:1px solid #232329;background:#101014}
.ve-tl-bar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #1e1e24}
.ve-tl-t{font-size:11px;color:#9a9aa6;font-variant-numeric:tabular-nums;margin-left:4px}
.ve-tl-body{flex:1;display:flex;min-height:0}
.ve-tl-labels{width:62px;flex:none;border-right:1px solid #1e1e24;display:flex;flex-direction:column;padding-top:22px}
.ve-tl-lab{height:40px;display:flex;align-items:center;padding:0 8px;font-size:10px;color:#7a7a86;border-bottom:1px solid #17171c}
.ve-tl-scroll{flex:1;overflow-x:auto;overflow-y:hidden}
.ve-tl-inner{position:relative;min-width:100%;height:100%;cursor:text}
.ve-ruler{position:relative;height:22px;border-bottom:1px solid #1e1e24}
.ve-tick{position:absolute;top:4px;font-size:9px;color:#5a5a66;transform:translateX(-1px);border-left:1px solid #2a2a33;padding-left:3px;height:16px}
.ve-playhead{position:absolute;top:0;bottom:0;width:2px;background:#FFD24A;z-index:6;pointer-events:none}
.ve-track{position:relative;height:40px;border-bottom:1px solid #17171c}
.ve-track.audio{opacity:.7}
.ve-clip{position:absolute;top:4px;height:32px;background:linear-gradient(#3a3550,#2c2840);border:1px solid #4a4566;border-radius:6px;display:flex;align-items:center;overflow:hidden;cursor:grab}
.ve-clip.on{border-color:#FFD24A;box-shadow:0 0 0 1px #FFD24A inset}
.ve-clip-lbl{flex:1;font-size:10.5px;color:#dcdce6;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.ve-clip-h{width:7px;align-self:stretch;cursor:ew-resize;background:rgba(255,255,255,.12)}.ve-clip-h.r{margin-left:auto}
.ve-xf{position:absolute;right:-6px;top:9px;width:12px;height:12px;background:#FFD24A;transform:rotate(45deg);border-radius:2px}
.ve-elbar{position:absolute;top:6px;height:28px;border-radius:6px;display:flex;align-items:center;overflow:hidden;cursor:grab}
.ve-elbar.text{background:#7a4b2e;border:1px solid #a9683f}.ve-elbar.img{background:#2e5a4a;border:1px solid #3f8068}.ve-elbar.audio{background:#2a3a55;border:1px solid #3a4d70;cursor:default}
.ve-elbar.on{box-shadow:0 0 0 1px #FFD24A inset;border-color:#FFD24A}
.ve-elbar-lbl{flex:1;font-size:10px;color:#f0e6dc;padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.ve-elbar-h{width:6px;align-self:stretch;cursor:ew-resize;background:rgba(255,255,255,.18)}.ve-elbar-h.r{margin-left:auto}
.ve-picker{width:min(640px,94vw);max-height:88vh;background:#141418;border:1px solid #2A2A33;border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
.ve-pk-search{display:flex;gap:8px;padding:12px 14px}
.ve-pk-grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 14px 12px}
.ve-pk-cell{aspect-ratio:9/16;border-radius:9px;overflow:hidden;border:1px solid #2A2A33;background:#000;cursor:pointer;padding:0}.ve-pk-cell video,.ve-pk-cell img{width:100%;height:100%;object-fit:cover;display:block}
.ve-pk-foot{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #232329}
.ve-export-view{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px}
.ve-export-vid{height:54vh;width:auto;border-radius:12px;background:#000}
.ve-rendering{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;font-size:13px}
.ve-note{background:#3a3320;border:1px solid #5a4d22;color:#e8d9a8;border-radius:9px;padding:8px 12px;font-size:12px;max-width:480px;text-align:center}
.ve-err{color:#FF8A80;font-size:13px;text-align:center;max-width:460px}
.ve-spin{animation:ve-spin 1s linear infinite}@keyframes ve-spin{to{transform:rotate(360deg)}}
@media(max-width:820px){.ve-main{flex-direction:column}.ve-tools{width:100%;flex-direction:row;border-right:none;border-bottom:1px solid #232329}.ve-tabs{flex-direction:column;border-bottom:none;border-right:1px solid #232329}.ve-props{width:100%;border-left:none;border-top:1px solid #232329;max-height:28vh}.ve-stage{max-height:38vh}.ve-pk-grid{grid-template-columns:repeat(3,1fr)}}
`}</style>
}
