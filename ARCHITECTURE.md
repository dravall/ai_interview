# AI Interviewer — Architecture

> Part of the project report set: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) (full analysis) · **ARCHITECTURE.md** (this file) · [INTERVIEW-PREP.md](INTERVIEW-PREP.md) · [LEARNING-PATH.md](LEARNING-PATH.md)
>
> Written 2026-10-19 from a direct read of the repository; **updated 2026-10-20** to match the code after the fixes logged in [PROJECT-HISTORY.md](PROJECT-HISTORY.md). Labels used: **[Confirmed]** = read in code/config; **[Inferred]** = reasoned from code; **[Unknown]** = not enough evidence.

---

## 1. The system in one picture

```text
                         ┌──────────────────────────────────────────────┐
                         │                 BROWSER                      │
                         │  apps/frontend  (React 19 SPA, Tailwind 4)   │
                         │                                              │
                         │  "/"  Form.tsx ── axios ──────────────┐      │
                         │  "/interview/:id"  Interview.tsx      │      │
                         │      │  lib/realtime.ts               │      │
                         │      │   ├─ axios ───────────────────┐│      │
                         │      │   └─ fetch(SDP) ─────────┐    ││      │
                         │      └─ mic (getUserMedia)      │    ││      │
                         │  "/result/:id"  Result.tsx ─ axios (poll 5s) │
                         └───────────────┬─────────────────┼────┼┼──────┘
                    audio (WebRTC/SRTP)  │                 │    ││  HTTP + "sid" cookie
                    + "oai-events" data  │                 │    ││
                    channel              ▼                 ▼    ▼▼
   ┌──────────────────────────────────────────────┐   ┌──────────────────────────────────────┐
   │        OpenAI Realtime API                    │   │  apps/backend  (Bun + Express 5)     │
   │  model: gpt-realtime-2.1-mini (default)       │   │  index.ts                            │
   │  POST /v1/realtime/calls  (SDP, ephemeral key)│   │   cors → headers → cookies → json →  │
   │  wss  /v1/realtime?call_id=… (sideband)       │◄──┤   ensureSession → routes             │
   │  POST /v1/realtime/client_secrets             │◄──┤  realtime.ts  (client secrets,       │
   └──────────────────────────────────────────────┘   │               instructions)          │
                    ▲  transcripts (events)           │  sideband.ts  (server WebSocket)     │
                    └─────────────────────────────────┤  scrapers/github.ts ──► api.github.com
                                                      │  result.ts ──────────► OpenRouter    │
                                                      │  db.ts (Prisma) ──┐    (Qwen grading)│
                                                      └───────────────────┼──────────────────┘
                                                                          ▼
                                                              ┌───────────────────────┐
                                                              │ PostgreSQL 16         │
                                                              │ Interview, Message    │
                                                              └───────────────────────┘
```

