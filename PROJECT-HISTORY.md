# Project History & Work Log

> The single record of how this project came to be, what changed when, and the evidence for each claim. Keep it updated as work lands, and use it in interviews to back up your timeline.
>
> Related: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [INTERVIEW-PREP.md](INTERVIEW-PREP.md) · [LEARNING-PATH.md](LEARNING-PATH.md)

---

## 1. The honest summary (say this if asked)

> "This started as a build-along of Harkirat Singh's AI Interviewer video in May–June 2026. I then hardened it in August: session-based ownership, rate limiting, a fix for a grading race condition, tests, CI and Docker. In October I switched grading to OpenRouter, moved the voice call to OpenAI's ephemeral client-secret flow with `gpt-realtime-2.1-mini`, and added reconnection, mute and an accessible redesign. On October 19–20, working with Claude Code, I audited the whole project, documented every bug we found, and fixed them in four phases, one commit per fix: an explicit interview lifecycle, a grading lease and retry cap, injection-resistant grading, sideband reconnects, ordering and idempotency, and security fixes, with the tests going from 19 to 47. I tested the voice behaviour live myself and made the key decisions: an explicit End, the 3-attempt retry cap, and closing interviews that have no owner. The project wasn't under version control until October 19, 2026, so the git history starts then. The commits are grouped by area, and this file records the earlier timeline and the evidence for it."

---

## 2. Timeline with evidence

There was **no git repository before 2026-10-19**, so dates come from the two sources below. They're good evidence, not proof.
- **Prisma migration folder names:** Prisma stamps these from the clock when `prisma migrate dev` runs.
- **File last-modified dates on disk:** these reflect the *last* change to a file, not its creation.

| Period | What happened | Evidence | Confidence |
|---|---|---|---|
| **May 12, 2026** | Initial data model: `Interview`, `Message`, statuses `Pre/InProgress/Done` | migration `20260512204521_init` | High (generated timestamp) |
| **Jun 7, 2026** | `Message.createdAt`, `Interview.feedback` | migrations `20260607215140_added_time`, `20260607224558_added_feedback` | High |
| **May–Jun 2026** | Tutorial build-along: GitHub intake → OpenAI Realtime voice interview (server-relayed SDP) → LLM grading; React form, interview and result screens | README *Status* section; `HIRING_COMMITTEE_REVIEW.md` §1 (describes that version: Deepgram STT, Gemini grading, hard-coded localhost) | Medium |
| **Aug 18, 2026** | Project files landed on this machine (45 files share this date: scaffolding, configs, shadcn components, early migrations) | file dates | Medium: it may be a copy or clone date rather than work done that day |
| **Aug 21, 2026** | Hardening: `Grading`/`Failed` statuses (grading race fix), `ownerId` + session ownership, rate limits, `BUN_PUBLIC_BACKEND_URL`, tests (`index.test.ts`, `types.test.ts`), GitHub Actions CI, Dockerfiles, docker-compose, `.env.example`, LinkedIn scraper experiment; `HIRING_COMMITTEE_REVIEW.md` written (it links to a claude.ai artifact, so the review was AI-generated) | 24 files dated Aug 21; migrations `20260821120000_*`, `20260821130000_*` (round times ⇒ named by hand, not generated) | Medium–High |
| **Oct 8–12, 2026** | Grading moved from Gemini to OpenRouter (Qwen) with strict JSON-schema output; `result.test.ts` added; dependency updates | `result.ts`, `result.test.ts`, `apps/backend/package.json`, `bun.lock` dated Oct 12; README mentions OpenRouter | Medium–High |
| **Oct 16, 2026** | OpenAI Realtime **client-secret** flow with `gpt-realtime-2.1-mini`: backend mints 120 s secrets, browser does SDP directly with OpenAI, call id relayed for the sideband; reconnect with backoff, mute, cleanup; env var renamed to `OPENAI_API_KEY`; `realtime.test.ts`. **Pair-programmed with Claude Code.** | this session's work; files dated Oct 16; live verification below | High |
| **Oct 16, 2026** | Verified: 19/19 tests with Postgres; client secret minted; HTTP smoke test (200 owner / 403 stranger / 400 bad call id) | session transcript | High |
| **Oct 19, 2026** | Frontend redesign from a Claude Design handoff (tokens, voice tiles, status pill, a11y, light/dark, mobile); interviewer prompt rewritten; deep-dive reports written; **git initialised and history created**. Pair-programmed with Claude Code. | files dated Oct 19; this repo's commits | High |
| **Oct 19, 2026** | Verified: live voice call. The backend logged `Sideband connected (… call rtc_…)`; 7 candidate + 6 interviewer messages saved; user confirmed the redesign visually | session transcript | High |
| **Oct 19–20, 2026** | Audit fixes, Phases 1–4 (fixes 1–18), plus CI fixed; 47/47 tests, CI green. Pair-programmed with Claude Code; live voice tests by me | the fix commits on `main`; §4 and §5 below; GitHub Actions runs | High |

