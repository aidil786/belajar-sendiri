// World 4 scenarios (Hello GitHub). Each lesson's simulator starting states (+ verify lists).
// The diary project lives in /home/you/diary and meets GitHub at https://github.com/you/diary.git.
// Aisyah, the teammate, works in her own clone at /home/aisyah/diary.
// `npm run verify:commands` maps https://github.com/... to local bare repos for real Git.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const URL = 'https://github.com/you/diary.git';
const MEI = 'https://github.com/mei/recipes.git';
const FORK = 'https://github.com/you/recipes.git';

const home = (extra = '') => `<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n${extra}`;

/** The diary with three commits: README, home page, style. */
const diary: ScenarioStep[] = [
  'mkdir diary',
  'cd diary',
  'git init',
  { write: 'README.md', content: '# My Diary\nA tiny website about learning Git.\n' },
  'git add README.md',
  'git commit -m "Add README"',
  { write: 'index.html', content: home() },
  'git add index.html',
  'git commit -m "Add home page"',
  { write: 'style.css', content: 'body { color: purple; }\n' },
  'git add style.css',
  'git commit -m "Add purple style"',
];

/** An empty repo on GitHub (made with "New repository", no README) + the diary. */
const withServer: ScenarioStep[] = [{ server: URL }, ...diary];
/** ...and the remote is saved as origin. */
const withRemote: ScenarioStep[] = [...withServer, `git remote add origin ${URL}`];
/** ...and the first push is done (main follows origin/main). */
const pushed: ScenarioStep[] = [...withRemote, 'git push -u origin main'];

/** Aisyah clones the diary and uses her own name in her repo. Ends back in your diary. */
const aisyahJoins: ScenarioStep[] = [
  'mkdir -p /home/aisyah',
  'cd /home/aisyah',
  `git clone ${URL}`,
  'cd diary',
  'git config user.name "Aisyah"',
  'git config user.email "aisyah@example.com"',
  'cd /home/you/diary',
];
const team: ScenarioStep[] = [...pushed, ...aisyahJoins];

/** Aisyah adds her day to index.html and pushes. You haven't fetched. */
const aisyahPushes: ScenarioStep[] = [
  'cd /home/aisyah/diary',
  'git pull',
  { write: 'index.html', content: home('<p>Day 2: Aisyah says hi!</p>\n') },
  'git commit -am "Add Aisyah\'s day 2"',
  'git push',
  'cd /home/you/diary',
];

/** You make the titles teal (another file, so no conflict with Aisyah). Not pushed. */
const youCommit: ScenarioStep[] = [{ write: 'style.css', content: 'body { color: purple; }\nh1 { color: teal; }\n' }, 'git commit -am "Make titles teal"'];

/** You pushed an about page with a typo in the message, then fixed it with --amend. */
const amended: ScenarioStep[] = [
  ...team,
  { write: 'about.html', content: '<h1>About me</h1>\n<p>I like nasi lemak and code.</p>\n' },
  'git add about.html',
  'git commit -m "Add about pgae"',
  'git push',
  'git commit --amend -m "Add about page"',
];

/** The boss: the diary site has four commits (with an about page). */
const site: ScenarioStep[] = [
  { server: URL },
  ...diary,
  { write: 'about.html', content: '<h1>About me</h1>\n<p>I like nasi lemak and code.</p>\n' },
  'git add about.html',
  'git commit -m "Add about page"',
];

/** Mei's recipe site, and your fork of it (a copy in your account), cloned to your laptop. */
const fork: ScenarioStep[] = [
  { server: MEI },
  { server: FORK },
  'mkdir -p /home/mei/recipes',
  'cd /home/mei/recipes',
  'git init',
  'git config user.name "Mei"',
  'git config user.email "mei@example.com"',
  { write: 'README.md', content: '# Recipes\nEasy Malaysian food.\n' },
  'git add README.md',
  'git commit -m "Add README"',
  { write: 'nasi-lemak.md', content: '# Nasi lemak\nRice, sambal, egg, peanuts.\n' },
  'git add nasi-lemak.md',
  'git commit -m "Add nasi lemak"',
  `git remote add origin ${MEI}`,
  'git push -u origin main',
  // Forking on GitHub copies the repo into your account.
  `git push ${FORK} main`,
  'cd /home/you',
  `git clone ${FORK}`,
  // Later, Mei adds a recipe to her repo. Your fork doesn't have it.
  'cd /home/mei/recipes',
  { write: 'roti-canai.md', content: '# Roti canai\nFlat bread with dhal.\n' },
  'git add roti-canai.md',
  'git commit -m "Add roti canai"',
  'git push',
  'cd /home/you/recipes',
];

