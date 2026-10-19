# AI Interviewer — Hiring Committee Review

Single-project resume/engineering audit, based on a direct read of the repository (no git history exists to inspect — this is the repo as it sits on disk).

Full formatted version: https://claude.ai/code/artifact/10876f4d-78e9-4fb9-af99-f48f07dab765

**Overall score: 4.6/10 — KEEP, AFTER IMPROVEMENTS**

---

## 1. What this project actually is

The README is one sentence: *"This is the code for the AI interviewer built in a YT video by Harkirat Singh"*, with a link to the video. That fact sets the ceiling for everything below.

What's actually implemented end to end:

1. A candidate pastes a GitHub profile URL into a React form (`Form.tsx`).
2. The backend (`index.ts`) strips the URL to a username, calls the GitHub REST API through a proxy agent (`scrapers/github.ts`), and stores the raw repo list as JSON on a new `Interview` row (Prisma / Postgres).
3. The frontend opens a WebRTC connection, does an SDP handshake through the backend to OpenAI's Realtime API (`gpt-realtime`), and the model conducts a 2–3 question voice interview seeded with the candidate's GitHub metadata (`sideband.ts`).
4. In parallel, the candidate's mic audio is *also* streamed to Deepgram for live transcription, purely so the backend has a text log of what the user said (the model's own spoken answers are recovered separately via a server-side "sideband" WebSocket mirroring the OpenAI realtime call).
5. On the results page, the frontend polls the backend every 5 seconds; once the interview is over, the backend sends the full transcript to Gemini with a Zod-derived JSON schema and gets back a score out of 10 and free-text feedback.

That's a real, working integration of four external services (GitHub, OpenAI Realtime, Deepgram, Gemini) in roughly 750–900 lines of custom application code. There's also a second, disconnected backend file (`index2.js`) that scrapes LinkedIn profiles with Playwright through a residential proxy — not imported or called from anywhere in the app. It reads as an abandoned experiment, not a shipped feature.

**Who it's for:** nominally, candidates practicing technical interviews. In its current state it's a single-user local demo — no accounts, no interview history, frontend hardcoded to `http://localhost:3001`.

**Completeness:** prototype. Runs the happy path once. Has a self-acknowledged, unfixed concurrency bug in grading, no auth, no tests, no CI, no Docker, no deployment story.

---

## 2. Classification

**Tutorial/clone-level project, bordering on Weak.**

The repo states its own origin plainly, and the core loop — GitHub scrape → realtime voice interview → LLM grade — is exactly the tutorial's premise. That caps originality regardless of code quality. What keeps it out of "not worth putting on a resume" is that the plumbing is genuinely non-trivial (WebRTC negotiation, sideband transcript capture, dual STT pipelines, structured LLM output) and it's a working full-stack build, not a copy-pasted script.

**Feels like:** Tutorial-derived, Under-engineered (app logic), Over-tooled (repo scaffolding).
**Not:** Original, over-engineered app logic, or a zero-effort clone.

The repo carries a full Turborepo monorepo with three internal packages (`packages/ui`, `eslint-config`, `typescript-config`) for what is, in practice, one backend route file and five frontend components. `packages/ui` is never imported by the frontend — dead `create-turbo` scaffold. Meanwhile the actual request-handling code has no service layer, no error middleware, and one unguarded race condition. The tooling investment and the application-logic investment point in opposite directions.

---

## 3. Scorecard (1–10)

| Metric | Score |
|---|---|
| Resume Value | 4 |
| Technical Depth | 5 |
| Hiring Signal | 4 |
| Originality | 2 |
| Real-World / Business Value | 4 |
| Engineering Quality | 4 |
| Architecture | 5 |
| Portfolio / Demo Value | 6 |
| Interview Potential | 6 |
| Improvement ROI | 6 |

## 4. Overall score

**4.6 / 10** — technically in the "<5, do not prioritize as-is" band. Not a badly-written 4.6 though: a well-executed idea with a low ceiling because of its origin and how unfinished the edges are.

---

## 5. The 30-second recruiter test

- **Catches attention:** "Voice AI interviewer" — WebRTC + OpenAI Realtime API, GitHub-aware prompting. Current and unusual on a resume line.
- **Keeps me reading:** Four real external integrations (GitHub, OpenAI Realtime, Deepgram, Gemini) wired into one flow, not a single-API toy.
- **Makes me skeptical:** No live link, no screenshots/GIF, no tests, a one-line README that credits a YouTube tutorial.
- **Makes me reject:** If, in interview, the candidate can't go beyond "I followed the video."

