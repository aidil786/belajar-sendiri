// Text tools (GNU grep 3.11, coreutils 9.7, sed 4.9, mawk 1.3): grep wc sort uniq cut tr tee
// sed awk seq xargs.
import { badOption, errText, parseOpts, setExplain, type Ctx, type IO } from '../ctx';
import { absPath, can, childNames, joinPath, lookup } from '../fs';
import { readFile, type Program } from './files';

function linesOf(text: string): string[] {
  const l = text.split('\n');
  if (text.endsWith('\n')) l.pop();
  return l;
}

function inputs(ctx: Ctx, io: IO, prog: string, files: string[]): { name: string; text: string }[] | null {
  const out: { name: string; text: string }[] = [];
  let failed = false;
  for (const f of files.length ? files : ['-']) {
    const t = readFile(ctx, io, prog, f);
    if (t === null) failed = true;
    else out.push({ name: f, text: t });
  }
  return failed && !out.length ? null : out;
}

// ---------------------------------------------------------------------------
// grep

export const grep: Program = (ctx, argv, io) => {
  const raw = argv.slice(1);
  const p = parseOpts(raw, 'inrRvclLwEFoHhqsxe', ['ignore-case', 'line-number', 'recursive', 'invert-match', 'count', 'files-with-matches', 'word-regexp', 'extended-regexp', 'fixed-strings', 'only-matching', 'quiet', 'color', 'color=auto', 'color=never', 'colour=auto'], ['e']);
  if (p.bad || p.badLong) {
    if (p.bad) io.err(`grep: invalid option -- '${p.bad}'\n`);
    else io.err(`grep: unrecognized option '${p.badLong}'\n`);
    io.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n");
    return 2;
  }
  const f = p.flags;
  const args = [...p.args];
  const pattern = p.values.e ?? args.shift();
  if (pattern === undefined) {
    io.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n");
    return 2;
  }
  const icase = f.has('i') || f.has('ignore-case');
  let src = f.has('F') || f.has('fixed-strings') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : f.has('E') ? pattern : basicToJs(pattern);
  if (f.has('w')) src = `(?<![\\w])(?:${src})(?![\\w])`;
  if (f.has('x')) src = `^(?:${src})$`;
  let re: RegExp;
  try {
    re = new RegExp(src, icase ? 'gi' : 'g');
  } catch {
    io.err('grep: Unmatched ( or \\(\n');
    return 2;
  }
  const rec = f.has('r') || f.has('R') || f.has('recursive');
  let files = args;
  if (rec && !files.length) files = ['.'];
  const targets: { shown: string; text: string | null }[] = [];
  let code = 1;
  let hadError = false;
  const addFile = (shown: string, path: string) => {
    const node = ctx.st.fs[path];
    if (!node) return;
    if (!can(ctx.st, ctx.sh.user, node, 'r')) {
      io.err(`grep: ${shown}: Permission denied\n`);
      hadError = true;
      return;
    }
    targets.push({ shown, text: node.content ?? '\u0000' });
  };
  const walk = (shown: string, path: string) => {
    const node = ctx.st.fs[path];
    if (!node) return;
    if (node.type === 'dir') {
      if (!can(ctx.st, ctx.sh.user, node, 'r') || !can(ctx.st, ctx.sh.user, node, 'x')) {
        io.err(`grep: ${shown}: Permission denied\n`);
        hadError = true;
        return;
      }
      for (const n of childNames(ctx.st, path)) walk(shown === '.' && args.length === 0 ? n : `${shown.replace(/\/$/, '')}/${n}`, joinPath(path, n));
    } else if (node.type === 'file') addFile(shown, path);
  };
  if (!files.length) targets.push({ shown: '(standard input)', text: io.stdin ?? '' });
  for (const name of files) {
    if (name === '-') {
      targets.push({ shown: '(standard input)', text: io.stdin ?? '' });
      continue;
    }
    const found = lookup(ctx.st, ctx.sh.user, absPath(ctx.sh.cwd, name));
    if (!found.ok) {
      io.err(`grep: ${name}: ${errText(found.err)}\n`);
      hadError = true;
      continue;
    }
    if (found.node.type === 'dir') {
      if (rec) walk(name, found.path);
      else {
        io.err(`grep: ${name}: Is a directory\n`);
        hadError = true;
      }
      continue;
    }
    addFile(name, found.path);
  }
  const showName = !f.has('h') && (f.has('H') || targets.length > 1 || rec);
  const invert = f.has('v') || f.has('invert-match');
  let total = 0;
  for (const t of targets) {
    const text = t.text ?? '';
    if (text.includes('\u0000')) {
      if (lineMatches(re, 'x', invert) || re.test(text)) {
        re.lastIndex = 0;
        if (!f.has('q') && !f.has('c')) io.out(`grep: ${t.shown}: binary file matches\n`);
        code = 0;
      }
      continue;
    }
    let n = 0;
    const lines = linesOf(text);
    lines.forEach((line, idx) => {
      re.lastIndex = 0;
      const hit = re.test(line) !== invert;
      re.lastIndex = 0;
      if (!hit) return;
      n++;
      if (f.has('c') || f.has('l') || f.has('L') || f.has('q') || f.has('quiet') || f.has('count') || f.has('files-with-matches')) return;
      const prefix = `${showName ? `${t.shown}:` : ''}${f.has('n') || f.has('line-number') ? `${idx + 1}:` : ''}`;
      if (f.has('o') && !invert) {
        for (const m of line.matchAll(re)) if (m[0]) io.out(`${prefix}${m[0]}\n`);
      } else io.out(`${prefix}${line}\n`);
    });
    total += n;
    if (n) code = 0;
    if (f.has('c') || f.has('count')) io.out(`${showName ? `${t.shown}:` : ''}${n}\n`);
    if ((f.has('l') || f.has('files-with-matches')) && n) io.out(`${t.shown}\n`);
    if (f.has('L') && !n) io.out(`${t.shown}\n`);
  }
  if (f.has('q') || f.has('quiet')) return code === 0 ? 0 : hadError ? 2 : 1;
  setExplain(ctx, code === 0 ? (f.has('c') ? 'linux.explain.grepCount' : 'linux.explain.grep') : 'linux.explain.grepNone', { pattern, n: total });
  return hadError ? 2 : code;
};

