# Build FahamLah: an ADHD-friendly, bilingual (English + Malay) Git & GitHub learning website

You are building a real website with me, starting from an empty folder. Read this whole brief before you do anything.

---

## 0. How we work together (read first)

- I build the website. My boss deploys it to Cloudflare from GitHub. **Do not push to GitHub and do not deploy.** Prepare everything so my boss can deploy (section 16).
- I'm learning Git while we build this. **Every time you run a git command, add one short, plain sentence saying what it did.**
- Keep your messages to me short: bullets, simple words.
- Use the latest stable version of every tool. Check the official docs (Astro, Cloudflare Workers, Motion, GSAP, xterm.js, nanostores) instead of trusting memory. If anything in this brief is outdated, tell me and use the current way.
- **Step 1:** save this brief to `docs/PLAN.md` exactly as written. Then create `CLAUDE.md` with a short summary of the non-negotiable rules (sections 3, 4, 9, 15) and a pointer to `docs/PLAN.md`, so future sessions remember everything.
- **Step 2:** before writing app code, show me a short build plan (max 15 bullets) and the final lesson list for Worlds 0–2. Wait for my "go".
- **This session = Phase 0 + Phase 1** (section 13). When done, stop and give me a short summary plus test steps. Later phases happen in later sessions (prompts at the end of this file).

---

## 1. What we are building

**FahamLah** (working name; *faham* = understand) is a reusable "learn anything" engine. Course #1 is **Git & GitHub**: about 140 bite-size lessons in 13 worlds, in English and Bahasa Melayu, taking a learner from basics to job-ready.

Every lesson follows one loop: **see it move → try it → check it → win.** Words stay short. Animations explain; they never decorate. Learners practise in a safe in-browser Git simulator first, then do real missions on their own computer and GitHub account.

**Who it's for:** beginners who know only basic Git and want to become developers. Many have ADHD. Many are Malaysian and may prefer Malay.

| Decision | Choice | Why |
|---|---|---|
| Scope | One engine, Git & GitHub as course #1 | Every game and animation is reused for the next topic |
| Lesson size | 3–5 minutes, one idea each | Fits short focus windows; easy to restart |
| Languages | English + Bahasa Melayu, switch any time, "peek" at the other language per card | Learn in BM, still pick up the English words developers use daily |
| Practice | Git simulator in the browser + real missions | Mistakes are free in the simulator; missions build a real portfolio |
| Git version | Teach Git 2.56 (latest, released 28 Sep 2026); flag what changes in Git 3.0 | Git 3.0 has no release date yet, but its new defaults are known |
| Hosting | Static site on Cloudflare Workers static assets, code on GitHub | Matches how my team ships |
| Reusability | Course content lives in `src/content/courses/<course>/`; generic UI is course-agnostic | A second course can reuse everything |

---

## 2. Tech stack

| Layer | Pick | Notes |
|---|---|---|
| Framework | **Astro**, static output | i18n routing (`/en/`, `/ms/`), content collections, MDX |
| Interactive cards | **React + TypeScript (strict)** islands | Only cards that move load JavaScript (`client:visible`) |
| Lessons | **MDX** in Astro content collections, one file per language | `en.mdx` + `ms.mdx` side by side |
| UI motion | **Motion** (motion.dev) | Enter/exit, drag, layout |
| Concept animation | **GSAP** (free, all plugins) | Timelines, SVG drawing |
| Commit graph | Custom SVG + a small layout helper you write | Full control of every animation |
| Terminal | **xterm.js** on top of our own Git engine (section 11) | Feels like a real terminal |
| State | **nanostores** + localStorage | No login, no server in v1 |
| Styling | Your call (Tailwind or plain CSS), but **all colours, spacing, radii and fonts come from one design-tokens file** | |
| Fonts | Atkinson Hyperlegible (default) and Lexend (option), self-hosted via Fontsource | Switch in settings |
| Mascot | Simple original SVG for now (Rive later) | See section 10 |
| Tests | Vitest (engine), Playwright (flows), axe (accessibility), Lighthouse budget | |
| Analytics | Cloudflare Web Analytics, snippet only added when an env var token exists | Off by default |
| Hosting | Cloudflare **Workers static assets** via `wrangler.jsonc` (not Cloudflare Pages) | My boss deploys |
| Later, not now | Worker + D1 for accounts/sync, AI "explain simpler" tutor, PWA offline, EN/BM narration audio | Leave clean extension points |

---

## 3. ADHD rules (every page must pass all 14)

The aim: a tidy screen with surprising interactions. Keep the layout the same every time; change *what you do* inside it.

1. **One idea per card.** Max ~40 words per card. One new term per card.
2. **Hook first, summary first.** Card 1 is a real problem ("You lost your code. Again."). A one-line "You will learn…" sits under the lesson title.
3. **Do something every 60–90 seconds.** Tap, drag, type a command, predict or choose. No long reading stretches.
4. **Instant, kind feedback.** Right: short praise + why. Wrong: "Almost! Here's the trick" + retry. Never a red "WRONG".
5. **Always know where you are.** Progress bar, "2 min left", "card 4 of 8" and a link to the world map, visible at all times.
6. **Short sessions, built-in breaks.** 3–5 min lessons. Optional 10-min focus sprint timer. Gentle break nudge after ~25 min of continuous use.
7. **Same layout, different action.** Every lesson uses the same frame; the interaction type rotates (drag, type, predict, sort, swipe, slider, click-the-graph). Avoid the same main interaction in two lessons in a row.
8. **Nothing pops up unasked.** No autoplay sound, no surprise modals, lots of white space. The break nudge is a small inline banner, never a modal.
9. **Freedom to jump.** No hard locks. Every world and lesson is open. A placement test marks what you already know.
10. **Resume exactly where you stopped.** Progress auto-saves after every card. "Continue" is the biggest button on the home page.
11. **Calm mode.** One switch: reduce motion, mute sounds, hide XP, softer decoration colours (text contrast stays high).
12. **Rabbit holes are optional.** "Go deeper" sections stay folded.
13. **Real-world wins early.** The learner makes their first real commit within 15 minutes of starting.
14. **See it, hear it, read it.** Animation + short text. (Narration audio comes later; leave an optional `audio` slot per card.)

