'use client'
// app/components/VideoEditor.js — a CapCut-style video editor over the EditPlan
// IR v2. Redesigned for intuitive desktop controls (workflow w5vwmrzgw):
//   • SELECTION is decoupled from the PLAYHEAD — clicking a clip/overlay SELECTS
//     it (shows props + trim handles) and never yanks the playhead or pauses.
//   • the playhead is its own object: a grabbable head on the ruler + click-to-seek,
//     and scrubbing shows live frames.
//   • geometry-based hit-testing (edge = trim, body = move/select), magnetic
//     snapping to clip edges + playhead, 4 corner resize handles on the canvas,
//     a preview-first resizable layout, real per-zone cursors + tooltips.
// Coordinates are 0..1 fractions of the fixed 1080x1920 canvas via lib/overlay-
// coords (the module the renderer also uses); the UI mounts only what PHASE_GATES
// says the renderer honors. Export → the proven directed render.
import { useReducer, useRef, useState, useEffect, useMemo, useCallback, memo } from 'react'
import { motion } from 'framer-motion'
import { X as LX, Type, Image as LImage, Film, Plus, Trash2, Undo2, Redo2, Play, Pause, Search, Scissors, ZoomIn, ZoomOut, Music, Wand2, SkipBack, Magnet, ChevronDown, Copy } from 'lucide-react'
import { normalizeEditPlanV2, FONTS, ANCHORS, MAX_ELEMENTS, MAX_SCENES, STYLE_KEYS, TRANSITIONS_V2, PHASE_GATES, MAX_CLIP_DUR } from '@/lib/edit-plan'
import { clamp01, cssAnchorStyle } from '@/lib/overlay-coords'
import { SLIDE_STYLES, FONT_CSS, FONT_CAPS } from '@/lib/style-tokens'

const spring = { type: 'spring', stiffness: 380, damping: 32 }
const FPS = 30, EDGE_PX = 12, SNAP_PX = 8
const clone = p => (typeof structuredClone === 'function' ? structuredClone(p) : JSON.parse(JSON.stringify(p)))
const clampN = (v, lo, hi) => Math.min(Math.max(Number(v) || 0, lo), hi)
const round1 = v => Math.round(v * 10) / 10
const sceneSecs = s => s.duration != null ? s.duration : (s.kind === 'card' || s.kind === 'color') ? 3 : 5
const maxDurFor = s => (s.kind === 'clip' || s.kind === 'ai_video') ? MAX_CLIP_DUR : 15
const uid = pfx => pfx + Math.random().toString(36).slice(2, 8)
const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s / 60), ss = Math.floor(s % 60), f = Math.floor((s % 1) * FPS); return `${m}:${String(ss).padStart(2, '0')}.${String(f).padStart(2, '0')}` }
const STYLE_LABEL = { bold: 'Bold', minimal: 'Minimal', editorial: 'Editorial', gradient: 'Gradient', mint: 'Mint' }

const updScene = (plan, i, fn) => ({ ...plan, scenes: plan.scenes.map((s, j) => j === i ? fn(s) : s) })
const updEl = (plan, i, id, patch) => updScene(plan, i, s => ({ ...s, elements: s.elements.map(e => e.id === id ? { ...e, ...patch } : e) }))

const blankText = () => ({ id: uid('e'), type: 'text', text: 'Your text', font: 'anton', size: 0.08, color: '#FFFFFF', stroke: { color: '#000000', width: 8 }, box: null, align: 'center', multiline: false, x: 0.5, y: 0.5, anchor: 'center', scale: 0.8, opacity: 1, rotation: 0, start: null, end: null, anim: { in: 'none', out: 'none', move: null } })
const blankImage = url => ({ id: uid('e'), type: 'image', url, asset_id: null, x: 0.5, y: 0.5, anchor: 'center', scale: 0.35, opacity: 1, rotation: 0, start: null, end: null, anim: { in: 'none', out: 'none', move: null } })
const blankClipScene = () => ({ id: uid('s'), kind: 'clip', query: '', url: null, asset_id: null, duration: 5, transition: 'cut', transition_dur: 0.4, motion: null, trim_start: null, trim_end: null, elements: [] })
const blankCardScene = () => ({ id: uid('s'), kind: 'card', eyebrow: null, heading: 'New scene', body: null, duration: 3, transition: 'cut', transition_dur: 0.4, motion: null, elements: [] })

function timeline(plan) { const starts = []; let acc = 0; for (const s of plan.scenes) { starts.push(acc); acc += sceneSecs(s) } return { starts, total: acc } }

