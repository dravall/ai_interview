# AI Interviewer — Interview Prep

> Report set: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · **INTERVIEW-PREP.md** (this file) · [LEARNING-PATH.md](LEARNING-PATH.md)
>
> Every answer is grounded in the repository as of **2026-10-20**, after the fixes logged in [PROJECT-HISTORY.md](PROJECT-HISTORY.md). Where an answer is a recommendation rather than what exists, it says so. Bug IDs (B1…) refer to [PROJECT-DEEP-DIVE.md §18](PROJECT-DEEP-DIVE.md#18-bugs-technical-debt--architectural-problems), which keeps each original finding with what was done about it.
>
> **Be honest about how the fixes were made:** I found and fixed them with Claude Code as a pair; I tested the voice behaviour live myself. The history file says so too. Expect follow-ups that check you understand each fix, and practise explaining them without notes.

---

## Pitches

### 30-second explanation
"It's a voice-based mock technical interviewer. You paste your GitHub profile, and an AI interviewer talks with you, live, about your own projects for two or three questions. Afterwards a second model grades the transcript and gives you a score out of 10 with written feedback. It's React and an Express/Bun backend on Postgres, using OpenAI's Realtime API over WebRTC for the voice. It started from a YouTube build-along. I then audited it and fixed what I found: an explicit interview lifecycle so grading never sees a half-finished transcript, a crash-safe grading lease, prompt-injection-resistant grading, sideband reconnects, and session ownership with rate limits, all covered by 47 tests in CI."

### 60-second explanation
"Practising interviews out loud is hard to do alone, so this app runs a short spoken interview tailored to your GitHub.
- **Intake:** the frontend creates an interview; the backend pulls your public repos from the GitHub API and stores them in Postgres.
- **Voice call:** the backend mints a two-minute OpenAI Realtime client secret with the interviewer's instructions, voice and turn detection locked server-side. The browser uses it to open a WebRTC call directly with the `gpt-realtime-2.1-mini` model, so audio never passes through my server and my API key never reaches the browser.
- **Transcript:** because the browser only gets audio back, the backend attaches a 'sideband' WebSocket to the same call and saves both sides' transcripts.
- **Ending:** when you click End, the browser forces the last half-finished answer to be transcribed, then tells the backend, which waits a few seconds for the final transcript lines before marking the interview `Ended`.
- **Grading:** the results page polls; the first poll atomically claims the ended interview, sends the transcript to an LLM on OpenRouter as delimited data under a rubric, and validates the strict-JSON result with Zod.
- **Identity:** an anonymous HttpOnly cookie, with ownership checks on every interview route."

### 2-minute technical explanation
"Architecturally it's two apps in a Turborepo: a React 19 SPA served by Bun, and an Express 5 API on Bun with Prisma and Postgres. There are no queues or workers. The interesting parts are how the voice call is set up, and how the server observes a call it isn't in the middle of.

**Call setup.**
1. The browser calls `POST /realtime/client-secret/:id`.
2. The backend checks the session owns the interview, builds the system prompt from the stored GitHub data, and calls OpenAI's `client_secrets` endpoint. The session config is pinned: model, `marin` voice, `semantic_vad` turn detection at low eagerness (so a thinking pause doesn't end your turn) with `interrupt_response` so the candidate can barge in, far-field noise reduction, and input transcription.
3. The browser creates an `RTCPeerConnection`, adds the mic track and an `oai-events` data channel, and posts its SDP offer to OpenAI's `/realtime/calls` with the ephemeral key.
4. OpenAI answers with SDP and a `Location` header containing the call id, which OpenAI exposes via CORS. The browser relays that id to my backend.
5. The backend validates it with a strict regex and opens a WebSocket to `wss://api.openai.com/v1/realtime?call_id=…` using the real key. It listens for input-transcription-completed and `response.done` events and upserts `Message` rows keyed by OpenAI's item id, timestamped by when each turn was *spoken*, because the two transcripts can arrive in either order.

**Reconnection.** If the peer connection fails, the data channel closes or the session expires, the client retries up to three times with exponential backoff. Each new session's instructions include the transcript so far, so the interviewer resumes rather than restarting. On the server, a dropped sideband socket retries the same call three times too.

