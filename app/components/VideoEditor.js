'use client'
// app/components/VideoEditor.js — a real timeline-less-but-real video editor over
// the EditPlan IR v2 (Phase 1a). A scaled 9:16 canvas with SELECTABLE + DRAGGABLE
// text/image overlay elements, a contextual properties panel, a scene strip, a
// stock/url media picker, a playback scrubber, undo/redo, and Export → the proven
// directed render (compositeScene). Coordinates are 0..1 fractions of the fixed
// 1080x1920 canvas via lib/overlay-coords (same module the renderer uses), so a
// position in the preview lands in the same place in the export.
//
// Phase 1a deliberately ships drag + properties-panel sizing; corner resize
// handles + a real multi-track timeline are Phase 1b. The editor mounts UI from
// PHASE_GATES, so it never offers what the renderer would drop.
import { useReducer, useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X as LX, Type, Image as LImage, Film, Plus, Trash2, Undo2, Redo2, Play, Pause, ChevronDown, Search, Layers, Sparkles, Loader2 } from 'lucide-react'
import { normalizeEditPlanV2, FONTS, ANCHORS, MAX_ELEMENTS, MAX_SCENES, STYLE_KEYS, PHASE_GATES } from '@/lib/edit-plan'
import { clamp01, cssAnchorStyle } from '@/lib/overlay-coords'
import { SLIDE_STYLES, FONT_CSS, FONT_CAPS } from '@/lib/style-tokens'

const spring = { type: 'spring', stiffness: 380, damping: 32 }
const clone = p => (typeof structuredClone === 'function' ? structuredClone(p) : JSON.parse(JSON.stringify(p)))
const sceneSecs = s => s.duration != null ? s.duration : (s.kind === 'card' || s.kind === 'color') ? 3 : 5
const uid = pfx => pfx + Math.random().toString(36).slice(2, 8)

const updScene = (plan, i, fn) => ({ ...plan, scenes: plan.scenes.map((s, j) => j === i ? fn(s) : s) })
const updEl = (plan, i, id, patch) => updScene(plan, i, s => ({ ...s, elements: s.elements.map(e => e.id === id ? { ...e, ...patch } : e) }))

const blankText = () => ({ id: uid('e'), type: 'text', text: 'Your text', font: 'anton', size: 0.08, color: '#FFFFFF', stroke: { color: '#000000', width: 8 }, box: null, align: 'center', multiline: false, x: 0.5, y: 0.5, anchor: 'center', scale: 0.8, opacity: 1, rotation: 0, start: null, end: null, anim: { in: 'none', out: 'none', move: null } })
const blankImage = url => ({ id: uid('e'), type: 'image', url, asset_id: null, x: 0.5, y: 0.5, anchor: 'center', scale: 0.35, opacity: 1, rotation: 0, start: null, end: null, anim: { in: 'none', out: 'none', move: null } })
const blankClipScene = () => ({ id: uid('s'), kind: 'clip', query: '', url: null, asset_id: null, duration: 5, transition: 'cut', transition_dur: 0.3, motion: null, trim_start: null, trim_end: null, elements: [] })
const blankCardScene = () => ({ id: uid('s'), kind: 'card', eyebrow: null, heading: 'New scene', body: null, duration: 3, transition: 'cut', transition_dur: 0.3, motion: null, elements: [] })

function reducer(s, a) {
  switch (a.type) {
    case 'snapshot': return { ...s, past: [...s.past, s.plan].slice(-60), future: [] }
    case 'live': return { ...s, plan: a.plan }
    case 'commit': return { ...s, past: [...s.past, s.plan].slice(-60), plan: a.plan, future: [] }
    case 'undo': return s.past.length ? { ...s, plan: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.plan, ...s.future].slice(0, 60), selEl: null } : s
    case 'redo': return s.future.length ? { ...s, plan: s.future[0], future: s.future.slice(1), past: [...s.past, s.plan].slice(-60), selEl: null } : s
    case 'sel': return { ...s, selScene: a.selScene ?? s.selScene, selEl: a.selEl !== undefined ? a.selEl : s.selEl }
    default: return s
  }
}