---

## 4. Writing rules (English and Malay)

Write like you're explaining to a smart 12-year-old friend. Then write the Malay for **meaning**, not word-for-word, in casual, clear **Malaysian** Malay. Git commands and core terms stay in English.

**Writing rules**
- Max 12 words per sentence (hard limit 15). One idea per sentence.
- Everyday words. Reading level: grade 5–6.
- Say "you" / "anda". Active voice: "Git saves it", not "It is saved by Git".
- Metaphor first, term second: "a save point in a game" → then "this is a **commit**".
- Every command gets a human sentence: `git add .` → "Put all changes in the box."
- Bold only the one key term on a card.
- Show the animation first; the words explain what the learner just saw.

**Same idea, two styles**

| | Textbook style (avoid) | FahamLah style (use) |
|---|---|---|
| English | The staging area is an intermediate area where commits can be formatted and reviewed before completing the commit. | Git has a box. You put ready changes in the box. Then you save the box. |
| Malay | Kawasan staging ialah kawasan perantaraan di mana komit boleh diformat dan disemak sebelum komit diselesaikan. | Git ada satu kotak. Masukkan perubahan yang dah siap. Lepas tu, simpan kotak tu. |

**Bilingual rules**
- Routes: `/en/...` and `/ms/...`. A toggle in the top bar switches language on the same page and remembers the choice. `/` redirects to the saved choice, else the browser language, else `/en/`.
- **Peek button** on every card shows the other language for that card only.
- In BM, the first time a term appears: English term + plain meaning, e.g. "commit (titik simpan)". After that, just "commit".
- Malaysian Malay, not Indonesian: *fail* not *berkas*, *muat turun* not *unduh*, *kata laluan* not *kata sandi*.
- Pronoun: *anda*. Tone *santai*, not slang-heavy.
- One shared glossary file drives tooltips in both languages.
- Every lesson has `bmReviewed: false` in its frontmatter until a native speaker reviews it.

All UI strings live in `src/i18n/en.json` and `src/i18n/ms.json`. No hard-coded UI text.

---

## 5. Glossary seed (`src/content/glossary/git.yaml`)

| English term | In BM lessons | Plain meaning (BM) |
|---|---|---|
| repository (repo) | repo | Folder projek yang Git jaga |
| commit | commit | Titik simpan, macam save point dalam game |
| staging area | kawasan staging | Kotak untuk perubahan yang dah siap |
| branch | branch | Jalan cerita lain untuk cuba benda baru |
| merge | merge (cantum) | Gabungkan dua jalan cerita jadi satu |
| conflict | konflik | Dua perubahan bertembung di tempat sama |
| HEAD | HEAD | Penanda "anda di sini" |
| remote / origin | remote / origin | Salinan projek di internet, contohnya di GitHub |
| clone | clone | Salin seluruh projek ke komputer anda |
| push / pull | push / pull | Hantar ke GitHub / tarik perubahan terbaru |
| fork | fork | Salinan projek orang lain dalam akaun anda |
| pull request (PR) | pull request (PR) | Minta orang semak dan terima perubahan anda |

Add an English plain meaning for each, and add every new term introduced in Worlds 0–2 (working folder, hash, diff, .gitignore, reset, revert, restore, detached HEAD, reflog, etc.).

---

## 6. Lesson anatomy and the gold-standard sample lesson

Every lesson uses the same 6-step frame, 6–10 cards, 3–5 minutes. The frame never changes; the interaction inside it does.

1. **Hook** (1 card): a real problem in one or two lines.
2. **See it** (1–2 cards): one animation, max 3 short sentences.
3. **Try it** (1–2 cards): drag, type in the mini terminal, or click the graph.
4. **Predict and check** (1–2 cards): "What happens next?", then the animation shows the answer.
5. **Win** (1 card): XP, one line "You can now…", confetti (off in calm mode).
6. **Go deeper** (folded, optional): extra flags, edge cases, links to official docs.

**Card format in MDX:** `<Card id="hook" type="hook">…</Card>`. Types: `hook`, `see`, `try`, `predict`, `check`, `win`, `deeper`. **Card ids must match exactly between `en.mdx` and `ms.mdx`** (Peek depends on it; CI checks it).

**Lesson frontmatter:**
```yaml
id: git-w01-l03
world: 1
title: The Box
summary: "You will learn: how to save only the files that are ready."
minutes: 4
xp: 20
interactives: [ThreeAreas, Terminal]
needs: [git-w01-l02]
scenario: w01-l03        # starting state for the simulator
gitVersion: "2.56"
lastChecked: 2026-10-30
bmReviewed: false
```

