# AI Interview Kickstart: frontend redesign spec

Style: clean and minimal, in the spirit of Linear and Vercel. Neutral zinc greys with one indigo accent and Geist type. The only continuous motion is the voice halo and the spinners. Desktop-first, and every screen must work at 375px. Light and dark themes come from the shadcn tokens in `src/styles/globals.css`.

---

## 1. Foundations

### Accent rule
`primary` (indigo) means only two things: **act here** (the primary button, focus ring) and **someone is speaking**. Everything else is neutral. `destructive` is reserved for End interview and for errors.

### Tokens (light / dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| background | #FFFFFF | #0A0A0B | page |
| foreground | #0A0A0B | #EDEDEF | text |
| card | #FFFFFF | #111113 | orbs at rest, cards |
| muted / secondary / accent | #F4F4F5 | #1C1C1F | skeletons, hover, step numbers |
| muted-foreground | #5F5F67 | #A1A1AA | secondary text (6.3:1 / 7.7:1) |
| border / input | #E4E4E7 | #27272A | hairlines |
| primary / ring | #4F46E5 | #8B93FF | the accent |
| primary-foreground | #FFFFFF | #0A0A0B | text on primary |
| **primary-subtle** (new) | #EEF0FF | #1A1B33 | speaking-orb fill, “You” transcript chip |
| destructive | #DC2626 | #DC2626 | End button fill, white text (4.8:1) |
| **destructive-text** (new) | #B91C1C | #F87171 | inline error text and icons |
| **destructive-subtle** (new) | #FEF2F2 | #2A1214 | error alert background |

shadcn's `accent` is its neutral hover surface. The brand accent is `primary`.

### Type (Geist, Geist Mono)
| Role | Spec | Tailwind |
|---|---|---|
| Score | 120px/0.9, 600, -0.06em, tabular (96px on mobile) | `text-[120px] leading-[0.9] font-semibold tracking-[-0.06em] tabular-nums` |
| H1 | 32/1.15, 600, -0.025em (28 on mobile) | `text-[32px] leading-[1.15] font-semibold tracking-[-0.025em]` |
| Section H2 | 18/1.4, 600 | `text-lg font-semibold` |
| Body / feedback | 15/1.65–1.7 | `text-[15px] leading-relaxed` |
| Small / hints | 13/1.5, muted-foreground | `text-[13px] text-muted-foreground` |
| Labels / timer / progress | Geist Mono 12, uppercase, 0.04em | `font-mono text-xs uppercase tracking-[0.04em]` |

### Shape and spacing
- `--radius: 0.5rem`: inputs and buttons are 8px, cards and screen surfaces 12px, pills fully rounded.
- Control height is 44px (`h-11`), icons 16px (`size-4`), icon gap 8px.
- Column widths: Intake 480px, Interview stage 720px, Results 640px. Page gutter is 16px at 375.
- Focus: buttons get a 2px `ring` outline with 2px offset. Inputs get a border in `ring` plus a 3px ring at 22% (`focus-visible:ring-[3px] ring-ring/20`).
- Elevation: light mode uses a hairline border plus one soft shadow (`shadow-[0_1px_2px_rgb(10_10_11/.04),0_12px_32px_-16px_rgb(10_10_11/.12)]`). Dark mode uses the border only.

### Motion
- Colour, border and opacity transitions run at 150ms ease-out.
- The voice halo uses transform 80ms linear and opacity 150ms ease-out, driven by `--level`.
- Spinner: lucide `LoaderCircle` with `animate-spin`.
- Live dot: a 2s opacity pulse (`animate-live`, defined in globals.css).
- `prefers-reduced-motion` stops all of the above. The halo becomes a static ring (see §5).

---

## 2. Intake: `/`

Layout: a centred column (`max-w-[480px]`, 40px top padding) with the brand row at the top (a 24px indigo rounded square with the lucide `AudioLines` icon, then “AI Interview Kickstart” at 14/600). Below that, 64px of space, then the H1 and lead, then the form, with the how-it-works row pinned to the bottom of the viewport (`mt-auto`).

