# AI Interviewer — Learning Path

> Report set: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [INTERVIEW-PREP.md](INTERVIEW-PREP.md) · **LEARNING-PATH.md** (this file)
>
> Work through these in order. Each step has a simple explanation, a technical one, a concrete example from this repo, the files to open, and an exercise. Answers to the exercises are at the end. Budget roughly a day for all 15.

---

## 1. Product problem
- **Simple:** practising interviews alone is hard; this gives you a patient interviewer who asks about your own projects and then grades you.
- **Technical:** a short, personalised, speech-to-speech session with an LLM, followed by an asynchronous LLM evaluation of the transcript.
- **Example:** the interviewer prompt in `realtime.ts` says "2–3 questions in total, each anchored in a specific repo".
- **Open:** `README.md`, `apps/backend/realtime.ts` (`buildInstructions`).
- **Exercise 1:** In one sentence each, name the three AI calls the product makes and what each is for.

## 2. User workflow
- **Simple:** paste link → talk → read score.
- **Technical:** three routes: `/` creates an `Interview`; `/interview/:id` runs the call; `/result/:id` polls for grading.
- **Example:** `App.tsx` maps those three routes to `Form`, `Interview`, `Result`.
- **Open:** `apps/frontend/src/App.tsx`, then skim each component's JSX.
- **Exercise 2:** Which screen first causes money to be spent on OpenAI, and which on OpenRouter?

