// A small bash parser: words keep their quotes (the expander removes them later), and the
// grammar covers what lessons and scripts use: pipelines, && || ; &, redirections (incl. here
// documents), if / for / while / until / case, { } and ( ) groups and functions.

export interface Redir {
  /** File descriptor the redirection applies to (1 for >, 0 for <). */
  fd: number;
  op: '>' | '>>' | '<' | '>&' | '<<' | '&>' | '&>>' | '<<<';
  /** The target word (raw), or the fd number for >&. */
  target: string;
  heredoc?: string;
  /** <<'EOF': no expansion inside. */
  quoted?: boolean;
}

export type Cmd =
  | { k: 'simple'; assigns: [string, string][]; words: string[]; redirs: Redir[]; line: number }
  | { k: 'if'; clauses: { cond: List; body: List }[]; orElse: List | null; redirs: Redir[]; line: number }
  | { k: 'for'; name: string; words: string[] | null; body: List; redirs: Redir[]; line: number }
  | { k: 'while'; until: boolean; cond: List; body: List; redirs: Redir[]; line: number }
  | { k: 'case'; word: string; items: { patterns: string[]; body: List }[]; redirs: Redir[]; line: number }
  | { k: 'group'; body: List; subshell: boolean; redirs: Redir[]; line: number }
  | { k: 'func'; name: string; body: Cmd; source: string; line: number };

export interface Pipeline {
  bang: boolean;
  cmds: Cmd[];
}

export interface AndOr {
  first: Pipeline;
  rest: { op: '&&' | '||'; p: Pipeline }[];
  /** Ends with & (runs in the background). */
  bg: boolean;
  /** Source text of this item (for jobs / ps). */
  text: string;
}

export interface List {
  items: AndOr[];
}

export class ParseError extends Error {
  constructor(
    public token: string,
    public eof = false,
  ) {
    super(eof ? 'syntax error: unexpected end of file' : `syntax error near unexpected token \`${token}'`);
  }
}

type Tok =
  | { t: 'word'; v: string; start: number; end: number; line: number }
  | { t: 'op'; v: string; start: number; end: number; line: number }
  | { t: 'redir'; fd: number; op: Redir['op']; start: number; end: number; line: number };

const OPS = ['&&', '||', ';;', '|', '&', ';', '(', ')', '\n'];
const RESERVED = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac', '{', '}', '!']);

