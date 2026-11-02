// A tiny POSIX-ish shell parser, shared by the laptop shell and the shell inside containers.
// Quotes, backslashes, $VAR / ${VAR} / $? expansion, $(...) substitution, and the operators
// | && || ; > >> < 2>&1 >&2 2>.

export interface Redirect {
  fd: 1 | 2;
  /** File name, or '&1' / '&2' to point at the other stream. */
  target: string;
  append: boolean;
}

export interface SimpleCommand {
  words: string[];
  /** Assignments before the command (`A=1 cmd`) or a bare assignment line. */
  assigns: [string, string][];
  redirects: Redirect[];
  input: string | null;
}

export interface Pipeline {
  commands: SimpleCommand[];
  /** How this pipeline joins the next one. */
  next: '&&' | '||' | ';' | null;
  background: boolean;
}

export type ParseResult = { ok: true; pipelines: Pipeline[] } | { ok: false; error: 'unclosedQuote' | 'syntax'; near?: string };

export interface Expand {
  /** Value of $NAME (undefined = unset, expands to nothing). */
  vars: (name: string) => string | undefined;
  /** Output of $(command), or undefined when substitution isn't allowed. */
  subst?: (command: string) => string;
}

type Tok = { k: 'w'; v: string; split: boolean } | { k: 'op'; v: string };

function readVar(src: string, i: number, ex: Expand): { value: string; end: number } | null {
  const next = src[i + 1];
  if (next === undefined) return null;
  if (next === '{') {
    const close = src.indexOf('}', i + 2);
    if (close < 0) return null;
    const inner = src.slice(i + 2, close);
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)(.*))?$/.exec(inner);
    if (!m) return { value: '', end: close + 1 };
    const v = ex.vars(m[1]!);
    if (m[2] === ':-') return { value: v ? v : (m[3] ?? ''), end: close + 1 };
    if (m[2] === '-') return { value: v ?? (m[3] ?? ''), end: close + 1 };
    return { value: v ?? '', end: close + 1 };
  }
  if (next === '?' || next === '$' || next === '#' || /\d/.test(next)) {
    return { value: ex.vars(next) ?? '', end: i + 2 };
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i + 1));
  if (!m) return null;
  return { value: ex.vars(m[0]) ?? '', end: i + 1 + m[0].length };
}

function readSubst(src: string, i: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')') {
      depth--;
      if (depth === 0) return { inner: src.slice(i + 2, j), end: j + 1 };
    }
  }
  return null;
}

export function tokenize(src: string, ex: Expand): { ok: true; toks: Tok[] } | { ok: false; error: 'unclosedQuote' } {
  const toks: Tok[] = [];
  let cur = '';
  let has = false;
  let split = false;
  let quote: '"' | "'" | null = null;
  const push = () => {
    if (has) toks.push({ k: 'w', v: cur, split });
    cur = '';
    has = false;
    split = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '\\') {
      const n = src[i + 1];
      if (n === undefined) continue;
      if (quote === '"' && !['"', '\\', '$', '`'].includes(n)) cur += ch;
      cur += n;
      has = true;
      i++;
      continue;
    }
    if (ch === '$') {
      if (src[i + 1] === '(' && src[i + 2] !== '(') {
        const s = readSubst(src, i);
        if (s && ex.subst) {
          cur += ex.subst(s.inner).replace(/\n+$/, '');
          has = true;
          if (!quote) split = true;
          i = s.end - 1;
          continue;
        }
      }
      const v = readVar(src, i, ex);
      if (v) {
        cur += v.value;
        has = true;
        if (!quote) split = true;
        i = v.end - 1;
        continue;
      }
      cur += ch;
      has = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      push();
      continue;
    }
    if (ch === '#' && !has) {
      break; // a comment
    }
    const two = src.slice(i, i + 2);
    const four = src.slice(i, i + 4);
    if (four === '2>&1' || four === '1>&2') {
      push();
      toks.push({ k: 'op', v: four });
      i += 3;
      continue;
    }
    if (src.slice(i, i + 3) === '>&2') {
      push();
      toks.push({ k: 'op', v: '1>&2' });
      i += 2;
      continue;
    }
    if (two === '2>' && !has) {
      push();
      const app = src[i + 2] === '>';
      toks.push({ k: 'op', v: app ? '2>>' : '2>' });
      i += app ? 2 : 1;
      continue;
    }
    if (two === '&&' || two === '||' || two === '>>') {
      push();
      toks.push({ k: 'op', v: two });
      i++;
      continue;
    }
    if (ch === '|' || ch === ';' || ch === '>' || ch === '<' || ch === '&') {
      push();
      toks.push({ k: 'op', v: ch });
      continue;
    }
    cur += ch;
    has = true;
  }
  if (quote) return { ok: false, error: 'unclosedQuote' };
  push();
  return { ok: true, toks };
}

export function parseShell(src: string, ex: Expand): ParseResult {
  const t = tokenize(src, ex);
  if (!t.ok) return t;
  const pipelines: Pipeline[] = [];
  let cmds: SimpleCommand[] = [];
  let cmd: SimpleCommand = { words: [], assigns: [], redirects: [], input: null };
  const endCmd = () => {
    if (cmd.words.length || cmd.assigns.length) cmds.push(cmd);
    cmd = { words: [], assigns: [], redirects: [], input: null };
  };
  const toks = t.toks;
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    if (tok.k === 'w') {
      if (cmd.words.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok.v)) {
        const eq = tok.v.indexOf('=');
        cmd.assigns.push([tok.v.slice(0, eq), tok.v.slice(eq + 1)]);
      } else if (tok.split && tok.v.trim() === '') {
        // An empty unquoted expansion disappears.
      } else if (tok.split) {
        cmd.words.push(...tok.v.split(/\s+/).filter(Boolean));
      } else cmd.words.push(tok.v);
      continue;
    }
    const op = tok.v;
    if (op === '>' || op === '>>' || op === '2>' || op === '2>>' || op === '<') {
      const target = toks[i + 1];
      if (!target || target.k !== 'w') return { ok: false, error: 'syntax', near: target?.k === 'op' ? target.v : 'newline' };
      i++;
      if (op === '<') cmd.input = target.v;
      else cmd.redirects.push({ fd: op.startsWith('2') ? 2 : 1, target: target.v, append: op.endsWith('>>') });
      continue;
    }
    if (op === '2>&1') {
      cmd.redirects.push({ fd: 2, target: '&1', append: false });
      continue;
    }
    if (op === '1>&2') {
      cmd.redirects.push({ fd: 1, target: '&2', append: false });
      continue;
    }
    if (op === '|') {
      if (!cmd.words.length) return { ok: false, error: 'syntax', near: '|' };
      endCmd();
      continue;
    }
    // && || ; &
    if (!cmd.words.length && !cmd.assigns.length && !cmds.length) return { ok: false, error: 'syntax', near: op };
    endCmd();
    pipelines.push({ commands: cmds, next: op === '&' ? ';' : (op as '&&' | '||' | ';'), background: op === '&' });
    cmds = [];
  }
  endCmd();
  if (cmds.length) pipelines.push({ commands: cmds, next: null, background: false });
  return { ok: true, pipelines };
}