> **30-second verdict:** Reads as "did a well-produced tutorial and it mostly works," not "built a product." The stack is genuinely resume-catchy on tech alone. But there's no deployed demo, no tests, no real README, and self-documented TODOs that read as unfinished. Worth a screen, not yet a differentiator — currently signals "can integrate APIs," not "can own a system."

---

## 6. Engineering deep dive

### Architecture
Turborepo monorepo → `apps/backend` (Bun, Express, Prisma/Postgres) and `apps/frontend` (Bun, React 19, react-router 7, Tailwind 4, shadcn-style components). Single Express router, four routes, no service/controller split, no middleware beyond CORS/JSON/text parsing.

**Good:** the sideband-WebSocket pattern for capturing a server-side transcript of a client-negotiated WebRTC call is the correct approach — the browser never receives text of the model's speech, so a second connection scoped to the same `call_id` is genuinely necessary. `/api/v1/` prefix shows some API-versioning habit.

**Weak:** a full monorepo with three shared packages is disproportionate for one route file and five components — `packages/ui` is dead weight. No error middleware, no request logging, grading logic lives inline inside a GET handler that already sent its response. `index2.js` is untyped, disconnected, unreferenced.

### Backend
- **API design:** four endpoints, inconsistent status codes — both "bad request body" and "interview not found" return `411 Length Required`, which fits neither case (`400`/`404` would).
- **Validation:** Zod only checks `github` is a string — no URL shape validation, no length cap. No schema on the other endpoints.
- **Auth/authz:** none. Any interview UUID is fully readable/writable by anyone. `cors()` has no origin allowlist.
- **Error handling:** GitHub scrape and Gemini grading have no try/catch. An LLM error mid-grading leaves the interview stuck pre-"Done" permanently.
- **The concurrency bug:** `GET /api/v1/result/:id` responds to the client, *then* conditionally calls `calculateResult` and writes the outcome. With 5s client polling and no lock, this fires a fresh Gemini call on every poll until status flips to `"Done"`. The code has its own `// TODO: Should add some sort of a lock here.`
- **DB access:** simple Prisma calls, no N+1 given the small surface, but no indexes beyond primary keys, no explicit `@@index` on `Message.interviewId`.
- **Logging:** scattered `console.log`/`console.error`, no structured logging, no request IDs.

### Frontend
- **Components:** small, single-purpose, readable (`Form`, `Interview`, `Result`, `VoiceOrb`). `VoiceOrb`'s Web Audio API level-metering (RMS over an analyser buffer) is the single best piece of code in the repo — genuinely non-trivial, done cleanly.
- **State:** local `useState`/`useRef` only — appropriately sized, no over-engineering.
- **Routing:** react-router 7, three routes, clean.
- **API integration:** `BACKEND_URL` is a hardcoded `http://localhost:3001` literal in `lib/config.ts`, not an env var — can't point at a deployed backend without editing source.
- **Security smell:** `Interview.tsx` opens a Deepgram WebSocket with a token passed directly as a client-side subprotocol, currently blanked, with a TODO: *"Lets create ephemereal api keys for the user and not put the prod key on the frontend."* The instinct is right; the follow-through isn't there — as structured, a real key here ships to every browser tab.
- **Loading/error states:** present for form submit and result polling; absent for denied mic permission, dropped WebRTC connection, or failed SDP exchange — the interview screen would just hang.
- **Accessibility:** not really considered; the core interaction (a pulsing orb) has no non-visual equivalent.
- **Dead code:** `APITester.tsx` is unused leftover from the Bun React starter template.

### Database
Two tables (`Interview`, `Message`), one FK, two enums. Reasonable use of a Postgres `Json` column for the GitHub payload. Three migrations show healthy incremental schema growth (init → added timestamp → added feedback). Gaps: no `createdAt`/`updatedAt` on `Interview` itself, no explicit index on `Message.interviewId` or `Interview.status`, no unique constraints beyond PKs. None of this matters at demo scale; all of it would at the first order of magnitude of real traffic.

### Testing
**Zero test files exist anywhere.** The project's own Cursor rules explicitly document how to write `bun test` tests, which makes the absence more notable — the tooling was known and simply unused.

### DevOps
No Dockerfile, no docker-compose, no CI (`.github/workflows`), no `.env.example`, no health check, no monitoring, no deployment target. `turbo.json` only orchestrates local dev/build/lint. The single most complete category of absence in the project.

---

## 7. The 10 biggest weaknesses, ranked

