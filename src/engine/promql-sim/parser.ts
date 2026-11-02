// PromQL parser: text → syntax tree, with Prometheus 3's type checks and error words.
// Parse errors read like Prometheus: `1:6: parse error: expected type range vector in call to
// function "rate", got instant vector`.
import {
  AGGREGATORS,
  AGGREGATORS_WITH_PARAM,
  COMPARISON_OPS,
  FUNCTIONS,
  SET_OPS,
  typeOf,
  type AggregateOp,
  type BinaryOp,
  type Card,
  type Expr,
  type Matcher,
  type MatchOp,
  type VectorMatching,
  type VectorSelector,
} from './ast';
import { parseDuration } from './format';
import { PromQLError, type ValueType } from './types';

type TokKind = 'ident' | 'number' | 'duration' | 'string' | 'op' | 'eof' | 'error';

interface Tok {
  kind: TokKind;
  text: string;
  pos: number;
  end: number;
  /** Parsed value for numbers, strings (unquoted) and durations (ms). */
  value?: number | string;
  /** For an error token: the lexer's complaint (thrown when the parser reaches it). */
  error?: PromQLError;
}

const KEYWORDS = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'bool', 'offset', 'and', 'or', 'unless', 'atan2']);
/** Tokens Prometheus calls operators (shown as <op:*> in errors). */
const OPERATOR_TOKENS = new Set(['+', '-', '*', '/', '%', '^', '==', '!=', '<', '>', '<=', '>=', '=~', '!~', '@']);
/** Real Prometheus 3 functions and aggregators this practice engine does not run (yet). */
const NOT_IN_ENGINE = new Set([
  'count_values', 'limitk', 'limit_ratio', 'stddev_over_time', 'stdvar_over_time', 'mad_over_time', 'first_over_time',
  'double_exponential_smoothing', 'holt_winters', 'day_of_month', 'day_of_week', 'day_of_year', 'days_in_month', 'hour',
  'minute', 'month', 'year', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'cos', 'cosh', 'sin', 'sinh', 'tan', 'tanh',
  'deg', 'rad', 'pi', 'histogram_avg', 'histogram_count', 'histogram_sum', 'histogram_fraction', 'histogram_stddev',
  'histogram_stdvar', 'info', 'sort_by_label', 'sort_by_label_desc', 'ts_of_max_over_time', 'ts_of_min_over_time', 'ts_of_last_over_time',
]);

function docType(t: ValueType): string {
  return t === 'vector' ? 'instant vector' : t === 'matrix' ? 'range vector' : t;
}

/** "line:col" of an offset, like Prometheus (1-based column). */
function where(input: string, pos: number): string {
  let line = 1;
  let last = -1;
  for (let i = 0; i < pos && i < input.length; i++) {
    if (input[i] === '\n') {
      line++;
      last = i;
    }
  }
  return `${line}:${pos - last}`;
}

class Parser {
  private toks: Tok[] = [];
  private i = 0;
  constructor(private readonly input: string) {}

  fail(pos: number, msg: string, key = 'syntax', params: Record<string, string | number> = {}): never {
    throw new PromQLError(`${where(this.input, pos)}: parse error: ${msg}`, key, params, pos);
  }

  // ---- Lexer (after Prometheus's promql/parser/lex.go: same tokens, same error words) -----
  lex(): void {
    const out: Tok[] = [];
    try {
      this.lexInto(out);
    } catch (e) {
      if (!(e instanceof PromQLError)) throw e;
      // Like Prometheus's lazy lexer: the parser meets the problem only when it gets there.
      out.push({ kind: 'error', text: '', pos: e.pos ?? this.input.length, end: this.input.length, error: e });
    }
    this.toks = out;
  }

