import { describe, expect, it } from 'vitest';
import { functionsIn, metricsIn, typeOf, type Binary, type Expr } from '../ast';
import { goRegexError, parseExpr } from '../parser';
import { PromQLError } from '../types';

function errorOf(q: string): PromQLError {
  try {
    parseExpr(q);
  } catch (e) {
    return e as PromQLError;
  }
  throw new Error(`no error for ${q}`);
}

/** A compact picture of the tree, to check precedence. */
function show(e: Expr): string {
  switch (e.type) {
    case 'number':
      return String(e.value);
    case 'vector':
      return e.name ?? '{…}';
    case 'binary':
      return `(${show(e.lhs)} ${e.op}${e.bool ? ' bool' : ''} ${show(e.rhs)})`;
    case 'unary':
      return `(${e.op}${show(e.expr)})`;
    case 'paren':
      return show(e.expr);
    case 'call':
      return `${e.func}(${e.args.map(show).join(', ')})`;
    case 'aggregate':
      return `${e.op}(${e.param ? `${show(e.param)}, ` : ''}${show(e.expr)})`;
    case 'matrix':
      return `${show(e.vector)}[${e.range}]`;
    case 'string':
      return JSON.stringify(e.value);
  }
}

describe('PromQL parser', () => {
  it('follows PromQL precedence: ^ is right-assoc, unary minus binds like *', () => {
    expect(show(parseExpr('1 + 2 * 3'))).toBe('(1 + (2 * 3))');
    expect(show(parseExpr('2 ^ 3 ^ 2'))).toBe('(2 ^ (3 ^ 2))');
    expect(show(parseExpr('-a ^ 2'))).toBe('(-(a ^ 2))');
    expect(show(parseExpr('-a * 2'))).toBe('((-a) * 2)');
    expect(show(parseExpr('a > 1 and b or c unless d'))).toBe('(((a > 1) and b) or (c unless d))');
    expect(show(parseExpr('a == bool 1'))).toBe('(a == bool 1)');
  });

  it('reads selectors, ranges, offset and @', () => {
    const e = parseExpr('rate(http_requests_total{code=~"5..", job!="x"}[5m] offset 1m @ 300)');
    expect(e.type).toBe('call');
    const m = (e as { args: Expr[] }).args[0]!;
    expect(m.type).toBe('matrix');
    if (m.type !== 'matrix') return;
    expect(m.range).toBe(300_000);
    expect(m.vector.offset).toBe(60_000);
    expect(m.vector.at).toBe(300_000);
    expect(m.vector.matchers).toEqual([
      { name: '__name__', op: '=', value: 'http_requests_total' },
      { name: 'code', op: '=~', value: '5..' },
      { name: 'job', op: '!=', value: 'x' },
    ]);
    expect((parseExpr('up @ end()') as { at?: unknown }).at).toBe('end');
  });

  it('accepts Prometheus 3 forms: plain seconds in ranges and offsets, durations as numbers', () => {
    const m = parseExpr('up[300]');
    expect(m.type === 'matrix' && m.range).toBe(300_000);
    expect(parseExpr('5m')).toMatchObject({ type: 'number', value: 300 });
    expect(parseExpr('{"up"}')).toMatchObject({ type: 'vector', name: 'up' });
  });

  it('reads aggregations with by/without before or after', () => {
    const a = parseExpr('sum by (job) (up)');
    const b = parseExpr('sum(up) by (job)');
    for (const e of [a, b]) expect(e).toMatchObject({ type: 'aggregate', op: 'sum', grouping: ['job'], without: false });
    expect(parseExpr('topk(3, up)')).toMatchObject({ type: 'aggregate', op: 'topk', param: { type: 'number', value: 3 } });
    expect(parseExpr('max without (cpu) (x)')).toMatchObject({ without: true, grouping: ['cpu'] });
  });

  it('reads vector matching modifiers', () => {
    const e = parseExpr('a / ignoring(code) group_left(team) b') as Binary;
    expect(e.matching).toEqual({ card: 'many-to-one', on: false, labels: ['code'], include: ['team'] });
    const f = parseExpr('a and on(job) b') as Binary;
    expect(f.matching).toEqual({ card: 'many-to-many', on: true, labels: ['job'], include: [] });
    // Vector matching on a scalar side is dropped.
    expect((parseExpr('a + 1') as Binary).matching).toBeNull();
  });

  it('types expressions and lists what they use', () => {
    expect(typeOf(parseExpr('rate(x[5m])'))).toBe('vector');
    expect(typeOf(parseExpr('x[5m]'))).toBe('matrix');
    expect(typeOf(parseExpr('1 + 2'))).toBe('scalar');
    expect(typeOf(parseExpr('scalar(x)'))).toBe('scalar');
    expect([...functionsIn(parseExpr('sum by (le) (rate(x[5m])) / scalar(y)'))].sort()).toEqual(['rate', 'scalar', 'sum']);
    expect([...metricsIn(parseExpr('a / on(x) b{c="d"}'))].sort()).toEqual(['a', 'b']);
  });

  it('refuses mistakes with the words Prometheus 3 uses (checked against promtool)', () => {
    expect(errorOf('rate(http_requests_total)').message).toBe('1:6: parse error: expected type range vector in call to function "rate", got instant vector');
    expect(errorOf('1 > 2').message).toBe('1:3: parse error: comparisons between scalars must use BOOL modifier');
    expect(errorOf('rat(x[5m])').message).toBe('1:1: parse error: unknown function with name "rat"');
    expect(errorOf('sum(rate(x[5m])').message).toBe('1:16: parse error: unclosed left parenthesis');
    expect(errorOf('rate(x[5m]))').message).toBe("1:13: parse error: unexpected right parenthesis ')'");
    expect(errorOf('x{job=shop}').message).toBe('1:7: parse error: unexpected identifier "shop" in label matching, expected string');
    expect(errorOf('x{code=500}').message).toBe("1:8: parse error: unexpected character inside braces: '5'");
    expect(errorOf('sum by job (x)').message).toBe('1:8: parse error: unexpected identifier "job" in grouping opts, expected "("');
    expect(errorOf('sum(rate(x[5m]) by (job)').message).toBe('1:17: parse error: unexpected <by> in aggregation');
    expect(errorOf('* x').message).toBe('1:1: parse error: unexpected <op:*>');
    expect(errorOf('x +').message).toBe('1:4: parse error: unexpected end of input');
    expect(errorOf('x[5x]').message).toBe('1:3: parse error: bad number or duration syntax: "5"');
    expect(errorOf('x[0s]').message).toBe('1:3: parse error: duration must be greater than 0');
    expect(errorOf('sum(x)[5m]').message).toBe('1:7: parse error: ranges only allowed for vector selectors');
    expect(errorOf('sum(x,)').message).toBe('1:6: parse error: trailing commas not allowed in function call args');
    expect(errorOf('{job=~".*"}').message).toBe('1:1: parse error: vector selector must contain at least one non-empty matcher');
    expect(errorOf('x{job=~"("}').message).toBe('1:3: parse error: error parsing regexp: missing closing ): `(`');
    expect(errorOf('').message).toBe('unknown position: parse error: no expression found in input');
  });

  it('keeps each error kind for the plain explanation', () => {
    expect(errorOf('rate(x)').key).toBe('wrongType');
    expect(errorOf('rate(x)').params).toMatchObject({ want: 'range vector', got: 'instant vector' });
    expect(errorOf('1 < 2').key).toBe('scalarCompare');
    expect(errorOf('foo(x)').key).toBe('unknownFunction');
    expect(errorOf('sum(x').key).toBe('unclosedParen');
  });

  it('says honestly what the practice engine does not run yet', () => {
    expect(errorOf('max_over_time(rate(x[5m])[1h:1m])').key).toBe('engineLimit');
    expect(errorOf('count_values("v", x)').key).toBe('engineLimit');
    expect(errorOf('hour()').message).toBe('hour() is real PromQL, but not in this practice engine yet');
  });

  it('explains regexes the way Go does', () => {
    expect(goRegexError('5..')).toBeNull();
    expect(goRegexError('(a')).toBe('missing closing ): `(a`');
    expect(goRegexError('a)')).toBe('unexpected ): `a)`');
    expect(goRegexError('[a')).toBe('missing closing ]: `[a`');
    expect(goRegexError('*a')).toBe('missing argument to repetition operator: `*`');
    expect(goRegexError('a**')).toBe('invalid nested repetition operator: `**`');
    expect(goRegexError('(?=a)')).toBe('invalid or unsupported Perl syntax: `(?=`');
  });
});