1. **Unbounded grading race condition** (correctness) — Result route responds, then conditionally kicks off ungated LLM grading. Every 5s poll before "Done" can fire a fresh Gemini call; a single failure leaves it stuck and retrying forever. *Fix:* atomically claim the row (e.g. `UPDATE ... SET status='Grading' WHERE status='Pre'`) before grading; add a terminal `Failed` state with backoff.
2. **No auth, no authz, wide-open CORS** (security) — any interview UUID is fully accessible; any origin can call the API. Deployed as-is, this is a direct cost-abuse vector against the project owner's paid API keys. *Fix:* session auth, origin allowlist, rate limiting on paid endpoints.
3. **Frontend hardcoded to localhost** (production readiness) — `BACKEND_URL` is a literal, not an env var; can't be deployed without editing source. *Fix:* `VITE_BACKEND_URL`-style config + `.env.example`.
4. **Zero tests** (quality) — no automated evidence any of the validation or grading logic behaves as intended. *Fix:* unit tests on Zod schemas and `calculateResult`'s parse path; a few integration tests against a test DB.
5. **Redundant dual STT pipeline** (design) — user audio streamed to both OpenAI Realtime (which already transcribes input) and Deepgram, just to log text. Extra cost, dependency, and failure surface for likely-duplicate capability. *Fix:* use Realtime's own input-transcription events; drop Deepgram or justify keeping it.
6. **Two orphaned, unfinished files** (hygiene) — `index2.js` (LinkedIn scraper) and `APITester.tsx` are both dead, unreferenced by the running app. *Fix:* delete `APITester.tsx`; integrate or clearly relabel the LinkedIn scraper.
7. **Client-exposed API key pattern** (security) — Deepgram token designed to be passed from the browser; currently blanked with a TODO about ephemeral keys. *Fix:* mint short-lived scoped Deepgram tokens server-side, same pattern already used for OpenAI Realtime sessions.
8. **No resilience around external calls** (reliability) — GitHub scraping has no pagination/rate-limit handling; no WebRTC/WebSocket reconnect logic. *Fix:* pagination + error toasts; basic reconnect/retry.
9. **Wrong HTTP status codes** (polish) — `411` used for both validation failure and not-found. *Fix:* `400`/`404`.
10. **Documentation is one sentence** (communication) — no architecture explanation, setup instructions, or screenshots anywhere. *Fix:* real README with diagram, setup, demo GIF, and an honest note on the tutorial origin plus what was extended.

---

## 8. Hidden strengths

- **WebRTC + server-side "sideband" transcript capture** — negotiating a WebRTC SDP offer/answer through a backend relay, then opening a second server-only WebSocket scoped to the same `call_id` to observe `response.done` events, is a real "two systems talking to each other correctly" problem most junior candidates never touch. Surface it as a specific talking point about why audio-only realtime APIs need an out-of-band channel for server-side observability.
- **Web Audio API level metering (`VoiceOrb`)** — the RMS-over-analyser-buffer volume calculation driving a shared `requestAnimationFrame` loop is clean, correct, library-free signal-processing-adjacent code, currently invisible because it looks like "just a UI animation."
- **Structured LLM output via Zod-derived JSON Schema** — one schema used both to constrain Gemini's output and to `.parse()` the response is the right pattern for reliable structured LLM output, applied consistently.
- **The orphaned LinkedIn scraper is more defensively written than the main app** — `index2.js`'s `normalizeLinkedInUrl` allowlists the `linkedin.com` hostname (SSRF protection) and strips CRLF from header values (header-injection protection). Better security instinct than anything in the connected codebase — just sitting disconnected and unmentioned.

---

## 9. What's actually missing (fit for this project specifically)

| Area | Why it belongs here |
|---|---|
| Idempotent job state machine | The `status` enum already exists — this completes an existing design rather than adding one. |
| Lightweight auth (session/magic link) | Interviews are already keyed by UUID per attempt; attaching an owner is a small schema change. |
| Rate limiting on the two paid-API endpoints | Directly caps the cost-abuse risk — highest leverage per hour spent. |
| Env-based config + Docker Compose | Turns "clone and hand-configure" into `docker compose up`. |
| CI (typecheck + lint + test) | `turbo.json` already defines the scripts; this just wires them into GH Actions. |
| Basic observability (request logging, error tracking) | Given four external API dependencies, knowing which one failed and why is the real operational need. |

**Deliberately not recommended:** message queues, Redis caching, extra WebSocket infra, search, microservices — none proportionate to a two-table, four-endpoint app. Adding it would read as over-engineering, not depth.

---

## 10. Improvement ROI

