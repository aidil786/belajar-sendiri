// Pure logic for ShrinkRay: make an image smaller, one honest move at a time.
// Every size is a real measurement (src/lib/docker-sizes.json, made by
// scripts/docker-games/measure-sizes.ts with Docker 29): the unpacked layer sizes
// `docker history` shows, added up. Moves that can't work in real life are refused kindly
// (distroless has no npm, and the build needs its dev tools).
import data from './docker-sizes.json';

export type ShrinkApp = 'node-api' | 'static-site';
export type BaseId = keyof typeof data.bases;

export interface Recipe {
  base: BaseId;
  /** A build stage: build with all the tools, copy only the result into a fresh final stage. */
  stage: boolean;
  /** A .dockerignore keeps the laptop's node_modules out of COPY . . */
  ignore: boolean;
  /** Final image has production packages only (npm prune --omit=dev in the build stage). */
  prodOnly: boolean;
}

export type Move = `base:${BaseId}` | 'stage' | 'ignore' | 'prodOnly';

interface AppDef {
  bases: BaseId[];
  start: Recipe;
  moves: Move[];
}

export const APPS: Record<ShrinkApp, AppDef> = {
  'node-api': {
    bases: ['node', 'slim', 'alpine', 'distroless'],
    start: { base: 'node', stage: false, ignore: false, prodOnly: false },
    moves: ['base:node', 'base:slim', 'base:alpine', 'base:distroless', 'ignore', 'stage', 'prodOnly'],
  },
  'static-site': {
    bases: ['nginx', 'nginx-alpine'],
    start: { base: 'nginx', stage: false, ignore: false, prodOnly: false },
    moves: ['base:nginx', 'base:nginx-alpine', 'ignore'],
  },
};

/** Bases that only work as a final stage (no npm, no shell). */
const FINAL_ONLY = new Set<BaseId>(['distroless']);

export function imageOf(base: BaseId): string {
  return data.bases[base].image;
}

export function recipeKey(r: Recipe): string {
  return `${r.base}|${r.stage ? 'stage' : 'single'}|${r.ignore ? 'ignore' : 'all'}|${r.prodOnly ? 'prod' : 'dev'}`;
}

/** Measured size in bytes, or null when this recipe can't be built. */
export function sizeOf(app: ShrinkApp, r: Recipe): number | null {
  const table = data.shrink[app] as Record<string, number>;
  return table[recipeKey(r)] ?? null;
}

export function startRecipe(app: ShrinkApp, start?: Partial<Recipe>): Recipe {
  const r = { ...APPS[app].start, ...start };
  return sizeOf(app, r) === null ? APPS[app].start : r;
}

export function isOn(r: Recipe, move: Move): boolean {
  if (move.startsWith('base:')) return r.base === move.slice(5);
  return r[move as 'stage' | 'ignore' | 'prodOnly'];
}

export type MoveResult =
  | { ok: true; recipe: Recipe }
  | { ok: false; reason: 'needsStage'; move: Move }
  | { ok: false; reason: 'stageNeeded'; by: Move }
  | { ok: false; reason: 'unknown'; move: Move };

/** Apply one move. Base moves pick that base; the others switch on and off. */
export function applyMove(app: ShrinkApp, r: Recipe, move: Move): MoveResult {
  let next: Recipe;
  if (move.startsWith('base:')) {
    const base = move.slice(5) as BaseId;
    if (!APPS[app].bases.includes(base)) return { ok: false, reason: 'unknown', move };
    if (FINAL_ONLY.has(base) && !r.stage) return { ok: false, reason: 'needsStage', move };
    next = { ...r, base };
  } else if (move === 'stage') {
    if (r.stage && FINAL_ONLY.has(r.base)) return { ok: false, reason: 'stageNeeded', by: `base:${r.base}` };
    if (r.stage && r.prodOnly) return { ok: false, reason: 'stageNeeded', by: 'prodOnly' };
    next = { ...r, stage: !r.stage };
  } else if (move === 'ignore' || move === 'prodOnly') {
    // In one stage, `npm run build` needs TypeScript, a dev tool: production-only can't build.
    if (move === 'prodOnly' && !r.prodOnly && !r.stage) return { ok: false, reason: 'needsStage', move };
    next = { ...r, [move]: !r[move] };
  } else return { ok: false, reason: 'unknown', move };
  return sizeOf(app, next) === null ? { ok: false, reason: 'unknown', move } : { ok: true, recipe: next };
}

/** The Dockerfile for a recipe (what was measured, minus the offline npm cache trick). */
export function dockerfile(app: ShrinkApp, r: Recipe): string[] {
  if (app === 'static-site') return [`FROM ${imageOf(r.base)}`, 'COPY . /usr/share/nginx/html'];
  if (!r.stage) return [`FROM ${imageOf(r.base)}`, 'WORKDIR /app', 'COPY . .', 'RUN npm ci', 'RUN npm run build', 'CMD ["node", "dist/server.js"]'];
  const builder = FINAL_ONLY.has(r.base) ? imageOf('slim') : imageOf(r.base);
  return [
    `FROM ${builder} AS build`,
    'WORKDIR /app',
    'COPY package.json package-lock.json ./',
    'RUN npm ci',
    'COPY . .',
    'RUN npm run build',
    ...(r.prodOnly ? ['RUN npm prune --omit=dev'] : []),
    '',
    `FROM ${imageOf(r.base)}`,
    'WORKDIR /app',
    'COPY --from=build /app/node_modules ./node_modules',
    'COPY --from=build /app/dist ./dist',
    FINAL_ONLY.has(r.base) ? 'CMD ["dist/server.js"]' : 'CMD ["node", "dist/server.js"]',
  ];
}

/** The .dockerignore lines, when there is one. */
export function dockerignore(app: ShrinkApp, r: Recipe): string[] {
  if (!r.ignore) return [];
  return app === 'static-site' ? ['node_modules', 'package.json'] : ['node_modules'];
}

/** Moves to show: the lesson's list (unknown ones dropped), or all for this app. */
export function movesFor(app: ShrinkApp, options?: Move[]): Move[] {
  const all = APPS[app].moves;
  return options?.length ? options.filter((m) => all.includes(m)) : all;
}

/** Can the target be reached with these moves? (Used by check:mdx.) */
export function reachable(app: ShrinkApp, start: Recipe, moves: Move[], targetBytes: number): boolean {
  const seen = new Set<string>();
  const queue: Recipe[] = [start];
  while (queue.length) {
    const r = queue.shift()!;
    const k = recipeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    if ((sizeOf(app, r) ?? Infinity) <= targetBytes) return true;
    for (const m of moves) {
      const res = applyMove(app, r, m);
      if (res.ok) queue.push(res.recipe);
    }
  }
  return false;
}
