// Labels, numbers and durations, printed the way Prometheus 3 (written in Go) prints them.
import type { Labels } from './types';

export const NAME = '__name__';

/** Label names in Prometheus order (byte order). */
export function labelNames(l: Labels): string[] {
  return Object.keys(l).sort(cmpStr);
}

export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A canonical key for a label set (equal sets, equal keys). */
export function labelsKey(l: Labels): string {
  return labelNames(l)
    .map((n) => `${n}\u0000${l[n]}`)
    .join('\u0001');
}

/** Prometheus labels.Compare: label by label (name, then value); the shorter set first on a tie. */
export function compareLabels(a: Labels, b: Labels): number {
  const an = labelNames(a);
  const bn = labelNames(b);
  const n = Math.min(an.length, bn.length);
  for (let i = 0; i < n; i++) {
    if (an[i] !== bn[i]) return cmpStr(an[i]!, bn[i]!);
    const c = cmpStr(a[an[i]!]!, b[bn[i]!]!);
    if (c) return c;
  }
  return an.length - bn.length;
}

/** Labels without empty values (Prometheus drops a label set to ""), sorted. */
export function makeLabels(l: Record<string, string>): Labels {
  const out: Record<string, string> = {};
  for (const n of Object.keys(l).sort(cmpStr)) if (l[n] !== '') out[n] = l[n]!;
  return out;
}

export function dropName(l: Labels): Labels {
  if (!(NAME in l)) return l;
  const out: Record<string, string> = { ...l };
  delete out[NAME];
  return out;
}

/** Go's strconv.Quote for the text we use (printable characters pass through). */
export function goQuote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

/** Prometheus labels.String(): {__name__="up", job="shop"}. */
export function labelsString(l: Labels): string {
  return `{${labelNames(l)
    .map((n) => `${n}=${goQuote(l[n]!)}`)
    .join(', ')}}`;
}

/** How the Prometheus UI names a series: up{job="shop"} (or {job="shop"} without a name). */
export function seriesString(l: Labels): string {
  const name = l[NAME] ?? '';
  const rest = labelNames(l).filter((n) => n !== NAME);
  if (name && rest.length === 0) return name;
  return `${name}{${rest.map((n) => `${n}=${goQuote(l[n]!)}`).join(', ')}}`;
}

// ---- Numbers -------------------------------------------------------------------------------

/** Shortest round-trip digits of |x| (finite, non-zero): digits and the decimal point position. */
function shortestDigits(x: number): { digits: string; dp: number } {
  const [mant, exp] = Math.abs(x).toExponential().split('e') as [string, string];
  const digits = mant.replace('.', '');
  return { digits, dp: Number(exp) + 1 };
}

/** Exact decimal expansion of a finite double: digits (no leading zeros) and point position. */
function exactDigits(x: number): { digits: string; dp: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(x));
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e2: number;
  if (expBits === 0) e2 = -1074;
  else {
    mant |= 1n << 52n;
    e2 = expBits - 1075;
  }
  if (mant === 0n) return { digits: '0', dp: 1 };
  let digits: string;
  let dp: number;
  if (e2 >= 0) {
    digits = (mant << BigInt(e2)).toString();
    dp = digits.length;
  } else {
    // mant / 2^k = mant * 5^k / 10^k
    const k = -e2;
    digits = (mant * 5n ** BigInt(k)).toString();
    dp = digits.length - k;
  }
  const stripped = digits.replace(/0+$/, '');
  return { digits: stripped || '0', dp };
}

/** Round a digit string to `nd` digits, half to even on an exact tie (Go's decimal rounding). */
function roundDigits(d: { digits: string; dp: number }, nd: number): { digits: string; dp: number } {
  if (nd < 0) return { digits: '0', dp: 1 };
  if (d.digits.length <= nd) return d;
  const keep = d.digits.slice(0, nd);
  const next = d.digits.charCodeAt(nd) - 48;
  const restNonZero = /[1-9]/.test(d.digits.slice(nd + 1));
  let up = next > 5 || (next === 5 && restNonZero);
  if (next === 5 && !restNonZero) up = nd > 0 && (keep.charCodeAt(nd - 1) - 48) % 2 === 1;
  if (!up) {
    const t = keep.replace(/0+$/, '');
    return t ? { digits: t, dp: d.dp } : { digits: '0', dp: 1 };
  }
  // Add one at the last kept digit.
  const arr = keep.split('').map(Number);
  let i = arr.length - 1;
  while (i >= 0 && arr[i] === 9) {
    arr[i] = 0;
    i--;
  }
  if (i < 0) return { digits: '1', dp: d.dp + 1 };
  arr[i]! += 1;
  return { digits: arr.slice(0, i + 1).join(''), dp: d.dp };
}

function special(x: number): string | null {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return '+Inf';
  if (x === -Infinity) return '-Inf';
  return null;
}

function fmtF(neg: boolean, d: { digits: string; dp: number }, prec: number): string {
  const int = d.dp > 0 ? d.digits.slice(0, d.dp).padEnd(d.dp, '0') : '0';
  let frac = '';
  for (let i = 0; i < prec; i++) {
    const j = d.dp + i;
    frac += j < 0 || j >= d.digits.length ? '0' : d.digits[j];
  }
  return `${neg ? '-' : ''}${int}${prec > 0 ? `.${frac}` : ''}`;
}

