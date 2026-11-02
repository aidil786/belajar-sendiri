// World 7 scenarios (Robots: Actions & CI/CD). Each lesson's simulator starting states (+ verify lists).
// Same diary project as Worlds 1–2. A workflow is just a file in the repo: Git saves it like any other.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const DAY1 = '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n';

/** The diary from World 1: README, a day 1 page and a .gitignore for logs (3 commits). */
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
  { write: '.gitignore', content: '*.log\n' },
  'git add .gitignore',
  'git commit -m "Ignore log files"',
];

/** The test workflow taught in lesson 7.2 (valid GitHub Actions syntax, same action majors as this repo's CI). */
export const CI_WORKFLOW =
  [
    'name: CI',
    'on: push',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - uses: actions/setup-node@v7',
    '        with:',
    '          node-version: 24',
    '      - run: npm ci',
    '      - run: npm test',
  ].join('\n') + '\n';

/** Dependabot version updates for npm packages and workflow actions (lesson 7.10). Format from docs.github.com. */
export const DEPENDABOT =
  [
    'version: 2',
    'updates:',
    '  - package-ecosystem: "npm"',
    '    directory: "/"',
    '    schedule:',
    '      interval: "weekly"',
    '  - package-ecosystem: "github-actions"',
    '    directory: "/"',
    '    schedule:',
    '      interval: "weekly"',
  ].join('\n') + '\n';

export const w07: Scenario[] = [
  // 7.2 Inside a workflow file: ci.yml is written but not committed yet.
  {
    id: 'w07-l02',
    steps: [...diary, { write: '.github/workflows/ci.yml', content: CI_WORKFLOW }],
    verify: [
      ['cat .github/workflows/ci.yml'],
      ['git status'],
      ['git status -s'],
      ['git add .github', 'git status -s'],
      ['git add .github', 'git commit -m "Add CI workflow"', 'git status -s', 'git log --oneline'],
      ['git add .', 'git commit -m "Add CI workflow"', 'git show --stat'],
    ],
  },
  // 7.10 Dependabot: the diary has a committed dependabot.yml.
  {
    id: 'w07-l10',
    steps: [...diary, { write: '.github/dependabot.yml', content: DEPENDABOT }, 'git add .github', 'git commit -m "Add Dependabot version updates"'],
    verify: [['cat .github/dependabot.yml', 'git status -s'], ['git log --oneline']],
  },
];
