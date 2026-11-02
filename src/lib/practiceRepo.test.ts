import { describe, expect, it } from 'vitest';
import {
  availableLabels,
  closingRefs,
  extractSuggestion,
  initialState,
  isTaskDone,
  mergeBlockers,
  reduce,
  type Pull,
  type RepoState,
} from './practiceRepo';

const me = 'you';

function pull(extra: Partial<Pull> = {}): Pull {
  return {
    number: 7,
    title: 'Add contact page',
    body: 'Adds a contact page.\n\nCloses #3',
    author: 'aina',
    from: 'contact-page',
    to: 'main',
    state: 'open',
    checks: [{ name: 'test', status: 'pass' }],
    files: [{ path: 'contact.html', diff: ['@@ -0,0 +1,2 @@', '+<h1>Contact</h1>', '+<p>Email me</p>'] }],
    ...extra,
  };
}

function base(extra: Partial<Pull> = {}, rules: { id: string; on: boolean }[] = []): RepoState {
  return initialState({
    issues: [
      { number: 3, title: 'No contact page', body: 'Please add one.', state: 'open', author: 'mei', labels: ['enhancement'] },
      { number: 4, title: 'Typo', body: 'Teh', state: 'open', author: 'mei' },
    ],
    pulls: [pull(extra)],
    runs: [
      {
        id: 41,
        workflow: 'CI',
        event: 'push',
        branch: 'main',
        status: 'fail',
        jobs: [{ name: 'test', steps: [{ name: 'Check out', status: 'pass' }, { name: 'Run tests', status: 'fail', log: ['1 failed'] }, { name: 'Deploy', status: 'skipped' }] }],
      },
    ],
    rules: rules.map((r) => ({ ...r, label: r.id })),
  });
}

describe('closing keywords', () => {
  it('finds Closes/Fixes/Resolves #N in any case', () => {
    expect(closingRefs('Closes #3')).toEqual([3]);
    expect(closingRefs('fixes #12 and RESOLVED #4, closed #3')).toEqual([12, 4, 3]);
    expect(closingRefs('fix #1 fixed #2 resolve #5 close #6')).toEqual([1, 2, 5, 6]);
  });

  it('ignores plain mentions', () => {
    expect(closingRefs('See #3. Related to #4.')).toEqual([]);
    expect(closingRefs('enclosed #3')).toEqual([]);
  });
});

describe('suggestions', () => {
  it('splits a suggestion block from the comment', () => {
    expect(extractSuggestion('Nice!\n```suggestion\n<h1>Contact us</h1>\n```')).toEqual({ text: 'Nice!', suggestion: '<h1>Contact us</h1>' });
    expect(extractSuggestion('Just a note')).toEqual({ text: 'Just a note' });
  });

  it('a line comment with a changed suggestion completes the task', () => {
    let s = base();
    s = reduce(s, { type: 'lineComment', pr: 7, path: 'contact.html', line: 2, body: '```suggestion\n<h1>Contact</h1>\n```', me });
    expect(isTaskDone({ type: 'suggest', pr: 7 }, s)).toBe(false); // same as the original line
    s = reduce(s, { type: 'lineComment', pr: 7, path: 'contact.html', line: 2, body: 'Friendlier?\n```suggestion\n<h1>Contact us</h1>\n```', me });
    expect(isTaskDone({ type: 'suggest', pr: 7 }, s)).toBe(true);
    expect(s.pulls[0]!.comments!.at(-1)).toMatchObject({ body: 'Friendlier?', suggestion: '<h1>Contact us</h1>', original: '<h1>Contact</h1>', line: 2 });
  });
});

