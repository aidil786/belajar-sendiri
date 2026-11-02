// Combined diffs ("diff --cc"), as shown by `git diff` during a conflict and by
// `git show <merge>`. A port of the core of Git's combine-diff.c (dense mode).
import { diffSeq, splitLines } from './diff';
import { blobId, shortHash } from './hash';
import { line } from './output';
import type { Line, Seg } from './types';

interface Lost {
  text: string;
  mask: number; // parents that had this line
}

interface SLine {
  text: string | null; // null for the trailer after the last line
  flag: number; // bit i: line is new compared with parent i; plus mark bits
  lost: Lost[];
  plno: number[];
}

/** Merge parent n's lost lines into the existing list (LCS), like coalesce_lines(). */
function coalesce(base: Lost[], add: string[], bit: number): Lost[] {
  if (!base.length) return add.map((text) => ({ text, mask: bit }));
  const n = base.length;
  const m = add.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const dir: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  // 1 = match, 2 = new, 3 = base
  for (let j = 1; j <= m; j++) dir[0]![j] = 2;
  for (let i = 1; i <= n; i++) dir[i]![0] = 3;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (base[i - 1]!.text === add[j - 1]) {
        lcs[i]![j] = lcs[i - 1]![j - 1]! + 1;
        dir[i]![j] = 1;
      } else if (lcs[i]![j - 1]! >= lcs[i - 1]![j]!) {
        lcs[i]![j] = lcs[i]![j - 1]!;
        dir[i]![j] = 2;
      } else {
        lcs[i]![j] = lcs[i - 1]![j]!;
        dir[i]![j] = 3;
      }
    }
  }
  // Walk back from the end; new lines go right after the current base line.
  const out = base.map((l) => ({ ...l }));
  let i = n;
  let j = m;
  while (i !== 0 || j !== 0) {
    const d = dir[i]![j]!;
    if (d === 1) {
      out[i - 1]!.mask |= bit;
      i--;
      j--;
    } else if (d === 2) {
      out.splice(i, 0, { text: add[j - 1]!, mask: bit });
      j--;
    } else i--;
  }
  return out;
}

function interesting(s: SLine, all: number): boolean {
  return (s.flag & all) !== 0 || s.lost.length > 0;
}

function findNext(sl: SLine[], mark: number, start: number, cnt: number, uninteresting: boolean): number {
  let i = start;
  while (i <= cnt) {
    if (uninteresting ? !(sl[i]!.flag & mark) : sl[i]!.flag & mark) return i;
    i++;
  }
  return i;
}

function adjustTail(sl: SLine[], all: number, begin: number, i: number): number {
  if (begin + 1 <= i && !(sl[i - 1]!.flag & all)) return i - 1;
  return i;
}

const CONTEXT = 3;

function giveContext(sl: SLine[], cnt: number, n: number): void {
  const all = (1 << n) - 1;
  const mark = 1 << n;
  const noPreDelete = 2 << n;
  let i = findNext(sl, mark, 0, cnt, false);
  if (cnt < i) return;
  while (i <= cnt) {
    let j = CONTEXT < i ? i - CONTEXT : 0;
    while (j < i) {
      if (!(sl[j]!.flag & mark)) sl[j]!.flag |= noPreDelete;
      sl[j++]!.flag |= mark;
    }
    for (;;) {
      j = findNext(sl, mark, i, cnt, true);
      if (cnt < j) return;
      let k = findNext(sl, mark, j, cnt, false);
      j = adjustTail(sl, all, i, j);
      if (k < j + CONTEXT) {
        while (j < k) sl[j++]!.flag |= mark;
        i = k;
        continue;
      }
      i = k;
      k = j + CONTEXT < cnt + 1 ? j + CONTEXT : cnt + 1;
      while (j < k) sl[j++]!.flag |= mark;
      break;
    }
  }
}

function makeHunksDense(sl: SLine[], cnt: number, n: number): void {
  const all = (1 << n) - 1;
  const mark = 1 << n;
  for (let i = 0; i <= cnt; i++) {
    if (interesting(sl[i]!, all)) sl[i]!.flag |= mark;
    else sl[i]!.flag &= ~mark;
  }
  let i = 0;
  while (i <= cnt) {
    while (i <= cnt && !(sl[i]!.flag & mark)) i++;
    if (cnt < i) break;
    const begin = i;
    let j: number;
    for (j = i + 1; j <= cnt; j++) {
      if (!(sl[j]!.flag & mark)) {
        let la = adjustTail(sl, all, begin, j);
        la = la + CONTEXT < cnt + 1 ? la + CONTEXT : cnt + 1;
        let contin = false;
        while (la && j <= --la) {
          if (sl[la]!.flag & mark) {
            contin = true;
            break;
          }
        }
        if (!contin) break;
        j = la;
      }
    }
    const end = j;
    let same = 0;
    let has = false;
    for (let k = i; k < end && !has; k++) {
      const diff = sl[k]!.flag & all;
      if (diff) {
        if (!same) same = diff;
        else if (same !== diff) {
          has = true;
          break;
        }
      }
      for (const ll of sl[k]!.lost) {
        if (has) break;
        if (!same) same = ll.mask;
        else if (same !== ll.mask) has = true;
      }
    }
    if (!has && same !== all) for (let k = begin; k < end; k++) sl[k]!.flag &= ~mark;
    i = end;
  }
  giveContext(sl, cnt, n);
}

