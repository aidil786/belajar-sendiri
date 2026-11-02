// Refs and commit-graph helpers shared by many commands:
// walks, merge bases, ahead/behind, ref-name rules, decorations and tracking text.
import { shortHash } from './hash';
import { line } from './output';
import { commitTime, headId, upstreamOf, upstreamTip, type Upstream } from './state';
import type { Commit, Line, Repo, Seg } from './types';

type Commits = Record<string, Commit>;

/** Every commit reachable from `tips` (tips included). */
export function reachable(commits: Commits, tips: (string | null | undefined)[]): Set<string> {
  const seen = new Set<string>();
  const stack = tips.filter((t): t is string => Boolean(t));
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const c = commits[id];
    if (!c) continue;
    seen.add(id);
    stack.push(...c.parents);
  }
  return seen;
}

export function isAncestorOf(commits: Commits, ancestor: string, of: string): boolean {
  if (ancestor === of) return true;
  return reachable(commits, [of]).has(ancestor);
}

/** Best common ancestors of a and b (like `git merge-base --all`), newest first. */
export function mergeBases(commits: Commits, a: string, b: string): string[] {
  const ra = reachable(commits, [a]);
  const rb = reachable(commits, [b]);
  const common = [...ra].filter((id) => rb.has(id));
  // Drop common ancestors that are ancestors of another common ancestor.
  const best = common.filter((c) => !common.some((d) => d !== c && isAncestorOf(commits, c, d)));
  return best.sort((x, y) => commitTime(commits[y]!) - commitTime(commits[x]!));
}

export function mergeBase(commits: Commits, a: string, b: string): string | null {
  return mergeBases(commits, a, b)[0] ?? null;
}

/** Commits in `local` not in `upstream` (ahead) and the other way round (behind). */
export function countAheadBehind(commits: Commits, local: string, upstream: string): { ahead: number; behind: number } {
  const rl = reachable(commits, [local]);
  const ru = reachable(commits, [upstream]);
  let ahead = 0;
  let behind = 0;
  for (const id of rl) if (!ru.has(id)) ahead++;
  for (const id of ru) if (!rl.has(id)) behind++;
  return { ahead, behind };
}

/** Commits reachable from `include` but not from `exclude`, newest first (committer date). */
export function walk(commits: Commits, include: string[], exclude: string[] = []): Commit[] {
  const skip = reachable(commits, exclude);
  const order = Object.keys(commits);
  return [...reachable(commits, include)]
    .filter((id) => !skip.has(id))
    .map((id) => commits[id]!)
    .sort((a, b) => commitTime(b) - commitTime(a) || order.indexOf(b.id) - order.indexOf(a.id));
}

/**
 * Git's "graph order" (--topo-order as used by --graph): children before parents,
 * and each line of history shown in one piece. `list` is in date order.
 */
