// Measure real Docker image and layer sizes for KekLapisBuilder and ShrinkRay.
// Test-only: needs a running Docker daemon and the base images. Never runs in Vitest.
//
//   npx tsx scripts/docker-games/measure-sizes.ts [workDir] [--write]
//
// It builds small apps in a temp folder with the same Dockerfile lines the games show,
// reads `docker history --human=false` (unpacked layer sizes, the numbers `docker history`
// prints) and sums them per image. `--write` saves src/lib/docker-sizes.json.
//
// No network for packages: `RUN npm ci` runs offline. Before it, the same RUN copies in
// exactly the npm cache entries a real online `npm ci` would download (from this machine's
// npm cache), so the layer holds node_modules + the npm cache, like a real build.
// Every image and container it makes is named fl-ui-measure-* and removed at the end.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const work = resolve(args.find((a) => !a.startsWith('--')) ?? mkdtempSync(join(tmpdir(), 'fl-ui-measure-')));
const NPM_CACHE = join(homedir(), '.npm/_cacache');
const PREFIX = 'fl-ui-measure';

const BASES = {
  node: 'node:24',
  slim: 'node:24-slim',
  alpine: 'node:24-alpine',
  distroless: 'gcr.io/distroless/nodejs24-debian13',
  nginx: 'nginx:1.29',
  'nginx-alpine': 'nginx:1.29-alpine',
} as const;
type BaseKey = keyof typeof BASES;

const PROD = ['zod', 'cookie', 'nanoid'];
const DEV = ['typescript', 'eslint', 'prettier', '@types/node'];

function sh(cmd: string, argv: string[], opts: { cwd?: string; input?: string } = {}): string {
  return execFileSync(cmd, argv, { cwd: opts.cwd, input: opts.input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

// ---- lockfile closure from this repo's package-lock.json ----
type LockEntry = { version: string; resolved?: string; integrity?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; [k: string]: unknown };
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockEntry> };

function closure(names: string[]): Set<string> {
  const out = new Set<string>();
  const visit = (path: string) => {
    if (out.has(path) || !lock.packages[path]) return;
    out.add(path);
    const e = lock.packages[path]!;
    for (const dep of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) {
      // Node resolution: nearest node_modules first, then up the tree.
      let base = path;
      let found: string | null = null;
      for (;;) {
        const candidate = `${base}/node_modules/${dep}`;
        if (lock.packages[candidate]) {
          found = candidate;
          break;
        }
        const i = base.lastIndexOf('/node_modules/');
        if (i < 0) break;
        base = base.slice(0, i);
      }
      found ??= lock.packages[`node_modules/${dep}`] ? `node_modules/${dep}` : null;
      if (found) visit(found);
    }
  };
  for (const n of names) visit(`node_modules/${n}`);
  return out;
}

function writeNodeApp(dir: string) {
  const prod = closure(PROD);
  const all = closure([...PROD, ...DEV]);
  const version = (n: string) => `^${lock.packages[`node_modules/${n}`]!.version}`;
  const pkg = {
    name: 'kedai-api',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: { build: 'tsc -p tsconfig.json', start: 'node dist/server.js', test: 'node --test' },
    dependencies: Object.fromEntries(PROD.map((n) => [n, version(n)])),
    devDependencies: Object.fromEntries(DEV.map((n) => [n, version(n)])),
  };
  const packages: Record<string, unknown> = { '': { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies } };
  for (const p of [...all].sort()) {
    const { dev: _d, devOptional: _o, peer: _p, ...e } = lock.packages[p]!;
    packages[p] = prod.has(p) ? e : { ...e, dev: true };
  }
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages }, null, 2) + '\n');
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'es2023', module: 'nodenext', moduleResolution: 'nodenext', outDir: 'dist', rootDir: 'src', strict: true, skipLibCheck: true, types: ['node'] }, include: ['src'] }, null, 2) + '\n',
  );
  writeFileSync(
    join(dir, 'src/server.ts'),
    [
      "import { createServer } from 'node:http';",
      "import { nanoid } from 'nanoid';",
      "import { menu, orderSchema } from './menu.js';",
      '',
      'const orders = new Map<string, unknown>();',
      'const server = createServer((req, res) => {',
      "  if (req.url === '/menu') return send(res, 200, menu);",
      "  if (req.url === '/orders' && req.method === 'POST') {",
      "    let body = '';",
      "    req.on('data', (c) => (body += c));",
      "    req.on('end', () => {",
      '      const parsed = orderSchema.safeParse(JSON.parse(body || "{}"));',
      '      if (!parsed.success) return send(res, 400, { error: parsed.error.message });',
      '      const id = nanoid();',
      '      orders.set(id, parsed.data);',
      '      send(res, 201, { id });',
      '    });',
      '    return;',
      '  }',
      "  send(res, 404, { error: 'not found' });",
      '});',
      '',
      'function send(res: import("node:http").ServerResponse, status: number, data: unknown) {',
      "  res.writeHead(status, { 'content-type': 'application/json' });",
      '  res.end(JSON.stringify(data));',
      '}',
      '',
      'server.listen(3000);',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'src/menu.ts'),
    [
      "import { z } from 'zod';",
      '',
      "export const menu = [{ id: 'nasi-lemak', price: 6 }, { id: 'kek-lapis', price: 4 }, { id: 'teh-tarik', price: 3 }];",
      'export const orderSchema = z.object({ item: z.string(), qty: z.number().int().positive() });',
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'test/menu.test.js'), "import { test } from 'node:test';\ntest('menu has items', () => {});\n");
  writeFileSync(join(dir, 'README.md'), '# Kedai API\n\nA tiny shop API for the FahamLah size measurements.\n');
  return { prod, all };
}

