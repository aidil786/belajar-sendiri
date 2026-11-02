# Writing Belajar Sendiri lessons

This is the practical guide for lesson files. The rules come from `docs/PLAN.md` (§3 ADHD rules, §4 writing rules, §6 lesson anatomy). The gold-standard example is `src/content/courses/git/w01-save-points/03-the-box/`. Copy its shape.

## Files

```
src/content/courses/git/
  course.yaml                          # outline (ids, slugs, titles, minutes, xp)
  wNN-<world>/NN-<slug>/en.mdx         # English lesson
  wNN-<world>/NN-<slug>/ms.mdx         # Malay lesson (same card ids!)
  wNN-<world>/boss/en.mdx, ms.mdx      # boss challenge
  scenarios/wNN.ts                     # simulator starting states (+ verify lists)
```

The folder name is `NN-<slug>` where `NN` is the lesson number in the world (01, 02, …) and `<slug>` matches `course.yaml`.

## Frontmatter

```yaml
id: git-w01-l03          # from course.yaml
world: 1
title: The Box            # in this file's language
summary: "You will learn: how to save only the files that are ready."   # BM: "Anda akan belajar: ..."
minutes: 4                # from course.yaml
xp: 20                    # from course.yaml
interactives: [AreasScene, DragToArea]   # names used in this file
needs: [git-w01-l02]      # previous lesson id(s), [] if none
scenario: w01-l03         # main scenario id, or omit
gitVersion: "2.56"
lastChecked: 2026-10-30
bmReviewed: false
kind: lesson              # or boss
docs:                     # official links for "Go deeper" (git-scm.com/docs first)
  - { label: "git add", url: "https://git-scm.com/docs/git-add" }
```

## Cards

```mdx
<Card id="hook" type="hook">
<Interactive name="AreasScene" ... />

You changed 3 files. Only 1 is ready. How do you save just that one?
</Card>
```

- Types: `hook`, `see`, `try`, `predict`, `check`, `win`, `deeper`.
- Order: hook (1) → see (1–2) → try (1–2) → predict/check (1–2) → win (1) → deeper (folded, optional, last).
- 6–10 cards, not counting `deeper`. 3–5 minutes.
- **Card ids must match exactly between `en.mdx` and `ms.mdx`.** Use short kebab-case ids: `hook`, `see-box`, `try-type`, `predict`, `check`, `win`, `deeper`.
- One main animation or activity per card.
- **See/hook cards:** animation first, then the words. **Try/predict cards:** the instruction first (one short line), then the activity.
- Max ~40 words of prose per card. Max 12 words per sentence (hard limit 15). Code does not count.
- Bold only the one key term on a card (`**staging area**`).
- `<Hint>…</Hint>` inside a card adds a hint (the `?` key). Use it on try cards.
- `<Term id="commit">commit</Term>` shows a glossary tooltip (ids from `src/content/glossary/git.yaml`).
- The `win` card holds one line: "You can now …" (BM: "Kini anda boleh …"). The player adds XP, the badge, the vote and the next-lesson button.
- The `deeper` card: extra flags or edge cases, and one TermReplay demo if useful.
- MDX tip: write props on one line or wrap the whole `<Interactive … />` tag; keep JS objects simple (strings, numbers, booleans, arrays, objects).

## Writing rules (short version)

- Explain to a smart 12-year-old friend. Grade 5–6 words. "you" / "anda". Active voice.
- Metaphor first, then the term: "a save point in a game" → "this is a **commit**".
- Every command gets a human sentence: `git add .` → "Put all changes in the box."
- Malay: write for meaning, casual clear **Malaysian** Malay (not Indonesian: *fail*, *muat turun*, *kata laluan*, *tetapan*). Pronoun *anda*. Santai, not slang-heavy.
- Malay: Git commands and core terms stay in English. First time a term appears in a lesson: "commit (titik simpan)", then just "commit".
- Kind feedback only: "Almost! Here's the trick…". Never "wrong".
- Don't copy text from Pro Git or anywhere. Fact-check against https://git-scm.com/docs.
- No GitHub logos, no Octocat, no real screenshots.

## Interactives

Every interactive gets `lang` automatically. `scenario="id"` is resolved from `scenarios/`. All text props are in the file's language.

### Concept animations (see / hook cards)

**AreasScene**: files move between the three areas. Plays once when shown; replayable; calm mode shows before/after.
```mdx
<Interactive name="AreasScene" zones={['working', 'staging']} command="git add index.html" effect="flash"
  label="Text alternative: what moves, in plain words."
  frames={[{ working: ['a.txt', { name: 'b.txt', tick: true, glow: true }] }, { working: ['a.txt'], staging: ['b.txt'] }]} />
```
- `zones`: any of `working`, `staging`, `repo` (default all three).
- `frames`: 1–3 states. A chip is a string or `{ name, tick?, glow?, tag?: 'new'|'changed'|'deleted'|'notReady', kind?: 'commit' }`. Use `kind: 'commit'` in `repo` with the commit message as `name`.
- `command`: typed in a mini terminal before the move. `effect`: `wobble` (first frame) or `flash` (camera flash on the last frame).
- `zoneLabels`: optional, e.g. `{ working: 'Your desk' }`.

**TermReplay**: a real-looking terminal transcript made by the engine.
```mdx
<Interactive name="TermReplay" scenario="w01-l04" commands={['git status']} pulse label="git status with one staged file." />
```
- `pulse` makes red/green parts pulse once. `outputOnly` hides the command lines.
- `fails={['git push']}`: commands that are meant to fail, because the lesson shows that error (a rejected push, Permission denied). `npm run check:mdx` allows them, and complains if they work. A merge or rebase that stops on a conflict needs no `fails`: Git is only waiting (this also holds for GraphScene and SpotLines).

**GraphScene**: the commit graph before/after a command (good for HEAD, reset, revert, detached HEAD).
```mdx
<Interactive name="GraphScene" scenario="w02-l07" commands={['git switch --detach HEAD~1']} label="HEAD moves back one commit and leaves the branch." />
```
- Shows the graph of the scenario, then runs `commands` one by one (animated). `showLost` shows reflog-only commits as dashed dots.
- The graph (here, in `Sim` with `panels={['graph']}`, `GraphPick` and `ResetLab`) draws real branching: each branch gets its own lane, merges join lanes, merge commits have a filled centre. Labels show full names (long names like `feature/login-form` widen the graph; it scrolls sideways): branches in green (the current one has a pink border), remote-tracking branches like `origin/main` in purple, tags with a dashed outline. Commits only a remote-tracking branch reaches (fetched, not merged yet) are purple. A stopped merge / rebase / cherry-pick shows a red **Conflict** badge with a warning icon under HEAD, and a dashed red line from the commit being brought in.

### Try / predict / check