### Sample: World 1, Lesson 3 — "The Box" (staging area), 4 min, 20 XP

Build this lesson **exactly**. It is the quality bar for every other lesson.

| Card | Step | English | Bahasa Melayu | What moves on screen |
|---|---|---|---|---|
| 1 | Hook | You changed 3 files. Only 1 is ready. How do you save just that one? | Anda ubah 3 fail. Hanya 1 yang dah siap. Macam mana nak simpan yang itu sahaja? | Three file cards wobble on a desk; one has a green tick. |
| 2 | See it | Git has a box. It is called the **staging area**. Ready changes go in the box. | Git ada satu kotak. Namanya **kawasan staging**. Perubahan yang siap masuk ke dalam kotak. | The ticked file glows and slides into an amber box. |
| 3 | See it | `git add index.html` puts one file in the box. | `git add index.html` masukkan satu fail ke dalam kotak. | The command types itself; the same slide animation replays. |
| 4 | Try it | Drag only the ready file into the box. | Seret fail yang dah siap sahaja ke dalam kotak. | Drag and drop; a wrong file bounces back with "Not ready yet!". |
| 5 | Try it | Now type the command yourself. | Sekarang taip arahan itu sendiri. | Mini terminal; the box fills when the command is right. |
| 6 | See it | A **commit** takes a photo of the box. Only what is inside gets saved. | **Commit** ambil gambar isi kotak. Hanya yang di dalam akan disimpan. | Camera flash; a snapshot card flies onto the timeline. |
| 7 | Predict | You run `git commit` now. Which files are saved? | Anda jalankan `git commit` sekarang. Fail mana yang disimpan? | Three choices; the answer is revealed by replaying the flash. |
| 8 | Check | In `git status`, green means "in the box". Red means "not yet". | Dalam `git status`, hijau maksudnya "dalam kotak". Merah maksudnya "belum lagi". | Real `git status` output with the colours pulsing once. |
| 9 | Win | +20 XP. You can now save only what is ready. | +20 XP. Kini anda boleh simpan hanya yang dah siap. | Box closes, star pops (static in calm mode). |
| — | Go deeper | `git add -p` saves only *part* of a file. `git restore --staged` takes a file out of the box. | `git add -p` simpan *sebahagian* fail sahaja. `git restore --staged` keluarkan fail dari kotak. | Folded panel with a 20-second demo. |

---

## 7. Full curriculum

13 worlds, ~140 lessons. `src/content/courses/git/course.yaml` must list **all 13 worlds** with id, EN/BM title, EN/BM summary, icon, concept colour, lesson list (id, EN/BM title, minutes, xp, `status: ready | soon`) and boss. Worlds 0–4 build on each other. After World 4, any branch in any order. World 11 (Rescue Center) is open any time.

