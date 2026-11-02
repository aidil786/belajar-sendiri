// Pure logic for ComposeCanvas: services on a canvas → a compose.yaml that writes itself.
// Output follows the Compose Specification (services, image/build, ports, environment, volumes,
// networks, depends_on with condition, healthcheck; top-level networks and volumes). Tests parse
// it with the `yaml` package; scripts/docker-games/verify-compose.ts runs `docker compose config`.

export type Condition = 'service_started' | 'service_healthy' | 'service_completed_successfully';
export const CONDITIONS: Condition[] = ['service_started', 'service_healthy', 'service_completed_successfully'];

export interface PaletteService {
  /** The service name in compose.yaml. */
  id: string;
  /** Text on the chip (default: the id). */
  label?: string;
  image?: string;
  /** Build folder, e.g. "./api" (used when there is no image). */
  build?: string;
  ports?: string[];
  environment?: Record<string, string | number | boolean>;
  healthcheck?: { test: string | string[]; interval?: string; timeout?: string; retries?: number };
  /** Where a named volume mounts in this service, e.g. "/var/lib/postgresql". Needed to attach a volume. */
  volumeTarget?: string;
  /** Plain words: what this service is. */
  means?: string;
}

export interface CanvasService {
  id: string;
  networks: string[];
  volume: string | null;
  dependsOn: Partial<Record<string, Condition>>;
}

export interface ComposeGoal {
  /** These services must be on the canvas. */
  services?: string[];
  /** service → named volume it must use. */
  volumes?: Record<string, string>;
  /** service → networks it must be on (it may be on more). */
  networks?: Record<string, string[]>;
  /** service → { other: condition }: it must wait for the other service like this. */
  dependsOn?: Record<string, Record<string, Condition>>;
  /** No services other than `services`. */
  only?: boolean;
}

export function emptyService(id: string): CanvasService {
  return { id, networks: [], volume: null, dependsOn: {} };
}

