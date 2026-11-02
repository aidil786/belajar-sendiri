// A small HCL (native syntax) lexer and parser: bodies, attributes, blocks and expressions with
// source ranges, so diagnostics can quote the line like OpenTofu does. Pure TypeScript.

export interface Pos {
  line: number;
  col: number;
  byte: number;
}
export interface Range {
  file: string;
  start: Pos;
  end: Pos;
}

// ---------------------------------------------------------------------------
// Tokens

export type TokType = 'ident' | 'number' | 'string' | 'heredoc' | 'nl' | 'op' | 'comment' | 'eof';
export type TemplatePart = { lit: string; raw: string } | { toks: Tok[]; range: Range };

export interface Tok {
  type: TokType;
  v: string;
  raw: string;
  range: Range;
  parts?: TemplatePart[];
  /** Heredoc: `<<-` strips the common indent. */
  flush?: boolean;
  marker?: string;
}

export class HclError extends Error {
  constructor(
    public summary: string,
    public detail: string,
    public range: Range,
    public context?: Range,
  ) {
    super(summary);
  }
}

const OPS = ['...', '==', '!=', '<=', '>=', '&&', '||', '=>', '=', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '.', ',', '(', ')', '[', ']', '{', '}'];

export function lex(src: string, file: string, opts: { comments?: boolean } = {}): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const pos = (): Pos => ({ line, col, byte: i });
  const adv = (n = 1) => {
    for (let k = 0; k < n && i < src.length; k++) {
      if (src[i] === '\n') {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };
  const push = (type: TokType, start: Pos, startByte: number, extra: Partial<Tok> = {}) => {
    const raw = src.slice(startByte, i);
    toks.push({ type, v: extra.v ?? raw, raw, range: { file, start, end: pos() }, ...extra });
  };

  const lexTemplate = (closeQuote: boolean, heredocEnd?: { marker: string }): { parts: TemplatePart[] } => {
    const parts: TemplatePart[] = [];
    let lit = '';
    let raw = '';
    const flush = () => {
      if (lit || raw) parts.push({ lit, raw });
      lit = '';
      raw = '';
    };
    while (i < src.length) {
      const c = src[i]!;
      if (closeQuote && c === '"') return (flush(), { parts });
      if (closeQuote && c === '\n') {
        throw new HclError('Unterminated template string', 'No closing marker was found for the string.', { file, start: pos(), end: pos() });
      }
      if (heredocEnd && (col === 1 || i === 0)) {
        const rest = src.slice(i);
        const m = /^[ \t]*([A-Za-z_][\w-]*)[ \t]*(\r?\n|$)/.exec(rest);
        if (m && m[1] === heredocEnd.marker) return (flush(), { parts });
      }
      if (closeQuote && c === '\\') {
        const n = src[i + 1];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
        if (n && n in map) {
          lit += map[n];
          raw += src.slice(i, i + 2);
          adv(2);
          continue;
        }
        if (n === 'u' || n === 'U') {
          const len = n === 'u' ? 4 : 8;
          const hex = src.slice(i + 2, i + 2 + len);
          lit += String.fromCodePoint(parseInt(hex, 16));
          raw += src.slice(i, i + 2 + len);
          adv(2 + len);
          continue;
        }
        throw new HclError('Invalid escape sequence', `The symbol "${n ?? ''}" is not a valid escape sequence selector.`, { file, start: pos(), end: pos() });
      }
      if ((c === '$' || c === '%') && src[i + 1] === c && src[i + 2] === '{') {
        lit += `${c}{`;
        raw += src.slice(i, i + 3);
        adv(3);
        continue;
      }
      if (c === '%' && src[i + 1] === '{') {
        throw new HclError('Unsupported template directive', 'This practice tool does not run %{ } template directives. Use a conditional expression or a for expression instead.', { file, start: pos(), end: pos() });
      }
      if (c === '$' && src[i + 1] === '{') {
        flush();
        const start = pos();
        adv(2);
        const inner: Tok[] = [];
        let depth = 0;
        for (;;) {
          skipSpace(true);
          if (i >= src.length) throw new HclError('Unterminated template string', 'No closing marker was found for the string.', { file, start, end: pos() });
          if (src[i] === '}' && depth === 0) {
            adv();
            break;
          }
          const t = next(true);
          if (!t) break;
          if (t.type === 'op' && t.v === '{') depth++;
          if (t.type === 'op' && t.v === '}') depth--;
          inner.push(t);
        }
        const endP = pos();
        inner.push({ type: 'eof', v: '', raw: '', range: { file, start: endP, end: endP } });
        parts.push({ toks: inner, range: { file, start, end: endP } });
        continue;
      }
      lit += c;
      raw += c;
      adv();
    }
    if (closeQuote) throw new HclError('Unterminated template string', 'No closing marker was found for the string.', { file, start: pos(), end: pos() });
    throw new HclError('Unterminated template string', `No closing marker was found for the heredoc.`, { file, start: pos(), end: pos() });
  };

  function skipSpace(newlines: boolean) {
    while (i < src.length) {
      const c = src[i]!;
      if (c === ' ' || c === '\t' || c === '\r' || (newlines && c === '\n')) adv();
      else break;
    }
  }

  function next(inInterp: boolean): Tok | null {
    const start = pos();
    const sb = i;
    const c = src[i]!;
    if (c === '\n') {
      adv();
      return { type: 'nl', v: '\n', raw: '\n', range: { file, start, end: pos() } };
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') adv();
      const raw = src.slice(sb, i);
      return { type: 'comment', v: raw, raw, range: { file, start, end: pos() } };
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      adv(end < 0 ? src.length - i : end + 2 - i);
      const raw = src.slice(sb, i);
      return { type: 'comment', v: raw, raw, range: { file, start, end: pos() } };
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[\w-]/.test(src[i]!)) adv();
      const raw = src.slice(sb, i);
      return { type: 'ident', v: raw, raw, range: { file, start, end: pos() } };
    }
    if (/[0-9]/.test(c)) {
      while (i < src.length && /[0-9]/.test(src[i]!)) adv();
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        adv();
        while (i < src.length && /[0-9]/.test(src[i]!)) adv();
      }
      if (/[eE]/.test(src[i] ?? '') && /[-+0-9]/.test(src[i + 1] ?? '')) {
        adv();
        if (/[-+]/.test(src[i]!)) adv();
        while (i < src.length && /[0-9]/.test(src[i]!)) adv();
      }
      const raw = src.slice(sb, i);
      return { type: 'number', v: raw, raw, range: { file, start, end: pos() } };
    }
    if (c === '"') {
      adv();
      const { parts } = lexTemplate(true);
      adv(); // closing quote
      const raw = src.slice(sb, i);
      return { type: 'string', v: raw, raw, range: { file, start, end: pos() }, parts };
    }
    if (c === '<' && src[i + 1] === '<' && /[-A-Za-z_]/.test(src[i + 2] ?? '')) {
      const m = /^<<(-?)([A-Za-z_][\w-]*)\r?\n/.exec(src.slice(i));
      if (m) {
        adv(m[0].length);
        const { parts } = lexTemplate(false, { marker: m[2]! });
        // closing marker line
        while (i < src.length && src[i] !== '\n') adv();
        const raw = src.slice(sb, i);
        const t: Tok = { type: 'heredoc', v: raw, raw, range: { file, start, end: pos() }, parts: m[1] ? dedent(parts) : parts, flush: Boolean(m[1]), marker: m[2]! };
        return t;
      }
    }
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        adv(op.length);
        return { type: 'op', v: op, raw: op, range: { file, start, end: pos() } };
      }
    }
    void inInterp;
    throw new HclError('Invalid character', `This character is not used within the language.`, { file, start, end: { line, col: col + 1, byte: i + 1 } });
  }

  while (i < src.length) {
    skipSpace(false);
    if (i >= src.length) break;
    const t = next(false);
    if (!t) break;
    if (t.type === 'comment' && !opts.comments) continue;
    toks.push(t);
  }
  const p = pos();
  toks.push({ type: 'eof', v: '', raw: '', range: { file, start: p, end: p } });
  void push;
  return toks;
}

