// Split a typed command line into words, like a tiny shell.
// Handles "double" and 'single' quotes and `>` / `>>` redirects.

export interface ParsedLine {
  words: string[];
  redirect: { append: boolean; target: string } | null;
  error: 'unclosedQuote' | 'missingTarget' | null;
}

export function parseLine(input: string): ParsedLine {
  const words: string[] = [];
  let redirect: ParsedLine['redirect'] = null;
  let cur = '';
  let hasCur = false;
  let quote: '"' | "'" | null = null;
  let pendingRedirect: boolean | null = null; // append flag while waiting for a target

  const push = () => {
    if (!hasCur) return;
    if (pendingRedirect !== null) {
      redirect = { append: pendingRedirect, target: cur };
      pendingRedirect = null;
    } else words.push(cur);
    cur = '';
    hasCur = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        cur += input[++i];
      } else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasCur = true;
    } else if (ch === ' ' || ch === '\t') {
      push();
    } else if (ch === '>') {
      push();
      const append = input[i + 1] === '>';
      if (append) i++;
      pendingRedirect = append;
    } else {
      cur += ch;
      hasCur = true;
    }
  }
  if (quote) return { words, redirect, error: 'unclosedQuote' };
  push();
  if (pendingRedirect !== null) return { words, redirect, error: 'missingTarget' };
  return { words, redirect, error: null };
}

/** Small option reader for `-m msg`, `-m=msg`, `--source=x`, `--source x`, and `-am`. */
export class Args {
  readonly flags = new Set<string>();
  readonly values = new Map<string, string>();
  readonly positional: string[] = [];
  readonly unknown: string[] = [];
  afterDashDash = false;
  /** How many positional words came before `--` (all of them if there was no `--`). */
  beforeDashDash = Infinity;

  constructor(args: string[], spec: { flags?: string[]; values?: string[]; combined?: boolean }) {
    const flags = new Set(spec.flags ?? []);
    const values = new Set(spec.values ?? []);
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (this.afterDashDash) {
        this.positional.push(a);
        continue;
      }
      if (a === '--') {
        this.afterDashDash = true;
        this.beforeDashDash = this.positional.length;
        continue;
      }
      if (a.startsWith('--') && a.includes('=')) {
        const [name, ...rest] = a.split('=');
        if (values.has(name!)) this.values.set(name!, rest.join('='));
        else this.unknown.push(a);
        continue;
      }
      if (values.has(a)) {
        const v = args[i + 1];
        if (v === undefined) this.unknown.push(a);
        else {
          this.values.set(a, v);
          i++;
        }
        continue;
      }
      if (flags.has(a)) {
        this.flags.add(a);
        continue;
      }
      // Combined short flags like -am "msg" or -fd.
      if (spec.combined && /^-[a-zA-Z]{2,}$/.test(a)) {
        const letters = a.slice(1).split('');
        let ok = true;
        for (let j = 0; j < letters.length; j++) {
          const f = `-${letters[j]}`;
          if (flags.has(f)) this.flags.add(f);
          else if (values.has(f) && j === letters.length - 1) {
            const v = args[i + 1];
            if (v === undefined) ok = false;
            else {
              this.values.set(f, v);
              i++;
            }
          } else ok = false;
        }
        if (!ok) this.unknown.push(a);
        continue;
      }
      if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
        this.unknown.push(a);
        continue;
      }
      this.positional.push(a);
    }
  }

  has(...names: string[]): boolean {
    return names.some((n) => this.flags.has(n));
  }

  get(...names: string[]): string | undefined {
    for (const n of names) {
      const v = this.values.get(n);
      if (v !== undefined) return v;
    }
    return undefined;
  }
}