**Lifecycle and grading.** `Pre → InProgress → Ended → Grading → Done | Failed`. End is explicit: the server waits up to five seconds for the call to close and the last saves to land before marking it `Ended`. Only then can a results poll claim it with a conditional `updateMany`. Postgres makes that atomic, so only one concurrent poll wins and pays for the LLM call. The claim also stamps a lease, so if the process dies mid-grading, the row can be re-claimed after two minutes; automatic retries stop after three attempts."

### 5-minute deep technical explanation
Use the 2-minute version, then add these four parts.

1. **Security model.** "There are no accounts. `ensureSession` issues a random-UUID `sid` cookie: HttpOnly, SameSite=Lax, Secure in production. The interview's `ownerId` is set to it, and `requireOwner` guards every interview route. CORS allows only the configured frontend origin with credentials. Each paid endpoint has its own per-IP limit (intake 5, client secret 10, sideband 20, grading retry 5 per 15 minutes), and `TRUST_PROXY` makes the IP correct behind a load balancer. Interviews with no owner are denied outright, and the API sends security headers. The real OpenAI key exists only on the server. The browser gets a 120-second client secret, and because the session config is baked into the secret, the client can't swap the model or the instructions. I hash the session id into OpenAI's safety-identifier header for abuse attribution."
2. **Data model.** "Two tables, `Interview` and `Message`, one-to-many. `Interview.status` is the lifecycle state machine; `gradingStartedAt` and `gradingAttempts` implement the lease and retry cap. `Message.itemId` is unique, so a replayed event can't duplicate a turn, and there's an index on `(interviewId, createdAt)` for the ordered transcript read. Eight migrations show the evolution."
3. **Testing and delivery.** "47 tests. Unit tests cover LLM-output failure modes and the grader's prompt shape; a sideband suite drives a fake WebSocket with fake timers through drops, reconnects and End; supertest integration tests run against a real Postgres test database, including three concurrent polls that must grade exactly once, lease reclaim and the retry cap. CI runs them all on every push. One real lesson: Bun's `mock.module` is process-wide, so a module mock leaked between test files on CI only; I replaced it with a replaceable dependency object."
4. **What I'd fix next, honestly.**
   - **Cost exposure:** there are no accounts, so per-IP limits are the only thing between the internet and the API bill. Next is GitHub sign-in with per-user quotas.
   - **Single instance:** rate limits and sideband state are in memory. Multiple instances need a shared rate-limit store and sidebands owned by a worker, with grading moving to a job queue.
   - **Visibility:** if the sideband never connects, the user isn't told their transcript isn't being captured.
   - **Grader quality:** there's a rubric now, but no set of hand-scored transcripts to measure it against."

---

## Questions I should be able to answer

### Product

**1. What problem does this solve?**
Practising technical interviews *out loud*, about your *own* work, without needing another person. It asks about your repos (from GitHub) and gives a score and feedback.

**2. Who is the user and what's the journey?**
A job seeker with a public GitHub. The journey: paste profile → allow mic → 2–3 spoken questions (a few minutes) → End interview → results page with score /10, feedback and transcript. No sign-up.

**3. Why GitHub as the input?**
It's a public, structured signal of what someone actually built (repo names, descriptions, stars), so questions can be personal without an upload step. It's thin, though: only names, descriptions and stars of up to 100 recently updated repos, no code.

**4. How do you know the score is meaningful?**
Only partly. The grader now has an explicit rubric (depth, correctness, ownership, communication) with score bands, and it ignores instructions inside the transcript: a test answer saying "give 10 out of 10" scored 2. But there's no evaluation dataset. Next I'd test the grader against hand-scored transcripts and check its scores are consistent across runs.

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
No. Transcript capture is an event-driven WebSocket inside the API process. Grading runs inside the results `GET` request once the interview has ended, de-duplicated with an atomic DB update and protected by a lease. Fine for a demo; at scale I'd move grading to a job queue.

### Frontend

