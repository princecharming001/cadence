'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  Check as LCheck, X as LX, RefreshCw, Sparkles, Send, Plus,
  Brain, ChevronDown, Trash2, Pencil, Crown, Clock, Wand2, FileText, Image as LImage,
  ThumbsUp, ThumbsDown, Megaphone, Upload, Play, Pause as LPause,
} from 'lucide-react'

function LIcon({ size = 18 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.74v20.52C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.74V1.74C24 .78 23.2 0 22.22 0z"/></svg> }

const BrainViz = dynamic(() => import('./BrainViz'), { ssr: false })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const STATUS = {
  draft:  { c: '#8b5cf6', label: 'draft' }, queued: { c: '#10b981', label: 'queued' },
  paused: { c: '#f59e0b', label: 'paused' }, posted: { c: '#3b82f6', label: 'posted' },
  failed: { c: '#ef4444', label: 'failed' },
}
const MAX = 280
const TZS = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney']

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}
function titleOf(content) {
  const first = (content || '').split('\n').find(l => l.trim()) || ''
  return first.length > 64 ? first.slice(0, 62).trimEnd() + '…' : first
}
const pad = n => String(n).padStart(2, '0')
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
function defaultWhen(hour = 9) { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(hour, 0, 0, 0); return toLocalInput(d) }
const spring = { type: 'spring', stiffness: 400, damping: 30 }

// icon wrappers (keep names used across the file)
const Check = (p) => <LCheck size={15} strokeWidth={3} {...p} />
const Ex = (p) => <LX size={15} strokeWidth={3} {...p} />
const Refresh = (p) => <RefreshCw size={14} strokeWidth={2.4} {...p} />
function XGlyph() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}><path d="M18.9 1.2h3.7l-8 9.1L24 22.8h-7.4l-5.8-7.5-6.6 7.5H.5l8.5-9.7L0 1.2h7.6l5.2 6.9zM17.6 20.6h2L6.5 3.3H4.3z"/></svg> }

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" className="row" onClick={() => onChange(!on)} style={{ gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
      <span className={'switch' + (on ? ' on' : '')}><span className="knob" /></span>
      {label && <span style={{ fontSize: 12.5, color: '#5b6573' }}>{label}</span>}
    </button>
  )
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('')
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg('')
    try {
      if (mode === 'signup') {
        const r = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })
        const d = await r.json(); if (!r.ok) { setMsg(d.error || 'Could not create account.'); setBusy(false); return }
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
      if (error) setMsg(error.message)
    } catch (err) { setMsg(err.message) } finally { setBusy(false) }
  }
  return (
    <div className="auth-wrap">
      <motion.form onSubmit={submit} className="card auth-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="wordmark" style={{ fontSize: 30 }}>Cadence</div>
        <div className="muted" style={{ marginTop: 8, marginBottom: 28, fontSize: 14 }}>Turn your LinkedIn into a scheduled X presence.</div>
        <input className="field" type="email" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="field" type="password" required placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} style={{ marginTop: 12 }} />
        <motion.button type="submit" disabled={busy} className="btn-primary" style={{ width: '100%', marginTop: 20, padding: 12 }} whileTap={{ scale: 0.98 }}>
          {busy ? <span className="dots"><i/><i/><i/></span> : mode === 'signin' ? 'Sign in' : 'Create account'}
        </motion.button>
        {msg && <div className="notice" style={{ marginTop: 14 }}>{msg}</div>}
        <div className="muted" style={{ marginTop: 20, textAlign: 'center', fontSize: 13 }}>
          {mode === 'signin' ? "New here? " : 'Have an account? '}
          <span className="link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg('') }}>{mode === 'signin' ? 'Create an account' : 'Sign in'}</span>
        </div>
      </motion.form>
    </div>
  )
}

// ── Paywall (gates access) ──────────────────────────────────────────────────────
function Paywall({ me, authed, onSignOut }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  async function subscribe() {
    setBusy(true); setMsg('')
    const r = await authed('/api/stripe/checkout', { method: 'POST' })
    const d = await r.json(); if (d.url) window.location.href = d.url; else { setMsg(d.error || 'Could not start checkout.'); setBusy(false) }
  }
  const perks = [
    [Brain, 'Learns your voice from your LinkedIn'],
    [Sparkles, 'Unlimited AI posts in your style'],
    [Clock, 'Auto-scheduling & auto-posting to X'],
    [LImage, 'AI images on your posts'],
  ]
  return (
    <div className="auth-wrap">
      <motion.div className="card pay-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="row" style={{ gap: 9, marginBottom: 6 }}><span className="wordmark" style={{ fontSize: 24 }}>Cadence</span><span className="pro-pill"><Crown size={12} /> Pro</span></div>
        <div className="muted" style={{ fontSize: 14, marginBottom: 18 }}>Subscribe to start turning your LinkedIn into a scheduled X presence.</div>
        <div className="pay-price">$17<span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>/month</span></div>
        <div className="pay-perks">
          {perks.map(([Ic, t], i) => <div key={i} className="pay-perk"><span className="pay-ic"><Ic size={15} /></span>{t}</div>)}
        </div>
        <motion.button className="btn-primary" style={{ width: '100%', padding: 13, marginTop: 18 }} disabled={busy} onClick={subscribe} whileTap={{ scale: 0.98 }}>
          {busy ? <span className="dots"><i/><i/><i/></span> : 'Subscribe — $17/mo'}
        </motion.button>
        {msg && <div className="notice" style={{ marginTop: 12 }}>{msg}</div>}
        <div className="muted" style={{ marginTop: 16, textAlign: 'center', fontSize: 12.5 }}>Cancel anytime · <span className="link" onClick={onSignOut}>Sign out</span></div>
      </motion.div>
    </div>
  )
}

// ── Onboarding ─────────────────────────────────────────────────────────────────
const OB_KEY = 'cadence_onboarding'
function Onboarding({ session, me, authed, onDone }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(OB_KEY) || '{}') } catch { return {} } })()
  const [step, setStep] = useState(saved.step || 0)
  const [name, setName] = useState(saved.name || me?.profile?.full_name || '')
  const [role, setRole] = useState(saved.role || '')
  const [goals, setGoals] = useState(saved.goals || '')
  const [liUrl, setLiUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [liDone, setLiDone] = useState(saved.liDone || false)
  const [conns, setConns] = useState([])

  const persist = (patch) => { localStorage.setItem(OB_KEY, JSON.stringify({ step, name, role, goals, liDone, ...patch })) }
  useEffect(() => { authed('/api/x/status').then(r => r.json()).then(d => setConns(d.connections || [])) }, [authed])
  useEffect(() => { const p = new URLSearchParams(window.location.search); if (p.get('x') === 'connected') { setStep(s => Math.max(s, 3)); window.history.replaceState({}, '', '/') } }, [])

  const connected = conns.length > 0
  async function connectX() { persist({ step: 2 }); const r = await authed('/api/x/connect', { method: 'POST' }); const d = await r.json(); if (d.url) window.location.href = d.url }
  async function scrapeLi() {
    if (!liUrl.trim()) return setStep(s => s + 1)
    setBusy(true)
    const r = await authed('/api/linkedin', { method: 'POST', body: JSON.stringify({ profileUrl: liUrl.trim(), maxPosts: 50 }) })
    const d = await r.json(); setBusy(false)
    if (!d.error) { setLiDone(true); persist({ liDone: true, step: step + 1 }); setStep(s => s + 1) }
  }
  async function finish() {
    setBusy(true)
    await authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ full_name: name, role, goals, onboarded: true }) })
    localStorage.removeItem(OB_KEY); setBusy(false); onDone()
  }

  const steps = [
    { title: 'Welcome to Cadence', body: (<>
      <p className="ob-lead">Cadence learns how you write on LinkedIn and turns it into a scheduled X presence — drafted, scheduled, and auto-posted in your voice.</p>
      <button className="btn-primary" style={{ marginTop: 20, padding: 12, width: '100%' }} onClick={() => setStep(1)}>Get started</button>
    </>)},
    { title: 'About you', body: (<>
      <label className="ob-label">Your name</label>
      <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Founder" />
      <label className="ob-label">What do you do?</label>
      <input className="field" value={role} onChange={e => setRole(e.target.value)} placeholder="Building an AI water-infrastructure startup" />
      <label className="ob-label">What do you want from X?</label>
      <textarea className="field" rows={2} value={goals} onChange={e => setGoals(e.target.value)} placeholder="Grow an audience of founders & investors" />
      <div className="ob-nav"><span className="link" onClick={() => setStep(0)}>Back</span><button className="btn-primary" disabled={!name.trim()} onClick={() => setStep(2)}>Next</button></div>
    </>)},
    { title: 'Connect your X account', body: (<>
      <p className="ob-lead">Cadence posts on your behalf when a post is due. Connect the X account you want to post to.</p>
      {connected ? <div className="ob-ok"><Check /> Connected @{conns[0].username}</div>
        : <button className="btn-primary row" style={{ gap: 8, marginTop: 16, padding: 12, width: '100%' }} onClick={connectX}><XGlyph /> Connect X</button>}
      <div className="ob-nav"><span className="link" onClick={() => setStep(1)}>Back</span><button className="btn-primary" onClick={() => setStep(3)}>{connected ? 'Next' : 'Skip for now'}</button></div>
    </>)},
    { title: 'Add your LinkedIn', body: (<>
      <p className="ob-lead">Paste your LinkedIn profile URL — Cadence reads up to your 50 recent posts to learn your voice. No login needed.</p>
      <input className="field" style={{ marginTop: 14 }} value={liUrl} onChange={e => setLiUrl(e.target.value)} placeholder="linkedin.com/in/your-handle" />
      {liDone && <div className="ob-ok" style={{ marginTop: 10 }}><Check /> Posts pulled</div>}
      <div className="ob-nav"><span className="link" onClick={() => setStep(2)}>Back</span><button className="btn-primary" disabled={busy} onClick={scrapeLi}>{busy ? <span className="dots"><i/><i/><i/></span> : liUrl.trim() ? 'Pull posts' : 'Skip'}</button></div>
    </>)},
    { title: "You're all set", body: (<>
      <p className="ob-lead">{name ? `Welcome, ${name.split(' ')[0]}. ` : ''}Head to the Brain to learn your voice and generate posts, or jump into your Queue.</p>
      <button className="btn-primary" style={{ marginTop: 20, padding: 12, width: '100%' }} disabled={busy} onClick={finish}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Enter Cadence'}</button>
    </>)},
  ]
  const cur = steps[Math.min(step, steps.length - 1)]
  return (
    <div className="auth-wrap">
      <motion.div className="card ob-card" key={step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="ob-dots">{steps.map((_, i) => <span key={i} className={'ob-dot' + (i <= step ? ' on' : '')} />)}</div>
        <div className="wordmark" style={{ fontSize: 22, marginBottom: 4 }}>{cur.title}</div>
        <div style={{ marginTop: 10 }}>{cur.body}</div>
      </motion.div>
    </div>
  )
}