function lineMatches(re: RegExp, line: string, invert: boolean): boolean {
  re.lastIndex = 0;
  const r = re.test(line) !== invert;
  re.lastIndex = 0;
  return r && false;
}

/** GNU basic regex → JavaScript: \( \) \{ \} \| \+ \? are special, bare ( ) { } | + ? are literal. */
export function basicToJs(bre: string): string {
  let out = '';
  for (let i = 0; i < bre.length; i++) {
    const c = bre[i]!;
    if (c === '\\' && i + 1 < bre.length) {
      const n = bre[++i]!;
      if ('(){}|+?'.includes(n)) out += n;
      else out += `\\${n}`;
      continue;
    }
    if ('(){}|+?'.includes(c)) out += `\\${c}`;
    else if (c === '[') {
      const e = bre.indexOf(']', i + 2);
      if (e < 0) {
        out += '\\[';
        continue;
      }
      out += bre.slice(i, e + 1).replace(/\[:(alpha|digit|alnum|space|upper|lower|punct):\]/g, (_m, k: string) => ({ alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', space: '\\s', upper: 'A-Z', lower: 'a-z', punct: '!-/:-@[-`{-~' })[k]!);
      i = e;
    } else out += c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// wc

export const wc: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'lwcm', ['lines', 'words', 'bytes', 'chars'], []);
  if (p.bad || p.badLong) return badOption(io, 'wc', p);
  let want = ['l', 'w', 'c'].filter((k) => p.flags.has(k) || p.flags.has({ l: 'lines', w: 'words', c: 'bytes' }[k]!));
  if (p.flags.has('m')) want.push('m');
  if (!want.length) want = ['l', 'w', 'c'];
  const files = p.args.length ? p.args : ['-'];
  const rows: { counts: number[]; name: string }[] = [];
  let code = 0;
  let sizeSum = 0;
  let stdin = false;
  for (const name of files) {
    const text = readFile(ctx, io, 'wc', name);
    if (text === null) {
      code = 1;
      continue;
    }
    if (name === '-') stdin = true;
    const bytes = new TextEncoder().encode(text).length;
    sizeSum += bytes;
    const counts = want.map((k) => (k === 'l' ? (text.match(/\n/g) ?? []).length : k === 'w' ? text.split(/\s+/).filter(Boolean).length : k === 'm' ? [...text].length : bytes));
    rows.push({ counts, name: name === '-' ? '' : name });
  }
  if (rows.length > 1) rows.push({ counts: want.map((_k, i) => rows.reduce((s, r) => s + r.counts[i]!, 0)), name: 'total' });
  let width = Math.max(1, String(sizeSum).length);
  if (stdin) width = Math.max(width, 7);
  if (want.length === 1 && rows.length === 1) width = 1;
  for (const r of rows) io.out(`${r.counts.map((c) => String(c).padStart(width)).join(' ')}${r.name ? ` ${r.name}` : ''}\n`);
  if (rows.length) setExplain(ctx, want.length === 1 && want[0] === 'l' ? 'linux.explain.wcL' : 'linux.explain.wc', { n: rows[0]!.counts[0]! });
  return code;
};

// ---------------------------------------------------------------------------
// sort, uniq, cut, tr, tee

export const sort: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'nruhfV', ['numeric-sort', 'reverse', 'unique'], ['k', 't']);
  if (p.bad || p.badLong) return badOption(io, 'sort', p, 2);
  const all: string[] = [];
  let code = 0;
  for (const name of p.args.length ? p.args : ['-']) {
    if (name === '-') {
      all.push(...linesOf(io.stdin ?? ''));
      continue;
    }
    const path = absPath(ctx.sh.cwd, name);
    const f = lookup(ctx.st, ctx.sh.user, path);
    if (!f.ok || f.node.type === 'dir' || !can(ctx.st, ctx.sh.user, f.node, 'r')) {
      io.err(`sort: ${f.ok && f.node.type === 'dir' ? 'read failed' : 'cannot read'}: ${name}: ${errText(f.ok ? (f.node.type === 'dir' ? 'EISDIR' : 'EACCES') : f.err)}\n`);
      code = 2;
      continue;
    }
    all.push(...linesOf(f.node.content ?? ''));
  }
  if (code) return code;
  const sep = p.values.t;
  const keyField = p.values.k ? Number(p.values.k.split(',')[0]!.replace(/[a-z]/g, '')) : 0;
  const keyOf = (l: string) => {
    if (!keyField) return l;
    const parts = sep ? l.split(sep) : l.trim().split(/\s+/);
    return parts.slice(keyField - 1).join(sep ?? ' ');
  };
  const num = p.flags.has('n') || p.flags.has('numeric-sort') || /n/.test(p.values.k ?? '');
  const hum = p.flags.has('h');
  const humVal = (s: string) => {
    const m = /^\s*([\d.]+)([KMGT]?)/.exec(s);
    return m ? Number(m[1]) * 1024 ** ' KMGT'.indexOf(m[2] || ' ') : 0;
  };
  const cmp = (a: string, b: string) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    let r: number;
    if (num || hum) {
      const na = hum ? humVal(ka) : parseFloat(ka) || 0;
      const nb = hum ? humVal(kb) : parseFloat(kb) || 0;
      r = na - nb;
    } else {
      const fa = p.flags.has('f') ? ka.toUpperCase() : ka;
      const fb = p.flags.has('f') ? kb.toUpperCase() : kb;
      r = fa < fb ? -1 : fa > fb ? 1 : 0;
    }
    if (r === 0) r = a < b ? -1 : a > b ? 1 : 0;
    return r;
  };
  let out = [...all].sort(cmp);
  if (p.flags.has('r') || p.flags.has('reverse')) out.reverse();
  if (p.flags.has('u') || p.flags.has('unique')) out = out.filter((l, i) => i === 0 || cmp(l, out[i - 1]!) !== 0 || keyOf(l) !== keyOf(out[i - 1]!));
  if (out.length) io.out(`${out.join('\n')}\n`);
  setExplain(ctx, num ? 'linux.explain.sortN' : 'linux.explain.sort');
  return 0;
};

export const uniq: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'cdui', ['count'], []);
  if (p.bad || p.badLong) return badOption(io, 'uniq', p);
  const ins = inputs(ctx, io, 'uniq', p.args.slice(0, 1));
  if (!ins) return 1;
  const lines = linesOf(ins[0]?.text ?? '');
  const groups: { line: string; n: number }[] = [];
  for (const l of lines) {
    const last = groups[groups.length - 1];
    if (last && (p.flags.has('i') ? last.line.toLowerCase() === l.toLowerCase() : last.line === l)) last.n++;
    else groups.push({ line: l, n: 1 });
  }
  for (const g of groups) {
    if (p.flags.has('d') && g.n < 2) continue;
    if (p.flags.has('u') && g.n > 1) continue;
    io.out(p.flags.has('c') || p.flags.has('count') ? `${String(g.n).padStart(7)} ${g.line}\n` : `${g.line}\n`);
  }
  setExplain(ctx, p.flags.has('c') ? 'linux.explain.uniqC' : 'linux.explain.uniq');
  return 0;
};

function fieldList(spec: string): ((i: number) => boolean) | null {
  const parts = spec.split(',');
  const tests: ((i: number) => boolean)[] = [];
  for (const part of parts) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[3] ? Number(m[3]) : m[2] ? Infinity : a;
    tests.push((i) => i >= a && i <= b);
  }
  return (i) => tests.some((t) => t(i));
}

export const cut: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 's', [], ['d', 'f', 'c']);
  if (p.bad || p.badLong) return badOption(io, 'cut', p);
  if (!p.values.f && !p.values.c) {
    io.err("cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n");
    return 1;
  }
  const d = p.values.d ?? '\t';
  if (d.length !== 1) {
    io.err("cut: the delimiter must be a single character\nTry 'cut --help' for more information.\n");
    return 1;
  }
  const sel = fieldList(p.values.f ?? p.values.c!);
  if (!sel) {
    io.err(`cut: invalid field value ${`'${p.values.f ?? p.values.c}'`}\nTry 'cut --help' for more information.\n`);
    return 1;
  }
  let code = 0;
  for (const name of p.args.length ? p.args : ['-']) {
    const text = name === '-' ? (io.stdin ?? '') : readFile(ctx, io, 'cut', name);
    if (text === null) {
      code = 1;
      continue;
    }
    for (const line of linesOf(text)) {
      if (p.values.c) {
        io.out(`${[...line].filter((_c, i) => sel(i + 1)).join('')}\n`);
        continue;
      }
      if (!line.includes(d)) {
        if (!p.flags.has('s')) io.out(`${line}\n`);
        continue;
      }
      io.out(`${line.split(d).filter((_x, i) => sel(i + 1)).join(d)}\n`);
    }
  }
  setExplain(ctx, 'linux.explain.cut');
  return code;
};

function trSet(s: string): string[] {
  const out: string[] = [];
  const chars = [...s.replace(/\\n/g, '\n').replace(/\\t/g, '\t')];
  const classes: Record<string, string> = { '[:lower:]': 'abcdefghijklmnopqrstuvwxyz', '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '[:digit:]': '0123456789', '[:space:]': ' \t\n' };
  const joined = chars.join('');
  for (const [k, v] of Object.entries(classes)) if (joined === k) return [...v];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i + 1] === '-' && chars[i + 2] !== undefined) {
      for (let c = chars[i]!.charCodeAt(0); c <= chars[i + 2]!.charCodeAt(0); c++) out.push(String.fromCharCode(c));
      i += 2;
    } else out.push(chars[i]!);
  }
  return out;
}

export const tr: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  const del = args[0] === '-d';
  const squeeze = args[0] === '-s';
  const sets = args.filter((a) => !a.startsWith('-') || a.length === 1);
  const text = io.stdin ?? '';
  if (!sets.length) {
    io.err("tr: missing operand\nTry 'tr --help' for more information.\n");
    return 1;
  }
  const a = trSet(sets[0]!);
  if (del) {
    io.out([...text].filter((c) => !a.includes(c)).join(''));
    return 0;
  }
  if (squeeze && sets.length === 1) {
    io.out(text.replace(new RegExp(`([${a.map((c) => c.replace(/[\]\\^-]/g, '\\$&')).join('')}])\\1+`, 'g'), '$1'));
    return 0;
  }
  if (sets.length < 2) {
    io.err(`tr: missing operand after ${`'${sets[0]}'`}\nTwo strings must be given when translating.\nTry 'tr --help' for more information.\n`);
    return 1;
  }
  const b = trSet(sets[1]!);
  io.out([...text].map((c) => (a.includes(c) ? (b[a.indexOf(c)] ?? b[b.length - 1] ?? c) : c)).join(''));
  setExplain(ctx, 'linux.explain.tr');
  return 0;
};

export const tee: Program = (ctx, argv, io) => {
  const append = argv.includes('-a');
  const files = argv.slice(1).filter((a) => !a.startsWith('-'));
  const text = io.stdin ?? '';
  io.out(text);
  let code = 0;
  for (const name of files) {
    const r = ctx.exec(['__write', name, append ? 'append' : 'replace', text, 'tee'], io);
    if (r !== 0) code = 1;
  }
  setExplain(ctx, 'linux.explain.tee', { name: files[0] ?? '' });
  return code;
};

// ---------------------------------------------------------------------------
// sed (s///, p, d, line and /regex/ addresses, -n, -i, -e)

export const sed: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  let quiet = false;
  let inPlace = false;
  const scripts: string[] = [];
  const files: string[] = [];
  let ext = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-n') quiet = true;
    else if (a === '-i' || a.startsWith('-i')) inPlace = true;
    else if (a === '-E' || a === '-r') ext = true;
    else if (a === '-e') scripts.push(args[++i] ?? '');
    else if (!scripts.length && !a.startsWith('-')) scripts.push(a);
    else files.push(a);
  }
  if (!scripts.length) {
    io.err('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n');
    return 1;
  }
  type Cmd = { addr?: (line: string, n: number) => boolean; op: string; re?: RegExp; rep?: string };
  const cmds: Cmd[] = [];
  for (const src of scripts) {
    let i = 0;
    const skip = () => {
      while (i < src.length && /[\s;]/.test(src[i]!)) i++;
    };
    skip();
    while (i < src.length) {
      let addr: Cmd['addr'];
      const rest0 = src.slice(i);
      const num = /^(\d+|\$)(?:,(\d+|\$))?/.exec(rest0);
      const rx = /^\/((?:\\.|[^/])*)\//.exec(rest0);
      if (num) {
        const a = num[1] === '$' ? Infinity : Number(num[1]);
        const b = num[2] === undefined ? a : num[2] === '$' ? Infinity : Number(num[2]);
        addr = (_l, n) => n >= a && n <= b;
        i += num[0].length;
      } else if (rx) {
        const re = new RegExp(ext ? rx[1]! : basicToJs(rx[1]!));
        addr = (l) => re.test(l);
        i += rx[0].length;
      }
      const c = src[i];
      if (c === 's') {
        const delim = src[i + 1] ?? '/';
        const parts: string[] = [];
        let j = i + 2;
        let cur = '';
        while (j < src.length && parts.length < 2) {
          const ch = src[j]!;
          if (ch === '\\' && j + 1 < src.length) {
            cur += src[j + 1] === delim ? delim : ch + src[j + 1];
            j += 2;
            continue;
          }
          if (ch === delim) {
            parts.push(cur);
            cur = '';
            j++;
            continue;
          }
          cur += ch;
          j++;
        }
        if (parts.length < 2) {
          io.err(`sed: -e expression #1, char ${src.length}: unterminated \`s' command\n`);
          return 1;
        }
        let flags = '';
        while (j < src.length && /[gIi0-9]/.test(src[j]!)) flags += src[j++]!;
        const re = new RegExp(ext ? parts[0]! : basicToJs(parts[0]!), (flags.includes('g') ? 'g' : '') + (/[Ii]/.test(flags) ? 'i' : ''));
        const rep = parts[1]!
          .replace(/\\t/g, '\t')
          .replace(/\\n/g, '\n')
          .replace(/\\(\d)/g, '$$$1')
          .replace(/(^|[^\\])&/g, '$1$$&')
          .replace(/\\&/g, '&');
        cmds.push({ ...(addr ? { addr } : {}), op: 's', re, rep });
        i = j;
      } else if (c === 'p' || c === 'd' || c === 'q') {
        cmds.push({ ...(addr ? { addr } : {}), op: c });
        i++;
      } else {
        io.err(`sed: -e expression #1, char ${i + 1}: unknown command: \`${c ?? ''}'\n`);
        return 1;
      }
      skip();
    }
  }
  const run = (text: string): string => {
    let out = '';
    const lines = linesOf(text);
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!;
      let deleted = false;
      let quit = false;
      const last = i === lines.length - 1;
      for (const c of cmds) {
        if (c.addr && !c.addr(line, last && c.addr(line, Infinity) ? Infinity : i + 1)) {
          if (!(c.addr(line, i + 1))) continue;
        }
        if (c.op === 's') line = line.replace(c.re!, c.rep!);
        else if (c.op === 'p') out += `${line}\n`;
        else if (c.op === 'd') {
          deleted = true;
          break;
        } else if (c.op === 'q') quit = true;
      }
      if (!deleted && !quiet) out += `${line}\n`;
      if (quit) break;
    }
    return out;
  };
  if (!files.length) {
    io.out(run(io.stdin ?? ''));
    return 0;
  }
  let code = 0;
  for (const name of files) {
    const text = readFile(ctx, io, 'sed', name);
    if (text === null) {
      code = 2;
      continue;
    }
    if (inPlace) {
      if (ctx.exec(['__write', name, 'replace', run(text), 'sed'], io) !== 0) code = 4;
      setExplain(ctx, 'linux.explain.sedI', { name });
    } else io.out(run(text));
  }
  if (!inPlace) setExplain(ctx, 'linux.explain.sed');
  return code;
};

