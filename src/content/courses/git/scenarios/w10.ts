// World 10 scenarios. Each lesson's simulator starting states (+ verify lists).
// Object ids are real SHA-1s, so these use `exactHashes`: `npm run verify:commands`
// compares every id with real Git too. Keep one commit per command in the steps
// (no stash or rebase) so the ids stay identical.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const page = (lines: string[]) => `${lines.join('\n')}\n`;

/** A tiny shop site with a css/ folder, three commits and an annotated tag. */
const shop: ScenarioStep[] = [
  'mkdir shop',
  'cd shop',
  'git init',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>', '<p>Fresh kuih every day.</p>']) },
  { write: 'css/style.css', content: 'h1 { color: green; }\n' },
  'git add .',
  'git commit -m "Add shop page"',
  { write: 'about.html', content: page(['<h1>About us</h1>']) },
  'git add about.html',
  'git commit -m "Add about page"',
  'git tag -a v1.0 -m "First shop release"',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>', '<p>Fresh kuih every day.</p>', '<p>Open 9am to 6pm.</p>']) },
  'git commit -am "Add opening hours"',
];

/** main and a merged feature branch, then one more commit: for HEAD^2, A..B and A...B. */
const branches: ScenarioStep[] = [
  'mkdir shop',
  'cd shop',
  'git init',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>']) },
  'git add index.html',
  'git commit -m "Add shop page"',
  'git switch -c menu',
  { write: 'menu.html', content: page(['<h1>Menu</h1>', '<p>Kuih lapis</p>']) },
  'git add menu.html',
  'git commit -m "Add menu page"',
  { write: 'menu.html', content: page(['<h1>Menu</h1>', '<p>Kuih lapis</p>', '<p>Onde-onde</p>']) },
  'git commit -am "Add onde-onde"',
  'git switch main',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>', '<p>Open daily</p>']) },
  'git commit -am "Say we open daily"',
  'git merge menu -m "Merge menu"',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>', '<p>Open daily</p>', '<a href="menu.html">Menu</a>']) },
  'git commit -am "Link the menu"',
  'git switch -c prices',
  { write: 'menu.html', content: page(['<h1>Menu</h1>', '<p>Kuih lapis RM1</p>', '<p>Onde-onde</p>']) },
  'git commit -am "Add a price"',
  'git switch main',
  { write: 'about.html', content: page(['<h1>About</h1>']) },
  'git add about.html',
  'git commit -m "Add about page"',
];

/** Three people, a bug that sneaks in, and a fix: for log -S/-G, grep, blame, shortlog. */
const history: ScenarioStep[] = [
  'mkdir shop',
  'cd shop',
  'git init',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>']) },
  'git add index.html',
  'git commit -m "Add shop page"',
  'git config user.name "Aisyah"',
  'git config user.email aisyah@example.com',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>', '<p>Price: RM10</p>']) },
  'git commit -am "Add the price"',
  'git config user.name "Ben"',
  'git config user.email ben@example.com',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>', '<p>Price: RM10</p>', '<footer>TODO: phone</footer>']) },
  'git commit -am "Add a footer"',
  { write: 'style.css', content: 'footer { color: grey; }\n' },
  'git add style.css',
  'git commit -m "Style the footer"',
  'git config user.name "Aisyah"',
  'git config user.email aisyah@example.com',
  { write: 'index.html', content: page(['<h1>Kedai Kancil</h1>', '<p>Price: RM10</p>', '<footer>Call 03-1234 5678</footer>']) },
  'git commit -am "Fix the footer phone"',
  'git config --unset user.name',
  'git config --unset user.email',
];

/**
 * Ten commits on index.html. "Tidy up spacing" (HEAD~4) quietly changes the price
 * from RM10 to RM0. test.sh passes while the page still says RM10.
 */
