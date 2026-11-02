// K9 node shell: the recorded node-side outputs (../fixtures/cka.json) and the real formats
// the engine fills them with (systemd, journald, klog, zap, go-units, go-humanize).
//
// Every fixture entry names its source: "node-image" (the kind node image v1.37.0), "etcd-image"
// (etcd 3.7.0), "kubectl-client", "component-image", "docs" or "kind-capture" (the manual
// .github/workflows/capture-cka.yml run on a real kind cluster). The engine never trusts the
// recorded node names, IPs, times, PIDs or hashes: it swaps in its own (see `fill`).
import data from '../fixtures/cka.json';
import { fnv32a } from '../util';

export interface FixtureOutput {
  source: string;
  cmd: string;
  exit: number;
  text: string;
  /** The node it was recorded on (replaced by the node you are on). */
  node?: string;
  /** That node's IP (replaced too). */
  ip?: string;
  /** The values typed when it was recorded (paths, ids, flags, the API address), replaced by the learner's. */
  vars?: Record<string, string>;
  note?: string;
  ref?: string;
}

interface CkaFixture {
  about: string;
  sources: Record<string, string>;
  kubernetes: string;
  nodeImage: string;
  outputs: Record<string, FixtureOutput>;
  files: Record<string, { source: string; text: string; note?: string }>;
  pending: Record<string, string>;
}

export const CKA = data as unknown as CkaFixture;

export function fx(key: string): FixtureOutput {
  const o = CKA.outputs[key];
  if (!o) throw new Error(`cka.json has no output "${key}"`);
  return o;
}

/** A fixture's text for this node: recorded node name, IP and Docker cgroup prefix swapped out. */
export function fill(key: string, ctx: { node?: string; ip?: string } = {}): string {
  const o = fx(key);
  let text = o.text.replace(/\/docker\/[0-9a-f]{64}/g, '');
  if (o.node && ctx.node) text = text.split(o.node).join(ctx.node);
  if (o.ip && ctx.ip) text = text.replace(new RegExp(`\\b${o.ip.replace(/\./g, '\\.')}\\b`, 'g'), ctx.ip);
  return text;
}

// ---------------------------------------------------------------------------
// Time formats

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
const d = (clock: number) => new Date(clock * 1000);
const hms = (clock: number) => `${p2(d(clock).getUTCHours())}:${p2(d(clock).getUTCMinutes())}:${p2(d(clock).getUTCSeconds())}`;

/** systemctl status: "Sun 2026-11-01 08:29:33 UTC". */
export function systemdTime(clock: number): string {
  const t = d(clock);
  return `${DAYS[t.getUTCDay()]} ${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${hms(clock)} UTC`;
}

/** journalctl short format: "Nov 01 08:30:51". */
export function journalTime(clock: number): string {
  const t = d(clock);
  return `${MONTHS[t.getUTCMonth()]} ${p2(t.getUTCDate())} ${hms(clock)}`;
}

/** A stable sub-second part (microseconds). A number salt is the line's place in that second, so times go up. */
export function micros(clock: number, salt: string | number): string {
  const base = fnv32a(String(clock)) % 300_000;
  const v = typeof salt === 'number' ? base + salt * 2_731 + (fnv32a(`${clock}:${salt}`) % 900) : fnv32a(`${clock}:${salt}`) % 1_000_000;
  return String(Math.min(999_999, v)).padStart(6, '0');
}

/** klog header: "I1101 08:30:54.343366    2766 ". */
export function klogHead(level: string, clock: number, pid: number, salt: string | number): string {
  const t = d(clock);
  return `${level}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())} ${hms(clock)}.${micros(clock, salt)} ${String(pid).padStart(7)} `;
}

/** zap JSON "ts": "2026-11-01T08:32:32.480596Z". */
export function zapTs(clock: number, salt: string | number): string {
  return new Date(clock * 1000).toISOString().replace(/\.\d{3}Z$/, `.${micros(clock, salt)}Z`);
}