Copy:
- H1: **Rehearse your technical interview out loud.**
- Lead: Paste your GitHub profile. An AI interviewer asks you 2–3 questions about your own repos, live by voice, then scores you out of 10 with written feedback.
- Label: GitHub profile URL. Placeholder: `github.com/username`
- Button: **Start interview** (with a trailing `ArrowRight` icon)
- Hint, with a `Mic` icon at 14px: We’ll ask for microphone access once the interview starts.
- Steps (a 3-column grid with a top border; each number sits in a 22px `bg-muted` square in mono):
  1. Connect GitHub · We read your public repos
  2. Talk · 2–3 questions, by voice
  3. Get feedback · Score /10 and written notes

The input is the shadcn Input inside a bordered wrapper with a leading `Github` icon (muted). On desktop the field and button sit in one row with `gap-2`. At 375px they stack and the button goes full width.

| State | Design |
|---|---|
| Empty | Button enabled. Autofocus the input on desktop only. |
| Typing | Focus ring on the field. Accept `github.com/user`, `https://github.com/user` or a bare username, and normalise before validating. |
| Invalid / empty | Field border `destructive-text`, `aria-invalid="true"`, `aria-describedby` pointing at the message. The message **replaces** the mic hint (no layout jump), shown with a `CircleAlert` icon in `text-destructive-text text-[13px]`. Repo URL: “That’s a repository link. Paste your profile instead, like github.com/octocat.” Empty: “Enter your GitHub profile URL to start.” Validate on submit, then on every change while the error shows. Return focus to the input. |
| Loading | Fix the button width (~166px), show `LoaderCircle animate-spin` and “Starting…”, `disabled`. Input is `readOnly` (not disabled) with `bg-muted`. The hint becomes `role="status"`: “Reading your public repos. This takes a few seconds.” Show it after ~600ms. |
| Request failed | Keep the URL. Above the label, an alert (`role="alert"`, `bg-destructive-subtle`, border `destructive-text/25`, `CircleAlert`) reading **Couldn’t start the interview**, “Check that the profile is public, then try again.” The button becomes **Try again** with a `RotateCcw` icon. Map 404 to “No GitHub user at that address.” and a rate limit to “GitHub is busy, try again in a minute.” A sonner `toast.error` is optional; the inline alert is the source of truth. |

---

## 3. Live interview: `/interview/:id`

Structure, top to bottom (full height):
1. **Top bar** (60px, bottom border). A three-column grid: brand mark plus **status pill** on the left, **progress** in the centre (“QUESTION 2 OF 3” in mono, then three 16×4 pips with `bg-foreground` done and `bg-border` todo), **timer** on the right (mono 13, tabular, muted).
2. **Stage** (flex-1, centred). Two VoiceTiles 64px apart (Interviewer on the left, You on the right, always in that order). Under them, a **caption** (15px foreground) and an optional **sub** line (13px muted).
3. **Controls** (top border, 20px padding, centred, `gap-3`): **Mute** (outline) and **End interview** (destructive, `PhoneOff` icon).

There's no text chat and no push-to-talk. Interrupting is just talking.

Status pill: 28px tall, fully rounded, 1px border, 12/500 text. It's the screen's single `role="status" aria-live="polite"` region.