/** `<<-EOT`: remove the smallest leading indent from every line. */
function dedent(parts: TemplatePart[]): TemplatePart[] {
  // Work on the literal text at line starts only (like HCL).
  const text = parts.map((p) => ('lit' in p ? p.lit : '\u0000')).join('');
  const lines = text.split('\n');
  let min = Infinity;
  for (const l of lines.slice(0, -1).concat(lines[lines.length - 1] ? [lines[lines.length - 1]!] : [])) {
    if (!l.trim()) continue;
    const m = /^[ \t]*/.exec(l)![0].length;
    min = Math.min(min, m);
  }
  if (!Number.isFinite(min) || min === 0) return parts;
  const out: TemplatePart[] = [];
  let atLineStart = true;
  for (const p of parts) {
    if (!('lit' in p)) {
      out.push(p);
      atLineStart = false;
      continue;
    }
    const segs = p.lit.split('\n');
    const fixed = segs.map((s, idx) => {
      const start = idx > 0 || atLineStart;
      return start ? s.replace(new RegExp(`^[ \\t]{0,${min}}`), '') : s;
    });
    const lit = fixed.join('\n');
    out.push({ lit, raw: p.raw });
    atLineStart = p.lit.endsWith('\n');
  }
  return out;
}

// ---------------------------------------------------------------------------
// AST

