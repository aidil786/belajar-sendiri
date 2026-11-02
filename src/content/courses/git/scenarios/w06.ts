// World 6 scenarios (Team Workflows). A small coffee-shop ordering site, "kopi".
// Workflows are taught with stories and games; the simulator shows real logs and lets
// the learner make the hotfix commit on a real hotfix branch (branches: World 3).
// Each `verify` list is replayed in real Git by `npm run verify:commands`.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const MENU = '<h1>Kopi Kita</h1>\n<ul>\n  <li>Kopi O</li>\n  <li>Teh Tarik</li>\n</ul>\n';
const CART = 'export const cart = [];\n';
const PAY_BUG = "const payButton = document.querySelector('#pay');\npayButton.addEventListener('clik', pay);\n";
const PAY_FIX = "const payButton = document.querySelector('#pay');\npayButton.addEventListener('click', pay);\n";

const start: ScenarioStep[] = ['mkdir kopi', 'cd kopi', 'git init'];

export const w06: Scenario[] = [
  // 6.1 GitHub Flow hook: everyone commits straight to main, half-done work included.
  {
    id: 'w06-l01',
    steps: [
      ...start,
      { write: 'index.html', content: MENU },
      'git add index.html',
      'git commit -m "Add menu page"',
      { write: 'cart.js', content: CART },
      'git add cart.js',
      'git commit -m "Add cart"',
      { write: 'search.js', content: '// TODO: search\n' },
      'git add search.js',
      'git commit -m "WIP search, do not ship"',
      { write: 'index.html', content: `${MENU}<p>Menu coming soon???</p>\n` },
      'git commit -am "quick menu change"',
    ],
    verify: [['git log --oneline']],
  },
  // 6.5 hook: a messy log nobody can turn into release notes.
  {
    id: 'w06-l05-messy',
    steps: [
      ...start,
      { write: 'index.html', content: MENU },
      'git add index.html',
      'git commit -m "stuff"',
      { write: 'cart.js', content: CART },
      'git add cart.js',
      'git commit -m "update"',
      { write: 'cart.js', content: `${CART}export const total = 0;\n` },
      'git commit -am "fix things"',
      { write: 'search.js', content: 'export function search() {}\n' },
      'git add search.js',
      'git commit -m "more changes"',
    ],
    verify: [['git log --oneline']],
  },
  // 6.5 Conventional Commits: labels that a tool (or you) can turn into a version number.
  {
    id: 'w06-l05',
    steps: [
      ...start,
      { write: 'index.html', content: MENU },
      'git add index.html',
      'git commit -m "feat: add menu page"',
      { write: 'cart.js', content: CART },
      'git add cart.js',
      'git commit -m "fix: correct price rounding"',
      { write: 'README.md', content: '# Kopi Kita\n\nRun `npm start`.\n' },
      'git add README.md',
      'git commit -m "docs: add setup steps to README"',
      { write: 'search.js', content: 'export function search() {}\n' },
      'git add search.js',
      'git commit -m "feat: add search box"',
      { write: 'cart.js', content: `${CART}export const total = 0;\n` },
      'git commit -am "fix: stop cart emptying itself"',
    ],
    verify: [['git log --oneline'], ['git log --oneline -n 2']],
  },
  // 6.7 Hotfix drill: 2.4.0 is tagged and live on main. On a new hotfix/pay-button branch
  // (made from that tag), the fix for pay.js is written but not committed.
  {
    id: 'w06-l07',
    steps: [
      ...start,
      { write: 'index.html', content: MENU },
      'git add index.html',
      'git commit -m "feat: add menu page"',
      { write: 'cart.js', content: CART },
      'git add cart.js',
      'git commit -m "feat: add cart"',
      { write: 'pay.js', content: PAY_BUG },
      'git add pay.js',
      'git commit -m "feat: add card payment"',
      'git tag -a v2.4.0 -m "Release 2.4.0"',
      'git switch -c hotfix/pay-button v2.4.0',
      { write: 'pay.js', content: PAY_FIX },
    ],
    verify: [
      ['git status'],
      ['git diff'],
      ['git branch'],
      ['git add pay.js', 'git commit -m "fix: make pay button work again"', 'git log --oneline'],
      ['git commit -am "fix(pay): listen for click, not clik"', 'git status', 'git log --oneline --all'],
    ],
  },
];
