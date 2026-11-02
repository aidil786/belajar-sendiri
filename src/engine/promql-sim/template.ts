// Alert templates: the part of Go's text/template (and Prometheus's template functions) that
// alert labels and annotations use: {{ $labels.instance }}, {{ $value }}, {{ .Labels.job }},
// pipes, printf, humanize, humanizePercentage, humanizeDuration, toUpper, toLower.
// Anything else is refused with a clear message (the engine never guesses).
import { goFloatE, goFloatF, goFloatG, goFloatV, goQuote } from './format';
import { PromQLError, type Labels } from './types';

export interface TemplateData {
  labels: Labels;
  value: number;
}

type Arg = { kind: 'num'; v: number } | { kind: 'str'; v: string } | { kind: 'map'; v: Labels };

function fail(msg: string): never {
  throw new PromQLError(msg, 'template', { msg });
}

function humanize(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return goFloatG(v, 4);
  if (Math.abs(v) >= 1) {
    let prefix = '';
    for (const p of ['k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y']) {
      if (Math.abs(v) < 1000) break;
      prefix = p;
      v /= 1000;
    }
    return goFloatG(v, 4) + prefix;
  }
  let prefix = '';
  for (const p of ['m', 'u', 'n', 'p', 'f', 'a', 'z', 'y']) {
    if (Math.abs(v) >= 1) break;
    prefix = p;
    v *= 1000;
  }
  return goFloatG(v, 4) + prefix;
}

function humanizeDuration(v: number): string {
  if (!Number.isFinite(v)) return goFloatG(v, 4);
  if (v === 0) return `${goFloatG(v, 4)}s`;
  if (Math.abs(v) >= 1) {
    let sign = '';
    if (v < 0) {
      sign = '-';
      v = -v;
    }
    const d = Math.trunc(v);
    const seconds = d % 60;
    const minutes = Math.trunc(d / 60) % 60;
    const hours = Math.trunc(d / 3600) % 24;
    const days = Math.trunc(d / 86400);
    if (days) return `${sign}${days}d ${hours}h ${minutes}m ${seconds}s`;
    if (hours) return `${sign}${hours}h ${minutes}m ${seconds}s`;
    if (minutes) return `${sign}${minutes}m ${seconds}s`;
    return `${sign}${goFloatG(v, 4)}s`;
  }
  let prefix = '';
  for (const p of ['m', 'u', 'n', 'p', 'f', 'a', 'z', 'y']) {
    if (Math.abs(v) >= 1) break;
    prefix = p;
    v *= 1000;
  }
  return `${goFloatG(v, 4)}${prefix}s`;
}

function toNum(a: Arg, fn: string): number {
  if (a.kind === 'num') return a.v;
  if (a.kind === 'str' && a.v.trim() !== '' && !Number.isNaN(Number(a.v))) return Number(a.v);
  return fail(`error calling ${fn}: can't convert ${a.kind === 'str' ? goQuote(a.v) : 'a map'} to float`);
}

function show(a: Arg): string {
  if (a.kind === 'num') return goFloatV(a.v);
  if (a.kind === 'str') return a.v;
  return `map[${Object.keys(a.v)
    .sort()
    .map((k) => `${k}:${a.v[k]}`)
    .join(' ')}]`;
}