export type Step = { t: 'attr'; name: string; range: Range } | { t: 'index'; key: Expr; range: Range } | { t: 'splat'; range: Range };

export type Expr =
  | { k: 'lit'; v: null | string | number | boolean; range: Range }
  | { k: 'tmpl'; parts: (string | Expr)[]; range: Range; heredoc?: boolean }
  | { k: 'tuple'; items: Expr[]; range: Range }
  | { k: 'object'; items: { key: Expr; ident: boolean; value: Expr }[]; range: Range }
  | { k: 'var'; name: string; range: Range }
  | { k: 'get'; obj: Expr; steps: Step[]; range: Range }
  | { k: 'call'; name: string; args: Expr[]; expand: boolean; range: Range; nameRange: Range }
  | { k: 'unary'; op: '-' | '!'; e: Expr; range: Range }
  | { k: 'binary'; op: string; l: Expr; r: Expr; range: Range }
  | { k: 'cond'; c: Expr; t: Expr; f: Expr; range: Range }
  | { k: 'for'; key?: string; val: string; coll: Expr; keyExpr?: Expr; valExpr: Expr; cond?: Expr; group: boolean; obj: boolean; range: Range }
  | { k: 'paren'; e: Expr; range: Range };

export interface Attribute {
  kind: 'attr';
  name: string;
  expr: Expr;
  range: Range;
  nameRange: Range;
}

export interface Block {
  kind: 'block';
  type: string;
  labels: string[];
  body: Body;
  range: Range;
  typeRange: Range;
  labelRanges: Range[];
  /** From the type to the opening brace: what OpenTofu quotes for a block. */
  defRange: Range;
  openRange: Range;
  closeRange: Range;
}

export interface Body {
  items: (Attribute | Block)[];
  range: Range;
}

export const attrsOf = (b: Body) => b.items.filter((x): x is Attribute => x.kind === 'attr');
export const blocksOf = (b: Body, type?: string) => b.items.filter((x): x is Block => x.kind === 'block' && (!type || x.type === type));
export const attrOf = (b: Body, name: string) => attrsOf(b).find((a) => a.name === name);

const span = (a: Range, b: Range): Range => ({ file: a.file, start: a.start, end: b.end });

// ---------------------------------------------------------------------------
// Parser

class Parser {
  private p = 0;
  private nlSkip = 0;
  constructor(
    private toks: Tok[],
    private file: string,
  ) {}

  private raw(i = this.p): Tok {
    return this.toks[Math.min(i, this.toks.length - 1)]!;
  }
  /** Index of the next token, skipping newlines when inside brackets. Does not move. */
  private ahead(): number {
    let i = this.p;
    if (this.nlSkip > 0) while (this.raw(i).type === 'nl') i++;
    return i;
  }
  peek(): Tok {
    return this.raw(this.ahead());
  }
  take(): Tok {
    const i = this.ahead();
    this.p = i + 1;
    return this.raw(i);
  }
  isOp(v: string) {
    const t = this.peek();
    return t.type === 'op' && t.v === v;
  }
  expectOp(v: string, what: string, detail?: string): Tok {
    const t = this.peek();
    if (t.type === 'op' && t.v === v) return this.take();
    throw new HclError(what, detail ?? `Expected "${v}".`, t.range);
  }
  skipNl() {
    while (this.raw().type === 'nl') this.p++;
  }

