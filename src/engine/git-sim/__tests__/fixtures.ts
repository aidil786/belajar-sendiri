// Example scenarios for Worlds 3–4 engine features and World 10 error cases. The unit tests build them, and
// `npm run verify:commands` replays every `verify` list in real Git too (with
// https://github.com/... mapped to local bare repos). Lesson scenarios live in
// src/content/courses/git/scenarios/; these are engine fixtures only.
import type { Scenario, ScenarioStep } from '../index';
import { W10_STEPS } from '../../../content/courses/git/scenarios/w10';

const page = (lines: string[]) => `${lines.join('\n')}\n`;
const DAYS = ['<h1>My Diary</h1>', '<p>Day 1</p>', '<p>Day 2</p>', '<p>Day 3</p>', '<p>Day 4</p>', '<p>Day 5</p>', '<p>Day 6</p>', '<p>Day 7</p>'];
const withLine = (i: number, text: string) => page(DAYS.map((l, j) => (j === i ? text : l)));

/** The diary: index.html (8 lines) and style.css, one commit on main. */
export const diary: ScenarioStep[] = [
  'mkdir diary',
  'cd diary',
  'git init',
  { write: 'index.html', content: page(DAYS) },
  { write: 'style.css', content: 'body { color: purple; }\n' },
  'git add .',
  'git commit -m "Add home page"',
];

/** about.html on branch `about`; main gets a title change (far from the about work). */
const branches: ScenarioStep[] = [
  ...diary,
  'git switch -c about',
  { write: 'about.html', content: '<h1>About me</h1>\n' },
  'git add about.html',
  'git commit -m "Add about page"',
  { write: 'about.html', content: '<h1>About me</h1>\n<p>I like Git.</p>\n' },
  'git commit -am "Say what I like"',
  'git switch main',
];

/** feature and main both change line 2 of index.html, add new.txt, and one deletes style.css. */
const conflicts: ScenarioStep[] = [
  ...diary,
  'git switch -c feature',
  { write: 'index.html', content: withLine(2, '<p>Day 2: feature</p>') },
  { write: 'new.txt', content: 'from feature\n' },
  'git rm style.css',
  'git add .',
  'git commit -m "Feature work"',
  'git switch main',
  { write: 'index.html', content: withLine(2, '<p>Day 2: main</p>') },
  { write: 'new.txt', content: 'from main\n' },
  { write: 'style.css', content: 'body { color: teal; }\n' },
  'git add .',
  'git commit -m "Main work"',
];

/** feature (2 commits, end of the file) and fix (line 1) branch off; main changes line 1 too. */
const replay: ScenarioStep[] = [
  ...diary,
  'git switch -c feature',
  { write: 'index.html', content: withLine(7, '<p>Day 7: feature</p>') },
  'git commit -am "Write day 7"',
  { write: 'contact.html', content: '<h1>Contact</h1>\n' },
  'git add contact.html',
  'git commit -m "Add contact page"',
  'git switch main',
  'git switch -c fix',
  { write: 'index.html', content: withLine(1, '<p>Day 1: fixed</p>') },
  'git commit -am "Fix day 1"',
  'git switch main',
  { write: 'index.html', content: withLine(1, '<p>Day 1: better</p>') },
  'git commit -am "Improve day 1"',
];

const URL = 'https://github.com/you/diary.git';

/** You push the diary to GitHub; Aisyah clones it, adds a line and pushes. You haven't fetched yet. */
const teamwork: ScenarioStep[] = [
  { server: URL },
  ...diary,
  `git remote add origin ${URL}`,
  'git push -u origin main',
  'mkdir -p /home/aisyah',
  'cd /home/aisyah',
  `git clone ${URL}`,
  'cd diary',
  'git config user.name "Aisyah"',
  'git config user.email "aisyah@example.com"',
  { write: 'index.html', content: withLine(7, '<p>Day 7: Aisyah was here</p>') },
  'git commit -am "Add Aisyah\'s day"',
  'git push',
  'cd /home/you/diary',
];