| World | Learner will be able to | Topics | Lessons | Boss challenge |
|---|---|---|---|---|
| 0. Start Here | Explain Git vs GitHub; set up their machine | Why version control ("final_v3_REAL.docx"); Git vs GitHub vs GitLab/Bitbucket/Codeberg; short history (Linus, 2005); terminal basics (`pwd`, `ls`, `cd`, `mkdir`); installing Git on Windows/macOS/Linux; first setup (`git config` user.name, user.email, `init.defaultBranch main`, editor, config levels); VS Code's Git panel; getting help (`git help`, `-h`) | 8 | Placement test: skip what you know |
| 1. Save Points | Save work safely and read history | `git init` and `.git`; the three areas; `git status`; `git add` (file, `.`, `-p`); `git commit`; what a commit contains (snapshot, author, parent, hash); good messages + Conventional Commits; `git log` (`--oneline`, `--graph`, `--all`), `git show`; `git diff` (unstaged, `--staged`, two commits); `.gitignore`; `git rm`, `git mv`; HEAD; small focused commits | 12 | Build a mini diary site with 5 clean commits |
| 2. Undo Magic | Fix almost any mistake without panic | `git restore`; `git restore --staged`; `--amend`; `git reset` soft/mixed/hard; `git revert`; reset vs revert vs restore; detached HEAD; `git clean -n`; `git reflog` | 9 | Escape room: undo 6 disasters |
| 3. Parallel Universes | Branch, merge, rebase, resolve conflicts | Branch = sticky note on a commit; `git branch`, `git switch -c`, old `git checkout`; fast-forward and three-way merge; conflict markers; resolving in VS Code, `--abort`; branch cleanup (`-d`, `--merged`); `git stash`; rebase basics; interactive rebase (squash, fixup, reword, drop, reorder); merge vs rebase + golden rule; `git cherry-pick` | 12 | Conflict Crusher: 3 conflicts, 1 clean history |
| 4. Hello GitHub | Connect to GitHub and sync | Account, profile, 2FA; creating repos (README, licence, `.gitignore` templates); auth: HTTPS + fine-grained tokens, Git Credential Manager, SSH keys (ed25519), `gh auth login`; `git remote`, origin; `git push -u`, upstream; `git clone`; `git fetch` vs `git pull`, `origin/main`; pull with merge vs rebase; push rejected + fix; force push and `--force-with-lease`; tags, SemVer, Releases; forks and syncing | 12 | Publish the diary site to GitHub |
| 5. Teamwork | Collaborate like a pro team | Repo tour; Markdown (headings, tables, task lists, alerts, Mermaid); great READMEs; Issues (labels, milestones, templates, sub-issues, issue types); PRs and draft PRs; code review (comments, suggestions, approve, request changes); "Closes #12"; merge methods (merge, squash, rebase); conflicts in a PR; rulesets, branch protection, CODEOWNERS; Projects boards; Discussions, Wiki, Gists; orgs, teams, roles; open source (fork → PR, CONTRIBUTING, licences, good first issues) | 14 | Team sim: review and merge a teammate's PR |
| 6. Team Workflows | Choose the right workflow | GitHub Flow; Git Flow; trunk-based + feature flags; branch naming; Conventional Commits + SemVer + changelogs; monorepo vs many repos; release and hotfix drills | 7 | Pick the workflow for 3 companies |
| 7. Robots (Actions & CI/CD) | Automate tests and deploys | What CI/CD means; workflow anatomy (`on`, `jobs`, `steps`, `runs-on`); triggers (push, pull_request, schedule, manual); Marketplace actions + pinning; secrets, variables, environments; matrix, cache, artifacts; status checks + badges; reusable workflows; deploy to GitHub Pages and Cloudflare; Dependabot; workflow security (`permissions`, least-privilege `GITHUB_TOKEN`) | 11 | Auto-deploy the diary site on every merge |
| 8. Shields (Security) | Keep code, accounts and secrets safe | 2FA, passkeys; never commit secrets (`.env` + `.gitignore`); secret scanning + push protection; leaked a key? rotate first, then `git filter-repo`; Dependabot alerts; CodeQL basics; SECURITY.md + advisories; signed commits (SSH/GPG), Verified badge | 8 | Leak drill: a fake key got pushed, fix it fast |
| 9. Power Tools | Use GitHub's extra tools well | GitHub CLI (`gh repo`, `gh issue`, `gh pr`); github.dev (press `.`) and Codespaces; GitHub Pages; GitHub Desktop and editor Git UIs; GitHub Copilot (completions, chat, agent mode, coding agent issue → PR, AI code review) and how to review AI-written code; Packages; API, webhooks, GitHub Apps (awareness); code search; GitHub Education + Student Developer Pack | 10 | Ship a small fix using only `gh` and a Codespace |
| 10. Deep Git | Understand Git inside | Objects (blob, tree, commit, tag) and hashes; refs, `HEAD` file, packed refs, reftable; plumbing vs porcelain (`cat-file`, `hash-object`); packfiles, `gc`, `git maintenance`; revision syntax (`HEAD~2`, `^`, `A..B`, `A...B`); history search (`log -S/-G`, `git grep`, `blame`, `shortlog`); `git bisect`; hooks (pre-commit, commit-msg); aliases, `includeIf`, line endings, `.gitattributes`; `git worktree`; submodules vs subtrees; big repos (shallow, partial clone, sparse-checkout, Git LFS); `rerere`, `range-diff`; **Git 3.0 preview** | 14 | Detective: use `bisect` to find the bug commit |
| 11. Rescue Center | Fix real "oh no" moments by following a path | Wrong branch; pushed a password; undo last commit (local vs pushed); bad message; forgot a file; merge panic; detached HEAD; deleted branch; lost commits after reset; push rejected; messy pull (abort); huge file committed; Windows line-ending chaos; "Permission denied (publickey)"; pushed to a protected branch | 15 | No boss: always-open quick help |
| 12. Career Quest | Use GitHub to get hired | Profile README, pinned repos, honest contribution graph; portfolio ideas; first open-source PR step by step (Hacktoberfest every October); Git interview questions; team etiquette (small PRs, kind reviews); docs and changelogs; keeping up (release notes, Pro Git, GitHub Docs, changelog) | 7 | First real open-source contribution |

**Git 3.0 preview facts** (for World 10 and small notes where defaults differ): no release date yet. New repos will default to SHA-256, the reftable ref format and a `main` branch; `safe.bareRepository` becomes `explicit`; `git whatchanged` and `git pack-redundant` are removed; Rust becomes required to build Git. `git checkout` stays, next to `git switch` and `git restore`. Verify against https://git-scm.com/docs/BreakingChanges before writing.

### Detailed lesson list for Worlds 0–2 (build these now; you may refine titles)

**World 0 — Start Here**
- 0.1 Why save versions? — hook: "final_v3_REAL.docx"; sort messy file names into a timeline.
- 0.2 Git vs GitHub — Git is a tool on your computer; GitHub is a website for repos; also GitLab, Bitbucket, Codeberg; sort cards into "Git" or "GitHub".
- 0.3 Where Git came from — Linus Torvalds, 2005, for Linux; tap a short timeline.
- 0.4 Terminal basics — `pwd`, `ls`, `cd`, `mkdir` in the mini terminal.
- 0.5 Install Git — pick your OS (Windows / macOS / Linux) → tailored steps, `git --version`; checklist mission on the learner's real computer.
- 0.6 Tell Git who you are — `git config --global user.name`, `user.email`, `init.defaultBranch main`, `core.editor`, config levels; command builder.
- 0.7 Git inside VS Code — Source Control panel tour on an original illustration (no screenshots); click hotspots.
- 0.8 Getting help — `git help <cmd>`, `git <cmd> -h`, the cheat sheet; predict which help to use.
- **Boss: Placement test** — ~10 quick questions; correct answers mark matching lessons in Worlds 0–2 as "known" (still open, shown with a tick).