// ── Settings modal ─────────────────────────────────────────────────────────────
function SettingsModal({ me, session, authed, conns, photos = [], onUploadPhoto, onDeletePhoto, onConnect, onClose, onSaved, onDisconnect, onUpgrade, onPortal }) {
  const p = me?.profile || {}
  const [name, setName] = useState(p.full_name || '')
  const [role, setRole] = useState(p.role || '')
  const [tz, setTz] = useState(p.timezone || 'America/Los_Angeles')
  const [hour, setHour] = useState(p.default_post_hour ?? 9)
  const [imgDefault, setImgDefault] = useState(!!p.include_image_default)
  const [busy, setBusy] = useState(false)
  const isPro = p.is_pro || (me && !me.billingConfigured)
  async function save() {
    setBusy(true)
    await authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ full_name: name, role, timezone: tz, default_post_hour: Number(hour), include_image_default: imgDefault }) })
    setBusy(false); onSaved()
  }
  return (
    <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card modal settings" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }} transition={spring}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Settings</span>
          <button className="x-close" onClick={onClose}><LX size={18} /></button>
        </div>
        <div className="set-section">
          <div className="set-h">Profile</div>
          <label className="ob-label">Name</label><input className="field" value={name} onChange={e => setName(e.target.value)} />
          <label className="ob-label">What you do</label><input className="field" value={role} onChange={e => setRole(e.target.value)} />
        </div>
        <div className="set-section">
          <div className="set-h">Posting</div>
          <div className="set-row"><span>Timezone</span><select className="field set-input" value={tz} onChange={e => setTz(e.target.value)}>{TZS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
          <div className="set-row"><span>Default time</span><select className="field set-input" value={hour} onChange={e => setHour(e.target.value)}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{((h % 12) || 12) + (h < 12 ? ' AM' : ' PM')}</option>)}</select></div>
          <div className="set-row"><span>Attach image by default</span><Toggle on={imgDefault} onChange={setImgDefault} /></div>
        </div>
        <div className="set-section">
          <div className="set-h">Your photos <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: '#9aa1ad' }}>· 5–10 selfies for AI images of you</span></div>
          <div className="photo-grid">
            {photos.map(p => (
              <div className="photo-cell" key={p.id}>
                <img src={p.url} alt="" />
                <button className="photo-del" onClick={() => onDeletePhoto(p.id)} title="Remove"><LX size={12} /></button>
              </div>
            ))}
            {photos.length < 10 && (
              <label className="photo-add">
                <Upload size={16} />
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.target.value = '' }} />
              </label>
            )}
          </div>
          <div className="muted tiny" style={{ marginTop: 8 }}>{photos.length}/10 uploaded. Used as reference when you turn on “Feature me” on a post image.</div>
        </div>
        <div className="set-section">
          <div className="set-h">Account</div>
          <div className="set-row"><span>Email</span><span className="muted">{session.user.email}</span></div>
          <div className="set-row" style={{ alignItems: 'flex-start' }}><span>X accounts</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              {conns.length ? conns.map(c => <span className="row" key={c.id} style={{ gap: 8 }}>@{c.username} <button className="mini danger" onClick={() => onDisconnect(c.id)}>Disconnect</button></span>) : <span className="muted">Not connected</span>}
              <button className="mini" onClick={onConnect}><Plus size={11} /> {conns.length ? 'Add account' : 'Connect'}</button>
            </div>
          </div>
          <div className="set-row"><span>Plan</span>{isPro ? <span className="row" style={{ gap: 8 }}><span className="pro-pill"><Crown size={12} /> Pro</span>{me?.billingConfigured && <button className="mini" onClick={onPortal}>Manage</button>}</span> : <button className="btn-primary btn-sm" onClick={onUpgrade}>Upgrade</button>}</div>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 18 }}>
          <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Save'}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Live countdown to a scheduled time ──────────────────────────────────────────
function useCountdown(whenLocal) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const target = new Date(whenLocal).getTime()
  const diff = target - now
  if (isNaN(target)) return ''
  if (diff <= 0) return 'due now'
  const s = Math.floor(diff / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (d > 0) return `in ${d}d ${h}h`
  if (h > 0) return `in ${h}h ${m}m`
  if (m > 0) return `in ${m}m ${sec}s`
  return `in ${sec}s`
}

// ── Draft proposal (in chat) — editable text editor for every recommended tweet ──
function DraftProposal({ proposal, authed, connected, onResolved, defaultHour, xConns = [], hasPhotos }) {
  const [content, setContent] = useState(proposal.content || '')
  const [img, setImg] = useState(proposal.image_url || '')
  const [imgOn, setImgOn] = useState(!!proposal.image_url)
  const [personal, setPersonal] = useState(false)
  const [when, setWhen] = useState(defaultWhen(defaultHour))
  const [connId, setConnId] = useState(xConns[0]?.id || '')
  const [busy, setBusy] = useState(false); const [regen, setRegen] = useState(false); const [done, setDone] = useState(null)
  const [rating, setRating] = useState(null)
  const countdown = useCountdown(when)

  useEffect(() => { if (!connId && xConns[0]?.id) setConnId(xConns[0].id) }, [xConns, connId])

  async function regenerate() {
    setRegen(true)
    const r = await authed('/api/image', { method: 'POST', body: JSON.stringify({ prompt: proposal.image_prompt || content, fromContent: !proposal.image_prompt, personal, seed: Math.floor(Math.random() * 1e5) }) })
    const d = await r.json(); if (d.url) setImg(d.url); setRegen(false)
  }
  function toggleImg(v) { setImgOn(v); if (v && !img) regenerate() }
  async function rate(r) {
    setRating(r)
    authed('/api/feedback', { method: 'POST', body: JSON.stringify({ content, rating: r }) }).catch(() => {})
  }
  async function approve(postNow) {
    if (!content.trim() || content.length > MAX) return
    setBusy(true)
    const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ content, scheduledFor: new Date(when).toISOString(), imageUrl: imgOn ? img : null, xConnectionId: connId || null }) })
    const d = await r.json(); let result = 'scheduled'
    if (postNow && d.post?.id) { const pr = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ id: d.post.id, action: 'post_now' }) }); const pd = await pr.json(); result = pd.status === 'posted' ? 'posted' : 'failed' }
    setBusy(false); setDone(result); onResolved && onResolved()
  }
  if (done) return <div className={'dp-done ' + done}>{done === 'posted' ? 'Posted to X' : done === 'failed' ? 'Post failed — reconnect X' : done === 'discarded' ? 'Discarded' : `Scheduled · ${fmt(new Date(when).toISOString())}`}</div>
  return (
    <motion.div className="card dp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="dp-head">
        <span>Draft preview</span>
        <div className="row" style={{ gap: 8 }}>
          <button className={'thumb' + (rating === 'up' ? ' on up' : '')} title="More like this" onClick={() => rate('up')}><ThumbsUp size={13} /></button>
          <button className={'thumb' + (rating === 'down' ? ' on down' : '')} title="Less like this" onClick={() => rate('down')}><ThumbsDown size={13} /></button>
          <Toggle on={imgOn} onChange={toggleImg} label="image" />
        </div>
      </div>
      <textarea className="field dp-text" rows={3} maxLength={400} value={content} onChange={e => setContent(e.target.value)} />
      <AnimatePresence>
        {imgOn && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="dp-img-wrap">
              {img ? <img src={img} className="dp-img" alt="post visual" /> : <div className="dp-img dp-placeholder"><span className="dots"><i/><i/><i/></span></div>}
              <button className="dp-regen" onClick={regenerate} disabled={regen} title="Regenerate image"><Refresh /></button>
            </div>
            {hasPhotos && <button type="button" className="dp-personal" onClick={() => setPersonal(p => !p)}><span className={'mini-check' + (personal ? ' on' : '')}>{personal && <LCheck size={10} strokeWidth={4} />}</span>Feature me (use my photos)</button>}
          </motion.div>
        )}
      </AnimatePresence>
      {xConns.length > 1 && (
        <select className="field dp-acct" value={connId} onChange={e => setConnId(e.target.value)}>
          {xConns.map(c => <option key={c.id} value={c.id}>Post as @{c.username}</option>)}
        </select>
      )}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <input type="datetime-local" className="field dt" value={when} onChange={e => setWhen(e.target.value)} />
          <span className="cd-pill"><Clock size={11} /> {countdown}</span>
        </div>
        <span className={'count' + (content.length > MAX ? ' over' : '')}>{content.length}/{MAX}</span>
      </div>
      <div className="dp-actions">
        <button className="icon-btn x" title="Discard" onClick={() => setDone('discarded')}><Ex /></button>
        <button className="icon-btn check" title="Approve & schedule" disabled={busy || content.length > MAX || !content.trim()} onClick={() => approve(false)}><Check /> <span>Schedule</span></button>
        <motion.button className="btn-primary btn-sm" whileTap={{ scale: 0.96 }} disabled={busy || !connected || content.length > MAX} onClick={() => approve(true)} title={!connected ? 'Connect X first' : 'Post now'}>Post now</motion.button>
      </div>
    </motion.div>
  )
}

