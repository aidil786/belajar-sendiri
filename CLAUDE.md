# FahamLah — notes for Claude

The full brief is in **`docs/PLAN.md`**. Read it before any work. This file is the short list of rules that never bend.

FahamLah is an ADHD-friendly, bilingual (English + Bahasa Melayu) "learn anything" engine. Course #1 is Git & GitHub (13 worlds, ~140 lessons). Static Astro site on Cloudflare Pages (project `belajarsendiri`, https://belajarsendiri.pages.dev). The repo is public.

## How we work
- Explain every git command in one short, plain sentence. The user is learning Git.
- Short messages: bullets, simple words.
- Check official docs for current tool versions; do not trust memory.
- Pushing and deploying: deploys come only from `main`, after every CI check passes (the `deploy` job in `.github/workflows/ci.yml` runs `npm run deploy`). The Cloudflare token and account id live only in the GitHub environment `production` (usable by `main` only). Never ask anyone to paste a token, never print one. `npm run deploy:dry` checks the config without deploying. See `DEPLOY.md`.
- Hosting: Cloudflare Pages project `belajarsendiri` (https://belajarsendiri.pages.dev). Never put a personal name, numbers or anything odd in a public address.
- Security (public repo): never commit secrets, personal data or account ids. Keep the Content-Security-Policy strict: no inline event handlers (`onclick=`), no `javascript:` links, no new outside host unless `public/_headers` allows it. `tests/e2e/security.spec.ts` must pass. Report problems as in `SECURITY.md`.
- Git target: teach Git 2.56; flag Git 3.0 changes (see `docs/PLAN.md` §7).

## ADHD rules (every page passes all 14) — §3
1. One idea per card. Max ~40 words. One new term per card.
2. Hook first (card 1 is a real problem). "You will learn…" line under the title.
3. The learner does something every 60–90 seconds.
4. Instant, kind feedback. Wrong → "Almost! Here's the trick" + retry. Never a red "WRONG".
5. Always show: progress bar, "card X of Y", "N min left", link to world map.
6. 3–5 min lessons. Optional 10-min focus sprint. Gentle inline break nudge after ~25 min.
7. Same layout every lesson; rotate the interaction type. No same main interaction twice in a row.
8. Nothing pops up unasked. No autoplay sound, no surprise modals.
9. No hard locks. Everything is open. Placement test marks lessons as known.
10. Resume exactly where you stopped. Save after every card. "Continue" is the biggest home button.
11. Calm mode: reduce motion, mute sound, hide XP, soften decoration (never text contrast).
12. "Go deeper" sections stay folded.
13. First real commit within 15 minutes of starting.
14. Animation + short text. Optional `audio` slot per card (narration later).

## Writing rules (EN + BM) — §4
- Explain like to a smart 12-year-old. Max 12 words per sentence (hard limit 15). Grade 5–6.
- "you" / "anda". Active voice. Metaphor first, then the term. Every command gets a human sentence.
- Bold only the one key term on a card. Animation first; words explain it.
- BM: write for meaning, casual clear **Malaysian** Malay (not Indonesian: *fail*, *muat turun*, *kata laluan*). Pronoun *anda*. Santai, not slang-heavy.
- Git commands and core terms stay in English. In BM, first use = "commit (titik simpan)", then just "commit".
- Routes `/en/...` and `/ms/...`. Language toggle keeps the same page and card. Peek shows the other language per card.
- Card ids must match exactly between `en.mdx` and `ms.mdx`.
- Every lesson has `bmReviewed: false` until a native speaker checks it.
- All UI strings live in `src/i18n/en.json` and `src/i18n/ms.json`. No hard-coded UI text.
- One shared glossary (`src/content/glossary/git.yaml`) drives tooltips in both languages.

## Look, motion, accessibility — §9
- One card centred, one big "Next" button. Progress bar fixed at top.
- The look is a "sticker stage": indigo dotted stage, white sticker cards with ink outlines and hard shadows, light paper sheets for text pages. Text on the stage uses `--on-stage`; see `docs/AUTHORING.md` ("Look: the sticker stage").
- Concept colours: working = blue, staging = amber, repo = green, remote = purple, HEAD = bright pink, conflict/danger = red **plus an icon**.
- All colours, spacing, radii and fonts come from `src/styles/tokens.css`.
- Body 18–20 px, ~60-char lines. Light + dark themes.
- Keys: Space/Enter next, Backspace back, `?` hint, `L` language. Never hijack keys while the terminal has focus.
- Mobile-first: works at 360 px. Terminal has a command key row on phones.
- One main animation per card. Never loops forever. 200–600 ms UI, up to ~2 s concept. Always replayable.
- `prefers-reduced-motion` and calm mode → simple before/after fade.
- Sound: short, optional, off by default.
- WCAG 2.2 AA: text alternative + static before/after for every animation; contrast ≥ 4.5:1; visible focus; nothing autoplays; every drag has a click/keyboard alternative; screen-reader labels on graph nodes.

## Do NOT — §15
- Deploy from any branch except `main`, deploy with failing checks, or push to `main` without the user's go-ahead in that session.
- Add leaderboards, punishing streaks, autoplay sound, surprise modals, or hard locks.
- Show a red "WRONG".
- Use GitHub's logo, Octocat, or GitHub branding. No cat- or octopus-shaped mascot (ours is an original mouse deer, Sang Kancil-inspired).
- Use real GitHub screenshots.
- Copy text from Pro Git or any other source.
- Invent Git behaviour. Check git-scm.com/docs and run `npm run verify:commands`.
- Use Indonesian Malay or heavy slang.
- Put more than one main animation on a card, or loop animations forever.
- Hard-code UI text.

## Where things live
- Second course **Ship It** (Docker, CI/CD, Kubernetes): brief in `docs/SHIP-IT-PLAN.md`. All rules here apply, plus its five extra rules (§3 there).
- Third family **Level Up** (Linux, Terraform & OpenTofu, Observability, AWS), the CKA pack (Kubernetes K9), harder drills and KCNA/CKAD practice: brief in `docs/LEVEL-UP-PLAN.md`. Its safety rules (§6 there) apply: the site never touches a real cloud account; real reps start with a budget alarm and end with a clean-up list.
- Lesson authoring guide (components, props, goals): `docs/AUTHORING.md`.
- Deploy guide for the boss: `DEPLOY.md`.
- Course content: `src/content/courses/<course>/` (generic UI stays course-agnostic).
- Git engine: `src/engine/git-sim/` — pure TypeScript, no DOM/React, Vitest-tested.
- Quality scripts: `scripts/` (readability, card-id parity, verify-commands vs real git).
