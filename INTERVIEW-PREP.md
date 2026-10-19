# AI Interviewer — Interview Prep

> Report set: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · **INTERVIEW-PREP.md** (this file) · [LEARNING-PATH.md](LEARNING-PATH.md)
>
> Every answer is grounded in the repository as of 2026-10-19. Where an answer is a recommendation rather than what exists, it says so. Bug IDs (B1…) refer to [PROJECT-DEEP-DIVE.md §18](PROJECT-DEEP-DIVE.md#18-bugs-technical-debt--architectural-problems).

---

## Pitches

### 30-second explanation
"It's a voice-based mock technical interviewer. You paste your GitHub profile, and an AI interviewer talks with you, live, about your own projects for two or three questions. Afterwards a second model grades the transcript and gives you a score out of 10 with written feedback. It's React and an Express/Bun backend on Postgres, using OpenAI's Realtime API over WebRTC for the voice. It started from a YouTube build-along, and I've since hardened it with session ownership, rate limits, a fix for a grading race condition, tests, CI and Docker."

### 60-second explanation
"Practising interviews out loud is hard to do alone, so this app runs a short spoken interview tailored to your GitHub.
- **Intake:** the frontend creates an interview; the backend pulls your public repos from the GitHub API and stores them in Postgres.
- **Voice call:** the backend mints a two-minute OpenAI Realtime client secret with the interviewer's instructions, voice and turn detection locked server-side. The browser uses it to open a WebRTC call directly with the `gpt-realtime-2.1-mini` model, so audio never passes through my server and my API key never reaches the browser.
- **Transcript:** because the browser only gets audio back, the backend attaches a 'sideband' WebSocket to the same call and saves both sides' transcripts.
- **Grading:** when you open the results page, the backend atomically claims the interview, sends the transcript to an LLM on OpenRouter with a strict JSON schema, and validates the result with Zod.
- **Identity:** an anonymous HttpOnly cookie, with ownership checks on every interview route."

### 2-minute technical explanation
"Architecturally it's two apps in a Turborepo: a React 19 SPA served by Bun, and an Express 5 API on Bun with Prisma and Postgres. There are no queues or workers. The interesting parts are how the voice call is set up, and how the server observes a call it isn't in the middle of.

**Call setup.**
1. The browser calls `POST /realtime/client-secret/:id`.
2. The backend checks the session owns the interview, builds the system prompt from the stored GitHub data, and calls OpenAI's `client_secrets` endpoint. The session config is pinned: model, `marin` voice, `semantic_vad` turn detection with `interrupt_response` so the candidate can barge in, near-field noise reduction, and input transcription.
3. The browser creates an `RTCPeerConnection`, adds the mic track and an `oai-events` data channel, and posts its SDP offer to OpenAI's `/realtime/calls` with the ephemeral key.
4. OpenAI answers with SDP and a `Location` header containing the call id, which OpenAI exposes via CORS. The browser relays that id to my backend.
5. The backend validates it with a strict regex and opens a WebSocket to `wss://api.openai.com/v1/realtime?call_id=…` using the real key. It listens for input-transcription-completed and `response.done` events and writes `Message` rows.

**Reconnection.** If the peer connection fails, the data channel closes or the session expires, the client retries up to three times with exponential backoff. Each new session's instructions include the transcript so far, so the interviewer resumes rather than restarting.

**Grading.** Grading is lazy. The first results poll runs an `updateMany … WHERE status IN the old state` to flip it to `Grading`. Postgres makes that atomic, so only one concurrent poll wins and pays for the LLM call; failures land in a retryable `Failed` state. That replaced an earlier bug where every 5-second poll triggered a new paid grading call."

### 5-minute deep technical explanation
Use the 2-minute version, then add these four parts.

1. **Security model.** "There are no accounts. `ensureSession` issues a random-UUID `sid` cookie: HttpOnly, SameSite=Lax, Secure in production. The interview's `ownerId` is set to it, and `requireOwner` guards every interview route. CORS allows only the configured frontend origin with credentials. Intake is limited to 5 per 15 minutes per IP and the realtime endpoints to 10, because each one costs money. The real OpenAI key exists only on the server. The browser gets a 120-second client secret, and because the session config is baked into the secret, the client can't swap the model or the instructions. I hash the session id into OpenAI's safety-identifier header for abuse attribution."
2. **Data model.** "Two tables, `Interview` and `Message`, one-to-many. `Interview.status` is a small state machine: `Pre → Grading → Done | Failed`, and `Failed` is re-claimable. The GitHub payload is JSONB. Five migrations show the evolution: timestamps, feedback, the Grading/Failed states for the race fix, then ownership."
3. **Testing and delivery.** "bun:test unit tests cover the LLM-output parsing failure modes, call-id validation and prompt construction. Supertest integration tests run against a real Postgres both locally and in GitHub Actions, covering intake, validation, rate-limit headers, ownership (403) and the grade-and-read path with the LLM mocked. Docker Compose brings up Postgres, runs migrations on backend boot, and starts both apps."
4. **What I'd fix next, honestly.**
   - **Docker secrets:** `.dockerignore` doesn't exclude `.env`, so secrets get baked into images.
   - **Grading timing:** grading triggers on first read, so it can race the last transcript event. I'd add an explicit end endpoint and only grade ended interviews.
   - **Transcript order:** the results query doesn't order the messages.
   - **Grader prompt injection:** the grader prompt takes raw candidate speech, and the score isn't bounded to 0–10.
   - **Single instance:** rate limits and sideband state are in memory, so it's single-instance until those move to shared infrastructure, with grading moving to a job queue."

---

## Questions I should be able to answer

### Product

**1. What problem does this solve?**
Practising technical interviews *out loud*, about your *own* work, without needing another person. It asks about your repos (from GitHub) and gives a score and feedback.

**2. Who is the user and what's the journey?**
A job seeker with a public GitHub. The journey: paste profile → allow mic → 2–3 spoken questions (a few minutes) → End interview → results page with score /10, feedback and transcript. No sign-up.

**3. Why GitHub as the input?**
It's a public, structured signal of what someone actually built (repo names, descriptions, stars), so questions can be personal without an upload step. It's thin, though: only names and descriptions of the first 30 repos, no code.

**4. How do you know the score is meaningful?**
I don't, beyond the model's judgement. There's no rubric beyond the grader prompt and no evaluation dataset. That's a known limitation. I'd add a rubric (e.g. depth, correctness, communication) and test the grader against hand-scored transcripts.

### Architecture

**5. Draw the architecture.**
Browser SPA ↔ Express API ↔ Postgres. The API also calls GitHub, OpenAI (client secrets plus the sideband WebSocket) and OpenRouter. Separately, the browser ↔ OpenAI over WebRTC for the audio. See [ARCHITECTURE.md §1](ARCHITECTURE.md#1-the-system-in-one-picture).

**6. Why does the browser connect directly to OpenAI instead of streaming audio through your server?**
Latency and simplicity. WebRTC gives sub-second, jitter-buffered, echo-cancelled audio, and my server never has to handle media. The trade-off is that my server doesn't see the conversation directly, hence the sideband.

**7. What is the sideband and why is it needed?**
A server-side WebSocket attached to the same Realtime call via its `call_id`. Over WebRTC the browser only receives the AI's *audio*, and grading needs *text*. The sideband receives transcription events server-side, so the transcript comes from a trusted source rather than from the browser (which a user could forge).

**8. How does the server learn the call id?**
OpenAI returns it in the `Location` header of the SDP response (`/v1/realtime/calls/rtc_…`). OpenAI's CORS policy exposes `Location`, so the browser reads it and POSTs it to `/api/v1/realtime/sideband/:id`. The server validates it against `^rtc_[A-Za-z0-9_-]{1,128}$` before using it in a URL.

**9. Are there background workers or queues?**
No. Transcript capture is an event-driven WebSocket inside the API process. Grading runs inside the results `GET` request, de-duplicated with an atomic DB update. Fine for a demo; at scale I'd move grading to a job queue.

### Frontend

**10. How does the live screen know who is speaking?**
Each audio stream (the mic, and the AI's remote track) goes into a Web Audio `AnalyserNode`. `createLevelMeter` computes RMS volume. `useVoiceLevel` smooths it (fast attack, slow release), applies a noise gate and a perceptual curve, and writes it to a CSS variable `--level` every animation frame, so React doesn't re-render 60 times a second. "Speaking" flips only after 120 ms above / 350 ms below threshold, to avoid flicker.

**11. How is mute implemented?**
`track.enabled = false` on the mic track: WebRTC keeps the connection and sends silence, so server VAD hears nothing. It works from a button (`aria-pressed`) or the **M** key, and is announced through the status live region.

**12. What happens when the connection drops?**
`handleDrop` closes the old peer connection and retries up to 3 times (1 s, 2 s, 4 s). A generation counter stops one failure reported twice (data-channel close *and* `waitForOpen` rejecting) from scheduling two retries. The mic stream and `AudioContext` are reused. A mic-permission error is fatal (no retry); after 3 failures an error card offers Try again.

**13. How do you avoid leaking the mic or audio resources?**
`stopRef` (on End and on unmount) clears the retry timer, closes the data channel and peer connection, stops all mic tracks (so the browser's mic indicator turns off), clears the audio element's `srcObject` and closes the `AudioContext`.

**14. How does the results page get the score?**
It polls `GET /api/v1/result/:id` every 5 s until `Done` or `Failed`. Weakness: it doesn't handle request errors, so a 404 spins forever (B4).

### Backend

**15. Walk through `POST /api/v1/pre-interview`.**
CORS → cookie parse → `ensureSession` (issues `sid`) → rate limit 5/15 min/IP → Zod checks `github` is a string → username = last URL segment → GitHub `/users/:u/repos` → `Interview` row with `status: Pre`, `ownerId: sid` → `{ id }`.

**16. Walk through minting a client secret.**
`requireOwner` → load interview + prior messages → `buildInstructions` (structured interviewer prompt + GitHub data labelled as data + replayed transcript if reconnecting) → `POST /v1/realtime/client_secrets` with the server key, a 120 s TTL and the full session config → return `{ clientSecret, expiresAt, model }` with `Cache-Control: no-store`.

**17. What did you fix in grading and how?**
Originally the results handler graded on every poll until `Done`, so concurrent 5 s polls each fired a paid LLM call, and a failure left the row stuck. Now:
1. **Atomic claim:** `updateMany({ where: { id, status: old }, data: { status: "Grading" } })`; only the request that gets `count === 1` grades.
2. **Failure state:** errors set `Failed`, which a later poll can re-claim.
3. **Migration:** the `Grading`/`Failed` enum values came in with a migration.

**18. How do you make the LLM return valid structured data?**
OpenRouter `response_format: json_schema` with `strict: true` and `provider.require_parameters: true` (route only to providers that honour it). Then `JSON.parse` and a Zod schema. Refusals, empty output and truncated JSON throw specific errors, and all of those paths are unit-tested.

### Database

**19. Describe the schema.**
`Interview` 1—N `Message`.
- **`Interview`:** `id`, `githubMetadata` (JSONB), `status`, `score`, `feedback`, `ownerId`.
- **`Message`:** `id`, `message`, `type` (`User`/`Assistant`), `interviewId` FK, `createdAt`.

**20. What indexes exist? What's missing?**
Only primary keys. Postgres doesn't auto-index foreign keys, so `Message.interviewId` (read on every results poll) has no index. I'd add `@@index([interviewId, createdAt])`, and probably `Interview.ownerId`.

**21. Why Postgres and not a document DB?**
The data is relational (an interview has many messages) and benefits from transactions and atomic conditional updates (the grading claim). JSONB still lets me store the GitHub blob schemaless.

**22. Any data-integrity issues?**
- **Ordering:** the results query lacks `orderBy`, and `createdAt` reflects insert time, not speech order (B3).
- **Unbounded score:** `score` has no 0–10 constraint.
- **Stuck lock:** a crash mid-grading leaves `Grading` stuck because there's no lease.
- **Unused state:** `InProgress` is never set.

### Security

**23. How does the app know a request belongs to a user?**
It knows browser sessions, not users: a random UUID `sid` cookie (HttpOnly, SameSite=Lax, Secure in prod). Interviews store `ownerId = sid`; `requireOwner` compares them on every interview route (403 otherwise).

**24. How do you keep the OpenAI key out of the browser?**
The key exists only in the backend env. The browser receives a 120-second ephemeral client secret scoped to a session config I define server-side, so it can't choose a different model or prompt. The sideband uses the real key server-side.

**25. What are the main security risks today?**
- **B1 (secrets in images):** `.env` gets copied into Docker images.
- **B10 (cost exposure):** no accounts, so anyone can spend API credit, limited only per IP.
- **B5 (grader injection):** candidate speech can try to steer the grader.
- **No security headers.**
- **B12 (legacy rows):** interviews with a NULL owner are readable by anyone with the id.

**26. Is there SSRF risk?**
Low. All outbound hosts are hard-coded. The GitHub username lands in a GitHub API *path*, and the call id is regex-validated before it goes into the WebSocket URL, which prevents query or path injection there.

**27. What does the rate limiting protect and what are its limits?**
It protects paid endpoints: 5 interviews and 10 realtime calls per 15 min per IP. Limits:
- it's in memory, so per-process and reset on restart;
- without `trust proxy`, all users behind a platform proxy may share one IP;
- both realtime endpoints share one bucket.

### Distributed systems

**28. What happens if the backend restarts mid-interview?**
The WebRTC call continues (it's browser ↔ OpenAI), but the in-memory sideband socket dies, so the rest of the conversation isn't transcribed. Nothing reconnects it unless the browser itself reconnects. Rate-limit counters also reset.

**29. Could you run two backend instances?**
Not safely as-is. Rate limits would split per instance, and the sideband map is per process, so a reconnect landing on another instance wouldn't close the old socket. The grading claim *is* multi-instance safe because it's enforced in Postgres.

**30. Is anything idempotent?**
- **Grading:** effectively once per state transition, thanks to the conditional update.
- **Sideband inserts:** not idempotent. A duplicated event would duplicate a message. You'd fix it by storing OpenAI's `item_id` with a unique constraint.

**31. How is a race between "End" and the last transcript handled?**
It isn't, explicitly. Grading starts on the first results poll, possibly before the last transcription event is saved (B2). Fix: an explicit end endpoint plus a short settle window, or wait for the sideband to close before allowing grading.

### DevOps

**32. How do you run it locally?**
`bun install` (also runs `prisma generate`), start Postgres (`docker compose up -d postgres`), `bunx prisma migrate dev` in `apps/backend`, set `OPENAI_API_KEY` and `OPENROUTER_API_KEY`, then `bun run dev` from the root.

**33. What does CI do?**
GitHub Actions on push to main and on PRs: Postgres 16 service container → `bun install` → `prisma migrate deploy` → `check-types` → `lint --max-warnings 0` → `bun test`, with real-DB integration tests.

**34. How is it deployed?**
It isn't yet. There are Dockerfiles and a compose file (migrations run on backend start), and the README says the host isn't decided. Before deploying I'd fix `.dockerignore`, pin the base image tag, set `trust proxy`, add a health endpoint, and use platform secrets.

### Testing

**35. What's tested?**
19 tests:
- **Intake schema:** accepts a string; rejects missing and non-string values.
- **Grader parsing:** success, truncated JSON, missing field, refusal, HTTP error.
- **Realtime helpers:** default model, call-id validation, prompt construction, safety-id hashing.
- **HTTP integration against real Postgres:** create + cookie, 400, rate-limit headers, owner grades and reads, stranger gets 403, unknown gets 404.

**36. What's not tested, and what would you add first?**
- **Realtime routes and the sideband handler:** I'd add HTTP tests for both routes with OpenAI mocked, and a sideband test that feeds fake events and asserts DB rows.
- **The grading race:** two concurrent `GET /result` calls should produce exactly one `calculateResult` call.
- **Frontend and E2E:** a Playwright E2E test with a fake media device for the error and reconnect states.

**37. Why integration-test against a real DB instead of mocking Prisma?**
The behaviour that matters most, the atomic `updateMany` claim and the ownership queries, is database behaviour. Mocks would just restate my assumptions. CI's Postgres service container makes this cheap.

### Tradeoffs

**38. Grade on read vs. grade on end vs. background job?**
- **Grade on read (current):** no extra infrastructure, and it grades exactly when someone wants the result. But it puts a slow paid call inside a `GET` and can race the end of the transcript.
- **Grade on end:** fixes the race.
- **Background job:** adds retries and restart-safety, at the cost of a queue and a worker.

**39. Client secret flow vs. server-relayed SDP?**
- **Server-relay (this repo's earlier design):** keeps all OpenAI REST traffic server-side and gets the call id for free.
- **Client secrets (current):** follows OpenAI's documented browser pattern and keeps the backend out of the handshake, but needs the browser to relay the call id.

Both keep the real key server-side.

**40. Anonymous cookies vs. accounts?**
- **Anonymous cookies:** zero friction for a demo, and still prevents reading others' results. But no history across devices, and weak cost control.
- **Accounts:** for real users I'd add GitHub OAuth, which fits the product, plus per-user quotas.

---

Next: work through [LEARNING-PATH.md](LEARNING-PATH.md) so you can answer these from understanding, not memory.
