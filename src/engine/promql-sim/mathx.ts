// Number helpers that copy Go's math package and Prometheus's float tricks, so the engine's
// results are the same doubles promtool prints.

/** Prometheus kahanSumInc (Neumaier's improvement): add `inc` to `sum` with compensation `c`. */
export function kahanSumInc(inc: number, sum: number, c: number): [number, number] {
  const t = sum + inc;
  if (!Number.isFinite(t) && !Number.isNaN(t)) c = 0;
  else if (Math.abs(sum) >= Math.abs(inc)) c += sum - t + inc;
  else c += inc - t + sum;
  return [t, c];
}

/** Go math.Pow special cases that differ from JavaScript's **. */
export function goPow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 1) return 1;
  if ((x === -1) && !Number.isFinite(y) && !Number.isNaN(y)) return 1;
  return x ** y;
}

/** Go math.Mod (same sign rules as JavaScript's %). */
export function goMod(x: number, y: number): number {
  return x % y;
}

/** Go math.Max: NaN wins, +0 beats -0. */
export function goMax(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.max(a, b);
}

export function goMin(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.min(a, b);
}

/** Go math.Round is half away from zero; PromQL's round() uses floor(x + 0.5) instead (see functions). */
export function sgn(x: number): number {
  if (x < 0) return -1;
  if (x > 0) return 1;
  return x; // 0, -0 or NaN
}

const MIN_NORMAL = 2.2250738585072014e-308;

/** Prometheus util/almost.Equal. */
export function almostEqual(a: number, b: number, epsilon: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === b) return true;
  const absSum = Math.abs(a) + Math.abs(b);
  const diff = Math.abs(a - b);
  if (a === 0 || b === 0 || absSum < MIN_NORMAL) return diff < epsilon * MIN_NORMAL;
  return diff / Math.min(absSum, Number.MAX_VALUE) < epsilon;
}