// ---------------------------------------------------------------------------
// awk (a small subset: -F, /re/ patterns, print with $N, NR, NF, END)

export const awk: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  let fs: string | null = null;
  let prog: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-F') fs = args[++i] ?? ' ';
    else if (a.startsWith('-F')) fs = a.slice(2);
    else if (prog === undefined) prog = a;
    else files.push(a);
  }
  if (prog === undefined) {
    io.err('usage: mawk [-F value] [-v var=value] [--] \'program text\' [file ...]\n');
    return 2;
  }
  const blocks = [...prog.matchAll(/(BEGIN|END|\/(?:\\.|[^/])*\/|\$\d+\s*[=!]=\s*"[^"]*"|NR\s*[<>=]=?\s*\d+)?\s*\{([^}]*)\}/g)].map((m) => ({ pat: m[1], body: m[2]!.trim() }));
  if (!blocks.length) {
    const m = /^\/((?:\\.|[^/])*)\/$/.exec(prog.trim());
    if (m) blocks.push({ pat: prog.trim(), body: 'print' });
    else {
      io.err(`mawk: syntax error at or near ${prog.trim()[0] ?? 'end of file'}\n`);
      return 2;
    }
  }
  let text = '';
  for (const name of files.length ? files : ['-']) {
    const t = readFile(ctx, io, 'mawk', name);
    if (t === null) return 2;
    text += t;
  }
  const lines = linesOf(text);
  let nr = 0;
  const vars: Record<string, number> = {};
  const evalExpr = (e: string, fields: string[]): string => {
    e = e.trim();
    const parts = e.split(/\s*,\s*/);
    return parts
      .map((part) =>
        part
          .split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/)
          .map((tok) => {
            if (/^".*"$/.test(tok)) return tok.slice(1, -1);
            if (tok === 'NR') return String(nr);
            if (tok === 'NF') return String(fields.length - 1);
            const fm = /^\$(\d+|NF)$/.exec(tok);
            if (fm) return fields[fm[1] === 'NF' ? fields.length - 1 : Number(fm[1])] ?? '';
            if (/^[A-Za-z_]\w*$/.test(tok)) return String(vars[tok] ?? '');
            return tok;
          })
          .join(''),
      )
      .join(' ');
  };
  const runBody = (body: string, fields: string[]) => {
    for (const stmt of body.split(';').map((s) => s.trim()).filter(Boolean)) {
      const pm = /^print\s*(.*)$/.exec(stmt);
      if (pm) io.out(`${pm[1] ? evalExpr(pm[1], fields) : fields[0]}\n`);
      const inc = /^([A-Za-z_]\w*)\s*\+=\s*\$(\d+)$/.exec(stmt);
      if (inc) vars[inc[1]!] = (vars[inc[1]!] ?? 0) + (Number(fields[Number(inc[2])]) || 0);
      const pp = /^([A-Za-z_]\w*)\+\+$/.exec(stmt);
      if (pp) vars[pp[1]!] = (vars[pp[1]!] ?? 0) + 1;
    }
  };
  for (const b of blocks.filter((x) => x.pat === 'BEGIN')) runBody(b.body, ['']);
  for (const line of lines) {
    nr++;
    const fields = [line, ...(fs === null || fs === ' ' ? line.trim().split(/\s+/) : line.split(fs))];
    for (const b of blocks) {
      if (b.pat === 'BEGIN' || b.pat === 'END') continue;
      if (b.pat) {
        const rm = /^\/((?:\\.|[^/])*)\/$/.exec(b.pat);
        if (rm && !new RegExp(rm[1]!).test(line)) continue;
        const em = /^\$(\d+)\s*([=!])=\s*"([^"]*)"$/.exec(b.pat);
        if (em && (fields[Number(em[1])] === em[3]) !== (em[2] === '=')) continue;
        const nm = /^NR\s*([<>=]=?)\s*(\d+)$/.exec(b.pat);
        if (nm) {
          const v = Number(nm[2]);
          const ok = nm[1] === '<' ? nr < v : nm[1] === '>' ? nr > v : nm[1] === '<=' ? nr <= v : nm[1] === '>=' ? nr >= v : nr === v;
          if (!ok) continue;
        }
      }
      runBody(b.body, fields);
    }
  }
  for (const b of blocks.filter((x) => x.pat === 'END')) runBody(b.body, [lines[lines.length - 1] ?? '']);
  setExplain(ctx, 'linux.explain.awk');
  return 0;
};

export const seq: Program = (_ctx, argv, io) => {
  const n = argv.slice(1).map(Number);
  if (!n.length || n.some((x) => Number.isNaN(x))) {
    io.err(argv.length < 2 ? "seq: missing operand\nTry 'seq --help' for more information.\n" : `seq: invalid floating point argument: ‘${argv.slice(1).find((a) => Number.isNaN(Number(a)))}’\nTry 'seq --help' for more information.\n`);
    return 1;
  }
  const [first, step, last] = n.length === 1 ? [1, 1, n[0]!] : n.length === 2 ? [n[0]!, 1, n[1]!] : [n[0]!, n[1]!, n[2]!];
  for (let v = first; step > 0 ? v <= last : v >= last; v += step) io.out(`${v}\n`);
  return 0;
};

export const xargs: Program = (ctx, argv, io) => {
  const cmd = argv.slice(1).filter((a, i) => !(i === 0 && a === '-r'));
  const items = (io.stdin ?? '').split(/\s+/).filter(Boolean);
  if (!items.length && argv.includes('-r')) return 0;
  const run = cmd.length ? cmd : ['echo'];
  return ctx.exec([...run, ...items], { ...io, stdin: null });
};

export { linesOf };