/** A YAML scalar: plain when safe, else JSON-quoted (a valid YAML double-quoted string). */
export function scalar(v: string | number | boolean): string {
  if (typeof v !== 'string') return String(v);
  const risky =
    v === '' ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`~]|:\s|\s#|\s$|:$/.test(v) ||
    /^(true|false|yes|no|on|off|null|y|n|~)$/i.test(v) ||
    /^[-+]?(\d|\.\d)/.test(v);
  return risky ? JSON.stringify(v) : v;
}

/** Build compose.yaml from the canvas. Services keep the order they were added. */
export function composeYaml(palette: PaletteService[], canvas: CanvasService[]): string {
  const byId = new Map(palette.map((p) => [p.id, p]));
  const out: string[] = ['services:'];
  if (!canvas.length) out[0] = 'services: {}';
  const nets = new Set<string>();
  const vols = new Set<string>();
  for (const s of canvas) {
    const p = byId.get(s.id);
    if (!p) continue;
    out.push(`  ${s.id}:`);
    if (p.image) out.push(`    image: ${scalar(p.image)}`);
    else out.push(`    build: ${scalar(p.build ?? `./${s.id}`)}`);
    if (p.ports?.length) {
      out.push('    ports:');
      for (const port of p.ports) out.push(`      - ${JSON.stringify(port)}`);
    }
    const env = Object.entries(p.environment ?? {});
    if (env.length) {
      out.push('    environment:');
      for (const [k, v] of env) out.push(`      ${k}: ${scalar(v)}`);
    }
    if (s.volume && p.volumeTarget) {
      vols.add(s.volume);
      out.push('    volumes:');
      out.push(`      - ${s.volume}:${p.volumeTarget}`);
    }
    if (s.networks.length) {
      out.push('    networks:');
      for (const n of s.networks) {
        nets.add(n);
        out.push(`      - ${n}`);
      }
    }
    const deps = Object.entries(s.dependsOn).filter(([id, c]) => c && canvas.some((x) => x.id === id));
    if (deps.length) {
      out.push('    depends_on:');
      for (const [id, c] of deps) {
        out.push(`      ${id}:`);
        out.push(`        condition: ${c}`);
      }
    }
    if (p.healthcheck) {
      out.push('    healthcheck:');
      const test = Array.isArray(p.healthcheck.test) ? `[${p.healthcheck.test.map((x) => JSON.stringify(x)).join(', ')}]` : scalar(p.healthcheck.test);
      out.push(`      test: ${test}`);
      if (p.healthcheck.interval) out.push(`      interval: ${p.healthcheck.interval}`);
      if (p.healthcheck.timeout) out.push(`      timeout: ${p.healthcheck.timeout}`);
      if (p.healthcheck.retries !== undefined) out.push(`      retries: ${p.healthcheck.retries}`);
    }
  }
  if (nets.size) {
    out.push('networks:');
    for (const n of nets) out.push(`  ${n}: {}`);
  }
  if (vols.size) {
    out.push('volumes:');
    for (const v of vols) out.push(`  ${v}: {}`);
  }
  return out.join('\n') + '\n';
}

/** Indent depth (in 2-space steps) of each line, for drawing indent guides. */
export function indentLevels(yaml: string): number[] {
  return yaml
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => Math.floor((/^ */.exec(l)?.[0].length ?? 0) / 2));
}

/** Line numbers (0-based) that are new or changed in `after` compared with `before`. */
export function changedLines(before: string, after: string): number[] {
  const old = new Map<string, number>();
  for (const l of before.split('\n')) old.set(l, (old.get(l) ?? 0) + 1);
  const out: number[] = [];
  after
    .replace(/\n$/, '')
    .split('\n')
    .forEach((l, i) => {
      const n = old.get(l) ?? 0;
      if (n > 0) old.set(l, n - 1);
      else out.push(i);
    });
  return out;
}

/** Services in the order `docker compose up` starts them (what each depends on comes first). */
export function startOrder(canvas: CanvasService[]): string[] {
  const done: string[] = [];
  const ids = new Set(canvas.map((s) => s.id));
  const visit = (id: string, seen: Set<string>) => {
    if (done.includes(id) || seen.has(id) || !ids.has(id)) return;
    seen.add(id);
    const s = canvas.find((x) => x.id === id)!;
    for (const [dep, c] of Object.entries(s.dependsOn)) if (c) visit(dep, seen);
    done.push(id);
  };
  for (const s of canvas) visit(s.id, new Set());
  return done;
}

/** A service that waits for itself through others (a → b → a). Compose refuses that. */
export function findCycle(canvas: CanvasService[]): string[] | null {
  const byId = new Map(canvas.map((s) => [s.id, s]));
  const walk = (id: string, path: string[]): string[] | null => {
    if (path.includes(id)) return [...path.slice(path.indexOf(id)), id];
    const s = byId.get(id);
    if (!s) return null;
    for (const [dep, c] of Object.entries(s.dependsOn)) {
      if (!c) continue;
      const hit = walk(dep, [...path, id]);
      if (hit) return hit;
    }
    return null;
  };
  for (const s of canvas) {
    const c = walk(s.id, []);
    if (c) return c;
  }
  return null;
}

export type ComposeVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing'; service: string }
  | { ok: false; reason: 'extra'; service: string }
  | { ok: false; reason: 'volume'; service: string; volume: string }
  | { ok: false; reason: 'network'; service: string; network: string }
  | { ok: false; reason: 'dependsOn'; service: string; on: string; condition: Condition; got: Condition | null }
  | { ok: false; reason: 'noHealthcheck'; service: string; on: string }
  | { ok: false; reason: 'cycle'; path: string[] };

/** Check the canvas against the goal. Reports the first problem, in build order. */
export function checkCompose(goal: ComposeGoal, canvas: CanvasService[], palette: PaletteService[]): ComposeVerdict {
  const has = (id: string) => canvas.find((s) => s.id === id);
  for (const id of goal.services ?? []) if (!has(id)) return { ok: false, reason: 'missing', service: id };
  if (goal.only) {
    const extra = canvas.find((s) => !(goal.services ?? []).includes(s.id));
    if (extra) return { ok: false, reason: 'extra', service: extra.id };
  }
  const cycle = findCycle(canvas);
  if (cycle) return { ok: false, reason: 'cycle', path: cycle };
  // Waiting for "healthy" needs a healthcheck on the other service.
  for (const s of canvas) {
    for (const [on, c] of Object.entries(s.dependsOn)) {
      if (c === 'service_healthy' && has(on) && !palette.find((p) => p.id === on)?.healthcheck) return { ok: false, reason: 'noHealthcheck', service: s.id, on };
    }
  }
  for (const [id, volume] of Object.entries(goal.volumes ?? {})) {
    const s = has(id);
    if (!s) return { ok: false, reason: 'missing', service: id };
    if (s.volume !== volume) return { ok: false, reason: 'volume', service: id, volume };
  }
  for (const [id, nets] of Object.entries(goal.networks ?? {})) {
    const s = has(id);
    if (!s) return { ok: false, reason: 'missing', service: id };
    const miss = nets.find((n) => !s.networks.includes(n));
    if (miss) return { ok: false, reason: 'network', service: id, network: miss };
  }
  for (const [id, deps] of Object.entries(goal.dependsOn ?? {})) {
    const s = has(id);
    if (!s) return { ok: false, reason: 'missing', service: id };
    for (const [on, condition] of Object.entries(deps)) {
      const got = s.dependsOn[on] ?? null;
      if (got !== condition) return { ok: false, reason: 'dependsOn', service: id, on, condition, got };
    }
  }
  return { ok: true };
}

/** Names of the networks and volumes to offer: the given lists, or the ones the goal uses. */
export function offered(goal: ComposeGoal, networks?: string[], volumes?: string[]): { networks: string[]; volumes: string[] } {
  const n = networks ?? [...new Set(Object.values(goal.networks ?? {}).flat())];
  const v = volumes ?? [...new Set(Object.values(goal.volumes ?? {}))];
  return { networks: n, volumes: v };
}
