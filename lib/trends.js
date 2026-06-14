// lib/trends.js — the Trend Engine. Learn what's actually working right now and
// turn it into things Cadence can DO:
//   • analyzeViralVideo(url)  → reverse-engineers a reel's HOOK + editing FORMAT
//     (downloads only the first ~20s, samples keyframes, reads the transcript,
//      and has Claude *see* the frames) → a replicable recipe + which render
//      style reproduces it.
//   • analyzeViralText(...)   → distills the hook pattern from a viral X/LinkedIn
//      post so we can write in that shape.
//   • trendingBlock(userId, platform) → injects the live patterns into every
//      generation surface so the user's own posts adopt what's trending.
//
// Discovery (this) is provider-agnostic; bulk HARVEST of trending content per
// niche is a separate layer that needs a scraping source (see the route).
import { spawn } from 'child_process'
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'
import { generateJson } from './llm'
import { probe, transcribe } from './clips'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Render styles the analyzer may map a video format onto — STRICT subset of
// lib/clips.js EDIT_FORMATS keys so an emitted style always renders (an invalid
// one like the old 'zoom_hook' silently degraded to captions).
export const RENDER_STYLES = ['captions', 'cold_open', 'sludge', 'tweet', 'thread', 'reddit']

function run(cmd, args, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let out = '', err = ''
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)) }, timeoutMs)
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('error', e => { clearTimeout(t); reject(e) })
    p.on('close', c => { clearTimeout(t); c === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} failed: ${err.slice(-300)}`)) })
  })
}
async function hasYtDlp() { try { await run('yt-dlp', ['--version'], { timeoutMs: 15000 }); return true } catch { return false } }

const PAGE_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|twitch\.tv|loom\.com|facebook\.com|dailymotion\.com)/i

// Download only the FIRST ~20s — all the hook + format signal lives there, and
// it keeps analysis fast and cheap (no full-reel pull).
async function downloadHead(url, dir, seconds = 20) {
  const out = path.join(dir, 'head.mp4')
  if (!PAGE_HOSTS.test(url)) {
    // direct file: fetch + hard cap
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) }).catch(() => null)
    if (!res?.ok) throw new Error('Could not fetch that video.')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.subarray(0, 64).toString('utf8').trimStart().toLowerCase().startsWith('<')) throw new Error("That link is a web page, not a video file.")
    await writeFile(out, buf)
    return out
  }
  if (!(await hasYtDlp())) throw new Error('yt-dlp is needed to read links from this site — install it on the server.')
  await run('yt-dlp', [
    '--download-sections', `*0-${seconds}`, '--force-keyframes-at-cuts',
    '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
    '--merge-output-format', 'mp4', '--no-playlist', '--force-overwrites',
    '-o', out, url,
  ], { timeoutMs: 4 * 60 * 1000 }).catch(e => {
    const m = String(e.message || '')
    if (/private|members.only|age.restricted|login required/i.test(m)) throw new Error('That video is private or restricted — can only learn from public posts.')
    if (/bot/i.test(m)) throw new Error('The platform is rate-limiting downloads right now — try again in a few minutes.')
    throw new Error(`Could not read that video: ${m.slice(-160)}`)
  })
  if (!existsSync(out)) throw new Error('Download produced no file.')
  return out
}

// Sample keyframes across the hook window. Frame 1 ≈ 1s (the hook), then spread.
async function keyframes(file, dir, duration) {
  const stamps = duration < 6 ? [0.6, duration * 0.5] : [1, Math.min(duration, 20) * 0.45, Math.min(duration, 20) * 0.85]
  const frames = []
  for (let i = 0; i < stamps.length; i++) {
    const f = path.join(dir, `frame${i}.jpg`)
    await run('ffmpeg', ['-ss', String(stamps[i]), '-i', file, '-frames:v', '1', '-vf', 'scale=540:-1', '-q:v', '4', '-y', f], { timeoutMs: 60000 }).catch(() => {})
    if (existsSync(f)) frames.push({ at: stamps[i], data: (await readFile(f)).toString('base64') })
  }
  return frames
}

// The WHOLE video — virality is a combination of factors, not just the hook.
const FORMAT_SCHEMA = {
  type: 'object',
  required: ['name', 'recipe', 'render_style'], // rest are strongly prompted but optional so one miss never 500s
  properties: {
    name: { type: 'string', description: 'Short label for the format, e.g. "Day-1-vs-Day-30 transformation" or "story-time with a twist".' },
    format_archetype: { type: 'string', description: 'The format type: story-time, transformation/before-after, listicle, talking-head rant, tutorial/how-to, reaction, day-in-the-life, POV skit, green-screen explainer, etc.' },
    topic_angle: { type: 'string', description: 'What it is ABOUT and the specific angle/take — concrete.' },
    trending_element: { type: 'string', description: 'Any trend it rides: a trending sound, meme template, challenge, or hot topic. "" if none.' },
    hook: { type: 'string', description: 'How the first ~2s stops the scroll (one of several factors, not the whole story).' },
    structure: { type: 'string', description: 'The beat-by-beat ARC start→finish: setup → build/escalation → turn → payoff. This is the spine of why it holds attention.' },
    payoff: { type: 'string', description: 'The satisfying resolution that makes people finish, rewatch, or share — the thing the whole video was building to.' },
    retention_mechanic: { type: 'string', description: 'What keeps them watching to the payoff: open loop, "wait for it", escalating stakes, fast cuts, on-screen progress, a question posed up top.' },
    shareability_trigger: { type: 'string', description: 'Why people SHARE it: relatability, controversy, high utility, awe, identity/status, humor.' },
    editing_techniques: { type: 'array', items: { type: 'string' }, description: 'Concrete editing techniques (caption style, zoom/punch-in, text cards, b-roll, split-screen, jump cuts, etc.).' },
    pacing: { type: 'string', description: 'Cut rhythm and energy in a few words.' },
    why_it_works: { type: 'string', description: 'The combination of factors that make it spread — topic + format + structure + payoff together.' },
    recipe: { type: 'string', description: 'A step-by-step recipe to reproduce the WHOLE format (topic angle → hook → structure → payoff → edit) on different footage.' },
    render_style: { type: 'string', enum: RENDER_STYLES, description: 'Which of Cadence\'s clip render styles reproduces the editing best.' },
    suggested_hook: { type: 'string', description: 'A ready-to-use opening line in this format, generic enough to adapt.' },
  },
}

// Reverse-engineer a reel: Claude SEES the frames + reads the transcript.
export async function analyzeViralVideo(url, { userId, save = true, platform } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'trend-'))
  try {
    const file = await downloadHead(url, dir)
    const meta = await probe(file).catch(() => ({ duration: 15 }))
    const [frames, tr] = await Promise.all([
      keyframes(file, dir, meta.duration || 15),
      transcribe(file, dir).catch(() => null),
    ])
    if (!frames.length) throw new Error('Could not read frames from that video.')
    const transcript = (tr?.segments || []).map(s => s.text).join(' ').slice(0, 1200)

    const content = [
      { type: 'text', text: `These are keyframes (in order, early→late) from a viral short-form video${transcript ? `. What's said: "${transcript}"` : ' (no clear speech).'}\n\nReverse-engineer the WHOLE FORMAT so a creator can reproduce it on their own footage — virality is a COMBINATION of factors, not just the hook. Cover all of: the topic/angle (and any trend/sound it rides), the format archetype, the full structure (setup → build → turn → PAYOFF), what the payoff is, how it holds attention to that payoff, why people share it, and the editing. Be concrete and specific to what you SEE and hear.` },
      ...frames.map(f => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.data } })),
    ]
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 900,
      tools: [{ name: 'emit_format', description: 'Return the analyzed format.', input_schema: FORMAT_SCHEMA }],
      tool_choice: { type: 'tool', name: 'emit_format' },
      messages: [{ role: 'user', content }],
    })
    const out = res.content.find(b => b.type === 'tool_use')?.input
    if (!out) throw new Error('Could not analyze that video.')

    // Compose the full anatomy into the pattern — the whole format, not just the hook.
    const pattern = [
      out.format_archetype ? `Format: ${out.format_archetype}` : '',
      out.topic_angle ? `Angle: ${out.topic_angle}` : '',
      out.trending_element ? `Rides: ${out.trending_element}` : '',
      out.structure ? `Structure: ${out.structure}` : '',
      out.payoff ? `Payoff: ${out.payoff}` : '',
      out.retention_mechanic ? `Holds attention via: ${out.retention_mechanic}` : '',
      out.shareability_trigger ? `Shared because: ${out.shareability_trigger}` : '',
      out.editing_techniques?.length ? `Editing: ${out.editing_techniques.join(', ')}` : '',
      out.recipe ? `Recipe: ${out.recipe}` : '',
    ].filter(Boolean).join('\n').slice(0, 2000)
    const row = {
      user_id: userId, platform: platform || guessPlatform(url), kind: 'format',
      name: String(out.name || 'Untitled format').slice(0, 120),
      archetype: String(out.format_archetype || '').slice(0, 80) || null,
      payoff: String(out.payoff || '').slice(0, 300) || null,
      trending_element: String(out.trending_element || '').slice(0, 200) || null,
      summary: String(out.why_it_works || '').slice(0, 600),
      pattern,
      hook_text: String(out.suggested_hook || out.hook || '').slice(0, 400) || null,
      render_style: RENDER_STYLES.includes(out.render_style) ? out.render_style : 'captions',
      example_url: url, example_text: transcript.slice(0, 600) || null,
      source: 'manual',
    }
    if (save && userId) { const { data } = await admin.from('trend_formats').insert(row).select().single(); return data || row }
    return row
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Distill the hook pattern from viral TEXT (X/LinkedIn). Accepts raw text or a
// list of {text, metric} top posts.
export async function analyzeViralText({ text, posts, platform = 'x', url }, { userId, save = true } = {}) {
  const corpus = Array.isArray(posts) && posts.length
    ? posts.map((p, i) => `[${i + 1}]${p.metric ? ` (${p.metric})` : ''} ${String(p.text || p).slice(0, 400)}`).join('\n\n')
    : String(text || '').slice(0, 3000)
  if (!corpus.trim()) return { error: 'Give a post (or top posts) to analyze.' }
  const out = await generateJson({
    system: `You study what makes ${platform === 'linkedin' ? 'LinkedIn' : 'X'} posts go viral. Extract the reusable FORMAT — the whole thing, not just the opening. Virality is a combination of factors.
Return: name (short label), format_archetype (contrarian take, listicle, build-in-public story, framework, teardown, hot take, before/after, etc.), topic_angle (what it's about + the angle, and any trending topic it rides), structure (the full arc: hook → development → turn/PAYOFF), payoff (the line or reframe that lands — the reason it's worth finishing and sharing), shareability_trigger (relatability/controversy/utility/awe/identity), pattern (a fill-in-the-blank TEMPLATE for the whole post, opening through payoff), why_it_works, suggested_hook (a ready opener in this format).`,
    user: corpus,
    schema: {
      type: 'object', required: ['name', 'pattern'],
      properties: { name: { type: 'string' }, format_archetype: { type: 'string' }, topic_angle: { type: 'string' }, structure: { type: 'string' }, payoff: { type: 'string' }, shareability_trigger: { type: 'string' }, pattern: { type: 'string' }, why_it_works: { type: 'string' }, suggested_hook: { type: 'string' } },
    },
    maxTokens: 800, toolName: 'emit_format',
  })
  const pattern = [
    out.format_archetype ? `Format: ${out.format_archetype}` : '',
    out.topic_angle ? `Angle: ${out.topic_angle}` : '',
    out.structure ? `Structure: ${out.structure}` : '',
    out.payoff ? `Payoff: ${out.payoff}` : '',
    out.shareability_trigger ? `Shared because: ${out.shareability_trigger}` : '',
    out.pattern ? `Template: ${out.pattern}` : '',
  ].filter(Boolean).join('\n').slice(0, 2000)
  const row = {
    user_id: userId, platform, kind: 'format',
    name: String(out.name || 'Post format').slice(0, 120),
    archetype: String(out.format_archetype || '').slice(0, 80) || null,
    payoff: String(out.payoff || '').slice(0, 300) || null,
    summary: String(out.why_it_works || '').slice(0, 600),
    pattern,
    hook_text: String(out.suggested_hook || '').slice(0, 400) || null,
    example_url: url || null, example_text: corpus.slice(0, 600), source: 'manual',
  }
  if (save && userId) { const { data } = await admin.from('trend_formats').insert(row).select().single(); return data || row }
  return row
}

function guessPlatform(url) {
  const u = String(url).toLowerCase()
  if (u.includes('tiktok')) return 'tiktok'
  if (u.includes('instagram')) return 'instagram'
  if (u.includes('linkedin')) return 'linkedin'
  if (u.includes('x.com') || u.includes('twitter')) return 'x'
  return 'instagram'
}

// Inject the live trending hook patterns into a generation prompt so the user's
// OWN posts adopt what's working. Text platforms only (video formats apply at
// render time via render_style).
export async function trendingBlock(userId, platform) {
  const { data } = await admin.from('trend_formats')
    .select('name, archetype, pattern, payoff, hook_text').eq('user_id', userId).eq('platform', platform)
    .eq('active', true).in('kind', ['hook', 'format']).order('created_at', { ascending: false }).limit(5)
  if (!data?.length) return ''
  return `\n\nWHAT'S WORKING RIGHT NOW on ${platform === 'linkedin' ? 'LinkedIn' : 'X'} — adopt the WHOLE FORMAT, not just the opening: the angle, the structure, and the PAYOFF that makes it land. Adapt to the user's voice; study the shape, never copy the example:\n${data.map(t => `- ${t.name}${t.archetype ? ` [${t.archetype}]` : ''}:\n${t.pattern}${t.hook_text ? `\n  e.g. "${t.hook_text}"` : ''}`).join('\n')}`
}