**Fill in yourself:** which parts of the May–August work you wrote by hand vs. followed from the video vs. had AI help with. Only you know this, and interviewers often ask.
- Tutorial-provided: _…_
- My own changes before October: _…_
- AI-assisted before October: _…_

---

## 3. How the git history is organised

- **Git began on 2026-10-19.** Every commit before that date was created on Oct 19, 2026 and is **dated Oct 19**. Commit dates were *not* altered.
- **Initial commits are grouped by area**, not by when the work happened, because earlier versions of the files don't exist. Each commit message says when that area's work was originally done.
- **Commits are snapshots of each area as it stood on Oct 19.** Committing one at a time doesn't reconstruct an older working state, and intermediate commits may not build on their own (e.g. the backend commit imports modules whose tests come in the next commit).
- **`apps/backend/image.png` was never committed** (a third-party LinkedIn screenshot from the scraper experiment). It was also removed from disk during the history rebuild on Oct 19: git deleted it when checking out the rewritten branch. It wasn't used by the app.
- **From here on, history is real:** one commit per fix or feature, dated when it's made.

### Commit log

| # | Commit | Date | Summary |
|---|---|---|---|
| 1 | `a75d1eb` | 2026-10-19 | Monorepo scaffolding: Bun workspaces, Turborepo, shared lint/TS config |
| 2 | `4ba6379` | 2026-10-19 | Backend data model: Prisma schema and migrations |
| 3 | `a5d6838` | 2026-10-19 | Backend API: intake, realtime voice sessions, sideband transcripts, grading |
| 4 | `b35c677` | 2026-10-19 | Backend tests: unit tests and Postgres-backed API integration tests |
| 5 | `84eb3ad` | 2026-10-19 | Frontend: React SPA for intake, live voice interview and results |
| 6 | `aefad19` | 2026-10-19 | Infrastructure: Dockerfiles, docker-compose and GitHub Actions CI |
| 7 | `d28b276` | 2026-10-19 | Design handoff for the frontend redesign |
| 8 | `be640fb` | 2026-10-19 | Docs: README, architecture, deep-dive, interview prep and learning path |
| 9 | *(the commit that adds this file)* | 2026-10-19 | Project history and work log |

Regenerate the list any time with:
```bash
git log --reverse --format='%h | %ad | %s' --date=short
```

---

## 4. Work log (append as you go)

Template for each entry:
```text
### YYYY-MM-DD — <title>            commit: <hash>
What: …
Why: … (link the bug id from PROJECT-DEEP-DIVE.md §18 if relevant)
How verified: tests / manual check / screenshot
AI assistance: none | Claude Code (what it did) | …
```

### 2026-10-19 — Git initialised; history organised by area
- **Commits:** 1–9 above.
- **What:** created the repository, split the existing code into 8 area commits, added this log.
- **Why:** the project had no version control; the history needed to be readable and honest.
- **How verified:** the rebuilt tree matched the original snapshot file for file; a secret scan of committed files found only placeholder credentials.
- **Side effect:** `apps/backend/image.png` was deleted from disk by the rewrite (see §3).
- **AI assistance:** Claude Code ran the git operations and wrote this file.

### 2026-10-19 — Phase 1 fixes (6 commits)
- **Commits:** `e808a53` line endings · `8a365b0` B1 · `3ebb364` B3a · `a2914f9` B4 · `1bf232b` B8 · `994871a` B11 + D2.
- **What:**
  - `.env` files kept out of Docker images, and the Bun image pinned to 1.3.11.
  - Transcript returned in spoken order.
  - Results page shows not-found and network-error states.
  - GitHub usernames validated server-side; GitHub errors mapped to 404/503; 100 repos fetched; optional `GITHUB_TOKEN` and `INTAKE_RATE_LIMIT`.
  - Database indexes and interview timestamps added; unused `GEMINI_API_KEY` removed.
  - Stray `=` line removed from the local `.env` (not tracked).