// ── Queue card (collapsible + inline edit) ──────────────────────────────────────
function QueueCard({ p, i, connected, defaultCollapsed, onSaveEdit, onPostNow, onDelete, onSchedule }) {
  const s = STATUS[p.status] || { c: '#9ca3af', label: p.status }
  const [open, setOpen] = useState(!defaultCollapsed)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.content)
  const [busy, setBusy] = useState(false)
  async function save() { setBusy(true); await onSaveEdit(p.id, draft); setBusy(false); setEditing(false); setOpen(true) }
  return (
    <motion.div className={'card qcard' + (open ? ' open' : '')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, ...spring }} layout>
      <button className="qhead" onClick={() => !editing && setOpen(o => !o)}>
        <span className="status-dot" style={{ background: s.c }} />
        <span className="qtitle">{open ? <span className="muted tiny">{fmt(p.scheduled_for)} · {s.label}</span> : titleOf(p.content)}</span>
        <ChevronDown size={15} className="qchev" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: '#9aa1ad', flex: 'none' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
            <div className="qbody">
              {p.image_url && <img src={p.image_url} className="qcard-img" alt="" />}
              {editing
                ? <textarea className="field" rows={5} value={draft} maxLength={400} onChange={e => setDraft(e.target.value)} autoFocus />
                : <div className="card-body">{p.content}</div>}
              {editing && <div className={'count' + (draft.length > MAX ? ' over' : '')} style={{ marginTop: 6 }}>{draft.length}/{MAX}</div>}
              {p.status !== 'posted' && (
                <div className="qrow">
                  <span className="muted tiny">{fmt(p.scheduled_for)}</span>
                  <div className="row" style={{ gap: 6 }}>
                    {editing ? (<>
                      <button className="mini" onClick={() => { setDraft(p.content); setEditing(false) }}>Cancel</button>
                      <button className="mini accent" disabled={busy || !draft.trim() || draft.length > MAX} onClick={save}>{busy ? '…' : 'Save'}</button>
                    </>) : (<>
                      <button className="mini" onClick={() => setEditing(true)}><Pencil size={12} /> Edit</button>
                      <button className="mini" onClick={() => onSchedule(p)}><Clock size={12} /> Time</button>
                      <button className="mini" onClick={() => onPostNow(p.id)} disabled={!connected}>Post now</button>
                      <button className="mini danger" onClick={() => onDelete(p.id)}><Trash2 size={12} /></button>
                    </>)}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Empty({ icon, children }) { return <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><div className="empty-icon">{icon}</div><div>{children}</div></motion.div> }

// ── Posted history (no longer in the active queue) ──────────────────────────────
function PostedSection({ posted }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="posted-wrap">
      <button className="posted-toggle" onClick={() => setOpen(o => !o)}>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        Posted <span className="muted tiny">· {posted.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
            {posted.map(p => (
              <div className="card posted-card" key={p.id}>
                {p.image_url && <img src={p.image_url} className="posted-thumb" alt="" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="card-body" style={{ fontSize: 12.5 }}>{p.content}</div>
                  <div className="muted tiny" style={{ marginTop: 5 }}>Posted {fmt(p.posted_at || p.scheduled_for)}{p.external_id ? <> · <a className="link" href={`https://x.com/i/web/status/${p.external_id}`} target="_blank" rel="noreferrer">view</a></> : ''}</div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Marketing campaigns ─────────────────────────────────────────────────────────
function CampaignManager({ campaigns, xConns, onSave, onToggle, onDelete }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState(''); const [topic, setTopic] = useState(''); const [link, setLink] = useState('')
  const [connIds, setConnIds] = useState([]); const [every, setEvery] = useState(24); const [perRun, setPerRun] = useState(1)
  const [img, setImg] = useState(false); const [busy, setBusy] = useState(false)

  function reset() { setName(''); setTopic(''); setLink(''); setConnIds([]); setEvery(24); setPerRun(1); setImg(false) }
  function toggleConn(id) { setConnIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]) }
  async function submit(active) {
    if (!name.trim() || !topic.trim()) return
    setBusy(true)
    const ok = await onSave({ name: name.trim(), topic: topic.trim(), link: link.trim() || null, connection_ids: connIds, interval_hours: Number(every), posts_per_run: Number(perRun), include_image: img, active })
    setBusy(false); if (ok) { reset(); setAdding(false) }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      {campaigns.map(c => {
        const accts = (c.connection_ids?.length ? c.connection_ids : xConns.map(x => x.id))
        const names = accts.map(id => xConns.find(x => x.id === id)?.username).filter(Boolean)
        return (
          <div className="card camp-card" key={c.id}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div className="conn-title row" style={{ gap: 7 }}>{c.name}<span className={'camp-state' + (c.active ? ' on' : '')}>{c.active ? 'Running' : 'Paused'}</span></div>
                <div className="muted tiny" style={{ marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.topic}</div>
              </div>
              <div className="row" style={{ gap: 6, flex: 'none' }}>
                <button className="mini" onClick={() => onToggle(c)} title={c.active ? 'Pause' : 'Start'}>{c.active ? <LPause size={12} /> : <Play size={12} />}</button>
                <button className="mini danger" onClick={() => onDelete(c.id)}><Trash2 size={12} /></button>
              </div>
            </div>
            <div className="muted tiny" style={{ marginTop: 7 }}>{c.posts_per_run} post{c.posts_per_run > 1 ? 's' : ''} every {c.interval_hours}h · {names.length ? '@' + names.join(', @') : 'all accounts'}{c.include_image ? ' · with image' : ''}</div>
          </div>
        )
      })}

      {adding ? (
        <div className="card camp-form">
          <input className="field" placeholder="Campaign name (e.g. Launch week)" value={name} onChange={e => setName(e.target.value)} />
          <textarea className="field" rows={3} style={{ marginTop: 8 }} placeholder="What do you want to promote? Describe the product/idea, the key points, and the vibe." value={topic} onChange={e => setTopic(e.target.value)} />
          <input className="field" style={{ marginTop: 8 }} placeholder="Link (optional)" value={link} onChange={e => setLink(e.target.value)} />
          <div className="camp-accts">
            <div className="muted tiny" style={{ marginBottom: 6 }}>Post from{xConns.length ? '' : ' — connect an X account first'}:</div>
            {xConns.map(c => (
              <button type="button" key={c.id} className={'chip' + (connIds.includes(c.id) ? ' on' : '')} onClick={() => toggleConn(c.id)}>@{c.username}</button>
            ))}
            {xConns.length > 0 && <span className="muted tiny" style={{ marginLeft: 4 }}>{connIds.length ? '' : '(none = all)'}</span>}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <label className="camp-num">Every <input type="number" min={1} className="field" value={every} onChange={e => setEvery(e.target.value)} /> h</label>
            <label className="camp-num"><input type="number" min={1} max={5} className="field" value={perRun} onChange={e => setPerRun(e.target.value)} /> per run</label>
            <Toggle on={img} onChange={setImg} label="image" />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="mini" onClick={() => { reset(); setAdding(false) }}>Cancel</button>
            <button className="btn-ghost btn-sm" disabled={busy || !name.trim() || !topic.trim()} onClick={() => submit(false)}>Save</button>
            <button className="btn-primary btn-sm" disabled={busy || !name.trim() || !topic.trim()} onClick={() => submit(true)}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Launch'}</button>
          </div>
        </div>
      ) : (
        <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', marginBottom: 10 }} onClick={() => setAdding(true)}><Plus size={14} /> New campaign</button>
      )}
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────
function App({ session }) {
  const token = session.access_token
  const authed = useCallback((path, opts = {}) => fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } }), [token])

  const [tab, setTab] = useState('queue')
  const [posts, setPosts] = useState([]); const [xConns, setXConns] = useState([])
  const [liSelf, setLiSelf] = useState([]); const [liMentors, setLiMentors] = useState([]); const [liPosts, setLiPosts] = useState([])
  const [campaigns, setCampaigns] = useState([]); const [photos, setPhotos] = useState([])
  const [me, setMe] = useState(null)
  const [messages, setMessages] = useState([]); const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false); const [banner, setBanner] = useState('')
  const [compose, setCompose] = useState(null); const [composeBusy, setComposeBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false); const [generating, setGenerating] = useState(false)
  const [upgrade, setUpgrade] = useState(false); const [settings, setSettings] = useState(false)
  const [xConnect, setXConnect] = useState(false)
  const inputRef = useRef(null); const bottomRef = useRef(null)

  const loadQueue = useCallback(async () => { const { data } = await supabase.from('posts').select('*').order('scheduled_for', { ascending: true }); if (data) setPosts(data) }, [])
  const loadX = useCallback(async () => { const r = await authed('/api/x/status'); const d = await r.json(); setXConns(d.connections || []) }, [authed])
  const loadLinkedIn = useCallback(async () => { const r = await authed('/api/linkedin'); const d = await r.json(); setLiSelf(d.self || []); setLiMentors(d.mentors || []); setLiPosts(d.posts || []) }, [authed])
  const loadMe = useCallback(async () => { const r = await authed('/api/me'); const d = await r.json(); setMe(d) }, [authed])
  const loadCampaigns = useCallback(async () => { const r = await authed('/api/campaigns'); const d = await r.json(); setCampaigns(d.campaigns || []) }, [authed])
  const loadPhotos = useCallback(async () => { const r = await authed('/api/photos'); const d = await r.json(); setPhotos(d.photos || []) }, [authed])

  useEffect(() => { loadQueue(); loadX(); loadLinkedIn(); loadMe(); loadCampaigns(); loadPhotos() }, [loadQueue, loadX, loadLinkedIn, loadMe, loadCampaigns, loadPhotos])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('x') === 'connected') { setBanner(`Connected @${q.get('handle') || 'your X account'}`); loadX() }
    else if (q.get('x') === 'denied') setBanner('X connection cancelled.')
    else if (q.get('x')) setBanner('X connection failed — try again.')
    if (q.get('billing') === 'success') { setBanner('Welcome to Pro'); loadMe() }
    if (q.get('x') || q.get('billing')) window.history.replaceState({}, '', '/')
  }, [loadX, loadMe])
  useEffect(() => { if (!banner) return; const t = setTimeout(() => setBanner(''), 4500); return () => clearTimeout(t) }, [banner])

  const connected = xConns.length > 0
  const isPro = me?.profile?.is_pro || (me && !me.billingConfigured)
  const defaultHour = me?.profile?.default_post_hour ?? 9
  const imgDefault = !!me?.profile?.include_image_default
  const drafts = posts.filter(p => p.status === 'draft')
  const queue = posts.filter(p => p.status !== 'draft' && p.status !== 'posted')
  const posted = posts.filter(p => p.status === 'posted').sort((a, b) => new Date(b.posted_at || b.scheduled_for) - new Date(a.posted_at || a.scheduled_for))
  const collapseQueue = queue.length > 4
  const hasPhotos = photos.length > 0

  // Opens a short guide first — X authorizes whichever account is active on x.com,
  // and OAuth 2.0 has no force-login, so we let the user switch accounts before authorizing.
  function connectX() { setXConnect(true) }
  async function startXConnect() { setXConnect(false); const r = await authed('/api/x/connect', { method: 'POST' }); const d = await r.json(); if (d.url) window.location.href = d.url; else setBanner(d.error || 'Could not start X connection.') }
  async function disconnectX(id) { const target = id || xConns[0]?.id; if (!target) return; await authed('/api/x/status', { method: 'DELETE', body: JSON.stringify({ id: target }) }); setBanner('Disconnected X account'); loadX() }
  async function openPortal() { const r = await authed('/api/stripe/portal', { method: 'POST' }); const d = await r.json(); if (d.url) window.location.href = d.url; else setBanner(d.error || 'Billing portal unavailable.') }

  // Campaigns
  async function saveCampaign(payload) {
    const r = await authed('/api/campaigns', { method: 'POST', body: JSON.stringify(payload) })
    const d = await r.json(); if (d.error) setBanner(d.error); else { setBanner(payload.active ? 'Campaign launched' : 'Campaign saved'); loadCampaigns(); if (payload.active) setTimeout(loadQueue, 1500) }
    return !d.error
  }
  async function toggleCampaign(c) { await authed('/api/campaigns', { method: 'PATCH', body: JSON.stringify({ id: c.id, active: !c.active }) }); setBanner(!c.active ? 'Campaign running' : 'Campaign paused'); loadCampaigns(); if (!c.active) setTimeout(loadQueue, 1500) }
  async function deleteCampaign(id) { await authed('/api/campaigns', { method: 'DELETE', body: JSON.stringify({ id }) }); loadCampaigns() }

  // Personal photos (multipart — don't send the JSON content-type header)
  async function uploadPhoto(file) {
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch('/api/photos', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
    const d = await r.json(); if (d.error) setBanner(d.error); else loadPhotos()
  }
  async function deletePhoto(id) { await authed('/api/photos', { method: 'DELETE', body: JSON.stringify({ id }) }); loadPhotos() }

  async function addLinkedIn(profileUrl, isMentor) {
    const r = await authed('/api/linkedin', { method: 'POST', body: JSON.stringify({ profileUrl, maxPosts: 50, isMentor }) })
    const d = await r.json()
    if (d.error) setBanner(`LinkedIn: ${d.error}`); else { setBanner(`Pulled ${d.scrape?.stored ?? 0} posts`); loadLinkedIn() }
    return !d.error
  }
  async function removeLinkedIn(id) { await authed('/api/linkedin', { method: 'DELETE', body: JSON.stringify({ id }) }); loadLinkedIn() }

  async function analyzeVoice() {
    setAnalyzing(true); setBanner('')
    const r = await authed('/api/persona', { method: 'POST' }); const d = await r.json(); setAnalyzing(false)
    if (r.status === 402) return setUpgrade(true)
    if (d.error) setBanner(d.error); else { setBanner('Voice profile updated'); loadMe() }
  }
  async function generate(n = 5) {
    setGenerating(true); setBanner('')
    const r = await authed('/api/generate', { method: 'POST', body: JSON.stringify({ n }) }); const d = await r.json(); setGenerating(false)
    if (r.status === 402) return setUpgrade(true)
    if (d.error) setBanner(d.error); else { setBanner(`Generated ${d.drafts?.length || 0} drafts`); loadQueue() }
  }
  function openNew() { setCompose({ mode: 'new', content: '', when: defaultWhen(defaultHour), imgOn: imgDefault, img: '', connId: xConns[0]?.id || '', personal: false }) }
  function openSchedule(p) { setCompose({ mode: p.status === 'draft' ? 'draft' : 'edit', id: p.id, content: p.content, when: toLocalInput(new Date(p.scheduled_for)), imgOn: !!p.image_url, img: p.image_url || '', connId: p.x_connection_id || xConns[0]?.id || '', personal: false }) }
  async function saveEdit(id, content) { await authed('/api/posts', { method: 'PATCH', body: JSON.stringify({ id, content }) }); loadQueue() }
  async function composeGenImg() {
    setCompose(c => ({ ...c, imgBusy: true }))
    const r = await authed('/api/image', { method: 'POST', body: JSON.stringify({ prompt: compose.content || 'social post', fromContent: true, personal: !!compose.personal, seed: Math.floor(Math.random() * 1e5) }) })
    const d = await r.json(); setCompose(c => c ? { ...c, img: d.url || '', imgBusy: false } : c)
  }
  async function saveCompose(postNow) {
    const c = (compose.content || '').trim(); if (!c || c.length > MAX) return
    setComposeBusy(true)
    try {
      let id = compose.id; const iso = new Date(compose.when).toISOString(); const imageUrl = compose.imgOn ? compose.img : null
      if ((compose.mode === 'edit' || compose.mode === 'draft') && id) {
        await authed('/api/posts', { method: 'PATCH', body: JSON.stringify({ id, content: c, scheduledFor: iso, status: 'queued', imageUrl, xConnectionId: compose.connId || null }) })
      } else { const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ content: c, scheduledFor: iso, imageUrl, xConnectionId: compose.connId || null }) }); const d = await r.json(); id = d.post?.id }
      if (postNow && id) { const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ id, action: 'post_now' }) }); const d = await r.json(); setBanner(d.status === 'posted' ? `Posted as @${d.as}` : `Post failed: ${d.error || 'error'}`) }
      else setBanner('Added to queue')
      setCompose(null); loadQueue()
    } finally { setComposeBusy(false) }
  }
  async function delPost(id) { await authed('/api/posts', { method: 'DELETE', body: JSON.stringify({ id }) }); loadQueue() }
  async function postNow(id) {
    setBanner('Posting…')
    const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ id, action: 'post_now' }) }); const d = await r.json()
    setBanner(d.status === 'posted' ? `Posted as @${d.as}` : `Failed: ${d.error || 'error'}`); loadQueue(); if (d.reconnect) loadX()
  }
  async function startUpgrade() { const r = await authed('/api/stripe/checkout', { method: 'POST' }); const d = await r.json(); if (d.url) window.location.href = d.url; else setBanner(d.error || 'Billing not available yet.') }
  function usePreset(text) { setInput(text); inputRef.current?.focus() }
  async function send(text) {
    const t = (text ?? input).trim(); if (!t || loading) return
    setInput(''); const next = [...messages, { role: 'user', content: t }]; setMessages(next); setLoading(true)
    try { const res = await authed('/api/chat', { method: 'POST', body: JSON.stringify({ messages: next }) }); const data = await res.json(); setMessages(p => [...p, { role: 'assistant', content: data.reply, proposal: data.proposal || null }]); loadQueue() }
    catch (e) { setMessages(p => [...p, { role: 'assistant', content: '⚠️ ' + e.message }]) } finally { setLoading(false) }
  }

  const persona = me?.persona; const stats = me?.stats || {}
  const initials = (me?.profile?.full_name || session.user.email || '?').trim()[0]?.toUpperCase()
  const PRESETS = ['Draft a post with an image', 'Generate 5 posts in my voice', 'Repurpose my best LinkedIn post', 'Make this punchier', 'Schedule my drafts daily at 9am']

  return (
    <div className="app">
      <header className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <span className="wordmark" style={{ fontSize: 20 }}>Cadence</span>
          <span className="muted tiny">{stats.queued || 0} queued · {stats.posted || 0} posted</span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          {!isPro && <motion.button className="btn-primary btn-sm" onClick={() => setUpgrade(true)} whileTap={{ scale: 0.96 }}>Upgrade</motion.button>}
          <button className="avatar" onClick={() => setSettings(true)} title="Settings">{initials}</button>
        </div>
      </header>

      <AnimatePresence>{banner && <motion.div className="banner" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={spring}>{banner}</motion.div>}</AnimatePresence>

      <div className="cols">
        <section className="pane left">
          <div className="left-head">
            <div className="seg">
              {['queue', 'brain', 'connections'].map(t => (
                <button key={t} onClick={() => setTab(t)} className={'seg-btn' + (tab === t ? ' on' : '')}>
                  {tab === t && <motion.span layoutId="seg-pill" className="seg-pill" transition={spring} />}
                  <span style={{ position: 'relative', zIndex: 1 }}>{t === 'queue' ? 'Queue' : t === 'brain' ? 'Brain' : 'Connections'}{t === 'brain' && drafts.length > 0 && <span className="dot-badge">{drafts.length}</span>}</span>
                </button>
              ))}
            </div>
            {tab === 'queue' && <motion.button className="btn-primary btn-sm row" style={{ gap: 5 }} onClick={openNew} whileTap={{ scale: 0.96 }}><Plus size={14} /> New post</motion.button>}
          </div>

          <div className="scroll-wrap">
            <motion.div key={tab} className="scroll" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>

              {tab === 'queue' && (<>
                {!connected && <div className="hint">Connect X in <b>Connections</b> so queued posts can publish.</div>}
                {queue.length === 0 && <Empty icon={<Clock size={26} />}>Your queue is empty. Write a post, or generate from your Brain.</Empty>}
                <div>{queue.map((p, i) => <QueueCard key={p.id} p={p} i={i} connected={connected} defaultCollapsed={collapseQueue} onSaveEdit={saveEdit} onPostNow={postNow} onDelete={delPost} onSchedule={openSchedule} />)}</div>
                {posted.length > 0 && <PostedSection posted={posted} />}
              </>)}

              {tab === 'brain' && (
                !persona ? (
                  <div className="brain-empty">
                    <div className="brain-stage muted-stage"><motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity }} style={{ color: '#0a66c2' }}><Brain size={48} /></motion.div></div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, marginTop: 14 }}>Learn your voice</div>
                    <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.65, maxWidth: 360, margin: '0 auto 18px' }}>Cadence reads your LinkedIn posts and maps your voice into an interactive mind — then writes X posts that sound like you.</div>
                    <motion.button className="btn-primary row" style={{ gap: 7 }} disabled={analyzing} onClick={analyzeVoice} whileTap={{ scale: 0.97 }}>{analyzing ? <span className="dots"><i/><i/><i/></span> : <><Wand2 size={15} /> Analyze my voice</>}</motion.button>
                    {liPosts.length === 0 && <div className="muted tiny" style={{ marginTop: 12 }}>Add your LinkedIn in Connections first.</div>}
                  </div>
                ) : (<>
                  <div className="brain-stage"><BrainViz /></div>
                  <div className="card persona">
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>Your voice <span className="muted tiny">· {persona.tone}</span></span>
                      <button className="mini" disabled={analyzing} onClick={analyzeVoice}>{analyzing ? '…' : 'Refresh'}</button>
                    </div>
                    <div className="persona-summary">{persona.summary}</div>
                  </div>
                  <div className="card gen-panel">
                    <div className="gen-head">
                      <span className="gen-ic"><Sparkles size={17} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="gen-title">Generate posts in your voice</div>
                        <div className="gen-sub">Studies your best-performing LinkedIn posts and what&apos;s landing on X right now, then writes 5 fresh tweets — each on a different topic in your niche.</div>
                      </div>
                    </div>
                    <motion.button className="btn-primary gen-btn" disabled={generating} onClick={() => generate(5)} whileTap={{ scale: 0.98 }}>
                      {generating ? <span className="row" style={{ gap: 8 }}><span className="dots"><i/><i/><i/></span> Writing your posts…</span> : <span className="row" style={{ gap: 8 }}><Wand2 size={15} /> Generate 5 posts</span>}
                    </motion.button>
                  </div>
                  {drafts.length === 0 && <Empty icon={<FileText size={26} />}>No drafts yet. Generate a batch — they land here to review.</Empty>}
                  <div><AnimatePresence>{drafts.map((p, i) => (
                    <motion.div key={p.id} className="card draft-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, ...spring }} layout exit={{ opacity: 0, scale: 0.95 }}>
                      <div className="card-body">{p.content}</div>
                      <div className="dp-actions" style={{ marginTop: 11 }}>
                        <button className="icon-btn x" title="Discard" onClick={() => delPost(p.id)}><Ex /></button>
                        <button className="icon-btn check" title="Schedule" onClick={() => openSchedule(p)}><Check /> <span>Schedule</span></button>
                        <button className="btn-primary btn-sm" disabled={!connected} onClick={() => postNow(p.id)}>Post now</button>
                      </div>
                    </motion.div>
                  ))}</AnimatePresence></div>
                </>)
              )}

              {tab === 'connections' && (<>
                <div className="conn-sec" style={{ marginTop: 2 }}>X accounts <span className="muted tiny" style={{ fontWeight: 400 }}>· post from any of these</span></div>
                {xConns.map(c => (
                  <div className="conn-card card" key={c.id}>
                    <div className="conn-icon x-icon"><XGlyph /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="conn-title">@{c.username}</div>
                      <div className="muted tiny">{c.name || 'Connected'}</div>
                    </div>
                    <button className="mini danger" onClick={() => disconnectX(c.id)}>Disconnect</button>
                  </div>
                ))}
                <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', marginBottom: 10 }} onClick={connectX}><Plus size={14} /> {connected ? 'Connect another X account' : 'Connect X'}</button>

                <div className="conn-sec row" style={{ gap: 7 }}><Megaphone size={13} /> Marketing campaigns <span className="muted tiny" style={{ fontWeight: 400 }}>· auto-post about something you want to promote</span></div>
                <CampaignManager campaigns={campaigns} xConns={xConns} onSave={saveCampaign} onToggle={toggleCampaign} onDelete={deleteCampaign} />

                <div className="conn-sec">Your LinkedIn</div>
                <LinkedInSlot account={liSelf[0]} onAdd={(url) => addLinkedIn(url, false)} onRemove={removeLinkedIn} self />

                <div className="conn-sec">Creators to study <span className="muted tiny" style={{ fontWeight: 400 }}>· up to 3 styles to mimic</span></div>
                {[0, 1, 2].map(i => (
                  <LinkedInSlot key={i} account={liMentors[i]} onAdd={(url) => addLinkedIn(url, true)} onRemove={removeLinkedIn} />
                ))}
              </>)}

            </motion.div>
          </div>
        </section>

        {/* chat */}
        <section className="pane right">
          <div className="scroll chat-scroll">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <div className="wordmark" style={{ fontSize: 19, marginBottom: 4 }}>How can I help?</div>
                <div className="muted" style={{ fontSize: 13 }}>Draft, schedule, repurpose, and post to X — just ask.</div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div key={i} className={'msg ' + m.role} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
                  <div className="msg-col" style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div className={'bubble ' + m.role}>{m.content}</div>
                    {m.proposal && <DraftProposal proposal={m.proposal} authed={authed} connected={connected} onResolved={loadQueue} defaultHour={defaultHour} xConns={xConns} hasPhotos={hasPhotos} />}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {loading && <div className="msg assistant"><div className="bubble assistant"><span className="dots"><i/><i/><i/></span></div></div>}
            <div ref={bottomRef} />
          </div>
          <div className="composer-wrap">
            <div className="presets">
              {PRESETS.map(p => <button key={p} className="preset" onClick={() => usePreset(p)}>{p}</button>)}
            </div>
            <div className="composer">
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Message Cadence…" rows={1} className="field chat-input" />
              <motion.button onClick={() => send()} disabled={loading || !input.trim()} className="btn-primary send" whileTap={{ scale: 0.92 }}><Send size={17} /></motion.button>
            </div>
          </div>
        </section>
      </div>

      {/* compose modal */}
      <AnimatePresence>
        {compose && (
          <motion.div className="overlay" onClick={() => !composeBusy && setCompose(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="card modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }} transition={spring}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontWeight: 700, fontSize: 15.5 }}>{compose.mode === 'edit' ? 'Edit post' : compose.mode === 'draft' ? 'Schedule draft' : compose.mode === 'repurpose' ? 'Repurpose to X' : 'New post'}</span>
                <button className="x-close" onClick={() => !composeBusy && setCompose(null)}><LX size={18} /></button>
              </div>
              <div style={{ position: 'relative' }}>
                <textarea className="field" rows={5} autoFocus placeholder={compose.loading ? 'Drafting…' : 'What do you want to post?'} value={compose.content || ''} disabled={compose.loading} onChange={e => setCompose(c => ({ ...c, content: e.target.value }))} />
                {compose.loading && <div className="draft-spin"><span className="dots"><i/><i/><i/></span></div>}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <Toggle on={compose.imgOn} onChange={v => { setCompose(c => ({ ...c, imgOn: v })); if (v && !compose.img) composeGenImg() }} label="Include image" />
                <span className={'count' + ((compose.content || '').length > MAX ? ' over' : '')}>{(compose.content || '').length}/{MAX}</span>
              </div>
              <AnimatePresence>
                {compose.imgOn && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    <div className="dp-img-wrap" style={{ marginTop: 10 }}>
                      {compose.img && !compose.imgBusy ? <img src={compose.img} className="dp-img" alt="" /> : <div className="dp-img dp-placeholder"><span className="dots"><i/><i/><i/></span></div>}
                      <button className="dp-regen" onClick={composeGenImg} disabled={compose.imgBusy} title="Regenerate"><Refresh /></button>
                    </div>
                    {hasPhotos && <button type="button" className="dp-personal" onClick={() => setCompose(c => ({ ...c, personal: !c.personal }))}><span className={'mini-check' + (compose.personal ? ' on' : '')}>{compose.personal && <LCheck size={10} strokeWidth={4} />}</span>Feature me (use my photos)</button>}
                  </motion.div>
                )}
              </AnimatePresence>
              {xConns.length > 1 && (
                <select className="field dp-acct" style={{ marginTop: 10 }} value={compose.connId || ''} onChange={e => setCompose(c => ({ ...c, connId: e.target.value }))}>
                  {xConns.map(c => <option key={c.id} value={c.id}>Post as @{c.username}</option>)}
                </select>
              )}
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
                <input type="datetime-local" className="field dt" value={compose.when} onChange={e => setCompose(c => ({ ...c, when: e.target.value }))} />
                <div className="row" style={{ gap: 10 }}>
                  <button className="btn-ghost" disabled={composeBusy} onClick={() => saveCompose(false)}>Schedule</button>
                  <motion.button className="btn-primary" whileTap={{ scale: 0.97 }} disabled={composeBusy || !connected || (compose.content || '').length > MAX || !(compose.content || '').trim()} onClick={() => saveCompose(true)} title={!connected ? 'Connect X first' : ''}>{composeBusy ? <span className="dots"><i/><i/><i/></span> : 'Post now'}</motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* upgrade modal */}
      <AnimatePresence>
        {upgrade && (
          <motion.div className="overlay" onClick={() => setUpgrade(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="card modal upgrade" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }} transition={spring}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="wordmark" style={{ fontSize: 21 }}>Cadence Pro</span><button className="x-close" onClick={() => setUpgrade(false)}><LX size={18} /></button></div>
              <div className="price">${me?.proPrice || 17}<span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>/mo</span></div>
              <ul className="perks">
                <li><Brain size={15} /> Voice engine — learn your style & auto-write posts</li>
                <li><Sparkles size={15} /> Unlimited AI generations in your voice</li>
                <li><LImage size={15} /> AI images on your posts</li>
                <li><Clock size={15} /> Unlimited scheduling & auto-posting</li>
              </ul>
              {me && !me.billingConfigured
                ? <div className="notice" style={{ marginTop: 4 }}>Billing isn&apos;t configured on this instance yet — all Pro features are currently unlocked.</div>
                : <motion.button className="btn-primary" style={{ width: '100%', marginTop: 8, padding: 13 }} onClick={startUpgrade} whileTap={{ scale: 0.98 }}>Upgrade to Pro</motion.button>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settings && <SettingsModal me={me} session={session} authed={authed} conns={xConns} photos={photos} onUploadPhoto={uploadPhoto} onDeletePhoto={deletePhoto} onConnect={connectX} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); loadMe() }} onDisconnect={disconnectX} onUpgrade={() => { setSettings(false); setUpgrade(true) }} onPortal={openPortal} />}
      </AnimatePresence>

      <AnimatePresence>
        {xConnect && <XConnectModal hasAccounts={connected} onClose={() => setXConnect(false)} onContinue={startXConnect} />}
      </AnimatePresence>
    </div>
  )
}