**World 1 — Save Points**
- 1.1 Make a repo — `git init`, the hidden `.git` folder.
- 1.2 Three places your work lives — working folder, staging, repository (Three Areas board).
- 1.3 The Box — the gold-standard sample in section 6.
- 1.4 Read `git status` — red vs green, `git status -s`.
- 1.5 Your first save point — `git commit -m`; what a commit holds (snapshot, author, parent, hash). **Real mission:** first commit on your own computer.
- 1.6 Good commit messages — short, imperative, Conventional Commits (`feat:`, `fix:`, `docs:`); Commit message judge (swipe).
- 1.7 Look back in time — `git log --oneline --graph --all`, `git show`; Time machine slider.
- 1.8 Spot the difference — `git diff`, `--staged`, between two commits.
- 1.9 Ignore files — `.gitignore` (`node_modules/`, `.env`, `*.log`).
- 1.10 Remove and rename — `git rm`, `git rm --cached`, `git mv`.
- 1.11 HEAD: you are here — the pink HEAD marker on the graph.
- 1.12 Small, focused commits — `git add -p` (simplified hunk picker), one change per commit.
- **Boss: Diary site with 5 clean commits** — in the simulator. Optional real mission: the learner does it on their computer and pastes their `git log --oneline` output; the site parses it and checks for 5 commits with good messages (no API needed).

**World 2 — Undo Magic**
- 2.1 Throw away a change — `git restore <file>` (danger: can lose work).
- 2.2 Take it out of the box — `git restore --staged`.
- 2.3 Fix the last commit — `git commit --amend` (fix message, add a forgotten file); never amend pushed commits.
- 2.4 Reset lab — `git reset --soft / --mixed / --hard`.
- 2.5 Undo safely with revert — `git revert` makes a new "undo" commit.
- 2.6 Which undo? — restore vs reset vs revert decision game.
- 2.7 Detached HEAD — `git checkout <hash>` / `git switch --detach`; get back with `git switch main`.
- 2.8 Clean up junk files — `git clean -n`, then `-f` (and `-d`).
- 2.9 Reflog, your safety net — `git reflog`; recover "lost" commits after `reset --hard`.
- **Boss: Escape room** — 6 disasters in the simulator: wrong file staged, typo in last message, forgot a file, committed junk, accidental `reset --hard`, undo a shared commit (needs `revert`). Hints after 2 tries.

### Always-on tools (outside the worlds)
- Bilingual **cheat sheet**.
- **Glossary** page (driven by the glossary file).
- **Command pages**: one per command taught so far — what it does, when to use it, an example, and a danger level: *safe* / *careful* / *can lose work* (icon + colour + word).
- **Rescue Center starter** (full version later): 4 flows that only need Worlds 1–2 skills — undo my last commit (not pushed), fix a bad commit message, I forgot a file in my commit, I lost commits after a reset.
- Daily 1-minute review cards come in Phase 5.

---

## 8. Interactive components

Build reusable components once; use them across all worlds. The **Git simulator** and the **commit graph** matter most: together they let learners type a command and instantly watch what Git does. Build them first.

| Component | Teaches | How it works | Phase |
|---|---|---|---|
| Git simulator + mini terminal | Real commands, safely | xterm.js terminal runs our Git engine; wrong commands give friendly hints; a small file panel lets learners edit files by clicking | **1** |
| Commit graph | Commits, HEAD | SVG dots and arrows animate after every command; HEAD is a glowing pink marker. Phase 1: linear history + detached HEAD | **1** (branches/merges in 2) |
| Three Areas board | Working folder → staging → repository | Drag files between three coloured zones; the matching command appears | **1** |
| Time machine slider | History and undo | Scrub through commits and watch a file change | **1** |
| Reset lab | soft vs mixed vs hard | Pick a reset type; see which areas change and which are wiped | **1** |
| Command builder | Command syntax | Snap pieces together: `git` + `commit` + `-m` + message | **1** |
| Commit message judge | Good messages | Swipe right for good, left for bad, then see why | **1** |
| Quiz cards (choose / predict / sort) | Checking understanding | Generic, reusable card interactions | **1** |
| Universe splitter | Branches | A timeline splits into two lanes you can switch between | 2 |
| Conflict resolver game | Conflict markers | Pick lines from "yours" and "theirs", remove the markers | 2 |
| Rebase card deck | Interactive rebase | Drag commit cards to reorder, squash, reword or drop | 2 |
| Push/pull courier | Local vs remote | A courier carries commits between "Your laptop" and "GitHub" | 2 |
| Practice repo page (mock) | Issues, PRs, reviews, Actions logs | Simplified, clearly labelled practice UI, **no GitHub logo or branding** | 3 |
| YAML block builder | GitHub Actions | Stack blocks (trigger, job, step); see YAML + pipeline animation side by side | 4 |
| Object X-ray | Git internals | Click a commit to open its tree, blobs and hash | 5 |
| Rescue flowcharts | Fixing real mistakes | Answer 2–3 questions, get the exact safe commands | 1 (starter), 5 (full) |
| Real missions checker | Doing it for real | Learner types their GitHub username; the public GitHub API checks the repo/commit/PR exists | 4 |

---

## 9. Look, feel, animation and accessibility

**Layout:** one card in the centre, one big "Next" button, nothing else competing. Card = title, one visual, max 3 short lines, action button. Progress bar fixed at the top.

**Concept colours** (same colour = same Git concept everywhere: lessons, diagrams, games, terminal hints):

| Concept | Colour |
|---|---|
| Working folder (your files) | Blue |
| Staging area (the box) | Amber |
| Repository (commits) | Green |
| Remote / GitHub | Purple |
| HEAD / "you are here" | Bright pink marker |
| Conflict / danger | Red **plus an icon** (never colour alone) |