describe('reviews', () => {
  it('approve and request changes', () => {
    let s = base();
    expect(isTaskDone({ type: 'approve', pr: 7 }, s)).toBe(false);
    s = reduce(s, { type: 'review', pr: 7, state: 'approved', body: '', me });
    expect(isTaskDone({ type: 'approve', pr: 7 }, s)).toBe(true);
    s = reduce(s, { type: 'review', pr: 7, state: 'changes', body: 'Please add an email link.', me });
    expect(isTaskDone({ type: 'requestChanges', pr: 7 }, s)).toBe(true);
  });

  it("you can't approve your own pull request", () => {
    const s = reduce(base({ author: me }), { type: 'review', pr: 7, state: 'approved', body: '', me });
    expect(isTaskDone({ type: 'approve', pr: 7 }, s)).toBe(false);
  });

  it('comment task with a required pattern', () => {
    let s = base();
    const task = { type: 'comment' as const, pr: 7, mustInclude: 'thank' };
    s = reduce(s, { type: 'comment', pr: 7, body: 'Looks good', me });
    expect(isTaskDone(task, s)).toBe(false);
    s = reduce(s, { type: 'comment', pr: 7, body: 'Thanks for this!', me });
    expect(isTaskDone(task, s)).toBe(true);
    s = reduce(s, { type: 'comment', issue: 4, body: 'I can fix it', me });
    expect(isTaskDone({ type: 'comment', issue: 4 }, s)).toBe(true);
  });

  it('a bad regex in mustInclude never crashes', () => {
    const s = reduce(base(), { type: 'comment', pr: 7, body: 'hi', me });
    expect(isTaskDone({ type: 'comment', pr: 7, mustInclude: '(' }, s)).toBe(true);
  });
});

describe('merging and branch rules', () => {
  it('merging closes the linked issue', () => {
    let s = base();
    s = reduce(s, { type: 'merge', pr: 7, method: 'squash', defaultBranch: 'main', me });
    expect(s.pulls[0]!.state).toBe('merged');
    expect(s.issues.find((i) => i.number === 3)!.state).toBe('closed');
    expect(s.issues.find((i) => i.number === 4)!.state).toBe('open');
    expect(isTaskDone({ type: 'merge', pr: 7 }, s)).toBe(true);
    expect(isTaskDone({ type: 'merge', pr: 7, method: 'squash' }, s)).toBe(true);
    expect(isTaskDone({ type: 'merge', pr: 7, method: 'rebase' }, s)).toBe(false);
  });

  it('merging into another branch does not close issues', () => {
    const s = reduce(base({ to: 'develop' }), { type: 'merge', pr: 7, method: 'merge', defaultBranch: 'main', me });
    expect(s.issues.find((i) => i.number === 3)!.state).toBe('open');
  });

  it('required review blocks until someone approves', () => {
    let s = base({}, [{ id: 'requireReview', on: true }]);
    expect(mergeBlockers(s, 7, 'merge')).toEqual(['needsApproval']);
    const blocked = reduce(s, { type: 'merge', pr: 7, method: 'merge', defaultBranch: 'main', me });
    expect(blocked.pulls[0]!.state).toBe('open');
    s = reduce(s, { type: 'review', pr: 7, state: 'approved', body: '', me });
    expect(mergeBlockers(s, 7, 'merge')).toEqual([]);
  });

  it('requested changes block a protected branch', () => {
    const s = base({ reviews: [{ author: 'mei', state: 'changes', body: 'Fix the title' }] }, [{ id: 'requireReview', on: true }]);
    expect(mergeBlockers(s, 7, 'merge')).toEqual(['changesRequested']);
    // A later approval from the same reviewer replaces it.
    const s2 = base({ reviews: [{ author: 'mei', state: 'changes', body: 'x' }, { author: 'mei', state: 'approved', body: '' }] }, [{ id: 'requireReview', on: true }]);
    expect(mergeBlockers(s2, 7, 'merge')).toEqual([]);
  });

  it('required checks block failing or running checks', () => {
    const fail = base({ checks: [{ name: 'test', status: 'fail' }] }, [{ id: 'requireChecks', on: true }]);
    expect(mergeBlockers(fail, 7, 'squash')).toEqual(['checksFailing']);
    const running = base({ checks: [{ name: 'test', status: 'running' }] }, [{ id: 'requireChecks', on: true }]);
    expect(mergeBlockers(running, 7, 'squash')).toEqual(['checksRunning']);
    // Without the rule, failing checks don't block.
    expect(mergeBlockers(base({ checks: [{ name: 'test', status: 'fail' }] }), 7, 'squash')).toEqual([]);
  });

  it('linear history allows only squash or rebase', () => {
    const s = base({}, [{ id: 'linearHistory', on: true }]);
    expect(mergeBlockers(s, 7, 'merge')).toEqual(['linearHistory']);
    expect(mergeBlockers(s, 7, 'squash')).toEqual([]);
    expect(mergeBlockers(s, 7, 'rebase')).toEqual([]);
  });

  it('drafts must be marked ready first', () => {
    let s = base({ draft: true });
    expect(mergeBlockers(s, 7, 'merge')).toEqual(['draft']);
    s = reduce(s, { type: 'ready', pr: 7 });
    expect(mergeBlockers(s, 7, 'merge')).toEqual([]);
  });

  it('a merged pull request cannot merge again', () => {
    const s = reduce(base(), { type: 'merge', pr: 7, method: 'merge', defaultBranch: 'main', me });
    expect(mergeBlockers(s, 7, 'merge')).toEqual(['notOpen']);
  });

  it('toggling a rule is tracked', () => {
    let s = base({}, [{ id: 'requireReview', on: false }]);
    expect(isTaskDone({ type: 'toggleRule', rule: 'requireReview', on: true }, s)).toBe(false);
    s = reduce(s, { type: 'toggleRule', rule: 'requireReview', on: true });
    expect(isTaskDone({ type: 'toggleRule', rule: 'requireReview', on: true }, s)).toBe(true);
    expect(mergeBlockers(s, 7, 'merge')).toEqual(['needsApproval']);
  });
});

