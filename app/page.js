'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  Check as LCheck, X as LX, RefreshCw, Sparkles, Send, Plus,
  Brain, ChevronDown, Trash2, Pencil, Crown, Clock, Wand2, Image as LImage,
  ThumbsUp, ThumbsDown, Upload, Play, MessageCircle, Star, Loader2,
  ArrowLeft, CreditCard, Users, User as LUser, Bot,
} from 'lucide-react'
import { SLIDESHOW_FORMATS, SLIDE_STYLE_LIST } from '@/lib/slideshow-styles'
import { PLANS, PLAN_LIST, monthlyEquivalent } from '@/lib/plans'

function LIcon({ size = 18 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.74v20.52C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.74V1.74C24 .78 23.2 0 22.22 0z"/></svg> }

const BrainViz = dynamic(() => import('./BrainViz'), { ssr: false })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const STATUS = {
  draft:  { c: '#8b5cf6', label: 'draft' }, queued: { c: '#10b981', label: 'queued' },
  paused: { c: '#f59e0b', label: 'paused' }, posted: { c: '#3b82f6', label: 'posted' },
  posting: { c: '#6366f1', label: 'posting…' }, failed: { c: '#ef4444', label: 'failed' },
}
const MAX = 280
// LinkedIn posts are intentionally long-form; X is the 280 platform.
const capFor = p => (p?.platform === 'linkedin' ? 1300 : 280)

// Where a post came from, color-coded so you can tell at a glance whether you
// scheduled it, a campaign made it, or it's a reply to someone else's post.
function sourceMeta(p) {
  if (p.source === 'agent') return { label: 'Agent', c: '#0e9f6e', bg: '#eafaf2', bd: '#c4ecd8' }
  if (p.reply_to_tweet_id || p.source === 'engagement') return { label: 'Reply', c: '#7c3aed', bg: '#f3eefe', bd: '#e2d4fb' }
  if (p.source === 'campaign') return { label: 'Campaign', c: '#c2740a', bg: '#fdf3e3', bd: '#f5dcae' }
  return { label: 'You', c: '#4f63d8', bg: '#eef1fe', bd: '#dde3fb' }
}
function SourceTag({ p }) {
  const m = sourceMeta(p)
  return <span className="src-tag" style={{ color: m.c, background: m.bg, borderColor: m.bd }}>{m.label}</span>
}
const TZS = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney']

function fmt(ts) {
  if (!ts) return 'not set'
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
        <div className="muted" style={{ marginTop: 8, marginBottom: 28, fontSize: 14 }}>You write on LinkedIn. Cadence turns it into tweets and posts them for you.</div>
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
    [Sparkles, 'Unlimited posts written in your voice'],
    [Clock, 'Auto-scheduling & auto-posting to X'],
    [LImage, 'AI images on your posts'],
  ]
  return (
    <div className="auth-wrap">
      <motion.div className="card pay-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="row" style={{ gap: 9, marginBottom: 6 }}><span className="wordmark" style={{ fontSize: 24 }}>Cadence</span><span className="pro-pill"><Crown size={12} /> Pro</span></div>
        <div className="muted" style={{ fontSize: 14, marginBottom: 18 }}>Subscribe and Cadence writes your tweets in your voice, then posts them on schedule.</div>
        <div className="pay-price">${me?.proPrice || 19}<span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>/month</span></div>
        <div className="pay-perks">
          {perks.map(([Ic, t], i) => <div key={i} className="pay-perk"><span className="pay-ic"><Ic size={15} /></span>{t}</div>)}
        </div>
        <motion.button className="btn-primary" style={{ width: '100%', padding: 13, marginTop: 18 }} disabled={busy} onClick={subscribe} whileTap={{ scale: 0.98 }}>
          {busy ? <span className="dots"><i/><i/><i/></span> : `Subscribe for $${me?.proPrice || 19}/mo`}
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
  const [busy, setBusy] = useState(false); const [obMsg, setObMsg] = useState('')
  const [liDone, setLiDone] = useState(saved.liDone || false)
  const [conns, setConns] = useState([])

  const persist = (patch) => { localStorage.setItem(OB_KEY, JSON.stringify({ step, name, role, goals, liDone, ...patch })) }
  useEffect(() => { authed('/api/x/status').then(r => r.json()).then(d => setConns(d.connections || [])) }, [authed])
  useEffect(() => { const p = new URLSearchParams(window.location.search); if (p.get('x') === 'connected') { setStep(s => Math.max(s, 3)); window.history.replaceState({}, '', '/') } }, [])

  const connected = conns.length > 0
  async function connectX() { setObMsg(''); persist({ step: 2 }); const r = await authed('/api/x/connect', { method: 'POST' }); const d = await r.json(); if (d.url) window.location.href = d.url; else setObMsg(d.error || 'Could not start X connection. Try again.') }
  async function scrapeLi() {
    if (!liUrl.trim()) return setStep(s => s + 1)
    setBusy(true); setObMsg('')
    const r = await authed('/api/linkedin', { method: 'POST', body: JSON.stringify({ profileUrl: liUrl.trim(), maxPosts: 50 }) })
    const d = await r.json(); setBusy(false)
    if (!d.error) { setLiDone(true); persist({ liDone: true, step: step + 1 }); setStep(s => s + 1) }
    else setObMsg(d.error)
  }
  async function finish() {
    setBusy(true)
    await authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ full_name: name, role, goals, onboarded: true }) })
    localStorage.removeItem(OB_KEY); setBusy(false); onDone()
  }

  const steps = [
    { title: 'Welcome to Cadence', body: (<>
      <p className="ob-lead">Cadence learns how you write on LinkedIn, then drafts tweets in your voice and posts them on a schedule. You approve every one before it goes out.</p>
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
      <p className="ob-lead">Paste your LinkedIn profile URL. Cadence reads your last 50 posts to learn how you write. No login needed.</p>
      <input className="field" style={{ marginTop: 14 }} value={liUrl} onChange={e => setLiUrl(e.target.value)} placeholder="linkedin.com/in/your-handle" />
      {liDone && <div className="ob-ok" style={{ marginTop: 10 }}><Check /> Posts pulled</div>}
      <div className="ob-nav"><span className="link" onClick={() => setStep(2)}>Back</span><button className="btn-primary" disabled={busy} onClick={scrapeLi}>{busy ? <span className="dots"><i/><i/><i/></span> : liUrl.trim() ? 'Pull posts' : 'Skip'}</button></div>
    </>)},
    { title: "You're all set", body: (<>
      <p className="ob-lead">{name ? `Welcome, ${name.split(' ')[0]}. ` : ''}Open the X tab to connect your account and learn your voice, then jump into your Queue.</p>
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
        {obMsg && <div className="notice" style={{ marginTop: 12, color: '#c0392b' }}>{obMsg}</div>}
      </motion.div>
    </div>
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

// ── Draft proposal (in chat) — editable editor for every recommended post.
// proposal.platform follows the chat's Focus (LinkedIn focus → LinkedIn post,
// 1300-char cap, publishes via Zernio instead of an X connection). ─────────────
function DraftProposal({ proposal, authed, connected, canPostLinkedIn, onResolved, defaultHour, xConns = [], hasPhotos }) {
  const platform = proposal.platform === 'linkedin' ? 'linkedin' : 'x'
  const isLi = platform === 'linkedin'
  const cap = isLi ? 1300 : MAX
  const canPost = isLi ? canPostLinkedIn : connected
  const [content, setContent] = useState(proposal.content || '')
  const [img, setImg] = useState(proposal.image_url || '')
  const [imgOn, setImgOn] = useState(!!proposal.image_url)
  const [personal, setPersonal] = useState(false)
  const [when, setWhen] = useState(defaultWhen(defaultHour))
  const [connId, setConnId] = useState(xConns[0]?.id || '')
  const [busy, setBusy] = useState(false); const [regen, setRegen] = useState(false); const [done, setDone] = useState(null)
  const [rating, setRating] = useState(null); const [err, setErr] = useState(''); const [doneErr, setDoneErr] = useState('')
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
    if (!content.trim() || content.length > cap) return
    setBusy(true)
    const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ content, platform, scheduledFor: new Date(when).toISOString(), imageUrl: imgOn ? img : null, xConnectionId: isLi ? null : (connId || null) }) })
    const d = await r.json()
    if (!r.ok || d.error || !d.post?.id) { setBusy(false); setErr(d.error || 'Could not save the post.'); return }
    let result = 'scheduled', errMsg = ''
    if (postNow) {
      const pr = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ id: d.post.id, action: 'post_now' }) })
      const pd = await pr.json()
      result = pd.status === 'posted' ? 'posted' : 'failed'
      if (result === 'failed') errMsg = pd.error || 'Post failed.'
    }
    setBusy(false); setDoneErr(errMsg); setDone(result); onResolved && onResolved()
  }
  if (done) return <div className={'dp-done ' + done}>{done === 'posted' ? (isLi ? 'Posted to LinkedIn' : 'Posted to X') : done === 'failed' ? `Failed — saved to Queue. ${doneErr}` : done === 'discarded' ? 'Discarded' : `Scheduled · ${fmt(new Date(when).toISOString())}`}</div>
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
      <textarea className="field dp-text" rows={isLi ? 6 : 3} maxLength={cap + 100} value={content} onChange={e => setContent(e.target.value)} />
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
      {!isLi && xConns.length > 1 && (
        <select className="field dp-acct" value={connId} onChange={e => setConnId(e.target.value)}>
          {xConns.map(c => <option key={c.id} value={c.id}>Post as @{c.username}</option>)}
        </select>
      )}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <input type="datetime-local" className="field dt" value={when} onChange={e => setWhen(e.target.value)} />
          <span className="cd-pill"><Clock size={11} /> {countdown}</span>
        </div>
        <span className={'count' + (content.length > cap ? ' over' : '')}>{content.length}/{cap}</span>
      </div>
      {err && <div className="notice" style={{ color: '#c0392b', marginTop: 8 }}>{err}</div>}
      <div className="dp-actions">
        <button className="icon-btn x" title="Discard" onClick={() => setDone('discarded')}><Ex /></button>
        <button className="icon-btn check" title="Approve & schedule" disabled={busy || content.length > cap || !content.trim()} onClick={() => approve(false)}><Check /> <span>Schedule</span></button>
        <motion.button className="btn-primary btn-sm" whileTap={{ scale: 0.96 }} disabled={busy || !canPost || content.length > cap} onClick={() => approve(true)} title={!canPost ? (isLi ? 'Connect LinkedIn first' : 'Connect X first') : 'Post now'}>Post now</motion.button>
      </div>
    </motion.div>
  )
}

