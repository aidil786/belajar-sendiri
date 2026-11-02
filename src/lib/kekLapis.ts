// Pure logic for KekLapisBuilder: Dockerfile lines stack like layers of kek lapis.
// Build once, change one file (or one line), build again: Docker reuses ("CACHED") every
// layer up to the first one that changed. That layer and every layer on top of it bake again.
//
// One stage only (a single FROM). Settings lines (ENV, CMD, EXPOSE, ...) add no files: they
// show as thin 0B layers, like `docker history`, and BuildKit doesn't count them as steps.
import { parseSize } from './dockerUnits';

export interface KekLineProp {
  /** Needed when the goal names lines. Default: l1, l2, ... in the given order. */
  id?: string;
  /** The Dockerfile line, e.g. "COPY . .". */
  text: string;
  /** Layer size: bytes, or text like "12.8MB". Settings lines default to 0B. */
  size?: number | string;
  /** Other versions of this line the learner can pick from (a select), each with its own size if you like. */
  changes?: (string | { text: string; size?: number | string })[];
}

export interface KekOption {
  text: string;
  size: number | null;
}

export interface KekLine {
  id: string;
  /** The text the learner picked (the line itself or one of its `changes`). */
  text: string;
  options: KekOption[];
  size: number | null;
}

/** What changes between the two builds. A string is a file name. */
export type KekEdit = string | { file: string; label?: string } | { line: string; text: string; label?: string };

export interface KekGoal {
  /** At least this many build steps (RUN, COPY, ADD, WORKDIR) stay CACHED after the edit. */
  cachedAfterEdit?: number;
  /** These line ids must stay CACHED after the edit. */
  cached?: string[];
  /** Line ids in this exact order (top of the Dockerfile first). */
  order?: string[];
}

export type LayerKind = 'base' | 'step' | 'settings';
export type MissReason = 'copiesFile' | 'edited' | 'below';

export interface KekLayer {
  id: string;
  /** The text in the second build (an edited line shows its new text). */
  text: string;
  kind: LayerKind;
  size: number | null;
  /** BuildKit step number ("[3/5]") for base and step layers. */
  step: number | null;
  cached: boolean;
  reason: MissReason | null;
}

export interface KekBuild {
  layers: KekLayer[];
  /** Index of the first layer that bakes again, or -1 when everything is cached. */
  firstMiss: number;
  steps: number;
  cachedSteps: number;
  /** Bytes baked again in the second build. */
  rebakedBytes: number;
}

const SETTINGS = new Set(['ENV', 'CMD', 'ENTRYPOINT', 'EXPOSE', 'LABEL', 'USER', 'ARG', 'HEALTHCHECK', 'STOPSIGNAL', 'SHELL', 'VOLUME', 'ONBUILD', 'MAINTAINER']);

export function keyword(text: string): string {
  return (/^\s*(\w+)/.exec(text)?.[1] ?? '').toUpperCase();
}

export function layerKind(text: string): LayerKind {
  const k = keyword(text);
  if (k === 'FROM') return 'base';
  return SETTINGS.has(k) ? 'settings' : 'step';
}

const sizeFor = (text: string, size: number | string | undefined) => parseSize(size) ?? (layerKind(text) === 'settings' ? 0 : null);

export function normaliseLines(lines: KekLineProp[]): KekLine[] {
  return lines.map((l, i) => {
    const first: KekOption = { text: l.text, size: sizeFor(l.text, l.size) };
    const more = (l.changes ?? []).map((c) => (typeof c === 'string' ? { text: c, size: sizeFor(c, undefined) } : { text: c.text, size: sizeFor(c.text, c.size) })).filter((c) => c.text !== l.text);
    return { id: l.id ?? `l${i + 1}`, text: l.text, options: [first, ...more], size: first.size };
  });
}

/** Pick another version of a line (from its `changes`). */
export function pickOption(lines: KekLine[], index: number, text: string): KekLine[] {
  return lines.map((l, j) => {
    const o = j === index ? l.options.find((x) => x.text === text) : undefined;
    return o ? { ...l, text: o.text, size: o.size } : l;
  });
}

