// World 8 scenarios (Shields: Security). Each lesson's simulator starting states (+ verify lists).
// Same diary project as Worlds 1–2, now with a small weather widget that needs an API key.
// Every key here is FAKE and clearly marked: API_KEY=fake_demo_key_123. Never use a real token format.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const DAY1 = '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n';
/** The fake key. It only exists to practise. */
const ENV = 'API_KEY=fake_demo_key_123\n';
/** The weather widget reads the key from .env (the safe way). */
const APP = '// Weather widget\nconst key = process.env.API_KEY;\nshowWeather("Ipoh", key);\n';
/** The same widget with the key pasted right into the code (the risky way). */
const APP_HARDCODED = '// Weather widget\nconst key = "fake_demo_key_123";\nshowWeather("Ipoh", key);\n';

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

/** Diary + the weather widget AND .env, both committed by mistake in one commit (4 commits). */
const leaked: ScenarioStep[] = [
  ...diary,
  { write: 'app.js', content: APP },
  { write: '.env', content: ENV },
  'git add .',
  'git commit -m "Add weather widget"',
];

/** SECURITY.md for lesson 8.7. */
const POLICY = [
  '# Security policy',
  '',
  '## Report a security bug',
  'Please do not open a public issue.',
  'Use private vulnerability reporting on this repo.',
  'We will reply within 7 days.',
].join('\n') + '\n';

/** package.json for lesson 8.5. The package names are made up. */
const PACKAGE = [
  '{',
  '  "name": "my-diary",',
  '  "dependencies": {',
  '    "example-date-lib": "1.0.0",',
  '    "example-weather-lib": "2.4.1"',
  '  }',
  '}',
].join('\n') + '\n';

export const w08: Scenario[] = [
  // 8.2 Never commit secrets: a new widget (app.js) and a new .env with a fake key. Nothing ignores .env yet.
  {
    id: 'w08-l02',
    steps: [...diary, { write: 'app.js', content: APP }, { write: '.env', content: ENV }],
    verify: [
      ['cat .env', 'git status -s'],
      ['git add .', 'git status -s'],
      ['echo ".env" >> .gitignore', 'git status -s'],
      ['echo ".env" >> .gitignore', 'cat .gitignore', 'git add .', 'git status'],
      ['echo ".env" >> .gitignore', 'git add .', 'git commit -m "Add weather widget"', 'git status -s'],
      ['git add .', 'git restore --staged .env', 'echo ".env" >> .gitignore', 'git add .', 'git status -s'],
    ],
  },
  // 8.3 Secret scanning: a key pasted straight into app.js (not committed yet).
  {
    id: 'w08-l03',
    steps: [...diary, { write: 'app.js', content: APP }, 'git add app.js', 'git commit -m "Add weather widget"', { write: 'app.js', content: APP_HARDCODED }],
    verify: [['git diff'], ['git status -s']],
  },
  // 8.4 Leaked a key: .env was committed, then "removed" in a later commit. The key still lives in history.
  {
    id: 'w08-l04',
    steps: [...leaked, 'git rm --cached .env', { write: '.gitignore', content: '*.log\n.env\n' }, 'git add .gitignore', 'git commit -m "Stop tracking .env"'],
    verify: [['git log --oneline'], ['git status -s'], ['git show --stat HEAD~1']],
  },
  // 8.4 hook: the leak itself (the commit that went out).
  {
    id: 'w08-l04-leak',
    steps: leaked,
    verify: [['git log --oneline'], ['git show --stat']],
  },
  // 8.5 Dependabot alerts: the diary uses two (made-up) packages.
  {
    id: 'w08-l05',
    steps: [...diary, { write: 'package.json', content: PACKAGE }, 'git add package.json', 'git commit -m "Add packages"'],
    verify: [['cat package.json', 'git status -s']],
  },
  // 8.7 SECURITY.md: no policy yet. The learner writes one and commits it.
  {
    id: 'w08-l07',
    steps: diary,
    verify: [
      ['echo "Report bugs privately" > SECURITY.md', 'git add SECURITY.md', 'git commit -m "Add security policy"', 'git status -s', 'git log --oneline'],
      ['echo "Report bugs privately" > SECURITY.md', 'git status -s'],
    ],
  },
  // 8.7 A finished SECURITY.md to read.
  {
    id: 'w08-l07-policy',
    steps: [...diary, { write: 'SECURITY.md', content: POLICY }, 'git add SECURITY.md', 'git commit -m "Add security policy"'],
    verify: [['cat SECURITY.md', 'git status -s']],
  },
  // 8.8 Signed commits: a change is ready in the box.
  {
    id: 'w08-l08',
    steps: [...diary, { write: 'index.html', content: `${DAY1}<footer>By Siti</footer>\n` }, 'git add index.html'],
    verify: [
      ['git config --global user.name "Siti"', 'git commit -m "Add footer"', 'git log -n 1'],
      ['git config --global gpg.format ssh', 'git config --global user.signingkey ~/.ssh/id_ed25519.pub', 'git config --global commit.gpgsign true', 'git status -s'],
    ],
  },

  // Boss 1: .env (with a fake key) went into the last commit. It is NOT pushed yet.
  {
    id: 'w08-boss-1',
    steps: leaked,
    verify: [['git show --stat'], ['git rm --cached .env', 'git status -s'], ['git rm --cached .env', 'git status']],
  },
  // Boss 2: .env is out of the box, but nothing ignores it yet.
  {
    id: 'w08-boss-2',
    steps: [...leaked, 'git rm --cached .env'],
    verify: [['echo ".env" >> .gitignore', 'git add .gitignore', 'git status -s']],
  },
  // Boss 3: ready to fix the commit itself.
  {
    id: 'w08-boss-3',
    steps: [...leaked, 'git rm --cached .env', 'echo ".env" >> .gitignore', 'git add .gitignore'],
    verify: [
      ['git commit --amend --no-edit', 'git status -s', 'git log --oneline', 'git show --stat'],
      ['git status'],
    ],
  },
];
