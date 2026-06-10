// lib/comment-styles.js — how the AI comments. Pure data, shared by the
// engagement engine (server) and the rule UI (client). `hint` is the prompt
// fragment injected into reply generation for that style.
export const COMMENT_STYLES = [
  {
    key: 'add_value',
    label: 'Add value',
    description: 'Adds a useful insight or example that builds on the post.',
    hint: "Reply by adding one concrete, useful idea that extends the original post: a specific example, a nuance they missed, or a 'here's what also works' angle. Be additive, never contrarian for its own sake. One tight thought, no preamble.",
  },
  {
    key: 'question',
    label: 'Ask a sharp question',
    description: 'Asks a specific, genuine question that invites a reply.',
    hint: "Reply with ONE specific, genuine question prompted by the post, the kind that makes the author want to answer. Not generic ('thoughts?'), not a gotcha. Reference a concrete detail from their post.",
  },
  {
    key: 'agree_build',
    label: 'Agree + build',
    description: 'Warmly agrees and adds a small personal angle.',
    hint: "Reply in a warm, human 'yes, and' tone: affirm the point briefly, then add your own small angle or lived experience. Sound like a real person who actually relates, not a fan account. No flattery cliches ('so true!', 'love this').",
  },
  {
    key: 'counter',
    label: 'Respectful counter-take',
    description: 'Offers a civil, substantive different perspective.',
    hint: 'Reply with a respectful, substantive counterpoint: acknowledge what is right, then offer a specific reason it might be different in some cases. Lead with curiosity, not correction. Never condescending, never a pile-on. One clear idea.',
  },
  {
    key: 'witty',
    label: 'Witty one-liner',
    description: 'A short, clever, on-topic quip. Never mean.',
    hint: 'Reply with one short, clever, on-topic line: dry wit or a playful observation tied directly to the post. Punchy, under ~120 chars. Funny WITH them, never at their expense. No emojis, no forced jokes.',
  },
  {
    key: 'experience',
    label: 'Share my experience',
    description: 'A brief, concrete first-person story or result that relates.',
    hint: "Reply with a brief, concrete first-person moment that relates to the post: a real number, outcome, or specific situation in the user's voice. 'I tried X, got Y.' Specific beats generic. One short thought, no humblebrag.",
  },
]

export function styleByKey(key) {
  return COMMENT_STYLES.find(s => s.key === key) || COMMENT_STYLES[0]
}
