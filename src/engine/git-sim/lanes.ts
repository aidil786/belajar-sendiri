// Lane layout for drawing the commit graph (UI-free, so any interactive can use it).
// Commits flow left → right by time. Lane 0 holds the default branch's first-parent
// line; other branches, remote-tracking refs and tags get their own lanes, packed
// so lanes that never overlap in time share a row.
import { shortHash } from './hash';
import { reachable } from './refs';
import { commitTime, findRepo, headId, subject } from './state';
import type { Commit, SimState } from './types';

export interface LaneNode {
  id: string;
  short: string;
  message: string;
  /** Column: time order, oldest = 0. */
  col: number;
  /** Row: 0 = the main line. */
  lane: number;
  parents: string[];
  branches: string[];
  /** Remote-tracking refs here, e.g. "origin/main". */
  remotes: string[];
  tags: string[];
  isHead: boolean;
  /** Only the reflog remembers it (shown with showLost). */
  lost: boolean;
  merge: boolean;
  /**
   * Who can reach it: your branches/HEAD ('local'), only remote-tracking refs
   * ('remote', e.g. fetched but not merged yet), only tags ('tag'), or nothing ('lost').
   */
  reach: 'local' | 'remote' | 'tag' | 'lost';
}

export interface LaneEdge {
  from: string; // parent id
  to: string; // child id
  kind: 'first' | 'merge';
  lost: boolean;
}

export interface LaneLayout {
  nodes: LaneNode[];
  edges: LaneEdge[];
  lanes: number;
  head: { branch: string | null; detached: boolean; id: string | null };
  /** A stopped merge / rebase / cherry-pick (or stash conflict): what is coming in and which files conflict. */
  pending: { op: 'merge' | 'rebase' | 'cherry-pick' | 'stash'; commit: string | null; paths: string[] } | null;
}

export interface LaneOptions {
  showLost?: boolean;
  /** Show remote-tracking refs and the commits only they reach (default true). */
  showRemotes?: boolean;
  /** Show tags and the commits only they reach (default true). */
  showTags?: boolean;
}

const EMPTY: LaneLayout = { nodes: [], edges: [], lanes: 0, head: { branch: null, detached: false, id: null }, pending: null };

