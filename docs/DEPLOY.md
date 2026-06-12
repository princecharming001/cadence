# Cadence — production deploy checklist

## Required env vars
| Var | What breaks without it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | auth + queue UI |
| `SUPABASE_SERVICE_KEY` | every API route |
| `ANTHROPIC_API_KEY` | chat, voice, suggestions, campaigns, agents |
| `CRON_SECRET` | /api/cron fails CLOSED without it — nothing publishes |
| `NEXT_PUBLIC_APP_URL` | OAuth redirects, Stripe return URLs, cron self-kick (no more localhost fallbacks in prod) |
| `X_OAUTH_CLIENT_ID` | X connect. `X_OAUTH_REDIRECT_URI` optional — defaults to `$NEXT_PUBLIC_APP_URL/api/x/callback`; whichever value is used must be registered on the X app |

## Optional / feature-gating
| Var | Activates |
|---|---|
| `APIFY_TOKEN` | LinkedIn scraping (voice + inspiration) |
| `ZERNIO_API_KEY` | publishing to LinkedIn / Instagram / TikTok + comment inboxes |
| `X_READ_ENABLED=true` | engagement discovery, niche replies, agent replies, impressions metric (PAID X reads; per-user daily cap 2500 via `bump_x_reads`) |
| `OPENAI_API_KEY` / `FAL_KEY` / `HIGGSFIELD_API_KEY`+`SECRET` | real AI images (else seeded placeholders). fal required for "Feature me" selfie images. Higgsfield needs credits on the account |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | turns the paywall ON (without them every feature is free) |
| `STRIPE_PRICE_INDIVIDUAL_MONTHLY` / `STRIPE_PRICE_INDIVIDUAL_ANNUAL` / `STRIPE_PRICE_TEAM_MONTHLY` / `STRIPE_PRICE_TEAM_ANNUAL` | the four pricing-page options. Legacy `STRIPE_PRICE_ID` still covers individual/monthly. Any unset combination 503s at checkout — create all four Prices in Stripe before turning billing on |

Stripe webhook endpoint: `POST /api/stripe/webhook` — subscribe to
`checkout.session.completed`, `customer.subscription.created/updated/deleted`.
Failures return 500 so Stripe retries; watch the log for `[stripe/webhook]`.

## Scheduler
Point any scheduler at `GET /api/cron` with `Authorization: Bearer $CRON_SECRET`
**at least every 5 minutes** (vercel.json ships `*/5`). One endpoint drives:
due posts, brand campaigns, X engagement, social auto-replies, **feeder agents**,
clip sweep, housekeeping. All engines are claim-first — overlapping ticks are safe.

## Box requirements (clips only)
`ffmpeg`, `ffprobe`, `yt-dlp`, `whisper-cpp` (+ ggml model at `~/.cache/whisper/`),
`assets/fonts/Anton.ttf` (bundled), `assets/fillers/*.mp4` (gitignored — copy manually).
Skip all of this if clips aren't offered; everything else runs serverless.

## Compliance notes
- **Feeder agents**: X's automation rules require automated accounts to be
  labeled as such (Settings → Your account → Automation on each feeder).
  Undisclosed bot accounts risk suspension. Default caps are deliberately low
  (2 posts + 4 replies/day per agent) — raise with care.
- X writes are pay-per-use (~$0.015/post); reads ~$0.005 and budget-capped.

## Post-deploy smoke test
1. Sign up → onboarding → connect X → post-now a test tweet.
2. `curl -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron` → 200 JSON.
3. With billing on: checkout an Individual plan in Stripe test mode → profile
   flips `is_pro/plan/seats`; portal opens from Billing tab.
