// lib/persona.js — the "brain": learn a person's voice from LinkedIn, then
// generate X posts in that voice.
import Anthropic from '@anthropic-ai/sdk'
import { admin } from './supabase'
import { X_RUBRIC } from './rubric'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Pull a user's LinkedIn corpus. `mentor: false` = their own profile(s),
// `mentor: true` = the style-mentor profiles they want to mimic.
async function getCorpus(userId, { mentor = false, limit = 50 } = {}) {
  const { data: accounts } = await admin
    .from('linkedin_accounts').select('id').eq('user_id', userId).eq('is_mentor', mentor)
  const ids = (accounts || []).map(a => a.id)
  if (!ids.length) return []
  const { data } = await admin
    .from('linkedin_posts')
    .select('content, likes, comments')
    .in('account_id', ids)
    .order('posted_at', { ascending: false })
    .limit(limit)
  return (data || []).filter(p => p.content && p.content.length > 40)
}

function parseJson(text, fallback) {
  try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim()) }
  catch { return fallback }
}

// Compress an over-length post to a complete thought <= 280 chars (no mid-word cuts).
async function shorten(text) {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 220,
    system: 'Rewrite the given X post to 280 characters or fewer. Keep it a COMPLETE thought — never cut off mid-sentence. Keep the hook and the punch. Output ONLY the post text.',
    messages: [{ role: 'user', content: text }],
  })
  return (res.content.find(b => b.type === 'text')?.text || text).trim().replace(/^["']|["']$/g, '')
}

// Distill voice/personality into a reusable persona profile and store it.
export async function analyzePersona(userId) {
  const posts = await getCorpus(userId, { mentor: false, limit: 50 })
  if (!posts.length) throw new Error('No LinkedIn posts to learn from — add your LinkedIn in Connections first.')

  const corpus = posts.map((p, i) => `[${i + 1}] (${p.likes} likes) ${p.content}`).join('\n\n')

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1600,
    system: `You are a brand-voice analyst. Given a person's LinkedIn posts, distill their writing voice and personality into a reusable profile for generating on-brand social posts. Respond with ONLY valid JSON (no markdown fences) of exactly this shape:
{"summary": "2-3 sentences on who they are and how they write",
 "tone": "short tone descriptor",
 "topics": ["5-8 themes they post about"],
 "style_rules": ["5-8 concrete do/don't rules capturing their style"],
 "signature_moves": ["3-5 recurring rhetorical patterns"],
 "sample_hooks": ["3-5 example opening lines in their voice"]}`,
    messages: [{ role: 'user', content: `Analyze this person's voice from their LinkedIn posts:\n\n${corpus}` }],
  })

  const txt  = res.content.find(b => b.type === 'text')?.text || '{}'
  const json = parseJson(txt, {})

  const row = {
    user_id:           userId,
    summary:           json.summary || null,
    tone:              json.tone || null,
    topics:            Array.isArray(json.topics) ? json.topics : [],
    style_rules:       Array.isArray(json.style_rules) ? json.style_rules : [],
    signature_moves:   Array.isArray(json.signature_moves) ? json.signature_moves : [],
    sample_hooks:      Array.isArray(json.sample_hooks) ? json.sample_hooks : [],
    source_post_count: posts.length,
    updated_at:        new Date().toISOString(),
  }
  await admin.from('personas').upsert(row, { onConflict: 'user_id' })
  return row
}

// Generate N fresh X posts in the user's voice, saved as reviewable drafts.
export async function generatePosts(userId, n = 5) {
  const { data: persona } = await admin.from('personas').select('*').eq('user_id', userId).single()
  if (!persona) throw new Error('Analyze the voice first.')

  const selfPosts   = await getCorpus(userId, { mentor: false, limit: 25 })
  const mentorPosts = await getCorpus(userId, { mentor: true, limit: 15 })
  const selfCorpus   = selfPosts.map(p => p.content).join('\n---\n')
  const mentorBlock  = mentorPosts.length
    ? `\n\nSTYLE MENTORS — high-performing posts from creators this user wants to emulate. Borrow their structure, hook patterns, and rhythm (NOT their topics or specific facts):\n${mentorPosts.map(p => `• ${p.content.slice(0, 300)}`).join('\n')}`
    : ''

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1600,
    system: `You write X (Twitter) posts in a specific person's voice.

THEIR VOICE PROFILE
tone: ${persona.tone}
topics: ${(persona.topics || []).join(', ')}
style rules: ${(persona.style_rules || []).join(' | ')}
signature moves: ${(persona.signature_moves || []).join(' | ')}

${X_RUBRIC}

Write exactly ${n} posts. Vary the angle across the set. Respond with ONLY a JSON array of ${n} tweet strings (use \\n for line breaks), nothing else.`,
    messages: [{ role: 'user', content: `This person's own recent LinkedIn material (for substance & voice):\n\n${selfCorpus}${mentorBlock}\n\nWrite ${n} fresh X posts in THEIR voice, applying the rubric.` }],
  })

  const txt = res.content.find(b => b.type === 'text')?.text || '[]'
  let arr   = parseJson(txt, [])
  arr = (Array.isArray(arr) ? arr : []).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())
  if (!arr.length) throw new Error('Generation returned nothing — try again.')

  // Guarantee complete posts <= 280 chars (no mid-word slicing).
  arr = await Promise.all(arr.map(async t => (t.length > 280 ? await shorten(t) : t)))
  arr = arr.map(t => (t.length > 280 ? t.slice(0, 277).trimEnd() + '…' : t)) // final safety net

  const now  = new Date().toISOString()
  const rows = arr.map(content => ({
    content, scheduled_for: now, status: 'draft', source: 'generated', user_id: userId,
  }))
  const { data, error } = await admin.from('posts').insert(rows).select()
  if (error) throw new Error(error.message)
  return data || []
}