function reducer(s, a) {
  switch (a.type) {
    case 'snapshot': return { ...s, past: [...s.past, s.plan].slice(-80), future: [] }
    case 'live': return { ...s, plan: a.plan }                                  // no history (mid-gesture)
    case 'quiet': return { ...s, plan: a.plan }                                 // non-undoable load adjust
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
    tick(); return () => { alive = false; clearTimeout(timer) }
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
  const [selScene, setSelScene] = useState(plan.scenes[0]?.id || null)  // id of the selected clip
  const [selEl, setSelEl] = useState(null)                              // id of the selected overlay
  const [playing, setPlaying] = useState(false)
  const [pps, setPps] = useState(34)
  const [tab, setTab] = useState('media')
  const [picker, setPicker] = useState(null)
  const [tlH, setTlH] = useState(210)        // timeline dock height (resizable)
  const [magnet, setMagnet] = useState(true)
  const [snapX, setSnapX] = useState(null)   // snap-guide x (px in timeline-inner) or null
  const [exportId, setExportId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState('')
  const [downgrades, setDowngrades] = useState([])
  const stageRef = useRef(null); const videoRef = useRef(null); const doneRef = useRef(false)
  const clip = useRef(null)   // copy buffer for an element

  // which scene the PREVIEW shows = under the playhead; which scene is being EDITED = selected (else preview).
  const activeIdx = useMemo(() => { let i = 0; for (let j = 0; j < starts.length; j++) if (globalT >= starts[j] - 1e-6) i = j; return Math.min(i, plan.scenes.length - 1) }, [starts, globalT, plan.scenes.length])
  const selSceneIdx = useMemo(() => { const i = plan.scenes.findIndex(s => s.id === selScene); return i >= 0 ? i : activeIdx }, [plan, selScene, activeIdx])
  const previewScene = plan.scenes[activeIdx] || plan.scenes[0]
  const editScene = plan.scenes[selSceneIdx] || previewScene
  const localT = Math.max(0, globalT - (starts[activeIdx] || 0))
  const selectedEl = useMemo(() => { for (const s of plan.scenes) { const e = s.elements.find(x => x.id === selEl); if (e) return e } return null }, [plan, selEl])

  const commit = useCallback(p => dispatch({ type: 'commit', plan: p }), [])
  const live = useCallback(p => dispatch({ type: 'live', plan: p }), [])
  const snapshot = useCallback(() => dispatch({ type: 'snapshot' }), [])

  useEffect(() => {
    const el = stageRef.current; if (!el) return
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); el.style.setProperty('--stage-w', r.width + 'px'); el.style.setProperty('--stage-h', r.height + 'px') })
    ro.observe(el); return () => ro.disconnect()
  }, [])

  // a lifted clip with unknown length adopts its real duration (non-undoable)
  const onBgMeta = e => { if (previewScene.kind === 'clip' && previewScene.url && previewScene.duration == null && e.target.duration) dispatch({ type: 'quiet', plan: updScene(plan, activeIdx, s => ({ ...s, duration: clampN(Math.round(e.target.duration), 1, MAX_CLIP_DUR) })) }) }

  // ── playback: a throttled wall clock; the preview <video> plays/seeks to match ──
  useEffect(() => {
    if (!playing) return
    let raf, prev = null, acc = 0
    const loop = ts => { if (prev == null) prev = ts; const dt = (ts - prev) / 1000; prev = ts; acc += dt; if (acc >= 0.06) { setGlobalT(g => { let n = g + acc; if (n >= total) n = 0; return n }); acc = 0 } raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf)
  }, [playing, total])
  // keep the preview frame matched to the playhead (scrub shows frames; play runs native)
  useEffect(() => {
    const v = videoRef.current; if (!v || !previewScene.url) return
    if (playing) { if (v.paused) v.play().catch(() => {}) }
    else { if (!v.paused) v.pause(); const target = (previewScene.trim_start || 0) + localT; if (Math.abs(v.currentTime - target) > 0.08) { try { v.currentTime = target } catch {} } }
  }, [globalT, activeIdx, playing]) // eslint-disable-line

  const seek = useCallback(g => { setGlobalT(clampN(g, 0, total)) }, [total])
  const scrub = useCallback(g => { setPlaying(false); setGlobalT(clampN(g, 0, total)) }, [total])

  // ── canvas: drag to move, corner handle to resize ──
  const startDrag = (e, el) => {
    e.stopPropagation(); setSelEl(el.id); setSelScene(previewScene.id); setPlaying(false)
    const rect = stageRef.current.getBoundingClientRect()
    const ox = el.x, oy = el.y, sx = e.clientX, sy = e.clientY; let moved = false
    const onMove = ev => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 2) { moved = true; snapshot() }
      if (!moved) return
      let nx = clamp01(ox + (ev.clientX - sx) / rect.width), ny = clamp01(oy + (ev.clientY - sy) / rect.height)
      if (magnet) { if (Math.abs(nx - 0.5) < 0.025) nx = 0.5; if (Math.abs(ny - 0.5) < 0.025) ny = 0.5 } // center snap
      live(updEl(plan, activeIdx, el.id, { x: nx, y: ny }))
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }
  const startResize = (e, el) => {
    e.stopPropagation(); setSelEl(el.id); setPlaying(false)
    const rect = stageRef.current.getBoundingClientRect()
    const cx = rect.left + el.x * rect.width, cy = rect.top + el.y * rect.height
    const d0 = Math.max(10, Math.hypot(e.clientX - cx, e.clientY - cy)); const base = el.type === 'text' ? el.size : el.scale; let moved = false
    const onMove = ev => {
      if (!moved) { moved = true; snapshot() }
      const ratio = Math.max(10, Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0
      live(updEl(plan, activeIdx, el.id, el.type === 'text' ? { size: clampN(base * ratio, 0.02, 0.3) } : { scale: clampN(base * ratio, 0.03, 1) }))
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  // ── element / scene ops (target the SELECTED scene) ──
  const addText = () => { if (editScene.elements.length >= MAX_ELEMENTS) return; const el = blankText(); commit(updScene(plan, selSceneIdx, s => ({ ...s, elements: [...s.elements, el] }))); setSelEl(el.id); seek((starts[selSceneIdx] || 0) + 0.05) }
  const addImage = url => { if (editScene.elements.length >= MAX_ELEMENTS) return; const el = blankImage(url); commit(updScene(plan, selSceneIdx, s => ({ ...s, elements: [...s.elements, el] }))); setSelEl(el.id); seek((starts[selSceneIdx] || 0) + 0.05); setPicker(null) }
  const delEl = id => { commit({ ...plan, scenes: plan.scenes.map(s => ({ ...s, elements: s.elements.filter(e => e.id !== id) })) }); if (selEl === id) setSelEl(null) }
  const dupEl = () => { if (!selectedEl) return; const e = { ...clone(selectedEl), id: uid('e'), x: clamp01(selectedEl.x + 0.04), y: clamp01(selectedEl.y + 0.04) }; commit(updScene(plan, selSceneIdx, s => ({ ...s, elements: [...s.elements, e] }))); setSelEl(e.id) }
  const setEl = patch => commit(updEl(plan, sceneIdxOf(selEl), selEl, patch))
  const setElLive = patch => live(updEl(plan, sceneIdxOf(selEl), selEl, patch))
  function sceneIdxOf(elId) { return plan.scenes.findIndex(s => s.elements.some(e => e.id === elId)) }

  const addScene = kind => { if (plan.scenes.length >= MAX_SCENES) return; const s = kind === 'card' ? blankCardScene() : blankClipScene(); commit({ ...plan, scenes: [...plan.scenes, s] }); setSelScene(s.id); setSelEl(null); seek(total + 0.05) }
  const delScene = i => { if (plan.scenes.length <= 1) return; const removed = plan.scenes[i]; commit({ ...plan, scenes: plan.scenes.filter((_, j) => j !== i) }); if (selScene === removed.id) setSelScene(plan.scenes[Math.max(0, i - 1)]?.id || null); setSelEl(null) }
  const setSceneLive = patch => live(updScene(plan, selSceneIdx, s => ({ ...s, ...patch })))
  const setSceneCommit = patch => commit(updScene(plan, selSceneIdx, s => ({ ...s, ...patch })))
  const setStyle = k => commit({ ...plan, style_key: k })
  const setBackground = sel => { commit(updScene(plan, selSceneIdx, s => ({ ...s, kind: sel.kind, url: sel.url ?? null, query: sel.query ?? null, asset_id: null, duration: sel.kind === 'card' ? (s.duration || 3) : s.duration, heading: sel.kind === 'card' ? (s.heading || 'New scene') : s.heading }))); setPicker(null) }

  function splitAtPlayhead() {
    const i = activeIdx, sc = plan.scenes[i], lt = globalT - (starts[i] || 0), d = sceneSecs(sc)
    if (lt < 0.3 || lt > d - 0.3) return
    snapshot()
    const A = clone(sc), B = clone(sc); A.id = uid('s'); B.id = uid('s'); A.duration = round1(lt); B.duration = round1(d - lt)
    if (sc.kind === 'clip') B.trim_start = (sc.trim_start || 0) + A.duration
    A.elements = []; B.elements = []
    for (const el of sc.elements) { const s0 = el.start ?? 0, e0 = el.end ?? d; if (s0 < lt) A.elements.push({ ...el, id: uid('e'), end: el.end == null ? null : Math.min(e0, lt) }); if (e0 > lt) B.elements.push({ ...el, id: uid('e'), start: Math.max(0, s0 - lt), end: el.end == null ? null : (e0 - lt) }) }
    commit({ ...plan, scenes: [...plan.scenes.slice(0, i), A, B, ...plan.scenes.slice(i + 1)] }); setSelScene(A.id)
  }

  // keyboard map
  useEffect(() => {
    const onKey = e => {
      const t = (document.activeElement?.tagName || '').toLowerCase()
      if (t === 'input' || t === 'textarea' || document.activeElement?.isContentEditable) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); setSelEl(null) }
      else if (mod && e.key.toLowerCase() === 'c') { if (selectedEl) clip.current = clone(selectedEl) }
      else if (mod && e.key.toLowerCase() === 'v') { if (clip.current) { const el = { ...clone(clip.current), id: uid('e') }; commit(updScene(plan, selSceneIdx, s => ({ ...s, elements: [...s.elements, el] }))); setSelEl(el.id) } }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dupEl() }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selEl) { e.preventDefault(); delEl(selEl) }
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key.toLowerCase() === 'b') { e.preventDefault(); splitAtPlayhead() }
      else if (e.key.toLowerCase() === 's') setMagnet(m => !m)
      else if (e.key === 'Home') scrub(0)
      else if (e.key === 'End') scrub(total)
      else if (e.key === 'ArrowLeft') { e.preventDefault(); scrub(globalT - 1 / FPS) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); scrub(globalT + 1 / FPS) }
      else if (e.key === 'Escape') setSelEl(null)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line

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

  // timeline-dock splitter drag
  const startSplit = e => {
    e.preventDefault(); const sy = e.clientY, h0 = tlH
    const onMove = ev => setTlH(clampN(h0 + (sy - ev.clientY), 132, window.innerHeight * 0.6))
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  const propTarget = selectedEl ? 'el' : 'scene'

  return (
    <motion.div className="ve-overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <VeStyles />
      <motion.div className="ve" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.99 }} transition={spring}>
        <div className="ve-top">
          <div className="ve-top-l"><b>Video editor</b></div>
          <div className="ve-top-c">
            <button className="ve-ic" title="Undo (⌘Z)" disabled={!state.past.length} onClick={() => { dispatch({ type: 'undo' }); setSelEl(null) }}><Undo2 size={15} /></button>
            <button className="ve-ic" title="Redo (⇧⌘Z)" disabled={!state.future.length} onClick={() => { dispatch({ type: 'redo' }); setSelEl(null) }}><Redo2 size={15} /></button>
          </div>
          <div className="ve-top-r">
            <div className="ve-style">{STYLE_KEYS.map(k => <button key={k} className={'ve-sw' + (plan.style_key === k ? ' on' : '')} title={STYLE_LABEL[k] || k} style={{ background: (SLIDE_STYLES[k] || {}).bg }} onClick={() => setStyle(k)} />)}</div>
            <button className="ve-export" disabled={exporting} onClick={doExport}>{exporting ? <span className="ve-spin ve-dot" /> : <Wand2 size={14} />} Export</button>
            <button className="ve-ic" title="Close" onClick={onClose}><LX size={17} /></button>
          </div>
        </div>

        {exportId ? (
          <ExportView job={exportJob} downgrades={downgrades} onBack={() => { doneRef.current = false; setExportId(null); setExporting(false) }} onClose={onClose} />
        ) : (
          <>
            <div className="ve-main">
              <ToolsPanel tab={tab} setTab={setTab} scene={editScene} idx={selSceneIdx} sceneCount={plan.scenes.length} total={total} canTransition={selSceneIdx < plan.scenes.length - 1}
                elCount={editScene.elements.length} onPicker={setPicker} onAddScene={addScene} onAddText={addText} onSetSceneCommit={setSceneCommit} onSetSceneLive={setSceneLive} onSnap={snapshot} />

              <div className="ve-stagewrap">
                <div className="ve-stage" ref={stageRef} onPointerDown={e => { if (e.target === stageRef.current) setSelEl(null) }}>
                  <Background scene={previewScene} style={style} videoRef={videoRef} onMeta={onBgMeta} />
                  {previewScene.elements.map(el => {
                    const visible = (el.start == null || localT >= el.start) && (el.end == null || localT < el.end)
                    return <CanvasEl key={el.id} el={el} selected={selEl === el.id} dimmed={!visible} onDrag={startDrag} onResize={startResize} />
                  })}
                  {previewScene.kind === 'clip' && !previewScene.url && <div className="ve-hint">Add footage in “Media,” then drop text or a logo on top</div>}
                </div>
                <div className="ve-transport">
                  <button className="ve-ic" title="Go to start (Home)" onClick={() => scrub(0)}><SkipBack size={14} /></button>
                  <button className="ve-ic ve-play" title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
                  <span className="ve-time">{fmtT(globalT)} <i>/ {fmtT(total)}</i></span>
                </div>
              </div>

              <div className="ve-props">
                <div className="ve-prop-head">{propTarget === 'el' ? (selectedEl.type === 'text' ? 'Text' : 'Image') : `${editScene.kind === 'card' ? 'Card' : editScene.kind === 'color' ? 'Color' : 'Clip'} ${selSceneIdx + 1}`}</div>
                {selectedEl ? <ElementProps el={selectedEl} onLive={setElLive} onCommit={setEl} onSnap={snapshot} onDelete={() => delEl(selectedEl.id)} onDup={dupEl} dur={sceneSecs(plan.scenes[sceneIdxOf(selEl)] || editScene)} />
                  : <SceneProps scene={editScene} onLive={setSceneLive} onCommit={setSceneCommit} onSnap={snapshot} onBackground={() => setPicker({ for: 'background' })} canTransition={selSceneIdx < plan.scenes.length - 1} />}
              </div>
            </div>

            <div className="ve-split" onPointerDown={startSplit} title="Drag to resize the timeline" />

            <div className="ve-tl" style={{ height: tlH }}>
              <div className="ve-tl-bar">
                <button className="ve-ic" title="Split at playhead (B)" onClick={splitAtPlayhead}><Scissors size={14} /></button>
                <button className="ve-ic" title="Delete selected clip" disabled={plan.scenes.length <= 1} onClick={() => delScene(selSceneIdx)}><Trash2 size={13} /></button>
                <button className={'ve-ic' + (magnet ? ' on' : '')} title="Snapping (S)" onClick={() => setMagnet(m => !m)}><Magnet size={14} /></button>
                <span className="ve-tl-t">{fmtT(globalT)}</span>
                <span style={{ flex: 1 }} />
                <button className="ve-ic" title="Zoom out" onClick={() => setPps(p => Math.max(8, p - 8))}><ZoomOut size={14} /></button>
                <button className="ve-ic" title="Zoom in" onClick={() => setPps(p => Math.min(90, p + 8))}><ZoomIn size={14} /></button>
              </div>
              <Timeline plan={plan} starts={starts} total={total} pps={pps} globalT={globalT} selSceneIdx={selSceneIdx} selEl={selEl} magnet={magnet} snapX={snapX} setSnapX={setSnapX}
                onScrub={scrub} onSelectScene={id => { setSelScene(id); setSelEl(null) }}
                onSelectEl={(id, gStart) => { setSelEl(id); const sc = plan.scenes.find(s => s.elements.some(e => e.id === id)); if (sc) setSelScene(sc.id); seek(gStart + 0.02) }}
                snapshot={snapshot} live={live} commit={commit} />
            </div>
          </>
        )}
      </motion.div>

      {picker && <MediaPicker kind={picker.for} authed={authed} onClose={() => setPicker(null)} onPick={sel => picker.for === 'image' ? addImage(sel.url) : setBackground(sel)} onCard={() => setBackground({ kind: 'card' })} />}
    </motion.div>
  )
}

