# Project History & Work Log

> The single record of how this project came to be, what changed when, and the evidence for each claim. Keep it updated as work lands, and use it in interviews to back up your timeline.
>
> Related: [PROJECT-DEEP-DIVE.md](PROJECT-DEEP-DIVE.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [INTERVIEW-PREP.md](INTERVIEW-PREP.md) · [LEARNING-PATH.md](LEARNING-PATH.md)

---

## 1. The honest summary (say this if asked)

> "This started as a build-along of Harkirat Singh's AI Interviewer video in May–June 2026. I then hardened it in August: session-based ownership, rate limiting, a fix for a grading race condition, tests, CI and Docker. In October I switched grading to OpenRouter, moved the voice call to OpenAI's ephemeral client-secret flow with `gpt-realtime-2.1-mini`, and added reconnection, mute and an accessible redesign. I pair-programmed the October work with Claude Code. The project wasn't under version control until October 19, 2026, so the git history starts then. The commits are grouped by area, and this file records the earlier timeline and the evidence for it."

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

---

## 5. Planned fixes (status tracker)

From the fix plan; details and reasoning in [PROJECT-DEEP-DIVE.md §18](PROJECT-DEEP-DIVE.md#18-bugs-technical-debt--architectural-problems).

| # | Fix | Bug | Phase | Status | Commit |
|---|---|---|---|---|---|
| 1 | Exclude `.env` from Docker images; pin Bun image tag | B1 | 1 | ☐ planned | |
| 2 | Order transcript by `createdAt` | B3a | 1 | ☐ planned | |
| 3 | Results page error states (404/403/network) | B4 | 1 | ☐ planned | |
| 4 | GitHub intake: server-side validation, error mapping, `per_page`, optional token | B8 | 1 | ☐ planned | |
| 5 | DB indexes + `Interview.createdAt/updatedAt` | B11 | 1 | ☐ planned | |
| 6 | Config drift (`GEMINI_API_KEY`, stray `.env` line) + `.gitattributes` for line endings | D2 | 1 | ☐ planned | |
| 7 | Explicit "end interview" + `InProgress`/`Ended` lifecycle before grading | B2 | 2 | ☐ planned | |
| 8 | Grader hardening: rubric, injection guard, 0–10 bounds, skip empty transcripts | B5 | 2 | ☐ planned | |
| 9 | Grading lease + retry cap + explicit retry endpoint; concurrency test | B6 | 2 | ☐ planned | |
| 10 | Sideband error handling + reconnect | B7 | 3 | ☐ planned | |
| 11 | True speech order + idempotent messages (OpenAI item ids) | B3b | 3 | ☐ planned | |
| 12 | Proxy-aware rate limits, separate buckets | B9 | 3 | ☐ planned | |
| 13 | Deny interviews without an owner | B12 | 3 | ☐ planned | |
| 14 | Basic security headers | — | 3 | ☐ planned | |
| 15 | Remove dead files (`packages/ui`, template routes, …); `image.png` already gone | B13 | 4 | ☐ planned (image.png ✔) | |
| 16 | Mark `HIRING_COMMITTEE_REVIEW.md` historical; refresh README and reports | D1 | 4 | ☐ planned | |

Open decisions before Phase 2 (from the plan): new end endpoint/statuses OK? retry cap with manual Try again OK? deny owner-less interviews? delete the LinkedIn experiment?

---

## 6. Using this in an interview

- **If asked "why does the git history start in October?":** "It wasn't under version control before then. I set up git on Oct 19 and documented the earlier timeline with evidence (migration timestamps and file dates) instead of faking commit dates."
- **If asked "what did you build vs. the tutorial?":** point to the Aug 21 and Oct rows in §2 and the work log in §4, and fill in §2's "fill in yourself" lines beforehand.
- **If asked about AI use:** be specific. The work log records where Claude Code was used. Be ready to explain any of that code line by line (use [LEARNING-PATH.md](LEARNING-PATH.md)).
- **Show the fix commits:** each one names the bug, the change and how it was verified. That's the strongest evidence of how you work.
