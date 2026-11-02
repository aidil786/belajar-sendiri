// `tofu fmt`: the canonical layout, following hclwrite's rules — two-space indents by bracket
// nesting, single spaces between tokens (none inside brackets, around dots or before commas),
// `{ a = 1 }` with inner spaces, and `=` signs lined up in runs of one-line arguments (a blank
// line or a multi-line value ends a run). Strings and heredocs are left exactly as written.
import { HclError, lex, type Tok } from './hcl';

const opens = (t: Tok) => t.type === 'op' && (t.v === '{' || t.v === '[' || t.v === '(');
const closes = (t: Tok) => t.type === 'op' && (t.v === '}' || t.v === ']' || t.v === ')');
const change = (t: Tok) => (opens(t) ? 1 : closes(t) ? -1 : 0);

function spaceAfter(subject: Tok, before: Tok | null, after: Tok | null): boolean {
  if (!after) return false;
  const isOp = (t: Tok | null, ...v: string[]) => Boolean(t && t.type === 'op' && v.includes(t.v));
  if (subject.type === 'ident' && isOp(after, '(')) return false;
  if (isOp(subject, '.') || isOp(after, '.')) return false;
  if (isOp(after, ',', '...')) return false;
  if (isOp(subject, ',')) return true;
  if (subject.type === 'ident' && subject.v === 'in' && before?.type === 'ident') return true;
  if (isOp(after, '[') && (subject.type === 'ident' || subject.type === 'number' || subject.type === 'string' || change(subject) < 0)) return false;
  if (isOp(subject, '-')) {
    if (!before) return false;
    if (before.type === 'op' && ['(', '{', '[', '=', ':', ',', '?', '+', '*', '/', '%', '-', '==', '!=', '>', '>=', '<', '<=', '&&', '||', '!'].includes(before.v)) return false;
    return true;
  }
  if (isOp(subject, '!')) return false;
  if (isOp(subject, '{') || isOp(after, '}')) return !(isOp(subject, '{') && isOp(after, '}'));
  if (change(subject) > 0) return false;
  if (change(after) < 0) return false;
  return true;
}

interface FLine {
  toks: Tok[];
  comment: Tok | null;
}

/** Format one file's source. Throws HclError when it does not parse. */
export function formatSource(src: string, file: string): string {
  const toks = lex(src, file, { comments: true });
  // Split into lines (a heredoc token ends its line).
  const lines: FLine[] = [];
  let cur: Tok[] = [];
  for (const t of toks) {
    if (t.type === 'eof') break;
    if (t.type === 'nl') {
      lines.push({ toks: cur, comment: null });
      cur = [];
      continue;
    }
    cur.push(t);
  }
  const trailing = cur.length > 0;
  if (cur.length) lines.push({ toks: cur, comment: null });
  for (const l of lines) {
    const last = l.toks[l.toks.length - 1];
    if (l.toks.length > 1 && last?.type === 'comment' && !last.raw.startsWith('/*')) {
      l.comment = last;
      l.toks = l.toks.slice(0, -1);
    }
  }
  // Indentation (hclwrite's formatIndent).
  const indent: number[] = [];
  const stack: number[] = [];
  for (const l of lines) {
    const all = l.comment ? [...l.toks, l.comment] : l.toks;
    if (!all.length) {
      indent.push(0);
      continue;
    }
    let net = 0;
    for (const t of l.toks) net += change(t);
    if (net > 0) {
      indent.push(stack.length);
      stack.push(net);
    } else if (net < 0) {
      let closing = -net;
      while (closing > 0 && stack.length) {
        const top = stack[stack.length - 1]!;
        if (closing > top) {
          closing -= top;
          stack.pop();
        } else if (closing < top) {
          stack[stack.length - 1] = top - closing;
          closing = 0;
        } else {
          stack.pop();
          closing = 0;
        }
      }
      indent.push(stack.length);
    } else indent.push(stack.length);
  }
  // Render tokens with hclwrite's spacing; find "lead" (before =) and "assign" (from =).
  type Out = { lead: string; assign: string | null; comment: string | null; indent: number; empty: boolean };
  const out: Out[] = lines.map((l, i) => {
    if (!l.toks.length && !l.comment) return { lead: '', assign: null, comment: null, indent: 0, empty: true };
    let eqAt = -1;
    for (let k = 1; k < l.toks.length; k++) {
      const t = l.toks[k]!;
      if (t.type === 'op' && t.v === '=') {
        let net = 0;
        for (const x of l.toks.slice(k)) {
          net += change(x);
          if (x.type === 'heredoc') break;
        }
        if (net === 0) eqAt = k;
        break;
      }
    }
    const join = (ts: Tok[], startBefore: Tok | null) => {
      let s = '';
      ts.forEach((t, k) => {
        s += t.raw;
        const before = k === 0 ? startBefore : ts[k - 1]!;
        const after = ts[k + 1] ?? null;
        if (after && spaceAfter(t, before, after)) s += ' ';
      });
      return s;
    };
    const lead = eqAt > 0 ? join(l.toks.slice(0, eqAt), null).replace(/\s+$/, '') : join(l.toks, null);
    const assign = eqAt > 0 ? join(l.toks.slice(eqAt), l.toks[eqAt - 1]!) : null;
    return { lead: l.toks.length ? lead : '', assign, comment: l.comment ? l.comment.raw.replace(/\s+$/, '') : null, indent: indent[i]!, empty: false };
  });
  // Align "=" in runs of assignment lines.
  let start = -1;
  let max = 0;
  const close = (end: number) => {
    for (let k = start; k < end; k++) out[k]!.lead = out[k]!.lead.padEnd(max);
    start = -1;
    max = 0;
  };
  out.forEach((o, k) => {
    if (o.assign === null) {
      if (start >= 0) close(k);
    } else {
      if (start < 0) start = k;
      max = Math.max(max, o.lead.length);
    }
  });
  if (start >= 0) close(out.length);
  // Align trailing comments in runs of lines that have them.
  const bodies = out.map((o) => (o.empty ? '' : o.assign !== null ? `${o.lead} ${o.assign}` : o.lead));
  let cs = -1;
  let cmax = 0;
  const cclose = (end: number) => {
    for (let k = cs; k < end; k++) if (out[k]!.comment !== null && bodies[k]!.length) bodies[k] = bodies[k]!.padEnd(cmax);
    cs = -1;
    cmax = 0;
  };
  out.forEach((o, k) => {
    if (o.comment === null || !bodies[k]!.length) {
      if (cs >= 0) cclose(k);
    } else {
      if (cs < 0) cs = k;
      cmax = Math.max(cmax, bodies[k]!.length);
    }
  });
  if (cs >= 0) cclose(out.length);
  const result = out.map((o, k) => {
    if (o.empty) return '';
    const body = bodies[k]!;
    const withComment = o.comment !== null ? (body.length ? `${body} ${o.comment}` : o.comment) : body;
    return '  '.repeat(o.indent) + withComment;
  });
  let text = result.join('\n');
  if (!trailing) text += '\n';
  return text;
}

