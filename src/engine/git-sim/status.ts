// Work out what changed: staged (index vs HEAD), unstaged (working vs index), untracked.
import { headTree, ignoreRules, isIgnored, workingTree } from './state';
import type { Repo, SimState } from './types';

export type StagedKind = 'new file' | 'modified' | 'deleted' | 'renamed';
export type UnstagedKind = 'modified' | 'deleted';

export interface StagedEntry {
  kind: StagedKind;
  path: string;
  from?: string; // for renames
}

export interface UnstagedEntry {
  kind: UnstagedKind;
  path: string;
}

export type UnmergedKind =
  | 'both deleted'
  | 'added by us'
  | 'deleted by them'
  | 'added by them'
  | 'deleted by us'
  | 'both added'
  | 'both modified';

export interface UnmergedEntry {
  kind: UnmergedKind;
  path: string;
  /** Short-status code, e.g. "UU". */
  code: string;
}

export interface RepoStatus {
  staged: StagedEntry[];
  unstaged: UnstagedEntry[];
  untracked: string[];
  ignored: string[];
  /** Conflicted paths (unresolved). */
  unmerged: UnmergedEntry[];
}

const UNMERGED: Record<number, [UnmergedKind, string]> = {
  1: ['both deleted', 'DD'],
  2: ['added by us', 'AU'],
  3: ['deleted by them', 'UD'],
  4: ['added by them', 'UA'],
  5: ['deleted by us', 'DU'],
  6: ['both added', 'AA'],
  7: ['both modified', 'UU'],
};

export function unmergedEntries(repo: Repo): UnmergedEntry[] {
  return Object.entries(repo.conflicts)
    .map(([path, c]) => {
      const mask = (c.base !== null ? 1 : 0) | (c.ours !== null ? 2 : 0) | (c.theirs !== null ? 4 : 0);
      const [kind, code] = UNMERGED[mask] ?? UNMERGED[7]!;
      return { path, kind, code };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function computeStatus(state: SimState, repo: Repo): RepoStatus {
  const head = headTree(repo);
  const index = repo.index;
  const work = workingTree(state, repo);
  const conflicted = (p: string) => Object.hasOwn(repo.conflicts, p);

  const added: string[] = [];
  const deleted: string[] = [];
  const staged: StagedEntry[] = [];
  for (const path of Object.keys(index)) {
    if (!(path in head)) added.push(path);
    else if (head[path] !== index[path]) staged.push({ kind: 'modified', path });
  }
  for (const path of Object.keys(head)) {
    if (!(path in index) && !conflicted(path)) deleted.push(path);
  }
  // Exact-content rename detection.
  const usedAdds = new Set<string>();
  for (const del of deleted) {
    const match = added.find((a) => !usedAdds.has(a) && index[a] === head[del]);
    if (match) {
      usedAdds.add(match);
      staged.push({ kind: 'renamed', path: match, from: del });
    } else staged.push({ kind: 'deleted', path: del });
  }
  for (const a of added) if (!usedAdds.has(a)) staged.push({ kind: 'new file', path: a });
  staged.sort((x, y) => x.path.localeCompare(y.path));

  const unstaged: UnstagedEntry[] = [];
  for (const path of Object.keys(index)) {
    if (!(path in work)) unstaged.push({ kind: 'deleted', path });
    else if (work[path] !== index[path]) unstaged.push({ kind: 'modified', path });
  }
  unstaged.sort((x, y) => x.path.localeCompare(y.path));

  const rules = ignoreRules(state, repo);
  const untracked: string[] = [];
  const ignored: string[] = [];
  for (const path of Object.keys(work).sort()) {
    if (path in index || conflicted(path)) continue;
    if (isIgnored(rules, path)) ignored.push(path);
    else untracked.push(path);
  }
  return { staged, unstaged, untracked, ignored, unmerged: unmergedEntries(repo) };
}

export function isClean(st: RepoStatus): boolean {
  return st.staged.length === 0 && st.unstaged.length === 0 && st.untracked.length === 0 && st.unmerged.length === 0;
}

/**
 * Untracked paths the way `git status` lists them: a folder whose files are all
 * untracked shows as `folder/`.
 */
export function collapseUntracked(untracked: string[], index: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const path of untracked) {
    const parts = path.split('/');
    let shown = path;
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      const hasTracked = Object.keys(index).some((p) => p.startsWith(`${dir}/`));
      if (!hasTracked) {
        shown = `${dir}/`;
        break;
      }
    }
    out.add(shown);
  }
  return [...out].sort();
}
