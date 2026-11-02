// Pure logic for the PracticeRepo interactive: a tiny, clearly fake code-hosting
// page. Everything here is plain data in, plain data out, so it is easy to test.
//
// Rules this models (simplified, but true to how real code sites behave):
// - "Closes #N" / "Fixes #N" / "Resolves #N" in a pull request body closes issue N
//   when the pull request is merged into the default branch.
// - You can't approve or request changes on your own pull request.
// - Branch rules (settings.rules) can block merging:
//   requireReview  → needs at least one approval and no open "changes requested"
//   requireChecks  → every check must pass (running checks also block)
//   linearHistory  → only squash or rebase merges are allowed
//   Any other rule id is shown as a switch but changes nothing else.

export type MergeMethod = 'merge' | 'squash' | 'rebase';
export const MERGE_METHODS: MergeMethod[] = ['merge', 'squash', 'rebase'];
export type CheckStatus = 'pass' | 'fail' | 'running';
export type StepStatus = CheckStatus | 'skipped';

export interface RepoFile {
  path: string;
  content: string;
}

export interface RepoInfo {
  owner: string;
  name: string;
  description?: string;
  files?: RepoFile[];
  /** Markdown shown under the file list. */
  readme?: string;
  /** Default branch (default "main"). */
  defaultBranch?: string;
}

export interface IssueComment {
  author: string;
  body: string;
  mine?: boolean;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  labels?: string[];
  state: 'open' | 'closed';
  author: string;
  comments?: IssueComment[];
  milestone?: string;
  type?: string;
}

export interface PullFile {
  path: string;
  /** Diff lines, each starting with "+", "-", " " or "@@". */
  diff: string[];
}

export interface Review {
  author: string;
  state: 'approved' | 'changes' | 'commented';
  body: string;
  mine?: boolean;
}

export interface PullComment {
  author: string;
  body: string;
  /** 1-based index into the file's diff lines. Without it, the comment is on the conversation. */
  line?: number;
  /** File path for a line comment (default: the first file). */
  path?: string;
  /** The suggested replacement for that line. */
  suggestion?: string;
  /** The line as it was when the suggestion was made. */
  original?: string;
  mine?: boolean;
}

export interface Pull {
  number: number;
  title: string;
  body: string;
  author: string;
  from: string;
  to: string;
  draft?: boolean;
  state: 'open' | 'merged' | 'closed';
  checks?: { name: string; status: CheckStatus }[];
  files?: PullFile[];
  reviews?: Review[];
  comments?: PullComment[];
  mergedWith?: MergeMethod;
}

export interface RunStep {
  name: string;
  status: StepStatus;
  log?: string[];
}

export interface Run {
  id: string | number;
  workflow: string;
  event: string;
  branch: string;
  status: CheckStatus;
  jobs: { name: string; steps: RunStep[] }[];
}

export interface Rule {
  id: string;
  label: string;
  on: boolean;
}

export type RepoTask =
  | { type: 'approve'; pr: number }
  | { type: 'requestChanges'; pr: number }
  | { type: 'comment'; pr?: number; issue?: number; mustInclude?: string }
  | { type: 'suggest'; pr: number }
  | { type: 'merge'; pr: number; method?: MergeMethod }
  | { type: 'label'; issue: number; label: string }
  | { type: 'close'; issue: number }
  | { type: 'linkIssue'; pr: number; issue: number }
  | { type: 'findFailingStep'; run: string | number }
  | { type: 'toggleRule'; rule: string; on: boolean }
  | { type: 'openFile'; path: string };

export interface RepoState {
  issues: Issue[];
  pulls: Pull[];
  runs: Run[];
  rules: Rule[];
  /** Files the learner opened. */
  opened: string[];
  /** Runs whose failing step the learner found. */
  found: string[];
  /** Rules the learner switched. */
  toggled: string[];
}

export type RepoAction =
  | { type: 'review'; pr: number; state: Review['state']; body: string; me: string }
  | { type: 'comment'; pr?: number; issue?: number; body: string; me: string }
  | { type: 'lineComment'; pr: number; path: string; line: number; body: string; me: string }
  | { type: 'merge'; pr: number; method: MergeMethod; defaultBranch: string; me: string }
  | { type: 'ready'; pr: number }
  | { type: 'editBody'; pr: number; body: string }
  | { type: 'setLabels'; issue: number; labels: string[] }
  | { type: 'setIssueState'; issue: number; state: Issue['state'] }
  | { type: 'toggleRule'; rule: string; on: boolean }
  | { type: 'openFile'; path: string }
  | { type: 'tapStep'; run: string | number; job: number; step: number };