/** Split a line into words, keeping "quoted words" and JSON-array items together. */
function words(text: string): string[] {
  const body = text.trim().replace(/^\w+\s+/, '');
  if (body.startsWith('[')) {
    try {
      const arr = JSON.parse(body) as unknown;
      if (Array.isArray(arr)) return arr.map(String);
    } catch {
      /* not JSON: fall through */
    }
  }
  return [...body.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

/** The build-context paths a COPY/ADD line copies. null: not a COPY/ADD, or copies from another stage/image. */
export function copySources(text: string): string[] | null {
  const k = keyword(text);
  if (k !== 'COPY' && k !== 'ADD') return null;
  const all = words(text);
  if (all.some((w) => /^--from=/i.test(w))) return null;
  const parts = all.filter((w) => !w.startsWith('--'));
  if (parts.length < 2) return [];
  return parts.slice(0, -1).filter((p) => !/^https?:\/\//.test(p));
}

function globToRegex(glob: string): RegExp {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${re}$`);
}

/** Does this COPY/ADD line copy `file` (a path in the build context)? */
export function copiesFile(text: string, file: string): boolean {
  const sources = copySources(text);
  if (!sources) return false;
  const path = file.replace(/^\.\//, '');
  return sources.some((raw) => {
    const src = raw.replace(/^\.\//, '').replace(/\/+$/, '');
    if (src === '' || src === '.') return true;
    if (/[*?]/.test(src)) return globToRegex(src).test(path) || path.startsWith(`${src}/`);
    return path === src || path.startsWith(`${src}/`);
  });
}

export function editFile(edit: KekEdit): string | null {
  if (typeof edit === 'string') return edit;
  return 'file' in edit ? edit.file : null;
}

/** Build once with `lines`, apply `edit`, build again: which layers are CACHED? */
export function rebuild(lines: KekLine[], edit: KekEdit): KekBuild {
  const file = editFile(edit);
  const lineEdit = typeof edit === 'object' && 'line' in edit ? edit : null;
  let firstMiss = -1;
  let step = 0;
  const layers: KekLayer[] = lines.map((l, i) => {
    const kind = layerKind(l.text);
    const text = lineEdit && lineEdit.line === l.id ? lineEdit.text : l.text;
    let reason: MissReason | null = null;
    if (firstMiss >= 0) reason = 'below';
    else if (lineEdit && lineEdit.line === l.id && lineEdit.text !== l.text) reason = 'edited';
    else if (file && copiesFile(l.text, file)) reason = 'copiesFile';
    if (reason && firstMiss < 0) firstMiss = i;
    return { id: l.id, text, kind, size: l.size, step: kind === 'settings' ? null : ++step, cached: reason === null, reason };
  });
  const steps = layers.filter((l) => l.kind === 'step');
  return {
    layers,
    firstMiss,
    steps: step,
    cachedSteps: steps.filter((l) => l.cached).length,
    rebakedBytes: layers.filter((l) => !l.cached).reduce((a, l) => a + (l.size ?? 0), 0),
  };
}

export type KekVerdict =
  | { ok: true }
  | { ok: false; reason: 'order'; index: number; id: string; want: string }
  | { ok: false; reason: 'cached'; id: string; because: string | null; why: MissReason }
  | { ok: false; reason: 'count'; got: number; need: number; miss: string | null };

/** Check the goal against the second build. Reports the most useful first problem. */
export function checkKek(goal: KekGoal, lines: KekLine[], build: KekBuild): KekVerdict {
  if (goal.order) {
    const ids = lines.map((l) => l.id);
    const i = goal.order.findIndex((id, j) => ids[j] !== id);
    if (i >= 0) return { ok: false, reason: 'order', index: i, id: ids[i] ?? '', want: goal.order[i]! };
  }
  const miss = build.firstMiss >= 0 ? build.layers[build.firstMiss]! : null;
  for (const id of goal.cached ?? []) {
    const layer = build.layers.find((l) => l.id === id);
    if (layer && !layer.cached) return { ok: false, reason: 'cached', id, because: layer.reason === 'below' && miss ? miss.id : null, why: layer.reason! };
  }
  if (goal.cachedAfterEdit !== undefined && build.cachedSteps < goal.cachedAfterEdit) {
    return { ok: false, reason: 'count', got: build.cachedSteps, need: goal.cachedAfterEdit, miss: miss?.id ?? null };
  }
  return { ok: true };
}

/** Move one line; FROM stays on line 1. Returns a new array (or the same one if the move is not allowed). */
export function moveLine(lines: KekLine[], index: number, dir: -1 | 1): KekLine[] {
  const j = index + dir;
  if (j < 0 || j >= lines.length) return lines;
  if (layerKind(lines[index]!.text) === 'base' || layerKind(lines[j]!.text) === 'base') return lines;
  const next = [...lines];
  [next[index], next[j]] = [next[j]!, next[index]!];
  return next;
}

/**
 * BuildKit's step lines for the second build (` => CACHED [2/5] WORKDIR /app`). The FROM step
 * is left out: BuildKit prints it with the full image name and digest.
 */
export function buildOutput(build: KekBuild): string[] {
  return build.layers.filter((l) => l.kind === 'step').map((l) => ` => ${l.cached ? 'CACHED ' : ''}[${l.step}/${build.steps}] ${l.text.trim()}`);
}