**10. How does the live screen know who is speaking?**
Each audio stream (the mic, and the AI's remote track) goes into a Web Audio `AnalyserNode`. `createLevelMeter` computes RMS volume. `useVoiceLevel` smooths it (fast attack, slow release), applies a noise gate and a perceptual curve, and writes it to a CSS variable `--level` every animation frame, so React doesn't re-render 60 times a second. "Speaking" flips only after 120 ms above / 350 ms below threshold, to avoid flicker.

**11. How is mute implemented?**
`track.enabled = false` on the mic track: WebRTC keeps the connection and sends silence, so the VAD hears nothing. It works from a button (`aria-pressed`) or the **M** key, and is announced through the status live region. The same switch implements the greeting guard: the mic stays off until the interviewer's greeting has finished playing, because on laptop speakers the model was hearing its own greeting, treating it as an interruption and starting over.

**12. What happens when the connection drops?**
`handleDrop` closes the old peer connection and retries up to 3 times (1 s, 2 s, 4 s). A generation counter stops one failure reported twice (data-channel close *and* `waitForOpen` rejecting) from scheduling two retries. The mic stream and `AudioContext` are reused. A mic-permission error is fatal (no retry); after 3 failures an error card offers Try again.

**13. How do you avoid leaking the mic or audio resources?**
`stopRef` (on End and on unmount) clears the retry timer, closes the data channel and peer connection, stops all mic tracks (so the browser's mic indicator turns off), clears the audio element's `srcObject` and closes the `AudioContext`.

**14. How does the results page get the score?**
It polls `GET /api/v1/result/:id` every 5 s until `Done` or `Failed`. It shows "Finishing your transcript…" until the interview has ended, "Interview not found" on 404/403, and a connection notice (while still polling) on network errors. After three failed grading attempts it offers Try again, which calls a retry endpoint. Originally a 404 spun forever (B4).

### Backend

**15. Walk through `POST /api/v1/pre-interview`.**
CORS → security headers → cookie parse → `ensureSession` (issues `sid`) → rate limit 5/15 min/IP → Zod checks `github` is a string ≤ 200 → `parseGithubUsername` (a profile URL or bare username by GitHub's rules, else 400) → GitHub `/users/:u/repos?per_page=100&sort=updated` (unknown user → 404, rate limit → 503) → `Interview` row with `status: Pre`, `ownerId: sid` → `{ id }`.

**16. Walk through minting a client secret.**
`requireOwner` → load interview + prior messages → `buildInstructions` (structured interviewer prompt + GitHub data labelled as data + replayed transcript if reconnecting) → `POST /v1/realtime/client_secrets` with the server key, a 120 s TTL and the full session config → return `{ clientSecret, expiresAt, model }` with `Cache-Control: no-store`.

**17. What did you fix in grading and how?**
In stages.
1. **Atomic claim (earlier):** every 5 s poll used to fire a paid LLM call. Now one `updateMany` with a status condition flips the row to `Grading`; only the request that gets `count === 1` grades.
2. **Grade only ended interviews:** grading used to start on the first results poll, which could be before the last answer was transcribed, or even during the call from another tab. Now there's an explicit `POST /end` that waits for the transcript to settle, and only `Ended` rows are claimable.
3. **Lease:** the claim stamps `gradingStartedAt`. If the process dies mid-grading, the row is re-claimable after 2 minutes, and the final write is conditioned on that same lease, so a slow old attempt can't overwrite a newer one.
4. **Retry cap:** automatic attempts stop at 3; then the user gets a Try again button that resets the count.
5. **Grader input:** a rubric in the system message, the transcript as delimited data, the score validated to 0–10, and an empty transcript scores 0 without paying for a call.

**18. How do you make the LLM return valid structured data?**
OpenRouter `response_format: json_schema` with `strict: true` and `provider.require_parameters: true` (route only to providers that honour it). Then `JSON.parse` and a Zod schema. Refusals, empty output and truncated JSON throw specific errors, and all of those paths are unit-tested.

### Database

**19. Describe the schema.**
`Interview` 1—N `Message`.
- **`Interview`:** `id`, `githubMetadata` (JSONB), `status`, `score`, `feedback`, `ownerId`, `gradingStartedAt`, `gradingAttempts`, `createdAt`, `updatedAt`.
- **`Message`:** `id`, `message`, `type` (`User`/`Assistant`), `interviewId` FK, `createdAt` (when the turn was spoken), `itemId` (OpenAI's item id, unique).

**20. What indexes exist, and why?**
`Message(interviewId, createdAt)`, because every results poll reads one interview's messages in order, and Postgres doesn't auto-index foreign keys. `Interview(ownerId)` for looking up a session's interviews. `Message.itemId` is unique, which is also an index. Originally there were only primary keys.

**21. Why Postgres and not a document DB?**
The data is relational (an interview has many messages) and benefits from transactions and atomic conditional updates (the grading claim). JSONB still lets me store the GitHub blob schemaless.

**22. Any data-integrity issues?**
There were four, all fixed:
- **Ordering:** the query had no `orderBy`, and insert time isn't speech order, because a candidate's transcript can arrive after the AI's reply. Now `createdAt` is set from when OpenAI created the conversation item, and the query orders by it.
- **Duplicates:** a replayed event inserted a second row. Now saves upsert on a unique `itemId`.
- **Unbounded score:** Zod now rejects anything outside 0–10 (there's no DB `CHECK` yet).
- **Stuck lock:** a crash mid-grading left `Grading` forever. Now there's a lease.

What's left: `githubMetadata` is a JSON string inside JSONB, which is harmless but can't be queried.

### Security

**23. How does the app know a request belongs to a user?**
It knows browser sessions, not users: a random UUID `sid` cookie (HttpOnly, SameSite=Lax, Secure in prod). Interviews store `ownerId = sid`; `requireOwner` compares them on every interview route (403 otherwise).

**24. How do you keep the OpenAI key out of the browser?**
The key exists only in the backend env. The browser receives a 120-second ephemeral client secret scoped to a session config I define server-side, so it can't choose a different model or prompt. The sideband uses the real key server-side.

**25. What are the main security risks today?**
The biggest one left is **cost exposure (B10)**: there are no accounts, so anyone can spend API credit, limited only per IP. Ones I found and fixed:
- **Secrets in images (B1):** `.dockerignore` didn't exclude `.env`, so `COPY . .` baked API keys into both images.
- **Grader injection (B5):** candidate speech went straight into the grading prompt. Now it's delimited data under a system rubric.
- **No security headers:** now `nosniff`, `DENY` framing, a deny-all CSP for the JSON API, no referrer, no caching.
- **Owner-less rows (B12):** interviews from before ownership existed were readable by anyone with the id. Now they're denied.

**26. Is there SSRF risk?**
Low. All outbound hosts are hard-coded. The GitHub username lands in a GitHub API *path*, and the call id is regex-validated before it goes into the WebSocket URL, which prevents query or path injection there.

**27. What does the rate limiting protect and what are its limits?**
It protects paid endpoints, per IP per 15 minutes, with a separate bucket for each: intake 5, client secret 10, sideband 20, grading retry 5. Separate buckets mean a few reconnects can't use up your budget for starting interviews. Behind a load balancer every request comes from the proxy's IP, so `TRUST_PROXY=<hops>` makes Express read the client IP from `X-Forwarded-For`; it's off by default because, without a proxy, clients could spoof that header. The remaining limit: it's in memory, so per-process and reset on restart.

### Distributed systems

**28. What happens if the backend restarts mid-interview?**
The WebRTC call continues (it's browser ↔ OpenAI), but the in-memory sideband dies with the process, so the rest of the conversation isn't transcribed unless the browser itself reconnects. Afterwards, idle recovery ends the interview (no live sideband and no activity for 60 s), so it still gets graded on what was captured. Rate-limit counters also reset. Note the difference from a *socket drop* while the server stays up: that reconnects to the same call automatically.

**29. Could you run two backend instances?**
Not safely as-is. Rate limits would split per instance, and the sideband map is per process, so a reconnect landing on another instance wouldn't close the old socket. The grading claim *is* multi-instance safe because it's enforced in Postgres.

**30. Is anything idempotent?**
- **Grading:** once per attempt, thanks to the conditional update; final writes are conditioned on the attempt's lease.
- **Sideband saves:** yes. Each turn is upserted on OpenAI's `item_id`, which has a unique constraint, so a replayed event keeps one row.
- **End and retry:** both are conditional updates, so calling them twice is harmless.

**31. How is a race between "End" and the last transcript handled?**
In two places.
- **Browser:** on End it sends `input_audio_buffer.commit`, so a half-finished answer is transcribed rather than dropped, and waits up to 3 s for that transcript (or OpenAI's "buffer empty" error if you'd stopped talking).
- **Server:** `POST /end` waits up to 5 s for OpenAI to close the call, then for any in-flight saves, and only then marks the interview `Ended`. Grading only claims `Ended` rows.

If the End request never arrives (tab closed), the sideband's close handler ends it after a 30 s grace for reconnects. Originally grading started on the first results poll and could miss the last answer (B2).

### DevOps

**32. How do you run it locally?**
`bun install` (also runs `prisma generate`), start Postgres (`docker compose up -d postgres`), `bunx prisma migrate dev` in `apps/backend`, set `OPENAI_API_KEY` and `OPENROUTER_API_KEY`, then `bun run dev` from the root.

**33. What does CI do?**
GitHub Actions on push to main and on PRs: Postgres 16 service container → `bun install` → `prisma migrate deploy` → `check-types` → `lint --max-warnings 0` → `bun test`, with real-DB integration tests.

**34. How is it deployed?**
It isn't yet. There are Dockerfiles and a compose file (migrations run on backend start), and the README says the host isn't decided. Already done in preparation: `.env` excluded from images, the Bun image pinned to the CI version, and `TRUST_PROXY` support. Still needed: a health endpoint, platform secrets, and a spend cap on the API accounts.

### Testing

**35. What's tested?**
47 tests in 5 files:
- **Intake (5):** schema, profile-URL parsing, rejecting repo links and other hosts.
- **Grader (8):** success, truncated JSON, missing field, refusal, HTTP error, out-of-range score, empty transcript (no call), and the prompt's shape (rubric in system, transcript delimited).
- **Realtime helpers (6):** default model, call-id validation, prompt construction and replay, safety-id hashing, turn detection.
- **Sideband (9), fake WebSocket + fake timers:** saving both sides, speech-order timestamps, End waiting for saves, reconnect, give-up-then-grace, browser reconnect inside the grace, End during a reconnect.
- **HTTP integration against a real Postgres test DB (19):** the full lifecycle, three concurrent polls grading exactly once, lease reclaim, retry cap, ownership, owner-less rows, per-endpoint limits behind a proxy, security headers, idempotent saves, GitHub error mapping.

**36. What's not tested, and what would you add first?**
- **Frontend and E2E:** first, a Playwright E2E test with a fake media device for the error, reconnect and End states.
- **The client-secret route's OpenAI call over HTTP**, with OpenAI mocked.
- **Coverage measurement** in CI.

(The sideband and the grading race, which used to be untested, now have tests.)

**37. Why integration-test against a real DB instead of mocking Prisma?**
The behaviour that matters most, the atomic `updateMany` claim, the lease and the ownership queries, is database behaviour. Mocks would just restate my assumptions. The concurrency test only means something against real Postgres. CI's Postgres service container makes this cheap, and locally the tests use a separate database so they never touch dev data.

### Tradeoffs

**38. Grade on read vs. grade on end vs. background job?**
- **Grade on read after an explicit End (current):** End settles the transcript, so there's no race, and the first poll grades with no extra infrastructure. But it puts a slow paid call inside a `GET`.
- **Grade inside the End request:** simpler polling, but End would take as long as the LLM call.
- **Background job:** fast requests, retries with backoff and restart-safety, at the cost of a queue and a worker. The lease and attempt cap give me some of that without one.

**39. Client secret flow vs. server-relayed SDP?**
- **Server-relay (this repo's earlier design):** keeps all OpenAI REST traffic server-side and gets the call id for free.
- **Client secrets (current):** follows OpenAI's documented browser pattern and keeps the backend out of the handshake, but needs the browser to relay the call id.

Both keep the real key server-side.

**40. Anonymous cookies vs. accounts?**
- **Anonymous cookies:** zero friction for a demo, and still prevents reading others' results. But no history across devices, and weak cost control.
- **Accounts:** for real users I'd add GitHub OAuth, which fits the product, plus per-user quotas.

---

Next: work through [LEARNING-PATH.md](LEARNING-PATH.md) so you can answer these from understanding, not memory.
