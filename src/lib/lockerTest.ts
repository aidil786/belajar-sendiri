// Pure logic for LockerTest: where does a container keep data, and what survives?
//   writable  the container's own top layer (inside the lunchbox)
//   volume    a named volume Docker keeps outside the container (a locker)
//   bind      a folder from your laptop (your own shelf)
//   tmpfs     memory only (a note on the whiteboard)
// Checked on Docker 29: `docker restart` keeps the writable layer but empties tmpfs;
// `docker rm` + `docker run` loses the writable layer and tmpfs, keeps volumes and bind mounts;
// `docker volume rm` (after the container is gone) deletes the volume. A bind mount's files stay on your laptop.

export type StoreKind = 'writable' | 'volume' | 'bind' | 'tmpfs';
export type LockerAction = 'restart' | 'recreate' | 'volumeRm';
export const KINDS: StoreKind[] = ['writable', 'volume', 'bind', 'tmpfs'];
export const ACTIONS: LockerAction[] = ['restart', 'recreate', 'volumeRm'];

export interface LockerMount {
  kind: StoreKind;
  /** Path inside the container. The writable layer uses it as the file's folder. */
  target?: string;
  /** Volume name (volume) or laptop folder (bind). */
  name?: string;
  /** The file kept there, e.g. "orders.db". */
  file?: string;
}

export interface Store {
  kind: StoreKind;
  target: string;
  name: string;
  file: string;
}

const DEFAULTS: Record<StoreKind, Store> = {
  writable: { kind: 'writable', target: '/app', name: '', file: 'today.txt' },
  volume: { kind: 'volume', target: '/data', name: 'kedai-data', file: 'orders.db' },
  bind: { kind: 'bind', target: '/menu', name: './menu', file: 'menu.md' },
  tmpfs: { kind: 'tmpfs', target: '/tmp/cache', name: '', file: 'cache.bin' },
};

export function stores(mounts?: (LockerMount | StoreKind)[]): Store[] {
  const list = mounts?.length ? mounts : KINDS;
  return list.map((m) => {
    const p: LockerMount = typeof m === 'string' ? { kind: m } : m;
    const d = DEFAULTS[p.kind];
    return { kind: p.kind, target: p.target ?? d.target, name: p.name ?? d.name, file: p.file ?? d.file };
  });
}

/** Does data in this kind of storage survive the action? */
export function survives(kind: StoreKind, action: LockerAction): boolean {
  if (kind === 'bind') return true;
  if (kind === 'tmpfs') return false;
  if (kind === 'volume') return action !== 'volumeRm';
  return action === 'restart'; // writable layer
}

/** The -v / --tmpfs flags for docker run. */
export function mountFlags(list: Store[]): string[] {
  return list.flatMap((s) => {
    if (s.kind === 'volume') return [`-v ${s.name}:${s.target}`];
    if (s.kind === 'bind') return [`-v ${s.name}:${s.target}`];
    if (s.kind === 'tmpfs') return [`--tmpfs ${s.target}`];
    return [];
  });
}

export function runLine(list: Store[], container: string, image: string): string {
  return ['docker run -d --name', container, ...mountFlags(list), image].join(' ');
}

/** The real commands an action runs, in order. */
export function actionCommands(action: LockerAction, list: Store[], container = 'kedai', image = 'nginx:1.29-alpine'): string[] {
  if (action === 'restart') return [`docker restart ${container}`];
  const run = runLine(list, container, image);
  if (action === 'recreate') return [`docker rm -f ${container}`, run];
  const volumes = list.filter((s) => s.kind === 'volume').map((s) => s.name);
  return [`docker rm -f ${container}`, ...(volumes.length ? [`docker volume rm ${volumes.join(' ')}`] : []), run];
}

/** Full path of the data file inside the container. */
export function filePath(s: Store): string {
  return `${s.target.replace(/\/+$/, '')}/${s.file}`;
}

export interface Score {
  right: number;
  total: number;
  /** Indexes of stores the learner guessed wrong (or skipped). */
  wrong: number[];
}

export function score(list: Store[], action: LockerAction, guess: (boolean | null)[]): Score {
  const wrong = list.flatMap((s, i) => (guess[i] === survives(s.kind, action) ? [] : [i]));
  return { right: list.length - wrong.length, total: list.length, wrong };
}

export function normaliseAsk(ask?: LockerAction | LockerAction[]): LockerAction[] {
  const list = ask === undefined ? ['recreate' as const] : Array.isArray(ask) ? ask : [ask];
  return list.filter((a) => ACTIONS.includes(a));
}
