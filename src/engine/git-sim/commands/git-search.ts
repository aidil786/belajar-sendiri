// History search (World 10): git grep, git blame, git shortlog, plus the pattern
// helpers `git log -S/-G/--grep/--author` use.
import { diffLines, diffSeq, splitLines } from '../diff';
import { fail, line, lines, notARepo, ok } from '../output';
import { Args } from '../parse';
import { displayPath, isInside, relative, resolve } from '../paths';
import { walk } from '../refs';
import { resolveRev, revProblem } from '../revision';
import { commitTime, dirExists, findRepo, headId, workingTree } from '../state';
import type { Commit, CommandFn, CommandResult, FileMap, Line, Repo, Seg, SimState } from '../types';

function badOption(state: SimState, opt: string): CommandResult {
  return fail(state, lines(`error: unknown option '${opt.replace(/^-+/, '')}'`), 'badOption', { key: 'sim.err.badOption', params: { option: opt } });
}

function badRevision(state: SimState, rev: string): CommandResult {
  return fail(
    state,
    lines(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`),
    'badRevision',
    { key: 'sim.err.badRevision', params: { rev } },
  );
}

// ---------------------------------------------------------------------------
// Patterns. Git uses POSIX regular expressions: basic (BRE) by default, extended with -E.

/** Turn a GNU basic regular expression into a JavaScript one. */
export function breToJs(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '[') {
      // Copy a bracket expression as is ("[]x]" keeps the first "]").
      let j = i + 1;
      if (pattern[j] === '^') j++;
      if (pattern[j] === ']') j++;
      while (j < pattern.length && pattern[j] !== ']') j++;
      out += pattern.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[++i]!;
      if ('(){}|+?'.includes(next)) out += next;
      else if (next === '<' || next === '>') out += '\\b';
      else out += `\\${next}`;
      continue;
    }
    if ('(){}|+?'.includes(ch)) out += `\\${ch}`;
    else if (ch === '*' && (out === '' || out === '^')) out += '\\*';
    else out += ch;
  }
  return out;
}

export interface PatternOpts {
  ignoreCase?: boolean;
  extended?: boolean;
  fixed?: boolean;
  word?: boolean;
}

/** A RegExp for a Git pattern, or null if it is not a valid pattern. */
export function gitRegex(pattern: string, opts: PatternOpts = {}, global = false): RegExp | null {
  let src = opts.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : opts.extended ? pattern : breToJs(pattern);
  if (opts.word) src = `(?<![\\w])(?:${src})(?![\\w])`;
  try {
    return new RegExp(src, `${opts.ignoreCase ? 'i' : ''}${global ? 'g' : ''}`);
  } catch {
    return null;
  }
}

/** How many times `text` occurs in `content` (non-overlapping), like `git log -S`. */
export function countOccurrences(content: string, text: string): number {
  if (!text) return 0;
  let n = 0;
  for (let i = content.indexOf(text); i !== -1; i = content.indexOf(text, i + text.length)) n++;
  return n;
}

/** Paths a commit changed compared with its first parent (all paths for a root commit). */
export function changedPaths(repo: Repo, c: Commit): string[] {
  const parent = c.parents[0] ? (repo.commits[c.parents[0]]?.snapshot ?? {}) : {};
  return [...new Set([...Object.keys(parent), ...Object.keys(c.snapshot)])].filter((p) => parent[p] !== c.snapshot[p]).sort();
}

/** `-S text`: paths of the commit where the count of `text` changed. */
export function pickaxeS(repo: Repo, c: Commit, text: string, regex: RegExp | null): string[] {
  const parent = c.parents[0] ? (repo.commits[c.parents[0]]?.snapshot ?? {}) : {};
  const count = (s: string | undefined) => {
    if (s === undefined) return 0;
    if (regex) return (s.match(new RegExp(regex.source, `${regex.flags.replace('g', '')}g`)) ?? []).length;
    return countOccurrences(s, text);
  };
  return changedPaths(repo, c).filter((p) => count(parent[p]) !== count(c.snapshot[p]));
}

/** `-G regex`: paths of the commit whose added or removed lines match. */
export function pickaxeG(repo: Repo, c: Commit, re: RegExp): string[] {
  const parent = c.parents[0] ? (repo.commits[c.parents[0]]?.snapshot ?? {}) : {};
  return changedPaths(repo, c).filter((p) => diffLines(parent[p] ?? '', c.snapshot[p] ?? '').some((op) => op.kind !== ' ' && re.test(op.text)));
}

// ---------------------------------------------------------------------------
// git grep

export const grep: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, {
    flags: ['-n', '--line-number', '-i', '--ignore-case', '-c', '--count', '-l', '--files-with-matches', '-L', '--files-without-match', '-w', '--word-regexp', '-v', '--invert-match', '-E', '--extended-regexp', '-F', '--fixed-strings', '-G', '--basic-regexp', '--cached', '-h', '-H'],
    values: ['-e'],
    combined: true,
  });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const before = a.positional.slice(0, Math.min(a.beforeDashDash, a.positional.length));
  const afterPaths = a.positional.slice(Math.min(a.beforeDashDash, a.positional.length));
  let pattern = a.get('-e');
  if (pattern === undefined) pattern = before.shift();
  if (pattern === undefined) {
    return fail(state, lines('fatal: no pattern given'), 'noPattern', { key: 'sim.err.grepNoPattern' });
  }
  const opts: PatternOpts = {
    ignoreCase: a.has('-i', '--ignore-case'),
    extended: a.has('-E', '--extended-regexp'),
    fixed: a.has('-F', '--fixed-strings'),
    word: a.has('-w', '--word-regexp'),
  };
  const re = gitRegex(pattern, opts);
  if (!re) return fail(state, lines(`fatal: command line, '${pattern}': Invalid regular expression`), 'badPattern', { key: 'sim.err.badPattern', params: { pattern } });

  // Revisions come first, then paths.
  const revs: { label: string; tree: FileMap }[] = [];
  const paths: string[] = [...afterPaths];
  for (const word of before) {
    const res = resolveRev(repo, word);
    const abs = resolve(state.cwd, word, state.home);
    if (res.ok && paths.length === 0) revs.push({ label: word, tree: repo.commits[res.id]!.snapshot });
    else if (abs in state.fs.files || dirExists(state, abs)) paths.push(word);
    else {
      const problem = !res.ok ? revProblem(word, res) : null;
      if (problem) return fail(state, lines(problem), 'badRevision', { key: 'sim.err.badRevision', params: { rev: word } });
      return badRevision(state, word);
    }
  }
  // Like Git, search the current folder (and below) and print paths relative to it.
  const prefix = state.cwd === repo.root || !isInside(state.cwd, repo.root) ? '' : `${relative(state.cwd, repo.root)}/`;
  const specs = paths.map((p) => {
    const abs = resolve(state.cwd, p, state.home);
    return abs === repo.root ? '' : relative(abs, repo.root);
  });
  const inScope = (p: string) =>
    (specs.length ? specs.some((s) => s === '' || p === s || p.startsWith(`${s}/`)) : p.startsWith(prefix));
  const show = (p: string) => (prefix ? displayPath(p, repo.root, state.cwd) : p);

  const sources: { label: string; files: FileMap }[] = [];
  if (revs.length) for (const r of revs) sources.push({ label: `${r.label}:`, files: r.tree });
  else if (a.has('--cached')) sources.push({ label: '', files: repo.index });
  else {
    const work = workingTree(state, repo);
    sources.push({ label: '', files: Object.fromEntries(Object.keys(repo.index).filter((p) => p in work).map((p) => [p, work[p]!])) });
  }
  const invert = a.has('-v', '--invert-match');
  const out: Line[] = [];
  let hits = 0;
  for (const src of sources) {
    for (const path of Object.keys(src.files).sort()) {
      if (!inScope(path)) continue;
      const fileLines = splitLines(src.files[path]!);
      const matched = fileLines.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => re.test(l) !== invert);
      const name: Seg[] = [{ t: `${src.label}${show(path)}`, c: 'magenta' }];
      if (a.has('-L', '--files-without-match')) {
        if (!matched.length) {
          out.push(name);
          hits++;
        }
        continue;
      }
      if (!matched.length) continue;
      hits += matched.length;
      if (a.has('-l', '--files-with-matches')) out.push(name);
      else if (a.has('-c', '--count')) out.push([...name, { t: ':', c: 'cyan' }, { t: String(matched.length) }]);
      else {
        for (const { l, n } of matched) {
          const segs: Seg[] = [...name, { t: ':', c: 'cyan' }];
          if (a.has('-n', '--line-number')) segs.push({ t: String(n), c: 'green' }, { t: ':', c: 'cyan' });
          segs.push(...highlight(l, invert ? null : re));
          out.push(segs);
        }
      }
    }
  }
  if (hits === 0) return { state, output: [], events: [], ok: false, stopped: true, explain: { key: 'sim.explain.grepNone', params: { pattern } } };
  return ok(state, out, [], { key: revs.length ? 'sim.explain.grepRev' : 'sim.explain.grep', params: { pattern, rev: revs[0]?.label ?? '' } });
};

/** Split a line into segments with the matches in red. */
function highlight(text: string, re: RegExp | null): Seg[] {
  if (!re) return [{ t: text }];
  const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
  const segs: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(g)) {
    if (m[0] === '') break;
    if (m.index > last) segs.push({ t: text.slice(last, m.index) });
    segs.push({ t: m[0], c: 'red' });
    last = m.index + m[0].length;
  }
  if (last < text.length || segs.length === 0) segs.push({ t: text.slice(last) });
  return segs;
}

// ---------------------------------------------------------------------------
// git blame

export interface BlameLine {
  /** Commit id, or null for a line that is not committed yet. */
  commit: string | null;
  /** True for a root commit's lines (Git marks them with ^). */
  boundary: boolean;
  /** Line number in that commit's version of the file. */
  origLine: number;
  text: string;
}

/**
 * Who last changed each line of `path`: walk history from `start` (a commit id), passing
 * unchanged lines to the parent that has them, like Git's blame. With `working`, the
 * working-folder version is blamed and lines not in `start` are "Not Committed Yet".
 */
export function blameLines(repo: Repo, path: string, start: string, working?: string): BlameLine[] {
  const startCommit = repo.commits[start]!;
  const finalText = working ?? startCommit.snapshot[path] ?? '';
  const finalLines = splitLines(finalText);
  const result: BlameLine[] = finalLines.map((text) => ({ commit: null, boundary: false, origLine: 0, text }));
  // Entries waiting on a suspect commit: final line index → line index in that commit's file.
  const pending = new Map<string, { final: number; at: number }[]>();
  const pass = (from: string[], to: string[], items: { final: number; at: number }[]) => {
    const map = new Map<number, number>();
    let i = 0;
    let j = 0;
    for (const op of diffSeq(to, from)) {
      if (op.kind === ' ') map.set(j++, i++);
      else if (op.kind === '-') i++;
      else j++;
    }
    const moved: { final: number; at: number }[] = [];
    const kept: { final: number; at: number }[] = [];
    for (const it of items) {
      const k = map.get(it.at);
      if (k === undefined) kept.push(it);
      else moved.push({ final: it.final, at: k });
    }
    return { moved, kept };
  };
  const all = finalLines.map((_, i) => ({ final: i, at: i }));
  if (working !== undefined) {
    const { moved, kept } = pass(finalLines, splitLines(startCommit.snapshot[path] ?? ''), all);
    for (const k of kept) result[k.final] = { commit: null, boundary: false, origLine: k.at + 1, text: finalLines[k.final]! };
    pending.set(start, moved);
  } else pending.set(start, all);

  while (pending.size) {
    // Newest suspect first, so every child has handed its lines over already.
    const id = [...pending.keys()].sort((x, y) => commitTime(repo.commits[y]!) - commitTime(repo.commits[x]!))[0]!;
    let items = pending.get(id)!;
    pending.delete(id);
    const c = repo.commits[id]!;
    const mine = splitLines(c.snapshot[path] ?? '');
    for (const p of c.parents) {
      const parent = repo.commits[p];
      if (!parent || !items.length || parent.snapshot[path] === undefined) continue;
      const { moved, kept } = pass(mine, splitLines(parent.snapshot[path]!), items);
      if (moved.length) pending.set(p, [...(pending.get(p) ?? []), ...moved]);
      items = kept;
    }
    for (const it of items) result[it.final] = { commit: id, boundary: c.parents.length === 0, origLine: it.at + 1, text: finalLines[it.final]! };
  }
  return result;
}

function blameDate(unix: number, tz: number): string {
  const d = new Date((unix + tz * 60) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = tz >= 0 ? '+' : '-';
  const off = Math.abs(tz);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${sign}${pad(Math.floor(off / 60))}${pad(off % 60)}`;
}

export const blame: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['-e', '--show-email', '-s', '-l', '-f', '--show-name'], values: ['-L'] });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const words = [...a.positional];
  let rev: string | undefined;
  let file: string | undefined;
  if (a.beforeDashDash !== Infinity) {
    rev = words.slice(0, a.beforeDashDash)[0];
    file = words[a.beforeDashDash];
  } else if (words.length >= 2) {
    rev = words[0];
    file = words[1];
  } else file = words[0];
  if (!file) return { state, output: [line('usage: git blame [<options>] [<rev>] [--] <file>')], events: [{ type: 'error', code: 'usage' }], ok: false, explain: { key: 'sim.err.blameUsage' } };
  const abs = resolve(state.cwd, file, state.home);
  const path = isInside(abs, repo.root) ? relative(abs, repo.root) : file;
  let start: string | null;
  let working: string | undefined;
  if (rev !== undefined) {
    const res = resolveRev(repo, rev);
    if (!res.ok) return badRevision(state, rev);
    start = res.id;
    if (repo.commits[start]!.snapshot[path] === undefined) {
      return fail(state, lines(`fatal: no such path ${path} in ${rev}`), 'noPath', { key: 'sim.err.blameNoPath', params: { path, rev } });
    }
  } else {
    start = headId(repo);
    if (!start || repo.commits[start]!.snapshot[path] === undefined) {
      return fail(state, lines(`fatal: no such path '${path}' in HEAD`), 'noPath', { key: 'sim.err.blameNoPath', params: { path, rev: 'HEAD' } });
    }
    working = state.fs.files[abs] ?? repo.commits[start]!.snapshot[path];
  }
  let result = blameLines(repo, path, start, working).map((b, i) => ({ ...b, n: i + 1 }));
  const range = a.get('-L');
  if (range !== undefined) {
    const m = /^(\d+)(?:,(\+?)(\d+))?$/.exec(range);
    if (!m) return fail(state, lines(`fatal: -L parameter '${range}' starting at line 1: No such line`), 'badRange', { key: 'sim.err.blameRange', params: { range } });
    const from = Number(m[1]);
    const to = m[3] === undefined ? result.length : m[2] ? from + Number(m[3]) - 1 : Number(m[3]);
    if (from < 1 || from > result.length) {
      return fail(state, lines(`fatal: file ${path} has only ${result.length} line${result.length === 1 ? '' : 's'}`), 'badRange', { key: 'sim.err.blameRange', params: { range } });
    }
    result = result.slice(from - 1, Math.min(to, result.length));
  }
  const who = (b: BlameLine) => {
    if (!b.commit) return a.has('-e', '--show-email') ? '<not.committed.yet>' : 'Not Committed Yet';
    const c = repo.commits[b.commit]!;
    return a.has('-e', '--show-email') ? `<${c.author.email}>` : c.author.name;
  };
  const nameW = Math.max(...result.map((b) => who(b).length), 0);
  const numW = String(Math.max(...result.map((b) => b.n), 1)).length;
  const long = a.has('-l');
  // Git 2.56: 7 hex chars, plus one more only when a boundary (^) line is shown, so the columns line up.
  const idLen = long ? 40 : result.some((b) => b.boundary) ? 8 : 7;
  const out: Line[] = result.map((b) => {
    const c = b.commit ? repo.commits[b.commit]! : null;
    let hash = c ? (b.boundary ? `^${c.id.slice(0, idLen - 1)}` : c.id.slice(0, idLen)) : '0'.repeat(idLen);
    if (long && c && b.boundary) hash = `^${c.id}`;
    const date = blameDate(c ? c.timestamp : state.clock, state.tz);
    const meta = a.has('-s') ? `${String(b.n).padStart(numW)}` : `${who(b).padEnd(nameW)} ${date} ${String(b.n).padStart(numW)}`;
    return [{ t: hash, c: 'yellow' }, { t: ` (${meta}) ${b.text}` }];
  });
  return ok(state, out, [], { key: 'sim.explain.blame', params: { file: path } });
};