  lexInto(out: Tok[]): void {
    const s = this.input;
    let i = 0;
    let parenDepth = 0;
    let braceOpen = false;
    let bracketOpen = false;
    const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
    const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
    while (i < s.length) {
      const c = s[i]!;
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === '#') {
        while (i < s.length && s[i] !== '\n') i++;
        continue;
      }
      const start = i;
      // Inside { } only label names, strings, matchers, commas and } may appear.
      if (braceOpen && !/[\p{L}_"'`,=!~}]/u.test(c)) this.fail(i, `unexpected character inside braces: '${c}'`, 'syntax');
      // Numbers and durations: lexNumberOrDuration.
      if (isDigit(c) || (c === '.' && isDigit(s[i + 1]))) {
        let j = i;
        let hex = false;
        if (c === '0' && /[xX]/.test(s[i + 1] ?? '')) {
          j += 2;
          hex = true;
          while (/[0-9a-fA-F_]/.test(s[j] ?? '')) j++;
        } else {
          while (isDigit(s[j]) || s[j] === '_') j++;
          if (s[j] === '.') {
            j++;
            while (isDigit(s[j]) || s[j] === '_') j++;
          }
          if (/[eE]/.test(s[j] ?? '') && /[-+0-9]/.test(s[j + 1] ?? '')) {
            j++;
            if (/[-+]/.test(s[j]!)) j++;
            while (isDigit(s[j])) j++;
          }
        }
        if (!isAlnum(s[j])) {
          const text = s.slice(i, j);
          out.push({ kind: 'number', text, pos: start, end: j, value: hex ? Number(text.replace(/_/g, '')) : Number(text.replace(/_/g, '')) });
          i = j;
          continue;
        }
        // acceptRemainingDuration: digits then a unit, maybe more digit+unit pairs.
        let k = i;
        while (isDigit(s[k])) k++;
        const bad = (end: number): never => this.fail(start, `bad number or duration syntax: ${JSON.stringify(s.slice(i, end))}`, 'badNumber', { text: s.slice(i, end) });
        if (!/[smhdwy]/.test(s[k] ?? '')) bad(k);
        k++;
        if (s[k] === 's') k++;
        while (isDigit(s[k])) {
          while (isDigit(s[k])) k++;
          if (!/[smhdw]/.test(s[k] ?? '')) bad(k);
          k++;
          if (s[k] === 's') k++;
        }
        if (isAlnum(s[k])) bad(k + 1);
        const text = s.slice(i, k);
        const d = parseDuration(text);
        if (d === null) this.fail(start, `not a valid duration string: ${JSON.stringify(text)}`, 'badDuration', { text });
        out.push({ kind: 'duration', text, pos: start, end: k, value: d });
        i = k;
        continue;
      }
      if (c === ':' && bracketOpen) {
        out.push({ kind: 'op', text: ':', pos: start, end: i + 1 });
        i++;
        continue;
      }
      if (/[\p{L}_:]/u.test(c)) {
        let j = i;
        while (/[\p{L}\p{N}_:]/u.test(s[j] ?? '')) j++;
        const text = s.slice(i, j);
        const low = text.toLowerCase();
        if (low === 'inf' || low === 'nan') out.push({ kind: 'number', text, pos: start, end: j, value: low === 'inf' ? Infinity : NaN });
        else out.push({ kind: 'ident', text, pos: start, end: j });
        i = j;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        let val = '';
        for (;;) {
          if (j >= s.length || (s[j] === '\n' && c !== '`')) this.fail(start, c === '`' ? 'unterminated raw string' : 'unterminated quoted string', 'unterminated');
          const d = s[j]!;
          if (d === c) break;
          if (d === '\\' && c !== '`') {
            const e = s[j + 1] ?? '';
            const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v' };
            if (e in map) {
              val += map[e];
              j += 2;
              continue;
            }
            if (e === 'x' && /^[0-9a-fA-F]{2}$/.test(s.slice(j + 2, j + 4))) {
              val += String.fromCharCode(parseInt(s.slice(j + 2, j + 4), 16));
              j += 4;
              continue;
            }
            if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(j + 2, j + 6))) {
              val += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16));
              j += 6;
              continue;
            }
            this.fail(j, 'unknown escape sequence', 'syntax');
          }
          val += d;
          j++;
        }
        out.push({ kind: 'string', text: s.slice(i, j + 1), pos: start, end: j + 1, value: val });
        i = j + 1;
        continue;
      }
      const two = s.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '=~', '!~'].includes(two) && !(braceOpen && two === '==')) {
        out.push({ kind: 'op', text: two, pos: start, end: i + 2 });
        i += 2;
        continue;
      }
      if (c === '!') {
        const next = s[i + 1];
        const shown = next === undefined ? '�' : next;
        this.fail(i, `unexpected character after '!'${braceOpen ? ' inside braces' : ''}: '${shown}'`, 'syntax');
      }
      if ('+-*/%^<>=(){}[],@'.includes(c) || c === ':') {
        if (c === '(') parenDepth++;
        if (c === ')') {
          if (parenDepth === 0) this.fail(i + 1, "unexpected right parenthesis ')'", 'unexpectedParen');
          parenDepth--;
        }
        if (c === '}' && !braceOpen) this.fail(i, "unexpected character: '}'", 'syntax');
        if (c === ']' && !bracketOpen) this.fail(i, "unexpected right bracket ']'", 'syntax');
        if (c === '{') braceOpen = true;
        if (c === '}') braceOpen = false;
        if (c === '[') bracketOpen = true;
        if (c === ']') bracketOpen = false;
        out.push({ kind: 'op', text: c, pos: start, end: i + 1 });
        i++;
        continue;
      }
      this.fail(i, `unexpected character${braceOpen ? ' inside braces' : ''}: '${c}'`, 'syntax');
    }
    if (braceOpen) this.fail(s.length, 'unexpected end of input inside braces', 'unclosedBrace');
    if (parenDepth > 0) this.fail(s.length, 'unclosed left parenthesis', 'unclosedParen');
    if (bracketOpen) this.fail(s.length, 'unclosed left bracket', 'unclosedBracket');
    out.push({ kind: 'eof', text: '', pos: s.length, end: s.length });
  }


  // ---- Token helpers -----------------------------------------------------------------------
  peek(o = 0): Tok {
    const t = this.toks[Math.min(this.i + o, this.toks.length - 1)]!;
    if (t.kind === 'error') throw t.error!;
    return t;
  }
  next(): Tok {
    const t = this.peek();
    this.i = Math.min(this.i + 1, this.toks.length - 1);
    return t;
  }
  isOp(text: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === 'op' && t.text === text;
  }
  isKw(kw: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === 'ident' && t.text.toLowerCase() === kw;
  }
  /** How Prometheus names a token in "unexpected …" errors (Item.desc). */
  describe(t: Tok): string {
    const short = (x: string) => (x.length > 10 ? `${JSON.stringify(x.slice(0, 10))}...` : JSON.stringify(x));
    switch (t.kind) {
      case 'eof':
      case 'error':
        return 'end of input';
      case 'ident': {
        const low = t.text.toLowerCase();
        if (['and', 'or', 'unless', 'atan2'].includes(low)) return `<op:${low}>`;
        if (KEYWORDS.has(low)) return `<${low}>`;
        if (AGGREGATORS.has(low as AggregateOp)) return `<aggr:${low}>`;
        return `identifier ${JSON.stringify(t.text)}`;
      }
      case 'number':
        return `number ${short(t.text)}`;
      case 'duration':
        return `duration ${short(t.text)}`;
      case 'string':
        return `string ${short(t.text)}`;
      case 'op':
        return OPERATOR_TOKENS.has(t.text) ? `<op:${t.text}>` : JSON.stringify(t.text);
    }
  }
  unexpected(t: Tok, ctx?: string): never {
    if (t.kind === 'eof') this.fail(t.pos, 'unexpected end of input' + (ctx ? ` ${ctx}` : ''), 'unexpectedEnd');
    this.fail(t.pos, `unexpected ${this.describe(t)}${ctx ? ` ${ctx}` : ''}`, 'unexpected', { what: t.text });
  }
  expectOp(text: string, ctx?: string): Tok {
    const t = this.peek();
    if (t.kind === 'op' && t.text === text) return this.next();
    this.unexpected(t, ctx);
  }

  // ---- Grammar -----------------------------------------------------------------------------
  parse(): Expr {
    this.lex();
    if (this.peek().kind === 'eof') throw new PromQLError('unknown position: parse error: no expression found in input', 'empty');
    const e = this.expr(0);
    const t = this.peek();
    if (t.kind !== 'eof') this.unexpected(t);
    this.check(e);
    return e;
  }

  /** Binary operator at the current token, with its precedence (higher binds tighter). */
  binop(): { op: BinaryOp; prec: number; right: boolean } | null {
    const t = this.peek();
    if (t.kind === 'op') {
      switch (t.text) {
        case '^':
          return { op: '^', prec: 6, right: true };
        case '*':
        case '/':
        case '%':
          return { op: t.text, prec: 5, right: false };
        case '+':
        case '-':
          return { op: t.text, prec: 4, right: false };
        case '==':
        case '!=':
        case '<':
        case '>':
        case '<=':
        case '>=':
          return { op: t.text, prec: 3, right: false };
        default:
          return null;
      }
    }
    if (t.kind === 'ident') {
      const k = t.text.toLowerCase();
      if (k === 'atan2') return { op: 'atan2', prec: 5, right: false };
      if (k === 'and' || k === 'unless') return { op: k, prec: 2, right: false };
      if (k === 'or') return { op: 'or', prec: 1, right: false };
    }
    return null;
  }

  expr(minPrec: number): Expr {
    let lhs = this.unary();
    for (;;) {
      const b = this.binop();
      if (!b || b.prec < minPrec) return lhs;
      const opTok = this.next();
      let bool = false;
      if (this.isKw('bool')) {
        this.next();
        bool = true;
      }
      const matching = this.matching(b.op);
      const rhs = this.expr(b.right ? b.prec : b.prec + 1);
      lhs = { type: 'binary', op: b.op, lhs, rhs, bool, matching, opPos: opTok.pos, pos: lhs.pos, end: rhs.end };
    }
  }

  matching(op: BinaryOp): VectorMatching {
    const m: VectorMatching = { card: SET_OPS.has(op) ? 'many-to-many' : 'one-to-one', on: false, labels: [], include: [] };
    if (this.isKw('on') || this.isKw('ignoring')) {
      m.on = this.next().text.toLowerCase() === 'on';
      m.labels = this.labelList();
      if (this.isKw('group_left') || this.isKw('group_right')) {
        const left = this.next().text.toLowerCase() === 'group_left';
        m.card = left ? 'many-to-one' : 'one-to-many';
        if (this.isOp('(')) m.include = this.labelList();
      }
    }
    return m;
  }

  labelList(): string[] {
    this.expectOp('(', 'in grouping opts, expected "("');
    const out: string[] = [];
    while (!this.isOp(')')) {
      const t = this.next();
      if (t.kind === 'ident' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t.text)) out.push(t.text);
      else if (t.kind === 'string') out.push(String(t.value));
      else this.unexpected(t, 'in grouping opts, expected label');
      if (this.isOp(',')) this.next();
      else if (!this.isOp(')')) this.unexpected(this.peek(), 'in grouping opts, expected "," or ")"');
    }
    this.next();
    return out;
  }

  unary(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.next();
      // Unary minus binds like * : only ^ goes inside it.
      const inner = this.expr(6);
      if (inner.type === 'number') return { ...inner, value: t.text === '-' ? -inner.value : inner.value, pos: t.pos };
      return { type: 'unary', op: t.text, expr: inner, pos: t.pos, end: inner.end };
    }
    return this.postfix(this.primary());
  }

  /** A duration or a plain number of seconds (Prometheus 3 accepts both), in ms. */
  durationValue(t: Tok): number {
    return t.kind === 'duration' ? (t.value as number) : Math.round((t.value as number) * 1000);
  }

  postfix(e: Expr): Expr {
    for (;;) {
      if (this.isOp('[')) {
        const open = this.next();
        const d = this.peek();
        if (d.kind !== 'duration' && d.kind !== 'number') this.unexpected(d, 'in subquery or range selector, expected duration');
        this.next();
        if (this.isOp(':')) throw new PromQLError('subqueries like [30m:1m] are not in this practice engine yet', 'engineLimit', { what: 'subquery' }, open.pos);
        const close = this.expectOp(']', 'in subquery or range selector, expected "]"');
        if (e.type !== 'vector') this.fail(open.pos, 'ranges only allowed for vector selectors', 'rangeOnSelector');
        if (e.offset !== 0 || e.at !== undefined) this.fail(open.pos, 'no offset modifiers allowed before range', 'offsetBeforeRange');
        const range = this.durationValue(d);
        if (range <= 0) this.fail(d.pos, 'duration must be greater than 0', 'zeroRange');
        e = { type: 'matrix', vector: e, range, pos: e.pos, end: close.end };
        continue;
      }
      if (this.isKw('offset')) {
        const kw = this.next();
        let sign = 1;
        if (this.isOp('-')) {
          this.next();
          sign = -1;
        } else if (this.isOp('+')) this.next();
        const d = this.peek();
        if (d.kind !== 'duration' && d.kind !== 'number') this.unexpected(d, 'in offset, expected number, duration, step(), or range()');
        this.next();
        const sel = e.type === 'matrix' ? e.vector : e.type === 'vector' ? e : null;
        if (!sel) this.fail(kw.pos, 'offset modifier must be preceded by an instant vector selector or range vector selector or a subquery', 'offsetPlace');
        if (sel.offset !== 0) this.fail(e.pos, 'offset may not be set multiple times', 'syntax');
        sel.offset = sign * this.durationValue(d);
        e.end = d.end;
        continue;
      }
      if (this.isOp('@')) {
        const at = this.next();
        const sel = e.type === 'matrix' ? e.vector : e.type === 'vector' ? e : null;
        if (!sel) this.fail(at.pos, '@ modifier must be preceded by an instant vector selector or range vector selector or a subquery', 'atPlace');
        if (sel.at !== undefined) this.fail(e.pos, '@ <timestamp> may not be set multiple times', 'syntax');
        const t = this.peek();
        if (t.kind === 'ident' && (t.text === 'start' || t.text === 'end') && this.isOp('(', 1) && this.isOp(')', 2)) {
          this.next();
          this.next();
          const close = this.next();
          sel.at = t.text;
          e.end = close.end;
          continue;
        }
        let sign = 1;
        if (this.isOp('-')) {
          this.next();
          sign = -1;
        } else if (this.isOp('+')) this.next();
        const n = this.peek();
        if (n.kind !== 'number') this.unexpected(n, 'in @, expected timestamp');
        this.next();
        sel.at = Math.round(sign * (n.value as number) * 1000);
        e.end = n.end;
        continue;
      }
      return e;
    }
  }

  primary(): Expr {
    const t = this.peek();
    if (t.kind === 'number') {
      this.next();
      return { type: 'number', value: t.value as number, pos: t.pos, end: t.end };
    }
    if (t.kind === 'string') {
      this.next();
      return { type: 'string', value: t.value as string, pos: t.pos, end: t.end };
    }
    if (t.kind === 'duration') {
      // Prometheus 3 reads a duration as a number of seconds (5m = 300).
      this.next();
      return { type: 'number', value: (t.value as number) / 1000, pos: t.pos, end: t.end };
    }
    if (this.isOp('(')) {
      const open = this.next();
      const inner = this.expr(0);
      const close = this.expectOp(')', 'in paren expression');
      return { type: 'paren', expr: inner, pos: open.pos, end: close.end };
    }
    if (this.isOp('{')) return this.selector(undefined, t.pos);
    if (t.kind === 'ident') {
      const low = t.text.toLowerCase();
      if (AGGREGATORS.has(low as AggregateOp) && (this.isOp('(', 1) || this.isKw('by', 1) || this.isKw('without', 1))) return this.aggregate();
      if (NOT_IN_ENGINE.has(low) && this.isOp('(', 1)) throw new PromQLError(`${low}() is real PromQL, but not in this practice engine yet`, 'engineLimit', { what: low }, t.pos);
      if (KEYWORDS.has(low)) this.unexpected(t);
      if (this.isOp('(', 1)) return this.call();
      this.next();
      return this.selector(t.text, t.pos);
    }
    this.unexpected(t);
  }

  selector(name: string | undefined, pos: number): VectorSelector {
    const matchers: Matcher[] = [];
    let end = pos + (name?.length ?? 0);
    if (this.isOp('{')) {
      this.next();
      while (!this.isOp('}')) {
        const l = this.next();
        let label: string;
        if (l.kind === 'ident' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(l.text)) label = l.text;
        else if (l.kind === 'string') label = String(l.value);
        else this.unexpected(l, 'in label matching, expected identifier or "}"');
        const opTok = this.next();
        if (opTok.kind !== 'op' || !['=', '!=', '=~', '!~'].includes(opTok.text)) {
          // {"metric.name"}: a bare quoted name is the metric name (Prometheus 3).
          if (l.kind === 'string' && (opTok.text === ',' || opTok.text === '}')) {
            if (name !== undefined) this.fail(l.pos, 'metric name must not be set twice: ' + JSON.stringify(name) + ' or ' + JSON.stringify(label), 'syntax');
            name = label;
            if (opTok.text === '}') {
              this.i--;
              break;
            }
            continue;
          }
          this.unexpected(opTok, 'in label matching, expected label matching operator');
        }
        const v = this.next();
        if (v.kind !== 'string') this.unexpected(v, 'in label matching, expected string');
        const op = opTok.text as MatchOp;
        const value = String(v.value);
        if (op === '=~' || op === '!~') {
          const problem = goRegexError(value);
          if (problem) this.fail(l.pos, `error parsing regexp: ${problem}`, 'badRegex', { re: value });
        }
        matchers.push({ name: label, op, value });
        if (this.isOp(',')) this.next();
        else if (!this.isOp('}')) this.unexpected(this.peek(), 'in label matching, expected "," or "}"');
      }
      end = this.next().end;
    }
    if (name !== undefined) {
      if (matchers.some((m) => m.name === '__name__')) this.fail(pos, `metric name must not be set twice: ${JSON.stringify(name)} or ${JSON.stringify(matchers.find((m) => m.name === '__name__')!.value)}`, 'syntax');
      matchers.unshift({ name: '__name__', op: '=', value: name });
    } else if (!matchers.some((m) => !matchesEmpty(m))) {
      this.fail(pos, 'vector selector must contain at least one non-empty matcher', 'emptySelector');
    }
    return { type: 'vector', name, matchers, offset: 0, pos, end };
  }

  args(ctx?: string): Expr[] {
    this.expectOp('(');
    const out: Expr[] = [];
    while (!this.isOp(')')) {
      out.push(this.expr(0));
      if (this.isOp(',')) {
        const comma = this.next();
        if (this.isOp(')')) this.fail(comma.pos, 'trailing commas not allowed in function call args', 'trailingComma');
      } else if (!this.isOp(')')) this.unexpected(this.peek(), ctx);
    }
    this.next();
    return out;
  }

  call(): Expr {
    const nameTok = this.next();
    if (!FUNCTIONS[nameTok.text]) {
      if (NOT_IN_ENGINE.has(nameTok.text)) throw new PromQLError(`${nameTok.text}() is real PromQL, but not in this practice engine yet`, 'engineLimit', { what: nameTok.text }, nameTok.pos);
      this.fail(nameTok.pos, `unknown function with name ${JSON.stringify(nameTok.text)}`, 'unknownFunction', { name: nameTok.text });
    }
    const args = this.args();
    return { type: 'call', func: nameTok.text, args, pos: nameTok.pos, end: this.toks[this.i - 1]!.end };
  }

  aggregate(): Expr {
    const opTok = this.next();
    const op = opTok.text.toLowerCase() as AggregateOp;
    let grouping: string[] = [];
    let without = false;
    let modifier = false;
    const mod = () => {
      if (this.isKw('by') || this.isKw('without')) {
        without = this.next().text.toLowerCase() === 'without';
        grouping = this.labelList();
        modifier = true;
      }
    };
    mod();
    if (!this.isOp('(')) this.unexpected(this.peek(), 'in aggregation');
    const args = this.args('in aggregation');
    if (!modifier) mod();
    if (args.length === 0) this.fail(opTok.pos, 'no arguments for aggregate expression provided', 'aggNoArgs');
    const want = AGGREGATORS_WITH_PARAM.has(op) ? 2 : 1;
    const end = this.toks[this.i - 1]!.end;
    if (args.length !== want) this.fail(opTok.pos, `wrong number of arguments for aggregate expression provided, expected ${want}, got ${args.length}`, 'aggArgs', { want, got: args.length });
    return { type: 'aggregate', op, expr: args[want - 1]!, param: want === 2 ? args[0] : undefined, grouping, without, pos: opTok.pos, end };
  }

  // ---- Type checks (Prometheus checkAST) ---------------------------------------------------
  expectType(e: Expr, want: ValueType, ctx: string): void {
    const got = typeOf(e);
    if (got !== want) this.fail(e.pos, `expected type ${docType(want)} in ${ctx}, got ${docType(got)}`, 'wrongType', { want: docType(want), got: docType(got), ctx });
  }

  check(e: Expr): void {
    switch (e.type) {
      case 'paren':
      case 'unary':
        this.check(e.expr);
        if (e.type === 'unary') {
          const t = typeOf(e.expr);
          if (t !== 'scalar' && t !== 'vector') this.fail(e.pos, `unary expression only allowed on expressions of type scalar or instant vector, got ${JSON.stringify(docType(t))}`, 'unaryType');
        }
        return;
      case 'matrix':
        return;
      case 'call': {
        const f = FUNCTIONS[e.func]!;
        const n = f.args.length;
        if (!f.optional) {
          if (n !== e.args.length) this.fail(e.pos, `expected ${n} argument(s) in call to ${JSON.stringify(e.func)}, got ${e.args.length}`, 'argCount', { func: e.func, want: n, got: e.args.length });
        } else {
          const need = n - 1;
          if (need > e.args.length) this.fail(e.pos, `expected at least ${need} argument(s) in call to ${JSON.stringify(e.func)}, got ${e.args.length}`, 'argCount', { func: e.func, want: need, got: e.args.length });
          const max = need + f.optional;
          if (f.optional > 0 && max < e.args.length) this.fail(e.pos, `expected at most ${max} argument(s) in call to ${JSON.stringify(e.func)}, got ${e.args.length}`, 'argCount', { func: e.func, want: max, got: e.args.length });
        }
        e.args.forEach((a, i) => {
          this.check(a);
          const want = f.args[Math.min(i, n - 1)];
          if (want) this.expectType(a, want, `call to function ${JSON.stringify(e.func)}`);
        });
        return;
      }
      case 'aggregate':
        this.check(e.expr);
        this.expectType(e.expr, 'vector', 'aggregation expression');
        if (e.param) {
          this.check(e.param);
          this.expectType(e.param, 'scalar', 'aggregation parameter');
        }
        return;
      case 'binary': {
        this.check(e.lhs);
        this.check(e.rhs);
        const lt = typeOf(e.lhs);
        const rt = typeOf(e.rhs);
        if (e.bool && !COMPARISON_OPS.has(e.op)) this.fail(e.opPos, 'bool modifier can only be used on comparison operators', 'boolPlace');
        if (COMPARISON_OPS.has(e.op) && !e.bool && lt === 'scalar' && rt === 'scalar') this.fail(e.opPos, 'comparisons between scalars must use BOOL modifier', 'scalarCompare');
        const m = e.matching;
        if (m && m.on) for (const l of m.labels) if (m.include.includes(l)) this.fail(e.opPos, `label ${JSON.stringify(l)} must not occur in ON and GROUP clause at once`, 'onAndGroup', { label: l });
        if (lt !== 'scalar' && lt !== 'vector') this.fail(e.lhs.pos, 'binary expression must contain only scalar and instant vector types', 'binaryTypes');
        if (rt !== 'scalar' && rt !== 'vector') this.fail(e.rhs.pos, 'binary expression must contain only scalar and instant vector types', 'binaryTypes');
        if ((lt !== 'vector' || rt !== 'vector') && m) {
          if (m.labels.length > 0) this.fail(e.pos, 'vector matching only allowed between instant vectors', 'matchingScalar');
          e.matching = null;
        } else if (m && SET_OPS.has(e.op) && (m.card === 'one-to-many' || m.card === 'many-to-one')) {
          this.fail(e.pos, `no grouping allowed for ${JSON.stringify(e.op)} operation`, 'setGrouping');
        }
        if ((lt === 'scalar' || rt === 'scalar') && SET_OPS.has(e.op)) this.fail(e.pos, `set operator ${JSON.stringify(e.op)} not allowed in binary scalar expression`, 'setScalar', { op: e.op });
        return;
      }
      default:
        return;
    }
  }
}