  body(end: 'eof' | '}', openBlock?: { range: Range; header: string }): Body {
    const items: (Attribute | Block)[] = [];
    const start = this.raw().range;
    for (;;) {
      this.skipNl();
      const t = this.raw();
      if (t.type === 'eof') {
        if (end === '}' && openBlock) {
          throw new HclError(
            'Unclosed configuration block',
            'There is no closing brace for this block before the end of the file. This may be caused by incorrect brace nesting elsewhere in this file.',
            openBlock.range,
          );
        }
        return { items, range: span(start, t.range) };
      }
      if (t.type === 'op' && t.v === '}') {
        if (end === '}') return { items, range: span(start, t.range) };
        throw new HclError('Argument or block definition required', 'An argument or block definition is required here.', t.range);
      }
      if (t.type !== 'ident') {
        throw new HclError('Argument or block definition required', 'An argument or block definition is required here.', t.range);
      }
      this.p++;
      const n = this.raw();
      if (n.type === 'op' && n.v === '=') {
        this.p++;
        const expr = this.expr();
        const after = this.raw();
        if (after.type !== 'nl' && after.type !== 'eof' && !(after.type === 'op' && after.v === '}' && end === '}')) {
          throw new HclError('Missing newline after argument', 'An argument definition must end with a newline.', after.range);
        }
        items.push({ kind: 'attr', name: t.v, expr, range: span(t.range, expr.range), nameRange: t.range });
        continue;
      }
      // block: labels then {
      const labels: string[] = [];
      const labelRanges: Range[] = [];
      for (;;) {
        const l = this.raw();
        if (l.type === 'string') {
          const ps = l.parts ?? [];
          if (ps.some((x) => !('lit' in x))) throw new HclError('Invalid block label', 'Block labels cannot contain template sequences.', l.range);
          labels.push(ps.map((x) => ('lit' in x ? x.lit : '')).join(''));
          labelRanges.push(l.range);
          this.p++;
        } else if (l.type === 'ident') {
          labels.push(l.v);
          labelRanges.push(l.range);
          this.p++;
        } else break;
      }
      const ob = this.raw();
      if (!(ob.type === 'op' && ob.v === '{')) {
        if (ob.type === 'op' && ob.v === ':') throw new HclError('Argument or block definition required', 'An argument or block definition is required here. To set an argument, use the equals sign "=" to introduce the argument value.', ob.range);
        throw new HclError(
          labels.length ? 'Invalid block definition' : 'Argument or block definition required',
          labels.length ? 'Either a quoted string block label or an opening brace ("{") is expected here.' : 'An argument or block definition is required here. To set an argument, use the equals sign "=" to introduce the argument value.',
          ob.range,
        );
      }
      this.p++;
      const defRange = span(t.range, ob.range);
      const inner = this.body('}', { range: defRange, header: [t.v, ...labels.map((x) => `"${x}"`)].join(' ') });
      const cb = this.raw();
      this.p++;
      const after = this.raw();
      if (after.type !== 'nl' && after.type !== 'eof' && !(after.type === 'op' && after.v === '}')) {
        throw new HclError('Missing newline after block definition', 'A block definition must end with a newline.', after.range);
      }
      items.push({ kind: 'block', type: t.v, labels, body: inner, range: span(t.range, cb.range), typeRange: t.range, labelRanges, defRange, openRange: ob.range, closeRange: cb.range });
    }
  }

  expr(): Expr {
    return this.cond();
  }

  private cond(): Expr {
    const c = this.binary(0);
    if (this.isOp('?')) {
      this.take();
      this.nlSkip++;
      const t = this.expr();
      this.expectOp(':', 'Missing false expression in conditional', 'The conditional operator (...?...:...) requires a false expression, delimited by a colon.');
      this.nlSkip--;
      const f = this.expr();
      return { k: 'cond', c, t, f, range: span(c.range, f.range) };
    }
    return c;
  }

