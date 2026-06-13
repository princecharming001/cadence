'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  Check as LCheck, X as LX, RefreshCw, Sparkles, Send, Plus,
  Brain, ChevronDown, Trash2, Pencil, Crown, Clock, Wand2, Image as LImage,
  ThumbsUp, ThumbsDown, Upload, Play, MessageCircle, Star, Loader2,
  ArrowLeft, CreditCard, Users, User as LUser, Bot, History as LHistory,
  Calendar as LCalendar, List as LList,
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
  draft:  { c: '#7A5EA8', label: 'draft' }, queued: { c: '#1E7A4D', label: 'queued' },
  paused: { c: '#f59e0b', label: 'paused' }, posted: { c: '#3b82f6', label: 'posted' },
  posting: { c: '#3C7A5E', label: 'posting…' }, failed: { c: '#B3372F', label: 'failed' },
}
const MAX = 280
// Per-platform caps (mirrors lib/prompts PLATFORM): X is the 280 platform,
// LinkedIn is long-form, IG/TikTok captions run to 2200.
const PLATFORM_CAPS = { x: 280, linkedin: 1300, instagram: 2200, tiktok: 2200 }
const capFor = p => PLATFORM_CAPS[p?.platform] || 280

// Where a post came from, color-coded so you can tell at a glance whether you
// scheduled it, a campaign made it, or it's a reply to someone else's post.
function sourceMeta(p) {
  if (p.source === 'agent') return { label: 'Agent', c: '#1E7A4D', bg: '#EDF5EF', bd: '#CBE3D2' }
  if (p.reply_to_tweet_id || p.source === 'engagement') return { label: 'Reply', c: '#7A5EA8', bg: '#F4F0FA', bd: '#E4DBF2' }
  if (p.source === 'campaign') return { label: 'Campaign', c: '#c2740a', bg: '#fdf3e3', bd: '#f5dcae' }
  return { label: 'You', c: '#1E4D3B', bg: '#EDF2EE', bd: '#D5E1D8' }
}
const TZS =['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney']

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
function IGGlyph({ size = 14 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ display: 'block' }}><rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4" /><circle cx="12" cy="12" r="4.4" /><circle cx="17.7" cy="6.3" r="1.5" fill="currentColor" stroke="none" /></svg> }
function TTGlyph({ size = 14 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}><path d="M16.6 1h3.1c.2 1.9 1.4 3.7 3.3 4.3v3.2c-1.7 0-3.3-.6-4.6-1.5v6.9c0 5.3-3.7 8.1-7.6 8.1-3.3 0-6.8-2.4-6.8-6.7 0-4 3.2-6.8 7.1-6.6V12c-1.9-.3-3.8 1-3.8 3.2 0 2 1.6 3.4 3.4 3.4 2 0 3.9-1.4 3.9-4.6V1z"/></svg> }

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" className="row" onClick={() => onChange(!on)} style={{ gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
      <span className={'switch' + (on ? ' on' : '')}><span className="knob" /></span>
      {label && <span style={{ fontSize: 12.5, color: '#5b6573' }}>{label}</span>}
    </button>
  )
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function AuthScreen({ initialMode = 'signin', onBack }) {
  const [mode, setMode] = useState(initialMode)
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
        <div className="wordmark" style={{ fontSize: 30 }}>cadence</div>
        <div className="muted" style={{ marginTop: 8, marginBottom: 28, fontSize: 14 }}>Your voice, posting itself — across X, LinkedIn, Instagram, and TikTok.</div>
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
        {onBack && <div style={{ marginTop: 14, textAlign: 'center' }}><span className="link" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--faint)' }} onClick={onBack}>← Back</span></div>}
      </motion.form>
    </div>
  )
}

// ── Landing — the public marketing page (signed-out) ───────────────────────────
const LD_FEATURES = [
  [Brain, 'A voice engine', 'It reads what you’ve already written and learns the rhythm — hooks, opinions, punctuation and all.'],
  [Clock, 'One queue', 'Every platform’s posts in a single timeline. Approve each one, or let it run.'],
  [MessageCircle, 'Replies, handled', 'Comments on your posts get answers in your voice — drafted for review, or fully automatic.'],
  [Star, 'Show up in your niche', 'Cadence finds the conversations that matter and joins them as you, not as a bot.'],
  [Bot, 'Agents on a mission', 'Deploy personas on your other accounts. Give them a campaign and they quietly carry it.'],
  [LImage, 'Carousels & clips', 'A topic in, a finished Instagram carousel or captioned vertical clip out.'],
]

const LD_QUOTES = [
  ['It writes the post I would have written at my sharpest, and it does it before breakfast.', 'Founder, developer-tools startup'],
  ['I stopped dreading LinkedIn. Honestly it sounds more like me than I do on a Tuesday.', 'Newsletter writer'],
  ['The agents are uncanny. My launch week mostly ran itself.', 'Indie maker'],
]

