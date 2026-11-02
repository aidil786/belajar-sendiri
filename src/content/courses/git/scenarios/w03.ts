// World 3 scenarios (Parallel Universes). Same diary project as Worlds 1–2, in /home/you/diary.
// Each `verify` list is replayed in real Git by `npm run verify:commands`, so the simulator
// never drifts from Git. A merge that stops on a conflict can't be a scenario step (steps must
// succeed), so conflict lessons start the merge with `commands` / `intro` and list it in `verify`.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const DAY1 = '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n';
const STYLE = 'body { color: purple; }\n';

/** The diary from Worlds 1–2: README, a day 1 page and a style sheet (3 commits on main). */
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

/** An about page on its own branch (2 commits). Ends back on main. */
const aboutBranch: ScenarioStep[] = [
  'git switch -c about',
  { write: 'about.html', content: '<h1>About me</h1>\n' },
  'git add about.html',
  'git commit -m "Add about page"',
  { write: 'about.html', content: '<h1>About me</h1>\n<p>I like Git.</p>\n' },
  'git commit -am "Say what I like"',
  'git switch main',
];

/** Diary + about branch, and main moved on too (a new style commit). On main. */
const diverged: ScenarioStep[] = [...diary, ...aboutBranch, { write: 'style.css', content: `${STYLE}h1 { color: teal; }\n` }, 'git commit -am "Make heading teal"'];

/** Both branches add a different day 2 line at the same spot: merging cake into main conflicts. */
const cakeConflict: ScenarioStep[] = [
  ...diary,
  'git switch -c cake',
  { write: 'index.html', content: `${DAY1}<p>Day 2: I baked a cake.</p>\n` },
  'git commit -am "Add cake day"',
  'git switch main',
  { write: 'index.html', content: `${DAY1}<p>Day 2: I learned branches.</p>\n` },
  'git commit -am "Add day 2 entry"',
];

/** Dark mode half done: one commit on dark-mode, more style changes not committed yet. */
const darkModeWip: ScenarioStep[] = [
  ...diary,
  'git switch -c dark-mode',
  { write: 'style.css', content: 'body { color: white; background: black; }\n' },
  'git commit -am "Start dark mode"',
  { write: 'style.css', content: 'body { color: white; background: black; }\nh1 { color: gold; }\n' },
];

const GALLERY = '<h1>My Galery</h1>\n<p>Photos from my week.</p>\n<p>More soon.</p>\n';
const GALLERY_FIXED = GALLERY.replace('Galery', 'Gallery');
const CAPTIONS = '<p>Photo 1: the beach</p>\n<p>Photo 2: my bike</p>\n';

/** gallery branch, three commits: page, a typo fix right after it, sloppy captions. */
const galleryA: ScenarioStep[] = [
  ...diary,
  'git switch -c gallery',
  { write: 'gallery.html', content: GALLERY },
  'git add gallery.html',
  'git commit -m "Add gallery page"',
  { write: 'gallery.html', content: GALLERY_FIXED },
  'git commit -am "fix typo"',
  { write: 'gallery.html', content: GALLERY_FIXED + CAPTIONS },
  'git commit -am "captions"',
];

/** gallery branch, four commits: page, captions, a late typo fix, a debug file. */
const galleryB: ScenarioStep[] = [
  ...diary,
  'git switch -c gallery',
  { write: 'gallery.html', content: GALLERY },
  'git add gallery.html',
  'git commit -m "Add gallery page"',
  { write: 'gallery.html', content: GALLERY + CAPTIONS },
  'git commit -am "Add photo captions"',
  { write: 'gallery.html', content: GALLERY_FIXED + CAPTIONS },
  'git commit -am "fix typo"',
  { write: 'debug.txt', content: 'debug: gallery loads\n' },
  'git add debug.txt',
  'git commit -m "debug log"',
];

/** experiments branch: two wild ideas and one real fix in the middle. Ends on main. */
const experiments: ScenarioStep[] = [
  ...diary,
  'git switch -c experiments',
  { write: 'style.css', content: `${STYLE}h1 { animation: blink 1s; }\n` },
  'git commit -am "Try a blinking title"',
  { write: 'README.md', content: '# My Diary\n\nA diary about learning Git.\n' },
  'git commit -am "Fix README intro"',
  { write: 'style.css', content: `${STYLE}h1 { animation: blink 1s; color: red; }\n` },
  'git commit -am "Try red title"',
  'git switch main',
];

