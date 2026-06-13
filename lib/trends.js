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

// Render styles the analyzer may map a video format onto (clip EDIT_FORMATS +
// the trend-derived ones). Keep in sync with lib/clips.js EDIT_FORMATS.
export const RENDER_STYLES = ['captions', 'zoom_hook', 'cold_open', 'sludge', 'tweet', 'thread', 'reddit']

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

const FORMAT_SCHEMA = {
  type: 'object',
  required: ['name', 'hook_type', 'why_it_works', 'recipe', 'render_style'],
  properties: {
    name: { type: 'string', description: 'Short label for the format, e.g. "POV cold-open" or "zoom-punch hook".' },
    hook_type: { type: 'string', description: 'The hook mechanism: how it stops the scroll in the first 2 seconds.' },
    hook_on_screen: { type: 'string', description: 'The exact on-screen hook text / spoken first line, if any.' },
    editing_techniques: { type: 'array', items: { type: 'string' }, description: 'Concrete techniques an editor used (captions style, zoom/punch-in, text card, b-roll, split-screen, jump cuts, etc.).' },
    pacing: { type: 'string', description: 'Cut rhythm and energy in a few words.' },
    why_it_works: { type: 'string', description: 'Why this format earns retention/shares — the psychology.' },
    recipe: { type: 'string', description: 'A step-by-step recipe to reproduce this format on a different clip.' },
    render_style: { type: 'string', enum: RENDER_STYLES, description: 'Which of Cadence\'s clip render styles reproduces this best.' },
    suggested_hook: { type: 'string', description: 'A ready-to-use hook line written in this format, generic enough to adapt.' },
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
      { type: 'text', text: `These are keyframes (in order, early→late) from the first seconds of a viral short-form video${transcript ? `. The spoken words so far: "${transcript}"` : ' (no clear speech).'}\n\nReverse-engineer its HOOK and editing FORMAT so a creator can reproduce the *format* on their own footage. Be concrete and specific to what you SEE — caption style, text placement, zoom/punch-ins, cuts, on-screen text, framing.` },
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

    const row = {
      user_id: userId, platform: platform || guessPlatform(url), kind: 'format',
      name: String(out.name || 'Untitled format').slice(0, 120),
      summary: [out.hook_type, out.why_it_works].filter(Boolean).join(' — ').slice(0, 600),
      pattern: [out.recipe, out.editing_techniques?.length ? `Techniques: ${out.editing_techniques.join(', ')}` : '', out.pacing ? `Pacing: ${out.pacing}` : ''].filter(Boolean).join('\n').slice(0, 1500),
      hook_text: String(out.suggested_hook || out.hook_on_screen || '').slice(0, 400) || null,
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
    system: `You study what makes ${platform === 'linkedin' ? 'LinkedIn' : 'X'} posts go viral. From the post(s), extract the reusable HOOK FORMAT (the structural pattern of the opening that earns the read), not the specific topic.
Return: name (short label), hook_type (the mechanism), pattern (a fill-in-the-blank template a writer can reuse), why_it_works, suggested_hook (a ready example in this pattern).`,
    user: corpus,
    schema: {
      type: 'object', required: ['name', 'pattern', 'why_it_works'],
      properties: { name: { type: 'string' }, hook_type: { type: 'string' }, pattern: { type: 'string' }, why_it_works: { type: 'string' }, suggested_hook: { type: 'string' } },
    },
    maxTokens: 600, toolName: 'emit_hook',
  })
  const row = {
    user_id: userId, platform, kind: 'hook',
    name: String(out.name || 'Hook pattern').slice(0, 120),
    summary: [out.hook_type, out.why_it_works].filter(Boolean).join(' — ').slice(0, 600),
    pattern: String(out.pattern || '').slice(0, 1500),
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
    .select('name, pattern, hook_text').eq('user_id', userId).eq('platform', platform)
    .eq('active', true).in('kind', ['hook', 'format']).order('created_at', { ascending: false }).limit(5)
  if (!data?.length) return ''
  return `\n\nWHAT'S WORKING RIGHT NOW on ${platform === 'linkedin' ? 'LinkedIn' : 'X'} (adapt these hook FORMATS to the user's voice — study the structure, never copy the example):\n${data.map(t => `- ${t.name}: ${t.pattern}${t.hook_text ? ` (e.g. "${t.hook_text}")` : ''}`).join('\n')}`
}
