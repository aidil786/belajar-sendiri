// Engine helpers for interactive components (conflict resolver, rebase card deck,
// push/pull courier, commit graph). Pure functions over SimState, like commands.
import { findServer } from './commands/git-remote';
import { shortHash } from './hash';
import { trackingInfo, walk } from './refs';
import { run } from './run';
import { clone, findRepo, subject, workingTree, writeFile } from './state';
import { unmergedEntries, type UnmergedKind } from './status';
import type { CommandResult, SimState } from './types';

export interface ConflictFile {
  path: string;
  kind: UnmergedKind;
  /** The three versions (index stages 1–3). null = absent on that side. */
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** The working file now (with conflict markers until fixed). null = deleted. */
  merged: string | null;
}

export interface ConflictInfo {
  /** What stopped: a merge, rebase, cherry-pick, or a stash pop/apply (no operation). */
  op: 'merge' | 'rebase' | 'cherry-pick' | 'stash';
  /** Names in the markers: "<<<<<<< ours" / ">>>>>>> theirs". */
  labels: { ours: string; theirs: string };
  /** The commit being brought in (null for stash). */
  commit: string | null;
  files: ConflictFile[];
}

/** Conflicts of the current stopped operation, or null when there are none and nothing is stopped. */
export function conflictInfo(state: SimState): ConflictInfo | null {
  const repo = findRepo(state);
  if (!repo) return null;
  const entries = unmergedEntries(repo);
  if (!repo.op && !entries.length) return null;
  const work = workingTree(state, repo);
  const files = entries.map((e) => ({
    path: e.path,
    kind: e.kind,
    base: repo.conflicts[e.path]!.base,
    ours: repo.conflicts[e.path]!.ours,
    theirs: repo.conflicts[e.path]!.theirs,
    merged: work[e.path] ?? null,
  }));
  const op = repo.op;
  if (!op) return { op: 'stash', labels: { ours: 'Updated upstream', theirs: 'Stashed changes' }, commit: null, files };
  if (op.kind === 'merge') return { op: 'merge', labels: { ours: 'HEAD', theirs: op.label }, commit: op.theirs, files };
  const id = op.kind === 'cherry-pick' ? op.commit : (op.current?.commit ?? null);
  const c = id ? repo.commits[id] : undefined;
  const theirs = c ? `${shortHash(c.id)} (${subject(c.message)})` : '';
  return { op: op.kind, labels: { ours: 'HEAD', theirs }, commit: id, files };
}

/**
 * Resolve one conflicted path: write `text` to the file and `git add` it
 * (or delete it and `git rm` it when `text` is null). Same effect as doing it by hand.
 */
export function resolveConflict(state: SimState, path: string, text: string | null): CommandResult {
  const repo = findRepo(state);
  if (!repo) return run(state, 'git status');
  const abs = `${repo.root}/${path}`;
  if (text === null) return run(state, `git rm -q -- "${abs}"`);
  const next = clone(state);
  writeFile(next, abs, text);
  const r = run(next, `git add -- "${abs}"`);
  return { ...r, events: [{ type: 'fileChanged', path }, ...r.events] };
}

export interface ServerBranch {
  name: string;
  tip: string;
  short: string;
  message: string;
}

export interface ServerInfo {
  url: string;
  defaultBranch: string;
  branches: ServerBranch[];
  tags: { name: string; tip: string }[];
  empty: boolean;
}

/** Every hosted repo on the fake GitHub. */
export function listServers(state: SimState): ServerInfo[] {
  return Object.values(state.servers)
    .map((s) => ({
      url: s.url,
      defaultBranch: s.head,
      branches: Object.entries(s.branches)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, tip]) => ({ name, tip, short: shortHash(tip), message: subject(s.commits[tip]!.message) })),
      tags: Object.entries(s.tags)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, tip]) => ({ name, tip })),
      empty: Object.keys(s.branches).length === 0,
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

export interface LogEntry {
  id: string;
  short: string;
  message: string;
  parents: string[];
}

/** Commits on a hosted branch (default branch when omitted), newest first. */
export function serverLog(state: SimState, url: string, branch?: string): LogEntry[] {
  const s = findServer(state, url);
  if (!s) return [];
  const tip = s.branches[branch ?? s.head];
  if (!tip) return [];
  return walk(s.commits, [tip]).map((c) => ({ id: c.id, short: shortHash(c.id), message: subject(c.message), parents: [...c.parents] }));
}

export interface AheadBehind {
  branch: string;
  /** e.g. "origin/main", or null when the branch has no upstream. */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** The upstream was set but the remote branch is gone. */
  gone: boolean;
}

/** How a local branch (current by default) compares with its upstream (as last fetched). */
export function aheadBehind(state: SimState, branch?: string): AheadBehind | null {
  const repo = findRepo(state);
  if (!repo) return null;
  const name = branch ?? (repo.head.type === 'branch' ? repo.head.name : null);
  if (!name) return null;
  const t = trackingInfo(repo, name);
  if (!t) return { branch: name, upstream: null, ahead: 0, behind: 0, gone: false };
  return { branch: name, upstream: t.upstream.ref, ahead: t.ahead, behind: t.behind, gone: t.gone };
}
