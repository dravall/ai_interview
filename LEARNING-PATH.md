# AI Interviewer — Learning Path

> Report set: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [INTERVIEW-PREP.md](INTERVIEW-PREP.md) · **LEARNING-PATH.md** (this file)
>
> Work through these in order. Each step has a simple explanation, a technical one, a concrete example from this repo, the files to open, and an exercise. Answers to the exercises are at the end. Budget roughly a day for all 15.
>
> **Updated 2026-10-20** for the code after the fixes in [PROJECT-HISTORY.md](PROJECT-HISTORY.md). Several exercises now ask you to explain a fix that exists, rather than design one. Interviewers ask about these most, so be able to walk through each from the code.

---

## 1. Product problem
- **Simple:** practising interviews alone is hard; this gives you a patient interviewer who asks about your own projects and then grades you.
- **Technical:** a short, personalised, speech-to-speech session with an LLM, followed by an asynchronous LLM evaluation of the transcript.
- **Example:** the interviewer prompt in `realtime.ts` says "2–3 questions in total, each anchored in a specific repo".
- **Open:** `README.md`, `apps/backend/realtime.ts` (`buildInstructions`).
- **Exercise 1:** In one sentence each, name the three AI calls the product makes and what each is for.

## 2. User workflow
- **Simple:** paste link → talk → read score.
- **Technical:** three routes: `/` creates an `Interview`; `/interview/:id` runs the call and ends it explicitly; `/result/:id` polls for grading.
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
- **Technical:** Turborepo + Bun workspaces. Only `packages/eslint-config` is actually consumed; `typescript-config` is listed but not extended. (The unused `packages/ui` template was removed.)
- **Example:** `apps/backend/eslint.config.js` imports `@repo/eslint-config/base`.
- **Open:** root `package.json`, `turbo.json`.
- **Exercise 4:** Why does adding a new env var without updating `turbo.json` fail lint?

## 5. Frontend
- **Simple:** three screens; the live one shows two circles that glow when someone talks.
- **Technical:** React 19 with local state only. `Interview.tsx` owns the call lifecycle in one `useEffect` using refs plus closures (`retryRef`, `stopRef`). Audio levels go through `AnalyserNode` → `useVoiceLevel` → CSS variable, avoiding per-frame re-renders. `applyMic()` combines mute with the greeting guard, and `finalizeTranscript()` runs on End.
- **Example:** `createLevelMeter` computes RMS: `sqrt(mean(((byte-128)/128)^2)) * 3.2`.
- **Open:** `src/components/Interview.tsx`, `src/lib/realtime.ts`, `src/hooks/useVoiceLevel.ts`, `src/components/interview/VoiceTile.tsx`.
- **Exercise 5:** What prevents a dropped connection from scheduling two reconnects at once? And why is the mic off while the interviewer greets you?

## 6. API
- **Simple:** six doors into the server: create interview, get a voice key, register the transcript listener, end the interview, retry grading, get results.
- **Technical:** Express 5 with middleware order `[trust proxy] → cors → security headers → cookieParser → json → ensureSession → rateLimit → requireOwner → handler`. Express 5 forwards rejected async handlers to the default error handler (500).
- **Example:** `POST /api/v1/realtime/client-secret/:interviewId` returns `{ clientSecret, expiresAt, model }` with `Cache-Control: no-store`.
- **Open:** `apps/backend/index.ts`, `apps/backend/realtime.ts`.
- **Exercise 6:** What HTTP status does a user get if GitHub says the username doesn't exist, and why?

