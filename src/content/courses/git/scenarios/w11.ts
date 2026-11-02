// World 11 scenarios (Rescue Center). Each lesson's simulator starting states (+ verify lists).
// Same diary project as Worlds 1–2, on GitHub at https://github.com/you/diary.git where needed.
// The `verify` lists also run every command the Rescue Center flows (rescue.yaml) show,
// so `npm run verify:commands` checks them against real Git. Verify lists use HEAD~n / HEAD@{n}, never hashes.
// Every key here is FAKE and clearly marked: API_KEY=fake_demo_key_123.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

const URL = 'https://github.com/you/diary.git';
const SSH_URL = 'git@github.com:you/diary.git';
const DAY1 = '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n';
const DAY2 = `${DAY1}<p>Day 2: I learned undo.</p>\n`;
const DAY3 = `${DAY2}<p>Day 3: I found the reflog.</p>\n`;
const STYLE = 'body { color: purple; }\n';
const ABOUT = '<h1>About me</h1>\n<p>I like Git.</p>\n';

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

/** Diary + a day 2 entry (4 commits). */
const diaryDay2: ScenarioStep[] = [...diary, { write: 'index.html', content: DAY2 }, 'git commit -am "Add day 2 entry"'];

/** The diary, also on GitHub: main pushed, upstream set. */
const online: ScenarioStep[] = [{ server: URL }, ...diary, `git remote add origin ${URL}`, 'git push -u origin main'];

/** Aisyah clones the diary, changes something, pushes, and you are back in your folder. */
const teammate = (change: ScenarioStep[], message: string): ScenarioStep[] => [
  'mkdir -p /home/aisyah',
  'cd /home/aisyah',
  `git clone ${URL}`,
  'cd diary',
  'git config user.name "Aisyah"',
  'git config user.email "aisyah@example.com"',
  ...change,
  `git commit -am "${message}"`,
  'git push',
  'cd /home/you/diary',
];

/** The about page, staged on main (it was meant for its own branch). */
const aboutStaged: ScenarioStep[] = [...diary, { write: 'about.html', content: ABOUT }, 'git add about.html'];

/** A weather widget and .env (with a fake key) committed together by mistake. */
const leak: ScenarioStep[] = [
  { write: 'app.js', content: '// Weather widget\nconst key = process.env.API_KEY;\nshowWeather("Ipoh", key);\n' },
  { write: '.env', content: 'API_KEY=fake_demo_key_123\n' },
  'git add .',
  'git commit -m "Add weather widget"',
];

/** A trip page and a big video, committed together. The "video" is a small stand-in file. */
const bigFile: ScenarioStep[] = [
  { write: 'trip.html', content: '<h1>My trip</h1>\n<video src="video.mp4"></video>\n' },
  { write: 'video.mp4', content: 'stand-in for a 300 MB video\n' },
  'git add .',
  'git commit -m "Add trip page"',
];

