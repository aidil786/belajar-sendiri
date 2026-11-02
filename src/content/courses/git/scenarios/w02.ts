// Starting states for World 2 lessons (Undo Magic). Same diary project as World 1.
// Each `verify` list is replayed in real Git by `npm run verify:commands`, so the
// simulator never drifts from Git. Verify lists use HEAD~n / HEAD@{n}, not hashes.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const DAY1 = '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n';
const DAY2 = `${DAY1}<p>Day 2: I learned undo.</p>\n`;
const DAY3 = `${DAY2}<p>Day 3: I found the reflog.</p>\n`;
const STYLE = 'body { color: purple; }\n';

/** The diary from World 1: README, a day 1 page and a style sheet (3 commits). */
const diary: ScenarioStep[] = [
  'mkdir diary',
  'cd diary',
  'git init',
  { write: 'README.md', content: '# My Diary\n' },
  'git add README.md',
  'git commit -m "Add README"',
  { write: 'index.html', content: DAY1 },
  'git add index.html',
  'git commit -m "Add day 1 page"',
  { write: 'style.css', content: STYLE },
  'git add style.css',
  'git commit -m "Add style"',
];

/** Diary + a 4th commit that adds a day 2 entry to index.html. */
const diaryDay2: ScenarioStep[] = [...diary, { write: 'index.html', content: DAY2 }, 'git commit -am "Add day 2 entry"'];

/** Diary + day 2 + day 3 entries (5 commits). */
const diaryDay3: ScenarioStep[] = [...diaryDay2, { write: 'index.html', content: DAY3 }, 'git commit -am "Add day 3 entry"'];

/** A day 2 page committed without its style sheet (day2.css is still untracked). */
const forgotFile: ScenarioStep[] = [
  ...diary,
  { write: 'day2.html', content: '<h1>Day 2</h1>\n<p>I learned undo.</p>\n' },
  { write: 'day2.css', content: 'h1 { color: teal; }\n' },
  'git add day2.html',
  'git commit -m "Add day 2 page"',
];

/** A bad style commit, then a good commit that only touches index.html. */
const badStyle = (css: string, message: string): ScenarioStep[] => [
  ...diary,
  { write: 'style.css', content: css },
  `git commit -am "${message}"`,
  { write: 'index.html', content: DAY2 },
  'git commit -am "Add day 2 entry"',
];