/** Go fmt.Sprintf for the verbs alert templates use. */
export function goSprintf(format: string, args: Arg[]): string {
  let out = '';
  let ai = 0;
  const re = /%([-+# 0]*)(\d+)?(?:\.(\d+))?([a-zA-Z%])/g;
  let last = 0;
  for (let m = re.exec(format); m; m = re.exec(format)) {
    out += format.slice(last, m.index);
    last = re.lastIndex;
    const verb = m[4]!;
    if (verb === '%') {
      out += '%';
      continue;
    }
    const a = args[ai++];
    if (!a) {
      out += `%!${verb}(MISSING)`;
      continue;
    }
    const prec = m[3] === undefined ? undefined : Number(m[3]);
    let s: string;
    if (a.kind === 'num') {
      switch (verb) {
        case 'f':
        case 'F':
          s = goFloatF(a.v, prec ?? 6);
          break;
        case 'g':
          s = prec === undefined ? goFloatV(a.v) : goFloatG(a.v, prec);
          break;
        case 'e':
          s = goFloatE(a.v, prec ?? 6);
          break;
        case 'v':
          s = goFloatV(a.v);
          break;
        default:
          s = `%!${verb}(float64=${goFloatV(a.v)})`;
      }
    } else if (a.kind === 'str') {
      if (verb === 's' || verb === 'v') s = prec === undefined ? a.v : a.v.slice(0, prec);
      else if (verb === 'q') s = goQuote(a.v);
      else s = `%!${verb}(string=${a.v})`;
    } else s = show(a);
    const width = m[2] === undefined ? 0 : Number(m[2]);
    if (s.length < width) s = m[1]?.includes('-') ? s.padEnd(width) : s.padStart(width, m[1]?.includes('0') && a.kind === 'num' ? '0' : ' ');
    out += s;
  }
  out += format.slice(last);
  if (ai < args.length) out += `%!(EXTRA ${args.slice(ai).map((a) => (a.kind === 'num' ? `float64=${goFloatV(a.v)}` : a.kind === 'str' ? `string=${a.v}` : 'map')).join(', ')})`;
  return out;
}

const FUNCS: Record<string, (args: Arg[]) => Arg> = {
  humanize: (a) => ({ kind: 'str', v: humanize(toNum(one(a, 'humanize'), 'humanize')) }),
  humanizePercentage: (a) => ({ kind: 'str', v: `${goFloatG(toNum(one(a, 'humanizePercentage'), 'humanizePercentage') * 100, 4)}%` }),
  humanizeDuration: (a) => ({ kind: 'str', v: humanizeDuration(toNum(one(a, 'humanizeDuration'), 'humanizeDuration')) }),
  toUpper: (a) => ({ kind: 'str', v: show(one(a, 'toUpper')).toUpperCase() }),
  toLower: (a) => ({ kind: 'str', v: show(one(a, 'toLower')).toLowerCase() }),
  printf: (a) => {
    const [f, ...rest] = a;
    if (!f || f.kind !== 'str') fail('printf needs a format string first');
    return { kind: 'str', v: goSprintf(f.v, rest) };
  },
};

function one(a: Arg[], fn: string): Arg {
  if (a.length !== 1) fail(`wrong number of args for ${fn}: want 1 got ${a.length}`);
  return a[0]!;
}

/** Split an action into words: "quoted strings", numbers, $vars, .Fields, names, |. */
function words(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '|' || c === '(' || c === ')') {
      out.push(c);
      i++;
      continue;
    }
    if (c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' && c === '"' ? 2 : 1;
      out.push(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < src.length && !/[\s|()]/.test(src[j]!)) j++;
    out.push(src.slice(i, j));
    i = j;
  }
  return out;
}

function operand(w: string, data: TemplateData): Arg {
  if (w.startsWith('"')) return { kind: 'str', v: JSON.parse(w) as string };
  if (w.startsWith('`')) return { kind: 'str', v: w.slice(1, -1) };
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(w)) return { kind: 'num', v: Number(w) };
  const path = /^(\$labels|\$value|\$externalLabels|\.Labels|\.Value|\.ExternalLabels)((?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)$/.exec(w);
  if (path) {
    const root = path[1]!;
    const field = path[2] ? path[2].slice(1) : undefined;
    if (root === '$value' || root === '.Value') {
      if (field) fail(`can't evaluate field ${field} in type float64`);
      return { kind: 'num', v: data.value };
    }
    const map: Labels = root.endsWith('xternalLabels') ? {} : data.labels;
    if (field) return { kind: 'str', v: map[field] ?? '' };
    return { kind: 'map', v: map };
  }
  return fail(`this practice engine reads $labels.<name>, $value and quoted text, not "${w}"`);
}

function evalPipeline(src: string, data: TemplateData): Arg {
  const ws = words(src);
  if (ws.includes('(') || ws.includes(')')) fail('this practice engine does not read brackets inside {{ }}');
  const cmds: string[][] = [[]];
  for (const w of ws) {
    if (w === '|') cmds.push([]);
    else cmds[cmds.length - 1]!.push(w);
  }
  let piped: Arg | undefined;
  for (const cmd of cmds) {
    if (!cmd.length) fail('missing value for command');
    const [head, ...rest] = cmd as [string, ...string[]];
    if (FUNCS[head]) {
      const args = rest.map((w) => operand(w, data));
      if (piped) args.push(piped);
      piped = FUNCS[head](args);
    } else {
      if (rest.length || piped) fail(`function "${head}" not defined`);
      piped = operand(head, data);
    }
  }
  return piped!;
}

/** Expand one alert label or annotation template. */
export function expandTemplate(text: string, data: TemplateData): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open < 0) {
      out += text.slice(i);
      break;
    }
    let before = text.slice(i, open);
    let start = open + 2;
    if (text[start] === '-' && /\s/.test(text[start + 1] ?? '')) {
      before = before.replace(/\s+$/, '');
      start += 1;
    }
    const close = text.indexOf('}}', start);
    if (close < 0) fail('unclosed action');
    let body = text.slice(start, close);
    let after = close + 2;
    let trimAfter = false;
    if (/\s-$/.test(body)) {
      body = body.slice(0, -1);
      trimAfter = true;
    }
    out += before;
    const b = body.trim();
    if (!b.startsWith('/*')) {
      if (/^(if|range|with|else|end|define|template|block)\b/.test(b)) fail(`this practice engine does not run {{ ${b.split(/\s/)[0]} }}`);
      out += show(evalPipeline(b, data));
    }
    if (trimAfter) while (after < text.length && /\s/.test(text[after]!)) after++;
    i = after;
  }
  return out;
}

/** Throws if a template uses something the engine can't expand. */
export function checkTemplate(text: string): void {
  expandTemplate(text, { labels: {}, value: 1 });
}
