// Formatting helpers that copy Docker's own (go-units, text/tabwriter, Go time layouts).
import type { Color, Line } from './types';

/** go-units HumanSizeWithPrecision: decimal units, `%.*g` style. */
export function humanSize(bytes: number, precision = 3): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let size = bytes;
  let i = 0;
  while (size >= 1000 && i < units.length - 1) {
    size /= 1000;
    i++;
  }
  return `${g(size, precision)}${units[i]}`;
}

/** go-units BytesSize: binary units (MiB, GiB), 4 significant digits. */
export function bytesSize(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${g(size, 4)}${units[i]}`;
}

/** Go's %.Ng: N significant digits, no trailing zeros. */
export function g(n: number, precision: number): string {
  if (n === 0) return '0';
  return String(Number(n.toPrecision(precision)));
}

/** Parse "93.5MB" / "25.9kB" / "1.34GB" back to bytes (for sums). */
export function parseSize(text: string): number {
  const m = /^([\d.]+)\s*(B|kB|MB|GB|TB)$/.exec(text.trim());
  if (!m) return 0;
  const mult: Record<string, number> = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return Math.round(Number(m[1]) * mult[m[2]!]!);
}

/** go-units HumanDuration, used for CREATED and STATUS columns. */
export function humanDuration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 1) return 'Less than a second';
  if (s === 1) return '1 second';
  if (s < 60) return `${s} seconds`;
  const minutes = Math.floor(s / 60);
  if (minutes === 1) return 'About a minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(s / 3600);
  if (hours === 1) return 'About an hour';
  if (hours < 48) return `${hours} hours`;
  if (hours < 24 * 7 * 2) return `${Math.floor(hours / 24)} days`;
  if (hours < 24 * 30 * 2) return `${Math.floor(hours / 24 / 7)} weeks`;
  if (hours < 24 * 365 * 2) return `${Math.floor(hours / 24 / 30)} months`;
  return `${Math.floor(s / 3600 / 24 / 365)} years`;
}

export function ago(now: number, then: number): string {
  return `${humanDuration(now - then)} ago`;
}

/** Docker truncates long cells with an ellipsis: keep `max - 1` characters, then "…". */
export function ellipsis(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Go text/tabwriter as Docker uses it: minwidth 10, padding 3 (docker ps, images, volume ls...).
 * The last column is never padded.
 */
export function table(rows: string[][], minWidth = 10, padding = 3): string[] {
  const cols = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < cols - 1; c++) {
    let w = 0;
    for (const r of rows) w = Math.max(w, [...(r[c] ?? '')].length);
    widths.push(Math.max(w + padding, minWidth));
  }
  return rows.map((r) =>
    r
      .map((cell, c) => (c < cols - 1 && c < r.length - 1 ? cell + ' '.repeat(widths[c]! - [...cell].length) : cell))
      .join(''),
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** 2026-10-31T01:00:00Z (RFC 3339, like Docker's JSON). `nanos` adds a fake fraction. */
export function iso(t: number, nanos?: string): string {
  const d = new Date(t * 1000);
  const base = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  return nanos ? `${base}.${nanos}Z` : `${base}Z`;
}

/** nginx error-log time: 2026/10/31 01:00:00 */
export function nginxTime(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/** nginx access-log time: 31/Oct/2026:01:00:00 +0000 */
export function accessTime(t: number): string {
  const d = new Date(t * 1000);
  return `${p2(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`;
}

/** HTTP date: Sat, 31 Oct 2026 01:00:00 GMT */
export function httpDate(t: number): string {
  const d = new Date(t * 1000);
  return `${DAYS[d.getUTCDay()]}, ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} GMT`;
}

/** postgres log time: 2026-10-31 01:00:00.123 (the caller adds " UTC") */
export function pgTime(t: number, ms = 0): string {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${String(ms).padStart(3, '0')}`;
}

/** redis log time: 31 Oct 2026 01:00:00.647 */
export function redisTime(t: number, ms = 0): string {
  const d = new Date(t * 1000);
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${String(ms).padStart(3, '0')}`;
}

/** `date` inside a container: Sat Oct 31 01:00:00 UTC 2026 */
export function unixDate(t: number): string {
  const d = new Date(t * 1000);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
}

/** `ls -l` time: Oct 31 01:00 */
export function lsTime(t: number): string {
  const d = new Date(t * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** docker image ls --format table CREATED AT: 2026-10-21 23:23:59 +0000 UTC */
export function goTime(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000 UTC`;
}

export function parseIso(text: string): number {
  return Math.floor(Date.parse(text) / 1000);
}

export function colored(text: string, c?: Color): Line {
  return c ? [{ t: text, c }] : [{ t: text }];
}

/** Right-align `right` at column `width` after `left` (BuildKit / Compose progress lines). */
export function spread(left: string, right: string, width: number): string {
  const room = width - [...right].length - 1;
  const l = [...left].length > room ? `${[...left].slice(0, Math.max(0, room - 1)).join('')} ` : left;
  return l + ' '.repeat(Math.max(1, width - [...l].length - [...right].length)) + right;
}