## 3. Architecture
- **Simple:** a website, a server that keeps secrets and saves things, a database, and three outside services. The voice goes straight from your browser to OpenAI.
- **Technical:** two-tier SPA + API. The media plane (WebRTC, browser↔OpenAI) is separate from the control/data plane (HTTP to the API, plus the server's sideband WebSocket to OpenAI).
- **Example:** [ARCHITECTURE.md §1](ARCHITECTURE.md#1-the-system-in-one-picture).
- **Open:** `ARCHITECTURE.md`.
- **Exercise 3:** Draw the diagram from memory, marking which arrows carry audio and which carry the API key.

## 4. Repository structure
- **Simple:** `apps/` holds the two programs; `packages/` holds shared settings.
- **Technical:** Turborepo + Bun workspaces. Only `packages/eslint-config` is actually consumed; `packages/ui` and `typescript-config` are unused scaffolding.
- **Example:** `apps/backend/eslint.config.js` imports `@repo/eslint-config/base`.
- **Open:** root `package.json`, `turbo.json`.
- **Exercise 4:** Why does adding a new env var without updating `turbo.json` fail lint?

## 5. Frontend
- **Simple:** three screens; the live one shows two circles that glow when someone talks.
- **Technical:** React 19 with local state only. `Interview.tsx` owns the call lifecycle in one `useEffect` using refs plus closures (`retryRef`, `stopRef`). Audio levels go through `AnalyserNode` → `useVoiceLevel` → CSS variable, avoiding per-frame re-renders.
- **Example:** `createLevelMeter` computes RMS: `sqrt(mean(((byte-128)/128)^2)) * 3.2`.
- **Open:** `src/components/Interview.tsx`, `src/lib/realtime.ts`, `src/hooks/useVoiceLevel.ts`, `src/components/interview/VoiceTile.tsx`.
- **Exercise 5:** What prevents a dropped connection from scheduling two reconnects at once?

## 6. API
- **Simple:** four doors into the server: create interview, get a voice key, register the transcript listener, get results.
- **Technical:** Express 5 with middleware order `cors → cookieParser → json → ensureSession → rateLimit → requireOwner → handler`. Express 5 forwards rejected async handlers to the default error handler (500).
- **Example:** `POST /api/v1/realtime/client-secret/:interviewId` returns `{ clientSecret, expiresAt, model }` with `Cache-Control: no-store`.
- **Open:** `apps/backend/index.ts`, `apps/backend/realtime.ts`.
- **Exercise 6:** What HTTP status does a user get if GitHub says the username doesn't exist, and why?

## 7. Database
- **Simple:** one row per interview; one row per spoken turn.
- **Technical:** Prisma 7 with the `pg` driver adapter. `Interview` 1—N `Message`; enum state machine `Pre → Grading → Done | Failed`; JSONB GitHub payload; only primary-key indexes.
- **Example:** migration `20260821120000_add_grading_failed_status` added `Grading` and `Failed` for the race fix.
- **Open:** `prisma/schema.prisma`, the 5 folders in `prisma/migrations/`, `db.ts`.
- **Exercise 7:** Write the SQL that Prisma's `updateMany({ where: { id, status: "Pre" }, data: { status: "Grading" } })` roughly becomes, and explain why it's safe under concurrency.

## 8. Authentication
- **Simple:** no accounts; your browser gets a secret ticket (cookie), and only that ticket can see your interviews.
- **Technical:** random UUID `sid` cookie (HttpOnly, SameSite=Lax, Secure in prod, 30 days); `ownerId` column; `requireOwner` returns 404/403; legacy NULL owners are open.
- **Example:** integration test "a different session is forbidden from reading someone else's result".
- **Open:** `index.ts` (`ensureSession`, `requireOwner`), `types.ts` (Request augmentation), `index.test.ts`.
- **Exercise 8:** If you deploy the frontend and backend on two unrelated domains, which env var must change and what else does it force?

## 9. Background processing
- **Simple:** there's no separate worker; the server listens to the call while it happens and grades when you first open the results.
- **Technical:** sideband WebSocket per call (in-memory map) plus lazy grading inside `GET /result`, protected by an atomic claim. No queue, so nothing survives a restart.
- **Example:** `sideband.ts` saves a `User` message on `conversation.item.input_audio_transcription.completed`.
- **Open:** `apps/backend/sideband.ts`, the result route in `index.ts`, `result.ts`.
- **Exercise 9:** The backend restarts while a candidate is mid-interview. What still works and what's lost?

## 10. Real-time architecture
- **Simple:** your voice and the AI's voice travel over a direct, live connection; the server listens in on a side channel to write things down.
- **Technical:**
  1. The client secret pins the session config.
  2. The browser posts its SDP offer to `/v1/realtime/calls` and reads the call id from `Location` (exposed by OpenAI's CORS).
  3. The server attaches the sideband by `call_id`.
  4. Server VAD with `interrupt_response` gives barge-in.
  5. The browser sends `response.create` so the AI speaks first.
- **Example:** `lib/realtime.ts` creates `createDataChannel("oai-events")` *before* `createOffer()`, so the data channel is part of the SDP.
- **Open:** `src/lib/realtime.ts`, `apps/backend/realtime.ts`, `apps/backend/sideband.ts`.
- **Exercise 10:** Why can't the browser just send the transcript to the backend itself?

## 11. Security
- **Simple:** the real keys never leave the server; the browser only gets a key that dies in 2 minutes.
- **Technical:** ephemeral client secrets, server-pinned config, call-id regex, hashed safety identifier, CORS allowlist, rate limits.
- **Gaps:** `.env` in Docker images (B1), grader injection (B5), no headers, cost exposure (B10).
- **Example:** `isValidCallId` rejects `rtc_abc&model=x` (tested in `realtime.test.ts`).
- **Open:** `realtime.ts`, `.dockerignore`, `PROJECT-DEEP-DIVE.md §10`.
- **Exercise 11:** Show the change to `.dockerignore` that fixes B1 without excluding `.env.example`.

## 12. Testing
- **Simple:** small automatic checks run on every push, including against a real database.
- **Technical:** bun:test unit tests (Zod, grader parsing, realtime helpers) plus supertest integration tests with `mock.module` for GitHub and grading, `describe.skipIf(!DATABASE_URL)`, run in CI with a Postgres service.
- **Example:** `result.test.ts` swaps `globalThis.fetch` to simulate OpenRouter responses.
- **Open:** `apps/backend/*.test.ts`, `.github/workflows/ci.yml`.
- **Exercise 12:** Sketch a test proving two concurrent `GET /result` calls only grade once.

## 13. Deployment
- **Simple:** there's a recipe (Docker) to run everything together, but no live website yet.
- **Technical:** `oven/bun:1` images copy the whole monorepo; the backend runs `prisma migrate deploy` on boot; compose wires Postgres → backend → frontend; the frontend backend-URL is inlined via `BUN_PUBLIC_*`.
- **Example:** `docker-compose.yml` overrides `DATABASE_URL` to the `postgres` service hostname.
- **Open:** `docker-compose.yml`, `apps/*/Dockerfile`, `.dockerignore`, `apps/frontend/bunfig.toml`.
- **Exercise 13:** Why does compose leave `NODE_ENV` unset for the backend? (Read the comment.)

## 14. Tradeoffs
- **Simple:** every shortcut saved time and has a cost.
- **Technical:**
  - grade-on-read vs. job queue;
  - client secrets vs. SDP relay;
  - anonymous cookies vs. accounts;
  - Express vs. `Bun.serve`;
  - monorepo scaffolding vs. app size.
- **Example:** [PROJECT-DEEP-DIVE.md §19–20](PROJECT-DEEP-DIVE.md#19-why-did-the-developer-do-this).
- **Exercise 14:** Argue *for* the current grade-on-read design in two sentences, then *against* it in two.

## 15. Weaknesses
- **Simple:** it works for a demo, but has a few real bugs and isn't ready for strangers on the internet.
- **Technical:** B1–B13 and D1–D2 in [PROJECT-DEEP-DIVE.md §18](PROJECT-DEEP-DIVE.md#18-bugs-technical-debt--architectural-problems); the top five are B1, B2, B3, B5, B10.
- **Exercise 15:** Pick the three fixes you'd ship first, and justify the order by risk × effort.

---

## Exercise answers

1. **Three AI calls:** OpenAI Realtime runs the spoken interview; Realtime input transcription (`gpt-4o-mini-transcribe`, inside the same session) turns the candidate's speech into text; OpenRouter (Qwen) grades the transcript.
2. **Where money is spent:** OpenAI spending starts on `/interview/:id` (client secret, then the call). OpenRouter spending starts on `/result/:id` (the first poll triggers grading). The GitHub call on `/` is free but rate-limited.
3. **The diagram:** audio arrows are browser ↔ OpenAI only. The real API key is on the backend → OpenAI arrows (`client_secrets` and the sideband). The browser → OpenAI SDP request carries only the ephemeral `ek_…` key.
4. **Why lint fails:** `eslint-plugin-turbo`'s `no-undeclared-env-vars` rule warns, and lint runs with `--max-warnings 0`.
5. **No double reconnect:** the `generation` counter in `Interview.tsx`. `handleDrop` ignores any failure whose `gen` isn't the current one and bumps it once handled.
6. **Unknown GitHub user:** a 500. axios throws on GitHub's 404, the route has no try/catch, and Express 5's default handler returns 500.
7. **The SQL:** `UPDATE "Interview" SET status='Grading' WHERE id=$1 AND status='Pre';` A single statement is atomic, and once one transaction changes the row, the other's `WHERE status='Pre'` no longer matches, so it updates 0 rows.
8. **Cross-domain deploy:** set `COOKIE_SAMESITE=none`. That forces `Secure`, which requires HTTPS. Also set `FRONTEND_ORIGIN` and `BUN_PUBLIC_BACKEND_URL` to the real URLs.
9. **Backend restart mid-interview:** the voice call keeps working (it's browser ↔ OpenAI). The sideband socket is lost, so later turns aren't saved, and rate-limit counters reset.
10. **Why the server listens itself:** the browser only receives AI *audio* over WebRTC; and anything the browser sends could be forged, which matters because the transcript is graded.
11. **The `.dockerignore` fix:** add `**/.env*` and `!**/.env.example`. That's two lines; `.dockerignore` supports `!` exceptions.
12. **Concurrency test:** mock `calculateResult` with a counter and a delay, create an interview, fire `Promise.all([agent.get(url), agent.get(url)])`, then assert `counter === 1` and one response says `Grading`.
13. **`NODE_ENV` unset:** `production` would make the session cookie `Secure`, and the browser talks plain HTTP to the container, so the cookie wouldn't persist.
14. **Grade-on-read, for:** no worker or queue to run, and grading happens exactly when the user asks. **Against:** a slow paid LLM call inside a `GET`, and it can grade before the final transcript lands.
15. **Suggested order:** B1 (minutes of effort, high risk) → B3 + B4 (one-line `orderBy` plus error handling, visible correctness) → B2 (an explicit end endpoint, fixes grading accuracy). B5 is a close fourth.

---

## File-by-file learning map

### Must understand
| File | Why |
|---|---|
| `apps/backend/index.ts` | Every route, middleware order, session and ownership logic, and the grading claim. The heart of the backend. |
| `apps/backend/realtime.ts` | How the browser gets a voice session without your key; the interviewer prompt; call-id validation. |
| `apps/backend/sideband.ts` | How transcripts are captured; the most "distributed-systems" file in the repo. |
| `apps/backend/result.ts` | Structured LLM output and its failure modes. |
| `apps/backend/prisma/schema.prisma` | The data model and state machine. |
| `apps/frontend/src/lib/realtime.ts` | The WebRTC/SDP handshake and call-id relay. |
| `apps/frontend/src/components/Interview.tsx` | Call lifecycle, reconnects, mute, cleanup. |

### Should understand
| File | Why |
|---|---|
| `apps/backend/scrapers/github.ts` | Intake data and its limits (30 repos, no token, proxy). |
| `apps/backend/types.ts` | Zod body schema; how `req.sessionId` gets typed. |
| `apps/backend/index.test.ts`, `result.test.ts`, `realtime.test.ts` | What's proven and how mocking is done. |
| `apps/frontend/src/components/Result.tsx` | Polling and result rendering. |
| `apps/frontend/src/components/Form.tsx` | Input normalisation and error states. |
| `apps/frontend/src/hooks/useVoiceLevel.ts`, `components/interview/VoiceTile.tsx` | Smoothing and debounce maths for speaking indicators. |
| `prisma/migrations/*` | How the schema evolved (good interview story). |
| `.github/workflows/ci.yml`, `docker-compose.yml`, `.dockerignore`, `apps/*/Dockerfile` | Delivery story and the B1 bug. |
| `turbo.json`, root `package.json` | Monorepo wiring and env declarations. |

### Can skim
| File | Why |
|---|---|
| `apps/backend/db.ts`, `prisma.config.ts` | Boilerplate Prisma setup. |
| `apps/frontend/src/components/interview/StatusPill.tsx`, `Brand.tsx`, `hooks/useMediaQuery.ts` | Small presentational pieces. |
| `apps/frontend/styles/globals.css`, `src/index.html`, `src/index.css` | Theme tokens and the dark-mode script. |
| `apps/frontend/src/lib/{api,config,utils}.ts`, `src/frontend.tsx`, `src/App.tsx` | A few lines each. |
| `README.md` | Accurate summary; read once. |
| `ai-interview-kickstart-redesign/DESIGN_SPEC.md` | Explains the UI decisions if asked about design. |

### Ignore initially
| File | Why |
|---|---|
| `apps/backend/generated/prisma/**` | Generated client. |
| `apps/frontend/src/components/ui/*` | shadcn primitives. |
| `apps/frontend/src/index.ts` `/api/hello` routes, `build.ts` | Bun template leftovers. |
| `packages/ui`, `packages/typescript-config`, `packages/eslint-config/next.js` | Unused scaffolding. |
| `apps/backend/experiments/linkedin-scraper.js`, `image.png` | Unwired experiment and its output. |
| `HIRING_COMMITTEE_REVIEW.md` | Stale (describes an older version). Read only to understand what changed. |
| `bun.lock`, `apps/backend/pnpm-lock.yaml`, `.turbo/`, `node_modules/` | Tooling artifacts. |

---

Back to: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [INTERVIEW-PREP.md](INTERVIEW-PREP.md)
