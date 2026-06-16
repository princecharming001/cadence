// lib/llm.js — the ONE way the backend talks to Claude.
//
// generateJson(): structured output via FORCED TOOL USE — the model must call a
// tool whose input_schema is the shape we want, so there is no markdown-fence
// parsing, no "Sure! Here's the JSON" prose, no truncated-brace failures. The
// result is validated against required fields and retried once on a miss.
//
// generateText(): plain prose generation (posts, replies, captions). Long-form
// quality is better unconstrained, so anything that ships as human-readable
// text stays a text call — only genuinely structured data uses generateJson.
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
export const MODEL = 'claude-sonnet-4-6'

export async function generateText({ system, user, maxTokens = 600, model = MODEL, temperature }) {
  const res = await anthropic.messages.create({
    model, max_tokens: maxTokens, system,
    ...(temperature != null ? { temperature } : {}),
    messages: [{ role: 'user', content: user }],
  })
  return (res.content.find(b => b.type === 'text')?.text || '').trim()
}

// schema: a JSON Schema object (type:'object', properties, required).
// Returns the validated object, or throws after one retry.
export async function generateJson({ system, user, schema, maxTokens = 1500, model = MODEL, toolName = 'emit', toolDescription = 'Emit the result in the required shape.', temperature }) {
  const required = schema?.required || []
  const attempt = async (extra = '') => {
    const res = await anthropic.messages.create({
      model, max_tokens: maxTokens,
      system: system + extra,
      ...(temperature != null ? { temperature } : {}),
      tools: [{ name: toolName, description: toolDescription, input_schema: schema }],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content: user }],
    })
    const call = res.content.find(b => b.type === 'tool_use')
    const out = call?.input
    if (!out || typeof out !== 'object') throw new Error('no structured output')
    for (const k of required) {
      const v = out[k]
      if (v == null || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim())) {
        throw new Error(`missing required field: ${k}`)
      }
    }
    return out
  }
  try { return await attempt() }
  catch { return await attempt('\n\nIMPORTANT: your previous attempt was malformed or incomplete — emit the full result via the tool, with every required field populated.') }
}