| State | Pill | Stage | Caption / sub | Controls | Timer |
|---|---|---|---|---|---|
| Connecting | spinner · Connecting | Tiles at 45% opacity, no state labels | “Setting up your interview & microphone…” / “Your browser will ask for microphone access. Choose Allow.” | Both disabled | 00:00 |
| Live, interviewer speaking | pulsing dot · Live | Interviewer tile speaking | “Interviewer is speaking” / “Jump in anytime. Just start talking.” (first question only) | Enabled | running |
| Live, you speaking or interrupting | Live | You tile speaking; Interviewer idle (“LISTENING”) | “Go ahead, the interviewer is listening” | Enabled | running |
| Muted | Live | You tile muted (see §5) | “You’re muted. Unmute to answer.” | Mute pressed: `aria-pressed="true"`, foreground-filled, `MicOff`, label **Unmute** | running |
| Reconnecting | spinner · Reconnecting | Neutral banner at the top of the stage (`bg-muted`, border, `WifiOff`): “Connection dropped. We’re reconnecting, and the interview picks up where it left off.” Tiles dimmed, labels “PAUSED”. Optional mono “Attempt 2 of 5”. | | Mute disabled, End enabled | “05:31 · paused” |
| Error | `CircleAlert` (destructive-text) · Interview stopped | Error card replaces the stage, `role="alert"`: a 56px `bg-destructive-subtle` circle with an icon, H2 20/600, body 14 muted, then **Try again** (primary, `RotateCcw`) and **Back to start** (outline link). Focus moves to Try again. | e.g. “Microphone access was blocked” / “Click the microphone icon in your browser’s address bar, set it to Allow, then try again.” Other errors: “We couldn’t reconnect”, “The interview service is unavailable”. | Controls bar removed | — |
| Ending | spinner · Ending | Tiles dimmed | `LoaderCircle` + “Wrapping up…” / “Taking you to your results.” | Both disabled | frozen |

Mobile (375): the brand mark is hidden. The top bar shows the pill (left) and timer (right), progress drops to its own centred row, orbs shrink to 88px with a 36px gap, the controls each take `flex-1` with the End label shortened to “End” (`aria-label="End interview"`), and the bottom padding includes `env(safe-area-inset-bottom)`.

The keyboard shortcut **M** toggles mute and announces “Microphone muted” or “Microphone on”.

---

## 4. Results: `/result/:id`

Top bar: brand on the left, **New interview** (outline, size sm, `Plus` icon) on the right. Content sits in a `max-w-[640px]` column with 56px vertical padding and 56px between sections.

| State | Design |
|---|---|
| Grading | `role="status"`: spinner (primary) + **Analyzing your interview…** (18/600), then “We’re scoring your answers and writing feedback. This page updates by itself, usually within a minute.” Below it, skeletons shaped like the final layout: a 168×96 score block, a 320×6 meter, a heading bar and four text lines, all `bg-muted` with a gentle opacity pulse. Poll every 5s and announce only once. After ~90s add “Taking longer than usual. You can leave this page and come back.” |
| Failed | A centred card with `role="alert"`, the same pattern as the interview error: **We couldn’t grade this interview** / “Something went wrong while scoring. Your conversation was recorded, so you can try grading it again.” **Try again** (primary) and **New interview** (outline). Focus moves to Try again. No toast. |
| Done | (1) Eyebrow in mono: “INTERVIEW COMPLETE · github.com/octocat”. (2) **Score as the hero and the page’s h1**: `7` at 120px plus `/10` at 28px muted, with `aria-label="Score: 7 out of 10"`. (3) A 10-segment meter (6px tall, 4px gap, 320px wide): filled `bg-foreground`, empty `bg-border`, `aria-hidden`. (4) **Feedback** H2, then the plain text split on blank lines into `<p>` (15/1.7, 16px between paragraphs), or `whitespace-pre-line`. (5) **Transcript** H2 with “N TURNS” on the right, as an `<ol>` with a top border. Each turn is a grid of `104px | 1fr`: the speaker label in mono caps (Interviewer is muted; You is a `bg-primary-subtle text-primary` chip), and the text at 15/1.65. Rows are separated by a bottom border. (6) A centred **New interview** primary button. |
| Empty transcript | Only the transcript section changes: a dashed-border box with 40px padding, centred, with a `MessageSquare` icon at 24px muted, **No transcript for this interview**, and “The call ended before anything was said, so there’s nothing to show here.” |