const H1 = '<h1>Kedai Kancil</h1>';
const OK = '<p class="price">RM10</p>';
const BROKEN = '<p class="price">RM0</p>';
const PHOTO = '<img src="kuih.png" alt="Kuih">';
const HOURS = '<p>Open 9am to 6pm</p>';
const MENU = '<a href="menu.html">Menu</a>';
const FOOTER = '<footer>Kedai Kancil</footer>';
const PHONE = '<p>Call 03-1234 5678</p>';
const MAP = '<a href="map.html">Map</a>';
const FAQ = '<a href="faq.html">FAQ</a>';
const bisectLines = [
  [H1, OK],
  [H1, PHOTO, OK],
  [H1, PHOTO, OK, HOURS],
  [H1, PHOTO, OK, HOURS, MENU],
  [H1, PHOTO, OK, HOURS, MENU, FOOTER],
  [H1, PHOTO, BROKEN, HOURS, MENU, FOOTER],
  [H1, PHOTO, BROKEN, HOURS, PHONE, MENU, FOOTER],
  [H1, PHOTO, BROKEN, HOURS, PHONE, MENU, MAP, FOOTER],
  [H1, PHOTO, BROKEN, HOURS, PHONE, MENU, MAP, FAQ, FOOTER],
  [H1, PHOTO, BROKEN, HOURS, PHONE, MENU, MAP, FAQ, '<footer>Kedai Kancil 2026</footer>'],
];
const bisectMessages = [
  'Add shop page',
  'Add a photo',
  'Add opening hours',
  'Add a menu link',
  'Add a footer',
  'Tidy up spacing',
  'Add phone number',
  'Add map link',
  'Add FAQ link',
  'Update footer year',
];
const bisect: ScenarioStep[] = [
  'mkdir shop',
  'cd shop',
  'git init',
  { write: 'test.sh', content: page(['# Is the price still right?', 'grep -q "RM10" index.html']) },
  { write: 'index.html', content: page(bisectLines[0]!) },
  'git add .',
  `git commit -m "${bisectMessages[0]}"`,
  ...bisectLines.slice(1).flatMap((lines, i): ScenarioStep[] => [
    { write: 'index.html', content: page(lines) },
    `git commit -am "${bisectMessages[i + 1]}"`,
  ]),
];

/** A small diary repo for worktrees and aliases. */
const diary: ScenarioStep[] = [
  'mkdir diary',
  'cd diary',
  'git init',
  { write: 'index.html', content: page(['<h1>My Diary</h1>', '<p>Day 1</p>']) },
  'git add index.html',
  'git commit -m "Add home page"',
  { write: 'index.html', content: page(['<h1>My Diary</h1>', '<p>Day 1</p>', '<p>Day 2</p>']) },
  'git commit -am "Add day 2"',
];

/** The shop, plus a note that is not in Git yet: for git hash-object -w (lesson 3). */
const plumbing: ScenarioStep[] = [...shop, { write: 'notes.txt', content: 'Kuih lapis\n' }];

/** The diary with a shared hooks folder in the repo: for core.hooksPath (lesson 8). */
const hooks: ScenarioStep[] = [
  ...diary,
  {
    write: '.githooks/pre-commit',
    content: page([
      '#!/bin/sh',
      '# Stop the commit if a staged line adds console.log',
      'if git diff --cached | grep -q "^+.*console.log"; then',
      '  echo "Please remove console.log first."',
      '  exit 1',
      'fi',
    ]),
  },
  'git add .githooks',
  'git commit -m "Add a shared pre-commit hook"',
];

/**
 * Boss: fourteen commits on an order page. "Clean up the form" (HEAD~5) quietly
 * disables the Buy button. "Fix button colour" sounds guilty but only adds style.css.
 * test.sh passes while the button is not disabled.
 */