// --- Boss: Conflict Crusher -------------------------------------------------

const BOSS_DAYS = `${DAY1}<p>Day 2: I learned branches.</p>\n<p>Day 3: I learned merging.</p>\n<p>Day 4: I learned rebase.</p>\n`;
/** party and main both change the title, add a day 5 line and change the colour: three conflicts. */
const bossConflicts: ScenarioStep[] = [
  ...diary,
  { write: 'index.html', content: BOSS_DAYS },
  'git commit -am "Add days 2 to 4"',
  'git switch -c party',
  { write: 'index.html', content: `${BOSS_DAYS.replace('My Diary', 'Party Diary')}<p>Day 5: Party time!</p>\n` },
  { write: 'style.css', content: 'body { color: hotpink; }\n' },
  'git commit -am "Party theme"',
  'git switch main',
  { write: 'index.html', content: `${BOSS_DAYS.replace('My Diary', 'My Git Diary')}<p>Day 5: I fixed conflicts.</p>\n` },
  { write: 'style.css', content: 'body { color: teal; }\n' },
  'git commit -am "Polish diary"',
];

const RECIPES = '<h1>Recipies</h1>\n<p>Food I like to make.</p>\n<p>Try them!</p>\n';
/** A messy recipes branch: page, "oops" typo fix, sloppy message, a debug file, one more recipe. */
const bossRecipes: ScenarioStep[] = [
  ...diary,
  'git switch -c recipes',
  { write: 'recipes.html', content: RECIPES },
  'git add recipes.html',
  'git commit -m "Add recipes page"',
  { write: 'recipes.html', content: RECIPES.replace('Recipies', 'Recipes') },
  'git commit -am "oops"',
  { write: 'recipes.html', content: `${RECIPES.replace('Recipies', 'Recipes')}<h2>Chocolate cake</h2>\n` },
  'git commit -am "add cake"',
  { write: 'debug.txt', content: 'debug: recipes load\n' },
  'git add debug.txt',
  'git commit -m "temp debug"',
  { write: 'recipes.html', content: `${RECIPES.replace('Recipies', 'Recipes')}<h2>Chocolate cake</h2>\n<h2>Banana pancakes</h2>\n` },
  'git commit -am "Add pancake recipe"',
];

