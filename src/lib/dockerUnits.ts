// Sizes the way Docker prints them (docker history, docker images, docker build):
// decimal units (1 kB = 1000 B) and 3 significant digits: "8.19kB", "12.8MB", "181MB", "1.36GB".
// Measured numbers live in docker-sizes.json (see scripts/docker-games/measure-sizes.ts).

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'];

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  let size = bytes;
  let unit = 0;
  for (;;) {
    while (size >= 1000 && unit < UNITS.length - 1) {
      size /= 1000;
      unit++;
    }
    const shown = Number(size.toPrecision(3));
    // 999.6 kB rounds to 1000 kB: move up one unit instead.
    if (shown >= 1000 && unit < UNITS.length - 1) {
      size = shown;
      continue;
    }
    return `${shown}${UNITS[unit]}`;
  }
}

/** A size from a lesson prop: bytes as a number, or text like "12.8MB", "37kB", "1.2 GB", "0B". */
export function parseSize(value: number | string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/i.exec(value);
  if (!m) return null;
  const power = ['b', 'kb', 'mb', 'gb', 'tb'].indexOf((m[2] ?? 'b').toLowerCase());
  return Math.round(Number(m[1]) * 1000 ** power);
}

/** Megabytes (decimal) for meters and targets. */
export const MB = 1_000_000;