Mobile: the score drops to 96px, the meter goes full width, speaker labels stack above the turn text, the bottom button is full width, and the top-bar button reads “New”.

---

## 5. VoiceTile (live-audio visual)

Two tiles (Interviewer and You), each made of:
- **Halo**: an absolutely positioned circle the same size as the orb, sitting behind it, solid `bg-primary`.
- **Orb**: 112px (88px on mobile), `bg-card`, 1px `border`. Icon 30px, stroke 1.75: `AudioLines` for the Interviewer, `UserRound` for You.
- **Name**: 14/600 foreground (13 on mobile).
- **State label**: mono 12 caps (11 on mobile), one of SPEAKING (`text-primary`), LISTENING, MUTED or PAUSED (muted-foreground). It's empty while connecting or ending.
- **Mute badge** (You only): 30px (26 on mobile), `bg-foreground text-background`, `MicOff` at 14px, bottom-right, with a 3px ring in `background`.
- The tile is 150px wide (120 on mobile). Reserve 152px for the halo at its maximum scale.

Level mapping, computed per animation frame and written to the CSS variable `--level` (never into React state):
```
smooth += (raw − smooth) × (raw > smooth ? 0.5 : 0.12)   // fast attack, slow release
v       = clamp((smooth − 0.02) / 0.5, 0, 1) ^ 0.6        // noise gate + perceptual curve
scale   = 1 + 0.35 × v                                    // 1.00 → 1.35
opacity = speaking ? 0.14 + 0.36 × v : 0                  // capped at 0.5
speaking = v > 0.08 held 120ms → on; below for 350ms → off (stops flicker between words)
```
| level | v | scale | opacity |
|---|---|---|---|
| ≤0.02 | 0 | 1.00 | 0 |
| 0.10 | 0.33 | 1.12 | 0.26 |
| 0.25 | 0.63 | 1.22 | 0.37 |
| 0.50 | 0.98 | 1.34 | 0.49 |
| 1.00 | 1.00 | 1.35 | 0.50 |

| Visual state | Orb | Halo | Label |
|---|---|---|---|
| Idle | card fill, 1px border, muted icon | hidden | LISTENING |
| Speaking | 2px `primary` border, `primary-subtle` fill, primary icon | live | SPEAKING (primary) |
| Muted (You) | `bg-muted`, dashed border, plus the badge | hidden, level forced to 0 (flat) | MUTED |
| Connecting / Ending | whole tile row at 45% opacity | hidden | (empty) |
| Reconnecting | orb at 45% | hidden | PAUSED |

Turn-taking: when you barge in, both tiles may be lit for about 200ms. Once the server cuts the AI audio, the interviewer’s level drops and its tile goes idle without any extra UI.

Reduced motion: no scaling. While speaking the halo is fixed at scale 1.12 and opacity 0.3. Transitions are off.

---

## 6. Accessibility checklist
- [ ] Every text pair is ≥ 4.5:1 (the token values above have been measured).
- [ ] Visible focus on every interactive element (`focus-visible` ring).
- [ ] Mute is a `<Button aria-pressed>`. The label flips Mute ↔ Unmute and the icon Mic ↔ MicOff, and the pressed style inverts. Colour alone never carries the state.
- [ ] One `role="status" aria-live="polite"` region per screen: the Intake loading hint, the Interview status pill, the Results grading text.
- [ ] Errors use `role="alert"`, and focus moves to the recovery button.
- [ ] Orbs and halos are `aria-hidden`. The visible name and state text are the accessible version. Speaking changes are **not** announced, because a screen reader would talk over the interviewer.
- [ ] Inputs have a `<Label htmlFor>`, `aria-invalid` and `aria-describedby`.
- [ ] `prefers-reduced-motion` honoured (global rule in globals.css plus the halo rule).
- [ ] Touch targets ≥ 44px. No horizontal scroll at 375px.
