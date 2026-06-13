# Reducing automation / bot detection

Platforms flag automated accounts on timing regularity, instant reactions,
content sameness, and volume bursts. Cadence's measures, audited 2026-06-13:

## Timing — the strongest signal
- **No round timestamps.** `nextSmartSlot` (lib/scheduling.js) drifts each
  scheduled post ±3 minutes off the 5-minute grid *and* lands on a random
  second, so published times look like a person tapping "post" (9:07:43), never
  a machine `09:00:00`. Applies to autopilot + campaign posts.
- **Posts respect human windows.** Smart slots only fall inside the user's
  posting windows, weighted by hours that have actually earned engagement — no
  3am posting.
- **Feeder agents jitter 2–20 min** before each action; a fleet never posts in
  the same minute.

## Replies — react like a human, not a script
- **Replies to comments on your OWN posts wait a randomized 30–90s** before
  going out (lib/social-engagement.js). An instant reply to a fresh comment is
  the clearest reply-bot tell.
- **Niche replies (to others' posts) post directly when found** — replying
  while the post is hot is the point — but the per-reply LLM write naturally
  spaces a batch over seconds, so there's no same-second burst.

## Volume — no spammy bursts
- Autopilot is capped (1–3 posts/day). Niche engagement and auto-reply are
  capped per run (`replies_per_run`). X reads are budget-capped (DAILY_READ_CAP)
  so the account never scrapes at machine scale.
- One-reply-per-target unique index prevents repeat-replying the same post.

## Content — varied and human
- Anti-repetition: recent posts are fed into every generation so hooks, angles,
  and phrasing don't repeat.
- The X/LinkedIn rubrics strip the classic AI tells ("delve", "tapestry",
  em-dash overuse, "it's worth noting") and push for varied length — "aim for
  80–200 chars, shorter often wins" — instead of always maxing out.
- Each feeder agent has a distinct persona, so accounts never echo identical
  copy.
- Replies react to a specific detail of the target post (REPLY_RUBRIC), never
  generic "Great post!" — the spammiest reply pattern.

## What we deliberately do NOT do
- No fake engagement (mass-follow, like-for-like).
- No credential automation or session hijacking — X posts via the official
  OAuth2 API; IG/TikTok/LinkedIn via Zernio's official integrations.
- No link-spam in replies (URLs in replies are stripped — also a higher API
  bill on X and the #1 reply-spam flag).

## Still open / future
- Per-account daily-volume ceilings surfaced in the UI.
- Occasional "skip a day" randomness so cadence isn't perfectly periodic.
- Cross-post staggering (don't fire identical content to every platform in the
  same second).
