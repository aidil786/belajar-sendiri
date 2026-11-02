// Docker-style option parsing: --name web, --name=web, -p 8080:80 (repeatable), -it, -dit.
// Options stop at the first plain word when `stopAtPositional` (docker run IMAGE CMD...).

export interface FlagSpec {
  /** Boolean flags, each a list of aliases: [['-d', '--detach'], ...]. */
  bools?: string[][];
  /** Flags with one value (last one wins). */
  values?: string[][];
  /** Repeatable flags with a value. */
  multi?: string[][];
  stopAtPositional?: boolean;
}

export interface Parsed {
  bools: Set<string>;
  values: Map<string, string>;
  multi: Map<string, string[]>;
  positional: string[];
  /** First unknown flag, as typed. */
  unknown: string | null;
  /** A value flag with nothing after it. */
  missing: string | null;
}

export function parseFlags(args: string[], spec: FlagSpec): Parsed {
  const canon = new Map<string, { kind: 'bool' | 'value' | 'multi'; name: string }>();
  for (const g of spec.bools ?? []) for (const a of g) canon.set(a, { kind: 'bool', name: g[g.length - 1]! });
  for (const g of spec.values ?? []) for (const a of g) canon.set(a, { kind: 'value', name: g[g.length - 1]! });
  for (const g of spec.multi ?? []) for (const a of g) canon.set(a, { kind: 'multi', name: g[g.length - 1]! });
  const p: Parsed = { bools: new Set(), values: new Map(), multi: new Map(), positional: [], unknown: null, missing: null };
  let i = 0;
  const put = (kind: 'value' | 'multi', name: string, v: string) => {
    if (kind === 'value') p.values.set(name, v);
    else p.multi.set(name, [...(p.multi.get(name) ?? []), v]);
  };
  for (; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      p.positional.push(...args.slice(i + 1));
      return p;
    }
    if (!a.startsWith('-') || a === '-') {
      if (spec.stopAtPositional) {
        p.positional.push(...args.slice(i));
        return p;
      }
      p.positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    const known = canon.get(key);
    if (known) {
      if (known.kind === 'bool') {
        if (eq > 0 && a.slice(eq + 1) === 'false') p.bools.delete(known.name);
        else p.bools.add(known.name);
        continue;
      }
      const v = eq > 0 && a.startsWith('--') ? a.slice(eq + 1) : args[i + 1];
      if (v === undefined) {
        p.missing ??= a;
        continue;
      }
      if (!(eq > 0 && a.startsWith('--'))) i++;
      put(known.kind, known.name, v);
      continue;
    }
    // Combined short flags: -it, -dit, -itd, or -p8080:80 / -eKEY=v.
    if (/^-[a-zA-Z]{2,}$/.test(a)) {
      const letters = a.slice(1).split('');
      let ok = true;
      for (let j = 0; j < letters.length; j++) {
        const f = canon.get(`-${letters[j]}`);
        if (!f) {
          ok = false;
          break;
        }
        if (f.kind === 'bool') p.bools.add(f.name);
        else {
          const rest = a.slice(j + 2);
          const v = rest || args[i + 1];
          if (v === undefined) p.missing ??= a;
          else {
            if (!rest) i++;
            put(f.kind, f.name, v);
          }
          break;
        }
      }
      if (!ok) p.unknown ??= a.startsWith('--') ? a : `-${a.slice(1).split('').find((l) => !canon.get(`-${l}`))}`;
      continue;
    }
    if (/^-[a-zA-Z].+/.test(a) && canon.get(a.slice(0, 2))?.kind !== 'bool' && canon.get(a.slice(0, 2))) {
      const f = canon.get(a.slice(0, 2))!;
      put(f.kind as 'value' | 'multi', f.name, a.slice(2));
      continue;
    }
    p.unknown ??= key;
  }
  return p;
}