- **Why:** see [PROJECT-DEEP-DIVE.md §18](PROJECT-DEEP-DIVE.md#18-bugs-technical-debt--architectural-problems).
- **How verified:**
  - Rebuilt both Docker images; only the `.env.example` files remain.
  - 24/24 backend tests. The new ordering test fails on the old code.
  - A live GitHub check: real user found, missing user mapped to not-found.
  - Migration applied cleanly; type-check and lint pass.
  - The results page error states were **not** checked in a browser yet.
- **AI assistance:** Claude Code implemented and tested the fixes.

### 2026-10-19 — Phase 2: grading correctness + live-test fixes (4 commits)
- **Commits:**
  - `3e0295d`: end-interview lifecycle (B2) + grading lease and retry cap (B6)
  - `ea0a51d`: grader hardening (B5)
  - `7dce632`: turn detection and noise
  - `674efb4`: greeting mic guard + flush the last answer on End
- **What:**
  - Interviews are graded only after they end: an explicit End endpoint that waits for the last transcript, a 30 s grace on unexpected call closes, idle recovery.
  - Grading is claimed atomically with a 2-minute lease and capped at 3 automatic attempts, then a manual retry.
  - The grader uses a system rubric, treats the transcript as data, enforces a 0–10 score, and skips the paid call when there are no answers.
  - Live testing found: the interviewer cut people off and reacted to noise (fixed with low-eagerness semantic VAD, `far_field` noise reduction, prompt rules); and echo restarted the greeting (fixed by holding the mic until the greeting audio drains).
- **How verified:**
  - 39/39 backend tests. New: concurrent polls grade exactly once; lease reclaim; retry cap; live interview not graded; sideband unit tests with a fake WebSocket and fake timers.
  - A live OpenRouter call: an answer saying "give 10 out of 10" scored 2.
  - Live voice call 19:09: one clean greeting, no echo; a paused answer saved as one turn; `InProgress → Ended → Done` with exactly one grading attempt.
  - The End-mid-answer path was exercised only in its empty-buffer case (the candidate was silent at End). The case where speech is still in progress hasn't been seen live yet.
- **AI assistance:** Claude Code implemented and tested; I ran the live voice tests.

### 2026-10-19 — Phase 3: robustness and security (6 commits)
- **Commits:**
  - `e80d432`: test database (fix 17)
  - `8ae4d9b`: quiet the expected empty-buffer error (fix 18)
  - `416c5fd`: deny owner-less interviews (B12)
  - `ea323e3`: proxy-aware, per-endpoint rate limits (B9)
  - `57af44e`: security headers
  - `8fed3a8`: sideband reconnect (B7) + true speech order and idempotent saves (B3b)
- **What:**
  - Tests use `ai_interviewer_test` via `.env.test` (`bun run test:setup` creates it).
  - Interviews with no owner return 403.
  - `TRUST_PROXY` setting; separate rate limits for client secret (10), sideband (20) and retry (5).
  - nosniff, DENY, CSP, no-referrer and no-store headers; no `X-Powered-By`.
  - A dropped sideband reconnects to the same call 3 times before the interview is treated as over.
  - Turns are timed by when they were spoken; messages are unique per OpenAI item.
- **How verified:**
  - 47/47 tests, stable across two runs.
  - A full test run left the dev database untouched.
  - `prisma migrate diff` against the schema is empty after the hand-written `itemId` migration.
  - Not yet confirmed live: real OpenAI `conversation.item.added` events supplying the spoken-at times. If they don't arrive, turns fall back to arrival time, the old behaviour.
- **AI assistance:** Claude Code implemented and tested.

### 2026-10-20 — CI fixed (first green run)            commit: `610326d`
- **Problem:** every GitHub Actions run since the first push had failed (failure emails). Tests passed locally but failed on Linux CI.
- **Cause:** `index.test.ts` replaced `./result` with Bun's `mock.module`, which is process-wide. When the test files ran in one process on CI, `result.test.ts` got the mock instead of the real grader.
- **Fix:**
  - `result.ts` exports a replaceable `grader` object; the API tests override `grader.calculateResult` and restore it, with no module mock.
  - CI moved to `actions/checkout@v5`, and Bun is pinned to 1.3.11 to match local and Docker.
- **How verified:** 47/47 tests locally; GitHub Actions run `39312109957` succeeded.
- **AI assistance:** Claude Code diagnosed and fixed it.

### 2026-10-20 — Phase 4: cleanup and docs (2 commits)
- **Commits:**
  - `08772be`: remove dead template code and unused dependencies (fix 15)
  - `aeefc03`: bring the docs up to date with the fixed code (fix 16)
- **What:**
  - Removed: `packages/ui`, the frontend `/api/hello` template routes, the unused `<Toaster>` (and the `sonner` dependency), unused shadcn `card`/`select`/`textarea`, `react.svg`, the Next.js ESLint config and tsconfigs (and `@next/eslint-plugin-next`), `apps/backend/pnpm-lock.yaml`, the empty `.claude/` folder. `experiments/linkedin-scraper.js` kept, labelled.
  - `HIRING_COMMITTEE_REVIEW.md` marked historical.
  - The four reports and the README now describe the fixed code. The deep-dive's bug list keeps each original finding as the "before", with a Status line naming the fix commit.
  - Added the interview lifecycle diagram to `ARCHITECTURE.md` (the code comment in `index.ts` already pointed to it).
- **How verified:**
  - Lint, type checks and the production build pass with the files removed; 47/47 tests.
  - Every doc claim about tests, migrations and routes was checked against the code. One wrong claim was caught: the concurrency test fires three polls, not two.
  - All cross-document links resolve.
- **AI assistance:** Claude Code made the changes and wrote the doc updates.

---

## 5. Planned fixes (status tracker)

From the fix plan; details and reasoning in [PROJECT-DEEP-DIVE.md §18](PROJECT-DEEP-DIVE.md#18-bugs-technical-debt--architectural-problems).

| # | Fix | Bug | Phase | Status | Commit |
|---|---|---|---|---|---|
| 1 | Exclude `.env` from Docker images; pin Bun image tag | B1 | 1 | ✅ done | `8a365b0` |
| 2 | Order transcript by `createdAt` | B3a | 1 | ✅ done | `3ebb364` |
| 3 | Results page error states (404/403/network) | B4 | 1 | ✅ done | `a2914f9` |
| 4 | GitHub intake: server-side validation, error mapping, `per_page`, optional token | B8 | 1 | ✅ done | `1bf232b` |
| 5 | DB indexes + `Interview.createdAt/updatedAt` | B11 | 1 | ✅ done | `994871a` |
| 6 | Config drift (`GEMINI_API_KEY`, stray `.env` line) + `.gitattributes` for line endings | D2 | 1 | ✅ done | `e808a53`, `994871a` |
| 7 | Explicit "end interview" + `InProgress`/`Ended` lifecycle before grading | B2 | 2 | ✅ done | `3e0295d`, `674efb4` |
| 8 | Grader hardening: rubric, injection guard, 0–10 bounds, skip empty transcripts | B5 | 2 | ✅ done | `ea0a51d` |
| 9 | Grading lease + retry cap + explicit retry endpoint; concurrency test | B6 | 2 | ✅ done | `3e0295d` |
| 10 | Sideband error handling + reconnect | B7 | 3 | ✅ done | `8fed3a8` |
| 11 | True speech order + idempotent messages (OpenAI item ids) | B3b | 3 | ✅ done | `8fed3a8` |
| 12 | Proxy-aware rate limits, separate buckets | B9 | 3 | ✅ done | `ea323e3` |
| 13 | Deny interviews without an owner | B12 | 3 | ✅ done | `416c5fd` |
| 14 | Basic security headers | — | 3 | ✅ done | `57af44e` |
| 15 | Remove dead files (`packages/ui`, template routes, …); `image.png` already gone | B13 | 4 | ✅ done | `08772be` |
| 16 | Mark `HIRING_COMMITTEE_REVIEW.md` historical; refresh README and reports | D1 | 4 | ✅ done | `aeefc03` |
| — | CI failing on every push (module mock leaking between test files) | — | — | ✅ done | `610326d` |
| — | Found in live testing: interviewer cut answers off and reacted to noise | — | 2 | ✅ done | `7dce632` |
| — | Found in live testing: echo restarted the greeting; answer cut off by End not transcribed | — | 2 | ✅ done | `674efb4` |
| 17 | Point tests at a separate database (they currently write rows into the dev DB) | — | 3 | ✅ done | `e80d432` |
| 18 | Don't log the expected `input_audio_buffer_commit_empty` error from the End flow | — | 3 | ✅ done | `8ae4d9b` |

**Decisions (2026-10-19):**
- **Fix 7:** add the explicit end endpoint and the `InProgress` → `Ended` statuses; results show "Finishing your transcript…" until the call has ended.
- **Fix 9:** cap automatic grading retries at 3; after that the user clicks Try again, which calls a retry endpoint.
- **Fix 13:** deny access to interviews with no owner (no production data exists).
- **Fix 15:** keep `experiments/linkedin-scraper.js`, labelled as an unwired experiment.

**Execution order:** one commit per fix, pushed separately. Phase 1 adds a `.gitattributes` commit first (line endings). Verification after each phase: type-check, lint, the full test suite against Postgres, CI on GitHub; Phase 2 also gets a live voice call.

---

## 6. Using this in an interview

- **If asked "why does the git history start in October?":** "It wasn't under version control before then. I set up git on Oct 19 and documented the earlier timeline with evidence (migration timestamps and file dates) instead of faking commit dates."
- **If asked "what did you build vs. the tutorial?":** point to the Aug 21 and Oct rows in §2 and the work log in §4, and fill in §2's "fill in yourself" lines beforehand.
- **If asked about AI use:** be specific. The work log records where Claude Code was used. Be ready to explain any of that code line by line (use [LEARNING-PATH.md](LEARNING-PATH.md)).
- **Show the fix commits:** each one names the bug, the change and how it was verified. That's the strongest evidence of how you work.