export function topoOrder(list: Commit[]): Commit[] {
  const indeg = new Map<string, number>();
  for (const c of list) indeg.set(c.id, 1);
  for (const c of list) for (const p of c.parents) if (indeg.has(p)) indeg.set(p, indeg.get(p)! + 1);
  const byId = new Map(list.map((c) => [c.id, c]));
  const stack = list.filter((c) => indeg.get(c.id) === 1);
  stack.reverse();
  const out: Commit[] = [];
  while (stack.length) {
    const c = stack.pop()!;
    for (const p of c.parents) {
      const n = indeg.get(p);
      if (!n) continue;
      indeg.set(p, n - 1);
      if (n - 1 === 1) stack.push(byId.get(p)!);
    }
    indeg.set(c.id, 0);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ref names (git check-ref-format, simplified but faithful for learners' input)

export function isValidRefName(name: string): boolean {
  if (!name || name === '@' || name.startsWith('-') || name.endsWith('/') || name.endsWith('.')) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  if (/[\s~^:?*[\\]/.test(name)) return false;
  if ([...name].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return false;
  return name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
}

export function isValidBranchName(name: string): boolean {
  return name !== 'HEAD' && isValidRefName(name);
}

// ---------------------------------------------------------------------------
// Decorations: " (HEAD -> main, tag: v1.0, origin/main, feature)"

export type LabelKind = 'head' | 'branch' | 'remote' | 'tag' | 'stash';

export interface RefLabel {
  kind: LabelKind;
  name: string;
  /** For kind 'head': the branch HEAD points at (shown as "HEAD -> main"). */
  branch?: string;
}

/**
 * Labels on a commit in Git's order: HEAD first, then the other refs in reverse
 * refname order (tags, stash, remote-tracking, local branches).
 */
export function refLabels(repo: Repo, id: string): RefLabel[] {
  const refs: { full: string; label: RefLabel }[] = [];
  for (const [b, c] of Object.entries(repo.branches)) if (c === id) refs.push({ full: `refs/heads/${b}`, label: { kind: 'branch', name: b } });
  for (const [r, c] of Object.entries(repo.remoteRefs)) if (c === id) refs.push({ full: `refs/remotes/${r}`, label: { kind: 'remote', name: r } });
  for (const [remote, b] of Object.entries(repo.remoteHeads)) {
    if (repo.remoteRefs[`${remote}/${b}`] === id) refs.push({ full: `refs/remotes/${remote}/HEAD`, label: { kind: 'remote', name: `${remote}/HEAD` } });
  }
  if (repo.stash[0]?.id === id) refs.push({ full: 'refs/stash', label: { kind: 'stash', name: 'refs/stash' } });
  for (const [t, c] of Object.entries(repo.tags)) if (c === id) refs.push({ full: `refs/tags/${t}`, label: { kind: 'tag', name: t } });
  refs.sort((a, b) => (a.full < b.full ? 1 : a.full > b.full ? -1 : 0));
  const out = refs.map((r) => r.label);
  const head = headId(repo);
  if (head === id) {
    if (repo.head.type === 'branch') {
      const name = repo.head.name;
      const i = out.findIndex((l) => l.kind === 'branch' && l.name === name);
      if (i !== -1) out.splice(i, 1);
      out.unshift({ kind: 'head', name: 'HEAD', branch: name });
    } else out.unshift({ kind: 'head', name: 'HEAD' });
  }
  return out;
}

/** Coloured decoration segments, or [] when the commit has no refs. */
export function decorationSegs(repo: Repo, id: string): Seg[] {
  const labels = refLabels(repo, id);
  if (!labels.length) return [];
  const segs: Seg[] = [{ t: ' (', c: 'yellow' }];
  labels.forEach((l, i) => {
    if (i > 0) segs.push({ t: ', ', c: 'yellow' });
    if (l.kind === 'head') {
      segs.push({ t: 'HEAD', c: 'cyan' });
      if (l.branch) segs.push({ t: ' -> ', c: 'yellow' }, { t: l.branch, c: 'green' });
    } else if (l.kind === 'branch') segs.push({ t: l.name, c: 'green' });
    else if (l.kind === 'remote') segs.push({ t: l.name, c: 'red' });
    else if (l.kind === 'tag') segs.push({ t: `tag: ${l.name}`, c: 'yellow' });
    else segs.push({ t: l.name, c: 'magenta' });
  });
  segs.push({ t: ')', c: 'yellow' });
  return segs;
}

// ---------------------------------------------------------------------------
// Tracking info ("Your branch is ahead of 'origin/main' by 1 commit.")

export interface Tracking {
  upstream: Upstream;
  gone: boolean;
  ahead: number;
  behind: number;
}

export function trackingInfo(repo: Repo, branch: string): Tracking | null {
  const up = upstreamOf(repo, branch);
  if (!up) return null;
  const tip = upstreamTip(repo, up);
  const local = repo.branches[branch];
  if (!tip) return { upstream: up, gone: true, ahead: 0, behind: 0 };
  if (!local) return { upstream: up, gone: false, ahead: 0, behind: 0 };
  return { upstream: up, gone: false, ...countAheadBehind(repo.commits, local, tip) };
}

const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

/** The "Your branch is ..." block used by `git status` and `git switch`. Empty when no upstream. */
export function trackingLines(repo: Repo, branch: string): Line[] {
  const t = trackingInfo(repo, branch);
  if (!t) return [];
  const up = t.upstream.ref;
  if (t.gone) {
    return [
      line(`Your branch is based on '${up}', but the upstream is gone.`),
      line('  (use "git branch --unset-upstream" to fixup)'),
    ];
  }
  if (t.ahead === 0 && t.behind === 0) return [line(`Your branch is up to date with '${up}'.`)];
  if (t.behind === 0) {
    return [line(`Your branch is ahead of '${up}' by ${commits(t.ahead)}.`), line('  (use "git push" to publish your local commits)')];
  }
  if (t.ahead === 0) {
    return [
      line(`Your branch is behind '${up}' by ${commits(t.behind)}, and can be fast-forwarded.`),
      line('  (use "git pull" to update your local branch)'),
    ];
  }
  return [
    line(`Your branch and '${up}' have diverged,`),
    line(`and have ${t.ahead} and ${t.behind} different commits each, respectively.`),
    line('  (use "git pull" if you want to integrate the remote branch with yours)'),
  ];
}

/** "[origin/main: ahead 1, behind 2]" body for `git branch -vv` (without brackets). */
export function trackShort(t: Tracking): string {
  if (t.gone) return 'gone';
  const parts: string[] = [];
  if (t.ahead) parts.push(`ahead ${t.ahead}`);
  if (t.behind) parts.push(`behind ${t.behind}`);
  return parts.join(', ');
}

/** "ahead 1, behind 2", "gone" or "" for a branch with an upstream. */
export function trackInfoText(repo: Repo, branch: string): string {
  const t = trackingInfo(repo, branch);
  return t ? trackShort(t) : '';
}

export function short(id: string): string {
  return shortHash(id);
}