// Inline poll of the export job (mirrors useVideoJob in page.js; the editor is a
// standalone module so it carries its own small poller).
function usePoll(jobId, authed, onTerminal) {
  const [job, setJob] = useState(null)
  useEffect(() => {
    if (!jobId) return
    let alive = true, tries = 0, timer
    const tick = async () => {
      try { const r = await authed(`/api/video?id=${jobId}`); const j = (await r.json()).job; if (alive && j) { setJob(j); if (['done', 'failed', 'needs_provider'].includes(j.status)) { onTerminal && onTerminal(j); return } } } catch { /* keep polling */ }
      if (alive && ++tries < 160) timer = setTimeout(tick, 5000)
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [jobId]) // eslint-disable-line
  return job
}

export default function VideoEditor({ job, authed, onRerendered, onClose }) {
  // Load the plan: a v2 plan as-is; a v1 plan lifted via the normalizer; any other
  // finished video lifted into a single clip scene (its mp4 becomes the background).
  const initial = useMemo(() => {
    if (job.edit_plan?.scenes?.length) return job.edit_plan.version === 2 ? clone(job.edit_plan) : normalizeEditPlanV2(job.edit_plan, {}).plan
    return { version: 2, aspect: job.aspect || 'vertical', captions: 'off', style_key: job.style_key || 'bold', audio: null,
      scenes: [{ id: 's0', kind: 'clip', url: job.video_url || null, query: null, asset_id: null, duration: 15, transition: 'cut', transition_dur: 0.3, motion: null, trim_start: null, trim_end: null, elements: [] }] }
  }, [job])

  const [state, dispatch] = useReducer(reducer, null, () => ({ plan: initial, selScene: 0, selEl: null, past: [], future: [] }))
  const { plan, selScene, selEl } = state
  const scene = plan.scenes[Math.min(selScene, plan.scenes.length - 1)] || plan.scenes[0]
  const sIdx = plan.scenes.indexOf(scene)
  const dur = sceneSecs(scene)
  const selectedEl = scene.elements.find(e => e.id === selEl) || null

  const [t, setT] = useState(0)              // playhead within the current scene
  const [playing, setPlaying] = useState(false)
  const [picker, setPicker] = useState(null) // { for:'background'|'image' }
  const [exportId, setExportId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState('')
  const [downgrades, setDowngrades] = useState([])
  const stageRef = useRef(null)
  const videoRef = useRef(null)
  const doneRef = useRef(false)

  // helpers bound to the current scene
  const commit = useCallback(p => dispatch({ type: 'commit', plan: p }), [])
  const live = useCallback(p => dispatch({ type: 'live', plan: p }), [])
  const snapshot = useCallback(() => dispatch({ type: 'snapshot' }), [])
  const selectEl = id => dispatch({ type: 'sel', selEl: id })

  // ── stage scale: publish --stage-w/--stage-h px so element px math divides by S
  useEffect(() => {
    const el = stageRef.current; if (!el) return
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); el.style.setProperty('--stage-w', r.width + 'px'); el.style.setProperty('--stage-h', r.height + 'px') })
    ro.observe(el); return () => ro.disconnect()
  }, [])

  // reset playhead when scene changes
  useEffect(() => { setT(0); setPlaying(false); if (videoRef.current) { try { videoRef.current.pause(); videoRef.current.currentTime = 0 } catch {} } }, [scene.id])

  // ── playback clock: native <video> drives t when present, else a wall clock ──
  useEffect(() => {
    if (!playing) return
    let raf, start = null, base = t
    const v = videoRef.current
    if (v && scene.kind !== 'card' && scene.kind !== 'color' && (scene.url)) { try { v.currentTime = t; v.play() } catch {} }
    const loop = ts => {
      if (start == null) start = ts
      let nt
      if (v && scene.url && !v.paused) nt = v.currentTime
      else nt = base + (ts - start) / 1000
      if (nt >= dur) { nt = 0; start = ts; base = 0; if (v && scene.url) { try { v.currentTime = 0 } catch {} } }
      setT(nt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); if (v) try { v.pause() } catch {} }
  }, [playing, scene.id]) // eslint-disable-line

  function scrub(nt) { setPlaying(false); setT(nt); if (videoRef.current && scene.url) { try { videoRef.current.currentTime = nt } catch {} } }

  // ── element drag (manual pointer events; deltas ÷ stage px = fraction) ──
  function startDrag(e, el) {
    if (playing) return
    e.stopPropagation(); selectEl(el.id)
    const rect = stageRef.current.getBoundingClientRect()
    const ox = el.x, oy = el.y, sx = e.clientX, sy = e.clientY
    let moved = false
    const onMove = ev => {
      if (!moved) { moved = true; snapshot() }
      const nx = clamp01(ox + (ev.clientX - sx) / rect.width)
      const ny = clamp01(oy + (ev.clientY - sy) / rect.height)
      live(updEl(plan, sIdx, el.id, { x: nx, y: ny }))
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }

  // ── element / scene ops ──
  const addText = () => { if (scene.elements.length >= MAX_ELEMENTS) return; const el = blankText(); commit(updScene(plan, sIdx, s => ({ ...s, elements: [...s.elements, el] }))); selectEl(el.id) }
  const addImage = url => { if (scene.elements.length >= MAX_ELEMENTS) return; const el = blankImage(url); commit(updScene(plan, sIdx, s => ({ ...s, elements: [...s.elements, el] }))); selectEl(el.id); setPicker(null) }
  const delEl = id => { commit(updScene(plan, sIdx, s => ({ ...s, elements: s.elements.filter(e => e.id !== id) }))); if (selEl === id) selectEl(null) }
  // commit = one undo step (pushes the pre-change plan); live = no history (paired
  // with an onFocus/pointer-down snapshot so a drag/typing session is one step).
  const setEl = patch => commit(updEl(plan, sIdx, selEl, patch))
  const setElLive = patch => live(updEl(plan, sIdx, selEl, patch))

  const addScene = kind => { if (plan.scenes.length >= MAX_SCENES) return; const s = kind === 'card' ? blankCardScene() : blankClipScene(); commit({ ...plan, scenes: [...plan.scenes, s] }); dispatch({ type: 'sel', selScene: plan.scenes.length, selEl: null }) }
  const delScene = i => { if (plan.scenes.length <= 1) return; commit({ ...plan, scenes: plan.scenes.filter((_, j) => j !== i) }); dispatch({ type: 'sel', selScene: Math.max(0, i - 1), selEl: null }) }
  const moveScene = (i, d) => { const j = i + d; if (j < 0 || j >= plan.scenes.length) return; const a = plan.scenes.slice();[a[i], a[j]] = [a[j], a[i]]; commit({ ...plan, scenes: a }); dispatch({ type: 'sel', selScene: j }) }
  const setSceneLive = patch => live(updScene(plan, sIdx, s => ({ ...s, ...patch })))
  const setStyle = k => commit({ ...plan, style_key: k })
  const setBackground = sel => { // sel: {kind, url?, query?}
    commit(updScene(plan, sIdx, s => ({ ...s, kind: sel.kind, url: sel.url ?? null, query: sel.query ?? null, asset_id: null, heading: sel.kind === 'card' ? (s.heading || 'New scene') : s.heading })))
    setPicker(null)
  }

  // keyboard: undo/redo + delete selection (skip when typing)
  useEffect(() => {
    const onKey = e => {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }) }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selEl) { e.preventDefault(); delEl(selEl) }
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'Escape') selectEl(null)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line

  // ── export ──
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
      <motion.div className="ve" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={spring}>
        {/* top bar */}
        <div className="ve-top">
          <div className="ve-top-l">
            <Layers size={15} /><b>Video editor</b>
          </div>
          <div className="ve-top-c">
            <button className="ve-ic" title="Undo (⌘Z)" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 size={15} /></button>
            <button className="ve-ic" title="Redo (⇧⌘Z)" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 size={15} /></button>
          </div>
          <div className="ve-top-r">
            <div className="ve-style">
              {STYLE_KEYS.map(k => <button key={k} className={'ve-sw' + (plan.style_key === k ? ' on' : '')} title={k} style={{ background: (SLIDE_STYLES[k] || {}).bg }} onClick={() => setStyle(k)} />)}
            </div>
            <button className="ve-export" disabled={exporting} onClick={doExport}>{exporting ? <Loader2 size={14} className="ve-spin" /> : <Sparkles size={14} />} Export</button>
            <button className="ve-ic" onClick={onClose}><LX size={17} /></button>
          </div>
        </div>

        {exportId ? (
          <ExportView job={exportJob} downgrades={downgrades} onBack={() => { doneRef.current = false; setExportId(null); setExporting(false) }} onClose={onClose} />
        ) : (
          <div className="ve-body">
            {/* add rail */}
            <div className="ve-rail">
              {PHASE_GATES.textElement && <button className="ve-add" onClick={addText} title="Add text"><Type size={18} /><span>Text</span></button>}
              {PHASE_GATES.imageElement && <button className="ve-add" onClick={() => setPicker({ for: 'image' })} title="Add image / logo"><LImage size={18} /><span>Image</span></button>}
              <button className="ve-add" onClick={() => setPicker({ for: 'background' })} title="Scene background"><Film size={18} /><span>Footage</span></button>
            </div>

            {/* stage */}
            <div className="ve-stagewrap">
              <div className="ve-stage" ref={stageRef} onPointerDown={() => selectEl(null)}>
                <Background scene={scene} style={style} videoRef={videoRef} />
                {scene.elements.map(el => {
                  const visible = (el.start == null || t >= el.start) && (el.end == null || t < el.end)
                  return <CanvasEl key={el.id} el={el} selected={selEl === el.id} dimmed={!visible} onPointerDown={e => startDrag(e, el)} />
                })}
                {scene.elements.length === 0 && scene.kind === 'clip' && !scene.url && (
                  <div className="ve-hint">Pick footage, then add text or a logo →</div>
                )}
              </div>
              {/* transport */}
              <div className="ve-transport">
                <button className="ve-ic" onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
                <input className="ve-scrub" type="range" min={0} max={dur} step={0.05} value={Math.min(t, dur)} onChange={e => scrub(Number(e.target.value))} />
                <span className="ve-time">{t.toFixed(1)}s / {dur}s</span>
              </div>
            </div>

            {/* properties */}
            <div className="ve-props">
              {selectedEl ? <ElementProps el={selectedEl} onLive={setElLive} onCommit={setEl} onSnap={snapshot} onDelete={() => delEl(selectedEl.id)} dur={dur} />
                : <SceneProps scene={scene} onLive={setSceneLive} onSnap={snapshot} onBackground={() => setPicker({ for: 'background' })} />}
            </div>
          </div>
        )}

        {/* scene strip */}
        {!exportId && (
          <div className="ve-scenes">
            {plan.scenes.map((s, i) => (
              <button key={s.id} className={'ve-scene' + (i === sIdx ? ' on' : '')} onClick={() => dispatch({ type: 'sel', selScene: i, selEl: null })}>
                <span className="ve-scene-n">{i + 1}</span>
                <span className="ve-scene-k">{s.kind === 'card' ? (s.heading || 'Card') : s.kind === 'color' ? 'Color' : 'Clip'}</span>
                <span className="ve-scene-d">{sceneSecs(s)}s{s.elements.length ? ` · ${s.elements.length}▦` : ''}</span>
                {i === sIdx && plan.scenes.length > 1 && <span className="ve-scene-x" onClick={e => { e.stopPropagation(); delScene(i) }}><Trash2 size={11} /></span>}
              </button>
            ))}
            <div className="ve-scene-add">
              <button className="ve-add-s" disabled={plan.scenes.length >= MAX_SCENES} onClick={() => addScene('clip')}><Plus size={12} /> Clip</button>
              <button className="ve-add-s" disabled={plan.scenes.length >= MAX_SCENES} onClick={() => addScene('card')}><Plus size={12} /> Card</button>
            </div>
            {sIdx > 0 && <button className="ve-ic sm" title="Move left" onClick={() => moveScene(sIdx, -1)}><ChevronDown size={13} style={{ transform: 'rotate(90deg)' }} /></button>}
            {sIdx < plan.scenes.length - 1 && <button className="ve-ic sm" title="Move right" onClick={() => moveScene(sIdx, 1)}><ChevronDown size={13} style={{ transform: 'rotate(-90deg)' }} /></button>}
          </div>
        )}
      </motion.div>

      {picker && <MediaPicker kind={picker.for} authed={authed} onClose={() => setPicker(null)}
        onPick={sel => picker.for === 'image' ? addImage(sel.url) : setBackground(sel)} onCard={() => setBackground({ kind: 'card' })} />}
    </motion.div>
  )
}

