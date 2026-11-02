// Starting states for World 0 lessons. Each `verify` list is replayed in real Git
// by `npm run verify:commands`, so the simulator never drifts from Git.
// Note: `git <cmd> -h` (exit code 129) and `git help <cmd>` (opens a manual page)
// are left out of `verify` on purpose: they don't exit cleanly in real Git.
import type { Scenario } from '~/engine/git-sim';

/** A small diary project with two commits, made by the default identity. */
const diaryTwoCommits = [
  'mkdir diary',
  'cd diary',
  'git init',
  { write: 'README.md', content: '# My Diary\n' },
  'git add README.md',
  'git commit -m "Add README"',
  { write: 'index.html', content: '<h1>My Diary</h1>\n' },
  'git add index.html',
  'git commit -m "Add home page"',
] as const;

export const w00: Scenario[] = [
  {
    // 0.1 Why save versions: one essay, four save points, for the time machine slider.
    id: 'w00-l01',
    steps: [
      'mkdir essay',
      'cd essay',
      'git init',
      { write: 'essay.txt', content: 'My Holiday\n' },
      'git add essay.txt',
      'git commit -m "Start essay"',
      { write: 'essay.txt', content: 'My Holiday\n\nWe went to Langkawi.\n' },
      'git add essay.txt',
      'git commit -m "Add first line"',
      { write: 'essay.txt', content: 'My Holiday\n\nWe went to Langkawi.\nWe saw eagles.\n' },
      'git add essay.txt',
      'git commit -m "Add eagles"',
      { write: 'essay.txt', content: 'My Holiday\n\nWe went to Langkawi.\nWe saw eagles and monkeys.\nBest trip ever.\n' },
      'git add essay.txt',
      'git commit -m "Add ending"',
    ],
    verify: [['git log --oneline']],
  },
  {
    // 0.2 Terminal basics: a home folder with two folders and a file. No repo yet.
    id: 'w00-l02',
    steps: [
      'mkdir Documents',
      'mkdir Music',
      { write: 'notes.txt', content: 'Buy milk\n' },
      { write: 'Documents/homework.txt', content: 'Maths: page 12\n' },
      { write: 'Music/playlist.txt', content: 'Song 1\nSong 2\n' },
    ],
    verify: [
      ['pwd'],
      ['ls'],
      ['cd Documents', 'pwd', 'ls'],
      ['cd Music', 'pwd'],
      ['mkdir projects', 'cd projects', 'pwd'],
    ],
  },
  {
    // 0.3 Install Git: an empty home folder, just to check the version.
    id: 'w00-l03',
    steps: [],
    verify: [['git --version']],
  },
  {
    // 0.4 Tell Git who you are: no name, no email, no settings at all.
    id: 'w00-l04',
    config: {},
    steps: [],
    verify: [
      ['git config --global user.name "Aiman Hakim"', 'git config --global user.name'],
      ['git config --global user.email "aiman@example.com"', 'git config --global user.email'],
      ['git config --global init.defaultBranch main', 'git init diary'],
      ['git config --global core.editor "code --wait"', 'git config --global --list'],
    ],
  },
  {
    // 0.4 hook: a commit signed by the placeholder identity.
    id: 'w00-l04-log',
    steps: [...diaryTwoCommits],
    verify: [['git log -n 1']],
  },
  {
    // 0.5 Git vs GitHub: history you can read with no internet.
    id: 'w00-l05',
    steps: [...diaryTwoCommits],
    verify: [['git log --oneline']],
  },
  {
    // 0.7 Git in VS Code: one changed file and one new file.
    id: 'w00-l07',
    steps: [
      ...diaryTwoCommits,
      { write: 'index.html', content: '<h1>My Diary</h1>\n<p>Day 1: I set up Git.</p>\n' },
      { write: 'style.css', content: 'body { color: purple; }\n' },
    ],
    verify: [
      ['git status'],
      ['git add style.css', 'git commit -m "Add styles"', 'git status -s'],
    ],
  },
  {
    // 0.8 Getting help: inside a repo, so every help command makes sense.
    id: 'w00-l08',
    steps: [...diaryTwoCommits],
    verify: [['git help']],
  },
];