export const w04: Scenario[] = [
  // 4.4 Remotes: the diary and an empty GitHub repo. No remote yet.
  {
    id: 'w04-l04',
    steps: withServer,
    verify: [[`git remote add origin ${URL}`, 'git remote', 'git remote -v'], ['git remote']],
  },
  // 4.5 First push: origin is saved. Nothing pushed yet.
  {
    id: 'w04-l05',
    steps: withRemote,
    verify: [['git push -u origin main', 'git status', 'git branch -vv'], ['git push origin main', 'git status']],
  },
  // 4.5 After the first push: one new commit to send with plain `git push`.
  {
    id: 'w04-l05-next',
    steps: [...pushed, { write: 'about.html', content: '<h1>About me</h1>\n' }, 'git add about.html', 'git commit -m "Add about page"'],
    verify: [['git status', 'git push', 'git status', 'git push']],
  },
  // 4.6 Clone: the diary is on GitHub (pushed from your old laptop). You are in /home/you with no diary.
  {
    id: 'w04-l06',
    steps: [{ server: URL }, 'mkdir -p /home/old-laptop', 'cd /home/old-laptop', ...diary,`git remote add origin ${URL}`, 'git push -u origin main', 'cd /home/you'],
    verify: [[`git clone ${URL}`, 'cd diary', 'git log --oneline', 'git remote -v', 'git branch -a', 'git status']],
  },
  // 4.7 A team: Aisyah cloned the diary. Nothing new yet.
  {
    id: 'w04-team',
    steps: team,
    verify: [['git fetch', 'git status', 'git branch -vv']],
  },
  // 4.7 Fetch vs pull: Aisyah pushed her day. You haven't fetched.
  {
    id: 'w04-l07',
    steps: [...team, ...aisyahPushes],
    verify: [
      ['git fetch', 'git status', 'git log --oneline --all', 'git pull', 'git status'],
      ['git pull', 'git log --oneline'],
    ],
  },
  // 4.8 Pull with merge or rebase: Aisyah pushed, and you made your own commit.
  {
    id: 'w04-l08',
    steps: [...team, ...aisyahPushes, ...youCommit],
    verify: [
      ['git fetch', 'git status'],
      ['git pull --no-rebase', 'git log --oneline --graph'],
      ['git pull --rebase', 'git log --oneline --graph', 'git push'],
      ['git config pull.rebase true', 'git pull', 'git status'],
    ],
  },
  // 4.9 Push rejected: the same situation. Your push bounces; pull, then push.
  {
    id: 'w04-l09',
    steps: [...team, ...aisyahPushes, ...youCommit],
    verify: [['git pull --rebase', 'git push', 'git status'], ['git pull --no-rebase', 'git push', 'git log --oneline --graph']],
  },
  // 4.10 Force push: you amended a pushed commit. Nobody else pushed since.
  {
    id: 'w04-l10',
    steps: amended,
    verify: [['git status', 'git push --force-with-lease', 'git status', 'git log --oneline']],
  },
  // 4.10 Same, but Aisyah pushed on top of your old commit after your last fetch.
  {
    id: 'w04-l10-team',
    steps: [
      ...team,
      { write: 'about.html', content: '<h1>About me</h1>\n<p>I like nasi lemak and code.</p>\n' },
      'git add about.html',
      'git commit -m "Add about pgae"',
      'git push',
      ...aisyahPushes,
      'git commit --amend -m "Add about page"',
    ],
    verify: [['git push --force', 'git log --oneline'], ['git fetch', 'git status']],
  },
  // 4.11 Tags: the diary is pushed. Time for version 1.0.0.
  {
    id: 'w04-l11',
    steps: pushed,
    verify: [['git tag -a v1.0.0 -m "First release"', 'git tag', 'git push origin v1.0.0', 'git show v1.0.0']],
  },
  // 4.11 The tag exists on your laptop only.
  {
    id: 'w04-l11-tagged',
    steps: [...pushed, 'git tag -a v1.0.0 -m "First release"'],
    verify: [['git push', 'git push --tags', 'git tag']],
  },
  // 4.12 Forks: your fork of Mei's recipes is behind her repo by one commit.
  {
    id: 'w04-l12',
    steps: fork,
    verify: [
      [`git remote add upstream ${MEI}`, 'git remote -v', 'git fetch upstream', 'git merge upstream/main', 'git push', 'git log --oneline'],
      ['git remote -v', 'git log --oneline'],
    ],
  },
  // Boss stage 1: the finished diary site, an empty GitHub repo, no remote.
  {
    id: 'w04-boss-1',
    steps: site,
    verify: [[`git remote add origin ${URL}`, 'git remote -v']],
  },
  // Boss stage 2: origin is saved. Push and set the upstream.
  {
    id: 'w04-boss-2',
    steps: [...site, `git remote add origin ${URL}`],
    verify: [['git push -u origin main', 'git status']],
  },
  // Boss stages 3 and 4: Aisyah pushed her day; you made titles teal. Your push will bounce.
  {
    id: 'w04-boss-3',
    steps: [...site, `git remote add origin ${URL}`, 'git push -u origin main', ...aisyahJoins, ...aisyahPushes, ...youCommit],
    verify: [['git pull --rebase', 'git log --oneline', 'git push'], ['git pull --no-rebase', 'git push', 'git status']],
  },
  // Boss stage 5: you pulled with --rebase. One more push.
  {
    id: 'w04-boss-5',
    steps: [...site, `git remote add origin ${URL}`, 'git push -u origin main', ...aisyahJoins, ...aisyahPushes, ...youCommit, 'git pull --rebase'],
    verify: [['git status', 'git push', 'git status']],
  },
];