## 7. Database
- **Simple:** one row per interview; one row per spoken turn.
- **Technical:** Prisma 7 with the `pg` driver adapter. `Interview` 1—N `Message`; lifecycle `Pre → InProgress → Ended → Grading → Done | Failed` with a grading lease (`gradingStartedAt`) and attempt count; `Message.itemId` unique for idempotent saves; index on `(interviewId, createdAt)`; JSONB GitHub payload.
- **Example:** migration `20260821120000_add_grading_failed_status` added `Grading` and `Failed` for the first race fix; `20261019183826_interview_lifecycle_and_grading_lease` added `Ended` and the lease columns.
- **Open:** `prisma/schema.prisma`, the 8 folders in `prisma/migrations/`, `db.ts`, the lifecycle diagram in [ARCHITECTURE.md §4](ARCHITECTURE.md#interview-lifecycle-interviewstatus).
- **Exercise 7:** Write the SQL that Prisma's grading claim (`updateMany` where status is `Ended`, or `Failed` with attempts < 3, or `Grading` with a stale lease) roughly becomes, and explain why it's safe under concurrency.

## 8. Authentication
- **Simple:** no accounts; your browser gets a secret ticket (cookie), and only that ticket can see your interviews.
- **Technical:** random UUID `sid` cookie (HttpOnly, SameSite=Lax, Secure in prod, 30 days); `ownerId` column; `requireOwner` returns 404/403, and rows with no owner are denied.
- **Example:** integration test "a different session is forbidden from reading someone else's result".
- **Open:** `index.ts` (`ensureSession`, `requireOwner`), `types.ts` (Request augmentation), `index.test.ts`.
- **Exercise 8:** If you deploy the frontend and backend on two unrelated domains, which env var must change and what else does it force?

## 9. Background processing
- **Simple:** there's no separate worker; the server listens to the call while it happens, waits for the last words when you click End, and grades when the results page asks.
- **Technical:** sideband WebSocket per call (in-memory map, reconnects to the same call on a drop) plus grading inside `GET /result` for `Ended` interviews, protected by an atomic claim and a 2-minute lease. No queue, so sideband state doesn't survive a restart, but the grading lock does (it's in Postgres).
- **Example:** `sideband.ts` upserts a `User` message on `conversation.item.input_audio_transcription.completed`, keyed by `item_id` and timed from the earlier `conversation.item.added`.
- **Open:** `apps/backend/sideband.ts`, the result route in `index.ts`, `result.ts`.
- **Exercise 9:** The backend restarts while a candidate is mid-interview. What still works, what's lost, and how does the interview still end up graded?

