'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  Check as LCheck, X as LX, RefreshCw, Sparkles, Send, Plus,
  Brain, ChevronDown, Trash2, Pencil, Crown, Clock, Wand2, Image as LImage,
  ThumbsUp, ThumbsDown, Upload, Play, MessageCircle, Star, Loader2, Film, FolderOpen, Search as LSearch,
  Paperclip, Captions, Video as LVideo, LayoutGrid as LGrid, Copy as LCopy,
  ArrowLeft, CreditCard, Users, User as LUser, Bot, History as LHistory,
  Calendar as LCalendar, List as LList, Clapperboard,
} from 'lucide-react'
import { SLIDESHOW_FORMATS, SLIDE_STYLE_LIST } from '@/lib/slideshow-styles'
import { PLANS, PLAN_LIST, monthlyEquivalent } from '@/lib/plans'

function LIcon({ size = 18 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.74v20.52C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.74V1.74C24 .78 23.2 0 22.22 0z"/></svg> }

const BrainViz = dynamic(() => import('./BrainViz'), { ssr: false })
const VideoEditor = dynamic(() => import('./components/VideoEditor'), { ssr: false })

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

// ── Safe chat markdown — renders the agent's replies as React nodes (never
//    dangerouslySetInnerHTML): clickable links ([label](url) + bare urls), bold,
//    inline code, and "- " bullet lists. Links open in a new tab, noopener. ────
const MD_INLINE = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(https?:\/\/[^\s<>()]+)/
function shortUrl(u) { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? '/…' : '') } catch { return u.slice(0, 40) } }
function mdInline(s, k = { i: 0 }) {
  const out = []; let rest = String(s)
  while (rest) {
    const m = rest.match(MD_INLINE)
    if (!m) { out.push(rest); break }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    if (m[1]) out.push(<a key={k.i++} href={m[3]} target="_blank" rel="noopener noreferrer" className="mb-link">{m[2]}</a>)
    else if (m[4]) out.push(<strong key={k.i++}>{m[5]}</strong>)
    else if (m[6]) out.push(<code key={k.i++} className="mb-code">{m[7]}</code>)
    else if (m[8]) out.push(<a key={k.i++} href={m[8]} target="_blank" rel="noopener noreferrer" className="mb-link">{shortUrl(m[8])} ↗</a>)
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}
function MessageBody({ text }) {
  const k = { i: 0 }
  return String(text || '').split('\n').map((line, li) => {
    const bullet = /^\s*[-*•·]\s+/.test(line)
    const content = bullet ? line.replace(/^\s*[-*•·]\s+/, '') : line
    if (!content.trim()) return <div key={li} className="mb-gap" />
    return <div key={li} className={bullet ? 'mb-li' : 'mb-p'}>{bullet && <span className="mb-dot">•</span>}<span>{mdInline(content, k)}</span></div>
  })
}

// Hover actions under an assistant message: Copy, and (on the latest) Retry.
function MsgActions({ text, onRegenerate }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(String(text || '')); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { /* clipboard blocked */ } }
  return (
    <div className="msg-actions">
      <button className="msg-act" onClick={copy} title="Copy">{copied ? <LCheck size={12} strokeWidth={3} /> : <LCopy size={12} />}{copied ? 'Copied' : 'Copy'}</button>
      {onRegenerate && <button className="msg-act" onClick={onRegenerate} title="Regenerate this reply"><RefreshCw size={12} /> Retry</button>}
    </div>
  )
}
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
  function finish(result, label) { if (done) return; setDone(result); setDoneLabel(label); onOutcome && onOutcome(result, label) }

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