function fmtE(neg: boolean, d: { digits: string; dp: number }, prec: number): string {
  const first = d.digits[0] ?? '0';
  let frac = '';
  for (let i = 1; i <= prec; i++) frac += d.digits[i] ?? '0';
  const exp = d.digits === '0' ? 0 : d.dp - 1;
  const sign = exp < 0 ? '-' : '+';
  const ae = Math.abs(exp);
  return `${neg ? '-' : ''}${first}${prec > 0 ? `.${frac}` : ''}e${sign}${ae < 10 ? `0${ae}` : ae}`;
}

/**
 * A sample value the way the Prometheus HTTP API and UI print it
 * (Go strconv.FormatFloat(v, 'f', -1, 64)): shortest digits, never an exponent.
 */
export function formatValue(x: number): string {
  const s = special(x);
  if (s) return s;
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const d = shortestDigits(x);
  return fmtF(x < 0, d, Math.max(d.digits.length - d.dp, 0));
}

/** Go's %v / strconv 'g' with the shortest digits (how {{ $value }} prints in a template). */
export function goFloatV(x: number): string {
  const s = special(x);
  if (s) return s;
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const d = shortestDigits(x);
  const exp = d.dp - 1;
  // Go: "if precision was the shortest possible, use precision 6 for this decision" (1e+06).
  if (exp < -4 || exp >= 6) return fmtE(x < 0, d, d.digits.length - 1);
  return fmtF(x < 0, d, Math.max(d.digits.length - d.dp, 0));
}

/** Go's %.<prec>g (exact rounding, half to even on a true tie; trailing zeros dropped). */
export function goFloatG(x: number, prec: number): string {
  const s = special(x);
  if (s) return s;
  if (prec === 0) prec = 1;
  const neg = x < 0 || Object.is(x, -0);
  const d = x === 0 ? { digits: '0', dp: 1 } : roundDigits(exactDigits(x), prec);
  let eprec = prec;
  if (eprec > d.digits.length && d.digits.length >= d.dp) eprec = d.digits.length;
  const exp = d.dp - 1;
  if (exp < -4 || exp >= eprec) {
    const p = Math.min(prec, d.digits.length);
    return fmtE(neg, d, p - 1);
  }
  const p = prec > d.dp ? d.digits.length : prec;
  return fmtF(neg, d, Math.max(p - d.dp, 0));
}

/** Go's %.<prec>f. */
export function goFloatF(x: number, prec: number): string {
  const s = special(x);
  if (s) return s;
  const neg = x < 0 || Object.is(x, -0);
  if (x === 0) return fmtF(neg, { digits: '0', dp: 1 }, prec);
  const ex = exactDigits(x);
  const d = roundDigits(ex, ex.dp + prec);
  return fmtF(neg, d, prec);
}

/** Go's %.<prec>e. */
export function goFloatE(x: number, prec: number): string {
  const s = special(x);
  if (s) return s;
  const neg = x < 0 || Object.is(x, -0);
  const d = x === 0 ? { digits: '0', dp: 1 } : roundDigits(exactDigits(x), prec + 1);
  return fmtE(neg, d, prec);
}

/** The shortest text that parses back to the same double (for YAML files and tests). */
export function roundTrip(x: number): string {
  if (Number.isNaN(x)) return '.nan';
  if (x === Infinity) return '.inf';
  if (x === -Infinity) return '-.inf';
  return String(x);
}

// ---- Durations -----------------------------------------------------------------------------

const UNITS: [string, number][] = [
  ['y', 365 * 24 * 3600_000],
  ['w', 7 * 24 * 3600_000],
  ['d', 24 * 3600_000],
  ['h', 3600_000],
  ['m', 60_000],
  ['s', 1000],
  ['ms', 1],
];

const DURATION_RE = /^(?:(\d+)y)?(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/;

/** Prometheus model.ParseDuration ("1h30m", "5m", "90s", "0"). Returns null when it isn't one. */
export function parseDuration(s: string): number | null {
  if (s === '0') return 0;
  if (!s) return null;
  const m = DURATION_RE.exec(s);
  if (!m) return null;
  let ms = 0;
  let any = false;
  for (let i = 0; i < UNITS.length; i++) {
    const g = m[i + 1];
    if (g === undefined) continue;
    any = true;
    ms += Number(g) * UNITS[i]![1];
  }
  return any ? ms : null;
}

/** Like parseDuration, but throws. */
export function duration(s: string): number {
  const d = parseDuration(s);
  if (d === null) throw new Error(`not a valid duration string: "${s}"`);
  return d;
}

/** Prometheus model.Duration.String(): 0s, 90s → 1m30s, 7d → 1w, 1h30m. */
export function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  let rest = Math.abs(ms);
  let out = ms < 0 ? '-' : '';
  for (const [unit, mult] of UNITS) {
    const exact = unit === 'y' || unit === 'w';
    if (exact && rest % mult !== 0) continue;
    const v = Math.floor(rest / mult);
    if (v > 0) {
      out += `${v}${unit}`;
      rest -= v * mult;
    }
  }
  return out;
}