// ── the scene background in the canvas (preview approximation of the render) ──
function Background({ scene, style, videoRef }) {
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
  if (scene.url) return <video className="ve-bg" ref={videoRef} src={scene.url} muted playsInline preload="metadata" style={{ objectFit: 'cover' }} />
  return <div className="ve-bg ve-bg-empty"><Film size={28} />{scene.query ? <span>{scene.query}</span> : <span>No footage yet</span>}</div>
}

// ── one overlay element on the canvas ──
function CanvasEl({ el, selected, dimmed, onPointerDown }) {
  const anchor = cssAnchorStyle(el)
  const common = { position: 'absolute', ...anchor, opacity: dimmed ? 0.25 : el.opacity, cursor: 'move', touchAction: 'none' }
  if (el.type === 'text') {
    const caps = FONT_CAPS[el.font]
    const box = el.box ? { background: el.box.color, padding: `calc(var(--stage-w) * ${el.box.pad / 1080})`, borderRadius: `calc(var(--stage-w) * ${(el.box.radius || 0) / 1080})` } : {}
    const stroke = el.stroke && el.stroke.width > 0 ? { WebkitTextStroke: `calc(var(--stage-w) * ${el.stroke.width / 1080}) ${el.stroke.color}`, paintOrder: 'stroke fill' } : {}
    return (
      <div className={'ve-el' + (selected ? ' sel' : '')} style={{ ...common }} onPointerDown={onPointerDown}>
        <div style={{ fontFamily: FONT_CSS[el.font], color: el.color, fontSize: `calc(var(--stage-h) * ${el.size})`, lineHeight: 1.05, whiteSpace: 'nowrap', textTransform: caps ? 'uppercase' : 'none', textAlign: el.align, fontWeight: el.font === 'inter' ? 800 : 400, ...stroke, ...box }}>{el.text || ' '}</div>
      </div>
    )
  }
  return (
    <div className={'ve-el' + (selected ? ' sel' : '')} style={{ ...common, width: `calc(var(--stage-w) * ${el.scale})` }} onPointerDown={onPointerDown}>
      <img src={el.url} alt="" draggable={false} style={{ width: '100%', height: 'auto', display: 'block', pointerEvents: 'none' }} />
    </div>
  )
}