// ── X connect guide — X authorizes whichever account is active on x.com, and
// OAuth 2.0 has no force-login, so to add a DIFFERENT account the user switches
// on X first. This walks them through it. ─────────────────────────────────────
function XConnectModal({ hasAccounts, onClose, onContinue }) {
  const [switched, setSwitched] = useState(false)
  return (
    <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card modal xc" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }} transition={spring}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="row" style={{ gap: 9, fontWeight: 700, fontSize: 15.5 }}><span className="xc-glyph"><XGlyph /></span>{hasAccounts ? 'Add another X account' : 'Connect your X account'}</span>
          <button className="x-close" onClick={onClose}><LX size={18} /></button>
        </div>
        <p className="xc-lead">X connects whichever account you&apos;re <b>currently signed into on x.com</b>. {hasAccounts ? 'To add a different one, switch accounts on X first — otherwise it&apos;ll just re-authorize the same account.' : 'Make sure the account showing on x.com is the one you want to post from.'}</p>

        {hasAccounts && (
          <div className="xc-steps">
            <div className="xc-step"><span className="xc-num">1</span><div>Open X and <b>switch to (or log into) the account</b> you want to add — use “Add an existing account” or log out and back in.</div></div>
            <div className="xc-step"><span className="xc-num">2</span><div>Come back here and continue — you&apos;ll just tap <b>Authorize</b> for that account.</div></div>
          </div>
        )}

        <div className="xc-actions">
          {hasAccounts && (
            <a className="btn-ghost row xc-open" href="https://x.com/logout" target="_blank" rel="noreferrer" onClick={() => setSwitched(true)}>
              <Refresh /> Log out / switch on X
            </a>
          )}
          <button className="btn-primary xc-go" onClick={onContinue}>{hasAccounts ? (switched ? 'I switched — Continue' : 'Continue to X') : 'Continue to X'}</button>
        </div>
        <div className="muted tiny" style={{ marginTop: 12, textAlign: 'center' }}>Tip: a private/incognito window is the most reliable way to authorize a different account.</div>
      </motion.div>
    </motion.div>
  )
}

