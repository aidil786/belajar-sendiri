// Author checks for the Ship It Docker games: KekLapisBuilder, OrderHatch, LockerTest,
// ComposeCanvas, ShrinkRay, NamespaceXray. An empty list means the props make sense:
// ids exist, the task is possible, and it isn't already done at the start.
import { parseSize, MB } from '../../src/lib/dockerUnits';
import { checkKek, layerKind, normaliseLines, rebuild, type KekEdit, type KekGoal, type KekLine, type KekLineProp } from '../../src/lib/kekLapis';
import { checkHatch, hostPortList, wanted, type Cable, type HatchContainer, type HatchTask } from '../../src/lib/orderHatch';
import { ACTIONS, KINDS, type LockerMount } from '../../src/lib/lockerTest';
import { checkCompose, CONDITIONS, emptyService, offered, type CanvasService, type ComposeGoal, type PaletteService } from '../../src/lib/composeCanvas';
import { APPS, movesFor, reachable, sizeOf, startRecipe, type Move, type Recipe, type ShrinkApp } from '../../src/lib/shrinkRay';
import { ANSWER, DOCKER_DEFAULT, shownSwitches, SWITCHES, taskDone, type Switch, type XrayTask } from '../../src/lib/namespaceXray';

export const DOCKER_REQUIRED: Record<string, string[]> = {
  KekLapisBuilder: ['lines', 'edit'],
  OrderHatch: ['containers', 'task'],
  LockerTest: [],
  ComposeCanvas: ['palette'],
  ShrinkRay: ['target'],
  NamespaceXray: [],
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Every order of the non-FROM lines and every pick of their versions, up to `cap` tries. */
function kekReachable(lines: KekLine[], edit: KekEdit, goal: KekGoal, cap = 60000): boolean | null {
  const [from, ...rest] = lines;
  if (!from) return false;
  let tries = 0;
  const perms = (xs: KekLine[]): KekLine[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  for (const order of perms(rest)) {
    const picks = (i: number, acc: KekLine[]): boolean => {
      if (++tries > cap) throw new Error('cap');
      if (i === order.length) {
        const all = [from, ...acc];
        return checkKek(goal, all, rebuild(all, edit)).ok;
      }
      return order[i]!.options.some((o) => picks(i + 1, [...acc, { ...order[i]!, text: o.text, size: o.size }]));
    };
    try {
      if (picks(0, [])) return true;
    } catch {
      return null; // too many to try: don't judge
    }
  }
  return false;
}

export function checkDockerGame(name: string, a: Record<string, unknown>, where: string): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`${where}: ${name} ${m}`);

  if (name === 'KekLapisBuilder') {
    const props = a.lines as KekLineProp[];
    if (!Array.isArray(props) || props.length < 2) return [`${where}: ${name} needs at least 2 lines`];
    if (props.some((l) => typeof l?.text !== 'string')) {
      err('every line needs text');
      return errors;
    }
    const lines = normaliseLines(props);
    if (layerKind(lines[0]!.text) !== 'base') err('line 1 must be a FROM line');
    if (lines.slice(1).some((l) => layerKind(l.text) === 'base')) err('has a second FROM (one stage only)');
    const ids = lines.map((l) => l.id);
    if (new Set(ids).size !== ids.length) err('has duplicate line ids');
    for (const [i, l] of props.entries()) {
      if (l.size !== undefined && parseSize(l.size) === null) err(`line ${i + 1} has a size it can't read: "${String(l.size)}"`);
      for (const c of l.changes ?? []) if (typeof c !== 'string' && parseSize(c.size) === null && c.size !== undefined) err(`line ${i + 1} has a change size it can't read`);
    }
    const edit = a.edit as KekEdit;
    const eo = isObj(a.edit) ? a.edit : null;
    if (typeof a.edit !== 'string' && !(eo && (typeof eo.file === 'string' || (typeof eo.line === 'string' && typeof eo.text === 'string')))) err('edit must be a file name, { file } or { line, text }');
    else if (eo && typeof eo.line === 'string' && !ids.includes(eo.line)) err(`edit line "${eo.line}" is not a line id`);
    const goal = a.goal as KekGoal | undefined;
    if (goal !== undefined) {
      if (!isObj(a.goal)) err('goal must be an object');
      else {
        for (const k of Object.keys(goal)) if (!['cached', 'cachedAfterEdit', 'order'].includes(k)) err(`unknown goal key "${k}"`);
        for (const id of [...(goal.cached ?? []), ...(goal.order ?? [])]) if (!ids.includes(id)) err(`goal names line "${id}", which is not a line id`);
        if (!errors.length) {
          if (checkKek(goal, lines, rebuild(lines, edit)).ok) err('goal is already met at the start');
          else if (kekReachable(lines, edit, goal) === false) err('goal cannot be reached by reordering or picking lines');
        }
      }
    }
  }

  if (name === 'OrderHatch') {
    const containers = a.containers as HatchContainer[];
    if (!Array.isArray(containers) || !containers.length) return [`${where}: ${name} needs containers`];
    const names = containers.map((c) => c.name);
    if (new Set(names).size !== names.length) err('has duplicate container names');
    for (const c of containers) if (!Array.isArray(c.ports) || !c.ports.length || c.ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) err(`container "${c.name}" needs ports (1–65535)`);
    const task = a.task as HatchTask;
    const start = (a.start ?? []) as Cable[];
    const hosts = hostPortList(task, start, a.hostPorts as number[] | undefined);
    const seen = new Set<number>();
    for (const c of start) {
      if (seen.has(c.host)) err(`start has two cables on laptop port ${c.host}`);
      seen.add(c.host);
      if (!containers.some((x) => x.name === c.container && x.ports.includes(c.port))) err(`start cable goes to ${c.container}:${c.port}, which doesn't exist`);
      if (!hosts.includes(c.host)) err(`start cable uses laptop port ${c.host}, which is not in hostPorts`);
    }
    if (!isObj(task) || task.type !== 'map') err('task must be { type: "map", ... }');
    else {
      for (const w of wanted(task)) {
        if (!containers.some((x) => x.name === w.container && x.ports.includes(w.port))) err(`task wants ${w.container}:${w.port}, which doesn't exist`);
        if (w.host !== undefined && !hosts.includes(w.host)) err(`task wants laptop port ${w.host}, which is not in hostPorts`);
        if (w.host === undefined && hosts.every((h) => start.some((c) => c.host === h))) err('every laptop port is taken at the start');
      }
      if (!errors.length && checkHatch(task, start).ok) err('task is already done at the start');
    }
  }

  if (name === 'LockerTest') {
    for (const m of (a.mounts ?? []) as (LockerMount | string)[]) {
      const kind = typeof m === 'string' ? m : m?.kind;
      if (!KINDS.includes(kind as never)) err(`unknown mount kind "${String(kind)}"`);
    }
    const ask = a.ask === undefined ? [] : Array.isArray(a.ask) ? a.ask : [a.ask];
    for (const x of ask) if (!ACTIONS.includes(x as never)) err(`unknown ask "${String(x)}" (use ${ACTIONS.join(', ')})`);
  }

  if (name === 'ComposeCanvas') {
    const palette = a.palette as PaletteService[];
    if (!Array.isArray(palette) || !palette.length) return [`${where}: ${name} needs a palette`];
    const ids = palette.map((p) => p.id);
    if (new Set(ids).size !== ids.length) err('palette has duplicate ids');
    for (const p of palette) {
      if (!/^[a-z0-9][a-z0-9_.-]*$/.test(p.id)) err(`service id "${p.id}" is not a valid Compose service name`);
      if (!p.image && !p.build) err(`service "${p.id}" needs an image or a build folder`);
    }
    const goal = (a.goal ?? {}) as ComposeGoal;
    const offer = offered(goal, a.networks as string[] | undefined, a.volumes as string[] | undefined);
    for (const id of [...(goal.services ?? []), ...Object.keys(goal.volumes ?? {}), ...Object.keys(goal.networks ?? {}), ...Object.keys(goal.dependsOn ?? {})]) {
      if (!ids.includes(id)) err(`goal names service "${id}", which is not in the palette`);
    }
    for (const [id, v] of Object.entries(goal.volumes ?? {})) {
      if (!palette.find((p) => p.id === id)?.volumeTarget) err(`goal gives "${id}" a volume, but it has no volumeTarget`);
      if (!offer.volumes.includes(v)) err(`goal volume "${v}" is not offered`);
    }
    for (const nets of Object.values(goal.networks ?? {})) for (const n of nets) if (!offer.networks.includes(n)) err(`goal network "${n}" is not offered`);
    for (const deps of Object.values(goal.dependsOn ?? {})) {
      for (const [on, c] of Object.entries(deps)) {
        if (!CONDITIONS.includes(c)) err(`unknown condition "${c}"`);
        if (!ids.includes(on)) err(`goal waits for "${on}", which is not in the palette`);
        if (c === 'service_healthy' && !palette.find((p) => p.id === on)?.healthcheck) err(`goal waits for "${on}" to be healthy, but it has no healthcheck`);
      }
    }
    const start = ((a.start ?? []) as (string | { id: string })[]).map((s) => (typeof s === 'string' ? s : s.id));
    for (const id of start) if (!ids.includes(id)) err(`start service "${id}" is not in the palette`);
    if (a.goal !== undefined && !errors.length) {
      const canvas: CanvasService[] = ((a.start ?? []) as (string | (Partial<CanvasService> & { id: string }))[]).map((s) => (typeof s === 'string' ? emptyService(s) : { ...emptyService(s.id), ...s }));
      if (checkCompose(goal, canvas, palette).ok) err('goal is already met at the start');
    }
  }

  if (name === 'ShrinkRay') {
    const app = (a.app ?? 'node-api') as ShrinkApp;
    if (!(app in APPS)) return [`${where}: ${name} unknown app "${String(app)}" (use ${Object.keys(APPS).join(', ')})`];
    const target = a.target as number;
    if (typeof target !== 'number' || target <= 0) err('target must be a size in MB, above 0');
    const options = a.options as Move[] | undefined;
    for (const m of options ?? []) if (!APPS[app].moves.includes(m)) err(`unknown option "${m}" for ${app} (use ${APPS[app].moves.join(', ')})`);
    const start: Recipe = startRecipe(app, a.start as Partial<Recipe> | undefined);
    if (a.start !== undefined && sizeOf(app, { ...APPS[app].start, ...(a.start as Partial<Recipe>) }) === null) err('start is a recipe that cannot be built');
    if (!errors.length) {
      if ((sizeOf(app, start) ?? 0) <= target * MB) err('start is already under the target');
      else if (!reachable(app, start, movesFor(app, options), target * MB)) err(`target ${target} MB cannot be reached with these options`);
    }
  }

  if (name === 'NamespaceXray') {
    const task = (a.task ?? { type: 'all' }) as XrayTask;
    const start = new Set((a.start ?? []) as Switch[]);
    const listed = (a.switches ?? []) as Switch[];
    for (const s of [...start, ...listed]) if (!SWITCHES.includes(s)) err(`unknown switch "${s}"`);
    const shown = shownSwitches(listed);
    const hidden = (need: Switch[]) => need.filter((s) => !shown.includes(s));
    if (!isObj(task) || !['all', 'docker', 'find', 'turnOn'].includes(task.type)) err('task type must be all, docker, find or turnOn');
    else if (task.type === 'find' && !(task.what in ANSWER)) err(`unknown question "${String(task.what)}" (use ${Object.keys(ANSWER).join(', ')})`);
    else if (task.type === 'find' && start.has(ANSWER[task.what])) err('the answer switch is already on at the start');
    else if (task.type === 'turnOn' && (!Array.isArray(task.switches) || task.switches.some((s) => !SWITCHES.includes(s)))) err('turnOn needs known switches');
    else {
      const need = task.type === 'find' ? [ANSWER[task.what]] : task.type === 'docker' ? DOCKER_DEFAULT : task.type === 'turnOn' ? task.switches : [];
      if (hidden(need).length) err(`task needs switches that are not shown: ${hidden(need).join(', ')}`);
      else if (task.type !== 'find' && taskDone(task, start, null, shown)) err('task is already done at the start');
    }
  }

  return errors;
}
