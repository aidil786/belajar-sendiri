// Pure logic for OrderHatch: port mapping as cables from your laptop's ports
// (the order hatch) to a container's ports. `-p 8080:80` = laptop 8080 → container 80.
// One laptop port takes one cable: a second one fails like Docker does
// ("Bind for 0.0.0.0:8080 failed: port is already allocated").

export interface HatchContainer {
  name: string;
  /** Ports the app inside listens on. */
  ports: number[];
  /** Image for the docker run line. Default nginx:1.29-alpine. */
  image?: string;
}

export interface Cable {
  host: number;
  container: string;
  port: number;
}

/** One cable the task needs. `host` left out: any free laptop port is fine. */
export interface WantedCable {
  container: string;
  port: number;
  host?: number;
}

export type HatchTask = { type: 'map'; maps: WantedCable[] } | ({ type: 'map' } & WantedCable);

export const DEFAULT_IMAGE = 'nginx:1.29-alpine';

export function wanted(task: HatchTask): WantedCable[] {
  if ('maps' in task) return task.maps;
  const { container, port, host } = task;
  return [host === undefined ? { container, port } : { container, port, host }];
}

/** Laptop ports to offer: the given list, or every port the task and start cables use plus 8080 and 3000. */
export function hostPortList(task: HatchTask, start: Cable[], given?: number[]): number[] {
  if (given?.length) return [...new Set(given)];
  const set = new Set<number>([...start.map((c) => c.host), ...wanted(task).flatMap((w) => (w.host === undefined ? [] : [w.host])), 8080, 3000]);
  return [...set].sort((a, b) => a - b);
}

export type PlugResult = { ok: true; cables: Cable[] } | { ok: false; reason: 'allocated'; by: Cable } | { ok: false; reason: 'same' };

/** Plug a cable. A laptop port that already has a cable refuses the second one. */
export function plug(cables: Cable[], cable: Cable): PlugResult {
  const by = cables.find((c) => c.host === cable.host);
  if (by) return by.container === cable.container && by.port === cable.port ? { ok: false, reason: 'same' } : { ok: false, reason: 'allocated', by };
  return { ok: true, cables: [...cables, cable] };
}

export function unplug(cables: Cable[], host: number): Cable[] {
  return cables.filter((c) => c.host !== host);
}

/** Docker's real error text for a laptop port in use. */
export function allocatedError(host: number): string {
  return `Bind for 0.0.0.0:${host} failed: port is already allocated`;
}

/** The docker run line for one container with its cables, e.g. `docker run -d --name web -p 8080:80 nginx:1.29-alpine`. */
export function runCommand(c: HatchContainer, cables: Cable[]): string {
  const flags = cables
    .filter((x) => x.container === c.name)
    .sort((a, b) => a.host - b.host)
    .map((x) => `-p ${x.host}:${x.port}`);
  return ['docker run -d --name', c.name, ...flags, c.image ?? DEFAULT_IMAGE].join(' ');
}

export type HatchVerdict = { ok: true } | { ok: false; missing: WantedCable; wrong: Cable | null };

/** Is every wanted cable plugged? `wrong` is a cable on the right laptop port that goes somewhere else. */
export function checkHatch(task: HatchTask, cables: Cable[]): HatchVerdict {
  for (const w of wanted(task)) {
    const hit = cables.find((c) => c.container === w.container && c.port === w.port && (w.host === undefined || c.host === w.host));
    if (!hit) {
      const wrong = (w.host !== undefined ? cables.find((c) => c.host === w.host) : null) ?? null;
      return { ok: false, missing: w, wrong };
    }
  }
  return { ok: true };
}

/** Which cable a browser request to localhost:<host> takes, if any. */
export function route(cables: Cable[], host: number): Cable | null {
  return cables.find((c) => c.host === host) ?? null;
}

/** The laptop port to send the demo request to: the first wanted cable that is plugged. */
export function requestPort(task: HatchTask, cables: Cable[]): number | null {
  for (const w of wanted(task)) {
    const hit = cables.find((c) => c.container === w.container && c.port === w.port && (w.host === undefined || c.host === w.host));
    if (hit) return hit.host;
  }
  return null;
}