**Type and theme:** body 18–20 px, line length ~60 characters, generous spacing. Light and dark themes. Calm mode lowers decoration contrast, never text contrast.

**Keyboard:** Space/Enter = next, Backspace = back, `?` = hint, `L` = switch language. (Don't hijack keys while the terminal has focus.)

**Mobile-first:** lessons work at 360 px width. The terminal works on a phone with a command keyboard row (`git`, `-m`, `.`, quotes, Tab, ↑).

**Animation rules**
- One main animation per card. It explains a change; it never loops forever.
- 200–600 ms for UI moves, up to ~2 s for concept animations, always replayable.
- Respect `prefers-reduced-motion` and calm mode: swap motion for a simple before/after fade.
- Sound effects: short, optional, **off by default**.

**Accessibility (WCAG 2.2 AA)**
- Every animation has a text alternative and a static before/after view.
- Text contrast at least 4.5:1; focus outlines always visible.
- Nothing autoplays.
- Every drag-and-drop has a click/keyboard alternative.
- Screen-reader labels on graph nodes ("commit a1b2c3d, on branch main, HEAD is here").

---

## 10. Motivation that stays gentle

Reward progress against the learner's own past self only. No leaderboards, no punishing streaks, no timers that can't be turned off.

| Mechanic | How it works | ADHD guard |
|---|---|---|
| XP and levels | 10–30 XP per lesson, +50 for a boss | Hidden in calm mode |
| World map | 13 islands light up as you finish them | Every island visible from day 1; jump anywhere |
| Badges | Phase 1: "First Commit", "Clean Messenger", "Undo Hero", "Escape Artist", one per finished world | Earned by skill, never by time spent |
| Gentle streak | Counts days you learned, even 1 minute | 2 free rest days a week; after a gap: "Welcome back!", never "You lost your streak" |
| Boss challenges | Story scenario mixing a world's skills | Retry instantly; hints after 2 tries |
| Missions | Real tasks on your own computer/GitHub | Checklist of small steps; each step saves |
| Mascot | An **original mouse deer inspired by Sang Kancil**, the clever hero of Malay folk tales | Reacts with a few frames (happy / thinking / oops); never interrupts; static in calm mode |
| Personal praise | Uses the learner's name (optional, asked once on first visit) and names what they did well: "Clean commit message, Aiman!" | Short, specific, never sarcastic |
| Unlockables | Themes, mascot outfits (later) | Cosmetic only |

The mascot must not look like a cat or an octopus, so it can never be confused with GitHub's mascot.

**Feedback vote:** at the end of every lesson, a 1-tap "Fun / Confusing / Boring" vote. Store locally; settings has "Export my feedback (JSON)".

---

## 11. The Git engine (the heart of the site)

Write a small, pure TypeScript model of Git in `src/engine/git-sim/`. Do **not** run real Git in the browser. We control the friendly messages, and every command emits events the animations listen to.

- **No DOM, no React** inside the engine. Fully unit-tested with Vitest.
- **State:** working files (path → content), index (staging), commits `{ id, parents[], message, author, timestamp, snapshot }`, branches, tags, HEAD (branch name or commit id), stash, reflog, config, plus a slot for a fake `origin` (used from Phase 2).
- **Commands are pure functions:** `(state, args) → { state, output, events }`. Never mutate state.
- **Events** drive the graph and boards, e.g. `fileChanged`, `fileStaged`, `fileUnstaged`, `commitCreated`, `headMoved`, `headDetached`, `branchMoved`, `resetApplied`, `revertCreated`, `filesCleaned`, `error`.
- **Hashes:** short, deterministic, seeded fake hashes so each lesson replays the same way.
- **Output** looks like real Git output (simplified but faithful). The UI adds a friendly one-line explanation underneath, in the current language.
- **Friendly errors:** unknown or mistyped command → e.g. "Hmm, Git doesn't know `git comit`. Did you mean `git commit`?" (via i18n keys). Never scary.
- **Shell commands** (World 0 and file editing): `pwd`, `ls` (incl. `-a`), `cd`, `mkdir`, `touch`, `cat`, `echo "text" > file`, `echo "text" >> file`, `clear`, `help`.
- **Phase 1 Git commands:** `--version`, `help` / `-h`, `config` (`user.name`, `user.email`, `init.defaultBranch`, `core.editor`, `--global`, `--local`, `--list`), `init`, `status` (+ `-s`), `add` (path, `.`, `-A`, simplified `-p`), `commit` (`-m`, `-am`, `--amend`, `--amend --no-edit`), `log` (`--oneline`, `--graph`, `--all`, `-n`), `show`, `diff` (working, `--staged`, `<a> <b>`), `rm` (+ `--cached`), `mv`, `restore` (path, `--staged`, `--source`), `reset` (`--soft`, `--mixed`, `--hard`, with a commit), `revert`, `checkout <commit>`, `switch <branch>` / `switch --detach` / `switch -`, `branch` (list only), `clean` (`-n`, `-f`, `-d`), `reflog`.
- **Revision syntax (Phase 1):** `HEAD`, `HEAD~n`, `HEAD^`, short hashes, branch names.
- **Scope grows by world:** ~10 commands for World 1, ~45 by World 10. Design so new commands are easy to add (a command registry).
- **Lesson scenarios:** each lesson can declare a starting state (files, commits, staged changes) in `src/content/courses/git/scenarios/`.
- **Truth check:** `scripts/verify-commands/` replays every lesson's command list in a temp folder with **real git** (fixed author name/email/dates for determinism) and compares structure with the engine: staged files, working-tree changes, number of commits, messages, branch tips, HEAD state, `status -s` lines. Hashes will differ, so compare structure, not hashes. Log the real Git version used; the target is Git 2.56.

---

## 12. Pages, state and folder structure

**Pages**
- `/` → redirect to `/en/` or `/ms/` (section 4).
- `/[lang]/` home: biggest button "Continue" (resumes the exact card), today's progress, gentle streak, world map preview.
- `/[lang]/git/` world map: all 13 islands. Worlds 3–12 show their topics and "Coming soon" lessons, but are still browsable.
- `/[lang]/git/[world]/[lesson]/` lesson player.
- `/[lang]/git/[world]/boss/` boss challenge.
- `/[lang]/glossary/`, `/[lang]/cheatsheet/`, `/[lang]/commands/[command]/`, `/[lang]/rescue/`.
- `/[lang]/settings/`: language, calm mode, font, theme, sound, name, focus sprint on/off, reset progress, export progress/feedback.
- Friendly 404 in both languages.

**Progress store** (`src/stores/progress.ts`, saved after every card, with a schema version for future migrations): current lesson + card, completed lessons, XP, badges, streak days, rest days used this week, placement-test "known" lessons, feedback votes, settings, learner name, session time (for the break nudge). Wrap all storage in try/catch; the site must work if storage is blocked.

**Folder structure** (adapt if current Astro conventions differ):
```text
fahamlah/
├─ CLAUDE.md
├─ docs/PLAN.md
├─ DEPLOY.md
├─ src/
│  ├─ content/courses/git/
│  │  ├─ course.yaml
│  │  ├─ scenarios/
│  │  └─ w01-save-points/03-the-box/{en.mdx, ms.mdx}
│  ├─ content/glossary/git.yaml
│  ├─ engine/git-sim/            # pure TS Git model + tests
│  ├─ components/interactives/   # Terminal, CommitGraph, ThreeAreas, ...
│  ├─ components/ui/             # Card, ProgressBar, LanguageToggle, Peek, ...
│  ├─ i18n/{en.json, ms.json}    # UI strings
│  ├─ stores/progress.ts         # XP, streak, resume point
│  ├─ styles/tokens.css          # design tokens
│  └─ pages/[lang]/              # /en/... and /ms/...
├─ public/audio/{en,ms}/         # empty for now
├─ scripts/
│  ├─ verify-commands/           # replays lesson commands in real Git
│  ├─ check-readability/         # sentence and card word limits
│  └─ check-card-ids/            # en/ms card id parity
├─ tests/e2e/                    # Playwright + axe
├─ .github/workflows/ci.yml
└─ wrangler.jsonc                # Workers static assets config
```

---

## 13. Roadmap and THIS session's scope

Six phases, ~24 weeks at ~10 hours a week. Each phase is a working site. A phase starts only after the gate above it passes.

| Phase | Build | Git I practise on this repo | Gate |
|---|---|---|---|
| **0. Foundations** | Lesson frame, EN/BM switch, Git engine v0, design tokens | `init`, `add`, `commit` daily | "The Box" works end to end in EN and BM |
| **1. MVP** | Worlds 0–2, Three Areas board, mini terminal, saved progress | Feature branches, merges, first deploy by my boss | 5 testers finish World 1, under 10% "Boring" |
| 2. Branch Lab | Worlds 3–4, live commit graph, conflict game, rebase deck | Rebase feature branches, resolve real conflicts | Engine matches real Git for every lesson command (CI green) |
| 3. Team Mode | Worlds 5–6, practice repo UI, Markdown playground | Every change via a PR my boss reviews; Issues board | 10 PRs reviewed and merged |
| 4. Automation | Worlds 7–8, YAML block builder, leak drill, missions checker | Actions CI, auto-deploy to Cloudflare, Dependabot | Every merge to main tests and deploys by itself |
| 5. Deep Git | Worlds 9–12, object X-ray, bisect detective, review cards, PWA | Bisect a real bug, add hooks, tag and release v1.0 | Launch v1.0 |
| Later | Accounts + sync (Worker + D1), AI tutor, narration, a 2nd course | | |

### This session: Phase 0 + Phase 1

**Phase 0 — Foundations**
1. `git init`, `.gitignore`, Astro + React + TypeScript strict, linting/formatting, design tokens, fonts, light/dark theme, calm mode.
2. Lesson frame: Card, ProgressBar ("card 4 of 8", "2 min left"), Next/Back, LanguageToggle, Peek, Hint, "Go deeper" fold, keyboard shortcuts.
3. Git engine v0 with the World 1 commands + Vitest tests.
4. Mini terminal + Three Areas board + basic commit graph.
5. "The Box" lesson end to end in EN and BM.
6. Stop for a moment: tell me how to run it locally so I can check the gate.

**Phase 1 — MVP**
1. Finish the engine for all Phase 1 commands (section 11) with tests.
2. Components marked Phase 1 in section 8.
3. All 29 lessons + 3 bosses for Worlds 0–2, in EN and BM, following sections 3, 4 and 6 exactly.
4. `course.yaml` with all 13 worlds (Worlds 3–12 as "soon"), world map, home page with "Continue".
5. Progress, XP, badges, gentle streak, placement test, focus sprint, break nudge, feedback vote, mascot reactions, settings.
6. Glossary, cheat sheet, command pages, Rescue Center starter.
7. Quality scripts + CI (section 14), `wrangler.jsonc` and `DEPLOY.md` (section 16).

**Git workflow while building:** one feature branch per chunk (`feat/lesson-frame`, `feat/git-engine`, `feat/world-0`, `feat/world-1`, …), small Conventional Commits, merge into `main` when the chunk works. Explain each git command in one line as you go.

### Definition of done for this session
- [ ] `npm run build` passes with no errors or warnings that matter.
- [ ] Engine unit tests cover every Phase 1 command, including error cases.
- [ ] Playwright: complete "The Box" in EN; switch to BM mid-lesson and stay on the same card; Peek works; reload resumes the same card.
- [ ] axe: no serious or critical violations on home, world map, a lesson, settings.
- [ ] Readability check passes on all lessons (max 15 words per sentence, max 40 words per card; code excluded).
- [ ] Card ids match between every `en.mdx` and `ms.mdx`.
- [ ] `verify-commands` passes locally against real git.
- [ ] Works at 360 px width; terminal usable on a phone.
- [ ] Calm mode and `prefers-reduced-motion` both verified.
- [ ] Lighthouse (mobile, lesson page): Performance ≥ 90, Accessibility ≥ 95.
- [ ] All 14 ADHD rules checked on a sample of lessons; tell me any rule you had to bend.

---

## 14. Quality checks and CI

`.github/workflows/ci.yml` runs on push and pull request: install → lint → typecheck → unit tests → readability check → card-id parity → verify-commands (real git on the runner) → build → Playwright + axe.
- Set `permissions: contents: read`. Pin action versions.
- Add npm scripts: `dev`, `build`, `preview`, `test`, `test:e2e`, `check:readability`, `check:cards`, `verify:commands`, `lint`, `typecheck`.

**Content sources:** write all lesson text yourself, in simple words.
- **Pro Git** (CC BY-NC-SA 3.0): read and link only; **do not copy text**.
- **GitHub Docs** (content CC BY 4.0): may adapt with credit, but rewrite in simple words anyway.
- **Git reference docs** (git-scm.com/docs): fact-check every command and flag here.
- Link official docs in each lesson's "Go deeper".
- Ideas only, never copy: Learn Git Branching, GitHub Skills, Oh My Git!, Oh Shit, Git!?!

---

## 15. Do NOT

- Push to GitHub, deploy, or run `wrangler deploy`.
- Add leaderboards, punishing streaks, autoplay sound, surprise modals, or hard locks.
- Show a red "WRONG". Use kind retry feedback.
- Use GitHub's logo, Octocat, or GitHub branding. No cat- or octopus-shaped mascot.
- Use real GitHub screenshots. Use simplified, original illustrations.
- Copy text from Pro Git or any other source.
- Invent Git behaviour. If unsure, check git-scm.com/docs and the real-git truth check.
- Use Indonesian Malay words or heavy slang.
- Put more than one main animation on a card, or loop animations forever.
- Hard-code UI text instead of using the i18n files.

---

## 16. Deployment handoff (for my boss)

- Astro builds a fully static site.
- `wrangler.jsonc` configures **Cloudflare Workers static assets**, with the assets directory pointing at Astro's build output. Check the current Cloudflare docs for the exact fields and a current `compatibility_date`. Handle trailing slashes and the `/` → `/en/` fallback sensibly; the client-side redirect in section 4 still applies.
- Write `DEPLOY.md` in plain words for my boss: build command, deploy command, how to connect the GitHub repo with Cloudflare Workers Builds, the optional Web Analytics env var, and how to add a custom domain.
- Run `npm run build` and `npx wrangler deploy --dry-run` (if available) locally to prove the config is valid. Don't deploy for real.

---

## Follow-up prompts for later sessions (don't do these now)

**Phase 2 — Branch Lab**
> Read `CLAUDE.md` and `docs/PLAN.md`. Build Phase 2: Worlds 3–4 (all lessons + bosses, EN and BM), the live commit graph with branches/merges/rebases, Universe splitter, Conflict resolver game, Rebase card deck, Push/pull courier, and a fake `origin` in the Git engine. Extend `verify-commands` to every new command. Same rules, same definition of done. Show me the lesson list first and wait for my "go".

**Phase 3 — Team Mode**
> Read `CLAUDE.md` and `docs/PLAN.md`. Build Phase 3: Worlds 5–6 (EN and BM), the practice repo page (no GitHub branding), and a Markdown playground. Same rules and definition of done. Show me the lesson list first.

**Phase 4 — Automation**
> Read `CLAUDE.md` and `docs/PLAN.md`. Build Phase 4: Worlds 7–8 (EN and BM), the YAML block builder, the leak drill, and the real missions checker using the public GitHub API (no login, handle rate limits kindly). Same rules and definition of done. Show me the lesson list first.

**Phase 5 — Deep Git and v1.0**
> Read `CLAUDE.md` and `docs/PLAN.md`. Build Phase 5: Worlds 9–12 (EN and BM), Object X-ray, bisect detective, the full Rescue Center (all 15 flows), daily review cards (spaced repetition, max 10 a day), PWA offline support, and the Git 3.0 preview lesson (re-check git-scm.com/docs/BreakingChanges first). Same rules and definition of done. Show me the lesson list first.