const T = '<h1>Order kuih</h1>';
const T2 = '<h1>Order your kuih</h1>';
const FORM = '<form action="/order">';
const QTY = '<input name="qty" value="1">';
const NOTE = '<textarea name="note"></textarea>';
const PICKUP = '<label>Pickup time <input name="time"></label>';
const BUY = '<button>Buy</button>';
const BUY_BROKEN = '<button disabled>Buy</button>';
const END = '</form>';
const PAY = '<p>Pay at the counter.</p>';
const HALAL = '<p>Halal kitchen</p>';
const CALL = '<p>Call 03-1234 5678</p>';
const MENU_LINK = '<a href="menu.html">See the menu</a>';
const CLOSED = '<p>Closed on Mondays</p>';
const FOOT = '<footer>Kedai Kancil</footer>';
const FOOT_YEAR = '<footer>Kedai Kancil 2026</footer>';
type BossStep = { lines: string[]; message: string } | { style: string; message: string };
const bossSteps: BossStep[] = [
  { lines: [T, FORM, BUY, END], message: 'Add order page' },
  { lines: [T, FORM, QTY, BUY, END], message: 'Add a quantity box' },
  { lines: [T, FORM, QTY, NOTE, BUY, END], message: 'Add a note box' },
  { lines: [T, FORM, QTY, NOTE, BUY, END, PAY], message: 'Add payment note' },
  { lines: [T2, FORM, QTY, NOTE, BUY, END, PAY], message: 'Reword the title' },
  { lines: [T2, FORM, QTY, NOTE, BUY, END, PAY, HALAL], message: 'Add halal note' },
  { lines: [T2, FORM, QTY, NOTE, PICKUP, BUY, END, PAY, HALAL], message: 'Add pickup time' },
  { style: 'button { color: white; background: green; }\n', message: 'Fix button colour' },
  { lines: [T2, FORM, QTY, NOTE, PICKUP, BUY_BROKEN, END, PAY, HALAL], message: 'Clean up the form' },
  { lines: [T2, FORM, QTY, NOTE, PICKUP, BUY_BROKEN, END, PAY, HALAL, CALL], message: 'Add phone number' },
  { lines: [T2, FORM, QTY, NOTE, PICKUP, BUY_BROKEN, END, PAY, HALAL, CALL, MENU_LINK], message: 'Link the menu' },
  { lines: [T2, FORM, QTY, NOTE, PICKUP, BUY_BROKEN, END, PAY, HALAL, CALL, MENU_LINK, FOOT], message: 'Add a footer' },
  { lines: [T2, FORM, QTY, NOTE, PICKUP, BUY_BROKEN, END, PAY, HALAL, CALL, CLOSED, MENU_LINK, FOOT], message: 'Add closing day' },
  { lines: [T2, FORM, QTY, NOTE, PICKUP, BUY_BROKEN, END, PAY, HALAL, CALL, CLOSED, MENU_LINK, FOOT_YEAR], message: 'Update footer year' },
];
const boss: ScenarioStep[] = [
  'mkdir kedai',
  'cd kedai',
  'git init',
  { write: 'test.sh', content: page(['# Can customers press Buy?', '! grep -q "disabled" order.html']) },
  ...bossSteps.flatMap((s, i): ScenarioStep[] => {
    if ('style' in s) return [{ write: 'style.css', content: s.style }, 'git add style.css', `git commit -m "${s.message}"`];
    if (i === 0) return [{ write: 'order.html', content: page(s.lines) }, 'git add .', `git commit -m "${s.message}"`];
    return [{ write: 'order.html', content: page(s.lines) }, `git commit -am "${s.message}"`];
  }),
];

/** Step lists, also used by the engine's error-case fixtures (src/engine/git-sim/__tests__/fixtures.ts). */
export const W10_STEPS = { shop, branches, history, bisect, diary, plumbing, hooks, boss };