/** systemd "… ago" (format_timestamp_relative): 7ms, 3s, 1min 17s, 12min, 1h 5min, 7h, 1 day 2h, 3 days. */
export function systemdAgo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 1) return '7ms ago';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 5) return `${m}min ${s % 60}s ago`;
  if (m < 60) return `${m}min ago`;
  const h = Math.floor(m / 60);
  if (h < 6) return `${h}h ${m % 60}min ago`;
  if (h < 25) return `${h}h ago`;
  if (h < 48) return `1 day ${h - 24}h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** systemd time span (format_timespan): "1min 17s", "6min 50s", "1h 2min 3s". */
export function systemdSpan(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const parts: string[] = [];
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}min`);
  if (r || !parts.length) parts.push(`${r}s`);
  return parts.join(' ');
}

/** go-units HumanDuration + " ago" (crictl CREATED): "About a minute ago", "7 minutes ago", "17 hours ago". */
export function unitsAgo(seconds: number): string {
  const s = Math.floor(seconds);
  let t: string;
  if (s < 1) t = 'Less than a second';
  else if (s === 1) t = '1 second';
  else if (s < 60) t = `${s} seconds`;
  else if (Math.floor(s / 60) === 1) t = 'About a minute';
  else if (s < 3600) t = `${Math.floor(s / 60)} minutes`;
  else {
    const h = Math.floor(s / 3600 + 0.5);
    if (h === 1) t = 'About an hour';
    else if (h < 48) t = `${h} hours`;
    else if (h < 24 * 14) t = `${Math.floor(h / 24)} days`;
    else if (h < 24 * 60) t = `${Math.floor(h / 24 / 7)} weeks`;
    else if (h < 24 * 730) t = `${Math.floor(h / 24 / 30)} months`;
    else t = `${Math.floor(h / 24 / 365)} years`;
  }
  return `${t} ago`;
}

/** go-humanize Bytes (SI): "29 kB", "2.1 MB". */
export function humanBytes(n: number): string {
  if (n < 10) return `${n} B`;
  const sizes = ['B', 'kB', 'MB', 'GB', 'TB'];
  const e = Math.floor(Math.log(n) / Math.log(1000));
  const v = Math.floor((n / 1000 ** e) * 10 + 0.5) / 10;
  return `${v < 10 ? v.toFixed(1) : v.toFixed(0)} ${sizes[e]}`;
}

/** kubeadm certs: "Oct 31, 2027 00:55 UTC". */
export function kubeadmTime(clock: number): string {
  const t = d(clock);
  return `${MONTHS[t.getUTCMonth()]} ${p2(t.getUTCDate())}, ${t.getUTCFullYear()} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())} UTC`;
}

/** apimachinery duration.ShortHumanDuration (kubeadm RESIDUAL TIME): "364d", "9y", "<invalid>". */
export function shortHuman(seconds: number): string {
  if (seconds < -1) return '<invalid>';
  if (seconds < 0) return '0s';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (h < 24 * 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

// ---------------------------------------------------------------------------
// Stable ids

/** Hex of any length from a text (same text, same id). */
export function hexOf(text: string, n: number): string {
  let out = '';
  for (let i = 0; out.length < n; i++) out += fnv32a(`${i}:${text}`).toString(16).padStart(8, '0');
  return out.slice(0, n);
}

/** Replace each `@KLOG` (a klog time placeholder) with "MMDD hh:mm:ss.uuuuuu" at this clock. */
export function klogStamp(text: string, clock: number): string {
  let i = 0;
  const t = d(clock);
  return text.replace(/@KLOG/g, () => `${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())} ${hms(clock)}.${micros(clock, i++)}`);
}

/** go-units HumanSizeWithPrecision(size, 3) (crictl images SIZE): "39.7MB", "320kB", "104MB". */
export function humanSize3(n: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${Number(v.toPrecision(3))}${units[i]}`;
}

/** Pad table cells like Go's text/tabwriter with minwidth, padding and a space filler (crictl: 20, 3). */
export function tabwrite(rows: string[][], minWidth = 20, padding = 3): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length + padding, minWidth)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join(''));
}
