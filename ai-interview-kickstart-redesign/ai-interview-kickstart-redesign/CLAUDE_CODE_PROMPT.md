# Prompt for Claude Code

Copy this folder into the repo root (for example as `design-handoff/`) and paste the following into Claude Code:

---

Implement the frontend redesign described in `design-handoff/DESIGN_SPEC.md`.

Stack: React 19, Tailwind CSS v4, shadcn/ui (Button, Card, Input, Label, Select, Textarea already exist), lucide-react, sonner. Don't add new UI libraries. Animations stay in CSS/Tailwind only.

Steps:
1. Merge `design-handoff/src/styles/globals.css` into the app's global stylesheet. Replace the existing shadcn token values, keep any app-specific rules, and load Geist and Geist Mono (the `geist` npm package or Google Fonts).
2. Add `src/hooks/useVoiceLevel.ts`, `src/components/interview/VoiceTile.tsx` and `src/components/interview/StatusPill.tsx` from the handoff. Adapt the import paths and `cn` helper to this repo.
3. Restyle the three routes to match the spec, state by state:
   - `/` Intake: empty, typing, invalid, loading, failed
   - `/interview/:id` Live: connecting, live, muted, reconnecting, error, ending
   - `/result/:id` Results: grading, failed, done, empty transcript
   Keep the existing data flow (API calls, the realtime voice connection, 5s polling). This is a visual and accessibility pass, so don't change any logic. Wire VoiceTile to the existing 0–1 audio level values for the interviewer and the user.
4. The `.dc.html` files in `design-handoff/reference/` are the design source, kept for exact values such as copy, spacing and colours. They won't render on their own and their markup isn't React, so read them for details and don't copy them in. DESIGN_SPEC.md is the authority.
5. Accessibility checklist (spec §6): aria-pressed on Mute, one aria-live status region per screen, role="alert" on errors, visible focus rings, prefers-reduced-motion, everything working at 375px.
6. When you're done, run the dev server and check each route in light and dark at 1280px and 375px.

Ask me before you change any behaviour or API contract.