| Improvement | Time | Difficulty | Resume | Interview | ROI |
|---|---:|---|---:|---:|---:|
| Fix grading race condition | 2h | Low | 5 | 8 | 9 |
| Real README + diagram + demo GIF | 3h | Low | 8 | 4 | 9 |
| Env-based config | 1h | Low | 4 | 3 | 8 |
| Delete/relocate dead files | 1h | Low | 4 | 3 | 7 |
| Unit + integration tests | 6h | Med | 7 | 6 | 7 |
| CI pipeline | 2h | Low | 6 | 4 | 7 |
| Basic auth + rate limiting | 8h | Med | 6 | 7 | 6 |
| Docker Compose | 3h | Low | 5 | 4 | 6 |
| Live deployment | 6h | Med | 8 | 5 | 6 |
| Fix/remove redundant STT pipeline | 4h | Med | 3 | 6 | 5 |
| WebRTC reconnect/error handling | 5h | Med | 3 | 5 | 4 |
| Finish + integrate LinkedIn scraper | 10h | High | 5 | 5 | 4 |

---

## 11. Time-based plan

**5 hours:** Fix the grading race condition. Move `BACKEND_URL` to env config. Delete `APITester.tsx`; delete or clearly label `index2.js`. Rewrite the README (what/architecture/setup/screenshot). Fix `411` status codes.

**10 hours (+5):** Basic session auth; rate limiting on session/result endpoints; GitHub pagination + graceful error handling; mic-permission and WebRTC-drop error states.

**20 hours (+10):** CI (typecheck/lint/test via existing `turbo.json` scripts); 10–15 unit tests + a few integration tests; Docker Compose; a deliberate, README-justified decision on the dual-STT question.

**40 hours (+20):** Live deployment with a real URL; a proper grading state machine with retries/backoff and a terminal `Failed` state; basic observability; finish-and-integrate or fully remove the LinkedIn scraper. At this point the project is honestly a **7-ish** on engineering quality, architecture, and portfolio value — capped only by originality.

**80 hours — worth it?** Only if the goal changes. Past ~40 hours, the remaining ceiling is set by the tutorial origin, not code quality. Worth continuing only for a genuine pivot: your own grading/question-generation logic instead of one LLM call, adaptive multi-round interviews, a history/comparison dashboard — something that makes the *idea*, not just the execution, yours. Otherwise, **stop at ~40 hours** and put the next 40 into a project built from your own problem statement.

---

## 12. Resume readiness

**ALMOST — 4/10.** Not ready as-is: no live link, one-line README, zero tests, and a self-acknowledged unfixed bug are all found within ten minutes of review. "Almost" rather than "no" because the fixes are concrete, scoped, and mostly under 10 hours — this needs finishing, not a rewrite.

---

## 13. Resume bullets (grounded only in what exists)

1. **"Built a real-time voice interview pipeline using OpenAI's Realtime API (WebRTC/SDP negotiation) with a server-side sideband WebSocket to capture and persist model transcript output, since the client-side audio stream carries no text representation of the assistant's speech."**
   *Signal:* comfort with a non-trivial, unusual real-time protocol. *Why a recruiter cares:* specific, current, hard to fake in a screen.

2. **"Designed a Turborepo monorepo (Bun, Express, PostgreSQL/Prisma, React 19) with Zod-validated REST endpoints that ingest a GitHub profile, fetch repository metadata, and inject it into a dynamically constructed interview prompt for a live LLM-driven conversation."**
   *Signal:* end-to-end ownership of a full-stack flow. *Why a recruiter cares:* shows wiring a real data source into an LLM system, not just calling a chat API.

3. **"Implemented automated interview scoring with Google's Gemini API, constraining output to a Zod-derived JSON Schema so grading results are parsed and validated as typed data rather than free-form text."**
   *Signal:* understands and fixes the unconstrained-LLM-output reliability problem. *Why a recruiter cares:* structured-output discipline is a real, current LLM-engineering skill.

**Do not invent** latency, accuracy, user counts, or cost savings that were never measured — see §14 for what to actually go measure first.

---

## 14. Metrics worth collecting

| Metric | Why it's the right one here |
|---|---|
| Time-to-first-AI-response after connect | Measures the WebRTC/session-setup path directly. |
| WebRTC connection success rate | Real reliability data for the hardest, currently-unhandled-on-failure part. |
| Grading call count per interview (before/after the lock fix) | A concrete before/after number demonstrating the §7 #1 fix. |
| GitHub scrape success/error rate under rate limiting | Tests the real failure mode from §7 #8. |
| Test coverage % once a suite exists | 0 tests → an honest concrete number. |
| p95 grading latency (Gemini round-trip) | Meaningful since grading blocks the "Done" transition the user polls for. |
| Frontend bundle size | Cheap, real, directly checkable from `bun run build`. |

---

## 15. Interview prep — 15 likely questions