export function initialState(data: { issues?: Issue[]; pulls?: Pull[]; runs?: Run[]; rules?: Rule[] }): RepoState {
  return {
    issues: structuredClone(data.issues ?? []),
    pulls: structuredClone(data.pulls ?? []),
    runs: structuredClone(data.runs ?? []),
    rules: structuredClone(data.rules ?? []),
    opened: [],
    found: [],
    toggled: [],
  };
}

/** Issue numbers a pull request body will close when merged. */
export function closingRefs(body: string): number[] {
  const out = new Set<number>();
  for (const m of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)) out.add(Number(m[1]));
  return [...out];
}

/** Split a ```suggestion block out of a comment body. */
export function extractSuggestion(body: string): { text: string; suggestion?: string } {
  const m = /```suggestion[^\n]*\n([\s\S]*?)\n?```/.exec(body);
  if (!m) return { text: body };
  return { text: (body.slice(0, m.index) + body.slice(m.index + m[0].length)).trim(), suggestion: m[1] ?? '' };
}

/** The diff line text without its +/-/space marker. */
export function lineText(line: string): string {
  return /^[+\- ]/.test(line) ? line.slice(1) : line;
}

/** Each reviewer's latest approve / request-changes review. */
export function latestReviews(pr: Pull): Map<string, Review['state']> {
  const map = new Map<string, Review['state']>();
  for (const r of pr.reviews ?? []) if (r.state !== 'commented') map.set(r.author, r.state);
  return map;
}

export function ruleOn(state: RepoState, id: string): boolean {
  return state.rules.some((r) => r.id === id && r.on);
}

export type Blocker = 'notOpen' | 'draft' | 'checksFailing' | 'checksRunning' | 'needsApproval' | 'changesRequested' | 'linearHistory';

/** Why this merge can't happen yet (empty = it can). */
export function mergeBlockers(state: RepoState, prNumber: number, method: MergeMethod): Blocker[] {
  const pr = state.pulls.find((p) => p.number === prNumber);
  if (!pr || pr.state !== 'open') return ['notOpen'];
  const out: Blocker[] = [];
  if (pr.draft) out.push('draft');
  if (ruleOn(state, 'requireChecks')) {
    if (pr.checks?.some((c) => c.status === 'fail')) out.push('checksFailing');
    else if (pr.checks?.some((c) => c.status === 'running')) out.push('checksRunning');
  }
  if (ruleOn(state, 'requireReview')) {
    const latest = [...latestReviews(pr).values()];
    if (latest.includes('changes')) out.push('changesRequested');
    else if (!latest.includes('approved')) out.push('needsApproval');
  }
  if (ruleOn(state, 'linearHistory') && method === 'merge') out.push('linearHistory');
  return out;
}

export function canReview(pr: Pull, me: string): boolean {
  return pr.state === 'open' && pr.author !== me;
}

function withPull(state: RepoState, n: number, fn: (p: Pull) => void): RepoState {
  const next = structuredClone(state);
  const pr = next.pulls.find((p) => p.number === n);
  if (pr) fn(pr);
  return next;
}

function withIssue(state: RepoState, n: number, fn: (i: Issue) => void): RepoState {
  const next = structuredClone(state);
  const issue = next.issues.find((i) => i.number === n);
  if (issue) fn(issue);
  return next;
}