/** Copy the npm cache entries (index + content) for these lock entries into dir/_cacache. */
function seedCache(dir: string, paths: Set<string>) {
  const cache = join(dir, '_cacache');
  for (const p of paths) {
    const e = lock.packages[p]!;
    if (!e.resolved || !e.integrity) continue;
    const key = `make-fetch-happen:request-cache:${e.resolved}`;
    const ih = createHash('sha256').update(key).digest('hex');
    const index = join('index-v5', ih.slice(0, 2), ih.slice(2, 4), ih.slice(4));
    const [algo, b64] = e.integrity.split('-') as [string, string];
    const hex = Buffer.from(b64, 'base64').toString('hex');
    const content = join(`content-v2/${algo}`, hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    // npm finds a tarball by its integrity alone; the index entry is copied when there is one.
    if (!existsSync(join(NPM_CACHE, content))) throw new Error(`Not in the npm cache: ${e.resolved}`);
    for (const rel of [index, content]) {
      if (!existsSync(join(NPM_CACHE, rel))) continue;
      mkdirSync(dirname(join(cache, rel)), { recursive: true });
      cpSync(join(NPM_CACHE, rel), join(cache, rel));
    }
  }
}

// ---- docker helpers ----
interface Layer {
  size: number;
  createdBy: string;
}
function history(image: string): Layer[] {
  return sh('docker', ['history', '--no-trunc', '--human=false', '--format', '{{.Size}}\t{{.CreatedBy}}', image])
    .trim()
    .split('\n')
    .map((l) => {
      const [size, ...rest] = l.split('\t');
      return { size: Number(size), createdBy: rest.join('\t') };
    })
    .reverse(); // oldest first
}
const sum = (ls: Layer[]) => ls.reduce((a, l) => a + l.size, 0);
const made: string[] = [];

function build(name: string, context: string, dockerfile: string, contexts: Record<string, string> = {}): Layer[] {
  const tag = `${PREFIX}-${name}`;
  writeFileSync(join(context, 'Dockerfile'), dockerfile);
  const extra = Object.entries(contexts).flatMap(([k, v]) => ['--build-context', `${k}=${v}`]);
  sh('docker', ['build', '-q', '--pull=false', '-t', tag, ...extra, context]);
  made.push(tag);
  return history(tag);
}

// The RUN line people write vs the RUN line we measure (same layer, offline).
const seeded = (flags: string, seed: string) => `RUN --mount=type=bind,from=${seed},target=/tmp/seed mkdir -p /root/.npm && cp -r /tmp/seed/_cacache /root/.npm/ && npm ci --offline --no-audit --no-fund${flags}`;

function main() {
  mkdirSync(work, { recursive: true });
  console.error(`Working in ${work}`);
  for (const b of Object.values(BASES)) sh('docker', ['image', 'inspect', b]); // must be pulled already

  const base: Record<string, number> = {};
  for (const [k, img] of Object.entries(BASES)) base[k] = sum(history(img));

  // ---- node-api app ----
  const app = join(work, 'node-api');
  rmSync(app, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  const { prod, all } = writeNodeApp(app);
  const seedProd = join(work, 'seed-prod');
  const seedAll = join(work, 'seed-all');
  rmSync(seedProd, { recursive: true, force: true });
  rmSync(seedAll, { recursive: true, force: true });
  seedCache(seedProd, prod);
  seedCache(seedAll, all);
  // The laptop's own node_modules (what COPY . . brings in without a .dockerignore).
  sh('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app });
  const ignore = 'node_modules\nDockerfile\n.dockerignore\n';
  const ctx = { 'seed-prod': seedProd, 'seed-all': seedAll };

  // KekLapisBuilder: the good order and the slow order.
  writeFileSync(join(app, '.dockerignore'), ignore);
  const kekGood = build(
    'kek-good',
    app,
    ['FROM node:24-alpine', 'WORKDIR /app', 'COPY package.json package-lock.json ./', seeded(' --omit=dev', 'seed-prod'), 'COPY . .', 'CMD ["node", "src/server.ts"]', ''].join('\n'),
    ctx,
  );
  const kekSlow = build(
    'kek-slow',
    app,
    ['FROM node:24-alpine', 'WORKDIR /app', 'COPY . .', seeded(' --omit=dev', 'seed-prod'), 'CMD ["node", "src/server.ts"]', ''].join('\n'),
    ctx,
  );
  const baseLayers = history(BASES.alpine).length;
  const own = (ls: Layer[]) => ls.slice(baseLayers).map((l) => ({ size: l.size, line: l.createdBy.replace(/^RUN \/bin\/sh -c mkdir .*npm ci --offline --no-audit --no-fund/, 'RUN npm ci').replace(/ # buildkit$/, '') }));

  // ShrinkRay node-api grid.
  const shrink: Record<string, number> = {};
  for (const b of ['node', 'slim', 'alpine'] as BaseKey[]) {
    for (const ign of [false, true]) {
      if (ign) writeFileSync(join(app, '.dockerignore'), ignore);
      else rmSync(join(app, '.dockerignore'), { force: true });
      const ls = build(`shrink-${b}-1-${ign ? 1 : 0}`, app, [`FROM ${BASES[b]}`, 'WORKDIR /app', 'COPY . .', seeded('', 'seed-all'), 'RUN npm run build', 'CMD ["node", "dist/server.js"]', ''].join('\n'), ctx);
      shrink[`${b}|single|${ign ? 'ignore' : 'all'}|dev`] = sum(ls);
    }
  }
  for (const b of ['node', 'slim', 'alpine', 'distroless'] as BaseKey[]) {
    for (const ign of [false, true]) {
      for (const prodOnly of [false, true]) {
        if (ign) writeFileSync(join(app, '.dockerignore'), ignore);
        else rmSync(join(app, '.dockerignore'), { force: true });
        const builder = b === 'distroless' ? BASES.slim : BASES[b];
        const cmd = b === 'distroless' ? 'CMD ["dist/server.js"]' : 'CMD ["node", "dist/server.js"]';
        const ls = build(
          `shrink-${b}-2-${ign ? 1 : 0}-${prodOnly ? 1 : 0}`,
          app,
          [
            `FROM ${builder} AS build`,
            'WORKDIR /app',
            'COPY package.json package-lock.json ./',
            seeded('', 'seed-all'),
            'COPY . .',
            'RUN npm run build',
            ...(prodOnly ? ['RUN npm prune --omit=dev'] : []),
            '',
            `FROM ${BASES[b]}`,
            'WORKDIR /app',
            'COPY --from=build /app/node_modules ./node_modules',
            'COPY --from=build /app/dist ./dist',
            cmd,
            '',
          ].join('\n'),
          ctx,
        );
        shrink[`${b}|stage|${ign ? 'ignore' : 'all'}|${prodOnly ? 'prod' : 'dev'}`] = sum(ls);
      }
    }
  }

  // ---- static-site app (nginx) ----
  const site = join(work, 'static-site');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(join(site, 'images'), { recursive: true });
  writeFileSync(join(site, 'index.html'), '<!doctype html>\n<title>My diary</title>\n<link rel="stylesheet" href="style.css">\n<h1>My diary</h1>\n<p>Day 1: I learned Docker.</p>\n'.repeat(4));
  writeFileSync(join(site, 'about.html'), '<!doctype html>\n<title>About</title>\n<h1>About me</h1>\n');
  writeFileSync(join(site, 'style.css'), 'body { font-family: system-ui; max-width: 40rem; margin: auto; }\n'.repeat(20));
  // Three photos (random bytes do not compress, like JPEGs).
  for (const n of [1, 2, 3]) writeFileSync(join(site, `images/day${n}.jpg`), createHash('sha512').update(String(n)).digest().toString('hex').repeat(3200));
  writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'diary-site', private: true, devDependencies: { prettier: `^${lock.packages['node_modules/prettier']!.version}` } }, null, 2) + '\n');
  cpSync(join(app, 'node_modules/prettier'), join(site, 'node_modules/prettier'), { recursive: true });
  const siteIgnore = 'node_modules\npackage.json\nDockerfile\n.dockerignore\n';
  const staticSizes: Record<string, number> = {};
  for (const b of ['nginx', 'nginx-alpine'] as BaseKey[]) {
    for (const ign of [false, true]) {
      if (ign) writeFileSync(join(site, '.dockerignore'), siteIgnore);
      else rmSync(join(site, '.dockerignore'), { force: true });
      const ls = build(`static-${b}-${ign ? 1 : 0}`, site, [`FROM ${BASES[b]}`, 'COPY . /usr/share/nginx/html', ''].join('\n'));
      staticSizes[`${b}|single|${ign ? 'ignore' : 'all'}|dev`] = sum(ls);
    }
  }

  const result = {
    measured: new Date().toISOString().slice(0, 10),
    docker: sh('docker', ['version', '--format', '{{.Server.Version}}']).trim(),
    note: 'Unpacked layer sizes in bytes, as docker history --human=false prints them; an image = the sum of its layers.',
    bases: Object.fromEntries(Object.entries(BASES).map(([k, img]) => [k, { image: img, bytes: base[k] }])),
    kekLapis: { good: own(kekGood), slow: own(kekSlow), base: { image: BASES.alpine, bytes: base.alpine } },
    shrink: { 'node-api': shrink, 'static-site': staticSizes },
  };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (write) writeFileSync(join(ROOT, 'src/lib/docker-sizes.json'), json);
  console.log(json);
}

try {
  main();
} finally {
  for (const tag of made) {
    try {
      sh('docker', ['image', 'rm', '-f', tag]);
    } catch {
      /* already gone */
    }
  }
}