export const w02: Scenario[] = [
  // 2.1 Throw away a change: index.html is broken, style.css has a good change.
  {
    id: 'w02-l01',
    steps: [
      ...diary,
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>oops oops oops</p>\n' },
      { write: 'style.css', content: `${STYLE}h1 { color: teal; }\n` },
    ],
    verify: [
      ['git status -s'],
      ['git diff index.html'],
      ['git restore index.html', 'git status -s'],
      ['git restore style.css', 'git status -s'],
      ['rm README.md', 'git status -s', 'git restore README.md', 'git status -s'],
    ],
  },

  // 2.2 Take it out of the box: index.html is ready, style.css is half-done. Both are staged.
  {
    id: 'w02-l02',
    steps: [
      ...diary,
      { write: 'index.html', content: DAY2 },
      { write: 'style.css', content: `${STYLE}/* TODO: pick a font */\n` },
      'git add .',
    ],
    verify: [
      ['git status'],
      ['git status -s'],
      ['git restore --staged style.css', 'git status -s'],
      ['git restore --staged style.css', 'git diff'],
    ],
  },

  // 2.3 Fix the last commit: a typo in the last message.
  {
    id: 'w02-l03',
    steps: [
      ...diary,
      { write: 'day2.html', content: '<h1>Day 2</h1>\n<p>I learned undo.</p>\n' },
      'git add day2.html',
      'git commit -m "Add day 2 pgae"',
    ],
    verify: [
      ['git log --oneline'],
      ['git commit --amend -m "Add day 2 page"', 'git log --oneline'],
    ],
  },
  // 2.3 Fix the last commit: a forgotten file.
  {
    id: 'w02-l03b',
    steps: forgotFile,
    verify: [
      ['git status -s'],
      ['git add day2.css', 'git commit --amend --no-edit', 'git status -s', 'git log --oneline'],
    ],
  },

  // 2.4 Reset lab: the last commit adds a day 2 entry.
  {
    id: 'w02-l04',
    steps: diaryDay2,
    verify: [
      ['git reset --soft HEAD~1', 'git status -s', 'git log --oneline'],
      ['git reset --mixed HEAD~1', 'git status -s'],
      ['git reset HEAD~1', 'git status -s', 'git log --oneline'],
      ['git reset --hard HEAD~1', 'git status -s', 'git log --oneline'],
    ],
  },

  // 2.5 Undo safely with revert: "Make heading blink" is bad; a later commit only touches index.html.
  {
    id: 'w02-l05',
    steps: badStyle(`${STYLE}h1 { animation: blink 0.3s infinite; }\n`, 'Make heading blink'),
    verify: [
      ['git log --oneline'],
      ['git revert --no-edit HEAD~1', 'git log --oneline', 'git status -s'],
    ],
  },

  // 2.7 Detached HEAD: 4 commits on main.
  {
    id: 'w02-l07',
    steps: diaryDay2,
    verify: [
      ['git switch --detach HEAD~2', 'git status', 'git switch main'],
      ['git checkout HEAD~2', 'git switch main', 'git log --oneline'],
      ['git switch --detach HEAD~2', 'git switch -'],
    ],
  },
  // 2.7 Detached HEAD: already visiting an old commit.
  {
    id: 'w02-l07b',
    steps: [...diaryDay2, 'git switch --detach HEAD~2'],
    verify: [['git status'], ['git switch main', 'git log --oneline']],
  },

  // 2.8 Clean up junk files: two junk files, a junk folder and an ignored log.
  {
    id: 'w02-l08',
    steps: [
      ...diary,
      { write: '.gitignore', content: '*.log\n' },
      'git add .gitignore',
      'git commit -m "Ignore log files"',
      { write: 'test.html', content: '<p>test</p>\n' },
      { write: 'index-copy.html', content: DAY1 },
      { write: 'tmp/scribble.txt', content: 'asdf\n' },
      { write: 'debug.log', content: 'debug: page loaded\n' },
    ],
    verify: [
      ['git status -s'],
      ['git clean -n'],
      ['git clean -n -d'],
      ['git clean -f', 'git status -s'],
      ['git clean -n -d', 'git clean -f -d', 'git status -s'],
      ['git clean -fd', 'git status -s'],
    ],
  },

  // 2.9 Reflog: before the accident (for the hook animation).
  {
    id: 'w02-l09a',
    steps: diaryDay3,
    verify: [['git reset --hard HEAD~1', 'git log --oneline']],
  },
  // 2.9 Reflog: after an accidental reset --hard, "Add day 3 entry" is lost.
  {
    id: 'w02-l09',
    steps: [...diaryDay3, 'git reset --hard HEAD~1'],
    verify: [['git reflog'], ['git reset --hard HEAD@{1}', 'git log --oneline'], ['git log --oneline']],
  },

  // Boss 1: a secret file went into the box with a ready file.
  {
    id: 'w02-boss-1',
    steps: [...diary, { write: 'index.html', content: DAY2 }, { write: 'secret.txt', content: 'My crush is...\n' }, 'git add .'],
    verify: [['git status'], ['git restore --staged secret.txt', 'git status -s']],
  },
  // Boss 2: a typo in the last commit message.
  {
    id: 'w02-boss-2',
    steps: [...diary, { write: 'index.html', content: DAY2 }, 'git commit -am "Add day 2 entyr"'],
    verify: [['git commit --amend -m "Add day 2 entry"', 'git log --oneline']],
  },
  // Boss 3: day2.css was left out of the last commit.
  {
    id: 'w02-boss-3',
    steps: forgotFile,
    verify: [['git add day2.css', 'git commit --amend --no-edit', 'git status -s', 'git log --oneline']],
  },
  // Boss 4: debug.log was committed by mistake.
  {
    id: 'w02-boss-4',
    steps: [
      ...diary,
      { write: 'index.html', content: DAY2 },
      { write: 'debug.log', content: 'debug: page loaded\n' },
      'git add .',
      'git commit -m "Add day 2 entry"',
    ],
    verify: [
      ['git rm --cached debug.log', 'git commit --amend --no-edit', 'git status -s', 'git log --oneline'],
    ],
  },
  // Boss 5: an accidental reset --hard threw away two commits.
  {
    id: 'w02-boss-5',
    steps: [...diaryDay3, 'git reset --hard HEAD~2'],
    verify: [['git reflog', 'git reset --hard HEAD@{1}', 'git log --oneline']],
  },
  // Boss 6: a shared bad commit (dark mode), then a good commit that only touches index.html.
  {
    id: 'w02-boss-6',
    steps: badStyle('body { color: purple; background: black; }\n', 'Add dark mode'),
    verify: [['git revert --no-edit HEAD~1', 'git log --oneline', 'git status -s']],
  },
];
