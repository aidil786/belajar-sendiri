// docker build: a Dockerfile, a build context (the folder), layers and the layer cache,
// shown the way BuildKit prints it. RUN lines run a small set of known effects
// (package installs add their measured size, npm/pip installs, files, users).
import { basename, dirname, isInside, normalize } from '../git-sim/paths';
import { catalogEntry, imageFromCatalog } from './catalog';
import { closest } from '../git-sim/output';
import { parseFlags } from './flags';
import { humanSize, parseSize, spread } from './format';
import { cacheId, hexOf } from './ids';
import { rateLimitError, setTag } from './images';
import { catalogKey, familiar, fullName, parseRef } from './refs';
import { fail, findImage, line, ok, out, resolve } from './state';
import type { FileMap, HealthConfig, HistoryRow, ImageConfig, ImageKind, KitchenEvent, KitchenResult, KitchenState, Line, LocalImage } from './types';

const WIDTH = 80;

export interface Instr {
  line: number;
  kw: string;
  args: string;
  raw: string;
}

export interface Stage {
  name: string | null;
  index: number;
  from: string;
  platform?: string;
  line: number;
  instrs: Instr[];
}

const KNOWN = ['FROM', 'RUN', 'CMD', 'LABEL', 'MAINTAINER', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL'];

export type ParsedDockerfile = { ok: true; stages: Stage[]; globalArgs: Instr[]; lines: string[] } | { ok: false; line: number; error: string; lines: string[] };

/** Parse a Dockerfile into stages. Continuation lines (\) are joined; comments skipped. */
export function parseDockerfile(text: string): ParsedDockerfile {
  const lines = text.split('\n');
  const instrs: Instr[] = [];
  let buf = '';
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    if (!buf && (t === '' || t.startsWith('#'))) continue;
    if (buf && t.startsWith('#')) continue;
    if (!buf) start = i + 1;
    if (t.endsWith('\\')) {
      buf += `${t.slice(0, -1)} `;
      continue;
    }
    buf += t;
    const m = /^(\S+)\s*([\s\S]*)$/.exec(buf);
    if (m) instrs.push({ line: start, kw: m[1]!.toUpperCase(), args: m[2]!.trim(), raw: buf });
    buf = '';
  }
  for (const ins of instrs) {
    if (!KNOWN.includes(ins.kw)) {
      const near = closest(ins.kw, KNOWN, 2);
      const kwShown = ins.raw.split(/\s/)[0];
      return { ok: false, line: ins.line, error: `dockerfile parse error on line ${ins.line}: unknown instruction: ${kwShown}${near ? ` (did you mean ${near}?)` : ''}`, lines };
    }
  }
  const globalArgs: Instr[] = [];
  const stages: Stage[] = [];
  for (const ins of instrs) {
    if (ins.kw === 'FROM') {
      const words = ins.args.split(/\s+/);
      let platform: string | undefined;
      while (words[0]?.startsWith('--')) {
        const w = words.shift()!;
        if (w.startsWith('--platform=')) platform = w.slice(11);
      }
      const from = words[0] ?? '';
      const asIdx = words.findIndex((w) => w.toUpperCase() === 'AS');
      stages.push({ name: asIdx > 0 ? (words[asIdx + 1] ?? null) : null, index: stages.length, from, platform, line: ins.line, instrs: [ins] });
      continue;
    }
    if (!stages.length) {
      if (ins.kw === 'ARG') {
        globalArgs.push(ins);
        continue;
      }
      return { ok: false, line: ins.line, error: `dockerfile parse error on line ${ins.line}: ${ins.kw} not allowed before FROM`, lines };
    }
    stages[stages.length - 1]!.instrs.push(ins);
  }
  if (!stages.length) return { ok: false, line: 1, error: 'the Dockerfile cannot be empty', lines };
  return { ok: true, stages, globalArgs, lines };
}

/** ["a", "b"] exec form or plain shell form. */
export function parseCmd(args: string): { exec: string[] | null; shell: string } {
  const t = args.trim();
  if (t.startsWith('[')) {
    try {
      const v = JSON.parse(t) as unknown;
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return { exec: v as string[], shell: t };
    } catch {
      /* falls back to shell form, like Docker */
    }
  }
  return { exec: null, shell: t };
}

/**
 * How BuildKit names a step: ARG and ENV values (also the base image's ENV) are filled in;
 * unknown or empty ones stay as written (`$HOME`, `${NOPE:-x}`). Checked on Docker 29.9.
 */
function displayExpand(text: string, vars: Record<string, string>): string {
  return text.replace(/\$\{(\w+)(?::?-([^}]*))?\}|\$(\w+)/g, (m, a: string | undefined, _def: string | undefined, b: string | undefined) => {
    const v = vars[(a ?? b)!];
    return v === undefined || v === '' ? m : v;
  });
}

function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\$\{(\w+)(?::?-([^}]*))?\}|\$(\w+)/g, (_, a: string, def: string | undefined, b: string) => {
    const name = a ?? b;
    const v = vars[name];
    return v !== undefined && v !== '' ? v : (def ?? '');
  });
}

// ---------------------------------------------------------------------------
// .dockerignore and the build context

function globToRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if ('.+^$(){}|[]\\'.includes(ch)) re += `\\${ch}`;
    else re += ch;
  }
  return new RegExp(`^${re}(/.*)?$`);
}