**Easy**
- Walk through what happens end-to-end when a user submits their GitHub URL.
- Why Postgres + Prisma instead of something simpler for two tables?
- What does the Zod schema on `/pre-interview` actually validate, and what happens if it fails?
- Why does `/session/:id` parse the body as `text/plain`/`application/sdp` instead of JSON?

**Medium**
- Explain the WebRTC handshake and what the "sideband" WebSocket is for.
- Why two STT pipelines (Deepgram + OpenAI Realtime)? Would you keep both?
- Your result endpoint responds then keeps working — why is that risky?
- What's your actual auth/authz story today?
- The Deepgram token is blank — what was the plan, and what's wrong with a real key there?

**Hard**
- Trace exactly how the no-lock grading bug spirals, and design a fix.
- GitHub rate-limits per IP and you're behind a shared proxy — what happens at 100 concurrent starts?
- How would you stop someone running up your API bill given no auth/rate limiting?

**System Design**
- Redesign for thousands of concurrent interviews/day — relay, database, cost control?
- Evolve into a multi-round, resumable platform with history and admin review — what changes structurally?

---

## 16. The honest interview story

Don't hide the tutorial origin — "I started from a walkthrough, then went deeper on X" is fine; getting caught overstating originality is not recoverable.

- **Problem:** Practicing technical interviews alone is awkward, and generic questions don't reflect what's on a candidate's GitHub.
- **Solution:** A voice-driven mock interview using GitHub repos as context, graded afterward.
- **Architecture:** GitHub scrape → Postgres → WebRTC session via backend to OpenAI Realtime → sideband WebSocket capturing model transcript → Gemini grading with Zod-constrained schema.
- **Hardest problem:** Getting a text transcript of the AI's side of a voice-only call — requires a second, server-scoped connection to the same call.
- **Trade-offs:** A second STT pipeline (Deepgram) for the user side rather than relying on Realtime's own transcription — worth revisiting, not defending.
- **Failure:** Shipped a known, TODO'd concurrency bug in the grading endpoint — name it directly and explain the fix rather than waiting to be caught.
- **What I'd change:** Fix the grading race with a real state machine, add auth/rate limiting before any public deploy, finish or remove the LinkedIn scraper.

---

## 17. Final verdict

| | Score |
|---|---|
| Current Score | 4.6/10 |
| Resume Readiness | 4/10 |
| Recruiter Appeal | 5/10 |
| Technical Depth | 5/10 |
| Interview Potential | 6/10 |
| Improvement ROI | 6/10 |

### **KEEP — AFTER IMPROVEMENTS**

Not in its current state: no live demo, one-line README, zero tests, and an unfixed, self-documented bug surface in a ten-minute review. But the underlying integration work is real and worth the ~10–20 hours in §11 to finish. It won't become an originality flagship no matter how polished — that ceiling is set by the tutorial origin — but "finished, tested, deployed, and honestly described" is a meaningfully different resume line than what exists today.

---

## 18. The 5 changes to make, in order

1. **Fix the grading race condition** — 2–3h. Highest-signal correctness fix; costs real API money every time it fires. Resume impact 5/10, interview impact 8/10.
2. **Write a real README, clean up dead code** — 3–4h. First thing anyone reads; dead files actively hurt the first impression. Resume impact 8/10, interview impact 4/10.
3. **Env-based config + basic auth/rate limiting** — 8–10h. Makes it deployable and safe to expose. Resume impact 6/10, interview impact 7/10.
4. **Add tests and CI** — 6–8h. Moves from "0 tests, 0 CI" to "has a pipeline." Resume impact 7/10, interview impact 6/10.
5. **Deploy it live** — 6–8h. A clickable demo beats invisible code quality — but only after 1 and 3 make it safe to expose. Resume impact 8/10, interview impact 5/10.

**Stop condition:** Stop once priorities 1–5 are done (~25–35 hours total). Beyond that, additional polish runs into the originality ceiling — a tutorial-derived idea, however well-engineered, won't out-compete a project built from an original problem statement. Don't spend 80 hours perfecting this project's plumbing; spend the next 40+ hours on a second project that starts from a problem you defined yourself.

---

## Would I spend the next 20 hours on this vs. another project?

**NO.** Not because the engineering is bad — it isn't; the WebRTC/sideband/structured-grading work is real. But 20 hours here caps out at "a well-finished tutorial clone," while the same 20 hours are worth strictly more on a project built from your own problem statement, because originality is the one score this review gives that time cannot buy back on this specific codebase. Spend the first 5 hours here (race-condition fix + README) since they're nearly free and remove the two worst first impressions — then redirect.