function matchesEmpty(m: Matcher): boolean {
  switch (m.op) {
    case '=':
      return m.value === '';
    case '!=':
      return m.value !== '';
    case '=~':
      return new RegExp(`^(?:${goRegex(m.value)})$`, 's').test('');
    case '!~':
      return !new RegExp(`^(?:${goRegex(m.value)})$`, 's').test('');
  }
}

const tick = (s: string) => `\`${s}\``;

/**
 * Why Go's regexp (RE2) refuses a pattern, in its own words ("missing closing ): `(`"), or null.
 * Covers the mistakes learners make; anything else JavaScript refuses gets a general line.
 */
export function goRegexError(re: string): string | null {
  const depth: number[] = [];
  let atomBefore = false;
  for (let i = 0; i < re.length; i++) {
    const c = re[i]!;
    if (c === '\\') {
      const n = re[i + 1];
      if (n === undefined) return `trailing backslash at end of expression: ${tick('')}`;
      if (/[1-9]/.test(n)) return `invalid escape sequence: ${tick(`\\${n}`)}`;
      i++;
      atomBefore = true;
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      if (re[j] === '^') j++;
      if (re[j] === ']') j++;
      while (j < re.length && re[j] !== ']') j += re[j] === '\\' ? 2 : 1;
      if (j >= re.length) return `missing closing ]: ${tick(re.slice(i))}`;
      i = j;
      atomBefore = true;
      continue;
    }
    if (c === '(') {
      for (const look of ['(?<=', '(?<!', '(?=', '(?!']) if (re.startsWith(look, i)) return `invalid or unsupported Perl syntax: ${tick(look)}`;
      depth.push(i);
      atomBefore = false;
      continue;
    }
    if (c === ')') {
      if (!depth.length) return `unexpected ): ${tick(re)}`;
      depth.pop();
      atomBefore = true;
      continue;
    }
    if (c === '|') {
      atomBefore = false;
      continue;
    }
    if (c === '*' || c === '+' || c === '?') {
      if (!atomBefore) return `missing argument to repetition operator: ${tick(c)}`;
      const lazy = re[i + 1] === '?';
      const after = re[i + (lazy ? 2 : 1)];
      if (after === '*' || after === '+' || after === '?') return `invalid nested repetition operator: ${tick(re.slice(i, i + (lazy ? 3 : 2)))}`;
      if (lazy) i++;
      continue;
    }
    atomBefore = true;
  }
  if (depth.length) return `missing closing ): ${tick(re)}`;
  try {
    new RegExp(goRegex(re));
  } catch {
    return `invalid regular expression: ${tick(re)}`;
  }
  return null;
}

/** Go RE2 syntax → JavaScript (the parts that differ for the regexes learners write). */
export function goRegex(re: string): string {
  return re.replace(/\(\?P</g, '(?<');
}

/** Parse a PromQL expression (throws PromQLError). */
export function parseExpr(input: string): Expr {
  return new Parser(input).parse();
}

/** Group card names for display. */
export function cardOf(m: VectorMatching | null): Card | null {
  return m?.card ?? null;
}