export function graphLanes(state: SimState, opts: LaneOptions = {}): LaneLayout {
  const repo = findRepo(state);
  if (!repo) return EMPTY;
  const showRemotes = opts.showRemotes ?? true;
  const showTags = opts.showTags ?? true;
  const head = headId(repo);
  const remoteTips = showRemotes ? Object.values(repo.remoteRefs) : [];
  const tagTips = showTags ? Object.values(repo.tags) : [];
  const live = reachable(repo.commits, [...Object.values(repo.branches), head, ...remoteTips, ...tagTips]);
  const ids = new Set(live);
  if (opts.showLost) for (const e of repo.reflog) if (repo.commits[e.commit]) ids.add(e.commit);
  const order = Object.keys(repo.commits);
  const commits: Commit[] = [...ids]
    .map((id) => repo.commits[id]!)
    .sort((a, b) => commitTime(a) - commitTime(b) || order.indexOf(a.id) - order.indexOf(b.id));
  const col = new Map(commits.map((c, i) => [c.id, i]));

  // 1. Chains: walk first parents from each tip, claiming commits nobody claimed yet.
  const owner = new Map<string, number>();
  const chains: string[][] = [];
  const claim = (tip: string | null | undefined) => {
    if (!tip || !ids.has(tip) || owner.has(tip)) return;
    const chain: string[] = [];
    for (let cur: string | undefined = tip; cur && ids.has(cur) && !owner.has(cur); cur = repo.commits[cur]?.parents[0]) {
      owner.set(cur, chains.length);
      chain.push(cur);
    }
    if (chain.length) chains.push(chain);
  };
  const current = repo.head.type === 'branch' ? repo.head.name : null;
  const mainName = ['main', 'master'].find((b) => repo.branches[b]) ?? current ?? Object.keys(repo.branches).sort()[0];
  if (mainName) claim(repo.branches[mainName]);
  if (repo.head.type === 'detached') claim(head);
  if (current) claim(repo.branches[current]);
  const byAge = (names: string[], tips: Record<string, string>) =>
    names.sort((a, b) => commitTime(repo.commits[tips[a]!]!) - commitTime(repo.commits[tips[b]!]!) || a.localeCompare(b));
  for (const b of byAge(Object.keys(repo.branches), repo.branches)) claim(repo.branches[b]);
  if (showRemotes) for (const r of byAge(Object.keys(repo.remoteRefs), repo.remoteRefs)) claim(repo.remoteRefs[r]);
  if (showTags) for (const t of byAge(Object.keys(repo.tags), repo.tags)) claim(repo.tags[t]);
  for (const c of [...commits].reverse()) claim(c.id);

  // 2. Rows: each chain spans from its fork point to the merge that took it in.
  const spans = chains.map((chain) => {
    let start = Math.min(...chain.map((id) => col.get(id)!));
    let end = Math.max(...chain.map((id) => col.get(id)!));
    const oldest = repo.commits[chain[chain.length - 1]!]!;
    const fork = oldest.parents[0];
    if (fork && col.has(fork)) start = Math.min(start, col.get(fork)!);
    for (const c of commits) {
      if (owner.get(c.id) !== chains.indexOf(chain) && c.parents.some((p) => chain.includes(p))) end = Math.max(end, col.get(c.id)!);
    }
    return { start, end };
  });
  const rowOf: number[] = [];
  const rows: { start: number; end: number }[][] = [];
  chains.forEach((_, i) => {
    const span = spans[i]!;
    let row = i === 0 ? 0 : 1;
    while ((rows[row] ?? []).some((s) => span.start <= s.end && s.start <= span.end)) row++;
    (rows[row] ??= []).push(span);
    rowOf.push(row);
  });

  const localSet = reachable(repo.commits, [...Object.values(repo.branches), head]);
  const remoteSet = reachable(repo.commits, remoteTips);
  const labels = <T extends string>(tips: Record<T, string>, id: string) =>
    (Object.entries(tips) as [T, string][]).filter(([, c]) => c === id).map(([n]) => n).sort();
  const nodes: LaneNode[] = commits.map((c) => ({
    id: c.id,
    short: shortHash(c.id),
    message: subject(c.message),
    col: col.get(c.id)!,
    lane: rowOf[owner.get(c.id)!] ?? 0,
    parents: c.parents.filter((p) => ids.has(p)),
    branches: labels(repo.branches, c.id),
    remotes: showRemotes ? labels(repo.remoteRefs, c.id) : [],
    tags: showTags ? labels(repo.tags, c.id) : [],
    isHead: c.id === head,
    lost: !live.has(c.id),
    merge: c.parents.length > 1,
    reach: localSet.has(c.id) ? 'local' : remoteSet.has(c.id) ? 'remote' : live.has(c.id) ? 'tag' : 'lost',
  }));
  const edges: LaneEdge[] = [];
  for (const n of nodes) {
    n.parents.forEach((p, i) => edges.push({ from: p, to: n.id, kind: i === 0 ? 'first' : 'merge', lost: n.lost || !live.has(p) }));
  }
  const conflictPaths = Object.keys(repo.conflicts).sort();
  let pending: LaneLayout['pending'] = null;
  if (repo.op) {
    const commit = repo.op.kind === 'merge' ? repo.op.theirs : repo.op.kind === 'cherry-pick' ? repo.op.commit : (repo.op.current?.commit ?? null);
    pending = { op: repo.op.kind, commit, paths: conflictPaths };
  } else if (conflictPaths.length) pending = { op: 'stash', commit: null, paths: conflictPaths };
  return {
    nodes,
    edges,
    lanes: Math.max(0, ...nodes.map((n) => n.lane + 1)),
    head: { branch: current, detached: repo.head.type === 'detached', id: head },
    pending,
  };
}