// ── properties for the selected element ──
function ElementProps({ el, onLive, onCommit, onSnap, onDelete, dur }) {
  const num = (label, key, min, max, step, scale = 1) => (
    <label className="ve-f"><span>{label}</span>
      <input type="number" inputMode="decimal" min={min} max={max} step={step} value={Math.round((el[key] ?? 0) * scale * 100) / 100}
        onFocus={onSnap} onChange={e => onLive({ [key]: Math.min(Math.max((Number(e.target.value) || 0) / scale, min / scale), max / scale) })} />
    </label>
  )
  return (
    <div className="ve-panel">
      <div className="ve-panel-h">{el.type === 'text' ? 'Text' : 'Image'} <button className="ve-ic sm danger" onClick={onDelete}><Trash2 size={13} /></button></div>
      {el.type === 'text' && <>
        <textarea className="ve-input" rows={2} value={el.text} onFocus={onSnap} onChange={e => onLive({ text: e.target.value.slice(0, 200) })} placeholder="Text…" />
        <div className="ve-row">
          {FONTS.map(f => <button key={f} className={'ve-chip' + (el.font === f ? ' on' : '')} style={{ fontFamily: FONT_CSS[f] }} onClick={() => onCommit({ font: f })}>{f}</button>)}
        </div>
        <div className="ve-row">
          <label className="ve-f"><span>Color</span><input type="color" value={el.color} onFocus={onSnap} onChange={e => onLive({ color: e.target.value })} /></label>
          <label className="ve-f"><span>Outline</span><input type="color" value={el.stroke?.color || '#000000'} onFocus={onSnap} onChange={e => onLive({ stroke: { color: e.target.value, width: el.stroke?.width ?? 8 } })} /></label>
        </div>
        <div className="ve-row">
          {num('Size', 'size', 2, 30, 0.5, 100)}
          <label className="ve-f"><span>Outline w</span>
            <input type="number" min={0} max={30} step={1} value={el.stroke?.width ?? 0} onFocus={onSnap}
              onChange={e => onLive({ stroke: { color: el.stroke?.color || '#000000', width: Math.min(Math.max(Number(e.target.value) || 0, 0), 30) } })} /></label>
        </div>
        <div className="ve-row">
          {['left', 'center', 'right'].map(a => <button key={a} className={'ve-chip' + (el.align === a ? ' on' : '')} onClick={() => onCommit({ align: a })}>{a}</button>)}
        </div>
      </>}
      <div className="ve-row">
        {num('X %', 'x', 0, 100, 1, 100)}
        {num('Y %', 'y', 0, 100, 1, 100)}
      </div>
      <div className="ve-row">
        <label className="ve-f"><span>Anchor</span>
          <select value={el.anchor} onChange={e => onCommit({ anchor: e.target.value })}>{ANCHORS.map(a => <option key={a} value={a}>{a}</option>)}</select>
        </label>
        {num('Opacity', 'opacity', 0, 100, 5, 100)}
      </div>
      {el.type === 'image' && num('Size %', 'scale', 2, 100, 1, 100)}
      <div className="ve-row">
        <label className="ve-f"><span>Start s</span><input type="number" min={0} max={dur} step={0.1} value={el.start ?? ''} placeholder="0" onFocus={onSnap} onChange={e => onLive({ start: e.target.value === '' ? null : Math.min(Math.max(Number(e.target.value) || 0, 0), dur) })} /></label>
        <label className="ve-f"><span>End s</span><input type="number" min={0} max={dur} step={0.1} value={el.end ?? ''} placeholder={String(dur)} onFocus={onSnap} onChange={e => onLive({ end: e.target.value === '' ? null : Math.min(Math.max(Number(e.target.value) || 0, 0), dur) })} /></label>
      </div>
      {PHASE_GATES.animFade && <div className="ve-row">
        <button className={'ve-chip' + (el.anim?.in === 'fade' ? ' on' : '')} onClick={() => onCommit({ anim: { ...el.anim, in: el.anim?.in === 'fade' ? 'none' : 'fade' } })}>Fade in</button>
        <button className={'ve-chip' + (el.anim?.out === 'fade' ? ' on' : '')} onClick={() => onCommit({ anim: { ...el.anim, out: el.anim?.out === 'fade' ? 'none' : 'fade' } })}>Fade out</button>
      </div>}
    </div>
  )
}