export const w03: Scenario[] = [
  // 3.1 A branch is a sticky note: the diary, 3 commits on main.
  {
    id: 'w03-l01',
    steps: diary,
    verify: [
      ['git branch dark-mode', 'git branch', 'git log --oneline'],
      ['git branch idea HEAD~1', 'git branch', 'git log --oneline --all'],
      ['git branch dark-mode', 'echo "<p>Day 2: I made a branch.</p>" >> index.html', 'git commit -am "Add day 2 entry"', 'git log --oneline --all', 'git branch -v'],
      ['git branch dark-mode', 'git branch -m dark-mode night-mode', 'git branch'],
    ],
  },

  // 3.2 Make and switch: a dark-mode note already exists. On main.
  {
    id: 'w03-l02',
    steps: [...diary, 'git branch dark-mode'],
    verify: [
      ['git branch'],
      ['git switch dark-mode', 'git branch', 'git status'],
      ['git switch -c about', 'git branch'],
      ['git switch -c contact', 'git switch -', 'git branch'],
    ],
  },
  // 3.2 Two universes: about has about.html; main has a day 2 entry. On main.
  {
    id: 'w03-l02-split',
    steps: [
      ...diary,
      'git switch -c about',
      { write: 'about.html', content: '<h1>About me</h1>\n' },
      'git add about.html',
      'git commit -m "Add about page"',
      'git switch main',
      { write: 'index.html', content: `${DAY1}<p>Day 2: I learned branches.</p>\n` },
      'git commit -am "Add day 2 entry"',
    ],
    verify: [
      ['git switch about', 'ls', 'cat index.html', 'git switch main', 'ls', 'cat index.html'],
      ['git log --oneline --graph --all'],
    ],
  },

  // 3.3 The old way: on main, with a dark-mode note.
  {
    id: 'w03-l03',
    steps: [...diary, 'git branch dark-mode'],
    verify: [
      ['git checkout -b fix-typo', 'git branch'],
      ['git checkout dark-mode', 'git branch'],
      ['git checkout -b fix-typo', 'git checkout main', 'git branch'],
    ],
  },
  // 3.3 Already on dark-mode, to go back with checkout.
  {
    id: 'w03-l03b',
    steps: [...diary, 'git switch -c dark-mode'],
    verify: [['git checkout main', 'git branch'], ['git switch main', 'git branch']],
  },

  // 3.4 Fast-forward: about is 2 commits ahead, main has nothing new. On main.
  {
    id: 'w03-l04',
    steps: [...diary, ...aboutBranch],
    verify: [
      ['git log --oneline --graph --all'],
      ['git merge about', 'git log --oneline --graph --all', 'git status'],
      ['git merge --ff-only about', 'git log --oneline'],
      ['git merge --no-ff about', 'git log --oneline --graph'],
    ],
  },
  // 3.4 After the fast-forward.
  {
    id: 'w03-l04-done',
    steps: [...diary, ...aboutBranch, 'git merge about'],
    verify: [['git log --oneline'], ['git branch -v']],
  },

  // 3.5 Three-way merge: both main and about moved on. On main.
  {
    id: 'w03-l05',
    steps: diverged,
    verify: [
      ['git log --oneline --graph --all'],
      ['git merge about', 'git log --oneline --graph', 'git status'],
      ['git merge about', 'git log --merges --oneline', 'git show HEAD'],
    ],
  },

  // 3.6 + 3.7 Conflicts: main and cake both wrote a day 2 line. On main.
  {
    id: 'w03-l06',
    steps: cakeConflict,
    verify: [
      ['git merge cake', 'git status', 'cat index.html'],
      ['git merge cake', 'git status -s', 'git diff'],
      ['git merge cake', 'git merge --abort', 'git status', 'git log --oneline'],
      [
        'git merge cake',
        'echo "<p>Day 2: I learned branches and baked a cake.</p>" >> index.html',
        'git add index.html',
        'git status',
        'git commit --no-edit',
        'git log --oneline --graph',
      ],
    ],
  },

  // 3.8 Clean up: about and dark-mode are merged into main; old-idea is not. On main.
  {
    id: 'w03-l08',
    steps: [
      ...diary,
      'git switch -c about',
      { write: 'about.html', content: '<h1>About me</h1>\n' },
      'git add about.html',
      'git commit -m "Add about page"',
      'git switch main',
      'git merge about',
      'git switch -c dark-mode',
      { write: 'style.css', content: `${STYLE}h1 { color: gold; }\n` },
      'git commit -am "Make heading gold"',
      'git switch main',
      'git merge dark-mode',
      'git switch -c old-idea',
      { write: 'index.html', content: `${DAY1}<marquee>Hi!</marquee>\n` },
      'git commit -am "Try a moving banner"',
      'git switch main',
    ],
    verify: [
      ['git branch'],
      ['git branch --merged'],
      ['git branch --no-merged'],
      ['git branch -d about', 'git branch -d dark-mode', 'git branch', 'git log --oneline'],
      ['git branch -D old-idea', 'git branch'],
    ],
  },

  // 3.9 Stash: on dark-mode with unsaved style changes. main has a different style.css.
  {
    id: 'w03-l09',
    steps: darkModeWip,
    verify: [
      ['git stash', 'git status -s', 'git stash list', 'git switch main', 'git branch'],
      ['git stash', 'git stash pop', 'git status -s', 'git stash list'],
      ['git stash', 'git stash apply', 'git stash list', 'git stash drop', 'git stash list'],
    ],
  },
  // 3.9 Work is in the drawer, you fixed main. Go back and pop it.
  {
    id: 'w03-l09b',
    steps: [
      ...darkModeWip,
      'git stash',
      'git switch main',
      { write: 'index.html', content: DAY1.replace('My Diary', 'My Git Diary') },
      'git commit -am "Fix home page title"',
    ],
    verify: [
      ['git stash list', 'git switch dark-mode', 'git stash pop', 'git status -s', 'git stash list'],
      ['git switch -', 'git stash pop', 'git status -s'],
    ],
  },
  // 3.9 Two things in the drawer.
  {
    id: 'w03-l09c',
    steps: [
      ...diary,
      { write: 'style.css', content: 'body { color: white; background: black; }\n' },
      'git stash push -m "dark colours"',
      { write: 'index.html', content: `${DAY1}<p>Day 2: draft</p>\n` },
      'git stash push -m "day 2 draft"',
    ],
    verify: [['git stash list'], ['git stash pop', 'git stash list', 'git status -s']],
  },

  // 3.10 + 3.12 Rebase: both moved on, you are on about.
  {
    id: 'w03-l10',
    steps: [...diverged, 'git switch about'],
    verify: [
      ['git log --oneline --graph --all'],
      ['git rebase main', 'git log --oneline --graph --all', 'git status'],
      ['git log --oneline -n 2', 'git rebase main', 'git log --oneline -n 2'],
      ['git rebase main', 'git switch main', 'git merge about', 'git log --oneline'],
      ['git merge main', 'git log --oneline --graph'],
    ],
  },
  // 3.10 After the rebase (still on about).
  {
    id: 'w03-l10-rebased',
    steps: [...diverged, 'git switch about', 'git rebase main'],
    verify: [['git switch main', 'git merge about', 'git log --oneline --graph']],
  },
  // 3.10 deeper: a rebase that stops on a conflict (cake onto main).
  {
    id: 'w03-l10-conflict',
    steps: [...cakeConflict, 'git switch cake'],
    verify: [
      ['git rebase main', 'git status'],
      ['git rebase main', 'git rebase --abort', 'git log --oneline'],
    ],
  },

  // 3.11 Interactive rebase (cards): typo fix right after the page, sloppy captions.
  {
    id: 'w03-l11a',
    steps: galleryA,
    verify: [['git log --oneline'], ['git rebase main']],
  },
  // 3.11 Interactive rebase (cards): a late typo fix and a debug file.
  {
    id: 'w03-l11b',
    steps: galleryB,
    verify: [['git log --oneline'], ['git log --oneline main..gallery']],
  },

  // 3.12 Cherry-pick: experiments has one real fix between two wild ideas. On main.
  {
    id: 'w03-l12-pick',
    steps: experiments,
    verify: [
      ['git log --oneline experiments'],
      ['git cherry-pick experiments~1', 'git log --oneline', 'cat README.md'],
      ['git cherry-pick experiments~1', 'git log --oneline --graph --all'],
    ],
  },

  // Boss 1: three conflicts (merge party into main).
  {
    id: 'w03-boss-merge',
    steps: bossConflicts,
    verify: [
      ['git merge party', 'git status', 'git diff'],
      ['git merge party', 'git merge --abort', 'git status -s'],
    ],
  },
  // Boss drill: unsaved work, an urgent switch.
  {
    id: 'w03-boss-stash',
    steps: darkModeWip,
    verify: [['git stash', 'git switch main', 'git stash list']],
  },
  // Boss drill: copy the README fix.
  {
    id: 'w03-boss-pick',
    steps: experiments,
    verify: [['git log --oneline experiments', 'git cherry-pick experiments~1', 'git log --oneline']],
  },
  // Boss drill: put about on top of main.
  {
    id: 'w03-boss-rebase',
    steps: [...diverged, 'git switch about'],
    verify: [['git rebase main', 'git log --oneline']],
  },
  // Boss drill: clean up merged branches.
  {
    id: 'w03-boss-cleanup',
    steps: [
      ...diary,
      ...aboutBranch,
      'git merge about',
      'git switch -c old-idea',
      { write: 'index.html', content: `${DAY1}<marquee>Hi!</marquee>\n` },
      'git commit -am "Try a moving banner"',
      'git switch main',
    ],
    verify: [['git branch --merged', 'git branch -d about', 'git branch -D old-idea', 'git branch']],
  },
  // Boss 2: a messy recipes branch to tidy with the rebase cards.
  {
    id: 'w03-boss-tidy',
    steps: bossRecipes,
    verify: [['git log --oneline'], ['git log --oneline main..recipes']],
  },
];
