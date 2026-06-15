// lib/onboarding-gate.js — the server-authoritative readiness gate for turning on
// Autopilot. The client mirrors this for UX, but THIS is the trust boundary: a
// user can't POST /api/autopilot {enabled:true} for a platform they haven't set
// up. Per-platform: finishing X's setup does NOT unlock LinkedIn (each platform
// needs its own connected account). The brand brief (positioning/pillars/voice)
// is shared across platforms — that's the whole point of the shared memory layer.
//
// Two tiers of strictness:
//   • enable (review mode)   → brief positioning + a connected account.
//   • enable + auto_post     → additionally content pillars + a learned voice
//                              (a persona), because hands-free posting in someone's
//                              name without a learned voice is the thing we must NOT do.

// Each gate item: { key, label, where } — `where` tells the client which
// onboarding step to drop the user back into.
export const GATE_KEYS = ['brief', 'account', 'pillars', 'voice']

export function autopilotGate({ brief, hasPersona, hasAccount, autoPost, platform }) {
  const missing = []
  const positioning = String(brief?.positioning || '').trim()
  const pillars = Array.isArray(brief?.pillars) ? brief.pillars.filter(p => String(p || '').trim()) : []

  if (!positioning) {
    missing.push({ key: 'brief', where: 'brief', label: 'Tell Cadence who you are — your positioning and who you’re talking to.' })
  }
  if (!hasAccount) {
    missing.push({ key: 'account', where: 'account', label: `Connect your ${platformLabel(platform)} account so Cadence can post for you.` })
  }
  if (autoPost) {
    if (pillars.length < 1) {
      missing.push({ key: 'pillars', where: 'pillars', label: 'Add 3–5 content pillars so hands-free posts have real substance.' })
    }
    if (!hasPersona) {
      missing.push({ key: 'voice', where: 'voice', label: `Let Cadence study your ${platformLabel(platform)} so it learns your voice before it posts unattended.` })
    }
  }
  return { ok: missing.length === 0, missing, autoPost: !!autoPost }
}

function platformLabel(p) {
  return p === 'x' ? 'X' : p === 'linkedin' ? 'LinkedIn' : p === 'instagram' ? 'Instagram' : p === 'tiktok' ? 'TikTok' : (p || 'social')
}
