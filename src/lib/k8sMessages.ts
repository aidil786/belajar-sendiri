// Small helpers that print things the way kubectl 1.37 prints them. Kept apart from k8sSchema.ts
// so games that only need a table or one message don't load the whole schema.

/**
 * kubectl's table layout (Go tabwriter: min width 6, padding 3). The last column is not padded.
 * e.g. kubectlTable(['NAME', 'READY'], [['tray-1', '1/1']])
 */
export function kubectlTable(headers: string[], rows: string[][]): string[] {
  const all = [headers, ...rows];
  const widths = headers.map((_, c) => Math.max(6, ...all.map((r) => (r[c] ?? '').length + 3)));
  return all.map((r) =>
    r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]!))).join(''),
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The letters Kubernetes uses for random name parts (no vowels, no look-alikes). */
const ALPHANUMS = 'bcdfghjklmnpqrstvwxz2456789';

/** A stable "random" suffix, like the -6mr2h in shop-6mr2h. */
export function nameSuffix(seed: string, length = 5): string {
  let h = hash(seed);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHANUMS[h % ALPHANUMS.length];
    h = (Math.floor(h / ALPHANUMS.length) ^ hash(`${seed}${i}`)) >>> 0;
  }
  return out;
}

/** A stable pod IP in the usual kind pod range, e.g. 10.244.1.7. */
export function podIP(name: string, index = 0): string {
  return `10.244.${(index % 3) + 1}.${(hash(name) % 200) + 5}`;
}

/** How the API server prints a value in "Invalid value: …" (maps as sorted JSON). */
export function showValue(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(o)
          .sort()
          .map((k) => [k, o[k]]),
      ),
    );
  }
  return JSON.stringify(v ?? null);
}

/** The API server's error when a Deployment's selector does not match its template labels. */
export function selectorMismatchMessage(
  kind: string,
  name: string,
  templateLabels: Record<string, string>,
): string {
  return `The ${kind} ${JSON.stringify(name)} is invalid: spec.template.metadata.labels: Invalid value: ${showValue(templateLabels)}: \`selector\` does not match template \`labels\``;
}

/** Labels as kubectl prints them: app=shop,tier=web (sorted). */
export function labelString(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

/** A small YAML writer for the manifests the games show (block style, 2 spaces, like kubectl). */
export function toYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  const scalar = (v: unknown): string => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    const s = String(v);
    // Quote anything YAML 1.1 would read as another type, or that has special characters.
    if (
      s === '' ||
      /^(y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/.test(
        s,
      ) ||
      /^[-+]?[0-9.]/.test(s) ||
      /[:#{}[\],&*!|>'"%@`]|^-|^\s|\s$/.test(s)
    ) {
      return JSON.stringify(s);
    }
    return s;
  };
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]\n`;
    return value
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const inner = toYaml(item, indent + 2);
          return `${pad}- ${inner.slice(indent + 2)}`;
        }
        return `${pad}- ${scalar(item)}\n`;
      })
      .join('');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (!entries.length) return `${pad}{}\n`;
    return entries
      .map(([k, v]) => {
        const key = /^[A-Za-z0-9_./-]+$/.test(k) ? k : JSON.stringify(k);
        if (v && typeof v === 'object' && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
          return `${pad}${key}:\n${toYaml(v, Array.isArray(v) ? indent + 2 : indent + 2)}`;
        }
        if (Array.isArray(v)) return `${pad}${key}: []\n`;
        if (v && typeof v === 'object') return `${pad}${key}: {}\n`;
        return `${pad}${key}: ${scalar(v)}\n`;
      })
      .join('');
  }
  return `${pad}${scalar(value)}\n`;
}
