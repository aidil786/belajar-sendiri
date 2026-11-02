// Turn a revision like HEAD~2, HEAD^2, main, origin/main, v1.0, a1b2c3d, HEAD@{1},
// @{u}, @{-1} or stash@{0} into a commit id.
import { headId, upstreamOf, upstreamTip } from './state';
import type { Repo } from './types';

export type RevResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'unknown' | 'ambiguous' | 'noParent' | 'noUpstream' | 'upstreamGone' | 'detachedUpstream'; branch?: string };

/** The branch we were on N switches ago (from the reflog), like @{-N}. */
export function previousBranch(repo: Repo, n = 1): string | null {
  let count = 0;
  for (const e of repo.reflog) {
    const m = /^checkout: moving from (\S+) to \S+$/.exec(e.message);
    if (m && ++count === n) return m[1]!;
  }
  return null;
}

/** Look a short name up the way Git does: tags, then branches, then remote-tracking refs. */
export function lookupRef(repo: Repo, name: string): string | undefined {
  const strip = (prefix: string) => (name.startsWith(prefix) ? name.slice(prefix.length) : null);
  const full = strip('refs/');
  if (full !== null) {
    const h = strip('refs/heads/');
    if (h !== null) return repo.branches[h];
    const t = strip('refs/tags/');
    if (t !== null) return repo.tags[t];
    const r = strip('refs/remotes/');
    if (r !== null) return remoteRef(repo, r);
    if (name === 'refs/stash') return repo.stash[0]?.id;
    return undefined;
  }
  if (name === 'stash') return repo.stash[0]?.id;
  if (repo.tags[name] !== undefined) return repo.tags[name];
  if (repo.branches[name] !== undefined) return repo.branches[name];
  const h = strip('heads/');
  if (h !== null && repo.branches[h] !== undefined) return repo.branches[h];
  const t = strip('tags/');
  if (t !== null && repo.tags[t] !== undefined) return repo.tags[t];
  const r = strip('remotes/') ?? name;
  return remoteRef(repo, r);
}

function remoteRef(repo: Repo, name: string): string | undefined {
  if (repo.remoteRefs[name] !== undefined) return repo.remoteRefs[name];
  // "origin" and "origin/HEAD" mean refs/remotes/origin/HEAD.
  const remote = name.endsWith('/HEAD') ? name.slice(0, -5) : name;
  const head = repo.remoteHeads[remote];
  return head ? repo.remoteRefs[`${remote}/${head}`] : undefined;
}

function resolveBase(repo: Repo, base: string): RevResult {
  if (base === 'HEAD' || base === '@') {
    const id = headId(repo);
    return id ? { ok: true, id } : { ok: false, reason: 'unknown' };
  }
  if (base === 'ORIG_HEAD') return repo.origHead ? { ok: true, id: repo.origHead } : { ok: false, reason: 'unknown' };
  if (base === 'MERGE_HEAD') return repo.op?.kind === 'merge' ? { ok: true, id: repo.op.theirs } : { ok: false, reason: 'unknown' };
  if (base === 'CHERRY_PICK_HEAD') {
    return repo.op?.kind === 'cherry-pick' ? { ok: true, id: repo.op.commit } : { ok: false, reason: 'unknown' };
  }
  if (base === 'REBASE_HEAD') {
    return repo.op?.kind === 'rebase' && repo.op.current ? { ok: true, id: repo.op.current.commit } : { ok: false, reason: 'unknown' };
  }
  // Upstream: @{u}, @{upstream}, main@{u}
  const up = /^(.*)@\{(u|upstream)\}$/.exec(base);
  if (up) {
    let branch = up[1]!;
    if (branch === '' || branch === 'HEAD') {
      if (repo.head.type !== 'branch') return { ok: false, reason: 'detachedUpstream' };
      branch = repo.head.name;
    }
    if (repo.branches[branch] === undefined && !(repo.head.type === 'branch' && repo.head.name === branch)) {
      return { ok: false, reason: 'unknown' };
    }
    const u = upstreamOf(repo, branch);
    if (!u) return { ok: false, reason: 'noUpstream', branch };
    const tip = upstreamTip(repo, u);
    return tip ? { ok: true, id: tip } : { ok: false, reason: 'upstreamGone', branch };
  }
  const prev = /^@\{-(\d+)\}$/.exec(base);
  if (prev) {
    const name = previousBranch(repo, Number(prev[1]));
    if (!name) return { ok: false, reason: 'unknown' };
    return resolveBase(repo, name);
  }
  const stash = /^(?:stash|refs\/stash)@\{(\d+)\}$/.exec(base);
  if (stash) {
    const entry = repo.stash[Number(stash[1])];
    return entry ? { ok: true, id: entry.id } : { ok: false, reason: 'unknown' };
  }
  const reflogMatch = /^(?:HEAD)?@\{(\d+)\}$/.exec(base);
  if (reflogMatch) {
    const entry = repo.reflog[Number(reflogMatch[1])];
    return entry ? { ok: true, id: entry.commit } : { ok: false, reason: 'unknown' };
  }
  const ref = lookupRef(repo, base);
  if (ref) return { ok: true, id: ref };
  if (/^[0-9a-f]{4,40}$/.test(base)) {
    const matches = Object.keys(repo.commits).filter((id) => id.startsWith(base));
    if (matches.length === 1) return { ok: true, id: matches[0]! };
    if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
  }
  return { ok: false, reason: 'unknown' };
}

export function resolveRev(repo: Repo, rev: string): RevResult {
  const m = /^(.*?@\{[^}]*\}|[^~^]*)((?:[~^]\d*)*)$/.exec(rev);
  if (!m || m[1] === '') return { ok: false, reason: 'unknown' };
  const res = resolveBase(repo, m[1]!);
  if (!res.ok) return res;
  const suffix = m[2] ?? '';
  const ops = suffix.match(/[~^]\d*/g) ?? [];
  let id = res.id;
  for (const op of ops) {
    const n = op.length > 1 ? Number(op.slice(1)) : 1;
    if (op[0] === '~') {
      for (let i = 0; i < n; i++) {
        const p = repo.commits[id]?.parents[0];
        if (!p) return { ok: false, reason: 'noParent' };
        id = p;
      }
    } else {
      if (n === 0) continue;
      const p = repo.commits[id]?.parents[n - 1];
      if (!p) return { ok: false, reason: 'noParent' };
      id = p;
    }
  }
  return { ok: true, id };
}

/** True if the word looks like a revision we could resolve. */
export function isRev(repo: Repo, word: string): boolean {
  return resolveRev(repo, word).ok;
}

/** Git's message for a revision that can't be used (upstream problems get their own words). */
export function revProblem(rev: string, res: Exclude<RevResult, { ok: true }>): string | null {
  if (res.reason === 'noUpstream') return `fatal: no upstream configured for branch '${res.branch}'`;
  if (res.reason === 'upstreamGone') return `fatal: upstream branch 'refs/heads/${res.branch}' not stored as a remote-tracking branch`;
  if (res.reason === 'detachedUpstream') return 'fatal: HEAD does not point to a branch';
  void rev;
  return null;
}