// ── Queue card (collapsible + inline edit) ──────────────────────────────────────
function QueueCard({ p, i, connected, canPostLinkedIn, defaultCollapsed, onSaveEdit, onPostNow, onDelete, onSchedule }) {
  const s = STATUS[p.status] || { c: '#9ca3af', label: p.status }
  const cap = capFor(p)
  const isLi = p.platform === 'linkedin'
  const canPost = isLi ? canPostLinkedIn : connected
  const inFlight = p.status === 'posting'
  const [open, setOpen] = useState(!defaultCollapsed)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.content)
  const [busy, setBusy] = useState(false)
  async function save() { setBusy(true); await onSaveEdit(p.id, draft); setBusy(false); setEditing(false); setOpen(true) }
  return (
    <motion.div className={'card qcard' + (open ? ' open' : '')} style={{ borderLeft: `3px solid ${sourceMeta(p).c}` }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, ...spring }} layout>
      <button className="qhead" onClick={() => !editing && setOpen(o => !o)}>
        <span className="status-dot" style={{ background: s.c }} />
        <span className="qtitle">{open ? <span className="muted tiny">{fmt(p.scheduled_for)} · {s.label}</span> : titleOf(p.content)}</span>
        <SourceTag p={p} />
        <ChevronDown size={15} className="qchev" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: '#9aa1ad', flex: 'none' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
            <div className="qbody">
              <ReplyContext p={p} />
              {p.image_url && <img src={p.image_url} className="qcard-img" alt="" />}
              {p.status === 'failed' && p.error && <div className="notice" style={{ color: '#c0392b', marginBottom: 8 }}>{p.error}</div>}
              {editing
                ? <textarea className="field" rows={5} value={draft} maxLength={cap + 40} onChange={e => setDraft(e.target.value)} autoFocus />
                : <div className="card-body">{p.content}</div>}
              {editing && <div className={'count' + (draft.length > cap ? ' over' : '')} style={{ marginTop: 6 }}>{draft.length}/{cap}</div>}
              {p.status !== 'posted' && (
                <div className="qrow">
                  <span className="muted tiny">{inFlight ? 'posting…' : fmt(p.scheduled_for)}</span>
                  <div className="row" style={{ gap: 6 }}>
                    {inFlight ? <span className="muted tiny"><Loader2 size={12} className="spin" /> publishing</span>
                     : editing ? (<>
                      <button className="mini" onClick={() => { setDraft(p.content); setEditing(false) }}>Cancel</button>
                      <button className="mini accent" disabled={busy || !draft.trim() || draft.length > cap} onClick={save}>{busy ? '…' : 'Save'}</button>
                    </>) : (<>
                      <button className="mini" onClick={() => setEditing(true)}><Pencil size={12} /> Edit</button>
                      <button className="mini" onClick={() => onSchedule(p)}><Clock size={12} /> Time</button>
                      <button className="mini" onClick={() => onPostNow(p.id)} disabled={!canPost} title={!canPost ? (isLi ? 'Connect LinkedIn to publish' : 'Connect X to publish') : ''}>{p.status === 'failed' ? 'Retry' : 'Post now'}</button>
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

// Activity monitor shared by campaigns and engagement rules: everything that
// has gone out, is due, or is coming up for one campaign/rule.
function activityFor(posts, key, id) {
  const mine = posts.filter(p => p[key] === id)
  const live = mine.filter(p => p.status === 'posted')
    .sort((a, b) => new Date(b.posted_at || b.scheduled_for) - new Date(a.posted_at || a.scheduled_for))
  const pending = mine.filter(p => p.status !== 'posted')
    .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))
  return { pending, live }
}

function ActivityList({ pending, live }) {
  const rows = [...pending, ...live]
  if (!rows.length) return <div className="muted tiny" style={{ padding: '8px 2px 2px' }}>Nothing yet. Posts will show up here as the agent creates them.</div>
  return (
    <div className="act-list">
      {rows.map(p => {
        const s = STATUS[p.status] || { c: '#9ca3af', label: p.status }
        const when = p.status === 'posted' ? `posted ${fmt(p.posted_at || p.scheduled_for)}`
          : p.status === 'draft' ? 'waiting for your approval'
          : p.status === 'queued' ? (new Date(p.scheduled_for) > new Date() ? `going out ${fmt(p.scheduled_for)}` : 'due now')
          : p.status === 'failed' ? 'failed' : s.label
        return (
          <div className="act-row" key={p.id}>
            <span className="status-dot" style={{ background: s.c, marginTop: 5 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="act-text">{p.content}</div>
              <div className="muted tiny" style={{ marginTop: 3 }}>
                {when}
                {p.status === 'posted' && p.external_id && (p.platform || 'x') === 'x' && <> · <a className="link" href={`https://x.com/i/web/status/${p.external_id}`} target="_blank" rel="noreferrer">view on X</a></>}
                {p.reply_to_tweet_id && <> · <a className="link" href={p.target_tweet_url || `https://x.com/i/web/status/${p.reply_to_tweet_id}`} target="_blank" rel="noreferrer">replying to</a></>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// What an engagement reply is replying TO — shown on drafts/queue cards so the
// user always knows the context they're approving.
function ReplyContext({ p }) {
  if (!p.reply_to_tweet_id) return null
  const t = p.target_tweet_text || ''
  return (
    <a className="reply-ctx" href={p.target_tweet_url || `https://x.com/i/web/status/${p.reply_to_tweet_id}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
      <MessageCircle size={12} />
      <span className="reply-ctx-text">Replying to {t ? `“${t.slice(0, 110)}${t.length > 110 ? '…' : ''}”` : 'this post'}</span>
    </a>
  )
}

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
              <div className="card posted-card" key={p.id} style={{ borderLeft: `3px solid ${sourceMeta(p).c}` }}>
                {p.image_url && <img src={p.image_url} className="posted-thumb" alt="" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 4 }}><SourceTag p={p} /></div>
                  <div className="card-body" style={{ fontSize: 12.5 }}>{p.content}</div>
                  <div className="muted tiny" style={{ marginTop: 5 }}>Posted {fmt(p.posted_at || p.scheduled_for)}{p.external_id && (p.platform || 'x') === 'x' ? <> · <a className="link" href={`https://x.com/i/web/status/${p.external_id}`} target="_blank" rel="noreferrer">view</a></> : ''}</div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Live "what's it doing now" line: a spinner + step text while running, or the
// last activity when idle. Shared by post + engagement campaign cards.
function LiveStatus({ running, detail, lastAt }) {
  if (!detail && !running) return null
  return (
    <div className={'live-status' + (running ? ' on' : '')}>
      {running
        ? <Loader2 size={12} className="spin" />
        : <span className="status-dot" style={{ background: '#cbd0d8', width: 7, height: 7 }} />}
      <span className="live-text">{detail || 'Idle'}</span>
      {!running && lastAt && <span className="muted tiny" style={{ marginLeft: 'auto', flex: 'none' }}>{fmt(lastAt)}</span>}
    </div>
  )
}

// "Run now" button with a busy state while its run is in flight.
function RunNow({ running, onRun }) {
  return (
    <button className="mini" disabled={running} onClick={onRun} title="Run this now and watch it work">
      {running ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
    </button>
  )
}

// ── Slideshow studio (AI Instagram carousels) ───────────────────────────────────
const PLATFORMS = [
  { key: 'instagram', label: 'Instagram' }, { key: 'tiktok', label: 'TikTok' },
  { key: 'linkedin', label: 'LinkedIn' }, { key: 'facebook', label: 'Facebook' },
]
function platformDot(p) { return ({ x: '#15171A', instagram: '#E1306C', tiktok: '#00b8b0', linkedin: '#0A66C2', facebook: '#1877F2' }[p] || '#888') }

function SlideshowStudio({ accounts, configured, slideshows, onConnect, onSync, onGenerate, onSave, onDelete, hideAccounts }) {
  const [topic, setTopic] = useState('')
  const [format, setFormat] = useState('listicle'); const [style, setStyle] = useState('bold')
  const [count, setCount] = useState(6)
  const [busy, setBusy] = useState(false); const [deck, setDeck] = useState(null) // {slides,caption,image_urls,style,format}
  const [pickedAccts, setPickedAccts] = useState([]); const [when, setWhen] = useState('')

  // Every platform that takes an image carousel — Instagram, TikTok, LinkedIn, Facebook.
  const igLike = accounts.filter(a => ['instagram', 'tiktok', 'linkedin', 'facebook'].includes(a.platform))
  const toggleAcct = id => setPickedAccts(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  async function gen() {
    if (!topic.trim()) return
    setBusy(true); setDeck(null)
    const d = await onGenerate({ topic: topic.trim(), format, style, slides: Number(count) })
    setBusy(false)
    if (d.error) return
    setDeck({ ...d, topic: topic.trim() })
  }
  async function schedule(post) {
    if (!deck) return
    const ok = await onSave({
      action: 'schedule', topic: deck.topic, format: deck.format, style: deck.style,
      slides: deck.slides, caption: deck.caption, image_urls: deck.imageUrls,
      account_ids: pickedAccts, scheduled_for: post && when ? new Date(when).toISOString() : null,
    })
    if (ok) { setDeck(null); setTopic(''); setPickedAccts([]); setWhen('') }
  }
  async function saveDraft() {
    if (!deck) return
    const ok = await onSave({ topic: deck.topic, format: deck.format, style: deck.style, slides: deck.slides, caption: deck.caption, image_urls: deck.imageUrls })
    if (ok) setDeck(null)
  }

  return (
    <>
      {/* Connected accounts (hidden when the tab already shows an accounts strip) */}
      {!hideAccounts && (<>
        <div className="conn-sec row" style={{ gap: 7, marginTop: 2 }}>Connected accounts
          <button className="mini" style={{ marginLeft: 'auto' }} onClick={onSync}><RefreshCw size={11} /> Refresh</button>
        </div>
        {!configured && <div className="notice" style={{ marginBottom: 10 }}>Posting isn&apos;t connected yet. Create a <b>Zernio</b> account (zernio.com), then set <code>ZERNIO_API_KEY</code> on the server. You can still generate and preview slideshows below now.</div>}
        {accounts.length === 0
          ? <div className="muted tiny" style={{ marginBottom: 8 }}>No accounts linked yet.</div>
          : <div className="acct-row">{accounts.map(a => (
              <span className="acct-chip" key={a.id}><span className="status-dot" style={{ background: platformDot(a.platform) }} />{a.username || a.platform}</span>
            ))}</div>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {PLATFORMS.map(p => <button key={p.key} className="chip" disabled={!configured} onClick={() => onConnect(p.key)}><Plus size={11} /> {p.label}</button>)}
        </div>
      </>)}

      {/* Generator */}
      <div className="conn-sec">Create a slideshow</div>
      <div className="card camp-form">
        <textarea className="field" rows={2} placeholder="What's the slideshow about? e.g. how small creators grow on Instagram in 2026" value={topic} onChange={e => setTopic(e.target.value)} />
        <label className="ob-label">Format</label>
        <div className="ss-grid">
          {SLIDESHOW_FORMATS.map(f => (
            <button key={f.key} type="button" className={'style-opt' + (format === f.key ? ' on' : '')} onClick={() => setFormat(f.key)}>
              <span><span className="style-name">{f.label}</span><span className="style-desc">{f.desc}</span></span>
            </button>
          ))}
        </div>
        <label className="ob-label">Style</label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {SLIDE_STYLE_LIST.map(s => (
            <button key={s.key} type="button" className={'sw-chip' + (style === s.key ? ' on' : '')} onClick={() => setStyle(s.key)} title={s.ai ? 'AI-generated backgrounds' : 'Typographic template'}>
              <span className="sw" style={{ background: s.swatch.startsWith('linear') ? undefined : s.swatch, backgroundImage: s.swatch.startsWith('linear') ? s.swatch : undefined, color: s.fg }}>Aa</span>
              {s.label}{s.ai ? ' ✨' : ''}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, justifyContent: 'space-between' }}>
          <label className="camp-num"><input type="number" min={3} max={10} className="field" value={count} onChange={e => setCount(e.target.value)} /> slides</label>
          <button className="btn-primary btn-sm" disabled={busy || !topic.trim()} onClick={gen}>{busy ? <span className="dots"><i/><i/><i/></span> : <><Wand2 size={13} /> Generate</>}</button>
        </div>
      </div>

      {/* Preview + schedule */}
      {deck && (
        <motion.div className="card camp-form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="ss-preview">
            {deck.imageUrls.map((u, i) => <img key={i} src={u} alt={`slide ${i + 1}`} className="ss-slide" />)}
          </div>
          <div className="muted tiny" style={{ whiteSpace: 'pre-wrap', marginTop: 10, lineHeight: 1.5 }}>{deck.caption}</div>
          {igLike.length > 0 && <>
            <div className="muted tiny" style={{ margin: '12px 0 6px' }}>Post to:</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {igLike.map(a => <button key={a.id} type="button" className={'chip' + (pickedAccts.includes(a.id) ? ' on' : '')} onClick={() => toggleAcct(a.id)}><span className="status-dot" style={{ background: platformDot(a.platform) }} />{a.username || a.platform}</button>)}
            </div>
            <input type="datetime-local" className="field" style={{ marginTop: 10 }} value={when} onChange={e => setWhen(e.target.value)} />
          </>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="mini" onClick={() => setDeck(null)}>Discard</button>
            <button className="btn-ghost btn-sm" onClick={saveDraft}>Save draft</button>
            {igLike.length > 0 && configured && <>
              <button className="btn-ghost btn-sm" disabled={!pickedAccts.length || !when} onClick={() => schedule(true)}>Schedule</button>
              <button className="btn-primary btn-sm" disabled={!pickedAccts.length} onClick={() => schedule(false)}>Post now</button>
            </>}
          </div>
        </motion.div>
      )}

      {/* Saved decks */}
      {slideshows.length > 0 && <>
        <div className="conn-sec">Your slideshows</div>
        {slideshows.map(s => (
          <div className="card camp-card" key={s.id}>
            <div className="row" style={{ gap: 10 }}>
              {s.image_urls?.[0] && <img src={s.image_urls[0]} className="ss-thumb" alt="" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="conn-title row" style={{ gap: 7 }}>{s.topic}<span className={'camp-state' + (s.status === 'posted' || s.status === 'scheduled' ? ' on' : '')}>{s.status}</span></div>
                <div className="muted tiny" style={{ marginTop: 3 }}>{s.image_urls?.length || 0} slides · {s.style} · {s.format}{s.scheduled_for ? ` · ${fmt(s.scheduled_for)}` : ''}{s.error ? ` · ${s.error}` : ''}</div>
              </div>
              <button className="mini danger" onClick={() => onDelete(s.id)}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </>}
    </>
  )
}

// A brand-themed brain animation header for each tab. Pass `dual` for two
// side-by-side brains (the IG/TikTok tab shows both platform brains).
function BrainBanner({ theme, dual }) {
  if (!dual) return <div className="brain-stage" style={{ height: 190 }}><BrainViz theme={theme} /></div>
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div className="brain-stage" style={{ height: 175, flex: 1, minWidth: 0 }}><BrainViz theme={theme} /></div>
      <div className="brain-stage" style={{ height: 175, flex: 1, minWidth: 0 }}><BrainViz theme={dual} /></div>
    </div>
  )
}

// Clean per-platform auto-reply: ONE toggle per platform. When on, Cadence reads
// new comments on the user's own posts and writes a reply in their voice, held
// for one-tap approval (safe, reversible — nothing posts without a tap). Every
// rendered field is stringified so raw inbox payloads can never leak as code.
const str = v => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? '' : String(v))
// Some inbox payloads stored the comment author as a JSON object (or a string of
// one). Pull a clean @handle out of whatever shape we got.
function authorHandle(v) {
  let val = v
  if (typeof val === 'string') {
    const s = val.trim()
    if (s.startsWith('{') || s.startsWith('[')) { try { val = JSON.parse(s) } catch { return s.replace(/^@/, '') || 'someone' } }
    else return s.replace(/^@/, '') || 'someone'
  }
  if (val && typeof val === 'object') return val.username || val.name || val.handle || 'someone'
  return val == null ? 'someone' : String(val).replace(/^@/, '') || 'someone'
}
function AutoReply({ platforms, settings, replies, accounts, configured, onToggle, onRun, onPostDraft }) {
  const byPlat = Object.fromEntries((settings || []).map(s => [s.platform, s]))
  const label = { x: 'X', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn' }
  return (
    <>
      {!configured && platforms.some(p => p !== 'x') && <div className="notice" style={{ marginBottom: 10 }}>Connect publishing to enable replies.</div>}
      {platforms.map(pl => {
        const s = byPlat[pl] || { platform: pl, enabled: false }
        const has = accounts.some(a => a.platform === pl)
        const drafts = (replies || []).filter(r => r.platform === pl && r.status === 'draft')
        return (
          <div className={'ar-block card' + (s.enabled ? ' on' : '')} key={pl}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div className="row" style={{ gap: 10, minWidth: 0 }}>
                <span className="status-dot" style={{ background: platformDot(pl), marginTop: 5 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label[pl]}</div>
                  <div className="muted tiny">{has ? 'Replies held for your approval' : 'No account connected'}</div>
                </div>
              </div>
              <Toggle on={!!s.enabled} onChange={v => onToggle(pl, { enabled: v })} />
            </div>
            {s.enabled && (
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  {s.running
                    ? <span className="live-status on" style={{ margin: 0 }}><Loader2 size={11} className="spin" /> {str(s.status_detail) || 'Checking comments…'}</span>
                    : <span className="muted tiny">{drafts.length ? `${drafts.length} repl${drafts.length === 1 ? 'y' : 'ies'} waiting for you` : 'No replies waiting'}</span>}
                  <button className="mini" disabled={!has} onClick={() => onRun(pl)}><RefreshCw size={11} /> Check now</button>
                </div>
                {drafts.slice(0, 6).map(d => (
                  <div className="ar-draft" key={d.id}>
                    <div className="ar-comment"><span className="ar-author">@{authorHandle(d.comment_author)}</span>{str(d.comment_text) ? ' · ' + str(d.comment_text).slice(0, 130) : ''}</div>
                    <div className="ar-reply">{str(d.reply_text)}</div>
                    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                      <button className="btn-primary btn-sm" onClick={() => onPostDraft(d.id)}>Reply</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// Floating, bottom-right expandable "accounts" dot for a tab. Keeps account
// management (and, on LinkedIn, voice/inspiration) one tap away without cluttering
// the main create-first flow.
function FloatingAccounts({ glyph, count, label, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="facct">
      <AnimatePresence>
        {open && (
          <motion.div className="facct-panel card" initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }} transition={spring}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{label}</span>
              <button className="x-close" onClick={() => setOpen(false)}><LX size={16} /></button>
            </div>
            <div className="facct-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <button className={'facct-dot' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)} title={label}>
        {glyph}
        {count > 0 && <span className="facct-count">{count}</span>}
      </button>
    </div>
  )
}

// Compact stat tiles (e.g. followers / following / posts).
const fmtNum = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n)
function StatTiles({ tiles }) {
  return (
    <div className="stat-tiles">
      {tiles.map((t, i) => (
        <div className="stat-tile" key={i}>
          <div className="stat-num">{t.value}</div>
          <div className="stat-lbl">{t.label}</div>
        </div>
      ))}
    </div>
  )
}

// Single-platform campaign: promote a topic on the user's OWN account for this
// platform, in their voice, on a cadence. Reuses the brand-campaign engine with
// targets locked to this tab's platform.
function PlatformCampaign({ campaigns, targets, supportsCarousel, allowImage, canCreate, connectHint, onSave, onPatch, onDelete, onRun }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(''); const [topic, setTopic] = useState('')
  const [hours, setHours] = useState(24)
  const [style, setStyle] = useState('bold'); const [format, setFormat] = useState('listicle'); const [img, setImg] = useState(false)
  const [picked, setPicked] = useState([]); const [busy, setBusy] = useState(false)
  const single = targets.length === 1
  function startNew() { setPicked(targets.map(t => t.id)); setOpen(true) }
  const chosen = single ? targets : targets.filter(t => picked.includes(t.id))
  async function submit() {
    if (!name.trim() || !topic.trim() || !chosen.length) return
    setBusy(true)
    const payload = {
      name: name.trim(), topic: topic.trim(),
      targets: chosen.map(t => ({ kind: t.kind, id: t.id, platform: t.platform })),
      interval_hours: Number(hours), include_image: img,
    }
    if (supportsCarousel) { payload.carousel_style = style; payload.carousel_format = format }
    payload.active = true
    const ok = await onSave(payload)
    setBusy(false)
    if (ok) { setOpen(false); setName(''); setTopic(''); setPicked([]) }
  }
  return (
    <>
      {campaigns.map(c => (
        <div className={'card camp-card' + (c.active ? ' on' : '')} key={c.id} style={{ display: 'block' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div className="conn-title">{c.name}</div>
              <div className="muted tiny" style={{ marginTop: 2 }}>{c.topic}</div>
              {c.status_detail && <div className="muted tiny" style={{ marginTop: 6 }}>{c.running && <Loader2 size={10} className="spin" />} {c.status_detail}</div>}
            </div>
            <Toggle on={!!c.active} onChange={v => onPatch(c.id, { active: v })} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <span className="muted tiny" style={{ marginRight: 'auto' }}>every {c.interval_hours}h</span>
            <button className="mini" onClick={() => onRun(c.id)} disabled={c.running}><Play size={11} /> Run now</button>
            <button className="mini danger" onClick={() => onDelete(c.id)}><Trash2 size={12} /></button>
          </div>
        </div>
      ))}
      {open ? (
        <div className="card camp-form">
          <input className="field" placeholder="Campaign name (e.g. Launch week)" value={name} onChange={e => setName(e.target.value)} />
          <textarea className="field" rows={2} style={{ marginTop: 8 }} placeholder="What to promote — written in your voice" value={topic} onChange={e => setTopic(e.target.value)} />
          {!single && (<>
            <label className="ob-label">Post to</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {targets.map(t => <button type="button" key={t.id} className={'chip' + (picked.includes(t.id) ? ' on' : '')} onClick={() => setPicked(p => p.includes(t.id) ? p.filter(x => x !== t.id) : [...p, t.id])}><span className="status-dot" style={{ background: platformDot(t.platform) }} />{t.label}</button>)}
            </div>
          </>)}
          {supportsCarousel && (
            <div style={{ marginTop: 10 }}>
              <label className="ob-label">Carousel style</label>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {SLIDE_STYLE_LIST.map(s => <button type="button" key={s.key} className={'sw-chip' + (style === s.key ? ' on' : '')} onClick={() => setStyle(s.key)}><span className="sw" style={{ background: s.swatch.startsWith('linear') ? undefined : s.swatch, backgroundImage: s.swatch.startsWith('linear') ? s.swatch : undefined, color: s.fg }}>Aa</span>{s.label}</button>)}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {SLIDESHOW_FORMATS.map(f => <button type="button" key={f.key} className={'chip' + (format === f.key ? ' on' : '')} onClick={() => setFormat(f.key)}>{f.label}</button>)}
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 12, marginTop: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <label className="camp-num">every <input type="number" min={1} className="field" value={hours} onChange={e => setHours(e.target.value)} /> hours</label>
            {allowImage && !supportsCarousel && <label className="row" style={{ gap: 7, fontSize: 12.5 }}><Toggle on={img} onChange={setImg} /> AI image</label>}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="mini" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={busy || !name.trim() || !topic.trim() || !chosen.length} onClick={submit}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Start campaign'}</button>
          </div>
        </div>
      ) : (
        canCreate
          ? <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center' }} onClick={startNew}><Plus size={14} /> New campaign</button>
          : <div className="muted tiny" style={{ padding: '2px 2px 4px' }}>{connectHint}</div>
      )}
    </>
  )
}

// Collapsible section — the backbone of the simplified tabs. Each tab keeps one
// primary area open; everything else folds away until needed.
function Section({ title, hint, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="sec card" style={{ padding: 0, marginBottom: 10, overflow: 'hidden' }}>
      <button className="sec-head" onClick={() => setOpen(o => !o)}>
        <span className="sec-title">{title}</span>
        {hint && <span className="muted tiny" style={{ fontWeight: 400 }}>{hint}</span>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {badge}
          <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
            <div style={{ padding: '4px 14px 14px' }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
const OnBadge = ({ on }) => <span className={'camp-state' + (on ? ' on' : '')}>{on ? 'on' : 'off'}</span>

// ── Clip studio — automated clipping for IG/TikTok ──────────────────────────────
const CLIP_FORMAT_LIST = [
  { key: 'vertical', label: 'Vertical 9:16', desc: 'blurred pad — nothing cropped' },
  { key: 'vertical_crop', label: 'Vertical crop', desc: 'fills the phone screen' },
  { key: 'square', label: 'Square 1:1', desc: 'feed-friendly' },
  { key: 'original', label: 'Original', desc: 'keep aspect ratio' },
]
// Edit styles applied on top of clips. Pick one or several — clips rotate
// through the chosen set. Captions are word-by-word with a yellow highlight;
// titles are AI-written from the transcript; watermark is your handle.
const EDIT_FORMAT_LIST = [
  { key: 'captions', label: 'Captions', desc: 'word-by-word bold captions, yellow highlight' },
  { key: 'sludge', label: 'Sludge split', desc: 'your clip on top, gameplay underneath' },
  { key: 'hook', label: 'Hook + captions', desc: 'big AI title first, captions throughout' },
  { key: 'clean', label: 'Clean', desc: 'watermark only' },
]
function ClipStudio({ jobs, accounts, configured, onCreate, onUpload, onDelete, onPost }) {
  const [url, setUrl] = useState(''); const [fileName, setFileName] = useState('')
  const [format, setFormat] = useState('vertical'); const [len, setLen] = useState('short'); const [maxClips, setMaxClips] = useState(3)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const postable = accounts.filter(a => ['instagram', 'tiktok'].includes(a.platform))
  const [edits, setEdits] = useState(['captions', 'sludge'])
  const [watermark, setWatermark] = useState('')
  const wmDefault = postable[0]?.username ? `@${postable[0].username}` : ''
  const toggleEdit = k => setEdits(s => s.includes(k) ? (s.length > 1 ? s.filter(x => x !== k) : s) : [...s, k])

  async function pickFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    setBusy(true); setFileName(f.name)
    const u = await onUpload(f)
    setBusy(false)
    if (u) setUrl(u); else setFileName('')
    e.target.value = ''
  }
  async function go() {
    if (!url.trim()) return
    setBusy(true)
    const ok = await onCreate({
      source_url: url.trim(), source_name: fileName || null, format,
      target_len: len, max_clips: Number(maxClips), captions: true,
      edit_formats: edits, watermark: (watermark || wmDefault).trim() || null,
    })
    setBusy(false)
    if (ok) { setUrl(''); setFileName('') }
  }

  return (
    <>
      <div className="card camp-form">
        <div className="muted tiny" style={{ marginBottom: 8 }}>Drop in a long video — Cadence cuts the best moments into ready-to-post clips.</div>
        <div className="row" style={{ gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Paste a YouTube link or direct video URL" value={fileName ? `Uploaded: ${fileName}` : url} onChange={e => { setUrl(e.target.value); setFileName('') }} disabled={!!fileName} />
          <button className="btn-ghost btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={13} /> Upload</button>
          <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={pickFile} />
        </div>
        <label className="ob-label">Clip format</label>
        <div className="ss-grid">
          {CLIP_FORMAT_LIST.map(f => (
            <button key={f.key} type="button" className={'style-opt' + (format === f.key ? ' on' : '')} onClick={() => setFormat(f.key)}>
              <span><span className="style-name">{f.label}</span><span className="style-desc">{f.desc}</span></span>
            </button>
          ))}
        </div>
        <label className="ob-label">Edit style <span style={{ fontWeight: 400, color: '#9aa1ad' }}>· pick one or more — clips rotate through them</span></label>
        <div className="ss-grid">
          {EDIT_FORMAT_LIST.map(f => (
            <button key={f.key} type="button" className={'style-opt' + (edits.includes(f.key) ? ' on' : '')} onClick={() => toggleEdit(f.key)}>
              <span className={'mini-check' + (edits.includes(f.key) ? ' on' : '')}>{edits.includes(f.key) && <LCheck size={10} strokeWidth={4} />}</span>
              <span><span className="style-name">{f.label}</span><span className="style-desc">{f.desc}</span></span>
            </button>
          ))}
        </div>
        <input className="field" style={{ marginTop: 10 }} placeholder={`Watermark${wmDefault ? ` (default ${wmDefault})` : ' — e.g. @yourhandle'}`} value={watermark} onChange={e => setWatermark(e.target.value)} />
        <div className="row" style={{ gap: 10, marginTop: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 6 }}>
            {[['short', '15–30s'], ['medium', '30–60s']].map(([k, l]) => <button key={k} type="button" className={'chip' + (len === k ? ' on' : '')} onClick={() => setLen(k)}>{l}</button>)}
            <label className="camp-num"><input type="number" min={1} max={5} className="field" value={maxClips} onChange={e => setMaxClips(e.target.value)} /> clips</label>
          </div>
          <button className="btn-primary btn-sm" disabled={busy || !url.trim()} onClick={go}>{busy ? <Loader2 size={13} className="spin" /> : <><Wand2 size={13} /> Make clips</>}</button>
        </div>
      </div>

      {jobs.map(j => (
        <div className="card camp-card" key={j.id} style={{ display: 'block' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="conn-title row" style={{ gap: 7, minWidth: 0 }}>
              {j.source_name || 'Video'}
              <span className={'camp-state' + (j.status === 'done' ? ' on' : '')}>{j.status}</span>
            </div>
            <button className="mini danger" onClick={() => onDelete(j.id)}><Trash2 size={12} /></button>
          </div>
          {(j.status === 'queued' || j.status === 'processing') && <div className="live-status" style={{ marginTop: 6 }}><Loader2 size={11} className="spin" /> {j.status_detail || 'Waiting…'}</div>}
          {j.status === 'failed' && <div className="muted tiny" style={{ marginTop: 6, color: '#c0392b' }}>{j.error}</div>}
          {j.status === 'done' && (
            <div className="clip-grid">
              {(j.clips || []).map((c, i) => (
                <div className="clip-card" key={i}>
                  <video src={c.url} controls preload="metadata" className="clip-vid" />
                  <div style={{ fontWeight: 600, fontSize: 12.5, margin: '6px 0 2px' }}>{c.title}</div>
                  <div className="muted tiny">{c.end - c.start}s{c.edit ? ` · ${(EDIT_FORMAT_LIST.find(f => f.key === c.edit) || {}).label || c.edit}` : ''}{c.caption ? ` · ${c.caption.slice(0, 60)}` : ''}</div>
                  {postable.length > 0 && configured && (
                    <div className="row" style={{ gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                      {postable.map(a => (
                        <button key={a.id} className="chip" style={{ fontSize: 11 }} onClick={() => onPost(j.id, i, [a.id])}>
                          <span className="status-dot" style={{ background: platformDot(a.platform) }} />Post @{a.username}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

// "Ready to post" — AI-drafted posts for this platform, waiting for one-tap
// approval. The heart of each content tab: open the tab, see posts ready to go.
function Suggestions({ platform, drafts, busy, canPost, onGenerate, onPostNow, onSchedule, onDiscard }) {
  return (
    <>
      <div className="conn-sec row" style={{ gap: 7 }}><Sparkles size={13} /> Ready to post
        <button className="mini" style={{ marginLeft: 'auto' }} disabled={busy} onClick={onGenerate}>{busy ? <Loader2 size={11} className="spin" /> : <Wand2 size={11} />} {drafts.length ? 'More' : 'Generate'}</button>
      </div>
      {drafts.length === 0 && <div className="muted tiny" style={{ margin: '0 2px 12px' }}>{busy ? 'Writing…' : 'Generate drafts in your voice.'}</div>}
      <AnimatePresence>{drafts.map(p => (
        <motion.div key={p.id} className="card draft-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} layout>
          <div className="card-body" style={{ whiteSpace: 'pre-wrap' }}>{p.content}</div>
          <div className="dp-actions" style={{ marginTop: 11 }}>
            <button className="icon-btn x" title="Discard" onClick={() => onDiscard(p.id)}><Ex /></button>
            <button className="icon-btn check" title="Schedule" onClick={() => onSchedule(p)}><Check /> <span>Schedule</span></button>
            <button className="btn-primary btn-sm" disabled={!canPost} onClick={() => onPostNow(p.id)}>Post now</button>
          </div>
        </motion.div>
      ))}</AnimatePresence>
    </>
  )
}

// Inspiration accounts — up to 3 public accounts per platform the AI studies
// for what's working. Read-only: nothing to connect or authorize.
function InspirationAccounts({ platform, accounts, onAdd, onRemove }) {
  const [val, setVal] = useState('')
  async function add() { if (!val.trim()) return; const ok = await onAdd(platform, val.trim()); if (ok) setVal('') }
  return (
    <>
      <div className="conn-sec row" style={{ gap: 7 }}><Star size={12} /> Inspiration accounts <span className="muted tiny" style={{ fontWeight: 400 }}>· up to 3 · read-only</span></div>
      {accounts.map(a => (
        <div className="card" key={a.id} style={{ padding: '9px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className="status-dot" style={{ background: platformDot(platform) }} />
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>@{a.handle}</span>
          <button className="mini danger" onClick={() => onRemove(a.id)}><Trash2 size={11} /></button>
        </div>
      ))}
      {accounts.length < 3 && (
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <input className="field" style={{ flex: 1 }} placeholder={`@handle or profile URL`} value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button className="btn-ghost btn-sm" onClick={add}><Plus size={13} /> Add</button>
        </div>
      )}
    </>
  )
}

// Cross-platform brand campaigns — promote a topic in one voice across any mix
// of connected accounts; the engine picks text-post vs carousel per platform.
function CrossCampaignManager({ campaigns, xConns, socialAccounts, onSave, onPatch, onDelete, onRun }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(''); const [topic, setTopic] = useState('')
  const [picked, setPicked] = useState([]); const [hours, setHours] = useState(24)
  const [style, setStyle] = useState('bold'); const [format, setFormat] = useState('listicle'); const [img, setImg] = useState(false)

  // Your personal accounts only: the primary X account + each connected social.
  const primary = xConns.find(c => c.is_primary) || xConns[0]
  const targets = [
    ...(primary ? [{ kind: 'x', id: primary.id, platform: 'x', label: `@${primary.username}` }] : []),
    ...socialAccounts.map(a => ({ kind: 'social', id: a.id, platform: a.platform, label: `@${a.username || a.platform}` })),
  ]
  const has = k => picked.some(p => p.id === k.id)
  const toggle = k => setPicked(s => has(k) ? s.filter(p => p.id !== k.id) : [...s, { kind: k.kind, id: k.id, platform: k.platform }])
  const hasCarousel = picked.some(p => p.platform === 'instagram' || p.platform === 'tiktok')

  async function submit() {
    const ok = await onSave({ name, topic, targets: picked, interval_hours: Number(hours), carousel_style: style, carousel_format: format, include_image: img, active: true })
    if (ok) { setOpen(false); setName(''); setTopic(''); setPicked([]) }
  }

  return (
    <>
      {campaigns.map(c => (
        <div className={'card camp-card' + (c.active ? ' on' : '')} key={c.id} style={{ display: 'block' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="conn-title">{c.name}</div>
              <div className="muted tiny" style={{ marginTop: 2 }}>{c.topic}</div>
              <div className="row" style={{ gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                {(c.targets || []).map((t, i) => <span className="acct-chip" key={i} style={{ fontSize: 11, padding: '3px 8px' }}><span className="status-dot" style={{ background: platformDot(t.platform) }} />{t.platform}</span>)}
              </div>
              {c.status_detail && <div className="muted tiny" style={{ marginTop: 6 }}>{c.running && <Loader2 size={10} className="spin" />} {c.status_detail}</div>}
            </div>
            <Toggle on={!!c.active} onChange={v => onPatch(c.id, { active: v })} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <span className="muted tiny" style={{ marginRight: 'auto' }}>every {c.interval_hours}h</span>
            <button className="mini" onClick={() => onRun(c.id)} disabled={c.running}><Play size={11} /> Run now</button>
            <button className="mini danger" onClick={() => onDelete(c.id)}><Trash2 size={12} /></button>
          </div>
        </div>
      ))}

      {!open
        ? <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center' }} onClick={() => setOpen(true)}><Plus size={14} /> New cross-platform campaign</button>
        : (
        <div className="card camp-form">
          <input className="field" placeholder="Campaign name (e.g. Launch week)" value={name} onChange={e => setName(e.target.value)} />
          <textarea className="field" rows={2} style={{ marginTop: 8 }} placeholder="What to promote — written in your voice" value={topic} onChange={e => setTopic(e.target.value)} />
          <label className="ob-label">Post to these accounts</label>
          {targets.length === 0 && <div className="muted tiny">Connect your accounts first.</div>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {targets.map(k => <button type="button" key={k.id} className={'chip' + (has(k) ? ' on' : '')} onClick={() => toggle(k)}><span className="status-dot" style={{ background: platformDot(k.platform) }} />{k.label}</button>)}
          </div>
          {hasCarousel && (
            <div style={{ marginTop: 10 }}>
              <label className="ob-label">Carousel style (for Instagram/TikTok)</label>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {SLIDE_STYLE_LIST.map(s => <button type="button" key={s.key} className={'sw-chip' + (style === s.key ? ' on' : '')} onClick={() => setStyle(s.key)}><span className="sw" style={{ background: s.swatch.startsWith('linear') ? undefined : s.swatch, backgroundImage: s.swatch.startsWith('linear') ? s.swatch : undefined, color: s.fg }}>Aa</span>{s.label}</button>)}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {SLIDESHOW_FORMATS.map(f => <button type="button" key={f.key} className={'chip' + (format === f.key ? ' on' : '')} onClick={() => setFormat(f.key)}>{f.label}</button>)}
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 12, marginTop: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <label className="camp-num"><input type="number" min={1} className="field" value={hours} onChange={e => setHours(e.target.value)} /> hours between</label>
            <label className="row" style={{ gap: 7, fontSize: 12.5 }}><Toggle on={img} onChange={setImg} /> AI image on text posts</label>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="mini" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={!name.trim() || !topic.trim() || !picked.length} onClick={submit}>Create campaign</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Niche engagement — YOUR account comments on relevant posts in your niche.
// Slim front-end over the engagement_rules engine (keywords + watched accounts
// discovery, replies in voice, approve-first by default).
function EngageManager({ rules, primaryConn, xReadEnabled, posts, onSave, onPatch, onDelete, onRun }) {
  const [open, setOpen] = useState(false)
  const [keywords, setKeywords] = useState(''); const [handles, setHandles] = useState('')
  const [every, setEvery] = useState(24); const [perRun, setPerRun] = useState(3)
  const [autoPost, setAutoPost] = useState(false); const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState(null)
  const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean)
  async function submit() {
    if (!keywords.trim() && !lines(handles).length) return
    setBusy(true)
    const ok = await onSave({
      name: 'Niche engagement',
      target_keywords: keywords.split(',').map(s => s.trim()).filter(Boolean),
      target_handles: lines(handles).slice(0, 3),
      comment_styles: ['add_value'],
      connection_ids: primaryConn ? [primaryConn.id] : [],
      interval_hours: Number(every), replies_per_run: Number(perRun),
      auto_post: autoPost, active: true,
    })
    setBusy(false)
    if (ok !== false) { setOpen(false); setKeywords(''); setHandles('') }
  }
  return (
    <>
      {rules.map(r => {
        const { pending, live } = activityFor(posts, 'engagement_rule_id', r.id)
        const expanded = openId === r.id
        const targets = [
          r.target_handles?.length ? r.target_handles.map(h => '@' + String(h).replace(/^@/, '')).join(' ') : null,
          r.target_keywords?.length ? r.target_keywords.join(', ') : null,
        ].filter(Boolean).join(' · ')
        return (
          <div className={'card camp-card' + (r.active ? ' on' : '')} key={r.id} style={{ display: 'block' }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div className="conn-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{targets || r.name}</div>
                <div className="muted tiny" style={{ marginTop: 2 }}>{r.replies_per_run}/run · every {r.interval_hours}h · {r.auto_post ? 'auto-posts' : 'you approve each'}</div>
              </div>
              <Toggle on={!!r.active} onChange={v => onPatch(r.id, { active: v }, v ? 'Engaging' : 'Paused')} />
            </div>
            <LiveStatus running={r.running} detail={r.status_detail} lastAt={r.last_activity_at} />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <button className="act-toggle" style={{ marginTop: 0, borderTop: 'none', padding: 0, width: 'auto' }} onClick={() => setOpenId(expanded ? null : r.id)}>
                <ChevronDown size={13} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                {live.length} posted · {pending.length} pending
              </button>
              <div className="row" style={{ gap: 6 }}>
                {onRun && <RunNow running={r.running} onRun={() => onRun(r.id)} />}
                <button className="mini danger" onClick={() => onDelete(r.id)}><Trash2 size={12} /></button>
              </div>
            </div>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                  <ActivityList pending={pending} live={live} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
      {open ? (
        <div className="card camp-form">
          <label className="ob-label" style={{ marginTop: 0 }}>Topics / keywords</label>
          <input className="field" placeholder="AI agents, indie hacking" value={keywords} onChange={e => setKeywords(e.target.value)} />
          <label className="ob-label">Accounts to watch <span style={{ fontWeight: 400, color: '#9aa1ad' }}>· up to 3</span></label>
          <textarea className="field" rows={2} placeholder={'@naval\n@sama'} value={handles} onChange={e => setHandles(e.target.value)} />
          {!xReadEnabled && <div className="notice" style={{ marginTop: 8 }}>Needs X read access turned on to find posts.</div>}
          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 10 }}>
              <label className="camp-num"><input type="number" min={1} max={10} className="field" value={perRun} onChange={e => setPerRun(e.target.value)} /> per run</label>
              <label className="camp-num">every <input type="number" min={1} className="field" value={every} onChange={e => setEvery(e.target.value)} /> h</label>
            </div>
            <label className="row" style={{ gap: 7, fontSize: 12.5 }}><Toggle on={autoPost} onChange={setAutoPost} /> auto-post</label>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="mini" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={busy || (!keywords.trim() && !handles.trim())} onClick={submit}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Start'}</button>
          </div>
        </div>
      ) : (
        <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center' }} onClick={() => setOpen(true)}><Plus size={14} /> New engagement</button>
      )}
    </>
  )
}
// Platforms whose APIs don't allow commenting on other people's posts (yet).
const EngageStub = ({ platform }) => <div className="muted tiny" style={{ padding: '2px 2px 6px' }}>Coming soon — {platform} doesn&apos;t let apps comment on others&apos; posts yet.</div>

// ── Feeder agents — an autonomous persona per feeder account. Each one thinks
// on a cadence, posts and replies as ITSELF, quietly backs the primary, and
// evolves its own identity from what it does. ──────────────────────────────────
function FeederAgents({ agents, xConns, posts, onSpawn, onPatch, onDelete, onRun, onReroll }) {
  const feeders = xConns.filter(c => !c.is_primary)
  const [seed, setSeed] = useState({})        // connId -> interests draft
  const [spawning, setSpawning] = useState('') // connId mid-spawn
  const [openId, setOpenId] = useState(null)
  async function spawn(connId) {
    setSpawning(connId)
    const ok = await onSpawn(connId, seed[connId] || '')
    setSpawning('')
    if (ok) setSeed(s => ({ ...s, [connId]: '' }))
  }
  if (!feeders.length) return <div className="muted tiny" style={{ padding: '2px 2px 6px' }}>Agents run on feeder accounts. Connect a second X account (accounts, bottom-right) to deploy one.</div>
  return (
    <>
      {feeders.map(c => {
        const a = agents.find(x => x.x_connection_id === c.id)
        if (!a) return (
          <div className="card camp-card" key={c.id} style={{ display: 'block' }}>
            <div className="conn-title row" style={{ gap: 7 }}><Bot size={14} /> @{c.username} <span className="muted tiny" style={{ fontWeight: 400 }}>· no agent yet</span></div>
            <div className="row" style={{ gap: 8, marginTop: 9 }}>
              <input className="field" style={{ flex: 1 }} placeholder="Its niche (e.g. AI tooling, fitness memes)" value={seed[c.id] || ''} onChange={e => setSeed(s => ({ ...s, [c.id]: e.target.value }))} />
              <button className="btn-primary btn-sm" disabled={spawning === c.id} onClick={() => spawn(c.id)}>{spawning === c.id ? <Loader2 size={13} className="spin" /> : 'Spawn'}</button>
            </div>
          </div>
        )
        const p = a.persona || {}
        const { pending, live } = activityFor(posts, 'feeder_agent_id', a.id)
        const expanded = openId === a.id
        const lastNote = (a.memory || [])[a.memory?.length - 1]?.note
        return (
          <div className={'card camp-card' + (a.active ? ' on' : '')} key={c.id} style={{ display: 'block' }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="conn-title row" style={{ gap: 7 }}><Bot size={14} /> {p.name || a.name || 'Agent'} <span className="muted tiny" style={{ fontWeight: 400 }}>· @{c.username}</span></div>
                <div className="muted tiny" style={{ marginTop: 3 }}>{p.archetype}{p.tone ? ` · ${p.tone}` : ''}</div>
                {lastNote && <div className="agent-note">“{lastNote}”</div>}
              </div>
              <Toggle on={!!a.active} onChange={v => onPatch(a.id, { active: v }, v ? `${p.name || 'Agent'} is live` : `${p.name || 'Agent'} paused`)} />
            </div>
            <LiveStatus running={a.running} detail={a.status_detail} lastAt={a.last_activity_at} />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <button className="act-toggle" style={{ marginTop: 0, borderTop: 'none', padding: 0, width: 'auto' }} onClick={() => setOpenId(expanded ? null : a.id)}>
                <ChevronDown size={13} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                {live.length} posted · {pending.length} pending
              </button>
              <div className="row" style={{ gap: 6 }}>
                <Toggle on={!!a.auto_post} onChange={v => onPatch(a.id, { auto_post: v }, v ? 'Acts on its own' : 'Drafts for your review')} label="autonomous" />
                <RunNow running={a.running} onRun={() => onRun(a.id)} />
                <button className="mini" title="New persona" onClick={() => onReroll(a.id)}><RefreshCw size={12} /></button>
                <button className="mini danger" onClick={() => onDelete(a.id)}><Trash2 size={12} /></button>
              </div>
            </div>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                  <div className="muted tiny" style={{ margin: '8px 0 4px' }}>{p.bio}</div>
                  {(p.opinions || []).slice(0, 3).map((o, i) => <div className="muted tiny" key={i}>· {o}</div>)}
                  <div className="row" style={{ gap: 10, margin: '10px 0 4px', flexWrap: 'wrap' }}>
                    <label className="camp-num"><input type="number" min={0} max={6} className="field" value={a.posts_per_day} onChange={e => onPatch(a.id, { posts_per_day: e.target.value })} /> posts/day</label>
                    <label className="camp-num"><input type="number" min={0} max={12} className="field" value={a.replies_per_day} onChange={e => onPatch(a.id, { replies_per_day: e.target.value })} /> replies/day</label>
                    <label className="camp-num">every <input type="number" min={1} className="field" value={a.interval_hours} onChange={e => onPatch(a.id, { interval_hours: e.target.value })} /> h</label>
                    <label className="row" style={{ gap: 6, fontSize: 12 }}><Toggle on={!!a.support_primary} onChange={v => onPatch(a.id, { support_primary: v })} /> backs your primary</label>
                  </div>
                  <ActivityList pending={pending} live={live} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </>
  )
}

// ── Pricing plan card ──────────────────────────────────────────────────────────
function PlanCard({ plan, interval, currentPlan, seats, setSeats, onChoose, busy }) {
  const per = monthlyEquivalent(plan, interval)
  const isCurrent = currentPlan === plan.key
  const total = plan.perSeat ? Math.round(per * seats) : per
  return (
    <div className={'plan-card card' + (plan.key === 'team' ? ' team' : '') + (isCurrent ? ' current' : '')}>
      <div className="row" style={{ gap: 8 }}>
        <span className="plan-ic">{plan.perSeat ? <Users size={16} /> : <LUser size={16} />}</span>
        <span className="plan-name">{plan.name}</span>
        {isCurrent && <span className="plan-badge">Current</span>}
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{plan.tagline}</div>
      <div className="plan-price">${per}<span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>{plan.unit}</span></div>
      <div className="muted tiny" style={{ minHeight: 16 }}>{interval === 'annual' ? `billed annually — $${plan.annual}${plan.perSeat ? '/seat' : ''}/yr` : plan.perSeat ? `min ${plan.minSeats} seats` : 'billed monthly'}</div>
      {plan.perSeat && (
        <div className="seat-row">
          <span className="muted tiny" style={{ flex: 1 }}>Seats</span>
          <div className="stepper">
            <button onClick={() => setSeats(s => Math.max(plan.minSeats, s - 1))} disabled={seats <= plan.minSeats}>−</button>
            <span>{seats}</span>
            <button onClick={() => setSeats(s => Math.min(plan.maxSeats || 50, s + 1))}>+</button>
          </div>
          <span className="plan-total">${total}/mo</span>
        </div>
      )}
      <ul className="plan-feats">{plan.features.map((f, i) => <li key={i}><LCheck size={14} strokeWidth={3} /> {f}</li>)}</ul>
      <button className={isCurrent ? 'btn-ghost' : 'btn-primary'} style={{ width: '100%', padding: 12, marginTop: 'auto' }} disabled={busy} onClick={() => onChoose(plan)}>
        {isCurrent ? 'Manage subscription' : `Choose ${plan.name}`}
      </button>
    </div>
  )
}

// ── Account page — full-screen profile / accounts / billing / pricing ───────────
function AccountPage({ me, session, accountTab, setAccountTab, authed, banner, photos, onUploadPhoto, onDeletePhoto, persona, analyzing, onAnalyze, xConns, connected, onConnectX, onDisconnectX, onMakePrimary, socialConfigured, socialAccounts, onConnectSocial, liSelf, liMentors, onAddLinkedIn, onRemoveLinkedIn, onPortal, onCheckout, onReload, onClose }) {
  const p = me?.profile || {}
  const [name, setName] = useState(p.full_name || '')
  const [role, setRole] = useState(p.role || '')
  const [goals, setGoals] = useState(p.goals || '')
  const [tz, setTz] = useState(p.timezone || 'America/Los_Angeles')
  const [hour, setHour] = useState(p.default_post_hour ?? 9)
  const [imgDefault, setImgDefault] = useState(!!p.include_image_default)
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false)
  const [interval, setIntervalSel] = useState(me?.planInterval === 'annual' ? 'annual' : 'monthly')
  const [teamSeats, setTeamSeats] = useState(Math.max(me?.seats || PLANS.team.minSeats, PLANS.team.minSeats))
  const billingOn = !!me?.billingConfigured
  const isPro = p.is_pro || !billingOn
  const planKey = me?.plan && PLANS[me.plan] ? me.plan : null
  const initials = (p.full_name || session.user.email || '?').trim()[0]?.toUpperCase()
  const stats = me?.stats || {}
  const liAcct = socialAccounts.find(a => a.platform === 'linkedin')
  const igtk = socialAccounts.filter(a => ['instagram', 'tiktok'].includes(a.platform))

  async function save() {
    setBusy(true)
    await authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ full_name: name, role, goals, timezone: tz, default_post_hour: Number(hour), include_image_default: imgDefault }) })
    setBusy(false); setSaved(true); setTimeout(() => setSaved(false), 1800); onReload && onReload()
  }
  function chooseplan(plan) {
    // Any active subscriber manages plan changes in the portal — a second
    // checkout would create a second live subscription.
    if (planKey === plan.key || (billingOn && p.is_pro)) return onPortal()
    onCheckout(plan.key, interval, plan.perSeat ? teamSeats : 1)
  }

  const TABS = [['profile', 'Profile', LUser], ['accounts', 'Accounts', Users], ['billing', 'Billing', CreditCard], ['pricing', 'Pricing', Crown]]

  return (
    <motion.div className="acctpage" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <header className="acct-top">
        <button className="btn-ghost row" style={{ gap: 7 }} onClick={onClose}><ArrowLeft size={16} /> Back</button>
        <span className="wordmark" style={{ fontSize: 18 }}>Account</span>
        <span style={{ width: 78 }} />
      </header>
      {banner && <div className="banner" style={{ margin: '10px 20px 0' }}>{banner}</div>}
      <div className="acct-tabstrip">
        {TABS.map(([k, l, Ic]) => (
          <button key={k} className={'acct-navbtn' + (accountTab === k ? ' on' : '')} onClick={() => setAccountTab(k)} style={{ width: 'auto' }}><Ic size={15} /> {l}</button>
        ))}
      </div>
      <div className="acct-wrap">
        <nav className="acct-nav">
          <div className="acct-id">
            <span className="acct-avatar">{initials}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || 'Your account'}</div>
              <div className="muted tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.email}</div>
            </div>
          </div>
          {TABS.map(([k, l, Ic]) => (
            <button key={k} className={'acct-navbtn' + (accountTab === k ? ' on' : '')} onClick={() => setAccountTab(k)}>
              <Ic size={16} /> {l}
            </button>
          ))}
          <div style={{ marginTop: 'auto' }}>
            <button className="acct-navbtn" onClick={() => supabase.auth.signOut()}><LX size={16} /> Sign out</button>
          </div>
        </nav>

        <div className="acct-content">
          {accountTab === 'profile' && (
            <div className="acct-sec-wrap">
              <h2 className="acct-h">Personal information</h2>
              <div className="card acct-card">
                <label className="ob-label">Name</label>
                <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Founder" />
                <label className="ob-label">What you do</label>
                <input className="field" value={role} onChange={e => setRole(e.target.value)} placeholder="Building an AI startup" />
                <label className="ob-label">What you want from social</label>
                <textarea className="field" rows={2} value={goals} onChange={e => setGoals(e.target.value)} placeholder="Grow an audience of founders & investors" />
                <label className="ob-label">Email</label>
                <input className="field" value={session.user.email} disabled />
              </div>

              <h2 className="acct-h">Posting defaults</h2>
              <div className="card acct-card">
                <div className="set-row"><span>Timezone</span><select className="field set-input" value={tz} onChange={e => setTz(e.target.value)}>{TZS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></div>
                <div className="set-row"><span>Default post time</span><select className="field set-input" value={hour} onChange={e => setHour(e.target.value)}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{((h % 12) || 12) + (h < 12 ? ' AM' : ' PM')}</option>)}</select></div>
                <div className="set-row"><span>Attach an AI image by default</span><Toggle on={imgDefault} onChange={setImgDefault} /></div>
              </div>

              <h2 className="acct-h">Your voice</h2>
              <div className="card acct-card">
                {persona
                  ? <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="muted tiny" style={{ marginBottom: 4 }}>{persona.tone}</div>
                        <div className="persona-summary">{persona.summary}</div>
                      </div>
                      <button className="mini" disabled={analyzing} onClick={onAnalyze}>{analyzing ? '…' : 'Re-analyze'}</button>
                    </div>
                  : <div className="row" style={{ gap: 12, justifyContent: 'space-between' }}>
                      <span className="muted tiny" style={{ flex: 1 }}>Cadence reads your connected accounts to learn how you write, so posts sound like you.</span>
                      <button className="btn-primary btn-sm" disabled={analyzing} onClick={onAnalyze}>{analyzing ? '…' : 'Analyze my voice'}</button>
                    </div>}
              </div>

              <h2 className="acct-h">Your photos <span className="muted tiny" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· 5–10 selfies for AI images of you</span></h2>
              <div className="card acct-card">
                <div className="photo-grid">
                  {photos.map(ph => (
                    <div className="photo-cell" key={ph.id}><img src={ph.url} alt="" /><button className="photo-del" onClick={() => onDeletePhoto(ph.id)}><LX size={12} /></button></div>
                  ))}
                  {photos.length < 10 && <label className="photo-add"><Upload size={16} /><input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.target.value = '' }} /></label>}
                </div>
                <div className="muted tiny" style={{ marginTop: 8 }}>{photos.length}/10 uploaded. Used when you turn on “Feature me” on a post image.</div>
              </div>

              <div className="acct-save" style={{ justifyContent: 'space-between' }}>
                <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
                <button className="btn-primary" disabled={busy} onClick={save}>{busy ? <span className="dots"><i/><i/><i/></span> : saved ? 'Saved ✓' : 'Save changes'}</button>
              </div>
            </div>
          )}

          {accountTab === 'accounts' && (
            <div className="acct-sec-wrap">
              <h2 className="acct-h">X accounts</h2>
              {xConns.map(c => (
                <div className={'conn-card card' + (c.is_primary ? ' primary' : '')} key={c.id}>
                  <div className="conn-icon x-icon"><XGlyph /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="conn-title row" style={{ gap: 6 }}>@{c.username}
                      {c.is_primary ? <span className="role-badge primary"><Star size={9} fill="currentColor" /> Primary</span> : <span className="role-badge">Feeder</span>}
                      {c.needs_reconnect && <span className="role-badge" style={{ background: '#fbe6d4', color: '#b9540a' }}>Reconnect</span>}
                    </div>
                  </div>
                  {c.needs_reconnect && <button className="mini accent" onClick={onConnectX}>Reconnect</button>}
                  {!c.is_primary && <button className="mini" onClick={() => onMakePrimary(c.id)}>Make primary</button>}
                  <button className="mini danger" onClick={() => onDisconnectX(c.id)}>Disconnect</button>
                </div>
              ))}
              <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', marginBottom: 18 }} onClick={onConnectX}><Plus size={14} /> {connected ? 'Add another X account' : 'Connect X'}</button>

              <h2 className="acct-h">Instagram & TikTok</h2>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                {igtk.map(a => <span className="acct-chip" key={a.id}><span className="status-dot" style={{ background: platformDot(a.platform) }} />{a.username || a.platform}</span>)}
                <button className="chip" disabled={!socialConfigured} onClick={() => onConnectSocial('instagram')}><Plus size={11} /> Instagram</button>
                <button className="chip" disabled={!socialConfigured} onClick={() => onConnectSocial('tiktok')}><Plus size={11} /> TikTok</button>
              </div>

              <h2 className="acct-h">LinkedIn</h2>
              <div className="card acct-card">
                <div className="conn-sec" style={{ marginTop: 0 }}>Publish to LinkedIn</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                  {socialAccounts.filter(a => a.platform === 'linkedin').map(a => <span className="acct-chip" key={a.id}><span className="status-dot" style={{ background: platformDot('linkedin') }} />{a.username || 'LinkedIn'}</span>)}
                  <button className="chip" disabled={!socialConfigured} onClick={() => onConnectSocial('linkedin')}><Plus size={11} /> {liAcct ? 'Reconnect' : 'Connect'}</button>
                </div>
                <div className="conn-sec">Your voice source <span className="muted tiny" style={{ fontWeight: 400 }}>· your own LinkedIn</span></div>
                <LinkedInSlot account={liSelf[0]} onAdd={(url) => onAddLinkedIn(url, false)} onRemove={onRemoveLinkedIn} self />
                <div className="conn-sec row" style={{ gap: 7 }}><Star size={12} /> Inspiration <span className="muted tiny" style={{ fontWeight: 400 }}>· up to 3, read-only</span></div>
                {[0, 1, 2].map(i => <LinkedInSlot key={i} account={liMentors[i]} onAdd={(url) => onAddLinkedIn(url, true)} onRemove={onRemoveLinkedIn} />)}
              </div>
            </div>
          )}

          {accountTab === 'billing' && (
            <div className="acct-sec-wrap">
              <h2 className="acct-h">Your plan</h2>
              <div className="card acct-card">
                {!billingOn ? (
                  <div>
                    <div className="row" style={{ gap: 9, marginBottom: 6 }}><span className="pro-pill"><Crown size={12} /> All features unlocked</span></div>
                    <div className="muted tiny">Billing isn’t configured on this instance yet, so every feature is on. Add Stripe keys on the server to turn on plans.</div>
                  </div>
                ) : isPro ? (
                  <div>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div className="row" style={{ gap: 9 }}>
                          <span className="pro-pill"><Crown size={12} /> {planKey ? PLANS[planKey].name : 'Pro'}</span>
                          {me?.seats > 1 && <span className="role-badge">{me.seats} seats</span>}
                        </div>
                        <div className="muted tiny" style={{ marginTop: 8 }}>
                          {me?.planInterval === 'annual' ? 'Billed annually' : 'Billed monthly'}{me?.periodEnd ? ` · renews ${fmt(me.periodEnd)}` : ''}
                        </div>
                      </div>
                      <button className="btn-ghost btn-sm" onClick={onPortal}>Manage</button>
                    </div>
                  </div>
                ) : (
                  <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                    <div><div style={{ fontWeight: 700 }}>Free</div><div className="muted tiny">Upgrade to unlock auto-posting, AI images, voice & campaigns.</div></div>
                    <button className="btn-primary btn-sm" onClick={() => setAccountTab('pricing')}>See plans</button>
                  </div>
                )}
              </div>

              <h2 className="acct-h">Usage</h2>
              <div className="stat-tiles" style={{ margin: 0 }}>
                <div className="stat-tile"><div className="stat-num">{fmtNum(stats.posted || 0)}</div><div className="stat-lbl">Posted</div></div>
                <div className="stat-tile"><div className="stat-num">{fmtNum(stats.queued || 0)}</div><div className="stat-lbl">Queued</div></div>
                <div className="stat-tile"><div className="stat-num">{fmtNum(xConns.length + socialAccounts.length)}</div><div className="stat-lbl">Accounts</div></div>
              </div>
              {billingOn && (
                <div style={{ marginTop: 18 }}><button className="btn-ghost" onClick={onPortal}><CreditCard size={14} style={{ marginRight: 7, verticalAlign: 'middle' }} />Payment methods & invoices</button></div>
              )}
            </div>
          )}

          {accountTab === 'pricing' && (
            <div className="acct-sec-wrap">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <h2 className="acct-h" style={{ margin: 0 }}>Choose your plan</h2>
                <div className="seg">
                  {[['monthly', 'Monthly'], ['annual', 'Annual · save 20%']].map(([k, l]) => (
                    <button key={k} className={'seg-btn' + (interval === k ? ' on' : '')} onClick={() => setIntervalSel(k)}>
                      {interval === k && <motion.span layoutId="bill-pill" className="seg-pill" transition={spring} />}
                      <span style={{ position: 'relative', zIndex: 1 }}>{l}</span>
                    </button>
                  ))}
                </div>
              </div>
              {!billingOn && <div className="notice" style={{ margin: '12px 0 4px' }}>Billing isn’t live on this instance yet — these are the plans that will be offered once Stripe is connected. Every feature is currently unlocked.</div>}
              <div className="plan-grid">
                {PLAN_LIST.map(plan => (
                  <PlanCard key={plan.key} plan={plan} interval={interval} currentPlan={planKey} seats={teamSeats} setSeats={setTeamSeats} onChoose={chooseplan} busy={false} />
                ))}
              </div>
              <div className="muted tiny" style={{ textAlign: 'center', marginTop: 16 }}>Prices in USD. Cancel anytime · taxes may apply at checkout.</div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────
function App({ session }) {
  const token = session.access_token
  const authed = useCallback((path, opts = {}) => fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } }), [token])

  const [tab, setTab] = useState('queue')
  const [posts, setPosts] = useState([]); const [xConns, setXConns] = useState([])
  const [liSelf, setLiSelf] = useState([]); const [liMentors, setLiMentors] = useState([]); const [liPosts, setLiPosts] = useState([])
  const [photos, setPhotos] = useState([])
  const [engRules, setEngRules] = useState([])
  const [socialAccounts, setSocialAccounts] = useState([]); const [socialConfigured, setSocialConfigured] = useState(false)
  const [slideshows, setSlideshows] = useState([])
  const [engSettings, setEngSettings] = useState([]); const [socialReplies, setSocialReplies] = useState([])
  const [qPlatform, setQPlatform] = useState('all')
  const [brandCampaigns, setBrandCampaigns] = useState([])
  const [inspoX, setInspoX] = useState([]); const [suggesting, setSuggesting] = useState('')
  const [clipJobs, setClipJobs] = useState([]); const [igMode, setIgMode] = useState('carousels')
  const [me, setMe] = useState(null)
  const [messages, setMessages] = useState([]); const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false); const [banner, setBanner] = useState('')
  const [compose, setCompose] = useState(null); const [composeBusy, setComposeBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [account, setAccount] = useState(null) // null | { tab: 'profile'|'accounts'|'billing'|'pricing' }
  const [xConnect, setXConnect] = useState(false)
  const [xStats, setXStats] = useState(null)
  const [chatScope, setChatScope] = useState([]) // [] = all platforms
  const [feederAgents, setFeederAgents] = useState([])
  const inputRef = useRef(null); const bottomRef = useRef(null)

  const loadQueue = useCallback(async () => { const { data } = await supabase.from('posts').select('*').order('scheduled_for', { ascending: true }).limit(300); if (data) setPosts(data) }, [])
  const loadX = useCallback(async () => { const r = await authed('/api/x/status'); const d = await r.json(); setXConns(d.connections || []) }, [authed])
  const loadLinkedIn = useCallback(async () => { const r = await authed('/api/linkedin'); const d = await r.json(); setLiSelf(d.self || []); setLiMentors(d.mentors || []); setLiPosts(d.posts || []) }, [authed])
  const loadMe = useCallback(async () => { const r = await authed('/api/me'); const d = await r.json(); setMe(d) }, [authed])
  const loadPhotos = useCallback(async () => { const r = await authed('/api/photos'); const d = await r.json(); setPhotos(d.photos || []) }, [authed])
  const loadEngagement = useCallback(async () => { const r = await authed('/api/engagement'); const d = await r.json(); setEngRules(d.rules || []) }, [authed])
  const loadSocial = useCallback(async (sync) => { const r = await authed(`/api/social${sync ? '?sync=1' : ''}`); const d = await r.json(); setSocialAccounts(d.accounts || []); setSocialConfigured(!!d.configured) }, [authed])
  const loadSlideshows = useCallback(async () => { const r = await authed('/api/slideshow'); const d = await r.json(); setSlideshows(d.slideshows || []) }, [authed])
  const loadSocialEng = useCallback(async () => { const r = await authed('/api/social-engagement'); const d = await r.json(); setEngSettings(d.settings || []); setSocialReplies(d.replies || []) }, [authed])
  const loadBrand = useCallback(async () => { const r = await authed('/api/brand-campaigns'); const d = await r.json(); setBrandCampaigns(d.campaigns || []) }, [authed])
  const loadInspoX = useCallback(async () => { const r = await authed('/api/inspiration?platform=x'); const d = await r.json(); setInspoX(d.accounts || []) }, [authed])
  const loadClips = useCallback(async () => { const r = await authed('/api/clips'); const d = await r.json(); setClipJobs(d.jobs || []) }, [authed])
  // In-flight guard: rapid tab toggles must not stack concurrent paid X reads.
  const xStatsBusy = useRef(false)
  const loadXStats = useCallback(async () => {
    if (xStatsBusy.current) return
    xStatsBusy.current = true
    try { const r = await authed('/api/x/stats'); const d = await r.json(); if (d.stats) setXStats(d.stats) }
    catch {} finally { xStatsBusy.current = false }
  }, [authed])
  const loadAgents = useCallback(async () => { const r = await authed('/api/feeder-agents'); const d = await r.json(); setFeederAgents(d.agents || []) }, [authed])

  useEffect(() => { loadQueue(); loadX(); loadLinkedIn(); loadMe(); loadPhotos(); loadEngagement(); loadSocial(); loadSlideshows(); loadSocialEng(); loadBrand(); loadInspoX(); loadClips(); loadAgents() }, [loadQueue, loadX, loadLinkedIn, loadMe, loadPhotos, loadEngagement, loadSocial, loadSlideshows, loadSocialEng, loadBrand, loadInspoX, loadClips, loadAgents])

  // Poll clip jobs while any is queued/processing so progress streams in live.
  useEffect(() => {
    if (!clipJobs.some(j => j.status === 'queued' || j.status === 'processing')) return
    const t = setInterval(loadClips, 3000)
    return () => clearInterval(t)
  }, [clipJobs, loadClips])

  // Returning from a Zernio account-link (Zernio redirects to /?connected=<platform>):
  // land the user back on Slideshows, pull in the freshly connected account, and tidy the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    if (!connected) return
    setTab(connected === 'linkedin' ? 'linkedin' : 'social')
    loadSocial(true).then(() => setBanner(`${connected[0].toUpperCase() + connected.slice(1)} connected`))
    window.history.replaceState({}, '', window.location.pathname)
  }, [loadSocial])

  // While any campaign, rule, or agent is mid-run, keep its live status fresh.
  const anyRunning = brandCampaigns.some(c => c.running) || engRules.some(r => r.running) || feederAgents.some(a => a.running)
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => { loadBrand(); loadEngagement(); loadAgents() }, 2000)
    return () => clearInterval(t)
  }, [anyRunning, loadBrand, loadEngagement, loadAgents])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('x') === 'connected') { setBanner(`Connected @${q.get('handle') || 'your X account'}`); loadX() }
    else if (q.get('x') === 'denied') setBanner('X connection cancelled.')
    else if (q.get('x')) setBanner('Couldn\'t connect to X. Try again.')
    if (q.get('billing') === 'success') { setBanner('Welcome to Pro'); loadMe() }
    if (q.get('x') || q.get('billing')) window.history.replaceState({}, '', '/')
  }, [loadX, loadMe])
  useEffect(() => { if (!banner) return; const t = setTimeout(() => setBanner(''), 4500); return () => clearTimeout(t) }, [banner])

  // Pull live X account stats (followers etc.) when the X tab is open.
  useEffect(() => { if (tab === 'x' && xConns.length) loadXStats() }, [tab, xConns.length, loadXStats])
  // The chat follows the active tab onto a platform focus — but a HAND-PICKED
  // selection survives tab switches (auto-sync resumes after "All").
  const scopeDirty = useRef(false)
  useEffect(() => {
    if (scopeDirty.current) return
    setChatScope(tab === 'x' ? ['x'] : tab === 'linkedin' ? ['linkedin'] : tab === 'social' ? ['instagram', 'tiktok'] : [])
  }, [tab])
  function toggleScope(k) {
    if (k === 'all') { scopeDirty.current = false; return setChatScope([]) }
    scopeDirty.current = true
    setChatScope(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k])
  }

  const connected = xConns.length > 0
  const isPro = me?.profile?.is_pro || (me && !me.billingConfigured)
  const defaultHour = me?.profile?.default_post_hour ?? 9
  const imgDefault = !!me?.profile?.include_image_default
  const drafts = posts.filter(p => p.status === 'draft')
  const xDrafts = drafts.filter(p => (p.platform || 'x') === 'x')
  const liDrafts = drafts.filter(p => p.platform === 'linkedin')
  const queue = posts.filter(p => p.status !== 'draft' && p.status !== 'posted')
  const posted = posts.filter(p => p.status === 'posted').sort((a, b) => new Date(b.posted_at || b.scheduled_for) - new Date(a.posted_at || a.scheduled_for))
  const collapseQueue = queue.length > 4
  const hasPhotos = photos.length > 0

  // Per-platform campaigns: a brand campaign "belongs" to a tab when every one of
  // its targets is on that tab's platform(s). The Campaigns tab keeps the full
  // cross-platform view.
  const campPlatforms = c => [...new Set((c.targets || []).map(t => t.platform))]
  const campsFor = plats => brandCampaigns.filter(c => (c.targets?.length) && campPlatforms(c).every(p => plats.includes(p)))
  // Cross-platform campaigns also post to a tab's platform without "belonging"
  // to it — the badge and a hint reflect them so the tab never lies about
  // something actively publishing there.
  const campsTouching = plats => brandCampaigns.filter(c => (c.targets || []).some(t => plats.includes(t.platform)))
  const CrossCampHint = ({ plats }) => {
    const extra = campsTouching(plats).length - campsFor(plats).length
    return extra > 0 ? <div className="muted tiny" style={{ padding: '6px 2px 0' }}>{extra} cross-platform campaign{extra > 1 ? 's' : ''} also post{extra > 1 ? '' : 's'} here — manage in Campaigns.</div> : null
  }
  const primaryX = xConns.find(c => c.is_primary) || xConns[0]
  const liAccount = socialAccounts.find(a => a.platform === 'linkedin')
  const xCampTargets = primaryX ? [{ kind: 'x', id: primaryX.id, platform: 'x', label: '@' + primaryX.username }] : []
  const liCampTargets = liAccount ? [{ kind: 'social', id: liAccount.id, platform: 'linkedin', label: '@' + (liAccount.username || 'LinkedIn') }] : []
  const igtkCampTargets = socialAccounts.filter(a => ['instagram', 'tiktok'].includes(a.platform)).map(a => ({ kind: 'social', id: a.id, platform: a.platform, label: '@' + (a.username || a.platform) }))

  // Opens a short guide first — X authorizes whichever account is active on x.com,
  // and OAuth 2.0 has no force-login, so we let the user switch accounts before authorizing.
  function connectX() { setXConnect(true) }
  async function startXConnect() { setXConnect(false); const r = await authed('/api/x/connect', { method: 'POST' }); const d = await r.json(); if (d.url) window.location.href = d.url; else setBanner(d.error || 'Could not start X connection.') }
  async function disconnectX(id) { const target = id || xConns[0]?.id; if (!target) return; if (!confirm('Disconnect this X account? Its scheduled posts will stop publishing.')) return; await authed('/api/x/status', { method: 'DELETE', body: JSON.stringify({ id: target }) }); setBanner('Disconnected X account'); loadX() }
  async function makePrimary(id) { await authed('/api/x/status', { method: 'PATCH', body: JSON.stringify({ id, is_primary: true }) }); setBanner('Primary account updated'); loadX() }

  // "Run now" — trigger one campaign/rule and poll its live status until it
  // finishes, so the user watches it work. The engine writes status_detail at
  // each step; we reload until running flips back to false.
  async function runEngagementNow(id) {
    setBanner('Running engagement…'); loadEngagement()
    const poll = setInterval(loadEngagement, 1400)
    try { await authed('/api/engagement', { method: 'POST', body: JSON.stringify({ action: 'run', id }) }) } finally { clearInterval(poll); loadEngagement(); loadQueue() }
  }
  async function openPortal() { const r = await authed('/api/stripe/portal', { method: 'POST' }); const d = await r.json(); if (d.url) window.location.href = d.url; else setBanner(d.error || 'Billing portal unavailable.') }


  // Engagement rules
  async function saveEngagement(payload) {
    const r = await authed('/api/engagement', { method: 'POST', body: JSON.stringify(payload) })
    const d = await r.json()
    if (d.error) setBanner(d.error)
    else { setBanner(payload.active ? 'Engagement agent running' : 'Engagement rule saved'); loadEngagement(); if (payload.active) setTimeout(loadQueue, 2500) }
    return !d.error
  }
  async function patchEngagement(id, patch, note) {
    await authed('/api/engagement', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) })
    if (note) setBanner(note); loadEngagement(); loadQueue(); if (patch.active) setTimeout(loadQueue, 2500)
  }
  async function deleteEngagement(id) { if (!confirm('Delete this engagement rule?')) return; await authed('/api/engagement', { method: 'DELETE', body: JSON.stringify({ id }) }); loadEngagement(); loadQueue() }

  // Feeder agents
  async function spawnAgent(connId, interests) {
    const r = await authed('/api/feeder-agents', { method: 'POST', body: JSON.stringify({ x_connection_id: connId, interests }) })
    const d = await r.json()
    if (d.error) { setBanner(d.error); return false }
    setBanner(`“${d.agent?.name || 'Agent'}” is ready — flip it on when you are`); loadAgents(); return true
  }
  async function patchAgent(id, patch, note) { await authed('/api/feeder-agents', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) }); if (note) setBanner(note); loadAgents(); loadQueue() }
  async function deleteAgent(id) { if (!confirm('Delete this agent and its unpublished posts?')) return; await authed('/api/feeder-agents', { method: 'DELETE', body: JSON.stringify({ id }) }); loadAgents(); loadQueue() }
  async function runAgent(id) {
    setBanner('Agent thinking…'); loadAgents()
    const poll = setInterval(loadAgents, 1500)
    try { await authed('/api/feeder-agents', { method: 'POST', body: JSON.stringify({ action: 'run', id }) }) } finally { clearInterval(poll); loadAgents(); loadQueue() }
  }
  async function rerollAgent(id) {
    setBanner('Reinventing the persona…')
    const r = await authed('/api/feeder-agents', { method: 'POST', body: JSON.stringify({ action: 'reroll', id }) }); const d = await r.json()
    setBanner(d.error || `Meet “${d.agent?.name}”`); loadAgents()
  }

  // Social (Instagram/TikTok/LinkedIn via Zernio)
  async function connectSocial(platform) {
    const r = await authed('/api/social', { method: 'POST', body: JSON.stringify({ action: 'connect', platform }) })
    const d = await r.json()
    if (d.authUrl) { window.location.href = d.authUrl } // full-page redirect; Zernio returns the user to /?connected=<platform>
    else setBanner(d.error || 'Could not start connection')
  }
  async function syncSocial() { setBanner('Refreshing connected accounts…'); await loadSocial(true) }
  // The single auto-reply toggle promises approve-first, so enabling it also
  // clears any legacy auto_post=true left by the old two-toggle UI.
  async function toggleReplies(platform, patch) { await authed('/api/social-engagement', { method: 'PATCH', body: JSON.stringify({ platform, ...patch, ...(patch.enabled !== undefined ? { auto_post: false } : {}) }) }); loadSocialEng() }
  async function runReplies(platform) {
    setBanner(`Checking ${platform} comments…`)
    const r = await authed('/api/social-engagement', { method: 'POST', body: JSON.stringify({ action: 'run', platform }) }); const d = await r.json()
    setBanner(d.error ? d.error : d.skipped ? `${platform}: ${d.skipped}` : `${platform}: ${d.posted || 0} posted, ${d.drafted || 0} drafted`); loadSocialEng()
  }
  async function postReplyDraft(id) { const r = await authed('/api/social-engagement', { method: 'POST', body: JSON.stringify({ action: 'post-draft', id }) }); const d = await r.json(); setBanner(d.error || 'Reply posted'); loadSocialEng() }
  async function saveBrand(payload) { const r = await authed('/api/brand-campaigns', { method: 'POST', body: JSON.stringify(payload) }); const d = await r.json(); if (d.error) { setBanner(d.error); return false } setBanner('Campaign created'); loadBrand(); return true }
  async function patchBrand(id, patch) { await authed('/api/brand-campaigns', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) }); loadBrand() }
  async function deleteBrand(id) { await authed('/api/brand-campaigns', { method: 'DELETE', body: JSON.stringify({ id }) }); loadBrand() }
  async function runBrand(id) {
    setBanner('Running campaign across your accounts…'); loadBrand()
    const poll = setInterval(loadBrand, 1500) // stream per-target status_detail
    try {
      const r = await authed('/api/brand-campaigns', { method: 'POST', body: JSON.stringify({ action: 'run', id }) }); const d = await r.json()
      setBanner(d.error ? d.error : `Posted across ${d.done || 0} account${d.done === 1 ? '' : 's'}`)
    } finally { clearInterval(poll); loadBrand(); loadQueue(); loadSlideshows() }
  }
  async function suggestPosts(platform) {
    setSuggesting(platform)
    const r = await authed('/api/suggest', { method: 'POST', body: JSON.stringify({ platform, n: 3 }) }); const d = await r.json()
    setSuggesting('')
    if (d.error) setBanner(d.error); else { setBanner(`${d.posts?.length || 0} ${platform === 'x' ? 'X' : 'LinkedIn'} posts ready to approve`); loadQueue() }
  }
  async function addInspo(platform, handle) {
    const r = await authed('/api/inspiration', { method: 'POST', body: JSON.stringify({ platform, handle }) }); const d = await r.json()
    if (d.error) { setBanner(d.error); return false }
    loadInspoX(); return true
  }
  async function removeInspo(id) { await authed('/api/inspiration', { method: 'DELETE', body: JSON.stringify({ id }) }); loadInspoX() }
  // Approve a LinkedIn suggestion for the next default posting hour (simplest
  // schedule path; it lands in the Queue where the time can still be edited).
  async function scheduleLinkedInDraft(p) {
    const when = defaultWhen(defaultHour)
    await authed('/api/posts', { method: 'PATCH', body: JSON.stringify({ id: p.id, content: p.content, scheduledFor: new Date(when).toISOString(), status: 'queued' }) })
    setBanner(`Scheduled for ${fmt(new Date(when).toISOString())} — edit the time in Queue`); loadQueue()
  }
  // Clips
  async function createClipJob(payload) {
    const r = await authed('/api/clips', { method: 'POST', body: JSON.stringify(payload) }); const d = await r.json()
    if (d.error) { setBanner(d.error); return false }
    setBanner('Clipping started — watch progress below'); loadClips(); return true
  }
  async function uploadClipFile(file) {
    setBanner('Uploading video…')
    const fd = new FormData(); fd.append('file', file)
    // Raw fetch: letting the browser set the multipart boundary (authed forces JSON).
    const r = await fetch('/api/clips/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
    const d = await r.json()
    if (d.error) { setBanner(d.error); return null }
    setBanner('Uploaded — ready to clip'); return d.url
  }
  async function deleteClipJob(id) { if (!confirm('Delete this clip job and its clips?')) return; await authed('/api/clips', { method: 'DELETE', body: JSON.stringify({ id }) }); loadClips() }
  async function postClip(job_id, clip_index, account_ids) {
    setBanner('Posting clip…')
    const r = await authed('/api/clips', { method: 'POST', body: JSON.stringify({ action: 'post', job_id, clip_index, account_ids }) }); const d = await r.json()
    setBanner(d.error || 'Clip posted')
  }
  async function deleteSlideshow(id) { if (!confirm('Delete this slideshow?')) return; await authed('/api/slideshow', { method: 'DELETE', body: JSON.stringify({ id }) }); loadSlideshows() }
  async function generateSlideshow(payload) {
    const r = await authed('/api/slideshow/generate', { method: 'POST', body: JSON.stringify(payload) })
    const d = await r.json()
    if (d.error) setBanner(d.error)
    return d
  }
  async function saveSlideshow(payload) {
    const r = await authed('/api/slideshow', { method: 'POST', body: JSON.stringify(payload) })
    const d = await r.json()
    if (d.error) setBanner(d.error)
    else { setBanner(payload.action === 'schedule' ? (payload.scheduled_for ? 'Slideshow scheduled' : 'Slideshow posted') : 'Slideshow saved'); loadSlideshows() }
    return !d.error
  }

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
    if (r.status === 402) return setAccount('pricing')
    if (d.error) setBanner(d.error); else { setBanner('Voice profile updated'); loadMe() }
  }
  function openNew() { setCompose({ mode: 'new', platform: 'x', content: '', when: defaultWhen(defaultHour), imgOn: imgDefault, img: '', connId: xConns[0]?.id || '', personal: false }) }
  function openSchedule(p) { setCompose({ mode: p.status === 'draft' ? 'draft' : 'edit', id: p.id, platform: p.platform || 'x', content: p.content, when: toLocalInput(new Date(p.scheduled_for)), imgOn: !!p.image_url, img: p.image_url || '', connId: p.x_connection_id || xConns[0]?.id || '', personal: false }) }
  async function saveEdit(id, content) { await authed('/api/posts', { method: 'PATCH', body: JSON.stringify({ id, content }) }); loadQueue() }
  async function composeGenImg() {
    setCompose(c => ({ ...c, imgBusy: true }))
    const r = await authed('/api/image', { method: 'POST', body: JSON.stringify({ prompt: compose.content || 'social post', fromContent: true, personal: !!compose.personal, seed: Math.floor(Math.random() * 1e5) }) })
    const d = await r.json(); setCompose(c => c ? { ...c, img: d.url || '', imgBusy: false } : c)
  }
  async function saveCompose(postNow) {
    const c = (compose.content || '').trim(); if (!c || c.length > capFor(compose)) return
    setComposeBusy(true)
    try {
      let id = compose.id; const iso = new Date(compose.when).toISOString(); const imageUrl = compose.imgOn ? compose.img : null
      if ((compose.mode === 'edit' || compose.mode === 'draft') && id) {
        const r = await authed('/api/posts', { method: 'PATCH', body: JSON.stringify({ id, content: c, scheduledFor: iso, status: 'queued', imageUrl, xConnectionId: compose.connId || null }) })
        const d = await r.json(); if (!r.ok || d.error) { setBanner(d.error || 'Could not save.'); return }
      } else {
        const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ content: c, scheduledFor: iso, imageUrl, xConnectionId: compose.connId || null }) }); const d = await r.json()
        if (!r.ok || d.error || !d.post?.id) { setBanner(d.error || 'Could not save the post.'); return }
        id = d.post.id
      }
      if (postNow && id) { const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ id, action: 'post_now' }) }); const d = await r.json(); setBanner(d.status === 'posted' ? `Posted as @${d.as}` : `Saved to Queue — couldn't post now: ${d.error || 'error'}`) }
      else setBanner('Added to queue')
      setCompose(null); loadQueue()
    } finally { setComposeBusy(false) }
  }
  async function delPost(id) { if (!confirm('Delete this post?')) return; await authed('/api/posts', { method: 'DELETE', body: JSON.stringify({ id }) }); loadQueue() }
  async function postNow(id) {
    setBanner('Posting…')
    const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ id, action: 'post_now' }) }); const d = await r.json()
    setBanner(d.status === 'posted' ? `Posted as @${d.as}` : `Failed: ${d.error || 'error'}`); loadQueue(); if (d.reconnect) loadX()
  }
  async function startCheckout(plan, interval, seats) {
    const r = await authed('/api/stripe/checkout', { method: 'POST', body: JSON.stringify({ plan, interval, seats }) })
    const d = await r.json(); if (d.url) window.location.href = d.url; else setBanner(d.error || 'Billing isn’t live on this instance yet.')
  }
  function usePreset(text) { setInput(text); inputRef.current?.focus() }
  async function send(text) {
    const t = (text ?? input).trim(); if (!t || loading) return
    setInput(''); const next = [...messages, { role: 'user', content: t }]; setMessages(next); setLoading(true)
    try { const res = await authed('/api/chat', { method: 'POST', body: JSON.stringify({ messages: next, platforms: chatScope }) }); const data = await res.json(); setMessages(p => [...p, { role: 'assistant', content: data.reply, proposal: data.proposal || null }]); loadQueue() }
    catch (e) { setMessages(p => [...p, { role: 'assistant', content: '⚠️ ' + e.message }]) } finally { setLoading(false) }
  }

  const persona = me?.persona; const stats = me?.stats || {}
  const initials = (me?.profile?.full_name || session.user.email || '?').trim()[0]?.toUpperCase()
  const PRESETS = ['Make an Instagram carousel about my niche', 'Generate 5 posts in my voice', 'Turn on TikTok auto-replies', 'Repurpose my best LinkedIn post', "What's my whole setup right now?"]

  return (
    <div className="app">
      <header className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <span className="wordmark" style={{ fontSize: 20 }}>Cadence</span>
          <span className="muted tiny">{stats.queued || 0} queued · {stats.posted || 0} posted</span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          {!isPro && <motion.button className="btn-primary btn-sm" onClick={() => setAccount('pricing')} whileTap={{ scale: 0.96 }}>Upgrade</motion.button>}
          <button className="avatar" onClick={() => setAccount('profile')} title="Account">{initials}</button>
        </div>
      </header>

      <AnimatePresence>{banner && <motion.div className="banner" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={spring}>{banner}</motion.div>}</AnimatePresence>

      <div className="cols">
        <section className="pane left">
          <div className="left-head">
            <div className="seg">
              {['queue', 'x', 'linkedin', 'social', 'campaigns'].map(t => (
                <button key={t} onClick={() => setTab(t)} className={'seg-btn' + (tab === t ? ' on' : '')}>
                  {tab === t && <motion.span layoutId="seg-pill" className="seg-pill" transition={spring} />}
                  <span style={{ position: 'relative', zIndex: 1 }}>{({ queue: 'Queue', x: 'X', linkedin: 'LinkedIn', social: 'IG/TikTok', campaigns: 'Campaigns' })[t]}</span>
                </button>
              ))}
            </div>
            {tab === 'queue' && <motion.button className="btn-primary btn-sm row" style={{ gap: 5 }} onClick={openNew} whileTap={{ scale: 0.96 }}><Plus size={14} /> New post</motion.button>}
          </div>

          <div className="scroll-wrap">
            <motion.div key={tab} className="scroll" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>

              {tab === 'queue' && (() => {
                const matchP = it => qPlatform === 'all' || (it.platform || 'x') === qPlatform
                const fQueue = queue.filter(matchP)
                const schedShows = slideshows.filter(s => ['scheduled', 'posted'].includes(s.status) && (qPlatform === 'all' || qPlatform === 'instagram' || qPlatform === 'tiktok'))
                const chips = [['all', 'All'], ['x', 'X'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']]
                return (<>
                  <div className="qfilter">
                    {chips.map(([k, l]) => <button key={k} className={'qchip' + (qPlatform === k ? ' on' : '')} onClick={() => setQPlatform(k)}>{k !== 'all' && <span className="status-dot" style={{ background: platformDot(k) }} />}{l}</button>)}
                  </div>
                  {fQueue.length > 0 && (
                    <div className="src-legend">
                      <span className="src-leg"><span className="dot" style={{ background: '#4f63d8' }} /> You</span>
                      <span className="src-leg"><span className="dot" style={{ background: '#c2740a' }} /> Campaign</span>
                      <span className="src-leg"><span className="dot" style={{ background: '#7c3aed' }} /> Reply</span>
                    </div>
                  )}
                  {fQueue.length === 0 && schedShows.length === 0 && <Empty icon={<Clock size={26} />}>Nothing queued{qPlatform !== 'all' ? ` for ${qPlatform}` : ''}. Write one or ask the chat.</Empty>}
                  <div>{fQueue.map((p, i) => <QueueCard key={p.id} p={p} i={i} connected={connected} canPostLinkedIn={socialAccounts.some(a => a.platform === 'linkedin')} defaultCollapsed={collapseQueue} onSaveEdit={saveEdit} onPostNow={postNow} onDelete={delPost} onSchedule={openSchedule} />)}</div>
                  {schedShows.map(s => (
                    <div className="card camp-card" key={s.id}>
                      <div className="row" style={{ gap: 10 }}>
                        {s.image_urls?.[0] && <img src={s.image_urls[0]} className="ss-thumb" alt="" />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="conn-title row" style={{ gap: 7 }}>{s.topic}<span className="camp-state on">{s.status}</span></div>
                          <div className="muted tiny">{s.image_urls?.length || 0}-slide carousel · {s.style}{s.scheduled_for ? ` · ${fmt(s.scheduled_for)}` : ''}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {posted.filter(matchP).length > 0 && qPlatform !== 'instagram' && qPlatform !== 'tiktok' && <PostedSection posted={posted.filter(matchP)} />}
                </>)
              })()}

              {/* X — your personal account. Metrics, then collapsed automation
                  dropdowns, then what's ready to post. Accounts in the dot. */}
              {tab === 'x' && (<>
                <BrainBanner theme="x" />
                {connected ? (
                  <StatTiles tiles={[
                    { value: xStats?.newFollowers30d == null ? '—' : (xStats.newFollowers30d > 0 ? '+' : '') + fmtNum(xStats.newFollowers30d), label: 'New followers' },
                    { value: fmtNum(xStats?.impressions30d), label: 'Impressions · 30d' },
                    { value: fmtNum(queue.filter(p => (p.platform || 'x') === 'x').length), label: 'Queued' },
                  ]} />
                ) : (
                  <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', margin: '8px 0 14px' }} onClick={connectX}><XGlyph /> Connect your X account</button>
                )}
                {xConns.some(c => c.needs_reconnect) && <div className="notice" style={{ color: '#b9540a', margin: '4px 0 10px' }}>An X account needs reconnecting — open accounts (bottom-right).</div>}

                <Section title="Auto-reply" hint="answers comments in your voice" badge={<OnBadge on={!!engSettings.find(s => s.platform === 'x')?.enabled} />}>
                  <AutoReply platforms={['x']} settings={engSettings} replies={socialReplies} accounts={connected ? [{ platform: 'x' }] : []} configured={socialConfigured} onToggle={toggleReplies} onRun={runReplies} onPostDraft={postReplyDraft} />
                </Section>
                <Section title="Engage in your niche" hint="comments on relevant posts as you" badge={<OnBadge on={engRules.some(r => r.active)} />}>
                  <EngageManager rules={engRules} primaryConn={primaryX} xReadEnabled={!!me?.xReadEnabled} posts={posts} onSave={saveEngagement} onPatch={patchEngagement} onDelete={deleteEngagement} onRun={runEngagementNow} />
                </Section>
                <Section title="Campaign" hint="promote a topic on a schedule" badge={<OnBadge on={campsTouching(['x']).some(c => c.active)} />}>
                  <PlatformCampaign campaigns={campsFor(['x'])} targets={xCampTargets} allowImage canCreate={connected} connectHint="Connect your X account first." onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
                  <CrossCampHint plats={['x']} />
                </Section>
                <Section title="Feeder agents" hint="autonomous personas on your other accounts" badge={<OnBadge on={feederAgents.some(a => a.active)} />}>
                  <FeederAgents agents={feederAgents} xConns={xConns} posts={posts} onSpawn={spawnAgent} onPatch={patchAgent} onDelete={deleteAgent} onRun={runAgent} onReroll={rerollAgent} />
                </Section>
                <Section title="Inspiration" hint="accounts the AI studies">
                  <InspirationAccounts platform="x" accounts={inspoX} onAdd={addInspo} onRemove={removeInspo} />
                </Section>

                <div style={{ marginTop: 14 }}>
                  <Suggestions platform="x" drafts={xDrafts} busy={suggesting === 'x'} canPost={connected}
                    onGenerate={() => suggestPosts('x')} onPostNow={postNow} onSchedule={openSchedule} onDiscard={delPost} />
                </div>
              </>)}

              {/* IG/TikTok — both brains, accounts, then ONE create area with a
                  Carousels | Clips switcher. Automation + voice fold away. */}
              {tab === 'social' && (<>
                <BrainBanner theme="instagram" dual="tiktok" />
                <div className="conn-sec row" style={{ gap: 7, marginTop: 10 }}>Accounts
                  <button className="mini" style={{ marginLeft: 'auto' }} onClick={syncSocial}><RefreshCw size={11} /> Refresh</button>
                </div>
                {!socialConfigured && <div className="notice" style={{ marginBottom: 10 }}>Connect Zernio to post — previews work now.</div>}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  {socialAccounts.filter(a => ['instagram', 'tiktok'].includes(a.platform)).map(a => (
                    <span className="acct-chip" key={a.id}><span className="status-dot" style={{ background: platformDot(a.platform) }} />{a.username || a.platform}</span>
                  ))}
                  <button className="chip" disabled={!socialConfigured} onClick={() => connectSocial('instagram')}><Plus size={11} /> Instagram</button>
                  <button className="chip" disabled={!socialConfigured} onClick={() => connectSocial('tiktok')}><Plus size={11} /> TikTok</button>
                </div>

                <div className="seg" style={{ marginBottom: 12 }}>
                  {[['carousels', 'Carousels'], ['clips', 'Clips']].map(([k, l]) => (
                    <button key={k} className={'seg-btn' + (igMode === k ? ' on' : '')} onClick={() => setIgMode(k)}>
                      {igMode === k && <motion.span layoutId="ig-pill" className="seg-pill" transition={spring} />}
                      <span style={{ position: 'relative', zIndex: 1 }}>{l}</span>
                    </button>
                  ))}
                </div>
                {igMode === 'carousels' && (
                  <SlideshowStudio hideAccounts accounts={socialAccounts} configured={socialConfigured} slideshows={slideshows}
                    onConnect={connectSocial} onSync={syncSocial} onGenerate={generateSlideshow} onSave={saveSlideshow} onDelete={deleteSlideshow} />
                )}
                {igMode === 'clips' && (
                  <ClipStudio jobs={clipJobs} accounts={socialAccounts} configured={socialConfigured}
                    onCreate={createClipJob} onUpload={uploadClipFile} onDelete={deleteClipJob} onPost={postClip} />
                )}

                <div style={{ marginTop: 16 }}>
                  <Section title="Auto-reply" hint="answers comments in your voice" badge={<OnBadge on={engSettings.some(s => ['instagram', 'tiktok'].includes(s.platform) && s.enabled)} />}>
                    <AutoReply platforms={['instagram', 'tiktok']} settings={engSettings} replies={socialReplies} accounts={socialAccounts} configured={socialConfigured} onToggle={toggleReplies} onRun={runReplies} onPostDraft={postReplyDraft} />
                  </Section>
                  <Section title="Engage in your niche" hint="comments on relevant posts as you">
                    <EngageStub platform="Instagram/TikTok" />
                  </Section>
                  <Section title="Campaign" hint="auto-post carousels on a schedule" badge={<OnBadge on={campsTouching(['instagram', 'tiktok']).some(c => c.active)} />}>
                    <PlatformCampaign campaigns={campsFor(['instagram', 'tiktok'])} targets={igtkCampTargets} supportsCarousel canCreate={igtkCampTargets.length > 0} connectHint="Connect Instagram or TikTok above first." onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
                    <CrossCampHint plats={['instagram', 'tiktok']} />
                  </Section>
                </div>
              </>)}

              {/* LinkedIn — same shape as X: stats, ready-to-post, replies, and a
                  campaign for your personal account. Connect + voice-source +
                  inspiration live in the floating accounts dot, bottom-right. */}
              {tab === 'linkedin' && (<>
                <BrainBanner theme="linkedin" />
                {liAccount ? (
                  <StatTiles tiles={[
                    { value: '—', label: 'New followers · soon' },
                    { value: '—', label: 'Impressions · soon' },
                    { value: fmtNum(queue.filter(p => p.platform === 'linkedin').length), label: 'Queued' },
                  ]} />
                ) : (
                  <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', margin: '8px 0 14px' }} disabled={!socialConfigured} onClick={() => connectSocial('linkedin')}><LIcon size={15} /> Connect LinkedIn</button>
                )}

                <Section title="Auto-reply" hint="answers comments in your voice" badge={<OnBadge on={!!engSettings.find(s => s.platform === 'linkedin')?.enabled} />}>
                  <AutoReply platforms={['linkedin']} settings={engSettings} replies={socialReplies} accounts={socialAccounts} configured={socialConfigured} onToggle={toggleReplies} onRun={runReplies} onPostDraft={postReplyDraft} />
                </Section>
                <Section title="Engage in your niche" hint="comments on relevant posts as you">
                  <EngageStub platform="LinkedIn" />
                </Section>
                <Section title="Campaign" hint="promote a topic on a schedule" badge={<OnBadge on={campsTouching(['linkedin']).some(c => c.active)} />}>
                  <PlatformCampaign campaigns={campsFor(['linkedin'])} targets={liCampTargets} canCreate={!!liAccount} connectHint="Connect LinkedIn first (accounts, bottom-right)." onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
                  <CrossCampHint plats={['linkedin']} />
                </Section>

                <div style={{ marginTop: 14 }}>
                  <Suggestions platform="linkedin" drafts={liDrafts} busy={suggesting === 'linkedin'} canPost={!!liAccount}
                    onGenerate={() => suggestPosts('linkedin')} onPostNow={postNow} onSchedule={scheduleLinkedInDraft} onDiscard={delPost} />
                </div>
              </>)}

              {/* Campaigns — purely cross-platform. One topic, every account,
                  the right format per platform, in one voice. */}
              {tab === 'campaigns' && (<>
                <BrainBanner theme="campaigns" />
                <div className="muted tiny" style={{ margin: '0 2px 12px' }}>All your campaigns. One topic → the right format on each of your accounts.</div>
                <CrossCampaignManager campaigns={brandCampaigns} xConns={xConns} socialAccounts={socialAccounts} onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
              </>)}

            </motion.div>
          </div>

          {/* Floating accounts — X & LinkedIn keep account management one tap away
              without cluttering the create-first flow. */}
          {tab === 'x' && (
            <FloatingAccounts glyph={<XGlyph />} count={xConns.length} label="X accounts">
              {xConns.map(c => (
                <div className={'conn-card card' + (c.is_primary ? ' primary' : '')} key={c.id} style={{ marginBottom: 8 }}>
                  <div className="conn-icon x-icon"><XGlyph /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="conn-title row" style={{ gap: 6 }}>@{c.username}
                      {c.is_primary ? <span className="role-badge primary"><Star size={9} fill="currentColor" /> Primary</span> : <span className="role-badge">Feeder</span>}
                      {c.needs_reconnect && <span className="role-badge" style={{ background: '#fbe6d4', color: '#b9540a' }}>Reconnect</span>}
                    </div>
                  </div>
                  {c.needs_reconnect && <button className="mini accent" onClick={connectX}>Reconnect</button>}
                  {!c.is_primary && <button className="mini" onClick={() => makePrimary(c.id)} title="Make this your primary account">Make primary</button>}
                  <button className="mini danger" onClick={() => disconnectX(c.id)}>Disconnect</button>
                </div>
              ))}
              <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center' }} onClick={connectX}><Plus size={14} /> {connected ? 'Add another account (feeder)' : 'Connect X'}</button>
            </FloatingAccounts>
          )}
          {tab === 'linkedin' && (
            <FloatingAccounts glyph={<LIcon size={15} />} count={socialAccounts.filter(a => a.platform === 'linkedin').length} label="LinkedIn">
              <div className="conn-sec" style={{ marginTop: 0 }}>Publish to LinkedIn</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                {socialAccounts.filter(a => a.platform === 'linkedin').map(a => (
                  <span className="acct-chip" key={a.id}><span className="status-dot" style={{ background: platformDot('linkedin') }} />{a.username || 'LinkedIn'}</span>
                ))}
                <button className="chip" disabled={!socialConfigured} onClick={() => connectSocial('linkedin')}><Plus size={11} /> {liAccount ? 'Reconnect' : 'Connect'}</button>
              </div>
              <div className="conn-sec">Your voice source <span className="muted tiny" style={{ fontWeight: 400 }}>· your own LinkedIn</span></div>
              <LinkedInSlot account={liSelf[0]} onAdd={(url) => addLinkedIn(url, false)} onRemove={removeLinkedIn} self />
              <div className="conn-sec row" style={{ gap: 7 }}><Star size={12} /> Inspiration <span className="muted tiny" style={{ fontWeight: 400 }}>· up to 3, read-only</span></div>
              {[0, 1, 2].map(i => (
                <LinkedInSlot key={i} account={liMentors[i]} onAdd={(url) => addLinkedIn(url, true)} onRemove={removeLinkedIn} />
              ))}
            </FloatingAccounts>
          )}
        </section>

        {/* chat */}
        <section className="pane right">
          <div className="scroll chat-scroll">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <div className="wordmark" style={{ fontSize: 19, marginBottom: 4 }}>How can I help?</div>
                <div className="muted" style={{ fontSize: 13 }}>Post, schedule, make carousels, run replies — across X, LinkedIn, Instagram & TikTok. Just ask.</div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div key={i} className={'msg ' + m.role} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
                  <div className="msg-col" style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div className={'bubble ' + m.role}>{m.content}</div>
                    {m.proposal && <DraftProposal proposal={m.proposal} authed={authed} connected={connected} canPostLinkedIn={socialAccounts.some(a => a.platform === 'linkedin')} onResolved={loadQueue} defaultHour={defaultHour} xConns={xConns} hasPhotos={hasPhotos} />}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {loading && <div className="msg assistant"><div className="bubble assistant"><span className="dots"><i/><i/><i/></span></div></div>}
            <div ref={bottomRef} />
          </div>
          <div className="composer-wrap">
            <div className="chat-scope">
              <span className="muted tiny" style={{ flex: 'none' }}>Focus:</span>
              {[['all', 'All'], ['x', 'X'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']].map(([k, l]) => {
                const on = k === 'all' ? chatScope.length === 0 : chatScope.includes(k)
                return (
                  <button key={k} className={'scope-chip' + (on ? ' on' : '')} onClick={() => toggleScope(k)}>
                    {k !== 'all' && <span className="status-dot" style={{ background: platformDot(k), width: 6, height: 6 }} />}{l}
                    {on && k !== 'all' && <LCheck size={11} strokeWidth={3} style={{ marginLeft: 1 }} />}
                  </button>
                )
              })}
            </div>
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
                <span style={{ fontWeight: 700, fontSize: 15.5 }}>{compose.mode === 'edit' ? 'Edit post' : compose.mode === 'draft' ? 'Schedule draft' : 'New post'}</span>
                <button className="x-close" onClick={() => !composeBusy && setCompose(null)}><LX size={18} /></button>
              </div>
              <div style={{ position: 'relative' }}>
                <textarea className="field" rows={5} autoFocus placeholder={compose.loading ? 'Drafting…' : 'What do you want to post?'} value={compose.content || ''} disabled={compose.loading} onChange={e => setCompose(c => ({ ...c, content: e.target.value }))} />
                {compose.loading && <div className="draft-spin"><span className="dots"><i/><i/><i/></span></div>}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                {compose.platform !== 'linkedin'
                  ? <Toggle on={compose.imgOn} onChange={v => { setCompose(c => ({ ...c, imgOn: v })); if (v && !compose.img) composeGenImg() }} label="Include image" />
                  : <span className="muted tiny">LinkedIn post</span>}
                <span className={'count' + ((compose.content || '').length > capFor(compose) ? ' over' : '')}>{(compose.content || '').length}/{capFor(compose)}</span>
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
              {compose.platform !== 'linkedin' && xConns.length > 1 && (
                <select className="field dp-acct" style={{ marginTop: 10 }} value={compose.connId || ''} onChange={e => setCompose(c => ({ ...c, connId: e.target.value }))}>
                  {xConns.map(c => <option key={c.id} value={c.id}>Post as @{c.username}</option>)}
                </select>
              )}
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
                <input type="datetime-local" className="field dt" value={compose.when} onChange={e => setCompose(c => ({ ...c, when: e.target.value }))} />
                <div className="row" style={{ gap: 10 }}>
                  <button className="btn-ghost" disabled={composeBusy} onClick={() => saveCompose(false)}>Schedule</button>
                  <motion.button className="btn-primary" whileTap={{ scale: 0.97 }} disabled={composeBusy || (compose.platform === 'linkedin' ? !socialAccounts.some(a => a.platform === 'linkedin') : !connected) || (compose.content || '').length > capFor(compose) || !(compose.content || '').trim()} onClick={() => saveCompose(true)} title={compose.platform === 'linkedin' ? '' : (!connected ? 'Connect X first' : '')}>{composeBusy ? <span className="dots"><i/><i/><i/></span> : 'Post now'}</motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* account page (full-screen): profile · accounts · billing · pricing */}
      <AnimatePresence>
        {account && me && (
          <AccountPage
            me={me} session={session} authed={authed} banner={banner}
            accountTab={account} setAccountTab={setAccount}
            photos={photos} onUploadPhoto={uploadPhoto} onDeletePhoto={deletePhoto}
            persona={persona} analyzing={analyzing} onAnalyze={analyzeVoice}
            xConns={xConns} connected={connected} onConnectX={connectX} onDisconnectX={disconnectX} onMakePrimary={makePrimary}
            socialConfigured={socialConfigured} socialAccounts={socialAccounts} onConnectSocial={connectSocial}
            liSelf={liSelf} liMentors={liMentors} onAddLinkedIn={addLinkedIn} onRemoveLinkedIn={removeLinkedIn}
            onPortal={openPortal} onCheckout={startCheckout} onReload={loadMe} onClose={() => setAccount(null)}
          />
        )}
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
        <p className="xc-lead">X connects whichever account you&apos;re <b>currently signed into on x.com</b>. {hasAccounts ? 'To add a different one, switch accounts on X first, or it&apos;ll just reconnect the same account.' : 'Make sure the account showing on x.com is the one you want to post from.'}</p>

        {hasAccounts && (
          <div className="xc-steps">
            <div className="xc-step"><span className="xc-num">1</span><div>Open X and <b>switch to (or log into) the account</b> you want to add. Use “Add an existing account” or log out and back in.</div></div>
            <div className="xc-step"><span className="xc-num">2</span><div>Come back here and hit continue. Then just tap <b>Authorize</b> for that account.</div></div>
          </div>
        )}

        <div className="xc-actions">
          {hasAccounts && (
            <a className="btn-ghost row xc-open" href="https://x.com/logout" target="_blank" rel="noreferrer" onClick={() => setSwitched(true)}>
              <Refresh /> Log out / switch on X
            </a>
          )}
          <button className="btn-primary xc-go" onClick={onContinue}>{hasAccounts ? (switched ? 'I switched, continue' : 'Continue to X') : 'Continue to X'}</button>
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
.overlay { position: fixed; inset: 0; z-index: 70; background: rgba(28,32,48,0.22); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 480px; max-width: 100%; border-radius: 18px; padding: 22px; background: #fff; max-height: 88vh; overflow-y: auto; box-shadow: 0 30px 70px -24px rgba(40,46,80,0.4); }
.x-close { background: none; border: none; cursor: pointer; color: #9aa1ad; padding: 4px; display: flex; border-radius: 8px; } .x-close:hover { color: #16181d; background: #f2f3f6; }
.set-section { padding: 14px 0; border-top: 1px solid #f0f0f4; } .set-section:first-of-type { border-top: none; padding-top: 0; }
.set-h { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #9aa1ad; margin-bottom: 10px; }
.set-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; padding: 6px 0; }
.set-input { width: auto; padding: 7px 11px; font-size: 13px; }
.draft-spin { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #6f8cff; pointer-events: none; }
.dt { width: auto; padding: 8px 12px; font-size: 13px; color-scheme: light; flex: none; }
.count { font-size: 12px; color: #9aa1ad; white-space: nowrap; } .count.over { color: #ef4444; font-weight: 600; }
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
/* engagement */
.camp-state.auto { color: #6d3bd0; background: #f3eefe; }
.reply-ctx { display: flex; align-items: flex-start; gap: 7px; font-size: 11.5px; color: #6d3bd0; background: #f3eefe; border: 1px solid #e2d4fb; border-radius: 9px; padding: 7px 10px; margin-bottom: 9px; text-decoration: none; line-height: 1.45; }
.reply-ctx:hover { background: #ece2fd; }
.reply-ctx svg { flex: none; margin-top: 1px; }
.reply-ctx-text { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
/* campaign / engagement activity monitor */
.act-toggle { display: flex; align-items: center; gap: 6px; width: 100%; margin-top: 9px; padding: 6px 0 0; background: none; border: none; border-top: 1px solid #f0f0f4; cursor: pointer; font-family: inherit; font-size: 11.5px; font-weight: 600; color: #757b88; }
.act-toggle:hover { color: #16181d; }
.act-list { padding-top: 8px; display: flex; flex-direction: column; gap: 9px; max-height: 260px; overflow-y: auto; }
.act-row { display: flex; gap: 9px; align-items: flex-start; }
.act-text { font-size: 12.5px; line-height: 1.5; color: #2a2f3a; white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
/* comment-style checkboxes */
.style-opt { display: flex; align-items: flex-start; gap: 9px; text-align: left; background: #fff; border: 1px solid #e2e3e9; border-radius: 10px; padding: 9px 11px; cursor: pointer; font-family: inherit; transition: .15s; }
.style-opt:hover { border-color: #c6cefb; background: #f8f9ff; }
.style-opt.on { border-color: #8aa0ff; background: #f3f5ff; }
.style-opt .mini-check { margin-top: 1px; }
.style-name { display: block; font-size: 13px; font-weight: 600; color: #16181d; }
.style-desc { display: block; font-size: 11.5px; color: #757b88; margin-top: 1px; line-height: 1.4; }
/* source tag + legend */
.src-tag { flex: none; font-size: 10px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; padding: 2px 7px; border-radius: 20px; border: 1px solid; white-space: nowrap; }
.src-legend { display: flex; gap: 12px; flex-wrap: wrap; padding: 2px 2px 10px; }
.src-leg { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: #757b88; }
.src-leg .dot { width: 9px; height: 9px; border-radius: 3px; }
/* account roles */
.conn-card.primary { border-color: #e8d28a; background: linear-gradient(0deg, #fffdf6, #fff); }
.role-badge { font-size: 9.5px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; padding: 2px 7px; border-radius: 20px; color: #757b88; background: #f1f2f5; border: 1px solid #e4e5ea; display: inline-flex; align-items: center; gap: 3px; }
.role-badge.primary { color: #9a7a10; background: #fbf3d6; border-color: #efe0a6; }
/* live status */
.live-status { display: flex; align-items: center; gap: 7px; margin-top: 8px; padding: 7px 9px; border-radius: 9px; background: #f6f7f9; font-size: 11.5px; color: #6b7280; }
.live-status.on { background: #eef1fe; color: #4351b8; }
.live-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
/* slideshow studio */
.acct-row { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 10px; }
.acct-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 20px; background: #f1f2f5; border: 1px solid #e4e5ea; }
.ss-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sw-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; padding: 5px 11px 5px 5px; border-radius: 22px; background: #fff; border: 1px solid #e2e3e9; cursor: pointer; font-family: inherit; }
.sw-chip.on { border-color: #8aa0ff; background: #f3f5ff; }
.sw-chip .sw { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 16px; font-size: 13px; font-weight: 800; border: 1px solid rgba(0,0,0,.08); }
.ss-preview { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x mandatory; }
.ss-slide { width: 152px; height: 190px; flex: none; border-radius: 12px; object-fit: cover; border: 1px solid #e8e9ee; scroll-snap-align: start; }
.ss-thumb { width: 46px; height: 58px; border-radius: 8px; object-fit: cover; flex: none; border: 1px solid #e8e9ee; }
/* collapsible sections + clip studio */
.sec-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 14px; background: none; border: none; cursor: pointer; font-family: inherit; text-align: left; }
.sec-title { font-weight: 700; font-size: 13.5px; color: #1c1e24; }
.clip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 10px; }
.clip-card { min-width: 0; }
.clip-vid { width: 100%; aspect-ratio: 9/16; object-fit: cover; border-radius: 10px; background: #0e0f13; border: 1px solid #e8e9ee; }
.qfilter { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.qchip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; padding: 6px 12px; border-radius: 20px; background: #fff; border: 1px solid #e3e4ea; color: #4a4f5a; cursor: pointer; font-family: inherit; }
.qchip.on { background: #111113; border-color: #111113; color: #fff; }
.camp-card.on { border-color: #cbb46a; background: #fffdf6; }
/* left pane anchors the floating accounts dot */
.left { position: relative; }
/* stat tiles */
.stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 8px; margin: 4px 0 16px; }
.stat-tile { background: #fff; border: 1px solid #ececf1; border-radius: 13px; padding: 12px 10px; text-align: center; box-shadow: 0 1px 2px rgba(20,24,30,0.03); }
.stat-num { font-family: 'Sora', sans-serif; font-weight: 800; font-size: 19px; letter-spacing: -0.02em; color: #14161b; }
.stat-lbl { font-size: 11px; color: #8a909c; margin-top: 3px; font-weight: 500; }
/* clean auto-reply blocks */
.ar-block { padding: 13px 14px; margin-bottom: 9px; display: block; }
.ar-block.on { border-color: #cdd6fb; }
.ar-draft { background: #f9fafc; border: 1px solid #eceef3; border-radius: 11px; padding: 10px 12px; margin-top: 9px; }
.ar-comment { font-size: 11.5px; color: #757b88; line-height: 1.45; overflow-wrap: anywhere; }
.ar-author { font-weight: 700; color: #4a4f5a; }
.ar-reply { font-size: 13px; color: #20242c; line-height: 1.5; margin-top: 5px; overflow-wrap: anywhere; }
/* floating accounts dot */
.facct { position: absolute; right: 18px; bottom: 18px; z-index: 20; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.facct-dot { position: relative; width: 46px; height: 46px; border-radius: 50%; border: 1px solid #e6e7ec; background: #fff; color: #16181d; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px -6px rgba(40,46,80,0.35); transition: transform .12s, box-shadow .15s; }
.facct-dot:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -8px rgba(40,46,80,0.4); }
.facct-dot.on { background: #16181d; color: #fff; border-color: #16181d; }
.facct-count { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 10px; background: #4f63d8; color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; }
.facct-panel { width: 320px; max-width: calc(100vw - 40px); max-height: 60vh; overflow-y: auto; padding: 15px 16px; border-radius: 16px; box-shadow: 0 20px 50px -20px rgba(40,46,80,0.45); }
.facct-body .conn-sec:first-child { margin-top: 4px; }
/* clearance so the floating accounts dot never covers the last card's buttons */
.left .scroll { padding-bottom: 96px; }
/* feeder agents */
.agent-note { font-size: 11.5px; font-style: italic; color: #6b7280; margin-top: 5px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
/* chat platform-scope selector */
.chat-scope { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-bottom: 9px; }
.scope-chip { display: inline-flex; align-items: center; gap: 5px; background: #f4f5f8; border: 1px solid #e8e9ee; border-radius: 16px; color: #5b6573; font-size: 11.5px; font-weight: 600; padding: 4px 10px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; }
.scope-chip:hover { border-color: #c6cefb; color: #3b4fc0; }
.scope-chip.on { background: #16181d; border-color: #16181d; color: #fff; }
/* ── account page ── */
.acctpage { position: fixed; inset: 0; z-index: 60; background: #fbfbfd; display: flex; flex-direction: column; overflow: hidden; }
.acct-top { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid #ededf2; background: rgba(255,255,255,0.9); backdrop-filter: blur(10px); }
.acct-wrap { flex: 1; min-height: 0; display: flex; max-width: 1080px; width: 100%; margin: 0 auto; }
.acct-nav { width: 232px; flex: none; border-right: 1px solid #ededf2; padding: 18px 14px; display: flex; flex-direction: column; gap: 4px; }
.acct-id { display: flex; align-items: center; gap: 11px; padding: 6px 8px 16px; min-width: 0; }
.acct-avatar { width: 40px; height: 40px; border-radius: 50%; background: #4f63d8; color: #fff; font-weight: 700; font-size: 16px; display: flex; align-items: center; justify-content: center; flex: none; }
.acct-navbtn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: none; background: none; border-radius: 10px; color: #5b6573; font-size: 13.5px; font-weight: 600; font-family: inherit; cursor: pointer; transition: .15s; text-align: left; }
.acct-navbtn:hover { background: #f2f3f7; color: #16181d; }
.acct-navbtn.on { background: #eef1fe; color: #3b4fc0; }
.acct-content { flex: 1; min-width: 0; overflow-y: auto; padding: 26px 30px 60px; }
.acct-sec-wrap { max-width: 640px; }
.acct-h { font-size: 13px; font-weight: 700; color: #16181d; margin: 24px 0 10px; }
.acct-h:first-child { margin-top: 0; }
.acct-card { padding: 16px 17px; }
.acct-card .ob-label:first-child { margin-top: 0; }
.acct-card .field + .ob-label { margin-top: 14px; }
.acct-save { margin-top: 22px; display: flex; justify-content: flex-end; }
/* pricing */
.plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
.plan-card { display: flex; flex-direction: column; padding: 20px 19px; border-radius: 18px; }
.plan-card.team { border-color: #d9def8; background: linear-gradient(180deg, #fbfcff, #fff); }
.plan-card.current { border-color: #cbb46a; }
.plan-ic { width: 28px; height: 28px; border-radius: 8px; background: #eef1fe; color: #4f63d8; display: flex; align-items: center; justify-content: center; flex: none; }
.plan-name { font-family: 'Sora', sans-serif; font-weight: 800; font-size: 17px; letter-spacing: -0.02em; }
.plan-badge { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #9a7a10; background: #fbf3d6; border: 1px solid #efe0a6; padding: 2px 8px; border-radius: 20px; }
.plan-price { font-family: 'Sora', sans-serif; font-weight: 800; font-size: 34px; letter-spacing: -0.02em; margin: 12px 0 2px; }
.plan-feats { list-style: none; padding: 0; margin: 14px 0 18px; display: flex; flex-direction: column; gap: 9px; }
.plan-feats li { display: flex; align-items: flex-start; gap: 9px; font-size: 12.5px; line-height: 1.45; color: #2a2f3a; }
.plan-feats li svg { color: #0e9f6e; flex: none; margin-top: 2px; }
.seat-row { display: flex; align-items: center; gap: 10px; margin: 12px 0 2px; padding: 9px 11px; background: #f6f7fa; border-radius: 11px; }
.stepper { display: inline-flex; align-items: center; gap: 0; border: 1px solid #e2e3e9; border-radius: 9px; overflow: hidden; background: #fff; }
.stepper button { width: 28px; height: 28px; border: none; background: #fff; color: #4a4f5a; font-size: 16px; cursor: pointer; font-family: inherit; }
.stepper button:hover:not(:disabled) { background: #f2f3f7; } .stepper button:disabled { opacity: .35; cursor: default; }
.stepper span { min-width: 30px; text-align: center; font-weight: 700; font-size: 13.5px; }
.plan-total { font-weight: 700; font-size: 13px; color: #16181d; white-space: nowrap; }
.acct-tabstrip { display: none; gap: 6px; padding: 10px 16px 0; overflow-x: auto; }
@media (max-width: 720px) {
  .acct-nav { display: none; }
  .acct-tabstrip { display: flex; }
  .plan-grid { grid-template-columns: 1fr; }
}
/* phones: stack the two panes; the left pane scrolls, chat takes the rest */
@media (max-width: 860px) {
  .cols { flex-direction: column; }
  .left { width: 100%; max-height: 56vh; border-right: none; border-bottom: 1px solid #ededf2; }
  .seg { flex-wrap: wrap; }
}
`