export function contextFiles(state: KitchenState, dir: string): { files: FileMap; ignored: string[]; ignoreSize: number | null } {
  const ignoreText = state.fs.files[`${dir}/.dockerignore`];
  const rules = (ignoreText ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => ({ neg: l.startsWith('!'), re: globToRe(normalize(l.replace(/^!/, '')).replace(/^\//, '')) }));
  const files: FileMap = {};
  const ignored: string[] = [];
  for (const [p, content] of Object.entries(state.fs.files)) {
    if (!isInside(p, dir) || p === dir) continue;
    const rel = p.slice(dir.length + 1);
    let skip = false;
    for (const r of rules) if (r.re.test(rel)) skip = !r.neg;
    if (skip) ignored.push(rel);
    else files[rel] = content;
  }
  return { files, ignored, ignoreSize: ignoreText === undefined ? null : new TextEncoder().encode(ignoreText).length };
}

function matchSources(files: FileMap, src: string): string[] | null {
  const s = normalize(src).replace(/^\//, '');
  if (s === '' || s === '.') return Object.keys(files).sort();
  if (/[*?[]/.test(s)) {
    const re = globToRe(s);
    const hits = Object.keys(files).filter((f) => re.test(f) && (!f.slice(0).includes('/') || re.test(f)));
    const direct = hits.filter((f) => new RegExp(`^${globToRe(s).source.replace(/\(\/\.\*\)\?\$$/, '')}$`).test(f));
    return direct.length ? direct.sort() : hits.length ? hits.sort() : null;
  }
  if (s in files) return [s];
  const under = Object.keys(files).filter((f) => f.startsWith(`${s}/`));
  return under.length ? under.sort() : null;
}

// ---------------------------------------------------------------------------
// Known RUN effects

interface PkgSize {
  bytes: number;
  bins: string[];
}

/** Unpacked sizes measured with BuildKit on 2026-10-31 (alpine 3.22/3.24, node 24, python 3.13). */
const APK: Record<string, PkgSize> = {
  curl: { bytes: 5_280_000, bins: ['curl'] },
  bash: { bytes: 2_320_000, bins: ['bash'] },
  git: { bytes: 7_970_000, bins: ['git'] },
};
/** Estimates (not measured): Debian packages and anything else. */
const APT: Record<string, PkgSize> = { curl: { bytes: 9_800_000, bins: ['curl'] }, git: { bytes: 38_000_000, bins: ['git'] }, wget: { bytes: 3_600_000, bins: ['wget'] } };
const APK_LOG: Record<string, string[]> = {
  curl: [
    '(1/9) Installing brotli-libs (1.1.1-r0)',
    '(2/9) Installing c-ares (1.34.9-r0)',
    '(3/9) Installing libunistring (1.3-r0)',
    '(4/9) Installing libidn2 (2.3.7-r0)',
    '(5/9) Installing nghttp2-libs (1.69.0-r0)',
    '(6/9) Installing libpsl (0.21.5-r3)',
    '(7/9) Installing zstd-libs (1.5.7-r0)',
    '(8/9) Installing libcurl (8.14.1-r4)',
    '(9/9) Installing curl (8.14.1-r4)',
  ],
  bash: ['(1/4) Installing ncurses-terminfo-base (6.5_p20250503-r0)', '(2/4) Installing libncursesw (6.5_p20250503-r0)', '(3/4) Installing readline (8.2.13-r1)', '(4/4) Installing bash (5.2.37-r0)'],
  git: ['(1/4) Installing libexpat (2.9.0-r0)', '(2/4) Installing pcre2 (10.46-r1)', '(3/4) Installing git (2.49.1-r0)', '(4/4) Installing git-init-template (2.49.1-r0)'],
};

interface Fs {
  files: FileMap;
  dirs: string[];
  users: Record<string, [number, number]>;
  bins: string[];
  owners: Record<string, number>;
}

interface RunEffect {
  ok: boolean;
  code: number;
  log: string[];
  size: number;
  compress: number;
  added: FileMap;
  addedDirs: string[];
  deleted: string[];
}

function runEffects(fs: Fs, cmd: string, workdir: string, kind: ImageKind, alpineVersion: string, env: Record<string, string>): RunEffect {
  const eff: RunEffect = { ok: true, code: 0, log: [], size: 0, compress: 0.3, added: {}, addedDirs: [], deleted: [] };
  const parts = cmd.split(/\s*(?:&&|;|\n)\s*/).filter(Boolean);
  const dash = kind === 'python' || kind === 'debian';
  const absOf = (p: string) => (p.startsWith('/') ? normalize(p) : normalize(`${workdir}/${p}`));
  let aptLists = 0;
  for (const part of parts) {
    const words = part.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^["']|["']$/g, '')) ?? [];
    const prog = words[0] ?? '';
    const args = words.slice(1);
    const has = (b: string) => fs.bins.includes(b) || ['echo', 'cd', 'export', 'true', 'set', 'exit', 'test', '['].includes(b);
    if (prog === 'exit' || prog === 'false') {
      eff.ok = false;
      eff.code = prog === 'false' ? 1 : Number(args[0] ?? 1);
      return eff;
    }
    if (!has(prog) && !['adduser', 'addgroup', 'useradd', 'groupadd'].includes(prog)) {
      eff.ok = false;
      eff.code = 127;
      eff.log.push(dash ? `/bin/sh: 1: ${prog}: not found` : `/bin/sh: ${prog}: not found`);
      return eff;
    }
    switch (prog) {
      case 'apk': {
        if (args[0] !== 'add') break;
        const noCache = args.includes('--no-cache');
        const pkgs = args.slice(1).filter((a) => !a.startsWith('-') && !a.startsWith('.'));
        eff.log.push(`fetch https://dl-cdn.alpinelinux.org/alpine/v${alpineVersion}/main/x86_64/APKINDEX.tar.gz`, `fetch https://dl-cdn.alpinelinux.org/alpine/v${alpineVersion}/community/x86_64/APKINDEX.tar.gz`);
        for (const p of pkgs) {
          const known = APK[p] ?? { bytes: 3_000_000, bins: [p] };
          if (fs.bins.includes(p) && known.bins.every((b) => fs.bins.includes(b))) continue;
          eff.size += known.bytes;
          eff.log.push(...(APK_LOG[p] ?? [`(1/1) Installing ${p}`]));
          for (const b of known.bins) {
            fs.bins.push(b);
            eff.added[`/usr/bin/${b}`] = '';
          }
        }
        if (!noCache) eff.size += 2_700_000;
        eff.compress = 0.5;
        eff.log.push(`OK: ${Math.round(12 + eff.size / 1e6)} MiB in ${25 + pkgs.length} packages`);
        break;
      }
      case 'apt-get':
      case 'apt': {
        if (args[0] === 'update') {
          aptLists += 19_500_000;
          eff.size += 19_500_000;
          eff.log.push('Get:1 http://deb.debian.org/debian trixie InRelease [140 kB]', 'Reading package lists...');
        } else if (args[0] === 'install') {
          if (!aptLists && !fs.files['/var/lib/apt/lists/.fahamlah']) {
            eff.ok = false;
            eff.code = 100;
            const p = args.filter((a) => !a.startsWith('-'))[1] ?? '';
            eff.log.push('Reading package lists...', 'Building dependency tree...', 'Reading state information...', `E: Unable to locate package ${p}`);
            return eff;
          }
          for (const p of args.slice(1).filter((a) => !a.startsWith('-'))) {
            const known = APT[p] ?? { bytes: 4_000_000, bins: [p] };
            eff.size += known.bytes;
            fs.bins.push(...known.bins);
            for (const b of known.bins) eff.added[`/usr/bin/${b}`] = '';
          }
        }
        eff.compress = 0.4;
        break;
      }
      case 'rm': {
        const target = args.filter((a) => !a.startsWith('-'));
        for (const t of target) {
          if (t.startsWith('/var/lib/apt/lists')) {
            eff.size -= aptLists;
            aptLists = 0;
            continue;
          }
          const abs = absOf(t.replace(/\/\*$/, ''));
          for (const f of Object.keys(fs.files)) if (isInside(f, abs)) eff.deleted.push(f);
          for (const f of Object.keys(eff.added)) if (isInside(f, abs)) delete eff.added[f];
        }
        break;
      }
      case 'npm': {
        const sub = args[0];
        if (sub === 'ci' || sub === 'install' || sub === 'i') {
          const pkgText = fs.files[absOf('package.json')];
          if (pkgText === undefined) {
            eff.ok = false;
            eff.code = 254;
            eff.log.push('npm error code ENOENT', 'npm error syscall open', `npm error path ${absOf('package.json')}`, 'npm error errno -2');
            return eff;
          }
          if (sub === 'ci' && fs.files[absOf('package-lock.json')] === undefined) {
            eff.ok = false;
            eff.code = 1;
            eff.log.push('npm error code EUSAGE', 'npm error', 'npm error The `npm ci` command can only install with an existing package-lock.json or', 'npm error npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or', 'npm error later to generate a package-lock.json file, then try again.');
            return eff;
          }
          let deps: Record<string, string>;
          let dev: Record<string, string>;
          try {
            const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
            deps = pkg.dependencies ?? {};
            dev = pkg.devDependencies ?? {};
          } catch {
            eff.ok = false;
            eff.code = 1;
            eff.log.push('npm error code EJSONPARSE');
            return eff;
          }
          const omitDev = args.includes('--omit=dev') || args.includes('--production') || env.NODE_ENV === 'production';
          const names = [...Object.keys(deps), ...(omitDev ? [] : Object.keys(dev))];
          const nm = absOf('node_modules');
          // With no packages to install, npm ci makes no node_modules folder (npm 11, checked on Docker 29.9).
          if (names.length) eff.addedDirs.push(nm);
          for (const d of names) eff.added[`${nm}/${d}/package.json`] = `{"name":"${d}"}\n`;
          // express@5 measured at 15.2MB (65 packages); others are estimates.
          for (const d of names) eff.size += d === 'express' ? 15_200_000 : d === 'typescript' ? 23_000_000 : d === 'vite' ? 18_000_000 : 1_500_000;
          eff.size += 8192;
          eff.compress = 0.3;
          const count = names.reduce((n, d) => n + (d === 'express' ? 65 : 3), 0);
          eff.log.push('', count ? `added ${count} packages in 5s` : 'up to date in 120ms');
        } else if (sub === 'run' && args[1] === 'build') {
          const dist = absOf('dist');
          eff.addedDirs.push(dist);
          const index = fs.files[absOf('index.html')] ?? fs.files[absOf('src/index.html')] ?? '<!doctype html>\n<h1>Built app</h1>\n';
          eff.added[`${dist}/index.html`] = index;
          eff.added[`${dist}/assets/index.js`] = '/* built */\n';
          eff.size += 180_000;
          eff.log.push('', '> build', '> vite build', '', 'dist/index.html  0.45 kB', 'dist/assets/index.js  142.1 kB', '✓ built in 1.2s');
        }
        break;
      }
      case 'pip':
      case 'pip3': {
        if (args[0] !== 'install') break;
        let pkgs = args.slice(1).filter((a) => !a.startsWith('-'));
        const r = args.indexOf('-r');
        if (r >= 0) {
          const req = fs.files[absOf(args[r + 1] ?? '')];
          if (req === undefined) {
            eff.ok = false;
            eff.code = 1;
            eff.log.push(`ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${args[r + 1]}'`);
            return eff;
          }
          pkgs = req.split('\n').map((l) => l.trim().split(/[=<>~ ]/)[0]!).filter((l) => l && !l.startsWith('#'));
        }
        // flask measured at 15.6MB; others are estimates.
        for (const p of pkgs) eff.size += p.toLowerCase() === 'flask' ? 15_600_000 : 3_000_000;
        if (!args.includes('--no-cache-dir')) eff.size += Math.round(eff.size * 0.4);
        eff.compress = 0.2;
        eff.log.push(`Successfully installed ${pkgs.join(' ')}`);
        break;
      }
      case 'mkdir':
        for (const d of args.filter((a) => !a.startsWith('-'))) eff.addedDirs.push(absOf(d));
        break;
      case 'touch':
        for (const f of args.filter((a) => !a.startsWith('-'))) eff.added[absOf(f)] = fs.files[absOf(f)] ?? '';
        break;
      case 'echo': {
        const m = /^echo\s+(.*?)\s*(>>?)\s*(\S+)$/.exec(part);
        if (m) {
          const text = m[1]!.replace(/^["']|["']$/g, '');
          const f = absOf(m[3]!);
          eff.added[f] = (m[2] === '>>' ? (fs.files[f] ?? '') : '') + `${text}\n`;
        } else eff.log.push(args.join(' '));
        break;
      }
      case 'adduser':
      case 'useradd': {
        const name = args.filter((a) => !a.startsWith('-')).pop() ?? 'app';
        const ui = args.indexOf('-u');
        const uid = ui >= 0 ? Number(args[ui + 1]) : Object.values(fs.users).reduce((m, [u]) => (u >= 1000 && u < 60000 ? Math.max(m, u + 1) : m), 1000);
        const filtered = args.filter((a, i) => !a.startsWith('-') && !(ui >= 0 && i === ui + 1));
        fs.users[filtered[filtered.length - 1] ?? name] = [uid, uid];
        if (!args.includes('-H') && !args.includes('--no-create-home')) {
          eff.addedDirs.push(`/home/${name}`);
          fs.owners[`/home/${name}`] = uid;
        }
        eff.added['/etc/passwd'] = '';
        break;
      }
      case 'addgroup':
      case 'groupadd':
        eff.added['/etc/group'] = '';
        break;
      case 'chown': {
        const pos = args.filter((a) => !a.startsWith('-'));
        const who = pos[0] ?? '0';
        const uid = /^\d+/.test(who) ? Number(who.split(':')[0]) : (fs.users[who.split(':')[0]!]?.[0] ?? 0);
        for (const t of pos.slice(1)) fs.owners[absOf(t)] = uid;
        break;
      }
      default:
        break;
    }
  }
  return eff;
}

// ---------------------------------------------------------------------------
// The build

interface StageResult {
  fs: Fs;
  config: ImageConfig;
  history: HistoryRow[];
  layers: string[];
  blobs: string[];
  key: string;
  baseUnpacked: number;
  baseContent: number;
  added: number;
  addedCompressed: number;
  kind: ImageKind;
  catalogRef?: string;
  platform: string;
  env: Record<string, string>;
  args: Record<string, string>;
  workdir: string;
  user: string;
}

interface Vertex {
  name: string;
  cached?: boolean;
  error?: boolean;
  canceled?: boolean;
  time: string;
  subs: { name: string; time: string }[];
  log: string[];
}

function fsFromImage(img: LocalImage): Fs {
  return { files: { ...img.files }, dirs: [...img.dirs], users: { ...img.users }, bins: [...img.bins], owners: { ...(img.owners ?? {}) } };
}

/** Bytes a small file change takes in an overlay layer (4 KiB blocks, parent folders included). */
function layerBytes(paths: string[], files: FileMap, dirs: string[]): number {
  const entries = new Set<string>(['/']);
  for (const p of [...paths, ...dirs]) {
    let d = p;
    while (d && d !== '/') {
      entries.add(d);
      d = dirname(d);
    }
  }
  let n = entries.size * 4096;
  for (const p of paths) {
    const size = new TextEncoder().encode(files[p] ?? '').length;
    if (size > 4096) n += (Math.ceil(size / 4096) - 1) * 4096;
  }
  return n;
}

function alpineOf(img: LocalImage | null): string {
  const rel = img?.files['/etc/os-release'] ?? '';
  const m = /VERSION_ID=(\d+\.\d+)/.exec(rel);
  return m ? m[1]! : '3.22';
}

function cmdHistory(kw: 'CMD' | 'ENTRYPOINT', list: string[]): string {
  return `${kw} [${list.map((x) => `"${x}"`).join(' ')}]`;
}

const SECRET_RE = /(?:^|_)(?:apikey|auth|credential|credentials|key|password|pword|passwd|secret|token)(?:_|$)/i;

export interface RunMount {
  type: string;
  id?: string;
  target?: string;
  env?: string;
  required: boolean;
}

/**
 * `RUN --mount=type=cache,target=/root/.npm npm ci`: the flags before the command, and the command.
 * Cache mounts are a shelf BuildKit keeps between builds; secret mounts exist only while that RUN
 * runs. Neither ends up in the layer or in `docker history` (checked on Docker 29.9).
 */
export function runFlags(args: string): { mounts: RunMount[]; flags: string[]; command: string } {
  const mounts: RunMount[] = [];
  const flags: string[] = [];
  let rest = args.trim();
  for (;;) {
    const m = /^(--[\w-]+(?:=\S*)?)\s*/.exec(rest);
    if (!m) break;
    flags.push(m[1]!);
    rest = rest.slice(m[0].length);
    if (m[1]!.startsWith('--mount=')) {
      const kv: Record<string, string> = {};
      for (const part of m[1]!.slice(8).split(',')) {
        const i = part.indexOf('=');
        kv[i < 0 ? part : part.slice(0, i)] = i < 0 ? 'true' : part.slice(i + 1);
      }
      const type = kv.type ?? 'bind';
      const target = kv.target ?? kv.dst ?? kv.destination;
      const id = kv.id ?? (type === 'secret' && target ? basename(target) : undefined);
      mounts.push({ type, id, target: type === 'secret' ? (target ?? `/run/secrets/${id}`) : target, env: kv.env, required: kv.required === 'true' });
    }
  }
  return { mounts, flags, command: rest };
}

/** `--secret id=npmrc,src=.npmrc` (or env=VAR) from the command line: id → where to read it. */
function cliSecrets(list: string[]): Record<string, { src?: string; env?: string }> {
  const out: Record<string, { src?: string; env?: string }> = {};
  for (const item of list) {
    const kv: Record<string, string> = {};
    for (const part of item.split(',')) {
      const i = part.indexOf('=');
      if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
    }
    const id = kv.id ?? kv.src ?? kv.source ?? kv.env;
    if (!id) continue;
    const src = kv.src ?? kv.source;
    out[id] = src ? { src } : kv.env ? { env: kv.env } : { env: id };
  }
  return out;
}

export const build = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, {
    bools: [['--no-cache'], ['-q', '--quiet'], ['--pull'], ['--load'], ['--push']],
    values: [['-f', '--file'], ['--target'], ['--platform'], ['--progress'], ['--network']],
    multi: [['-t', '--tag'], ['--build-arg'], ['--label'], ['--secret'], ['--cache-from']],
  });
  if (f.unknown) return fail(state, out(`ERROR: unknown flag: ${f.unknown}`), 'unknownFlag', { key: 'sim.docker.err.unknownFlag', params: { flag: f.unknown, cmd: 'docker build' } });
  if (f.positional.length !== 1) {
    return fail(state, out(`ERROR: "docker buildx build" requires exactly 1 argument.\nSee 'docker buildx build --help'.\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n\nStart a build`), 'usage', { key: 'sim.docker.err.buildNeedsPath' });
  }
  const s = structuredClone(state);
  const ctxDir = resolve(s, f.positional[0]!);
  if (!s.fs.dirs.includes(ctxDir)) return fail(state, out(`ERROR: failed to build: unable to prepare context: path "${f.positional[0]}" not found`), 'noContext', { key: 'sim.docker.err.noContext', params: { path: f.positional[0]! } });
  const tags = f.multi.get('--tag') ?? [];
  for (const t of tags) {
    const p = parseRef(t);
    if (!p.ok) return fail(state, out(`ERROR: failed to build: invalid tag "${t}": ${p.error.replace(/^invalid reference format: /, '').replace(/ \(.*\)/, '')}`), 'badTag', { key: 'sim.docker.err.badRef', params: { ref: t } });
  }
  // Several platforms at once (linux/amd64,linux/arm64) are not modelled: say so kindly (lesson D2-13 shows real output).
  if (f.values.get('--platform')?.includes(',')) {
    return {
      ...fail(state, out("This practice kitchen builds one platform at a time. The lesson shows a real multi-platform build."), 'explainOnly', { key: 'sim.docker.explain.notInSim', params: { cmd: 'docker build --platform linux/amd64,linux/arm64' } }),
      stopped: true,
    };
  }
  // Build secrets (`--secret id=npmrc,src=.npmrc`): read before anything else, like the CLI does.
  const secretValues: Record<string, string> = {};
  for (const [id, from] of Object.entries(cliSecrets(f.multi.get('--secret') ?? []))) {
    if (from.src) {
      const text = s.fs.files[resolve(s, from.src)];
      if (text === undefined) {
        return fail(state, out(`ERROR: failed to build: failed to stat ${from.src}: stat ${from.src}: no such file or directory`), 'buildFailed', { key: 'sim.docker.err.buildFailed', params: { error: `failed to stat ${from.src}` } });
      }
      secretValues[id] = text;
    } else if (from.env && s.env[from.env] !== undefined) secretValues[id] = s.env[from.env]!;
  }
  const plain = f.values.get('--progress') === 'plain';
  const quiet = f.bools.has('--quiet');
  const dfName = f.values.get('--file') ?? 'Dockerfile';
  const dfPath = dfName.startsWith('/') ? dfName : resolve(s, dfName.includes('/') || f.values.has('--file') ? dfName : `${f.positional[0]}/${dfName}`);
  const dfText = s.fs.files[dfPath];
  const vertices: Vertex[] = [];
  const events: KitchenEvent[] = [];
  const v = (name: string, time = '0.0s', subs: { name: string; time: string }[] = []) => {
    const vx: Vertex = { name, time, subs, log: [] };
    vertices.push(vx);
    return vx;
  };
  const dfSize = dfText === undefined ? 2 : new TextEncoder().encode(dfText).length + 37;
  const defV = v(`[internal] load build definition from ${basename(dfName)}`, '0.0s', [{ name: `transferring dockerfile: ${dfSize}B`, time: '0.0s' }]);
  const finish = (error: string | null, extra: Line[] = [], dfLines?: string[], errLine?: number, errVertex?: Vertex): KitchenResult => {
    const outLines = render(vertices, plain, quiet, error, extra, dfName, dfLines, errLine, errVertex);
    if (error) {
      const r = fail(s === state ? state : state, outLines, 'buildFailed', { key: 'sim.docker.err.buildFailed', params: { error: error.slice(0, 160) } });
      r.events = [...events, ...r.events];
      return r;
    }
    return ok(s, outLines, events);
  };
  if (dfText === undefined) return finish(`failed to solve: failed to read dockerfile: open ${dfName}: no such file or directory`);
  const parsed = parseDockerfile(dfText);
  if (!parsed.ok) return finish(`failed to solve: ${parsed.error}`, [], parsed.lines, parsed.line);

  // Build checks (warnings), like BuildKit's.
  const warnings: string[] = [];
  for (const st of parsed.stages) {
    const fromIns = st.instrs[0]!;
    const asWord = fromIns.args.split(/\s+/).find((w) => w.toUpperCase() === 'AS');
    const fromWord = fromIns.raw.split(/\s+/)[0]!;
    if (asWord && ((fromWord === fromWord.toUpperCase()) !== (asWord === asWord.toUpperCase()))) {
      warnings.push(`FromAsCasing: 'as' and 'FROM' keywords' casing do not match (line ${fromIns.line})`);
    }
    for (const ins of st.instrs) {
      if ((ins.kw === 'CMD' || ins.kw === 'ENTRYPOINT') && !parseCmd(ins.args).exec) {
        warnings.push(`JSONArgsRecommended: JSON arguments recommended for ${ins.kw} to prevent unintended behavior related to OS signals (line ${ins.line})`);
      }
      if (ins.kw === 'ENV' || ins.kw === 'ARG') {
        for (const pair of ins.args.match(/(\w+)(?==)|^(\w+)$/g) ?? []) {
          if (SECRET_RE.test(pair)) warnings.push(`SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data (${ins.kw} "${pair}") (line ${ins.line})`);
        }
      }
      if (ins.kw === 'MAINTAINER') warnings.push(`MaintainerDeprecated: Maintainer instruction is deprecated in favor of using label (line ${ins.line})`);
    }
  }
  for (const w of warnings) defV.subs.push({ name: `WARN: ${w}`, time: '' });

  // Build args.
  const buildArgs: Record<string, string> = {};
  for (const a of f.multi.get('--build-arg') ?? []) {
    const i = a.indexOf('=');
    if (i > 0) buildArgs[a.slice(0, i)] = a.slice(i + 1);
    else if (s.env[a] !== undefined) buildArgs[a] = s.env[a]!;
  }
  const globals: Record<string, string> = {};
  for (const ins of parsed.globalArgs) {
    const [k, d] = ins.args.split('=');
    globals[k!] = buildArgs[k!] ?? d ?? '';
  }

  // Which stages are needed for the target?
  const stages = parsed.stages;
  const target = f.values.get('--target');
  let targetIdx = stages.length - 1;
  if (target) {
    targetIdx = stages.findIndex((x) => x.name === target);
    if (targetIdx < 0) return finish(`failed to solve: target stage "${target}" could not be found`);
  }
  const need = new Set<number>();
  const visit = (i: number) => {
    if (need.has(i)) return;
    need.add(i);
    const st = stages[i]!;
    const fromStage = stages.findIndex((x, j) => j < i && x.name === st.from);
    if (fromStage >= 0) visit(fromStage);
    for (const ins of st.instrs) {
      const m = /--from=(\S+)/.exec(ins.args);
      if (m && (ins.kw === 'COPY' || ins.kw === 'ADD')) {
        const ref = m[1]!;
        const j = /^\d+$/.test(ref) ? Number(ref) : stages.findIndex((x) => x.name === ref);
        if (j >= 0 && j < i) visit(j);
      }
    }
  };
  visit(targetIdx);

  // Load metadata for each distinct base image.
  const bases = new Map<string, LocalImage>();
  for (const i of [...need].sort((a, b) => a - b)) {
    const st = stages[i]!;
    const from = substitute(st.from, globals);
    if (from === 'scratch' || stages.some((x, j) => j < i && x.name === from) || bases.has(from)) continue;
    const pr = parseRef(from);
    if (!pr.ok) return finish(`failed to solve: failed to parse stage name "${from}": invalid reference format`, [], parsed.lines, st.line);
    const metaV = v(`[internal] load metadata for ${fullName(pr.ref)}`);
    const local = findImage(s, from);
    if (local && local.platform === (f.values.get('--platform') ?? local.platform)) {
      bases.set(from, local);
      continue;
    }
    const key = catalogKey(pr.ref);
    if (s.registry.rateLimited && pr.ref.domain === 'docker.io' && !s.registry.auth['docker.io']) {
      metaV.error = true;
      return finish(`failed to solve: ${from}: failed to resolve source metadata for ${fullName(pr.ref)}: ${rateLimitError(pr.ref)}`, [], parsed.lines, st.line, metaV);
    }
    const remoteRepo = s.registry.repos[`${pr.ref.domain}/${pr.ref.path}`]?.tags[pr.ref.tag];
    if (key && catalogEntry(key)) {
      metaV.time = '1.2s';
      bases.set(from, imageFromCatalog(key));
    } else if (remoteRepo) {
      bases.set(from, structuredClone(remoteRepo));
    } else {
      metaV.error = true;
      metaV.time = '0.9s';
      const why = key && catalogEntry(`${key.split(':')[0]}:latest`) === undefined && !MEASURED_REPOS.has(key.split(':')[0]!)
        ? `failed to resolve source metadata for ${fullName(pr.ref)}: pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed`
        : `failed to resolve source metadata for ${fullName(pr.ref)}: ${fullName(pr.ref)}: not found`;
      return finish(`failed to solve: ${from}: ${why}`, [], parsed.lines, st.line, metaV);
    }
  }
  const ign = contextFiles(s, ctxDir);
  v('[internal] load .dockerignore', '0.0s', [{ name: `transferring context: ${ign.ignoreSize === null ? 2 : ign.ignoreSize + 40}B`, time: '0.0s' }]);

  const results: StageResult[] = [];
  const platform = f.values.get('--platform') ?? s.host.platform;
  const noCache = f.bools.has('--no-cache');
  let ctxLoaded = false;
  let warnedCtx = 0;
  // BuildKit names an unnamed stage "stage-0" once any RUN uses --mount (seen on Docker 29.9).
  const usesMount = stages.some((x) => x.instrs.some((ins) => ins.kw === 'RUN' && /^--mount=/.test(ins.args)));
  for (const i of [...need].sort((a, b) => a - b)) {
    const st = stages[i]!;
    const label = st.name ?? (stages.length > 1 || usesMount ? `stage-${i}` : '');
    const steps = st.instrs.filter((x) => ['FROM', 'WORKDIR', 'COPY', 'ADD', 'RUN'].includes(x.kw)).length;
    let n = 0;
    const tagOf = () => `[${label ? `${label} ` : ''}${++n}/${steps}]`;
    const from = substitute(st.from, globals);
    const prev = stages.findIndex((x, j) => j < i && x.name === from);
    let r: StageResult;
    if (prev >= 0) {
      const p = results[prev]!;
      r = structuredClone(p);
      n = 1;
    } else if (from === 'scratch') {
      r = { fs: { files: {}, dirs: ['/'], users: {}, bins: [], owners: {} }, config: {}, history: [], layers: [], blobs: [], key: 'scratch', baseUnpacked: 0, baseContent: 0, added: 0, addedCompressed: 0, kind: 'busybox', platform, env: {}, args: { ...globals }, workdir: '/', user: '' };
      n = 1;
    } else {
      const base = bases.get(from)!;
      const pr = parseRef(from) as { ok: true; ref: ReturnType<typeof parseRef> extends { ok: true; ref: infer R } ? R : never };
      const shownFrom = `${fullName(pr.ref)}@sha256:${base.id}`;
      // BuildKit keeps base images it fetched in its own cache (they don't show in `docker images`).
      const baseKey = `base:${base.id}`;
      const pulled = !findImage(s, from) && !s.buildCache.some((x) => x.key === baseKey);
      if (pulled) {
        const e = catalogEntry(base.catalogRef ?? '');
        s.buildCache.push({ key: baseKey, created: s.clock, lastUsed: s.clock, size: e ? parseSize(e.platformContent) : base.contentSize, description: `pulled from ${fullName(pr.ref)}`, diffId: base.id, inUse: true });
      }
      const subs = [{ name: `resolve ${shownFrom}`, time: '0.0s' }];
      if (pulled) {
        for (const [d, size] of catalogEntry(base.catalogRef ?? '')?.layers ?? []) subs.push({ name: `sha256:${d} ${humanSize(size)} / ${humanSize(size)}`, time: '0.4s' });
        for (const [d] of catalogEntry(base.catalogRef ?? '')?.layers ?? []) subs.push({ name: `extracting sha256:${d}`, time: '0.1s' });
      }
      v(`${tagOf()} FROM ${shownFrom}`, pulled ? '2.1s' : '0.0s', subs);
      const env: Record<string, string> = {};
      for (const e of base.config.Env ?? []) env[e.split('=')[0]!] = e.split('=').slice(1).join('=');
      const plat = base.source === 'catalog' ? catalogEntry(base.catalogRef ?? '') : undefined;
      const baseContent = plat ? parseSize(plat.platformContent) : base.contentSize;
      const baseDisk = plat ? parseSize(plat.platformDisk) : base.diskSize;
      r = {
        fs: fsFromImage(base),
        config: structuredClone(base.config),
        history: structuredClone(base.history),
        layers: [...base.layers],
        blobs: [...base.blobs],
        key: `base:${base.id}`,
        baseUnpacked: baseDisk - baseContent,
        baseContent,
        added: 0,
        addedCompressed: 0,
        kind: base.kind,
        catalogRef: base.catalogRef,
        platform: st.platform ?? platform,
        env,
        args: { ...globals },
        workdir: base.config.WorkingDir || '/',
        user: base.config.User ?? '',
      };
    }
    const stageArgs: Record<string, string> = {};
    const vars = () => ({ ...r.args, ...stageArgs, ...r.env });
    for (const ins of st.instrs.slice(1)) {
      const text = ins.args;
      const now = s.clock;
      const hist = (createdBy: string, size = 0) => r.history.unshift({ createdBy, size, comment: 'buildkit.dockerfile.v0', created: now });
      switch (ins.kw) {
        case 'ARG': {
          const [k, d] = text.split('=');
          const val = buildArgs[k!] ?? (d !== undefined ? substitute(d, vars()) : globals[k!] ?? '');
          stageArgs[k!] = val;
          hist(`ARG ${k}${val !== '' || d !== undefined ? `=${val}` : ''}`);
          break;
        }
        case 'ENV': {
          const pairs = text.includes('=') ? (text.match(/(\w+)=("[^"]*"|'[^']*'|\S+)/g) ?? []) : [`${text.split(/\s+/)[0]}=${text.split(/\s+/).slice(1).join(' ')}`];
          const shown: string[] = [];
          for (const p of pairs) {
            const i2 = p.indexOf('=');
            const k = p.slice(0, i2);
            const val = substitute(p.slice(i2 + 1).replace(/^["']|["']$/g, ''), vars());
            r.env[k] = val;
            shown.push(`${k}=${val}`);
          }
          r.config.Env = Object.entries(r.env).map(([k, x]) => `${k}=${x}`);
          hist(`ENV ${shown.join(' ')}`);
          break;
        }
        case 'LABEL': {
          const pairs = text.match(/([\w.-]+)=("[^"]*"|\S+)/g) ?? [];
          r.config.Labels ??= {};
          const shown: string[] = [];
          for (const p of pairs) {
            const i2 = p.indexOf('=');
            const val = substitute(p.slice(i2 + 1).replace(/^"|"$/g, ''), vars());
            r.config.Labels[p.slice(0, i2)] = val;
            shown.push(`${p.slice(0, i2)}=${val}`);
          }
          hist(`LABEL ${shown.join(' ')}`);
          break;
        }
        case 'EXPOSE': {
          const ports = substitute(text, vars()).split(/\s+/).map((p) => (p.includes('/') ? p : `${p}/tcp`));
          r.config.ExposedPorts = { ...(r.config.ExposedPorts ?? {}) };
          for (const p of ports) r.config.ExposedPorts[p] = {};
          hist(`EXPOSE [${ports.join(' ')}]`);
          break;
        }
        case 'USER': {
          r.user = substitute(text, vars());
          r.config.User = r.user;
          hist(`USER ${r.user}`);
          break;
        }
        case 'CMD':
        case 'ENTRYPOINT': {
          const c = parseCmd(text);
          const list = c.exec ?? ['/bin/sh', '-c', c.shell];
          if (ins.kw === 'CMD') r.config.Cmd = list;
          else {
            r.config.Entrypoint = list;
            r.config.Cmd = null;
          }
          hist(cmdHistory(ins.kw, list));
          break;
        }
        case 'STOPSIGNAL':
          r.config.StopSignal = text;
          hist(`STOPSIGNAL ${text}`);
          break;
        case 'VOLUME': {
          const c = parseCmd(text);
          const list = c.exec ?? text.split(/\s+/);
          r.config.Volumes = { ...(r.config.Volumes ?? {}) };
          for (const p of list) r.config.Volumes[p] = {};
          hist(`VOLUME [${list.join(' ')}]`);
          break;
        }
        case 'HEALTHCHECK': {
          if (/^NONE$/i.test(text)) {
            r.config.Healthcheck = { Test: ['NONE'] };
            hist('HEALTHCHECK NONE');
            break;
          }
          const flags: Record<string, string> = {};
          let rest = text;
          for (;;) {
            const m = /^--(\w[\w-]*)=(\S+)\s*/.exec(rest);
            if (!m) break;
            flags[m[1]!] = m[2]!;
            rest = rest.slice(m[0].length);
          }
          const cmd = rest.replace(/^CMD\s+/i, '');
          const c = parseCmd(cmd);
          const hc: HealthConfig = { Test: c.exec ? ['CMD', ...c.exec] : ['CMD-SHELL', c.shell] };
          const sec = (x?: string) => (x ? Number(x.replace(/s$/, '').replace(/m$/, '')) * (x.endsWith('m') ? 60 : 1) : undefined);
          if (flags.interval) hc.Interval = sec(flags.interval);
          if (flags.retries) hc.Retries = Number(flags.retries);
          if (flags['start-period']) hc.StartPeriod = sec(flags['start-period']);
          r.config.Healthcheck = hc;
          hist(`HEALTHCHECK {Test:[${hc.Test.join(' ')}] Interval:${flags.interval ?? '0s'} Timeout:${flags.timeout ?? '0s'} StartPeriod:${flags['start-period'] ?? '0s'} StartInterval:0s Retries:${flags.retries ?? 0}}`);
          break;
        }
        case 'MAINTAINER':
          hist(`MAINTAINER ${text}`);
          break;
        case 'SHELL':
        case 'ONBUILD':
          hist(`${ins.kw} ${text}`);
          break;
        case 'WORKDIR':
        case 'COPY':
        case 'ADD':
        case 'RUN': {
          const tag = tagOf();
          let shown = displayExpand(ins.raw.replace(/^\S+/, ins.kw), vars());
          if (ins.kw === 'RUN' && shown.length > 200) shown = `${shown.slice(0, 199)}…`;
          let added: FileMap = {};
          let addedDirs: string[] = [];
          let deleted: string[] = [];
          let size: number;
          let compress = 0.3;
          let log: string[] = [];
          let contentKey = '';
          let createdBy: string;
          if (ins.kw === 'WORKDIR') {
            const dir = normalize(substitute(text, vars()).startsWith('/') ? substitute(text, vars()) : `${r.workdir}/${substitute(text, vars())}`);
            r.workdir = dir;
            r.config.WorkingDir = dir;
            const exists = r.fs.dirs.includes(dir);
            if (!exists) addedDirs = [dir];
            size = exists ? 4096 : layerBytes([], {}, [dir]);
            createdBy = `WORKDIR ${dir}`;
          } else if (ins.kw === 'COPY' || ins.kw === 'ADD') {
            const words = text.match(/"[^"]*"|\S+/g) ?? [];
            const opts: Record<string, string> = {};
            while (words[0]?.startsWith('--')) {
              const w = words.shift()!;
              const [k, val] = w.slice(2).split('=');
              opts[k!] = val ?? 'true';
            }
            const c = parseCmd(words.join(' '));
            const list = (c.exec ?? words).map((w) => substitute(w, vars()));
            const dest = list.pop() ?? '.';
            let sourceFiles: FileMap;
            let fromLabel = '';
            if (opts.from) {
              const j = /^\d+$/.test(opts.from) ? Number(opts.from) : stages.findIndex((x) => x.name === opts.from);
              const src = j >= 0 ? results[j] : undefined;
              if (src) {
                sourceFiles = Object.fromEntries(Object.entries(src.fs.files).map(([p, x]) => [p.slice(1), x]));
                fromLabel = opts.from;
              } else {
                const img = findImage(s, opts.from) ?? (catalogEntry(opts.from) ? imageFromCatalog(opts.from) : null);
                sourceFiles = img ? Object.fromEntries(Object.entries(img.files).map(([p, x]) => [p.slice(1), x])) : {};
              }
            } else {
              if (!ctxLoaded) {
                ctxLoaded = true;
                const bytes = Object.values(ign.files).reduce((m, x) => m + new TextEncoder().encode(x).length, 0);
                warnedCtx = bytes;
                v('[internal] load build context', '0.0s', [{ name: `transferring context: ${humanSize(bytes + 15 * Object.keys(ign.files).length)}`, time: '0.0s' }]);
              }
              sourceFiles = ign.files;
            }
            const destAbs = normalize(dest.startsWith('/') ? dest : `${r.workdir}/${dest}`);
            const intoDir = dest.endsWith('/') || dest === '.' || list.length > 1 || r.fs.dirs.includes(destAbs);
            for (const srcPat of list) {
              const hits = matchSources(sourceFiles, srcPat);
              if (!hits) {
                const vx = v(`ERROR ${tag} ${shown}`);
                vx.error = true;
                const fromV = vertices.find((x) => x.name.includes('FROM') && x.name.startsWith(tag.replace(/\d+\//, '1/')));
                if (fromV) fromV.canceled = true;
                const ref = `${cacheId(`${s.seed}${s.counter}a`)}::${cacheId(`${s.seed}${s.counter}b`)}`;
                const msg = fromLabel
                  ? `failed to solve: failed to compute cache key: failed to calculate checksum of ref ${ref}: "/${normalize(srcPat).replace(/^\//, '')}": not found`
                  : `failed to solve: failed to compute cache key: failed to calculate checksum of ref ${ref}: "/${normalize(srcPat).replace(/^\//, '')}": not found`;
                return finish(msg, [], parsed.lines, ins.line, vx);
              }
              const isDirSrc = !(normalize(srcPat).replace(/^\//, '') in sourceFiles) && !/[*?[]/.test(srcPat);
              for (const h of hits) {
                const rel = isDirSrc ? h.slice(normalize(srcPat).replace(/^\.?\/?/, '').length).replace(/^\//, '') : basename(h);
                const target = intoDir || isDirSrc ? `${destAbs === '/' ? '' : destAbs}/${rel}` : destAbs;
                added[target] = sourceFiles[h]!;
                contentKey += `${target}:${hexOf(sourceFiles[h]!, 16)};`;
              }
            }
            if (intoDir && !r.fs.dirs.includes(destAbs)) addedDirs.push(destAbs);
            for (const p of Object.keys(added)) {
              let d = dirname(p);
              while (d !== '/' && !r.fs.dirs.includes(d) && !addedDirs.includes(d)) {
                addedDirs.push(d);
                d = dirname(d);
              }
            }
            if (opts.chown) {
              const who = substitute(opts.chown, vars());
              const uid = /^\d+/.test(who) ? Number(who.split(':')[0]) : (r.fs.users[who.split(':')[0]!]?.[0] ?? 0);
              for (const p of [...Object.keys(added), ...addedDirs]) r.fs.owners[p] = uid;
            }
            size = layerBytes(Object.keys(added), added, addedDirs);
            createdBy = `${ins.kw} ${opts.chown ? `--chown=${opts.chown} ` : ''}${list.join(' ')} ${dest} # buildkit`;
            compress = 0.05;
          } else {
            const rf = runFlags(text);
            const c = parseCmd(rf.command);
            // Secret mounts: the file (and env var) exist only while this RUN runs.
            const secretFiles: FileMap = {};
            const secretEnv: Record<string, string> = {};
            for (const m of rf.mounts) {
              if (m.type !== 'secret' || !m.id) continue;
              const val = secretValues[m.id];
              if (val === undefined) {
                if (!m.required) continue;
                const vx = v(`ERROR ${tag} ${shown}`, '0.0s');
                vx.error = true;
                return finish(`failed to solve: secret ${m.id}: not found`, [], parsed.lines, ins.line, vx);
              }
              secretFiles[m.target!] = val;
              if (m.env) {
                secretEnv[m.env] = val;
                shown = shown.replace(new RegExp(`\\$\\{?${m.env}\\b\\}?`, 'g'), '****');
              }
            }
            const script = substitute(c.exec ? c.exec.join(' ') : c.shell, { ...vars(), ...secretEnv });
            const saved = Object.keys(secretFiles).map((p) => [p, r.fs.files[p]] as const);
            Object.assign(r.fs.files, secretFiles);
            const eff = runEffects(r.fs, script, r.workdir, r.kind, r.kind === 'alpine' ? alpineOf(bases.get(from) ?? null) : '3.24', { ...r.env, ...secretEnv });
            for (const [p, old] of saved) {
              if (old === undefined) delete r.fs.files[p];
              else r.fs.files[p] = old;
              delete eff.added[p];
            }
            const usedArgs = Object.entries(stageArgs);
            const argPrefix = usedArgs.length ? `|${usedArgs.length} ${usedArgs.map(([k, x]) => `${k}=${x}`).join(' ')} ` : '';
            createdBy = `RUN ${argPrefix}${c.exec ? c.exec.join(' ') : `/bin/sh -c ${c.shell}`} # buildkit`;
            contentKey = `${JSON.stringify(r.env)}|${r.user}|${argPrefix}|${rf.flags.join(' ')}`;
            log = eff.log;
            if (!eff.ok) {
              const vx = v(`ERROR ${tag} ${shown}`, '0.2s');
              vx.error = true;
              vx.log = eff.log;
              return finish(`failed to solve: process "${c.exec ? c.exec.join(' ') : `/bin/sh -c ${c.shell}`}" did not complete successfully: exit code: ${eff.code}`, [], parsed.lines, ins.line, vx);
            }
            added = eff.added;
            addedDirs = eff.addedDirs;
            deleted = eff.deleted;
            size = Math.max(4096, eff.size + layerBytes(Object.keys(eff.added), eff.added, eff.addedDirs));
            compress = eff.compress;
            if (r.user && r.user !== 'root' && (script.includes('apk add') || script.includes('apt-get'))) {
              const vx = v(`ERROR ${tag} ${shown}`, '0.1s');
              vx.error = true;
              // apk as non-root: Alpine 3.24's apk stops at its log file; 3.22's at the database (Docker 29.9).
              const alpineMinor = Number(/VERSION_ID=\d+\.(\d+)/.exec(r.fs.files['/etc/os-release'] ?? '')?.[1] ?? 24);
              const apkErr = alpineMinor >= 24 ? ['ERROR: Unable to open log: Permission denied'] : ['ERROR: Unable to lock database: Permission denied', 'ERROR: Failed to open apk database: Permission denied'];
              vx.log = script.includes('apk') ? apkErr : ['E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)'];
              return finish(`failed to solve: process "/bin/sh -c ${c.shell}" did not complete successfully: exit code: ${script.includes('apk') ? 99 : 100}`, [], parsed.lines, ins.line, vx);
            }
          }
          const key = hexOf(`${r.key}|${ins.kw}|${createdBy}|${contentKey}|${r.workdir}`);
          const hit = !noCache && s.buildCache.find((x) => x.key === key);
          let diffId: string;
          if (hit) {
            diffId = hit.diffId;
            hit.lastUsed = s.clock;
            const stored = s.layerStore[diffId];
            if (stored) {
              added = stored.files;
              addedDirs = stored.dirs;
              deleted = stored.deleted;
              size = stored.size;
              if (stored.users) Object.assign(r.fs.users, stored.users);
              if (stored.bins) r.fs.bins.push(...stored.bins.filter((b) => !r.fs.bins.includes(b)));
            }
            const vx = v(`CACHED ${tag} ${shown}`);
            vx.cached = true;
            events.push({ type: 'layerCached', step: tag, instruction: shown });
          } else {
            diffId = hexOf(`${key}:${s.clock}:${s.counter++}`);
            s.buildCache = s.buildCache.filter((x) => x.key !== key);
            s.buildCache.push({ key: cacheId(key), created: s.clock, lastUsed: s.clock, size, description: createdBy, diffId, inUse: false });
            s.buildCache[s.buildCache.length - 1]!.key = key;
            s.layerStore[diffId] = { files: added, dirs: addedDirs, deleted, size, users: { ...r.fs.users }, bins: [...r.fs.bins] };
            const vx = v(`${tag} ${shown}`, ins.kw === 'RUN' ? `${(1 + (size > 1e6 ? 1.5 : 0.2)).toFixed(1)}s` : '0.0s');
            vx.log = log;
            events.push({ type: 'layerBuilt', step: tag, instruction: shown, size });
          }
          for (const [p, x] of Object.entries(added)) r.fs.files[p] = x;
          for (const d of addedDirs) if (!r.fs.dirs.includes(d)) r.fs.dirs.push(d);
          for (const d of deleted) delete r.fs.files[d];
          r.key = key;
          r.layers.push(diffId);
          r.blobs.push(diffId);
          r.added += size;
          r.addedCompressed += Math.max(150, Math.round(size * compress));
          r.history.unshift({ createdBy, size, comment: 'buildkit.dockerfile.v0', created: hit ? (hit.created ?? now) : now });
          break;
        }
      }
    }
    results[i] = r;
  }
  void warnedCtx;

  // Export the target stage.
  const r = results[targetIdx]!;
  const labels = f.multi.get('--label') ?? [];
  for (const l of labels) {
    r.config.Labels ??= {};
    r.config.Labels[l.split('=')[0]!] = l.split('=').slice(1).join('=');
  }
  const contentSize = r.baseContent + r.addedCompressed + 1800;
  const unpacked = r.baseUnpacked + r.added;
  const id = hexOf(`image:${r.key}:${JSON.stringify(r.config)}:${s.clock}`);
  const img: LocalImage = {
    id,
    repoTags: [],
    repoDigests: [],
    created: s.clock,
    config: r.config,
    history: r.history,
    layers: r.layers,
    blobs: r.blobs,
    diskSize: unpacked + contentSize,
    contentSize,
    size: unpacked,
    platform: r.platform,
    kind: r.kind,
    files: r.fs.files,
    dirs: r.fs.dirs,
    users: r.fs.users,
    bins: r.fs.bins,
    owners: r.fs.owners,
    source: 'build',
    catalogRef: r.catalogRef,
  };
  s.images[id] = img;
  const exportSubs = [
    { name: 'exporting layers', time: '0.0s' },
    { name: `exporting manifest sha256:${hexOf(`${id}:m`)}`, time: '0.0s' },
    { name: `exporting config sha256:${hexOf(`${id}:c`)}`, time: '0.0s' },
    { name: `exporting attestation manifest sha256:${hexOf(`${id}:a`)}`, time: '0.0s' },
    { name: `exporting manifest list sha256:${id}`, time: '0.0s' },
  ];
  for (const t of tags) {
    const p = parseRef(t) as { ok: true; ref: Parameters<typeof fullName>[0] };
    setTag(s, fullName(p.ref), img);
    exportSubs.push({ name: `naming to ${fullName(p.ref)}`, time: '0.0s' }, { name: `unpacking to ${fullName(p.ref)}`, time: '0.0s' });
    events.push({ type: 'imageBuilt', ref: familiar(p.ref), id });
  }
  if (!tags.length) events.push({ type: 'imageBuilt', ref: null, id });
  v('exporting to image', '0.1s', exportSubs);
  s.lastBuild = {
    ref: tags[0] ? familiar((parseRef(tags[0]) as { ok: true; ref: Parameters<typeof familiar>[0] }).ref) : null,
    id,
    cached: events.filter((e) => e.type === 'layerCached').length,
    built: events.filter((e) => e.type === 'layerBuilt').length,
    steps: events.flatMap((e): { step: string; instruction: string; cached: boolean; size: number }[] => (e.type === 'layerCached' ? [{ step: e.step, instruction: e.instruction, cached: true, size: 0 }] : e.type === 'layerBuilt' ? [{ step: e.step, instruction: e.instruction, cached: false, size: e.size }] : [])),
  };
  if (quiet) return ok(s, [line(`sha256:${id}`)], events, { key: 'sim.docker.explain.buildQuiet' });
  const res = finish(null, warnings.length ? [line(''), [{ t: ` ${warnings.length} warning${warnings.length > 1 ? 's' : ''} found (use docker --debug to expand):`, c: 'yellow' }], ...warnings.map((w) => line(` - ${w}`))] : []);
  const cached = events.filter((e) => e.type === 'layerCached').length;
  const built = events.filter((e) => e.type === 'layerBuilt').length;
  res.explain = {
    key: warnings.length ? 'sim.docker.explain.buildWarn' : cached && !built ? 'sim.docker.explain.buildAllCached' : cached ? 'sim.docker.explain.buildSomeCached' : 'sim.docker.explain.build',
    params: { ref: tags[0] ? familiar((parseRef(tags[0]) as { ok: true; ref: Parameters<typeof familiar>[0] }).ref) : id.slice(0, 12), cached: String(cached), built: String(built), n: String(warnings.length) },
  };
  return res;
};

const MEASURED_REPOS = new Set(['hello-world', 'alpine', 'busybox', 'nginx', 'node', 'python', 'postgres', 'redis']);

/** BuildKit's progress view (TTY) or plain log, plus the error block. */
function render(vertices: Vertex[], plain: boolean, quiet: boolean, error: string | null, extra: Line[], dfName: string, dfLines?: string[], errLine?: number, errVertex?: Vertex): Line[] {
  const outLines: Line[] = [];
  const total = vertices.length;
  if (quiet && !error) return outLines;
  const totalTime = vertices.reduce((n, x) => n + Number.parseFloat(x.time || '0'), 0).toFixed(1);
  if (plain) {
    outLines.push(line('#0 building with "default" instance using docker driver'), line(''));
    vertices.forEach((vx, i) => {
      const n = `#${i + 1}`;
      const name = vx.name.replace(/^(CACHED|ERROR) /, '');
      outLines.push(line(`${n} ${name}`));
      for (const sub of vx.subs) outLines.push(line(sub.name.startsWith('WARN:') ? `${n} ${sub.name}` : `${n} ${sub.name} done`));
      for (const l of vx.log) outLines.push(line(`${n} 0.215 ${l}`));
      if (vx.cached) outLines.push(line(`${n} CACHED`));
      else if (vx.error) outLines.push(line(`${n} ERROR: ${error ?? ''}`.replace('failed to solve: ', '')));
      else outLines.push(line(`${n} DONE ${vx.time || '0.0s'}`));
      outLines.push(line(''));
    });
  } else {
    outLines.push([{ t: spread(`[+] Building ${totalTime}s (${total}/${total}) FINISHED`, 'docker:default', WIDTH), c: error ? 'red' : 'blue' }]);
    for (const vx of vertices) {
      const name = vx.canceled ? `CANCELED ${vx.name}` : vx.name;
      outLines.push(vx.error ? [{ t: spread(` => ${name}`, vx.time || '0.0s', WIDTH), c: 'red' }] : vx.cached ? [{ t: spread(` => ${name}`, vx.time || '0.0s', WIDTH), c: 'blue' }] : line(spread(` => ${name}`, vx.time || '0.0s', WIDTH)));
      for (const sub of vx.subs) {
        if (sub.name.startsWith('WARN:')) outLines.push([{ t: ` => ${sub.name}`, c: 'yellow' }]);
        else outLines.push(line(spread(` => => ${sub.name}`, sub.time, WIDTH)));
      }
    }
  }
  if (error) {
    if (errVertex) {
      const name = errVertex.name.replace(/^(ERROR|CACHED) /, '');
      outLines.push(line('------'), line(` > ${name}:`));
      for (const l of errVertex.log) outLines.push(line(`0.215 ${l}`));
      outLines.push(line('------'));
    }
    if (dfLines && errLine) {
      outLines.push(line(`${basename(dfName)}:${errLine}`), line('--------------------'));
      const from = Math.max(1, errLine - 2);
      const to = Math.min(dfLines.length, errLine + 1);
      for (let i = from; i <= to; i++) outLines.push(line(`${String(i).padStart(4)} | ${i === errLine ? '>>> ' : '    '}${dfLines[i - 1] ?? ''}`));
      outLines.push(line('--------------------'));
    }
    outLines.push([{ t: `ERROR: failed to build: ${error}`, c: 'red' }]);
  }
  outLines.push(...extra);
  return outLines;
}