// ---------------------------------------------------------------------------
// git shortlog

export const shortlog: CommandFn = (state, args) => {
  const repo = findRepo(state);
  if (!repo) return notARepo(state);
  const a = new Args(args, { flags: ['-s', '--summary', '-n', '--numbered', '-e', '--email', '--all', '--no-merges'], combined: true });
  if (a.unknown.length) return badOption(state, a.unknown[0]!);
  const include: string[] = [];
  const exclude: string[] = [];
  for (const p of a.positional.slice(0, Math.min(a.beforeDashDash, a.positional.length))) {
    const range = /^(.*?)\.\.(.*)$/.exec(p);
    if (range) {
      const l = resolveRev(repo, range[1] || 'HEAD');
      const r = resolveRev(repo, range[2] || 'HEAD');
      if (!l.ok) return badRevision(state, range[1]!);
      if (!r.ok) return badRevision(state, range[2]!);
      include.push(r.id);
      exclude.push(l.id);
      continue;
    }
    const res = resolveRev(repo, p);
    if (!res.ok) return badRevision(state, p);
    include.push(res.id);
  }
  if (a.has('--all')) include.push(...Object.values(repo.branches), ...Object.values(repo.remoteRefs), ...Object.values(repo.tags));
  // In a terminal, plain `git shortlog` summarises HEAD.
  if (!include.length) {
    const head = headId(repo);
    if (!head) return fail(state, lines(`fatal: your current branch '${repo.head.type === 'branch' ? repo.head.name : 'HEAD'}' does not have any commits yet`), 'noCommits', { key: 'sim.err.noCommits' });
    include.push(head);
  }
  let commits = walk(repo.commits, include, exclude);
  if (a.has('--no-merges')) commits = commits.filter((c) => c.parents.length <= 1);
  const email = a.has('-e', '--email');
  const groups = new Map<string, Commit[]>();
  for (const c of commits) {
    const key = email ? `${c.author.name} <${c.author.email}>` : c.author.name;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const names = [...groups.keys()].sort((x, y) => {
    if (a.has('-n', '--numbered')) {
      const d = groups.get(y)!.length - groups.get(x)!.length;
      if (d) return d;
    }
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const out: Line[] = [];
  for (const name of names) {
    const list = groups.get(name)!;
    if (a.has('-s', '--summary')) {
      out.push(line(`${String(list.length).padStart(6)}\t${name}`));
      continue;
    }
    out.push(line(`${name} (${list.length}):`));
    for (const c of [...list].reverse()) out.push(line(`      ${c.message.split('\n')[0]}`));
    out.push(line(''));
  }
  return ok(state, out, [], { key: a.has('-s', '--summary') ? 'sim.explain.shortlogSummary' : 'sim.explain.shortlog', params: { authors: String(names.length) } });
};