export function reduce(state: RepoState, action: RepoAction): RepoState {
  switch (action.type) {
    case 'review':
      return withPull(state, action.pr, (p) => {
        if (action.state !== 'commented' && !canReview(p, action.me)) return;
        (p.reviews ??= []).push({ author: action.me, state: action.state, body: action.body, mine: true });
      });
    case 'comment':
      if (action.issue !== undefined) {
        return withIssue(state, action.issue, (i) => {
          (i.comments ??= []).push({ author: action.me, body: action.body, mine: true });
        });
      }
      return withPull(state, action.pr ?? -1, (p) => {
        (p.comments ??= []).push({ author: action.me, body: action.body, mine: true });
      });
    case 'lineComment':
      return withPull(state, action.pr, (p) => {
        const file = p.files?.find((f) => f.path === action.path);
        const original = file?.diff[action.line - 1];
        const { text, suggestion } = extractSuggestion(action.body);
        const c: PullComment = { author: action.me, body: text, line: action.line, path: action.path, mine: true };
        if (suggestion !== undefined) {
          c.suggestion = suggestion;
          c.original = original === undefined ? '' : lineText(original);
        }
        (p.comments ??= []).push(c);
      });
    case 'merge': {
      if (mergeBlockers(state, action.pr, action.method).length) return state;
      let next = withPull(state, action.pr, (p) => {
        p.state = 'merged';
        p.mergedWith = action.method;
      });
      const pr = next.pulls.find((p) => p.number === action.pr)!;
      if (pr.to === action.defaultBranch) {
        for (const n of closingRefs(pr.body)) next = withIssue(next, n, (i) => (i.state = 'closed'));
      }
      return next;
    }
    case 'ready':
      return withPull(state, action.pr, (p) => (p.draft = false));
    case 'editBody':
      return withPull(state, action.pr, (p) => (p.body = action.body));
    case 'setLabels':
      return withIssue(state, action.issue, (i) => (i.labels = [...action.labels]));
    case 'setIssueState':
      return withIssue(state, action.issue, (i) => (i.state = action.state));
    case 'toggleRule': {
      const next = structuredClone(state);
      const rule = next.rules.find((r) => r.id === action.rule);
      if (rule) rule.on = action.on;
      if (!next.toggled.includes(action.rule)) next.toggled.push(action.rule);
      return next;
    }
    case 'openFile':
      return state.opened.includes(action.path) ? state : { ...state, opened: [...state.opened, action.path] };
    case 'tapStep': {
      const run = state.runs.find((r) => String(r.id) === String(action.run));
      const step = run?.jobs[action.job]?.steps[action.step];
      if (step?.status !== 'fail' || state.found.includes(String(action.run))) return state;
      return { ...state, found: [...state.found, String(action.run)] };
    }
  }
}

function safeRegex(src: string): RegExp | null {
  try {
    return new RegExp(src, 'i');
  } catch {
    return null;
  }
}

export function isTaskDone(task: RepoTask, state: RepoState): boolean {
  const pr = 'pr' in task && task.pr !== undefined ? state.pulls.find((p) => p.number === task.pr) : undefined;
  const issue = 'issue' in task && task.issue !== undefined ? state.issues.find((i) => i.number === task.issue) : undefined;
  switch (task.type) {
    case 'approve':
      return Boolean(pr?.reviews?.some((r) => r.mine && r.state === 'approved'));
    case 'requestChanges':
      return Boolean(pr?.reviews?.some((r) => r.mine && r.state === 'changes'));
    case 'comment': {
      const re = task.mustInclude ? safeRegex(task.mustInclude) : null;
      const ok = (body: string) => !re || re.test(body);
      if (task.issue !== undefined) return Boolean(issue?.comments?.some((c) => c.mine && ok(c.body)));
      return Boolean(pr?.comments?.some((c) => c.mine && ok(c.body)) || pr?.reviews?.some((r) => r.mine && r.body && ok(r.body)));
    }
    case 'suggest':
      return Boolean(pr?.comments?.some((c) => c.mine && c.suggestion !== undefined && c.suggestion.trim() !== (c.original ?? '').trim()));
    case 'merge':
      return pr?.state === 'merged' && (!task.method || pr.mergedWith === task.method);
    case 'label':
      return Boolean(issue?.labels?.some((l) => l.toLowerCase() === task.label.toLowerCase()));
    case 'close':
      return issue?.state === 'closed';
    case 'linkIssue':
      return Boolean(pr && closingRefs(pr.body).includes(task.issue));
    case 'findFailingStep':
      return state.found.includes(String(task.run));
    case 'toggleRule':
      return state.toggled.includes(task.rule) && state.rules.some((r) => r.id === task.rule && r.on === task.on);
    case 'openFile':
      return state.opened.includes(task.path);
  }
}

/** Default label set of a new repository on a typical code site. */
export const DEFAULT_LABELS = ['bug', 'documentation', 'duplicate', 'enhancement', 'good first issue', 'help wanted', 'invalid', 'question', 'wontfix'];

export function availableLabels(state: RepoState, extra?: string[]): string[] {
  const all = new Set<string>(extra?.length ? extra : DEFAULT_LABELS);
  for (const i of state.issues) for (const l of i.labels ?? []) all.add(l);
  return [...all];
}
