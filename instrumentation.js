// Local dev scheduler. In production, Vercel cron (vercel.json: */5) drives
// /api/cron, which publishes due posts, dispatches scheduled carousels, renders
// + auto-posts clips, and runs the agent/engagement engines. `next dev` has NO
// scheduler, so locally everything sits 'queued' past its time and never fires.
// This pings the same cron loop once a minute — DEV ONLY (prod is owned by the
// Vercel cron; we never double-drive it).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV === 'production') return
  if (globalThis.__devCronStarted) return
  globalThis.__devCronStarted = true

  if (!process.env.CRON_SECRET) {
    console.warn('[dev-cron] CRON_SECRET is unset — local scheduler is OFF (scheduled posts/clips will not publish locally).')
    return
  }
  const port = process.env.PORT || 3000
  const url = `http://127.0.0.1:${port}/api/cron`
  const tick = async () => {
    try { await fetch(url, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }) } catch { /* server not up yet */ }
  }
  // Let the server finish booting, then run every 60s.
  setTimeout(() => { tick(); setInterval(tick, 60_000) }, 8000)
  console.log('[dev-cron] local scheduler ON — pinging /api/cron every 60s (publishes due posts, clips, carousels, agents).')
}
