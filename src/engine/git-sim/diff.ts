// Line diffs and unified-diff output, in the same shape Git prints.
import type { Line } from './types';

export interface Op {
  kind: ' ' | '-' | '+';
  text: string;
}

export interface Hunk {
  /** Range of ops covered by this hunk: [start, end). */
  start: number;
  end: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export function splitLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Longest-common-subsequence line diff. Files in lessons are small. */
export function diffLines(a: string, b: string): Op[] {
  return diffSeq(splitLines(a), splitLines(b));
}

/** The same diff on arrays of lines. */
export function diffSeq(x: string[], y: string[]): Op[] {
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const below = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = x[i] === y[j] ? below[j + 1]! + 1 : Math.max(below[j]!, row[j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      ops.push({ kind: ' ', text: x[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: '-', text: x[i]! });
      i++;
    } else {
      ops.push({ kind: '+', text: y[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ kind: '-', text: x[i++]! });
  while (j < m) ops.push({ kind: '+', text: y[j++]! });
  return ops;
}

/** Group changes into hunks with `context` lines around them (Git uses 3). */
export function makeHunks(ops: Op[], context = 3): Hunk[] {
  const changeIdx: number[] = [];
  ops.forEach((op, i) => {
    if (op.kind !== ' ') changeIdx.push(i);
  });
  if (changeIdx.length === 0) return [];

  const ranges: [number, number][] = [];
  for (const idx of changeIdx) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length, idx + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  // Line numbers before each op.
  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let o = 0;
  let nn = 0;
  for (const op of ops) {
    oldBefore.push(o);
    newBefore.push(nn);
    if (op.kind !== '+') o++;
    if (op.kind !== '-') nn++;
  }

  return ranges.map(([start, end]) => {
    let oldCount = 0;
    let newCount = 0;
    for (let i = start; i < end; i++) {
      const k = ops[i]!.kind;
      if (k !== '+') oldCount++;
      if (k !== '-') newCount++;
    }
    const oldStart = oldCount === 0 ? oldBefore[start]! : oldBefore[start]! + 1;
    const newStart = newCount === 0 ? newBefore[start]! : newBefore[start]! + 1;
    return { start, end, oldStart, oldCount, newStart, newCount };
  });
}

function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

export function hunkHeader(h: Hunk): string {
  return `@@ -${range(h.oldStart, h.oldCount)} +${range(h.newStart, h.newCount)} @@`;
}

/** Render hunks as coloured lines (header cyan, removed red, added green). */
export function renderHunks(ops: Op[], hunks: Hunk[]): Line[] {
  const out: Line[] = [];
  for (const h of hunks) {
    out.push([{ t: hunkHeader(h), c: 'cyan' }]);
    for (let i = h.start; i < h.end; i++) {
      const op = ops[i]!;
      if (op.kind === ' ') out.push([{ t: ` ${op.text}` }]);
      else out.push([{ t: `${op.kind}${op.text}`, c: op.kind === '-' ? 'red' : 'green' }]);
    }
  }
  return out;
}

export function countChanges(ops: Op[]): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.kind === '+') insertions++;
    else if (op.kind === '-') deletions++;
  }
  return { insertions, deletions };
}

/** Keep the new side for accepted hunks and the old side for the rest. */
export function applyHunks(ops: Op[], hunks: Hunk[], accepted: number[]): string {
  const inAccepted = new Array<boolean>(ops.length).fill(false);
  for (const idx of accepted) {
    const h = hunks[idx];
    if (!h) continue;
    for (let i = h.start; i < h.end; i++) inAccepted[i] = true;
  }
  const lines: string[] = [];
  ops.forEach((op, i) => {
    if (op.kind === ' ') lines.push(op.text);
    else if (op.kind === '+' && inAccepted[i]) lines.push(op.text);
    else if (op.kind === '-' && !inAccepted[i]) lines.push(op.text);
  });
  return lines.length ? `${lines.join('\n')}\n` : '';
}
