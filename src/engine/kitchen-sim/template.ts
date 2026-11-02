// A small Go text/template, enough for `--format`: {{.A.B}}, {{json .X}}, {{index .M "k"}},
// {{range .X}}...{{end}}, {{range $k, $v := .X}}...{{end}}, {{if .X}}...{{else}}...{{end}},
// {{println}}, {{upper}}, {{lower}}, {{join .List ", "}}, and the table prefix.

type Node =
  | { k: 'text'; v: string }
  | { k: 'expr'; v: string; at: number }
  | { k: 'range'; v: string; at: number; body: Node[]; vars: [string, string] | null }
  | { k: 'if'; v: string; at: number; body: Node[]; alt: Node[] };

export class TemplateError extends Error {}

function parse(src: string): Node[] {
  const tokens: { text?: string; action?: string; at: number }[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{{', i);
    if (open < 0) {
      tokens.push({ text: src.slice(i), at: i });
      break;
    }
    if (open > i) tokens.push({ text: src.slice(i, open), at: i });
    const close = src.indexOf('}}', open);
    if (close < 0) throw new TemplateError(`template parsing error: template: :1: unclosed action`);
    tokens.push({ action: src.slice(open + 2, close).trim().replace(/^-\s*|\s*-$/g, ''), at: open + 2 });
    i = close + 2;
  }
  let pos = 0;
  const block = (endWords: string[]): { nodes: Node[]; end: string } => {
    const nodes: Node[] = [];
    while (pos < tokens.length) {
      const t = tokens[pos++]!;
      if (t.text !== undefined) {
        nodes.push({ k: 'text', v: t.text });
        continue;
      }
      const a = t.action!;
      if (endWords.includes(a)) return { nodes, end: a };
      if (a.startsWith('range ')) {
        let expr = a.slice(6).trim();
        let vars: [string, string] | null = null;
        const m = /^\$(\w+)\s*,\s*\$(\w+)\s*:=\s*(.+)$/.exec(expr);
        if (m) {
          vars = [m[1]!, m[2]!];
          expr = m[3]!;
        }
        const b = block(['end']);
        nodes.push({ k: 'range', v: expr, at: t.at, body: b.nodes, vars });
      } else if (a.startsWith('if ')) {
        const b = block(['else', 'end']);
        let alt: Node[] = [];
        if (b.end === 'else') alt = block(['end']).nodes;
        nodes.push({ k: 'if', v: a.slice(3).trim(), at: t.at, body: b.nodes, alt });
      } else nodes.push({ k: 'expr', v: a, at: t.at });
    }
    return { nodes, end: '' };
  };
  return block([]).nodes;
}

type Scope = { dot: unknown; vars: Record<string, unknown> };

function field(base: unknown, path: string, at: number, fullExpr: string): unknown {
  let cur = base;
  let offset = 0;
  for (const part of path.split('.').filter(Boolean)) {
    const here = at + fullExpr.indexOf(`.${part}`, offset);
    offset = fullExpr.indexOf(`.${part}`, offset) + part.length + 1;
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      const obj = cur as Record<string, unknown>;
      if (!(part in obj)) {
        throw new TemplateError(`template parsing error: template: :1:${here}: executing "" at <${fullExpr.slice(0, offset)}>: map has no entry for key "${part}"`);
      }
      cur = obj[part];
    } else {
      throw new TemplateError(`template parsing error: template: :1:${here}: executing "" at <${fullExpr.slice(0, offset)}>: can't evaluate field ${part} in type interface {}`);
    }
  }
  return cur;
}

function goString(v: unknown): string {
  if (v === null || v === undefined) return '<no value>';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(goString).join(' ')}]`;
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `map[${entries.map(([k, x]) => `${k}:${goString(x)}`).join(' ')}]`;
}

function evalArg(arg: string, s: Scope, at: number): unknown {
  if (/^".*"$/.test(arg)) return arg.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  if (arg === '.') return s.dot;
  if (arg.startsWith('$')) {
    const [name, ...rest] = arg.slice(1).split('.');
    const v = s.vars[name!];
    return rest.length ? field(v, `.${rest.join('.')}`, at, arg) : v;
  }
  if (arg.startsWith('.')) return field(s.dot, arg, at, arg);
  if (/^-?\d+$/.test(arg)) return Number(arg);
  return arg;
}

function splitArgs(expr: string): string[] {
  return expr.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
}

function evalExpr(expr: string, s: Scope, at: number): unknown {
  const parts = splitArgs(expr);
  const fn = parts[0]!;
  const args = parts.slice(1);
  switch (fn) {
    case 'json':
      return JSON.stringify(evalArg(args[0] ?? '.', s, at) ?? null);
    case 'index': {
      const base = evalArg(args[0]!, s, at) as Record<string, unknown> | unknown[] | null;
      const key = evalArg(args[1]!, s, at) as string | number;
      if (Array.isArray(base)) return base[Number(key)];
      return base ? (base as Record<string, unknown>)[String(key)] : undefined;
    }
    case 'println':
      return `${args.map((a) => goString(evalArg(a, s, at))).join(' ')}\n`;
    case 'upper':
      return goString(evalArg(args[0]!, s, at)).toUpperCase();
    case 'lower':
      return goString(evalArg(args[0]!, s, at)).toLowerCase();
    case 'join': {
      const list = evalArg(args[0]!, s, at);
      return Array.isArray(list) ? list.map(goString).join(String(evalArg(args[1] ?? '""', s, at))) : '';
    }
    case 'len': {
      const v = evalArg(args[0]!, s, at);
      return Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : String(v ?? '').length;
    }
    default:
      return evalArg(fn, s, at);
  }
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

function run(nodes: Node[], s: Scope): string {
  let out = '';
  for (const n of nodes) {
    if (n.k === 'text') out += n.v;
    else if (n.k === 'expr') {
      const v = evalExpr(n.v, s, n.at);
      out += typeof v === 'string' ? v : goString(v);
    } else if (n.k === 'if') {
      out += run(truthy(evalExpr(n.v, s, n.at)) ? n.body : n.alt, s);
    } else {
      const v = evalExpr(n.v, s, n.at);
      if (Array.isArray(v)) {
        v.forEach((x, i) => (out += run(n.body, { dot: x, vars: n.vars ? { ...s.vars, [n.vars[0]]: i, [n.vars[1]]: x } : s.vars })));
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) {
          out += run(n.body, { dot: x, vars: n.vars ? { ...s.vars, [n.vars[0]]: k, [n.vars[1]]: x } : s.vars });
        }
      }
    }
  }
  return out;
}

/** Render a Go template over `data`. Throws TemplateError like Docker prints it. */
export function render(template: string, data: unknown): string {
  const src = template.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
  return run(parse(src), { dot: data, vars: {} });
}

/** `--format "table {{.Names}}\t{{.Status}}"`: a header row from the field names. */
export function headerFor(template: string, names: Record<string, string>): string {
  const src = template.replace(/^table\s*/, '').replace(/\\t/g, '\t');
  return src.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_, f: string) => names[f] ?? f.toUpperCase());
}
