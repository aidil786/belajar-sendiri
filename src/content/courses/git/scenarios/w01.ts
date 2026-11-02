// Starting states for World 1 lessons. Each `verify` list is replayed in real Git
// by `npm run verify:commands`, so the simulator never drifts from Git.
// Every lesson uses the same "diary" project in /home/you/diary.
import type { Scenario, ScenarioStep } from '~/engine/git-sim';

/** The diary project with one commit (README.md). */
const diaryStart = [
  'mkdir diary',
  'cd diary',
  'git init',
  { write: 'README.md', content: '# My Diary\n' },
  'git add README.md',
  'git commit -m "Add README"',
] as const;

/** The diary with three clean commits: README, home page, style. */
const diaryPages: ScenarioStep[] = [
  ...diaryStart,
  { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n' },
  'git add index.html',
  'git commit -m "Add home page"',
  { write: 'style.css', content: 'body { color: purple; }\n' },
  'git add style.css',
  'git commit -m "Add purple style"',
];

/** index.html for lesson 1.12: a title typo near the top, the day entries near the bottom. */
const longHome = (title: string, extra: string) =>
  [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    `<title>${title}</title>`,
    '<link rel="stylesheet" href="style.css">',
    '</head>',
    '<body>',
    '<h1>My Diary</h1>',
    '<p>Welcome to my diary.</p>',
    '<p>Day 1: I made a repo.</p>',
    '<p>Day 2: I learned the box.</p>',
    '<p>Day 3: I made my first commit.</p>',
    extra,
    '</body>',
    '</html>',
  ]
    .filter((l) => l !== '')
    .join('\n') + '\n';

/** The boss builds the diary site in five clean commits. Each stage starts where the last one ended. */
const homePage = '<h1>My Diary</h1>\n<p>Welcome! I am learning Git.</p>\n';
const boss1: ScenarioStep[] = ['mkdir diary', 'cd diary', { write: 'README.md', content: '# My Diary\nA tiny website about learning Git.\n' }];
const boss2: ScenarioStep[] = [
  ...boss1,
  'git init',
  'git add README.md',
  'git commit -m "Add README"',
  { write: 'index.html', content: homePage },
  { write: 'style.css', content: 'body { color: purple; }\n' },
];
const boss3: ScenarioStep[] = [
  ...boss2,
  'git add index.html',
  'git commit -m "Add home page"',
  { write: 'index.html', content: `<link rel="stylesheet" href="style.css">\n${homePage}` },
];
const boss4: ScenarioStep[] = [...boss3, 'git add style.css index.html', 'git commit -m "Add purple style"', { write: 'debug.log', content: 'server started\n' }];
const boss5: ScenarioStep[] = [
  ...boss4,
  { write: '.gitignore', content: '*.log\n' },
  'git add .gitignore',
  'git commit -m "Ignore log files"',
  { write: 'about.html', content: '<h1>About me</h1>\n<p>I like nasi lemak and code.</p>\n' },
  { write: 'index.html', content: `<link rel="stylesheet" href="style.css">\n${homePage}<a href="about.html">About me</a>\n` },
];

export const w01: Scenario[] = [
  // 1.1 Make a repo: a folder with files, but no repo yet.
  {
    id: 'w01-l01',
    steps: [
      'mkdir diary',
      'cd diary',
      { write: 'README.md', content: '# My Diary\n' },
      { write: 'index.html', content: '<h1>My Diary</h1>\n' },
    ],
    verify: [['git init'], ['git init', 'git status'], ['git init', 'git init']],
  },
  {
    id: 'w01-l03',
    steps: [
      ...diaryStart,
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n' },
      { write: 'style.css', content: 'body { color: purple; }\n' },
      { write: 'about.html', content: '<h1>About me</h1>\n<p>TODO</p>\n' },
    ],
    verify: [
      ['git add index.html', 'git status -s'],
      ['git add index.html', 'git status'],
      ['git add index.html', 'git commit -m "Add day 1 page"', 'git status -s', 'git log --oneline'],
      ['git add index.html', 'git restore --staged index.html', 'git status -s'],
    ],
  },
  // 1.4 Read git status: something in every group.
  {
    id: 'w01-l04',
    steps: [
      ...diaryPages,
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n<p>Day 2: I read git status.</p>\n' },
      { write: 'about.html', content: '<h1>About me</h1>\n<p>I like nasi lemak and code.</p>\n' },
      'git add index.html about.html',
      { write: 'style.css', content: 'body { color: purple; }\nh1 { color: teal; }\n' },
      { write: 'notes.txt', content: 'Ideas for day 3\n' },
      { write: 'todo.txt', content: 'Buy snacks\n' },
    ],
    verify: [['git status'], ['git status -s'], ['git status -sb']],
  },
  // 1.5 First save point: index.html is new and not in the box yet.
  {
    id: 'w01-l05',
    steps: [...diaryStart, { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n' }],
    verify: [
      ['git add index.html', 'git commit -m "Add home page"', 'git log'],
      ['git add index.html', 'git commit -m "Add home page"', 'git log --oneline'],
    ],
  },
  // 1.5 The same diary after the first real save point.
  {
    id: 'w01-l05-saved',
    steps: [
      ...diaryStart,
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n' },
      'git add index.html',
      'git commit -m "Add home page"',
    ],
    verify: [['git log'], ['git show']],
  },
  // 1.6 A history with messages nobody can understand.
  {
    id: 'w01-l06-messy',
    steps: [
      ...diaryStart,
      { write: 'index.html', content: '<h1>My Diary</h1>\n' },
      'git add index.html',
      'git commit -m "stuff"',
      { write: 'style.css', content: 'body { color: purple; }\n' },
      'git add style.css',
      'git commit -m "update"',
      { write: 'about.html', content: '<h1>About me</h1>\n' },
      'git add about.html',
      'git commit -m "asdf"',
      { write: 'index.html', content: '<h1>My Diary</h1>\n<a href="about.html">About me</a>\n' },
      'git add index.html',
      'git commit -m "fix"',
    ],
    verify: [['git log --oneline']],
  },
  // 1.6 Clean history; about.html waits for a clean message.
  {
    id: 'w01-l06',
    steps: [...diaryPages, { write: 'about.html', content: '<h1>About me</h1>\n<p>I like nasi lemak and code.</p>\n' }],
    verify: [
      ['git add about.html', 'git commit -m "Add about page"', 'git log --oneline'],
      ['git add about.html', 'git commit -m "feat: add about page"', 'git log --oneline'],
      ['git add about.html', 'git commit -m "feat: add about page" -m "It lists my favourite food."', 'git log -n 1'],
    ],
  },
  // 1.7 Five commits that each change index.html (for the time machine).
  {
    id: 'w01-l07',
    steps: [
      'mkdir diary',
      'cd diary',
      'git init',
      { write: 'index.html', content: '<h1>My Diary</h1>\n' },
      'git add index.html',
      'git commit -m "Add home page"',
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I made a repo.</p>\n' },
      'git add index.html',
      'git commit -m "Add day 1 entry"',
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I made a repo.</p>\n<p>Day 2: I learned the box.</p>\n' },
      'git add index.html',
      'git commit -m "Add day 2 entry"',
      {
        write: 'index.html',
        content: '<h1>My Diary</h1>\n<p>Day 1: I made a repo.</p>\n<p>Day 2: I learned the box.</p>\n<p>Day 3: I made my first commit.</p>\n',
      },
      'git add index.html',
      'git commit -m "Add day 3 entry"',
      {
        write: 'index.html',
        content: '<h1>My Git Diary</h1>\n<p>Day 1: I made a repo.</p>\n<p>Day 2: I learned the box.</p>\n<p>Day 3: I made my first commit.</p>\n',
      },
      'git add index.html',
      'git commit -m "Change title to My Git Diary"',
    ],
    verify: [['git log'], ['git log --oneline'], ['git log --oneline --graph --all'], ['git show'], ['git log --oneline -n 2']],
  },
  // 1.8 Spot the difference: three commits, plus a change in the folder.
  {
    id: 'w01-l08',
    steps: [
      ...diaryStart,
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I made a repo.</p>\n<p>TODO: write day 2</p>\n' },
      'git add index.html',
      'git commit -m "Add home page"',
      {
        write: 'index.html',
        content: '<h1>My Diary</h1>\n<p>Day 1: I made a repo.</p>\n<p>Day 2: I learned the box.</p>\n<p>TODO: write day 3</p>\n',
      },
      'git add index.html',
      'git commit -m "Add day 2 entry"',
      {
        write: 'index.html',
        content:
          '<h1>My Diary</h1>\n<p>Day 1: I made a repo.</p>\n<p>Day 2: I learned the box.</p>\n<p>Day 3: I made my first commit.</p>\n<p>It felt great!</p>\n',
      },
    ],
    verify: [['git diff'], ['git add index.html', 'git diff', 'git diff --staged'], ['git log --oneline'], ['git diff --name-only']],
  },
  // 1.9 Ignore files: two log files clutter git status.
  {
    id: 'w01-l09',
    steps: [...diaryPages, { write: 'debug.log', content: 'server started\n' }, { write: 'error.log', content: 'page not found\n' }],
    verify: [['git status -s'], ['git status']],
  },
  // 1.9 The same diary after .gitignore was written.
  {
    id: 'w01-l09-ignored',
    steps: [
      ...diaryPages,
      { write: 'debug.log', content: 'server started\n' },
      { write: 'error.log', content: 'page not found\n' },
      { write: '.gitignore', content: '*.log\n' },
    ],
    verify: [['git status -s'], ['git add .', 'git status -s'], ['git add .gitignore', 'git commit -m "Ignore log files"', 'git status']],
  },
  // 1.10 Remove and rename: an old file, a badly named page, a log saved by mistake.
  {
    id: 'w01-l10',
    steps: [
      ...diaryStart,
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n' },
      { write: 'aboutme.html', content: '<h1>About me</h1>\n<p>I like nasi lemak and code.</p>\n' },
      { write: 'old-notes.txt', content: 'Ideas I never used\n' },
      { write: 'debug.log', content: 'server started\n' },
      'git add .',
      'git commit -m "Add diary pages"',
      { write: '.gitignore', content: '*.log\n' },
      'git add .gitignore',
      'git commit -m "Ignore log files"',
    ],
    verify: [
      ['git rm old-notes.txt', 'git status -s'],
      ['git rm --cached debug.log', 'git status -s'],
      ['git mv aboutme.html about.html', 'git status -s', 'git commit -m "Rename about page"', 'git status'],
    ],
  },
  // 1.11 HEAD: four commits on main.
  {
    id: 'w01-l11',
    steps: [
      ...diaryPages,
      { write: 'about.html', content: '<h1>About me</h1>\n<p>I like nasi lemak and code.</p>\n' },
      'git add about.html',
      'git commit -m "Add about page"',
    ],
    verify: [['git log --oneline'], ['git log --oneline --graph --all'], ['git branch'], ['git status']],
  },
  // 1.12 Small commits: one file, two separate changes far apart (two hunks).
  {
    id: 'w01-l12',
    steps: [
      ...diaryStart,
      { write: 'index.html', content: longHome('My Dairy', '') },
      'git add index.html',
      'git commit -m "Add home page"',
      { write: 'index.html', content: longHome('My Diary', '<p>Day 4: I learned small commits.</p>') },
    ],
    verify: [['git diff'], ['git status -s']],
  },
  // Boss, stage 1: the README is written, no repo yet.
  { id: 'w01-boss-1', steps: boss1, verify: [['git init', 'git add README.md', 'git commit -m "Add README"', 'git log --oneline']] },
  // Boss, stage 2: home page and style are both new. Only the home page goes in.
  { id: 'w01-boss-2', steps: boss2, verify: [['git add index.html', 'git commit -m "Add home page"', 'git status -s']] },
  // Boss, stage 3: style.css is new and index.html links to it. One change, one commit.
  { id: 'w01-boss-3', steps: boss3, verify: [['git add style.css index.html', 'git commit -m "Add purple style"', 'git status']] },
  // Boss, stage 4: a log file appears.
  { id: 'w01-boss-4', steps: boss4, verify: [['git status -s']] },
  // Boss, stage 5: the about page and its link.
  { id: 'w01-boss-5', steps: boss5, verify: [['git add about.html index.html', 'git commit -m "Add about page"', 'git log --oneline']] },
];
