// Helpers to build output lines and turn them into ANSI or plain text.
import type { Color, CommandResult, Explain, Line, SimEvent, SimState } from './types';

export function line(t: string, c?: Color): Line {
  return c ? [{ t, c }] : [{ t }];
}

export function lines(text: string, c?: Color): Line[] {
  return text.split('\n').map((t) => line(t, c));
}

export function plain(output: Line[]): string {
  return output.map((l) => l.map((s) => s.t).join('')).join('\n');
}

const ANSI: Record<Color, string> = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

export function toAnsi(output: Line[]): string {
  return output
    .map((l) => l.map((s) => (s.c ? `${ANSI[s.c]}${s.t}\x1b[0m` : s.t)).join(''))
    .join('\r\n');
}

export function ok(
  state: SimState,
  output: Line[] = [],
  events: SimEvent[] = [],
  explain?: Explain,
): CommandResult {
  return explain ? { state, output, events, ok: true, explain } : { state, output, events, ok: true };
}

/** A failed command. The state is returned unchanged. */
export function fail(
  state: SimState,
  output: Line[],
  code: string,
  explain?: Explain,
): CommandResult {
  const res: CommandResult = { state, output, events: [{ type: 'error', code }], ok: false };
  if (explain) res.explain = explain;
  return res;
}

export function notARepo(state: SimState): CommandResult {
  return fail(
    state,
    lines('fatal: not a git repository (or any of the parent directories): .git'),
    'notARepo',
    { key: 'sim.err.notARepo' },
  );
}

/** Levenshtein distance, for "did you mean?" hints. */
export function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}

export function closest(word: string, options: string[], max = 2): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const o of options) {
    const d = distance(word, o);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return bestD <= max ? best : undefined;
}