**There is no Redis, no queue, no worker process, and no WebSocket server of our own.** [Confirmed: no such dependencies in either `package.json`; the only WebSocket is the backend's *outbound* client connection to OpenAI in `sideband.ts`.] The "background work" in this system is:

1. The **sideband socket** (`apps/backend/sideband.ts`), which is a long-lived outbound WebSocket opened per call, and
2. **Grading**, which runs *inline* inside the `GET /api/v1/result/:id` request handler, once the interview has `Ended`.

---

## 2. Layered view (adapted to what actually exists)

```text
User (candidate, anonymous — no login)
 ↓
Frontend SPA (apps/frontend/src) — 3 routes, react-router 7
 ↓  HTTPS/JSON via axios (withCredentials → "sid" cookie)
Express API (apps/backend/index.ts)
 ↓  middleware: [trust proxy] → cors → security headers → cookie-parser → express.json → ensureSession → [rateLimit] → [requireOwner]
Route handlers (inline in index.ts — no controller/service split)
 ↓
"Service" modules: realtime.ts · sideband.ts · scrapers/github.ts · result.ts
 ↓
Postgres via Prisma (db.ts)        External: GitHub REST · OpenAI Realtime · OpenRouter
 ↓
(No workers.) Long-lived sideband WebSocket per live call writes Message rows as events arrive.
```

---

## 3. Components — what each one is and why it exists

### 3.1 Frontend SPA — `apps/frontend`
| | |
|---|---|
| **What** | React 19 single-page app served by `Bun.serve()` (`src/index.ts`) using Bun's HTML imports + `bun-plugin-tailwind`. |
| **Why it exists** | The browser is the only place that can capture the microphone and play audio. It also owns the WebRTC peer connection. |
| **Responsibilities** | Intake form → create interview; open the voice call; show live speaking state, mute, reconnect; show results. |
| **Talks to** | Backend (axios, `src/lib/api.ts`, cookie credentials), OpenAI (`fetch` SDP + WebRTC media, `src/lib/realtime.ts`). |
| **In** | User's GitHub URL, microphone audio, AI audio track, JSON from backend. |
| **Out** | `POST` requests, mic audio to OpenAI, rendered UI. |
| **If removed** | No way to use the product; the backend has no UI. |

### 3.2 Backend API — `apps/backend/index.ts`
| | |
|---|---|
| **What** | One Express 5 app (≈ 330 lines) run with Bun, listening on port 3001. Exported as `app` so tests can drive it with supertest. |
| **Why** | Holds secrets (OpenAI, OpenRouter, DB), enforces ownership, persists data, calls paid APIs on the user's behalf. |
| **Routes** | `POST /api/v1/pre-interview`, `POST /api/v1/realtime/client-secret/:interviewId`, `POST /api/v1/realtime/sideband/:interviewId`, `POST /api/v1/interview/:interviewId/end`, `POST /api/v1/result/:interviewId/retry`, `GET /api/v1/result/:interviewId`. |
| **Talks to** | Postgres, GitHub, OpenAI, OpenRouter. |
| **If removed** | API keys would have to live in the browser (insecure), and there'd be no persistence or grading. |

### 3.3 Realtime session module — `apps/backend/realtime.ts`
| | |
|---|---|
| **What** | Mints short-lived OpenAI Realtime **client secrets** (`POST /v1/realtime/client_secrets`, TTL 120 s), builds the interviewer's system instructions, validates call IDs, hashes the session ID into an `OpenAI-Safety-Identifier`. |
| **Why** | Lets the browser connect directly to OpenAI over WebRTC **without ever seeing `OPENAI_API_KEY`**. Fixes model, voice, VAD and instructions server-side so the client can't choose them. |
| **In → Out** | Interview's GitHub JSON + prior messages → `{ value: "ek_…", expires_at }`. |
| **If removed** | No voice call can start. |

### 3.4 Sideband — `apps/backend/sideband.ts`
| | |
|---|---|
| **What** | A server-side WebSocket (`ws` package) to `wss://api.openai.com/v1/realtime?call_id=…`, attached to the *same* call the browser is in. |
| **Why** | Over WebRTC the browser only receives **audio** for the AI's side. The server needs **text** for grading, so it listens to events on a second channel: `conversation.item.added` (when each turn was spoken), `conversation.item.input_audio_transcription.completed` (candidate) and `response.done` (interviewer's audio transcript). |
| **State** | In-memory `Map<interviewId, Sideband>`: the socket, pending saves, item times, reconnect state. A browser reconnect replaces the previous entry. |
| **Failure handling** | A dropped socket reconnects to the same call (1 s, 2 s, 4 s); after that, a 30 s grace for the browser to reconnect, then the interview is ended. `endInterview()` waits for the call to close and for in-flight saves before marking it `Ended`. |
| **Out** | `Message` rows in Postgres, upserted by OpenAI item id (idempotent), timed by when each turn was spoken. |
| **If removed** | Calls still work, but transcripts are empty → grading has nothing to grade. |

### 3.5 GitHub scraper — `apps/backend/scrapers/github.ts`
| | |
|---|---|
| **What** | One `GET https://api.github.com/users/{username}/repos?per_page=100&sort=updated`, authenticated with `GITHUB_TOKEN` if set, optionally through `PROXY_URL` (`https-proxy-agent`). Keeps `name`, `full_name`, `description`, `stargazers_count`. Errors become a typed `GithubLookupError` (`not-found`, `rate-limited`, `unavailable`). |
| **Why** | Gives the interviewer something personal to ask about. |
| **If removed** | Interviews become generic. |
| **Limits [Confirmed]** | Up to 100 most recently updated repos (no pagination beyond that). Without a token, GitHub's unauthenticated limit applies (60 req/hour/IP; 5,000 with a token). **[Inferred]** `PROXY_URL` predates the token option and exists to get around that per-IP limit. |

### 3.6 Grader — `apps/backend/result.ts`
| | |
|---|---|
| **What** | Sends the transcript to OpenRouter (`qwen/qwen3.8-flash` by default, `OPENROUTER_MODEL` overrides): a rubric as the system message, the transcript inside `<transcript>` tags as data, and a strict JSON schema `{feedback: string, score: integer}`. Validates with Zod (`score` 0–10). An interview with no candidate answers scores 0 without a model call. |
| **Why** | Turns a conversation into a score and written feedback. |
| **If removed** | Interviews would end but never be graded. |