function SceneProps({ scene, onLive, onSnap, onBackground }) {
  return (
    <div className="ve-panel">
      <div className="ve-panel-h">Scene</div>
      <button className="ve-btn" onClick={onBackground}><Film size={13} /> Change background</button>
      {scene.kind === 'card' && <>
        <label className="ve-lab">Heading</label>
        <input className="ve-input" value={scene.heading || ''} maxLength={80} onFocus={onSnap} onChange={e => onLive({ heading: e.target.value })} />
        <label className="ve-lab">Subtext</label>
        <input className="ve-input" value={scene.body || ''} maxLength={160} onFocus={onSnap} onChange={e => onLive({ body: e.target.value })} />
      </>}
      {(scene.kind === 'clip') && <>
        <label className="ve-lab">Footage search (if no clip picked)</label>
        <input className="ve-input" value={scene.query || ''} onFocus={onSnap} onChange={e => onLive({ query: e.target.value })} placeholder="e.g. coffee pour cafe" />
      </>}
      <label className="ve-f wide"><span>Duration {scene.duration ?? sceneSecs(scene)}s</span>
        <input type="range" min={1} max={15} step={1} value={scene.duration ?? sceneSecs(scene)} onPointerDown={onSnap} onChange={e => onLive({ duration: Number(e.target.value) })} />
      </label>
      <div className="ve-muted">Tip: select an element to edit it. Drag elements on the canvas to position them.</div>
    </div>
  )
}