export const w11: Scenario[] = [
  // 11.1 Wrong branch. Hook: the about page is staged on main.
  { id: 'w11-l01-before', steps: aboutStaged, verify: [['git commit -m "Add about page"', 'git log --oneline']] },
  // 11.1 The about page was committed on main. Not pushed.
  {
    id: 'w11-l01',
    steps: [...aboutStaged, 'git commit -m "Add about page"'],
    verify: [
      ['git branch about', 'git reset --hard HEAD~1', 'git switch about', 'git log --oneline --all', 'git status -s'],
      ['git switch -c about', 'git switch main', 'git reset --hard HEAD~1', 'git branch -v'],
    ],
  },
  // 11.1 Rescue flow: the right branch (about) already exists.
  {
    id: 'w11-l01-exists',
    steps: [...diary, 'git branch about', { write: 'about.html', content: ABOUT }, 'git add about.html', 'git commit -m "Add about page"'],
    verify: [['git switch about', 'git cherry-pick main', 'git switch main', 'git reset --hard HEAD~1', 'git log --oneline --all']],
  },
  // 11.1 Rescue flow: the slip on main was already pushed.
  {
    id: 'w11-l01-pushed',
    steps: [...online, { write: 'about.html', content: ABOUT }, 'git add about.html', 'git commit -m "Add about page"', 'git push'],
    verify: [['git revert HEAD', 'git push', 'git switch -c about', 'git cherry-pick main~1', 'git log --oneline', 'git status -s']],
  },

  // 11.2 Pushed a password: .env (fake key) went to GitHub with the widget.
  {
    id: 'w11-l02',
    steps: [...online, ...leak, 'git push'],
    verify: [
      ['git show --stat'],
      ['git rm --cached .env', 'echo ".env" >> .gitignore', 'git add .gitignore', 'git commit -m "Stop tracking .env"', 'git push', 'git status -s', 'git log --oneline'],
    ],
  },
  // 11.2 Rescue flow: the same slip, not pushed yet.
  {
    id: 'w11-l02-local',
    steps: [...diary, ...leak],
    verify: [['git rm --cached .env', 'echo ".env" >> .gitignore', 'git add .gitignore', 'git commit --amend --no-edit', 'git show --stat', 'git status -s']],
  },

  // 11.3 Undo my last commit: day 2 committed too soon, only on this computer.
  {
    id: 'w11-l03',
    steps: diaryDay2,
    verify: [
      ['git reset --soft HEAD~1', 'git status -s', 'git log --oneline'],
      ['git reset --soft HEAD~1', 'git status'],
      ['git reset --hard HEAD~1', 'git status -s', 'git log --oneline'],
    ],
  },
  // 11.3 The same commit, already pushed.
  {
    id: 'w11-l03-pushed',
    steps: [...online, { write: 'index.html', content: DAY2 }, 'git commit -am "Add day 2 entry"', 'git push'],
    verify: [['git revert HEAD', 'git push', 'git log --oneline', 'git status -s']],
  },

  // 11.4 Bad message: the last commit says "stuff". Not pushed.
  {
    id: 'w11-l04',
    steps: [...diary, { write: 'index.html', content: DAY2 }, 'git commit -am "stuff"'],
    verify: [
      ['git log --oneline'],
      ['git commit --amend -m "Add day 2 entry"', 'git log --oneline', 'git status -s'],
      ['git commit --amend -m "Better message"', 'git log --oneline'],
    ],
  },

  // 11.5 Forgot a file: day2.html is committed, day2.css is still on the desk.
  {
    id: 'w11-l05',
    steps: [
      ...diary,
      { write: 'day2.html', content: '<h1>Day 2</h1>\n<link rel="stylesheet" href="day2.css">\n' },
      { write: 'day2.css', content: 'h1 { color: teal; }\n' },
      'git add day2.html',
      'git commit -m "Add day 2 page"',
    ],
    verify: [
      ['git status -s'],
      ['git add day2.css', 'git commit --amend --no-edit', 'git show --stat', 'git status -s'],
      ['git add day2.css', 'git commit -m "Add missing day2.css"', 'git log --oneline'],
    ],
  },
  // 11.5 Rescue flow: the same commands with the flow's file name.
  {
    id: 'w11-l05-flow',
    steps: [...diary, { write: 'forgot.txt', content: 'I was left behind.\n' }],
    verify: [
      ['git add forgot.txt', 'git commit --amend --no-edit', 'git log --oneline'],
      ['git add forgot.txt', 'git commit -m "Add missing forgot.txt"', 'git log --oneline'],
    ],
  },

  // 11.6 Merge panic: main and the title branch both changed the title line.
  {
    id: 'w11-l06',
    steps: [
      ...diary,
      'git switch -c title',
      { write: 'index.html', content: '<h1>Dear Diary</h1>\n<p>Day 1: I learned Git.</p>\n' },
      'git commit -am "Rename the title"',
      'git switch main',
      { write: 'index.html', content: '<h1>MY DIARY</h1>\n<p>Day 1: I learned Git.</p>\n' },
      'git commit -am "Make the title loud"',
    ],
    verify: [
      ['git merge title', 'git status', 'git merge --abort', 'git status -s', 'git log --oneline'],
      ['git merge title', 'git status -s', 'git merge --abort', 'git status'],
      ['git merge title', 'git reset --hard ORIG_HEAD', 'git status -s'],
    ],
  },
  // 11.6 Rescue flow: a merge that worked, then regret (not pushed).
  {
    id: 'w11-l06-merged',
    steps: [
      ...diary,
      'git switch -c about',
      { write: 'about.html', content: ABOUT },
      'git add about.html',
      'git commit -m "Add about page"',
      'git switch main',
      { write: 'style.css', content: `${STYLE}h1 { color: teal; }\n` },
      'git commit -am "Teal title"',
      'git merge about',
    ],
    verify: [
      ['git reset --hard ORIG_HEAD', 'git log --oneline', 'git status -s'],
      ['git revert -m 1 HEAD', 'git log --oneline', 'git status -s'],
    ],
  },

  // 11.7 Detached HEAD: you visited an old commit and made a commit there.
  {
    id: 'w11-l07',
    steps: [...diary, 'git switch --detach HEAD~1', { write: 'index.html', content: '<h1>Dear Diary</h1>\n<p>Day 1: I learned Git.</p>\n' }, 'git commit -am "Try a new title"'],
    verify: [
      ['git status'],
      ['git switch -c new-title', 'git log --oneline --all', 'git status'],
      ['git switch main', 'git reflog', 'git branch new-title HEAD@{1}', 'git branch -v'],
    ],
  },
  // 11.7 Rescue flow: just looking around, no new commits.
  { id: 'w11-l07-look', steps: [...diary, 'git switch --detach HEAD~1'], verify: [['git switch main', 'git status']] },

  // 11.8 Deleted branch. Before: the about branch is not merged into main.
  {
    id: 'w11-l08-before',
    steps: [...diary, 'git switch -c about', { write: 'about.html', content: ABOUT }, 'git add about.html', 'git commit -m "Add about page"', 'git switch main'],
    verify: [['git branch -D about', 'git branch']],
  },
  // 11.8 After `git branch -D about`.
  {
    id: 'w11-l08',
    steps: [...diary, 'git switch -c about', { write: 'about.html', content: ABOUT }, 'git add about.html', 'git commit -m "Add about page"', 'git switch main', 'git branch -D about'],
    verify: [
      ['git reflog'],
      ['git branch about HEAD@{1}', 'git log --oneline --all', 'git branch'],
      ['git switch -c about HEAD@{1}', 'git status'],
    ],
  },

  // 11.9 Lost commits. Before: day 2 and day 3 are committed.
  {
    id: 'w11-l09-before',
    steps: [...diaryDay2, { write: 'index.html', content: DAY3 }, 'git commit -am "Add day 3 entry"'],
    verify: [['git reset --hard HEAD~2', 'git log --oneline']],
  },
  // 11.9 After `git reset --hard HEAD~2`: day 2 and day 3 look gone.
  {
    id: 'w11-l09',
    steps: [...diaryDay2, { write: 'index.html', content: DAY3 }, 'git commit -am "Add day 3 entry"', 'git reset --hard HEAD~2'],
    verify: [
      ['git reflog'],
      ['git reset --hard HEAD@{1}', 'git log --oneline'],
      ['git branch rescue HEAD@{1}', 'git log --oneline --all'],
      ['git reset --hard ORIG_HEAD', 'git log --oneline'],
    ],
  },

  // 11.10 Push rejected: Aisyah pushed an about page; you committed day 2 and haven't fetched.
  {
    id: 'w11-l10',
    steps: [
      ...online,
      ...teammate([{ write: 'about.html', content: ABOUT }, 'git add about.html'], "Add Aisyah's about page"),
      { write: 'index.html', content: DAY2 },
      'git commit -am "Add day 2 entry"',
    ],
    // (The rejected `git push` itself is shown by the lesson; verify lists only hold commands that succeed.)
    verify: [
      ['git pull --rebase', 'git push', 'git log --oneline', 'git status -s'],
      ['git pull --no-rebase', 'git push', 'git log --oneline --graph'],
      ['git fetch', 'git status', 'git log --oneline --graph --all'],
    ],
  },

  // 11.11 Messy pull: Aisyah and you both changed the day 1 line.
  {
    id: 'w11-l11',
    steps: [
      ...online,
      ...teammate([{ write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: Aisyah taught me Git.</p>\n' }], 'Thank Aisyah on day 1'),
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I learned Git. So fun!</p>\n' },
      'git commit -am "Say Git is fun"',
    ],
    verify: [
      ['git pull --rebase', 'git status', 'git rebase --abort', 'git status -s', 'git log --oneline'],
      ['git pull --rebase', 'git status -s', 'git rebase --abort', 'git status'],
      ['git pull --no-rebase', 'git status', 'git merge --abort', 'git status -s'],
    ],
  },

  // 11.12 Huge file: video.mp4 slipped into the last commit. Not pushed.
  {
    id: 'w11-l12',
    steps: [...online, ...bigFile],
    verify: [
      ['git show --stat'],
      ['git rm --cached video.mp4', 'git status -s'],
      ['git rm --cached video.mp4', 'echo "*.mp4" >> .gitignore', 'git add .gitignore', 'git commit --amend --no-edit', 'git show --stat', 'git status -s'],
      [
        'echo "<p>Day 2: I went on a trip.</p>" >> index.html',
        'git commit -am "Add day 2 entry"',
        'git reset --soft origin/main',
        'git rm --cached video.mp4',
        'echo "*.mp4" >> .gitignore',
        'git add .gitignore',
        'git commit -m "Add trip page"',
        'git status -s',
        'git log --oneline',
      ],
    ],
  },
  // 11.12 Rescue flow: the big file was pushed (GitHub took it).
  {
    id: 'w11-l12-pushed',
    steps: [...online, ...bigFile, 'git push'],
    verify: [['git rm --cached video.mp4', 'echo "*.mp4" >> .gitignore', 'git add .gitignore', 'git commit -m "Stop tracking video.mp4"', 'git push', 'git status -s']],
  },

  // 11.13 Line endings: the diary is on GitHub; a teammate on Windows sees every line changed.
  {
    id: 'w11-l13',
    steps: online,
    verify: [
      ['echo "* text=auto" > .gitattributes', 'git add .gitattributes', 'git add --renormalize .', 'git commit -m "Normalize line endings"', 'git status -s', 'cat .gitattributes'],
      ['echo "<p>Day 2</p>" >> index.html', 'git add --renormalize .', 'git status', 'git status -s'],
      ['git config --global core.autocrlf true', 'git config --global core.autocrlf input', 'git status -s'],
    ],
  },

  // 11.14 Permission denied (publickey): origin uses SSH, and the key isn't set up. A new commit waits.
  {
    id: 'w11-l14',
    steps: [...online, `git remote set-url origin ${SSH_URL}`, { write: 'index.html', content: DAY2 }, 'git commit -am "Add day 2 entry"'],
    verify: [
      ['git remote -v'],
      [`git remote set-url origin ${URL}`, 'git remote -v', 'git push', 'git status -s'],
    ],
  },

  // 11.15 Protected branch: you committed on main; GitHub only takes main changes through a PR.
  {
    id: 'w11-l15',
    steps: [...online, { write: 'index.html', content: '<h1>My Dear Diary</h1>\n<p>Day 1: I learned Git.</p>\n' }, 'git commit -am "Fix the title"'],
    verify: [
      ['git switch -c fix-title', 'git push -u origin fix-title', 'git status', 'git branch -vv'],
      ['git switch -c fix-title', 'git push -u origin fix-title', 'git branch -f main origin/main', 'git branch -vv'],
      ['git switch -c my-fix', 'git push -u origin my-fix', 'git branch -vv'],
    ],
  },
];