### 3.7 Database — Postgres via Prisma 7 (`db.ts`, `prisma/schema.prisma`)
Two tables, `Interview` (1) → `Message` (N). Prisma 7 uses the `@prisma/adapter-pg` driver adapter (the `pg` package) instead of the legacy Rust engine. Generated client lives in `apps/backend/generated/prisma` (regenerated by `postinstall`). Full detail in [PROJECT-DEEP-DIVE.md §9](PROJECT-DEEP-DIVE.md#9-database-deep-dive).

### 3.8 External services
| Service | Called from | Purpose | Auth |
|---|---|---|---|
| GitHub REST API | backend `scrapers/github.ts` | candidate repo list | optional `GITHUB_TOKEN` (optional proxy) |
| OpenAI `client_secrets` | backend `realtime.ts` | mint ephemeral key | `OPENAI_API_KEY` |
| OpenAI `realtime/calls` | **browser** `lib/realtime.ts` | SDP offer/answer | ephemeral `ek_…` key |
| OpenAI WebRTC media | **browser** | mic audio up, AI audio down, `oai-events` data channel | negotiated via SDP |
| OpenAI sideband `wss` | backend `sideband.ts` | transcript events | `OPENAI_API_KEY` |
| OpenRouter chat completions | backend `result.ts` | grading | `OPENROUTER_API_KEY` |
| Google Fonts | browser (`index.html`) | Geist / Geist Mono | none |

---

## 4. The most important flow: a full interview, end to end

```text
1. User pastes "github.com/octocat" and clicks Start interview
        ↓  Form.tsx parseGithubProfile() → "https://github.com/octocat"
2. POST /api/v1/pre-interview  { github }                     (axios, cookie)
        ↓  cors → cookie-parser → json → ensureSession (issues "sid" cookie if missing)
        ↓  preInterviewLimiter (5 / 15 min / IP)
        ↓  Zod PreInterviewBody (string, max 200) → parseGithubUsername (400 if not a profile)
        ↓  scrapeGithub(username)  ──► api.github.com/users/octocat/repos?per_page=100&sort=updated
        ↓      (unknown user → 404, rate limit/outage → 503)
        ↓  prisma.interview.create({ githubMetadata, status: "Pre", ownerId: sid })
        ↓  ← { id }
3. navigate("/interview/:id")  → Interview.tsx useEffect → connect()
        ↓  getUserMedia({audio})               (browser mic permission prompt)
        ↓  connectRealtime()  (lib/realtime.ts)
4. POST /api/v1/realtime/client-secret/:id
        ↓  ensureSession → clientSecretLimiter (10 / 15 min / IP) → requireOwner (ownerId === sid)
        ↓  load interview + prior messages (ordered by createdAt)
        ↓  buildInstructions(githubMetadata, prior)  → system prompt
        ↓  createClientSecret()  ──► OpenAI POST /v1/realtime/client_secrets
        ↓      session = { model, instructions, voice "marin",
        ↓                  input transcription gpt-4o-mini-transcribe, noise reduction far_field,
        ↓                  turn_detection semantic_vad (eagerness low) + interrupt_response }
        ↓  ← { clientSecret: "ek_…", expiresAt, model }   (Cache-Control: no-store)
5. Browser: RTCPeerConnection + addTrack(mic) + createDataChannel("oai-events")
        ↓  createOffer → POST https://api.openai.com/v1/realtime/calls (Bearer ek_…)
        ↓  ← SDP answer + Location: /v1/realtime/calls/rtc_…   (CORS exposes Location)
        ↓  setRemoteDescription(answer)
6. POST /api/v1/realtime/sideband/:id  { callId: "rtc_…" }
        ↓  sidebandLimiter (20 / 15 min / IP) → requireOwner → isValidCallId (regex ^rtc_[A-Za-z0-9_-]{1,128}$)
        ↓  status → InProgress
        ↓  initSideband(callId, id)  ──► wss://api.openai.com/v1/realtime?call_id=rtc_…
        ↓  ← 204
7. Data channel opens → browser sends {type:"response.create"} → interviewer speaks first
        ↓  mic stays off until the greeting has finished playing (output_audio_buffer.stopped),
        ↓  so speaker echo can't interrupt it
        ↓  (conversation runs; OpenAI's VAD handles turns and barge-in)
        ↓  sideband receives events:
        ↓    conversation.item.added → remember when the turn was spoken
        ↓    input_audio_transcription.completed → upsert Message{type: User, itemId, createdAt: spokenAt}
        ↓    response.done (output_audio transcript) → upsert Message{type: Assistant, itemId, createdAt: spokenAt}
8. User clicks End interview
        ↓  finalizeTranscript(): input_audio_buffer.commit (transcribe a half-finished answer), wait ≤ 3 s
        ↓  stopRef(): close pc + data channel, stop mic, close AudioContext
        ↓  POST /api/v1/interview/:id/end → wait ≤ 5 s for the call to close + pending saves → status Ended
        ↓  navigate("/result/:id")
9. Result.tsx: GET /api/v1/result/:id now, then every 5 s
        ↓  requireOwner
        ↓  atomic claim  UPDATE … SET status='Grading', gradingStartedAt=now, gradingAttempts+1
        ↓               WHERE status='Ended' OR (Failed AND attempts < 3) OR (Grading AND lease stale)
        ↓     claim won  → calculateResult(messages ordered by createdAt) ──► OpenRouter → Zod parse
        ↓                  → status Done + score + feedback   (or Failed on error; written only while
        ↓                    this attempt still holds the lease)
        ↓     claim lost → report the current status
        ↓  ← { score, feedback, transcript[], status }
10. UI shows score /10, feedback paragraphs, transcript.
```

### Reconnect sub-flow (inside step 7)
```text
pc.connectionState == "failed"  or  data channel closes  or  error event code contains "expired"
        ↓  handleDrop(): close old connection, attempts++
        ↓  attempts ≤ 3 → status "reconnecting", wait 1s / 2s / 4s → connect() again (steps 4–7)
        ↓      new client secret includes "## Interview so far" + replayed transcript
        ↓  attempts > 3 or mic error → status "error" (Try again / Back to start)
```

### Interview lifecycle (`Interview.status`)
```text
            sideband attached                 End clicked, or call lost and
  Pre ─────────────────────────► InProgress ──not resumed (30 s grace), or ──► Ended
   │                               ▲          idle 60 s with no live call       │
   └── idle 60 s, no live call ────┼───────────────────────────────────────────►│
                                   └──── browser reconnects (Ended → InProgress)│
                                                                                │ results poll claims
                         ┌──────── lease older than 2 min: re-claim ───────┐    ▼
                         │                                                 └─ Grading ──► Done
                         │                                                       │
   Failed ◄──────────────┴───────────────── grading error ◄──────────────────────┘
     │  attempts < 3: next poll re-claims (shown to the user as "Grading")
     └─ attempts = 3: user clicks Try again → POST /retry → Ended (attempts reset to 0)
```
Every transition is a conditional `updateMany`, so two requests racing for the same transition can't both win.

---

## 5. Repository structure and dependency map

```text
ai-interviewer/                      Turborepo + Bun workspaces monorepo
├── package.json                     workspaces: apps/*, packages/*; turbo scripts
├── turbo.json                       task graph + globalEnv list (lint rule checks it)
├── bun.lock                         the real lockfile
├── docker-compose.yml               postgres + backend + frontend
├── .dockerignore                    excludes node_modules, build output and every .env (keeps .env.example)
├── .github/workflows/ci.yml         install → migrate → types → lint → test (Postgres service)
├── README.md                        current
├── PROJECT-HISTORY.md               what changed, when, and how it was verified
├── HIRING_COMMITTEE_REVIEW.md       HISTORICAL (Aug 2026), marked as such; describes an older version
├── ai-interview-kickstart-redesign/ design handoff (spec + reference HTML), not used at runtime
├── apps/
│   ├── backend/
│   │   ├── index.ts                 ★ entry point: Express app, all routes, middleware
│   │   ├── realtime.ts              ★ client secrets, interviewer prompt, call-id validation
│   │   ├── sideband.ts              ★ transcript capture WebSocket
│   │   ├── result.ts                ★ grading via OpenRouter
│   │   ├── scrapers/github.ts       GitHub repo fetch
│   │   ├── db.ts                    Prisma client singleton
│   │   ├── types.ts                 Zod body schema, GitHub username parser, Request augmentation
│   │   ├── prisma/schema.prisma     ★ data model;  prisma/migrations/* (8 migrations)
│   │   ├── prisma.config.ts         Prisma CLI config (uses dotenv)
│   │   ├── generated/prisma/        GENERATED client — ignore
│   │   ├── *.test.ts                bun:test suites (47 tests)
│   │   ├── .env.test, scripts/setup-test-db.ts   separate test database
│   │   ├── experiments/linkedin-scraper.js   standalone experiment, labelled, not wired in
│   │   └── Dockerfile
│   └── frontend/
│       ├── src/index.ts             Bun.serve(): serves index.html for /*
│       ├── src/index.html           HTML shell, fonts, theme script
│       ├── src/frontend.tsx         React root
│       ├── src/App.tsx              ★ routes
│       ├── src/components/Form.tsx        ★ "/"
│       ├── src/components/Interview.tsx   ★ "/interview/:id" (call lifecycle)
│       ├── src/components/Result.tsx      ★ "/result/:id"
│       ├── src/components/interview/{VoiceTile,StatusPill}.tsx
│       ├── src/components/Brand.tsx, src/components/ui/* (shadcn)
│       ├── src/hooks/{useVoiceLevel,useMediaQuery}.ts
│       ├── src/lib/realtime.ts      ★ WebRTC + SDP + sideband registration
│       ├── src/lib/{api,config,utils}.ts
│       ├── styles/globals.css       theme tokens (light/dark), halo CSS
│       ├── build.ts                 production bundle script (template)
│       └── Dockerfile
└── packages/
    ├── eslint-config/               USED by both apps (base, react-internal)
    └── typescript-config/           not extended by either app's tsconfig [Confirmed]
```

### Who depends on whom

```text
frontend/App.tsx ─► Form.tsx ─► lib/api.ts ─► lib/config.ts (BUN_PUBLIC_BACKEND_URL)
                 ├► Interview.tsx ─► lib/realtime.ts ─► lib/api.ts
                 │                 ├► interview/VoiceTile.tsx ─► hooks/useVoiceLevel.ts
                 │                 ├► interview/StatusPill.tsx
                 │                 └► hooks/useMediaQuery.ts
                 └► Result.tsx ─► lib/api.ts
(all) ─► components/ui/* ─► lib/utils.ts (cn)      styles/globals.css ◄─ index.css ◄─ index.html

backend/index.ts ─► types.ts (Zod)          ─► db.ts ─► generated/prisma (◄ schema.prisma)
                 ├► scrapers/github.ts ─► axios, https-proxy-agent
                 ├► realtime.ts (fetch → OpenAI)
                 ├► sideband.ts ─► realtime.ts (getOpenAIKey), db.ts, ws
                 └► result.ts (fetch → OpenRouter), zod

both apps' eslint.config.js ─► packages/eslint-config
turbo.json globalEnv ◄─ checked by eslint-plugin-turbo (no-undeclared-env-vars)
```

---

## 6. Runtime topology and state

| State | Where it lives | Survives restart? | Shared across instances? |
|---|---|---|---|
| Interviews, messages, scores | Postgres | yes | yes |
| Session identity | `sid` cookie (random UUID) in the browser | yes (30 days) | yes |
| Rate-limit counters | `express-rate-limit` default **in-memory** store, one per endpoint | **no** | **no** |
| Active sideband sockets, reconnect and end timers | `Map`s in `sideband.ts` | **no**: a backend restart drops transcript capture for live calls (idle recovery later ends the interview) | **no** |
| Grading lock | `status = Grading` + `gradingStartedAt` lease in Postgres | yes (a stale lease is re-claimed) | yes |
| Live call (audio, conversation context) | OpenAI | n/a | n/a |
| Mic stream, AudioContext, peer connection | browser refs in `Interview.tsx` | no | n/a |

**[Inferred] Consequence:** the backend is effectively single-instance. Running two replicas would split rate-limit counters, and a sideband registered on replica A can't be replaced by a reconnect that lands on replica B (the old socket wouldn't be closed). See [PROJECT-DEEP-DIVE.md §21](PROJECT-DEEP-DIVE.md#21-scale-analysis).

---

## 7. Deployment picture

```text
Developer machine
 ↓ git push → github.com/dravall/ai_interview (main)
GitHub Actions  .github/workflows/ci.yml   on push to main / PR (green since 610326d)
 ↓  bun install → prisma migrate deploy (Postgres 16 service) → check-types → lint → test
Build  (no image build/publish step in CI)
 ↓
Deployment  — [Unknown/not decided]: README says "which host to actually use isn't decided yet"
 ↓
Local "prod-like":  docker compose up --build
      postgres:16 (volume) ─► backend (oven/bun:1.3.11, runs `prisma migrate deploy` then `bun index.ts`)
                           ─► frontend (oven/bun:1.3.11, `NODE_ENV=production bun src/index.ts`)
```

Next: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) for the full forensic analysis.
