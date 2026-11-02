// World 9 scenarios (Power Tools). Most of this world is about GitHub tools (gh, Codespaces,
// Pages…) that the simulator doesn't run; those lessons use Transcript instead.
// Lesson 9.4 shows that a commit made in an app (GitHub Desktop, an editor's Git panel)
// is a normal commit: `git log` in the terminal sees it.
import type { Scenario } from '~/engine/git-sim';

const DAY1 = '<h1>My Diary</h1>\n<p>Day 1: I learned Git.</p>\n';
const CONTACT = '<h1>Contact</h1>\n<p>Email me any time.</p>\n';

export const w09: Scenario[] = [
  {
    // The diary, with its newest commit made "in the app".
    id: 'w09-l04',
    steps: [
      'mkdir diary',
      'cd diary',
      'git init',
      { write: 'README.md', content: '# My Diary\n' },
      'git add README.md',
      'git commit -m "Add README"',
      { write: 'index.html', content: DAY1 },
      'git add index.html',
      'git commit -m "Add day 1 page"',
      { write: 'contact.html', content: CONTACT },
      'git add contact.html',
      'git commit -m "Add contact page"',
    ],
    verify: [['git log --oneline'], ['git status']],
  },
];
