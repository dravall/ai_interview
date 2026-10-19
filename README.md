## AI Interviewer

A voice-driven mock technical interview. A candidate pastes their GitHub profile
URL, the app fetches their public repos for context, runs a live voice
interview over WebRTC, and grades the transcript when it's done.

### How it works

1. **Intake** — the frontend posts a GitHub profile URL; the backend fetches
   the user's repos from the GitHub REST API and stores them on a new
   `Interview` row (Postgres via Prisma).
2. **Interview** — a live speech-to-speech conversation with OpenAI's
   Realtime API (`gpt-realtime-2.1-mini` by default) over WebRTC. The backend
   mints a short-lived client secret (`POST /v1/realtime/client_secrets`)
   with the interview instructions, voice and turn detection baked in, so
   `OPENAI_API_KEY` never reaches the browser. The browser then does the SDP
   offer/answer with OpenAI directly using that secret, and relays the
   returned `call_id` to the backend, which opens a server-side "sideband"
   WebSocket on the same call to persist a text transcript of both sides.
   Server-side semantic VAD handles turn-taking and barge-in (talking over
   the interviewer cuts it off); the page has mute/unmute, and auto-reconnects
   (with backoff) if the call drops or the session expires — the new session
   is seeded with the transcript so far, so the interviewer picks up where it
   left off.
3. **Grading** — once the interview ends, the results page polls the backend
   every 5s. The backend sends the full transcript to Qwen via OpenRouter,
   constrained to a JSON schema (validated with Zod), and gets back a score out of 10 plus written
   feedback.

### Setup

```bash
bun install

# apps/backend: copy the env template and fill in real values, then migrate
cd apps/backend
cp .env.example .env   # set DATABASE_URL, OPENAI_API_KEY, OPENROUTER_API_KEY, PROXY_URL
bunx prisma migrate dev

# apps/frontend: only needed if the backend isn't on localhost:3001
cd ../frontend
cp .env.example .env

# from the repo root, run both apps
bun run dev
```

`bun install` also runs `prisma generate` automatically (`apps/backend`'s
`postinstall` script) so the generated Prisma client exists even before
`DATABASE_URL` is set.

**Environment variables** (`apps/backend/.env.example`):

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres connection string (Prisma) |
| `OPENAI_API_KEY` | OpenAI Realtime API — mints client secrets + sideband transcript capture. Server-only. (`OPENAI_KEY`, the old name, is still read as a fallback.) |
| `OPENAI_REALTIME_MODEL` | Optional Realtime model (default `gpt-realtime-2.1-mini`) |
| `OPENAI_REALTIME_VOICE` | Optional Realtime voice (default `marin`) |
| `OPENAI_REALTIME_NOISE_REDUCTION` | Optional. `far_field` (laptop/room mic, default) or `near_field` (headset) |
| `OPENAI_REALTIME_VAD` | Optional. `semantic` (default; lets the candidate pause) or `server` (loudness threshold, for noisy rooms) |
| `OPENROUTER_API_KEY` | OpenRouter — post-interview grading |
| `OPENROUTER_MODEL` | Optional grading model slug (default `qwen/qwen3.8-flash`) |
| `PROXY_URL` | HTTPS proxy for the GitHub scrape (`scrapers/github.ts`) |
| `GITHUB_TOKEN` | Optional. GitHub API token; raises the limit from 60 to 5,000 requests/hour |
| `INTAKE_RATE_LIMIT` | Optional. Interviews one IP can start per 15 minutes (default 5) |
| `FRONTEND_ORIGIN` | CORS allowlist — the origin allowed to call the API with credentials |
| `NODE_ENV` | `development` \| `production` — controls the session cookie's `secure` flag |
| `COOKIE_SAMESITE` | Set to `none` only for a cross-domain deployment (see Deployment below); leave unset for local dev |

**Environment variables** (`apps/frontend/.env.example`):

| Variable | Used for |
|---|---|
| `BUN_PUBLIC_BACKEND_URL` | Backend base URL, inlined into the client bundle at build/dev time (defaults to `http://localhost:3001` if unset) |

