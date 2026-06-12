// Chat history CRUD — conversations persist across sessions, scoped to the
// authenticated user. The browser saves after every exchange and loads past
// chats from the History menu.
import { admin, getUser } from '@/lib/supabase'

const MAX_MESSAGES = 200
const MAX_BYTES = 400000 // jsonb payload guard

// GET            → list recent chats (id, title, updated_at) for the picker
// GET ?id=<uuid> → one full chat (messages included)
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (id) {
    const { data, error } = await admin.from('chats').select('*')
      .eq('id', id).eq('user_id', user.id).single()
    if (error || !data) return Response.json({ error: 'Chat not found.' }, { status: 404 })
    return Response.json({ chat: data })
  }
  const { data, error } = await admin.from('chats')
    .select('id, title, updated_at, created_at')
    .eq('user_id', user.id).order('updated_at', { ascending: false }).limit(50)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ chats: data || [] })
}

// POST { id?, messages, scope? } → create or update; returns { id }
export async function POST(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json()
  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : []
  if (!messages.length) return Response.json({ error: 'Nothing to save.' }, { status: 400 })
  if (JSON.stringify(messages).length > MAX_BYTES) {
    return Response.json({ error: 'Chat too large to save.' }, { status: 400 })
  }
  // Title = first user message, trimmed to a label.
  const first = messages.find(m => m?.role === 'user' && typeof m.content === 'string')
  const title = (first?.content || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 80)
  const row = { messages, title, scope: Array.isArray(body.scope) ? body.scope : null, updated_at: new Date().toISOString() }

  if (body.id) {
    const { data, error } = await admin.from('chats').update(row)
      .eq('id', body.id).eq('user_id', user.id).select('id').single()
    if (!error && data) return Response.json({ id: data.id })
    // fall through (stale id) → create fresh
  }
  const { data, error } = await admin.from('chats')
    .insert({ ...row, user_id: user.id }).select('id').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ id: data.id })
}

// DELETE { id }
export async function DELETE(req) {
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await req.json()
  await admin.from('chats').delete().eq('id', id).eq('user_id', user.id)
  return Response.json({ deleted: true })
}