// ── LinkedIn slot (self or mentor) ──────────────────────────────────────────────
function LinkedInSlot({ account, onAdd, onRemove, self }) {
  const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false)
  async function add() { if (!url.trim()) return; setBusy(true); const ok = await onAdd(url.trim()); setBusy(false); if (ok) setUrl('') }
  if (account) {
    const handle = account.public_identifier || account.profile_url.split('/in/')[1]?.replace(/\/$/, '')
    return (
      <div className="conn-card card">
        <div className="conn-icon li-icon"><LIcon /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="conn-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name || handle}</div>
          <div className="muted tiny">{account.last_scraped_at ? 'Posts pulled' : 'Pulling…'}{self ? ' · your voice' : ''}</div>
        </div>
        <button className="mini danger" onClick={() => onRemove(account.id)}><Trash2 size={13} /></button>
      </div>
    )
  }
  return (
    <div className="slot-empty">
      <div className="conn-icon li-icon ghost"><LIcon /></div>
      <input className="field" placeholder={self ? 'Your linkedin.com/in/username' : 'linkedin.com/in/creator'} value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} style={{ flex: 1, minWidth: 0 }} />
      <button className="btn-primary btn-sm" disabled={busy || !url.trim()} onClick={add}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Add'}</button>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(undefined)

  const loadMe = useCallback(async (s) => {
    if (!s) { setMe(null); return }
    const r = await fetch('/api/me', { headers: { Authorization: `Bearer ${s.access_token}` } })
    setMe(await r.json())
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); loadMe(data.session) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); loadMe(s) })
    return () => sub.subscription.unsubscribe()
  }, [loadMe])

  const authed = useCallback((path, opts = {}) => fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...(opts.headers || {}) } }), [session])
  const gated = me && me.billingConfigured && !me.profile?.is_pro

  let view = null
  if (session === undefined || (session && me === undefined)) view = null
  else if (!session) view = <AuthScreen />
  else if (gated) view = <Paywall me={me} authed={authed} onSignOut={() => supabase.auth.signOut()} />
  else if (me && !me.profile?.onboarded) view = <Onboarding session={session} me={me} authed={authed} onDone={() => loadMe(session)} />
  else view = <App session={session} />

  return (<><style>{CSS}</style><div className="bg-mesh" />{view}</>)
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600;700&family=Sora:wght@600;700;800&display=swap');
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #fbfbfd; color: #16181d; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-thumb { background: rgba(20,24,30,0.12); border-radius: 5px; } ::-webkit-scrollbar-thumb:hover { background: rgba(20,24,30,0.2); }
.bg-mesh { position: fixed; inset: 0; z-index: 0; pointer-events: none; background: radial-gradient(110% 70% at 50% -10%, #f2f5fb 0%, #fbfbfd 60%); }
.card { background: #fff; border: 1px solid #ececf1; border-radius: 14px; box-shadow: 0 1px 2px rgba(20,24,30,0.03); }
.wordmark { font-family: 'Sora', sans-serif; font-weight: 800; letter-spacing: -0.03em; color: #14161b; }
.muted { color: #757b88; } .tiny { font-size: 11.5px; } .hl { color: #4f63d8; font-weight: 500; }
.link { color: #4f63d8; cursor: pointer; font-weight: 600; } .link:hover { color: #3b4fc0; }
.row { display: flex; align-items: center; }
.field { width: 100%; background: #fff; border: 1px solid #e2e3e9; border-radius: 11px; color: #16181d; font-size: 14px; padding: 10px 13px; font-family: inherit; transition: border-color .15s, box-shadow .15s; outline: none; }
.field::placeholder { color: #a2a8b3; }
.field:focus { border-color: #8aa0ff; box-shadow: 0 0 0 3px rgba(99,130,255,0.12); }
.field:disabled { opacity: .6; }
.btn-primary { background: #4f63d8; border: none; border-radius: 11px; color: #fff; font-weight: 600; font-size: 13.5px; padding: 9px 15px; cursor: pointer; font-family: inherit; transition: background .15s, transform .05s; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; }
.btn-primary:hover:not(:disabled) { background: #4356c8; } .btn-primary:disabled { opacity: .42; cursor: default; }
.btn-sm { padding: 6px 12px; font-size: 12.5px; }
.btn-ghost { background: #fff; border: 1px solid #e2e3e9; border-radius: 10px; color: #5b6573; font-size: 13px; padding: 8px 14px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; }
.btn-ghost:hover:not(:disabled) { color: #16181d; border-color: #cfd2da; }
.avatar { width: 33px; height: 33px; border-radius: 50%; border: none; background: #4f63d8; color: #fff; font-weight: 700; font-size: 13.5px; cursor: pointer; font-family: inherit; }
.pro-pill { display: inline-flex; align-items: center; gap: 5px; color: #6d3bd0; background: #f3eefe; border: 1px solid #e2d4fb; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
.notice { font-size: 12.5px; color: #9a6b00; background: #fff8ec; border: 1px solid #f3e2bf; padding: 9px 12px; border-radius: 10px; }
.switch { width: 36px; height: 21px; border-radius: 20px; background: #d6d9e0; position: relative; transition: background .2s; flex: none; } .switch.on { background: #4f63d8; }
.knob { position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform .2s; } .switch.on .knob { transform: translateX(15px); }

.auth-wrap { position: relative; z-index: 1; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.auth-card { width: 372px; max-width: 100%; padding: 34px 32px; border-radius: 20px; box-shadow: 0 1px 2px rgba(20,24,30,0.04), 0 24px 60px -34px rgba(40,46,80,0.3); }
.pay-card { width: 400px; max-width: 100%; padding: 34px 32px; border-radius: 22px; box-shadow: 0 1px 2px rgba(20,24,30,0.04), 0 24px 60px -34px rgba(40,46,80,0.35); }
.pay-price { font-size: 40px; font-weight: 800; font-family: 'Sora'; letter-spacing: -0.02em; }
.pay-perks { margin: 18px 0 4px; display: flex; flex-direction: column; gap: 11px; }
.pay-perk { display: flex; align-items: center; gap: 11px; font-size: 13.5px; color: #2a2f3a; }
.pay-ic { width: 28px; height: 28px; border-radius: 8px; background: #eef1fe; color: #4f63d8; display: flex; align-items: center; justify-content: center; flex: none; }
.ob-card { width: 432px; max-width: 100%; padding: 30px 32px; border-radius: 22px; box-shadow: 0 1px 2px rgba(20,24,30,0.04), 0 24px 60px -34px rgba(40,46,80,0.3); }
.ob-dots { display: flex; gap: 6px; margin-bottom: 18px; } .ob-dot { width: 24px; height: 4px; border-radius: 4px; background: #e7e8ee; } .ob-dot.on { background: #4f63d8; }
.ob-lead { font-size: 14px; line-height: 1.6; color: #4a5260; margin: 0; }
.ob-label { display: block; font-size: 12px; font-weight: 600; color: #5b6573; margin: 14px 0 6px; }
.ob-nav { display: flex; align-items: center; justify-content: space-between; margin-top: 22px; }
.ob-ok { display: inline-flex; align-items: center; gap: 7px; color: #0e9f6e; font-size: 13px; font-weight: 600; }

.app { position: relative; z-index: 1; display: flex; flex-direction: column; height: 100vh; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 11px 22px; background: rgba(255,255,255,0.85); backdrop-filter: blur(10px); border-bottom: 1px solid #ededf2; }
.banner { position: relative; z-index: 1; margin: 10px 22px -2px; padding: 9px 14px; font-size: 13px; color: #34468f; font-weight: 500; background: #eef1fe; border: 1px solid #dde3fb; border-radius: 11px; }
.cols { display: flex; flex: 1; overflow: hidden; }
.pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.left { width: 47%; border-right: 1px solid #ededf2; }
.right { flex: 1; }
.scroll-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 14px 18px; }
.left-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 8px; gap: 8px; }
.hint { font-size: 12.5px; color: #9a6b00; background: #fff8ec; border: 1px solid #f3e2bf; padding: 9px 12px; border-radius: 10px; margin-bottom: 12px; }
.seg { display: inline-flex; gap: 2px; padding: 3px; background: #f0f1f5; border-radius: 11px; }
.seg-btn { position: relative; background: none; border: none; color: #757b88; font-size: 12.5px; font-weight: 600; font-family: inherit; padding: 6px 13px; border-radius: 8px; cursor: pointer; transition: color .15s; white-space: nowrap; }
.seg-btn.on { color: #16181d; } .seg-pill { position: absolute; inset: 0; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(20,24,30,0.1); z-index: 0; }
.dot-badge { margin-left: 6px; font-size: 10px; background: #8b5cf6; color: #fff; border-radius: 10px; padding: 1px 6px; font-weight: 700; }
.scroll .card { margin-bottom: 10px; }
.card-body { font-size: 13.5px; line-height: 1.55; color: #2a2f3a; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.qcard { overflow: hidden; }
.qhead { width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: none; border: none; cursor: pointer; font-family: inherit; text-align: left; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.qtitle { flex: 1; min-width: 0; font-size: 13px; color: #2a2f3a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qbody { padding: 0 14px 13px; }
.qcard-img { width: 100%; border-radius: 10px; margin-bottom: 10px; display: block; max-height: 220px; object-fit: cover; }
.qrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 11px; }
.mini { background: #fff; border: 1px solid #e2e3e9; border-radius: 8px; color: #5b6573; font-size: 11.5px; padding: 4px 9px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
.mini:hover:not(:disabled) { color: #16181d; border-color: #cfd2da; } .mini:disabled { opacity: .4; cursor: default; }
.mini.danger:hover { color: #e0484d; border-color: #f3c2c4; }
.mini.accent { color: #fff; background: #4f63d8; border-color: #4f63d8; } .mini.accent:hover:not(:disabled) { background: #4356c8; }
.draft-card { border-color: #e7ddfb; background: #fcfbff; padding: 14px 15px; }
.empty { color: #98a0ad; font-size: 13px; text-align: center; margin-top: 30px; line-height: 1.7; padding: 0 24px; } .empty-icon { color: #c2c7d2; margin-bottom: 10px; display: flex; justify-content: center; }
.brain-empty { text-align: center; padding: 18px 18px 30px; }
.brain-stage { height: 320px; border-radius: 16px; background: radial-gradient(120% 120% at 50% 0%, #ffffff 0%, #eef4fb 100%); border: 1px solid #e6ebf2; margin-bottom: 14px; overflow: hidden; }
.muted-stage { display: flex; align-items: center; justify-content: center; }
.persona { padding: 15px 16px; }
.persona-summary { font-size: 13px; line-height: 1.6; color: #3a404c; overflow-wrap: anywhere; }
.conn-card { display: flex; align-items: center; gap: 13px; padding: 13px 15px; margin-bottom: 10px; }
.conn-icon { width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex: none; }
.x-icon { background: #16181d; color: #fff; } .li-icon { background: #0a66c2; color: #fff; } .li-icon.ghost { background: #eef4fb; color: #0a66c2; }
.conn-title { font-weight: 600; font-size: 13.5px; }
.conn-sec { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #9aa1ad; margin: 18px 0 9px; }
.slot-empty { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.chat-scroll { padding: 20px 20px 8px; display: flex; flex-direction: column; }
.chat-welcome { margin: auto; text-align: center; padding: 30px 0; }
.msg { display: flex; margin-bottom: 12px; } .msg.user { justify-content: flex-end; } .msg.assistant { justify-content: flex-start; }
.msg-col { display: flex; flex-direction: column; gap: 10px; max-width: 86%; min-width: 0; }
.bubble { max-width: 100%; padding: 11px 15px; font-size: 13.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.bubble.user { background: #4f63d8; color: #fff; border-radius: 17px 17px 5px 17px; }
.bubble.assistant { background: #fff; border: 1px solid #ececf1; color: #2a2f3a; border-radius: 17px 17px 17px 5px; box-shadow: 0 1px 2px rgba(20,24,30,0.03); }
.composer-wrap { border-top: 1px solid #ededf2; padding: 12px 16px 14px; }
.presets { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: none; }
.presets::-webkit-scrollbar { display: none; }
.preset { flex: none; background: #f4f5f8; border: 1px solid #e8e9ee; border-radius: 18px; color: #5b6573; font-size: 12px; padding: 6px 12px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; }
.preset:hover { color: #3b4fc0; border-color: #c6cefb; background: #eef1fe; }
.composer { display: flex; gap: 10px; align-items: flex-end; }
.chat-input { flex: 1; resize: none; max-height: 140px; line-height: 1.5; padding: 11px 14px; }
.send { width: 42px; height: 42px; padding: 0; border-radius: 12px; flex: none; }
.dots { display: inline-flex; gap: 4px; align-items: center; } .dots i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; animation: blink 1s infinite; } .dots i:nth-child(2) { animation-delay: .2s; } .dots i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%,100% { opacity: .25; } 50% { opacity: 1; } }
.overlay { position: fixed; inset: 0; z-index: 50; background: rgba(28,32,48,0.22); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 480px; max-width: 100%; border-radius: 18px; padding: 22px; background: #fff; max-height: 88vh; overflow-y: auto; box-shadow: 0 30px 70px -24px rgba(40,46,80,0.4); }
.settings { width: 460px; }
.x-close { background: none; border: none; cursor: pointer; color: #9aa1ad; padding: 4px; display: flex; border-radius: 8px; } .x-close:hover { color: #16181d; background: #f2f3f6; }
.set-section { padding: 14px 0; border-top: 1px solid #f0f0f4; } .set-section:first-of-type { border-top: none; padding-top: 0; }
.set-h { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #9aa1ad; margin-bottom: 10px; }
.set-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; padding: 6px 0; }
.set-input { width: auto; padding: 7px 11px; font-size: 13px; }
.draft-spin { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #6f8cff; pointer-events: none; }
.dt { width: auto; padding: 8px 12px; font-size: 13px; color-scheme: light; flex: none; }
.count { font-size: 12px; color: #9aa1ad; white-space: nowrap; } .count.over { color: #ef4444; font-weight: 600; }
.upgrade .price { font-size: 38px; font-weight: 800; font-family: 'Sora'; margin: 14px 0 4px; }
.perks { list-style: none; padding: 0; margin: 16px 0; } .perks li { display: flex; align-items: center; gap: 9px; font-size: 13.5px; color: #2a2f3a; padding: 8px 0; border-bottom: 1px solid #f0f0f4; }
.perks li svg { color: #4f63d8; flex: none; }
.dp { padding: 14px; width: 320px; max-width: 100%; }
.dp-head { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; font-weight: 600; color: #8b5cf6; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 9px; }
.dp-text { font-size: 13.5px; line-height: 1.5; resize: none; }
.dp-img-wrap { position: relative; margin-top: 10px; border-radius: 12px; overflow: hidden; }
.dp-img { width: 100%; display: block; border-radius: 12px; aspect-ratio: 1/1; object-fit: cover; background: #eef1f7; }
.dp-placeholder { display: flex; align-items: center; justify-content: center; color: #9aa1ad; }
.dp-regen { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border-radius: 9px; border: none; background: rgba(20,24,30,0.55); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px); }
.dp-regen:hover:not(:disabled) { background: rgba(20,24,30,0.78); } .dp-regen:disabled { opacity: .5; }
.dp-actions { display: flex; align-items: center; gap: 8px; margin-top: 13px; }
.icon-btn { height: 34px; border-radius: 10px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: .15s; }
.icon-btn.x { width: 34px; flex: none; border: 1px solid #f0c8ca; background: #fdf0f0; color: #ef4444; } .icon-btn.x:hover { background: #fbe3e3; }
.icon-btn.check { flex: 1; border: 1px solid #bfe8d6; background: #effaf4; color: #0e9f6e; } .icon-btn.check:hover:not(:disabled) { background: #e2f6ec; } .icon-btn.check:disabled { opacity: .45; cursor: default; }
.dp-done { font-size: 12.5px; font-weight: 600; padding: 9px 14px; border-radius: 11px; background: #fff; border: 1px solid #ececf1; color: #0e9f6e; } .dp-done.discarded { color: #9aa1ad; } .dp-done.failed { color: #d97706; }

/* thumbs feedback */
.thumb { width: 26px; height: 26px; border-radius: 8px; border: 1px solid #e2e3e9; background: #fff; color: #9aa1ad; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: .15s; padding: 0; }
.thumb:hover { color: #5b6573; border-color: #cfd2da; }
.thumb.on.up { color: #0e9f6e; border-color: #bfe8d6; background: #effaf4; }
.thumb.on.down { color: #ef4444; border-color: #f3c2c4; background: #fdf0f0; }
/* countdown pill */
.cd-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #4f63d8; background: #eef1fe; border: 1px solid #dde3fb; padding: 4px 9px; border-radius: 9px; white-space: nowrap; flex: none; }
/* personal-image checkbox */
.dp-personal { display: flex; align-items: center; gap: 7px; margin-top: 8px; background: none; border: none; cursor: pointer; font-family: inherit; font-size: 12px; color: #5b6573; padding: 0; }
.mini-check { width: 15px; height: 15px; border-radius: 5px; border: 1.5px solid #cfd2da; display: inline-flex; align-items: center; justify-content: center; color: #fff; flex: none; }
.mini-check.on { background: #4f63d8; border-color: #4f63d8; }
.dp-acct { width: 100%; padding: 8px 11px; font-size: 13px; }
/* posted history */
.posted-wrap { margin-top: 14px; }
.posted-toggle { display: flex; align-items: center; gap: 7px; background: none; border: none; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #9aa1ad; padding: 4px 2px; }
.posted-toggle:hover { color: #5b6573; }
.posted-card { display: flex; gap: 11px; padding: 11px 13px; align-items: flex-start; }
.posted-thumb { width: 42px; height: 42px; border-radius: 9px; object-fit: cover; flex: none; }
/* campaigns */
.camp-card { padding: 13px 15px; margin-bottom: 10px; }
.camp-state { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #9aa1ad; background: #f0f1f5; border-radius: 20px; padding: 2px 8px; }
.camp-state.on { color: #0e9f6e; background: #effaf4; }
.camp-form { padding: 14px 15px; margin-bottom: 10px; border-color: #dde3fb; }
.camp-accts { margin-top: 10px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.chip { background: #f4f5f8; border: 1px solid #e8e9ee; border-radius: 16px; color: #5b6573; font-size: 12px; padding: 5px 11px; cursor: pointer; font-family: inherit; transition: .15s; }
.chip.on { color: #fff; background: #4f63d8; border-color: #4f63d8; }
.camp-num { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #5b6573; } .camp-num .field { width: 58px; padding: 6px 9px; font-size: 13px; text-align: center; }
/* photo grid */
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.photo-cell { position: relative; width: 62px; height: 62px; border-radius: 11px; overflow: hidden; border: 1px solid #e2e3e9; }
.photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo-del { position: absolute; top: 3px; right: 3px; width: 19px; height: 19px; border-radius: 6px; border: none; background: rgba(20,24,30,0.6); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.photo-del:hover { background: rgba(20,24,30,0.85); }
.photo-add { width: 62px; height: 62px; border-radius: 11px; border: 1.5px dashed #cfd2da; color: #9aa1ad; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: .15s; }
.photo-add:hover { color: #4f63d8; border-color: #a9b6ff; background: #f6f8ff; }
/* generate-posts panel */
.gen-panel { padding: 16px; margin: 14px 0; background: linear-gradient(180deg, #fbfaff 0%, #fff 70%); border-color: #e7ddfb; }
.gen-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
.gen-ic { width: 36px; height: 36px; border-radius: 10px; flex: none; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg, #6f8cff, #8b5cf6); box-shadow: 0 4px 12px -4px rgba(124,108,246,0.5); }
.gen-title { font-weight: 700; font-size: 14.5px; color: #16181d; }
.gen-sub { font-size: 12.5px; line-height: 1.55; color: #6b7280; margin-top: 3px; }
.gen-btn { width: 100%; padding: 11px; font-size: 13.5px; }
/* X connect guide modal */
.xc { width: 440px; }
.xc-glyph { width: 30px; height: 30px; border-radius: 9px; background: #16181d; color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.xc-lead { font-size: 13.5px; line-height: 1.6; color: #4a5260; margin: 6px 0 16px; }
.xc-steps { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
.xc-step { display: flex; gap: 11px; font-size: 13px; line-height: 1.55; color: #2a2f3a; }
.xc-num { width: 22px; height: 22px; border-radius: 50%; flex: none; background: #eef1fe; color: #4f63d8; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.xc-actions { display: flex; gap: 10px; }
.xc-open { flex: 1; justify-content: center; gap: 7px; text-decoration: none; }
.xc-go { flex: 1; padding: 9px 15px; }
`
