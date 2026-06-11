# Cadence Backend Architecture

**Essence: one voice, every platform, on autopilot.** The backend's five jobs:

1. **Voice** — maintain a living model of how the user actually writes
2. **Generation** — produce platform-native content through one prompt stack
3. **Scheduling** — publish exactly once, on time, observably
4. **Engagement** — reply safely, in voice, with the user in control
5. **Steering** — chat, run-now, and live status keep the human in command

## Layers

### Foundation (`lib/llm.js`, `lib/prompts.js`, `lib/engine.js`, `lib/voice.js`)

- **`llm.js`** — `generateJson()` (forced tool-use structured output, validated,
  one retry — never parse markdown fences) and `generateText()` (long-form stays
  unconstrained for quality).
- **`prompts.js`** — `voiceBlock(persona, {register})` (post / reply / longform /
  headline), `feedbackBlock`, `antiRepetition`, `PLATFORM` caps, rubrics
  (`X_RUBRIC`, `REPLY_RUBRIC`, `PROMO_RUBRIC`, `LINKEDIN_RUBRIC`), `enforceLen`
  (word-safe trim → LLM compression for X only).
- **`engine.js`** — the exactly-once machinery. PostgREST UPDATE-with-filters is
  an atomic compare-and-set, so:
  - `claimEngineRow`: `running=false → true` gate; **next_run_at advances at
    claim time** (a crash can never hot-loop paid API calls).
  - `claimPost`: `queued → posting`; the ONLY path to publishing. Stale UI
    clicks and overlapping crons lose the CAS and are politely rejected.
  - `releaseStaleClaims` / `sweepInterruptedPosts`: heartbeat-based recovery.
    Interrupted posts mark **failed without retry** — a success-then-crash must
    never publish twice.
- **`voice.js`** — `getVoice(userId)`: persona + feedback + recent content in
  one query set, fetched once per engine run.

### Engines (all claim-first, all isolated, all live-status via `setEngineStatus`)

| Engine | Table | Output | Publish path |
|---|---|---|---|
| Queue poster | `posts` | — | X API / Zernio (LinkedIn) |
| X campaigns | `campaigns` | queued posts | queue |
| Brand campaigns | `brand_campaigns` | posts + slideshows, full provenance | queue / Zernio |
| X feeder engagement | `engagement_rules` | reply drafts/queued | queue |
| Social auto-replies | `social_engagement` | `social_replies` | X API / Zernio inbox |
| Clips | `clip_jobs` | storage mp4s | manual / Zernio |

Dedupe is **gate-row-before-publish**: unique indexes
(`posts(user_id, reply_to_tweet_id)`, `social_replies(user_id, comment_id)`)
act as locks — insert first, publish second, update status last.

### Scheduling topology

`GET /api/cron` (Bearer `CRON_SECRET`) is the single heartbeat:
1. recovery sweeps → 2. due posts (the money path, limit 25/tick) →
3. engines → 4. clip-worker kick + housekeeping via `after()`.

Local dev: `cron-runner.js` per minute. Production: point any scheduler at the
endpoint ≥ every 5 minutes; overlapping ticks are harmless by construction.

### Security posture

- All data access via service-role through `/api` routes scoped by `user_id`;
  RLS deny-by-default on engine tables (intentional).
- Browser RLS: `posts` readable (the queue reads it directly — its column names
  and status vocabulary `draft|queued|paused|posting|posted|failed` are a UI
  contract). `x_connections` browser policies **dropped** — OAuth tokens never
  reach the client.
- X auth failures flag `needs_reconnect`; connections are never auto-deleted.

### Prompt principles

Every generation surface assembles: voiceBlock (register-tuned) → rubric →
feedbackBlock → antiRepetition → platform caps → enforceLen. The strongest
guardrails sit on the paths that publish autonomously. Structured outputs go
through `generateJson`; persona analysis validates before persisting (a bad
generation can never clobber a good voice profile).

### Deploy checklist

`ffmpeg`, `yt-dlp`, `whisper-cpp` + `~/.cache/whisper/ggml-base.en.bin`,
`assets/fonts/`, `assets/fillers/*.mp4`, env: `ANTHROPIC_API_KEY`,
`ZERNIO_API_KEY`, `CRON_SECRET`, `X_*`, `APIFY_TOKEN`, Supabase keys.
Optional upgrades: `OPENAI_API_KEY` (cloud Whisper), `YTDLP_COOKIES`.