describe('issues, files and runs', () => {
  it('link an issue by editing the body', () => {
    let s = base({ body: 'Adds a page.' });
    expect(isTaskDone({ type: 'linkIssue', pr: 7, issue: 3 }, s)).toBe(false);
    s = reduce(s, { type: 'editBody', pr: 7, body: 'Adds a page.\n\nFixes #3' });
    expect(isTaskDone({ type: 'linkIssue', pr: 7, issue: 3 }, s)).toBe(true);
  });

  it('labels and closing issues', () => {
    let s = base();
    s = reduce(s, { type: 'setLabels', issue: 4, labels: ['Bug'] });
    expect(isTaskDone({ type: 'label', issue: 4, label: 'bug' }, s)).toBe(true);
    s = reduce(s, { type: 'setIssueState', issue: 4, state: 'closed' });
    expect(isTaskDone({ type: 'close', issue: 4 }, s)).toBe(true);
    expect(availableLabels(s)).toContain('good first issue');
    expect(availableLabels(s, ['priority'])).toEqual(['priority', 'enhancement', 'Bug']);
  });

  it('open a file', () => {
    const s = reduce(base(), { type: 'openFile', path: 'README.md' });
    expect(isTaskDone({ type: 'openFile', path: 'README.md' }, s)).toBe(true);
  });

  it('only the failing step counts as found', () => {
    let s = base();
    s = reduce(s, { type: 'tapStep', run: 41, job: 0, step: 0 });
    expect(isTaskDone({ type: 'findFailingStep', run: 41 }, s)).toBe(false);
    s = reduce(s, { type: 'tapStep', run: '41', job: 0, step: 1 });
    expect(isTaskDone({ type: 'findFailingStep', run: 41 }, s)).toBe(true);
  });

  it('the original data is never changed', () => {
    const issues = [{ number: 1, title: 't', body: 'b', state: 'open' as const, author: 'a' }];
    const s = initialState({ issues });
    reduce(s, { type: 'setIssueState', issue: 1, state: 'closed' });
    expect(issues[0]!.state).toBe('open');
    expect(s.issues[0]!.state).toBe('open');
  });
});