function hunkComment(text: string | null): boolean {
  return text !== null && /^[A-Za-z_$]/.test(text);
}

/**
 * Combined diff of one path. `parents` are the parent versions (null = absent),
 * `result` the merged version. Returns [] when --cc finds nothing worth showing.
 */
export function combinedDiff(
  path: string,
  parents: (string | null)[],
  result: string,
  opts: { resultHash?: string | null; always?: boolean } = {},
): Line[] {
  const n = parents.length;
  const res = splitLines(result);
  const cnt = res.length;
  const sl: SLine[] = [];
  for (let k = 0; k <= cnt + 1; k++) sl.push({ text: k < cnt ? res[k]! : null, flag: 0, lost: [], plno: new Array<number>(n).fill(0) });
  // Lines that are new compared with each parent start flagged; a match clears the flag.
  parents.forEach((p, pi) => {
    const bit = 1 << pi;
    const ops = diffSeq(splitLines(p ?? ''), res);
    let r = 0;
    let lostHere: string[] = [];
    const flush = () => {
      if (lostHere.length) sl[r]!.lost = coalesce(sl[r]!.lost, lostHere, bit);
      lostHere = [];
    };
    for (const op of ops) {
      if (op.kind === '-') {
        lostHere.push(op.text);
        continue;
      }
      flush();
      if (op.kind === '+') sl[r]!.flag |= bit;
      r++;
    }
    flush();
  });
  // Parent line numbers at each result line.
  for (let pi = 0; pi < n; pi++) {
    const bit = 1 << pi;
    let plno = 1;
    let lno = 0;
    for (; lno <= cnt; lno++) {
      sl[lno]!.plno[pi] = plno;
      for (const ll of sl[lno]!.lost) if (ll.mask & bit) plno++;
      if (lno < cnt && !(sl[lno]!.flag & bit)) plno++;
    }
    sl[lno]!.plno[pi] = plno;
  }
  makeHunksDense(sl, cnt, n);

  const mark = 1 << n;
  const noPreDelete = 2 << n;
  const body: Line[] = [];
  let lno = 0;
  for (;;) {
    let comment: string | null = null;
    while (lno <= cnt && !(sl[lno]!.flag & mark)) {
      if (hunkComment(sl[lno]!.text)) comment = sl[lno]!.text;
      lno++;
    }
    if (cnt < lno) break;
    let end = lno + 1;
    while (end <= cnt && sl[end]!.flag & mark) end++;
    let rlines = end - lno;
    if (cnt < end) rlines--;
    const at = '@'.repeat(n + 1);
    let header = at;
    for (let pi = 0; pi < n; pi++) {
      const l0 = sl[lno]!.plno[pi]!;
      const l1 = sl[end]!.plno[pi]!;
      header += ` -${l0},${l1 - l0}`;
    }
    header += ` +${lno + 1},${rlines} ${at}`;
    const head: Seg[] = [{ t: header, c: 'cyan' }];
    if (comment) head.push({ t: ` ${comment}` });
    body.push(head);
    while (lno < end) {
      const s = sl[lno++]!;
      if (!(s.flag & noPreDelete)) {
        for (const ll of s.lost) {
          let cols = '';
          for (let pi = 0; pi < n; pi++) cols += ll.mask & (1 << pi) ? '-' : ' ';
          body.push([{ t: `${cols}${ll.text}`, c: 'red' }]);
        }
      }
      if (cnt < lno) break;
      let cols = '';
      for (let pi = 0; pi < n; pi++) cols += s.flag & (1 << pi) ? '+' : ' ';
      if (s.flag & (mark - 1)) body.push([{ t: `${cols}${s.text}`, c: 'green' }]);
      else body.push([{ t: `${cols}${s.text}` }]);
    }
  }
  if (!body.length && !opts.always) return [];
  const blob = (c: string | null) => (c === null ? '0000000' : shortHash(blobId(c)));
  const resultHash = opts.resultHash === undefined ? shortHash(blobId(result)) : (opts.resultHash ?? '0000000');
  return [
    line(`diff --cc ${path}`, 'bold'),
    line(`index ${parents.map(blob).join(',')}..${resultHash}`, 'bold'),
    line(`--- a/${path}`, 'bold'),
    line(`+++ b/${path}`, 'bold'),
    ...body,
  ];
}
