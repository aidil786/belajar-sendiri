// Layout for the commit graph. Pure: no DOM.
// The engine (graphLanes) decides lanes; here we turn them into pixel positions.
// Columns widen to fit full branch / tag / remote names (never cut), and each lane
// gets enough room above it for its stack of labels.
import { graphLanes, type LaneEdge, type SimState } from '~/engine/git-sim';

export interface GraphLabel {
  kind: 'branch' | 'remote' | 'tag' | 'head';
  name: string;
  /** For kind 'branch': HEAD points here. */
  current?: boolean;
  width: number;
}

export interface GraphNode {
  id: string;
  short: string;
  message: string;
  x: number; // column, oldest = 0
  lane: number; // 0 = main line
  branches: string[];
  remotes: string[];
  tags: string[];
  isHead: boolean;
  lost: boolean;
  merge: boolean;
  reach: 'local' | 'remote' | 'tag' | 'lost';
  /** First parent (kept for older callers). */
  parent: string | null;
  /** Labels stacked above the dot, nearest first (HEAD pill last, on top). */
  labels: GraphLabel[];
  px: number;
  py: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: LaneEdge[];
  headBranch: string | null; // HEAD -> branch, or null when detached
  detached: boolean;
  lanes: number;
  /** A stopped merge / rebase / cherry-pick (conflict marker in red). */
  pending: { op: string; commit: string | null; paths: string[] } | null;
  width: number;
  height: number;
}

export const GEOM = {
  col: 84, // minimum distance between commits
  padX: 44,
  labelH: 20,
  labelStep: 22,
  /** Space under a dot for its hash, then the gap before the next lane's labels. */
  below: 48,
  dot: 12,
};

/** Width of a label pill for this text (12px bold text, generous so nothing is cut). */
export function labelWidth(text: string): number {
  return Math.max(40, Math.ceil(text.length * 7.6) + 18);
}

export function layoutGraph(state: SimState, opts: { showLost?: boolean } = {}): GraphLayout {
  const lanes = graphLanes(state, { showLost: Boolean(opts.showLost) });
  const head = lanes.head;
  const nodes: GraphNode[] = lanes.nodes.map((n) => {
    const labels: GraphLabel[] = [];
    // The current branch comes first (nearest the dot), then other branches, remotes and tags.
    const branches = [...n.branches].sort((a, b) => Number(b === head.branch) - Number(a === head.branch) || a.localeCompare(b));
    for (const b of branches) labels.push({ kind: 'branch', name: b, current: n.isHead && b === head.branch, width: labelWidth(b) });
    for (const r of n.remotes) labels.push({ kind: 'remote', name: r, width: labelWidth(r) });
    for (const t of n.tags) labels.push({ kind: 'tag', name: t, width: labelWidth(t) + 10 });
    if (n.isHead) labels.push({ kind: 'head', name: 'HEAD', width: 48 });
    return {
      id: n.id,
      short: n.short,
      message: n.message,
      x: n.col,
      lane: n.lane,
      branches: n.branches,
      remotes: n.remotes,
      tags: n.tags,
      isHead: n.isHead,
      lost: n.lost,
      merge: n.merge,
      reach: n.reach,
      parent: n.parents[0] ?? null,
      labels,
      px: 0,
      py: 0,
    };
  });

  // Horizontal: neighbours sit far enough apart that their widest labels don't touch.
  const half = (n: GraphNode) => Math.max(0, ...n.labels.map((l) => l.width / 2));
  let x = nodes[0] ? Math.max(GEOM.padX, half(nodes[0]) + 8) : GEOM.padX;
  nodes.forEach((n, i) => {
    if (i > 0) x += Math.max(GEOM.col, half(nodes[i - 1]!) + half(n) + 10);
    n.px = x;
  });
  const last = nodes[nodes.length - 1];
  const width = Math.max(240, (last ? last.px + Math.max(GEOM.padX, half(last) + 12) : 0) + 4);

  // Vertical: each lane gets room for its tallest label stack.
  const laneCount = Math.max(1, lanes.lanes);
  const stack = new Array<number>(laneCount).fill(1);
  for (const n of nodes) stack[n.lane] = Math.max(stack[n.lane]!, n.labels.length);
  const laneY: number[] = [];
  let y = 0;
  for (let l = 0; l < laneCount; l++) {
    y += (l === 0 ? 8 : GEOM.below) + 16 + stack[l]! * GEOM.labelStep;
    laneY.push(y);
  }
  for (const n of nodes) n.py = laneY[n.lane]!;
  const conflictRoom = lanes.pending?.paths.length ? 28 : 0;
  const height = y + GEOM.below - 10 + conflictRoom;

  return {
    nodes,
    edges: lanes.edges,
    headBranch: head.branch,
    detached: head.detached,
    lanes: laneCount,
    pending: lanes.pending,
    width,
    height,
  };
}
