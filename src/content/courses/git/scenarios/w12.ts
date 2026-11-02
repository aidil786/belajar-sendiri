// World 12 scenarios. Each lesson's simulator starting states (+ verify lists).
// Career Quest is mostly real-world work, so only two lessons need the simulator.
// They use World 1-2 features only (one branch, no remotes).
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const DAY1 = '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n';

/** The diary from World 1, plus a menu commit that broke the page (3 commits). */
const diaryWithBadMenu: ScenarioStep[] = [
  'mkdir diary',
  'cd diary',
  'git init',
  { write: 'README.md', content: '# My Diary\n' },
  'git add README.md',
  'git commit -m "Add README"',
  { write: 'index.html', content: DAY1 },
  'git add index.html',
  'git commit -m "Add day 1 page"',
  { write: 'menu.html', content: '<nav>\n<a href="/">Home</a>\n<a href="/nope">Broken link</a>\n</nav>\n' },
  'git add menu.html',
  'git commit -m "Add broken menu"',
];

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-10-30
### Added
- Dark mode switch.
### Fixed
- Notes save on phones again.
`;

/** A small notes app with messy commit messages and a new, untracked CHANGELOG.md. */
const notesApp: ScenarioStep[] = [
  'mkdir notes-app',
  'cd notes-app',
  'git init',
  { write: 'README.md', content: '# Notes App\nA tiny app for fast notes.\n' },
  'git add README.md',
  'git commit -m "wip"',
  { write: 'app.js', content: 'const notes = [];\n' },
  'git add app.js',
  'git commit -m "stuff"',
  { write: 'app.js', content: 'const notes = [];\nexport function save(note) {\n  notes.push(note);\n}\n' },
  'git commit -am "fix again"',
  { write: 'CHANGELOG.md', content: CHANGELOG },
];

export const w12: Scenario[] = [
  // 12.4 Interview questions: "What is HEAD?" and "reset or revert?" on a 3-commit diary.
  {
    id: 'w12-l04',
    steps: diaryWithBadMenu,
    verify: [['git log --oneline'], ['git revert --no-edit HEAD', 'git log --oneline', 'git status -s']],
  },

  // 12.6 Docs and changelogs: messy log, then commit the new CHANGELOG.md with a docs: message.
  {
    id: 'w12-l06',
    steps: notesApp,
    verify: [['git log --oneline'], ['git status -s'], ['git add CHANGELOG.md', 'git commit -m "docs: add changelog"', 'git log --oneline']],
  },
];