  private static LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

  private binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary();
    let l = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && Parser.LEVELS[level]!.includes(t.v)) {
        this.take();
        const r = this.binary(level + 1);
        l = { k: 'binary', op: t.v, l, r, range: span(l.range, r.range) };
      } else return l;
    }
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.type === 'op' && (t.v === '-' || t.v === '!')) {
      this.take();
      const e = this.unary();
      return { k: 'unary', op: t.v as '-' | '!', e, range: span(t.range, e.range) };
    }
    return this.postfix(this.primary());
  }

  private postfix(e: Expr): Expr {
    const steps: Step[] = [];
    let base = e;
    for (;;) {
      const t = this.raw();
      if (t.type === 'op' && t.v === '.') {
        this.p++;
        const n = this.raw();
        if (n.type === 'ident') {
          this.p++;
          steps.push({ t: 'attr', name: n.v, range: n.range });
          continue;
        }
        if (n.type === 'number') {
          this.p++;
          steps.push({ t: 'index', key: { k: 'lit', v: Number(n.v), range: n.range }, range: n.range });
          continue;
        }
        if (n.type === 'op' && n.v === '*') {
          this.p++;
          steps.push({ t: 'splat', range: n.range });
          continue;
        }
        throw new HclError('Invalid attribute name', 'An attribute name is required after a dot.', n.range);
      }
      if (t.type === 'op' && t.v === '[') {
        this.p++;
        this.nlSkip++;
        if (this.isOp('*')) {
          const st = this.take();
          this.expectOp(']', 'Missing close bracket on splat index', 'The star for a full splat operator must be immediately followed by a closing bracket ("]").');
          this.nlSkip--;
          steps.push({ t: 'splat', range: st.range });
          continue;
        }
        const key = this.expr();
        const close = this.expectOp(']', 'Missing close bracket on index', 'The index operator must end with a closing bracket ("]").');
        this.nlSkip--;
        steps.push({ t: 'index', key, range: span(t.range, close.range) });
        continue;
      }
      break;
    }
    if (!steps.length) return base;
    const last = steps[steps.length - 1]!.range;
    base = { k: 'get', obj: base, steps, range: span(e.range, last) };
    return base;
  }

  private primary(): Expr {
    const t = this.take();
    if (t.type === 'number') return { k: 'lit', v: Number(t.v), range: t.range };
    if (t.type === 'string' || t.type === 'heredoc') return this.template(t);
    if (t.type === 'ident') {
      if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true', range: t.range };
      if (t.v === 'null') return { k: 'lit', v: null, range: t.range };
      if (this.raw().type === 'op' && this.raw().v === '(') {
        this.p++;
        this.nlSkip++;
        const args: Expr[] = [];
        let expand = false;
        while (!this.isOp(')')) {
          args.push(this.expr());
          if (this.isOp('...')) {
            this.take();
            expand = true;
          }
          if (this.isOp(',')) this.take();
          else if (!this.isOp(')')) throw new HclError('Missing argument separator', 'A comma is required to separate each function argument from the next.', this.peek().range);
        }
        const close = this.take();
        this.nlSkip--;
        return { k: 'call', name: t.v, args, expand, range: span(t.range, close.range), nameRange: t.range };
      }
      return { k: 'var', name: t.v, range: t.range };
    }
    if (t.type === 'op' && t.v === '(') {
      this.nlSkip++;
      const e = this.expr();
      const close = this.expectOp(')', 'Unbalanced parentheses', 'Expected a closing parenthesis to terminate the expression.');
      this.nlSkip--;
      return { k: 'paren', e, range: span(t.range, close.range) };
    }
    if (t.type === 'op' && t.v === '[') return this.tupleOrFor(t);
    if (t.type === 'op' && t.v === '{') return this.objectOrFor(t);
    if (t.type === 'nl' || t.type === 'eof') {
      throw new HclError('Invalid expression', 'Expected the start of an expression, but found the end of the file.', t.range);
    }
    throw new HclError('Invalid expression', 'Expected the start of an expression, but found an invalid expression token.', t.range);
  }

  private template(t: Tok): Expr {
    const parts: (string | Expr)[] = [];
    for (const p of t.parts ?? []) {
      if ('lit' in p) parts.push(p.lit);
      else {
        const sub = new Parser(p.toks, this.file);
        sub.nlSkip = 1;
        const e = sub.expr();
        if (sub.peek().type !== 'eof') throw new HclError('Extra characters after interpolation expression', 'Expected a closing brace to end the interpolation expression, but found extra characters.', sub.peek().range);
        parts.push(e);
      }
    }
    return { k: 'tmpl', parts, range: t.range, heredoc: t.type === 'heredoc' };
  }

  private forHead(): { key?: string; val: string; coll: Expr } {
    this.take(); // for
    const a = this.take();
    if (a.type !== 'ident') throw new HclError('Invalid for expression', 'For expression requires variable name after "for".', a.range);
    let key: string | undefined;
    let val = a.v;
    if (this.isOp(',')) {
      this.take();
      const b = this.take();
      if (b.type !== 'ident') throw new HclError('Invalid for expression', 'For expression requires value variable name after comma.', b.range);
      key = a.v;
      val = b.v;
    }
    const inTok = this.take();
    if (!(inTok.type === 'ident' && inTok.v === 'in')) throw new HclError('Invalid for expression', 'For expression requires the "in" keyword after its name declarations.', inTok.range);
    const coll = this.expr();
    this.expectOp(':', 'Invalid for expression', 'For expression requires a colon after the collection expression.');
    return key !== undefined ? { key, val, coll } : { val, coll };
  }

  private tupleOrFor(open: Tok): Expr {
    this.nlSkip++;
    if (this.peek().type === 'ident' && this.peek().v === 'for') {
      const h = this.forHead();
      const valExpr = this.expr();
      let cond: Expr | undefined;
      if (this.peek().type === 'ident' && this.peek().v === 'if') {
        this.take();
        cond = this.expr();
      }
      const close = this.expectOp(']', 'Invalid for expression', 'Extra characters after the end of the "for" expression.');
      this.nlSkip--;
      return { k: 'for', ...h, valExpr, ...(cond ? { cond } : {}), group: false, obj: false, range: span(open.range, close.range) };
    }
    const items: Expr[] = [];
    while (!this.isOp(']')) {
      items.push(this.expr());
      if (this.isOp(',')) this.take();
      else if (!this.isOp(']')) throw new HclError('Missing item separator', 'Expected a comma to mark the beginning of the next item.', this.peek().range);
    }
    const close = this.take();
    this.nlSkip--;
    return { k: 'tuple', items, range: span(open.range, close.range) };
  }

  private objectOrFor(open: Tok): Expr {
    // Newlines separate items in an object constructor; skip them between items only.
    const save = this.nlSkip;
    this.nlSkip = 0;
    this.skipNl();
    if (this.raw().type === 'ident' && this.raw().v === 'for') {
      this.nlSkip = 1;
      const h = this.forHead();
      const keyExpr = this.expr();
      this.expectOp('=>', 'Invalid for expression', 'For expression requires the "=>" operator after its key expression.');
      const valExpr = this.expr();
      let group = false;
      if (this.isOp('...')) {
        this.take();
        group = true;
      }
      let cond: Expr | undefined;
      if (this.peek().type === 'ident' && this.peek().v === 'if') {
        this.take();
        cond = this.expr();
      }
      const close = this.expectOp('}', 'Invalid for expression', 'Extra characters after the end of the "for" expression.');
      this.nlSkip = save;
      return { k: 'for', ...h, keyExpr, valExpr, ...(cond ? { cond } : {}), group, obj: true, range: span(open.range, close.range) };
    }
    const items: { key: Expr; ident: boolean; value: Expr }[] = [];
    for (;;) {
      this.skipNl();
      const t = this.raw();
      if (t.type === 'op' && t.v === '}') break;
      if (t.type === 'eof') throw new HclError('Missing close brace', 'Expected a closing brace to end the object constructor.', t.range);
      let key: Expr;
      let ident = false;
      if (t.type === 'ident' && this.raw(this.p + 1).type === 'op' && ['=', ':'].includes(this.raw(this.p + 1).v)) {
        this.p++;
        key = { k: 'lit', v: t.v, range: t.range };
        ident = true;
      } else {
        this.nlSkip = 1;
        key = this.binary(0);
        this.nlSkip = 0;
      }
      const eq = this.raw();
      if (!(eq.type === 'op' && (eq.v === '=' || eq.v === ':'))) {
        throw new HclError('Missing key/value separator', 'Expected an equals sign ("=") to mark the beginning of the attribute value.', eq.range);
      }
      this.p++;
      this.nlSkip = 1;
      const value = this.expr();
      this.nlSkip = 0;
      items.push({ key, ident, value });
      const sep = this.raw();
      if (sep.type === 'op' && sep.v === ',') this.p++;
      else if (sep.type === 'nl') this.skipNl();
      else if (!(sep.type === 'op' && sep.v === '}')) {
        throw new HclError('Missing attribute separator', 'Expected a newline or comma to mark the beginning of the next attribute.', sep.range);
      }
    }
    const close = this.raw();
    this.p++;
    this.nlSkip = save;
    return { k: 'object', items, range: span(open.range, close.range) };
  }
}

