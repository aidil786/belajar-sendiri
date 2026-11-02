// kubectl's flag parsing: global flags anywhere, `--flag=value` or `--flag value`,
// short flags (-n shop, -nshop, -oyaml, -it), `--` before a container command.

const SHORT: Record<string, string> = {
  n: 'namespace',
  o: 'output',
  l: 'selector',
  k: 'kustomize',
  c: 'container',
  p: 'previous',
  w: 'watch',
  A: 'all-namespaces',
  i: 'stdin',
  t: 'tty',
  h: 'help',
  R: 'recursive',
  q: 'quiet',
};

/** Flags that take a value (for every command). */
const VALUE = new Set([
  'namespace', 'output', 'selector', 'filename', 'kustomize', 'container', 'context', 'as', 'as-group', 'replicas', 'image', 'port',
  'target-port', 'type', 'name', 'grace-period', 'timeout', 'tail', 'to-revision', 'revision', 'field-selector', 'sort-by', 'schedule',
  'from-literal', 'from-file', 'from-env-file', 'protocol', 'tcp', 'restart', 'env', 'labels', 'cascade', 'for', 'min', 'max', 'cpu-percent',
  'cpu', 'memory', 'verb', 'subresource', 'serviceaccount', 'user', 'group', 'role', 'clusterrole', 'resource', 'resource-name', 'hard', 'selector',
  'cluster', 'kubeconfig', 'set', 'values', 'version', 'target', 'image-pull-policy', 'node-port', 'external-ip', 'session-affinity',
  'max-log-requests', 'since', 'max-surge', 'max-unavailable', 'rule', 'class', 'min-available', 'max-unavailable', 'docker-server', 'request-timeout',
  'address', 'field-manager', 'template', 'copy-to', 'profile', 'overrides', 'show-kind', 'chunk-size', 'raw', 'record',
  'requests', 'limits', 'from',
]);

/** Flags that are on/off; `--wait=false` style works too. */
const BOOL = new Set([
  'all-namespaces', 'watch', 'show-labels', 'previous', 'stdin', 'tty', 'help', 'overwrite', 'all', 'ignore-daemonsets', 'delete-emptydir-data',
  'force', 'wait', 'rm', 'command', 'list', 'current', 'client', 'minify', 'recursive', 'server-side', 'no-headers', 'follow', 'quiet',
  'containers', 'ignore-not-found', 'local', 'prefix', 'timestamps', 'save-config', 'disable-eviction', 'raw', 'expose', 'dry-run', 'short',
  'show-managed-fields', 'privileged', 'ignore-errors', 'insecure-skip-tls-verify', 'watch-only', 'all-containers', 'v',
]);

export interface Parsed {
  words: string[];
  flags: Record<string, string[]>;
  /** Words after `--`. */
  after: string[] | null;
  unknown: string[];
}

/** Value-taking flags that are boolean for some commands (logs -f, top --containers …). */
export function parseArgs(words: string[], opts: { followShortF?: boolean } = {}): Parsed {
  const flags: Record<string, string[]> = {};
  const out: string[] = [];
  const unknown: string[] = [];
  let after: string[] | null = null;
  const set = (k: string, v: string) => {
    (flags[k] ??= []).push(v);
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === '--') {
      after = words.slice(i + 1);
      break;
    }
    if (w.startsWith('--') && w.length > 2) {
      const eq = w.indexOf('=');
      const name = eq >= 0 ? w.slice(2, eq) : w.slice(2);
      const inline = eq >= 0 ? w.slice(eq + 1) : null;
      if (name === 'dry-run') {
        set('dry-run', inline ?? 'client');
        continue;
      }
      if (name === 'filename') {
        set('filename', inline ?? words[++i] ?? '');
        continue;
      }
      if (BOOL.has(name) && !VALUE.has(name)) {
        set(name, inline ?? 'true');
        continue;
      }
      if (VALUE.has(name)) {
        set(name, inline ?? words[++i] ?? '');
        continue;
      }
      unknown.push(`--${name}`);
      if (inline === null && words[i + 1] && !words[i + 1]!.startsWith('-')) {
        // keep going; the value (if any) stays a word
      }
      continue;
    }
    if (w.startsWith('-') && w.length > 1 && !/^-\d/.test(w)) {
      const letters = w.slice(1);
      const first = letters[0]!;
      if (first === 'f') {
        if (opts.followShortF) {
          set('follow', 'true');
          if (letters.length > 1) for (const ch of letters.slice(1)) set(SHORT[ch] ?? ch, 'true');
          continue;
        }
        set('filename', letters.length > 1 ? letters.slice(1).replace(/^=/, '') : (words[++i] ?? ''));
        continue;
      }
      const name = SHORT[first];
      if (!name) {
        unknown.push(`-${first}`);
        continue;
      }
      if (VALUE.has(name) && !BOOL.has(name)) {
        set(name, letters.length > 1 ? letters.slice(1).replace(/^=/, '') : (words[++i] ?? ''));
        continue;
      }
      // Bool shorts can be combined: -it
      for (const ch of letters) {
        const n = SHORT[ch];
        if (n) set(n, 'true');
        else unknown.push(`-${ch}`);
      }
      continue;
    }
    out.push(w);
  }
  return { words: out, flags, after, unknown };
}

export function flag(p: Parsed, name: string): string | undefined {
  const v = p.flags[name];
  return v ? v[v.length - 1] : undefined;
}

export function flagAll(p: Parsed, name: string): string[] {
  return p.flags[name] ?? [];
}

export function bool(p: Parsed, name: string, dflt = false): boolean {
  const v = flag(p, name);
  if (v === undefined) return dflt;
  return v !== 'false';
}

/** Find the kubectl sub-command (the first word that isn't a flag or a flag's value). */
export function findCommand(words: string[]): { cmd: string | undefined; index: number } {
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === '--') return { cmd: undefined, index: -1 };
    if (w.startsWith('--')) {
      const name = w.slice(2).split('=')[0]!;
      if (!w.includes('=') && VALUE.has(name) && !BOOL.has(name)) i++;
      continue;
    }
    if (w.startsWith('-') && w.length > 1) {
      const name = SHORT[w[1]!];
      if (w.length === 2 && name && VALUE.has(name) && !BOOL.has(name)) i++;
      continue;
    }
    return { cmd: w, index: i };
  }
  return { cmd: undefined, index: -1 };
}