/** Read `$( … )`, `$(( … ))` or `${ … }` starting at src[i] === '$'; returns the end index (exclusive). */
function skipDollar(src: string, i: number): number {
  const open = src[i + 1];
  if (open === '(') {
    let depth = 0;
    let j = i + 1;
    while (j < src.length) {
      const c = src[j]!;
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === "'") {
        const e = src.indexOf("'", j + 1);
        j = e < 0 ? src.length : e + 1;
        continue;
      }
      if (c === '"') {
        j = skipDouble(src, j);
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') {
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    return src.length;
  }
  if (open === '{') {
    const e = src.indexOf('}', i + 2);
    return e < 0 ? src.length : e + 1;
  }
  return i + 1;
}

/** src[i] === '"': index after the closing quote. */
function skipDouble(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j]!;
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '$' && (src[j + 1] === '(' || src[j + 1] === '{')) {
      j = skipDollar(src, j);
      continue;
    }
    if (c === '`') {
      const e = src.indexOf('`', j + 1);
      j = e < 0 ? src.length : e + 1;
      continue;
    }
    if (c === '"') return j + 1;
    j++;
  }
  throw new ParseError('"', true);
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const pendingHeredocs: { redirIndex: number; delim: string; strip: boolean }[] = [];
  const heredocs = new Map<number, { body: string; quoted: boolean }>();
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '\\' && src[i + 1] === '\n') {
      i += 2;
      line++;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      toks.push({ t: 'op', v: '\n', start: i, end: i + 1, line });
      i++;
      line++;
      // Here documents start on the next line.
      while (pendingHeredocs.length) {
        const h = pendingHeredocs.shift()!;
        const body: string[] = [];
        let found = false;
        while (i < src.length) {
          const e = src.indexOf('\n', i);
          const ln = e < 0 ? src.slice(i) : src.slice(i, e);
          i = e < 0 ? src.length : e + 1;
          line++;
          const cmp = h.strip ? ln.replace(/^\t+/, '') : ln;
          if (cmp === h.delim) {
            found = true;
            break;
          }
          body.push(h.strip ? ln.replace(/^\t+/, '') : ln);
        }
        if (!found && i >= src.length && body.length === 0) throw new ParseError('<<', true);
        const tok = toks[h.redirIndex] as Tok & { t: 'redir' };
        heredocs.set(tok.start, { body: body.length ? `${body.join('\n')}\n` : '', quoted: false });
      }
      continue;
    }
    // Redirections: [n]>, [n]>>, [n]<, >&n, &>, &>>, <<, <<<
    const redir = /^(\d?)(>>|>&|>|<<<|<<-?|<)|^(&>>?)/.exec(src.slice(i, i + 4));
    if (redir) {
      const fdText = redir[1];
      if (redir[3]) {
        toks.push({ t: 'redir', fd: 1, op: redir[3] as Redir['op'], start: i, end: i + redir[0].length, line });
        i += redir[0].length;
        continue;
      }
      let op = redir[2]!;
      const strip = op === '<<-';
      if (strip) op = '<<';
      const fd = fdText ? Number(fdText) : op.startsWith('<') ? 0 : 1;
      toks.push({ t: 'redir', fd, op: op as Redir['op'], start: i, end: i + redir[0].length, line });
      i += redir[0].length;
      if (op === '<<') {
        while (src[i] === ' ' || src[i] === '\t') i++;
        const m = /^(['"]?)([\w.-]+)\1/.exec(src.slice(i));
        if (!m) throw new ParseError('newline');
        const idx = toks.length - 1;
        pendingHeredocs.push({ redirIndex: idx, delim: m[2]!, strip });
        toks.push({ t: 'word', v: m[1] ? `'${m[2]}'` : m[2]!, start: i, end: i + m[0].length, line });
        i += m[0].length;
      }
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ t: 'op', v: op, start: i, end: i + op.length, line });
      i += op.length;
      continue;
    }
    // A word: up to unquoted space or operator.
    const start = i;
    while (i < src.length) {
      const d = src[i]!;
      if (d === ' ' || d === '\t' || d === '\n' || d === ';' || d === '|' || d === '&' || d === '(' || d === ')' || d === '<' || d === '>') {
        if (d === '(' && i > start && /^[\w-]+=$/.test(src.slice(start, i))) {
          // name=( … ) arrays are not supported: read up to the closing paren as one word.
          const e = src.indexOf(')', i);
          i = e < 0 ? src.length : e + 1;
          continue;
        }
        break;
      }
      if (d === '\\') {
        i += 2;
        continue;
      }
      if (d === "'") {
        const e = src.indexOf("'", i + 1);
        if (e < 0) throw new ParseError("'", true);
        i = e + 1;
        continue;
      }
      if (d === '"') {
        i = skipDouble(src, i);
        continue;
      }
      if (d === '$' && (src[i + 1] === '(' || src[i + 1] === '{')) {
        i = skipDollar(src, i);
        continue;
      }
      if (d === '`') {
        const e = src.indexOf('`', i + 1);
        if (e < 0) throw new ParseError('`', true);
        i = e + 1;
        continue;
      }
      i++;
    }
    toks.push({ t: 'word', v: src.slice(start, i), start, end: i, line });
    line += (src.slice(start, i).match(/\n/g) ?? []).length;
  }
  if (pendingHeredocs.length) {
    for (const h of pendingHeredocs) {
      const tok = toks[h.redirIndex] as Tok & { t: 'redir' };
      heredocs.set(tok.start, { body: '', quoted: false });
    }
  }
  // Attach here-document bodies to their redirection tokens.
  for (const tk of toks) if (tk.t === 'redir' && heredocs.has(tk.start)) (tk as Tok & { body?: string }).body = heredocs.get(tk.start)!.body;
  return toks;
}

class Parser {
  i = 0;
  constructor(
    private toks: Tok[],
    private src: string,
  ) {}

  peek(): Tok | undefined {
    return this.toks[this.i];
  }

  isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'op' && t.v === v;
  }

  isWord(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'word' && t.v === v;
  }

  skipNewlines() {
    while (this.isOp('\n')) this.i++;
  }

  expectWord(v: string) {
    this.skipNewlines();
    if (!this.isWord(v)) {
      const t = this.peek();
      if (!t) throw new ParseError(v, true);
      throw new ParseError(t.t === 'op' ? (t.v === '\n' ? 'newline' : t.v) : t.t === 'word' ? t.v : src(this.src, t));
    }
    this.i++;
  }

  /** A list up to one of the stop words (not consumed). */
  list(stops: string[]): List {
    const items: AndOr[] = [];
    for (;;) {
      this.skipNewlines();
      const t = this.peek();
      if (!t) break;
      if (t.t === 'word' && stops.includes(t.v)) break;
      if (t.t === 'op' && (t.v === ')' || t.v === ';;') && stops.includes(t.v)) break;
      if (t.t === 'op' && t.v !== '(' && t.v !== '\n') throw new ParseError(t.v);
      const ao = this.andOr();
      items.push(ao);
      const n = this.peek();
      if (n && n.t === 'op' && (n.v === ';' || n.v === '&' || n.v === '\n')) {
        if (n.v === '&') ao.bg = true;
        this.i++;
      }
    }
    return { items };
  }

  andOr(): AndOr {
    const startTok = this.peek()!;
    const first = this.pipeline();
    const rest: AndOr['rest'] = [];
    while (this.isOp('&&') || this.isOp('||')) {
      const op = (this.peek() as Tok & { t: 'op' }).v as '&&' | '||';
      this.i++;
      this.skipNewlines();
      if (!this.peek()) throw new ParseError(op, true);
      rest.push({ op, p: this.pipeline() });
    }
    const endTok = this.toks[this.i - 1]!;
    return { first, rest, bg: false, text: this.src.slice(startTok.start, endTok.end).trim() };
  }

  pipeline(): Pipeline {
    let bang = false;
    if (this.isWord('!')) {
      bang = true;
      this.i++;
    }
    const cmds = [this.command()];
    while (this.isOp('|')) {
      this.i++;
      this.skipNewlines();
      if (!this.peek()) throw new ParseError('|', true);
      cmds.push(this.command());
    }
    return { bang, cmds };
  }

  redirs(): Redir[] {
    const out: Redir[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'redir') return out;
      this.i++;
      const w = this.peek();
      if (!w || w.t !== 'word') throw new ParseError(w ? (w.t === 'op' ? (w.v === '\n' ? 'newline' : w.v) : 'newline') : 'newline');
      this.i++;
      const r: Redir = { fd: t.fd, op: t.op, target: w.v };
      if (t.op === '<<') {
        r.heredoc = (t as Tok & { body?: string }).body ?? '';
        r.quoted = /^['"]/.test(w.v);
      }
      out.push(r);
    }
  }

  command(): Cmd {
    const t = this.peek();
    if (!t) throw new ParseError('', true);
    const line = t.line;
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const body = this.list([')']);
      if (!this.isOp(')')) throw new ParseError(')', true);
      this.i++;
      return { k: 'group', body, subshell: true, redirs: this.redirs(), line };
    }
    if (t.t === 'word') {
      switch (t.v) {
        case 'if':
          return this.ifCmd();
        case 'for':
          return this.forCmd();
        case 'while':
        case 'until':
          return this.whileCmd(t.v === 'until');
        case 'case':
          return this.caseCmd();
        case '{': {
          this.i++;
          const body = this.list(['}']);
          this.expectWord('}');
          return { k: 'group', body, subshell: false, redirs: this.redirs(), line };
        }
        case 'then':
        case 'elif':
        case 'else':
        case 'fi':
        case 'do':
        case 'done':
        case 'esac':
        case '}':
        case 'in':
          throw new ParseError(t.v);
      }
      // name() { … }
      const nx = this.toks[this.i + 1];
      const nx2 = this.toks[this.i + 2];
      if (/^[A-Za-z_][\w-]*$/.test(t.v) && nx?.t === 'op' && nx.v === '(' && nx2?.t === 'op' && nx2.v === ')') {
        this.i += 3;
        this.skipNewlines();
        const bodyStart = this.peek();
        const body = this.command();
        const endTok = this.toks[this.i - 1]!;
        return { k: 'func', name: t.v, body, source: this.src.slice(bodyStart!.start, endTok.end), line };
      }
      if (t.v === 'function') {
        const name = this.toks[this.i + 1];
        if (name?.t === 'word') {
          this.i += 2;
          if (this.isOp('(')) {
            this.i++;
            if (!this.isOp(')')) throw new ParseError('(');
            this.i++;
          }
          this.skipNewlines();
          const bodyStart = this.peek();
          const body = this.command();
          const endTok = this.toks[this.i - 1]!;
          return { k: 'func', name: name.v, body, source: this.src.slice(bodyStart!.start, endTok.end), line };
        }
      }
    }
    // A simple command.
    const assigns: [string, string][] = [];
    const words: string[] = [];
    const redirs: Redir[] = [];
    for (;;) {
      const x = this.peek();
      if (!x) break;
      if (x.t === 'redir') {
        redirs.push(...this.redirs());
        continue;
      }
      if (x.t !== 'word') break;
      const m = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(x.v);
      if (m && words.length === 0) assigns.push([m[1]!, m[2]!]);
      else words.push(x.v);
      this.i++;
    }
    if (!words.length && !assigns.length && !redirs.length) {
      const x = this.peek();
      throw new ParseError(x ? (x.t === 'op' ? (x.v === '\n' ? 'newline' : x.v) : 'newline') : '', !x);
    }
    return { k: 'simple', assigns, words, redirs, line };
  }

  ifCmd(): Cmd {
    const line = this.peek()!.line;
    this.i++;
    const clauses: { cond: List; body: List }[] = [];
    let orElse: List | null = null;
    const cond = this.list(['then']);
    this.expectWord('then');
    clauses.push({ cond, body: this.list(['elif', 'else', 'fi']) });
    for (;;) {
      this.skipNewlines();
      if (this.isWord('elif')) {
        this.i++;
        const c = this.list(['then']);
        this.expectWord('then');
        clauses.push({ cond: c, body: this.list(['elif', 'else', 'fi']) });
        continue;
      }
      if (this.isWord('else')) {
        this.i++;
        orElse = this.list(['fi']);
      }
      break;
    }
    this.expectWord('fi');
    for (const c of clauses) if (!c.cond.items.length) throw new ParseError('then');
    return { k: 'if', clauses, orElse, redirs: this.redirs(), line };
  }

  forCmd(): Cmd {
    const line = this.peek()!.line;
    this.i++;
    const name = this.peek();
    if (!name || name.t !== 'word') throw new ParseError(name?.t === 'op' ? name.v : 'newline', !name);
    this.i++;
    let words: string[] | null = null;
    this.skipNewlines();
    if (this.isWord('in')) {
      this.i++;
      words = [];
      while (this.peek()?.t === 'word' && !this.isWord('do')) {
        words.push((this.peek() as Tok & { t: 'word' }).v);
        this.i++;
      }
      if (this.isOp(';') || this.isOp('\n')) this.i++;
    } else if (this.isOp(';')) this.i++;
    this.expectWord('do');
    const body = this.list(['done']);
    this.expectWord('done');
    return { k: 'for', name: name.v, words, body, redirs: this.redirs(), line };
  }

  whileCmd(until: boolean): Cmd {
    const line = this.peek()!.line;
    this.i++;
    const cond = this.list(['do']);
    this.expectWord('do');
    const body = this.list(['done']);
    this.expectWord('done');
    return { k: 'while', until, cond, body, redirs: this.redirs(), line };
  }

  caseCmd(): Cmd {
    const line = this.peek()!.line;
    this.i++;
    const w = this.peek();
    if (!w || w.t !== 'word') throw new ParseError('newline', !w);
    this.i++;
    this.expectWord('in');
    const items: { patterns: string[]; body: List }[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.isWord('esac')) break;
      if (!this.peek()) throw new ParseError('esac', true);
      if (this.isOp('(')) this.i++;
      const patterns: string[] = [];
      for (;;) {
        const p = this.peek();
        if (!p || p.t !== 'word') throw new ParseError(p?.t === 'op' ? p.v : 'newline', !p);
        patterns.push(p.v);
        this.i++;
        if (this.isOp('|')) {
          this.i++;
          continue;
        }
        break;
      }
      if (!this.isOp(')')) throw new ParseError(this.peek()?.t === 'word' ? (this.peek() as Tok & { t: 'word' }).v : 'newline');
      this.i++;
      const body = this.list([';;', 'esac']);
      items.push({ patterns, body });
      if (this.isOp(';;')) this.i++;
    }
    this.expectWord('esac');
    return { k: 'case', word: w.v, items, redirs: this.redirs(), line };
  }
}

function src(text: string, t: Tok): string {
  return text.slice(t.start, t.end);
}

/** Parse a command line or a whole script. Throws ParseError with bash's wording. */
export function parseScript(text: string): List {
  const toks = tokenize(text);
  const p = new Parser(toks, text);
  const l = p.list([]);
  const rest = p.peek();
  if (rest) throw new ParseError(rest.t === 'word' ? rest.v : rest.t === 'op' ? rest.v : 'newline');
  return l;
}

export { RESERVED };