// ── timeline ──
const Timeline = memo(function Timeline({ plan, starts, total, pps, globalT, selSceneIdx, selEl, magnet, snapX, setSnapX, onScrub, onSelectScene, onSelectEl, snapshot, live, commit }) {
  const innerRef = useRef(null)
  const W = Math.max(total * pps + 60, 240)
  const xToT = clientX => { const r = innerRef.current.getBoundingClientRect(); return (clientX - r.left) / pps }
  const sceneSnaps = useMemo(() => { const a = [0]; starts.forEach((s, i) => { a.push(s, s + sceneSecs(plan.scenes[i])) }); return a }, [plan, starts])
  const snap = (t, extra = []) => { if (!magnet) return t; const targets = [...sceneSnaps, ...extra]; let best = t, bd = SNAP_PX / pps; for (const tg of targets) { const d = Math.abs(t - tg); if (d < bd) { bd = d; best = tg } } return best }

  function rulerDown(e) {
    if (e.target.closest('.ve-clip') || e.target.closest('.ve-elbar')) return
    onScrub(xToT(e.clientX))
    const onMove = ev => onScrub(snap(xToT(ev.clientX)))
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  function sceneDown(e, i) {
    e.stopPropagation()
    const sc = plan.scenes[i]; onSelectScene(sc.id)
    const r = e.currentTarget.getBoundingClientRect(), lx = e.clientX - r.left
    const edge = lx < EDGE_PX ? 'left' : lx > r.width - EDGE_PX ? 'right' : 'body'
    const sx = e.clientX, oDur = sceneSecs(sc), oTrim = sc.trim_start || 0; let moved = false
    const onMove = ev => {
      const dT = (ev.clientX - sx) / pps
      if (!moved && Math.abs(ev.clientX - sx) > 3) { moved = true; snapshot() }
      if (!moved) return
      if (edge === 'right') { const nd = clampN(snap((starts[i] || 0) + oDur + dT) - (starts[i] || 0), 1, maxDurFor(sc)); live(updScene(plan, i, s => ({ ...s, duration: round1(nd) }))) }
      else if (edge === 'left') { const ns = clampN(snap((starts[i] || 0) + dT), 0, (starts[i] || 0) + oDur - 1) - (starts[i] || 0); const nd = clampN(oDur - ns, 1, maxDurFor(sc)); live(updScene(plan, i, s => ({ ...s, duration: round1(nd), ...(sc.kind === 'clip' ? { trim_start: round1(Math.max(0, oTrim + (oDur - nd))) } : {}) }))) }
      else { setSnapX(null) /* body reorder handled on up */ }
    }
    const onUp = ev => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); setSnapX(null)
      if (edge === 'body' && moved) { const dropT = (starts[i] || 0) + oDur / 2 + (ev.clientX - sx) / pps; const others = plan.scenes.filter((_, j) => j !== i); let acc = 0, ni = others.length; for (let j = 0; j < others.length; j++) { const w = sceneSecs(others[j]); if (dropT < acc + w / 2) { ni = j; break } acc += w } if (ni !== i) { snapshot(); const a = plan.scenes.slice(); const [m] = a.splice(i, 1); a.splice(ni, 0, m); commit({ ...plan, scenes: a }) } }
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  function elDown(e, i, el) {
    e.stopPropagation()
    const sc = plan.scenes[i], sd = sceneSecs(sc), base = starts[i] || 0
    const r = e.currentTarget.getBoundingClientRect(), lx = e.clientX - r.left
    const edge = lx < EDGE_PX ? 'left' : lx > r.width - EDGE_PX ? 'right' : 'body'
    onSelectEl(el.id, base + (el.start ?? 0))
    const s0 = el.start ?? 0, e0 = el.end ?? sd, span = e0 - s0, sx = e.clientX; let moved = false
    const elemSnaps = [base, base + sd]
    const onMove = ev => {
      const dT = (ev.clientX - sx) / pps
      if (!moved && Math.abs(ev.clientX - sx) > 3) { moved = true; snapshot() }
      if (!moved) return
      if (edge === 'body') { let ns = clampN(snap(base + s0 + dT, elemSnaps) - base, 0, sd - span); live(updEl(plan, i, el.id, { start: round1(ns), end: round1(ns + span) })) }
      else if (edge === 'left') { let ns = clampN(snap(base + s0 + dT, elemSnaps) - base, 0, e0 - 0.2); live(updEl(plan, i, el.id, { start: round1(ns) })) }
      else { let ne = clampN(snap(base + e0 + dT, elemSnaps) - base, s0 + 0.2, sd); live(updEl(plan, i, el.id, { end: round1(ne) })) }
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); setSnapX(null) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  const { texts, imgs } = useMemo(() => { const texts = [], imgs = []; plan.scenes.forEach((s, i) => s.elements.forEach(el => (el.type === 'image' ? imgs : texts).push({ i, el }))); return { texts, imgs } }, [plan])
  const ticks = useMemo(() => { const step = pps < 16 ? 5 : pps < 36 ? 2 : 1, a = []; for (let t = 0; t <= total + 0.001; t += step) a.push(t); return a }, [total, pps])

  return (
    <div className="ve-tl-body">
      <div className="ve-tl-labels">
        <div className="ve-tl-lab head" />
        <div className="ve-tl-lab"><Film size={11} />Video</div><div className="ve-tl-lab"><Type size={11} />Text</div><div className="ve-tl-lab"><LImage size={11} />Sticker</div><div className="ve-tl-lab"><Music size={11} />Audio</div>
      </div>
      <div className="ve-tl-scroll">
        <div className="ve-tl-inner" ref={innerRef} style={{ width: W }} onPointerDown={rulerDown}>
          <div className="ve-ruler">{ticks.map(t => <span key={t} className="ve-tick" style={{ left: t * pps }}>{fmtT(t).replace(/\.\d+$/, '')}</span>)}</div>
          <div className="ve-playhead" style={{ left: globalT * pps }}><span className="ve-playhead-head" onPointerDown={e => { e.stopPropagation(); onScrub(xToT(e.clientX)); const onMove = ev => onScrub(snap(xToT(ev.clientX))); const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp) }} /></div>
          {snapX != null && <div className="ve-snapline" style={{ left: snapX }} />}
          <div className="ve-track">
            {plan.scenes.map((s, i) => (
              <div key={s.id} className={'ve-clip' + (i === selSceneIdx ? ' on' : '')} style={{ left: (starts[i] || 0) * pps, width: Math.max(2 * EDGE_PX + 16, sceneSecs(s) * pps) }} onPointerDown={e => sceneDown(e, i)} title={s.kind === 'card' ? (s.heading || 'Card') : 'Clip'}>
                <span className="ve-trim l" /><span className="ve-clip-lbl">{s.kind === 'card' ? (s.heading || 'Card') : s.kind === 'color' ? 'Color' : 'Clip'}{s.motion === 'kenBurns' ? ' ⤢' : ''}</span><span className="ve-trim r" />
                {i < plan.scenes.length - 1 && s.transition !== 'cut' && <span className="ve-xf" title={s.transition} />}
              </div>
            ))}
          </div>
          <div className="ve-track">{texts.map(({ i, el }) => { const s0 = (starts[i] || 0) + (el.start ?? 0), s1 = (starts[i] || 0) + (el.end ?? sceneSecs(plan.scenes[i])); return (<div key={el.id} className={'ve-elbar text' + (selEl === el.id ? ' on' : '')} style={{ left: s0 * pps, width: Math.max(2 * EDGE_PX + 8, (s1 - s0) * pps) }} onPointerDown={e => elDown(e, i, el)}><span className="ve-trim l" /><span className="ve-elbar-lbl">{el.text || 'text'}</span><span className="ve-trim r" /></div>) })}</div>
          <div className="ve-track">{imgs.map(({ i, el }) => { const s0 = (starts[i] || 0) + (el.start ?? 0), s1 = (starts[i] || 0) + (el.end ?? sceneSecs(plan.scenes[i])); return (<div key={el.id} className={'ve-elbar img' + (selEl === el.id ? ' on' : '')} style={{ left: s0 * pps, width: Math.max(2 * EDGE_PX + 8, (s1 - s0) * pps) }} onPointerDown={e => elDown(e, i, el)}><span className="ve-trim l" /><span className="ve-elbar-lbl">image</span><span className="ve-trim r" /></div>) })}</div>
          <div className="ve-track audio"><div className="ve-elbar audio" style={{ left: 0, width: Math.max(20, total * pps) }}><span className="ve-elbar-lbl">audio · muted in export</span></div></div>
        </div>
      </div>
    </div>
  )
})

const ToolsPanel = memo(function ToolsPanel({ tab, setTab, scene, idx, sceneCount, total, canTransition, elCount, onPicker, onAddScene, onAddText, onSetSceneCommit, onSetSceneLive, onSnap }) {
  return (
    <div className="ve-tools">
      <div className="ve-tabs">
        {[['media', Film, 'Media'], ['text', Type, 'Text'], ['sticker', LImage, 'Sticker'], ['fx', Wand2, 'Effects'], ['audio', Music, 'Audio']].map(([k, Ic, lbl]) => (
          <button key={k} className={'ve-tab' + (tab === k ? ' on' : '')} title={lbl} onClick={() => setTab(k)}><Ic size={18} /><span>{lbl}</span></button>
        ))}
      </div>
      <div className="ve-tabbody">
        {tab === 'media' && <>
          <button className="ve-btn full" onClick={() => onPicker({ for: 'background' })}><Film size={13} /> Change footage</button>
          <button className="ve-btn full" disabled={sceneCount >= MAX_SCENES} onClick={() => onAddScene('clip')}><Plus size={13} /> Add clip scene</button>
          <button className="ve-btn full" disabled={sceneCount >= MAX_SCENES} onClick={() => onAddScene('card')}><Plus size={13} /> Add text card</button>
          <div className="ve-muted">{sceneCount}/{MAX_SCENES} scenes · {fmtT(total)} total. Click a clip on the timeline to select it; drag its ends to trim.</div>
        </>}
        {tab === 'text' && <>
          <button className="ve-btn full" disabled={elCount >= MAX_ELEMENTS} onClick={onAddText}><Type size={13} /> Add text</button>
          <div className="ve-muted">Adds text to clip {idx + 1}. Drag it on the canvas to move; drag a corner to resize.</div>
        </>}
        {tab === 'sticker' && <>
          <button className="ve-btn full" disabled={elCount >= MAX_ELEMENTS} onClick={() => onPicker({ for: 'image' })}><LImage size={13} /> Add image / logo</button>
          <div className="ve-muted">A PNG/logo or a stock image, placed over clip {idx + 1}.</div>
        </>}
        {tab === 'fx' && <>
          <label className="ve-lab">Transition → next clip</label>
          <div className="ve-grid2">{TRANSITIONS_V2.map(tr => <button key={tr} className={'ve-chip' + (scene.transition === tr ? ' on' : '')} disabled={!canTransition} onClick={() => onSetSceneCommit({ transition: tr })}>{tr}</button>)}</div>
          <label className="ve-f wide"><span>Length {scene.transition_dur ?? 0.4}s</span><input type="range" min={0.2} max={1.5} step={0.1} value={scene.transition_dur ?? 0.4} onPointerDown={onSnap} onChange={e => onSetSceneLive({ transition_dur: Number(e.target.value) })} /></label>
          {(scene.kind === 'card' || scene.kind === 'color') && PHASE_GATES.kenBurns && <button className={'ve-btn full' + (scene.motion === 'kenBurns' ? ' on' : '')} onClick={() => onSetSceneCommit({ motion: scene.motion === 'kenBurns' ? null : 'kenBurns' })}><ZoomIn size={13} /> Ken Burns zoom {scene.motion === 'kenBurns' ? '✓' : ''}</button>}
        </>}
        {tab === 'audio' && <div className="ve-muted">The clip’s own audio is muted in the export for now. A music track + per-clip audio are coming next.</div>}
      </div>
    </div>
  )
})

const Background = memo(function Background({ scene, style, videoRef, onMeta }) {
  if (scene.kind === 'card' || scene.kind === 'color') {
    const bg = scene.kind === 'color' && scene.color ? scene.color : style.bg, caps = FONT_CAPS[style.display]
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
})

const CanvasEl = memo(function CanvasEl({ el, selected, dimmed, onDrag, onResize }) {
  const common = { position: 'absolute', ...cssAnchorStyle(el), opacity: dimmed && !selected ? 0.3 : el.opacity, cursor: 'grab', touchAction: 'none' }
  const corners = selected && PHASE_GATES.resizeHandle ? ['tl', 'tr', 'bl', 'br'].map(c => <span key={c} className={'ve-rh ' + c} onPointerDown={e => onResize(e, el)} />) : null
  if (el.type === 'text') {
    const caps = FONT_CAPS[el.font]
    const box = el.box ? { background: el.box.color, padding: `calc(var(--stage-w) * ${el.box.pad / 1080})`, borderRadius: `calc(var(--stage-w) * ${(el.box.radius || 0) / 1080})` } : {}
    const stroke = el.stroke && el.stroke.width > 0 ? { WebkitTextStroke: `calc(var(--stage-w) * ${el.stroke.width / 1080}) ${el.stroke.color}`, paintOrder: 'stroke fill' } : {}
    return (<div className={'ve-el' + (selected ? ' sel' : '')} style={common} onPointerDown={e => onDrag(e, el)}>
      <div style={{ fontFamily: FONT_CSS[el.font], color: el.color, fontSize: `calc(var(--stage-h) * ${el.size})`, lineHeight: 1.05, whiteSpace: 'nowrap', textTransform: caps ? 'uppercase' : 'none', textAlign: el.align, fontWeight: el.font === 'inter' ? 800 : 400, ...stroke, ...box }}>{el.text || ' '}</div>{corners}</div>)
  }
  return (<div className={'ve-el' + (selected ? ' sel' : '')} style={{ ...common, width: `calc(var(--stage-w) * ${el.scale})` }} onPointerDown={e => onDrag(e, el)}>
    <img src={el.url} alt="" draggable={false} style={{ width: '100%', height: 'auto', display: 'block', pointerEvents: 'none' }} />{corners}</div>)
})

const ElementProps = memo(function ElementProps({ el, onLive, onCommit, onSnap, onDelete, onDup, dur }) {
  const num = (label, key, min, max, step, scale = 1) => (
    <label className="ve-f"><span>{label}</span><input type="number" inputMode="decimal" min={min} max={max} step={step} value={Math.round((el[key] ?? 0) * scale * 100) / 100} onFocus={onSnap} onChange={e => onLive({ [key]: Math.min(Math.max((Number(e.target.value) || 0) / scale, min / scale), max / scale) })} /></label>
  )
  return (
    <div className="ve-panel">
      <div className="ve-row" style={{ justifyContent: 'flex-end' }}><button className="ve-ic sm" title="Duplicate (⌘D)" onClick={onDup}><Copy size={12} /></button><button className="ve-ic sm danger" title="Delete (⌫)" onClick={onDelete}><Trash2 size={13} /></button></div>
      {el.type === 'text' && <>
        <textarea className="ve-input" rows={2} value={el.text} onFocus={onSnap} onChange={e => onLive({ text: e.target.value.slice(0, 200) })} placeholder="Text…" />
        <div className="ve-row">{FONTS.map(f => <button key={f} className={'ve-chip' + (el.font === f ? ' on' : '')} style={{ fontFamily: FONT_CSS[f] }} onClick={() => onCommit({ font: f })}>{f}</button>)}</div>
        <div className="ve-row"><label className="ve-f"><span>Color</span><input type="color" value={el.color} onFocus={onSnap} onChange={e => onLive({ color: e.target.value })} /></label><label className="ve-f"><span>Outline</span><input type="color" value={el.stroke?.color || '#000000'} onFocus={onSnap} onChange={e => onLive({ stroke: { color: e.target.value, width: el.stroke?.width ?? 8 } })} /></label></div>
        <div className="ve-row">{num('Size', 'size', 2, 30, 0.5, 100)}<label className="ve-f"><span>Outline w</span><input type="number" min={0} max={30} step={1} value={el.stroke?.width ?? 0} onFocus={onSnap} onChange={e => onLive({ stroke: { color: el.stroke?.color || '#000000', width: Math.min(Math.max(Number(e.target.value) || 0, 0), 30) } })} /></label></div>
        <div className="ve-row">{['left', 'center', 'right'].map(a => <button key={a} className={'ve-chip' + (el.align === a ? ' on' : '')} onClick={() => onCommit({ align: a })}>{a}</button>)}</div>
      </>}
      <div className="ve-row">{num('X %', 'x', 0, 100, 1, 100)}{num('Y %', 'y', 0, 100, 1, 100)}</div>
      <div className="ve-row"><label className="ve-f"><span>Anchor</span><select value={el.anchor} onChange={e => onCommit({ anchor: e.target.value })}>{ANCHORS.map(a => <option key={a} value={a}>{a}</option>)}</select></label>{num('Opacity', 'opacity', 0, 100, 5, 100)}</div>
      {el.type === 'image' && num('Size %', 'scale', 3, 100, 1, 100)}
      <div className="ve-row"><label className="ve-f"><span>Start s</span><input type="number" min={0} max={dur} step={0.1} value={el.start ?? ''} placeholder="0" onFocus={onSnap} onChange={e => onLive({ start: e.target.value === '' ? null : Math.min(Math.max(Number(e.target.value) || 0, 0), dur) })} /></label><label className="ve-f"><span>End s</span><input type="number" min={0} max={dur} step={0.1} value={el.end ?? ''} placeholder={String(dur)} onFocus={onSnap} onChange={e => onLive({ end: e.target.value === '' ? null : Math.min(Math.max(Number(e.target.value) || 0, 0), dur) })} /></label></div>
      {PHASE_GATES.animFade && <div className="ve-row"><button className={'ve-chip' + (el.anim?.in === 'fade' ? ' on' : '')} onClick={() => onCommit({ anim: { ...el.anim, in: el.anim?.in === 'fade' ? 'none' : 'fade' } })}>Fade in</button><button className={'ve-chip' + (el.anim?.out === 'fade' ? ' on' : '')} onClick={() => onCommit({ anim: { ...el.anim, out: el.anim?.out === 'fade' ? 'none' : 'fade' } })}>Fade out</button></div>}
    </div>
  )
})

const SceneProps = memo(function SceneProps({ scene, onLive, onCommit, onSnap, onBackground, canTransition }) {
  return (
    <div className="ve-panel">
      <button className="ve-btn full" onClick={onBackground}><Film size={13} /> Change background</button>
      {scene.kind === 'card' && <><label className="ve-lab">Heading</label><input className="ve-input" value={scene.heading || ''} maxLength={80} onFocus={onSnap} onChange={e => onLive({ heading: e.target.value })} /><label className="ve-lab">Subtext</label><input className="ve-input" value={scene.body || ''} maxLength={160} onFocus={onSnap} onChange={e => onLive({ body: e.target.value })} /></>}
      {scene.kind === 'clip' && <><label className="ve-lab">Footage search (if no clip picked)</label><input className="ve-input" value={scene.query || ''} onFocus={onSnap} onChange={e => onLive({ query: e.target.value })} placeholder="e.g. coffee pour cafe" /></>}
      <label className="ve-f wide"><span>Duration {scene.duration ?? sceneSecs(scene)}s</span><input type="range" min={1} max={maxDurFor(scene)} step={0.5} value={scene.duration ?? sceneSecs(scene)} onPointerDown={onSnap} onChange={e => onLive({ duration: Number(e.target.value) })} /></label>
      {(scene.kind === 'card' || scene.kind === 'color') && PHASE_GATES.kenBurns && <button className={'ve-btn full' + (scene.motion === 'kenBurns' ? ' on' : '')} onClick={() => onCommit({ motion: scene.motion === 'kenBurns' ? null : 'kenBurns' })}><ZoomIn size={13} /> Ken Burns {scene.motion === 'kenBurns' ? '✓' : ''}</button>}
      {canTransition && <><label className="ve-lab">Transition → next</label><select className="ve-input" value={scene.transition} onChange={e => onCommit({ transition: e.target.value })}>{TRANSITIONS_V2.map(tr => <option key={tr} value={tr}>{tr}</option>)}</select></>}
      <div className="ve-muted">Trim on the timeline (drag a clip’s ends). Split with the scissors (B). Drag a clip to reorder.</div>
    </div>
  )
})

function MediaPicker({ kind, authed, onClose, onPick, onCard }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]); const [loading, setLoading] = useState(false); const [enabled, setEnabled] = useState(true); const [url, setUrl] = useState('')
  const type = kind === 'image' ? 'image' : 'video'
  async function search() { if (!q.trim()) return; setLoading(true); try { const r = await authed(`/api/stock?q=${encodeURIComponent(q)}&type=${type}&n=12`); const d = await r.json(); setEnabled(d.enabled !== false); setHits(d.hits || []) } catch { setHits([]) } setLoading(false) }
  return (
    <motion.div className="ve-overlay" style={{ zIndex: 120 }} onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="ve-picker" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="ve-top"><div className="ve-top-l"><Search size={14} /><b>{kind === 'image' ? 'Add an image' : 'Choose footage'}</b></div><button className="ve-ic" onClick={onClose}><LX size={16} /></button></div>
        <div className="ve-pk-search"><input className="ve-input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder={kind === 'image' ? 'Search stock images…' : 'Search stock video…'} autoFocus /><button className="ve-btn" onClick={search} disabled={loading}>{loading ? <span className="ve-spin ve-dot" /> : 'Search'}</button></div>
        {!enabled && <div className="ve-muted" style={{ padding: '0 14px' }}>Stock search needs a Pexels key — paste a direct media URL below, or use a text card.</div>}
        <div className="ve-pk-grid">{hits.map((h, i) => <button key={i} className="ve-pk-cell" onClick={() => onPick({ kind: 'clip', url: h.url, query: q })}>{type === 'video' ? <video src={h.url} muted preload="metadata" /> : <img src={h.thumb || h.url} alt="" />}</button>)}{!hits.length && !loading && <div className="ve-muted" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 20 }}>Search to find {type === 'image' ? 'images' : 'clips'}.</div>}</div>
        <div className="ve-pk-foot"><input className="ve-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="…or paste a direct media URL" /><button className="ve-btn" disabled={!/^https?:\/\//.test(url)} onClick={() => onPick(kind === 'image' ? { url } : { kind: 'clip', url })}>Use</button>{kind === 'background' && onCard && <button className="ve-btn ghost" onClick={onCard}>Text card</button>}</div>
      </motion.div>
    </motion.div>
  )
}

