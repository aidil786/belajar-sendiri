// Three-way merges, the way Git does them (ort strategy, xdiff "zealous" level).
//
// File level: a port of xdiff's xdl_do_merge. Changes on both sides that overlap
// OR touch (no unchanged line between them) are a conflict. Conflicts are then
// refined (identical lines move out), and conflicts at most 3 lines apart join.
// Tree level: per path, like ort without rename detection.
import { diffSeq, splitLines } from './diff';
import { line } from './output';
import type { ConflictEntry, FileMap, Line } from './types';

interface Change {
  i1: number; // start in base
  chg1: number; // lines in base
  i2: number; // start in the side
  chg2: number; // lines in the side
}

/** Changes (hunks with no context) turning `a` into `b`. */
function changes(a: string[], b: string[]): Change[] {
  const out: Change[] = [];
  let i = 0;
  let j = 0;
  let cur: Change | null = null;
  for (const op of diffSeq(a, b)) {
    if (op.kind === ' ') {
      if (cur) out.push(cur);
      cur = null;
      i++;
      j++;
      continue;
    }
    cur ??= { i1: i, chg1: 0, i2: j, chg2: 0 };
    if (op.kind === '-') {
      cur.chg1++;
      i++;
    } else {
      cur.chg2++;
      j++;
    }
  }
  if (cur) out.push(cur);
  return out;
}

interface Chunk {
  mode: 0 | 1 | 2 | 4; // 0 conflict, 1 ours, 2 theirs, 4 identical after refining
  i0: number;
  chg0: number;
  i1: number; // in ours
  chg1: number;
  i2: number; // in theirs
  chg2: number;
}

function sameLines(a: string[], ai: number, b: string[], bi: number, n: number): boolean {
  for (let k = 0; k < n; k++) if (a[ai + k] !== b[bi + k]) return false;
  return true;
}

function doMerge(base: string[], ours: string[], theirs: string[]): Chunk[] {
  const c1 = changes(base, ours);
  const c2 = changes(base, theirs);
  const out: Chunk[] = [];
  const append = (mode: 0 | 1 | 2, i0: number, chg0: number, i1: number, chg1: number, i2: number, chg2: number) => {
    const m = out[out.length - 1];
    if (m && (i1 <= m.i1 + m.chg1 || i2 <= m.i2 + m.chg2)) {
      if (mode !== m.mode) m.mode = 0;
      m.chg0 = i0 + chg0 - m.i0;
      m.chg1 = i1 + chg1 - m.i1;
      m.chg2 = i2 + chg2 - m.i2;
    } else out.push({ mode, i0, chg0, i1, chg1, i2, chg2 });
  };
  let a = 0;
  let b = 0;
  while (a < c1.length && b < c2.length) {
    const x = c1[a]!;
    const y = c2[b]!;
    if (x.i1 + x.chg1 < y.i1) {
      append(1, x.i1, x.chg1, x.i2, x.chg2, y.i2 - y.i1 + x.i1, x.chg1);
      a++;
      continue;
    }
    if (y.i1 + y.chg1 < x.i1) {
      append(2, y.i1, y.chg1, x.i2 - x.i1 + y.i1, y.chg1, y.i2, y.chg2);
      b++;
      continue;
    }
    if (x.i1 !== y.i1 || x.chg1 !== y.chg1 || x.chg2 !== y.chg2 || !sameLines(ours, x.i2, theirs, y.i2, x.chg2)) {
      const off = x.i1 - y.i1;
      const ffo = off + x.chg1 - y.chg1;
      let i0 = x.i1;
      let i1 = x.i2;
      let i2 = y.i2;
      if (off > 0) {
        i0 -= off;
        i1 -= off;
      } else i2 += off;
      let chg0 = x.i1 + x.chg1 - i0;
      let chg1 = x.i2 + x.chg2 - i1;
      let chg2 = y.i2 + y.chg2 - i2;
      if (ffo < 0) {
        chg0 -= ffo;
        chg1 -= ffo;
      } else chg2 += ffo;
      append(0, i0, chg0, i1, chg1, i2, chg2);
    }
    const e1 = x.i1 + x.chg1;
    const e2 = y.i1 + y.chg1;
    if (e1 >= e2) b++;
    if (e2 >= e1) a++;
  }
  while (a < c1.length) {
    const x = c1[a++]!;
    append(1, x.i1, x.chg1, x.i2, x.chg2, x.i1 + theirs.length - base.length, x.chg1);
  }
  while (b < c2.length) {
    const y = c2[b++]!;
    append(2, y.i1, y.chg1, y.i1 + ours.length - base.length, y.chg1, y.i2, y.chg2);
  }
  return out;
}

/** Zealous: diff the two sides of each conflict; only the lines that really differ stay in conflict. */
function refine(chunks: Chunk[], ours: string[], theirs: string[]): Chunk[] {
  const out: Chunk[] = [];
  for (const m of chunks) {
    if (m.mode !== 0 || m.chg1 === 0 || m.chg2 === 0) {
      out.push(m);
      continue;
    }
    const sub = changes(ours.slice(m.i1, m.i1 + m.chg1), theirs.slice(m.i2, m.i2 + m.chg2));
    if (sub.length === 0) {
      out.push({ ...m, mode: 4 });
      continue;
    }
    for (const s of sub) out.push({ ...m, mode: 0, i1: s.i1 + m.i1, chg1: s.chg1, i2: s.i2 + m.i2, chg2: s.chg2 });
  }
  return out;
}