// ── Slide editor — edit the TEXT baked into a carousel's slides, not just the
//    caption. The copy lives as structured data (kind/heading/body per slide);
//    editing a field re-renders just that slide server-side (pure Satori, no
//    LLM) and hot-swaps its image. Self-owned state; reports up via onChange. ──
function SlideEditor({ slides: slides0, imageUrls: urls0, style, format, handle, authed, onChange }) {
  const [slides, setSlides] = useState(slides0 || [])
  const [urls, setUrls] = useState(urls0 || [])
  const [open, setOpen] = useState(null) // index being edited
  const [busy, setBusy] = useState({})   // {index: true} while re-rendering
  const timers = useRef({})
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  useEffect(() => { onChangeRef.current && onChangeRef.current(slides, urls) }, [slides, urls])
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  function renderSlide(i, nextSlides) {
    clearTimeout(timers.current[i])
    timers.current[i] = setTimeout(async () => {
      setBusy(b => ({ ...b, [i]: true }))
      try {
        const r = await authed('/api/slideshow/render-slide', { method: 'POST', body: JSON.stringify({ style, format, handle, slides: nextSlides, indices: [i] }) })
        const d = await r.json()
        if (d.urls?.length) setUrls(prev => { const n = prev.slice(); for (const u of d.urls) n[u.index] = u.url; return n })
      } catch { /* keep the old image on failure */ }
      setBusy(b => ({ ...b, [i]: false }))
    }, 650)
  }
  function edit(i, field, val) {
    const next = slides.map((s, j) => j === i ? { ...s, [field]: val } : s)
    setSlides(next); renderSlide(i, next)
  }
  const words = v => String(v || '').trim().split(/\s+/).filter(Boolean).length
  const kindLabel = k => k === 'cover' ? 'Cover' : k === 'cta' ? 'Last slide (CTA)' : 'Slide'

  return (
    <div className="se-wrap">
      <div className="ss-preview">
        {urls.map((u, i) => (
          <button type="button" key={i} className={'se-thumb' + (open === i ? ' on' : '')} onClick={() => setOpen(open === i ? null : i)} title="Edit this slide's text">
            <img src={u} className="ss-slide" alt={`slide ${i + 1}`} />
            {busy[i] && <span className="se-spin"><Loader2 size={16} className="spin" /></span>}
            <span className="se-pencil"><Pencil size={11} /></span>
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {open != null && slides[open] && (
          <motion.div key={open} className="se-edit" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}>
            <div className="se-edit-head">
              <span>{kindLabel(slides[open].kind)} {open + 1} of {slides.length}</span>
              {busy[open] ? <span className="muted tiny"><Loader2 size={11} className="spin" /> rendering…</span> : <button className="se-x" onClick={() => setOpen(null)} title="Done"><Ex /></button>}
            </div>
            <label className="se-label">Heading</label>
            <textarea className="field se-field" rows={2} value={slides[open].heading || ''} onChange={e => edit(open, 'heading', e.target.value)} placeholder="Headline for this slide" />
            <div className={'se-count' + (words(slides[open].heading) > (slides[open].kind === 'cover' ? 8 : 12) ? ' over' : '')}>{words(slides[open].heading)} words{slides[open].kind === 'cover' ? ' · keep ≤8' : ''}</div>
            <label className="se-label">Body <span className="muted tiny">(optional)</span></label>
            <textarea className="field se-field" rows={3} value={slides[open].body || ''} onChange={e => edit(open, 'body', e.target.value)} placeholder="Supporting line — short; carousels get skimmed" />
            <div className={'se-count' + (words(slides[open].body) > 20 ? ' over' : '')}>{words(slides[open].body)} words · keep ≤20</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Clarifying-question card — a single inline multiple-choice gate. Tapping an
//    option (or typing in "Something else…") sends that text as the user's next
//    message, so the agent loop sees the answer. Transient: not persisted — the
//    choice already lives in the transcript as the user's turn. ────────────────
function QuestionProposal({ proposal, onPick }) {
  const q = proposal.question || {}
  const opts = Array.isArray(q.options) ? q.options : []
  const [pickedIdx, setPickedIdx] = useState(-1)
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const locked = pickedIdx >= 0
  function pick(idx, val) { if (locked || proposal.resolved || !val) return; setPickedIdx(idx); onPick(val) }
  // Persisted (history-reloaded) answered card: show the chosen answer, no longer interactive.
  if (proposal.resolved) return (
    <div className="card qp qp-answered">
      {q.header && <div className="qp-eyebrow">{q.header}</div>}
      <div className="qp-q">{q.prompt}</div>
      <div className="qp-opt on" style={{ cursor: 'default' }}>
        <span className="qp-key"><LCheck size={12} strokeWidth={3} /></span>
        <span className="qp-opt-txt"><span className="qp-opt-l">{proposal.resolved_label || 'Answered'}</span></span>
      </div>
    </div>
  )
  return (
    <motion.div className="card qp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      {q.header && <div className="qp-eyebrow">{q.header}</div>}
      <div className="qp-q">{q.prompt}</div>
      <div className="qp-opts">
        {opts.map((o, i) => {
          const on = pickedIdx === i
          return (
            <button key={i} type="button" className={'qp-opt' + (on ? ' on' : '') + (locked && !on ? ' dim' : '')} disabled={locked} onClick={() => pick(i, o.value || o.label)}>
              <span className="qp-key">{String.fromCharCode(65 + i)}</span>
              <span className="qp-opt-txt"><span className="qp-opt-l">{o.label}</span>{o.description && <span className="qp-opt-d">{o.description}</span>}</span>
            </button>
          )
        })}
        {q.allow_other && !locked && (otherOpen ? (
          <div className="qp-other-open">
            <input className="field" autoFocus placeholder="Describe what you want instead…" value={otherText}
              onChange={e => setOtherText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pick(99, otherText.trim()) } }} />
            <button type="button" className="sc-send" disabled={!otherText.trim()} onClick={() => pick(99, otherText.trim())}><Send size={15} /></button>
          </div>
        ) : (
          <button type="button" className="qp-opt qp-other" onClick={() => setOtherOpen(true)}>
            <span className="qp-key"><Pencil size={12} /></span>
            <span className="qp-opt-txt"><span className="qp-opt-l">Something else…</span></span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

// ── Campaign proposal — an editable consent card for a feeder-agent campaign.
//    The agent drafts the brief; the user tweaks it here and taps Launch, which
//    POSTs to /api/agent-campaigns (nothing is created until they do). ──────────
function CampaignProposal({ proposal, authed, onResolved, onOutcome }) {
  const c = proposal.campaign || {}
  const [pitch, setPitch] = useState(c.pitch || '')
  const [audience, setAudience] = useState(c.audience || '')
  const [keyPoints, setKeyPoints] = useState((c.key_points || []).join('\n'))
  const [intensity, setIntensity] = useState(c.intensity || 'balanced')
  const [objective, setObjective] = useState(c.objective || 'awareness')
  const [linkStrategy, setLinkStrategy] = useState(c.link_strategy || 'occasional')
  const [platforms, setPlatforms] = useState(Array.isArray(c.platforms) ? c.platforms : [])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [done, setDone] = useState(proposal.resolved || null)
  const [doneLabel, setDoneLabel] = useState(proposal.resolved_label || '')
  const togglePlat = k => setPlatforms(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])
  function finish(result, label) { if (done) return; setDone(result); setDoneLabel(label); onOutcome && onOutcome(result, label) }
  async function launch() {
    if (busy || done) return
    if (!platforms.length) { setErr('Pick at least one platform for the agents to promote on.'); return }
    setErr(''); setBusy(true)
    const brief = composeBriefClient({ pitch, audience, keyPoints, avoid: '' })
    const body = {
      name: (c.product || 'Campaign').slice(0, 42), product: c.product, link: c.link || undefined, brief,
      pitch, audience, key_points: keyPoints.split('\n').map(s => s.trim()).filter(Boolean),
      intensity, objective, platforms, link_strategy: linkStrategy, cta: c.cta || undefined,
      dont_say: Array.isArray(c.dont_say) ? c.dont_say : undefined, status: 'active',
    }
    const r = await authed('/api/agent-campaigns', { method: 'POST', body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok || d.error) { setErr(d.error || 'Could not launch the campaign.'); return }
    const n = d.agents_assigned || 0
    finish('launched', n ? `Launched · ${n} agent${n > 1 ? 's' : ''} on it` : 'Launched — add agents on the Campaigns tab')
    onResolved && onResolved()
  }
  if (done) return <div className={'dp-done ' + (done === 'discarded' ? 'discarded' : 'posted')}>{doneLabel || done}</div>
  return (
    <motion.div className="card dp cp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="dp-head"><span>Campaign · {c.product}</span><span className="muted tiny">agents weave it into their own posting</span></div>
      <label className="cp-l">Pitch</label>
      <textarea className="field dp-text" rows={2} placeholder="One line on what it is and why it matters…" value={pitch} onChange={e => setPitch(e.target.value)} />
      <label className="cp-l">Who it's for</label>
      <input className="field" placeholder="The audience, concretely" value={audience} onChange={e => setAudience(e.target.value)} />
      <label className="cp-l">What lands <span className="muted tiny">(one per line)</span></label>
      <textarea className="field dp-text" rows={3} placeholder={'A concrete reason it\'s worth talking about\nAnother one'} value={keyPoints} onChange={e => setKeyPoints(e.target.value)} />
      <div className="cp-seg"><span className="cp-l">Push</span><div className="cp-chips">{INTENSITY_OPTS.map(([k, l]) => <button key={k} type="button" className={'chip' + (intensity === k ? ' on' : '')} onClick={() => setIntensity(k)}>{l}</button>)}</div></div>
      <div className="cp-seg"><span className="cp-l">Objective</span><div className="cp-chips">{OBJECTIVE_OPTS.map(([k, l]) => <button key={k} type="button" className={'chip' + (objective === k ? ' on' : '')} onClick={() => setObjective(k)}>{l}</button>)}</div></div>
      <div className="cp-seg"><span className="cp-l">Platforms</span><div className="cp-chips">{CAMP_PLATFORMS.map(([k, l]) => <button key={k} type="button" className={'chip' + (platforms.includes(k) ? ' on' : '')} onClick={() => togglePlat(k)}>{l}</button>)}</div></div>
      <div className="cp-seg"><span className="cp-l">Links</span><div className="cp-chips">{LINK_STRAT_OPTS.map(([k, l]) => <button key={k} type="button" className={'chip' + (linkStrategy === k ? ' on' : '')} onClick={() => setLinkStrategy(k)}>{l}</button>)}</div></div>
      {err && <div className="notice" style={{ color: '#B3372F', marginTop: 8 }}>{err}</div>}
      <div className="dp-actions">
        <button className="icon-btn x" title="Discard" disabled={busy} onClick={() => finish('discarded', 'Discarded')}><Ex /></button>
        <motion.button className="btn-primary btn-sm" whileTap={{ scale: 0.96 }} disabled={busy || !platforms.length} onClick={launch}>{busy ? <span className="dots"><i /><i /><i /></span> : 'Launch campaign'}</motion.button>
      </div>
    </motion.div>
  )
}

// ── Media proposal (carousel / clip) — inline preview in chat, mirrors
//    DraftProposal's approve/resolve flow but publishes via /api/slideshow or
//    /api/clips. Lets the user edit the caption, pick which connected accounts
//    to post to, then schedule / post now / save as a draft / discard. ─────────
function MediaProposal({ proposal, authed, socialAccounts = [], onResolved, onOutcome, defaultHour, index = 0, total = 1 }) {
  const isVideo = !!proposal.video
  const deck = proposal.slideshow || {}
  const vid = proposal.video || {}
  // A generated-video proposal renders asynchronously: it starts as a job that
  // we poll until it lands (or shows a graceful "not switched on" state).
  const isGenerated = isVideo && vid.kind === 'generated'
  const [gen, setGen] = useState(() => ({ status: isGenerated ? (vid.status || 'rendering') : 'done', video_url: vid.url || null, detail: '', error: '' }))
  const videoUrl = isGenerated ? gen.video_url : vid.url
  // Live working copy: editing slide text re-renders images, so the structured
  // slides AND their image URLs both change before we publish.
  const [deckSlides, setDeckSlides] = useState(Array.isArray(deck.slides) ? deck.slides : [])
  const [imgUrls, setImgUrls] = useState(Array.isArray(deck.image_urls) ? deck.image_urls : [])
  // Carousel posts to IG / TikTok / LinkedIn; clips to IG Reels / TikTok.
  const okPlatforms = isVideo ? ['instagram', 'tiktok'] : ['instagram', 'tiktok', 'linkedin']
  const accts = socialAccounts.filter(a => okPlatforms.includes(a.platform))
  const [caption, setCaption] = useState((isVideo ? vid.caption : deck.caption) || '')
  const [picked, setPicked] = useState(() => new Set(accts.length === 1 ? [accts[0].id] : []))
  const [when, setWhen] = useState(defaultWhen(defaultHour))
  const whenTouched = useRef(false)
  const [smartSlot, setSmartSlot] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [done, setDone] = useState(proposal.resolved || null)
  const [doneLabel, setDoneLabel] = useState(proposal.resolved_label || '')
  const countdown = useCountdown(when)
  function finish(result, label) { if (done) return; setDone(result); setDoneLabel(label); onOutcome && onOutcome(result, label) }
  function toggleAcct(id) { setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  useEffect(() => {
    let on = true
    authed(`/api/schedule?platform=${accts[0]?.platform || 'instagram'}`).then(r => r.json()).then(d => {
      if (on && d.when && !whenTouched.current) {
        const t = new Date(d.when); const z = n => String(n).padStart(2, '0')
        setWhen(`${t.getFullYear()}-${z(t.getMonth() + 1)}-${z(t.getDate())}T${z(t.getHours())}:${z(t.getMinutes())}`)
        setSmartSlot(true)
      }
    }).catch(() => {})
    return () => { on = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll a generated-video job until it lands / is gated off / fails.
  useEffect(() => {
    if (!isGenerated || gen.status !== 'rendering') return
    let on = true, timer, tries = 0
    const tick = async () => {
      try {
        const r = await authed(`/api/video?id=${vid.job_id}`)
        const j = (await r.json()).job
        if (on) {
          if (j === null) { setGen({ status: 'failed', video_url: null, detail: '', error: 'This video is no longer available.' }); return }
          if (j) {
            if (j.status === 'done' && j.video_url) { setGen({ status: 'done', video_url: j.video_url, detail: '', error: '' }); return }
            if (j.status === 'needs_provider') { setGen({ status: 'needs_provider', video_url: null, detail: j.status_detail || '', error: '' }); return }
            if (j.status === 'failed') { setGen({ status: 'failed', video_url: null, detail: '', error: j.error || 'Render failed.' }); return }
            if (j.status_detail) setGen(g => g.detail === j.status_detail ? g : { ...g, detail: j.status_detail })
          }
        }
      } catch { /* keep polling */ }
      if (on && ++tries < 150) timer = setTimeout(tick, 5000)
      else if (on) setGen(g => g.status === 'rendering' ? { ...g, status: 'failed', error: 'Still rendering — it\'ll land in your Library shortly.' } : g)
    }
    timer = setTimeout(tick, 3500)
    return () => { on = false; clearTimeout(timer) }
  }, [isGenerated, gen.status, vid.job_id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function publish(mode) { // 'now' | 'schedule' | 'draft'
    setErr(''); setBusy(true)
    const ids = [...picked]
    if (mode !== 'draft' && !ids.length) { setBusy(false); setErr('Pick at least one account to post to.'); return }
    let r, d
    if (isGenerated) {
      r = await authed('/api/video', { method: 'POST', body: JSON.stringify({ action: 'post', job_id: vid.job_id, account_ids: ids, caption, scheduled_for: mode === 'schedule' ? new Date(when).toISOString() : undefined }) })
      d = await r.json()
      if (!r.ok || d.error) { setBusy(false); setErr(d.error || 'Could not post the video.'); return }
    } else if (isVideo) {
      r = await authed('/api/clips', { method: 'POST', body: JSON.stringify({ action: 'post', job_id: vid.job_id, clip_index: vid.clip_index, account_ids: ids, caption, scheduled_for: mode === 'schedule' ? new Date(when).toISOString() : undefined }) })
      d = await r.json()
      if (!r.ok || d.error) { setBusy(false); setErr(d.error || 'Could not post the clip.'); return }
    } else {
      const body = { topic: deck.topic, format: deck.format, style: deck.style, handle: deck.handle, slides: deckSlides, caption, image_urls: imgUrls }
      if (mode !== 'draft') { body.action = 'schedule'; body.account_ids = ids; if (mode === 'schedule') body.scheduled_for = new Date(when).toISOString() }
      r = await authed('/api/slideshow', { method: 'POST', body: JSON.stringify(body) })
      d = await r.json()
      if (!r.ok || d.error) { setBusy(false); setErr(d.error || 'Could not save the carousel.'); return }
    }
    setBusy(false)
    const names = accts.filter(a => picked.has(a.id)).map(a => '@' + a.username).join(', ')
    const label = mode === 'draft' ? 'Saved to Projects'
      : mode === 'schedule' ? `Scheduled · ${fmt(new Date(when).toISOString())}`
      : `Posted to ${names}`
    finish(mode === 'draft' ? 'saved' : mode === 'schedule' ? 'scheduled' : 'posted', label)
    onResolved && onResolved()
  }
  if (done) return <div className={'dp-done ' + (done === 'posted' ? 'posted' : done === 'discarded' ? 'discarded' : 'scheduled')}>{doneLabel || done}</div>

  // Generated video that hasn't landed yet — rendering, gated off, or failed.
  const genName = vid.mode === 'ugc' ? 'UGC video' : vid.mode === 'edit' ? 'Your edit' : 'Generated video'
  if (isGenerated && gen.status !== 'done') {
    const coming = {
      needs_credits: 'The video generator is out of credits right now. In the meantime, I can stitch an edit from your own media.',
      needs_avatar: 'A UGC video needs a photo of the spokesperson — attach one from your Library and ask again.',
      needs_tts: 'Voiceover isn\'t configured yet. I can make an AI video or an edit from your media instead.',
    }[gen.detail] || 'Generated video isn\'t switched on yet — but I can make a carousel, or an edit stitched from your own media.'
    const prettyErr = {
      nsfw: 'That prompt got flagged — try rephrasing it.',
      provider_failed: 'The render didn\'t finish — want me to try again?',
      timeout: 'The render didn\'t finish — want me to try again?',
      canceled: 'The render was canceled.',
    }[gen.error] || gen.error || 'Render failed.'
    return (
      <motion.div className="card dp mp-gen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="dp-head"><span>{genName}</span></div>
        {gen.status === 'rendering' && (
          <div className="mp-rendering">
            <span className="dots"><i /><i /><i /></span>
            <span>Rendering your video…{gen.detail ? ` ${gen.detail}` : ''}</span>
            <span className="muted tiny">This takes a few minutes — it'll appear here when it's ready.</span>
          </div>
        )}
        {gen.status === 'needs_provider' && <div className="mp-coming">{coming}</div>}
        {gen.status === 'failed' && <div className="notice" style={{ color: '#B3372F' }}>{prettyErr}</div>}
        <div className="dp-actions">
          <button className="icon-btn x" title="Dismiss" onClick={() => finish('discarded', 'Dismissed')}><Ex /></button>
        </div>
      </motion.div>
    )
  }
  return (
    <motion.div className="card dp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="dp-head">
        <span>{isGenerated ? genName : isVideo ? 'Clip preview' : `Carousel${total > 1 ? ` ${index + 1} of ${total}` : ''} · ${imgUrls.length} slides`}</span>
        {!isVideo && deck.style && <span className="muted tiny">{deck.format} · {deck.style} · tap a slide to edit</span>}
      </div>
      {isVideo
        ? <video className="mp-video" src={videoUrl} controls playsInline preload="metadata" poster={vid.thumb || undefined} />
        : <SlideEditor slides={deckSlides} imageUrls={imgUrls} style={deck.style} format={deck.format} handle={deck.handle} authed={authed}
            onChange={(s, u) => { setDeckSlides(s); setImgUrls(u) }} />}
      <textarea className="field dp-text" rows={3} placeholder="Caption…" value={caption} onChange={e => setCaption(e.target.value)} />
      {accts.length > 0 ? (
        <div className="mp-accts">
          {accts.map(a => (
            <button key={a.id} type="button" className={'mp-chip' + (picked.has(a.id) ? ' on' : '')} onClick={() => toggleAcct(a.id)}>
              <span className="status-dot" style={{ background: platformDot(a.platform) }} />@{a.username}
            </button>
          ))}
        </div>
      ) : <div className="muted tiny" style={{ marginTop: 8 }}>{isVideo ? `Connect Instagram or TikTok to post this ${isGenerated ? 'video' : 'clip'} — it's saved in your Library.` : 'Connect Instagram, TikTok, or LinkedIn to post — saving as a draft for now.'}</div>}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <input type="datetime-local" className="field dt" value={when} onChange={e => { whenTouched.current = true; setSmartSlot(false); setWhen(e.target.value) }} />
          <span className="cd-pill"><Clock size={11} /> {countdown}{smartSlot ? ' · smart' : ''}</span>
        </div>
      </div>
      {err && <div className="notice" style={{ color: '#B3372F', marginTop: 8 }}>{err}</div>}
      <div className="dp-actions">
        <button className="icon-btn x" title="Discard" onClick={() => finish('discarded', 'Discarded')}><Ex /></button>
        {!isVideo && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => publish('draft')}>Save draft</button>}
        <button className="icon-btn check" title="Schedule" disabled={busy || !picked.size} onClick={() => publish('schedule')}><Check /> <span>Schedule</span></button>
        <motion.button className="btn-primary btn-sm" whileTap={{ scale: 0.96 }} disabled={busy || !picked.size} onClick={() => publish('now')}>Post now</motion.button>
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
                    <div className="cal-day-text">{p.content}{p._ss && <span className="camp-state" style={{ marginLeft: 7 }}>carousel</span>}</div>
                    <div className="row" style={{ gap: 8, marginTop: 5 }}>
                      <span className="cal-day-status" style={{ color: s.c }}>{s.label}</span>
                      {/* Carousels are managed from the Slideshows tab (already handed to Zernio) — read-only here. */}
                      {!p._ss && !done && <button className="mini" onClick={() => onOpen(p)}><Pencil size={11} /> Edit</button>}
                      {!p._ss && !done && onPostNow && <button className="mini" onClick={() => onPostNow(p.id)}>Post now</button>}
                      {!p._ss && onDelete && <button className="mini danger" onClick={() => onDelete(p.id)}><Trash2 size={11} /></button>}
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

function SlideshowStudio({ accounts, configured, slideshows, albums = [], onConnect, onSync, onGenerate, onSave, onDelete, onRefresh, hideAccounts, platformFocus, authed }) {
  const [topic, setTopic] = useState('')
  const [format, setFormat] = useState('listicle'); const [style, setStyle] = useState('bold')
  const [count, setCount] = useState(6)
  const [albumId, setAlbumId] = useState('') // '' = AI/typographic backgrounds; else pull photos from this album
  const [busy, setBusy] = useState(false); const [deck, setDeck] = useState(null) // {slides,caption,image_urls,style,format}
  const [pickedAccts, setPickedAccts] = useState([]); const [when, setWhen] = useState('')
  // Inline edit / schedule of a SAVED draft deck (status==='draft' only).
  const [edit, setEdit] = useState(null) // { id, title, slides, image_urls, caption, busy }
  const [sched, setSched] = useState(null) // { id, picked:[ids], when, busy }

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
    const d = await onGenerate({ topic: topic.trim(), format, style, slides: Number(count), album_ids: albumId ? [albumId] : undefined })
    setBusy(false)
    if (d.error) return
    setDeck({ ...d, topic: topic.trim() })
    if (platformFocus) setPickedAccts(focusAccts.map(a => a.id)) // this tab's platform is pre-selected
  }
  async function schedule(post) {
    if (!deck) return
    const ok = await onSave({
      action: 'schedule', topic: deck.topic, format: deck.format, style: deck.style, handle: deck.handle,
      slides: deck.slides, caption: deck.caption, image_urls: deck.imageUrls,
      account_ids: pickedAccts, scheduled_for: post && when ? new Date(when).toISOString() : null,
    })
    if (ok) { setDeck(null); setTopic(''); setPickedAccts([]); setWhen('') }
  }
  async function saveDraft() {
    if (!deck) return
    const ok = await onSave({ topic: deck.topic, format: deck.format, style: deck.style, handle: deck.handle, slides: deck.slides, caption: deck.caption, image_urls: deck.imageUrls })
    if (ok) setDeck(null)
  }
  async function saveEdit() {
    if (!edit) return
    setEdit(e => ({ ...e, busy: true }))
    await authed('/api/slideshow', { method: 'PATCH', body: JSON.stringify({ id: edit.id, title: edit.title, slides: edit.slides, image_urls: edit.image_urls, caption: edit.caption }) })
    setEdit(null)
    onRefresh && onRefresh()
  }
  // Schedule / post a SAVED draft in place (no duplicate row).
  async function scheduleSaved(post) {
    if (!sched || !sched.picked.length) return
    setSched(s => ({ ...s, busy: true }))
    const ok = await onSave({ action: 'schedule', id: sched.id, account_ids: sched.picked, scheduled_for: post && sched.when ? new Date(sched.when).toISOString() : null })
    if (ok) setSched(null); else setSched(s => ({ ...s, busy: false }))
  }
  const togglePick = id => setSched(s => ({ ...s, picked: s.picked.includes(id) ? s.picked.filter(x => x !== id) : [...s.picked, id] }))

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
        {albums.length > 0 && (<>
          <label className="ob-label">Backgrounds</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={'chip' + (!albumId ? ' on' : '')} onClick={() => setAlbumId('')}>Style default</button>
            {albums.map(al => <button key={al.id} type="button" className={'chip' + (albumId === al.id ? ' on' : '')} title="Pull matching photos from this album" onClick={() => setAlbumId(al.id)}><LImage size={11} /> {al.name}</button>)}
          </div>
          {albumId ? <div className="muted tiny" style={{ marginTop: 6 }}>Slides will use your own photos from this album, matched to each topic.</div> : null}
        </>)}
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
          <SlideEditor slides={deck.slides} imageUrls={deck.imageUrls} style={deck.style} format={deck.format} handle={deck.handle} authed={authed}
            onChange={(s, u) => setDeck(d => ({ ...d, slides: s, imageUrls: u }))} />
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
        {slideshows.map(s => {
          const editing = edit?.id === s.id
          const scheduling = sched?.id === s.id
          const isDraft = s.status === 'draft'
          const hasSlides = Array.isArray(s.slides) && s.slides.length > 0
          return (
          <div className="card camp-card" key={s.id}>
            <div className="row" style={{ gap: 10 }}>
              {s.image_urls?.[0] && <img src={s.image_urls[0]} className="ss-thumb" alt="" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="conn-title row" style={{ gap: 7 }}>{s.title || s.topic}<span className={'camp-state' + (s.status === 'posted' || s.status === 'scheduled' ? ' on' : '')}>{s.status}</span></div>
                <div className="muted tiny" style={{ marginTop: 3 }}>{s.image_urls?.length || 0} slides · {s.style} · {s.format}{s.scheduled_for ? ` · ${fmt(s.scheduled_for)}` : ''}{s.error ? ` · ${s.error}` : ''}</div>
              </div>
              {isDraft && igLike.length > 0 && configured && (
                <button className="mini" onClick={() => scheduling ? setSched(null) : (setEdit(null), setSched({ id: s.id, picked: focusAccts.map(a => a.id), when: '', busy: false }))}><Clock size={12} /> {scheduling ? 'Close' : 'Schedule'}</button>
              )}
              {isDraft && hasSlides && (
                <button className="mini" onClick={() => editing ? setEdit(null) : (setSched(null), setEdit({ id: s.id, title: s.title || '', slides: s.slides, image_urls: s.image_urls || [], caption: s.caption || '', busy: false }))}><Pencil size={12} /> {editing ? 'Close' : 'Edit'}</button>
              )}
              <button className="mini danger" onClick={() => onDelete(s.id)}><Trash2 size={12} /></button>
            </div>
            <AnimatePresence initial={false}>
              {editing && (
                <motion.div key="edit" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
                  <div style={{ marginTop: 12 }}>
                    <label className="ob-label">Title <span className="muted tiny" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· a name you'll remember</span></label>
                    <input className="field" value={edit.title} placeholder={s.topic} onChange={e => setEdit(p => ({ ...p, title: e.target.value }))} />
                    <label className="ob-label" style={{ marginTop: 12 }}>Slides <span className="muted tiny" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· tap one to edit its text</span></label>
                    <SlideEditor slides={edit.slides} imageUrls={edit.image_urls} style={s.style} format={s.format} handle={s.handle} authed={authed}
                      onChange={(sl, u) => setEdit(e => ({ ...e, slides: sl, image_urls: u }))} />
                    <label className="ob-label" style={{ marginTop: 12 }}>Caption</label>
                    <textarea className="field" rows={3} style={{ lineHeight: 1.5 }} value={edit.caption} onChange={e => setEdit(p => ({ ...p, caption: e.target.value }))} />
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                      <button className="mini" onClick={() => setEdit(null)}>Cancel</button>
                      <button className="btn-primary btn-sm" disabled={edit.busy} onClick={saveEdit}>{edit.busy ? 'Saving…' : 'Save changes'}</button>
                    </div>
                  </div>
                </motion.div>
              )}
              {scheduling && (
                <motion.div key="sched" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
                  <div style={{ marginTop: 12 }}>
                    <div className="muted tiny" style={{ marginBottom: 6 }}>Post to:</div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {focusAccts.map(a => <button key={a.id} type="button" className={'chip' + (sched.picked.includes(a.id) ? ' on' : '')} onClick={() => togglePick(a.id)}><span className="status-dot" style={{ background: platformDot(a.platform) }} />{a.username || a.platform}</button>)}
                    </div>
                    {crossAccts.length > 0 && <>
                      <div className="muted tiny" style={{ margin: '10px 0 6px' }}>Cross-post to:</div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {crossAccts.map(a => <button key={a.id} type="button" className={'chip' + (sched.picked.includes(a.id) ? ' on' : '')} onClick={() => togglePick(a.id)}><span className="status-dot" style={{ background: platformDot(a.platform) }} />{a.username || a.platform} · {a.platform}</button>)}
                      </div>
                    </>}
                    <input type="datetime-local" className="field" style={{ marginTop: 10 }} value={sched.when} onChange={e => setSched(p => ({ ...p, when: e.target.value }))} />
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                      <button className="mini" onClick={() => setSched(null)}>Cancel</button>
                      <button className="btn-ghost btn-sm" disabled={sched.busy || !sched.picked.length || !sched.when} onClick={() => scheduleSaved(true)}>Schedule</button>
                      <button className="btn-primary btn-sm" disabled={sched.busy || !sched.picked.length} onClick={() => scheduleSaved(false)}>{sched.busy ? 'Posting…' : 'Post now'}</button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )})}
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
        // Only show replies for accounts STILL connected on this platform — a
        // disconnected/old account's replies must not linger after a switch.
        const liveZids = new Set(accounts.filter(a => a.platform === pl).map(a => a.zernio_account_id).filter(Boolean))
        const recent = (replies || []).filter(r => r.platform === pl && (r.status === 'posted' || r.reply_text) && (!r.account_id || liveZids.has(r.account_id))).slice(0, 6)
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
function BrandOnboarding({ initial, missing, platform, busy, onSave, onClose }) {
  // If we were reopened because Autopilot was blocked, jump straight to the step
  // that fixes the first thing missing (positioning → step 0, pillars → step 1).
  const firstWhere = (missing || [])[0]?.where
  const [step, setStep] = useState(firstWhere === 'pillars' ? 1 : 0)
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
        {missing?.length ? (
          <div className="notice" style={{ margin: '0 0 14px' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>To turn on Autopilot, finish:</div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>{missing.map((m, i) => <li key={i} style={{ marginTop: 2 }}>{m.label}</li>)}</ul>
          </div>
        ) : null}
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

// ── Autopilot body — cadence settings. The section-header toggle turns Autopilot
// ON (writing on a cadence); the "When a post is ready" control chooses Review-
// first (drafts) vs Auto-post (hands-off). Both are gated server-side by the
// onboarding gate (brief + connected account; auto-post also needs voice +
// pillars). Comments live under Engage.
// ── Instagram / TikTok visual autopilot ──────────────────────────────────────
// Research-grounded MCQ options (archetype + goal are the master switches that
// pre-set the format mix; minimal free-text).
const IG_ARCHETYPES = [
  { key: 'educator', emoji: '🎓', label: 'Educator', desc: 'Teach a skill — “save this” content', formats: ['carousel', 'ugc_face'] },
  { key: 'entertainer', emoji: '😄', label: 'Entertainer', desc: 'Relatable, funny, rewatchable', formats: ['ugc_face', 'clip'] },
  { key: 'aesthetic', emoji: '🎨', label: 'Aesthetic curator', desc: 'A look / vibe / niche taste', formats: ['clip', 'carousel'] },
  { key: 'founder', emoji: '🚀', label: 'Founder / build-in-public', desc: 'Document building your thing', formats: ['ugc_face', 'carousel'] },
  { key: 'commentator', emoji: '🎤', label: 'Commentator', desc: 'Hot takes on your industry', formats: ['ugc_face', 'clip'] },
  { key: 'storyteller', emoji: '📖', label: 'Storyteller', desc: 'Personal narrative + lessons', formats: ['clip', 'ugc_face'] },
  { key: 'insider', emoji: '🔧', label: 'Insider / BTS', desc: 'Pull back the curtain on your craft', formats: ['clip', 'carousel'] },
  { key: 'promoter', emoji: '🛍️', label: 'Brand builder', desc: 'Drive a product or offer', formats: ['ugc_face', 'carousel'] },
]
const IG_GOALS = [
  { key: 'grow', emoji: '📈', label: 'Grow followers' },
  { key: 'authority', emoji: '🧠', label: 'Build authority' },
  { key: 'sales', emoji: '💸', label: 'Drive sales' },
  { key: 'entertain', emoji: '🎉', label: 'Entertain & community' },
  { key: 'educate', emoji: '📚', label: 'Be useful / educate' },
  { key: 'personal_brand', emoji: '✨', label: 'Build my personal brand' },
]
const IG_FORMATS = [
  { key: 'carousel', emoji: '🖼️', label: 'Carousels', desc: 'Swipe decks — best for saves & depth' },
  { key: 'ugc_face', emoji: '🎬', label: 'Talking-head videos', desc: 'Your face on camera (needs a photo)' },
  { key: 'clip', emoji: '🎞️', label: 'Short video clips', desc: 'Faceless stock-B-roll reels' },
]
const IG_CADENCE = [[24, '1× / day'], [48, 'Every 2 days'], [72, '2× / week'], [168, 'Weekly']]

// The MCQ-first onboarding for IG/TikTok autopilot. 4 quick steps, all tap-to-pick;
// archetype pre-selects the format mix so most users just confirm.
function SocialAutopilotOnboarding({ platform, initial, photos = [], missing, busy, onSave, onClose, onUploadPhoto }) {
  const label = platform === 'instagram' ? 'Instagram' : 'TikTok'
  const [step, setStep] = useState(0)
  const [p, setP] = useState({
    archetype: initial?.archetype || '', goal: initial?.goal || '',
    formats: initial?.formats || [], niche: initial?.niche || '', tone: initial?.tone || [],
    face_photo_url: initial?.face_photo_url || '', per_run: initial?.per_run || 1, interval_hours: initial?.interval_hours || 24,
  })
  const set = (k, v) => setP(s => ({ ...s, [k]: v }))
  const pickArchetype = a => setP(s => ({ ...s, archetype: a.key, formats: s.formats.length ? s.formats : a.formats })) // pre-set the mix
  const toggleFmt = k => setP(s => ({ ...s, formats: s.formats.includes(k) ? s.formats.filter(x => x !== k) : [...s.formats, k] }))
  const toggleTone = t => setP(s => ({ ...s, tone: s.tone.includes(t) ? s.tone.filter(x => x !== t) : [...s.tone, t].slice(0, 4) }))
  const needsFace = p.formats.includes('ugc_face')
  // Auto-pick the first face photo when talking-head is on and one isn't chosen,
  // so the user is never silently stuck on a disabled Next (they can tap another).
  useEffect(() => {
    if (needsFace && !p.face_photo_url && photos.length) setP(s => ({ ...s, face_photo_url: photos[0].url }))
  }, [needsFace, photos.length]) // eslint-disable-line
  function submit() {
    onSave({
      content_plan: { archetype: p.archetype, goal: p.goal, formats: p.formats, niche: p.niche.trim(), tone: p.tone, face_photo_url: p.face_photo_url },
      cadence: { per_run: Number(p.per_run), interval_hours: Number(p.interval_hours) },
    })
  }
  const Card = ({ on, emoji, title, sub, onClick }) => (
    <button type="button" className={'ig-onb-card' + (on ? ' on' : '')} onClick={onClick}
      style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', textAlign: 'left', padding: '11px 13px', borderRadius: 12, border: `1.5px solid ${on ? 'var(--ink,#111)' : 'rgba(0,0,0,0.12)'}`, background: on ? 'rgba(0,0,0,0.04)' : '#fff', cursor: 'pointer', width: '100%' }}>
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <span style={{ fontWeight: 650, fontSize: 13 }}>{title}</span>
      {sub && <span className="muted tiny" style={{ lineHeight: 1.3 }}>{sub}</span>}
    </button>
  )
  return (
    <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card modal" style={{ width: 540, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={spring}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 15.5 }}>Set up {label} Autopilot</span>
          <button className="x-close" onClick={onClose}><LX size={18} /></button>
        </div>
        <div className="muted tiny" style={{ marginBottom: 12 }}>A few taps and Cadence starts making + posting content for you. You can change any of this later.</div>
        {missing?.length ? (
          <div className="notice" style={{ margin: '0 0 12px' }}><div style={{ fontWeight: 600, marginBottom: 4 }}>To turn it on, finish:</div><ul style={{ margin: 0, paddingLeft: 16 }}>{missing.map((m, i) => <li key={i} style={{ marginTop: 2 }}>{m.label}</li>)}</ul></div>
        ) : null}
        <div className="onb-dots" style={{ marginBottom: 14 }}>{[0, 1, 2, 3].map(i => <span key={i} className={'ob-dot' + (i <= step ? ' on' : '')} />)}</div>

        {step === 0 && (<>
          <div className="onb-q">What kind of account are you building?</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {IG_ARCHETYPES.map(a => <Card key={a.key} on={p.archetype === a.key} emoji={a.emoji} title={a.label} sub={a.desc} onClick={() => pickArchetype(a)} />)}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn-primary btn-sm" disabled={!p.archetype} onClick={() => setStep(1)}>Next →</button></div>
        </>)}

        {step === 1 && (<>
          <div className="onb-q">What's the goal?</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {IG_GOALS.map(g => <Card key={g.key} on={p.goal === g.key} emoji={g.emoji} title={g.label} onClick={() => set('goal', g.key)} />)}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}><button className="mini" onClick={() => setStep(0)}>← Back</button><button className="btn-primary btn-sm" disabled={!p.goal} onClick={() => setStep(2)}>Next →</button></div>
        </>)}

        {step === 2 && (<>
          <div className="onb-q">What should it post? <span className="muted tiny" style={{ fontWeight: 400 }}>· pick any (pre-set for your type)</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {IG_FORMATS.map(f => <Card key={f.key} on={p.formats.includes(f.key)} emoji={f.emoji} title={f.label} sub={f.desc} onClick={() => toggleFmt(f.key)} />)}
          </div>
          {needsFace && (
            <div style={{ marginTop: 12 }}>
              <label className="onb-label">Your face for talking-head videos <span className="muted tiny" style={{ fontWeight: 400 }}>· tap one to use on camera</span></label>
              {photos.length ? (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {photos.map(ph => {
                    const on = p.face_photo_url === ph.url
                    return (
                      <button key={ph.id} type="button" onClick={() => set('face_photo_url', ph.url)} style={{ position: 'relative', padding: 0, border: `2px solid ${on ? 'var(--ink,#111)' : 'rgba(0,0,0,0.12)'}`, borderRadius: 10, cursor: 'pointer', lineHeight: 0 }}>
                        <img src={ph.url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, opacity: on ? 1 : 0.85 }} />
                        {on && <span style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 999, background: 'var(--ink,#111)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LCheck size={11} strokeWidth={4} /></span>}
                      </button>
                    )
                  })}
                  <label className="btn-ghost" style={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 10 }} title="Upload another">
                    <Plus size={16} /><input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && onUploadPhoto?.(e.target.files[0])} />
                  </label>
                </div>
              ) : (
                <label className="btn-ghost row" style={{ gap: 7, justifyContent: 'center', cursor: 'pointer' }}><Plus size={14} /> Upload a clear photo of your face<input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && onUploadPhoto?.(e.target.files[0])} /></label>
              )}
            </div>
          )}
          {(() => {
            const reason = !p.formats.length ? 'Pick at least one format to continue.'
              : (needsFace && !p.face_photo_url) ? (photos.length ? 'Tap a face photo above for talking-head videos — or tap “Talking-head videos” again to drop it.' : 'Add a face photo for talking-head videos — or tap “Talking-head videos” again to drop it.')
              : ''
            return (
              <>
                {reason && <div className="muted tiny" style={{ marginTop: 10, color: '#8A6200' }}>{reason}</div>}
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}><button className="mini" onClick={() => setStep(1)}>← Back</button><button className="btn-primary btn-sm" disabled={!!reason} onClick={() => setStep(3)}>Next →</button></div>
              </>
            )
          })()}
        </>)}

        {step === 3 && (<>
          <div className="onb-q">Last bit — your niche & vibe</div>
          <label className="onb-label">What do you post about?</label>
          <input className="field" autoFocus placeholder="e.g. home cooking for busy parents" value={p.niche} onChange={e => set('niche', e.target.value)} />
          <label className="onb-label">Personality <span className="muted tiny" style={{ fontWeight: 400 }}>· pick up to 4</span></label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{TONE_OPTS.map(t => <button key={t} type="button" className={'chip' + (p.tone.includes(t) ? ' on' : '')} onClick={() => toggleTone(t)}>{t}</button>)}</div>
          <label className="onb-label">How often</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{IG_CADENCE.map(([h, l]) => <button key={h} type="button" className={'chip' + (Number(p.interval_hours) === h ? ' on' : '')} onClick={() => set('interval_hours', h)}>{l}</button>)}</div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <button className="mini" onClick={() => setStep(2)}>← Back</button>
            <button className="btn-primary btn-sm" disabled={busy || !p.niche.trim()} onClick={submit}>{busy ? <Loader2 size={13} className="spin" /> : 'Turn on Autopilot'}</button>
          </div>
        </>)}
      </motion.div>
    </motion.div>
  )
}

// Section body for an active IG/TikTok autopilot — plan summary + cadence + review/auto-post.
function SocialAutopilotBody({ row, onToggle, onEditPlan }) {
  const plan = row.content_plan || {}
  const auto = !!row.auto_post
  const fmtLabel = { carousel: 'carousels', ugc_face: 'talking-head videos', clip: 'clips' }
  return (
    <>
      <div className="muted tiny" style={{ marginBottom: 10 }}>Makes {(plan.formats || []).map(f => fmtLabel[f] || f).join(' + ') || 'content'} about {plan.niche || 'your niche'} on a cadence.{row?.enabled && row?.status_detail ? ` · ${row.status_detail}` : ''}</div>
      <div className="ap-row"><span className="ap-rowlabel">Posts per run</span><Stepper value={row.per_run || 1} min={1} max={3} onChange={v => onToggle({ per_run: v })} /></div>
      <div className="ap-row">
        <span className="ap-rowlabel">When a post is ready</span>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className={'chip' + (!auto ? ' on' : '')} onClick={() => onToggle({ auto_post: false })}>Review first</button>
          <button type="button" className={'chip' + (auto ? ' on' : '')} onClick={() => onToggle({ auto_post: true })}>Auto-post</button>
        </div>
      </div>
      <div className="muted tiny" style={{ marginTop: -4, marginBottom: 10 }}>{auto ? 'Cadence posts at your best times — fully hands-off.' : 'Cadence makes it; nothing goes out until you approve it.'}</div>
      <button className="ap-edit" onClick={onEditPlan}>Edit your content plan →</button>
    </>
  )
}

function AutopilotBody({ row, onToggle, onEditBrief }) {
  const perDay = row.per_run || 1
  const auto = !!row.auto_post
  return (
    <>
      <div className="muted tiny" style={{ marginBottom: 12 }}>Writes posts in your voice on a cadence.{row?.enabled && row?.status_detail ? ` · ${row.status_detail}` : ''}</div>
      <div className="ap-row">
        <span className="ap-rowlabel">Posts per day</span>
        <Stepper value={perDay} min={1} max={3} onChange={v => onToggle({ per_run: v, interval_hours: 24 })} />
      </div>
      <div className="ap-row">
        <span className="ap-rowlabel">When a post is ready</span>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className={'chip' + (!auto ? ' on' : '')} onClick={() => onToggle({ auto_post: false })}>Review first</button>
          <button type="button" className={'chip' + (auto ? ' on' : '')} onClick={() => onToggle({ auto_post: true })}>Auto-post</button>
        </div>
      </div>
      <div className="muted tiny" style={{ marginTop: -4, marginBottom: 10 }}>{auto ? 'Cadence posts at your best times — fully hands-off.' : 'Cadence drafts; nothing goes out until you approve it.'}</div>
      <button className="ap-edit" onClick={onEditBrief}>Edit your brand brief →</button>
    </>
  )
}

// ── What Cadence has learned — the durable, cross-platform brand memory distilled
// from the user's own engagement (numbers + audience comments + thumbs). It's
// applied to every post automatically; showing it makes the loop legible and
// gives the user a manual re-analyze. Shows cross-platform learnings + this
// platform's specific ones.
const INSIGHT_TAG = { insight: 'Works', tactic: 'Do', audience: 'Audience', format: 'Format' }
const insightAgo = iso => {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
function InsightsPanel({ insights, platform, learnedAt, learning, onLearn }) {
  const rel = (insights || []).filter(i => !i.platform || i.platform === platform)
  return (
    <>
      <div className="muted tiny" style={{ marginBottom: 10 }}>
        Cadence keeps learning from your real engagement automatically and applies it to every post it writes — across all your platforms.{learnedAt ? ` Last updated ${insightAgo(learnedAt)}.` : ''}
      </div>
      {rel.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {rel.map(i => (
            <div key={i.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <span className="chip" style={{ flex: 'none', fontSize: 10.5, padding: '2px 7px', opacity: 0.85 }}>{INSIGHT_TAG[i.kind] || i.kind}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{i.text}{i.platform ? <span className="muted tiny"> · {i.platform}</span> : null}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted tiny" style={{ padding: '2px 0 8px' }}>Nothing yet — as your posts gather engagement, Cadence studies what landed and learns your patterns on its own.</div>
      )}
      <div className="muted tiny row" style={{ gap: 5, opacity: 0.7 }}><Sparkles size={11} /> Updates on its own — no button to press.{learning ? ' Analyzing now…' : ''}</div>
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

function PlatformCampaign({ campaigns, targets, supportsCarousel, canCreate, connectHint, albums = [], onSave, onPatch, onDelete, onRun }) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [hours, setHours] = useState(24)
  const [picked, setPicked] = useState([]); const [busy, setBusy] = useState(false)
  // Content the campaign pushes (IG/TikTok): carousels, clips, or both. Clips
  // need source videos to cut from + an edit style.
  const [types, setTypes] = useState(['carousel'])
  const [clipSrc, setClipSrc] = useState(''); const [clipEdit, setClipEdit] = useState('captions')
  const [albumId, setAlbumId] = useState('') // pull library media for this campaign
  const single = targets.length === 1
  const wantCarousel = !supportsCarousel || types.includes('carousel')
  const wantClip = supportsCarousel && types.includes('clip')
  const clipUrls = clipSrc.split('\n').map(s => s.trim()).filter(s => /^https?:\/\//.test(s))
  function startNew() { setPicked(targets.map(t => t.id)); setTypes(['carousel']); setClipSrc(''); setClipEdit('captions'); setTopic(''); setOpen(true) }
  function toggleType(k) { setTypes(ts => ts.includes(k) ? (ts.length > 1 ? ts.filter(x => x !== k) : ts) : [...ts, k]) }
  const chosen = single ? targets : targets.filter(t => picked.includes(t.id))
  const needTopic = wantCarousel // clips caption themselves from the transcript
  const valid = chosen.length && types.length && (!needTopic || topic.trim()) && (!wantClip || clipUrls.length || albumId)
  async function submit() {
    if (!valid) return
    setBusy(true)
    const t = (topic.trim() || (wantClip ? 'Clip campaign' : ''))
    const payload = {
      name: t.length > 42 ? t.slice(0, 42).trimEnd() + '…' : t,
      topic: t,
      targets: chosen.map(t => ({ kind: t.kind, id: t.id, platform: t.platform })),
      interval_hours: Number(hours), include_image: false, active: true,
    }
    if (supportsCarousel) {
      payload.content_types = types
      payload.carousel_style = 'bold'; payload.carousel_format = 'listicle'
      if (wantClip) { payload.clip_sources = clipUrls; payload.clip_edit = clipEdit }
      if (albumId) payload.album_ids = [albumId]
    }
    const ok = await onSave(payload)
    setBusy(false)
    if (ok) { setOpen(false); setTopic(''); setPicked([]); setClipSrc('') }
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
            <span className="muted tiny" style={{ marginRight: 'auto' }}>{supportsCarousel && c.content_types?.length ? c.content_types.map(t => t === 'clip' ? 'clips' : 'carousels').join(' + ') + ' · ' : ''}{cadenceLabel(c.interval_hours)}</span>
            <button className="mini" onClick={() => onRun(c.id)} disabled={c.running}><Play size={11} /> Run now</button>
            <button className="mini danger" onClick={() => onDelete(c.id)}><Trash2 size={12} /></button>
          </div>
        </div>
      ))}
      {open ? (
        <div className="card camp-form">
          {supportsCarousel && (<>
            <label className="ob-label">Push out</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {[['carousel', 'Carousels', 'AI slides from your topic'], ['clip', 'Clips', 'short videos cut from your links']].map(([k, l, d]) => (
                <button type="button" key={k} className={'chip' + (types.includes(k) ? ' on' : '')} title={d} onClick={() => toggleType(k)}>{types.includes(k) && <LCheck size={11} strokeWidth={3} />} {l}</button>
              ))}
            </div>
          </>)}
          {needTopic && <textarea className="field" style={{ marginTop: supportsCarousel ? 12 : 0 }} rows={2} placeholder={supportsCarousel ? 'What should the carousels be about? (your voice)' : 'What should it promote? (your voice)'} value={topic} onChange={e => setTopic(e.target.value)} autoFocus />}
          {wantClip && (<>
            <label className="ob-label">Clip from these videos <span className="muted tiny" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· one link per line, it rotates through them</span></label>
            <textarea className="field" rows={3} placeholder={'https://youtube.com/watch?v=…\nhttps://tiktok.com/@you/video/…'} value={clipSrc} onChange={e => setClipSrc(e.target.value)} />
            <label className="ob-label">Edit style</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {EDIT_FORMAT_LIST.map(f => <button type="button" key={f.key} className={'chip' + (clipEdit === f.key ? ' on' : '')} title={f.desc} onClick={() => setClipEdit(f.key)}>{f.label}</button>)}
            </div>
          </>)}
          {!single && (<>
            <label className="ob-label">Post to</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {targets.map(t => <button type="button" key={t.id} className={'chip' + (picked.includes(t.id) ? ' on' : '')} onClick={() => setPicked(p => p.includes(t.id) ? p.filter(x => x !== t.id) : [...p, t.id])}><span className="status-dot" style={{ background: platformDot(t.platform) }} />{t.label}</button>)}
            </div>
          </>)}
          {supportsCarousel && albums.length > 0 && (<>
            <label className="ob-label">Pull media from <span className="muted tiny" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· your library album for {wantClip && !wantCarousel ? 'clip footage' : 'photos' + (wantClip ? ' & clip footage' : '')}</span></label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className={'chip' + (!albumId ? ' on' : '')} onClick={() => setAlbumId('')}>{wantClip && !wantCarousel ? 'Pasted links' : 'AI-generated'}</button>
              {albums.map(al => <button key={al.id} type="button" className={'chip' + (albumId === al.id ? ' on' : '')} onClick={() => setAlbumId(al.id)}><LImage size={11} /> {al.name}</button>)}
            </div>
          </>)}
          <label className="ob-label">How often</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {CADENCES.map(([h, l]) => <button type="button" key={h} className={'chip' + (Number(hours) === h ? ' on' : '')} onClick={() => setHours(h)}>{l}</button>)}
          </div>
          {wantClip && types.length > 1 && <div className="muted tiny" style={{ marginTop: 8 }}>Alternates each run — one carousel, then one clip, and so on.</div>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="mini" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={busy || !valid} onClick={submit}>{busy ? <span className="dots"><i/><i/><i/></span> : 'Start campaign'}</button>
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
function ClipStudio({ jobs, accounts, configured, onCreate, onUpload, onDelete, onPost, platformFocus, library = [] }) {
  const [url, setUrl] = useState(''); const [fileName, setFileName] = useState('')
  const [assetId, setAssetId] = useState(null); const [showLib, setShowLib] = useState(false)
  const libVideos = library.filter(a => a.type === 'video' && a.url)
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
    if (!url.trim() && !assetId) return
    setBusy(true)
    const ok = await onCreate({
      source_url: assetId ? undefined : url.trim(), source_asset_id: assetId || undefined,
      source_name: fileName || null, format,
      target_len: len, max_clips: Number(maxClips), captions: true,
      edit_formats: edits,
      watermark: wmOn ? ((watermark || wmDefault).trim() || null) : null,
      outro: outroOn, outro_logo_url: outroOn ? (logoUrl || null) : null,
    })
    setBusy(false)
    if (ok) { setUrl(''); setFileName(''); setAssetId(null) }
  }

  return (
    <>
      <div className="card camp-form">
        <div className="muted tiny" style={{ marginBottom: 8 }}>Drop in a long video — Cadence cuts the best moments into ready-to-post clips.</div>
        <div className="row" style={{ gap: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Paste a YouTube link or direct video URL" value={fileName ? `${assetId ? 'Library' : 'Uploaded'}: ${fileName}` : url} onChange={e => { setUrl(e.target.value); setFileName(''); setAssetId(null) }} disabled={!!fileName} />
          {libVideos.length > 0 && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => setShowLib(true)} title="Pick a video from your Library"><LImage size={13} /> Library</button>}
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
          <button className="btn-primary btn-sm" disabled={busy || (!url.trim() && !assetId)} onClick={go}>{busy ? <Loader2 size={13} className="spin" /> : <><Wand2 size={13} /> Make clips</>}</button>
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

      <AnimatePresence>
        {showLib && (
          <motion.div className="overlay" onClick={() => setShowLib(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="card modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }} transition={spring}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Clip from your Library</span>
                <button className="x-close" onClick={() => setShowLib(false)}><LX size={18} /></button>
              </div>
              <div className="lib-grid">
                {libVideos.map(a => (
                  <button key={a.id} className="lib-thumb" style={{ aspectRatio: '4/5' }} onClick={() => { setAssetId(a.id); setFileName(a.filename || 'video'); setUrl(''); setShowLib(false) }}>
                    {a.thumb_url ? <img src={a.thumb_url} alt="" /> : <div className="lib-noimg"><Play size={20} /></div>}
                    <span className="lib-badge"><Play size={11} /></span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
// Media-aware "Ready to post" list for IG/TikTok autopilot output — carousels
// (thumbnail) and videos (clapper badge), plus in-flight 'rendering' placeholders
// and failed renders. Review-mode drafts surface here for approval; without this
// the engine would post into a void.
function SocialDrafts({ items, onPostNow, onSchedule, onDiscard }) {
  if (!items.length) return <div className="muted tiny" style={{ padding: '2px 0' }}>Nothing waiting — Autopilot will drop carousels & videos here for your OK as it makes them.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(p => {
        const rendering = p.status === 'rendering', failed = p.status === 'failed'
        const thumb = p.image_urls?.[0] || p.image_url
        return (
          <div className="row" key={p.id} style={{ gap: 10, alignItems: 'flex-start', padding: '7px 0', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ width: 44, height: 44, flex: 'none', borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Clapperboard size={16} style={{ opacity: 0.5 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.content || (p.video_url ? 'Video' : 'Carousel')}</div>
              <div className="muted tiny" style={{ marginTop: 2 }}>{p.image_urls?.length ? `${p.image_urls.length}-slide carousel` : p.video_url ? 'video' : rendering ? '' : 'post'}{rendering ? 'rendering your video…' : failed ? <span style={{ color: '#B3372F' }}>render failed</span> : ''}</div>
            </div>
            {rendering ? <Loader2 size={13} className="spin" style={{ marginTop: 4, opacity: 0.6 }} />
              : failed ? <button className="mini danger" onClick={() => onDiscard(p.id)}><Trash2 size={11} /></button>
              : (<div className="row" style={{ gap: 5, flex: 'none' }}>
                  <button className="mini" onClick={() => onPostNow(p.id)}>Post</button>
                  <button className="mini" onClick={() => onSchedule(p)}><Clock size={11} /></button>
                  <button className="mini danger" onClick={() => onDiscard(p.id)}><Trash2 size={11} /></button>
                </div>)}
          </div>
        )
      })}
    </div>
  )
}

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
  // Many-to-many: an agent can be on several campaigns.
  const myCampIds = agent.campaign_ids || (agent.campaign_id ? [agent.campaign_id] : [])
  const myCamps = campaigns.filter(c => myCampIds.includes(c.id))
  const camp = myCamps[0]
  const isX = !!agent.x_connection_id
  return (
    <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card modal" style={{ width: 560 }} onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={spring}>
        <div className="row" style={{ gap: 13, alignItems: 'flex-start' }}>
          <AgentAvatar agent={agent} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 16.5 }}>{p.name || agent.name || 'Agent'}</span>
              {myCamps.map(c => <span key={c.id} className="role-badge" title="On a campaign mission">{c.name}</span>)}
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
                    {(a.campaign_ids || (a.campaign_id ? [a.campaign_id] : [])).slice(0, 2).map(cid => <span key={cid} className="role-badge" title="On a campaign mission">{campaigns.find(cp => cp.id === cid)?.name || 'campaign'}</span>)}
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
const OBJECTIVE_OPTS = [
  ['awareness', 'Awareness'], ['signups', 'Sign-ups'], ['installs', 'App installs'],
  ['traffic', 'Traffic'], ['waitlist', 'Waitlist'], ['launch_buzz', 'Launch buzz'],
]
const LINK_STRAT_OPTS = [
  ['never', 'Never link'], ['occasional', 'Occasional link'], ['cta_only', 'Link on CTAs'], ['every_promo', 'Link every promo'],
]
const CAMP_PLATFORMS = [['x', 'X'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']]

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
const FEEDER_TYPE_OPTS = [
  ['faceless', 'Faceless channels', 'Value carousels & posts — no AI person. Lower policy risk, high volume.'],
  ['ugc_influencer', 'UGC influencers', 'Branded AI creators that post talking-head videos. Higher trust; needs video credits + carries an AI-generated label.'],
  ['standard', 'Persona accounts', 'Believable individual voices that post text/carousels in their own style.'],
]
function CampaignOnboarding({ onCancel, onCreate, onDraft, onSpawnFleet, freeX = [], freeSocial = [] }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false); const [drafting, setDrafting] = useState(false)
  const [f, setF] = useState({ product: '', link: '', pitch: '', audience: '', keyPoints: '', avoid: '', cta: '', intensity: 'balanced', objective: 'awareness', linkStrategy: 'occasional', platforms: [] })
  const [feederType, setFeederType] = useState('faceless')
  const [fleetSel, setFleetSel] = useState([]) // ['x:<id>' | 's:<id>']
  const [override, setOverride] = useState(null) // manual edits to the composed brief
  const hasFreeAccounts = freeX.length > 0 || freeSocial.length > 0
  const toggleFleet = key => setFleetSel(s => s.includes(key) ? s.filter(x => x !== key) : [...s, key])
  const togglePlat = k => setF(s => ({ ...s, platforms: s.platforms.includes(k) ? s.platforms.filter(x => x !== k) : [...s.platforms, k] }))
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
  // Create the campaign, then (if accounts were picked) spin up the fleet on them.
  async function launch() {
    const product = f.product.trim(); if (!product) return
    setBusy(true)
    const camp = await onCreate({
      product, name: product.length > 42 ? product.slice(0, 42).trimEnd() + '…' : product,
      link: f.link.trim() || null, brief, intensity: f.intensity, active: true,
      objective: f.objective, platforms: f.platforms, link_strategy: f.linkStrategy,
      pitch: f.pitch.trim() || null, audience: f.audience.trim() || null,
      cta: f.cta.trim() || null,
      key_points: f.keyPoints.split('\n').map(s => s.trim()).filter(Boolean),
      dont_say: f.avoid.split('\n').map(s => s.trim()).filter(Boolean),
      assign_all: false, // the fleet step decides who runs it
    })
    const cid = camp && typeof camp === 'object' ? camp.id : null
    if (cid && fleetSel.length && onSpawnFleet) {
      const items = fleetSel.map(k => {
        const [kind, id] = k.split(':')
        return kind === 'x' ? { x_connection_id: id, feeder_type: feederType, interests: f.product } : { social_account_id: id, feeder_type: feederType, interests: f.product }
      })
      await onSpawnFleet({ campaign_id: cid, items })
    }
    setBusy(false)
    if (camp) onCancel()
  }

  return (
    <div className="card camp-onb">
      <div className="onb-dots" style={{ marginBottom: 16 }}>{[0, 1, 2, 3].map(i => <span key={i} className={'ob-dot' + (i <= step ? ' on' : '')} />)}</div>

      {step === 0 && (<>
        <div className="onb-q">What are the agents promoting?</div>
        <input className="field" autoFocus placeholder="e.g. Cluey — the AI study copilot for students" value={f.product} onChange={e => set('product', e.target.value)} />
        <input className="field" style={{ marginTop: 8 }} placeholder="Link (optional — paste it and I'll draft the brief)" value={f.link} onChange={e => set('link', e.target.value)} />
        <label className="onb-label">Goal</label>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {OBJECTIVE_OPTS.map(([k, l]) => <button key={k} type="button" className={'chip' + (f.objective === k ? ' on' : '')} onClick={() => set('objective', k)}>{l}</button>)}
        </div>
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
        <label className="onb-label">Never say <span className="muted tiny" style={{ fontWeight: 400 }}>· one per line, a hard rule</span></label>
        <textarea className="field dp-grow" rows={2} placeholder={"don't call it a 'cheating' tool\nnever name a competitor"} value={f.avoid} onChange={e => set('avoid', e.target.value)} />
        <label className="onb-label">Soft CTA <span className="muted tiny" style={{ fontWeight: 400 }}>· optional, used on link posts</span></label>
        <input className="field" placeholder="e.g. try the free tier" value={f.cta} onChange={e => set('cta', e.target.value)} />
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
        <label className="onb-label">Platforms <span className="muted tiny" style={{ fontWeight: 400 }}>· which agents run it · none = any</span></label>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {CAMP_PLATFORMS.map(([k, l]) => <button key={k} type="button" className={'chip' + (f.platforms.includes(k) ? ' on' : '')} onClick={() => togglePlat(k)}><span className="status-dot" style={{ background: platformDot(k) }} />{l}</button>)}
        </div>
        <label className="onb-label">Link strategy</label>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {LINK_STRAT_OPTS.map(([k, l]) => <button key={k} type="button" className={'chip' + (f.linkStrategy === k ? ' on' : '')} onClick={() => set('linkStrategy', k)}>{l}</button>)}
        </div>
        <label className="onb-label">Brief preview <span className="muted tiny" style={{ fontWeight: 400 }}>· what the agents read — edit freely</span></label>
        <textarea className="field dp-grow" rows={3} value={brief} onChange={e => setOverride(e.target.value)} placeholder="Add a pitch or points in the previous step to see the brief." />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="mini" onClick={() => setStep(1)}>← Back</button>
          <button className="btn-primary btn-sm" disabled={busy || !f.product.trim()} onClick={() => setStep(3)}>Next → set up the fleet</button>
        </div>
      </>)}

      {step === 3 && (<>
        <div className="onb-q">Spin up the fleet</div>
        <div className="muted tiny" style={{ marginBottom: 10 }}>Pick the kind of accounts that run this campaign. Each becomes an autonomous agent that weaves the mission into its own posting, in its own voice — never as an ad.</div>
        <label className="onb-label">Feeder type</label>
        <div className="onb-intensity">
          {FEEDER_TYPE_OPTS.map(([k, l, d]) => (
            <button key={k} className={'onb-int' + (feederType === k ? ' on' : '')} onClick={() => setFeederType(k)}>
              <span className="onb-int-l">{l}</span>
              <span className="onb-int-d">{d}</span>
            </button>
          ))}
        </div>
        {hasFreeAccounts ? (<>
          <label className="onb-label">Deploy on <span className="muted tiny" style={{ fontWeight: 400 }}>· your free feeder accounts</span></label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto' }}>
            {freeX.map(x => (
              <button key={`x:${x.id}`} type="button" className={'row chip' + (fleetSel.includes(`x:${x.id}`) ? ' on' : '')} style={{ justifyContent: 'flex-start', gap: 8 }} onClick={() => toggleFleet(`x:${x.id}`)}>
                <span className={'mini-check' + (fleetSel.includes(`x:${x.id}`) ? ' on' : '')}>{fleetSel.includes(`x:${x.id}`) && <LCheck size={10} strokeWidth={4} />}</span>
                <span className="status-dot" style={{ background: platformDot('x') }} />X · @{x.username}
              </button>
            ))}
            {freeSocial.map(s => (
              <button key={`s:${s.id}`} type="button" className={'row chip' + (fleetSel.includes(`s:${s.id}`) ? ' on' : '')} style={{ justifyContent: 'flex-start', gap: 8 }} onClick={() => toggleFleet(`s:${s.id}`)}>
                <span className={'mini-check' + (fleetSel.includes(`s:${s.id}`) ? ' on' : '')}>{fleetSel.includes(`s:${s.id}`) && <LCheck size={10} strokeWidth={4} />}</span>
                <span className="status-dot" style={{ background: platformDot(s.platform) }} />{s.platform} · @{s.username || s.platform}
              </button>
            ))}
          </div>
          {feederType === 'ugc_influencer' && <div className="muted tiny" style={{ marginTop: 6 }}>UGC influencers post talking-head videos (best on Instagram/TikTok) and need video generation enabled. Each post carries an AI-generated label.</div>}
        </>) : (
          <div className="muted tiny" style={{ marginTop: 8 }}>No free feeder accounts connected yet — you can launch now and deploy agents later from the campaign card (connect feeder X / social accounts first).</div>
        )}
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="mini" onClick={() => setStep(2)}>← Back</button>
          <button className="btn-primary btn-sm" disabled={busy || !f.product.trim()} onClick={launch}>{busy ? <Loader2 size={13} className="spin" /> : (fleetSel.length ? `Launch + spin up ${fleetSel.length} agent${fleetSel.length === 1 ? '' : 's'}` : 'Launch campaign')}</button>
        </div>
      </>)}
    </div>
  )
}

// Campaign intelligence panel — the shared brain made visible: what's working
// (distilled learnings), audience sentiment, the winning angles the bandit found,
// and per-platform / per-agent reach-normalized performance.
function CampaignIntel({ m = {}, roster = [], handleOf }) {
  const s = m.sentiment || {}
  const arms = (m.top_arms || []).filter(a => a.dimension === 'angle_lens' && a.obs > 0)
  const platforms = Object.entries(m.by_platform || {})
  const nameFor = id => { const a = roster.find(x => x.id === id); return a ? (a.persona?.name || a.name) : 'agent' }
  const sentTotal = s.total || 0
  const pct = n => sentTotal ? Math.round((n / sentTotal) * 100) : 0
  return (
    <div className="camp2-manage" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* What's working — distilled campaign learnings */}
      {m.insights?.length ? (
        <div>
          <div className="muted tiny" style={{ fontWeight: 700, marginBottom: 5 }}>WHAT'S WORKING</div>
          {m.insights.slice(0, 5).map((i, k) => (
            <div key={k} className="row" style={{ gap: 7, alignItems: 'flex-start', marginTop: 4 }}>
              <span className="chip" style={{ flex: 'none', fontSize: 10, padding: '1px 6px', opacity: 0.8 }}>{i.kind}</span>
              <span style={{ fontSize: 12, lineHeight: 1.4 }}>{i.text}{i.platform ? <span className="muted tiny"> · {i.platform}</span> : null}</span>
            </div>
          ))}
        </div>
      ) : <div className="muted tiny">Cadence is still gathering results — insights appear once the fleet has a few posts with real reach.</div>}

      {/* Audience sentiment */}
      {sentTotal > 0 && (
        <div>
          <div className="muted tiny" style={{ fontWeight: 700, marginBottom: 5 }}>AUDIENCE SENTIMENT <span style={{ fontWeight: 400 }}>· {sentTotal} comments</span></div>
          <div style={{ display: 'flex', height: 7, borderRadius: 999, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ width: `${pct(s.counts?.positive || 0)}%`, background: '#22c55e' }} />
            <div style={{ width: `${pct(s.counts?.question || 0)}%`, background: '#3b82f6' }} />
            <div style={{ width: `${pct(s.counts?.neutral || 0)}%`, background: '#9ca3af' }} />
            <div style={{ width: `${pct(s.counts?.negative || 0)}%`, background: '#ef4444' }} />
          </div>
          <div className="muted tiny">{pct(s.counts?.positive || 0)}% positive · {pct(s.counts?.question || 0)}% questions · {pct(s.counts?.negative || 0)}% negative</div>
          {s.questions?.length ? <div className="muted tiny" style={{ marginTop: 5 }}><b>They keep asking:</b> {s.questions.slice(0, 2).map(q => `"${q.slice(0, 60)}"`).join(' · ')}</div> : null}
          {(s.neg_share || 0) >= 0.25 && s.negatives?.length ? <div className="tiny" style={{ marginTop: 4, color: '#ef4444' }}><b>Pushback:</b> {s.negatives.slice(0, 1).map(n => `"${n.slice(0, 60)}"`)}</div> : null}
        </div>
      )}

      {/* Winning angles (bandit) */}
      {arms.length > 0 && (
        <div>
          <div className="muted tiny" style={{ fontWeight: 700, marginBottom: 5 }}>WINNING ANGLES <span style={{ fontWeight: 400 }}>· the fleet is learning to favor these</span></div>
          <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
            {arms.slice(0, 4).map((a, k) => <span key={k} className="chip sm">{a.value} <b style={{ marginLeft: 3 }}>{Math.round(a.mean * 100)}%</b></span>)}
          </div>
        </div>
      )}

      {/* Per-platform performance */}
      {platforms.length > 0 && (
        <div>
          <div className="muted tiny" style={{ fontWeight: 700, marginBottom: 5 }}>BY PLATFORM</div>
          {platforms.map(([p, v]) => (
            <div key={p} className="row" style={{ gap: 8, fontSize: 12, marginTop: 3 }}>
              <span className="status-dot" style={{ background: platformDot(p), width: 6, height: 6 }} />
              <span style={{ width: 70 }}>{p}</span>
              <span className="muted tiny">{v.posts} posts · {fmtNum(v.impressions)} impr{v.eng_rate != null ? ` · ${v.eng_rate}% eng` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Top agent */}
      {m.by_agent && Object.keys(m.by_agent).length > 0 && (() => {
        const best = Object.entries(m.by_agent).filter(([, a]) => a.eng_rate != null).sort((a, b) => b[1].eng_rate - a[1].eng_rate)[0]
        if (!best) return null
        const [id, a] = best
        return <div className="muted tiny"><b>Top performer:</b> {nameFor(id)} — {a.eng_rate}% eng over {a.posts} posts{a.best ? `; best: "${a.best.content.slice(0, 50)}…"` : ''}</div>
      })()}
    </div>
  )
}

function AgentCampaigns({ campaigns, agents, xConns, socialAccounts, posts, onSaveCamp, onPatchCamp, onDeleteCamp, onSpawn, onSpawnFleet, onPatchAgent, onRunAgent, onOpenAgent, onDraftCamp, onAssign, onUnassign }) {
  const onCamp = (a, cid) => (a.campaign_ids || []).includes(cid) // many-to-many membership
  const [form, setForm] = useState(null)        // create-campaign draft
  const [busy, setBusy] = useState(false)
  const [manageFor, setManageFor] = useState(null) // campaign id with the crew panel open
  const [intelFor, setIntelFor] = useState(null)   // campaign id with the intelligence panel open
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
  // An agent is assignable to a campaign if it's not already on it (it can be on
  // several). "Free" agents (on no campaign at all) are highlighted first.
  const assignableTo = cid => agents.filter(a => !onCamp(a, cid))

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
        const roster = agents.filter(a => onCamp(a, c.id))
        const m = c.metrics || {}
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
              <span className="camp2-stats">{m.promo_posts != null
                ? <><b>{fmtNum(m.promo_posts)}</b> promo · <b>{fmtNum(m.impressions || 0)}</b> impr{m.eng_rate != null ? <> · <b>{m.eng_rate}%</b> eng</> : ''}{m.clicks ? <> · <b>{fmtNum(m.clicks)}</b> clicks</> : ''}</>
                : <><b>{live}</b> posted · <b>{pending}</b> queued</>}</span>
              {(m.posts > 0 || m.insights?.length || m.sentiment?.total) && (
                <button className="chip sm" title="Campaign intelligence — what's working, sentiment, winning angles" onClick={() => setIntelFor(intelFor === c.id ? null : c.id)}>
                  <Sparkles size={11} style={{ marginRight: 3 }} />Intel
                </button>
              )}
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
                          {(a.campaign_ids || []).length > 1 && <span className="muted tiny" title="On other campaigns too">+{(a.campaign_ids || []).length - 1}</span>}
                          <RunNow running={a.running} onRun={() => onRunAgent(a.id)} />
                          <button className="mini" title="Remove from this campaign (agent keeps running its others)" onClick={() => onUnassign(c.id, a.id)}><LX size={11} /></button>
                        </div>
                      )
                    })}
                    <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      {assignableTo(c.id).length > 0 && (
                        <select className="field" style={{ width: 'auto', padding: '6px 10px', fontSize: 12.5 }} value="" onChange={e => e.target.value && onAssign(c.id, [e.target.value])}>
                          <option value="">Add an agent…</option>
                          {assignableTo(c.id).map(a => <option key={a.id} value={a.id}>{(a.persona?.name || a.name)} · {a.platform || 'x'}{(a.campaign_ids || []).length ? ` (on ${(a.campaign_ids || []).length})` : ''}</option>)}
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

            <AnimatePresence initial={false}>
              {intelFor === c.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                  <CampaignIntel m={m} roster={roster} handleOf={handleOf} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}

      {/* Create — guided onboarding */}
      {form ? (
        <CampaignOnboarding onCancel={() => setForm(null)} onCreate={onSaveCamp} onDraft={onDraftCamp} onSpawnFleet={onSpawnFleet} freeX={freeX} freeSocial={freeSocial} />
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

// ── Media Library — upload content, organize into albums, see how Cadence
//    reads each asset so it can reuse it tastefully in slideshows & clips. ─────
function AssetCard({ a, selected, onToggle, onOpen, onFavorite }) {
  const an = a.analysis || {}
  const busy = ['uploading', 'analyzing', 'processing'].includes(a.status)
  const thumb = a.type === 'video' ? a.thumb_url : (a.url || a.thumb_url)
  return (
    <div className={'lib-cell' + (selected ? ' sel' : '')}>
      <button className="lib-thumb" onClick={() => onOpen(a)} title={an.scene || a.filename}>
        {thumb ? <img src={thumb} alt="" /> : <div className="lib-noimg">{a.type === 'video' ? <Play size={20} /> : <LImage size={20} />}</div>}
        {a.type === 'video' && <span className="lib-badge"><Play size={11} /></span>}
        {busy && <span className="lib-status"><Loader2 size={15} className="spin" /> analyzing</span>}
        {a.status === 'failed' && <span className="lib-status bad">failed</span>}
        {a.status === 'ready' && (an.mood || an.subject) && <span className="lib-tags">{[an.subject, an.mood].filter(Boolean).join(' · ')}</span>}
      </button>
      {onFavorite && <button className={'lib-fav' + (a.is_favorite ? ' on' : '')} title={a.is_favorite ? 'Unfavorite' : 'Favorite'} onClick={() => onFavorite(a.id, !a.is_favorite)}><Star size={12} fill={a.is_favorite ? 'currentColor' : 'none'} /></button>}
      <button className={'lib-check' + (selected ? ' on' : '')} onClick={() => onToggle(a.id)}>{selected && <LCheck size={11} strokeWidth={4} />}</button>
    </div>
  )
}

const SMART_VIEWS = [
  ['all', 'All media', a => true],
  ['favorites', 'Favorites', a => a.is_favorite],
  ['recent', 'Recently used', a => !!a.last_used_at],
  ['none', 'Unfiled', a => !a.album_id],
  ['portraits', 'Portraits', a => a.analysis?.orientation === 'portrait'],
  ['textfriendly', 'Text-friendly', a => (a.analysis?.text_overlay_score || 0) >= 0.6],
  ['broll', 'B-roll (no speech)', a => a.type === 'video' && a.analysis?.has_speech === false],
]
// STUDIO COMPOSER — the create surface as an agent. Describe what you want
// (a carousel, a clip, an ad, anything), optionally attach Library media + pick
// a format, and the same Cadence agent builds it and drops the result inline.
// It's a thin shell over /api/chat (with a `studio` context) so everything the
// chat agent can do, the Studio can do — just create-first and structured.
function StudioComposer({ library = [], messages, busy, onSend, onResolve, onRegenerate, authed, socialAccounts, connected, xConns, hasPhotos, refreshLive, defaultHour, scope = [], onToggleScope, inputRef }) {
  const [input, setInput] = useState('')
  const [format, setFormat] = useState('auto')   // auto | carousel | clip | video
  const [captions, setCaptions] = useState(true)
  const [attach, setAttach] = useState([])        // [{id,type,url,filename,thumb_url}]
  const [pickOpen, setPickOpen] = useState(false)
  const [pickType, setPickType] = useState('all') // all | video | image
  const endRef = useRef(null)
  const fallbackTa = useRef(null)
  const taRef = inputRef || fallbackTa
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, busy])

  const usable = library.filter(a => a.url && (a.type === 'image' ? a.status !== 'failed' : a.status === 'ready'))
  const picks = usable.filter(a => pickType === 'all' || a.type === pickType)
  const isOn = a => attach.some(x => x.id === a.id)
  const toggleAttach = a => setAttach(p => isOn(a) ? p.filter(x => x.id !== a.id) : [...p, { id: a.id, type: a.type, url: a.url, filename: a.filename, thumb_url: a.thumb_url }])
  const isVid = ['clip', 'ai_video', 'ugc', 'edit'].includes(format) || attach.some(a => a.type === 'video')
  const hasImg = attach.some(a => a.type === 'image')
  const hasMedia = attach.length > 0

  function go(text) {
    const t = (text ?? input).trim(); if (!t || busy) return
    setInput('')
    onSend(t, { format, captions, attachments: attach })
  }

  // ONE create-type selector (replaces the old format chipset + quick bar).
  // Picking a type sets the studio format hint; the agent routes accordingly.
  const TYPES = [
    ['auto', 'Auto', Sparkles],
    ['carousel', 'Carousel', LImage],
    ['ai_video', 'AI video', LVideo],
    ['ugc', 'Avatar', MessageCircle],
    ['clip', 'Clip', Film],
    ['edit', 'Edit', Wand2],
    ['remix', 'Remix', RefreshCw],
  ]
  const PH = {
    auto: 'Describe what to make — a carousel, clip, video, post… or just ask',
    carousel: "What's the carousel about?",
    ai_video: 'Describe the video to generate…',
    ugc: 'What should the spokesperson say?',
    clip: 'Paste a video link (or attach one in Assets) to clip',
    edit: 'Describe the edit — attach clips, paste a TikTok/Reel link, or give a topic for stock',
    remix: 'Paste a viral TikTok/Reel/Short link to remix into your own',
  }[format]
  // A required input is missing for the picked type — nudge before they send.
  const need = format === 'ugc' && !hasImg ? 'Attach a photo of your spokesperson (Assets) for a talking-avatar video.'
    : format === 'edit' && !hasMedia ? 'Attach the clips/photos to stitch (Assets), or paste links in your message.'
    : null
  const FOCUS = [['all', 'All'], ['x', 'X'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']]
  const selType = (k) => { setFormat(k); taRef.current?.focus() }

  // Shared composer block (used in the empty hero and pinned under a thread).
  const composer = (
    <div className="sc-composer">
      <div className="sc-types">
        {TYPES.map(([k, l, Ic]) => (
          <button key={k} type="button" className={'sc-type' + (format === k ? ' on' : '')} onClick={() => selType(k)}>
            <Ic size={13} />{l}
          </button>
        ))}
      </div>
      {attach.length > 0 && (
        <div className="sc-attach-row">
          {attach.map(a => (
            <span className="sc-attach" key={a.id} title={a.filename}>
              {a.type === 'video' ? <LVideo size={12} /> : <img src={a.thumb_url || a.url} alt="" />}
              <span className="sc-attach-name">{a.filename || (a.type === 'video' ? 'video' : 'image')}</span>
              <button onClick={() => toggleAttach(a)} aria-label="Remove"><LX size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <textarea ref={taRef} className="sc-input" rows={messages.length ? 1 : 2}
        value={input} onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }}
        placeholder={PH} />
      {need && <button type="button" className="sc-need" onClick={() => setPickOpen(true)}><Paperclip size={12} /> {need}</button>}
      <div className="sc-opts">
        <button className={'sc-chip' + (attach.length ? ' on' : '')} onClick={() => setPickOpen(true)}>
          <Paperclip size={13} /> Assets{attach.length ? ` · ${attach.length}` : ''}
        </button>
        {isVid && (
          <button className={'sc-chip' + (captions ? ' on' : '')} onClick={() => setCaptions(c => !c)}>
            <Captions size={13} /> Captions{captions ? '' : ' off'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <motion.button className="sc-send" onClick={() => go()} disabled={busy || !input.trim()} whileTap={{ scale: 0.92 }}><Send size={16} /></motion.button>
      </div>
      {onToggleScope && (
        <div className="sc-focus">
          <span className="muted tiny" style={{ flex: 'none' }}>Post to</span>
          {FOCUS.map(([k, l]) => {
            const on = k === 'all' ? scope.length === 0 : scope.includes(k)
            return (
              <button key={k} className={'sc-focus-chip' + (on ? ' on' : '')} onClick={() => onToggleScope(k)}>
                {k !== 'all' && <span className="status-dot" style={{ background: platformDot(k), width: 6, height: 6 }} />}{l}
                {on && k !== 'all' && <LCheck size={10} strokeWidth={3} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <div className={'sc' + (messages.length ? ' has-thread' : '')}>
      {messages.length === 0 ? (
        <div className="sc-hero">
          <div className="sc-badge"><Sparkles size={13} /> Studio agent</div>
          <h2 className="sc-title">What do you want to make?</h2>
          <p className="sc-sub">Describe a carousel, a clip, an ad — anything. Cadence builds it and drops the result right here. Attach your own media to feature it.</p>
          {composer}
        </div>
      ) : (
        <>
          <div className="sc-thread">
            <AnimatePresence initial={false}>
              {messages.map((m, i) => {
                const props = m.proposals || (m.proposal ? [m.proposal] : [])
                return (
                  <motion.div key={i} className={'msg ' + m.role} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
                    <div className={'msg-col' + (props.length ? ' has-dp' : '')} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div className={'bubble ' + m.role}>{m.role === 'assistant' ? <MessageBody text={m.content} /> : m.content}</div>
                      {m.role === 'assistant' && m.content && <MsgActions text={m.content} onRegenerate={onRegenerate && i === messages.length - 1 && !busy ? onRegenerate : null} />}
                      {props.map((p, j) => p.question
                        ? <QuestionProposal key={j} proposal={p} onPick={(v) => go(v)} />
                        : p.campaign
                        ? <CampaignProposal key={j} proposal={p} authed={authed} onResolved={refreshLive} onOutcome={(resolved, label) => onResolve(i, j, resolved, label)} />
                        : (p.slideshow || p.video)
                        ? <MediaProposal key={j} proposal={p} index={j} total={props.length} authed={authed} socialAccounts={socialAccounts} onResolved={refreshLive} onOutcome={(resolved, label) => onResolve(i, j, resolved, label)} defaultHour={defaultHour} />
                        : <DraftProposal key={j} proposal={p} index={j} total={props.length} authed={authed} connected={connected} canPostLinkedIn={socialAccounts.some(a => a.platform === 'linkedin')} onResolved={refreshLive} onOutcome={(resolved, label) => onResolve(i, j, resolved, label)} defaultHour={defaultHour} xConns={xConns} hasPhotos={hasPhotos} />
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
            {busy && <div className="msg assistant"><div className="bubble assistant"><span className="dots"><i /><i /><i /></span></div></div>}
            <div ref={endRef} />
          </div>
          {composer}
        </>
      )}

      <AnimatePresence>
        {pickOpen && (
          <motion.div className="overlay" style={{ zIndex: 80 }} onClick={() => setPickOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="card modal sc-pick" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.97 }} transition={spring}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Attach from Library</span>
                <button className="x-close" onClick={() => setPickOpen(false)}><LX size={18} /></button>
              </div>
              <div className="sc-pick-tabs">
                {[['all', 'All'], ['video', 'Videos'], ['image', 'Photos']].map(([k, l]) => (
                  <button key={k} className={'sc-chip' + (pickType === k ? ' on' : '')} onClick={() => setPickType(k)}>{l}</button>
                ))}
                <span style={{ flex: 1 }} />
                <span className="muted tiny">{attach.length} selected</span>
              </div>
              {picks.length === 0
                ? <div className="muted" style={{ padding: '28px 4px', textAlign: 'center', fontSize: 13 }}>Nothing here yet. Upload media in the Library tab first.</div>
                : (
                  <div className="lib-grid sc-pick-grid">
                    {picks.map(a => (
                      <button key={a.id} className={'lib-cell' + (isOn(a) ? ' sel' : '')} onClick={() => toggleAttach(a)}>
                        <div className="lib-thumb">
                          {a.type === 'video'
                            ? (a.thumb_url ? <img src={a.thumb_url} alt="" /> : <div className="lib-vid-fallback"><Film size={20} /></div>)
                            : <img src={a.url} alt="" />}
                          {a.type === 'video' && <span className="lib-badge"><Play size={9} /></span>}
                          {isOn(a) && <span className="lib-check on"><LCheck size={12} strokeWidth={3} /></span>}
                        </div>
                        <span className="lib-name">{a.filename}</span>
                      </button>
                    ))}
                  </div>
                )}
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
                <button className="btn-ghost btn-sm" onClick={() => setAttach([])}>Clear</button>
                <button className="btn-primary btn-sm" onClick={() => setPickOpen(false)}>Done</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Projects — one home for everything you've created: carousels, clips, and
//    generated videos/edits. Unifies the slideshows + clip_jobs + video_jobs
//    tables into a single gallery with preview, status, and post/delete. ───────
// Poll one video_jobs row until it lands. Shared by MediaProposal-style cards and
// the video editor so there's a single poller implementation.
function useVideoJob(jobId, authed, enabled = true) {
  const [job, setJob] = useState(null)
  useEffect(() => {
    if (!enabled || !jobId) return
    let on = true, timer, tries = 0
    const tick = async () => {
      try {
        const r = await authed(`/api/video?id=${jobId}`)
        const j = (await r.json()).job
        if (on && j) { setJob(j); if (['done', 'failed', 'needs_provider'].includes(j.status)) return }
      } catch { /* keep polling */ }
      if (on && ++tries < 160) timer = setTimeout(tick, 5000)
    }
    tick()
    return () => { on = false; clearTimeout(timer) }
  }, [jobId, enabled, authed])
  return job
}

const VSE_STYLES = [['bold', 'Bold'], ['minimal', 'Minimal'], ['editorial', 'Editorial'], ['gradient', 'Gradient'], ['mint', 'Mint']]

// Video editor — a tasteful scene LIST over the EditPlan IR. A 'directed' video
// edits its real plan; ANY other finished video (clip / AI video / edit) is
// LIFTED into a single clip scene so it's editable too (add a hook card, append
// b-roll, swap footage, trim). Re-render is a non-destructive CLONE: it POSTs a
// new directed job (parent_job_id lineage) and never touches the original. Only
// controls the render engine actually honors are exposed (text, duration, scene
// order, style) — captions/transitions/motion arrive when the engine does.
const rid = () => 'n_' + Date.now().toString(36) + Math.round(Math.random() * 1e6).toString(36)
const sceneSecs = s => s.duration != null ? Number(s.duration) || 0 : (s.kind === 'card' || s.kind === 'color') ? 3 : 5
// Strip editor-only fields (e.g. the swap-undo pointer) before the plan is sent.
const stripPlan = p => ({ ...p, scenes: p.scenes.map(({ orig_url, ...s }) => s) }) // eslint-disable-line

function VideoSceneEditor({ job, authed, onRerendered, onClose }) {
  const lifted = !(job.mode === 'directed' && job.edit_plan?.scenes?.length)
  const initial = useMemo(() => lifted
    ? { version: 1, aspect: job.aspect || 'vertical', captions: 'off', style_key: job.style_key || 'bold', scenes: [{ id: 's0', kind: 'clip', url: job.video_url, query: null, asset_id: null, duration: 15, transition: 'cut', motion: null, caption_text: null }] }
    : JSON.parse(JSON.stringify(job.edit_plan)), [job.id]) // eslint-disable-line
  const [plan, setPlan] = useState(initial)
  const [newJobId, setNewJobId] = useState(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [downgrades, setDowngrades] = useState([])
  const [srcLong, setSrcLong] = useState(false) // a lifted source longer than the 15s scene cap
  const rendered = useVideoJob(newJobId, authed, !!newJobId)
  const doneRef = useRef(false)
  useEffect(() => { if (rendered?.status === 'done' && !doneRef.current) { doneRef.current = true; onRerendered && onRerendered() } }, [rendered?.status]) // eslint-disable-line

  const setScene = (i, patch) => setPlan(p => ({ ...p, scenes: p.scenes.map((s, j) => j === i ? { ...s, ...patch } : s) }))
  const move = (i, d) => setPlan(p => { const a = p.scenes.slice(); const j = i + d; if (j < 0 || j >= a.length) return p;[a[i], a[j]] = [a[j], a[i]]; return { ...p, scenes: a } })
  const del = i => setPlan(p => p.scenes.length <= 1 ? p : ({ ...p, scenes: p.scenes.filter((_, j) => j !== i) }))
  const add = kind => setPlan(p => p.scenes.length >= 6 ? p : ({ ...p, scenes: [...p.scenes, kind === 'card' ? { id: rid(), kind: 'card', heading: 'New card', body: null, duration: 3, transition: 'cut', motion: null } : { id: rid(), kind: 'clip', query: '', url: null, asset_id: null, duration: 4, transition: 'cut', motion: null }] }))
  const totalSecs = Math.round(plan.scenes.reduce((a, s) => a + sceneSecs(s), 0))

  async function rerender() {
    if (busy) return
    if (!plan.scenes.length) { setErr('Add at least one scene.'); return }
    // Mirror the server's drop rule: a clip with no footage source (after a swap
    // with no query typed) would be silently dropped, shrinking the plan.
    if (plan.scenes.some(s => (s.kind === 'clip' || !s.kind) && !s.url && !s.asset_id && !String(s.query || '').trim())) {
      setErr('Every clip needs footage — type what to show, or use your own clip.'); return
    }
    setErr(''); setDowngrades([]); setBusy(true)
    try {
      const r = await authed('/api/video', { method: 'POST', body: JSON.stringify({ mode: 'directed', edit_plan: stripPlan(plan), prompt: job.prompt || '', parent_job_id: job.id }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) { setErr(d.error || 'Could not start the re-render.'); return }
      if (Array.isArray(d.downgrades) && d.downgrades.length) setDowngrades(d.downgrades)
      setNewJobId(d.job.id)
    } catch { setErr('Could not reach the server — try again.') }
    finally { setBusy(false) }
  }

  return (
    <motion.div className="overlay" style={{ zIndex: 95 }} onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card modal vse" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.97 }} transition={spring}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 15.5 }}>Edit video</span>
          <button className="x-close" onClick={onClose}><LX size={18} /></button>
        </div>

        {newJobId ? (
          <div className="vse-rendering">
            {downgrades.length > 0 && rendered?.status !== 'failed' && <div className="vse-note" style={{ marginBottom: 10 }}>Heads up: {downgradeText(downgrades)}</div>}
            {rendered?.status === 'done'
              ? (<><video className="mp-video" src={rendered.video_url} controls playsInline preload="metadata" style={{ marginBottom: 12 }} /><div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Your edited version is ready — it’s in Projects.</div><button className="btn-primary btn-sm" onClick={onClose}>Done</button></>)
              : rendered?.status === 'failed' ? (<><div className="notice" style={{ color: '#B3372F' }}>{rendered.error || 'The re-render failed.'}</div><button className="btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => { doneRef.current = false; setNewJobId(null) }}>Back to edit</button></>)
                : rendered?.status === 'needs_provider' ? (<div className="mp-coming">Generated video isn’t switched on — this edit uses AI scenes.</div>)
                  : (<div className="mp-rendering"><span className="dots"><i /><i /><i /></span><span>Re-rendering your video…{rendered?.status_detail ? ` ${rendered.status_detail}` : ''}</span><span className="muted tiny">A minute or two — it’ll appear in Projects when ready.</span></div>)}
          </div>
        ) : (
          <>
            <div className="muted tiny" style={{ marginBottom: 10 }}>{lifted ? 'Editing your video as scenes — add a hook card, more b-roll, or trim. The original stays in Projects, untouched.' : 'Reorder, retitle, swap footage or trim each scene.'}</div>
            {srcLong && <div className="vse-note" style={{ marginBottom: 10 }}>Your original is longer than one scene — re-rendering composes scenes of up to 15s each, so a long clip is trimmed. The original stays safe in Projects.</div>}
            <div className="vse-scenes">
              {plan.scenes.map((s, i) => {
                const isCard = s.kind === 'card' || s.kind === 'color'
                return (
                  <div className="vse-scene" key={s.id || i}>
                    <span className="vse-num">{i + 1}</span>
                    {isCard
                      ? <div className={'vse-thumb vse-thumb-card sty-' + (s.style_key || plan.style_key || 'bold')}><b>{(s.heading || 'Aa').slice(0, 14)}</b></div>
                      : (s.url && !s.query)
                        ? <video className="vse-thumb" src={s.url} muted playsInline preload="metadata" onLoadedMetadata={lifted && i === 0 ? (e => { if (e.target.duration > 15.5) setSrcLong(true) }) : undefined} />
                        : <div className="vse-thumb vse-thumb-q"><Film size={16} /></div>}
                    <div className="vse-fields">
                      <span className="vse-kind">{isCard ? 'Text card' : 'Clip'}</span>
                      {isCard ? (
                        <>
                          <input className="field" value={s.heading || ''} maxLength={80} onChange={e => setScene(i, { kind: 'card', heading: e.target.value })} placeholder="Big line" />
                          <input className="field" value={s.body || ''} maxLength={160} onChange={e => setScene(i, { body: e.target.value })} placeholder="Subtext (optional)" />
                        </>
                      ) : (s.url && !s.query) ? (
                        <div className="row" style={{ gap: 8 }}><span className="muted tiny">Your footage</span><button className="mini" onClick={() => setScene(i, { query: '', url: null, orig_url: s.url })}>Swap for stock…</button></div>
                      ) : (
                        <>
                          <input className="field" value={s.query || ''} onChange={e => setScene(i, { query: e.target.value, url: null })} placeholder="B-roll to show (e.g. coffee pour cafe)" />
                          {s.orig_url && <button className="vse-restore" onClick={() => setScene(i, { url: s.orig_url, query: null, orig_url: null })}>↩ Use my footage again</button>}
                        </>
                      )}
                      <div className="vse-row">
                        <label className="vse-dur">Length <input type="number" inputMode="numeric" min="1" max="15" value={s.duration || ''} onChange={e => setScene(i, { duration: Math.min(Math.max(Number(e.target.value) || 1, 1), 15) })} />s</label>
                        <span style={{ flex: 1 }} />
                        <button className="vse-ic" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ChevronDown size={14} style={{ transform: 'rotate(180deg)' }} /></button>
                        <button className="vse-ic" title="Move down" disabled={i === plan.scenes.length - 1} onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
                        <button className="vse-ic danger" title="Delete scene" disabled={plan.scenes.length <= 1} onClick={() => del(i)}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="vse-add">
              <button className="sc-chip" disabled={plan.scenes.length >= 6} onClick={() => add('card')}><Plus size={12} /> Text card</button>
              <button className="sc-chip" disabled={plan.scenes.length >= 6} onClick={() => add('clip')}><Plus size={12} /> B-roll clip</button>
              <span className="muted tiny" style={{ marginLeft: 'auto' }}>~{totalSecs}s · {plan.scenes.length}/6 scenes</span>
            </div>
            <div className="vse-global">
              <span className="muted tiny" style={{ flex: 'none' }}>Style</span>
              {VSE_STYLES.map(([k, l]) => <button key={k} className={'chip' + (plan.style_key === k ? ' on' : '')} onClick={() => setPlan(p => ({ ...p, style_key: k }))}>{l}</button>)}
            </div>
            {err && <div className="notice" style={{ color: '#B3372F', marginTop: 8 }}>{err}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
              <motion.button className="btn-primary btn-sm" whileTap={{ scale: 0.96 }} disabled={busy} onClick={rerender}>{busy ? <span className="dots"><i /><i /><i /></span> : 'Re-render'}</motion.button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

// Friendly one-liner for the normalizer's downgrade list (ai_video->clip, etc.).
function downgradeText(downgrades = []) {
  const txt = downgrades.map(d => String(d)).join(' ')
  const bits = []
  if (/ai_video|avatar|->\s*clip|->\s*card|generat/i.test(txt)) bits.push('an AI scene was swapped for stock b-roll (generated video isn’t switched on)')
  if (/drop/i.test(txt)) bits.push('a scene with no footage was dropped')
  if (/aspect/i.test(txt)) bits.push('the aspect was set to vertical')
  return (bits.length ? bits.join('; ') : 'some scenes were adjusted to render') + '.'
}

// Carousel editor — drops the existing SlideEditor into a modal; Save persists to
// the slideshows row (draft-only, enforced server-side) and re-renders slides.
function CarouselEditModal({ slideshow, authed, onSaved, onClose }) {
  const [draft, setDraft] = useState({ slides: slideshow.slides || [], image_urls: slideshow.image_urls || [] })
  const [caption, setCaption] = useState(slideshow.caption || '')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  async function save() {
    setErr(''); setBusy(true)
    const r = await authed('/api/slideshow', { method: 'PATCH', body: JSON.stringify({ id: slideshow.id, slides: draft.slides, image_urls: draft.image_urls, caption }) })
    const d = await r.json().catch(() => ({})); setBusy(false)
    if (!r.ok || d.error) { setErr(d.error || 'Could not save.'); return }
    onSaved && onSaved()
  }
  return (
    <motion.div className="overlay" style={{ zIndex: 95 }} onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card modal" style={{ width: 560, maxWidth: '100%' }} onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.97 }} transition={spring}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15.5 }}>Edit carousel</span>
          <button className="x-close" onClick={onClose}><LX size={18} /></button>
        </div>
        <SlideEditor slides={slideshow.slides} imageUrls={slideshow.image_urls} style={slideshow.style} format={slideshow.format} handle={slideshow.handle} authed={authed} onChange={(s, u) => setDraft({ slides: s, image_urls: u })} />
        <label className="se-label">Caption</label>
        <textarea className="field" rows={2} value={caption} onChange={e => setCaption(e.target.value)} placeholder="Caption…" style={{ minHeight: 52, resize: 'vertical' }} />
        {err && <div className="notice" style={{ color: '#B3372F', marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <motion.button className="btn-primary btn-sm" whileTap={{ scale: 0.96 }} disabled={busy} onClick={save}>{busy ? <span className="dots"><i /><i /><i /></span> : 'Save'}</motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function Projects({ slideshows = [], clipJobs = [], videoJobs = [], socialAccounts = [], authed, onDeleteSlideshow, onDeleteClip, onDeleteVideo, onPostClip, onPostVideo, onReloadSlideshows, onReloadVideos, onGoCreate }) {
  const [filter, setFilter] = useState('all')      // all | carousel | clip | video
  const [postOpen, setPostOpen] = useState(null)   // item key whose account-picker is open
  const [postCaption, setPostCaption] = useState('') // editable caption for the open picker
  const [editing, setEditing] = useState(null)     // { kind:'carousel'|'video', raw }

  // While any video is rendering, poll the list so directed renders advance
  // promptly (mirrors the clip poll); stops once everything is terminal.
  useEffect(() => {
    if (!onReloadVideos || !videoJobs.some(j => ['queued', 'processing', 'rendering'].includes(j.status))) return
    const t = setInterval(onReloadVideos, 4000)
    return () => clearInterval(t)
  }, [videoJobs, onReloadVideos])

  // Build the gallery once per data change (not per keystroke / filter toggle).
  const { items, counts, igtt } = useMemo(() => {
    const igtt = socialAccounts.filter(a => ['instagram', 'tiktok'].includes(a.platform))

    // Collapse re-render lineages. A directed edit is a new job pointing back at
    // its parent; show the newest DONE render per lineage as the card so a failed
    // or in-flight clone can NEVER bury the proven original — a more-recent
    // non-done clone is surfaced as a note ON that card (re-rendering / retry).
    const byId = new Map(videoJobs.map(v => [v.id, v]))
    const rootOf = v => { let r = v, hops = 0; while (r.parent_job_id && byId.has(r.parent_job_id) && hops++ < 20) r = byId.get(r.parent_job_id); return r.id }
    const newer = (a, b) => new Date(a?.created_at || 0) > new Date(b?.created_at || 0)
    const lineage = new Map() // root -> { newest, newestDone }
    for (const v of videoJobs) {
      const root = rootOf(v)
      const cur = lineage.get(root) || { newest: null, newestDone: null }
      if (newer(v, cur.newest)) cur.newest = v
      if (v.status === 'done' && newer(v, cur.newestDone)) cur.newestDone = v
      lineage.set(root, cur)
    }

    const items = []
    for (const s of slideshows) {
      items.push({ key: 'ss' + s.id, kind: 'carousel', badge: 'Carousel', when: s.created_at || s.scheduled_for, status: s.status || 'draft', title: s.title || s.topic || 'Carousel', thumb: s.image_urls?.[0], meta: `${s.image_urls?.length || 0} slides`, edit: (s.status || 'draft') === 'draft' ? () => setEditing({ kind: 'carousel', raw: s }) : null, del: () => onDeleteSlideshow(s.id) })
    }
    for (const j of clipJobs) {
      if (j.status === 'done' && Array.isArray(j.clips) && j.clips.length) {
        j.clips.forEach((c, i) => items.push({ key: 'cl' + j.id + '_' + i, kind: 'clip', badge: 'Clip', when: j.created_at, status: 'ready', title: c.title || j.source_name || 'Clip', video: c.url, meta: c.end != null && c.start != null ? `${Math.round(c.end - c.start)}s` : '', caption: c.caption || c.title || j.source_name || '', post: (ids, cap) => onPostClip(j.id, i, ids, cap), edit: () => setEditing({ kind: 'video', raw: { mode: 'clip', video_url: c.url, aspect: 'vertical', style_key: 'bold', prompt: c.title || j.source_name || '', id: null } }), del: () => onDeleteClip(j.id) }))
      } else {
        items.push({ key: 'cl' + j.id, kind: 'clip', badge: 'Clip', when: j.created_at, status: j.status, title: j.source_name || 'Clip', detail: j.status_detail, error: j.error, del: () => onDeleteClip(j.id) })
      }
    }
    for (const { newest, newestDone } of lineage.values()) {
      const v = newestDone || newest                                  // proven render wins; else its native state
      const clone = newestDone && newest && newest.id !== newestDone.id ? newest : null
      const rerendering = clone && ['queued', 'processing', 'rendering'].includes(clone.status) ? clone : null
      const failedClone = clone && clone.status === 'failed' ? clone : null
      const badge = v.mode === 'directed' ? 'Video' : v.mode === 'ugc' ? 'Avatar' : v.mode === 'edit' ? 'Edit' : 'AI video'
      const ready = v.status === 'done'
      items.push({
        key: 'vd' + v.id, kind: 'video', badge, edited: !!v.parent_job_id, when: (clone || v).created_at,
        status: ready ? 'ready' : v.status, title: v.prompt || v.script || badge, video: v.video_url, thumb: v.thumb_url,
        detail: v.status_detail === 'Ready' ? '' : v.status_detail, error: v.status === 'failed' ? v.error : null,
        rerendering: !!rerendering, rerenderDetail: rerendering?.status_detail,
        retry: failedClone ? () => setEditing({ kind: 'video', raw: failedClone }) : null, retryError: failedClone?.error,
        caption: v.prompt || v.script || '', post: (ids, cap) => onPostVideo(v.id, ids, cap ?? (v.prompt || v.script || '')),
        edit: ready ? () => setEditing({ kind: 'video', raw: v }) : null, del: () => onDeleteVideo(v.id),
      })
    }
    items.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
    const counts = { all: items.length, carousel: items.filter(i => i.kind === 'carousel').length, clip: items.filter(i => i.kind === 'clip').length, video: items.filter(i => i.kind === 'video').length }
    return { items, counts, igtt }
  }, [slideshows, clipJobs, videoJobs, socialAccounts]) // eslint-disable-line

  const shown = filter === 'all' ? items : items.filter(it => it.kind === filter)

  return (
    <div className="proj">
      <div className="proj-filters">
        {[['all', 'All'], ['carousel', 'Carousels'], ['clip', 'Clips'], ['video', 'Videos']].map(([k, l]) => (
          <button key={k} className={'sc-chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}{counts[k] ? ` · ${counts[k]}` : ''}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="proj-empty">
          <div className="wordmark" style={{ fontSize: 18, marginBottom: 6 }}>Nothing here yet</div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>Everything you make in the Studio — carousels, clips, AI videos, edits — lands here.</div>
          <button className="btn-primary btn-sm" onClick={onGoCreate}><Sparkles size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />Make something</button>
        </div>
      ) : (
        <div className="proj-grid">
          {shown.map(it => {
            const ready = it.status === 'ready' || it.status === 'done'
            const pending = it.status === 'queued' || it.status === 'processing' || it.status === 'rendering'
            return (
              <div className="proj-card" key={it.key}>
                <div className="proj-media">
                  {it.video && ready ? <video src={it.video} controls preload="metadata" poster={it.thumb || undefined} />
                    : it.thumb ? <img src={it.thumb} alt="" />
                      : <div className={'proj-ph' + (pending ? ' wait' : '')}>{pending ? <Loader2 size={20} className="spin" /> : it.kind === 'carousel' ? <LImage size={22} /> : it.kind === 'clip' ? <Film size={22} /> : <LVideo size={22} />}</div>}
                  <span className="proj-badge">{it.badge}</span>
                </div>
                <div className="proj-body">
                  <div className="proj-title" title={it.title}>{it.title}</div>
                  <div className="proj-meta">
                    <span className={'proj-status' + (ready ? ' ok' : it.status === 'failed' ? ' bad' : '')}>{it.status}</span>
                    {it.edited ? <span className="proj-status">edited</span> : null}
                    {it.meta ? <span className="muted tiny">{it.meta}</span> : null}
                    {it.when ? <span className="muted tiny">{fmt(it.when)}</span> : null}
                  </div>
                  {pending && it.detail && <div className="muted tiny" style={{ marginTop: 4 }}>{it.detail}</div>}
                  {it.status === 'failed' && it.error && <div className="muted tiny" style={{ marginTop: 4, color: '#B3372F' }}>{it.error}</div>}
                  {it.status === 'needs_provider' && <div className="muted tiny" style={{ marginTop: 4 }}>Generated video isn’t switched on.</div>}
                  {it.rerendering && <div className="muted tiny" style={{ marginTop: 4 }}><Loader2 size={11} className="spin" style={{ verticalAlign: '-2px', marginRight: 4 }} />Re-rendering an edit…{it.rerenderDetail ? ` ${it.rerenderDetail}` : ''}</div>}
                  {it.retry && <div className="muted tiny" style={{ marginTop: 4, color: '#B3372F' }}>Last re-render failed{it.retryError ? ` — ${it.retryError}` : ''}. <button className="vse-restore" onClick={it.retry}>Retry</button></div>}
                  {ready && it.post && postOpen === it.key && (
                    <div className="proj-post">
                      {igtt.length === 0
                        ? <span className="muted tiny">Connect Instagram or TikTok to post.</span>
                        : (<>
                          <textarea className="field" rows={2} value={postCaption} onChange={e => setPostCaption(e.target.value)} placeholder="Caption…" style={{ minHeight: 48, fontSize: 12, resize: 'vertical' }} />
                          <div className="muted tiny" style={{ marginBottom: 2 }}>Post to:</div>
                          {igtt.map(a => (
                            <button key={a.id} className="chip" style={{ fontSize: 11 }} onClick={() => { it.post([a.id], postCaption); setPostOpen(null) }}>
                              <span className="status-dot" style={{ background: platformDot(a.platform) }} />@{a.username}
                            </button>
                          ))}
                        </>)}
                    </div>
                  )}
                </div>
                <div className="proj-actions">
                  {it.edit && <button className="mini" onClick={it.edit}><Pencil size={11} /> Edit</button>}
                  {ready && it.post && <button className="mini" onClick={() => { const opening = postOpen !== it.key; setPostOpen(opening ? it.key : null); if (opening) setPostCaption(it.caption || '') }}><Upload size={11} /> Post</button>}
                  <button className="mini danger" onClick={it.del}><Trash2 size={12} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <AnimatePresence>
        {editing?.kind === 'carousel' && <CarouselEditModal slideshow={editing.raw} authed={authed} onSaved={() => { onReloadSlideshows && onReloadSlideshows(); setEditing(null) }} onClose={() => setEditing(null)} />}
        {editing?.kind === 'video' && <VideoEditor job={editing.raw} authed={authed} onRerendered={() => onReloadVideos && onReloadVideos()} onClose={() => setEditing(null)} />}
      </AnimatePresence>
    </div>
  )
}

function MediaLibrary({ assets, albums, onUpload, onCreateAlbum, onDeleteAlbum, onMove, onDelete, onFavorite, onUseIn }) {
  const [view, setView] = useState('all') // smart-view key OR album id
  const [sel, setSel] = useState(new Set())
  const [creating, setCreating] = useState(false); const [name, setName] = useState('')
  const [detail, setDetail] = useState(null)
  const [q, setQ] = useState(''); const [facet, setFacet] = useState({ type: '', orientation: '', subject: '', mood: '' }); const [sort, setSort] = useState('new')
  const tok = s => String(s || '').toLowerCase()
  const isAlbum = albums.some(al => al.id === view)
  const smartFn = (SMART_VIEWS.find(v => v[0] === view) || SMART_VIEWS[0])[2]

  let shown = assets.filter(a => isAlbum ? a.album_id === view : smartFn(a))
  if (facet.type) shown = shown.filter(a => a.type === facet.type)
  if (facet.orientation) shown = shown.filter(a => a.analysis?.orientation === facet.orientation)
  if (facet.subject) shown = shown.filter(a => a.analysis?.subject === facet.subject)
  if (facet.mood) shown = shown.filter(a => a.analysis?.mood === facet.mood)
  if (q.trim()) { const n = tok(q); shown = shown.filter(a => tok(a.filename).includes(n) || tok(a.analysis?.scene).includes(n) || (a.analysis?.labels || []).some(l => tok(l).includes(n))) }
  shown = [...shown].sort((x, y) => sort === 'quality' ? ((y.analysis?.quality || 0) - (x.analysis?.quality || 0)) : sort === 'used' ? (new Date(y.last_used_at || 0) - new Date(x.last_used_at || 0)) : (new Date(y.created_at) - new Date(x.created_at)))

  const subjects = [...new Set(assets.map(a => a.analysis?.subject).filter(Boolean))].sort()
  const moods = [...new Set(assets.map(a => a.analysis?.mood).filter(Boolean))].sort()
  const targetAlbum = isAlbum ? view : null
  const toggleSel = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  function onPick(e) {[...(e.target.files || [])].forEach(f => onUpload(f, targetAlbum)); e.target.value = '' }
  async function create() { if (!name.trim()) return; if (await onCreateAlbum(name.trim())) { setName(''); setCreating(false) } }
  const analyzing = assets.filter(a => ['analyzing', 'processing', 'uploading'].includes(a.status)).length
  const Facet = ({ k, v, label }) => <button type="button" className={'lib-facet' + (facet[k] === v ? ' on' : '')} onClick={() => setFacet(f => ({ ...f, [k]: f[k] === v ? '' : v }))}>{label}</button>

  return (
    <div className="lib">
      <div className="lib-side">
        {SMART_VIEWS.map(([k, l, fn]) => (
          <button key={k} className={'lib-album' + (view === k ? ' on' : '')} onClick={() => setView(k)}>{l} <span>{assets.filter(fn).length}</span></button>
        ))}
        <div className="lib-side-h">Albums</div>
        {albums.map(al => (
          <div key={al.id} className="lib-album-row">
            <button className={'lib-album' + (view === al.id ? ' on' : '')} onClick={() => setView(al.id)}>{al.name} <span>{al.count}</span></button>
            <button className="lib-album-del" title="Delete album" onClick={() => onDeleteAlbum(al.id)}><Trash2 size={11} /></button>
          </div>
        ))}
        {creating ? (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input className="field" autoFocus placeholder="Album name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} style={{ fontSize: 12.5, padding: '6px 9px' }} />
            <button className="btn-primary btn-sm" onClick={create}>Add</button>
          </div>
        ) : <button className="lib-newalbum" onClick={() => setCreating(true)}><Plus size={12} /> New album</button>}
      </div>

      <div className="lib-main">
        <div className="lib-top">
          <div className="muted tiny" style={{ flex: 1, minWidth: 0 }}>Upload your photos & clips — Cadence reads each one so it can weave them tastefully into your reels & carousels.{analyzing ? ` · ${analyzing} analyzing…` : ''}</div>
          <label className="btn-primary btn-sm row" style={{ gap: 6, cursor: 'pointer' }}><Upload size={14} /> Upload<input type="file" multiple accept="image/*,video/*" hidden onChange={onPick} /></label>
        </div>

        {assets.length > 0 && (
          <div className="lib-filters">
            <div className="lib-search"><LSearch size={13} /><input placeholder="Search your media…" value={q} onChange={e => setQ(e.target.value)} /></div>
            <Facet k="type" v="image" label="Photos" /><Facet k="type" v="video" label="Videos" />
            <Facet k="orientation" v="portrait" label="Portrait" /><Facet k="orientation" v="landscape" label="Landscape" />
            {subjects.slice(0, 5).map(s => <Facet key={s} k="subject" v={s} label={s} />)}
            {moods.slice(0, 4).map(m => <Facet key={m} k="mood" v={m} label={m} />)}
            <select className="field lib-sort" value={sort} onChange={e => setSort(e.target.value)}>
              <option value="new">Newest</option><option value="quality">Best quality</option><option value="used">Recently used</option>
            </select>
          </div>
        )}

        {sel.size > 0 && (
          <div className="lib-bulk">
            <span>{sel.size} selected</span>
            <select className="field" style={{ width: 'auto', padding: '5px 9px', fontSize: 12.5 }} value="" onChange={e => { const v = e.target.value; if (!v) return; onMove([...sel], v === '__none' ? null : v); setSel(new Set()) }}>
              <option value="">Move to…</option>
              <option value="__none">Unfiled</option>
              {albums.map(al => <option key={al.id} value={al.id}>{al.name}</option>)}
            </select>
            <button className="mini danger" onClick={() => { [...sel].forEach(onDelete); setSel(new Set()) }}><Trash2 size={12} /> Delete</button>
            <button className="mini" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="brain-empty card" style={{ display: 'block', marginTop: 12 }}>
            <div className="empty-icon"><LImage size={24} /></div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Nothing here yet</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>Upload images and videos. Cadence reads each one — subject, mood, how well text sits on it — and pulls the right ones into your carousels and clips. Assign albums to campaigns to control what each one draws from.</div>
          </div>
        ) : (
          <div className="lib-grid">{shown.map(a => <AssetCard key={a.id} a={a} selected={sel.has(a.id)} onToggle={toggleSel} onOpen={setDetail} onFavorite={onFavorite} />)}</div>
        )}
      </div>

      <AnimatePresence>
        {detail && (() => { const an = detail.analysis || {}; return (
          <motion.div className="overlay" onClick={() => setDetail(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="card modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }} transition={spring}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{detail.filename || (detail.type === 'video' ? 'Video' : 'Image')}</span>
                <button className="x-close" onClick={() => setDetail(null)}><LX size={18} /></button>
              </div>
              {detail.type === 'video'
                ? <video src={detail.url} poster={detail.thumb_url || undefined} controls playsInline className="mp-video" />
                : <img src={detail.url} alt="" style={{ width: '100%', borderRadius: 10, maxHeight: 360, objectFit: 'contain', background: '#0001' }} />}
              {detail.status !== 'ready' ? (
                <div className="muted tiny" style={{ marginTop: 10 }}>{detail.status === 'failed' ? `Analysis failed: ${detail.error || ''}` : 'Analyzing…'}</div>
              ) : (<>
                {an.scene && <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.5 }}>{an.scene}</div>}
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {an.subject && <span className="lib-chip">{an.subject}</span>}
                  {an.mood && <span className="lib-chip">{an.mood}</span>}
                  {an.orientation && <span className="lib-chip">{an.orientation}</span>}
                  {an.quality != null && <span className="lib-chip">quality {Math.round(an.quality * 100)}%</span>}
                  {an.text_overlay_score != null && <span className="lib-chip">text-friendly {Math.round(an.text_overlay_score * 100)}%</span>}
                  {(an.labels || []).slice(0, 8).map((l, i) => <span key={i} className="lib-chip subtle">{l}</span>)}
                </div>
                {Array.isArray(an.palette) && an.palette.length > 0 && <div className="row" style={{ gap: 4, marginTop: 10 }}>{an.palette.map((c, i) => <span key={i} style={{ width: 22, height: 22, borderRadius: 5, background: c, border: '1px solid var(--line)' }} title={c} />)}</div>}
              </>)}
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                {onFavorite && <button className={'mini' + (detail.is_favorite ? ' on' : '')} onClick={() => { onFavorite(detail.id, !detail.is_favorite); setDetail(d => ({ ...d, is_favorite: !d.is_favorite })) }}><Star size={12} fill={detail.is_favorite ? 'currentColor' : 'none'} /> {detail.is_favorite ? 'Favorited' : 'Favorite'}</button>}
                {onUseIn && detail.status === 'ready' && <button className="btn-primary btn-sm" onClick={() => { onUseIn(detail); setDetail(null) }}><Wand2 size={12} /> Use in {detail.type === 'video' ? 'a clip' : 'a carousel'}</button>}
                <button className="mini danger" style={{ marginLeft: 'auto' }} onClick={() => { onDelete(detail.id); setDetail(null) }}><Trash2 size={12} /> Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )})()}
      </AnimatePresence>
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────
function App({ session }) {
  const token = session.access_token
  const authed = useCallback((path, opts = {}) => fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } }), [token])

  const [tab, setTab] = useState('studio')
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
  const [videoJobs, setVideoJobs] = useState([])
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
  const [mediaAssets, setMediaAssets] = useState([]); const [mediaAlbums, setMediaAlbums] = useState([])
  const [chatList, setChatList] = useState([]); const [historyOpen, setHistoryOpen] = useState(false)
  const [agentProfileId, setAgentProfileId] = useState(null) // open agent-profile modal
  const [trends, setTrends] = useState([]); const [scanning, setScanning] = useState('')
  const [autopilot, setAutopilot] = useState([]); const [apRunning, setApRunning] = useState('')
  const [insights, setInsights] = useState([]); const [insightsLearnedAt, setInsightsLearnedAt] = useState(null); const [learning, setLearning] = useState(false)
  const [brandOnb, setBrandOnb] = useState(null); const [brandSaving, setBrandSaving] = useState(false) // platform string while open
  const [socialOnb, setSocialOnb] = useState(null) // 'instagram'|'tiktok' while the IG/TikTok autopilot wizard is open
  const [gateMiss, setGateMiss] = useState(null) // { platform, missing[], autoPost } — what's blocking Autopilot
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
  const loadVideos = useCallback(async () => { const r = await authed('/api/video'); const d = await r.json(); setVideoJobs(d.jobs || []) }, [authed])
  // In-flight guard: rapid tab toggles must not stack concurrent paid X reads.
  const xStatsBusy = useRef(false)
  const loadXStats = useCallback(async () => {
    if (xStatsBusy.current) return
    xStatsBusy.current = true
    try { const r = await authed('/api/x/stats'); const d = await r.json(); if (d.stats) setXStats(d.stats) }
    catch {} finally { xStatsBusy.current = false }
  }, [authed])
  const loadAgents = useCallback(async () => { const r = await authed('/api/feeder-agents'); const d = await r.json(); setFeederAgents(d.agents || []) }, [authed])
  const loadAgentCamps = useCallback(async () => { const r = await authed('/api/agent-campaigns?metrics=1'); const d = await r.json(); setAgentCampaigns(d.campaigns || []) }, [authed])
  const loadTrends = useCallback(async () => { try { const r = await authed('/api/trends'); const d = await r.json(); setTrends(d.formats || []) } catch {} }, [authed])
  const loadAutopilot = useCallback(async () => { try { const r = await authed('/api/autopilot'); const d = await r.json(); setAutopilot(d.autopilot || []) } catch {} }, [authed])
  const loadInsights = useCallback(async () => { try { const r = await authed('/api/brand-memory'); const d = await r.json(); setInsights(d.insights || []); setInsightsLearnedAt(d.last_learned_at || null) } catch {} }, [authed])
  const loadMedia = useCallback(async () => { try { const r = await authed('/api/media'); const d = await r.json(); setMediaAssets(d.assets || []); setMediaAlbums(d.albums || []) } catch {} }, [authed])

  useEffect(() => { loadQueue(); loadX(); loadLinkedIn(); loadMe(); loadPhotos(); loadEngagement(); loadSocial(); loadSlideshows(); loadSocialEng(); loadBrand(); loadInspoX(); loadClips(); loadVideos(); loadAgents(); loadAgentCamps(); loadTrends(); loadAutopilot(); loadInsights(); loadMedia() }, [loadQueue, loadX, loadLinkedIn, loadMe, loadPhotos, loadEngagement, loadSocial, loadSlideshows, loadSocialEng, loadBrand, loadInspoX, loadClips, loadVideos, loadAgents, loadAgentCamps, loadTrends, loadAutopilot, loadInsights, loadMedia])

  // ── Coordinated state sync ──────────────────────────────────────────────────
  // Every view derives from a shared set of lists. Mutations used to hand-pick
  // which loader to call, so deleting a post (etc.) left badges, counts, agent
  // stats and campaign metrics on OTHER tabs stale — and background cron changes
  // (auto-published posts, agent output) never showed until a manual reload.
  // refreshLive re-pulls everything that changes, and we run it after mutations,
  // on a 20s poll, and whenever the tab regains focus — so the whole app stays
  // consistent no matter where (or what) changed it.
  const refreshLive = useCallback(() => {
    // loadMe carries the headline stats (queued/posted/accounts) shown in the
    // topbar + profile tiles — refresh it too or those numbers go stale while the
    // queue moves under them.
    loadQueue(); loadMe(); loadAutopilot(); loadAgents(); loadAgentCamps(); loadSlideshows(); loadSocialEng(); loadEngagement(); loadClips(); loadVideos(); loadBrand(); loadMedia(); loadSocial(); loadInsights()
  }, [loadQueue, loadMe, loadAutopilot, loadAgents, loadAgentCamps, loadSlideshows, loadSocialEng, loadEngagement, loadClips, loadVideos, loadBrand, loadMedia, loadSocial, loadInsights])
  useEffect(() => {
    const sync = () => { if (document.visibilityState === 'visible') refreshLive() }
    const id = setInterval(sync, 20000)            // background-change safety net
    document.addEventListener('visibilitychange', sync) // instant on tab return
    window.addEventListener('focus', refreshLive)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', sync); window.removeEventListener('focus', refreshLive) }
  }, [refreshLive])

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
  // Fresh-on-view for the social platforms too (X already does, above) — so the
  // follower/post tiles aren't indefinitely stale. loadSocial is stable, so this
  // only fires on a tab change.
  useEffect(() => { if (['instagram', 'tiktok', 'linkedin'].includes(tab)) loadSocial(true) }, [tab, loadSocial])
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
  // The Queue/calendar/tiles show ONLY the active account's posts, per platform,
  // so a previously-connected (or feeder) account's posts never linger in the
  // current account's view and the view updates the moment you switch accounts:
  //  - X      → the post is tied to the PRIMARY connection, or unstamped (unstamped
  //             publishes as the primary). Switch via "Make primary".
  //  - others → the post is tied to a CURRENTLY-connected account for that platform,
  //             or unstamped. A since-disconnected account's posts drop out.
  const liveSocialIds = new Set(socialAccounts.map(a => a.id))
  const ofActiveAccount = p => (p.platform || 'x') === 'x'
    ? (!p.x_connection_id || p.x_connection_id === primaryX?.id)
    : (!p.social_account_id || liveSocialIds.has(p.social_account_id))
  const xCampTargets = primaryX ? [{ kind: 'x', id: primaryX.id, platform: 'x', label: '@' + primaryX.username }] : []
  const liCampTargets = liAccount ? [{ kind: 'social', id: liAccount.id, platform: 'linkedin', label: '@' + (liAccount.username || 'LinkedIn') }] : []

  // Opens a short guide first — X authorizes whichever account is active on x.com,
  // and OAuth 2.0 has no force-login, so we let the user switch accounts before authorizing.
  function connectX() { setXConnect(true) }
  async function startXConnect() { setXConnect(false); const r = await authed('/api/x/connect', { method: 'POST' }); const d = await r.json(); if (d.url) window.location.href = d.url; else setBanner(d.error || 'Could not start X connection.') }
  async function disconnectX(id) { const target = id || xConns[0]?.id; if (!target) return; if (!await askConfirm({ title: 'Disconnect this X account?', body: 'Its scheduled posts will stop publishing.', confirmLabel: 'Disconnect', danger: true })) return; await authed('/api/x/status', { method: 'DELETE', body: JSON.stringify({ id: target }) }); setBanner('Disconnected X account'); loadX() }
  // Switching the active account is switching brand IDENTITY — the new account may
  // be a completely different persona/autopilot/audience. Re-scope the WHOLE app to
  // it, and if it hasn't been set up yet, run its onboarding; otherwise top up its
  // queue so a freshly-switched-to account isn't left under-posted.
  async function afterSwitch(platform, onboarded) {
    refreshLive(); loadX(); loadXStats(); loadLinkedIn() // pull every account-scoped view for the new identity
    if (onboarded === false) {
      setBanner('New account — let’s set up its identity')
      if (platform === 'instagram' || platform === 'tiktok') setSocialOnb(platform)
      else setBrandOnb(platform || 'x')
    } else {
      setBanner('Switched account')
      if (platform === 'x' || platform === 'linkedin') suggestPosts(platform).catch(() => {}) // refill the queue for this account
    }
  }
  async function makePrimary(id) {
    const r = await authed('/api/x/status', { method: 'PATCH', body: JSON.stringify({ id, is_primary: true }) })
    const d = await r.json().catch(() => ({}))
    await afterSwitch('x', d.onboarded)
  }
  async function setActiveSocial(id, platform) {
    const r = await authed('/api/social', { method: 'POST', body: JSON.stringify({ action: 'set-active', id }) })
    const d = await r.json().catch(() => ({}))
    if (d.error) { setBanner(d.error); return }
    await afterSwitch(platform, d.onboarded)
  }

  // "Run now" — trigger one campaign/rule and poll its live status until it
  // finishes, so the user watches it work. The engine writes status_detail at
  // each step; we reload until running flips back to false.
  async function runEngagementNow(id) {
    setBanner('Running engagement…'); loadEngagement()
    const poll = setInterval(loadEngagement, 1400)
    try { await authed('/api/engagement', { method: 'POST', body: JSON.stringify({ action: 'run', id }) }) } finally { clearInterval(poll); loadEngagement(); refreshLive() }
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
  // In-app confirm dialog — promise-based, replaces native window.confirm so
  // every prompt is on-brand. askConfirm({...}) resolves true/false on the tap.
  const [confirmReq, setConfirmReq] = useState(null)
  const confirmResolve = useRef(null)
  const [ssEdit, setSsEdit] = useState(null) // { id, when } — rescheduling a queued carousel
  function askConfirm(opts) {
    return new Promise(resolve => { confirmResolve.current = resolve; setConfirmReq(typeof opts === 'string' ? { body: opts } : opts) })
  }
  function resolveConfirm(v) { setConfirmReq(null); const r = confirmResolve.current; confirmResolve.current = null; r && r(v) }
  useEffect(() => {
    if (!confirmReq) return
    const onKey = e => { if (e.key === 'Escape') resolveConfirm(false); else if (e.key === 'Enter') resolveConfirm(true) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmReq]) // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteEngagement(id) { if (!await askConfirm({ title: 'Delete engagement rule?', body: 'It stops finding and replying to niche posts.', confirmLabel: 'Delete', danger: true })) return; await authed('/api/engagement', { method: 'DELETE', body: JSON.stringify({ id }) }); loadEngagement(); refreshLive() }

  // Feeder agents — payload is either a feeder connection id (X tab shorthand)
  // or a full body ({ social_account_id | x_connection_id, interests, campaign_id }).
  async function spawnAgent(payload, interests) {
    const body = typeof payload === 'string' ? { x_connection_id: payload, interests } : payload
    const r = await authed('/api/feeder-agents', { method: 'POST', body: JSON.stringify(body) })
    const d = await r.json()
    if (d.error) { setBanner(d.error); return false }
    setBanner(`“${d.agent?.name || 'Agent'}” is ready — flip it on when you are`); loadAgents(); loadAgentCamps(); return true
  }
  async function patchAgent(id, patch, note) { await authed('/api/feeder-agents', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) }); if (note) setBanner(note); loadAgents(); refreshLive() }
  async function deleteAgent(id) { if (!await askConfirm({ title: 'Delete agent?', body: 'Its unpublished posts are removed too.', confirmLabel: 'Delete', danger: true })) return; await authed('/api/feeder-agents', { method: 'DELETE', body: JSON.stringify({ id }) }); loadAgents(); refreshLive() }
  async function runAgent(id) {
    setBanner('Agent thinking…'); loadAgents()
    const poll = setInterval(loadAgents, 1500)
    try { await authed('/api/feeder-agents', { method: 'POST', body: JSON.stringify({ action: 'run', id }) }) } finally { clearInterval(poll); loadAgents(); refreshLive() }
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
    setBanner('Campaign created — deploy agents to it'); loadAgentCamps(); return d.campaign || null
  }
  // Spin up a whole fleet at once (company onboarding): batch-create typed agents
  // on the chosen accounts, all assigned to the campaign.
  async function spawnFleet(body) {
    const r = await authed('/api/feeder-agents', { method: 'POST', body: JSON.stringify({ action: 'spawn_fleet', ...body }) })
    const d = await r.json()
    if (d.error) { setBanner(d.error); return false }
    setBanner(`Fleet spun up — ${d.created || 0} agent${d.created === 1 ? '' : 's'} ready${d.errors?.length ? ` (${d.errors.length} skipped)` : ''}`)
    loadAgents(); loadAgentCamps(); return true
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
    try {
      const r = await authed('/api/autopilot', { method: 'POST', body: JSON.stringify({ platform, ...patch }) })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        loadAutopilot() // roll the optimistic toggle back to the server truth
        if (r.status === 422 && d.gate) return handleGateReject(d.gate)
        setBanner(d.error || 'Could not update Autopilot.'); return
      }
      setGateMiss(null); loadAutopilot()
    } catch { loadAutopilot() }
  }
  // Autopilot wasn't ready — route the user to the exact thing that's missing.
  // brief/pillars live in the brand-brief modal; account/voice are external steps
  // (connect, or let Cadence study the account), so for those we just guide.
  function handleGateReject(gate) {
    setGateMiss(gate)
    if (gate.platform === 'instagram' || gate.platform === 'tiktok') {
      setSocialOnb(gate.platform) // the visual MCQ wizard owns IG/TikTok setup
    } else {
      const needsBrief = (gate.missing || []).some(m => m.where === 'brief' || m.where === 'pillars')
      if (needsBrief) setBrandOnb(gate.platform)
    }
    setBanner((gate.missing || []).map(m => m.label).join('   ·   ') || 'Finish setup to turn on Autopilot.')
  }
  // Save the IG/TikTok content plan + enable autopilot (from the MCQ wizard).
  const [socialSaving, setSocialSaving] = useState(false)
  async function saveSocialPlan({ content_plan, cadence }) {
    if (!socialOnb) return
    setSocialSaving(true)
    try {
      const r = await authed('/api/autopilot', { method: 'POST', body: JSON.stringify({ platform: socialOnb, enabled: true, content_plan, ...cadence }) })
      const d = await r.json().catch(() => ({}))
      loadAutopilot()
      if (!r.ok) {
        if (r.status === 422 && d.gate) { setGateMiss(d.gate); setBanner((d.gate.missing || []).map(m => m.label).join('   ·   ')); return }
        setBanner(d.error || 'Could not turn on Autopilot.'); return
      }
      setGateMiss(null); setSocialOnb(null)
      setBanner(`Autopilot on — Cadence is creating ${socialOnb === 'instagram' ? 'Instagram' : 'TikTok'} content for you`)
    } catch { setBanner('Could not save — try again.') } finally { setSocialSaving(false) }
  }
  async function learnNow() {
    setLearning(true)
    try {
      const r = await authed('/api/brand-memory', { method: 'POST', body: JSON.stringify({ action: 'learn' }) })
      const d = await r.json()
      setInsights(d.insights || []); loadInsights()
      const res = d.result || {}
      setBanner(res.learned ? `Learned ${res.learned} insight${res.learned === 1 ? '' : 's'} from your engagement` : (res.skipped === 'not enough signal' ? 'Not enough posted activity yet — post a few and check back.' : 'No new patterns this round.'))
    } catch { setBanner('Could not analyze right now.') } finally { setLearning(false) }
  }
  const brandOnboarded = !!me?.profile?.brand_brief?.positioning
  async function saveBrandBrief({ brief, cadence }) {
    setBrandSaving(true)
    const platform = brandOnb || 'x'
    try {
      await authed('/api/profile', { method: 'PATCH', body: JSON.stringify({ brand_brief: brief }) })
      // brand_brief is also sent to autopilot so it's stored as THIS account's
      // per-account identity (not just the user-level default).
      const r = await authed('/api/autopilot', { method: 'POST', body: JSON.stringify({ platform, enabled: true, brand_brief: brief, ...cadence }) })
      await loadMe(session); loadAutopilot()
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        // Brief is saved; what's left (connect account / learn voice) can't be done
        // in this modal — close it and guide to the next step.
        if (r.status === 422 && d.gate) { setBrandOnb(null); setGateMiss(d.gate); setBanner((d.gate.missing || []).map(m => m.label).join('   ·   ')); return }
        setBanner(d.error || 'Could not turn on Autopilot.'); return
      }
      setGateMiss(null)
      setBanner(`Autopilot on — Cadence is running your ${platform === 'linkedin' ? 'LinkedIn' : 'X'} in your voice`)
      setBrandOnb(null)
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
    const n = feederAgents.filter(a => (a.campaign_ids || []).includes(id)).length
    if (!await askConfirm({ title: 'End this campaign?', body: `${n ? `${n} agent${n === 1 ? '' : 's'} will be released from it. ` : ''}Its posts + performance history are kept.`, confirmLabel: 'End campaign', danger: true })) return
    await authed('/api/agent-campaigns', { method: 'DELETE', body: JSON.stringify({ id }) }); loadAgentCamps(); loadAgents()
  }
  // Many-to-many assignment: an agent can be on several campaigns.
  async function assignAgents(campaignId, agentIds) { await authed('/api/agent-campaigns', { method: 'POST', body: JSON.stringify({ action: 'assign', campaign_id: campaignId, agent_ids: agentIds }) }); loadAgents(); loadAgentCamps() }
  async function unassignAgent(campaignId, agentId) { await authed('/api/agent-campaigns', { method: 'POST', body: JSON.stringify({ action: 'unassign', campaign_id: campaignId, agent_id: agentId }) }); loadAgents(); loadAgentCamps() }

  // Social (Instagram/TikTok/LinkedIn via Zernio)
  async function connectSocial(platform) {
    const r = await authed('/api/social', { method: 'POST', body: JSON.stringify({ action: 'connect', platform }) })
    const d = await r.json()
    if (d.authUrl) { window.location.href = d.authUrl } // full-page redirect; Zernio returns the user to /?connected=<platform>
    else setBanner(d.error || 'Could not start connection')
  }
  async function syncSocial() { setBanner('Refreshing connected accounts…'); await loadSocial(true) }
  async function disconnectSocial(id) {
    if (!await askConfirm({ title: 'Disconnect account?', body: 'Its scheduled posts will stop publishing.', confirmLabel: 'Disconnect', danger: true })) return
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
    if (d.error) setBanner(d.error); else { setBanner(`${d.posts?.length || 0} ${platform === 'x' ? 'X' : 'LinkedIn'} posts ready to approve`); refreshLive() }
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
  async function deleteClipJob(id) { if (!await askConfirm({ title: 'Delete clip job?', body: 'This removes the job and its rendered clips.', confirmLabel: 'Delete', danger: true })) return; await authed('/api/clips', { method: 'DELETE', body: JSON.stringify({ id }) }); loadClips() }
  async function postClip(job_id, clip_index, account_ids, caption) {
    setBanner('Posting clip…')
    const r = await authed('/api/clips', { method: 'POST', body: JSON.stringify({ action: 'post', job_id, clip_index, account_ids, caption }) }); const d = await r.json()
    setBanner(d.error || 'Clip posted')
  }
  async function deleteVideo(id) { if (!await askConfirm({ title: 'Delete video?', confirmLabel: 'Delete', danger: true })) return; await authed('/api/video', { method: 'DELETE', body: JSON.stringify({ id }) }); loadVideos() }
  async function postVideo(job_id, account_ids, caption) {
    setBanner('Posting video…')
    const r = await authed('/api/video', { method: 'POST', body: JSON.stringify({ action: 'post', job_id, account_ids, caption }) }); const d = await r.json()
    setBanner(d.error || 'Video posted')
  }
  async function deleteSlideshow(id) { if (!await askConfirm({ title: 'Delete slideshow?', confirmLabel: 'Delete', danger: true })) return; await authed('/api/slideshow', { method: 'DELETE', body: JSON.stringify({ id }) }); loadSlideshows() }
  async function rescheduleSlideshow(id, whenIso) {
    const r = await authed('/api/slideshow', { method: 'PATCH', body: JSON.stringify({ id, scheduled_for: whenIso }) })
    const d = await r.json()
    if (d.error) setBanner(d.error); else { setBanner('Carousel rescheduled'); setSsEdit(null); loadSlideshows() }
  }
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

  // ── Media library: signed direct-to-storage upload → analyze ────────────────
  function imageDims(file) {
    return new Promise((resolve) => {
      const img = new window.Image(); const url = URL.createObjectURL(file)
      img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
      img.onerror = () => resolve({}); img.src = url
    })
  }
  async function uploadMedia(file, albumId) {
    if (!file) return
    if (file.size > 200 * 1024 * 1024) { setBanner('Files up to 200MB.'); return }
    let width, height
    if (file.type.startsWith('image')) { const d = await imageDims(file); width = d.w; height = d.h }
    const r = await authed('/api/media', { method: 'POST', body: JSON.stringify({ action: 'sign', filename: file.name, mime: file.type, size: file.size, album_id: albumId || null, width, height }) })
    const d = await r.json()
    if (d.error) { setBanner(d.error); return }
    const { error } = await supabase.storage.from('media').uploadToSignedUrl(d.upload.path, d.upload.token, file)
    if (error) { setBanner('Upload failed — ' + error.message); return }
    await authed('/api/media', { method: 'POST', body: JSON.stringify({ action: 'uploaded', id: d.asset.id, width, height }) })
    loadMedia()
  }
  async function createAlbum(name) { const r = await authed('/api/media', { method: 'POST', body: JSON.stringify({ action: 'album', name }) }); const d = await r.json(); if (d.error) setBanner(d.error); else loadMedia(); return !d.error }
  async function deleteAlbum(id) { if (!await askConfirm({ title: 'Delete album?', body: 'The media inside is kept — just un-filed.', confirmLabel: 'Delete', danger: true })) return; await authed('/api/media', { method: 'DELETE', body: JSON.stringify({ albumId: id }) }); loadMedia() }
  async function moveAssets(ids, albumId) { await authed('/api/media', { method: 'PATCH', body: JSON.stringify({ ids, album_id: albumId }) }); loadMedia() }
  async function deleteAsset(id) { await authed('/api/media', { method: 'DELETE', body: JSON.stringify({ id }) }); loadMedia() }
  async function favoriteAsset(id, favorite) {
    setMediaAssets(list => list.map(a => a.id === id ? { ...a, is_favorite: favorite } : a)) // optimistic
    await authed('/api/media', { method: 'PATCH', body: JSON.stringify({ id, favorite }) }); loadMedia()
  }

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
  function openSchedule(p) { const plat = p.platform || 'x'; setCompose({ mode: p.status === 'draft' ? 'draft' : 'edit', id: p.id, platform: plat, content: p.content, when: toLocalInput(new Date(p.scheduled_for)), imgOn: !!p.image_url, img: p.image_url || '', connId: plat === 'x' ? (p.x_connection_id || xConns[0]?.id || '') : '', personal: false }) }
  async function saveEdit(id, content) { await authed('/api/posts', { method: 'PATCH', body: JSON.stringify({ id, content }) }); refreshLive() }
  async function pausePost(id) { await authed('/api/posts', { method: 'PATCH', body: JSON.stringify({ id, status: 'paused' }) }); setBanner('Held — it won’t go out until you resume it'); refreshLive() }
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
      setCompose(null); refreshLive()
    } finally { setComposeBusy(false) }
  }
  async function delPost(id) { if (!await askConfirm({ title: 'Delete post?', confirmLabel: 'Delete', danger: true })) return; await authed('/api/posts', { method: 'DELETE', body: JSON.stringify({ id }) }); refreshLive() }
  async function postNow(id) {
    setBanner('Posting…')
    const r = await authed('/api/posts', { method: 'POST', body: JSON.stringify({ id, action: 'post_now' }) }); const d = await r.json()
    setBanner(d.status === 'posted' ? `Posted as @${d.as}` : `Failed: ${d.error || 'error'}`); refreshLive(); if (d.reconnect) loadX()
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

  // Run one agent turn over a given history (no new user message appended here);
  // shared by send (after appending the user turn) and regenerate (which replays
  // the last user turn). `opts` carries the Studio create-context.
  async function runTurn(history, opts = null) {
    setLoading(true)
    try {
      const body = {
        messages: history.slice(-40), platforms: chatScope,
        // Always pass a (possibly minimal) studio context — the chat IS the Studio.
        studio: {
          format: opts?.format || 'auto',
          captions: opts ? opts.captions !== false : true,
          attachments: (opts?.attachments || []).map(a => ({ id: a.id, type: a.type, url: a.url, filename: a.filename })),
        },
      }
      const res = await authed('/api/chat', { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      const proposals = Array.isArray(data.proposals) ? data.proposals : (data.proposal ? [data.proposal] : [])
      const withReply = [...history, { role: 'assistant', content: data.reply, proposals }]
      setMessages(withReply); saveChat(withReply); refreshLive()
    }
    catch (e) { setMessages(p => [...p, { role: 'assistant', content: '⚠️ ' + e.message }]) } finally { setLoading(false) }
  }
  async function send(text, opts = null) {
    const t = (text ?? input).trim(); if (!t || loading) return
    setInput(''); const next = [...messages, { role: 'user', content: t }]; setMessages(next)
    await runTurn(next, opts)
  }
  // Re-run the latest exchange: drop the last assistant reply, replay from the
  // last user message. Non-destructive to earlier turns.
  async function regenerate() {
    if (loading) return
    const li = messages.map(m => m.role).lastIndexOf('user'); if (li < 0) return
    const base = messages.slice(0, li + 1); setMessages(base)
    await runTurn(base, null)
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

      <div className="shell">
        {/* Side menu (Opus-Clip style): create-first, channels demoted below. */}
        <nav className="side">
          <div className="side-group">
            {[['studio', 'Create', Sparkles], ['projects', 'Projects', LGrid], ['queue', 'Queue', LList], ['campaigns', 'Campaigns', Bot], ['library', 'Library', FolderOpen]].map(([t, l, Ic]) => (
              <button key={t} onClick={() => setTab(t)} className={'side-btn' + (tab === t ? ' on' : '')}>
                <Ic size={16} /><span>{l}</span>
              </button>
            ))}
          </div>
          <div className="side-label">Channels</div>
          <div className="side-group">
            {['x', 'linkedin', 'instagram', 'tiktok'].map(t => (
              <button key={t} onClick={() => setTab(t)} className={'side-btn side-chan' + (tab === t ? ' on' : '')}>
                <span className="side-glyph">{PLATFORM_GLYPH[t]}</span>
                <span>{({ x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' })[t]}</span>
              </button>
            ))}
          </div>
        </nav>

        <section className={'work' + (['x', 'linkedin', 'instagram', 'tiktok'].includes(tab) ? ` plat-${tab}` : '')}>
          <div className="work-head">
            <span className="work-title">{({ studio: 'Studio', projects: 'Projects', queue: 'Queue', campaigns: 'Campaigns', library: 'Library', x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' })[tab]}</span>
            {tab === 'studio' && (
              <div className="row" style={{ gap: 6, position: 'relative' }}>
                <button className="mini" onClick={() => { if (!historyOpen) loadChats(); setHistoryOpen(o => !o) }} title="Previous chats"><LHistory size={12} /> History</button>
                <button className="mini" onClick={newChat} title="Start a new chat"><Plus size={12} /> New</button>
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
            )}
            {tab === 'queue' && <motion.button className="btn-primary btn-sm row" style={{ gap: 5 }} onClick={openNew} whileTap={{ scale: 0.96 }}><Plus size={14} /> New post</motion.button>}
          </div>

          <div className="scroll-wrap">
            <motion.div key={tab} className="scroll" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>

              {tab === 'queue' && (() => {
                const matchP = it => (qPlatform === 'all' || (it.platform || 'x') === qPlatform) && ofActiveAccount(it)
                const fQueue = queue.filter(matchP)
                // Scheduled/posted carousels live in the slideshows table (Zernio
                // publishes them on its own clock) — surface them in the queue +
                // calendar. Their platform comes from the accounts they target.
                const acctPlat = id => socialAccounts.find(a => a.id === id)?.platform
                const ssPlatforms = s => [...new Set((s.account_ids || []).map(acctPlat).filter(Boolean))]
                const schedShows = slideshows
                  .filter(s => ['scheduled', 'posting', 'posted', 'failed'].includes(s.status))
                  .map(s => ({ ...s, _platforms: ssPlatforms(s) }))
                  .filter(s => qPlatform === 'all' || s._platforms.includes(qPlatform))
                const ssAsPosts = schedShows.map(s => ({
                  id: 'ss-' + s.id, _ss: true, status: s.status,
                  // Always carry a real date so the calendar chip never renders epoch.
                  scheduled_for: s.scheduled_for || s.created_at, posted_at: s.status === 'posted' ? (s.scheduled_for || s.created_at) : null,
                  platform: s._platforms[0] || 'instagram', content: s.title || s.topic, image_urls: s.image_urls,
                }))
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
                    ? <QueueCalendar posts={[...shown, ...posted.filter(matchP), ...ssAsPosts]} onOpen={openSchedule} onPostNow={postNow} onDelete={delPost} />
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
                  {schedShows.map(s => {
                    const canEdit = s.status === 'scheduled' && !s.zernio_post_id // local (cron-dispatched) → re-timeable
                    const editing = ssEdit?.id === s.id
                    return (
                    <div className="card camp-card" key={s.id}>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="row" style={{ gap: 3, flex: 'none' }}>{(s._platforms?.length ? s._platforms : [null]).map((pl, k) => <span key={k} className="status-dot" style={{ background: platformDot(pl) }} />)}</span>
                        {s.image_urls?.[0] && <img src={s.image_urls[0]} className="ss-thumb" alt="" />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="conn-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleOf(s.title || s.topic)}</div>
                          <div className="muted tiny" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.status === 'failed' ? <span style={{ color: '#B3372F' }}>Failed — {s.error || 'see Slideshows'} · </span> : s.status === 'posting' ? 'Posting · ' : ''}{s.image_urls?.length || 0} slides · {s._platforms?.length ? s._platforms.join(', ') : 'carousel'} · {s.scheduled_for ? fmt(s.scheduled_for) : s.style}</div>
                        </div>
                        {canEdit && <button className="mini" onClick={() => editing ? setSsEdit(null) : setSsEdit({ id: s.id, when: toLocalInput(new Date(s.scheduled_for)) })}><Clock size={12} /> {editing ? 'Close' : 'Reschedule'}</button>}
                        {s.status !== 'posted' && <button className="mini danger" onClick={() => deleteSlideshow(s.id)}><Trash2 size={12} /></button>}
                      </div>
                      <AnimatePresence initial={false}>
                        {editing && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
                            <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                              <input type="datetime-local" className="field dt" value={ssEdit.when} onChange={e => setSsEdit(p => ({ ...p, when: e.target.value }))} />
                              <button className="btn-primary btn-sm" disabled={!ssEdit.when} onClick={() => rescheduleSlideshow(s.id, new Date(ssEdit.when).toISOString())}>Save time</button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )})}
                  {posted.filter(matchP).length > 0 && <PostedSection posted={posted.filter(matchP)} />}
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
                      { value: fmtNum(queue.filter(p => (p.platform || 'x') === 'x' && ofActiveAccount(p)).length), label: 'Queued' },
                    ]} />
                  </div>
                ) : (<>
                  <BrainBanner theme="x" />
                  <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', margin: '8px 0 14px' }} onClick={connectX}><XGlyph /> Connect your X account</button>
                </>)}
                {xConns.some(c => c.needs_reconnect) && <div className="notice" style={{ color: '#8A6200', margin: '4px 0 10px' }}>An X account needs reconnecting — open accounts (bottom-right).</div>}

                {(() => {
                  const ap = apFor('x')
                  // LIVE count from the shared queue (never a stale snapshot string)
                  const xQueued = posts.filter(p => (p.platform || 'x') === 'x' && ['queued', 'posting'].includes(p.status) && ofActiveAccount(p)).length
                  const arOn = !!engSettings.find(s => s.platform === 'x')?.enabled
                  const engRule = engRules.find(r => r.active) || engRules[0]
                  const liveCamps = campsTouching(['x']).filter(c => c.active).length
                  function engToggle(v) {
                    if (v) { engRule?.id ? patchEngagement(engRule.id, { active: true, auto_post: true, interval_hours: 0.33 }) : saveEngagement({ comment_styles: ['add_value'], connection_ids: primaryX ? [primaryX.id] : [], interval_hours: 0.33, replies_per_run: 4, auto_post: true, active: true }) }
                    else if (engRule?.id) patchEngagement(engRule.id, { active: false })
                  }
                  return (<>
                    {/* Campaigns — the headline feature, open by default */}
                    <Section title="Campaigns" defaultOpen badge={liveCamps ? <span className="live-pill on"><span className="pulse" />{liveCamps} live</span> : null}>
                      <PlatformCampaign campaigns={campsFor(['x'])} targets={xCampTargets} allowImage canCreate={connected} connectHint="Connect your X account first." onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
                      <CrossCampHint plats={['x']} />
                    </Section>

                    {/* Autopilot — hands-free; toggle gated behind brand onboarding */}
                    <Section title="Autopilot" hint="run your account hands-free" badge={ap.enabled ? <span className="muted tiny">{ap.running ? 'writing…' : `${xQueued} queued`}</span> : null}
                      toggle={{ on: ap.enabled, onChange: v => { if (v && !brandOnboarded) setBrandOnb('x'); else patchAutopilot('x', { enabled: v }) } }}>
                      <AutopilotBody row={ap} onToggle={patch => patchAutopilot('x', patch)} onEditBrief={() => setBrandOnb('x')} />
                    </Section>

                    {/* What Cadence has learned — durable brand memory from real engagement */}
                    <Section title="What's working" hint="learned from your engagement" badge={insights.filter(i => !i.platform || i.platform === 'x').length ? <span className="muted tiny">{insights.filter(i => !i.platform || i.platform === 'x').length}</span> : null}>
                      <InsightsPanel insights={insights} platform="x" learnedAt={insightsLearnedAt} learning={learning} onLearn={learnNow} />
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
                    <Section title="Ready to post" defaultOpen={xDrafts.length > 0} badge={xDrafts.length ? <span className="camp-state on">{xDrafts.length}</span> : null}>
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
                // Scope counts to THIS platform's CURRENTLY-connected accounts — a post
                // tied to a since-disconnected account (or to no account) must not
                // inflate a freshly-connected account's stats.
                const platAcctIds = new Set(platAccts.map(a => a.id))
                const mine = p => platAcctIds.has(p.social_account_id)
                // "Posted" = the account's REAL all-time post count (Zernio
                // mediaCount/videoCount); fall back to Cadence posts FOR THIS ACCOUNT.
                const realPosted = platAccts.reduce((n, a) => n + (a.posts_count || 0), 0)
                const platPosted = realPosted || posts.filter(p => p.platform === plat && p.status === 'posted' && mine(p)).length
                const platQueued = posts.filter(p => p.platform === plat && ['queued', 'posting'].includes(p.status) && mine(p)).length
                return (<>
                  <BrainBanner theme={plat} />
                  {platAccts.length ? (
                    <StatTiles tiles={[
                      { value: platAccts.some(a => a.followers != null) ? fmtNum(followers) : '—', label: 'Followers' },
                      { value: platPosted ? fmtNum(platPosted) : '—', label: 'Posted' },
                      { value: fmtNum(platQueued), label: 'Queued' },
                    ]} />
                  ) : (
                    <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', margin: '8px 0 14px' }} disabled={!socialConfigured} onClick={() => connectSocial(plat)}>{plat === 'instagram' ? <IGGlyph size={15} /> : <TTGlyph size={15} />} Connect {platLabel}</button>
                  )}
                  {!socialConfigured && <div className="notice" style={{ margin: '0 0 10px' }}>Connect Zernio to post — previews work now.</div>}

                  {(() => {
                    const ap = apFor(plat)
                    const hasPlan = !!(ap.content_plan && (ap.content_plan.formats || []).length)
                    return (
                      <div style={{ marginTop: 4, marginBottom: 14 }}>
                        <Section title="Autopilot" hint={`make + post ${plat === 'instagram' ? 'Reels & carousels' : 'clips & carousels'} for you`}
                          badge={ap.enabled ? <span className="muted tiny">{ap.running ? 'creating…' : `${platQueued} queued`}</span> : null}
                          toggle={{ on: ap.enabled, onChange: v => { if (v && !hasPlan) setSocialOnb(plat); else patchAutopilot(plat, { enabled: v }) } }}>
                          {hasPlan
                            ? <SocialAutopilotBody row={ap} onToggle={patch => patchAutopilot(plat, patch)} onEditPlan={() => setSocialOnb(plat)} />
                            : <div className="muted tiny">Flip this on and Cadence will run a thorough 4-step setup, then start making {plat === 'instagram' ? 'carousels, talking-head videos & clips' : 'clips, talking-head videos & carousels'} in your niche — posted for you or queued for review.</div>}
                        </Section>
                      </div>
                    )
                  })()}

                  {(() => {
                    const igItems = posts.filter(p => p.platform === plat && p.source === 'autopilot' && ['draft', 'rendering', 'failed'].includes(p.status) && (mine(p) || !p.social_account_id))
                      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 12)
                    if (!apFor(plat).enabled && !igItems.length) return null
                    return (
                      <div style={{ marginTop: 14 }}>
                        <Section title="Ready to post" hint="autopilot output — approve or skip" defaultOpen={igItems.some(p => p.status === 'draft')} badge={igItems.filter(p => p.status === 'draft').length ? <span className="camp-state on">{igItems.filter(p => p.status === 'draft').length}</span> : null}>
                          <SocialDrafts items={igItems} onPostNow={postNow} onSchedule={openSchedule} onDiscard={delPost} />
                        </Section>
                      </div>
                    )
                  })()}

                  <div style={{ marginTop: 14 }}>
                    <Section title="What's working" hint="learned from your engagement" badge={insights.filter(i => !i.platform || i.platform === plat).length ? <span className="muted tiny">{insights.filter(i => !i.platform || i.platform === plat).length}</span> : null}>
                      <InsightsPanel insights={insights} platform={plat} learnedAt={insightsLearnedAt} learning={learning} onLearn={learnNow} />
                    </Section>
                    <Section title="Auto-reply" hint="answers comments in your voice" badge={<OnBadge on={engSettings.some(s => s.platform === plat && s.enabled)} />}>
                      <AutoReply platforms={[plat]} settings={engSettings} replies={socialReplies} accounts={socialAccounts} configured={socialConfigured} onToggle={toggleReplies} onRun={runReplies} onPostDraft={postReplyDraft} />
                    </Section>
                    <Section title="Campaign" hint="auto-post carousels & clips on a schedule" badge={<OnBadge on={campsTouching([plat]).some(c => c.active)} />}>
                      <PlatformCampaign campaigns={campsFor([plat])} targets={platCampTargets} supportsCarousel albums={mediaAlbums} canCreate={platCampTargets.length > 0} connectHint={`Connect ${platLabel} first (accounts, bottom-right).`} onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
                      <CrossCampHint plats={[plat]} />
                    </Section>
                    {/* "What's working now" panel removed per user — the niche
                        scrape still runs (daily harvest cron + find_trends chat
                        tool) and silently feeds generation via trendingBlock. */}
                  </div>
                </>)
              })()}

              {/* LinkedIn — same shape as X: stats, ready-to-post, replies, and a
                  campaign for your personal account. Connect + voice-source +
                  inspiration live in the floating accounts dot, bottom-right. */}
              {/* LinkedIn — mirrors the X tab: brain + stats header, then
                  collapsible Campaigns / Autopilot / Auto-reply / Ready-to-post.
                  No niche-engage (LinkedIn's API can't reply on others' posts). */}
              {tab === 'linkedin' && (() => {
                const ap = apFor('linkedin')
                const arOn = !!engSettings.find(s => s.platform === 'linkedin')?.enabled
                const liLive = campsTouching(['linkedin']).filter(c => c.active).length
                // LinkedIn all-time "Posted": Zernio gives no post count, so use
                // the scraped own-profile post count (Apify), not just Cadence posts.
                const liSelfIds = new Set(liSelf.map(s => s.id))
                const liScraped = liPosts.filter(p => liSelfIds.has(p.account_id)).length
                const liPosted = liScraped || posts.filter(p => p.platform === 'linkedin' && p.status === 'posted').length
                // The scrape is capped (max_posts), so a full scrape means "≥ N".
                const liAtCap = liScraped > 0 && liScraped >= (liSelf[0]?.max_posts || Infinity)
                return (<>
                  {liAccount ? (
                    <div className="phead">
                      <div className="phead-brain"><BrainBanner theme="linkedin" /></div>
                      <StatTiles vertical tiles={[
                        { value: liAccount.followers != null ? fmtNum(liAccount.followers) : '—', label: 'Followers' },
                        { value: liPosted ? fmtNum(liPosted) + (liAtCap ? '+' : '') : '—', label: 'Posted' },
                        { value: fmtNum(queue.filter(p => p.platform === 'linkedin').length), label: 'Queued' },
                      ]} />
                    </div>
                  ) : (<>
                    <BrainBanner theme="linkedin" />
                    <button className="btn-ghost row" style={{ gap: 7, width: '100%', justifyContent: 'center', margin: '8px 0 14px' }} disabled={!socialConfigured} onClick={() => connectSocial('linkedin')}><LIcon size={15} /> Connect LinkedIn</button>
                  </>)}

                  <Section title="Campaigns" defaultOpen badge={liLive ? <span className="live-pill on"><span className="pulse" />{liLive} live</span> : null}>
                    <PlatformCampaign campaigns={campsFor(['linkedin'])} targets={liCampTargets} canCreate={!!liAccount} connectHint="Connect LinkedIn first (accounts, bottom-right)." onSave={saveBrand} onPatch={patchBrand} onDelete={deleteBrand} onRun={runBrand} />
                    <CrossCampHint plats={['linkedin']} />
                  </Section>

                  <Section title="Autopilot" hint="run your account hands-free" badge={ap.enabled ? <span className="muted tiny">{ap.running ? 'writing…' : `${queue.filter(p => p.platform === 'linkedin' && ['queued', 'posting'].includes(p.status)).length} queued`}</span> : null}
                    toggle={{ on: ap.enabled, onChange: v => { if (v && !brandOnboarded) setBrandOnb('linkedin'); else patchAutopilot('linkedin', { enabled: v }) } }}>
                    <AutopilotBody row={ap} onToggle={patch => patchAutopilot('linkedin', patch)} onEditBrief={() => setBrandOnb('linkedin')} />
                  </Section>

                  <Section title="What's working" hint="learned from your engagement" badge={insights.filter(i => !i.platform || i.platform === 'linkedin').length ? <span className="muted tiny">{insights.filter(i => !i.platform || i.platform === 'linkedin').length}</span> : null}>
                    <InsightsPanel insights={insights} platform="linkedin" learnedAt={insightsLearnedAt} learning={learning} onLearn={learnNow} />
                  </Section>

                  <Section title="Auto-reply" hint="reply to comments on your posts" badge={<OnBadge on={engSettings.some(s => s.platform === 'linkedin' && s.enabled)} />}>
                    <AutoReply platforms={['linkedin']} settings={engSettings} replies={socialReplies} accounts={socialAccounts} configured={socialConfigured} onToggle={toggleReplies} onRun={runReplies} onPostDraft={postReplyDraft} />
                  </Section>

                  <Section title="Ready to post" defaultOpen={liDrafts.length > 0} badge={liDrafts.length ? <span className="camp-state on">{liDrafts.length}</span> : null}>
                    <Suggestions platform="linkedin" drafts={liDrafts} busy={suggesting === 'linkedin'} canPost={!!liAccount}
                      onGenerate={() => suggestPosts('linkedin')} onPostNow={postNow} onSchedule={scheduleLinkedInDraft} onDiscard={delPost} />
                  </Section>
                </>)
              })()}

              {/* Campaigns — purely cross-platform. One topic, every account,
                  the right format per platform, in one voice. */}
              {tab === 'campaigns' && (<>
                <BrainBanner theme="campaigns" />
                <AgentFleet agents={feederAgents} xConns={xConns} socialAccounts={socialAccounts} posts={posts} onOpen={setAgentProfileId} />
                <div className="muted tiny" style={{ margin: '0 2px 12px' }}>Missions for your agents. Pick something to promote, deploy agents across platforms — each one works it into its own posting, in its own voice.</div>
                <AgentCampaigns campaigns={agentCampaigns} agents={feederAgents} xConns={xConns} socialAccounts={socialAccounts} posts={posts}
                  onSaveCamp={saveAgentCamp} onPatchCamp={patchAgentCamp} onDeleteCamp={deleteAgentCamp} onDraftCamp={draftAgentCamp}
                  onAssign={assignAgents} onUnassign={unassignAgent}
                  onSpawn={spawnAgent} onSpawnFleet={spawnFleet} onPatchAgent={patchAgent} onRunAgent={runAgent} onOpenAgent={setAgentProfileId} />
              </>)}

              {/* STUDIO = the one chat. Describe anything (carousel, clip, video,
                  post) and it makes it inline; pick where to post on the result. */}
              {tab === 'studio' && (
                <StudioComposer library={mediaAssets} messages={messages} busy={loading} onSend={send} onResolve={resolveProposal} onRegenerate={regenerate}
                  authed={authed} socialAccounts={socialAccounts} connected={connected} xConns={xConns} hasPhotos={hasPhotos}
                  refreshLive={refreshLive} defaultHour={defaultHour} scope={chatScope} onToggleScope={toggleScope} />
              )}
              {tab === 'projects' && (
                <Projects slideshows={slideshows} clipJobs={clipJobs} videoJobs={videoJobs} socialAccounts={socialAccounts} authed={authed}
                  onDeleteSlideshow={deleteSlideshow} onDeleteClip={deleteClipJob} onDeleteVideo={deleteVideo}
                  onPostClip={postClip} onPostVideo={postVideo} onReloadSlideshows={loadSlideshows} onReloadVideos={loadVideos} onGoCreate={() => setTab('studio')} />
              )}
              {tab === 'library' && (
                <MediaLibrary assets={mediaAssets} albums={mediaAlbums} onUpload={uploadMedia} onCreateAlbum={createAlbum} onDeleteAlbum={deleteAlbum} onMove={moveAssets} onDelete={deleteAsset} onFavorite={favoriteAsset} onUseIn={() => setTab('studio')} />
              )}

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
                <AccountRow key={a.id} platform="linkedin" title={a.username || 'LinkedIn'} subtitle={a.active ? 'active — publishes your posts' : 'connected'}
                  actions={<>
                    {a.active ? <span className="role-badge primary"><Star size={9} fill="currentColor" /> Active</span> : <button className="mini" onClick={() => setActiveSocial(a.id, 'linkedin')}>Set active</button>}
                    <button className="mini danger" onClick={() => disconnectSocial(a.id)}>Disconnect</button>
                  </>} />
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
                <AccountRow key={a.id} platform={a.platform} title={a.username || a.platform} subtitle={`${a.followers != null ? `${fmtNum(a.followers)} followers` : 'connected'}${a.active ? ' · active' : ''}`}
                  actions={<>
                    {a.active ? <span className="role-badge primary"><Star size={9} fill="currentColor" /> Active</span> : <button className="mini" onClick={() => setActiveSocial(a.id, tab)}>Set active</button>}
                    <button className="mini danger" onClick={() => disconnectSocial(a.id)}>Disconnect</button>
                  </>} />
              ))}
              <ConnectBtn disabled={!socialConfigured} onClick={() => connectSocial(tab)} title={!socialConfigured ? 'Publishing not configured yet' : ''}>Connect {tab === 'instagram' ? 'Instagram' : 'TikTok'}</ConnectBtn>
            </FloatingAccounts>
          )}
        </section>
      </div>

      {/* brand onboarding — required before Autopilot speaks for you */}
      <AnimatePresence>
        {brandOnb && <BrandOnboarding platform={brandOnb} initial={{ ...(me?.profile?.brand_brief || {}), ...apFor(brandOnb) }} missing={gateMiss?.platform === brandOnb ? gateMiss.missing : null} busy={brandSaving} onSave={saveBrandBrief} onClose={() => setBrandOnb(null)} />}
        {socialOnb && <SocialAutopilotOnboarding platform={socialOnb} initial={{ ...(apFor(socialOnb).content_plan || {}), per_run: apFor(socialOnb).per_run, interval_hours: apFor(socialOnb).interval_hours }} photos={photos} missing={gateMiss?.platform === socialOnb ? gateMiss.missing : null} busy={socialSaving} onSave={saveSocialPlan} onClose={() => setSocialOnb(null)} onUploadPhoto={uploadPhoto} />}
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

      {/* in-app confirm dialog (replaces native window.confirm) */}
      <AnimatePresence>
        {confirmReq && (
          <motion.div className="overlay" style={{ zIndex: 90 }} onClick={() => resolveConfirm(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="card modal confirm-modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }} transition={spring}>
              <div className="confirm-title">{confirmReq.title || 'Are you sure?'}</div>
              {confirmReq.body && <div className="confirm-body">{confirmReq.body}</div>}
              <div className="confirm-actions">
                <button className="btn-ghost btn-sm" onClick={() => resolveConfirm(false)}>Cancel</button>
                <button className={'btn-sm ' + (confirmReq.danger ? 'btn-danger' : 'btn-primary')} autoFocus onClick={() => resolveConfirm(true)}>{confirmReq.confirmLabel || 'Confirm'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
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
              {(compose.platform || 'x') === 'x' && xConns.length > 1 && (
                <select className="field dp-acct" style={{ marginTop: 10 }} value={compose.connId || ''} onChange={e => setCompose(c => ({ ...c, connId: e.target.value }))}>
                  {xConns.map(c => <option key={c.id} value={c.id}>Post as @{c.username}</option>)}
                </select>
              )}
              {(() => {
                // Post-now needs a connected account for THIS post's platform —
                // X uses the X connection; the rest use a social_accounts row.
                const cp = compose.platform || 'x'
                const hasAcct = cp === 'x' ? connected : socialAccounts.some(a => a.platform === cp)
                const plLabel = cp === 'x' ? 'X' : (PLATFORMS.find(p => p.key === cp)?.label || cp)
                return (
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
                    <input type="datetime-local" className="field dt" value={compose.when} onChange={e => setCompose(c => ({ ...c, when: e.target.value }))} />
                    <div className="row" style={{ gap: 10 }}>
                      <button className="btn-ghost" disabled={composeBusy} onClick={() => saveCompose(false)}>Schedule</button>
                      <motion.button className="btn-primary" whileTap={{ scale: 0.97 }} disabled={composeBusy || !hasAcct || (compose.content || '').length > capFor(compose) || !(compose.content || '').trim()} onClick={() => saveCompose(true)} title={hasAcct ? '' : `Connect ${plLabel} first`}>{composeBusy ? <span className="dots"><i/><i/><i/></span> : 'Post now'}</motion.button>
                    </div>
                  </div>
                )
              })()}
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
/* Opus-Clip shell: side menu + single work pane */
.shell { display: flex; flex: 1; overflow: hidden; }
.side { flex: none; width: 212px; display: flex; flex-direction: column; gap: 2px; padding: 14px 12px; border-right: 1px solid var(--line); overflow-y: auto; background: var(--bg); }
.side-group { display: flex; flex-direction: column; gap: 2px; }
.side-label { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); padding: 18px 10px 6px; }
.side-btn { display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: 9px; border: none; background: none; cursor: pointer; font-family: inherit; font-size: 13.5px; font-weight: 600; color: var(--body); text-align: left; transition: background .12s, color .12s; }
.side-btn:hover { background: var(--bg2); }
.side-btn.on { background: var(--accent-soft); color: var(--accent-text); }
.side-btn svg { flex: none; }
.side-chan { font-weight: 500; font-size: 13px; color: var(--muted); }
.side-glyph { width: 16px; display: inline-flex; align-items: center; justify-content: center; }
.side-glyph svg { width: 14px; height: 14px; }
.work { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.work-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 13px 18px 9px; min-height: 30px; position: relative; }
.work-title { font-size: 15px; font-weight: 800; letter-spacing: -.01em; color: var(--ink); }
.sc-focus { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 9px 2px 0; margin-top: 9px; border-top: 1px solid var(--line); }
.sc-focus-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line2); background: var(--surface); color: var(--muted); cursor: pointer; font-family: inherit; }
.sc-focus-chip:hover { border-color: var(--line-hover); }
.sc-focus-chip.on { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent-text); }
@media (max-width: 760px) {
  .shell { flex-direction: column; }
  .side { width: 100%; flex-direction: row; overflow-x: auto; overflow-y: hidden; border-right: none; border-bottom: 1px solid var(--line); padding: 8px 10px; gap: 4px; align-items: center; }
  .side-group { flex-direction: row; gap: 4px; flex: none; }
  .side-label { display: none; }
  .side-btn { padding: 7px 10px; white-space: nowrap; }
}
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
.bubble.assistant { white-space: normal; }
/* chat markdown */
.mb-p { margin: 0; }
.mb-p + .mb-p { margin-top: 7px; }
.mb-gap { height: 7px; }
.mb-li { display: flex; gap: 8px; margin-top: 4px; }
.mb-dot { color: var(--accent); flex: none; }
.mb-link { color: var(--accent-text); text-decoration: underline; text-underline-offset: 2px; font-weight: 600; overflow-wrap: anywhere; }
.mb-link:hover { color: var(--accent-deep); }
.mb-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; background: var(--bg2); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; }
/* per-message actions (copy / retry) */
.msg-actions { display: flex; gap: 4px; margin-top: 2px; opacity: 0; transition: opacity .12s; }
.msg:hover .msg-actions, .msg-actions:focus-within { opacity: 1; }
.msg-act { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; color: var(--muted); background: none; border: none; border-radius: 7px; padding: 4px 7px; cursor: pointer; font-family: inherit; }
.msg-act:hover { background: var(--bg2); color: var(--ink); }
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
.confirm-modal { max-width: 360px; width: 100%; padding: 22px; }
.confirm-title { font-weight: 700; font-size: 16px; color: var(--ink); }
.confirm-body { font-size: 13.5px; color: var(--muted); line-height: 1.5; margin-top: 7px; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.btn-danger { background: #C0392B; color: #fff; border: none; border-radius: 9px; padding: 8px 16px; font-weight: 600; cursor: pointer; transition: background .15s; }
.btn-danger:hover { background: #A93226; }
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
.mp-video { width: 100%; max-height: 340px; border-radius: 10px; background: #000; border: 1px solid var(--line); margin-bottom: 8px; }
.mp-accts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.mp-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); font-size: 12.5px; color: var(--ink); cursor: pointer; transition: all .15s; }
.mp-chip:hover { border-color: var(--accent); }
.mp-chip.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.mp-chip.on .status-dot { box-shadow: 0 0 0 2px rgba(255,255,255,.6); }
.se-wrap { margin-bottom: 8px; }
.se-thumb { position: relative; flex: none; padding: 0; border: none; background: none; cursor: pointer; border-radius: 8px; scroll-snap-align: start; }
.se-thumb .ss-slide { transition: outline .15s; }
.se-thumb.on .ss-slide { outline: 2.5px solid var(--accent); outline-offset: 1px; }
.se-pencil { position: absolute; top: 6px; right: 6px; display: flex; padding: 4px; border-radius: 6px; background: rgba(8,9,13,.55); color: #fff; opacity: 0; transition: opacity .15s; }
.se-thumb:hover .se-pencil, .se-thumb.on .se-pencil { opacity: 1; }
.se-spin { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.5); border-radius: 8px; color: var(--accent); }
.se-edit { overflow: hidden; }
.se-edit-head { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; font-weight: 600; color: var(--ink); margin: 10px 0 6px; }
.se-label { display: block; font-size: 11px; font-weight: 600; color: var(--faint); text-transform: uppercase; letter-spacing: .4px; margin: 8px 0 4px; }
.se-field { width: 100%; line-height: 1.4; }
.se-count { font-size: 10.5px; color: var(--faint); margin-top: 3px; }
.se-count.over { color: #B3372F; }
.se-x { display: flex; padding: 4px; border: none; background: none; color: var(--faint); cursor: pointer; border-radius: 6px; }
.se-x:hover { background: var(--line); color: var(--ink); }
.lib { display: flex; gap: 16px; align-items: flex-start; }
.lib-side { width: 180px; flex: none; display: flex; flex-direction: column; gap: 3px; }
.lib-side-h { font-size: 11px; font-weight: 700; color: var(--faint); text-transform: uppercase; letter-spacing: .5px; margin: 12px 4px 4px; }
.lib-album { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; border-radius: 9px; border: none; background: none; cursor: pointer; font-size: 13px; color: var(--ink); }
.lib-album:hover { background: var(--line); }
.lib-album.on { background: var(--accent); color: #fff; }
.lib-album span { font-size: 11.5px; opacity: .7; }
.lib-album-row { display: flex; align-items: center; }
.lib-album-row .lib-album { flex: 1; }
.lib-album-del { border: none; background: none; color: var(--faint); cursor: pointer; padding: 4px; opacity: 0; }
.lib-album-row:hover .lib-album-del { opacity: 1; }
.lib-newalbum { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 9px; border: 1px dashed var(--line); background: none; cursor: pointer; font-size: 12.5px; color: var(--muted); margin-top: 6px; }
.lib-main { flex: 1; min-width: 0; }
.lib-top { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.lib-bulk { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 12px; font-size: 12.5px; }
.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
.lib-cell { position: relative; }
.lib-thumb { position: relative; width: 100%; aspect-ratio: 4/5; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); background: #0001; cursor: pointer; padding: 0; display: block; }
.lib-thumb img { width: 100%; height: 100%; object-fit: cover; }
.lib-noimg { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--faint); }
.lib-badge { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); background: rgba(8,9,13,.55); color: #fff; border-radius: 999px; padding: 7px; display: flex; }
.lib-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(255,255,255,.55); color: var(--ink); font-size: 11.5px; font-weight: 600; }
.lib-status.bad { background: rgba(179,55,47,.12); color: #B3372F; }
.lib-tags { position: absolute; bottom: 0; left: 0; right: 0; padding: 5px 7px; background: linear-gradient(transparent, rgba(8,9,13,.7)); color: #fff; font-size: 10.5px; font-weight: 600; }
.lib-check { position: absolute; top: 7px; right: 7px; width: 19px; height: 19px; border-radius: 5px; border: 1.5px solid #fff; background: rgba(8,9,13,.4); display: flex; align-items: center; justify-content: center; color: #fff; cursor: pointer; }
.lib-check.on { background: var(--accent); border-color: var(--accent); }
.lib-chip { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; background: var(--accent); color: #fff; font-weight: 600; }
.lib-chip.subtle { background: var(--line); color: var(--muted); font-weight: 500; }
.lib-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.lib-search { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 999px; color: var(--faint); background: var(--card); }
.lib-search input { border: none; background: none; outline: none; font-size: 12.5px; color: var(--ink); width: 150px; }
.lib-facet { font-size: 12px; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--muted); cursor: pointer; text-transform: capitalize; }
.lib-facet:hover { border-color: var(--accent); }
.lib-facet.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.lib-sort { width: auto; padding: 6px 10px; font-size: 12.5px; margin-left: auto; }
.lib-fav { position: absolute; top: 7px; left: 7px; width: 22px; height: 22px; border-radius: 6px; border: none; background: rgba(8,9,13,.45); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: opacity .15s; }
.lib-cell:hover .lib-fav, .lib-fav.on { opacity: 1; }
.lib-fav.on { color: #FFD24A; }
.studio { display: flex; gap: 16px; align-items: flex-start; }
.studio-rail { width: 196px; flex: none; display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; }
.studio-plat { display: flex; gap: 4px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 3px; }
.studio-plat-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 4px; border-radius: 8px; border: none; background: none; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--muted); }
.studio-plat-btn.on { background: var(--accent); color: #fff; }
.studio-verbs { display: flex; flex-direction: column; gap: 6px; }
.studio-verb { display: flex; align-items: center; gap: 11px; padding: 12px 13px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); cursor: pointer; text-align: left; color: var(--ink); transition: border-color .15s, background .15s; }
.studio-verb:hover { border-color: var(--accent); }
.studio-verb.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.studio-verb-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.studio-verb-l { font-size: 13.5px; font-weight: 700; }
.studio-verb-d { font-size: 11px; opacity: .72; }
.studio-canvas { flex: 1; min-width: 0; }
@media (max-width: 720px) {
  .studio { flex-direction: column; }
  .studio-rail { width: 100%; position: static; }
  .studio-verbs { flex-direction: row; }
  .studio-verb { flex: 1; }
  .studio-verb-d { display: none; }
  .lib { flex-direction: column; }
  .lib-side { width: 100%; flex-direction: row; flex-wrap: wrap; }
}
/* STUDIO COMPOSER — the agent create surface */
.sc { display: flex; flex-direction: column; min-height: calc(100vh - 230px); }
.sc-hero { max-width: 620px; margin: 0 auto; width: 100%; padding-top: 7vh; text-align: center; display: flex; flex-direction: column; align-items: center; }
.sc-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: var(--accent-text); background: var(--accent-soft); border: 1px solid var(--accent-line); padding: 5px 11px; border-radius: 999px; margin-bottom: 16px; }
.sc-title { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: var(--ink); margin: 0 0 8px; }
.sc-sub { font-size: 13.5px; line-height: 1.6; color: var(--muted); margin: 0 0 22px; max-width: 460px; }
.sc-composer { width: 100%; background: var(--surface); border: 1px solid var(--line2); border-radius: 16px; padding: 12px 12px 10px; box-shadow: 0 10px 34px -22px rgba(35,32,24,0.42); text-align: left; }
.sc.has-thread .sc-composer { position: sticky; bottom: 0; margin-top: 4px; backdrop-filter: blur(6px); }
.sc-input { width: 100%; border: none; background: none; outline: none; resize: none; font-family: inherit; font-size: 14px; line-height: 1.55; color: var(--ink); padding: 4px 6px 2px; max-height: 200px; }
.sc-input::placeholder { color: var(--faint); }
.sc-opts { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 6px 2px 0; }
.sc-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line2); background: var(--surface); color: var(--muted); cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; }
.sc-chip:hover { border-color: var(--line-hover); color: var(--body); }
.sc-chip.on { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent-text); }
.sc-chipset { display: inline-flex; gap: 3px; background: var(--bg2); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
.sc-chipset .sc-chip { border: none; background: none; padding: 5px 11px; }
.sc-chipset .sc-chip.on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 4px -1px rgba(35,32,24,0.25); }
.sc-send { width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; flex: none; transition: .15s; }
.sc-send:disabled { opacity: .4; cursor: default; }
.sc-send:not(:disabled):hover { background: var(--accent-deep); }
.sc-attach-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px 8px; }
.sc-attach { display: inline-flex; align-items: center; gap: 6px; max-width: 200px; background: var(--bg2); border: 1px solid var(--line); border-radius: 8px; padding: 3px 5px 3px 6px; font-size: 11.5px; color: var(--body); }
.sc-attach img { width: 18px; height: 18px; border-radius: 4px; object-fit: cover; }
.sc-attach-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-attach button { background: none; border: none; cursor: pointer; color: var(--faint); display: flex; padding: 1px; } .sc-attach button:hover { color: var(--ink); }
.sc-quick { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 16px; }
.sc-quick-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--body); background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 7px 13px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; flex: none; }
.sc-quick-chip:hover { border-color: var(--accent); color: var(--accent-text); }
.sc-quick-chip svg { color: var(--accent); }
/* single create-type selector above the composer input */
.sc-types { display: flex; gap: 6px; overflow-x: auto; padding: 1px 2px 10px; margin: 0 -2px; scrollbar-width: none; }
.sc-types::-webkit-scrollbar { display: none; }
.sc-type { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: 12.5px; font-weight: 600; color: var(--muted); background: var(--surface); border: 1px solid var(--line2); border-radius: 999px; padding: 6px 12px; cursor: pointer; font-family: inherit; transition: .15s; white-space: nowrap; }
.sc-type svg { color: var(--faint); transition: color .15s; }
.sc-type:hover { border-color: var(--line-hover); color: var(--body); }
.sc-type.on { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent-text); }
.sc-type.on svg { color: var(--accent); }
.sc-need { display: inline-flex; align-items: center; gap: 6px; margin: 6px 2px 0; padding: 7px 11px; border-radius: 9px; border: 1px dashed var(--accent-line); background: var(--accent-soft); color: var(--accent-text); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; text-align: left; }
.sc-need:hover { border-style: solid; }
.sc-thread { display: flex; flex-direction: column; gap: 14px; padding: 6px 2px 16px; flex: 1; }
.sc-pick { width: 560px; }
.sc-pick-tabs { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
.sc-pick-grid { max-height: 52vh; overflow-y: auto; padding: 2px; }
.lib-cell.sel .lib-thumb { outline: 2px solid var(--accent); outline-offset: 1px; }
.lib-check.on { background: var(--accent); border-color: var(--accent); }
.lib-vid-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--faint); background: var(--bg2); }
.lib-name { display: block; font-size: 11px; color: var(--muted); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* clarifying-question card */
.qp { padding: 14px 14px 12px; width: 100%; }
.qp-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent-text); margin-bottom: 6px; }
.qp-q { font-size: 14.5px; font-weight: 650; color: var(--ink); line-height: 1.4; margin-bottom: 12px; }
.qp-opts { display: flex; flex-direction: column; gap: 8px; }
.qp-opt { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; padding: 11px 12px; border-radius: 11px; border: 1px solid var(--line2); background: var(--surface); cursor: pointer; font-family: inherit; color: var(--ink); transition: border-color .15s, background .15s, opacity .15s; }
.qp-opt:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
.qp-opt:disabled { cursor: default; }
.qp-opt.on { border-color: var(--accent); background: var(--accent-soft); }
.qp-opt.dim { opacity: .42; }
.qp-key { flex: none; width: 26px; height: 26px; border-radius: 7px; background: var(--bg2); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--muted); }
.qp-opt.on .qp-key { background: var(--accent); border-color: var(--accent); color: #fff; }
.qp-opt-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.qp-opt-l { font-size: 13.5px; font-weight: 600; line-height: 1.3; }
.qp-opt-d { font-size: 11.5px; color: var(--muted); line-height: 1.35; }
.qp-other { border-style: dashed; color: var(--muted); }
.qp-other .qp-opt-l { font-weight: 500; }
.qp-other-open { display: flex; align-items: center; gap: 8px; }
.qp-other-open .field { flex: 1; }
/* campaign consent card */
.cp .cp-l { display: block; font-size: 11px; font-weight: 700; color: var(--muted); margin: 10px 0 4px; }
.cp .cp-l:first-of-type { margin-top: 4px; }
.cp-seg { margin-top: 10px; }
.cp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
/* generated-video card states */
.mp-rendering { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 30px 16px; background: var(--bg2); border-radius: 12px; font-size: 13.5px; color: var(--body); }
.mp-rendering .muted { max-width: 320px; }
.mp-coming { padding: 16px; background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 12px; font-size: 13px; line-height: 1.5; color: var(--accent-text); }
/* Projects gallery */
.proj-filters { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 14px; }
.proj-empty { text-align: center; padding: 8vh 16px; }
.proj-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
.proj-card { border: 1px solid var(--line); border-radius: 13px; overflow: hidden; background: var(--surface); display: flex; flex-direction: column; }
.proj-media { position: relative; aspect-ratio: 4/5; background: var(--bg2); overflow: hidden; }
.proj-media video, .proj-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.proj-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--faint); }
.proj-ph.wait { color: var(--accent); }
.proj-badge { position: absolute; top: 8px; left: 8px; font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: rgba(8,9,13,.55); color: #fff; backdrop-filter: blur(4px); }
.proj-body { padding: 9px 11px 4px; flex: 1; }
.proj-title { font-size: 12.5px; font-weight: 600; color: var(--ink); line-height: 1.35; max-height: 2.7em; overflow: hidden; }
.proj-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 5px; }
.proj-status { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 999px; background: var(--bg2); color: var(--muted); }
.proj-status.ok { background: #E7F3EC; color: #2E7D46; }
.proj-status.bad { background: #FBEAEA; color: #B3372F; }
.proj-post { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.proj-post textarea { flex-basis: 100%; }
.proj-actions { display: flex; justify-content: flex-end; gap: 6px; padding: 6px 9px 9px; }
/* video scene editor */
.vse { width: 540px; max-width: 100%; }
.vse-scenes { display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow-y: auto; padding: 2px; }
.vse-scene { display: flex; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 11px; background: var(--bg2); }
.vse-num { flex: none; width: 24px; height: 24px; border-radius: 7px; background: var(--surface); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--muted); }
.vse-fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.vse-kind { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--accent-text); }
.vse-fields .field { padding: 7px 10px; font-size: 13px; }
.vse-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.vse-dur { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
.vse-dur input { width: 46px; padding: 4px 6px; border: 1px solid var(--line2); border-radius: 7px; background: var(--surface); font-family: inherit; font-size: 12px; text-align: center; }
.vse-ic { width: 28px; height: 26px; border-radius: 7px; border: 1px solid var(--line2); background: var(--surface); color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.vse-ic:disabled { opacity: .35; cursor: default; }
.vse-ic.danger:hover:not(:disabled) { color: #B3372F; border-color: #E8B7B2; }
.vse-add { display: flex; align-items: center; gap: 7px; margin-top: 10px; }
.vse-global { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
.vse-rendering { padding: 8px 0 4px; text-align: center; }
.vse-thumb { width: 42px; height: 60px; border-radius: 8px; object-fit: cover; flex: none; border: 1px solid var(--line); background: var(--surface); }
.vse-thumb-card, .vse-thumb-q { display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden; color: var(--muted); }
.vse-thumb-card b { font-size: 8px; line-height: 1.15; font-weight: 800; padding: 3px; word-break: break-word; }
.vse-thumb-card.sty-bold { background: #111113; color: #D4A017; }
.vse-thumb-card.sty-minimal { background: #F5F1E8; color: #111113; }
.vse-thumb-card.sty-editorial { background: #fff; color: #111113; font-style: italic; }
.vse-thumb-card.sty-gradient { background: linear-gradient(135deg, #6366F1, #EC4899); color: #fff; }
.vse-thumb-card.sty-mint { background: #D9F2E6; color: #0F5132; }
.vse-restore { align-self: flex-start; background: none; border: none; padding: 2px 0; font-family: inherit; font-size: 11.5px; color: #B5891A; cursor: pointer; }
.vse-restore:hover { text-decoration: underline; }
.vse-note { font-size: 12px; line-height: 1.4; color: #7A5B12; background: #FBF3DC; border: 1px solid #EBD9A8; border-radius: 9px; padding: 7px 10px; text-align: left; }
@media (max-width: 600px) {
  .vse { width: 100%; }
  .vse-scene { flex-wrap: wrap; }
  .vse-row { flex-wrap: wrap; }
}
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