function ExportView({ job, downgrades, onBack, onClose }) {
  const s = job?.status
  return (<div className="ve-export-view">
    {downgrades?.length > 0 && s !== 'failed' && <div className="ve-note">Some things were adjusted to render: {downgrades.slice(0, 3).join('; ')}.</div>}
    {s === 'done' ? (<><video className="ve-export-vid" src={job.video_url} controls playsInline preload="metadata" /><div className="ve-muted">Your edited video is ready — it’s in Projects.</div><button className="ve-export" onClick={onClose}>Done</button></>)
      : s === 'failed' ? (<><div className="ve-err">{job.error || 'The render failed.'}</div><button className="ve-btn" onClick={onBack}>Back to edit</button></>)
        : s === 'needs_provider' ? (<div className="ve-muted">Generated video isn’t switched on for this edit.</div>)
          : (<div className="ve-rendering"><span className="ve-spin ve-dot big" /><span>Rendering your video…{job?.status_detail ? ` ${job.status_detail}` : ''}</span><span className="ve-muted">A minute or two — it’ll appear in Projects.</span></div>)}
  </div>)
}

function VeStyles() {
  return <style>{`
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;800&family=Playfair+Display:wght@700&display=swap');
.ve-overlay{position:fixed;inset:0;z-index:110;background:rgba(10,10,14,.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:10px}
.ve{width:min(1340px,99vw);height:97vh;background:#131317;color:#ECECEF;border:1px solid #2A2A33;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55);font-size:13px}
.ve-top{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #232329;gap:10px;flex:none}
.ve-top-l b{font-weight:700;font-size:13.5px}.ve-top-c{display:flex;gap:4px}.ve-top-r{display:flex;align-items:center;gap:8px}
.ve-ic{width:30px;height:28px;border-radius:8px;border:1px solid #2E2E38;background:#1E1E25;color:#C9C9D2;display:flex;align-items:center;justify-content:center;cursor:pointer}
.ve-ic:hover:not(:disabled){background:#2a2a34;color:#fff}.ve-ic:disabled{opacity:.35;cursor:default}.ve-ic.sm{width:24px;height:22px}.ve-ic.on{background:#FFD24A;color:#161616;border-color:#FFD24A}.ve-ic.danger:hover{color:#FF6B6B;border-color:#5a2b2b}.ve-ic.ve-play{background:#FFD24A;color:#161616;border-color:#FFD24A}
.ve-style{display:flex;gap:4px;margin-right:4px}.ve-sw{width:20px;height:20px;border-radius:6px;border:2px solid #33333d;cursor:pointer}.ve-sw.on{border-color:#FFD24A}
.ve-export{display:inline-flex;align-items:center;gap:6px;background:#FFD24A;color:#161616;border:none;border-radius:9px;padding:7px 15px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}.ve-export:disabled{opacity:.6}
.ve-main{flex:1;display:flex;min-height:0}
.ve-tools{width:188px;flex:none;border-right:1px solid #232329;display:flex;flex-direction:column}
.ve-tabs{display:flex;border-bottom:1px solid #232329}
.ve-tab{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;border-bottom:2px solid transparent;color:#9a9aa6;padding:9px 1px;cursor:pointer;font-size:10px;font-family:inherit}
.ve-tab.on{color:#FFD24A;border-bottom-color:#FFD24A}.ve-tab:hover{color:#cfcfd6}
.ve-tabbody{padding:12px;display:flex;flex-direction:column;gap:9px;overflow-y:auto}
.ve-stagewrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px;gap:12px;min-width:0;background:radial-gradient(circle at 50% 35%,#191920,#101015)}
.ve-stage{position:relative;height:100%;max-height:100%;aspect-ratio:9/16;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.55);margin:auto}
.ve-bg{position:absolute;inset:0;width:100%;height:100%}
.ve-bg-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#5a5a66;font-size:12px;text-align:center;padding:20px}
.ve-hint{position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#cfcfd6;font-size:11px;opacity:.85;pointer-events:none}
.ve-el{will-change:transform}.ve-el.sel{outline:2px solid #FFD24A;outline-offset:1px}
.ve-rh{position:absolute;width:13px;height:13px;border-radius:50%;background:#FFD24A;border:2px solid #161616;touch-action:none;z-index:3}
.ve-rh.tl{left:-7px;top:-7px;cursor:nwse-resize}.ve-rh.tr{right:-7px;top:-7px;cursor:nesw-resize}.ve-rh.bl{left:-7px;bottom:-7px;cursor:nesw-resize}.ve-rh.br{right:-7px;bottom:-7px;cursor:nwse-resize}
.ve-transport{display:flex;align-items:center;gap:10px;flex:none}
.ve-time{font-size:12px;color:#cfcfd6;font-variant-numeric:tabular-nums;min-width:96px;text-align:center}.ve-time i{color:#80808c;font-style:normal}
.ve-props{width:232px;flex:none;border-left:1px solid #232329;overflow-y:auto;display:flex;flex-direction:column}
.ve-prop-head{padding:10px 12px;border-bottom:1px solid #232329;font-weight:700;font-size:12.5px;flex:none}
.ve-panel{padding:12px;display:flex;flex-direction:column;gap:9px}
.ve-input{width:100%;background:#1C1C23;border:1px solid #2E2E38;border-radius:8px;color:#ECECEF;padding:7px 9px;font-size:12.5px;font-family:inherit;resize:vertical}
.ve-lab{font-size:11px;color:#8e8e9a;margin-top:2px}
.ve-row{display:flex;gap:7px;flex-wrap:wrap}.ve-grid2{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.ve-f{display:flex;flex-direction:column;gap:3px;font-size:10.5px;color:#9a9aa6;flex:1;min-width:58px}.ve-f.wide{width:100%}
.ve-f input,.ve-f select{background:#1C1C23;border:1px solid #2E2E38;border-radius:7px;color:#ECECEF;padding:5px 7px;font-size:12px;font-family:inherit}.ve-f input[type=color]{padding:2px;height:28px}
.ve-chip{background:#1C1C23;border:1px solid #2E2E38;border-radius:7px;color:#C2C2CC;padding:5px 8px;font-size:11px;cursor:pointer;text-transform:capitalize;font-family:inherit}.ve-chip.on{background:#FFD24A;color:#161616;border-color:#FFD24A;font-weight:700}.ve-chip:disabled{opacity:.4}
.ve-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#26262F;border:1px solid #33333d;border-radius:8px;color:#ECECEF;padding:8px 11px;font-size:12px;cursor:pointer;font-family:inherit}.ve-btn.full{width:100%}.ve-btn.on{background:#FFD24A;color:#161616;border-color:#FFD24A;font-weight:700}.ve-btn.ghost{background:none}.ve-btn:disabled{opacity:.45;cursor:default}.ve-btn:hover:not(:disabled):not(.on){background:#2e2e38}
.ve-muted{font-size:11px;color:#80808c;line-height:1.55}
.ve-split{height:7px;flex:none;cursor:ns-resize;background:#0e0e12;border-top:1px solid #232329;border-bottom:1px solid #232329;display:flex;align-items:center;justify-content:center}
.ve-split::after{content:'';width:40px;height:3px;border-radius:2px;background:#3a3a44}.ve-split:hover::after{background:#FFD24A}
.ve-tl{flex:none;display:flex;flex-direction:column;background:#0f0f13;min-height:132px}
.ve-tl-bar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #1e1e24;flex:none}
.ve-tl-t{font-size:11px;color:#9a9aa6;font-variant-numeric:tabular-nums;margin-left:6px}
.ve-tl-body{flex:1;display:flex;min-height:0}
.ve-tl-labels{width:66px;flex:none;border-right:1px solid #1e1e24;display:flex;flex-direction:column}
.ve-tl-lab{height:56px;display:flex;align-items:center;gap:5px;padding:0 8px;font-size:10px;color:#8a8a96;border-bottom:1px solid #16161b}.ve-tl-lab.head{height:24px;border-bottom:1px solid #1e1e24}
.ve-tl-scroll{flex:1;overflow-x:auto;overflow-y:hidden}
.ve-tl-inner{position:relative;min-width:100%;height:100%;cursor:crosshair}
.ve-ruler{position:relative;height:24px;border-bottom:1px solid #1e1e24}
.ve-tick{position:absolute;top:5px;font-size:9px;color:#5a5a66;transform:translateX(-1px);border-left:1px solid #2a2a33;padding-left:3px;height:16px}
.ve-playhead{position:absolute;top:0;bottom:0;width:2px;background:#FFD24A;z-index:6}
.ve-playhead-head{position:absolute;top:0;left:-8px;width:18px;height:14px;background:#FFD24A;border-radius:3px 3px 6px 6px;cursor:ew-resize;clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)}
.ve-snapline{position:absolute;top:24px;bottom:0;width:1px;background:#4ADE80;z-index:5;pointer-events:none}
.ve-track{position:relative;height:56px;border-bottom:1px solid #16161b}.ve-track.audio{opacity:.72}
.ve-clip{position:absolute;top:5px;height:46px;background:linear-gradient(#3a3550,#2c2840);border:1px solid #4a4566;border-radius:6px;display:flex;align-items:center;overflow:hidden;cursor:grab;user-select:none}
.ve-clip.on{border-color:#FFD24A;box-shadow:0 0 0 1px #FFD24A inset,0 2px 10px rgba(255,210,74,.18)}
.ve-clip-lbl{flex:1;font-size:11px;color:#dcdce6;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.ve-trim{width:9px;align-self:stretch;flex:none;cursor:ew-resize;background:rgba(255,255,255,.06);position:relative}.ve-trim::after{content:'';position:absolute;inset:0 -6px;cursor:ew-resize}.ve-clip.on .ve-trim,.ve-elbar.on .ve-trim{background:rgba(255,210,74,.35)}.ve-trim:hover{background:rgba(255,210,74,.55)}
.ve-xf{position:absolute;right:-6px;top:16px;width:13px;height:13px;background:#FFD24A;transform:rotate(45deg);border-radius:2px;z-index:2;pointer-events:none}
.ve-elbar{position:absolute;top:8px;height:40px;border-radius:6px;display:flex;align-items:center;overflow:hidden;cursor:grab;user-select:none}
.ve-elbar.text{background:#7a4b2e;border:1px solid #a9683f}.ve-elbar.img{background:#2e5a4a;border:1px solid #3f8068}.ve-elbar.audio{background:#2a3a55;border:1px solid #3a4d70;cursor:default;top:8px;height:40px}
.ve-elbar.on{box-shadow:0 0 0 2px #FFD24A inset;border-color:#FFD24A}
.ve-elbar-lbl{flex:1;font-size:10.5px;color:#f0e6dc;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.ve-picker{width:min(640px,94vw);max-height:88vh;background:#141418;border:1px solid #2A2A33;border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
.ve-pk-search{display:flex;gap:8px;padding:12px 14px}
.ve-pk-grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 14px 12px}
.ve-pk-cell{aspect-ratio:9/16;border-radius:9px;overflow:hidden;border:1px solid #2A2A33;background:#000;cursor:pointer;padding:0}.ve-pk-cell video,.ve-pk-cell img{width:100%;height:100%;object-fit:cover;display:block}
.ve-pk-foot{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #232329}
.ve-export-view{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px}
.ve-export-vid{height:60vh;width:auto;border-radius:12px;background:#000}
.ve-rendering{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;font-size:13px}
.ve-note{background:#3a3320;border:1px solid #5a4d22;color:#e8d9a8;border-radius:9px;padding:8px 12px;font-size:12px;max-width:480px;text-align:center}
.ve-err{color:#FF8A80;font-size:13px;text-align:center;max-width:460px}
.ve-dot{width:13px;height:13px;border-radius:50%;border:2px solid rgba(0,0,0,.25);border-top-color:#161616;display:inline-block}.ve-dot.big{width:24px;height:24px;border-width:3px;border-color:rgba(255,255,255,.2);border-top-color:#FFD24A}
.ve-spin{animation:ve-spin 1s linear infinite}@keyframes ve-spin{to{transform:rotate(360deg)}}
@media(max-width:880px){.ve-main{flex-direction:column}.ve-tools{width:100%;flex-direction:row;border-right:none;border-bottom:1px solid #232329}.ve-tabs{flex-direction:column;border-bottom:none;border-right:1px solid #232329;width:56px}.ve-props{width:100%;border-left:none;border-top:1px solid #232329;max-height:26vh}.ve-pk-grid{grid-template-columns:repeat(3,1fr)}}
`}</style>
}