## 10. Real-time architecture
- **Simple:** your voice and the AI's voice travel over a direct, live connection; the server listens in on a side channel to write things down.
- **Technical:**
  1. The client secret pins the session config.
  2. The browser posts its SDP offer to `/v1/realtime/calls` and reads the call id from `Location` (exposed by OpenAI's CORS).
  3. The server attaches the sideband by `call_id`.
  4. Semantic VAD at low eagerness lets the candidate pause to think; `interrupt_response` gives barge-in.
  5. The browser sends `response.create` so the AI speaks first.
- **Example:** `lib/realtime.ts` creates `createDataChannel("oai-events")` *before* `createOffer()`, so the data channel is part of the SDP.
- **Open:** `src/lib/realtime.ts`, `apps/backend/realtime.ts`, `apps/backend/sideband.ts`.
- **Exercise 10:** Why can't the browser just send the transcript to the backend itself?

## 11. Security
- **Simple:** the real keys never leave the server; the browser only gets a key that dies in 2 minutes.
- **Technical:** ephemeral client secrets, server-pinned config, call-id regex, hashed safety identifier, CORS allowlist, per-endpoint rate limits, security headers, `.env` excluded from images, delimited grader input.
- **Remaining gap:** cost exposure (B10): no accounts.
- **Example:** `isValidCallId` rejects `rtc_abc&model=x` (tested in `realtime.test.ts`).
- **Open:** `realtime.ts`, `.dockerignore`, `PROJECT-DEEP-DIVE.md §10`.
- **Exercise 11:** Explain how the `.dockerignore` lines fixed B1 without excluding `.env.example`, and why the bug existed at all with `COPY . .`.

## 12. Testing
- **Simple:** small automatic checks run on every push, including against a real database.
- **Technical:** 47 bun:test tests: unit tests (Zod, grader, realtime helpers), a sideband suite with a fake `ws` and fake timers, and supertest integration tests against a separate Postgres test database (`describe.skipIf(!DATABASE_URL)`), run in CI with a Postgres service. Dependencies are swapped through replaceable objects (`grader`, `sidebandStore`), because Bun's `mock.module` is process-wide and leaked between files on CI.
- **Example:** `result.test.ts` swaps `globalThis.fetch` to simulate OpenRouter responses; `index.test.ts` "concurrent result polls grade an interview exactly once".
- **Open:** `apps/backend/*.test.ts`, `.github/workflows/ci.yml`.
- **Exercise 12:** Read the concurrency test and explain why it only proves something against a real database.

## 13. Deployment
- **Simple:** there's a recipe (Docker) to run everything together, but no live website yet.
- **Technical:** `oven/bun:1.3.11` images (pinned to match CI) copy the whole monorepo minus `.env` files; the backend runs `prisma migrate deploy` on boot; compose wires Postgres → backend → frontend; the frontend backend-URL is inlined via `BUN_PUBLIC_*`.
- **Example:** `docker-compose.yml` overrides `DATABASE_URL` to the `postgres` service hostname.
- **Open:** `docker-compose.yml`, `apps/*/Dockerfile`, `.dockerignore`, `apps/frontend/bunfig.toml`.
- **Exercise 13:** Why does compose leave `NODE_ENV` unset for the backend? (Read the comment.)

## 14. Tradeoffs
- **Simple:** every shortcut saved time and has a cost.
- **Technical:**
  - grade-on-read-after-End vs. job queue;
  - client secrets vs. SDP relay;
  - anonymous cookies vs. accounts;
  - Express vs. `Bun.serve`;
  - monorepo scaffolding vs. app size.
- **Example:** [PROJECT-DEEP-DIVE.md §19–20](PROJECT-DEEP-DIVE.md#19-why-did-the-developer-do-this).
- **Exercise 14:** Argue *for* the current "End settles, first poll grades" design in two sentences, then *against* it in two.

## 15. Weaknesses
- **Simple:** the bugs found in the audit are fixed, but it still isn't ready for strangers on the internet: anyone can spend your API credit, and it runs as one server.
- **Technical:** B1–B13 and D1–D2 in [PROJECT-DEEP-DIVE.md §18](PROJECT-DEEP-DIVE.md#18-bugs-technical-debt--architectural-problems), each with what was done; [PROJECT-HISTORY.md](PROJECT-HISTORY.md) for the order they were fixed in. Still open: B10 (no accounts), single-instance state, no frontend/E2E tests.
- **Exercise 15:** Explain the order the fixes were shipped in (Phase 1 → 3) by risk × effort, then pick the next three you'd do.

---

## Exercise answers

1. **Three AI calls:** OpenAI Realtime runs the spoken interview; Realtime input transcription (`gpt-4o-mini-transcribe`, inside the same session) turns the candidate's speech into text; OpenRouter (Qwen) grades the transcript.
2. **Where money is spent:** OpenAI spending starts on `/interview/:id` (client secret, then the call). OpenRouter spending starts on `/result/:id`, on the first poll after the interview has ended, and only if the candidate actually answered (an empty transcript scores 0 for free). The GitHub call on `/` is free but rate-limited.
3. **The diagram:** audio arrows are browser ↔ OpenAI only. The real API key is on the backend → OpenAI arrows (`client_secrets` and the sideband). The browser → OpenAI SDP request carries only the ephemeral `ek_…` key.
4. **Why lint fails:** `eslint-plugin-turbo`'s `no-undeclared-env-vars` rule warns, and lint runs with `--max-warnings 0`.
5. **No double reconnect:** the `generation` counter in `Interview.tsx`. `handleDrop` ignores any failure whose `gen` isn't the current one and bumps it once handled. **Greeting guard:** on laptop speakers the mic picked up the interviewer's own greeting; the VAD treated that as the candidate interrupting, and the greeting restarted. So the mic sends nothing until `output_audio_buffer.stopped` (or `cleared`) says the greeting finished, with a 30 s fallback.
6. **Unknown GitHub user:** a 404 with "No GitHub user at that address". The scraper throws a `GithubLookupError` with `kind: "not-found"`, and the route maps it; rate limits and outages become 503. (It used to be a 500: axios threw, there was no try/catch, and Express 5's default handler answered.)
7. **The SQL:** roughly `UPDATE "Interview" SET status='Grading', "gradingStartedAt"=now(), "gradingAttempts"="gradingAttempts"+1 WHERE id=$1 AND (status='Ended' OR (status='Failed' AND "gradingAttempts"<3) OR (status='Grading' AND "gradingStartedAt" < now() - interval '2 minutes'));` A single statement is atomic. Once one transaction changes the row, the other re-checks the `WHERE` against the new row (`Grading`, fresh lease), which no longer matches, so it updates 0 rows.
8. **Cross-domain deploy:** set `COOKIE_SAMESITE=none`. That forces `Secure`, which requires HTTPS. Also set `FRONTEND_ORIGIN` and `BUN_PUBLIC_BACKEND_URL` to the real URLs.
9. **Backend restart mid-interview:** the voice call keeps working (it's browser ↔ OpenAI). The sideband is lost with the process, so later turns aren't saved, and rate-limit counters reset. When the results page polls, idle recovery sees no live sideband and no activity for 60 s, ends the interview, and grades what was captured. (A socket *drop* without a restart is different: it reconnects to the same call.)
10. **Why the server listens itself:** the browser only receives AI *audio* over WebRTC; and anything the browser sends could be forged, which matters because the transcript is graded.
11. **The `.dockerignore` fix:** `**/.env`, `**/.env.*` and then `!**/.env.example`; `.dockerignore` supports `!` exceptions, and later lines win. The bug existed because both Dockerfiles `COPY . .` the whole repo, and `.env` is gitignored but *not* docker-ignored, so the keys ended up in image layers.
12. **Concurrency test:** it replaces `grader.calculateResult` with a slow counter, creates an `Ended` interview, fires three `GET /result` calls at once, and asserts exactly one grading call and that a response reports `Done`. It only proves something against real Postgres because the guarantee *is* Postgres's: row locking and re-checking the `WHERE` on a conditional update. A mocked Prisma would just return whatever the mock says.
13. **`NODE_ENV` unset:** `production` would make the session cookie `Secure`, and the browser talks plain HTTP to the container, so the cookie wouldn't persist.
14. **For:** no worker or queue to run; End has already settled the transcript, so the first poll grades complete data; the lease and attempt cap give crash recovery without infrastructure. **Against:** a slow paid LLM call inside a `GET` (side effects on a read); and grading only happens while someone is polling, so an abandoned results page leaves the interview ungraded.
15. **The order shipped:** Phase 1 was cheap and high-value: B1 (minutes of effort, high risk), the `orderBy` half of B3, B4 error states, B8 GitHub errors, indexes. Phase 2 was grading correctness: B2 lifecycle, B5 grader, B6 lease and cap. Phase 3 was robustness and security: B7 reconnects + true speech order, B9 limits, B12, headers. **Next three:** sign-in with per-user quotas (B10, the biggest remaining risk), an E2E test of the call flow, and telling the user when transcript capture fails.

---

## File-by-file learning map

### Must understand
| File | Why |
|---|---|
| `apps/backend/index.ts` | Every route, middleware order, session and ownership logic, the lifecycle, and the grading claim and lease. The heart of the backend. |
| `apps/backend/realtime.ts` | How the browser gets a voice session without your key; the interviewer prompt; call-id validation. |
| `apps/backend/sideband.ts` | How transcripts are captured, reconnects, speech-order timing, and `endInterview`; the most "distributed-systems" file in the repo. |
| `apps/backend/result.ts` | The grading rubric, injection-resistant input, structured LLM output and its failure modes. |
| `apps/backend/prisma/schema.prisma` | The data model and state machine. |
| `apps/frontend/src/lib/realtime.ts` | The WebRTC/SDP handshake and call-id relay. |
| `apps/frontend/src/components/Interview.tsx` | Call lifecycle, reconnects, mute, greeting guard, End flow, cleanup. |

### Should understand
| File | Why |
|---|---|
| `apps/backend/scrapers/github.ts` | Intake data, typed errors and limits (100 repos, optional token, proxy). |
| `apps/backend/types.ts` | Zod body schema, the GitHub username parser, how `req.sessionId` gets typed. |
| `apps/backend/*.test.ts` | What's proven and how dependencies are swapped (and why not `mock.module`). |
| `apps/frontend/src/components/Result.tsx` | Polling, finishing/not-found/offline/retry states, result rendering. |
| `apps/frontend/src/components/Form.tsx` | Input normalisation and error states. |
| `apps/frontend/src/hooks/useVoiceLevel.ts`, `components/interview/VoiceTile.tsx` | Smoothing and debounce maths for speaking indicators. |
| `prisma/migrations/*` | How the schema evolved (good interview story). |
| `.github/workflows/ci.yml`, `docker-compose.yml`, `.dockerignore`, `apps/*/Dockerfile` | Delivery story and the B1 fix. |
| `PROJECT-HISTORY.md` | What was fixed, in what order, and how it was verified. |
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
| `apps/frontend/build.ts` | Bun template production-bundle script. |
| `packages/typescript-config` | Not extended by either app. |
| `apps/backend/experiments/linkedin-scraper.js` | Unwired, labelled experiment. |
| `HIRING_COMMITTEE_REVIEW.md` | Historical (Aug 2026, an older version). Read only to understand what changed. |
| `bun.lock`, `.turbo/`, `node_modules/` | Tooling artifacts. |

---

Back to: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [INTERVIEW-PREP.md](INTERVIEW-PREP.md)