export const w10: Scenario[] = [
  {
    id: 'w10-objects',
    exactHashes: true,
    steps: shop,
    verify: [
      ['git cat-file -t HEAD', 'git cat-file -p HEAD', 'git cat-file -s HEAD', 'git cat-file -p HEAD^{tree}', 'git cat-file -t HEAD:css', 'git cat-file -p HEAD:css/style.css'],
      ['git ls-tree HEAD', 'git ls-tree -r HEAD', 'git ls-tree HEAD css', 'git ls-tree -r --name-only HEAD~1', 'git ls-tree -l HEAD'],
      ['git hash-object index.html', 'echo "Kuih lapis" > notes.txt', 'git hash-object notes.txt', 'git hash-object -w notes.txt', 'git cat-file -t 17e284d', 'git cat-file -p 17e284d'],
      ['git rev-parse HEAD', 'git rev-parse --short HEAD~1', 'git rev-parse HEAD~2', 'git rev-parse HEAD^{tree}', 'git rev-parse HEAD:index.html', 'git rev-parse --abbrev-ref HEAD', 'git rev-parse --show-toplevel'],
      ['git cat-file -t v1.0', 'git cat-file -p v1.0', 'git rev-parse v1.0', 'git rev-parse v1.0^{}', 'git show-ref', 'git show-ref --tags -d'],
      ['cat .git/HEAD', 'cat .git/refs/heads/main', 'cat .git/refs/tags/v1.0', 'git switch --detach HEAD~1', 'cat .git/HEAD', 'git switch main'],
      ['git pack-refs --all', 'cat .git/packed-refs', 'echo "<p>New</p>" >> about.html', 'git commit -am "Add a line"', 'cat .git/refs/heads/main', 'cat .git/packed-refs', 'git show-ref --heads'],
    ],
  },
  {
    id: 'w10-revisions',
    exactHashes: true,
    steps: branches,
    verify: [
      ['git log --oneline', 'git rev-parse HEAD~1', 'git rev-parse HEAD~2', 'git rev-parse HEAD~2^1', 'git rev-parse HEAD~2^2', 'git log --oneline -1 HEAD~2^2~1'],
      ['git log --oneline HEAD~2..HEAD', 'git log --oneline main..prices', 'git log --oneline prices..main', 'git log --oneline main...prices', 'git log --oneline --left-right main...prices'],
      ['git diff main...prices', 'git rev-parse main...prices', 'git rev-parse HEAD~1..HEAD'],
      // Lesson 5: the graph, walking back with ~ and ^, and HEAD@{1}.
      ['git log --oneline --graph --all', 'git switch --detach HEAD~2', 'git log --oneline -1', 'git switch main', 'git switch --detach HEAD~2^2~1', 'git log --oneline -1', 'git switch main', 'git rev-parse --short HEAD~2^2', 'git rev-parse --short HEAD~3', 'git log --oneline -1 HEAD^'],
    ],
  },
  {
    id: 'w10-search',
    exactHashes: true,
    steps: history,
    verify: [
      ['git log -S "TODO" --oneline', 'git log -S "RM10" --oneline', 'git log -G "phone|Call" --oneline', 'git log -G "Call" -p'],
      ['git log --author=Aisyah --oneline', 'git log --author=Ben --oneline', 'git log --grep=footer --oneline', 'git log --grep=FOOTER -i --oneline'],
      ['git grep -n Kancil', 'git grep footer', 'git grep TODO HEAD~2', 'git grep -c p', 'git grep nothing-here'],
      ['git blame index.html', 'git blame style.css', 'git blame -L 2,3 index.html', 'git blame HEAD~2 -- index.html'],
      ['git shortlog HEAD', 'git shortlog -sn HEAD', 'git shortlog -sne HEAD'],
      // Lesson 6 demos.
      ['git grep -n footer', 'git log --author=Ben --oneline', 'git log --grep=footer --oneline'],
    ],
  },
  {
    id: 'w10-bisect',
    exactHashes: true,
    steps: bisect,
    verify: [
      ['sh test.sh', 'git bisect start', 'git bisect bad', 'git bisect good HEAD~9', 'sh test.sh', 'git bisect good', 'git bisect bad', 'git bisect good', 'git bisect log', 'git bisect reset'],
      ['git bisect start HEAD HEAD~9', 'git bisect good', 'git status', 'git bisect bad', 'git bisect bad', 'git bisect log', 'git bisect reset'],
      ['git bisect start HEAD HEAD~9', 'git bisect run sh test.sh', 'git bisect reset'],
      ['git bisect start HEAD HEAD~9', 'git bisect skip', 'git bisect skip', 'git bisect good', 'git bisect bad', 'git bisect log', 'git bisect reset'],
    ],
  },
  {
    id: 'w10-worktree',
    exactHashes: true,
    steps: diary,
    verify: [
      ['git worktree add ../diary-fix -b fix', 'git worktree list', 'cd ../diary-fix', 'git status', 'echo "<p>Fixed</p>" >> index.html', 'git commit -am "Fix a typo"', 'cd ../diary', 'git log --oneline --all', 'git worktree remove ../diary-fix', 'git worktree list', 'git merge fix', 'git branch -d fix'],
      ['git worktree add ../old HEAD~1', 'git worktree list', 'echo "x" > ../old/new.txt', 'git worktree remove --force ../old', 'git worktree list'],
      ['git worktree add ../hotfix', 'git worktree list --porcelain', 'cd ../hotfix', 'git rev-parse --show-toplevel', 'git rev-parse --abbrev-ref HEAD'],
      // Lesson 10: remove keeps the branch.
      ['git worktree add ../diary-fix -b fix', 'git worktree list', 'git worktree remove ../diary-fix', 'git worktree list', 'git branch'],
    ],
  },
  {
    id: 'w10-aliases',
    exactHashes: true,
    steps: diary,
    verify: [
      ['git config --global alias.st status', 'git config --global alias.lg "log --oneline --graph --all"', 'git st', 'git lg', 'git config --global --get-regexp alias', 'git st -s'],
      // Lesson 9: a built-in name can't be hidden by an alias; .gitattributes for line endings.
      ['git config --global alias.status "log --oneline"', 'git status', 'git config --global alias.last "log -1 HEAD"', 'git last'],
      ['echo "* text=auto" > .gitattributes', 'echo "*.png binary" >> .gitattributes', 'git add .gitattributes', 'git commit -m "Add line ending rules"', 'git status -s', 'git log --oneline'],
      ['git config --global core.autocrlf input', 'git config --global --get-regexp core'],
      // Lesson 13: rerere is one setting.
      ['git config --global rerere.enabled true', 'git config --global --get-regexp rerere'],
    ],
  },
  {
    id: 'w10-plumbing',
    exactHashes: true,
    steps: plumbing,
    verify: [
      ['git status -s', 'git hash-object notes.txt', 'git hash-object -w notes.txt', 'git cat-file -t 17e284d', 'git cat-file -p 17e284d', 'git status -s'],
      ['git rev-parse HEAD', 'git ls-tree HEAD', 'git hash-object index.html', 'git rev-parse HEAD:index.html', 'git cat-file -p HEAD:index.html'],
    ],
  },
  {
    id: 'w10-hooks',
    exactHashes: true,
    steps: hooks,
    verify: [['git log --oneline', 'git ls-tree -r --name-only HEAD', 'git config core.hooksPath .githooks', 'git config core.hooksPath']],
  },
  {
    id: 'w10-boss',
    exactHashes: true,
    steps: boss,
    verify: [
      ['git log --oneline', 'sh test.sh', 'git bisect start', 'git bisect bad', 'git bisect good HEAD~13', 'sh test.sh', 'git bisect run sh test.sh', 'git bisect log', 'git bisect reset', 'git status'],
      ['git bisect start HEAD HEAD~13', 'git bisect good', 'git bisect bad', 'git bisect bad', 'git bisect good', 'git bisect log', 'git bisect reset'],
      ['git blame -L 6,6 order.html', 'git show --stat 7bb484d', 'git log -S disabled --oneline'],
      ['git bisect start HEAD HEAD~13', 'git bisect run sh test.sh', 'git bisect reset', 'git status'],
    ],
  },
];