export const verifyFixtures: Scenario[] = [
  {
    // Revert an older commit when a later commit changed a different line of the same file:
    // Git's three-way merge reverts it cleanly and keeps the later edit.
    id: 'fx-revert-same-file',
    steps: [
      ...diary,
      { write: 'notes.txt', content: 'a\nb\nc\nd\ne\n' },
      'git add notes.txt',
      'git commit -m "Add notes"',
      { write: 'notes.txt', content: 'a\nb\nc\nd\nE\n' },
      'git commit -am "Shout e"',
      { write: 'notes.txt', content: 'A\nb\nc\nd\nE\n' },
      'git commit -am "Shout a"',
    ],
    verify: [
      ['git revert --no-edit HEAD~1', 'git log --oneline', 'git status'],
      ['git revert --no-edit HEAD', 'git revert --no-edit HEAD~2', 'git log --oneline'],
    ],
  },
  {
    id: 'fx-branches',
    steps: branches,
    verify: [
      ['git branch', 'git branch -v', 'git branch -d about', 'git merge about', 'git branch --merged', 'git branch -d about', 'git log --oneline --graph --all'],
      ['git branch feature', 'git switch feature', 'git switch -', 'git branch -m feature feat', 'git branch -v', 'git branch -D feat', 'git branch'],
      ['git merge --no-ff about', 'git log --oneline --graph', 'git show HEAD', 'git log --merges --oneline'],
      ['git switch -c side', 'echo "<p>Side</p>" >> index.html', 'git commit -am "Side note"', 'git switch main', 'git merge --ff-only side', 'git log --oneline'],
      [
        'echo "h1 { color: teal; }" >> style.css',
        'git commit -am "Teal title"',
        'git merge --ff-only about',
        'git merge about',
        'git log --oneline --graph --all',
        'git log --oneline main..about',
        'git branch -d about',
      ],
      ['git checkout -b side', 'git checkout main', 'git checkout -b other about', 'git branch --no-merged main', 'git branch -d other'],
      ['git switch -c x about', 'git branch --show-current', 'git switch -C x main', 'git log --oneline'],
      ['echo "changed" >> index.html', 'git switch about', 'git status -s', 'git switch -c keep', 'git status -s'],
      ['echo "<h1>Mine</h1>" > about.html', 'git switch about'],
      ['git merge nope', 'git merge', 'git branch bad..name', 'git branch about', 'git branch new nope', 'git branch -d main'],
    ],
  },
  {
    id: 'fx-conflicts',
    steps: conflicts,
    verify: [
      ['git merge feature', 'git status', 'git status -s', 'git diff', 'git commit -m "Try"', 'git merge feature'],
      ['git merge feature', 'git merge --abort', 'git status', 'git merge --abort'],
      [
        'git merge feature',
        'echo "<h1>My Diary</h1>" > index.html',
        'git add index.html',
        'git status',
        'git add new.txt',
        'git rm style.css',
        'git status',
        'git diff --cached',
        'git commit -m "Merge feature"',
        'git log --oneline --graph',
        'git show HEAD',
      ],
      ['git merge feature', 'git add .', 'git status', 'git merge --continue', 'git log --oneline -1'],
      ['git merge feature', 'git commit -am "Keep the markers"', 'git status -s'],
      ['git merge feature', 'git checkout -- index.html', 'git restore index.html', 'git switch feature', 'git merge --continue'],
      ['git merge feature', 'git reset --hard', 'git status'],
      ['git switch feature', 'git merge main', 'git status -s', 'git diff'],
      ['echo "local" >> index.html', 'git merge feature'],
    ],
  },
  {
    id: 'fx-stash-rebase-pick-tag',
    steps: replay,
    verify: [
      ['echo "/* draft */" >> style.css', 'echo "todo" > notes.txt', 'git stash', 'git stash list', 'git status -s', 'git stash show', 'git stash show -p', 'git stash pop', 'git status -s', 'git stash list'],
      ['echo "/* a */" >> style.css', 'git stash push -m "style draft"', 'echo "todo" > notes.txt', 'git stash -u', 'git stash list', 'git status -s', 'git stash apply', 'git stash drop', 'git stash list', 'git stash pop', 'git stash pop'],
      ['echo "/* a */" >> style.css', 'git stash', 'echo "/* b */" >> style.css', 'git commit -am "B"', 'git stash pop', 'git status', 'git status -s', 'git stash list'],
      ['echo "x" >> style.css', 'git add style.css', 'git stash', 'git stash clear', 'git stash list', 'git stash'],
      ['git switch feature', 'git rebase main', 'git log --oneline --graph --all', 'git rebase main'],
      ['git switch fix', 'git rebase main', 'git status', 'git rebase --continue', 'git switch main'],
      ['git switch fix', 'git rebase main', 'echo "<p>Day 1: fixed and better</p>" > index.html', 'git add index.html', 'git status', 'git rebase --continue', 'git log --oneline --graph --all'],
      ['git switch fix', 'git rebase main', 'git rebase --skip', 'git log --oneline', 'git status'],
      ['git switch fix', 'git rebase main', 'git rebase --abort', 'git status', 'git log --oneline'],
      ['git switch fix', 'echo "dirty" >> style.css', 'git rebase main', 'git rebase', 'git rebase nope'],
      ['git cherry-pick feature~1', 'git log --oneline -3', 'git cherry-pick feature~1', 'git cherry-pick --skip', 'git status'],
      ['git cherry-pick fix', 'git status', 'git status -s', 'git cherry-pick --abort', 'git status -s', 'git cherry-pick --abort'],
      ['git cherry-pick fix', 'echo "<p>Day 1: both</p>" > index.html', 'git add index.html', 'git cherry-pick --continue', 'git log --oneline -2', 'git cherry-pick nope'],
      ['git tag v1.0', 'git tag -a v1.1 -m "Version 1.1"', 'git tag', 'git tag v1.0', 'git log --oneline --all', 'git show v1.1', 'git tag old feature~1', 'git tag -d v1.0', 'git tag -d nope', 'git tag'],
      ['git switch feature', 'git merge main', 'git rebase main'],
    ],
  },
  {
    id: 'fx-teamwork',
    steps: teamwork,
    verify: [
      ['git remote', 'git remote -v', 'git status', 'git fetch', 'git status', 'git branch -vv', 'git log --oneline --all', 'git pull', 'git status', 'git fetch'],
      ['echo "x" > x.txt', 'git add x.txt', 'git commit -m "Add x"', 'git push', 'git fetch', 'git status', 'git pull', 'git pull --ff-only', 'git pull --no-rebase', 'git push', 'git log --oneline --graph --all'],
      ['echo "x" > x.txt', 'git add x.txt', 'git commit -m "Add x"', 'git pull --rebase', 'git status', 'git push', 'git log --oneline --all'],
      ['git commit --amend -m "Start the diary"', 'git push', 'git push --force-with-lease', 'git fetch', 'git push --force-with-lease', 'git status'],
      ['git remote rename origin upstream', 'git remote -v', 'git branch -vv', 'git remote set-url upstream https://github.com/you/diary2.git', 'git remote -v', 'git remote remove upstream', 'git remote', 'git branch -vv'],
      ['git remote add origin https://github.com/you/x.git', 'git remote remove nope', 'git push nope main', 'git push origin nope'],
      ['git tag v1.0', 'git tag -a v1.1 -m "Version 1.1"', 'git push origin v1.0', 'git push --tags', 'git push --tags', 'git push origin --delete v1.0'],
      ['git switch -c feature', 'echo "f" > f.txt', 'git add f.txt', 'git commit -m "Add f"', 'git push', 'git push -u origin feature', 'git branch -vv', 'git push origin --delete feature', 'git branch -vv', 'git branch -a', 'git status'],
      ['git switch -c y', 'git push origin y', 'git branch -u origin/y', 'git branch -vv', 'git branch --unset-upstream', 'git branch -vv'],
      ['cd /home/you', 'git clone https://github.com/you/diary.git copy', 'git clone https://github.com/you/diary.git copy', 'cd copy', 'git log --oneline', 'git branch -a', 'git status'],
      ['cd /home/aisyah/diary', 'git switch -c topic', 'echo "t" > t.txt', 'git add t.txt', 'git commit -m "Topic"', 'git push -u origin topic', 'cd /home/you/diary', 'git fetch', 'git switch topic', 'git branch -vv', 'cd /home/aisyah/diary', 'git push origin --delete topic', 'cd /home/you/diary', 'git fetch', 'git fetch --prune', 'git branch -a'],
    ],
  },
  // World 10 error cases (the lesson scenarios keep only commands that succeed).
  {
    id: 'fx-w10-objects-errors',
    exactHashes: true,
    steps: W10_STEPS.shop,
    verify: [['git cat-file -p nope', 'git rev-parse nope', 'git ls-tree nope', 'git cat-file -p HEAD:missing.txt', 'git hash-object nope.txt', 'git show-ref nothing', 'cat .git/MERGE_HEAD']],
  },
  {
    id: 'fx-w10-bisect-errors',
    exactHashes: true,
    steps: W10_STEPS.bisect,
    verify: [
      ['git bisect start HEAD HEAD~9', 'git bisect good', 'git bisect bad', 'git bisect bad', 'git bisect good', 'git bisect log', 'git bisect reset'],
      ['git bisect start HEAD~9 HEAD', 'git bisect reset', 'git bisect good', 'git bisect log'],
      ['sh test.sh', './test.sh', 'git bisect start HEAD HEAD~9', 'git bisect skip', 'git bisect skip', 'git bisect skip', 'git bisect skip', 'git bisect skip', 'git bisect skip', 'git bisect skip', 'git bisect skip', 'git bisect log'],
    ],
  },
  {
    id: 'fx-w10-worktree-errors',
    exactHashes: true,
    steps: W10_STEPS.diary,
    verify: [
      ['git worktree add ../diary-fix -b fix', 'git switch fix', 'git checkout fix', 'git branch -d fix', 'git worktree add ../again fix', 'git worktree add ../diary-fix', 'git worktree remove ../nope'],
      ['git worktree add ../old HEAD~1', 'echo "x" > ../old/new.txt', 'git worktree remove ../old', 'git worktree list'],
    ],
  },
  {
    id: 'fx-new-repo',
    steps: [
      { server: 'https://github.com/you/empty.git' },
      { server: 'https://github.com/you/notes.git', files: { 'README.md': '# Notes\n' }, message: 'Initial commit' },
    ],
    verify: [
      ['git clone https://github.com/you/empty.git', 'cd empty', 'git status', 'git status -sb', 'echo "hi" > a.txt', 'git add a.txt', 'git commit -m "First"', 'git push', 'git status'],
      ['git clone https://github.com/you/notes.git', 'cd notes', 'git log --oneline', 'git status -sb', 'git branch -vv'],
      ['mkdir diary', 'cd diary', 'git init', 'git pull', 'git remote add origin https://github.com/you/notes.git', 'git pull', 'git pull origin main', 'git log --oneline'],
    ],
  },
];