/** Conflicts separated by at most 3 lines become one conflict. */
function simplify(chunks: Chunk[]): Chunk[] {
  const out = chunks.map((c) => ({ ...c }));
  for (let k = 0; k < out.length - 1; ) {
    const m = out[k]!;
    const next = out[k + 1]!;
    const begin = m.i1 + m.chg1;
    const end = next.i1;
    if (m.mode !== 0 || next.mode !== 0 || end - begin > 3) {
      k++;
      continue;
    }
    m.chg1 = next.i1 + next.chg1 - m.i1;
    m.chg2 = next.i2 + next.chg2 - m.i2;
    out.splice(k + 1, 1);
  }
  return out;
}

export interface FileMergeResult {
  content: string;
  conflict: boolean;
  /** Number of conflict blocks (<<<<<<< ... >>>>>>>). */
  conflicts: number;
}

const MARK = 7;

/** Merge one file. `labels` go after the conflict markers ("HEAD", "feature"). */
export function mergeFile(base: string, ours: string, theirs: string, labels: { ours: string; theirs: string }): FileMergeResult {
  if (ours === theirs) return { content: ours, conflict: false, conflicts: 0 };
  if (base === ours) return { content: theirs, conflict: false, conflicts: 0 };
  if (base === theirs) return { content: ours, conflict: false, conflicts: 0 };
  const b = splitLines(base);
  const o = splitLines(ours);
  const t = splitLines(theirs);
  const chunks = simplify(refine(doMerge(b, o, t), o, t));
  const out: string[] = [];
  let i = 0;
  let conflicts = 0;
  for (const m of chunks) {
    if (m.mode === 4) continue;
    out.push(...o.slice(i, m.i1));
    if (m.mode === 0) {
      conflicts++;
      out.push(`${'<'.repeat(MARK)} ${labels.ours}`, ...o.slice(m.i1, m.i1 + m.chg1), '='.repeat(MARK));
      out.push(...t.slice(m.i2, m.i2 + m.chg2), `${'>'.repeat(MARK)} ${labels.theirs}`);
    } else if (m.mode === 1) out.push(...o.slice(m.i1, m.i1 + m.chg1));
    else out.push(...t.slice(m.i2, m.i2 + m.chg2));
    i = m.i1 + m.chg1;
  }
  out.push(...o.slice(i));
  return { content: out.length ? `${out.join('\n')}\n` : '', conflict: conflicts > 0, conflicts };
}

// ---------------------------------------------------------------------------
// Trees

export interface TreeMergeResult {
  /** Stage-0 index after the merge (conflicted paths left out). */
  index: FileMap;
  /** Tracked working files after the merge (conflicted files include markers). */
  working: FileMap;
  conflicts: Record<string, ConflictEntry>;
  /** "Auto-merging x" and "CONFLICT (...)" lines, in path order. */
  messages: Line[];
}

/**
 * Merge `theirs` into `ours` with `base` as the common ancestor.
 * `names` are how the two sides are called in messages and markers.
 */
export function mergeTrees(base: FileMap, ours: FileMap, theirs: FileMap, names: { ours: string; theirs: string }): TreeMergeResult {
  const index: FileMap = {};
  const working: FileMap = {};
  const conflicts: Record<string, ConflictEntry> = {};
  const messages: Line[] = [];
  const paths = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
  for (const p of paths) {
    const b = base[p];
    const o = ours[p];
    const t = theirs[p];
    let result: string | undefined;
    if (o === t) result = o;
    else if (b === o) result = t;
    else if (b === t) result = o;
    else if (o !== undefined && t !== undefined) {
      messages.push(line(`Auto-merging ${p}`));
      const merged = mergeFile(b ?? '', o, t, names);
      if (merged.conflict) {
        messages.push(line(`CONFLICT (${b === undefined ? 'add/add' : 'content'}): Merge conflict in ${p}`));
        conflicts[p] = { base: b ?? null, ours: o, theirs: t };
        working[p] = merged.content;
        continue;
      }
      result = merged.content;
    } else {
      // Modified on one side, deleted on the other.
      const deletedIn = o === undefined ? names.ours : names.theirs;
      const keptIn = o === undefined ? names.theirs : names.ours;
      messages.push(
        line(`CONFLICT (modify/delete): ${p} deleted in ${deletedIn} and modified in ${keptIn}.  Version ${keptIn} of ${p} left in tree.`),
      );
      conflicts[p] = { base: b ?? null, ours: o ?? null, theirs: t ?? null };
      working[p] = (o ?? t)!;
      continue;
    }
    if (result !== undefined) {
      index[p] = result;
      working[p] = result;
    }
  }
  return { index, working, conflicts, messages };
}