function Landing({ onAuth }) {
  const [scrolled, setScrolled] = useState(false)
  const rootRef = useRef(null)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    // Progressive enhancement: content is visible by default. Only elements
    // below the fold get hidden (.pre) for the subtle reveal, and a failsafe
    // un-hides everything — no JS path can leave the page blank.
    const els = [...(rootRef.current?.querySelectorAll('.rv') || [])]
    const vh = window.innerHeight
    const below = els.filter(el => el.getBoundingClientRect().top > vh * 0.9)
    below.forEach(el => el.classList.add('pre'))
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.remove('pre')), { threshold: 0.12 })
    below.forEach(el => io.observe(el))
    const t = setTimeout(() => els.forEach(el => el.classList.remove('pre')), 1500)
    return () => { io.disconnect(); clearTimeout(t) }
  }, [])
  return (
    <div className="site" ref={rootRef}>
      <nav className={'ld-nav' + (scrolled ? ' scrolled' : '')}>
        <div className="ld-nav-in">
          <span className="wordmark" style={{ fontSize: 21 }}>cadence</span>
          <div className="ld-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#how">How it works</a>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <button className="ld-signin" onClick={() => onAuth('signin')}>Sign in</button>
            <button className="ld-cta" onClick={() => onAuth('signup')}>Get started</button>
          </div>
        </div>
      </nav>

      <header className="ld-hero">
        <div className="ld-eyebrow">Social media, in your own voice</div>
        <h1 className="ld-h1">Your voice, posting itself.</h1>
        <p className="ld-sub">Cadence learns how you write, then drafts, schedules, and replies across X, LinkedIn, Instagram, and TikTok. Every word still sounds like you.</p>
        <div className="row" style={{ gap: 12, justifyContent: 'center' }}>
          <button className="ld-cta lg" onClick={() => onAuth('signup')}>Get started</button>
          <a href="#features" className="ld-ghost">See how it works</a>
        </div>
        <div className="ld-proof">Built for people who post every day</div>
      </header>

      <section className="ld-sec" id="features">
        <div className="ld-eyebrow rv">What it does</div>
        <h2 className="ld-h2 rv">Everything between the idea and the post.</h2>
        <div className="ld-grid rv">
          {LD_FEATURES.map(([Icon, t, b]) => (
            <div className="ld-card" key={t}>
              <Icon size={22} style={{ color: 'var(--accent)' }} />
              <div className="ld-card-t">{t}</div>
              <div className="ld-card-b">{b}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="ld-sec" id="how">
        <div className="ld-eyebrow rv">A morning with Cadence</div>
        <h2 className="ld-h2 rv">You approve. It does the rest.</h2>
        <div className="ld-bento rv">
          <div className="ld-card ld-big">
            <div className="ld-mock-h"><span className="ld-eyebrow" style={{ margin: 0 }}>Queue · today</span><span className="ld-mock-pill">4 scheduled</span></div>
            {[
              ['Most “growth advice” is just survivorship bias with a thread emoji.', '9:15 AM', 'X'],
              ['What 6 months of daily posting actually changed (numbers inside).', '11:00 AM', 'LinkedIn'],
              ['5 hooks that carried every carousel we shipped this month', '1:30 PM', 'Instagram'],
              ['Reply → @anna: the trick is batching replies, not posts.', '3:45 PM', 'X'],
            ].map(([t, when, plat], i) => (
              <div className="ld-mock-row" key={i}>
                <span className="status-dot" style={{ background: i === 3 ? '#7A5EA8' : 'var(--ok)' }} />
                <span className="ld-mock-t">{t}</span>
                <span className="ld-mock-meta">{plat} · {when}</span>
              </div>
            ))}
          </div>
          <div className="ld-stack">
            <div className="ld-card">
              <div className="ld-card-t">A chat that does things</div>
              <div className="ld-card-b">“Draft a post about the launch and schedule it for 9am.” It’s queued before you finish your coffee.</div>
            </div>
            <div className="ld-card">
              <div className="ld-card-t">Posts that learn</div>
              <div className="ld-card-b">Thumbs-up the good ones, thumbs-down the misses. Everything after gets closer to you.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="ld-sec">
        <div className="ld-eyebrow rv">From early users</div>
        <div className="ld-quotes">
          {LD_QUOTES.map(([q, who]) => (
            <blockquote className="ld-quote rv" key={who}>
              <p>“{q}”</p>
              <cite>{who}</cite>
            </blockquote>
          ))}
        </div>
      </section>

      <section className="ld-sec" id="pricing">
        <div className="ld-eyebrow rv">Pricing</div>
        <h2 className="ld-h2 rv">Two plans. No riddles.</h2>
        <div className="ld-price-wrap rv">
          <div className="ld-price">
            <div className="ld-price-name">Individual</div>
            <div className="ld-price-amt">$19<span>/mo</span></div>
            <div className="ld-card-b">Your accounts on every platform, the voice engine, the queue, auto-replies, and campaigns.</div>
            <button className="ld-cta" style={{ marginTop: 18 }} onClick={() => onAuth('signup')}>Start with Individual</button>
          </div>
          <div className="ld-price">
            <div className="ld-price-name">Team</div>
            <div className="ld-price-amt">$15<span>/seat/mo · min 3</span></div>
            <div className="ld-card-b">Everything in Individual for each seat, plus shared campaigns and a combined view of the team.</div>
            <button className="ld-ghost" style={{ marginTop: 18 }} onClick={() => onAuth('signup')}>Start with Team</button>
          </div>
        </div>
      </section>

      <footer className="ld-foot">
        <div className="ld-foot-in">
          <div className="ld-foot-grid">
            <div>
              <div className="ld-foot-h">Product</div>
              <a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#how">How it works</a>
            </div>
            <div>
              <div className="ld-foot-h">Platforms</div>
              <span>X</span><span>LinkedIn</span><span>Instagram</span><span>TikTok</span>
            </div>
            <div>
              <div className="ld-foot-h">Company</div>
              <span>About</span><span>Contact</span>
            </div>
            <div>
              <div className="ld-foot-h">Legal</div>
              <span>Privacy</span><span>Terms</span>
            </div>
          </div>
          <div className="ld-foot-bar">
            <span>© 2026 Cadence</span>
            <span>Made for creators</span>
          </div>
        </div>
      </footer>
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
  const [positioning, setPositioning] = useState(saved.positioning || '')
  const [tone, setTone] = useState(saved.tone || [])
  const toggleTone = t => setTone(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t].slice(0, 4))
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
    const brand_brief = (positioning.trim() || tone.length)
      ? { positioning: positioning.trim(), audience: '', pillars: [], tone, goal: goals.trim(), avoid: '' } : undefined
    await authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ full_name: name, role, goals, onboarded: true, ...(brand_brief ? { brand_brief } : {}) }) })
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
      <label className="ob-label">How do you want to come across?</label>
      <input className="field" value={positioning} onChange={e => setPositioning(e.target.value)} placeholder="the founder who shows the real, unglamorous side of building" />
      <label className="ob-label">Pick your personality <span className="muted tiny" style={{ fontWeight: 400 }}>· up to 4</span></label>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{TONE_OPTS.map(t => <button key={t} type="button" className={'chip' + (tone.includes(t) ? ' on' : '')} onClick={() => toggleTone(t)}>{t}</button>)}</div>
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
        {obMsg && <div className="notice" style={{ marginTop: 12, color: '#B3372F' }}>{obMsg}</div>}
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
function DraftProposal({ proposal, authed, connected, canPostLinkedIn, onResolved, onOutcome, defaultHour, xConns = [], hasPhotos, index = 0, total = 1 }) {
  const isThread = Array.isArray(proposal.thread) && proposal.thread.length > 1
  const platform = proposal.platform === 'linkedin' ? 'linkedin' : 'x'
  const isLi = platform === 'linkedin'
  const cap = isLi ? 1300 : MAX
  const canPost = isLi ? canPostLinkedIn : connected
  const [content, setContent] = useState(proposal.content || '')
  const [parts, setParts] = useState(isThread ? proposal.thread : [])
  const [img, setImg] = useState(proposal.image_url || '')
  const [imgOn, setImgOn] = useState(!!proposal.image_url)
  const [personal, setPersonal] = useState(false)
  const [when, setWhen] = useState(defaultWhen(defaultHour))
  const [smartSlot, setSmartSlot] = useState(false)
  const whenTouched = useRef(false)
  const [connId, setConnId] = useState(xConns[0]?.id || '')
  // resolved/resolved_label persist with the chat, so reloaded history shows
  // the outcome instead of a live card that could double-post.
  const [busy, setBusy] = useState(false); const [regen, setRegen] = useState(false); const [done, setDone] = useState(proposal.resolved || null)
  const [doneLabel, setDoneLabel] = useState(proposal.resolved_label || '')
  const [rating, setRating] = useState(null); const [err, setErr] = useState('')
  const countdown = useCountdown(when)
  function finish(result, label) { setDone(result); setDoneLabel(label); onOutcome && onOutcome(result, label) }

  useEffect(() => { if (!connId && xConns[0]?.id) setConnId(xConns[0].id) }, [xConns, connId])

  // Prefill the time picker with the user's next SMART slot (their windows,
  // weighted by what's actually earned engagement). Editing the picker wins.
  useEffect(() => {
    let on = true
    authed(`/api/schedule?platform=${platform}`).then(r => r.json()).then(d => {
      if (on && d.when && !whenTouched.current) {
        const t = new Date(d.when); const z = n => String(n).padStart(2, '0')
        setWhen(`${t.getFullYear()}-${z(t.getMonth() + 1)}-${z(t.getDate())}T${z(t.getHours())}:${z(t.getMinutes())}`)
        setSmartSlot(true)
      }
    }).catch(() => {})
    return () => { on = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
  const threadInvalid = isThread && (parts.some(t => !t.trim() || t.length > 280) || parts.filter(t => t.trim()).length < 2)
  async function approve(postNow) {
    if (isThread ? threadInvalid : (!content.trim() || content.length > cap)) return
    setBusy(true)
    const body = isThread
      ? { thread: parts.filter(t => t.trim()), scheduledFor: new Date(when).toISOString(), xConnectionId: connId || null }
      : { content, platform, scheduledFor: new Date(when).toISOString(), imageUrl: imgOn ? img : null, xConnectionId: isLi ? null : (connId || null) }
    const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify(body) })
    const d = await r.json()
    if (!r.ok || d.error || !d.post?.id) { setBusy(false); setErr(d.error || 'Could not save the post.'); return }
    let result = 'scheduled', errMsg = ''
    if (postNow) {
      const pr = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ id: d.post.id, action: 'post_now' }) })
      const pd = await pr.json()
      result = pd.status === 'posted' ? 'posted' : 'failed'
      if (result === 'failed') errMsg = pd.error || 'Post failed.'
    }
    setBusy(false)
    const label = result === 'posted' ? (isThread ? 'Thread started — the rest follows in order' : isLi ? 'Posted to LinkedIn' : 'Posted to X')
      : result === 'failed' ? `Failed — saved to Queue. ${errMsg}`
      : `Scheduled · ${fmt(new Date(when).toISOString())}`
    finish(result, label); onResolved && onResolved()
  }
  if (done) return <div className={'dp-done ' + done}>{doneLabel || (done === 'discarded' ? 'Discarded' : done)}</div>
  return (
    <motion.div className="card dp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="dp-head">
        <span>{isThread ? `Thread draft · ${parts.length} parts` : total > 1 ? `Draft ${index + 1} of ${total}` : 'Draft preview'}</span>
        <div className="row" style={{ gap: 8 }}>
          <button className={'thumb' + (rating === 'up' ? ' on up' : '')} title="More like this" onClick={() => rate('up')}><ThumbsUp size={13} /></button>
          <button className={'thumb' + (rating === 'down' ? ' on down' : '')} title="Less like this" onClick={() => rate('down')}><ThumbsDown size={13} /></button>
          {!isThread && <Toggle on={imgOn} onChange={toggleImg} label="image" />}
        </div>
      </div>
      {isThread
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {parts.map((t, i) => (
              <div key={i} className="dp-part">
                <span className="dp-part-n">{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <textarea className="field dp-text dp-grow" rows={3} maxLength={380} value={t}
                    onChange={e => setParts(ps => ps.map((x, j) => j === i ? e.target.value : x))} />
                  <div className="row" style={{ justifyContent: 'flex-end', padding: '2px 2px 0' }}>
                    <span className={'count' + (t.length > 280 ? ' over' : '')} style={{ fontSize: 10.5 }}>{t.length}/280</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        : <textarea className="field dp-text dp-grow" rows={isLi ? 12 : 7} maxLength={cap + 100} value={content} onChange={e => setContent(e.target.value)} />}
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
          <input type="datetime-local" className="field dt" value={when} onChange={e => { whenTouched.current = true; setSmartSlot(false); setWhen(e.target.value) }} />
          <span className="cd-pill" title={smartSlot ? 'Picked from your posting windows + engagement history' : ''}><Clock size={11} /> {countdown}{smartSlot ? ' · smart' : ''}</span>
        </div>
        {!isThread && <span className={'count' + (content.length > cap ? ' over' : '')}>{content.length}/{cap}</span>}
      </div>
      {err && <div className="notice" style={{ color: '#B3372F', marginTop: 8 }}>{err}</div>}
      <div className="dp-actions">
        <button className="icon-btn x" title="Discard" onClick={() => finish('discarded', 'Discarded')}><Ex /></button>
        <button className="icon-btn check" title="Approve & schedule" disabled={busy || (isThread ? threadInvalid : (content.length > cap || !content.trim()))} onClick={() => approve(false)}><Check /> <span>Schedule</span></button>
        <motion.button className="btn-primary btn-sm" whileTap={{ scale: 0.96 }} disabled={busy || !canPost || (isThread ? threadInvalid : content.length > cap)} onClick={() => approve(true)} title={!canPost ? (isLi ? 'Connect LinkedIn first' : 'Connect X first') : 'Post now'}>Post now</motion.button>
      </div>
    </motion.div>
  )
}

// ── Queue card (collapsible + inline edit) ──────────────────────────────────────
function QueueCard({ p, i, connected, socialPlatforms, defaultCollapsed, onSaveEdit, onPostNow, onDelete, onSchedule }) {
  const s = STATUS[p.status] || { c: '#9ca3af', label: p.status }
  const cap = capFor(p)
  const isZernio = ['linkedin', 'instagram', 'tiktok'].includes(p.platform)
  const canPost = isZernio ? !!socialPlatforms?.has(p.platform) : connected
  const inFlight = p.status === 'posting'
  const [open, setOpen] = useState(!defaultCollapsed)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.content)
  const [busy, setBusy] = useState(false)
  async function save() { setBusy(true); await onSaveEdit(p.id, draft); setBusy(false); setEditing(false); setOpen(true) }
  const needsAttention = ['failed', 'posting', 'paused', 'draft'].includes(p.status)
  const qTime = new Date(p.scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return (
    <motion.div className={'card qcard' + (open ? ' open' : '') + (p.status === 'failed' ? ' bad' : '')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02, ...spring }} layout>
      <button className="qhead" onClick={() => !editing && setOpen(o => !o)}>
        <span className="status-dot" style={{ background: platformDot(p.platform || 'x') }} />
        <span className="qtime">{qTime}</span>
        <span className="qtitle">{titleOf(p.content)}</span>
        {p.thread_id != null && p.thread_index != null && <span className="qmeta">🧵 {(p.thread_index ?? 0) + 1}</span>}
        {needsAttention && <span className={'qstate' + (p.status === 'failed' ? ' bad' : '')}>{s.label}</span>}
        <ChevronDown size={15} className="qchev" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'var(--faint)', flex: 'none' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
            <div className="qbody">
              <div className="muted tiny" style={{ marginBottom: 8 }}>{fmt(p.scheduled_for)} · {s.label}{sourceMeta(p).label !== 'You' ? ` · via ${sourceMeta(p).label.toLowerCase()}` : ''}</div>
              <ReplyContext p={p} />
              {Array.isArray(p.image_urls) && p.image_urls.length > 1
                ? <div className="ss-preview" style={{ marginBottom: 8 }}>{p.image_urls.map((u, k) => <img key={k} src={u} className="ss-slide" alt={`slide ${k + 1}`} />)}</div>
                : p.image_url && <img src={p.image_url} className="qcard-img" alt="" />}
              {p.status === 'failed' && p.error && <div className="notice" style={{ color: '#B3372F', marginBottom: 8 }}>{p.error}</div>}
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
                      <button className="mini" onClick={() => onPostNow(p.id)} disabled={!canPost} title={!canPost ? (isZernio ? `Connect ${p.platform} to publish` : 'Connect X to publish') : ''}>{p.status === 'failed' ? 'Retry' : 'Post now'}</button>
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

// ── Calendar view of the queue — a clean month grid. Each post is a thin
// platform-colored chip on its scheduled day; click to open/retime. ──────────
function QueueCalendar({ posts, onOpen, onPostNow, onDelete }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [sel, setSel] = useState(null) // selected day key
  const year = cursor.getFullYear(), month = cursor.getMonth()
  const today = new Date()
  const dayKey = iso => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
  const byDay = {}
  for (const p of posts) (byDay[dayKey(p.posted_at || p.scheduled_for)] ||= []).push(p)
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7) cells.push(null)
  const selPosts = (sel ? (byDay[sel] || []) : []).sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))
  const selDate = sel ? (() => { const [y, m, d] = sel.split('-').map(Number); return new Date(y, m, d) })() : null
  return (
    <div className="cal">
      <div className="cal-head">
        <button className="cal-nav" onClick={() => { setCursor(new Date(year, month - 1, 1)); setSel(null) }} aria-label="Previous month"><ChevronDown size={15} style={{ transform: 'rotate(90deg)' }} /></button>
        <span className="cal-title">{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button className="cal-nav" onClick={() => { setCursor(new Date(year, month + 1, 1)); setSel(null) }} aria-label="Next month"><ChevronDown size={15} style={{ transform: 'rotate(-90deg)' }} /></button>
        <button className="cal-today" onClick={() => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSel(`${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`) }}>Today</button>
      </div>
      <div className="cal-grid cal-dow">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="cal-dowcell">{d}</div>)}</div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (d == null) return <div key={i} className="cal-cell empty" />
          const key = `${year}-${month}-${d}`
          const dt = new Date(year, month, d)
          const isToday = dt.toDateString() === today.toDateString()
          const dayPosts = (byDay[key] || []).sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))
          return (
            <button key={i} className={'cal-cell' + (isToday ? ' today' : '') + (sel === key ? ' sel' : '') + (dayPosts.length ? ' has' : '')} onClick={() => setSel(sel === key ? null : key)}>
              <div className="cal-daynum">{d}</div>
              <div className="cal-chips">
                {dayPosts.slice(0, 3).map(p => (
                  <span key={p.id} className={'cal-chip' + (p.status === 'posted' ? ' done' : '') + (p.status === 'failed' ? ' bad' : '')} title={(p.content || '').slice(0, 90)}>
                    <span className="status-dot" style={{ background: platformDot(p.platform || 'x'), width: 5, height: 5, flex: 'none' }} />
                    <span className="cal-chip-t">{new Date(p.scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                ))}
                {dayPosts.length > 3 && <span className="cal-more">+{dayPosts.length - 3}</span>}
              </div>
            </button>
          )
        })}
      </div>
      <AnimatePresence initial={false}>
        {sel && (
          <motion.div className="cal-day card" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="cal-day-title">{selDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
              <button className="x-close" onClick={() => setSel(null)}><LX size={16} /></button>
            </div>
            {selPosts.length === 0 && <div className="muted tiny" style={{ padding: '4px 0 6px' }}>Nothing scheduled. Pick a draft or ask the chat to write one.</div>}
            {selPosts.map(p => {
              const s = STATUS[p.status] || { c: '#9ca3af', label: p.status }
              const done = p.status === 'posted'
              return (
                <div className="cal-day-row" key={p.id}>
                  <div className="cal-day-time"><span className="status-dot" style={{ background: platformDot(p.platform || 'x') }} />{new Date(p.posted_at || p.scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                  <div className="cal-day-body">
                    <div className="cal-day-text">{p.content}</div>
                    <div className="row" style={{ gap: 8, marginTop: 5 }}>
                      <span className="cal-day-status" style={{ color: s.c }}>{s.label}</span>
                      {!done && <button className="mini" onClick={() => onOpen(p)}><Pencil size={11} /> Edit</button>}
                      {!done && onPostNow && <button className="mini" onClick={() => onPostNow(p.id)}>Post now</button>}
                      {onDelete && <button className="mini danger" onClick={() => onDelete(p.id)}><Trash2 size={11} /></button>}
                    </div>
                  </div>
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

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
// One posted item — a compact collapsed row (matches the queue), expands to
// the full post + its real engagement. Platform-color dot, no source bars.
function PostedRow({ p }) {
  const [open, setOpen] = useState(false)
  const time = new Date(p.posted_at || p.scheduled_for).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <motion.div className={'card qcard' + (open ? ' open' : '')} layout>
      <button className="qhead" onClick={() => setOpen(o => !o)}>
        <span className="status-dot" style={{ background: platformDot(p.platform || 'x') }} />
        <span className="qtime">{time}</span>
        <span className="qtitle">{titleOf(p.content)}</span>
        {p.metrics_at && (p.likes || p.reposts) ? <span className="qmeta">♥ {p.likes || 0}</span> : null}
        <ChevronDown size={15} className="qchev" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'var(--faint)', flex: 'none' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
            <div className="qbody">
              {Array.isArray(p.image_urls) && p.image_urls.length > 1
                ? <div className="ss-preview" style={{ marginBottom: 8 }}>{p.image_urls.map((u, k) => <img key={k} src={u} className="ss-slide" alt={`slide ${k + 1}`} />)}</div>
                : p.image_url && <img src={p.image_url} className="qcard-img" alt="" />}
              <div className="card-body">{p.content}</div>
              <div className="muted tiny" style={{ marginTop: 7 }}>
                Posted {fmt(p.posted_at || p.scheduled_for)}{sourceMeta(p).label !== 'You' ? ` · via ${sourceMeta(p).label.toLowerCase()}` : ''}
                {p.external_id && (p.platform || 'x') === 'x' ? <> · <a className="link" href={`https://x.com/i/web/status/${p.external_id}`} target="_blank" rel="noreferrer">view</a></> : ''}
              </div>
              {p.metrics_at && <div className="row" style={{ gap: 12, marginTop: 7, fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}><span>♥ {p.likes || 0}</span><span>↻ {p.reposts || 0}</span><span>💬 {p.replies || 0}</span>{p.impressions ? <span>{p.impressions.toLocaleString()} views</span> : null}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

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
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden', paddingTop: 8 }}>
            {posted.map(p => <PostedRow key={p.id} p={p} />)}
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

function SlideshowStudio({ accounts, configured, slideshows, onConnect, onSync, onGenerate, onSave, onDelete, hideAccounts, platformFocus }) {
  const [topic, setTopic] = useState('')
  const [format, setFormat] = useState('listicle'); const [style, setStyle] = useState('bold')
  const [count, setCount] = useState(6)
  const [busy, setBusy] = useState(false); const [deck, setDeck] = useState(null) // {slides,caption,image_urls,style,format}
  const [pickedAccts, setPickedAccts] = useState([]); const [when, setWhen] = useState('')

  // Every platform that takes an image carousel — Instagram, TikTok, LinkedIn, Facebook.
  // On a platform tab, that platform's accounts are the default target and the
  // rest become an explicit "Cross-post to" choice.
  const igLike = accounts.filter(a => ['instagram', 'tiktok', 'linkedin', 'facebook'].includes(a.platform))
  const focusAccts = platformFocus ? igLike.filter(a => a.platform === platformFocus) : igLike
  const crossAccts = platformFocus ? igLike.filter(a => a.platform !== platformFocus) : []
  const toggleAcct = id => setPickedAccts(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  async function gen() {
    if (!topic.trim()) return
    setBusy(true); setDeck(null)
    const d = await onGenerate({ topic: topic.trim(), format, style, slides: Number(count) })
    setBusy(false)
    if (d.error) return
    setDeck({ ...d, topic: topic.trim() })
    if (platformFocus) setPickedAccts(focusAccts.map(a => a.id)) // this tab's platform is pre-selected
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
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {SLIDESHOW_FORMATS.map(f => (
            <button key={f.key} type="button" className={'chip' + (format === f.key ? ' on' : '')} title={f.desc} onClick={() => setFormat(f.key)}>{f.label}</button>
          ))}
        </div>
        <label className="ob-label">Style</label>
        <div className="sw-row">
          {SLIDE_STYLE_LIST.map(s => (
            <button key={s.key} type="button" className={'sw-tile' + (style === s.key ? ' on' : '')} onClick={() => setStyle(s.key)} title={s.ai ? 'AI-generated backgrounds' : 'Typographic template'}>
              <span className="sw-tile-swatch" style={{ background: s.swatch.startsWith('linear') ? undefined : s.swatch, backgroundImage: s.swatch.startsWith('linear') ? s.swatch : undefined, color: s.fg }}>Aa</span>
              <span className="sw-tile-label">{s.label}{s.ai ? ' ✨' : ''}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 5 }}>
            {[4, 5, 6, 8].map(n => <button key={n} type="button" className={'chip' + (Number(count) === n ? ' on' : '')} onClick={() => setCount(n)}>{n}</button>)}
            <span className="muted tiny" style={{ marginLeft: 4 }}>slides</span>
          </div>
          <button className="btn-primary btn-sm" disabled={busy || !topic.trim()} onClick={gen}>{busy ? <span className="dots"><i/><i/><i/></span> : <><Wand2 size={13} /> Generate</>}</button>
        </div>
      </div>

      {/* Preview + schedule */}
      {deck && (
        <motion.div className="card camp-form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="ss-preview">
            {deck.imageUrls.map((u, i) => <img key={i} src={u} alt={`slide ${i + 1}`} className="ss-slide" />)}
          </div>
          <label className="ob-label" style={{ marginTop: 12 }}>Caption <span className="muted tiny" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· edit before posting</span></label>
          <textarea className="field" rows={4} style={{ lineHeight: 1.5 }} value={deck.caption || ''} onChange={e => setDeck(d => ({ ...d, caption: e.target.value }))} />
          {igLike.length > 0 && <>
            <div className="muted tiny" style={{ margin: '12px 0 6px' }}>Post to:</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {focusAccts.map(a => <button key={a.id} type="button" className={'chip' + (pickedAccts.includes(a.id) ? ' on' : '')} onClick={() => toggleAcct(a.id)}><span className="status-dot" style={{ background: platformDot(a.platform) }} />{a.username || a.platform}</button>)}
            </div>
            {crossAccts.length > 0 && <>
              <div className="muted tiny" style={{ margin: '10px 0 6px' }}>Cross-post to:</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {crossAccts.map(a => <button key={a.id} type="button" className={'chip' + (pickedAccts.includes(a.id) ? ' on' : '')} onClick={() => toggleAcct(a.id)}><span className="status-dot" style={{ background: platformDot(a.platform) }} />{a.username || a.platform} · {a.platform}</button>)}
              </div>
            </>}
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
        const recent = (replies || []).filter(r => r.platform === pl && (r.status === 'posted' || r.reply_text)).slice(0, 6)
        return (
          <div className={'ar-block card' + (s.enabled ? ' on' : '')} key={pl}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div className="row" style={{ gap: 10, minWidth: 0 }}>
                <span className="status-dot" style={{ background: platformDot(pl), marginTop: 5 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label[pl]}</div>
                  <div className="muted tiny">{!has ? 'No account connected' : s.enabled ? 'Posts a reply automatically the moment someone comments' : 'Auto-reply to comments in your voice'}</div>
                </div>
              </div>
              <Toggle on={!!s.enabled} onChange={v => onToggle(pl, { enabled: v })} />
            </div>
            {s.enabled && (
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  {s.running
                    ? <span className="live-status on" style={{ margin: 0 }}><Loader2 size={11} className="spin" /> {str(s.status_detail) || 'Checking comments…'}</span>
                    : <span className="muted tiny">{recent.length ? `${recent.length} recent repl${recent.length === 1 ? 'y' : 'ies'}` : 'Watching for new comments…'}</span>}
                  <button className="mini" disabled={!has} onClick={() => onRun(pl)}><RefreshCw size={11} /> Check now</button>
                </div>
                {recent.map(d => (
                  <div className="ar-draft" key={d.id}>
                    <div className="ar-comment"><span className="ar-author">@{authorHandle(d.comment_author)}</span>{str(d.comment_text) ? ' · ' + str(d.comment_text).slice(0, 130) : ''}</div>
                    <div className="ar-reply">{str(d.reply_text)}</div>
                    {d.status !== 'posted' && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn-primary btn-sm" onClick={() => onPostDraft(d.id)}>Reply now</button></div>}
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
// ── Standardized account UI — ONE card shape for every platform ──────────────
// Icon + @handle + badges on the left, the same Connect/Disconnect affordances
// on the right, across X, LinkedIn, Instagram, and TikTok.
const PLATFORM_GLYPH = { x: <XGlyph />, linkedin: <LIcon size={15} />, instagram: <IGGlyph />, tiktok: <TTGlyph /> }
function AccountRow({ platform, title, badges = null, subtitle, actions }) {
  return (
    <div className="conn-card card" style={{ marginBottom: 8 }}>
      <div className={`conn-icon acct-ic ${platform}`}>{PLATFORM_GLYPH[platform] || <Bot size={14} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="conn-title row" style={{ gap: 6, overflow: 'hidden' }}>{title}{badges}</div>
        {subtitle && <div className="muted tiny">{subtitle}</div>}
      </div>
      {actions}
    </div>
  )
}
const ConnectBtn = ({ onClick, disabled, children, title }) => (
  <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', marginBottom: 6 }} disabled={disabled} onClick={onClick} title={title}><Plus size={14} /> {children}</button>
)

// One X inspiration slot — mirrors the LinkedIn mentor slots: empty = inline
// add field, filled = a standard account card with remove.
function XInspoSlot({ account, onAdd, onRemove }) {
  const [val, setVal] = useState(''); const [busy, setBusy] = useState(false)
  async function add() { if (!val.trim()) return; setBusy(true); const ok = await onAdd('x', val.trim()); setBusy(false); if (ok) setVal('') }
  if (account) return (
    <AccountRow platform="x" title={`@${account.handle}`} subtitle="watched · read-only"
      actions={<button className="mini danger" onClick={() => onRemove(account.id)}><Trash2 size={11} /></button>} />
  )
  return (
    <div className="slot-empty">
      <div className="conn-icon acct-ic ghosted"><XGlyph /></div>
      <input className="field" placeholder="@creator to study" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} style={{ flex: 1, minWidth: 0 }} />
      <button className="btn-primary btn-sm" disabled={busy || !val.trim()} onClick={add}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Add'}</button>
    </div>
  )
}

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
function StatTiles({ tiles, vertical }) {
  // Vertical (X tab, beside the brain): one calm panel with hairline rows —
  // not three boxy tiles with heavy top bars.
  if (vertical) return (
    <div className="stat-col card">
      {tiles.map((t, i) => (
        <div className="stat-col-row" key={i}>
          <span className="stat-col-num">{t.value}</span>
          <span className="stat-col-lbl">{t.label}</span>
        </div>
      ))}
    </div>
  )
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

// Brand voice/identity options (researched for personal-brand positioning).
const TONE_OPTS = ['authoritative', 'witty', 'contrarian', 'warm', 'vulnerable', 'analytical', 'bold', 'helpful', 'irreverent', 'inspirational', 'no-nonsense', 'story-driven']
const GOAL_OPTS = ['Grow my audience', 'Build authority', 'Generate leads', 'Drive signups', 'Build community']

// ── Brand onboarding — before the brain speaks for you autonomously, it learns
// who you are and how you want to be portrayed: positioning, audience, content
// pillars, personality, goal, cadence, and boundaries. Researched from brand-
// voice + content-strategy best practice. Shown at signup; required before
// Autopilot. ─────────────────────────────────────────────────────────────────
function BrandOnboarding({ initial, busy, onSave, onClose }) {
  const [step, setStep] = useState(0)
  const [f, setF] = useState({
    positioning: initial?.positioning || '', audience: initial?.audience || '',
    pillars: (initial?.pillars || []).join('\n'), tone: initial?.tone || [],
    goal: initial?.goal || '', avoid: initial?.avoid || '',
    per_run: initial?.per_run || 1, comments_per_day: initial?.comments_per_day ?? 4, interval_hours: initial?.interval_hours || 24,
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const toggleTone = t => set('tone', f.tone.includes(t) ? f.tone.filter(x => x !== t) : [...f.tone, t].slice(0, 4))
  function submit() {
    onSave({
      brief: { positioning: f.positioning.trim(), audience: f.audience.trim(), pillars: f.pillars.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 5), tone: f.tone, goal: f.goal, avoid: f.avoid.trim() },
      cadence: { per_run: Number(f.per_run), interval_hours: 24 },
    })
  }
  return (
    <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card modal" style={{ width: 480 }} onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={spring}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 15.5 }}>Set up Autopilot</span>
          <button className="x-close" onClick={onClose}><LX size={18} /></button>
        </div>
        <div className="muted tiny" style={{ marginBottom: 14 }}>Before Cadence speaks for you, tell it who you are and how you want to come across.</div>
        <div className="onb-dots" style={{ marginBottom: 16 }}>{[0, 1, 2].map(i => <span key={i} className={'ob-dot' + (i <= step ? ' on' : '')} />)}</div>
        {step === 0 && (<>
          <div className="onb-q">Who are you, and how do you want to be seen?</div>
          <label className="onb-label">Your positioning</label>
          <textarea className="field dp-grow" rows={2} autoFocus placeholder="e.g. the founder who shows the unglamorous reality of building an AI startup" value={f.positioning} onChange={e => set('positioning', e.target.value)} />
          <label className="onb-label">Who you're talking to</label>
          <input className="field" placeholder="e.g. early-stage founders & operators" value={f.audience} onChange={e => set('audience', e.target.value)} />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><button className="btn-primary btn-sm" disabled={!f.positioning.trim()} onClick={() => setStep(1)}>Next →</button></div>
        </>)}
        {step === 1 && (<>
          <div className="onb-q">What do you talk about, and how?</div>
          <label className="onb-label">Content pillars <span className="muted tiny" style={{ fontWeight: 400 }}>· one per line, 3–5</span></label>
          <textarea className="field dp-grow" rows={4} placeholder={'lessons from building\ncontrarian takes on startup advice\nbehind-the-scenes wins and failures'} value={f.pillars} onChange={e => set('pillars', e.target.value)} />
          <label className="onb-label">Personality <span className="muted tiny" style={{ fontWeight: 400 }}>· pick up to 4</span></label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{TONE_OPTS.map(t => <button key={t} type="button" className={'chip' + (f.tone.includes(t) ? ' on' : '')} onClick={() => toggleTone(t)}>{t}</button>)}</div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}><button className="mini" onClick={() => setStep(0)}>← Back</button><button className="btn-primary btn-sm" onClick={() => setStep(2)}>Next →</button></div>
        </>)}
        {step === 2 && (<>
          <div className="onb-q">Your goal and cadence</div>
          <label className="onb-label">What's the goal?</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{GOAL_OPTS.map(g => <button key={g} type="button" className={'chip' + (f.goal === g ? ' on' : '')} onClick={() => set('goal', g)}>{g}</button>)}</div>
          <label className="onb-label">How often</label>
          <div className="ap-row">
            <span className="ap-rowlabel">Posts per day</span>
            <Stepper value={Number(f.per_run) || 1} min={1} max={3} onChange={v => set('per_run', v)} />
          </div>
          <label className="onb-label">Anything to avoid <span className="muted tiny" style={{ fontWeight: 400 }}>· optional</span></label>
          <input className="field" placeholder="e.g. politics, dunking on competitors" value={f.avoid} onChange={e => set('avoid', e.target.value)} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}><button className="mini" onClick={() => setStep(1)}>← Back</button><button className="btn-primary btn-sm" disabled={busy} onClick={submit}>{busy ? <Loader2 size={13} className="spin" /> : 'Turn on Autopilot'}</button></div>
        </>)}
      </motion.div>
    </motion.div>
  )
}

// ── Stepper — compact − value + control for small counts (posts/day, etc.)
function Stepper({ value, min = 1, max = 9, onChange }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Fewer">−</button>
      <span className="stepper-val">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="More">+</button>
    </div>
  )
}

// ── Autopilot body — cadence settings. The on/off toggle (in the section
// header) IS the autopost switch — when on, Cadence writes AND publishes. No
// second toggle. Comments live under Engage. Gated behind brand onboarding.
function AutopilotBody({ row, onToggle, onEditBrief }) {
  const perDay = row.per_run || 1
  return (
    <>
      <div className="muted tiny" style={{ marginBottom: 12 }}>Writes posts in your voice and publishes them across your best times.{row?.enabled && row?.status_detail ? ` · ${row.status_detail}` : ''}</div>
      <div className="ap-row">
        <span className="ap-rowlabel">Posts per day</span>
        <Stepper value={perDay} min={1} max={3} onChange={v => onToggle({ per_run: v, interval_hours: 24 })} />
      </div>
      <button className="ap-edit" onClick={onEditBrief}>Edit your brand brief →</button>
    </>
  )
}

// Recent comments/replies feed — what the engagement engine is replying to.
function RepliesFeed({ posts, platform = 'x', source }) {
  const replies = posts.filter(p => p.reply_to_tweet_id && (p.platform || 'x') === platform && (!source || p.source === source))
    .sort((a, b) => new Date(b.created_at || b.scheduled_for) - new Date(a.created_at || a.scheduled_for)).slice(0, 6)
  if (!replies.length) return <div className="muted tiny" style={{ marginTop: 8 }}>No replies yet — they'll show up here as they go out.</div>
  return (
    <div className="reply-feed">
      <div className="reply-feed-h">Recent replies</div>
      {replies.map(p => {
        const s = STATUS[p.status] || { c: '#9ca3af', label: p.status }
        return (
          <div className="reply-feed-row" key={p.id}>
            <span className="status-dot" style={{ background: s.c, marginTop: 5, flex: 'none' }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              {p.target_tweet_text && <a className="reply-feed-ctx" href={p.target_tweet_url || '#'} target="_blank" rel="noreferrer">↳ {p.target_tweet_text.slice(0, 70)}</a>}
              <div className="reply-feed-text">{p.content}</div>
            </div>
            <span className="muted tiny" style={{ flex: 'none' }}>{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// Single-platform campaign: promote a topic on the user's OWN account for this
// platform, in their voice, on a cadence. Reuses the brand-campaign engine with
// targets locked to this tab's platform.
// Minimal by design: one topic box, a cadence, go. The campaign name derives
// from the topic; carousel style/format and images use sane defaults instead
// of asking — the engine is the product, not the form.
const CADENCES = [[12, '2× a day'], [24, 'Daily'], [72, 'Every 3 days'], [168, 'Weekly']]
const cadenceLabel = hrs => (CADENCES.find(([h]) => h === Number(hrs)) || [])[1] || `every ${hrs}h`

function PlatformCampaign({ campaigns, targets, supportsCarousel, canCreate, connectHint, onSave, onPatch, onDelete, onRun }) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [hours, setHours] = useState(24)
  const [picked, setPicked] = useState([]); const [busy, setBusy] = useState(false)
  const single = targets.length === 1
  function startNew() { setPicked(targets.map(t => t.id)); setOpen(true) }
  const chosen = single ? targets : targets.filter(t => picked.includes(t.id))
  async function submit() {
    if (!topic.trim() || !chosen.length) return
    setBusy(true)
    const t = topic.trim()
    const payload = {
      name: t.length > 42 ? t.slice(0, 42).trimEnd() + '…' : t,
      topic: t,
      targets: chosen.map(t => ({ kind: t.kind, id: t.id, platform: t.platform })),
      interval_hours: Number(hours), include_image: false, active: true,
    }
    if (supportsCarousel) { payload.carousel_style = 'bold'; payload.carousel_format = 'listicle' }
    const ok = await onSave(payload)
    setBusy(false)
    if (ok) { setOpen(false); setTopic(''); setPicked([]) }
  }
  return (
    <>
      {campaigns.map(c => (
        <div className={'card camp-card' + (c.active ? ' on' : '')} key={c.id} style={{ display: 'block' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div className="conn-title">{c.name}</div>
              {c.status_detail && <div className="muted tiny" style={{ marginTop: 4 }}>{c.running && <Loader2 size={10} className="spin" />} {c.status_detail}</div>}
            </div>
            <Toggle on={!!c.active} onChange={v => onPatch(c.id, { active: v })} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <span className="muted tiny" style={{ marginRight: 'auto' }}>{cadenceLabel(c.interval_hours)}</span>
            <button className="mini" onClick={() => onRun(c.id)} disabled={c.running}><Play size={11} /> Run now</button>
            <button className="mini danger" onClick={() => onDelete(c.id)}><Trash2 size={12} /></button>
          </div>
        </div>
      ))}
      {open ? (
        <div className="card camp-form">
          <textarea className="field" rows={2} placeholder="What should it promote? (written in your voice)" value={topic} onChange={e => setTopic(e.target.value)} autoFocus />
          {!single && (<>
            <label className="ob-label">Post to</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {targets.map(t => <button type="button" key={t.id} className={'chip' + (picked.includes(t.id) ? ' on' : '')} onClick={() => setPicked(p => p.includes(t.id) ? p.filter(x => x !== t.id) : [...p, t.id])}><span className="status-dot" style={{ background: platformDot(t.platform) }} />{t.label}</button>)}
            </div>
          </>)}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {CADENCES.map(([h, l]) => <button type="button" key={h} className={'chip' + (Number(hours) === h ? ' on' : '')} onClick={() => setHours(h)}>{l}</button>)}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="mini" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={busy || !topic.trim() || !chosen.length} onClick={submit}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Start campaign'}</button>
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
function Section({ title, hint, badge, toggle, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="sec card" style={{ padding: 0, marginBottom: 10, overflow: 'hidden' }}>
      <div className="sec-head" role="button" tabIndex={0} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
        <span className="sec-title">{title}</span>
        {hint && <span className="muted tiny" style={{ fontWeight: 400 }}>{hint}</span>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {badge}
          {toggle && <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}><Toggle on={toggle.on} onChange={toggle.onChange} /></span>}
          <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }} />
        </span>
      </div>
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
// Edit styles applied on top of clips — five formats, each a genuinely
// different essence (not caption variants). Pick one or several; clips rotate
// through the chosen set. Copy on the cards is AI-written from the transcript.
const EDIT_FORMAT_LIST = [
  { key: 'captions', label: 'Captions', desc: 'word-by-word bold captions, yellow highlight' },
  { key: 'cold_open', label: 'Cold open', desc: 'bold full-screen hook card, then cuts to your clip' },
  { key: 'sludge', label: 'Sludge split', desc: 'your clip on top, gameplay underneath' },
  { key: 'tweet', label: 'Tweet quote', desc: 'a real viral-tweet screenshot pinned over the clip' },
  { key: 'thread', label: 'Thread', desc: 'a 2-3 tweet mini-thread that advances with the clip' },
  { key: 'reddit', label: 'Reddit story', desc: 'r/ story card opens the clip, captions carry it' },
]
function ClipStudio({ jobs, accounts, configured, onCreate, onUpload, onDelete, onPost, platformFocus }) {
  const [url, setUrl] = useState(''); const [fileName, setFileName] = useState('')
  const [format, setFormat] = useState('vertical'); const [len, setLen] = useState('short'); const [maxClips, setMaxClips] = useState(3)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null); const logoRef = useRef(null)
  const postable = accounts.filter(a => ['instagram', 'tiktok'].includes(a.platform))
  // On a platform tab: that platform posts first-class, the other is cross-post.
  const focusPost = platformFocus ? postable.filter(a => a.platform === platformFocus) : postable
  const crossPost = platformFocus ? postable.filter(a => a.platform !== platformFocus) : []
  const [edits, setEdits] = useState(['captions', 'sludge'])
  const [wmOn, setWmOn] = useState(true); const [watermark, setWatermark] = useState('')
  const [outroOn, setOutroOn] = useState(false); const [logoUrl, setLogoUrl] = useState(''); const [logoBusy, setLogoBusy] = useState(false)
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
  async function pickLogo(e) {
    const f = e.target.files?.[0]; if (!f) return
    setLogoBusy(true)
    const u = await onUpload(f)
    setLogoBusy(false)
    if (u) setLogoUrl(u)
    e.target.value = ''
  }
  async function go() {
    if (!url.trim()) return
    setBusy(true)
    const ok = await onCreate({
      source_url: url.trim(), source_name: fileName || null, format,
      target_len: len, max_clips: Number(maxClips), captions: true,
      edit_formats: edits,
      watermark: wmOn ? ((watermark || wmDefault).trim() || null) : null,
      outro: outroOn, outro_logo_url: outroOn ? (logoUrl || null) : null,
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
        <label className="ob-label">Edit style <span style={{ fontWeight: 400, color: '#A39E94' }}>· pick one or more — clips rotate through them</span></label>
        <div className="ss-grid">
          {EDIT_FORMAT_LIST.map(f => (
            <button key={f.key} type="button" className={'style-opt' + (edits.includes(f.key) ? ' on' : '')} onClick={() => toggleEdit(f.key)}>
              <span className={'mini-check' + (edits.includes(f.key) ? ' on' : '')}>{edits.includes(f.key) && <LCheck size={10} strokeWidth={4} />}</span>
              <span><span className="style-name">{f.label}</span><span className="style-desc">{f.desc}</span></span>
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 7, fontSize: 12.5, flex: 'none' }}><Toggle on={wmOn} onChange={setWmOn} /> Watermark</label>
          {wmOn && <input className="field" style={{ flex: 1, minWidth: 160 }} placeholder={wmDefault ? `default ${wmDefault}` : '@yourhandle'} value={watermark} onChange={e => setWatermark(e.target.value)} />}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 7, fontSize: 12.5, flex: 'none' }} title="Every clip ends on a 1.6s card with your logo and a chime"><Toggle on={outroOn} onChange={setOutroOn} /> Brand outro</label>
          {outroOn && (<>
            {logoUrl && <img src={logoUrl} alt="logo" style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'cover', border: '1px solid var(--line2)' }} />}
            <button className="btn-ghost btn-sm" disabled={logoBusy} onClick={() => logoRef.current?.click()}>{logoBusy ? <Loader2 size={12} className="spin" /> : <Upload size={12} />} {logoUrl ? 'Change logo' : 'Upload logo'}</button>
            <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickLogo} />
            <span className="muted tiny">ends every clip on your logo + a chime</span>
          </>)}
        </div>
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
          {j.status === 'failed' && <div className="muted tiny" style={{ marginTop: 6, color: '#B3372F' }}>{j.error}</div>}
          {j.status === 'done' && (
            <div className="clip-grid">
              {(j.clips || []).map((c, i) => (
                <div className="clip-card" key={i}>
                  <video src={c.url} controls preload="metadata" className="clip-vid" />
                  <div style={{ fontWeight: 600, fontSize: 12.5, margin: '6px 0 2px' }}>{c.title}</div>
                  <div className="muted tiny">{c.end - c.start}s{c.edit ? ` · ${(EDIT_FORMAT_LIST.find(f => f.key === c.edit) || {}).label || c.edit}` : ''}{c.caption ? ` · ${c.caption.slice(0, 60)}` : ''}</div>
                  {postable.length > 0 && configured && (
                    <div className="row" style={{ gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                      {focusPost.map(a => (
                        <button key={a.id} className="chip" style={{ fontSize: 11 }} onClick={() => onPost(j.id, i, [a.id])}>
                          <span className="status-dot" style={{ background: platformDot(a.platform) }} />Post @{a.username}
                        </button>
                      ))}
                      {crossPost.map(a => (
                        <button key={a.id} className="chip" style={{ fontSize: 11 }} title={`Cross-post this clip to ${a.platform}`} onClick={() => onPost(j.id, i, [a.id])}>
                          <span className="status-dot" style={{ background: platformDot(a.platform) }} />Cross-post @{a.username}
                        </button>
                      ))}
                      {focusPost.length > 0 && crossPost.length > 0 && (
                        <button className="chip" style={{ fontSize: 11, fontWeight: 600 }} title="Post to every connected account at once" onClick={() => onPost(j.id, i, postable.map(a => a.id))}>
                          Post everywhere
                        </button>
                      )}
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

// ── Trend formats — what's working now, reverse-engineered into reusable
// patterns. Video formats carry a render-style badge (use it on a clip);
// text/ad patterns feed generation automatically. ───────────────────────────
const RENDER_LABEL = { captions: 'Captions', cold_open: 'Cold open', sludge: 'Sludge split', tweet: 'Tweet quote', thread: 'Thread', reddit: 'Reddit story' }
function TrendFormats({ platform, formats, busy, canScan, onScan, onDelete }) {
  const mine = formats.filter(f => f.platform === platform || (platform === 'instagram' && f.platform === 'meta_ads'))
  const isVideo = platform === 'instagram' || platform === 'tiktok'
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="muted tiny">{mine.length ? `${mine.length} format${mine.length === 1 ? '' : 's'} banked` : 'Nothing banked yet'}</span>
        {canScan
          ? <button className="mini accent" disabled={busy} onClick={onScan}>{busy ? <><Loader2 size={11} className="spin" /> Scanning…</> : <><RefreshCw size={11} /> Scan {platform === 'tiktok' ? 'TikTok' : 'Instagram'} now</>}</button>
          : <span className="muted tiny">Paste a post link in chat to learn one</span>}
      </div>
      {mine.length === 0 && <div className="muted tiny" style={{ padding: '2px 0 4px' }}>{isVideo ? 'Scan to reverse-engineer the top viral formats in your niche — each maps to a clip style you can apply.' : 'Ask the chat to “study this post” with a link, or scan a platform — winning hook patterns feed your drafts automatically.'}</div>}
      {mine.map(f => (
        <div className="trend-card card" key={f.id}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="trend-name">{f.name}</div>
              {f.summary && <div className="muted tiny" style={{ marginTop: 2, lineHeight: 1.5 }}>{f.summary.slice(0, 150)}</div>}
            </div>
            <button className="hist-del" title="Forget this format" onClick={() => onDelete(f.id)}><Trash2 size={12} /></button>
          </div>
          {f.payoff && <div className="trend-payoff"><span>Payoff</span> {f.payoff}</div>}
          {f.pattern && <div className="trend-pattern">{f.pattern.slice(0, 360)}</div>}
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {f.archetype && <span className="trend-badge arch">{f.archetype}</span>}
            {f.render_style && RENDER_LABEL[f.render_style] && <span className="trend-badge render"><Wand2 size={10} /> {RENDER_LABEL[f.render_style]}</span>}
            {f.kind === 'ad' && <span className="trend-badge ad">Ad format</span>}
            {f.metrics?.views ? <span className="trend-badge">{fmtNum(f.metrics.views)} views</span> : null}
            {f.example_url && <a className="trend-badge link" href={f.example_url} target="_blank" rel="noreferrer">source ↗</a>}
          </div>
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
// ── Niche engagement — YOUR account comments on relevant posts in your niche.
// Slim front-end over the engagement_rules engine (keywords + watched accounts
// ── Tag input — type + Enter/comma to add a removable chip (handles, keywords).
function TagInput({ value, onChange, placeholder, max = 8, prefix = '' }) {
  const [draft, setDraft] = useState('')
  function add(raw) {
    const parts = String(raw).split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean)
    if (!parts.length) { setDraft(''); return }
    const next = [...value]
    for (const p of parts) if (next.length < max && !next.some(x => x.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next); setDraft('')
  }
  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) { e.preventDefault(); add(draft) }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div className="taginput">
      {value.map((v, i) => (
        <span className="tag" key={i}>{prefix}{v}<button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove"><LX size={11} /></button></span>
      ))}
      {value.length < max && (
        <input className="tag-input" value={draft} placeholder={value.length ? '' : placeholder} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft.trim() && add(draft)} />
      )}
    </div>
  )
}

// ── Engage in your niche — body for the collapsible section. Keywords +
// accounts to always reply to (as chips). The on/off toggle lives in the
// section header. Replies post immediately to ride the wave. ─────────────────
function EngageBody({ rule, xReadEnabled, posts, onPatch }) {
  const [kw, setKw] = useState([])
  const [handles, setHandles] = useState([])
  useEffect(() => {
    setKw(rule?.target_keywords || [])
    setHandles((rule?.target_handles || []).map(h => String(h).replace(/^@/, '')))
  }, [rule?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  function save(k, h) { if (rule?.id) onPatch(rule.id, { target_keywords: k, target_handles: h.slice(0, 5), auto_post: true }) }
  function setKwSaved(v) { setKw(v); save(v, handles) }
  function setHandlesSaved(v) { setHandles(v); save(kw, v) }
  return (
    <>
      {!rule?.id && <div className="muted tiny" style={{ marginBottom: 8 }}>Turn it on, then add what to watch.</div>}
      <div className="ap-row">
        <span className="ap-rowlabel">Replies per day</span>
        <Stepper value={rule?.replies_per_run || 4} min={1} max={12} onChange={v => rule?.id && onPatch(rule.id, { replies_per_run: v })} />
      </div>
      <label className="ob-label">Keywords <span className="muted tiny" style={{ fontWeight: 400 }}>· enter to add</span></label>
      <TagInput value={kw} onChange={setKwSaved} placeholder="AI agents, indie hacking…" max={8} />
      <label className="ob-label">Accounts to always reply to <span className="muted tiny" style={{ fontWeight: 400 }}>· up to 5</span></label>
      <TagInput value={handles} onChange={setHandlesSaved} placeholder="@handle…" max={5} prefix="@" />
      {!xReadEnabled && <div className="notice" style={{ marginTop: 8 }}>Needs X read access to find posts.</div>}
      {rule?.running && <div className="live-status on" style={{ marginTop: 8 }}><Loader2 size={11} className="spin" /> {str(rule.status_detail) || 'Finding posts…'}</div>}
      <RepliesFeed posts={posts} platform="x" source="engagement" />
    </>
  )
}

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
          <label className="ob-label">Accounts to watch <span style={{ fontWeight: 400, color: '#A39E94' }}>· up to 3</span></label>
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
// Agent identity: the account's REAL profile picture when stats have pulled
// it, else the AI persona portrait, else a deterministic colored initial.
function AgentAvatar({ agent, size = 40 }) {
  const name = agent?.persona?.name || agent?.name || 'A'
  const src = agent?.stats?.avatar || agent?.avatar_url
  if (src) return <img src={src} alt={name} className="agent-pfp" style={{ width: size, height: size }} />
  const hue = Math.abs([...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0)) % 360
  return (
    <span className="agent-pfp" style={{ width: size, height: size, background: `hsl(${hue} 48% 84%)`, color: `hsl(${hue} 52% 32%)`, fontSize: Math.round(size * 0.42) }}>
      {name[0]?.toUpperCase() || 'A'}
    </span>
  )
}

// Everything Cadence pushed to an agent's account (agent output, queue posts,
// suggestions) — matched by connection id, platform fallback for legacy rows.
function postsForAgent(posts, a) {
  return posts.filter(p => p.feeder_agent_id === a.id
    || (a.x_connection_id && p.x_connection_id === a.x_connection_id)
    || (a.social_account_id && (p.social_account_id === a.social_account_id || (!p.social_account_id && !p.x_connection_id && p.platform === (a.platform || '')))))
}
// Best second stat the platform exposes.
const agentTile2 = st => st?.posts != null ? [fmtNum(st.posts), 'Acct posts']
  : st?.reach30 != null ? [fmtNum(st.reach30), 'Reach · 30d'] : ['—', 'Acct posts']

// ── Agent profile — click any agent (fleet, roster) for the full picture:
// identity, live controls, stats, settings, reflections, and a clean
// activity timeline. One modal, every surface opens it. ──────────────────────
function AgentProfile({ agent, xConns, socialAccounts, campaigns = [], posts, onPatch, onRun, onReroll, onDelete, onClose }) {
  if (!agent) return null
  const p = agent.persona || {}
  const handle = agent.x_connection_id
    ? xConns.find(c => c.id === agent.x_connection_id)?.username
    : socialAccounts.find(s => s.id === agent.social_account_id)?.username
  const mine = postsForAgent(posts, agent)
  const live = mine.filter(x => x.status === 'posted')
  const pending = mine.filter(x => x.status !== 'posted')
  const st = agent.stats || {}
  const tile2 = agentTile2(st)
  const notes = (agent.memory || []).slice(-3).reverse()
  const camp = campaigns.find(c => c.id === agent.campaign_id)
  const isX = !!agent.x_connection_id
  return (
    <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card modal" style={{ width: 560 }} onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={spring}>
        <div className="row" style={{ gap: 13, alignItems: 'flex-start' }}>
          <AgentAvatar agent={agent} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 16.5 }}>{p.name || agent.name || 'Agent'}</span>
              {camp && <span className="role-badge" title="On a campaign mission">{camp.name}</span>}
            </div>
            <div className="muted tiny" style={{ marginTop: 2 }}>@{handle || '—'} · {agent.platform || 'x'}{p.archetype ? ` · ${p.archetype}` : ''}</div>
          </div>
          <button className="x-close" onClick={onClose}><LX size={18} /></button>
        </div>
        {p.bio && <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 10 }}>{p.bio}</div>}

        <div className="fleet-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)', margin: '14px 0 2px' }}>
          <div><b>{fmtNum(st.followers)}</b><span>Followers</span></div>
          <div><b>{tile2[0]}</b><span>{tile2[1]}</span></div>
          <div><b>{live.length}</b><span>Published</span></div>
          <div><b>{pending.length}</b><span>Queued</span></div>
        </div>

        <div className="set-section" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 7, fontSize: 12.5 }}><Toggle on={!!agent.active} onChange={v => onPatch(agent.id, { active: v }, v ? `${p.name || 'Agent'} is live` : `${p.name || 'Agent'} paused`)} /> Live</label>
            <label className="row" style={{ gap: 7, fontSize: 12.5 }}><Toggle on={!!agent.auto_post} onChange={v => onPatch(agent.id, { auto_post: v }, v ? 'Acts on its own' : 'Drafts for your review')} /> Autonomous</label>
            <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
              <RunNow running={agent.running} onRun={() => onRun(agent.id)} />
              <button className="mini" title="New persona" onClick={() => onReroll(agent.id)}><RefreshCw size={12} /></button>
              <button className="mini danger" title="Delete agent" onClick={() => { onDelete(agent.id); onClose() }}><Trash2 size={12} /></button>
            </div>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <label className="camp-num"><input type="number" min={0} max={6} className="field" value={agent.posts_per_day} onChange={e => onPatch(agent.id, { posts_per_day: e.target.value })} /> posts/day</label>
            {isX && <label className="camp-num"><input type="number" min={0} max={12} className="field" value={agent.replies_per_day} onChange={e => onPatch(agent.id, { replies_per_day: e.target.value })} /> replies/day</label>}
            <label className="camp-num">every <input type="number" min={1} className="field" value={agent.interval_hours} onChange={e => onPatch(agent.id, { interval_hours: e.target.value })} /> h</label>
            {isX && <label className="row" style={{ gap: 6, fontSize: 12 }}><Toggle on={!!agent.support_primary} onChange={v => onPatch(agent.id, { support_primary: v })} /> backs your primary</label>}
          </div>
        </div>

        <LiveStatus running={agent.running} detail={agent.status_detail} lastAt={agent.last_activity_at} />

        {notes.length > 0 && (
          <div className="set-section">
            <div className="set-h">What it's been thinking</div>
            {notes.map((n, i) => <div className="agent-note" key={i} style={{ marginTop: i ? 6 : 0 }}>“{n.note}”</div>)}
          </div>
        )}

        <div className="set-section">
          <div className="set-h">Activity</div>
          <ActivityList pending={pending.slice(0, 12)} live={live.slice(0, 12)} />
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Fleet strip — every feeder agent across platforms at a glance: real
// profile pictures ringed in their platform color, live dot, and a hover card
// with the numbers (followers, account posts, published/queued via Cadence).
// Click an agent to open its full profile.
function AgentFleet({ agents, xConns, socialAccounts, posts, onOpen }) {
  const [hover, setHover] = useState(null)
  const handleOf = a => a.x_connection_id
    ? xConns.find(c => c.id === a.x_connection_id)?.username
    : socialAccounts.find(s => s.id === a.social_account_id)?.username
  if (!agents.length) return null
  return (
    <div className="fleet card">
      <div className="conn-sec" style={{ margin: '0 0 12px' }}>Your fleet <span className="muted tiny" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {agents.length} agent{agents.length === 1 ? '' : 's'} across platforms</span></div>
      <div className="fleet-row">
        {agents.map(a => {
          const mine = postsForAgent(posts, a)
          const live = mine.filter(p => p.status === 'posted')
          const pending = mine.filter(p => p.status !== 'posted')
          const st = a.stats || {}
          const tile2 = agentTile2(st)
          return (
            <div key={a.id} className="fleet-cell" role="button" title="Open agent profile" onClick={() => onOpen && onOpen(a.id)} onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(h => (h === a.id ? null : h))}>
              <div className="fleet-ava" style={{ borderColor: platformDot(a.platform || 'x') }}>
                <AgentAvatar agent={a} size={52} />
                <span className={'fleet-dot' + (a.active ? ' on' : '')} title={a.active ? 'Live' : 'Paused'} />
              </div>
              <div className="fleet-name">{(a.persona?.name || a.name || 'Agent').split(' ')[0]}</div>
              <AnimatePresence>
                {hover === a.id && (
                  <motion.div className="card fleet-tip" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.14 }}>
                    <div className="row" style={{ gap: 9 }}>
                      <AgentAvatar agent={a} size={34} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.persona?.name || a.name || 'Agent'}</div>
                        <div className="muted tiny">@{handleOf(a) || '—'} · {a.platform || 'x'}{a.active ? ' · live' : ' · paused'}</div>
                      </div>
                    </div>
                    {a.persona?.archetype && <div className="muted tiny" style={{ marginTop: 7 }}>{a.persona.archetype}</div>}
                    <div className="fleet-stats">
                      <div><b>{fmtNum(st.followers)}</b><span>Followers</span></div>
                      <div><b>{tile2[0]}</b><span>{tile2[1]}</span></div>
                      <div><b>{live.length}</b><span>Published</span></div>
                      <div><b>{pending.length}</b><span>Queued</span></div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FeederAgents({ agents, xConns, posts, campaigns = [], onSpawn, onPatch, onDelete, onRun, onReroll }) {
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
              <div className="row" style={{ gap: 11, minWidth: 0, alignItems: 'flex-start' }}>
                <AgentAvatar agent={a} size={42} />
                <div style={{ minWidth: 0 }}>
                  <div className="conn-title row" style={{ gap: 7 }}>{p.name || a.name || 'Agent'}
                    {a.campaign_id && <span className="role-badge" title="On a campaign mission">{campaigns.find(cp => cp.id === a.campaign_id)?.name || 'campaign'}</span>}
                  </div>
                  <div className="muted tiny" style={{ marginTop: 2 }}>@{c.username}{p.archetype ? ` · ${p.archetype}` : ''}</div>
                  {lastNote && <div className="agent-note">“{lastNote}”</div>}
                </div>
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

// ── Agent campaigns: missions agents carry out across platforms ────────────────
const INTENSITY_OPTS = [
  ['subtle', 'Subtle', '~1 in 4 posts'],
  ['balanced', 'Balanced', 'about half'],
  ['loud', 'Loud', 'most posts'],
]
const INTENSITY_DESC = {
  subtle: 'A light touch — it comes up naturally about 1 in 4 posts.',
  balanced: 'A steady drumbeat — woven into roughly half their posting.',
  loud: 'Front and center — most posts orbit the mission.',
}

// Compose the structured brief inputs into the single line missionBlock reads.
function composeBriefClient({ pitch, audience, keyPoints, avoid }) {
  const pts = (keyPoints || '').split('\n').map(s => s.trim()).filter(Boolean)
  const parts = []
  if (pitch?.trim()) parts.push(pitch.trim())
  if (audience?.trim()) parts.push(`Who it's for: ${audience.trim()}`)
  if (pts.length) parts.push(`What lands: ${pts.join('; ')}`)
  if (avoid?.trim()) parts.push(`Avoid: ${avoid.trim()}`)
  return parts.join(' · ').slice(0, 600)
}

// ── Campaign onboarding — a clean 3-step brief so the agents promote with real
// substance, not "idk the promo". Step 1: what + (optional) AI auto-draft from
// the link. Step 2: the brief. Step 3: how hard to push + review. ─────────────
function CampaignOnboarding({ onCancel, onCreate, onDraft }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false); const [drafting, setDrafting] = useState(false)
  const [f, setF] = useState({ product: '', link: '', pitch: '', audience: '', keyPoints: '', avoid: '', intensity: 'balanced' })
  const [override, setOverride] = useState(null) // manual edits to the composed brief
  const set = (k, v) => { setF(s => ({ ...s, [k]: v })); setOverride(null) }
  const canDraft = (f.product.trim() || f.link.trim()) && !drafting
  const brief = override ?? composeBriefClient(f)

  async function autodraft() {
    if (!canDraft) return
    setDrafting(true)
    const d = await onDraft({ product: f.product, link: f.link })
    setDrafting(false)
    if (d && !d.error) {
      setF(s => ({ ...s, product: d.product || s.product, pitch: d.pitch || '', audience: d.audience || '', keyPoints: (d.key_points || []).join('\n'), avoid: d.avoid || '' }))
      setStep(1)
    }
  }
  async function submit() {
    const product = f.product.trim(); if (!product) return
    setBusy(true)
    const ok = await onCreate({
      product, name: product.length > 42 ? product.slice(0, 42).trimEnd() + '…' : product,
      link: f.link.trim() || null, brief, intensity: f.intensity, active: true,
    })
    setBusy(false)
    if (ok) onCancel()
  }

  return (
    <div className="card camp-onb">
      <div className="onb-dots" style={{ marginBottom: 16 }}>{[0, 1, 2].map(i => <span key={i} className={'ob-dot' + (i <= step ? ' on' : '')} />)}</div>

      {step === 0 && (<>
        <div className="onb-q">What are the agents promoting?</div>
        <input className="field" autoFocus placeholder="e.g. Cluey — the AI study copilot for students" value={f.product} onChange={e => set('product', e.target.value)} />
        <input className="field" style={{ marginTop: 8 }} placeholder="Link (optional — paste it and I'll draft the brief)" value={f.link} onChange={e => set('link', e.target.value)} />
        <button className="onb-draft" disabled={!canDraft} onClick={autodraft}>
          {drafting ? <><Loader2 size={14} className="spin" /> Reading + drafting the brief…</> : <><Sparkles size={14} /> Draft the brief for me</>}
        </button>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="mini" onClick={onCancel}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!f.product.trim()} onClick={() => setStep(1)}>Fill it in myself →</button>
        </div>
      </>)}

      {step === 1 && (<>
        <div className="onb-q">The brief <span className="muted tiny" style={{ fontWeight: 400 }}>· what the agents lean on</span></div>
        <label className="onb-label">The pitch</label>
        <input className="field" placeholder="One line: what it is and why it matters" value={f.pitch} onChange={e => set('pitch', e.target.value)} />
        <label className="onb-label">Who it's for</label>
        <input className="field" placeholder="e.g. CS students cramming for finals" value={f.audience} onChange={e => set('audience', e.target.value)} />
        <label className="onb-label">What lands <span className="muted tiny" style={{ fontWeight: 400 }}>· one point per line</span></label>
        <textarea className="field dp-grow" rows={3} placeholder={'cuts study time in half\nactually explains, doesn\'t just answer\nfree to start'} value={f.keyPoints} onChange={e => set('keyPoints', e.target.value)} />
        <label className="onb-label">Anything to avoid <span className="muted tiny" style={{ fontWeight: 400 }}>· optional</span></label>
        <input className="field" placeholder="e.g. don't call it a 'cheating' tool" value={f.avoid} onChange={e => set('avoid', e.target.value)} />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="mini" onClick={() => setStep(0)}>← Back</button>
          <button className="btn-primary btn-sm" onClick={() => setStep(2)}>Next →</button>
        </div>
      </>)}

      {step === 2 && (<>
        <div className="onb-q">How hard should they push it?</div>
        <div className="onb-intensity">
          {INTENSITY_OPTS.map(([k, l]) => (
            <button key={k} className={'onb-int' + (f.intensity === k ? ' on' : '')} onClick={() => set('intensity', k)}>
              <span className="onb-int-l">{l}</span>
              <span className="onb-int-d">{INTENSITY_DESC[k]}</span>
            </button>
          ))}
        </div>
        <label className="onb-label">Brief preview <span className="muted tiny" style={{ fontWeight: 400 }}>· this is what the agents read — edit freely</span></label>
        <textarea className="field dp-grow" rows={3} value={brief} onChange={e => setOverride(e.target.value)} placeholder="Add a pitch or points in the previous step to see the brief." />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="mini" onClick={() => setStep(1)}>← Back</button>
          <button className="btn-primary btn-sm" disabled={busy || !f.product.trim()} onClick={submit}>{busy ? <Loader2 size={13} className="spin" /> : 'Launch campaign'}</button>
        </div>
      </>)}
    </div>
  )
}

function AgentCampaigns({ campaigns, agents, xConns, socialAccounts, posts, onSaveCamp, onPatchCamp, onDeleteCamp, onSpawn, onPatchAgent, onRunAgent, onOpenAgent, onDraftCamp }) {
  const [form, setForm] = useState(null)        // create-campaign draft
  const [busy, setBusy] = useState(false)
  const [manageFor, setManageFor] = useState(null) // campaign id with the crew panel open
  const [editFor, setEditFor] = useState(null)      // campaign id being edited
  const [edit, setEdit] = useState({ product: '', link: '' })
  const [deployAcct, setDeployAcct] = useState('')  // 'x:<id>' | 's:<id>'
  const [deploySeed, setDeploySeed] = useState('')
  const [spawning, setSpawning] = useState(false)
  function startEdit(c) { setEdit({ product: c.product || '', link: c.link || '' }); setEditFor(c.id) }
  async function saveEdit(c) {
    const t = edit.product.trim()
    if (!t) return
    await onPatchCamp(c.id, { product: t, link: edit.link.trim() || null, name: t.length > 42 ? t.slice(0, 42).trimEnd() + '…' : t }, 'Campaign updated')
    setEditFor(null)
  }

  const handleOf = a => a.x_connection_id
    ? xConns.find(c => c.id === a.x_connection_id)?.username
    : socialAccounts.find(s => s.id === a.social_account_id)?.username
  // Accounts that could host a NEW agent.
  const freeX = xConns.filter(c => !c.is_primary && !agents.some(a => a.x_connection_id === c.id))
  const freeSocial = socialAccounts.filter(s => ['linkedin', 'instagram', 'tiktok'].includes(s.platform) && !agents.some(a => a.social_account_id === s.id))
  const unassigned = agents.filter(a => !a.campaign_id)

  async function create() {
    setBusy(true)
    const ok = await onSaveCamp(form)
    setBusy(false)
    if (ok) setForm(null)
  }
  async function deployNew(camp) {
    if (!deployAcct) return
    setSpawning(true)
    const [kind, id] = deployAcct.split(':')
    const payload = { interests: deploySeed.trim() || camp.product, campaign_id: camp.id }
    if (kind === 'x') payload.x_connection_id = id; else payload.social_account_id = id
    const ok = await onSpawn(payload)
    setSpawning(false)
    if (ok) { setDeployAcct(''); setDeploySeed('') }
  }

  return (
    <>
      {campaigns.length === 0 && !form && (
        <div className="brain-empty card" style={{ display: 'block' }}>
          <div className="empty-icon"><Bot size={26} /></div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>No campaigns yet</div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>A campaign is a mission: pick something to promote, deploy agents on your other accounts, and they weave it into their own posting — each in its own voice.</div>
        </div>
      )}

      {campaigns.map(c => {
        const roster = agents.filter(a => a.campaign_id === c.id)
        const live = roster.reduce((n, a) => n + activityFor(posts, 'feeder_agent_id', a.id).live.length, 0)
        const pending = roster.reduce((n, a) => n + activityFor(posts, 'feeder_agent_id', a.id).pending.length, 0)
        return (
          <div className={'card camp2' + (c.active ? ' live' : '')} key={c.id}>
            {editFor === c.id ? (
              <div>
                <textarea className="field" rows={2} placeholder="What are the agents promoting?" value={edit.product} onChange={e => setEdit(s => ({ ...s, product: e.target.value }))} autoFocus />
                <input className="field" style={{ marginTop: 8 }} placeholder="Link (optional)" value={edit.link} onChange={e => setEdit(s => ({ ...s, link: e.target.value }))} />
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                  <button className="mini" onClick={() => setEditFor(null)}>Cancel</button>
                  <button className="btn-primary btn-sm" disabled={!edit.product.trim()} onClick={() => saveEdit(c)}>Save</button>
                </div>
              </div>
            ) : (
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="camp2-title" role="button" title="Edit campaign" onClick={() => startEdit(c)}>
                <div className="camp2-name">{c.name} <Pencil size={12} className="camp2-pencil" /></div>
                <div className="camp2-sub">{c.product}{c.link ? ' · link attached' : ''}</div>
              </div>
              <button className={'live-pill' + (c.active ? ' on' : '')} title={c.active ? 'Pause the campaign' : 'Set it live'}
                onClick={() => onPatchCamp(c.id, { active: !c.active }, !c.active ? 'Campaign live — agents will pick it up' : 'Campaign paused — agents stay in character')}>
                {c.active && <span className="pulse" />}{c.active ? 'Live' : 'Paused'}
              </button>
              <button className="hist-del" title="Delete campaign" onClick={() => onDeleteCamp(c.id)}><Trash2 size={13} /></button>
            </div>
            )}

            <div className="camp2-row">
              <div className="facepile" role="button" title="Manage the crew" onClick={() => { setManageFor(manageFor === c.id ? null : c.id); setDeployAcct('') }}>
                {roster.slice(0, 6).map(a => <span key={a.id} title={a.persona?.name || a.name}><AgentAvatar agent={a} size={30} /></span>)}
                <span className="facepile-add"><Plus size={13} /></span>
              </div>
              <span className="camp2-stats"><b>{live}</b> posted · <b>{pending}</b> queued</span>
              <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                {INTENSITY_OPTS.map(([k, l, hint]) => (
                  <button key={k} className={'chip sm' + (c.intensity === k ? ' on' : '')} title={hint} onClick={() => onPatchCamp(c.id, { intensity: k })}>{l}</button>
                ))}
              </div>
            </div>

            <AnimatePresence initial={false}>
              {manageFor === c.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                  <div className="camp2-manage">
                    {roster.length === 0 && <div className="muted tiny" style={{ marginBottom: 6 }}>No agents on this mission yet.</div>}
                    {roster.map(a => {
                      const p = a.persona || {}
                      return (
                        <div className="row" key={a.id} style={{ gap: 9, padding: '5px 0', minWidth: 0 }}>
                          <div className="row" role="button" title="Open agent profile" style={{ gap: 9, minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => onOpenAgent && onOpenAgent(a.id)}>
                            <AgentAvatar agent={a} size={26} />
                            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || a.name}</span>
                            <span className="status-dot" style={{ background: platformDot(a.platform || 'x'), width: 6, height: 6 }} />
                            <span className="muted tiny" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{handleOf(a) || '—'}{a.active ? '' : ' · off'}</span>
                          </div>
                          <RunNow running={a.running} onRun={() => onRunAgent(a.id)} />
                          <button className="mini" title="Remove from campaign (agent keeps running)" onClick={() => onPatchAgent(a.id, { campaign_id: null })}><LX size={11} /></button>
                        </div>
                      )
                    })}
                    <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      {unassigned.length > 0 && (
                        <select className="field" style={{ width: 'auto', padding: '6px 10px', fontSize: 12.5 }} value="" onChange={e => e.target.value && onPatchAgent(e.target.value, { campaign_id: c.id }, 'Agent assigned to the mission')}>
                          <option value="">Assign an agent…</option>
                          {unassigned.map(a => <option key={a.id} value={a.id}>{(a.persona?.name || a.name)} · {a.platform || 'x'}</option>)}
                        </select>
                      )}
                      {(freeX.length > 0 || freeSocial.length > 0) && (<>
                        <select className="field" style={{ flex: 1, minWidth: 150 }} value={deployAcct} onChange={e => setDeployAcct(e.target.value)}>
                          <option value="">Deploy on account…</option>
                          {freeX.map(x => <option key={x.id} value={`x:${x.id}`}>X · @{x.username}</option>)}
                          {freeSocial.map(s => <option key={s.id} value={`s:${s.id}`}>{s.platform} · @{s.username || s.platform}</option>)}
                        </select>
                        {deployAcct && <input className="field" style={{ flex: 2, minWidth: 170 }} placeholder={`Its niche (default: ${c.product.slice(0, 40)})`} value={deploySeed} onChange={e => setDeploySeed(e.target.value)} />}
                        {deployAcct && <button className="btn-primary btn-sm" disabled={spawning} onClick={() => deployNew(c)}>{spawning ? <Loader2 size={13} className="spin" /> : 'Deploy'}</button>}
                      </>)}
                      {unassigned.length === 0 && freeX.length === 0 && freeSocial.length === 0 && roster.length === 0 && (
                        <span className="muted tiny">Connect a feeder X account or another social account to deploy an agent.</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}

      {/* Create — guided onboarding */}
      {form ? (
        <CampaignOnboarding onCancel={() => setForm(null)} onCreate={onSaveCamp} onDraft={onDraftCamp} />
      ) : (
        <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={() => setForm(true)}><Plus size={14} /> New campaign</button>
      )}
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
  const [windows, setWindows] = useState(Array.isArray(p.posting_windows) && p.posting_windows.length
    ? p.posting_windows
    : [{ start: '08:30', end: '10:30' }, { start: '12:00', end: '13:30' }, { start: '17:00', end: '19:30' }])
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
    await authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ full_name: name, role, goals, timezone: tz, default_post_hour: Number(hour), include_image_default: imgDefault, posting_windows: windows }) })
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
                <div className="set-row" style={{ alignItems: 'flex-start' }}>
                  <span>Posting windows<br /><span className="muted tiny" style={{ fontWeight: 400 }}>Cadence picks the exact moment inside these</span></span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    {windows.map((w, i) => (
                      <div className="row" key={i} style={{ gap: 6 }}>
                        <input type="time" className="field set-input" value={w.start} onChange={e => setWindows(ws => ws.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} />
                        <span className="muted tiny">–</span>
                        <input type="time" className="field set-input" value={w.end} onChange={e => setWindows(ws => ws.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} />
                        <button className="mini danger" disabled={windows.length <= 1} onClick={() => setWindows(ws => ws.filter((_, j) => j !== i))}><LX size={11} /></button>
                      </div>
                    ))}
                    {windows.length < 5 && <button className="mini" onClick={() => setWindows(ws => [...ws, { start: '20:00', end: '21:30' }])}><Plus size={11} /> Add window</button>}
                  </div>
                </div>
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
                      {c.needs_reconnect && <span className="role-badge" style={{ background: '#FAF3E4', color: '#8A6200' }}>Reconnect</span>}
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
  const [qPlatform, setQPlatform] = useState('all'); const [qView, setQView] = useState('list')
  const [showReplies, setShowReplies] = useState(false)
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
  const [agentCampaigns, setAgentCampaigns] = useState([])
  const [chatList, setChatList] = useState([]); const [historyOpen, setHistoryOpen] = useState(false)
  const [agentProfileId, setAgentProfileId] = useState(null) // open agent-profile modal
  const [trends, setTrends] = useState([]); const [scanning, setScanning] = useState('')
  const [autopilot, setAutopilot] = useState([]); const [apRunning, setApRunning] = useState('')
  const [brandOnb, setBrandOnb] = useState(false); const [brandSaving, setBrandSaving] = useState(false)
  const chatIdRef = useRef(null) // current saved-chat id; null until first save
  const inputRef = useRef(null); const bottomRef = useRef(null)
  const [leftPct, setLeftPct] = useState(47); const colsRef = useRef(null); const [dragging, setDragging] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)
  useEffect(() => { const v = localStorage.getItem('cadence_chat_open'); if (v === '0') setChatOpen(false) }, [])
  function toggleChat(open) { setChatOpen(open); localStorage.setItem('cadence_chat_open', open ? '1' : '0') }
  useEffect(() => { const v = Number(localStorage.getItem('cadence_split')); if (v >= 28 && v <= 72) setLeftPct(v) }, [])
  const startDrag = useCallback((e) => {
    e.preventDefault(); setDragging(true)
    const move = (ev) => {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX
      const rect = colsRef.current?.getBoundingClientRect(); if (!rect) return
      setLeftPct(Math.min(72, Math.max(28, ((cx - rect.left) / rect.width) * 100)))
    }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up)
      document.body.style.userSelect = ''; document.body.style.cursor = ''; setDragging(false)
      setLeftPct(p => { localStorage.setItem('cadence_split', String(Math.round(p))); return p })
    }
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
    document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up)
  }, [])

  const loadQueue = useCallback(async () => { const { data } = await supabase.from('posts').select('*').order('scheduled_for', { ascending: true, nullsLast: true }).limit(300); if (data) setPosts(data) }, [])
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
  const loadAgentCamps = useCallback(async () => { const r = await authed('/api/agent-campaigns'); const d = await r.json(); setAgentCampaigns(d.campaigns || []) }, [authed])
  const loadTrends = useCallback(async () => { try { const r = await authed('/api/trends'); const d = await r.json(); setTrends(d.formats || []) } catch {} }, [authed])
  const loadAutopilot = useCallback(async () => { try { const r = await authed('/api/autopilot'); const d = await r.json(); setAutopilot(d.autopilot || []) } catch {} }, [authed])

  useEffect(() => { loadQueue(); loadX(); loadLinkedIn(); loadMe(); loadPhotos(); loadEngagement(); loadSocial(); loadSlideshows(); loadSocialEng(); loadBrand(); loadInspoX(); loadClips(); loadAgents(); loadAgentCamps(); loadTrends(); loadAutopilot() }, [loadQueue, loadX, loadLinkedIn, loadMe, loadPhotos, loadEngagement, loadSocial, loadSlideshows, loadSocialEng, loadBrand, loadInspoX, loadClips, loadAgents, loadAgentCamps, loadTrends, loadAutopilot])

  // Capture the browser timezone once, so smart scheduling thinks in THEIR time.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (me?.profile && tz && !me.profile.timezone) {
      authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ timezone: tz }) }).catch(() => {})
    }
  }, [me?.profile, authed]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setTab(['linkedin', 'instagram', 'tiktok'].includes(connected) ? connected : 'instagram')
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
    setChatScope(['x', 'linkedin', 'instagram', 'tiktok'].includes(tab) ? [tab] : [])
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
  const collapseQueue = true // queue rows stay compact; expand one to act on it
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

  // Feeder agents — payload is either a feeder connection id (X tab shorthand)
  // or a full body ({ social_account_id | x_connection_id, interests, campaign_id }).
  async function spawnAgent(payload, interests) {
    const body = typeof payload === 'string' ? { x_connection_id: payload, interests } : payload
    const r = await authed('/api/feeder-agents', { method: 'POST', body: JSON.stringify(body) })
    const d = await r.json()
    if (d.error) { setBanner(d.error); return false }
    setBanner(`“${d.agent?.name || 'Agent'}” is ready — flip it on when you are`); loadAgents(); loadAgentCamps(); return true
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

  // Agent campaigns — the missions agents carry out
  async function saveAgentCamp(body) {
    const r = await authed('/api/agent-campaigns', { method: 'POST', body: JSON.stringify(body) })
    const d = await r.json()
    if (d.error) { setBanner(d.error); return false }
    setBanner('Campaign created — deploy agents to it'); loadAgentCamps(); return true
  }
  async function scanTrends(platform) {
    setScanning(platform)
    try {
      const r = await authed('/api/trends', { method: 'POST', body: JSON.stringify({ action: 'harvest', platforms: [platform], deepN: 3 }) })
      const d = await r.json()
      if (d.error) setBanner(d.error)
      else { const n = d.summary?.formats || 0; setBanner(n ? `Banked ${n} ${platform} format${n === 1 ? '' : 's'}` : `Scanned ${platform} — nothing new this round`); loadTrends() }
    } catch { setBanner('Scan failed — try again.') } finally { setScanning('') }
  }
  async function deleteTrend(id) { await authed('/api/trends', { method: 'DELETE', body: JSON.stringify({ id }) }); loadTrends() }
  const apFor = p => autopilot.find(a => a.platform === p) || { platform: p, enabled: false, auto_post: false, per_run: 1, interval_hours: 24 }
  async function patchAutopilot(platform, patch) {
    // optimistic so toggles/inputs feel instant
    setAutopilot(list => { const ex = list.find(a => a.platform === platform); const merged = { ...apFor(platform), ...patch }; return ex ? list.map(a => a.platform === platform ? merged : a) : [...list, merged] })
    try { await authed('/api/autopilot', { method: 'POST', body: JSON.stringify({ platform, ...patch }) }); loadAutopilot() } catch { loadAutopilot() }
  }
  const brandOnboarded = !!me?.profile?.brand_brief?.positioning
  async function saveBrandBrief({ brief, cadence }) {
    setBrandSaving(true)
    try {
      await authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ brand_brief: brief }) })
      await authed('/api/autopilot', { method: 'POST', body: JSON.stringify({ platform: 'x', enabled: true, ...cadence }) })
      await loadMe(session); loadAutopilot()
      setBanner('Autopilot on — Cadence is running your X in your voice')
      setBrandOnb(false)
    } catch { setBanner('Could not save — try again.') } finally { setBrandSaving(false) }
  }
  async function draftAgentCamp(body) {
    try {
      const r = await authed('/api/agent-campaigns', { method: 'POST', body: JSON.stringify({ action: 'draft', ...body }) })
      const d = await r.json()
      if (d.draft && !d.draft.error) return d.draft
      setBanner(d.draft?.error || d.error || 'Could not draft that — fill it in manually.'); return null
    } catch { setBanner('Could not draft that — fill it in manually.'); return null }
  }
  async function patchAgentCamp(id, patch, note) { await authed('/api/agent-campaigns', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) }); if (note) setBanner(note); loadAgentCamps() }
  async function deleteAgentCamp(id) {
    if (!confirm('Delete this campaign? Its agents stay — they just stop promoting it.')) return
    await authed('/api/agent-campaigns', { method: 'DELETE', body: JSON.stringify({ id }) }); loadAgentCamps(); loadAgents()
  }

  // Social (Instagram/TikTok/LinkedIn via Zernio)
  async function connectSocial(platform) {
    const r = await authed('/api/social', { method: 'POST', body: JSON.stringify({ action: 'connect', platform }) })
    const d = await r.json()
    if (d.authUrl) { window.location.href = d.authUrl } // full-page redirect; Zernio returns the user to /?connected=<platform>
    else setBanner(d.error || 'Could not start connection')
  }
  async function syncSocial() { setBanner('Refreshing connected accounts…'); await loadSocial(true) }
  async function disconnectSocial(id) {
    if (!confirm('Disconnect this account? Its scheduled posts will stop publishing.')) return
    await authed('/api/social', { method: 'DELETE', body: JSON.stringify({ id }) })
    setBanner('Account disconnected'); loadSocial()
  }
  // Auto-reply ON = replies go out automatically the moment a comment lands
  // (immediacy = reach, per the user). Enabling forces auto_post=true.
  async function toggleReplies(platform, patch) { await authed('/api/social-engagement', { method: 'PATCH', body: JSON.stringify({ platform, ...patch, ...(patch.enabled ? { auto_post: true } : {}) }) }); loadSocialEng() }
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
  async function pausePost(id) { await authed('/api/posts', { method: 'PATCH', body: JSON.stringify({ id, status: 'paused' }) }); setBanner('Held — it won’t go out until you resume it'); loadQueue() }
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

  // ── Chat persistence: every exchange upserts the conversation, so history
  // survives reloads and the user can revisit or branch from old chats. ──────
  const saveChat = useCallback(async (msgs) => {
    if (!msgs?.length) return
    try {
      const r = await authed('/api/chats', { method: 'POST', body: JSON.stringify({ id: chatIdRef.current, messages: msgs, scope: chatScope }) })
      const d = await r.json()
      if (d.id) {
        const isNew = !chatIdRef.current
        chatIdRef.current = d.id
        if (isNew) loadChats() // surface the new conversation in History right away
      }
    } catch {}
  }, [authed, chatScope]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadChats = useCallback(async () => {
    try { const r = await authed('/api/chats'); const d = await r.json(); setChatList(d.chats || []) } catch {}
  }, [authed])
  useEffect(() => { loadChats() }, [loadChats])
  function newChat() { chatIdRef.current = null; setMessages([]); setHistoryOpen(false); inputRef.current?.focus() }
  async function openChat(id) {
    const r = await authed(`/api/chats?id=${id}`); const d = await r.json()
    if (d.chat) { chatIdRef.current = d.chat.id; setMessages(Array.isArray(d.chat.messages) ? d.chat.messages : []); setHistoryOpen(false) }
  }
  async function deleteChat(id, e) {
    e.stopPropagation()
    await authed('/api/chats', { method: 'DELETE', body: JSON.stringify({ id }) })
    if (chatIdRef.current === id) { chatIdRef.current = null; setMessages([]) }
    loadChats()
  }
  // A draft card was posted/scheduled/discarded — record the outcome on the
  // saved chat so reloading history never shows a live card for it again.
  function resolveProposal(mi, pi, resolved, label) {
    setMessages(ms => {
      const next = ms.map((m, i) => i !== mi ? m : {
        ...m,
        proposals: (m.proposals || (m.proposal ? [m.proposal] : [])).map((p, j) => j !== pi ? p : { ...p, resolved, resolved_label: label }),
        proposal: undefined,
      })
      saveChat(next)
      return next
    })
  }

  async function send(text) {
    const t = (text ?? input).trim(); if (!t || loading) return
    setInput(''); const next = [...messages, { role: 'user', content: t }]; setMessages(next); setLoading(true)
    try {
      // Model sees the recent window; the full conversation still saves to history.
      const res = await authed('/api/chat', { method: 'POST', body: JSON.stringify({ messages: next.slice(-40), platforms: chatScope }) })
      const data = await res.json()
      const proposals = Array.isArray(data.proposals) ? data.proposals : (data.proposal ? [data.proposal] : [])
      const withReply = [...next, { role: 'assistant', content: data.reply, proposals }]
      setMessages(withReply); saveChat(withReply); loadQueue()
    }
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

      <div className="cols" ref={colsRef} style={{ '--left-pct': (chatOpen ? leftPct : 100) + '%' }}>
        <section className={'pane left' + (['x', 'linkedin', 'instagram', 'tiktok'].includes(tab) ? ` plat-${tab}` : '')}>
          <div className="left-head">
            <div className="seg">
              {['queue', 'x', 'linkedin', 'instagram', 'tiktok', 'campaigns'].map(t => (
                <button key={t} onClick={() => setTab(t)} className={'seg-btn' + (tab === t ? ' on' : '')}>
                  {tab === t && <motion.span layoutId="seg-pill" className="seg-pill" transition={spring} />}
                  <span style={{ position: 'relative', zIndex: 1 }}>{({ queue: 'Queue', x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', campaigns: 'Campaigns' })[t]}</span>
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
                const replies = fQueue.filter(p => p.reply_to_tweet_id)
                const shown = showReplies ? fQueue : fQueue.filter(p => !p.reply_to_tweet_id)
                const failed = shown.filter(p => p.status === 'failed')
                const dayOf = iso => { const d = new Date(iso), t = new Date()
                  if (d.toDateString() === t.toDateString()) return 'Today'
                  const tm = new Date(t); tm.setDate(t.getDate() + 1)
                  return d.toDateString() === tm.toDateString() ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) }
                let lastDay = null
                return (<>
                  <div className="qfilter">
                    {chips.map(([k, l]) => <button key={k} className={'qchip' + (qPlatform === k ? ' on' : '')} onClick={() => setQPlatform(k)}>{k !== 'all' && <span className="status-dot" style={{ background: platformDot(k) }} />}{l}</button>)}
                    <div className="qview" style={{ marginLeft: 'auto' }}>
                      <button className={'qview-btn' + (qView === 'list' ? ' on' : '')} onClick={() => setQView('list')} title="List view"><LList size={13} /></button>
                      <button className={'qview-btn' + (qView === 'calendar' ? ' on' : '')} onClick={() => setQView('calendar')} title="Calendar view"><LCalendar size={13} /></button>
                    </div>
                  </div>
                  {qView === 'calendar'
                    ? <QueueCalendar posts={[...shown, ...posted.filter(matchP)]} onOpen={openSchedule} onPostNow={postNow} onDelete={delPost} />
                    : (<>
                  {replies.length > 0 && (
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', fontSize: 11.5, color: 'var(--muted)', cursor: 'pointer', margin: '0 2px 8px' }}>
                      <label className="row" style={{ gap: 6 }}>replies · {replies.length}<Toggle on={showReplies} onChange={setShowReplies} /></label>
                    </div>
                  )}
                  {failed.length > 0 && (
                    <div className="fail-banner">⚠ {failed.length} post{failed.length === 1 ? '' : 's'} failed — open the cards below to retry or fix.</div>
                  )}
                  {shown.length === 0 && schedShows.length === 0 && <Empty icon={<Clock size={26} />}>Nothing queued{qPlatform !== 'all' ? ` for ${qPlatform}` : ''}. Write one or ask the chat.</Empty>}
                  <div>{shown.map((p, i) => {
                    const day = ['queued', 'posting'].includes(p.status) ? dayOf(p.scheduled_for) : null
                    const head = day && day !== lastDay ? <div className="day-head">{day}</div> : null
                    if (day) lastDay = day
                    return (
                      <div key={p.id}>
                        {head}
                        <QueueCard p={p} i={i} connected={connected} socialPlatforms={new Set(socialAccounts.map(a => a.platform))} defaultCollapsed={collapseQueue} onSaveEdit={saveEdit} onPostNow={postNow} onDelete={delPost} onSchedule={openSchedule} />
                      </div>
                    )
                  })}</div>
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
                    </>)}
                </>)
              })()}

              {/* X — brain + stats up top, campaigns (the main feature) surfaced,
                  autopilot, then auto-reply + niche engagement with a live reply
                  feed, then what's ready to post. Accounts in the dot. */}
              {tab === 'x' && (<>
                {connected ? (
                  <div className="phead">
                    <div className="phead-brain"><BrainBanner theme="x" /></div>
                    <StatTiles vertical tiles={[
                      { value: xStats?.newFollowers30d == null ? '—' : (xStats.newFollowers30d > 0 ? '+' : '') + fmtNum(xStats.newFollowers30d), label: 'New followers' },
                      { value: fmtNum(xStats?.impressions30d), label: 'Impressions · 30d' },
                      { value: fmtNum(queue.filter(p => (p.platform || 'x') === 'x').length), label: 'Queued' },
                    ]} />
                  </div>
                ) : (<>
                  <BrainBanner theme="x" />
                  <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', margin: '8px 0 14px' }} onClick={connectX}><XGlyph /> Connect your X account</button>
                </>)}
                {xConns.some(c => c.needs_reconnect) && <div className="notice" style={{ color: '#8A6200', margin: '4px 0 10px' }}>An X account needs reconnecting — open accounts (bottom-right).</div>}

                {(() => {
                  const ap = apFor('x')
                  const arOn = !!engSettings.find(s => s.platform === 'x')?.enabled
                  const engRule = engRules.find(r => r.active) || engRules[0]
                  const liveCamps = campsTouching(['x']).filter(c => c.active).length
                  function engToggle(v) {
                    if (v) { engRule?.id ? patchEngagement(engRule.id, { active: true, auto_post: true }) : saveEngagement({ comment_styles: ['add_value'], connection_ids: primaryX ? [primaryX.id] : [], interval_hours: 24, replies_per_run: 4, auto_post: true, active: true }) }
                    else if (engRule?.id) patchEngagement(engRule.id, { active: false })
                  }
                  return (<>
                    {/* Campaigns — the headline feature, open by default */}
                    <Section title="Campaigns" hint="promote on a schedule, in your voice" defaultOpen badge={liveCamps ? <span className="live-pill on"><span className="pulse" />{liveCamps} live</span> : null}>
                      <PlatformCampaign campaigns={campsFor(['x'])} targets={xCampTargets} allowImage canCreate={connected} connectHint="Connect your X account first." onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
                      <CrossCampHint plats={['x']} />
                    </Section>

                    {/* Autopilot — hands-free; toggle gated behind brand onboarding */}
                    <Section title="Autopilot" hint="run your account hands-free" badge={ap.enabled && ap.status_detail ? <span className="muted tiny">{ap.status_detail}</span> : null}
                      toggle={{ on: ap.enabled, onChange: v => { if (v && !brandOnboarded) setBrandOnb(true); else patchAutopilot('x', { enabled: v }) } }}>
                      <AutopilotBody row={ap} onToggle={patch => patchAutopilot('x', patch)} onEditBrief={() => setBrandOnb(true)} />
                    </Section>

                    {/* Auto-reply — replies to comments on your posts (after a human pause) */}
                    <Section title="Auto-reply" hint="reply to comments on your posts" toggle={{ on: arOn, onChange: v => toggleReplies('x', { enabled: v }) }}>
                      <div className="muted tiny" style={{ marginBottom: 4 }}>{arOn ? 'Cadence checks for new comments on a schedule and replies automatically — after a natural 30–90s pause so it never reads as a bot.' : 'Off — turn on to reply to comments in your voice.'}</div>
                      <RepliesFeed posts={posts} platform="x" source="reply" />
                    </Section>

                    {/* Engage in your niche — keywords + accounts to always reply to */}
                    <Section title="Engage in your niche" hint="reply to keywords & accounts" toggle={{ on: !!engRule?.active, onChange: engToggle }}>
                      <EngageBody rule={engRule} xReadEnabled={!!me?.xReadEnabled} posts={posts} onPatch={patchEngagement} />
                    </Section>

                    {/* Ready to post */}
                    <Section title="Ready to post" hint="drafts waiting for you" defaultOpen={xDrafts.length > 0} badge={xDrafts.length ? <span className="camp-state on">{xDrafts.length}</span> : null}>
                      <Suggestions platform="x" drafts={xDrafts} busy={suggesting === 'x'} canPost={connected}
                        onGenerate={() => suggestPosts('x')} onPostNow={postNow} onSchedule={openSchedule} onDiscard={delPost} />
                    </Section>
                  </>)
                })()}
              </>)}

              {/* Instagram / TikTok — one tab per platform: its brain, REAL
                  stats, the Carousels|Clips studio scoped to that platform
                  (with a cross-post option after generating), automations. */}
              {['instagram', 'tiktok'].includes(tab) && (() => {
                const plat = tab
                const platLabel = plat === 'instagram' ? 'Instagram' : 'TikTok'
                const platAccts = socialAccounts.filter(a => a.platform === plat)
                const platCampTargets = platAccts.map(a => ({ kind: 'social', id: a.id, platform: plat, label: '@' + (a.username || plat) }))
                const followers = platAccts.reduce((n, a) => n + (a.followers || 0), 0)
                return (<>
                  <BrainBanner theme={plat} />
                  {platAccts.length ? (
                    <StatTiles tiles={[
                      { value: platAccts.some(a => a.followers != null) ? fmtNum(followers) : '—', label: 'Followers' },
                      { value: fmtNum(posts.filter(p => p.platform === plat && p.status === 'posted').length), label: 'Posted' },
                      { value: fmtNum(queue.filter(p => p.platform === plat).length), label: 'Queued' },
                    ]} />
                  ) : (
                    <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', margin: '8px 0 14px' }} disabled={!socialConfigured} onClick={() => connectSocial(plat)}>{plat === 'instagram' ? <IGGlyph size={15} /> : <TTGlyph size={15} />} Connect {platLabel}</button>
                  )}
                  {!socialConfigured && <div className="notice" style={{ margin: '0 0 10px' }}>Connect Zernio to post — previews work now.</div>}

                  <div className="seg" style={{ marginBottom: 12 }}>
                    {[['carousels', 'Carousels'], ['clips', plat === 'instagram' ? 'Reels' : 'Clips']].map(([k, l]) => (
                      <button key={k} className={'seg-btn' + (igMode === k ? ' on' : '')} onClick={() => setIgMode(k)}>
                        {igMode === k && <motion.span layoutId="ig-pill" className="seg-pill" transition={spring} />}
                        <span style={{ position: 'relative', zIndex: 1 }}>{l}</span>
                      </button>
                    ))}
                  </div>
                  {igMode === 'carousels' && (
                    <SlideshowStudio hideAccounts platformFocus={plat} accounts={socialAccounts} configured={socialConfigured} slideshows={slideshows}
                      onConnect={connectSocial} onSync={syncSocial} onGenerate={generateSlideshow} onSave={saveSlideshow} onDelete={deleteSlideshow} />
                  )}
                  {igMode === 'clips' && (
                    <ClipStudio platformFocus={plat} jobs={clipJobs} accounts={socialAccounts} configured={socialConfigured}
                      onCreate={createClipJob} onUpload={uploadClipFile} onDelete={deleteClipJob} onPost={postClip} />
                  )}

                  <div style={{ marginTop: 16 }}>
                    <Section title="Auto-reply" hint="answers comments in your voice" badge={<OnBadge on={engSettings.some(s => s.platform === plat && s.enabled)} />}>
                      <AutoReply platforms={[plat]} settings={engSettings} replies={socialReplies} accounts={socialAccounts} configured={socialConfigured} onToggle={toggleReplies} onRun={runReplies} onPostDraft={postReplyDraft} />
                    </Section>
                    <Section title="Engage in your niche" hint="comments on relevant posts as you">
                      <EngageStub platform={platLabel} />
                    </Section>
                    <Section title="Campaign" hint="auto-post carousels on a schedule" badge={<OnBadge on={campsTouching([plat]).some(c => c.active)} />}>
                      <PlatformCampaign campaigns={campsFor([plat])} targets={platCampTargets} supportsCarousel canCreate={platCampTargets.length > 0} connectHint={`Connect ${platLabel} first (accounts, bottom-right).`} onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
                      <CrossCampHint plats={[plat]} />
                    </Section>
                    <Section title="What's working now" hint="viral formats in your niche → clip styles" defaultOpen badge={trends.filter(f => f.platform === plat).length ? <span className="camp-state on">{trends.filter(f => f.platform === plat).length}</span> : null}>
                      <TrendFormats platform={plat} formats={trends} busy={scanning === plat} canScan onScan={() => scanTrends(plat)} onDelete={deleteTrend} />
                    </Section>
                  </div>
                </>)
              })()}

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
                <Section title="What's working now" hint="viral hook patterns feed your drafts" badge={trends.filter(f => f.platform === 'linkedin').length ? <span className="camp-state on">{trends.filter(f => f.platform === 'linkedin').length}</span> : null}>
                  <TrendFormats platform="linkedin" formats={trends} canScan={false} onDelete={deleteTrend} />
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
                <AgentFleet agents={feederAgents} xConns={xConns} socialAccounts={socialAccounts} posts={posts} onOpen={setAgentProfileId} />
                <div className="muted tiny" style={{ margin: '0 2px 12px' }}>Missions for your agents. Pick something to promote, deploy agents across platforms — each one works it into its own posting, in its own voice.</div>
                <AgentCampaigns campaigns={agentCampaigns} agents={feederAgents} xConns={xConns} socialAccounts={socialAccounts} posts={posts}
                  onSaveCamp={saveAgentCamp} onPatchCamp={patchAgentCamp} onDeleteCamp={deleteAgentCamp} onDraftCamp={draftAgentCamp}
                  onSpawn={spawnAgent} onPatchAgent={patchAgent} onRunAgent={runAgent} onOpenAgent={setAgentProfileId} />
              </>)}

            </motion.div>
          </div>

          {/* Floating accounts — X & LinkedIn keep account management one tap away
              without cluttering the create-first flow. */}
          {tab === 'x' && (
            <FloatingAccounts glyph={<XGlyph />} count={xConns.length} label="X accounts">
              <div className="conn-sec" style={{ marginTop: 0 }}>Your accounts</div>
              {xConns.map(c => (
                <AccountRow key={c.id} platform="x" title={`@${c.username}`}
                  badges={<>
                    {c.is_primary ? <span className="role-badge primary"><Star size={9} fill="currentColor" /> Primary</span> : <span className="role-badge">Feeder</span>}
                    {c.needs_reconnect && <span className="role-badge" style={{ background: '#FAF3E4', color: '#8A6200' }}>Reconnect</span>}
                  </>}
                  actions={<>
                    {c.needs_reconnect && <button className="mini accent" onClick={connectX}>Reconnect</button>}
                    {!c.is_primary && <button className="mini" onClick={() => makePrimary(c.id)} title="Make this your primary account">Make primary</button>}
                    <button className="mini danger" onClick={() => disconnectX(c.id)}>Disconnect</button>
                  </>} />
              ))}
              <ConnectBtn onClick={connectX}>{connected ? 'Add another account (feeder)' : 'Connect X'}</ConnectBtn>
              <div className="conn-sec row" style={{ gap: 7 }}><Star size={12} /> Inspiration <span className="muted tiny" style={{ fontWeight: 400 }}>· up to 3, read-only</span></div>
              {[0, 1, 2].map(i => (
                <XInspoSlot key={i} account={inspoX[i]} onAdd={addInspo} onRemove={removeInspo} />
              ))}
            </FloatingAccounts>
          )}
          {tab === 'linkedin' && (
            <FloatingAccounts glyph={<LIcon size={15} />} count={socialAccounts.filter(a => a.platform === 'linkedin').length} label="LinkedIn">
              <div className="conn-sec" style={{ marginTop: 0 }}>Your account</div>
              {socialAccounts.filter(a => a.platform === 'linkedin').map(a => (
                <AccountRow key={a.id} platform="linkedin" title={a.username || 'LinkedIn'} subtitle="publishes your posts"
                  actions={<button className="mini danger" onClick={() => disconnectSocial(a.id)}>Disconnect</button>} />
              ))}
              <ConnectBtn disabled={!socialConfigured} onClick={() => connectSocial('linkedin')} title={!socialConfigured ? 'Publishing not configured yet' : ''}>{liAccount ? 'Reconnect LinkedIn' : 'Connect LinkedIn'}</ConnectBtn>
              <div className="conn-sec">Your voice source <span className="muted tiny" style={{ fontWeight: 400 }}>· your own LinkedIn</span></div>
              <LinkedInSlot account={liSelf[0]} onAdd={(url) => addLinkedIn(url, false)} onRemove={removeLinkedIn} self />
              <div className="conn-sec row" style={{ gap: 7 }}><Star size={12} /> Inspiration <span className="muted tiny" style={{ fontWeight: 400 }}>· up to 3, read-only</span></div>
              {[0, 1, 2].map(i => (
                <LinkedInSlot key={i} account={liMentors[i]} onAdd={(url) => addLinkedIn(url, true)} onRemove={removeLinkedIn} />
              ))}
            </FloatingAccounts>
          )}
          {['instagram', 'tiktok'].includes(tab) && (
            <FloatingAccounts glyph={tab === 'instagram' ? <IGGlyph size={15} /> : <TTGlyph size={15} />} count={socialAccounts.filter(a => a.platform === tab).length} label={tab === 'instagram' ? 'Instagram accounts' : 'TikTok accounts'}>
              <div className="conn-sec row" style={{ marginTop: 0, gap: 7 }}>Your accounts
                <button className="mini" style={{ marginLeft: 'auto' }} onClick={syncSocial}><RefreshCw size={11} /> Refresh</button>
              </div>
              {socialAccounts.filter(a => a.platform === tab).map(a => (
                <AccountRow key={a.id} platform={a.platform} title={a.username || a.platform} subtitle={a.followers != null ? `${fmtNum(a.followers)} followers` : 'publishes your posts'}
                  actions={<button className="mini danger" onClick={() => disconnectSocial(a.id)}>Disconnect</button>} />
              ))}
              <ConnectBtn disabled={!socialConfigured} onClick={() => connectSocial(tab)} title={!socialConfigured ? 'Publishing not configured yet' : ''}>Connect {tab === 'instagram' ? 'Instagram' : 'TikTok'}</ConnectBtn>
            </FloatingAccounts>
          )}
        </section>

        {chatOpen && <>
        <div className={'split-handle' + (dragging ? ' active' : '')} onMouseDown={startDrag} onTouchStart={startDrag} title="Drag to resize" role="separator" aria-label="Resize panels"><span className="split-grip" /></div>

        {/* chat */}
        <section className="pane right">
          <div className="chat-head">
            <span className="chat-head-label">{messages.length ? (chatList.find(c => c.id === chatIdRef.current)?.title || 'Chat') : 'New chat'}</span>
            <div className="row" style={{ gap: 6, position: 'relative' }}>
              <button className="mini" onClick={() => { if (!historyOpen) loadChats(); setHistoryOpen(o => !o) }} title="Previous chats"><LHistory size={12} /> History</button>
              <button className="mini" onClick={newChat} title="Start a new chat"><Plus size={12} /> New</button>
              <button className="mini" onClick={() => toggleChat(false)} title="Collapse chat"><LX size={13} /></button>
              <AnimatePresence>
                {historyOpen && (
                  <motion.div className="card chat-hist" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
                    {chatList.length === 0 && <div className="muted tiny" style={{ padding: '10px 12px' }}>No saved chats yet — they save automatically as you talk.</div>}
                    {chatList.map(c => (
                      <div key={c.id} className={'hist-row' + (c.id === chatIdRef.current ? ' on' : '')} onClick={() => openChat(c.id)}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="hist-title">{c.title || 'Chat'}</div>
                          <div className="muted tiny">{fmt(c.updated_at)}</div>
                        </div>
                        <button className="hist-del" title="Delete chat" onClick={e => deleteChat(c.id, e)}><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="scroll chat-scroll" onClick={() => historyOpen && setHistoryOpen(false)}>
            {messages.length === 0 && (
              <div className="chat-welcome">
                <div className="wordmark" style={{ fontSize: 19, marginBottom: 4 }}>How can I help?</div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Post, schedule, make carousels, run replies — across X, LinkedIn, Instagram & TikTok. Just ask.</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                  {["Write a post about what I'm building this week", 'Turn my last LinkedIn post into a thread', "Make a carousel: 5 lessons from this month"].map(ex => (
                    <button key={ex} className="preset" style={{ fontSize: 12.5 }} onClick={() => usePreset(ex)}>{ex}</button>
                  ))}
                </div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((m, i) => {
                const props = m.proposals || (m.proposal ? [m.proposal] : [])
                return (
                  <motion.div key={i} className={'msg ' + m.role} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
                    <div className={'msg-col' + (props.length ? ' has-dp' : '')} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div className={'bubble ' + m.role}>{m.content}</div>
                      {props.map((p, j) => (
                        <DraftProposal key={j} proposal={p} index={j} total={props.length} authed={authed} connected={connected} canPostLinkedIn={socialAccounts.some(a => a.platform === 'linkedin')} onResolved={loadQueue} onOutcome={(resolved, label) => resolveProposal(i, j, resolved, label)} defaultHour={defaultHour} xConns={xConns} hasPhotos={hasPhotos} />
                      ))}
                    </div>
                  </motion.div>
                )
              })}
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
        </>}
        {!chatOpen && (
          <button className="chat-reopen" onClick={() => toggleChat(true)} title="Open Cadence chat"><Sparkles size={15} /> Chat</button>
        )}
      </div>

      {/* brand onboarding — required before Autopilot speaks for you */}
      <AnimatePresence>
        {brandOnb && <BrandOnboarding initial={{ ...(me?.profile?.brand_brief || {}), ...apFor('x') }} busy={brandSaving} onSave={saveBrandBrief} onClose={() => setBrandOnb(false)} />}
      </AnimatePresence>

      {/* agent profile modal — opened from the fleet or a campaign roster */}
      <AnimatePresence>
        {agentProfileId && (() => {
          const a = feederAgents.find(x => x.id === agentProfileId)
          return a ? (
            <AgentProfile agent={a} xConns={xConns} socialAccounts={socialAccounts} campaigns={agentCampaigns} posts={posts}
              onPatch={patchAgent} onRun={runAgent} onReroll={rerollAgent} onDelete={deleteAgent} onClose={() => setAgentProfileId(null)} />
          ) : null
        })()}
      </AnimatePresence>

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
  const [landingAuth, setLandingAuth] = useState(null) // null = landing; 'signin'|'signup' = auth screen
  // The static marketing page (public/landing.html) links here with ?auth=…
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('auth')
    if (m === 'signin' || m === 'signup') setLandingAuth(m)
  }, [])

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
  else if (!session) view = landingAuth
    ? <AuthScreen initialMode={landingAuth} onBack={() => setLandingAuth(null)} />
    : <Landing onAuth={setLandingAuth} />
  else if (gated) view = <Paywall me={me} authed={authed} onSignOut={() => supabase.auth.signOut()} />
  else if (me && !me.profile?.onboarded) view = <Onboarding session={session} me={me} authed={authed} onDone={() => loadMe(session)} />
  else view = <App session={session} />

  return (<><style>{CSS}</style><div className="bg-mesh" />{view}</>)
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&display=swap');
:root {
  --bg: #FFFFFF; --bg2: #F5F5F3; --surface: #FFFFFF; --raise: #FAFAF9;
  --line: #EBEAE6; --line2: #DEDCD6; --line-hover: #CFCDC6;
  --ink: #1A1A18; --body: #3A3833; --muted: #6B6860; --faint: #A09D98;
  --accent: #C2714F; --accent-deep: #A85B3D; --accent-soft: #F5E7DF; --accent-line: #E8CFC0; --accent-text: #A85B3D;
  --gold: #8A6A1F; --gold-soft: #F8F2E1; --gold-line: #E6D9B4;
  --ok: #1E7A4D; --ok-soft: #EDF4EE; --ok-line: #CBE0D0;
  --bad: #B3372F; --bad-soft: #F8EDEA; --bad-line: #E8C9C3;
  --warn: #8A6200; --warn-soft: #F9F2E3; --warn-line: #EADCB8;
  --plum: #7A5EA8; --plum-soft: #F3F0F8; --plum-line: #E3DAF0;
  --serif: 'Newsreader', Georgia, serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ink); font-family: 'Inter', system-ui, sans-serif; font-size: 15px; letter-spacing: -0.01em; line-height: 1.6; -webkit-font-smoothing: antialiased; }
::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-thumb { background: rgba(40,36,28,0.14); border-radius: 5px; } ::-webkit-scrollbar-thumb:hover { background: rgba(40,36,28,0.24); }
.bg-mesh { position: fixed; inset: 0; z-index: 0; pointer-events: none; background: var(--bg); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; transition: border-color .2s ease, background .2s ease; }
.wordmark { font-family: var(--serif); font-style: italic; font-weight: 500; letter-spacing: 0; color: var(--ink); text-transform: lowercase; }
.muted { color: var(--muted); } .tiny { font-size: 11.5px; } .hl { color: var(--accent-text); font-weight: 500; }
.link { color: var(--accent-text); cursor: pointer; font-weight: 600; } .link:hover { color: var(--accent-deep); }
.row { display: flex; align-items: center; }
.field { width: 100%; background: var(--raise); border: 1px solid var(--line2); border-radius: 8px; color: var(--ink); font-size: 14px; padding: 10px 13px; font-family: inherit; transition: border-color .2s ease, box-shadow .2s ease; outline: none; }
.field::placeholder { color: var(--faint); }
.field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent); }
.field:disabled { opacity: .6; }
.btn-primary { background: var(--ink); border: 1px solid var(--ink); border-radius: 8px; color: #FAF9F7; font-weight: 500; font-size: 13.5px; padding: 9px 15px; cursor: pointer; font-family: inherit; transition: background .2s ease, transform .1s ease; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; }
.btn-primary:hover:not(:disabled) { background: #33312C; } .btn-primary:active:not(:disabled) { transform: scale(0.98); } .btn-primary:disabled { opacity: .38; cursor: default; }
.btn-sm { padding: 6px 12px; font-size: 12.5px; }
.btn-ghost { background: var(--surface); border: 1px solid var(--line2); border-radius: 8px; color: var(--muted); font-size: 13px; padding: 8px 14px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; }
.btn-ghost:hover:not(:disabled) { color: var(--ink); border-color: #B9B3A6; }
.avatar { width: 33px; height: 33px; border-radius: 50%; border: none; background: var(--ink); color: #FAF9F7; font-weight: 600; font-size: 13.5px; cursor: pointer; font-family: var(--serif); }
.pro-pill { display: inline-flex; align-items: center; gap: 5px; color: var(--gold); background: var(--gold-soft); border: 1px solid var(--gold-line); padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.notice { font-size: 12.5px; color: var(--warn); background: var(--warn-soft); border: 1px solid var(--warn-line); padding: 9px 12px; border-radius: 8px; }
.switch { width: 36px; height: 21px; border-radius: 999px; background: #D3CFC5; position: relative; transition: background .2s; flex: none; } .switch.on { background: var(--accent); }
.knob { position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #FCFBF9; box-shadow: 0 1px 2px rgba(0,0,0,0.18); transition: transform .2s; } .switch.on .knob { transform: translateX(15px); }

.auth-wrap { position: relative; z-index: 1; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.auth-card { width: 372px; max-width: 100%; padding: 34px 32px; border-radius: 14px; box-shadow: 0 24px 60px -38px rgba(35,32,24,0.35); }
.pay-card { width: 400px; max-width: 100%; padding: 34px 32px; border-radius: 14px; box-shadow: 0 24px 60px -38px rgba(35,32,24,0.35); }
.pay-price { font-size: 40px; font-weight: 600; font-family: var(--serif); letter-spacing: -0.01em; }
.pay-perks { margin: 18px 0 4px; display: flex; flex-direction: column; gap: 11px; }
.pay-perk { display: flex; align-items: center; gap: 11px; font-size: 13.5px; color: var(--body); }
.pay-ic { width: 28px; height: 28px; border-radius: 7px; background: var(--accent-soft); color: var(--accent-text); display: flex; align-items: center; justify-content: center; flex: none; }
.ob-card { width: 432px; max-width: 100%; padding: 30px 32px; border-radius: 14px; box-shadow: 0 24px 60px -38px rgba(35,32,24,0.35); }
.ob-dots { display: flex; gap: 6px; margin-bottom: 18px; } .ob-dot { width: 24px; height: 3px; border-radius: 3px; background: var(--line); } .ob-dot.on { background: var(--accent); }
.ob-lead { font-size: 14px; line-height: 1.6; color: var(--body); margin: 0; }
.ob-label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 14px 0 6px; }
.ob-nav { display: flex; align-items: center; justify-content: space-between; margin-top: 22px; }
.ob-ok { display: inline-flex; align-items: center; gap: 7px; color: var(--ok); font-size: 13px; font-weight: 600; }

.app { position: relative; z-index: 1; display: flex; flex-direction: column; height: 100vh; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 22px; background: var(--bg); border-bottom: 1px solid var(--line); }
.banner { position: relative; z-index: 1; margin: 10px 22px -2px; padding: 9px 14px; font-size: 13px; color: var(--accent-text); font-weight: 500; background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 8px; }
.cols { display: flex; flex: 1; overflow: hidden; }
.pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.left { width: var(--left-pct, 47%); flex: none; }
.right { flex: 1; min-width: 0; }
.split-handle { flex: none; width: 9px; margin: 0 -4px; cursor: col-resize; position: relative; z-index: 6; display: flex; align-items: center; justify-content: center; touch-action: none; }
.split-handle::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; transform: translateX(-50%); background: var(--line); transition: background .15s, width .15s; }
.split-handle:hover::before, .split-handle.active::before { width: 3px; background: var(--accent); border-radius: 2px; }
.split-grip { position: relative; z-index: 1; width: 4px; height: 30px; border-radius: 3px; background: var(--line2); opacity: 0; transition: opacity .15s; }
.split-handle:hover .split-grip, .split-handle.active .split-grip { opacity: 1; background: var(--accent); }
.scroll-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 14px 18px; }
.left-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 8px; gap: 8px; }
.hint { font-size: 12.5px; color: var(--warn); background: var(--warn-soft); border: 1px solid var(--warn-line); padding: 9px 12px; border-radius: 8px; margin-bottom: 12px; }
.seg { display: inline-flex; gap: 2px; padding: 3px; background: var(--bg2); border-radius: 9px; }
.seg-btn { position: relative; background: none; border: none; color: var(--muted); font-size: 12.5px; font-weight: 600; font-family: inherit; padding: 6px 13px; border-radius: 7px; cursor: pointer; transition: color .15s; white-space: nowrap; }
.seg-btn.on { color: var(--ink); } .seg-pill { position: absolute; inset: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 7px; z-index: 0; }
.scroll .card { margin-bottom: 8px; }
.card-body { font-size: 13.5px; line-height: 1.55; color: var(--body); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.qcard { overflow: hidden; }
.qcard.bad { border-color: var(--bad-line); background: #FFFBFA; }
.qhead { width: 100%; display: flex; align-items: center; gap: 9px; padding: 10px 13px; background: none; border: none; cursor: pointer; font-family: inherit; text-align: left; }
.qhead:hover .qtitle { color: var(--ink); }
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.qtime { flex: none; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 52px; }
.qmeta { flex: none; font-size: 10.5px; color: var(--faint); }
.qstate { flex: none; font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); background: var(--bg2); border-radius: 999px; padding: 2px 8px; }
.qstate.bad { color: var(--bad); background: var(--bad-soft); }
.qtitle { flex: 1; min-width: 0; font-size: 13px; color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .15s; }
.qbody { padding: 0 14px 13px; }
.qcard-img { width: 100%; border-radius: 8px; margin-bottom: 10px; display: block; max-height: 220px; object-fit: cover; }
.qrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 11px; }
.mini { background: var(--surface); border: 1px solid var(--line2); border-radius: 7px; color: var(--muted); font-size: 11.5px; padding: 4px 9px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
.mini:hover:not(:disabled) { color: var(--ink); border-color: #B9B3A6; } .mini:disabled { opacity: .4; cursor: default; }
.mini.danger:hover { color: var(--bad); border-color: var(--bad-line); }
.mini.accent { color: #FAF9F7; background: var(--accent); border-color: var(--accent); } .mini.accent:hover:not(:disabled) { background: var(--accent-deep); }
.draft-card { border-color: var(--line); background: var(--raise); padding: 14px 15px; }
.empty { color: var(--faint); font-size: 13px; text-align: center; margin-top: 30px; line-height: 1.7; padding: 0 24px; } .empty-icon { color: #C6C1B5; margin-bottom: 10px; display: flex; justify-content: center; }
.brain-empty { text-align: center; padding: 18px 18px 30px; }
.brain-stage { height: 320px; border-radius: 10px; background: radial-gradient(120% 120% at 50% 0%, #FCFBF9 0%, #EFECE5 100%); border: 1px solid var(--line); margin-bottom: 14px; overflow: hidden; }
.muted-stage { display: flex; align-items: center; justify-content: center; }
.persona { padding: 15px 16px; }
.persona-summary { font-size: 13px; line-height: 1.6; color: var(--body); overflow-wrap: anywhere; }
.conn-card { display: flex; align-items: center; gap: 13px; padding: 13px 15px; margin-bottom: 10px; }
.conn-icon { width: 38px; height: 38px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex: none; }
.x-icon { background: var(--ink); color: #fff; } .li-icon { background: #0a66c2; color: #fff; } .li-icon.ghost { background: #EDF1F6; color: #0a66c2; }
/* standardized account-row icons — one look across every platform */
.acct-ic.x { background: var(--ink); color: #fff; }
.acct-ic.linkedin { background: #0a66c2; color: #fff; }
.acct-ic.instagram { background: linear-gradient(45deg, #F58529 0%, #DD2A7B 55%, #8134AF 100%); color: #fff; }
.acct-ic.tiktok { background: #010101; color: #6CF5EA; }
.acct-ic.ghosted { background: var(--bg2); color: var(--faint); }
.conn-title { font-weight: 600; font-size: 13.5px; }
.conn-sec { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--faint); margin: 18px 0 9px; }
.slot-empty { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.chat-scroll { padding: 20px 20px 8px; display: flex; flex-direction: column; }
.chat-welcome { margin: auto; text-align: center; padding: 30px 0; }
.msg { display: flex; margin-bottom: 12px; } .msg.user { justify-content: flex-end; } .msg.assistant { justify-content: flex-start; }
.msg-col { display: flex; flex-direction: column; gap: 10px; max-width: 86%; min-width: 0; }
.msg-col.has-dp { width: 680px; max-width: 100%; }
.chat-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--bg); flex: none; }
.chat-head-label { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.chat-hist { position: absolute; top: 32px; right: 0; width: 320px; max-height: 400px; overflow-y: auto; z-index: 60; padding: 6px; box-shadow: 0 18px 50px -20px rgba(35,32,24,0.35); }
.hist-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.hist-row:hover { background: var(--bg2); }
.hist-row.on { background: var(--accent-soft); }
.hist-title { font-size: 12.5px; font-weight: 500; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hist-del { background: none; border: none; color: var(--faint); cursor: pointer; padding: 4px; border-radius: 6px; flex: none; display: flex; }
.hist-del:hover { color: var(--bad); background: var(--bad-soft); }
.bubble { max-width: 100%; padding: 11px 15px; font-size: 13.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.bubble.user { background: var(--ink); color: #FAF9F7; border-radius: 12px 12px 4px 12px; }
.bubble.assistant { background: var(--surface); border: 1px solid var(--line); color: var(--body); border-radius: 12px 12px 12px 4px; }
.composer-wrap { border-top: 1px solid var(--line); padding: 12px 16px 14px; background: var(--bg); }
.presets { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: none; }
.presets::-webkit-scrollbar { display: none; }
.preset { flex: none; background: transparent; border: 1px solid var(--line2); border-radius: 999px; color: var(--muted); font-size: 12px; padding: 6px 12px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; }
.preset:hover { color: var(--accent-text); border-color: var(--accent-line); background: var(--accent-soft); }
.composer { display: flex; gap: 10px; align-items: flex-end; }
.chat-input { flex: 1; resize: none; max-height: 140px; line-height: 1.5; padding: 11px 14px; }
.send { width: 42px; height: 42px; padding: 0; border-radius: 10px; flex: none; }
.dots { display: inline-flex; gap: 4px; align-items: center; } .dots i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; animation: blink 1s infinite; } .dots i:nth-child(2) { animation-delay: .2s; } .dots i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%,100% { opacity: .25; } 50% { opacity: 1; } }
.overlay { position: fixed; inset: 0; z-index: 70; background: rgba(30,27,20,0.30); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 480px; max-width: 100%; border-radius: 12px; padding: 22px; background: var(--surface); max-height: 88vh; overflow-y: auto; box-shadow: 0 30px 70px -28px rgba(35,32,24,0.45); }
.x-close { background: none; border: none; cursor: pointer; color: var(--faint); padding: 4px; display: flex; border-radius: 7px; } .x-close:hover { color: var(--ink); background: var(--bg2); }
.set-section { padding: 14px 0; border-top: 1px solid var(--line); } .set-section:first-of-type { border-top: none; padding-top: 0; }
.set-h { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--faint); margin-bottom: 10px; }
.set-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; padding: 6px 0; }
.set-input { width: auto; padding: 7px 11px; font-size: 13px; }
.draft-spin { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--accent-text); pointer-events: none; }
.dt { width: auto; padding: 8px 12px; font-size: 13px; color-scheme: light; flex: none; }
.count { font-size: 12px; color: var(--faint); white-space: nowrap; } .count.over { color: var(--bad); font-weight: 600; }
.dp { padding: 16px; width: 100%; }
.dp-head { display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; font-weight: 600; color: var(--accent-text); text-transform: uppercase; letter-spacing: .09em; margin-bottom: 10px; }
.dp-text { font-size: 14.5px; line-height: 1.6; resize: vertical; min-height: 150px; }
/* Auto-growing editors: the box fits the text — no inner scrollbars, no
   clipped lines (field-sizing is supported in all current Chromium/Safari). */
.dp-grow { field-sizing: content; max-height: 540px; overflow-y: auto; }
.dp-part { display: flex; gap: 10px; align-items: flex-start; }
.dp-part .dp-text { min-height: 60px; }
.dp-part-n { width: 22px; height: 22px; border-radius: 50%; background: var(--bg2); border: 1px solid var(--line); color: var(--muted); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: none; margin-top: 10px; }
/* slideshow style picker — swatch tiles */
.sw-row { display: flex; gap: 10px; flex-wrap: wrap; }
.sw-tile { display: flex; flex-direction: column; align-items: center; gap: 5px; background: none; border: none; cursor: pointer; padding: 0; font-family: inherit; }
.sw-tile-swatch { width: 56px; height: 42px; border-radius: 11px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; border: 1px solid var(--line2); transition: box-shadow .15s, border-color .15s; }
.sw-tile.on .sw-tile-swatch { border-color: transparent; box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
.sw-tile-label { font-size: 10.5px; font-weight: 600; color: var(--muted); }
.sw-tile.on .sw-tile-label { color: var(--accent-text); }
.dp-img-wrap { position: relative; margin-top: 10px; border-radius: 8px; overflow: hidden; }
.dp-img { width: 100%; display: block; border-radius: 8px; aspect-ratio: 1/1; object-fit: cover; background: var(--bg2); }
.dp-placeholder { display: flex; align-items: center; justify-content: center; color: var(--faint); }
.dp-regen { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border-radius: 7px; border: none; background: rgba(26,25,22,0.6); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px); }
.dp-regen:hover:not(:disabled) { background: rgba(26,25,22,0.82); } .dp-regen:disabled { opacity: .5; }
.dp-actions { display: flex; align-items: center; gap: 8px; margin-top: 13px; }
.icon-btn { height: 34px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: .15s; }
.icon-btn.x { width: 34px; flex: none; border: 1px solid var(--bad-line); background: var(--bad-soft); color: var(--bad); } .icon-btn.x:hover { background: #F4E1DE; }
.icon-btn.check { flex: 1; border: 1px solid var(--ok-line); background: var(--ok-soft); color: var(--ok); } .icon-btn.check:hover:not(:disabled) { background: #E2EFE5; } .icon-btn.check:disabled { opacity: .45; cursor: default; }
.dp-done { font-size: 12.5px; font-weight: 600; padding: 9px 14px; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); color: var(--ok); } .dp-done.discarded { color: var(--faint); } .dp-done.failed { color: var(--warn); }

/* thumbs feedback */
.thumb { width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--line2); background: var(--surface); color: var(--faint); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: .15s; padding: 0; }
.thumb:hover { color: var(--muted); border-color: #B9B3A6; }
.thumb.on.up { color: var(--ok); border-color: var(--ok-line); background: var(--ok-soft); }
.thumb.on.down { color: var(--bad); border-color: var(--bad-line); background: var(--bad-soft); }
/* countdown pill */
.cd-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--accent-text); background: var(--accent-soft); border: 1px solid var(--accent-line); padding: 4px 9px; border-radius: 999px; white-space: nowrap; flex: none; }
/* personal-image checkbox */
.dp-personal { display: flex; align-items: center; gap: 7px; margin-top: 8px; background: none; border: none; cursor: pointer; font-family: inherit; font-size: 12px; color: var(--muted); padding: 0; }
.mini-check { width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid var(--line2); display: inline-flex; align-items: center; justify-content: center; color: #fff; flex: none; }
.mini-check.on { background: var(--accent); border-color: var(--accent); }
.dp-acct { width: 100%; padding: 8px 11px; font-size: 13px; }
/* posted history */
.posted-wrap { margin-top: 14px; }
.posted-toggle { display: flex; align-items: center; gap: 7px; background: none; border: none; cursor: pointer; font-family: inherit; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--faint); padding: 4px 2px; }
.posted-toggle:hover { color: var(--muted); }
/* campaigns */
.camp-card { padding: 13px 15px; margin-bottom: 10px; }
.camp-state { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); background: var(--bg2); border-radius: 999px; padding: 2px 8px; }
.camp-state.on { color: var(--ok); background: var(--ok-soft); }
.camp-form { padding: 14px 15px; margin-bottom: 10px; border-color: var(--accent-line); }
.camp-accts { margin-top: 10px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.chip { background: transparent; border: 1px solid var(--line2); border-radius: 999px; color: var(--muted); font-size: 12px; padding: 5px 11px; cursor: pointer; font-family: inherit; transition: .15s; }
.chip.on { color: #FAF9F7; background: var(--ink); border-color: var(--ink); }
.camp-num { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); } .camp-num .field { width: 58px; padding: 6px 9px; font-size: 13px; text-align: center; }
/* photo grid */
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.photo-cell { position: relative; width: 62px; height: 62px; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); }
.photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo-del { position: absolute; top: 3px; right: 3px; width: 19px; height: 19px; border-radius: 5px; border: none; background: rgba(26,25,22,0.62); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.photo-del:hover { background: rgba(26,25,22,0.85); }
.photo-add { width: 62px; height: 62px; border-radius: 8px; border: 1.5px dashed var(--line2); color: var(--faint); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: .15s; }
.photo-add:hover { color: var(--accent-text); border-color: var(--accent-line); background: var(--accent-soft); }
/* generate-posts panel */
.gen-panel { padding: 16px; margin: 14px 0; background: var(--raise); border-color: var(--line); }
.gen-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
.gen-ic { width: 36px; height: 36px; border-radius: 9px; flex: none; display: flex; align-items: center; justify-content: center; color: #FAF9F7; background: var(--accent); }
.gen-title { font-weight: 700; font-size: 14.5px; color: var(--ink); }
.gen-sub { font-size: 12.5px; line-height: 1.55; color: var(--muted); margin-top: 3px; }
.gen-btn { width: 100%; padding: 11px; font-size: 13.5px; }
/* X connect guide modal */
.xc { width: 440px; }
.xc-glyph { width: 30px; height: 30px; border-radius: 8px; background: var(--ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.xc-lead { font-size: 13.5px; line-height: 1.6; color: var(--body); margin: 6px 0 16px; }
.xc-steps { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
.xc-step { display: flex; gap: 11px; font-size: 13px; line-height: 1.55; color: var(--body); }
.xc-num { width: 22px; height: 22px; border-radius: 50%; flex: none; background: var(--accent-soft); color: var(--accent-text); font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.xc-actions { display: flex; gap: 10px; }
.xc-open { flex: 1; justify-content: center; gap: 7px; text-decoration: none; }
.xc-go { flex: 1; padding: 9px 15px; }
/* engagement */
.camp-state.auto { color: var(--plum); background: var(--plum-soft); }
.reply-ctx { display: flex; align-items: flex-start; gap: 7px; font-size: 11.5px; color: var(--plum); background: var(--plum-soft); border: 1px solid var(--plum-line); border-radius: 8px; padding: 7px 10px; margin-bottom: 9px; text-decoration: none; line-height: 1.45; }
.reply-ctx:hover { background: #EEE7F7; }
.reply-ctx svg { flex: none; margin-top: 1px; }
.reply-ctx-text { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
/* campaign / engagement activity monitor */
.act-toggle { display: flex; align-items: center; gap: 6px; width: 100%; margin-top: 9px; padding: 6px 0 0; background: none; border: none; border-top: 1px solid var(--line); cursor: pointer; font-family: inherit; font-size: 11.5px; font-weight: 600; color: var(--muted); }
.act-toggle:hover { color: var(--ink); }
.act-list { padding-top: 8px; display: flex; flex-direction: column; gap: 9px; max-height: 260px; overflow-y: auto; }
.act-row { display: flex; gap: 9px; align-items: flex-start; }
.act-text { font-size: 12.5px; line-height: 1.5; color: var(--body); white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
/* comment-style checkboxes */
.style-opt { display: flex; align-items: flex-start; gap: 9px; text-align: left; background: var(--surface); border: 1px solid var(--line2); border-radius: 8px; padding: 9px 11px; cursor: pointer; font-family: inherit; transition: .15s; }
.style-opt:hover { border-color: var(--accent-line); background: var(--raise); }
.style-opt.on { border-color: #CE8A6B; background: var(--accent-soft); }
.style-opt .mini-check { margin-top: 1px; }
.style-name { display: block; font-size: 13px; font-weight: 600; color: var(--ink); }
.style-desc { display: block; font-size: 11.5px; color: var(--muted); margin-top: 1px; line-height: 1.4; }
/* account roles */
.conn-card.primary { border-color: var(--gold-line); background: linear-gradient(0deg, #F8F4E9, var(--surface)); }
.role-badge { font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; color: var(--muted); background: var(--bg2); border: 1px solid var(--line); display: inline-flex; align-items: center; gap: 3px; }
.role-badge.primary { color: var(--gold); background: var(--gold-soft); border-color: var(--gold-line); }
/* live status */
.live-status { display: flex; align-items: center; gap: 7px; margin-top: 8px; padding: 7px 9px; border-radius: 7px; background: var(--bg2); font-size: 11.5px; color: var(--muted); }
.live-status.on { background: var(--accent-soft); color: var(--accent-text); }
.live-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
/* slideshow studio */
.acct-row { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 10px; }
.acct-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 999px; background: var(--bg2); border: 1px solid var(--line); }
.ss-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sw-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; padding: 5px 11px 5px 5px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line2); cursor: pointer; font-family: inherit; }
.sw-chip.on { border-color: #CE8A6B; background: var(--accent-soft); }
.sw-chip .sw { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; font-size: 13px; font-weight: 800; border: 1px solid rgba(0,0,0,.08); }
.ss-preview { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x mandatory; }
.ss-slide { width: 152px; height: 190px; flex: none; border-radius: 8px; object-fit: cover; border: 1px solid var(--line); scroll-snap-align: start; }
.ss-thumb { width: 46px; height: 58px; border-radius: 6px; object-fit: cover; flex: none; border: 1px solid var(--line); }
/* collapsible sections + clip studio */
.sec-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 14px; background: none; border: none; cursor: pointer; font-family: inherit; text-align: left; }
.sec-title { font-weight: 700; font-size: 13.5px; color: var(--ink); }
.clip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 10px; }
.clip-card { min-width: 0; }
.clip-vid { width: 100%; aspect-ratio: 9/16; object-fit: cover; border-radius: 8px; background: #1A1A18; border: 1px solid var(--line); }
.qfilter { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.fail-banner { font-size: 12.5px; font-weight: 600; color: var(--bad); background: var(--bad-soft); border: 1px solid var(--bad-line); border-radius: 8px; padding: 10px 13px; margin-bottom: 12px; }
.day-head { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--faint); margin: 16px 0 8px; }
.day-head:first-child { margin-top: 2px; }
.qchip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; padding: 6px 12px; border-radius: 999px; background: transparent; border: 1px solid var(--line2); color: var(--muted); cursor: pointer; font-family: inherit; }
.qchip.on { background: var(--ink); border-color: var(--ink); color: #FAF9F7; }
.camp-card.on { border-color: var(--gold-line); background: #F8F4E9; }
/* left pane anchors the floating accounts dot */
.left { position: relative; }
/* stat tiles */
.stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 8px; margin: 4px 0 16px; }
.stat-tile { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 10px; text-align: center; }

/* ── Platform-scoped accents ──────────────────────────────────────────────────
   Each platform tab carries its OWN hue — selected states, focus rings, swatch
   rings, form borders all re-tint via the accent variables instead of the
   global terracotta. Queue/Campaigns keep the warm default. */
.plat-x { --accent: #16181B; --accent-deep: #000; --accent-soft: #EEEFF1; --accent-line: #DBDDE1; --accent-text: #16181B; }
.plat-linkedin { --accent: #0A66C2; --accent-deep: #084E95; --accent-soft: #E9F1FA; --accent-line: #C6DDF2; --accent-text: #0A66C2; }
.plat-instagram { --accent: #D6336C; --accent-deep: #B02458; --accent-soft: #FBEAF1; --accent-line: #F3CADB; --accent-text: #C2255C; }
.plat-tiktok { --accent: #0CA8A0; --accent-deep: #08766F; --accent-soft: #E4F6F5; --accent-line: #BFE8E5; --accent-text: #0B8F88; }
/* Brand hairline across the stat tiles — quiet identity, not a paint job. */
.plat-x .stat-tile, .plat-linkedin .stat-tile, .plat-instagram .stat-tile, .plat-tiktok .stat-tile { position: relative; overflow: hidden; }
.plat-x .stat-tile::before, .plat-linkedin .stat-tile::before, .plat-instagram .stat-tile::before, .plat-tiktok .stat-tile::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2.5px;
}
.plat-x .stat-tile::before { background: var(--ink); }
.plat-linkedin .stat-tile::before { background: linear-gradient(90deg, #0A66C2, #5EA8E8); }
.plat-instagram .stat-tile::before { background: linear-gradient(90deg, #F58529, #DD2A7B 55%, #8134AF); }
.plat-tiktok .stat-tile::before { background: linear-gradient(90deg, #25F4EE, #0CA8A0 50%, #FE2C55); }
.stat-num { font-family: var(--serif); font-weight: 600; font-size: 21px; letter-spacing: -0.01em; color: var(--ink); }
.stat-lbl { font-size: 10.5px; color: var(--faint); margin-top: 3px; font-weight: 500; text-transform: uppercase; letter-spacing: .07em; }
/* clean auto-reply blocks */
.ar-block { padding: 13px 14px; margin-bottom: 9px; display: block; }
.ar-block.on { border-color: var(--accent-line); }
.ar-draft { background: var(--raise); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-top: 9px; }
.ar-comment { font-size: 11.5px; color: var(--muted); line-height: 1.45; overflow-wrap: anywhere; }
.ar-author { font-weight: 700; color: var(--body); }
.ar-reply { font-size: 13px; color: var(--ink); line-height: 1.5; margin-top: 5px; overflow-wrap: anywhere; }
/* floating accounts dot */
.facct { position: absolute; right: 18px; bottom: 18px; z-index: 20; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.facct-dot { position: relative; width: 46px; height: 46px; border-radius: 50%; border: 1px solid var(--line2); background: var(--surface); color: var(--ink); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px -8px rgba(35,32,24,0.35); transition: transform .12s, box-shadow .15s; }
.facct-dot:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -10px rgba(35,32,24,0.4); }
.facct-dot.on { background: var(--ink); color: #FAF9F7; border-color: var(--ink); }
.facct-count { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid var(--bg); }
.facct-panel { width: 320px; max-width: calc(100vw - 40px); max-height: 60vh; overflow-y: auto; padding: 15px 16px; border-radius: 12px; box-shadow: 0 20px 50px -22px rgba(35,32,24,0.45); }
.facct-body .conn-sec:first-child { margin-top: 4px; }
/* clearance so the floating accounts dot never covers the last card's buttons */
.left .scroll { padding-bottom: 96px; }
/* feeder agents */
.agent-note { font-size: 11.5px; font-style: italic; font-family: var(--serif); color: var(--muted); margin-top: 5px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.agent-pfp { border-radius: 50%; object-fit: cover; flex: none; border: 1px solid var(--line2); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-family: var(--serif); }
/* fleet strip — feeder agents across platforms at a glance */
.fleet { padding: 14px 16px 12px; margin-bottom: 12px; overflow: visible; }
.fleet-row { display: flex; gap: 18px; flex-wrap: wrap; }
.fleet-cell { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 66px; cursor: pointer; }
.fleet-cell:hover .fleet-ava { border-color: var(--accent) !important; }
.camp2-title { cursor: pointer; min-width: 0; flex: 1; }
.camp2-pencil { opacity: 0; transition: opacity .15s; color: var(--faint); }
.camp2-title:hover .camp2-pencil { opacity: 1; }
.fleet-ava { position: relative; border: 2.5px solid var(--line2); border-radius: 50%; padding: 2.5px; background: var(--surface); }
.fleet-ava .agent-pfp { border: none; display: flex; }
.fleet-dot { position: absolute; right: 0; bottom: 0; width: 13px; height: 13px; border-radius: 50%; background: #C9C5BC; border: 2.5px solid var(--surface); }
.fleet-dot.on { background: var(--ok); }
.fleet-name { font-size: 11px; font-weight: 600; color: var(--muted); max-width: 66px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fleet-tip { position: absolute; top: 78px; left: 50%; margin-left: -115px; width: 230px; padding: 12px 13px; z-index: 45; box-shadow: 0 18px 44px -16px rgba(35,32,24,0.38); }
.fleet-cell:first-child .fleet-tip { margin-left: -28px; }
.fleet-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 10px; margin-top: 11px; }
.fleet-stats > div { display: flex; flex-direction: column; gap: 1px; }
.fleet-stats b { font-size: 15.5px; font-weight: 700; color: var(--ink); line-height: 1.1; }
.fleet-stats span { font-size: 9.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); font-weight: 600; }
/* campaign cards v2 — headline, live pill, facepile crew */
.camp2 { position: relative; padding: 16px 18px 14px; margin-bottom: 12px; border-radius: 14px; }
.camp2.live { border-color: var(--ok-line); }
.camp2.live::before { content: ''; position: absolute; left: -1px; top: 16px; bottom: 16px; width: 3px; border-radius: 0 3px 3px 0; background: var(--ok); }
.camp2-name { font-family: var(--serif); font-size: 17px; font-weight: 600; line-height: 1.25; }
.camp2-sub { font-size: 12px; color: var(--muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-pill { border: 1px solid var(--line2); background: var(--bg2); color: var(--muted); font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 999px; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 6px; flex: none; transition: .15s; }
.live-pill:hover { border-color: var(--line-hover); }
.live-pill.on { color: var(--ok); background: var(--ok-soft); border-color: var(--ok-line); }
.live-pill .pulse { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: blink 1.6s infinite; }
.facepile { display: flex; align-items: center; cursor: pointer; }
.facepile .agent-pfp { border: 2px solid var(--surface); }
.facepile > span + span .agent-pfp, .facepile .facepile-add { margin-left: -9px; }
.facepile-add { width: 30px; height: 30px; border-radius: 50%; border: 1.5px dashed var(--line-hover); background: var(--surface); color: var(--muted); display: inline-flex; align-items: center; justify-content: center; z-index: 1; transition: .15s; }
.facepile:hover .facepile-add { color: var(--accent-text); border-color: var(--accent-line); }
.camp2-row { display: flex; align-items: center; gap: 14px; margin-top: 13px; flex-wrap: wrap; }
.camp2-stats { font-size: 12px; color: var(--muted); white-space: nowrap; }
.camp2-stats b { color: var(--ink); font-weight: 700; }
.camp2-manage { border-top: 1px dashed var(--line); margin-top: 12px; padding-top: 10px; }
.chip.sm { padding: 3px 9px; font-size: 11px; }
/* campaign onboarding — guided brief */
.camp-onb { padding: 20px 20px 18px; margin-bottom: 12px; border-radius: 14px; }
.onb-dots { display: flex; gap: 6px; }
.onb-q { font-family: var(--serif); font-size: 18px; font-weight: 600; margin-bottom: 13px; line-height: 1.25; }
.onb-label { display: block; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); margin: 12px 0 6px; }
.onb-draft { width: 100%; margin-top: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 11px; border-radius: 10px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; color: var(--accent-text); background: var(--accent-soft); border: 1px dashed var(--accent-line); transition: .15s; }
.onb-draft:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
.onb-draft:disabled { opacity: .5; cursor: default; }
.onb-intensity { display: flex; flex-direction: column; gap: 8px; }
.onb-int { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 11px 14px; border-radius: 11px; border: 1px solid var(--line2); background: var(--surface); cursor: pointer; font-family: inherit; transition: .15s; }
.onb-int:hover { border-color: var(--line-hover); }
.onb-int.on { border-color: var(--accent); background: var(--accent-soft); }
.onb-int-l { font-size: 13.5px; font-weight: 700; color: var(--ink); }
.onb-int-d { font-size: 11.5px; color: var(--muted); }
/* trend formats — what's working now */
.trend-card { padding: 12px 14px; margin-bottom: 8px; }
.trend-name { font-weight: 700; font-size: 13.5px; }
.trend-pattern { font-size: 12px; color: var(--body); background: var(--bg2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin-top: 8px; line-height: 1.5; white-space: pre-wrap; }
.trend-payoff { font-size: 12px; color: var(--body); margin-top: 8px; line-height: 1.5; }
.trend-payoff span { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--ok); background: var(--ok-soft); border: 1px solid var(--ok-line); padding: 1px 6px; border-radius: 5px; margin-right: 6px; }
.trend-badge.arch { background: var(--plum-soft); border-color: var(--plum-line); color: var(--plum); text-transform: capitalize; }
/* queue list/calendar toggle */
.qview { display: inline-flex; gap: 2px; background: var(--bg2); border: 1px solid var(--line); border-radius: 9px; padding: 2px; }
.qview-btn { width: 28px; height: 24px; border: none; background: none; border-radius: 7px; color: var(--faint); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: .15s; }
.qview-btn.on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
/* calendar */
.cal { margin-top: 4px; }
.cal-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.cal-nav { width: 28px; height: 28px; border: 1px solid var(--line2); background: var(--surface); border-radius: 8px; cursor: pointer; color: var(--muted); display: inline-flex; align-items: center; justify-content: center; }
.cal-nav:hover { border-color: var(--line-hover); color: var(--ink); }
.cal-title { font-family: var(--serif); font-size: 16.5px; font-weight: 600; }
.cal-today { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--accent-text); background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cal-dow { margin-bottom: 4px; }
.cal-dowcell { text-align: center; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); padding: 2px 0; }
.cal-cell { min-height: 76px; border: 1px solid var(--line); border-radius: 9px; padding: 5px; background: var(--surface); display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
.cal-cell.empty { border: none; background: none; }
.cal-cell.today { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.cal-daynum { font-size: 11px; font-weight: 600; color: var(--muted); padding-left: 2px; }
.cal-cell.today .cal-daynum { color: var(--accent-text); }
.cal-chips { display: flex; flex-direction: column; gap: 3px; min-height: 0; }
.cal-chip { display: flex; align-items: center; gap: 4px; width: 100%; border: none; background: var(--bg2); border-radius: 5px; padding: 2px 5px; cursor: pointer; font-family: inherit; transition: .12s; }
.cal-chip:hover { background: var(--accent-soft); }
.cal-chip.done { opacity: .5; }
.cal-chip.bad { background: var(--bad-soft); }
.cal-chip-t { font-size: 10px; font-weight: 600; color: var(--body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-more { font-size: 9.5px; color: var(--faint); font-weight: 600; padding-left: 4px; }
/* X tab: brain (left) + stats stacked (right), both ending at the same line */
.phead { display: flex; gap: 12px; height: 190px; margin-bottom: 14px; }
.phead-brain { flex: 1.7; min-width: 0; border-radius: 14px; overflow: hidden; }
.phead-brain .brain-stage { height: 100% !important; margin-bottom: 0 !important; border-radius: 14px; }
.phead .stat-col { flex: 1; min-width: 144px; }
.stat-col { height: 100%; display: flex; flex-direction: column; padding: 0; border-radius: 14px; overflow: hidden; }
.stat-col-row { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 0 18px; border-top: 1px solid var(--line); }
.stat-col-row:first-child { border-top: none; }
.stat-col-num { font-family: var(--serif); font-size: 25px; font-weight: 600; line-height: 1; letter-spacing: -0.01em; color: var(--ink); }
.stat-col-lbl { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); }
/* autopilot / engage cadence row + stepper + edit-brief link */
.ap-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; }
.ap-rowlabel { font-size: 13px; font-weight: 600; color: var(--ink); }
.stepper { display: inline-flex; align-items: center; gap: 2px; background: var(--bg2); border: 1px solid var(--line2); border-radius: 9px; padding: 2px; }
.stepper button { width: 28px; height: 26px; border: none; background: none; border-radius: 7px; color: var(--muted); font-size: 17px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
.stepper button:hover:not(:disabled) { background: var(--surface); color: var(--ink); }
.stepper button:disabled { opacity: .35; cursor: default; }
.stepper-val { min-width: 26px; text-align: center; font-size: 14px; font-weight: 700; color: var(--ink); }
.ap-edit { margin-top: 12px; background: none; border: none; padding: 0; color: var(--accent-text); font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.ap-edit:hover { color: var(--accent-deep); }
/* calendar: clickable cells + day detail panel */
.cal-cell { font-family: inherit; text-align: left; cursor: default; }
.cal-cell.has { cursor: pointer; }
.cal-cell.has:hover { border-color: var(--line-hover); }
.cal-cell.sel { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.cal-chip { cursor: inherit; }
.cal-day { margin-top: 12px; padding: 14px 16px; }
.cal-day-title { font-family: var(--serif); font-size: 15.5px; font-weight: 600; }
.cal-day-row { display: flex; gap: 12px; padding: 9px 0; border-top: 1px solid var(--line); }
.cal-day-row:first-of-type { border-top: none; }
.cal-day-time { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; flex: none; min-width: 78px; padding-top: 1px; }
.cal-day-body { min-width: 0; flex: 1; }
.cal-day-text { font-size: 13px; color: var(--body); line-height: 1.45; }
.cal-day-status { font-size: 11px; font-weight: 600; text-transform: capitalize; }
.psec-head { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: var(--faint); margin: 0 2px 10px; }
.psec-head .live-pill { text-transform: none; letter-spacing: 0; }
/* autopilot */
.autopilot { padding: 15px 16px; border-radius: 14px; }
.autopilot.on { border-color: var(--accent-line); }
.ap-icon { width: 34px; height: 34px; border-radius: 9px; background: var(--accent-soft); color: var(--accent-text); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.ap-title { font-weight: 700; font-size: 14.5px; }
/* recent replies feed */
.reply-feed { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 8px; }
.reply-feed-h { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); margin-bottom: 6px; }
.reply-feed-row { display: flex; gap: 8px; padding: 5px 0; align-items: flex-start; }
.reply-feed-ctx { display: block; font-size: 11px; color: var(--muted); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reply-feed-ctx:hover { color: var(--accent-text); }
.reply-feed-text { font-size: 12.5px; color: var(--body); line-height: 1.4; margin-top: 1px; }
/* tag input — chips you add (handles, keywords), no surrounding box */
.taginput { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 2px 0; }
.tag { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 999px; padding: 4px 6px 4px 11px; font-size: 12.5px; font-weight: 600; color: var(--accent-text); white-space: nowrap; }
.tag button { background: none; border: none; cursor: pointer; color: var(--accent-text); opacity: .55; display: inline-flex; padding: 1px; border-radius: 50%; }
.tag button:hover { opacity: 1; }
.tag-input { flex: 1; min-width: 110px; border: none; background: none; outline: none; font-family: inherit; font-size: 13.5px; color: var(--ink); padding: 4px 2px; }
.tag-input::placeholder { color: var(--faint); }
/* chat reopen button (when collapsed) */
.chat-reopen { position: absolute; right: 18px; bottom: 18px; z-index: 20; display: inline-flex; align-items: center; gap: 7px; padding: 10px 16px; border-radius: 999px; border: 1px solid var(--line2); background: var(--ink); color: #FAF9F7; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 10px 30px -10px rgba(35,32,24,0.5); transition: transform .12s; }
.chat-reopen:hover { transform: translateY(-1px); }
.trend-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: var(--bg2); border: 1px solid var(--line2); color: var(--muted); }
.trend-badge.render { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent-text); }
.trend-badge.ad { background: var(--gold-soft); border-color: var(--gold-line); color: var(--gold); }
.trend-badge.link { text-decoration: none; cursor: pointer; }
.trend-badge.link:hover { color: var(--accent-text); border-color: var(--accent-line); }
/* chat platform-scope selector */
.chat-scope { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-bottom: 9px; }
.scope-chip { display: inline-flex; align-items: center; gap: 5px; background: transparent; border: 1px solid var(--line2); border-radius: 999px; color: var(--muted); font-size: 11.5px; font-weight: 600; padding: 4px 10px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; }
.scope-chip:hover { border-color: var(--accent-line); color: var(--accent-text); }
.scope-chip.on { background: var(--ink); border-color: var(--ink); color: #FAF9F7; }
/* ── account page ── */
.acctpage { position: fixed; inset: 0; z-index: 60; background: var(--bg); display: flex; flex-direction: column; overflow: hidden; }
.acct-top { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--bg); }
.acct-wrap { flex: 1; min-height: 0; display: flex; max-width: 1080px; width: 100%; margin: 0 auto; }
.acct-nav { width: 232px; flex: none; border-right: 1px solid var(--line); padding: 18px 14px; display: flex; flex-direction: column; gap: 4px; }
.acct-id { display: flex; align-items: center; gap: 11px; padding: 6px 8px 16px; min-width: 0; }
.acct-avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--ink); color: #FAF9F7; font-weight: 600; font-size: 16px; font-family: var(--serif); display: flex; align-items: center; justify-content: center; flex: none; }
.acct-navbtn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: none; background: none; border-radius: 8px; color: var(--muted); font-size: 13.5px; font-weight: 600; font-family: inherit; cursor: pointer; transition: .15s; text-align: left; }
.acct-navbtn:hover { background: var(--bg2); color: var(--ink); }
.acct-navbtn.on { background: var(--accent-soft); color: var(--accent-text); }
.acct-content { flex: 1; min-width: 0; overflow-y: auto; padding: 26px 30px 60px; }
.acct-sec-wrap { max-width: 640px; }
.acct-h { font-family: var(--serif); font-size: 15px; font-weight: 600; color: var(--ink); margin: 24px 0 10px; }
.acct-h:first-child { margin-top: 0; }
.acct-card { padding: 16px 17px; }
.acct-card .ob-label:first-child { margin-top: 0; }
.acct-card .field + .ob-label { margin-top: 14px; }
.acct-save { margin-top: 22px; display: flex; justify-content: flex-end; }
/* pricing */
.plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
.plan-card { display: flex; flex-direction: column; padding: 20px 19px; border-radius: 12px; }
.plan-card.team { border-color: var(--accent-line); background: linear-gradient(180deg, #F6F0EA, var(--surface)); }
.plan-card.current { border-color: var(--gold-line); }
.plan-ic { width: 28px; height: 28px; border-radius: 7px; background: var(--accent-soft); color: var(--accent-text); display: flex; align-items: center; justify-content: center; flex: none; }
.plan-name { font-family: var(--serif); font-weight: 600; font-size: 18px; letter-spacing: 0; }
.plan-badge { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--gold); background: var(--gold-soft); border: 1px solid var(--gold-line); padding: 2px 8px; border-radius: 999px; }
.plan-price { font-family: var(--serif); font-weight: 600; font-size: 36px; letter-spacing: -0.01em; margin: 12px 0 2px; }
.plan-feats { list-style: none; padding: 0; margin: 14px 0 18px; display: flex; flex-direction: column; gap: 9px; }
.plan-feats li { display: flex; align-items: flex-start; gap: 9px; font-size: 12.5px; line-height: 1.45; color: var(--body); }
.plan-feats li svg { color: var(--ok); flex: none; margin-top: 2px; }
.seat-row { display: flex; align-items: center; gap: 10px; margin: 12px 0 2px; padding: 9px 11px; background: var(--bg2); border-radius: 8px; }
.stepper { display: inline-flex; align-items: center; gap: 0; border: 1px solid var(--line2); border-radius: 7px; overflow: hidden; background: var(--surface); }
.stepper button { width: 28px; height: 28px; border: none; background: var(--surface); color: var(--body); font-size: 16px; cursor: pointer; font-family: inherit; }
.stepper button:hover:not(:disabled) { background: var(--bg2); } .stepper button:disabled { opacity: .35; cursor: default; }
.stepper span { min-width: 30px; text-align: center; font-weight: 700; font-size: 13.5px; }
.plan-total { font-weight: 700; font-size: 13px; color: var(--ink); white-space: nowrap; }
.acct-tabstrip { display: none; gap: 6px; padding: 10px 16px 0; overflow-x: auto; }
@media (max-width: 720px) {
  .acct-nav { display: none; }
  .acct-tabstrip { display: flex; }
  .plan-grid { grid-template-columns: 1fr; }
}
/* phones: stack the two panes; the left pane scrolls, chat takes the rest */
@media (max-width: 860px) {
  .cols { flex-direction: column; }
  .left { width: 100%; max-height: 56vh; border-right: none; border-bottom: 1px solid var(--line); }
  .split-handle { display: none; }
  .seg { flex-wrap: wrap; }
}

/* ════ landing (marketing site) ════ */
.site { position: relative; z-index: 1; }
.rv { transition: opacity .4s ease, transform .4s ease; }
.rv.pre { opacity: 0; transform: translateY(8px); }
.ld-nav { position: sticky; top: 0; z-index: 40; transition: background .2s ease, border-color .2s ease; border-bottom: 1px solid transparent; }
.ld-nav.scrolled { background: rgba(250,249,247,0.8); backdrop-filter: blur(12px); border-bottom-color: var(--line); }
.ld-nav-in { max-width: 1080px; margin: 0 auto; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ld-links { display: flex; gap: 28px; }
.ld-links a { font-size: 14px; color: var(--muted); text-decoration: none; opacity: .85; transition: opacity .2s ease, color .2s ease; }
.ld-links a:hover { opacity: 1; color: var(--ink); }
.ld-signin { background: none; border: none; font-family: inherit; font-size: 14px; color: var(--muted); cursor: pointer; transition: color .2s ease; padding: 0; }
.ld-signin:hover { color: var(--ink); }
.ld-cta { background: var(--accent); border: 1px solid var(--accent); color: #FAF9F7; font-family: inherit; font-size: 13px; font-weight: 500; padding: 8px 16px; border-radius: 100px; cursor: pointer; transition: background .2s ease, transform .1s ease; white-space: nowrap; }
.ld-cta:hover { background: var(--accent-deep); }
.ld-cta:active { transform: scale(0.98); }
.ld-cta.lg { font-size: 14.5px; padding: 12px 26px; }
.ld-ghost { display: inline-flex; align-items: center; background: transparent; border: 1px solid var(--line); color: var(--ink); font-family: inherit; font-size: 14.5px; font-weight: 500; padding: 12px 26px; border-radius: 100px; cursor: pointer; text-decoration: none; transition: border-color .2s ease, transform .1s ease; }
.ld-ghost:hover { border-color: var(--line-hover); }
.ld-ghost:active { transform: scale(0.98); }
.ld-eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); margin-bottom: 16px; font-weight: 500; }
.ld-hero { max-width: 1080px; margin: 0 auto; padding: 160px 24px 120px; text-align: center; }
.ld-h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(42px, 6vw, 72px); line-height: 1.08; letter-spacing: -0.01em; color: var(--ink); margin: 0 0 22px; }
.ld-sub { font-size: 18px; line-height: 1.7; color: var(--muted); max-width: 480px; margin: 0 auto 34px; }
.ld-proof { font-size: 12.5px; color: var(--faint); margin-top: 26px; }
.ld-sec { max-width: 1080px; margin: 0 auto; padding: 120px 24px; border-top: 1px solid var(--line); }
.ld-h2 { font-family: var(--serif); font-weight: 400; font-size: clamp(28px, 3.4vw, 36px); line-height: 1.2; color: var(--ink); margin: 0 0 40px; max-width: 560px; }
.ld-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.ld-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 24px; transition: border-color .2s ease, background .2s ease, transform .2s ease; }
.ld-card:hover { border-color: var(--line-hover); background: var(--bg2); transform: translateY(-2px); }
.ld-card-t { font-family: var(--serif); font-weight: 500; font-size: 17px; color: var(--ink); margin: 14px 0 6px; }
.ld-card-t:first-child { margin-top: 0; }
.ld-card-b { font-size: 14px; line-height: 1.65; color: var(--muted); }
.ld-bento { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; align-items: stretch; }
.ld-big { display: flex; flex-direction: column; gap: 0; }
.ld-stack { display: flex; flex-direction: column; gap: 24px; }
.ld-stack .ld-card { flex: 1; }
.ld-mock-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.ld-mock-pill { font-size: 11px; color: var(--accent-text); background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 100px; padding: 3px 10px; }
.ld-mock-row { display: flex; align-items: center; gap: 12px; padding: 13px 2px; border-top: 1px solid var(--line); }
.ld-mock-row:last-child { border-bottom: 1px solid var(--line); }
.ld-mock-t { flex: 1; min-width: 0; font-size: 13.5px; color: var(--body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld-mock-meta { flex: none; font-size: 11.5px; color: var(--faint); }
.ld-quotes { display: flex; flex-direction: column; gap: 56px; max-width: 640px; }
.ld-quote { margin: 0; }
.ld-quote p { font-family: var(--serif); font-style: italic; font-weight: 400; font-size: 20px; line-height: 1.55; color: var(--ink); margin: 0 0 10px; }
.ld-quote cite { font-style: normal; font-size: 13px; color: var(--faint); }
.ld-price-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 720px; }
.ld-price { padding: 28px 0 0; border-top: 2px solid var(--ink); }
.ld-price-name { font-family: var(--serif); font-size: 19px; color: var(--ink); }
.ld-price-amt { font-family: var(--serif); font-weight: 400; font-size: 40px; color: var(--ink); margin: 8px 0 10px; }
.ld-price-amt span { font-family: 'Inter', sans-serif; font-size: 13px; color: var(--faint); margin-left: 6px; }
.ld-foot { background: var(--bg2); border-top: 1px solid var(--line); }
.ld-foot-in { max-width: 1080px; margin: 0 auto; padding: 56px 24px 28px; }
.ld-foot-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; padding-bottom: 40px; }
.ld-foot-grid a, .ld-foot-grid span { display: block; font-size: 13px; color: var(--muted); text-decoration: none; padding: 4px 0; }
.ld-foot-grid a:hover { color: var(--ink); }
.ld-foot-h { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); margin-bottom: 10px; font-weight: 500; }
.ld-foot-bar { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding-top: 22px; font-size: 12.5px; color: var(--faint); }
@media (max-width: 860px) {
  .ld-links { display: none; }
  .ld-hero { padding: 110px 22px 80px; }
  .ld-sec { padding: 80px 22px; }
  .ld-grid { grid-template-columns: 1fr; }
  .ld-bento { grid-template-columns: 1fr; }
  .ld-price-wrap { grid-template-columns: 1fr; }
  .ld-foot-grid { grid-template-columns: 1fr 1fr; }
}
`
