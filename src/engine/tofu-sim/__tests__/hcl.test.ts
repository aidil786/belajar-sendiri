import { describe, expect, it } from 'vitest';
import { attrOf, blocksOf, HclError, parseExpr, parseFile, references } from '../hcl';
import { evalExpr, type Scope } from '../eval';
import { DiagError } from '../diag';
import { str, num, tuple, object, unknown, T_STRING, type Val } from '../values';

const scope = (vars: Record<string, Val> = {}): Scope => ({
  fn: { readFile: (p) => (p === 'menu.txt' ? 'nasi\n' : null) },
  ref(root, steps, range) {
    const name = steps[0]?.t === 'attr' ? steps[0].name : '';
    const key = `${root}.${name}`;
    if (key in vars) return { val: vars[key]!, used: 1 };
    throw new DiagError([{ severity: 'error', summary: 'nope', detail: key, subject: range }]);
  },
});
const ev = (src: string, vars: Record<string, Val> = {}) => evalExpr(parseExpr(src), scope(vars));

describe('HCL parser', () => {
  it('reads blocks, labels and attributes with ranges', () => {
    const body = parseFile('resource "random_pet" "stall" {\n  length = 2\n}\n\n# a comment\nlocals {\n  a = "x" // trailing\n}\n', 'main.tf');
    const [r, l] = blocksOf(body);
    expect(r!.type).toBe('resource');
    expect(r!.labels).toEqual(['random_pet', 'stall']);
    expect(attrOf(r!.body, 'length')!.nameRange.start).toMatchObject({ line: 2, col: 3 });
    expect(l!.type).toBe('locals');
    expect(r!.defRange.start.line).toBe(1);
  });

  it('reads one-line blocks', () => {
    const body = parseFile('resource "terraform_data" "x" {}\nvariable "y" { default = 1 }\n', 'a.tf');
    expect(blocksOf(body).map((b) => b.type)).toEqual(['resource', 'variable']);
  });

  it('newline-separated object items and nested brackets', () => {
    const v = ev('{\n  nasi = 5\n  mee  = [1,\n 2]\n}');
    expect(v.v).toMatchObject({ nasi: { v: 5 }, mee: { v: [{ v: 1 }, { v: 2 }] } });
  });

  it('heredocs keep content; <<- strips the common indent', () => {
    expect(ev('<<EOT\nhello\n  world\nEOT\n').v).toBe('hello\n  world\n');
    expect(ev('<<-EOT\n    one\n      two\n    EOT\n').v).toBe('one\n  two\n');
  });

  it('templates interpolate, and a lone interpolation keeps its type', () => {
    expect(ev('"Welcome to ${var.shop}!"', { 'var.shop': str('Kedai') }).v).toBe('Welcome to Kedai!');
    expect(ev('"${var.n}"', { 'var.n': num(3) })).toEqual(num(3));
    expect(ev('"price $${x}"').v).toBe('price ${x}');
    expect(ev('"a\\nb\\"c"').v).toBe('a\nb"c');
  });

  it('finds references (and skips for-expression names)', () => {
    const refs = references(parseExpr('[for s in var.stalls : upper(s)] == local.x ? random_pet.p.id : data.local_file.f.content'));
    expect(refs.map((r) => r.root)).toEqual(['var', 'local', 'random_pet', 'data']);
  });

  it('reports an unclosed block like OpenTofu', () => {
    try {
      parseFile('resource "random_pet" "stall" {\n  length = 2\n', 'main.tf');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HclError);
      expect((e as HclError).summary).toBe('Unclosed configuration block');
      expect((e as HclError).range.start.line).toBe(1);
    }
  });

  it('reports a missing value as an invalid expression', () => {
    expect(() => parseFile('resource "random_pet" "x" {\n  length = \n}\n', 'main.tf')).toThrowError(HclError);
  });
});

describe('expressions', () => {
  it('arithmetic, comparison, logic and conditionals', () => {
    expect(ev('2 * 3 + 1').v).toBe(7);
    expect(ev('10 / 4').v).toBe(2.5);
    expect(ev('var.t > 0 && var.t <= 10', { 'var.t': num(20) }).v).toBe(false);
    expect(ev('true ? "OPEN" : "CLOSED"').v).toBe('OPEN');
    expect(ev('!false').v).toBe(true);
    expect(ev('"1" == 1').v).toBe(false);
  });

  it('for expressions make tuples and objects; if filters', () => {
    const m = object({ nasi: num(5), mee: num(4) });
    expect(ev('[for k, v in var.m : k if v > 4]', { 'var.m': m }).v).toEqual([str('nasi')]);
    const o = ev('{ for k, v in var.m : upper(k) => v * 2 }', { 'var.m': m });
    expect(o.ty.k).toBe('object');
    expect((o.v as Record<string, Val>).NASI!.v).toBe(10);
  });

  it('splat over a tuple of objects', () => {
    const pets = tuple([object({ id: str('a') }), object({ id: str('b') })]);
    expect(ev('var.p[*].id', { 'var.p': pets }).v).toEqual([str('a'), str('b')]);
  });

  it('functions: format, join, upper, length, lookup, merge, concat, coalesce, toset, tomap', () => {
    expect(ev('format("%s has %d stalls", "Kedai", 3)').v).toBe('Kedai has 3 stalls');
    expect(ev('join(", ", ["a", "b"])').v).toBe('a, b');
    expect(ev('upper("teh")').v).toBe('TEH');
    expect(ev('lower("TEH")').v).toBe('teh');
    expect(ev('length([1, 2, 3])').v).toBe(3);
    expect(ev('lookup({ a = 1 }, "b", 0)').v).toBe(0);
    expect(ev('merge({ a = 1 }, { b = 2 })').ty.k).toBe('object');
    expect((ev('concat(["a"], ["b"])').v as Val[]).length).toBe(2);
    expect(ev('coalesce("", "kopi")').v).toBe('kopi');
    const s = ev('toset(["mee", "nasi", "mee"])');
    expect(s.ty).toEqual({ k: 'set', e: T_STRING });
    expect((s.v as Val[]).map((x) => x.v)).toEqual(['mee', 'nasi']);
    expect(ev('tomap({ a = "x" })').ty).toEqual({ k: 'map', e: T_STRING });
    expect(ev('file("menu.txt")').v).toBe('nasi\n');
  });

  it('can and try catch errors', () => {
    expect(ev('can(var.nope)').v).toBe(false);
    expect(ev('try(var.nope, "fallback")').v).toBe('fallback');
  });

  it('unknown values stay unknown; sensitive marks spread', () => {
    expect(ev('"x-${var.id}"', { 'var.id': unknown(T_STRING) }).v).toEqual({ unknown: true });
    expect(ev('upper(var.pin)', { 'var.pin': { ...str('abc'), s: true } }).s).toBe(true);
  });

  it('a misspelt function suggests the right one', () => {
    try {
      ev('upperr("a")');
      expect.unreachable();
    } catch (e) {
      expect((e as DiagError).diags[0]!.detail).toBe('There is no function named "upperr". Did you mean "upper"?');
    }
  });
});