/** Unified diff like `tofu fmt -diff` (three lines of context). */
export function unifiedDiff(a: string, b: string, name: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x[x.length - 1] === '') x.pop();
  if (y[y.length - 1] === '') y.pop();
  const n = x.length;
  const m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  type Op = { op: ' ' | '-' | '+'; t: string; ai: number; bi: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) ops.push({ op: ' ', t: x[i]!, ai: i++, bi: j++ });
    else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) ops.push({ op: '+', t: y[j]!, ai: i, bi: j++ });
    else ops.push({ op: '-', t: x[i]!, ai: i++, bi: j });
  }
  // Inside each run of changes, removed lines come before added ones (like difflib).
  for (let k = 0; k < ops.length; ) {
    if (ops[k]!.op === ' ') {
      k++;
      continue;
    }
    let e = k;
    while (e < ops.length && ops[e]!.op !== ' ') e++;
    const run = ops.slice(k, e);
    ops.splice(k, e - k, ...run.filter((o) => o.op === '-'), ...run.filter((o) => o.op === '+'));
    k = e;
  }
  // Group into hunks with 3 lines of context.
  const changed = ops.map((o) => o.op !== ' ');
  const hunks: [number, number][] = [];
  ops.forEach((_, k) => {
    if (!changed[k]) return;
    const s = Math.max(0, k - 3);
    const e = Math.min(ops.length, k + 4);
    const last = hunks[hunks.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else hunks.push([s, e]);
  });
  const range = (start: number, len: number) => (len === 1 ? `${start + 1}` : len === 0 ? `${start},0` : `${start + 1},${len}`);
  const outLines = [`--- old/${name}`, `+++ new/${name}`];
  for (const [s, e] of hunks) {
    const part = ops.slice(s, e);
    const aLen = part.filter((o) => o.op !== '+').length;
    const bLen = part.filter((o) => o.op !== '-').length;
    const aStart = part.find((o) => o.op !== '+')?.ai ?? part[0]!.ai;
    const bStart = part.find((o) => o.op !== '-')?.bi ?? part[0]!.bi;
    outLines.push(`@@ -${range(aStart, aLen)} +${range(bStart, bLen)} @@`);
    for (const o of part) outLines.push(`${o.op}${o.t}`);
  }
  return outLines.join('\n');
}

export { HclError };