Each interview is scoped to an anonymous session cookie issued on first
contact with the backend — only the browser session that started an
interview can read its result or post to it.

### Testing

```bash
bun run check-types   # tsc --noEmit, both apps
bun run lint          # eslint, both apps
bun run test          # apps/backend: bun test
```

`apps/backend`'s test suite has two layers:
- **Unit tests** (`types.test.ts`, `result.test.ts`, `realtime.test.ts`, `sideband.test.ts`) — no network, no DB, run anywhere.
- **Integration tests** (`index.test.ts`) — hit the real Express app + Postgres via `supertest`, with `scrapers/github.ts` and `result.ts` mocked so no real GitHub/OpenRouter calls happen.

Locally the tests use a separate database, `ai_interviewer_test`, set in `apps/backend/.env.test` (Bun loads it automatically under `bun test`), so test rows never land in your dev data. Create and migrate it once, with Postgres running:

```bash
cd apps/backend && bun run test:setup
```

A real `DATABASE_URL` environment variable overrides `.env.test`; that's how CI points the tests at its own Postgres.

CI (`.github/workflows/ci.yml`) runs all of the above against a throwaway Postgres service container on every push/PR.

### Testing a live voice conversation

1. Start Postgres (`docker compose up -d postgres`, or any local Postgres) and
   run `bunx prisma migrate dev` in `apps/backend`.
2. Set `OPENAI_API_KEY` in `apps/backend/.env`, then `bun run dev` from the repo root.
3. Open http://localhost:3000 in Chrome/Edge/Firefox, paste a GitHub profile
   URL, and allow microphone access. Use headphones so the interviewer
   doesn't hear itself.
4. Check that:
   - the interviewer greets you first, and replies after you finish a sentence;
   - **barge-in**: talking over the interviewer stops it mid-sentence;
   - **mute**: while muted, nothing you say gets a reply;
   - **reconnect**: in DevTools → Network, go offline for ~10s and back — the
     page shows "Reconnecting…" and the interviewer resumes the same interview;
   - **End interview** releases the mic (the browser's mic indicator goes off)
     and the results page shows a transcript with both sides.

Backend logs show `Sideband connected (interview …, call rtc_…)` per call.
To sanity-check the key and model without a browser:

```bash
curl -X POST localhost:3001/api/v1/realtime/client-secret/<interviewId> -b "sid=<your sid cookie>"
# → { "clientSecret": "ek_…", "expiresAt": …, "model": "gpt-realtime-2.1-mini" }
```

### Deployment

Both apps have a `Dockerfile` (`apps/backend/Dockerfile`, `apps/frontend/Dockerfile`) — plain `bun install` + the existing `start` script, no host-specific config. Either builds anywhere that accepts a Dockerfile (Render, Fly.io, Railway, etc. all do); which host to actually use isn't decided yet.

For a local, prod-like smoke test of the full stack (Postgres + both apps, real migrations, real container boot):

```bash
cp apps/backend/.env.example apps/backend/.env   # fill in real API keys to exercise the full interview flow
docker compose up --build
```

This runs `bunx prisma migrate deploy` automatically on backend boot, so a fresh Postgres volume ends up fully migrated. `docker compose down -v` removes the throwaway volume when done.

**Cross-domain deployment note**: once frontend and backend live on different top-level domains (not just different ports/subdomains of the same one), set `COOKIE_SAMESITE=none` on the backend — this also forces the session cookie's `Secure` flag on, which requires HTTPS (true by default behind any real host's edge, not true for plain local/Docker HTTP testing — leave it unset there).

### Status

This started as a build-along of
[Harkirat Singh's AI Interviewer video](https://www.youtube.com/watch?v=iNJ7z4YLQFk),
extended since then — most notably a fix for a grading race condition where
concurrent result polls could each trigger a separate (paid) OpenRouter call.

`apps/backend/experiments/linkedin-scraper.js` is an unfinished, unwired
experiment — a Playwright-based LinkedIn profile scraper meant to eventually
complement the GitHub intake. It's not called from the running app.