/** Parse one .tf / .tfvars file. Throws HclError on a syntax error. */
export function parseFile(src: string, file: string): Body {
  const toks = lex(src, file);
  return new Parser(toks, file).body('eof');
}

/** Parse a single expression (for -var values and `console`). */
export function parseExpr(src: string, file = '<value for var>'): Expr {
  const toks = lex(src, file);
  const p = new Parser(toks, file);
  const e = p.expr();
  while (p.peek().type === 'nl') p.take();
  if (p.peek().type !== 'eof') throw new HclError('Extra characters after expression', 'An expression was successfully parsed, but extra characters were found after it.', p.peek().range);
  return e;
}

/** A traversal like `random_pet.stall[0].id` as root name + steps (null when the expression is not one). */
export function traversalOf(e: Expr): { root: string; steps: Step[] } | null {
  if (e.k === 'var') return { root: e.name, steps: [] };
  if (e.k === 'get' && e.obj.k === 'var') return { root: e.obj.name, steps: e.steps };
  return null;
}

/** Every variable reference inside an expression (for dependency graphs). */
export function references(e: Expr | undefined, bound: Set<string> = new Set()): { root: string; steps: Step[]; range: Range }[] {
  if (!e) return [];
  const out: { root: string; steps: Step[]; range: Range }[] = [];
  const walk = (x: Expr, b: Set<string>) => {
    switch (x.k) {
      case 'var':
        if (!b.has(x.name)) out.push({ root: x.name, steps: [], range: x.range });
        return;
      case 'get':
        if (x.obj.k === 'var' && !b.has(x.obj.name)) out.push({ root: x.obj.name, steps: x.steps, range: x.range });
        else walk(x.obj, b);
        for (const s of x.steps) if (s.t === 'index') walk(s.key, b);
        return;
      case 'tmpl':
        for (const p of x.parts) if (typeof p !== 'string') walk(p, b);
        return;
      case 'tuple':
        x.items.forEach((i) => walk(i, b));
        return;
      case 'object':
        x.items.forEach((i) => {
          if (!i.ident) walk(i.key, b);
          walk(i.value, b);
        });
        return;
      case 'call':
        x.args.forEach((a) => walk(a, b));
        return;
      case 'unary':
        walk(x.e, b);
        return;
      case 'paren':
        walk(x.e, b);
        return;
      case 'binary':
        walk(x.l, b);
        walk(x.r, b);
        return;
      case 'cond':
        walk(x.c, b);
        walk(x.t, b);
        walk(x.f, b);
        return;
      case 'for': {
        walk(x.coll, b);
        const nb = new Set(b);
        if (x.key) nb.add(x.key);
        nb.add(x.val);
        if (x.keyExpr) walk(x.keyExpr, nb);
        walk(x.valExpr, nb);
        if (x.cond) walk(x.cond, nb);
        return;
      }
      default:
        return;
    }
  };
  walk(e, bound);
  return out;
}