// ── media picker: stock search + paste url (+ "use a text card") ──
function MediaPicker({ kind, authed, onClose, onPick, onCard }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [loading, setLoading] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [url, setUrl] = useState('')
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
        <div className="ve-top">
          <div className="ve-top-l"><Search size={14} /><b>{kind === 'image' ? 'Add an image' : 'Choose footage'}</b></div>
          <button className="ve-ic" onClick={onClose}><LX size={16} /></button>
        </div>
        <div className="ve-pk-search">
          <input className="ve-input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder={kind === 'image' ? 'Search stock images…' : 'Search stock video…'} autoFocus />
          <button className="ve-btn" onClick={search} disabled={loading}>{loading ? <Loader2 size={13} className="ve-spin" /> : 'Search'}</button>
        </div>
        {!enabled && <div className="ve-muted" style={{ padding: '0 14px' }}>Stock search needs a Pexels key — paste a direct media URL below, or use a text card.</div>}
        <div className="ve-pk-grid">
          {hits.map((h, i) => (
            <button key={i} className="ve-pk-cell" onClick={() => onPick({ kind: 'clip', url: h.url, query: q })}>
              {type === 'video' ? <video src={h.url} muted preload="metadata" /> : <img src={h.thumb || h.url} alt="" />}
            </button>
          ))}
          {!hits.length && !loading && <div className="ve-muted" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 20 }}>Search to find {type === 'image' ? 'images' : 'clips'}.</div>}
        </div>
        <div className="ve-pk-foot">
          <input className="ve-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="…or paste a direct media URL" />
          <button className="ve-btn" disabled={!/^https?:\/\//.test(url)} onClick={() => onPick(kind === 'image' ? { url } : { kind: 'clip', url })}>Use</button>
          {kind === 'background' && onCard && <button className="ve-btn ghost" onClick={onCard}>Text card</button>}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── export progress view (reuses the directed render + poll) ──
function ExportView({ job, downgrades, onBack, onClose }) {
  const s = job?.status
  return (
    <div className="ve-export-view">
      {downgrades?.length > 0 && s !== 'failed' && <div className="ve-note">Some scenes were adjusted to render: {downgrades.slice(0, 3).join('; ')}.</div>}
      {s === 'done' ? (
        <><video className="ve-export-vid" src={job.video_url} controls playsInline preload="metadata" />
          <div className="ve-muted">Your edited video is ready — it’s in Projects.</div>
          <button className="ve-export" onClick={onClose}>Done</button></>
      ) : s === 'failed' ? (
        <><div className="ve-err">{job.error || 'The render failed.'}</div><button className="ve-btn" onClick={onBack}>Back to edit</button></>
      ) : s === 'needs_provider' ? (
        <div className="ve-muted">Generated video isn’t switched on for this edit.</div>
      ) : (
        <div className="ve-rendering"><Loader2 size={26} className="ve-spin" /><span>Rendering your video…{job?.status_detail ? ` ${job.status_detail}` : ''}</span><span className="ve-muted">A minute or two — it’ll appear in Projects.</span></div>
      )}
    </div>
  )
}

// ── component-scoped styles ──
function VeStyles() {
  return <style>{`
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;800&family=Playfair+Display:wght@700&display=swap');
.ve-overlay{position:fixed;inset:0;z-index:110;background:rgba(12,12,16,.62);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:18px}
.ve{width:min(1080px,96vw);height:min(92vh,860px);background:#15151A;color:#ECECEF;border:1px solid #2A2A33;border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.ve-top{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #24242C;gap:10px}
.ve-top-l{display:flex;align-items:center;gap:7px;font-size:13.5px}.ve-top-l b{font-weight:700}
.ve-top-c{display:flex;gap:4px}.ve-top-r{display:flex;align-items:center;gap:8px}
.ve-ic{width:30px;height:28px;border-radius:8px;border:1px solid #2E2E38;background:#1E1E25;color:#C9C9D2;display:flex;align-items:center;justify-content:center;cursor:pointer}
.ve-ic:hover:not(:disabled){background:#26262F}.ve-ic:disabled{opacity:.35;cursor:default}.ve-ic.sm{width:24px;height:22px}.ve-ic.danger:hover{color:#FF6B6B;border-color:#5a2b2b}
.ve-style{display:flex;gap:4px;margin-right:4px}
.ve-sw{width:20px;height:20px;border-radius:6px;border:2px solid transparent;cursor:pointer}.ve-sw.on{border-color:#FFD24A}
.ve-export{display:inline-flex;align-items:center;gap:6px;background:#FFD24A;color:#161616;border:none;border-radius:9px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}
.ve-export:disabled{opacity:.6}
.ve-body{flex:1;display:flex;min-height:0}
.ve-rail{width:64px;flex:none;border-right:1px solid #24242C;display:flex;flex-direction:column;gap:4px;padding:10px 6px}
.ve-add{display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:1px solid transparent;border-radius:10px;color:#C2C2CC;padding:9px 4px;cursor:pointer;font-size:10.5px;font-family:inherit}
.ve-add:hover{background:#1E1E25;border-color:#2E2E38}
.ve-stagewrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px;gap:10px;min-width:0;background:radial-gradient(circle at 50% 30%,#1B1B22,#131318)}
.ve-stage{position:relative;height:100%;max-height:62vh;aspect-ratio:9/16;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.ve-bg{position:absolute;inset:0;width:100%;height:100%}
.ve-bg-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#5a5a66;font-size:12px;text-align:center;padding:20px}
.ve-hint{position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#cfcfd6;font-size:11px;opacity:.8}
.ve-el{will-change:transform}.ve-el.sel{outline:2px solid #FFD24A;outline-offset:2px;border-radius:3px}
.ve-transport{display:flex;align-items:center;gap:10px;width:100%;max-width:420px}
.ve-scrub{flex:1;accent-color:#FFD24A}
.ve-time{font-size:11px;color:#9a9aa6;font-variant-numeric:tabular-nums;min-width:74px;text-align:right}
.ve-props{width:264px;flex:none;border-left:1px solid #24242C;overflow-y:auto;padding:12px}
.ve-panel{display:flex;flex-direction:column;gap:9px}
.ve-panel-h{display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:13px;text-transform:capitalize}
.ve-input{width:100%;background:#1C1C23;border:1px solid #2E2E38;border-radius:8px;color:#ECECEF;padding:7px 9px;font-size:12.5px;font-family:inherit;resize:vertical}
.ve-lab{font-size:11px;color:#8e8e9a;margin-top:2px}
.ve-row{display:flex;gap:7px;flex-wrap:wrap}
.ve-f{display:flex;flex-direction:column;gap:3px;font-size:10.5px;color:#9a9aa6;flex:1;min-width:64px}
.ve-f.wide{width:100%}
.ve-f input,.ve-f select{background:#1C1C23;border:1px solid #2E2E38;border-radius:7px;color:#ECECEF;padding:5px 7px;font-size:12px;font-family:inherit}
.ve-f input[type=color]{padding:2px;height:28px}
.ve-chip{background:#1C1C23;border:1px solid #2E2E38;border-radius:7px;color:#C2C2CC;padding:5px 9px;font-size:11px;cursor:pointer;text-transform:capitalize;font-family:inherit}
.ve-chip.on{background:#FFD24A;color:#161616;border-color:#FFD24A;font-weight:700}
.ve-btn{display:inline-flex;align-items:center;gap:6px;background:#26262F;border:1px solid #33333d;border-radius:8px;color:#ECECEF;padding:7px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.ve-btn.ghost{background:none}.ve-btn:disabled{opacity:.4;cursor:default}
.ve-muted{font-size:11px;color:#80808c;line-height:1.5}
.ve-scenes{display:flex;align-items:center;gap:7px;padding:9px 12px;border-top:1px solid #24242C;overflow-x:auto}
.ve-scene{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:78px;background:#1A1A21;border:1px solid #2A2A33;border-radius:10px;padding:7px 9px;cursor:pointer;flex:none;font-family:inherit;color:#C2C2CC}
.ve-scene.on{border-color:#FFD24A;background:#20201c}
.ve-scene-n{font-size:9px;color:#7a7a86}.ve-scene-k{font-size:11.5px;font-weight:600;color:#ECECEF;max-width:88px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ve-scene-d{font-size:9.5px;color:#80808c}
.ve-scene-x{position:absolute;top:4px;right:4px;color:#7a7a86}.ve-scene-x:hover{color:#FF6B6B}
.ve-scene-add{display:flex;flex-direction:column;gap:3px;flex:none}
.ve-add-s{display:inline-flex;align-items:center;gap:3px;background:#1A1A21;border:1px dashed #34343f;border-radius:8px;color:#9a9aa6;padding:5px 8px;font-size:10.5px;cursor:pointer;font-family:inherit}
.ve-add-s:disabled{opacity:.4}
.ve-picker{width:min(620px,94vw);max-height:88vh;background:#15151A;border:1px solid #2A2A33;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;color:#ECECEF}
.ve-pk-search{display:flex;gap:8px;padding:12px 14px}
.ve-pk-grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 14px 12px}
.ve-pk-cell{aspect-ratio:9/16;border-radius:9px;overflow:hidden;border:1px solid #2A2A33;background:#000;cursor:pointer;padding:0}
.ve-pk-cell video,.ve-pk-cell img{width:100%;height:100%;object-fit:cover;display:block}
.ve-pk-foot{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #24242C}
.ve-export-view,.ve-export-vid{display:flex}
.ve-export-view{flex:1;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px}
.ve-export-vid{width:auto;height:54vh;border-radius:12px;background:#000}
.ve-rendering{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;font-size:13px}
.ve-note{background:#3a3320;border:1px solid #5a4d22;color:#e8d9a8;border-radius:9px;padding:8px 12px;font-size:12px;max-width:460px;text-align:center}
.ve-err{color:#FF8A80;font-size:13px;text-align:center;max-width:460px}
.ve-spin{animation:ve-spin 1s linear infinite}@keyframes ve-spin{to{transform:rotate(360deg)}}
@media(max-width:720px){.ve-body{flex-direction:column}.ve-rail{width:100%;flex-direction:row;border-right:none;border-bottom:1px solid #24242C}.ve-props{width:100%;border-left:none;border-top:1px solid #24242C;max-height:34vh}.ve-stage{max-height:42vh}.ve-pk-grid{grid-template-columns:repeat(3,1fr)}}
`}</style>
}