**Sim**: the practice terminal with live boards.
```mdx
<Interactive name="Sim" scenario="w01-l03" panels={['areas']} goal={{ staged: ['index.html'], notStaged: ['style.css'] }}
  hints={['Type git add index.html and press Enter.']} success="The box has index.html. Nothing else." />
```
- `panels`: any of `areas`, `graph`, `files` (file panel lets learners edit files by clicking). Default `['areas']`. Use `[]` for World 0 shell lessons.
- `goal` (all optional, all must pass): `staged`, `notStaged`, `modified`, `untracked` (path lists); `clean` (bool), `noUntracked`; `commits` (exact count from HEAD), `minCommits`; `lastMessage` (regex); `messages` (regex per commit, newest first); `cleanMessages` (number of commits with clean messages); `headDetached` (bool); `headAtMessage` (regex); `lastIsRevert` (bool); `filesExist`, `filesMissing` (paths); `fileContains`, `fileNotContains` (`{ path: text }`); `stagedContains`, `stagedNotContains` (`{ path: text }` inside the box); `lastCommitFiles`, `lastCommitHas`, `lastCommitLacks`; `cwd` (absolute, e.g. `/home/you/diary`); `dirsExist`; `repoAt`; `config` (`{ 'user.name': 'x' }`, exact); `configSet` (keys that must be set to anything); `typed` (regex any typed command matches); `lastTyped` (regex).
- World 3–4 goals (all optional too):
  - `currentBranch` (`'feature'`), `branches` / `branchesMissing` (names), `branchAt` (`{ feature: 'Add about' }`: the branch tip's message matches the regex).
  - `mergeCommit` (bool: HEAD is / isn't a merge commit), `linearHistory` (bool: no merge commits behind HEAD).
  - `inMerge`, `inRebase` (bool: a merge / rebase is stopped), `conflicts` (paths still unresolved), `noConflicts` (bool).
  - `stashCount` (number), `tags` (names that exist).
  - `remotes` (`{ origin: 'https://github.com/you/diary.git' }`, exact URL), `upstream` (`{ main: 'origin/main' }`).
  - `pushed` (branches whose commit is on the remote, the same commit as yours), `serverHas` (`{ url, branch, messageRegex?, hasMessage? }` or a list: the hosted repo has that branch; tip message / any commit matches).
  - `aheadBehind` (`{ ahead?, behind? }`: the current branch versus its upstream, as last fetched).
- World 10 goals (all optional too):
  - `bisectFound` (regex on the first bad commit's message; stays true after `git bisect reset`), `bisectActive` (bool).
  - `aliases` (`{ st: 'status', lg: 'log --oneline --graph --all' }`: global or local `alias.*`, spaces normalised).
  - `worktrees` (absolute paths of linked worktrees, e.g. `['/home/you/diary-fix']`).
  - `objectsWritten` (blob ids, full or short, saved with `git hash-object -w`), `packedRefs` (refs in `.git/packed-refs`, e.g. `['refs/heads/main']`).
- A command that makes Git stop and wait (a merge conflict, a rebase conflict) is not counted as a mistake.
- `hints`: shown after 2 failed commands, or after 4 commands that miss the goal (then the next hint every 2 more).
- `prefill`: text already in the input. `intro`: commands run and shown before the learner types. `showLost`: graph shows reflog-only commits.

**DragToArea**: drag files between areas (or tap file, tap area). Wrong moves bounce back.
```mdx
<Interactive name="DragToArea" zones={['working', 'staging']} items={[{ name: 'index.html', tick: true, target: 'staging' }, { name: 'style.css', target: 'working', wrong: 'Not ready yet!' }]} success="Only the ready file is in the box." />
```
- `start`: zone where items begin (default `working`). For "take it out of the box" use `start="staging"`.

**Choice**: pick one answer (predict or check). Kind feedback and an optional reveal animation.
```mdx
<Interactive name="Choice" options={[{ label: 'Only `index.html`', correct: true, why: 'Only the box gets saved.' }, { label: 'All files', why: 'Only the box gets saved.' }]} reveal={{ frames: [...], label: '...' }} />
```
- Give every option a `why`. `compact` shows short options in a row.

**SortCards**: sort cards into 2–3 labelled buckets.
```mdx
<Interactive name="SortCards" buckets={[{ id: 'git', label: 'Git' }, { id: 'github', label: 'GitHub' }]} items={[{ label: 'Works offline', bucket: 'git', why: 'Git lives on your computer.' }]} success="All sorted!" />
```

**OrderList**: put items in the right order (top = first). Items are shuffled for the learner.
```mdx
<Interactive name="OrderList" items={['essay.docx', 'essay_v2.docx', 'essay_final.docx', 'essay_final_REAL.docx']} label="Oldest at the top" success="That's the real order." />
```

**SwipeJudge**: swipe right = good, left = needs work (buttons too).
```mdx
<Interactive name="SwipeJudge" cards={[{ text: 'feat: add contact form', good: true, why: 'Clear and specific.' }, { text: 'stuff', good: false, why: 'What stuff?' }]} />
```
- Card text shows in the code font (for commit messages). For sentences, add `prose`: `<Interactive name="SwipeJudge" prose cards={[...]} />`.

**TimeMachine**: a slider through history; the file changes as you slide.
```mdx
<Interactive name="TimeMachine" scenario="w01-l07" file="index.html" label="index.html at each commit" />
```

**SpotLines**: tap the matching lines in real output (made by the engine), or in given lines.
```mdx
<Interactive name="SpotLines" scenario="w01-l04" commands={['git status']} targets="new file:|modified:" prompt="Tap every line that is in the box." success="Those are the green ones!" />
```
- `targets` is a regex matched against each output line. Or pass `lines={[{ text: '+ new line', target: true }]}` instead of scenario/commands.

**CommandBuilder**: tap pieces in order to build a command. Each piece has a human meaning.
```mdx
<Interactive name="CommandBuilder" pieces={[{ text: 'git', means: 'Talk to Git' }, { text: 'config', means: 'change a setting' }, { text: '--global', means: 'for all projects' }, { text: 'user.name', means: 'your name' }, { text: '"Aiman"', means: 'the value' }]} decoys={[{ text: '--local', means: 'this project only' }]} success="That's the command!" />
```

**ResetLab**: pick `--soft`, `--mixed` or `--hard`; see which areas keep or lose the changes. Done after trying all three.
```mdx
<Interactive name="ResetLab" scenario="w02-l04" />
```

**GraphPick**: click a commit on the graph.
```mdx
<Interactive name="GraphPick" scenario="w01-l11" answer="Add style" prompt="Tap the commit HEAD points at." why="The pink HEAD marker sits on it." then="git revert {hash}" />
```
- `answer`: regex for the right commit's message. `then` (optional): command to run after a right pick (`{hash}` = picked short hash); the graph shows the result.

**HunkPicker**: choose which pieces of a change go into this commit.
```mdx
<Interactive name="HunkPicker" file="index.html" hunks={[{ lines: ['+<h2>Day 2</h2>', '+<p>I learned diff.</p>'], take: true, why: 'This is the Day 2 entry.' }, { lines: ['-<p>TODO</p>', '+<p>Fix typo</p>'], take: false, why: 'A typo fix is a different change.' }]} />
```

**Hotspots**: tap glowing dots on an original illustration. Built-in pictures: `vscode` (an editor with a Source Control panel), `vscode-merge` (the same editor during a merge conflict: the Accept … buttons, Current / Incoming Change, Resolve in Merge Editor, Merge Changes).
```mdx
<Interactive name="Hotspots" picture="vscode" spots={[{ id: 'changes', x: 18, y: 30, title: 'Changes', text: 'Files you changed.' }]} />
```
- `x`, `y` are percentages of the picture (0–100). See `src/components/interactives/pictures.tsx` for the spot positions that make sense.

**TimelineTap**: tap each point on a timeline to reveal it.
```mdx
<Interactive name="TimelineTap" events={[{ when: '2005', title: 'Git is born', text: 'Linus Torvalds writes Git for Linux.' }]} />
```

**OsPicker**: pick Windows / macOS / Linux, get the steps as a saved checklist (a real mission).
```mdx
<Interactive name="OsPicker" id="install-git" options={[{ os: 'windows', steps: [{ id: 'dl', text: 'Download Git from git-scm.com.' }] }, { os: 'macos', steps: [...] }, { os: 'linux', steps: [...] }]} />
```

**Mission**: a real-world checklist (on the learner's own computer). Ticks are saved. Steps can have a command with a Copy button.
```mdx
<Interactive name="Mission" id="first-commit" steps={[{ id: 'folder', text: 'Make a folder for your project.', command: 'mkdir my-diary' }]} success="That was real Git!" />
```

### Push/pull courier (World 4)

**Courier**: "Your laptop" and "GitHub" side by side (stacked on phones). A courier carries commits between them. Both panels come from the engine: the laptop shows your branch and its remote-tracking branch (`origin/main`, with "N ahead · N behind"); GitHub shows the hosted branch and its tags. Commits only on your laptop are green with ↑, commits only on GitHub are purple with ↓, fetched-but-not-joined commits are dashed purple. A refused push bounces back and shows Git's kind explanation in red with an icon. Travel takes ~1.3 s, plays once, and can be replayed; calm mode / reduced motion shows a Before/After toggle instead. Git's real output sits in a folded "What Git printed".
```mdx
<Interactive name="Courier" scenario="w04-l09" actions={['push', 'fetch', { cmd: 'git pull --rebase', label: 'Pull (rebase)' }]}
  goal={{ pushed: ['main'], serverHas: { url: 'https://github.com/you/diary.git', branch: 'main', hasMessage: 'Aisyah' } }}
  hints={['Pull first.', 'Then push again.']} success="Both commits are on GitHub now." />
<Interactive name="Courier" scenario="w04-l05" commands={['git push -u origin main']} label="Three commits travel up to GitHub." />
```
- `actions` (try cards): buttons. Built-in: `push` (`git push`), `fetch`, `pull`, `commit` (a new local commit, from `mine`), `teammate` (the teammate commits and pushes, from `teammate`). Any other command: `{ cmd: 'git push --force-with-lease', label?: 'Force, safely' }` (the label shows above the command).
- `commands` (see cards): a demo that plays once when shown. Steps are Git commands, `@commit` or `@teammate`. Needs `label` (the text alternative). A refused push is a fine demo step.
- No `actions` and no `commands`: a still picture of both sides (good for a hook).
- `teammate`: `{ name: 'Aisyah', dir: '/home/aisyah/diary', commits?: [{ file, message, append? | content? }] }`. Each tap: she gets the latest from GitHub, changes `file`, commits and pushes (her own `user.name` comes from her repo config in the scenario). With a `commits` list the button stops after the last one.
- `mine`: commits the `commit` button makes, in order (`{ file, message, append? | content? }`, paths relative to the repo). Without it: `entry-1.txt`, `entry-2.txt`, …
- `goal`: the Sim goals (e.g. `{ pushed: ['main'] }`, `{ aheadBehind: { ahead: 0, behind: 0 } }`, `{ branchAt: { main: 'Aisyah' } }`), plus `serverTags: ['v1.0.0']` (tags on the GitHub repo). `hints` show after 2 refusals or 4 taps; `success` like Sim.
- `url`: which hosted repo to show before the laptop has an `origin` (default: the only one).
- `npm run check:mdx` checks the actions, runs the demo steps and makes sure the goal isn't met at the start. The pure logic lives in `src/lib/courier.ts` (unit-tested).
- Avoid conflicts unless the card is about them: give the learner's and the teammate's commits different files (or lines far apart).

### GitHub, Markdown and Actions (Worlds 5, 7, 9, 12)

All five are checked by `npm run check:mdx` (ids exist, regexes compile, the task isn't already done). They are on the hidden test page `/en/dev/interactives/` (used by `tests/e2e/interactives.spec.ts`).

**Transcript**: a static, real-looking terminal for tools the simulator doesn't run (`gh`, `ssh-keygen`, `npm`…). Lines appear one by one once (all at once in calm mode); Replay button; every command line has a Copy button. Only show output you are sure is real and current.
```mdx
<Interactive name="Transcript" title="bash" label="Make a folder and a note; cat shows the word hi."
  lines={[{ cmd: 'mkdir demo && cd demo' }, { cmd: 'echo "hi" > note.txt' }, { cmd: 'cat note.txt' }, { out: 'hi', color: 'green' }]} />
```
- `lines`: `{ cmd?, out?, color? }[]`. `out` may hold several lines (`\n`). `color`: `green`, `red`, `yellow`, `cyan`, `dim` (colours `out`).
- `label` (required): the text alternative. `prompt` (default `$`). `title`: text in the window bar (default "Terminal").

**PracticeRepo**: a small, clearly labelled *practice* repository page ("Practice repo — not a real website"). Original design, no real-site branding. You set up the situation with data; the learner does one `task`, checked live.
```mdx
<Interactive name="PracticeRepo" screen="pull" at={7}
  repo={{ owner: 'aina-codes', name: 'diary', files: [{ path: 'README.md', content: '# Diary\n' }] }}
  issues={[{ number: 3, title: 'Add a contact page', body: 'Please add one.', state: 'open', author: 'mei' }]}
  pulls={[{ number: 7, title: 'Add contact page', body: 'Adds a page.\n\nCloses #3', author: 'mei', from: 'contact-page', to: 'main', state: 'open',
    checks: [{ name: 'test', status: 'pass' }], files: [{ path: 'contact.html', diff: ['@@ -0,0 +1 @@', '+<h1>Contact</h1>'] }] }]}
  settings={{ rules: [{ id: 'requireReview', label: 'Require one approving review', on: true }] }}
  task={{ type: 'merge', pr: 7 }} success="Merged! Issue #3 closed by itself." />
```
- `screen`: `code` (files + README), `markdown-file` (one file; `.md` is rendered), `issues`, `issue`, `pulls`, `pull`, `pull-files`, `actions`, `run`, `settings`. Tabs show only for areas that have data. `at`: the issue/PR number, run id or file path the detail screen opens (default: the first).
- `repo`: `{ owner, name, description?, files?: { path, content }[], readme?, defaultBranch? }` (default branch `main`; README comes from `readme` or a `README.md` file). Relative links in Markdown open files of the practice repo.
- `issues`: `{ number, title, body, state: 'open'|'closed', author, labels?, comments?: { author, body }[], milestone?, type? }[]`.
- `pulls`: `{ number, title, body, author, from, to, state: 'open'|'merged'|'closed', draft?, checks?: { name, status: 'pass'|'fail'|'running' }[], files?: { path, diff: string[] }[], reviews?: { author, state: 'approved'|'changes'|'commented', body }[], comments?: { author, body, line?, path?, suggestion? }[] }[]`. Diff lines start with `+`, `-`, a space, or `@@`. A comment `line` is the 1-based index in that file's `diff` (`path` defaults to the first file).
- `runs`: `{ id, workflow, event, branch, status, jobs: { name, steps: { name, status: 'pass'|'fail'|'running'|'skipped', log?: string[] }[] }[] }[]`.
- `settings.rules`: `{ id, label, on }[]`. These ids change merging: `requireReview` (needs an approval and no open "changes requested"), `requireChecks` (all checks pass; running checks also block), `linearHistory` (squash or rebase only). Other ids are plain switches.
- `labels`: labels the learner can pick (default: bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix). `me`: the learner's name in the repo (default "you" / "anda"; you can't approve your own PR).
- `task` (one): `{ type: 'approve', pr }`, `{ type: 'requestChanges', pr }`, `{ type: 'comment', pr | issue, mustInclude? }` (regex, case-insensitive), `{ type: 'suggest', pr }` (line comment with a changed ```` ```suggestion ```` block), `{ type: 'merge', pr, method? }` (`merge`, `squash`, `rebase`), `{ type: 'label', issue, label }`, `{ type: 'close', issue }`, `{ type: 'linkIssue', pr, issue }` (PR body gets "Closes #N" / "Fixes #N" / "Resolves #N"), `{ type: 'findFailingStep', run }`, `{ type: 'toggleRule', rule, on }`, `{ type: 'openFile', path }`.
- Merging a PR whose body says "Closes #N" into the default branch closes issue N. Blocked merges explain why (that's how branch protection is taught).
- A `merge` task with a `method`: picking another method gives a kind hint and does not merge, so the learner can retry.
- Each PracticeRepo is its own world: state never carries to the next card. For a story over several cards (World 5 boss), give the next card the updated data (the fix pushed, your earlier review in `reviews`).

**MarkdownPlayground**: type Markdown, see the page (side by side on wide screens; stacked with a "Preview only" toggle on phones). The renderer is safe (no raw HTML, safe links only, images become alt-text placeholders) and supports headings, bold/italic/strike, code, lists, task lists, links, quotes, alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), tables with alignment, rules, `#123` and `@name`. A ```` ```mermaid ```` block shows as labelled code.
```mdx
<Interactive name="MarkdownPlayground" initial={'# My project\n\nOne line about it.\n'} prompt="Add an Install section with one task."
  goal={{ mustMatch: ['^##\\s+Install', '^- \\[ \\] '], hint: ['Start a line with ## Install', 'Start a line with - [ ] '] }} success="Nice README!" />
```
- `goal.mustMatch`: regexes on the source (multiline flag on, so `^` is the start of a line). Done when all match. `goal.hint[i]` helps with `mustMatch[i]` when the learner presses Check. Without `goal` it is free play.

**YamlBuilder**: build a GitHub Actions workflow by stacking blocks. YAML and a little pipeline update live; Run lights up trigger → job → steps when the order is right. Decoys get kind feedback (their `why`).
```mdx
<Interactive name="YamlBuilder" workflow="CI" goal={{ order: ['push', 'job', 'checkout', 'node', 'test'] }} blocks={[
  { id: 'push', kind: 'trigger', label: 'On push', yaml: 'push:\n  branches: [main]', means: 'Run when someone pushes to main.' },
  { id: 'job', kind: 'job', label: 'Job: test', yaml: 'test:\n  runs-on: ubuntu-latest', means: 'Get a fresh Linux computer.' },
  { id: 'checkout', kind: 'step', label: 'Check out code', yaml: '- uses: actions/checkout@v7', means: 'Copy your code onto it.' },
  { id: 'node', kind: 'step', label: 'Set up Node', yaml: '- uses: actions/setup-node@v7\n  with:\n    node-version: 24', means: 'Install Node.' },
  { id: 'test', kind: 'step', label: 'Run tests', yaml: '- run: npm test', means: 'Run the tests.' },
  { id: 'deploy', kind: 'step', label: 'Deploy', yaml: '- run: npm run deploy', means: 'Publish the site.', why: 'This workflow only tests.' }]} />
```
- `workflow`: the workflow's `name:` (not `name`, which picks the interactive). `goal.order`: block ids in order. `success` optional.
- Block `yaml` is only the inside part; the builder adds `on:`, `jobs:`, `steps:`, `permissions:`, `env:` and all indents. `trigger`: the event (`push:` …). `job`: the job id and settings (`test:\n  runs-on: …`). `step`: one step (leading `- ` optional). `permissions` / `env`: key lines (`contents: read`); above the first job they are for the whole workflow, below a job they are for that job. Steps belong to the job above them.
- Use the action versions this repo uses (`actions/checkout@v7`, `actions/setup-node@v7`).

**MissionCheck**: real-world check with the public GitHub API (no login, no token). The learner types their GitHub username (and repo name); it is saved in this browser so later missions fill it in. Only `api.github.com` is called. Rate limits and offline get kind messages.
```mdx
<Interactive name="MissionCheck" checks={[{ type: 'repo', repo: 'diary', label: 'Your diary repo is public' },
  { type: 'commits', repo: 'diary', min: 5, label: 'It has 5 commits' }, { type: 'file', repo: 'diary', path: 'README.md', label: 'It has a README' }]}
  success="GitHub can see your diary!" />
```
- `checks`: `{ type, repo?, path?, min?, label }[]`. Types: `repo` (exists and is public), `commits` (≥ `min`, default 1), `file` (`path` exists), `profileReadme` (the `username/username` repo has a README), `pullRequest` (≥ `min` PRs by the learner; `repo: 'owner/name'` limits the search to that repo), `workflowRuns` (≥ `min` Actions runs), `tags` (≥ `min` tags), `pages` (GitHub Pages is on).
- `repo` is the suggested name; the learner can change it (one input per suggested name). `title` and `success` are optional.

### Branches, conflicts and rebasing (World 3)

All three run the real engine (no invented Git), take `commands` (run silently after the scenario, e.g. `['git merge cake']` to make a conflict: a scenario step can't stop on a conflict), and are checked by `npm run check:mdx` (task possible, regexes valid, commands work). They are on the hidden test page `/en/dev/interactives/` (used by `tests/e2e/w03-branch-lab.spec.ts`). Calm mode / reduced motion: no drag, no slides, the graph jumps to the after state.

**UniverseSplitter**: branches as parallel universes. Each branch is a lane of the commit graph. Tap a lane, or pick a universe button (arrow keys move between them): it runs `git switch <branch>`, HEAD moves, and the folder panel shows that universe's files and one file's content. Or pick a commit and stick a new branch on it.
```mdx
<Interactive name="UniverseSplitter" scenario="w03-l02-split" file="index.html" task={{ type: 'visitAll' }} />
<Interactive name="UniverseSplitter" scenario="w03-l01" task={{ type: 'create', at: '^Add day 1 page$', name: 'idea' }} prompt="Stick a note called `idea` on “Add day 1 page”." />
```
- `task` (one): `{ type: 'visitAll', branches? }` (the start counts as visited), `{ type: 'switch', branch }`, `{ type: 'create', at, name?, switch? }` (`at`: regex for the commit message; `name` is prefilled and required; `switch: true` runs `git switch -c` instead of `git branch`).
- `file`: the file to show (default: the first file that differs between universes). `prompt`, `success` optional.

**ConflictResolver**: the conflict game. Shows the conflicted file(s) with Git's real `<<<<<<<` / `=======` / `>>>>>>>` lines (red plus a warning icon). Each conflict gets buttons: keep yours / theirs / both, or Edit (a text box with the markers in; they must delete them). Several files get tabs. Finish = `resolveConflict` (write + `git add`) for each file, then the finishing command, with the commands shown.
```mdx
<Interactive name="ConflictResolver" scenario="w03-l06" commands={['git merge cake']} expect={['learned branches', 'baked a cake']} why="Keep both day 2 lines." graph />
<Interactive name="ConflictResolver" scenario="w03-boss-merge" commands={['git merge party']}
  expect={{ 'index.html': ['My Git Diary', 'Party time'], 'style.css': 'hotpink' }} avoid={{ 'index.html': 'Party Diary' }} />
```
- `expect` / `avoid`: regex (multi-line, any case) the fixed text must / must not match. A string or list is for the first file; an object maps paths. `check:mdx` makes sure yours / theirs / both can reach it. No markers may be left either way.
- `finish`: commands after `git add` (default: `git commit --no-edit` for a merge, `git rebase --continue`, `git cherry-pick --continue`; nothing for a stash pop). `[]` stops after `git add`.
- `look="editor"`: buttons named like a code editor's (Accept Current Change, Accept Incoming Change, Accept Both Changes). Words: in a merge, "yours" = HEAD; in other looks and in rebase / cherry-pick / stash, "current" (HEAD) and "incoming".
- `file`: only that file. `graph`: show the commit graph (the conflict badge, then the merge commit). `prompt`, `why` (added to the "Almost!" message), `success`.

**RebaseDeck**: interactive rebase (`git rebase -i`) as cards. Cards come from `rebaseTodo(state, upstream)`, oldest on top. Drag the grip or use ↑ ↓ to reorder; pick an action per card (pick, reword, squash, fixup, drop; a native select, so the first letter works too). Reword opens a message box; squash has an optional one. "Run rebase" runs `rebaseInteractive` and the graph shows before → after (button to compare).
```mdx
<Interactive name="RebaseDeck" scenario="w03-l11b" upstream="main"
  goal={{ messages: ['^Add photo captions$', '^Add gallery page$', '^Add style$'], commits: 5, filesMissing: ['debug.txt'] }}
  commitFiles={[{ message: '^Add gallery page$', file: 'gallery.html', contains: 'My Gallery' }]}
  hints={['Move “fix typo” right under “Add gallery page”.']} />
```
- `goal`: any Sim goal keys (checked after the run). `messages` checks subjects, so squash and fixup look the same there.
- `commitFiles`: `{ message, file, contains?, lacks? }[]`: the commit whose subject matches has that file content. Use it when *where* a fixup lands matters (a fix folded into the wrong commit keeps the same messages).
- Kind feedback for: nothing changed, a first squash/fixup, all dropped, an order that would conflict, too many / too few commits, messages, a file that should be gone. `hints` are added one by one.

### Deep Git (World 10)

Both build their repo from a `scenario` and are on the hidden test page (`/en/dev/interactives/`). `npm run check:mdx` checks their props against the scenario.

**ObjectXray**: look inside Git's object database. The learner picks a commit (HEAD's history, newest first), then clicks ids in the `git cat-file -p` view: a commit's `tree` / `parent` lines, a tree's entries (folders are trees, files are blobs). A trail shows the path (commit › tree › css › style.css) and goes back. Ids are real SHA-1s, the same ones `git cat-file`, `ls-tree` and `rev-parse` print.
```mdx
<Interactive name="ObjectXray" scenario="w10-objects" task={{ type: 'findBlob', path: 'css/style.css' }} success="That blob is the stylesheet's content." />
```
- `task` (optional; without it the card is free exploring and never reports done): `{ type: 'findBlob', path, from? }` (open the blob of that file), `{ type: 'findTree', path?, from? }` (a folder's tree; no `path` = the root tree), `{ type: 'findParent', of? }` (open the parent commit). `from` / `of` is a revision, default `HEAD`. Done (`fl:done`) when the learner opens that object.
- Opening the wrong blob (or another commit for `findParent`) gives kind feedback (`fl:wrong`); a Hint button names the next id to open (`fl:hint`).
- `prompt` replaces the task sentence; `success` replaces the "found it" sentence.

**BisectDetective**: catch the commit that broke something. The commits from `good` to `bad` sit in a list (oldest first). Start runs `git bisect start <bad> <good>` in the engine, which checks out the middle commit (Git's own choice). The learner presses Run the test (shows the file at that commit, the bad line marked), then Mark good / Mark bad (`git bisect good|bad`). The list narrows until Git names the first bad commit; then its change is shown. Steps used are shown next to `ceil(log2(n))`. The little terminal shows the real `git bisect` output.
```mdx
<Interactive name="BisectDetective" scenario="w10-bisect" test={{ file: 'index.html', bad: 'RM0', label: 'The test: the price in index.html must not be RM0.' }}
  success="Bisect found the price bug in a few tests." />
```
- `test`: `{ file, bad, label? }`. A commit is bad when a line of `file` matches the regex `bad`. `label` explains the test in words (default names the file and pattern).
- `good` / `bad` (optional revisions): the known ends. Default: the oldest commit on HEAD's line, and HEAD. The test must pass at `good` and fail at `bad` (`check:mdx` checks this).
- Marking against the test result gives kind feedback (`fl:wrong`); marking before testing nudges (`fl:hint`). `fl:done` when the first bad commit is found.

### Ship It: Docker games

Six standalone games for the Docker part (they don't use a simulator or a `scenario`). Food-story words throughout: kek lapis (layers), order hatch (ports), lockers (volumes), set meal (Compose), meal pack (image). Every one: buttons and native selects for every action (drag is optional), kind `fl:wrong` feedback, `fl:done` when the task is met, one main animation under 2 s that never loops, Replay, and Before/After (or a written before → after) in calm mode / reduced motion. On the hidden test page (`/en/dev/interactives/`, tested by `tests/e2e/docker-games.spec.ts`). `npm run check:mdx` checks their props (ids exist, the task is possible, it isn't done at the start). Logic: `src/lib/kekLapis.ts`, `orderHatch.ts`, `lockerTest.ts`, `composeCanvas.ts`, `shrinkRay.ts`, `namespaceXray.ts` (pure, unit-tested). All take optional `prompt` (your task sentence) and `success`.

**Sizes are real.** `src/lib/docker-sizes.json` holds sizes measured on Docker Engine 29.9 (2026-10-31): unpacked layer sizes as `docker history --human=false` prints them; an image = the sum of its layers. Shown like Docker prints them (`8.19kB`, `12.8MB`, `1.36GB`, decimal units). `docker images` on the containerd image store shows two other numbers: DISK USAGE (unpacked + the download) and CONTENT SIZE (the compressed download). Re-measure with `npx tsx scripts/docker-games/measure-sizes.ts <tmp dir> --write` (needs the base images pulled; runs `npm ci` offline from this machine's npm cache, seeding the same cache files an online `npm ci` would write into the layer; makes and removes `fl-ui-measure-*` images).

| Measured | Size |
| --- | --- |
| Bases: `node:24` · `node:24-slim` · `node:24-alpine` · `gcr.io/distroless/nodejs24-debian13` · `nginx:1.29` · `nginx:1.29-alpine` | 1.22GB · 249MB · 181MB · 159MB · 174MB · 66.6MB |
| Kek lapis app on `node:24-alpine`: `WORKDIR /app` · `COPY package.json package-lock.json ./` · `RUN npm ci --omit=dev` · `COPY . .` · `CMD` | 8.19kB · 53.2kB · 12.8MB · 36.9kB · 0B |

**KekLapisBuilder**: each Dockerfile line stacks one kek lapis layer with its size. The learner reorders lines (↑ ↓; `FROM` stays first) or picks another version of a line (a select), then presses "Change index.html and build again": it was built once, the file changes, and the second build shows which layers stay CACHED and which bake again (the first changed layer and every one on top). A folded "What docker build printed" shows BuildKit's step lines (` => CACHED [4/5] RUN npm ci --omit=dev`).
```mdx
<Interactive name="KekLapisBuilder" edit="index.html" goal={{ cached: ['install'] }} lines={[
  { id: 'from', text: 'FROM node:24-alpine', size: '181MB' }, { id: 'workdir', text: 'WORKDIR /app', size: '8.19kB' },
  { id: 'copy-all', text: 'COPY . .', size: '36.9kB' }, { id: 'copy-pkg', text: 'COPY package.json package-lock.json ./', size: '53.2kB' },
  { id: 'install', text: 'RUN npm ci --omit=dev', size: '12.8MB' }, { id: 'cmd', text: 'CMD ["node", "server.js"]' }]} />
```
- `lines` (required): `{ id?, text, size?, changes? }[]`, top first. One stage: line 1 is the only `FROM`. `size`: bytes, or text like `'12.8MB'` (settings lines like `ENV`, `CMD`, `EXPOSE` default to `0B` and never "bake"). `changes`: other versions of the line, strings or `{ text, size }`. `id` defaults to `l1`, `l2`, …; give ids when the goal names lines.
- `edit` (required): what changes before the second build: a file name (`'index.html'` or `{ file, label? }`; a `COPY`/`ADD` that copies it misses the cache: `.`, folders and globs like `package*.json` count) or a Dockerfile line (`{ line: 'install', text: 'RUN npm ci --omit=dev --ignore-scripts' }`).
- `goal` (optional; without it the card is done after the first build): `cached` (line ids that must stay CACHED), `cachedAfterEdit` (at least this many `RUN`/`COPY`/`ADD`/`WORKDIR` steps CACHED), `order` (exact line order). The "Almost!" note names the line that broke the cache and where to move it.

**OrderHatch**: port mapping as cables. Laptop ports on one side, containers and their ports on the other. Tap a laptop port, then a container port (or the other way round; keyboard works the same): a cable joins them and the matching `docker run -d --name web -p 8080:80 nginx:1.29-alpine` appears. A second cable on a busy laptop port sparks: red + icon, Docker's real words (`Bind for 0.0.0.0:8080 failed: port is already allocated`, checked on Docker 29) and a plain sentence. When the task is done, a request travels laptop → cable → container and "200 OK" appears.
```mdx
<Interactive name="OrderHatch" containers={[{ name: 'web', ports: [80] }, { name: 'api', ports: [3000], image: 'node:24-alpine' }]}
  task={{ type: 'map', host: 8080, container: 'web', port: 80 }} />
<Interactive name="OrderHatch" containers={[{ name: 'web', ports: [80] }, { name: 'api', ports: [3000] }]} start={[{ host: 8080, container: 'web', port: 80 }]}
  hostPorts={[8080, 8081]} task={{ type: 'map', maps: [{ container: 'api', port: 3000 }] }} prompt="api needs a laptop port too. 8080 is busy." />
```
- `containers` (required): `{ name, ports, image? }[]` (image default `nginx:1.29-alpine`). `task` (required): `{ type: 'map', host?, container, port }` or `{ type: 'map', maps: [...] }`; no `host` means any free laptop port. `start`: cables already plugged. `hostPorts`: laptop ports to offer (default: the ones used plus 3000 and 8080).

**LockerTest**: predict, then reveal. A lunchbox (container) holds data in its own writable layer and in tmpfs (a note in memory); outside are a named volume (a locker) and a bind mount (your shelf, a laptop folder). The learner marks each file Stays or Gone, presses Run it, sees the real commands and the truth. Wrong guesses get the trick and Try again. Truth (checked on Docker 29): `docker restart` keeps the writable layer and empties tmpfs; `docker rm` + `docker run` keeps only volumes and bind mounts; `docker volume rm` (after the container is gone) deletes the volume; bind-mounted files always stay.
```mdx
<Interactive name="LockerTest" ask={['restart', 'recreate', 'volumeRm']} />
<Interactive name="LockerTest" mounts={['writable', { kind: 'volume', name: 'diary-data', target: '/data', file: 'diary.db' }]} ask="recreate" />
```
- `ask`: `restart`, `recreate` (rm + run) and/or `volumeRm`, one question each (default `['recreate']`). Done when every question is answered right.
- `mounts`: kinds (`writable`, `volume`, `bind`, `tmpfs`) or `{ kind, name?, target?, file? }` (default: all four: `/app/today.txt`, `kedai-data:/data/orders.db`, `./menu:/menu/menu.md`, tmpfs `/tmp/cache/cache.bin`). `container` (default `kedai`), `image` (default `nginx:1.29-alpine`) for the commands.

**ComposeCanvas**: a set meal. Tap (or drag) services from the menu onto the table; tick their phone lines (networks), pick a locker (named volume) and who waits for whom (`depends_on` with `service_started`, `service_healthy` or `service_completed_successfully`). `compose.yaml` writes itself beside it: valid Compose Specification, about 15 lines visible with indent guides, it scrolls, new lines glow once. "Order the set meal" checks the goal, then `docker compose up -d` lights the services in start order (dependencies first; "healthy" when they have a healthcheck).
```mdx
<Interactive name="ComposeCanvas" start={['web']} palette={[
  { id: 'web', image: 'nginx:1.29-alpine', ports: ['8080:80'], means: 'Serves the shop pages.' },
  { id: 'api', build: './api', environment: { DATABASE_URL: 'postgres://kedai:example@db:5432/kedai' }, means: 'Takes the orders.' },
  { id: 'db', image: 'postgres:18-alpine', environment: { POSTGRES_PASSWORD: 'example' }, volumeTarget: '/var/lib/postgresql',
    healthcheck: { test: ['CMD-SHELL', 'pg_isready -U postgres'], interval: '5s' }, means: 'Keeps the orders.' }]}
  goal={{ services: ['web', 'api', 'db'], volumes: { db: 'db-data' }, networks: { web: ['front'], api: ['front', 'back'], db: ['back'] }, dependsOn: { api: { db: 'service_healthy' } } }} />
```
- `palette` (required): `{ id, label?, image? | build?, ports?, environment?, healthcheck?: { test, interval?, timeout?, retries? }, volumeTarget?, means? }[]`. `id` is the service name (lowercase). A service can take a volume only with `volumeTarget` (Postgres 18 images keep data under `/var/lib/postgresql`).
- `goal`: `services` (must be there), `only` (no others), `volumes` (`{ db: 'db-data' }`), `networks` (`{ api: ['front', 'back'] }`, at least these), `dependsOn` (`{ api: { db: 'service_healthy' } }`). Waiting for "healthy" on a service with no healthcheck, or a waiting loop, gets a kind note. `networks` / `volumes` props: names to offer (default: the ones the goal uses). `start`: ids (or full `{ id, networks, volume, dependsOn }`) already on the table.
- The Kedai sample stack is `src/lib/composeSamples.ts`. `npx tsx scripts/docker-games/verify-compose.ts` runs real `docker compose config` on generated files (test-only, needs Docker; Vitest parses them with the `yaml` package).

**ShrinkRay**: make the meal pack smaller. A size meter (start size, target line) shrinks as the learner swaps the base, adds a `.dockerignore`, adds a build stage and ships without dev tools; the Dockerfile (≤ 15 lines) and `.dockerignore` update live. Moves that wouldn't build are refused with the reason: distroless has no npm or shell (needs a build stage); production-only can't run the TypeScript build in one stage. Done at or under the target.
```mdx
<Interactive name="ShrinkRay" target={200} />
<Interactive name="ShrinkRay" app="static-site" target={80} />
```
- `target` (required): MB, decimal. `app`: `node-api` (default: a small TypeScript API, zod/cookie/nanoid + typescript/eslint/prettier/@types/node) or `static-site` (a diary site served by nginx). `options`: moves to offer (default all): `base:node`, `base:slim`, `base:alpine`, `base:distroless`, `ignore`, `stage`, `prodOnly` (node-api); `base:nginx`, `base:nginx-alpine`, `ignore` (static-site). `start`: `{ base, stage, ignore, prodOnly }` (default the biggest). Docker Hardened Images aren't offered: they need a registry login we couldn't measure.
- Measured node-api sizes: one stage on `node:24` 1.36GB (1.3GB with `.dockerignore`), `node:24-slim` 390MB / 328MB, `node:24-alpine` 322MB / 260MB; with a build stage (final image; `.dockerignore` doesn't change it) dev tools in / out: `node:24` 1.28GB / 1.23GB, slim 311MB / 258MB, alpine 243MB / 190MB, distroless 221MB / 168MB. Static site: `nginx:1.29` 186MB / 175MB, `nginx:1.29-alpine` 78MB / 67.8MB (without / with `.dockerignore`).

**NamespaceXray**: a plain Linux process (`node server.js`, PID 4242 on `aina-laptop`). Each switch sits next to the panel it changes: PID (process list), Mount (files), Network (interfaces), UTS (hostname), IPC (shared memory), User (uid outside), and the cgroup limits (memory, CPU, processes, with the cgroup v2 file and value). The changed panel glows once and says what it showed before. With Docker's default set on (PID, mount, network, UTS, IPC) the banner says it's a container now. Notes keep it honest: ps needs a fresh `/proc` (Docker mounts one), Docker swaps the root folder for the image, Docker uses user namespaces only in rootless mode or with userns-remap, limits only apply when you ask (`--memory`, `--cpus`, `--pids-limit`).
```mdx
<Interactive name="NamespaceXray" task={{ type: 'find', what: 'hideProcesses' }} switches={['pid', 'mnt', 'net', 'uts', 'ipc', 'user']} />
<Interactive name="NamespaceXray" task={{ type: 'docker' }} />
```
- `task`: `{ type: 'all' }` (default: every switch on show), `{ type: 'docker' }` (Docker's default set), `{ type: 'turnOn', switches }`, or `{ type: 'find', what }` with `what` = `hideProcesses`, `ownHostname`, `ownNetwork`, `ownFiles`, `privateIpc`, `fakeRoot`, `capMemory`, `capCpu`, `capProcesses` (the wrong switch still flips and says what it changed).
- `switches`: show only these (`pid`, `mnt`, `net`, `uts`, `ipc`, `user`, `memory`, `cpu`, `pids`) to keep a phone card short. `start`: switches already on.

### Ship It: YAML playground (D0, usable anywhere)

**YamlPlayground**: the learner edits a small YAML file (the YamlDoctor editor: line numbers, indent guides every 2 spaces, a tab shows red, "Add a space" / "Remove a space" buttons for phones, Start over) and a box below shows **how a computer reads it**: a tree of keys, lists and values, each with its kind (map, list, text, number, true/false, empty) and counts ("list · 3 items"). The tree follows every key press. A reading problem marks the line (red + ⚠) and shows the reader's real words, `yaml: line 3: found character that cannot start any token` (go-yaml, the reader under Docker Compose and kubectl), then one plain line (rule 19); the error waits ~0.7 s after typing stops. Values follow YAML 1.1 like kubectl: `yes` is true and `0123456789` becomes the number 123456789, so the traps show for real. Logic: `src/lib/yamlPlayground.ts` (unit-tested; parsing from `src/lib/k8sYaml.ts`). On the hidden test page (`/en/dev/interactives/`, tested by `tests/e2e/yaml-playground.spec.ts`).
```mdx
<Interactive name="YamlPlayground" file="order.yaml" initial={'dish: nasi lemak\nprice: 5\n'} prompt="Change the dish to laksa." />
<Interactive name="YamlPlayground" file="order.yaml" initial={'dish: nasi lemak\nsides:\n  - sambal\n  - egg\n'}
  expect={[{ path: 'sides', type: 'list', count: 3, includes: 'cucumber', hint: 'Add a line under egg: two spaces, a dash, a space, cucumber.' }]}
  solution={'dish: nasi lemak\nsides:\n  - sambal\n  - egg\n  - cucumber\n'} hint="Copy the egg line." success="Three sides!" />
```
- `initial` (required): the starting YAML, ~15 lines max (rule 18; `check:mdx` stops at 16). `file`: the tab name (default `menu.yaml`). `prompt`: the task sentence. `hint`: shown by the Hint button (`fl:hint`). `success`.
- `expect`: what the finished YAML must say; each `{ path, type?, count?, equals?, includes?, hint? }` must hold. `path` is dotted from the top (`sides`, `sides.0`, `tiffin.bottom.1`; `''` = the whole file). `type`: `map`, `list`, `text`, `number`, `bool`, `null`. `count`: list items or map keys. `equals` / `includes` compare as text (use `type` to tell `5` from `"5"`). `hint` is the "Almost!" line when Check finds this one first. Done (`fl:done`) as soon as it reads cleanly and every item holds; Check gives kind feedback (`fl:wrong`). Without `expect` it is free play, done after the first edit.
- `solution` (required with `expect`): a YAML that meets it. Never shown; `npm run check:mdx` makes sure it meets `expect` and that `initial` does not.

### Boss-only

**Placement** (World 0 boss): quick questions; right answers mark lessons as known.
```mdx
<Interactive name="Placement" questions={[{ q: 'What does git add do?', options: [{ label: 'Puts changes in the box', correct: true }, { label: 'Uploads to GitHub' }], marks: ['git-w01-l03'] }]} />
```

**Challenge**: several simulator stages in a row (escape room, diary site). Hints after 2 tries.
```mdx
<Interactive name="Challenge" stages={[{ title: 'Wrong file staged', text: 'secret.txt is in the box. Take it out.', scenario: 'w02-boss-1', goal: { notStaged: ['secret.txt'] }, hints: ['Use git restore --staged.'] }]} />
```

**LogCheck**: paste real `git log --oneline` output; checks the number of commits and message quality. No network.
```mdx
<Interactive name="LogCheck" min={5} />
```

## Scenarios

```ts
// src/content/courses/git/scenarios/w01.ts
{
  id: 'w01-l04',
  steps: ['mkdir diary', 'cd diary', 'git init', { write: 'index.html', content: '<h1>Hi</h1>\n' }, 'git add .', 'git commit -m "Add home page"'],
  verify: [['git status -s'], ['git add index.html', 'git status']],
}
```
- Steps run in the engine (and in real Git for `verify`). Default identity: `You <you@example.com>`, `init.defaultBranch=main`, home `/home/you`.
- Use `{ write: path, content }` for multi-line files. End file content with `\n`.
- `verify`: each list runs after the steps, in the engine **and** in real Git. Include the commands the lesson teaches. Keep each command valid (it must succeed) — except commands that Git itself stops on, like a merge with conflicts: those are fine in a verify list, because real Git stops the same way.
- Keep the diary project in `/home/you/diary` across World 1–2 so lessons feel connected.

## Rescue flows, review cards and the smoke test

- **Rescue flows** (`src/content/courses/git/rescue.yaml`): give each flow a `group` so it lands in the right section: `commits`, `branches`, `remote`, `secrets` or `setup` (no group → "Other problems"). The filter box searches flow titles in both languages. Link straight to one flow with `/en/rescue/#<flow-id>`. There is one flow per World 11 lesson; each result's `lesson:` points at it. Every Git command in a result is also in a `verify` list in `scenarios/w11.ts` (placeholder hashes like `a1b2c3d` and `ssh` commands excepted), so real Git checks it.
- **Rescue simulator extras (World 11)**: an SSH GitHub address (`git@github.com:you/diary.git` or `ssh://git@github.com/...`) answers every push, fetch, pull and clone with `Permission denied (publickey)`, because the simulator has no SSH key; `git remote set-url origin https://...` fixes it. `git revert -m 1 <merge>` undoes a merge commit. `git add --renormalize .` works like `git add -u .` (the simulator keeps LF line endings already).
- **Daily review cards** come from finished lessons only. A command page reviews after its `lesson`. A glossary word reviews after the first lesson **in its `world`** that uses `<Term id="...">` for it, else the first lesson there that mentions the English word, else after the whole world. So: set `world` on new glossary terms, and wrap the key word in `<Term>` in the lesson that teaches it. Questions offer 3 answers from the same or a nearby world. If two commands or two words mean nearly the same (like `git switch` and `git checkout`), add `confusable: [other-id]` to one of them, so neither is offered as a wrong answer for the other.
- **Smoke test** (`tests/e2e/all-lessons.spec.ts`): every lesson with `status: ready` is opened in EN and MS and stepped from card 1 to the win card. It fails on any page or console error. Turn a lesson `ready` only when both `.mdx` files exist.

### Branches and conflicts (World 3)

- Build branches with ordinary commands: `'git switch -c feature'`, `{ write: ... }`, `'git commit -am "..."'`, `'git switch main'`.
- Like real Git, changes on **touching lines** conflict (no unchanged line between them). For a clean three-way merge, keep the two edits at least one unchanged line apart (better: far apart, or in different files). For a conflict, change the same line on both branches.
- Conflict markers name the branch as typed (`>>>>>>> feature`); in a rebase or cherry-pick, `>>>>>>> a1b2c3d (Commit message)`; in a stash pop, `Updated upstream` / `Stashed changes`.
- A scenario step can't stop on a conflict. Start the conflict in the card instead: `commands` (TermReplay, GraphScene, SpotLines, ConflictResolver) or `intro` (Sim). `check:mdx` accepts commands that stop like this, and the verify list should run them too.
- `git commit` with no `-m` during a merge uses Git's default message (`Merge branch 'feature'`) because the simulator has no editor; the explanation line says so. `git rebase -i` is refused with a kind explanation: use the rebase card deck (engine helper `rebaseInteractive`).

### GitHub and teammates (World 4)

A hosted repo is a scenario step, like clicking "New repository" on GitHub:

```ts
{ server: 'https://github.com/you/diary.git' }                                        // empty repo
{ server: 'https://github.com/you/notes.git', files: { 'README.md': '# Notes\n' } }   // with a first commit ("Initial commit"; `message` to change)
```

A teammate is just another folder. Use commands real Git can run too:

```ts
steps: [
  { server: 'https://github.com/you/diary.git' },
  ...diary,                                      // your project in /home/you/diary
  'git remote add origin https://github.com/you/diary.git',
  'git push -u origin main',
  'mkdir -p /home/aisyah',
  'cd /home/aisyah',
  'git clone https://github.com/you/diary.git',
  'cd diary',
  'git config user.name "Aisyah"',              // her own identity (repo config)
  'git config user.email "aisyah@example.com"',
  { write: 'index.html', content: '...' },
  'git commit -am "Add Aisyah\'s day"',
  'git push',
  'cd /home/you/diary',                           // end where the learner works
]
```

- Push output is what a terminal shows (`To https://github.com/...`, ` * [new branch]      main -> main`, then `branch 'main' set up to track 'origin/main'.`). Pushing a new non-default branch to github.com also shows GitHub's `remote:` lines with the pull-request link.
- `git fetch` creates `origin/HEAD` like Git 2.48+; `git pull` on diverged branches without a choice gives Git's "Need to specify how to reconcile divergent branches" message (teach `--rebase` / `--no-rebase` / `pull.rebase`).
- `npm run verify:commands` maps `https://github.com/...` to local bare repos for real Git, so these scenarios are checked too. Real Git runs on the engine's clock (each command gets the engine's time after it), so commits get the same dates as in the engine.

### Deep Git (World 10)

- **Object ids are real.** Blob, tree, commit and annotated-tag ids are the SHA-1s real Git computes (same files, identity, dates and message). The engine's clock moves one minute per commit, so a scenario always gives the same ids. If you change a scenario's steps, every later id changes: never copy a hash into a lesson without checking it (`check:mdx` fails on a hash in a Sim goal/hint, or a TermReplay command, that the scenario doesn't have). `git log --oneline` in the scenario shows the ids.
- Set `exactHashes: true` on a scenario to make `verify:commands` compare ids too (they match when each command makes at most one commit: no stash or rebase in the steps). `VERIFY_ONLY=w10 npm run verify:commands` checks just the scenarios whose id starts with `w10`.
- Ready-made World 10 scenarios (`scenarios/w10.ts`): `w10-objects` (shop with a `css/` folder, 3 commits, tag `v1.0`), `w10-revisions` (merged `menu` branch and an open `prices` branch: `HEAD^2`, `A..B`, `A...B`), `w10-search` (You, Aisyah and Ben; a `TODO` footer that gets fixed: `log -S/-G`, `grep`, `blame`, `shortlog`), `w10-bisect` (10 commits; "Tidy up spacing", `HEAD~4`, changes the price to `RM0`; `test.sh` checks it), `w10-worktree` and `w10-aliases` (the diary, 2 commits), `w10-plumbing` (the shop plus an untracked `notes.txt` for `hash-object -w`), `w10-hooks` (the diary plus a committed `.githooks/pre-commit`), `w10-boss` (14 commits on `order.html`; "Clean up the form", `HEAD~5`, disables the Buy button; "Fix button colour" only adds `style.css`; `test.sh` is `! grep -q "disabled" order.html`).
- The terminal runs: `git cat-file -t|-s|-p|-e`, `git hash-object [-w]`, `git ls-tree [-r] [-t] [-d] [-l] [--name-only]`, `git rev-parse` (revisions, ranges, `^{tree}`, `rev:path`, `--short`, `--abbrev-ref`, `--show-toplevel`, `--git-dir`, `--show-prefix`), `git show-ref`, `git pack-refs [--all]`; `cat .git/HEAD`, `cat .git/refs/heads/main`, `cat .git/packed-refs`, `ls .git/refs/heads` (a read-only view; other `.git` files are not modelled); `git log -S/-G/--author/--grep/-i/-p/--left-right` and `-- <folder>`; `git diff A...B`; `git grep [-n -i -c -l -w -v -E -F] <pattern> [<rev>]`; `git blame [-L a,b] [-e] [<rev>] <file>`; `git shortlog [-s -n -e]`; `git bisect start|good|bad|skip|reset|log|run`; aliases (`git config --global alias.st status`, then `git st`; built-in commands win, like Git); `git worktree add|list|remove|prune`.
- `git bisect run` needs a command the terminal can run: `git bisect run sh test.sh` runs a script one command per line (`grep -q`, `test -f`, `! cmd`, `exit N`, `set -e`). Files here are never executable, so `./test.sh` says Permission denied (like a real file without `chmod +x`).
- Explain-only (a kind note, no fake output): `git rerere`, `range-diff`, `submodule`, `subtree`, `lfs`, `sparse-checkout`, `gc`, `maintenance`, `count-objects`, `repack`, `prune`, `fsck`, `whatchanged`, `hook`, `refs`. Teach these with Transcript (real output you are sure of) or pictures.
- Output follows Git 2.56 (CI checks it): bisect quotes its terms (`is the first 'bad' commit`, `waiting for both 'good' and 'bad' commits`; `new`/`old` work too), the first-bad-commit block is decorated like `git log` (`commit <id> (HEAD)`), `git bisect reset` with no bisect prints nothing, `git blame` ids are 7 hex chars (8 when a `^` boundary line shows), and `git worktree list` pads paths with one space. With an older local Git, `verify:commands` smooths these differences on both sides.

## Engine helpers for interactives

Import from `~/engine/git-sim`. All are pure: they never change the state you pass in.

- `conflictInfo(state): ConflictInfo | null` — the stopped merge / rebase / cherry-pick (or a stash pop that clashed). `{ op: 'merge' | 'rebase' | 'cherry-pick' | 'stash', labels: { ours, theirs }, commit, files: { path, kind, base, ours, theirs, merged }[] }`. `kind` is Git's status word (`'both modified'`, `'both added'`, `'deleted by them'`, …); a side is `null` when the file is absent there; `merged` is the working file now (with markers until fixed).
- `resolveConflict(state, path, text: string | null): CommandResult` — write `text` to the file and `git add` it (or delete + `git rm` when `null`). Same effect as typing it.
- `rebaseTodo(state, upstream): TodoItem[]` — what `git rebase -i <upstream>` would list, oldest first: `{ action: 'pick', commit, short, message }`.
- `rebaseInteractive(state, upstream, todo: { action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'; commit: string; message?: string }[]): CommandResult` — run that todo (no editor). `reword` / `squash` use `message` if given (squash default: both messages joined by a blank line; fixup keeps the first message). Stops on conflicts exactly like `git rebase` (then `conflictInfo` and `git rebase --continue` work as usual). A first `squash` / `fixup` is refused.
- `listServers(state): ServerInfo[]` — every hosted repo: `{ url, defaultBranch, branches: { name, tip, short, message }[], tags: { name, tip }[], empty }`.
- `serverLog(state, url, branch?): LogEntry[]` — commits on a hosted branch (default branch if omitted), newest first: `{ id, short, message, parents }`.
- `aheadBehind(state, branch?): AheadBehind | null` — `{ branch, upstream: 'origin/main' | null, ahead, behind, gone }` against the last fetch (current branch by default).
- `graphLanes(state, { showLost?, showRemotes?, showTags? }): LaneLayout` — lane data for drawing: `nodes` (`id, short, message, col` (time order), `lane` (0 = main line), `parents, branches, remotes, tags, isHead, lost, merge, reach: 'local' | 'remote' | 'tag' | 'lost'`), `edges` (`from` parent → `to` child, `kind: 'first' | 'merge'`), `lanes`, `head` and `pending` (a stopped operation: `{ op, commit, paths }`). `CommitGraph` uses it through `layoutGraph`.
- Also exported: `mergeFile`, `mergeTrees` (Git's three-way merge), `findServer`, `createServer`, `refLabels`, `remoteNames`, `remoteUrl`, `upstreamOf`.
- World 10: `objectStore(repo): Map<id, GitObject>` (every commit, tree, blob and annotated tag; `GitObject` is `{ type: 'commit', commit } | { type: 'tree', entries } | { type: 'blob', content } | { type: 'tag', name, info, target }`, each with `id`), `resolveObject(repo, spec)` (`HEAD`, `HEAD:css/style.css`, `HEAD^{tree}`, `v1.0^{}`, short ids → `{ ok, obj }`), `objectText(obj, tz)` (what `cat-file -p` prints), `objectSize`, `treeLines`, `commitTree`, `allRefs(repo)`, `dotGitFiles(state, repo)` (the `.git` view), `blameLines(repo, path, commitId)`, `bisectInfo(state): BisectInfo` (`{ active, start, bad, good, skip, testing, candidates (newest first), found, stepsLeft, log }`; `found` stays after reset), `bisectPick(commits, bad, good, skip)` (Git's next-commit choice), `estimateSteps(n)`, `worktreePaths(state)`, `blobId`, `treeId`, `buildTrees`. The interactives' own logic is in `src/lib/objectXray.ts` and `src/lib/bisectDetective.ts`.
- New events: `objectWritten`, `bisectStep` (`testing`, `left`), `bisectFound`, `bisectReset`, `worktreeAdded`, `worktreeRemoved`. `CommandResult.exitCode` is set by `sh`, `grep` and `test` (for `git bisect run`).
- `CommandResult.stopped` is `true` when Git stopped for the learner (conflicts), and for other non-zero results that are not mistakes (`git grep` or `grep` finding nothing, `test` being false, an explain-only command, bisect with only skipped commits left): `ok` is `false` like Git's exit code, but it is not a mistake. Events for animations include `branchCreated`, `merged` (`mode: 'fastForward' | 'merge' | 'upToDate'`), `conflict`, `conflictResolved`, `rebased` (`replayed`: old → new ids), `cherryPicked`, `stashSaved`, `pushed` / `pushRejected` / `fetched` (with `RefUpdate` lists), `cloned`, `tagCreated` and more (see `types.ts`).

## Ship It: conveyor engine and CI/CD games

Part 2 of Ship It (Kilang, `src/content/courses/cicd/`) runs workflows on a fake runner: the **conveyor engine** (`src/engine/conveyor-sim/`, pure TypeScript, Vitest-tested). Three games sit on it. They are on the hidden test page (`/en/dev/interactives/`, tests in `tests/e2e/conveyor.spec.ts`) and checked by `npm run check:mdx`.

**Scenarios come from the cicd course.** Lessons in `src/content/courses/cicd/` find them by themselves; anywhere else (a Kubernetes lesson with TrafficDial, the dev page) add `course="cicd"`. `check:mdx` reminds you.

### Scenarios (`src/content/courses/cicd/scenarios/cN.ts`)

```ts
{
  id: 'c2-fix-permissions',
  file: '.github/workflows/publish.yml',     // shown above the YAML (default .github/workflows/ci.yml)
  workflow: `name: Publish\non:\n  push:\n    branches: [main]\n...`,   // write ${{ }} as \${{ }} in a template string
  events: ['push-main', 'pr', 'fork-pr', 'tag'],   // event buttons (also push-branch, dispatch, schedule, release)
  branch: 'feature', tag: 'v1.2.0', changed: ['src/app.js'],   // what the events push (defaults shown)
  secrets: ['CLOUDFLARE_API_TOKEN'],          // repository secrets that exist (fork PRs get none)
  environments: { production: { reviewers: ['aina'], branches: ['main'], secrets: ['CLOUDFLARE_API_TOKEN'] } },
  cache: { warm: true, lockfileChanged: false, layers: false },   // what earlier runs left in the cache
  fail: { tests: ['tests/cart.test.js > adds tax'], onlyIn: { node: '22' }, lint: ['src/a.js 3:7 error ...'],
          build: true, cve: 'CRITICAL', hadolint: true, smoke: true, db: true, hang: 'npm test' },
  olderRun: true,                             // an older run on the same ref is still going (concurrency)
  repo: { owner: 'you', name: 'shop', private: false, tokenDefault: 'read' },
  fix: { from: 5, to: 6 },                    // lines a fix task may change
  expect: { 'push-main': 'failure' },         // checked by the scenario tests
  // C4: holes (must equal auditWorkflow's), the fixed file, actionlint findings shown on purpose.
  holes: [{ line: 6, kind: 'writeAll', fix: 'permissions:\n  contents: read' }], fixed: `...`, actionlint: ['is potentially untrusted'],
  traffic: { mode: 'canary', newErrorRate: 0.08, steps: [5, 25, 50, 100] },   // TrafficDial defaults
}
```

- **Every workflow must be valid for real GitHub.** `npm run verify:workflows` runs actionlint (official Docker image, pinned in `scripts/verify-workflows/index.ts`) on every scenario (`workflow` and `fixed`) and on `.github/workflows/*`; CI runs it before deploy. A file that is vulnerable on purpose lists the findings it shows in `actionlint` (regexes); any other finding fails, and so does a listed one that disappears.
- **Action versions:** use the ones in `KNOWN_ACTIONS` (`src/engine/conveyor-sim/actions.ts`): `actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache@v6`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, `actions/attest@v4` (`attest-build-provenance@v4` wraps it), `docker/setup-buildx-action@v4`, `docker/setup-qemu-action@v4`, `docker/login-action@v4`, `docker/metadata-action@v6`, `docker/build-push-action@v7`, `aquasecurity/trivy-action@v0.36.0`, `hadolint/hadolint-action@v3.1.0`. `verify:workflows` refuses other versions. Teach full-SHA pinning, but show a SHA only as a labelled example (`@0123...4567 # v2.0.0 (example SHA)`).
- YAML trap: `run: echo "a: b"` is a YAML error (a colon and a space inside a plain value). Quote the whole value or reword it.
- Keep a workflow short: the YAML box shows ~15 lines and scrolls.

### What the engine knows

- **Keys:** `name`, `on` (push with branches/tags/paths and their `-ignore`, pull_request, pull_request_target, workflow_dispatch with inputs, schedule, workflow_call, release, issues, ...), `permissions`, `concurrency` (`group`, `cancel-in-progress`, `queue`), `env`, and per job `runs-on`, `needs`, `if`, `strategy.matrix` (include, exclude, `fail-fast`, `max-parallel`), `environment`, `services`, `outputs`, `env`, `permissions`, `timeout-minutes`, `continue-on-error`, `uses` (reusable workflow); steps `uses`, `run`, `with`, `env`, `id`, `if`, `continue-on-error`, `timeout-minutes`. Unknown keys, labels, scopes, events and bad expressions are kind errors with the line (and GitHub's real words, like `Unexpected value 'runs_on'`). Old majors and unknown inputs are warnings; unknown actions and commands pretend to pass (with a note).
- **Commands in `run:`:** `npm ci|install`, `npm test`, `npm run lint|build|deploy|...`, `npx wrangler deploy`, `docker build|push|login|run|compose`, `curl` (only `--fail`/`-f` stops on an error page), `gh release|pr|issue ...` (needs `GH_TOKEN`), `hadolint`, `trivy`, `echo` (with `>> "$GITHUB_OUTPUT"` or `$GITHUB_ENV`), `exit N`, `sleep N`. Like `bash -e`, the first failing command stops the step.
- **Real behaviour:** filters (globs, `!` patterns, tags vs branches, no path filters for tags), `success()`/`failure()`/`always()`, `needs.<id>.result` and `outputs`, matrix legs and fail-fast, cache keys from `hashFiles` (a second run hits; a new lockfile misses; `restore-keys` give a partial hit), artifacts (missing name, duplicate name 409), GITHUB_TOKEN scopes (`denied: permission_denied: write_package`, `Resource not accessible by integration`, `id-token: write` for attestations), fork PRs (no secrets, read-only token), environment reviewers and deployment branches, concurrency, timeouts, service containers, secret masking (`***`).
- **Container steps (World C2):** metadata-action tags (`type=ref` branch/pr/tag, `semver` with `{{version}}`/`{{major}}.{{minor}}`, `sha`, `raw`, `edge`; `flavor: latest=auto` adds `latest` on a version tag but not on a pre-release like `v1.3.0-rc.1`). build-push-action `platforms`: a platform the runner's CPU can't run (arm64 on `ubuntu-latest`) needs `docker/setup-qemu-action` first, else the real `exec /bin/sh: exec format error` (exit code 255, checked on Docker 29). `docker run … npm test` and `docker compose run|exec … npm test` run the tests inside the image (`fail.tests` applies; Compose brings its own database, so `fail.db` doesn't). The C2 scenarios (`scenarios/c2.ts`) cover build, tags, GHCR, layer cache, multi-arch, tests in containers, service DB, Compose, lint, CVE gate, attestations, reusable workflows, concurrency, paths and the green line.

### Engine API (`~/engine/conveyor-sim`)

- `parseWorkflow(yaml) → { workflow, issues }` (`Issue`: `{ level, key, params, line, real? }`; `key` is an i18n key under `conveyor.issue.*`).
- `simulate(yaml, { trigger, world, decisions })` and `runScenario(scenario, preset | trigger, { yaml?, decisions?, world? })` return a `RunResult`: `status` (`success`, `failure`, `cancelled`, `waiting`, `notTriggered`, `invalid`), `why`, `jobs` (each leg: `key`, `result`, `start`/`end` on the fake clock, `steps` with `log` and `why`), `events`, `duration`, `artifacts`, `waitingFor`, `cachesSaved`, `layersSaved`.
- Events (sorted by time): `runQueued`, `runPending`, `olderRunCancelled`, `matrixSplit`, `jobStarted`, `jobSkipped`, `jobFinished`, `stepStarted`, `stepPassed`, `stepFailed` (`continued`), `stepSkipped`, `stepCancelled`, `cacheHit` (`partial`), `cacheMiss`, `cacheSaved`, `artifactUploaded`, `artifactDownloaded`, `approvalWaiting`, `approved`, `rejected`, `runFinished`.
- Also: `presetTrigger(preset)`, `matchTrigger(workflow, trigger)`, `tokenPermissions(...)`, `expandMatrix(matrix)`, `evaluate` / `evalIf` / `interpolate` (expressions), `auditWorkflow(yaml) → Hole[]` (`unpinned`, `writeAll`, `prTargetCheckout`, `injection`, `secretEcho`, `selfHosted`, each with its line), `beltLayout(workflow)`, `viewAt(result, n)`, `stationView(...)`, `firstFailedStation(...)`.
- Every failure has a plain note (`conveyor.why.*`) next to the real error line the tool printed.

### ConveyorBelt (C1–C3)

The workflow on the left (line numbers, indent guides; yellow = lines you may change, pink = the line running now, red + icon = a problem), the stations on the right (stacked on phones): get ready → lint → test → build → scan → publish → deploy. One job: its steps are the stations. Several jobs: one station per job, in `needs` order. A matrix shows one lane per leg; a cache hit is a shortcut badge; a red station (with an icon) stops the line and the rest is skipped. Tap a station for the runner's log. Run, Pause, Step and Step through (every run is finite; calm mode / reduced motion shows the end at once). The cache stays warm between runs, like on GitHub.
```mdx
<Interactive name="ConveyorBelt" course="cicd" scenario="c1-broken-test" task={{ type: 'predict' }} />
<Interactive name="ConveyorBelt" course="cicd" scenario="c2-fix-permissions" task={{ type: 'green' }} fixes={[
  { label: 'contents: write', text: 'permissions:\n  contents: write', why: 'Writing code is not writing packages.' },
  { label: 'write-all', text: 'permissions: write-all', why: 'Every step would get every key.', correct: false },
  { label: 'contents: read and packages: write', text: 'permissions:\n  contents: read\n  packages: write' }]} />
<Interactive name="ConveyorBelt" course="cicd" scenario="c2-fix-permissions" editable task={{ type: 'green', forbid: ['write-all'] }} />
```
- `scenario` (required), `event` (the event picked first), `events` (buttons; default the scenario's), `label` (optional caption), `success`.
- `task` (default `{ type: 'watch' }`: done after one finished run): `{ type: 'green', forbid? }` (make it pass; `forbid`: regexes the YAML must not match), `{ type: 'predict' }` (tap the station that will stop the line, or "Nothing stops it", then Run; a miss gets a kind hint and another go), `{ type: 'event', job?, result }` (find an event where `job` ends `success`, `skipped` or `failure`, or `result: 'notTriggered'`), `{ type: 'approve' }` (approve a waiting environment), `{ type: 'cacheHit' }` (run twice).
- Fix tasks use the scenario's `fix` lines: `fixes` = choices (`{ label, text, why?, correct? }`; `correct: false` = green but not the safe answer), or `editable` = a small text box for those lines.
- `check:mdx` runs the scenario: a green task must start red and have a working fix, an event task must be possible, and so on. Logic: `src/lib/conveyorBelt.ts`.

### SpotTheHole (C4)

A vulnerable workflow. Tap a risky line: it turns red (with an icon) and shows the attack in plain words, then the fix (and the fixed code). A safe line gets a kind "Almost!"; after two misses, a hint. Done when every hole is found; then "Show the fixed workflow" (scenario `fixed`).
```mdx
<Interactive name="SpotTheHole" course="cicd" scenario="c4-vulnerable" />
<Interactive name="SpotTheHole" file=".github/workflows/hello.yml" workflow={['name: Hello', 'on: issues', 'jobs:', '  hello:', '    runs-on: ubuntu-latest', '    steps:',
  { text: '      - run: echo "Hi ${{ github.event.issue.title }}"', hole: { kind: 'injection', fixCode: '      - run: echo "Hi $TITLE"' } }]} />
```
- Scenario mode (a cicd lesson, or `course="cicd"`): the holes come from `auditWorkflow` (with the scenario's `holes[].fix` as fixed code); `notes={{ 15: { attack, fix } }}` changes the words for one line.
- `workflow` mode: one entry per line; `hole: { kind?, attack?, fix?, fixCode? }` (`fixCode: ''` = delete the line). Kinds: `unpinned`, `writeAll`, `prTargetCheckout`, `injection`, `secretEcho`, `selfHosted` (default words from i18n `holes.*`); without a kind, write `attack` and `fix`. `check:mdx` makes sure the marked holes match the audit and no hole is left unmarked.
- `file`, `prompt`, `success` optional. Facts: docs.github.com "Secure use reference"; the tj-actions/changed-files tag compromise (March 2025).

### TrafficDial (C3, K2)

The old version v1 (blue) and the new version v2 (green). Canary: send 5% → 25% → 50% → 100% (one step at a time). Blue/green: test v2 privately, switch everyone, switch back. A line graph shows each version's error rate per minute with an alarm line; a spike turns red (with an icon). "Users who hit a v2 error" counts up. Each move plays a few minutes (~0.6 s each) and stops; calm mode / reduced motion: a "Next minute" button, with the numbers table open.
```mdx
<Interactive name="TrafficDial" mode="canary" newErrorRate={0.08} task={{ type: 'rollback', maxHurt: 150 }} />
<Interactive name="TrafficDial" mode="bluegreen" newErrorRate={0.1} task={{ type: 'rollback' }} />
<Interactive name="TrafficDial" course="cicd" scenario="c3-release" task={{ type: 'rollout' }} />
```
- `mode` (`canary` | `bluegreen`), `newErrorRate` (a share: 0.08 = 8%), `oldErrorRate` (0.005), `steps` ([5, 25, 50, 100]), `threshold` (0.02), `usersPerMinute` (1000), `scenario` (its `traffic` gives the defaults).
- `task`: `{ type: 'rollback', maxHurt? }` (default 150: roll back before that many users hit the bug; in blue/green, testing first and keeping v1 also wins), `{ type: 'rollout' }` (a healthy release reaches 100%), `{ type: 'explore' }`. Too late gives a kind "Almost!" and Start again. Logic: `src/lib/trafficDial.ts` (the numbers never change between learners).

## Ship It course (Docker, CI/CD, Kubernetes)

The brief is `docs/SHIP-IT-PLAN.md`. Every rule above still applies, plus its five extra rules (§3: one food story, show the state after every command, safe by default, YAML in small bites, real errors in plain words). Ship It is one course in three parts, stored as three course folders that share one overview map (`/<lang>/ship-it/`) and one Rescue Center (`/<lang>/ship-it/rescue/`).

### Folders, ids and URLs

```
src/content/courses/docker/       # Part 1 "Dapur": worlds D0–D6 (world ids 0–6)
src/content/courses/cicd/         # Part 2 "Kilang": worlds C1–C4 (world ids 1–4)
src/content/courses/kubernetes/   # Part 3 "Medan Selera": worlds K1–K7 (ids 1–7) + Career Quest (id 8, code K8)
  course.yaml                     # the whole outline: every world, lesson, boss and mission
  <world dir>/NN-<slug>/en.mdx    # e.g. d1-first-containers/07-port-mapping/en.mdx
  <world dir>/NN-<slug>/ms.mdx
  <world dir>/boss/en.mdx, ms.mdx
  commands.yaml                   # command pages + cheat sheet for this course
  rescue.yaml                     # rescue flows (shown in the Ship It Rescue Center)
  scenarios/index.ts              # simulator starting states (shape set by that course's engine)
src/content/glossary/docker.yaml, cicd.yaml, kubernetes.yaml
```

- Lesson ids: `docker-d1-l03`, `cicd-c2-l05`, `k8s-k1-l04`. Bosses: `docker-d1-boss`. Career Quest: `k8s-k8-l01` …
- Capstone missions are lessons at the end of their world, with `mission: N` in `course.yaml`: `docker-d4-m1`, `cicd-c2-m2`, `cicd-c3-m3`, `k8s-k5-m4`, `k8s-k6-m5`, `k8s-k7-m6`. Their folder is `NN-<slug>` like any lesson (e.g. `d4-set-meals/11-mission-1-pack-it/`). Maps show an `M1` tag on the world and "Mission 1" on the row.
- URLs: `/<lang>/docker/<world slug>/<lesson slug>/`, the same for `cicd` and `kubernetes`. Course maps: `/<lang>/docker/` (anchor `#world-1` opens World D1). Tool pages: `/<lang>/<course>/glossary/`, `/<lang>/<course>/commands/`, `/<lang>/<course>/commands/<id>/`, `/<lang>/<course>/cheatsheet/`. The Git course keeps its short ones (`/<lang>/glossary/` …).
- `course.yaml`: only flip `status: soon` → `ready` for what you wrote. The outline (order, titles, minutes, xp) is shared by every helper; `src/content/courses/ship-it.test.ts` checks the counts against the plan.

### Frontmatter

Like the Git course, but `tool` + `toolVersion` take the place of `gitVersion`:

```yaml
id: k8s-k1-l04
world: 1                 # the world id number (K1 = 1, D0 = 0), not the code
title: Want 3, See 2
summary: "You will learn: how Kubernetes heals itself."
minutes: 4               # from course.yaml
xp: 20                   # from course.yaml
interactives: [Choice]
needs: [k8s-k1-l03]
tool: kubernetes         # docker | github-actions | kubernetes
toolVersion: "1.37"      # docker: "29" (Engine 29.x, Compose v5) · github-actions: "2026-10"
lastChecked: 2026-10-31
bmReviewed: false
docs:
  - { label: "Kubernetes: controllers", url: "https://kubernetes.io/docs/concepts/architecture/controller/" }
```

The lesson frame shows it quietly under the summary: "Checked with Kubernetes 1.37 on 31 Oct 2026" / "Disemak dengan Kubernetes 1.37 pada 31 Okt 2026". `npm run check:cards` wants `tool` and `toolVersion` in every Ship It lesson, with the same values in `en.mdx` and `ms.mdx`. Kancil wears the course's hat in the lesson frame and on the maps (chef's hat, hard hat, captain's cap).

### Course-level fields in `course.yaml`

| Field | Where | What it does |
| --- | --- | --- |
| `family: ship-it`, `part: 1`, `partName {en, ms}`, `story {en, ms}` | course | Groups the three courses; "Part 1 · Dapur" on maps, home and the switcher |
| `hat: chef \| hardhat \| captain` | course | Kancil's hat in this course |
| `tool`, `toolVersion` | course | Default for lessons that leave them out |
| `placement: docker-d0-l10` | course | Home links "Know some Docker already? Take the placement test." once it is ready |
| `requires: [{ course: git, worlds: [0, 1, 2, 3, 4] }]` | course | A gentle "best after" tip. Never a lock |
| `intro {en, ms}` | course | The map's intro line |
| `code: D1` | world | "World D1" / "Dunia D1" everywhere |
| `finale: true` | world | Career Quest: its own "Finish line" box on the Ship It map |
| `mission: 1` | lesson | Capstone mission tag |
| `name {en, ms}` | badge | Badge name (Git badges use i18n `badge.<id>` instead) |

Badge ids are global (progress keeps one list), so world badges carry the course: `docker-world-1`, `cicd-world-2`, `k8s-world-3`. The skill badges from the plan (§12) sit on the lesson or boss that teaches the skill, e.g. `kek-lapis-master` on `docker-d2-l06`, `self-healer` on `k8s-k1-l04`.

### Glossary, scenarios and the terminal

- `<Term id="container">container</Term>` uses the glossary of the course in the URL (`docker.yaml` in a Docker lesson). For a word from another course, name it: `<Term id="workflow" course="git">workflow</Term>`. Add new words under your world's marker line (`# --- World D1 terms …`). Ids are unique per file.
- `<Interactive … scenario="d1-l03" />` finds the scenario in the URL's course (`src/content/courses/docker/scenarios/index.ts`); pass `course="git"` to use another course's. In code: `findScenario<T>('docker', id)`.
- The terminal's phone key row takes a `keys` prop. The Git keys stay the default; Ship It terminals pass one of `KEY_SETS` (exported from `Terminal.tsx`: `docker`, `compose`, `kubectl`) or their own list. Words and flags get a space after them; punctuation does not.
- Words and commands from ready Ship It lessons join the daily review cards by themselves (their ids get a course prefix, like `docker:registry`).

### Commands and rescue flows

- `commands.yaml`: same shape as the Git one. Each command gets `/<lang>/<course>/commands/<id>/` and a line in that course's cheat sheet. Mark risky commands (`docker system prune`, `kubectl delete`) `careful` or `lose`.
- `rescue.yaml`: same shape as the Git one; `group` is not needed. The Ship It Rescue Center shows one section per part, with the same filter box. Flow ids must be unique across the three files; link one flow with `/<lang>/ship-it/rescue/#<flow-id>`.

### Linking between the courses

- From a Ship It lesson to the Git course, use a normal Markdown link with the lesson's language: `[World 7: Robots](/en/git/#world-7)` in `en.mdx`, `/ms/git/#world-7` in `ms.mdx`. Glossary words can point across with `course="git"` (above).
- From the Git course to Ship It: link the overview (`/en/ship-it/`), a world (`/en/docker/#world-1`) or a ready lesson (`/en/docker/first-containers/port-mapping/`). Link world anchors while a lesson is still "Coming soon": they always exist.
- The Git prerequisites (Worlds 0–4; World 7 before Part 2) live in `requires`, so maps and home show them as a gentle tip. Don't repeat them as a lock anywhere.

### Kitchen engine (Docker)

The Docker lessons run on `src/engine/kitchen-sim/`: a pure TypeScript copy of Docker Engine 29.x and Compose v5 on one laptop (no DOM, no network). It works like the Git engine: `run(state, 'docker ps')` returns `{ state, output, events, ok, explain, stopped?, exitCode?, prompt? }` and never changes the old state. Outputs are the real CLI's, measured on Docker 29.9.2 (`docker images`, `ps`, BuildKit, Compose progress, error messages). `explain` is an i18n key under `sim.docker.explain.*` / `sim.docker.err.*` (the friendly line under the terminal). The fake clock starts at 2026-10-31 01:00 UTC and moves 3 s per command.

**`KitchenSim`**: terminal (Docker key row) + the state picture after every command.

```mdx
<Interactive name="KitchenSim" scenario="d1-nginx"
  goal={{ running: ['web'], reachable: 'localhost:8080', lastTyped: '^curl' }}
  hints={["Type docker run -d --name web -p 8080:80 nginx:1.30-alpine", "Now try curl localhost:8080"]}
  success="Your lunchbox serves the page through hatch 8080." />
```

| Prop | Type | What it does |
| --- | --- | --- |
| `scenario` | id | Starting state (`src/content/courses/docker/scenarios/`) |
| `goal` | `KitchenGoal` | Checked after every command; met → `success` and `data-done="true"` |
| `hints` | `string[]` | Kind "Almost!" box after 2 mistakes; the next hint every 2 more |
| `success` | string | Shown when the goal is met |
| `prefill` | string | Text already typed in the input |
| `intro` | `string[]` | Commands run (and shown) before the learner types |
| `picture` | boolean | The state picture (default `true`) |
| `keys` | `'docker' \| 'compose' \| string[]` | Phone key row (default `'docker'`) |

A command that deletes things (`docker rm -f`, `volume rm`, `rmi -f`, any `prune`, `compose down -v`) gets a red "Careful" note with an icon. A mistake gets the friendly `explain` line, never a red "WRONG".

**`KitchenReplay`**: a transcript that plays line by line (all at once in calm mode), with the picture following each command. No typing.

```mdx
<Interactive name="KitchenReplay" scenario="d2-diary-dockerfile"
  commands={["docker build -t diary:1.0 .", "docker run -d --name diary -p 8080:80 diary:1.0", "curl localhost:8080"]}
  label="The recipe becomes the image diary:1.0" />
```

Props: `commands` (required), `label` (figure caption), `outputOnly` (hide the prompts), `picture` (default `true`), `fails` (commands that are meant to fail, e.g. to show an error; `check:mdx` makes sure they do).

**The state picture.** The laptop is blue, with numbered port hatches (`8080 → web:80`). Containers are lunchboxes: running = green; created, paused and restarting = amber with a dashed edge; exited with code 0 = grey, dotted; exited with another code = red **with an icon** and the code. Images are stacked layers (purple when they only live in the registry). Volumes are lockers, networks are phone lines between boxes. Every box has a screen-reader label; with reduced motion or calm mode it is a plain before/after fade. In code: `kitchenPicture(state)`.

**Goal keys** (all optional; every key must pass):

| Key | Example |
| --- | --- |
| `running`, `created`, `paused`, `healthy`, `notExists` | `['web']` |
| `exited` | `['job']` or `{ job: 0 }` (with exit code) |
| `portMapped` | `{ web: '8080:80' }` (host:container) |
| `reachable` / `unreachable` | `'localhost:8080'` / `['localhost:9090']` (curl from the laptop) |
| `reachableContains` | `{ 'localhost:8080': 'Kedai Kancil' }` |
| `imageExists` / `imageMissing` | `'diary:1.0'` / `['nginx:latest']` |
| `imageMaxSize`, `imageUser`, `layers` | `{ 'diary:1.0': '100MB' }`, `{ 'diary:1.0': 'nonroot' }`, `{ 'diary:1.0': 10 }` |
| `cacheHits`, `maxRebuilt` | numbers, about the last build |
| `volumeExists`, `volumeMissing`, `networkExists` | `['pgdata']` |
| `fileInVolume`, `tableInVolume` | `{ data: 'x' }`, `{ pgdata: 'notes' }` |
| `networkHas` | `{ shopnet: ['web', 'api'] }` |
| `composeUp`, `composeDown` | `'shop'` or `{ project: 'shop', services: ['web'] }`; `'shop'` |
| `containerEnv`, `containerUser`, `readOnly`, `restartPolicy`, `logsContain` | `{ db: ['POSTGRES_PASSWORD'] }`, `{ api: 'nonroot' }`, `['web']`, `{ web: 'unless-stopped' }`, `{ db: 'ready to accept' }` |
| `loggedIn`, `pushed` | `'you'`, `['you/diary:1.0']` |
| `filesExist`, `fileContains`, `fileMode`, `cwd`, `envVar`, `lastExit` | laptop files and shell, e.g. `{ fileMode: { '/home/you/kitchen/cook.sh': 'x' } }`. File paths are relative to `/home/you`, not to the scenario's `cwd`: write them in full |
| `count` | `{ running: 2, containers, images, volumes }` |
| `typed`, `lastTyped` | regex on any typed command / the last one |

`check:mdx` refuses unknown keys and a goal that is already met before the learner starts. Add `lastTyped` when the state alone is met too early.

**Scenarios** live in `src/content/courses/docker/scenarios/` (one file per world, spread into `allScenarios` in `index.ts`; `examples.ts` has five models: `d1-hello`, `d1-nginx`, `d2-diary-dockerfile`, `d3-postgres-volume`, `d4-compose-shop`; `d0.ts` has the D0 laptops: `d0-hello` (fresh, nothing pulled), `d0-rooms` (alpine + nginx pulled), `d0-down` (the daemon is stopped), `d0-linux` (`~/kitchen` with `menu.txt`, a `cook.sh` without the x bit, `recipes/`), `d0-net` (the `shop` container serves `~/shop/site` on hatch 8080: `/` and `/menu.html`; anything else is a real nginx 404)). In a `verify` list, use `curl -sS` for a curl that is meant to fail: a piped curl prints its progress meter on the same line as the error. `d4.ts` has the Kedai Kancil repo of capstone missions 1–2 (`/home/you/kedai-kancil`: `web/` nginx + `api/` Node, each with a Dockerfile, images already built as `kedai-kancil-web` / `-api`): `d4-shop` (web, api, db), `d4-healthy` / `d4-sick-db` (`service_healthy`), `d4-env` (`${DB_PASSWORD:?…}`, no `.env` yet), `d4-profiles`, `d4-override` (+ `compose.override.yaml`, `compose.prod.yaml`), `d4-scale`, `d4-version`, `d4-boss` (four services, two networks), `d4-mission` (not built).

```ts
{
  id: 'd3-postgres-volume',
  cwd: '/home/you/shop',            // default /home/you
  images: ['postgres:18-alpine'],    // already pulled (catalog images only)
  steps: [
    'mkdir -p /home/you/shop',       // a command typed in the terminal (must succeed)
    { write: 'init.sql', content: 'create table notes (id int);\n' },  // a laptop file
    { write: 'run.sh', content: 'echo hi\n', mode: '755' },
    { delete: 'old.txt' },
    { wait: 10 },                    // seconds on the fake clock (health checks, sleep)
  ],
  verify: [['docker run -d --name db -e POSTGRES_PASSWORD=x -v pgdata:/var/lib/postgresql postgres:18-alpine', 'sleep 10', 'docker exec db psql -U postgres -c "select 1"']],
  settle: 2,                         // seconds to wait on the real daemon after each verify command
}
```

Engine-only steps (the truth check skips scenarios that use them): `{ busyPort: 8080 }` (another program holds the port), `{ account: { user, token, password? } }` (a Docker Hub account), `{ remoteImage: { ref: 'aisyah/shop-api:1.0', from: 'node:24-alpine', platform?, private? } }` (someone else's pushed image), `{ flag: 'rateLimited' | 'dockerDown' | 'ipv6' }`.

**Images in the freezer** (the catalog, measured from the real images): `hello-world:latest`, `alpine:3.22`, `busybox:1.37`, `nginx:1.30-alpine`, `nginx:latest`, `node:24-alpine`, `python:3.13-slim`, `postgres:18-alpine`, `redis:8-alpine`. Any other official image gets a kind "not stocked in the practice kitchen" note; an unknown tag gets Docker's real `not found`; a repo that doesn't exist gets `pull access denied`.

**What runs.** `docker run create start stop restart kill pause unpause rm ps logs exec port top stats cp wait rename images pull push tag rmi history login logout inspect build volume network system (df, info, prune) version info`, the `container` / `image` / `builder` management forms, `--format` Go templates, and `docker compose up down ps logs exec config build pull restart stop start rm run ls` (with `.env`, interpolation, profiles, `depends_on` health conditions). Inside containers: a small `sh` (BusyBox or dash, by image), `psql`, `redis-cli`, `node`, `npm ci/install`, `npm start`, `npm test`, `npm run <script>`, `node --test` (no test files: the empty summary; with test files: a plain "can't run here" line), `python -m http.server`, `wget`/`curl` (by name on user networks), `tar` (`c`/`x`/`t` with `z`, `v`, `f <file>`, `-C <dir>`, BusyBox words on Alpine, GNU words on Debian: back up a volume into `"$PWD"` and restore it, World D3). The laptop shell: `pwd cd ls cat mkdir touch rm cp echo env printenv export unset chmod whoami id hostname uname date ps sleep which clear help curl ping`, redirects (`>`, `>>`), `$VAR`, `$?`, `$PWD`. One command per line; a pipe works only into a filter (`grep`, `head`, `tail`, `wc`, `sort`) or `docker login --password-stdin`. Explain-only (a friendly line, no state change): `DOCKER_EXPLAIN_ONLY` (`attach commit diff export save load search swarm init scout …`) and `docker compose watch / push / scale …`. `docker system prune`, `container prune` and friends ask `[y/N]` like the real CLI; the next line answers.

**Dockerfile builds (World D2).** `docker build` / `docker buildx build` run every instruction (multi-stage, `--target`, `ARG` before `FROM`, `--build-arg`, `--label`, `HEALTHCHECK`, `USER`). Step names fill in `ARG`/`ENV` values like BuildKit (`RUN echo "Menu for pasar"`). `RUN --mount=type=cache,target=…` and `RUN --mount=type=secret,id=…[,env=…][,required=true]` work with `--secret id=…,src=file`: the secret exists only during that step, never in `docker history`, and doesn't bust the cache; a missing required secret gives BuildKit's `secret <id>: not found`. Any `--mount` makes BuildKit call an unnamed stage `stage-0` (as Docker 29 prints it). Non-root nginx (`USER nginx`) stops with the real `mkdir() "/var/cache/nginx/client_temp" … Permission denied` (then `open() "/run/nginx.pid"`) until the user owns those; port 80 works for non-root users in Docker. `apk add` as a normal user fails with that Alpine version's real message. Not modelled: a real multi-platform build (`--platform a,b`) or `docker images --tree`; teach them with `Transcript` (World D2 lesson 13 has real output). Folder names in a scenario must differ from image names (the truth check renames image names in commands). World D2 scenarios (`scenarios/d2.ts`): `d2-l01` (hello.js on node), `d2-l02` and `d2-l06` (the Kedai API with package files), `d2-l03` (images `say`, `greet`; folders `sayer`, `greeter`, `shouter`), `d2-l04` (ARG/ENV menu), `d2-l05` and `d2-l07` (the diary on nginx), `d2-l08` (two-stage `kedai` site), `d2-l09` (`ARG BASE` before `FROM`), `d2-l10` (non-root; `oops/`), `d2-l11` (health checks; `broken/`), `d2-l12` (secret and cache mounts; `leak/`, `cache/`), `d2-l13`, `d2-boss-pack`, `d2-boss-nonroot`.

**Real faults you can set up** (outputs match Docker 29): port taken (`busyPort` or another container), missing tag, Hub rate limit (`flag: 'rateLimited'`), daemon down (`flag: 'dockerDown'`), Postgres 18 with the old `/var/lib/postgresql/data` mount (exits 1 with the real message), Postgres crash recovery after `docker rm -f`, a non-root user writing to a fresh volume, a missing `npm ci` (`Cannot find module 'express'`), Python's buffered stdout (no log line without `-u` / `PYTHONUNBUFFERED=1`), an arm64 image on this amd64 laptop (`exec format error`), container names not resolving on the default bridge, BuildKit errors with the Dockerfile arrows, build-check warnings (`JSONArgsRecommended`, `SecretsUsedInArgOrEnv`), `--env-file` mistakes (a space around `=`: `variable 'NAME ' contains whitespaces`; quotes stay in the value; a bare `NAME` takes the laptop's exported value or is left out), and `--network none` (`ping: sendto: Network unreachable`). Digests (D5): in `name:tag@sha256:…` the digest wins and the tag is ignored; a digest the registry doesn't have is `not found`. Least privilege (D5): `--read-only`, `--cap-drop ALL` and `--user` work in any container (`Read-only file system`, `Operation not permitted`); nginx run as root stops with its real `[emerg]` line under `--read-only` (it needs `--tmpfs /var/cache/nginx --tmpfs /run`) or `--cap-drop ALL` (chown).

**Events** (for animations): `imagePulled`, `imageBuilt`, `imageTagged`, `imageRemoved`, `imagePushed`, `layerBuilt`, `layerCached`, `containerCreated`, `containerStarted`, `containerExited`, `containerPaused`, `containerUnpaused`, `containerRemoved`, `portMapped`, `volumeCreated` / `Removed`, `networkCreated` / `Removed` / `Connected` / `Disconnected`, `composeUp`, `composeDown`, `requestServed`, `loggedIn`, `loggedOut`, `fileWritten`, `cwdChanged`, `error`.

**Engine helpers** (import from `~/engine/kitchen-sim`): `run`, `runAll`, `buildKitchenScenario`, `kitchenStart` / `kitchenStep`, `checkKitchenGoal(state, goal, typed?) → { ok, failed }`, `kitchenPicture`, `findContainer`, `findImage`, `parseDockerfile`, `loadProject` (compose), `containerJson` / `imageJson` (inspect), `statusText`, `portsText`, `CATALOG`, `DOCKER_COMMANDS`, `HOST_COMMANDS`, `plain` (output → text).

**Truth check: `npm run verify:docker`.** Every scenario's `verify` lists run in the engine and on a real Docker daemon (CI job `docker-truth`, which must pass before `deploy`). It compares containers (name, state, exit code), ports, images, volumes, networks, files in volumes and the outputs of `ps`, `images`, `logs`, `curl`, `exec` and errors (ids, times, sizes and IPs masked). So that it can share a daemon safely:

- Everything gets the prefix `fl-vd-` and a label, host ports move up by 20000, and it all is removed before and after each list. Prune commands only run in the engine.
- Name containers, volumes, networks and images with at least 2 characters, and never like an official image (`--name nginx` is refused: use `web`).
- A real container needs real time: put `sleep 10` in a verify list before you talk to Postgres, and raise `settle` for health checks. (`sleep` moves the engine clock the same way.)
- `VERIFY_ONLY=d3 npm run verify:docker` checks only scenarios whose id starts with `d3`. A Docker Hub 429 is shown as "not compared", not as a failure.
- Several runs on one shared daemon: run it under a lock (`flock <lock file> npm run verify:docker`), or give each run its own `VERIFY_DOCKER_PREFIX=fl-xx-` (names and label) and `VERIFY_DOCKER_PORT_OFFSET=31000`.

**Under the hood (D6).** One process, two views: `docker top`, `ps aux` on the laptop and `docker inspect -f '{{.State.Pid}}'` show the same laptop PIDs (the `containerd-shim-runc-v2` line is the parent; nginx workers show as uid `101`), while `docker exec web ps` shows PID 1. `uname -r` prints the same kernel inside and out. `--memory`, `--cpus` and `--pids-limit` are kept: `inspect` shows `HostConfig.Memory` / `MemorySwap` / `NanoCpus` / `PidsLimit`, `docker stats` shows the memory cap as LIMIT, and bad values get Docker 29's errors (`Minimum memory limit allowed is 6MB`, `range of CPUs is from 0.01 to 4.00 …`). `docker info` lists the runtimes (`Default Runtime: runc`, containerd and runc versions) and Security Options. Not modelled: OOM kills, `docker diff` (explain-only: teach it with a real Transcript), `/proc` and cgroup files. Scenarios: `scenarios/d6.ts` (`d6-web`, `d6-limits`, `d6-two-boxes`, `d6-rescue`, which checks the Docker rescue flows' commands).

### Ship It: Kubernetes games

Six standalone games for Part 3 (PLAN §10). Each has its own pure logic in `src/lib/` (Vitest-tested) and does not need the food-court simulator. All real-looking output was checked against kubectl, kube-apiserver and kube-scheduler **v1.37.2**, Gateway API **v1.6.1** and the Argo CD docs. All six are on the hidden test page `/en/dev/interactives/` (props in `src/lib/k8sDemos.ts`, tests in `tests/e2e/k8s-games.spec.ts`), and `npm run check:mdx` checks their props (task possible, not already done). Text props are in the file's language; UI words come from i18n (`k8sDoctor.*`, `k8sSched.*`, `k8sLabels.*`, `k8sTrace.*`, `k8sRbac.*`, `k8sGitops.*`, `k8sGame.*`). Every drag has a tap alternative; calm mode and reduced motion show results at once.

**YamlDoctor** (K1–K4): fix a broken manifest in a small editor (line numbers, indent guides, the problem line marked red with ⚠, "Add a space" / "Remove a space" buttons for phones) until `kubectl apply` turns green. The output is what kubectl 1.37 prints, word for word (go-yaml errors with go-yaml's line numbers, `error validating data`, `resource mapping not found … ensure CRDs are installed first`, `strict decoding error: unknown field …`, `json: cannot unmarshal …`, `The Deployment "shop" is invalid: …`), then one plain line (rule 19).
```mdx
<Interactive name="YamlDoctor" file="shop.yaml" manifest={'apiVersion: extensions/v1beta1\nkind: Deployment\n…'}
  solution={'apiVersion: apps/v1\nkind: Deployment\n…'} keep={['replicas: 3']} hint="Deployments live in apps/v1 now." />
```
- `manifest` (required): the broken YAML, ~15 lines max (rule 18). `file`: name in `kubectl apply -f <file>` (default `manifest.yaml`).
- `keep`: regexes (multiline) that must still match when it applies, so deleting the broken part isn't a fix (`keepHint` is the kind message). `hint`: shown on Hint (`fl:hint`). `namespaces`: namespaces that exist besides `default` and `kube-*` (a Namespace earlier in the same file counts). `solution`: the fixed YAML, never shown; `check:mdx` makes sure it applies and matches `keep`. `prompt`, `success`.
- The checker is `kubectlApply(text, file, { namespaces })` in `src/lib/k8sSchema.ts`: built-in kinds (Pod, Deployment, ReplicaSet, StatefulSet, DaemonSet, Service, ConfigMap, Secret, Job, CronJob, HPA v2, NetworkPolicy, Ingress, PDB, PVC, PV, StorageClass, Namespace, ServiceAccount, ResourceQuota, LimitRange, RBAC) and Gateway API (Gateway, GatewayClass, HTTPRoute, ReferenceGrant). Single errors match kubectl exactly (126 real outputs in `src/lib/__fixtures__/kubectl-1.37.2.json`); several errors in one file are close, not exact.
- Ready-made broken manifests with their fixes and real output: `src/lib/k8sFixtures.ts` (`fixture('typo')` …): `tab`, `indent`, `colon-space`, `old-api`, `typo`, `selector`, `missing-image`, `string-int`, `service-protocol`, `yes-bool`, `secret-base64`, `role-verbs`, `cron`, `hpa-max`, `route-path`.
- The schema is generated: `scripts/gen-k8s-schema/` (see its header for the inputs and how to refresh it for Kubernetes 1.38).

**SchedulerTetris** (K2, K5): fit trays (pods) onto stalls (nodes). Requests are block sizes, allocatable is shelf space; taints are locks 🔒, tolerations are keys 🔑, `nodeSelector` / required node affinity are signs. Tap a tray, then "Put … on stall-b" (or drag). A wrong stall bounces with the reason in plain words plus the scheduler's own reason (`Insufficient memory`, `node(s) had untolerated taint(s)` …). "Ask the scheduler" shows the real FailedScheduling message, e.g. `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient memory. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.` (kube-scheduler 1.37 says `untolerated taint(s)`, without the taint itself).
```mdx
<Interactive name="SchedulerTetris"
  nodes={[{ name: 'stall-a', cpu: '2', memory: '4Gi', labels: { zone: 'front' } },
    { name: 'stall-c', cpu: '4', memory: '8Gi', labels: { gpu: 'yes' }, taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' }] }]}
  pods={[{ name: 'tray-1', cpu: '1500m', memory: '1Gi' }, { name: 'gpu-job', cpu: '2', memory: '4Gi', nodeSelector: { gpu: 'yes' } },
    { name: 'giant', cpu: '8', memory: '2Gi' }]}
  keys={[{ key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' }]}
  task={{ type: 'placeAll', pending: ['giant'] }} />
```
- `nodes`: `{ name, cpu, memory, labels?, taints?: { key, value?, effect }[], unschedulable? }[]` (allocatable). `pods`: `{ name, cpu, memory, tolerations?, nodeSelector?, affinity?: { key, operator: 'In'|'NotIn'|'Exists'|'DoesNotExist', values? }[], node? }[]` (requests; `node` = starts there).
- `keys`: tolerations the learner can hand to trays (tap a key, then a tray). `task` (default `{ type: 'placeAll' }`): done when every tray is on a stall it fits, and the ones in `pending` (if given) sit in Pending because they fit nowhere. `prompt`, `success`.

**LabelMatchmaker** (K1, K3): stick labels on trays; the Service (order number) lights up every tray its selector matches, and the real `kubectl get endpointslices -l kubernetes.io/service-name=shop` table updates (`<unset>` plus a red ⚠ "no endpoints" when nothing matches). Template mode: give a Deployment's pod template labels that match its selector; Apply shows the real `` `selector` does not match template `labels` `` error until they do.
```mdx
<Interactive name="LabelMatchmaker" pods={[{ name: 'tray-1', labels: { app: 'shop' } }, { name: 'tray-2', labels: { app: 'shop', tier: 'web' } }]}
  labels={['tier=web', 'app=api']} selector={{ app: 'shop', tier: 'web' }} task={{ type: 'select', pods: ['tray-1', 'tray-2'] }} />
<Interactive name="LabelMatchmaker" pods={[]} labels={['app=shop']} selector={{ app: 'shop' }} templateLabels={{ app: 'web' }} task={{ type: 'template' }} />
```
- `pods`, `labels` (chips `key=value`; one value per key, so `app=web` replaces `app=shop`), `selector`, `task`: `{ type: 'select', pods }` (the Service must pick exactly these) or `{ type: 'template' }`. `service` (name, default `shop`), `port` (default 80), `templateLabels`, `prompt`, `success`.

**RequestTracer** (K3): one request, hop by hop: browser → Gateway (listener) → HTTPRoute (path) → Service (port → targetPort) → EndpointSlice → Pod. Send plays it once (~2 s); Step goes one hop at a time. Break toggles change one hop; the user's terminal shows the answer (`HTTP/1.1 404 Not Found`, `500` for a missing backend Service, `503` for no ready endpoints, curl 8.x's `Couldn't connect to server` for a closed port, `Operation timed out` when a NetworkPolicy drops packets) next to what Kubernetes shows (EndpointSlices, pods, the route's `BackendNotFound`), plus a plain line. Outcomes follow the Gateway API v1.6 spec where it sets them (404, 500, 503).
```mdx
<Interactive name="RequestTracer" breaks={['path', 'targetPort', 'ready', 'policy']} task={{ type: 'outcome', want: '503' }}
  route={{ host: 'kedai.example', gateway: { name: 'entrance', port: 80 },
    route: { name: 'shop', rules: [{ path: '/api', service: 'api', port: 80 }] },
    services: [{ name: 'api', port: 80, targetPort: 3000, selector: { app: 'api' } }],
    pods: [{ name: 'api-1', labels: { app: 'api' }, containerPort: 3000 }], request: { path: '/api/menu' } }} />
```
- `route` (required): `{ host?, gateway: { name, port }, route: { name, rules: { path, type?: 'PathPrefix'|'Exact', service, port }[] }, services: { name, port, targetPort, selector }[], pods: { name, labels, ready?, containerPort }[], policy?: { name, allowGateway }, request: { path, port? } }`. It must work (200) before any break.
- `breaks`: toggles the learner may use: `path` (ask for /menu), `listener` (port 8080), `serviceName` (typo in the backendRef), `selector`, `targetPort` (9090), `ready` (pods not ready), `policy` (deny NetworkPolicy). `broken`: breaks on at the start.
- `task`: `{ type: 'trace' }` (default: send one request), `{ type: 'deliver' }` (undo `broken` until 200 OK), `{ type: 'outcome', want: '404'|'500'|'503'|'refused'|'timeout' }`. Note: with a catch-all `/` rule, `path` still reaches a pod.

**RbacSwitchboard** (K6): wire people and ServiceAccounts (plugs) to Roles / ClusterRoles (sockets) with bindings (wires, made with three plain selects: who, role, where). The can-i list shows `kubectl auth can-i … --as=…` and yes/no exactly as Kubernetes RBAC decides it (only adds rights; RoleBindings count only in their namespace; `*`; subresources like `pods/log`; the warnings for cluster-wide resources, unknown resources and verbs). "Ask your own question" is folded.
```mdx
<Interactive name="RbacSwitchboard"
  subjects={[{ kind: 'ServiceAccount', name: 'ci-bot', namespace: 'ci' }, { kind: 'User', name: 'mei' }]}
  roles={[{ kind: 'Role', name: 'deployer', namespace: 'shop', rules: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'patch'] }] },
    { kind: 'ClusterRole', name: 'everything', rules: [{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }] }]}
  bindings={[{ kind: 'ClusterRoleBinding', name: 'ci-bot-everything', roleRef: { kind: 'ClusterRole', name: 'everything' }, subjects: [{ kind: 'ServiceAccount', name: 'ci-bot', namespace: 'ci' }] }]}
  questions={[{ as: 'ServiceAccount:ci:ci-bot', verb: 'patch', resource: 'deployments', namespace: 'shop', expect: true },
    { as: 'ServiceAccount:ci:ci-bot', verb: 'get', resource: 'secrets', namespace: 'shop', expect: false }]} />
```
- `subjects`, `roles` (`{ kind, name, namespace? (Roles), rules: { apiGroups, resources, verbs, resourceNames? }[] }`), `bindings` (start wires: `{ kind, name, namespace? (RoleBindings), roleRef: { kind, name }, subjects }`), `questions` (`{ as: 'ServiceAccount:ns:name' | 'User:name', verb, resource, namespace? ('*' = -A), expect? }`).
- `task`: `{ type: 'wire' }` (default: done when every question gets its `expect`) or `{ type: 'predict' }` (Yes/No per question). `namespaces` (scopes for new RoleBindings), `prompt`, `success`. A Role can only be wired in its own namespace (kind feedback).

**GitOpsMirror** (K7): Git on the left (the Deployment file; change `replicas` with − / + or pick an `image`, then Commit), the cluster on the right with Argo CD's Sync (Synced / OutOfSync / Syncing) and Health (Healthy / Progressing). A "manual change" button runs a `kubectl scale` (danger badge): with self-heal on it snaps back after the 5-second self-heal wait; with it off it stays OutOfSync until Sync. The clock plays steps (~0.6 s each), or Pause and Step through them; the log says what happened.
```mdx
<Interactive name="GitOpsMirror" app={{ name: 'shop', namespace: 'shop', replicas: 3, image: 'ghcr.io/kedai-kancil/shop:1.4.0' }}
  task={{ type: 'gitChange', field: 'replicas', to: 5 }} />
<Interactive name="GitOpsMirror" app={{ name: 'shop', replicas: 3, image: 'ghcr.io/kedai-kancil/shop:1.4.0' }} selfHeal={false} task={{ type: 'drift' }} />
```
- `app` (required): `{ name, namespace?, deployment?, replicas, image, repo?, path? }`. `selfHeal` (default true). `images`: tags to pick from (default: `app.image` and the next minor). `drift`: the manual change (default `{ replicas: 1 }`).
- `task`: `{ type: 'gitChange', field: 'replicas' | 'image', to }` (done when Git and the cluster both have it, Synced and Healthy) or `{ type: 'drift' }` (a manual change, then undone by self-heal or Sync).

`npm run verify:manifests` runs the official kubeconform image (pinned, Kubernetes 1.37.2 schemas, `-strict`; Gateway API and Argo CD schemas from the CRDs catalog) over every fixed fixture, every schema-level broken fixture (must be rejected), and the YAML the demos show. It needs Docker and runs in CI before deploy.

These games are separate from the food-court engine below: they don't need a scenario, and they can sit next to `KubeSim` / `KubeReplay` cards in the same lesson.

## Food-court engine (Kubernetes)

`src/engine/foodcourt-sim/` is a pure TypeScript Kubernetes 1.37 cluster: an object store with real `apiVersion`/`kind`/`metadata`/`spec`/`status` and the server defaults `kubectl apply` really gets, controllers (Deployment with RollingUpdate/Recreate and revisions, ReplicaSet, DaemonSet, StatefulSet, Job, CronJob, HPA, EndpointSlice, namespace deletion, garbage collection), a scheduler (requests vs allocatable, nodeSelector, node affinity, taints/tolerations, hostname anti-affinity and topology spread, real `FailedScheduling` messages), kubelets (image pulls, `ErrImagePull`/`ImagePullBackOff`, `CrashLoopBackOff` with 10 s → 5 min back-off, `OOMKilled`, liveness/readiness/startup probes), Services and cluster DNS, NodePort, LoadBalancer, port-forward, Gateway API (an Envoy Gateway–like controller, GatewayClass `eg`), NetworkPolicy, RBAC (`auth can-i`, `--as`) and Pod Security admission. Time runs on a pausable clock. Tables, YAML, errors and events were checked against a real kube-apiserver / kube-scheduler v1.37.2 and kubectl v1.37.2. Every command returns `{ state, output, events, explain }` like the Git engine.

Food story: a cluster is the food court, a node a **stall**, a pod a **tray**, a Deployment the manager's **order**, a Service an **order number**, a Gateway the **entrance**.

### The clusters

A scenario starts with one kind cluster, context `kind-dev` (nodes `dev-control-plane` (tainted), `dev-worker`, `dev-worker2`; 4 CPU / 8Gi each; `kube-system` pods, the `standard` StorageClass, CoreDNS). Add `{ name: 'prod-like' }` for a managed-looking second cluster (3 nodes, metrics-server, LoadBalancer addresses) to teach the wrong-cluster danger. Options per cluster: `metricsServer`, `gateway`, `loadBalancer`, `namespace` (the context's namespace), `nodes` (custom `{ name, role?, cpu?, memory?, labels?, taints? }`).

Images that exist (anything else fails to pull, like a typo): `nginx` (1.24–1.30, alpine…; serves the real welcome page, or files mounted at `/usr/share/nginx/html`), `busybox` and `alpine` (a small shell: `echo`, `sleep`, `exit`, `touch`, `rm`, `cat`, `env`, `date`, `httpd -p`, `while true; do …; done`, `tail /dev/zero` = memory leak), `postgres` (exits without `POSTGRES_PASSWORD`, like the real one), `redis`, `hashicorp/http-echo` (`-text=…`, `-listen=:8080`), `polinux/stress`, `registry.k8s.io/pause`.

### Scenarios

```ts
// src/content/courses/kubernetes/scenarios/k1.ts (list it in scenarios/index.ts)
{
  id: 'k1-want3',
  files: { 'shop.yaml': SHOP_YAML },          // the learner's folder: /home/you/shop
  steps: ['kubectl apply -f shop.yaml'],       // then the cluster settles (settle: false to skip)
  verify: [['kubectl delete pod {pod:app=shop}', 'kubectl get deployment shop']],
}
```
- `clusters`, `context`, `dir`, `files`, `steps`, `settle`, `verify`, `engineOnly` (a reason). Steps: a command (must work), `{ try: cmd }` (may fail), `{ tick: 30 }`, `{ settle: true }`, `{ write, content }`, `{ fault: … }`.
- `{pod:app=shop}` in a command (verify lists, KubeReplay, ManagersBoard actions) means "the first pod matching `app=shop`": real pod names are random.
- `npm run verify:k8s` runs every verify list in the engine, and in CI on a real kind cluster (Kubernetes 1.37, `kind-dev`), then compares objects (generated suffixes masked), Deployment/ReplicaSet counts and revisions, pod statuses and restart buckets, Service endpoint counts, event reasons and each command's output (ages and IPs masked). After every command both sides settle. Pick lists that end in a steady state. Scenarios that need Gateway API, metrics-server or a second cluster set `engineOnly` and only run in the engine. `VERIFY_ONLY=k2 npm run verify:k8s` runs some; `VERIFY_SHOW=1` prints the engine's outputs.
- Model scenarios to reuse: `k1-empty`, `k1-first-pod`, `k1-want3`, `k2-rolling`, `k2-crashloop`, `k2-badimage`, `k2-oomkilled`, `k3-service`, `k3-gateway`, `k4-configmap`, `k5-pending`, `k5-cordon`, `k5-hpa`, `k6-rbac`, `k6-pod-security`, `k1-two-clusters` (`scenarios/model.ts`).

### The terminal

`kubectl` (alias `k`): `get` (`-o wide|yaml|json|name|jsonpath=…|custom-columns=…`, `-l`, `-n`, `-A`, `--show-labels`, `--sort-by`, `--field-selector`, `-w` as a short scripted watch), `describe`, `apply -f|-k`, `create` (namespace, deployment, configmap, secret generic, job, cronjob, service clusterip|nodeport|loadbalancer, serviceaccount, role, rolebinding, clusterrole, clusterrolebinding, quota, pdb), `delete` (waits like kubectl), `scale`, `set image|env|resources`, `patch`, `replace`, `rollout status|history|undo|restart|pause|resume`, `logs` (`-c`, `--previous`, `--tail`, `-f` for 20 s), `exec … -- cmd` (curl, wget, cat, ls, env, nslookup …; interactive shells get a kind note), `port-forward`, `expose`, `run`, `label`, `annotate`, `explain` (a few real fields), `config get-contexts|current-context|use-context|set-context --current --namespace|view`, `auth can-i` (`--as`, `--list`) and `auth whoami`, `top` (with metrics-server), `cordon`, `uncordon`, `drain`, `taint`, `diff`, `debug`, `kustomize`, `wait`, `autoscale`, `events`, `version`, `cluster-info`, `api-resources`, `--dry-run=client|server`. Also `ls`, `cat`, `cd`, `pwd`, `curl` (from the laptop: port-forwards, Gateway / LoadBalancer / NodePort addresses), `sleep N` (N simulated seconds pass), `clear`.
- `kubectl edit`, `attach`, `cp`, `proxy`, `kind …`: explain-only (a kind note, no fake output).
- Notes and lockers (World K4, `scenarios/k4.ts`): `printenv` / `env` inside a container show the variables it **started** with (`env`, `envFrom`, `configMapKeyRef`, `secretKeyRef`), so a changed ConfigMap reaches env vars only after a restart (`kubectl rollout restart`). Mounted ConfigMap / Secret files follow the object at once here; a real kubelet takes up to a minute or two, so show a `sleep 120` before reading them. `kubectl exec … -- touch FILE` and `sh -c 'echo text >> FILE'` (or `>`) write files: on an `emptyDir` they are shared by the pod's containers and go with the pod; on a PVC they stay with the claim (a new pod on the same claim, or a StatefulSet pod on its `data-<name>-N` claim, reads them; deleting the claim forgets them); anywhere else they go when the container restarts. ConfigMap / Secret mounts are read-only. `ls` prints one name per line (no tty, like busybox).
- **Helm 4**: `helm template <release> ./kedai [--set replicaCount=3,image.tag=…]` renders the built-in practice chart (a Deployment and a Service). `install`, `upgrade`, `rollback`, `list`, `uninstall` are explain-only (their output depends on the Helm 4 build): show them with `Transcript` using output you checked.

### Interactives

**FoodCourtSim** (also `KubeSim`): the practice terminal (kubectl key row), the food-court picture (rule 16: stalls, trays green/amber/red + icon, order numbers, entrance), the pink "you are here" bar on top, and a slow clock (Play/Pause, +1 s, +30 s; it rests when nothing changes). Reduced motion / calm: no movement, the picture just changes.
```mdx
<Interactive name="FoodCourtSim" scenario="k1-want3" board="shop" faults={['deletePod']}
  goal={{ replicas: { name: 'shop', count: 5 }, podsReady: { selector: 'app=shop', count: 5 } }}
  hints={['Type kubectl scale deployment shop --replicas=5']} success="Want 5, see 5." />
```
- `goal` (all optional, all must pass): `podsReady` `{ selector, count, exact?, namespace? }`, `deploymentImage` `{ name, image, container? }`, `replicas` `{ name, count, kind? }`, `rolloutComplete` `{ name, revision?, minRevision? }`, `serviceEndpoints` `{ name, count? | min? }`, `reachable` `{ url, from? (pod name or selector; default the laptop), status?, contains?, host? }`, `unreachable` `{ url, from? }`, `contextIs`, `namespaceIs`, `objectExists` / `objectMissing` (`'deployment/shop'`, `'food/configmap/menu'` or `{ kind, name, namespace }`), `canI` (`[{ verb, resource, as?, namespace?, allowed }]`), `restarts` `{ selector, min }`, `podStatus` / `noPodStatus` `{ selector, status }` (kubectl's STATUS text, e.g. `CrashLoopBackOff`), `hpaReplicas` `{ name, min }`, `nodeCordoned` `{ name, cordoned }`, `labels` `{ kind, name, labels }`, `podSecurity` `{ namespace, level }`, `portForward` (local port), `typed`, `lastTyped` (regex).
- `faults`: buttons the card allows: `deletePod` (trays become delete buttons), `killNode` (stalls get Close/Open), `badImage`, `memoryLeak`, `readinessFail`, `crash`, `traffic`. All carry a red danger badge.
- `board`: show the Manager's board for that Deployment. `intro`, `prefill`, `hints`, `success` like Sim. `namespace` (`'all'` for every namespace), `showSystem`, `paused`, `picture={false}`, `keys`.
- A command like `kubectl delete …` or `drain` shows a red danger note under the terminal (stronger on a production-like cluster).

**ManagersBoard**: Want / See / Do, drawn from the engine's reconcile events ("Want 3. See 2. Make 1 more."), with a small picture and action buttons.
```mdx
<Interactive name="ManagersBoard" scenario="k1-want3" target="shop"
  actions={['deletePod', { cmd: 'kubectl scale deployment shop --replicas=5', label: 'Order 5 trays' }]}
  goal={{ healed: 1 }} label="Want 3, see 3. Delete a pod: see 2, make 1 more." />
```
- `actions`: `deletePod`, `killNode`, or `{ cmd, label }`. `goal`: `healed` (replacements made), `want` (the order's count); done when also every wanted tray is ready.
- `target` is a Deployment by default; `kind="ReplicaSet"` (or `StatefulSet`) puts that object on the board instead (`deletePod` then deletes one of its pods).

**KubeReplay**: a transcript made by the engine, with the picture after each command. Plays once; Replay; calm mode shows it all.
```mdx
<Interactive name="KubeReplay" scenario="k2-crashloop" commands={['kubectl get pods', 'kubectl logs {pod:app=oops} --previous']}
  label="The oops pod keeps crashing. Its last run printed: oh no, no gas." />
```
- `picture={false}` hides the picture; `outputOnly`; `fails` (commands meant to fail); `namespace`.

**YouAreHere**: the pink bar on its own (`context`, `namespace`, `cluster?`, `prodLike?`). `import YouAreHere from '~/components/interactives/YouAreHere'` for other components.

`npm run check:mdx` checks these: the scenario exists in the Kubernetes course, demo/intro commands work, goal keys exist and the goal isn't met at the start. They're on the hidden page `/en/dev/interactives/` (`tests/e2e/foodcourt.spec.ts`).

### Engine helpers

Import from `~/engine/foodcourt-sim`: `run`, `runAll`, `tick(state, seconds)`, `settle(state)`, `injectFault(state, fault)`, `checkGoal`, `buildScenario` / `buildScenarioCached`, `picture(state, { namespace?, showSystem? })` (stalls, trays, waiting trays, order numbers, entrances), `board(state, { name? })` (want/see/ready/doing), `boardEvents(events)`, `whereAmI(state)` (context, namespace, `prodLike`). Events: `podCreated`, `podScheduled`, `podFailedScheduling`, `podStarted`, `podReady`, `podCrashed`, `podRestarted`, `imagePullFailed`, `podDeleted`, `podGone`, `podReplaced` (old → new name), `reconcile` (`want`, `see`, `do`, `count`), `scaled`, `rolloutStep`, `rolloutComplete`, `nodeDown`, `nodeNotReady`, `nodeUp`, `podEvicted`, `requestRouted` (hops), `forbidden`, `admissionDenied`, `contextSwitched`, `namespaceSwitched`, `portForward`.

Where the story (and the sim) breaks: time is sped up (a node goes NotReady after 50 s and its pods move 5 minutes later, as in real Kubernetes, but the clock skips); the scheduler places pods by simple scores (real tie-breaks are random); Services take turns between pods (kube-proxy picks at random).

### K9 node shell (CKA pack)

World K9 goes under the stalls. `ssh dev-worker` (how the exam does it) or `docker exec -it dev-worker bash` (how kind users do it; kind nodes have no SSH server, so `ssh` prints a grey note) opens a shell **inside a node**. The prompt becomes `root@dev-worker:/#` (purple, plus an "inside node" note above the terminal); `exit` goes back to the laptop (`logout` / `Connection to … closed.` after ssh). `docker exec dev-worker crictl ps` runs one command without a shell. Code: `src/engine/foodcourt-sim/node/` (`os.ts` the machine, `shell.ts` the commands, `etcd.ts` etcdctl/etcdutl, `fixtures.ts` the recorded outputs).

**Commands inside a node** (everything else prints bash's real `bash: X: command not found`, exit 127):
- `systemctl status|start|stop|restart|is-active|is-enabled|enable|daemon-reload kubelet` (`containerd` answers `is-active`). Stop/start/restart print nothing, like systemctl. Unknown units: `Unit nginx.service could not be found.` (exit 4).
- `journalctl -u kubelet [-n N] [--no-pager] [-f]`: the kubelet's own start and stop lines (klog format), newest last. A stop writes, in kind's order, the kubelet's shutdown lines, then systemd's `Stopping kubelet.service …`, `kubelet.service: Deactivated successfully.` and `Stopped kubelet.service …`. Other units: `-- No entries --`.
- `crictl ps [-a] [--name RE] [-q]`, `crictl pods [--name RE]`, `crictl logs [--tail N] ID` (an ID prefix from `crictl ps -a`), `crictl images`. crictl talks to containerd, so it still works when the kubelet is stopped.
- Files: `ls [-l]`, `cat`, `head`/`tail -n N`, `grep`, `sed [-i] 's/old/new/[g]' FILE` (and `/re/d`), `mv`, `cp [-r]`, `rm [-r]`, `mkdir -p`, `cd`, `pwd`, `echo`, `export`, `hostname`. One pipe stage after a command: `| grep`, `| head`, `| tail`, `| wc -l`.
- `kubeadm certs check-expiration` (each row ends with the spaces kubeadm's tabwriter adds, as recorded), `kubeadm certs renew all|NAME`, `kubeadm version -o short` (control-plane node only). `kubeadm upgrade plan|apply` only explains: the capture holds a real `upgrade plan` (`kubeadm-upgrade-plan`), but its versions depend on the patch releases out that day.
- `kubectl` inside a node works like on kind. kind starts **control-plane** node containers with `KUBECONFIG=/etc/kubernetes/admin.conf` (kind v0.33.0, `runArgsForNode` in `pkg/cluster/internal/providers/docker/provision.go`; the node image itself sets none), so a shell there has it (`echo $KUBECONFIG`) and `kubectl get nodes` works as the cluster admin, straight to `dev-control-plane:6443` (kind-capture). The node's kubectl is the node image's own (`Client Version: v1.37.0`). A **worker** gets no KUBECONFIG and has no admin.conf: kubectl tries `http://localhost:8080` (5 `memcache.go` lines, then `The connection to the server localhost:8080 was refused - did you specify the right host or port?`); `export KUBECONFIG=/etc/kubernetes/admin.conf` there changes nothing (client-go skips KUBECONFIG files that are not there); `--kubeconfig /etc/kubernetes/admin.conf` prints `error: stat /etc/kubernetes/admin.conf: no such file or directory`. These worker outputs ran the node image's kubectl v1.37.0 in that image (kubectl 1.37.2 prints the same); capture-cka.sh records them on kind next time. With no server, `get`, `describe`, `delete` and `scale` print those lines, `version` prints its two client lines and only the last line, and other commands (e.g. `apply`, which says it cannot download the openapi schema) get a grey note. A kubeconfig that is not an admin's (e.g. `kubelet.conf`) also gets a grey note.
- etcd (3.7, what kubeadm v1.37.0 runs): on **kind** use the etcd pod: `kubectl -n kube-system exec etcd-dev-control-plane -- etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save /var/lib/etcd/backup.db` (inside the pod only `/var/lib/etcd` and `/etc/kubernetes/pki/etcd` are on the node). A cluster made with `{ name: 'kind-dev', etcdTools: true }` is **exam-style**: `etcdctl` and `etcdutl` are on the control-plane node and `sudo` works. Real 3.7 behaviour, checked against the binaries: without the CA and a client certificate signed by the etcd CA (server, healthcheck-client, peer, apiserver-etcd-client) `snapshot save` prints one line and **waits forever** (the sim shows `^C` and a grey note); `--endpoints` may be left out; `etcdctl snapshot status` and `etcdctl snapshot restore` are gone (etcdctl prints its `snapshot` help); use `etcdutl [--write-out=table|json] snapshot status FILE` and `etcdutl --data-dir DIR snapshot restore FILE`. `snapshot save` writes JSON log lines (stderr) plus `Snapshot saved at FILE` and `Server version 3.7.0` (stdout). Through `kubectl exec` the two come back as separate streams and mix: kind-capture shows the two stdout lines just before the last JSON line (`"msg":"saved"`). Typed on the node (exam-style), one terminal keeps the program's order: every log line, then the two stdout lines (checked with etcd 3.7.0 in a pty). Lessons should look for `Snapshot saved at`, not for a line number. The kubernetes.io etcd page still shows the older 3.5 table (`+----+`); 3.7 draws box lines and adds a VERSION column.

**What happens** (the kubelet's loop runs every simulated second):
- **Kubelet stopped** (`systemctl stop kubelet`, or the `stopKubelet` fault): the node goes NotReady after 50 s with the real conditions (`Unknown`, `NodeStatusUnknown`, `Kubelet stopped posting node status.`) and `node.kubernetes.io/unreachable` taints; pods there keep running; after 5 more minutes they are evicted (and stay Terminating until the kubelet is back). `systemctl start kubelet` → Ready again within a second or two.
- **Static pods**: the control plane runs from `/etc/kubernetes/manifests/{etcd,kube-apiserver,kube-controller-manager,kube-scheduler}.yaml` (the real kubeadm v1.37.0 manifests) and shows up as mirror pods `<name>-dev-control-plane`, `Controlled By: Node/dev-control-plane`, `kubernetes.io/config.source: file`. The kubelet notices a manifest change after 3 s (it watches the folder; the docs say to allow fileCheckFrequency, 20 s). A file moved away or one that is no longer a valid Pod → the pod goes; an image tag typo → `ErrImagePull`/`ImagePullBackOff`; a misspelt flag or a `--kubeconfig` file the container cannot see → `CrashLoopBackOff` with the real kube-scheduler v1.37.0 log (`run.go:72] "command failed" err="stat …: no such file or directory"`, or the flag help ending in `Error: unknown flag: --bind-adress`). Deleting a mirror pod with kubectl: the kubelet posts it again.
- **Control plane down**: no kube-scheduler → new pods stay `Pending` with `Events: <none>`; no kube-controller-manager → no new ReplicaSet pods, no node checks, no endpoints; no kube-apiserver or etcd → `kubectl get` on the laptop prints one line, `Unable to connect to the server: EOF` (kind-capture: kind publishes the API port through Docker, which takes the connection and then closes it). Inside the control-plane node, kubectl goes straight to `dev-control-plane:6443` and nothing listens: 5 `memcache.go` lines, then `The connection to the server dev-control-plane:6443 was refused - did you specify the right host or port?` (the node image's kubectl v1.37.0 with a kubeadm-made admin.conf; capture-cka.sh records it on kind next time). Other commands follow the no-server rule above (`version --client` still works).
- **etcd restore**: the snapshot holds every object at that moment (its revision is the cluster's resourceVersion). After `etcdutl --data-dir /var/lib/etcd-restore snapshot restore /opt/backup.db`, point etcd at the folder (`sed -i 's#/var/lib/etcd$#/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml`, or change only the `etcd-data` hostPath). etcd restarts on it (the API is down for a few seconds), objects made after the snapshot are gone, and the deleted Deployment is back with its old uid and pods.

**Faults** (scenario steps `{ fault: … }`, or FoodCourtSim's `faults={['stopKubelet']}` button with a danger badge): `{ type: 'stopKubelet', node? }`, `{ type: 'startKubelet', node? }`, `{ type: 'breakStaticPod', component: 'kube-scheduler' | 'kube-controller-manager' | 'kube-apiserver' | 'etcd', how: 'yaml' | 'image' | 'flag' | 'path' | 'move' }` (`move` puts the file in `/root/`; `flag`/`path` work for the kube-* components). Inside a node, commands that change the node (`systemctl stop|restart`, `mv`/`sed -i` on a manifest, `rm`, `kubeadm certs renew`, `etcdutl … restore`) show the danger note.

**Goals** (with the other FoodCourtSim goals): `nodeReady` `{ name, ready? }`, `staticPodRunning` `{ name: 'kube-scheduler' (or the mirror pod name), node?, running? }` (Running, ready and on the current manifest), `snapshotTaken` `{ path? }` (an etcd snapshot file on the control-plane node or in the etcd pod), `deploymentRestored` `{ name, namespace? }` (the same Deployment object as in a snapshot, after an etcd restore, all pods ready; a re-applied Deployment does not count).

```mdx
<Interactive name="FoodCourtSim" scenario="k9-notready" faults={['stopKubelet']}
  goal={{ nodeReady: { name: 'dev-worker' } }} hints={['Type ssh dev-worker', 'Then systemctl start kubelet']} />
<Interactive name="KubeReplay" scenario="k9-certs" picture={false}
  commands={['docker exec -it dev-control-plane bash', 'kubeadm certs check-expiration', 'exit']} label="…" />
```

**Scenarios** (`src/content/courses/kubernetes/scenarios/k9.ts`): `k9-kubelet`, `k9-notready`, `k9-static-pods`, `k9-scheduler-down`, `k9-scheduler-crash`, `k9-crictl` (a crash-looping `oven` pod on dev-worker2), `k9-drain`, `k9-etcd-backup` and `k9-etcd-restore` (exam-style; `/opt/backup.db`), `k9-etcd-kind` (kubectl exec), `k9-certs`, `k9-boss` (dev-worker2's kubelet stopped + the shop Deployment deleted, snapshot in `/opt`). The `ETCD_TLS`, `ETCD_SAVE` and `ETCD_SAVE_KIND` strings are exported for lessons. `npm run verify:k8s` can only run kubectl on the real kind cluster, so only kubectl-only lists are truth-checked (`k9-static-pods`: mirror pod names, `config.source`, owner `Node`); scenarios with node commands or node faults are `engineOnly` and their node outputs are fixture-backed.

**Fixtures** (`src/engine/foodcourt-sim/fixtures/cka.json`): every node-side output the shell prints comes from a recording; each entry says where from (`source`), what was typed (`cmd`, `vars`) and on which node/IP. After two **Capture CKA outputs** runs (2026-11-01: kind v0.33.0, node image `kindest/node:v1.37.0@sha256:a1ed56cf…`, 3 nodes; see `captured`), every output entry is `kind-capture`, the files (manifests, kubelet unit and config) too. The kubelet's journal line for a manifest that no longer parses is recorded for one slip (`  containers` without its colon): the engine shows it for that slip only, with the file's own line number, and stays silent for other broken files. **Some real outputs change from run to run**, so tests and lessons must not pin them: which kubelet shutdown lines appear in the stop journal and where systemd's `Stopping…` lands; the order of stdout and stderr lines from `etcdctl snapshot save` through `kubectl exec`; the local port in `kubectl version` when the API is down. Lessons copy these from the engine, never by hand. **Only crictl rows** are drawn by the engine (under `pending`: the recorded column format, tabwriter min width 20, padding 3). The engine swaps in its own node names, IPs, times, PIDs, hashes and sizes (`fill`, `klogStamp` and the time helpers in `node/fixtures.ts`). **Refresh**: run the manual workflow **Capture CKA outputs** (`.github/workflows/capture-cka.yml`; it makes the same 3-node kind cluster as the k8s-truth job, runs `scripts/capture-cka.sh`, and uploads the `cka-capture` artifact), then `npx tsx scripts/capture-cka/import.ts cka-capture.json` (add `--dry-run` first), then `npx vitest run src/engine/foodcourt-sim` and `npm run verify:k8s`. Extra captures (kubectl views of the same moments: NotReady `get`/`describe`, the drain, the restored Deployment) land under `reference` for lessons to quote.

Not modelled (say less): expired certificates (kubeadm shows `<invalid>`, but kubectl's x509 error needs a capture), kubelet configuration errors, kubeadm init/join/upgrade output, CoreDNS/kube-proxy faults, what kubectl commands other than `get`/`describe`/`delete`/`scale`/`version` print with no API server. UI words: `k9.*` in `src/i18n/en.json` / `ms.json`. Dev page demos: `k9-shell`, `k9-restore`, `k9-replay` (`tests/e2e/k9.spec.ts`).

## Ship It: night shift drills, exam mode and the certification map

**Night shift drills** (`/<lang>/ship-it/night-shift/`, PLAN §12): optional 5-minute scenarios where something is broken in a simulator (KitchenSim, ConveyorBelt or FoodCourtSim) and the learner fixes it. "This week's drill" is picked in the browser from the ISO week number, rotating through the levels (`weeklyPick` in `src/lib/nightShift.ts`); the full list, grouped by level, is always open below it. Each drill has its own page (`/<lang>/ship-it/night-shift/<id>/`): what broke, your job, the simulator, and a folded "Need help?" with the matching Rescue Center flow and official docs. A fixed drill is saved in its own small key (`fahamlah:nightshift:v1`, `{ v: 1, done: { <id>: 'YYYY-MM-DD' } }`); the main progress data never changes. No countdown, no score, nothing pops up.

To add a drill:

1. Make the broken start state. Reuse a lesson scenario, or add one to that course's `scenarios/nightshift.ts` (ids `ns-docker-…`, `ns-ci-…`, `ns-k8s-…`) with a `verify` list that runs the fix, then run `npm run verify:docker`, `npm run verify:k8s` or `npm run verify:workflows`.
2. Add the drill to `src/content/courses/nightshift.ts` (up to 40 in all, spread over the three parts):
   ```ts
   {
     id: 'wrong-hatch', part: 'docker', kind: 'kitchen', scenario: 'ns-docker-wrong-hatch', level: 1,
     title: { en: '…', ms: '…' }, alert: 'curl: (56) Recv failure: Connection reset by peer',
     story: { en: 'What broke.', ms: '…' }, task: { en: 'What fixed looks like.', ms: '…' },
     goal: { running: ['web'], reachable: 'localhost:8080' },          // KitchenGoal / KubeGoal (kind: 'kube')
     hints: [{ en: '…', ms: '…' }],                                      // after mistakes; never in exam mode
     solution: ['docker rm -f web', 'docker run -d --name web -p 8080:80 nginx:1.30-alpine'],   // tests only
     success: { en: '…', ms: '…' }, rescue: 'docker-localhost-unreachable',
     docs: [{ label: 'Docker: port publishing', url: 'https://docs.docker.com/engine/network/port-publishing/' }],
   }
   ```
   A belt (`kind: 'conveyor'`, a cicd scenario with `fix` lines) takes `fixes` (choices, like ConveyorBelt), `forbid` (regexes for exam mode's text box, e.g. `write-all`) and `solution` (the fix text). `rescue` is a flow id from that course's `rescue.yaml`; until it exists, the page links the Rescue Center.
3. `npx vitest run src/content/courses/nightshift.test.ts` checks it: the scenario builds, the goal isn't met at the start, the solution meets it, belts work with choices and the text box, rescue and docs links, sentence length (max 15 words) and Malaysian Malay. `tests/e2e/ship-polish.spec.ts` opens every drill.

**Exam mode** (Settings, `settings.examMode`, off by default; older saves read as off): on night shift drills it adds a count-up timer (`role="timer"`, `aria-live="off"`, labelled "Exam timer"; whole minutes in calm mode; after 5 minutes it only says so kindly) and a "docs-only" rule card (kubernetes.io/docs, docs.docker.com, docs.github.com). Hints and the help box are hidden, and belts show a text box instead of choices, until the learner presses "Leave exam mode for this drill". Nothing listens to keys.

**Certification map** (`/<lang>/ship-it/certifications/`): data in `src/content/courses/certifications.ts` (format, USD price or `'varies'`, covering worlds as `{ course, world }`, take-it-when, official link; checked date `CERTS_CHECKED`). Progress = finished ready lessons and bosses of the covering worlds (`src/lib/certMap.ts`), like the world map counts them. Update the facts when the exams change; `certifications.test.ts` checks the worlds exist and the links are official.

UI words: `nightshift.*`, `exam.*`, `certs.*` in `src/i18n/en.json` / `ms.json`.

## Linux engine (LinuxSim)

Level Up · Linux & Networking runs on `src/engine/linux-sim/`: a pure TypeScript Debian 13 server called **kedai** (no DOM, no network, Vitest-tested, deterministic: the clock starts at 2026-11-01 09:00 UTC and moves 2 s per command; PIDs and ids are seeded). It works like the other engines: `run(state, 'ls -l')` returns `{ state, output, events, ok, exitCode, explain?, stopped?, danger? }` and never changes the old state. `explain` is an i18n key under `linux.explain.*` / `linux.err.*`; `danger` is set for `rm -r`/`-f`, `sudo`, `su`, `kill -9`, `chmod 777`, `crontab -r`, `curl … | bash` and friends.

**The machine.** Debian 13.7, bash 5.2, GNU coreutils 9.7, grep 3.11, procps, iproute2, systemd 257, nginx 1.26, cron, OpenSSH 10, curl 8.14, BIND 9.20 tools, apt 3.0; 2 CPUs, 2 GB, a 20 GB disk; `LANG=C.UTF-8`; no IPv6. Users `root`, `www-data` and the learner `you` (groups `you sudo`, passwordless sudo like a cloud server's first user, home `/home/you` mode 700, logged in over SSH on `pts/0`). The login umask is Debian 13's: `pam_umask` with user private groups gives `you` (and `www-data`, and new users) **0002**, so new files are `-rw-rw-r--` (664) and folders `drwxrwxr-x` (775); root (`sudo`, `sudo -i`, root steps) gets 0022 (644 / 755). `umask` / `umask -S` / `umask 022` work. Services `nginx` (master + one worker per CPU, serving `/var/www/html`), `cron` and `ssh`, with real unit files and journal lines. Network: `lo` 127.0.0.1, `eth0` 10.0.0.5/24, gateway 10.0.0.1, resolver 10.0.0.2, `/etc/hosts` `127.0.1.1 kedai`; a practice internet with `kedai.example` (203.0.113.10, a page), `www.kedai.example` (CNAME), `api.kedai.example` (`/health`), `pasar.example`. Only documentation names and addresses (RFC 2606, RFC 5737).

**What runs.** Shell: pipes, `> >> < 2> 2>&1 &> <<EOF <<<`, `&& || ;`, `&`, globs (`* ? [ ]`, hidden files only with a dot), braces, `$VAR ${VAR:-x} $? $# $@ $1 $$ $!`, `$( )`, `$(( ))`, quotes, `if/elif/else`, `for`, `while/until`, `case`, functions, `set -euo pipefail` (a `set -u` error leaves a script with 127), aliases (`ls --color=auto`, like Debian's `.bashrc`), and builtins `cd pwd echo printf export unset set source . type command alias exit logout jobs fg bg kill wait read trap history umask test [ [[ true false`. Programs: `ls (-l -a -A -h -R -d -1 -t -S -r) cat (-n) less more head tail (-n, +N, -f) mkdir (-p -v) rmdir (-p -v) touch cp (-r -v -i -n) mv (-v -i -n -f) rm (-r -f -v -i -I -d, danger) ln -s find (-name -iname -type -size -empty -user -perm -mtime -maxdepth -delete -exec) tree (-L N, -a, -d, -f, --noreport; installed with apt) stat du df grep (-r -i -n -v -c -l -w -E -F -o) wc sort (-n -r -u -k -t -h) uniq (-c -d -u) cut tr tee sed (s///, p, d, -n, -i) awk (fields, /re/, NR, END) seq xargs date (+FORMAT; -d with now, today, tomorrow, yesterday, @SECONDS, 2026-11-02 [10:30], N days [ago]) env printenv which hostname uname nproc free uptime top (one snapshot; live in the terminal until q) whoami id groups sudo (-u, -i, -s, sudo su) su passwd (a kind note) chmod (letters and numbers, -R) chown chgrp (-R -v -c: "changed ownership of 'f' from you to root") useradd usermod groupadd userdel ps (aux, -ef, -u, -C) kill (bash's: `kill -l` lists 64 signals five a line, `kill -l 9` → `KILL`, `kill -l KILL` → `9`; `sudo kill` and `/usr/bin/kill` are procps' own, with its own `-l` / `-L`) killall pkill pgrep (-c -l -a -f -x -u) sleep systemctl (status start stop restart reload enable disable --now is-active is-enabled is-failed list-units cat daemon-reload) journalctl (-u -n -f -x -e -q --no-pager -g, -p err / -p 3 / -p warning..err; colours by priority: err red, warning yellow, notice bold) nginx -t apt / apt-get (update install remove search show list upgrade, offline catalog: tree, htop, ncdu, jq, unzip, with sizes measured on Debian 13) dpkg -l curl (-s -S -v -I -i -o -f -X) ip (addr, route, link, -br) ss (-t -u -l -n -p) ping (-c) getent dig (+short) host crontab (-l, a file, -, -r; -e has no editor) ssh-keygen bash sh mktemp yes clear`. `nano`, `vim`, `man`, `python3`, `wget`, `git`, `ufw`, `traceroute`, `openssl` are not installed (the real `command not found`). `ssh`/`scp` to other machines time out with a kind note. GNU quoting as under `C.UTF-8`: `mkdir`, `id`, `groups`, `sleep`, `seq`, `date`, `chmod`/`chown` (bad mode, user, group), `find` and `head`/`tail` name things with ‘locale quotes’; `mkdir -v`, `rmdir`, `cp`, `mv`, `rm`, `touch`, `ls`, `stat`, `chmod`/`chown` (files) use 'shell quotes'. Copy messages from the engine, never retype them.

**Questions.** `rm -i`, `rm -I`, `cp -i`, `mv -i` and, at a terminal, `rm`/`mv` on a write-protected file ask like the real tools (`rm: remove regular empty file 'x'? `, `cp: overwrite 'y'? `, `mv: replace 't', overriding mode 0444 (r--r--r--)? `). In LinuxSim the question becomes the prompt and the next line typed is the answer: `y`/`yes` (anything starting with y) means yes, anything else no (`cp`/`mv` then exit 1); `^C` stops the whole line. The answer is not a command (it is not in `history` or the ↑ list). A `solution` can include answers (`['rm -i old.txt', 'y']`). In `verify` lists pipe the answers in (`echo y | rm -i x`, `yes | rm -ri d`): the truth check has no terminal, so a question with nothing piped gets no answer (no), and rm/mv do not ask about write-protected files there. Two cautions for verify lists: with several entries in one folder the questions come in disk order, so give the same answer to all (`yes |`) or keep one entry per folder; and don't add `-v` to questions (without a terminal the real tool prints its `-v` lines after all the questions).

**Journal rights.** Without `adm` or `systemd-journal` (the learner has neither), `journalctl` shows only the learner's own journal file: the lines their own `sudo` wrote, after a Hint. Before any `sudo` there is none: `No journal files were opened due to insufficient permissions.` (exit 1). `systemctl status` as the learner shows no journal lines; with `sudo` it shows the last 10. A unit that is stopped and disabled is unloaded by systemd: `systemctl status` then shows only `Active: inactive (dead)` (no since, Duration, Process or Main PID lines). A failed start has no `Main PID` line.

**Time and programs.** A long command typed at the prompt (`sleep 100`, `tail -f`, `ping` without `-c`, `top`, `journalctl -f`, a script or loop that never ends) holds the terminal: the card shows Ctrl+C / Ctrl+Z buttons (and `q` for `top`); typing `^C` or `^Z` works too. `&` makes a job (`[1] 1240`), then `jobs`, `fg`, `bg`, `kill %1`; finished jobs report `[1]+  Done` at the next prompt. A script that runs forever becomes a busy process (`ps` shows it at 99% CPU). cron runs every user's crontab when the clock passes the minute (`sleep 60` moves time).

**`LinuxSim`**: the terminal (Debian's green/blue prompt `you@kedai:~/shop$`, `#` for root; history, Tab completes commands and file names; the phone key row) + the state picture: the pink "you are here" bar (with a red root badge and icon after `sudo -i`), the folder you are in (blue: each entry's kind, `rwx` mode, owner:group, "can run", "not yours", first children of folders, hidden count), services as lights (green running, grey stopped, red + icon failed; "starts at boot"), busy programs (amber), and with `network` the address and listening ports (purple).

```mdx
<Interactive name="LinuxSim" scenario="linux-perms"
  goal={{ fileMode: { '~/shop/open.sh': 'x' }, lastTyped: '^(\\./|bash )open\\.sh' }}
  hints={['Type chmod +x open.sh', 'Then run it: ./open.sh']}
  solution={['chmod +x open.sh', './open.sh']}
  success="The script can run now, and it opened the shop." />
```

| Prop | Type | What it does |
| --- | --- | --- |
| `scenario` | id | Starting machine (`src/content/courses/linux/scenarios/`; LinuxSim reads Linux scenarios everywhere) |
| `goal` | `LinuxGoal` | Checked after every command; met → `success`, `fl:done` and a short confetti burst (none in calm mode) |
| `hints` | `string[]` | Kind "Almost!" box after 2 mistakes; the next hint every 2 more |
| `success` | string | Shown when the goal is met |
| `solution` | `string[]` | Never shown: `check:mdx` runs it and makes sure it reaches the goal |
| `prefill`, `intro` | string, `string[]` | Text already typed; commands run and shown first |
| `picture` | boolean | The state picture (default `true`) |
| `network` | boolean | Show the network panel (default: the scenario's `network`) |
| `keys` | `string[]` | Phone key row (default `ls cd sudo -l ~/ \| Tab ↑`) |

**Goal keys** (all optional, all must pass; paths absolute or `~/…`): `fileExists`, `fileMissing`, `dirExists` (paths); `fileContains`, `fileNotContains` (`{ path: regex }`); `fileMode` (`{ path: '755' | 'rwxr-xr-x' | 'x' | '-x' }`: `x` = the owner may run it); `owner` (`{ path: 'user' | 'user:group' }`); `cwd`; `user` (who you are now); `serviceActive`, `serviceInactive`, `serviceFailed`, `serviceEnabled`, `serviceDisabled` (names); `portListening`, `portClosed` (numbers); `processGone`, `processRunning` (regexes on command lines); `scriptExitCode` (`{ path: code }`, the last run); `envVar` (`{ NAME: regex }`, exported); `packageInstalled`; `userExists`; `inGroup` (`{ user: group }`); `crontabHas` (`{ user: regex }`); `reachable` (`{ 'localhost': 200 }` or `{ url: { status?, contains? } }`, curl from the server); `resolves` (`{ name: ip }`); `jobs` (count); `noForeground`; `lastExit`; `typed`, `lastTyped` (regex). `check:mdx` refuses unknown keys, bad regexes, a goal met at the start and a `solution` that doesn't reach it.

**Scenarios** (`src/content/courses/linux/scenarios/`, one file per world spread into `allScenarios` in `index.ts`; `examples.ts` has 13 models, each with a model `task`):

```ts
{
  id: 'linux-perms',
  cwd: '~/shop',                                   // where the learner starts (default ~)
  steps: [
    'mkdir shop',                                  // typed by "you" (must succeed)
    { root: 'systemctl stop nginx' },              // run as root
    { write: '~/shop/open.sh', content: '#!/bin/bash\necho hi\n', mode: '644', owner: 'you' },
    { process: { cmd: 'bash /home/you/bin/stuck.sh', busy: true, stubborn: false } },  // keeps running
    { wait: 10 },
  ],
  verify: [['ls -l', './open.sh', 'chmod +x open.sh', './open.sh']],
  network: true,                                   // show the network panel
  task: { goal: { fileMode: { '~/shop/open.sh': 'x' } }, solution: ['chmod +x open.sh'] },
}
```

`{ install: 'tree' }` installs a package from the apt catalog before the learner arrives (the truth check installs the real one from `.deb` files baked into its image, no network). Engine-only steps (the truth check skips the scenario; give it `engineOnly: 'why'`): `{ dns: { name: ip } }`, `{ remote: { ip, up, rtt?, ports?, drops?, pages? } }` (`drops`: a firewall, so connections time out), `{ bigFile: { path, size } }` (fills the disk), `{ listen: { port, addr?, prog, pages? } }`. When `~/bin` exists after the steps it joins `PATH`, like `~/.profile` at login. Models: `linux-home` (a shop to walk around), `linux-messy` (L1 boss), `linux-logs` (an nginx access log for grep and pipes), `linux-perms`, `linux-stuck` (a busy script), `linux-nginx-down` (a typo in the nginx site: L2 boss), `linux-services`, `linux-path`, `linux-users`, `linux-net` (ports, `/etc/hosts`, curl), `linux-dns` (engine only: DNS and a firewalled host), `linux-backup` (a `set -euo pipefail` script and cron: L4 boss), `linux-disk` (engine only: a full disk). World L3 and L4 states live in `l3.ts` (`linux-l3-*`: addresses, ports, an app on the intercom only, `/etc/hosts`, HTTP status codes, a refusing shop and a firewalled one, the four-shop ladder, the boss rungs) and `l4.ts` (`linux-l4-*`: keys, `authorized_keys`, `~/.ssh/config`, a full disk, cron with the clock at 09:00:40, scripts for variables, loops and strict mode, nginx sites, the backup boss). `fidelity.ts` holds `linux-fid-*` machines no lesson uses: their verify lists pin behaviours once found different from Debian 13 (quotes, `kill -l`, questions, `tree -L`, `systemctl status` after stop / disable / a failed start, `journalctl -p` and journal rights, the login umask, system file sizes, the checker's normalising). Keep them passing.

Engine notes from L3/L4 (checked on Debian 13, 2026-11-01): a dropped connection makes curl wait for the kernel (`(28) Failed to connect … after 134844 ms: Could not connect to server`; the clock moves on 135 s), or for `--connect-timeout N` / `-m N` (`(28) Connection timed out after N004 milliseconds`). nginx takes new `listen` ports only on start, restart or reload, like the real one; a reload with a bad config fails with `Job for nginx.service failed.` and keeps serving. `ssh-keygen` asks its questions in OpenSSH 10's order and words, and its key file has the real size. `curl -v` output is a terminal's order (the truth check runs without a terminal, so it compares `curl -sS -o file` instead). `crontab` checks lines like Vixie cron: it names the field (`"-":0: bad hour`; the number counts the lines cron had read, so a mistake inside line 1 says 0 and one at its end says 1), knows `jan`…`dec` and `sun`…`sat`, and refuses a file without its last newline. `ssh` to the server itself (`localhost`, `kedai`, its addresses) first asks to trust its key (with no terminal: `Host key verification failed.`), then wants a key in `~/.ssh/authorized_keys` or a password (the learner has none, so passwords fail; a matching key is only explained: the practice terminal stays in its session). nginx serves each port from its own `server { }` block (root, index; a missing index file is a 403), and only root may signal it (`nginx -s reload` as you: `kill(…, 1) failed (1: Operation not permitted)`). `ping` to a machine on the server's own network shows `ttl=64`; an address there with nobody on it gives `Destination Host Unreachable` (iputils 20240905; engine only, the truth check's network differs). Still not modelled: HTTPS practice hosts answer over HTTP/1.1 (real curl would negotiate HTTP/2 with most servers); `ssh-keygen` prints its questions instead of waiting for answers. What the engine doesn't do (openssl, ufw, traceroute, real SSH, scp, rsync, systemd timers) is taught with Transcripts captured in a Debian 13 lab: two machines on one network, and four network namespaces as kedai → gateway → exchange → kedai.example.

**Truth check: `npm run verify:linux`** (CI job `linux-truth`, needed by `deploy`). Every scenario's `verify` lists run in the engine and on a real Debian 13 machine: a container built from `scripts/verify-linux/Dockerfile` with systemd as PID 1 (privileged), nginx, cron, ssh, sudo and the user `you`, two CPUs, home on a volume. Each list gets a fresh machine and runs as `you` in one bash login session; the engine's `/etc/hosts` is copied in. `docker exec` skips PAM (its umask is 0000), so the check sets a real login's umask everywhere: 0002 for `you` (verify lists, string steps, processes), 0022 for root steps (which run in `/home/you`, like the engine's). No extra `chmod` is needed after a root `mkdir`. History is on with `HISTCONTROL=ignoreboth` like an interactive Debian shell, so `history` works in verify lists (a line starting with a space, or repeating the one before, is not saved). After `systemctl start/restart/reload/enable --now` and `nginx -s reload` the check waits half a second, like a learner reading the screen (so `systemctl status` shows `/usr/sbin/cron -f`, not systemd's `(cron)` placeholder, and `ss` shows a reloaded nginx's new port); before `journalctl` and `systemctl status` it waits 0.3 s (journald writes a moment later), and each machine starts only after journald has moved its journal to `/var/log/journal` (as on a running server, where each user has their own journal file). It compares every command's exit code and output and, at the end, the home folder (path, type, mode, owner, group, size). Normalised, because they truly differ: times, dates (the real machine's date of today, as `date +%F` or `+%Y%m%d` print it, becomes the engine's 2026-11-01, so don't write today's real date into a verify list), PIDs, invocation ids, IPs and MACs, memory/CPU/task numbers, the number of nginx workers (one per host CPU), curl's progress meter (only without a terminal), `find`/`grep -r` order, `ls` columns (a script gets one name per line), the checking session's own `ps` rows (its shell has no terminal: `ps`, `ps -u you` show TTY `?`, the learner's `pts/0`, and no `sshd-session`), nginx rows in `ps -C nginx` (one kept), the order of `rm -r`/`cp -r`/`chmod -R`/`chown -R` with `-v` or `-c` (disk order: compared as a set), `find` from a system folder (`find / …`: the real disk has many more folders you may not read, so its `Permission denied` lines are left out; the exit code is still compared; prefer `2>/dev/null`), sudo's `session opened … by you(uid=1000)` (the check has no login name), IPv6 lines, the journal "insufficient permissions" warning (only after journald's flush), sshd's goodbye line (same millisecond as systemd's). Not normalised, so keep out of verify lists: `/tmp` (a real Debian 13 `/tmp` is a tmpfs holding systemd's `systemd-private-*` folders; use a folder of your own), `-v` mixed with questions (above). Run it under the Docker lock: `flock <lock> npm run verify:linux`; `VERIFY_ONLY=linux-net`, `TRUTH_SHARD=1/2`, `VERIFY_LINUX_KEEP=1` (keep the containers), `VERIFY_LINUX_PREFIX`. Behind an HTTPS proxy the image build uses `HTTPS_PROXY` and the CA in `/root/.ccr/ca-bundle.crt`.

**Engine-only (shown, but not compared with a real machine):** `apt` (offline catalog; versions, sizes and the apt 3.0 layout measured on Debian 13 in Nov 2026), DNS answers (`dig`, `host`; the format follows BIND 9.20) and remote hosts, `df`/`free`/`uptime`/`top` numbers (a container sees its host), `uname -r` (Debian 13's `6.12.113+deb13-amd64`), job-control notices (`[1] 1240`, `Done`: interactive shells only), `ssh-keygen` keys and fingerprints (made up; the format and randomart algorithm are OpenSSH's), `ssh`/`scp` to other machines, cron firing over time, the learner's SSH login lines (and so their `pts/0` terminal in `ps`). `sudo`'s journal lines are checked (only the login name in `by you(uid=1000)` is normalised). `openssl s_client` is not modelled.

Engine helpers (`~/engine/linux-sim`): `run`, `runAll`, `promptOf`, `createMachine`, `buildLinuxScenario` / `buildLinuxScenarioCached`, `linuxStep`, `checkLinuxGoal`, `LINUX_GOAL_KEYS`, `linuxPicture`, `LINUX_COMMANDS`, `APT_CATALOG`, `applyMode`, `randomart`, `plain`, `toAnsi`. Events: `cwd`, `fileWritten`, `fileRemoved`, `dirMade`, `modeChanged`, `ownerChanged`, `userSwitched`, `procStarted`, `procEnded`, `procStopped`, `serviceChanged`, `packageInstalled`, `packageRemoved`, `request`, `cleared`, `error`.

## Level Up: AWS games

There is no free AWS sandbox to check against, so AWS gets **pure-logic games** instead of a simulator (LEVEL-UP-PLAN §5). Every rule is taken from the official AWS documentation and unit-tested with that page's own worked examples (`src/lib/aws/*.test.ts`; each test names its page). The story is the mall: a unit you rent, keys (IAM), guards (security groups and network ACLs), roads (VPC and subnets), the monthly bill. Own line drawings only (`awsShared.tsx`): no AWS logos, no console screenshots. All four: buttons, selects and text inputs for everything (no drag), kind `fl:wrong` feedback, `fl:done` when the task is met (the lesson player then calls `celebrate()`), one short animation that never loops (calm mode and reduced motion show the end at once), 360 px friendly, words from i18n `aws.*`. On the hidden test page `/en/dev/interactives/` (props in `src/lib/aws/demos.ts`, tests in `tests/e2e/aws-games.spec.ts`); `npm run check:mdx` checks their props (`scripts/check-mdx/aws-games.ts`). All take optional `prompt` and `success`.

**IamJudge** (A2): a request (who, action, resource, request facts) and up to a few short policies (JSON, ≤ 16 lines each on the card; `check:mdx` stops longer ones). Predict Allow or Deny, then the guard posts answer one by one in the documented order: any Deny that fits → SCPs (every level needs an Allow) → the resource policy → identity policies → the permissions boundary. The statements that decided light up (green ✓ Allow, red ⚠ Deny), and condition keys show what the request had. Or `task: edit`: the learner changes one line of one policy (pink) until AWS gives `want`.
```mdx
<Interactive name="IamJudge"
  request={{ principal: 'arn:aws:iam::111122223333:user/aina', who: 'Aina', action: 's3:PutObject', resource: 'arn:aws:s3:::kedai-menu/today.json', context: { 'aws:SecureTransport': 'false' } }}
  policies={[{ name: 'menu-writer', kind: 'identity', doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:PutObject', Resource: 'arn:aws:s3:::kedai-menu/*' }] } },
    { name: 'tls-only', kind: 'identity', doc: { Version: '2012-10-17', Statement: [{ Effect: 'Deny', Action: 's3:*', Resource: '*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }] } }]} />
<Interactive name="IamJudge" request={{ principal: 'arn:aws:iam::111122223333:user/aina', action: 's3:PutObject', resource: 'arn:aws:s3:::kedai-menu/today.json' }}
  policies={[{ name: 'menu-reader', kind: 'identity', doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::kedai-menu/*' }] } }]}
  task={{ type: 'edit', policy: 0, line: 6, want: 'Allow', forbid: ['"\\*"', 's3:\\*'] }} solution={'"Action": ["s3:GetObject", "s3:PutObject"],'} />
```
- `request`: `principal` is an IAM user ARN or a role session ARN (`arn:aws:sts::111122223333:assumed-role/ci-deployer/run-42`); `context`: request keys that are present (a key you leave out is "not in the request", which matters: see the condition rules below). `who`: a friendly name.
- `policies`: `{ name, kind: 'identity' | 'boundary' | 'resource' | 'scp', level? (SCPs: root, an OU, account), doc }`. A resource policy's `Principal` is `{ AWS: <user ARN | role ARN | role session ARN> }`.
- `task`: `{ type: 'predict' }` (default) or `{ type: 'edit', policy, line, want: 'Allow' | 'Deny', forbid? }` (`line` is the 1-based line as the card prints it; `forbid`: regexes the new line must not match, e.g. a bare `*`). Edit needs `solution` (never shown; `check:mdx` makes sure it works and that the start doesn't).
- What the evaluator knows (`src/lib/aws/iam.ts`): Effect, Action / NotAction (case-insensitive, `*` and `?` anywhere), Resource / NotResource (case-sensitive ARNs, wildcards per ARN part, a trailing `*` reaches past colons), Condition with `StringEquals`, `StringNotEquals`, `StringEqualsIgnoreCase`, `StringNotEqualsIgnoreCase`, `StringLike`, `StringNotLike`, `Bool`, `IpAddress`, `NotIpAddress` (IPv4; a bare address is /32), `ArnEquals`, `ArnLike`, `ArnNotEquals`, `ArnNotLike`, any of them `…IfExists`, and `Null`. Key names are case-insensitive; operators AND, keys AND, values OR (negated operators: NOR); a missing key makes a positive operator false and a negated one true. Same-account resource policies: naming the IAM user or the role session is enough on its own; naming the role ARN skips the identity check but still needs the boundary.
- Not modelled (the game and `check:mdx` refuse them, so nothing is guessed): the root user, cross-account requests, RCPs, session policies, federated users, `Principal: "*"` / accounts / services, `NotPrincipal`, policy variables (`${aws:username}`), Numeric / Date / Binary operators, `ForAllValues` / `ForAnyValue`, IPv6, and service exceptions (role trust policies and KMS key policies). Teach those with words and the docs.
- Sources: IAM User Guide "Policy evaluation logic" and its pages (single account, explicit vs implicit deny), "Permissions boundaries", the policy element pages (Action, NotAction, Resource, NotResource, Condition, condition operators, multiple keys and values) and AWS Organizations "SCP evaluation".

**SubnetPlanner** (A3): the VPC is the mall's land; each row of units (a subnet) in each wing (AZ) needs its own block. Pick a size (it lands on the first free aligned block) or type a CIDR. Live checks per subnet: /16–/28, inside the VPC, no overlap (red ⚠ on both, a striped block on the address map), usable addresses after the five AWS keeps (network, VPC router, Amazon DNS at base + 2, future use, broadcast; a folded list shows them). Done as soon as every cell meets the brief.
```mdx
<Interactive name="SubnetPlanner" vpc="10.0.0.0/16" azs={['ap-southeast-5a', 'ap-southeast-5b']} need={{ public: 20, private: 200 }}
  start={[{ tier: 'public', az: 'ap-southeast-5a', cidr: '10.0.0.0/27' }]} />
<Interactive name="SubnetPlanner" vpc="10.0.0.0/8" editVpc tiers={['public']} azs={['ap-southeast-5a', 'ap-southeast-5b', 'ap-southeast-5c']} />
```
- `vpc` (required), `azs` (default `ap-southeast-5a`, `ap-southeast-5b`), `tiers` (`public`, `private`; default both), `need` (usable addresses per subnet of a tier), `start` (subnets already there), `editVpc` (the VPC block is an input too, with its checks: /16–/28; 0.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 and 224.0.0.0/4 are refused; 172.17.0.0/16 and public ranges get a note; host bits are cleared like the API does). `check:mdx`: the brief fits, the start isn't already done.
- Logic: `src/lib/aws/cidr.ts` (`parseCidr`, `checkVpcCidr`, `checkPlan`, `reservedAddresses`, `usableAddresses`, `firstFreeBlock`, `splitVpc`, `autoPlan`). Sources: Amazon VPC "VPC CIDR blocks", "Subnet CIDR blocks", "Subnets for your VPC". Not modelled: IPv6, secondary CIDR blocks and their association table, BYOIP.

**SecurityGroupGate** (A3): visitors walk to a unit. First the row's gate (network ACL: numbered rules, lowest first, first match wins, `*` denies the rest, remembers nothing) and then the unit's door (security group: allow rules only, any match is enough, remembers the conversation). The learner adds and removes rules (selects and inputs), then "Let them try": each visitor's walk grows to where it stopped (red ⚠ when that's wrong, a calm stop sign when keeping it out was the task), with the rule that decided. The reply goes back to the client's ephemeral ports, so a NACL needs an Out rule for them; a rule that covers only part of the range says which ports are still blocked.
```mdx
<Interactive name="SecurityGroupGate" edit="sg" forbidOpen={[22]} visitors={[
  { id: 'shopper', label: 'Shopper', ip: '198.51.100.20', client: 'windows', protocol: 'tcp', port: 443, want: 'in' },
  { id: 'laptop', label: 'Your laptop (SSH)', ip: '203.0.113.9', protocol: 'tcp', port: 22, want: 'in' },
  { id: 'stranger', label: 'Stranger (SSH)', ip: '192.0.2.77', protocol: 'tcp', port: 22, want: 'out' }]} />
<Interactive name="SecurityGroupGate" edit="nacl" nacl="custom" sg={[{ protocol: 'tcp', ports: '443', source: '0.0.0.0/0' }]} visitors={[...]} />
```
- `visitors` (required): `{ id, label, ip, groups?, client?, protocol: 'tcp' | 'udp', port, want: 'in' | 'out' }`. `client` picks the reply ports from the docs: `linux` 32768–61000 (default), `windows` 49152–65535, `windowsOld` 1025–5000, `elb`, `nat`, `lambda` 1024–65535. `groups`: the visitor is a server in that security group (for rules whose source is `sg-…`).
- `edit`: `sg` (default), `nacl` or `both`. `sg`: inbound rules at the start (`{ protocol: 'tcp' | 'udp' | 'all', ports?: '443' | '1024-65535', source: CIDR | 'sg-…' }`; one address needs `/32`). `nacl`: `'default'` (allows all; hidden when only the SG is edited), `'custom'` (a new one: denies all) or `{ inbound, outbound }` of `{ number: 1–32766, protocol, ports?, cidr, action: 'allow' | 'deny' }`. `groups`: group ids that exist. `forbidOpen`: ports that must not be open to `0.0.0.0/0` in the security group (the docs' advice for 22 and 3389).
- `check:mdx`: rules and visitors read, the task isn't done at the start, and a tight answer (one `/32` rule per wanted visitor, on the editable guard) meets it. Logic: `src/lib/aws/gates.ts`. Sources: Amazon VPC "Security groups", "Security group rules", "Network ACLs", "Network ACL rules", "Default network ACL", "Custom network ACLs" (incl. "Ephemeral ports"), "Example: Control access to instances in a subnet". Not modelled: ICMP types, IPv6 rules, prefix lists, traffic the server starts itself, traffic inside one subnet.

**IdleBill** (A1 safety, A4 costs): one thing at a time: does it keep costing money while it sits idle? Two big buttons; a miss gives the trick (the why) and another go; a right answer files it on the bill or the free shelf with its why, the official page and the pricing page. At the end the costly ones become the learner's clean-up list, with "prices change" and the Free Tier page. **No prices anywhere** (a unit test fails on a currency or a price).
```mdx
<Interactive name="IdleBill" />
<Interactive name="IdleBill" items={['natGateway', 'securityGroup', 'ebsDetached', 'vpc']} ordered />
```
- `items`: ids from `src/lib/aws/idleCosts.ts` (default 4 + 4, shuffled the same way for everyone; `ordered` keeps your order). Costs while idle: `natGateway`, `elasticIpIdle`, `elasticIpStopped`, `ebsDetached`, `ebsOfStopped`, `ebsSnapshot`, `loadBalancer`, `rdsRunning`, `rdsStopped` (storage and backups; it starts again after 7 days), `eksCluster`, `interfaceEndpoint`, `secret`, `hostedZone`, `s3Objects`, `ecrImages`, `lambdaProvisioned`. Free while idle: `vpc`, `securityGroup`, `networkAcl`, `internetGateway`, `gatewayEndpoint`, `privateIp`, `iam`, `ecsCluster`, `stoppedInstance` (compute only: its disks still cost), `lambdaFunction`. Words: `aws.idle.item.<id>.name` / `.why`.
- Each item cites the page that states how it is billed (checked 2026-11-01, `IDLE_CHECKED`). When AWS changes a rule, update the item, its i18n words and its source together.

## Exam practice and drill levels

Level Up (docs/LEVEL-UP-PLAN.md §3–4) adds harder night shift drills and exam-style practice for KCNA and CKAD. Everything is optional and nothing is locked.

### Drill levels

Every drill in `src/content/courses/nightshift.ts` has a `level`:

| Level | What the learner gets |
| --- | --- |
| `1` ★ | One fault. Hints show in the simulator after mistakes (as before). Belts show the choices. |
| `2` ★★ | One fault. Hints stay folded under "Need a hint?" and open one at a time. Belts start with the text box; the choices are a folded hint. |
| `3` ★★★ | An **incident**: two or three faults at once. No hints (the Rescue Center link stays). After the fix: a root-cause question (kind feedback, try again), then the fixed note, "What you fixed" and the confetti. KitchenSim or FoodCourtSim only. |

- `alert` (optional, every level): the first thing on the page, a real line the learner would see (`curl: (56) …`, `0/3 nodes are available: …`). Copy it from what the engine prints for the scenario (its outputs are checked against the real tool). It is not translated.
- A level 3 drill also needs `problems` (2–3: `{ what: { en, ms }, fix: [commands] }`; `solution` must equal their fixes in order) and `rootCause`:
  ```ts
  rootCause: {
    question: { en: 'Both faults came at once. What was the root cause?', ms: '…' },
    options: [{ en: '…', ms: '…' }, { en: '…', ms: '…' }, { en: '…', ms: '…' }],   // 3–4
    answer: 1,
    why: { en: 'Why it is the root cause (shown after the right pick).', ms: '…' },
  },
  ```
  A miss shows "Almost! Here's the trick: Look at what changed just before it broke." (`nightshift.level.rootNudge`).
- `nightshift.test.ts` also checks: levels 1–2 have hints; an incident has 2–3 faults, each one matters (fixing all but one leaves the goal unmet), and a root-cause question with one answer. Examples: `kitchen-blackout` (Docker) and `lunch-rush-outage` (Kubernetes).
- Exam mode still adds the timer and hides hints on every level.
- The drills (35 on 2026-11-01): Docker 13, CI/CD 9, Kubernetes 13; 11 incidents. A three-fault incident: `new-laptop` (Docker) and `lunch-release-quota` (Kubernetes). Give every incident a root cause that explains all its faults (an untested script, a pull that needed new steps, guessed sizes, copied YAML, the wrong context), not just one of them.
- Traps found while writing them: a belt needs a workflow that parses and runs, so an invalid file (`runs_on`, a `needs` typo) can't be a drill yet. The conveyor engine doesn't model action SHA pins. A box that failed on a busy port comes back with no published port after a plain `docker start` on Docker 29.9.2 (the engine keeps the port), so teach `rm` + `run` and don't start a drill from a `Created` box with a port.

### Exam practice pages

`/<lang>/ship-it/exam/` (hub), `/<lang>/ship-it/exam/kcna/` and `/<lang>/ship-it/exam/ckad/`. Both runners are React islands (`client:only`): `src/components/ship-it/KcnaMock.tsx` and `CkadPractice.tsx`. One question or task per screen, "Question X of Y" with a progress bar, Back / Next (and Skip for tasks), results per domain. A set is picked with a seeded random order (`pickSet` in `src/lib/mockExam.ts`): by the official domain weights when the bank is bigger than a set, else every item. Attempts and the unfinished set live in their own key, `fahamlah:exams:v1` (`{ v: 1, attempts: […], current: { kcna?, ckad? } }`), saved after every answer; the main progress store never changes. Exam mode (Settings) adds a count-up timer (suggested time = the real exam's minutes scaled to the set size; it never stops anyone) and, for CKAD, the docs-only rule card (kubernetes.io/docs, kubernetes.io/blog, helm.sh/docs) with hints hidden. The pages say "practice, not the real exam" and link the official exam pages. The certification map shows a "Practise for …" link when a cert has `practice: 'exam/kcna/'` in `certifications.ts`.

**Add a KCNA question** (`src/content/exams/kcna.ts`; 176 questions on 2026-11-01, keep it at 160+):

```ts
{
  id: 'kcna-orchestration-004',        // kcna-<domain>-NNN, never reused
  domain: 'orchestration',             // fundamentals | orchestration | delivery | architecture (official, 2026-11-01)
  answer: 2,                           // index of the right option, the same in both languages
  lesson: 'k8s-k3-l05',                // a ready lesson (the review link)
  en: { question: 'Which … ?', options: ['…', '…', '…', '…'], why: 'One or two short sentences.' },
  ms: { question: '… ?', options: ['…', '…', '…', '…'], why: '…' },
},
```

Write every question yourself (never copy real exam questions). Exactly 4 different options; mix up where the answer sits (options are also shuffled per attempt). Put commands and object names in backticks: EN and MS must have the same `code` in the question, each option and the why. `src/content/exams/kcna.test.ts` checks ids, domains, options, the answer, the lesson, EN/MS code parity, max 15 words per sentence, a question mark, no "wrong", and Malaysian Malay. For the whole bank it also checks: 160+ questions, each domain's share within 3 points of its official weight (44/28/16/12), no question asked twice, and the answer spread over all four positions (20–30% each). Next id per domain: check the last one in the file. The review link may point at any ready lesson (Kubernetes, Docker, CI/CD or Git).

**Add a CKAD task** (`src/content/exams/ckad.ts`; 34 tasks, goal 30+ spread by the domain weights):

```ts
{
  id: 'ckad-services-networking-002',  // ckad-<domain>-NNN
  domain: 'services-networking',       // design-build | deployment | observability | env-config-security | services-networking
  scenario: 'exam-ckad-shop',          // any Kubernetes scenario id; new ones go in kubernetes/scenarios/exam.ts
  goal: { serviceEndpoints: { name: 'shop', count: 3 } },   // a KubeGoal (no typed / lastTyped: any working path passes)
  en: { task: 'Like an exam task: names, images, ports.', hint: 'One nudge (folded; hidden in exam mode).' },
  ms: { task: '…', hint: '…' },
  docs: { label: 'Kubernetes: Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
  solution: ['kubectl expose deployment shop --port=80'],   // tests only
},
```

New starting clusters go in `src/content/courses/kubernetes/scenarios/exam.ts` (ids `exam-ckad-…`, with a `verify` list; `npm run verify:k8s`). `src/content/exams/ckad.test.ts` checks the scenario exists, the goal isn't met at the start and the solution meets it, **waiting alone (5 simulated minutes) never meets it**, the docs link is on a site the real exam allows, and the words. `tests/e2e/exam.spec.ts` solves the first task of a set with its solution.

How the 34 tasks (2026-11-01) stay checkable:
- The terminal has no text editor (`kubectl edit` is explain-only; the task screen says so). Tasks are solved with `kubectl create`/`run`/`expose`/`set`/`label`/`rollout`, `kubectl patch -p '{…}'` (lists of named items such as `containers`, `initContainers`, `volumes` merge by `name`, like a strategic merge patch), and `apply -f`/`-k` on files the scenario puts in the folder.
- Goals check behaviour, not fields: a page served from a ConfigMap (`reachable … contains`), an exec readiness probe that reads a mounted Secret, quota or Pod Security admission that blocks pods until requests or a `securityContext` are right, `canI` for RBAC, `reachable`/`unreachable` for NetworkPolicy, an exact `revision` for rollbacks.
- Start from a steady broken state that time cannot fix (never Ready, Pending, blocked), never one that flips (a liveness restart loop is Ready part of the time).
- Not modelled, so no tasks: building images, CRDs and operators, `helm install`/`upgrade` (explain-only), Ingress objects (Gateway API instead), `kubectl top` limits.
- Engine-only scenarios: `exam-ckad-till-logs` (postgres is not preloaded in CI) and `exam-ckad-gateway` (no Gateway controller in kind). Lists that label a node take the label off again (node labels outlive the real check's reset).

UI words: `mock.*` and `nightshift.level.*`.

## Level Up courses (platform)

The brief is `docs/LEVEL-UP-PLAN.md` (§1 and §5 are binding). Level Up (BM: *Naik Tahap*) is a second family, built exactly like Ship It: four course folders that share one overview map (`/<lang>/level-up/`) and one Rescue Center (`/<lang>/level-up/rescue/`). Every Ship It rule above applies (story, state after every command, safe by default, ≤ ~15 lines of YAML/HCL per card, real error first).

### Folders, ids and URLs

```
src/content/courses/linux/          # Part 1 "Rumah Kedai": L1–L4 (world ids 1–4), mission M7 in L4
src/content/courses/iac/            # Part 2 "Pelan Arkitek": T1–T4, mission M8 in T4
src/content/courses/observability/  # Part 3 "Bilik Kawalan": O1–O4, mission M9 in O4
src/content/courses/aws/            # Part 4 "Pusat Beli-belah": A1–A4, mission M10 in A4
  course.yaml  commands.yaml  rescue.yaml  scenarios/index.ts   # same shapes as Ship It
src/content/glossary/linux.yaml, iac.yaml, observability.yaml, aws.yaml
src/content/courses/kubernetes/     # + world 9 (K9 Cluster Admin, the CKA pack, `extra: true`)
```

- Lesson ids: `linux-l1-l03`, `iac-t2-l05`, `obs-o3-l02`, `aws-a4-l01`, `k8s-k9-l01`; bosses `linux-l1-boss`, `k8s-k9-boss`; missions `linux-l4-m7`, `iac-t4-m8`, `obs-o4-m9`, `aws-a4-m10` (`mission: 7` … `10`; the schema allows 1–10). World folders are `<code>-<slug>` (`l1-shophouse`, `t3-state-teams`, `o4-diary-one-order`, `a3-mall-roads`, `k9-cluster-admin`).
- URLs: `/<lang>/linux/<world slug>/<lesson slug>/`, the same for `iac`, `observability` and `aws`. Tool pages: `/<lang>/<course>/glossary/`, `/commands/`, `/cheatsheet/`. A Level Up rescue flow: `/<lang>/level-up/rescue/#<flow-id>`.
- Every lesson in the four outlines starts as `status: soon`. Only flip the ones you wrote. `src/content/courses/level-up.test.ts` checks the outline against the plan (counts, ids, folders, missions, badges, hints, short sentences, Malaysian Malay); `ship-it.test.ts` checks K9.

### Frontmatter and course fields

- `tool` / `toolVersion` per course (course.yaml sets the default): `linux` / `"debian-13"` (the lesson frame says "Checked with Linux (Debian 13)"), `opentofu` / `"1.13"`, `prometheus` / `"3"`, `aws` / `"2026-11"`. K9 keeps `kubernetes` / `"1.37"`. All tools live in `TOOLS` (`src/lib/catalog.ts`); each needs `tool.<id>` in both i18n files.
- `hat`: Kancil's outfit. Level Up adds `toolbelt` (Linux), `pencil` (IaC, behind the ear), `headset` (Observability) and `lanyard` (AWS). All outfits live in `HATS`; each needs `mascot.hat.<id>` (the screen-reader label). They are static drawings in `Mascot.astro`, coloured by `--mascot-*` tokens.
- `extra: true` on a world: an optional extra pack. Maps and the Ship It overview show a calm "Extra pack" tag (`map.extraPack`); nothing is locked, and the finish line (`finale: true`, Career Quest) stays the last island on the map (`mapOrder` in `catalog.ts`).
- `requires`: the "best after" tips. Worlds with a code are named by it: "Tip: best after CI/CD, World C1." Linux has none (it is a good first step; the home card and overview say so).
- `topics {en, ms}` on a world: a one-line list shown on the map while the world has no ready lesson.
- Badge ids are global: world badges `linux-world-1`, `iac-world-2`, `obs-world-3`, `aws-world-4`, `k8s-world-9`; skill badges sit on bosses (`service-medic`, `path-finder`, `plan-reader`, `drift-hunter`, `slo-setter`, `quiet-pager`, `budget-guard`, `least-privilege`, `cluster-medic`).

### Glossary, commands, rescue and scenarios

- The new glossary, `commands:` and `flows:` lists start with only marker comments (`# --- World L1 terms … ---`). A list holding only comments reads as empty, so add your entries under your marker; there is no `[]` to remove.
- `commands.yaml` already has groups per course (Linux: `files`, `search`, `permissions`, `processes`, `packages`, `network`, `remote`, `scripts`; IaC: `loop`, `tidy`, `state`, `environments`; Observability: `check`, `ask`, `alerts`, `logs`; AWS: `setup`, `iam`, `network`, `storage`, `containers`, `money`; Kubernetes adds `admin` for K9). Every command's `group` must exist (`content-ids.test.ts`). An empty list shows "Command pages arrive with the lessons." and an empty glossary "Words arrive with the lessons."
- Rescue flow ids are unique across the family; start them with the course (`linux-`, `iac-`, `obs-`, `aws-`).
- Scenarios: each course has `scenarios/index.ts` (`allScenarios`, `scenarios`), registered in `src/content/courses/scenarios.ts` (`scenariosByCourse`, also used by `npm run check:mdx`). Put your world's states in their own file (`l1.ts`) and spread them into `allScenarios`. The engine that reads them defines the shape (linux-sim, tofu-sim, promql-sim; AWS games keep their presets here too).

### Pages and colours

- The overview and the Rescue Center are shared components: `src/components/pages/FamilyOverview.astro` (parts in their colours, world tiles with codes, missions, Rescue Center, finish line; slot `early` after the Rescue Center and a default slot at the end) with `FamilyExtra.astro` boxes, and `FamilyRescue.astro` (one section per part; with no flows it says "coming soon" calmly). Ship It uses them too and adds the night shift and the certification map.
- Family words come from `familyKeys(family)` in `catalog.ts`: Level Up uses `levelup.*` (title, subtitle, summary, intro, before, missions, missionsText with `{range}`, rescueTitle/Intro/FilterHint, certsText, startHere). Families appear in `FAMILIES` order (Ship It, then Level Up) everywhere: home, top bar, review cards.
- Course accents: `--course-linux`, `--course-iac`, `--course-observability`, `--course-aws`. White text passes AA on each (`src/styles/tokens.test.ts` checks every `--course-*`); the overview puts it on the "Part N" pill and the part's top strip.
- Certification map: Level Up adds LFCS (L1–L4), PCA (O1–O3), Terraform Associate (T1–T4; OpenTofu has no exam), AWS CLF-C02 and SAA-C03 (A1–A4), and CKA now points at K9. Each cert has a `family`; the page shows one section per family. Prices are USD before local tax (`70.5` shows "USD 70.50").
- Tests: `tests/e2e/level-up.spec.ts` (overview EN/MS, rescue, each map, tool pages, switcher, home card, certs, axe light and dark, 360 px).

## Check your work

```bash
npm run check:cards        # card ids match between en and ms
npm run check:readability  # sentence and card word limits
npx vitest run src/content # scenarios build and verify lists run
npm run verify:docker      # Docker scenarios: engine vs a real Docker daemon
npm run verify:linux       # Linux scenarios: engine vs a real Debian 13 machine (needs Docker)

npm run verify:manifests   # Kubernetes YAML the games ship passes kubeconform (needs Docker)
npm run verify:workflows   # CI/CD scenarios and .github/workflows vs actionlint (needs Docker)
npm run build              # every lesson renders
PW_PORT=4400 npm run test:e2e -- tests/e2e/all-lessons.spec.ts --project=desktop  # click through every ready lesson
```

## Look: the sticker stage (2026-11-02)

- **Stage and paper.** Every page sits on an indigo **stage** with a soft dot pattern (`body::before`, tokens `--stage-a/b`, `--stage-dot`). Text right on the stage is light (`[data-stage]` sets `--on-stage`; quiet text uses `--on-stage-muted`). Pages that are mostly text (glossary, settings, rescue, exams…) get one big paper **sheet** automatically. Playful pages pass `stage` to `Base.astro` (home, course maps, family overviews; lessons are `bare` and also on the stage) and put their content on stickers.
- **`.sticker`** (`global.css`): a white card with a thick ink outline (`--line`) and a hard offset shadow (`--lift-s`, `--lift`, `--lift-l`). Anything with text that sits on the stage must be a sticker, or set `color: var(--color-text)` on a light background. Calm mode turns the shadows off and the stage into plain paper.
- **Buttons** (`.btn`) are chunky stickers that press down. Mint = go (`.btn`), white (`.btn-ghost`), sun (`.btn-sun`), sky (`.btn-sky`), and the underlined `.btn-quiet`.
- **Headlines** use Bricolage Grotesque (`--font-head`, weight 800, self-hosted); body text stays Atkinson Hyperlegible Next or Lexend.
- **Focus ring:** sun yellow on the stage, blue on paper (`--focus-ring`; `.sheet` and `.sticker` switch it back to blue).
- **Top bar:** an ink bar with a level chip (100 XP a level; calm mode hides it). On phones (≤ 640 px) the menus become a tab bar at the bottom, each tab an icon plus a short word (`tab.*` strings).
- **Maps:** each world is a sticker; its lessons are a quest path of numbered stops. `applyMapMarks` marks stops done / known and the lesson you stopped in ("You are here", `aria-current="step"`).
- **Lessons:** a floating ink pill on top (map, card count, language), the card as a big sticker with a colour band per card type, an ink controls bar, and on wide screens Kancil's tip for the card type (`buddy.*` strings; calm mode hides it).

## Colour and motion helpers (2026-11-01)

- **Colours:** the brand is mint, sky and grape (`--brand-gradient`, `--brand-a/b/c`, `--candy-*` in `tokens.css`), plus a warm accent (`--warm`), one colour per card type (`--step-*`) and per course (`--course-git`, `--course-docker`, `--course-cicd`, `--course-kubernetes`; Level Up: `--course-linux`, `--course-iac`, `--course-observability`, `--course-aws`). Concept colours (`--c-*`) keep their Git meanings; don't reuse them for decoration.
- **`celebrate(element, pieces?)`** (`src/lib/celebrate.ts`): a confetti burst under a second, for a real win only (a card done, a lesson or drill finished). It does nothing in calm mode or with reduced motion.
- **`.pop-in`** on a list: its children rise in one after another (transform only, so contrast never dips). Give each child `style="--sibling-index: N"` for browsers without `sibling-index()`.
- **`.lift`** on a tile link: it rises a little under the pointer.
- **`h1.accent`**: the short sun bar under a page title.
- Page-to-page fades use cross-document view transitions (`global.css`); `Base.astro` skips them in calm mode.
- Every new animation runs once, stays under ~1 s, and is off in calm mode and with `prefers-reduced-motion`. `tests/e2e/delight.spec.ts` checks this.

## PromQL engine (PromQLPlayground, AlertRuleBuilder)

Level Up · Observability (`src/content/courses/observability/`) practises PromQL on a pure TypeScript Prometheus: `src/engine/promql-sim/` (Vitest-tested). Every answer it gives in a scenario's `verify` list is checked against the real **promtool** of Prometheus 3.13 LTS (`npm run verify:promql`, CI job `promql-truth`). Both interactives always read observability scenarios, from any course (no `course=` needed). They are on the hidden page `/en/dev/interactives/` (tests in `tests/e2e/promql.spec.ts`) and checked by `npm run check:mdx`.

### What the engine runs (Prometheus 3 semantics)

- **Selectors**: `name{label="x", a!="b", c=~"5..", d!~"x|y"}` (regexes anchored, `.` matches newlines), `{"utf8.name"}`, `[5m]` ranges (also plain seconds: `[300]`), `offset 5m` (also negative or seconds), `@ 300`, `@ start()`, `@ end()`. Windows are left-open: an instant selector looks back 5 minutes, `(t − 5m, t]`; a range is `(t − range, t]`. A stale marker ends a series at once.
- **Functions**: `rate` `irate` `increase` `delta` `idelta` `deriv` `predict_linear`, `avg_` `min_` `max_` `sum_` `count_` `last_` `present_` `quantile_over_time`, `changes` `resets`, `abs` `ceil` `floor` `round` `sqrt` `exp` `ln` `log2` `log10` `sgn`, `clamp` `clamp_min` `clamp_max`, `histogram_quantile` (classic `le` buckets), `label_replace` `label_join`, `absent` `absent_over_time`, `scalar` `vector` `time` `timestamp`, `sort` `sort_desc`. Range functions drop the metric name (except `last_over_time`).
- **Aggregations**: `sum avg min max count group topk bottomk quantile stddev stdvar`, with `by (…)` / `without (…)` before or after.
- **Operators**: `+ - * / % ^ atan2`, `== != > < >= <=` (filter, or `bool`), `and or unless`, with `on` / `ignoring` and `group_left` / `group_right (labels)`; one-to-one `on(...)` keeps only those labels, as in Prometheus. Arithmetic drops the metric name; comparisons keep it.
- **Errors** are Prometheus's own words, checked against promtool (`1:6: parse error: expected type range vector in call to function "rate", got instant vector`, `unclosed left parenthesis`, `found duplicate series for the match group …`, `vector cannot contain metrics with the same labelset` …), each with a plain line (`promql.err.<key>`). Real PromQL the engine doesn't run yet (subqueries `[30m:1m]`, `count_values`, `limitk`, the time-of-day and trig functions, native histograms) says so honestly (`engineLimit`) instead of a fake error.
- **Rules**: recording rules (written back as series, stale when they vanish) and alerting rules (`for`, `keep_firing_for`, `labels`, `annotations`), evaluated like promtool: every group at 0, 1m, 2m …; alerts go inactive → pending → firing and write `ALERTS` / `ALERTS_FOR_STATE`. Templates: `{{ $labels.x }}`, `{{ .Labels.x }}`, `{{ $value }}` (Go `%v`: `1.234567e+06`), pipes, `humanize`, `humanizePercentage`, `humanizeDuration`, `printf "%.2f"`, `toUpper`, `toLower`. Other template code (`if`, `range` …) is refused, never guessed.
- Values print like the Prometheus UI (`0.16666666666666666`, `+Inf`); floats add up the Prometheus way (Kahan), so results are the same doubles promtool prints.

### Scenarios (`src/content/courses/observability/scenarios/`)

One file per world, spread into `allObsScenarios` in `index.ts` (one per line). `examples.ts` has ten models: `o1-first-look` (two counters, one gauge), `o2-shop-requests` (request counters by instance and code; shop-2 restarts at 16m), `o2-recording` (+ two recording rules), `o2-latency` (a classic histogram; shop-1 slows down at 10m), `o2-node` (node-exporter-like CPU, memory, a filling disk, load), `o2-labels` (stall/item/outlet labels), `o2-staleness` (a removed thermometer vs a quiet one), `o3-target-down` (`up`; shop-1 down from 11m, a 3-minute db-1 blip), `o3-flappy` (a queue bouncing around 25), `o3-slow-burn` (an SLO with recording rules and a burn-rate alert).

```ts
{
  id: 'o3-target-down',
  about: 'One line: what the data shows.',
  interval: '1m',                    // scrape interval (promtool `interval`, default 1m)
  evaluationInterval: '1m',          // rule evaluation (default 1m)
  series: [
    { series: 'up{job="shop",instance="shop-1"}', values: '1x10 0x20' },   // promtool notation
  ],
  rules: [{ name: 'slo', rules: [{ record: 'job:x:rate5m', expr: '…' }] }],  // optional
  evalTime: '12m',                   // where the slider starts (default: the end of the data)
  metrics: ['up'],                   // metric chips (default: every name in the data)
  verify: [
    { expr: 'count(up == 0)', at: ['7m', '12m'] },
    { expr: 'rate(up)', at: ['5m'], error: true },               // must fail with promtool's words
    { alert: { alert: 'InstanceDown', expr: 'up == 0', for: '5m', labels: { severity: 'page' } }, at: ['12m', '16m'] },
  ],
}
```

- **Values** (promtool's notation): `0+10x30` = 0, 10, … 300 (31 values, repeated addition), `5x3` = four 5s, `_` and `_x3` = no sample, `stale` = a staleness marker. Sample `i` sits at `i × interval`.
- **Verify rules**: `at` times are multiples of the evaluation interval; results must be instant vectors or scalars (promtool can't check a range vector) and not NaN; alert names are unique in a scenario. promtool loads series in a **random order**, so a float sum over several series, an `avg`, a `topk` tie or the pair a "duplicate series" error names can change between runs: `verify:promql` re-runs every check under 42 series orders and refuses one whose answer depends on the order (use rounder numbers, e.g. `rate(x[5m]) * 60`, or drop it). `exp()` is left out of verify lists (Go's `math.Exp` can differ in the 16th digit).
- `npm run verify:promql` (needs Docker; `VERIFY_ONLY=o2` runs some; set `DOCKER_LOCK=/path/to/lockfile` on a shared daemon) writes each scenario as a promtool unit test whose `exp_samples` / `exp_alerts` are the **engine's** answers, runs `promtool test rules` in `quay.io/prometheus/prometheus:v3.13.5` and shows promtool's diff on any mismatch.

### PromQLPlayground

A query box (Enter runs, Shift+Enter is a new line), metric chips (tap: the name goes in at the caret), Run, the eval-time slider (every scrape interval; time 0 is the start), the result table (series and value; a range vector lists its samples), and a small line graph of the same query at every step: 2px lines in `--chart-1…6` (more than 6 series: neutral lines), a hairline grid, the eval time as the pink "you are here" line, a crosshair readout under the pointer, a legend whose buttons light one series up on hover / focus (tap pins it), and the graph as a folded table (the text alternative). Mistakes show Prometheus's words (red + icon), then the plain line. Nothing moves on its own.

```mdx
<Interactive name="PromQLPlayground" scenario="o2-shop-requests" initial="http_requests_total"
  prompt="Show requests per second for each status code, with the instances added up."
  goal={{ usesFunction: ['rate', 'sum'], labelNames: ['code'], resultCount: 3 }}
  hints={['Start with rate(http_requests_total[5m]).']} solution="sum by (code) (rate(http_requests_total[5m]))" />
```
- Props: `scenario` (required), `initial`, `prompt`, `metrics` (chips), `at` (slider start), `goal`, `hints` (one at a time after two misses), `success`, `solution` (never shown; `check:mdx` runs it), `graph={false}` (table only).
- `goal` (all optional, all must pass, checked at `goal.at` or the scenario's `evalTime`): `resultCount`, `resultEquals` / `resultIncludes` (`[{ labels: { code: '500' }, value?: 0.05, tolerance?: 0.001 }]`; the metric name only counts when you write `__name__`; tolerance is relative, default 1e-6), `labelNames` (every series has exactly these labels, name aside: `['code']`, or `[]` for one total), `resultType` (`vector` | `scalar` | `matrix`), `usesFunction` (functions or aggregations: `['rate', 'sum']`), `typed` (regex). A miss gets one kind, specific line (`promql.miss.*`: "You got 1 series. The task wants 3.").
- `check:mdx`: the scenario exists, goal keys and times are valid, chips exist, the `initial` query doesn't meet the goal and the `solution` does. Logic: `src/lib/promqlPlayground.ts`, graph geometry `src/lib/promGraph.ts`.

### AlertRuleBuilder

Build an alerting rule from blocks: **When** (`expr`), **Wait first** (`for`), optionally **Keep firing after** (`keep_firing_for`), **Labels** and **Message** (`annotations`). The `rules.yml` writes itself (≤ 15 lines, indent guides, long lines wrap), the value the alert watches is graphed with a dashed threshold (from `x > 25`, or the block's own `graph` / `threshold`), and a timeline shows each alert (one row per label set) **quiet** (grey) → **pending** (amber, ⏳) → **firing** (red, 🔔) over the scenario, as promtool evaluates it, with a text summary under each row ("⏳ pending 6m to 8m") and a folded table. The "Look at time" slider moves the pink marker and shows what on-call would see then (FIRING / PENDING with the expanded message). "Test the rule" checks the goal.

```mdx
<Interactive name="AlertRuleBuilder" scenario="o3-target-down" alert="InstanceDown"
  exprs={[{ expr: 'up == 0' }, { expr: 'up == 1', why: 'up == 1 is true when the target is fine.' }]}
  fors={['0s', '1m', '5m']}
  labels={[{ labels: {} }, { labels: { severity: 'page' } }]}
  annotations={[{ annotations: { summary: 'Something is down' } }, { annotations: { summary: '{{ $labels.instance }} is down' } }]}
  goal={{ firingAt: ['20m'], quietAt: ['7m'], noFlap: true, firingLabels: { instance: 'shop-1' }, labels: { severity: 'page' }, annotationUses: ['$labels.instance'] }}
  solution={{ expr: 0, for: 2, labels: 1, annotations: 1 }} />
```
- Props: `scenario`, `exprs` (`{ expr, label?, why?, graph?, threshold? }[]`, required), `alert` (the rule's name, default `KedaiAlert`), `fors` (default `['0s', '1m', '5m']`; `0s` shows "no wait"), `keepFiringFor` (`['0s', '5m']`; `0s` = "stop at once"), `labels` (`{ labels, label?, why? }[]`), `annotations` (`{ annotations, label?, why? }[]`), `start` and `solution` (block indexes `{ expr, for, keep, labels, annotations }`; the solution is never shown), `goal`, `prompt`, `hints`, `success`, `at`.
- `goal` (all optional): `firesBetween: ['10m', '15m']` (first firing), `quietBefore`, `firingAt: ['20m']`, `quietAt: ['7m']`, `noFlap` (each alert fires in one stretch), `firingLabels` (every alert that fires has these labels: the right target), `labels` (the rule carries them), `annotationUses` (text in a message template, e.g. `$labels.instance`). Flapping is reported first; then one kind line per miss (`promql.alertMiss.*`), plus the picked block's `why`.
- `check:mdx`: every expression parses, every template is one the engine expands, durations are valid, goal keys exist, the starting blocks miss the goal and the solution meets it, and the solution's YAML fits in 15 lines. Logic: `src/lib/alertRuleBuilder.ts`.

UI words: `promql.*` in `src/i18n/en.json` / `ms.json`. Chart colours: `--chart-1…6` in `tokens.css` (checked with the dataviz palette validator on both themes; light slots 3–5 are under 3:1 on white, so every chart has its table view).

## OpenTofu engine (TofuSim, PlanReader)

The Terraform & OpenTofu lessons (`src/content/courses/iac/`) run on `src/engine/tofu-sim/`: a pure TypeScript copy of **OpenTofu 1.13.5** on one laptop (no DOM, no network). It works like the other engines: `run(state, 'tofu plan')` returns `{ state, output, events, ok, exitCode, explain, stopped? }` and never changes the state it was given. `explain` is an i18n key under `tofu.explain.*` / `tofu.err.*` (the friendly line under the terminal). Output is the real CLI's, word for word: `npm run verify:tofu` runs every scenario's `verify` lists with the real OpenTofu 1.13.5 container and compares outputs, exit codes, `terraform.tfstate` after every command and the files at the end. Story: the `.tf` files are the architect's **blueprint**; `terraform.tfstate` is the building's register.

**What runs.** `tofu init` (provider install lines, `.terraform.lock.hcl` with the registry's real hashes, local modules), `validate`, `fmt` (`-check`, `-diff`, `-list=false`, `-recursive`), `plan` (`-out`, `-var`, `-var-file`, `-target`, `-replace`, `-refresh-only`, `-refresh=false`, `-destroy`, `-input=false`), `apply` (a saved plan, `-auto-approve`, or the real "Enter a value:" question — the next line typed is the answer), `destroy`, `refresh`, `show` (state or a saved plan, `-json`), `output` (`-json`, `-raw`, one name), `state list|show|mv|rm`, `import ADDR ID`, `providers`, `version`, `-no-color` everywhere. In a terminal, errors and warnings are drawn in the red `╷ │ ╵` gutter; with `-no-color` they print plain, like the real CLI. Shell: `ls [-a]`, `cat`, `rm [-r]`, `echo`/`printf` with `>` / `>>`, `mkdir`, `cp`, `mv`, `touch`, `pwd`, `clear`, `export TF_VAR_x=…`. `terraform …` answers "command not found" with a kind note (the laptop has OpenTofu). Explain-only (kind note, no fake output): `console`, `graph`, `taint`, `workspace`, `login`, `test`, `get`.

**Language.** Blocks, attributes, strings with `${}` interpolation, heredocs (`<<EOT`, `<<-EOT`), numbers, bools, lists, maps, objects, references, splats, conditionals, `for` expressions (lists and maps, `if`, grouping), operators; functions `format`, `formatlist`, `join`, `split`, `upper`, `lower`, `title`, `trimspace`, `replace`, `substr`, `length`, `toset`, `tolist`, `tomap`, `tostring`, `tonumber`, `lookup`, `merge`, `concat`, `coalesce`, `keys`, `values`, `contains`, `element`, `distinct`, `flatten`, `sort`, `range`, `zipmap`, `min`, `max`, `sum`, `jsonencode`, `jsondecode`, `base64encode`, `md5`, `sha1`, `sha256`, `file`, `fileexists`, `can`, `try`, … Variables (types incl. `object({ … optional() })`, defaults, `validation`, `sensitive`), `terraform.tfvars` + `*.auto.tfvars` + `-var` / `-var-file` / `TF_VAR_`, locals, outputs (`sensitive`), `count`, `for_each` (maps and sets), `depends_on`, `lifecycle` (`prevent_destroy`, `create_before_destroy`, `ignore_changes`), `moved` and `import` blocks, local modules (`source = "./modules/x"`) with inputs and outputs, data sources, `path.module`, `terraform.workspace`. Unknown values print `(known after apply)`; sensitive ones `(sensitive value)`.

**Providers** (the versions `tofu init` picks today): hashicorp/random 3.9.1 (`random_pet`, `random_integer`, `random_string`, `random_password`, `random_id`, `random_uuid`), hashicorp/local 2.9.1 (`local_file`, `local_sensitive_file`, data `local_file` / `local_sensitive_file` — files really appear in the project folder; a file changed or deleted by hand is drift: the next plan creates it again, `-refresh-only` reports "has been deleted"), hashicorp/null 3.3.2 (`null_resource`), and the built-in `terraform_data`. Random values come from a seeded generator (the same scenario always gives the same names); the truth check masks them. The only backend is the local state file; a `backend "s3"` (or any remote one) gets a kind "not in practice" error at `init`, and so do other providers and registry modules.

**Not modelled** (teach with `Transcript` and output you checked): remote backends and locking, workspaces, provider blocks with settings, `check` / `removed` blocks, `%{ }` template directives, `templatefile`, `tofu console`, `tofu test`, `-json` plan output.

### Scenarios

```ts
// src/content/courses/iac/scenarios/t2.ts (spread it into allScenarios in scenarios/index.ts)
{
  id: 't3-drift',
  files: { 'main.tf': MENU, '.next/main.tf': NEXT },   // project files; folders starting with "." stay out of the tabs
  steps: ['tofu init', 'tofu apply -auto-approve', { write: 'main.tf', content: '…' }, { delete: 'old.tf' }],
  verify: [['rm menu.txt', 'tofu plan', 'tofu apply', 'yes', 'tofu state list']],   // "yes" answers the question
  seed: 1,                 // random values (optional)
  engineOnly: 'why',       // skip the truth check (only when the real CLI can't run it)
}
```

- Every `steps` command must work. In `verify`, a line right after a command that asks a question is the answer (`yes`, a variable's value). Errors on purpose are fine (the truth check compares them too).
- `cp .next/main.tf main.tf` is how a list (or a PlanReader) switches to the "next version" of the blueprint.
- Random numbers: use ranges like `min = 100`, `max = 999`, so the masked value never looks like another number in the output.
- `tofu providers` lists a module's providers in a random order in real OpenTofu: the check compares them as a set.
- Model scenarios (`scenarios/examples.ts`): `t1-first-blueprint` (random_pet + local_file sign, an output), `t1-food-court` (pet, integer, file, terraform_data, null_resource), `t1-messy` (for `fmt`), `t1-typos` (validate errors), `t1-plan-reader` (create, update, destroy and replace in one plan), `t1-plan-file` (`-out`, stale plans), `t2-inputs` (variables, validation, tfvars, locals, functions), `t2-ask` (a required variable is asked for), `t2-many` (`count`, `for_each`), `t2-data` (data source, `depends_on`), `t3-drift` (drift, `-refresh-only`, `-target`, `-replace`, `state mv/rm`), `t3-moved`, `t3-import`, `t3-secrets` (`random_password`, secrets in the state file), `t3-lifecycle`, `t4-modules`.
- World T3–T4 scenarios (`scenarios/t3.ts`, `t4.ts`, goals tested in `t34.test.ts`): `t3-register` (built shop: find the state file), `t3-drift-menu` (a dish added to `menu.txt` by hand), `t3-import-door` (door code `KANCIL` set by hand; `.next` has the import block), `t3-rename` (stall renamed to chef; `.next` adds the moved block), `t3-register-big` (five things for `state list/show/rm`), `t3-secret-pin` (output missing `sensitive = true`), `t3-secret-built`, `t3-workspace` (`terraform.workspace` in a file name), `t3-boss-drift` / `-door` / `-rename`; `t4-kiosk` (a module used twice; `.next` adds a third), `t4-lock` and `t4-lock-new` (a new provider the lock file doesn't know), `t4-secret-env` (`TF_VAR_db_password`), `t4-grow` (count 1 → 3, a bigger oven, the fridge gone: for PlanReader), `t4-boss-module` (a refactor into modules without moved blocks), `t4-boss-lock`.
- Fixed for T3/T4 (2026-11-01, checked with OpenTofu 1.12.4 and 1.13.5): an import that changes nothing prints `# (imported from "ID")` and every attribute; a plan of only imports or moves with new outputs adds "You can apply this plan to save these new output values…"; a moved block also renames the address in other resources' `dependencies`; `tofu init` lists only modules it installs now, in name order; `tofu init -upgrade` says "Using previously-installed" for a provider already in `.terraform`; "No value for required variable" wraps as one paragraph; a CLI `tofu import` also saves the root outputs (what isn't built yet is saved as a typed null: `tofu output` prints `tostring(null)`).
- `VERIFY_ONLY=t3 npm run verify:tofu` checks some; `VERIFY_SHOW=1` prints both sides. Locally it uses the agent proxy for provider downloads (when `HTTPS_PROXY` is set) and a shared plugin cache; run it under the Docker lock (`flock <lock> npm run verify:tofu`). CI job `tofu-truth` (3 shards) must pass before deploy.
- World T1 and T2 scenarios (`scenarios/t1.ts`, `t2.ts`): `t1-sign` (one sign file), `t1-blocks` (pet + sign, `.next` greets in Malay), `t1-ready` / `t1-built` (pet + sign + output, init done / built), `t1-hours` (a `terraform_data` input to change in place), `t1-fix-me` (two validate errors), `t1-boss` / `t1-boss-next` / `t1-boss-done` (the food court: fresh, next version in place, built v2); `t2-vars` (a required variable is asked for), `t2-tfvars` (`terraform.tfvars` + `penang.tfvars`), `t2-outputs`, `t2-locals`, `t2-count` (the shifting-index trap in `.next/variables.tf`), `t2-for-each`, `t2-prices` (a map), `t2-recipe` / `t2-recipe-built` (a data source), `t2-functions` (outputs only), `t2-boss` / `t2-boss-built` (a map in `terraform.tfvars`). `src/content/courses/iac/scenarios/t1t2.test.ts` checks each lesson goal starts unmet and a learner's commands meet it.
- Fidelity scenarios (`scenarios/fidelity.ts`, no lesson uses them; unit tests in `src/engine/tofu-sim/__tests__/fidelity.test.ts`): output a learner can reach by typing freely, fixed on 2026-11-01 and pinned by verify lists. A variable whose value fails (wrong type, a broken `validation` rule) leaves out everything that uses it: the rest is still planned ("…but then encountered a problem:"), and with nothing left to show the plan is just `Planning failed.`; a wrong type names its source (`set using -var="x=..."`, `the TF_VAR_x environment variable`, `an interactive prompt`, or `declared at main.tf:1,1-18` for a `.tfvars` file); a question with no description has no blank line before `Enter a value:`. "Changes to Outputs" pads names to the longest output in the plan (changed or not); outputs (and `terraform_data` input/output) diff like JSON: a map shows bare keys and "unchanged attributes". Lists show one unchanged item before a change and one after, the rest as `# (N unchanged elements hidden)`; map keys line up on the longest key, unchanged ones included. `tofu output` / "Outputs:" print a list as `tolist([…])`, a set `toset([…])`, a map `tomap({…})` (`keys()` of a map gives a list; tuples and objects print bare). A string that becomes unknown is drawn as the old value removed, then `-> (known after apply)`: a heredoc ending `EOT -> (known after apply)`, and when it forces replacement the mark comes twice (`"x" # forces replacement -> (known after apply) # forces replacement`); a list that becomes unknown shows its old items with `-`. A one-line string that becomes several lines is a heredoc diff. `tofu plan -destroy` with nothing saved says `No changes. No objects need to be destroyed.`. `Missing required argument` names its block (`on main.tf line 1, in resource "local_file" "sign":`). `tofu output <missing>` is a normal diagnostic (wrapped at 78).
- Not checked yet (keep lessons away until a verify list covers them): diffs of a string that holds JSON (`"{…}"`, `"[…]"`), diffs of set-typed resource attributes.
- **Version.** The engine copies OpenTofu **1.13.5** (moved up from 1.12.4 on 2026-11-02, after every verify list matched the real 1.13.5). What a learner sees change from 1.12: a plan or apply with nothing to do prints only `No changes. Your infrastructure matches the configuration.` (the paragraph after it is gone); with `-target` it adds `Note: You used the -target option, so OpenTofu only checked resources…` (not with `-exclude`); `terraform.tfstate.backup` and the timestamped backups of `state mv/rm` use the state file's indented layout (1.12 wrote one line); `tofu version` and the state's `terraform_version` say 1.13.5. To move to another release: set `REAL_TOFU_VERSION` in `scripts/verify-tofu/real.ts` and `TOFU_VERSION` in `src/engine/tofu-sim/state.ts` (the check refuses a mismatch), try it first with `VERIFY_TOFU_IMAGE=ghcr.io/opentofu/opentofu:<version> npm run verify:tofu`, then bump `toolVersion` in `course.yaml` and the lessons.

### TofuSim

The project's files in tabs (a small editor with line numbers; `.tf` and `.tfvars` files), the practice terminal (same rules as the other sims: a real input, the phone key row, ↑ history, Tab completes), and the **blueprint vs built** picture: what the files ask for (blue) next to what is built (green, from the state), with the last plan's marks — `+ will be created` / `~ will change` (amber, dashed) and `−/+ will be replaced` / `− will be destroyed` (red, with an icon). `tofu destroy` and `tofu state rm` show a red danger note.

```mdx
<Interactive name="TofuSim" scenario="t1-first-blueprint"
  goal={{ resourceInState: ['random_pet.stall', 'local_file.sign'], outputExists: ['stall_name'] }}
  hints={['Type tofu init first.', 'Then tofu apply, and answer yes.']}
  success="Built from the blueprint: a stall name and its sign." />
```

| Prop | Type | What it does |
| --- | --- | --- |
| `scenario` | id | Starting state (`src/content/courses/iac/scenarios/`; TofuSim always reads the iac course) |
| `goal` | `TofuGoal` | Checked after every command and every edit; met → `success`, `data-done="true"` |
| `hints`, `success`, `prefill`, `intro` | | Like KitchenSim (`intro`: commands run and shown before the learner types) |
| `files` / `editable` | boolean | Show the file tabs (default `true`) / let the learner edit them (default `true`) |
| `open` | path | The tab open at the start (default `main.tf`) |
| `picture` | boolean | The blueprint vs built picture (default `true`) |
| `keys` | `string[]` | Phone key row (default `tofu init plan apply -auto-approve Tab ↑`) |

**Goal keys** (all optional; every key must pass): `resourceInState` / `resourceMissing` (addresses; `random_pet.helper` matches any of its instances), `outputEquals` (`{ sign: 'KEDAI KANCIL' }`, compared as `tofu output -raw` text), `outputExists`, `planSummary` (`{ add, change, destroy }` of the last plan), `stateCount` (managed instances), `filesExist`, `filesMissing`, `fileContains`, `fileNotContains`, `initialized`, `formatted` (every `.tf` file as `tofu fmt` leaves it), `typed`, `lastTyped` (regex). `check:mdx` refuses unknown keys, intro commands that fail, and a goal already met at the start.

### PlanReader

A real plan (the engine's own text), one card per resource with the "will be created" words hidden: the learner taps **create / update in place / destroy / replace** by reading the symbol (`+`, `~`, `-`, `-/+` or `+/-`), then, for a replace, which argument forces it (the line that ends `# forces replacement`). A miss gets a kind "Almost!" with the symbol's meaning and another go; the summary line appears at the end.

```mdx
<Interactive name="PlanReader" scenario="t1-plan-reader" commands={['cp .next/main.tf main.tf']} />
<Interactive name="PlanReader" scenario="t3-drift" flags="-destroy" askWhy={false} />
```

- `scenario` (iac), `commands` (run before planning), `flags` (extra plan flags), `askWhy` (default `true`), `prompt`, `success`. `check:mdx` makes sure the plan builds and has changes to read. Logic: `src/lib/planReader.ts`.

**Engine helpers** (import from `~/engine/tofu-sim`): `run`, `runAll`, `initialState`, `buildTofuScenario` / `buildTofuScenarioCached`, `checkTofuGoal`, `tofuPicture`, `promptOf` (the `Enter a value:` question), `parseState` / `serializeState`, `listInstances`, `loadConfig`, `formatSource`, `renderChange`, `DANGER`. Events: `initDone`, `planned` (`add`, `change`, `destroy`, `import`, `actions`), `applied`, `stateChanged`, `fileWritten`, `fileRemoved`, `formatted`, `validated`, `waiting`, `cancelled`, `cleared`, `error`. UI words: `tofu.*` in `src/i18n/en.json` / `ms.json`. Tests: `src/engine/tofu-sim/__tests__/`, `src/content/courses/iac/scenarios/scenarios.test.ts`, `tests/e2e/tofu.spec.ts`.
