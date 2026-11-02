// What each known action and command does on the fake runner.
// Logs are short but look like the real tools; real error lines are kept word for word
// where we are sure of them, and every failure carries a plain-words note (`why`).
import { parseUses } from './actions';
import type { Job, LogLine, Note, Permissions, Scalar, Trigger, World } from './types';

export interface StepMark {
  type: 'cacheHit' | 'cacheMiss' | 'artifactUploaded' | 'artifactDownloaded';
  key: string;
  partial?: boolean;
}

export interface JobState {
  checkedOut: boolean;
  deps: boolean;
  /** npm cache result from setup-node or actions/cache. */
  npmCache: 'hit' | 'partial' | 'miss' | null;
  builder: boolean;
  /** docker/setup-qemu-action ran: the runner can build for other CPU types. */
  qemu?: boolean;
  loggedIn: Record<string, { viaToken: boolean }>;
  /** Cache keys to save in the post-job step (misses). */
  saves: string[];
  layersSaved: boolean;
  /** Variables written to $GITHUB_ENV. */
  env: Record<string, string>;
}

export interface RunState {
  artifacts: Map<string, { job: string; t: number }>;
}

export interface Repo {
  owner: string;
  name: string;
  full: string;
  private: boolean;
  defaultBranch: string;
}

export interface StepCtx {
  world: World;
  trigger: Trigger;
  eventName: string;
  repo: Repo;
  sha: string;
  perms: Permissions;
  /** Secrets are empty (a fork's pull request). */
  noSecrets: boolean;
  job: Job;
  jobKey: string;
  leg?: Record<string, Scalar>;
  legIndex: number;
  /** Merged env for this step (workflow, job, $GITHUB_ENV, step), already interpolated. */
  env: Record<string, string>;
  /** `with:` inputs, interpolated. */
  with: Record<string, string>;
  /** `with:` inputs as written (to see where a value came from). */
  rawWith: Record<string, string>;
  js: JobState;
  rs: RunState;
  /** Current time on the fake clock (seconds). */
  now: number;
  lockHash: string;
  oldLockHash: string;
}

export interface Outcome {
  ok: boolean;
  seconds: number;
  log: LogLine[];
  why?: Note;
  outputs?: Record<string, string>;
  marks?: StepMark[];
  /** A learner-facing note that is not a failure (e.g. the simulator pretends). */
  note?: Note;
  /** The command never ends (until a timeout). */
  hang?: boolean;
}

export const TOKEN_VALUE = 'ghs_flToken000000';
export const secretValue = (name: string) => `fl-secret-${name}`;

const out = (text: string, kind?: LogLine['kind']): LogLine => (kind ? { text, kind } : { text });
const fail = (log: LogLine[], why: Note, seconds = 2, extra: Partial<Outcome> = {}): Outcome => ({ ok: false, seconds, log, why, ...extra });
const pass = (log: LogLine[], seconds: number, extra: Partial<Outcome> = {}): Outcome => ({ ok: true, seconds, log, ...extra });
const why = (key: string, params?: Note['params']): Note => (params ? { key: `conveyor.why.${key}`, params } : { key: `conveyor.why.${key}` });
const exitLine = (code: number) => out(`Error: Process completed with exit code ${code}.`, 'err');

/** A short fake hex string, the same for the same input. */
export function fakeHex(seed: string, len = 64): string {
  let h = 2166136261;
  let s = '';
  while (s.length < len) {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    s += (h >>> 0).toString(16).padStart(8, '0');
    seed += s.length;
  }
  return s.slice(0, len);
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function registryOf(image: string): string {
  const first = image.split('/')[0] ?? '';
  return image.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost') ? first : 'docker.io';
}

function testsFail(c: StepCtx): string[] {
  const f = c.world.fail;
  if (!f?.tests?.length) return [];
  if (f.onlyIn && c.leg) {
    for (const [k, v] of Object.entries(f.onlyIn)) if (String(c.leg[k]) !== String(v)) return [];
  } else if (f.onlyIn && !c.leg) return [];
  return f.tests;
}

function hangs(c: StepCtx, text: string): boolean {
  const h = c.world.fail?.hang;
  return Boolean(h && text.includes(h));
}

// ---------- actions ----------

export function runAction(uses: string, c: StepCtx): Outcome {
  const u = parseUses(uses);
  const w = c.with;
  switch (u.name) {
    case 'actions/checkout': {
      if (c.repo.private && (c.perms.contents ?? 'none') === 'none') {
        return fail([out('remote: Repository not found.', 'err'), out(`Error: fatal: repository 'https://github.com/${c.repo.full}/' not found`, 'err')], why('repoNotFound'));
      }
      c.js.checkedOut = true;
      const log = [out(`Syncing repository: ${c.repo.full}`), out('Getting Git version info'), out('Fetching the repository')];
      if (w.ref) log.push(out(`Checking out the ref: ${w.ref}`));
      log.push(out(`HEAD is now at ${c.sha.slice(0, 7)}`, 'dim'));
      return pass(log, 2);
    }
    case 'actions/setup-node': {
      const v = w['node-version'] || (w['node-version-file'] ? `(from ${w['node-version-file']})` : 'latest');
      const log = [out('Environment details', 'dim'), out(`  node: v${v.replace(/^v/, '')}`, 'dim')];
      const marks: StepMark[] = [];
      let seconds = 3;
      if (w.cache) {
        if (!c.js.checkedOut) {
          return fail(
            [out('Error: Dependencies lock file is not found in /home/runner/work. Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock', 'err')],
            why('noLockForCache'),
          );
        }
        const key = `node-cache-Linux-x64-${w.cache}-${c.lockHash}`;
        const warm = c.world.cache?.warm && !c.world.cache?.lockfileChanged;
        if (warm) {
          log.push(out(`Cache restored from key: ${key}`, 'ok'));
          marks.push({ type: 'cacheHit', key });
          c.js.npmCache = 'hit';
          seconds += 2;
        } else {
          log.push(out(`${w.cache} cache is not found`));
          marks.push({ type: 'cacheMiss', key });
          c.js.npmCache = 'miss';
          c.js.saves.push(key);
        }
      }
      return pass(log, seconds, { marks });
    }
    case 'actions/cache': {
      const key = w.key ?? '';
      const restore = list(w['restore-keys']);
      const usesHash = (c.rawWith.key ?? '').includes('hashFiles');
      const warm = Boolean(c.world.cache?.warm);
      const exact = warm && !(usesHash && c.world.cache?.lockfileChanged);
      const npmPath = /npm|node_modules/.test(w.path ?? '');
      if (exact) {
        if (npmPath) c.js.npmCache = 'hit';
        return pass([out(`Cache restored from key: ${key}`, 'ok')], 3, { outputs: { 'cache-hit': 'true' }, marks: [{ type: 'cacheHit', key }] });
      }
      c.js.saves.push(key);
      if (warm && restore.length) {
        const old = `${restore[0]}${c.oldLockHash}`;
        if (npmPath) c.js.npmCache = 'partial';
        return pass([out(`Cache restored from key: ${old}`, 'ok')], 3, { outputs: { 'cache-hit': 'false' }, marks: [{ type: 'cacheHit', key: old, partial: true }] });
      }
      if (npmPath) c.js.npmCache = 'miss';
      if (w['fail-on-cache-miss'] === 'true') {
        return fail([out(`Error: Failed to restore cache entry. Exiting as fail-on-cache-miss is set. Input key: ${key}`, 'err')], why('cacheRequired'));
      }
      return pass([out(`Cache not found for input keys: ${[key, ...restore].join(', ')}`)], 1, { outputs: { 'cache-hit': 'false' }, marks: [{ type: 'cacheMiss', key }] });
    }
    case 'actions/upload-artifact': {
      const name = w.name || 'artifact';
      if (c.rs.artifacts.has(name) && w.overwrite !== 'true') {
        return fail(
          [out('Error: Failed to CreateArtifact: Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run', 'err')],
          why('artifactDuplicate', { name }),
        );
      }
      c.rs.artifacts.set(name, { job: c.jobKey, t: c.now + 3 });
      const size = 40000 + (parseInt(fakeHex(name, 4), 16) % 20000);
      return pass([out(`With the provided path, there will be 12 files uploaded`), out(`Artifact ${name} has been successfully uploaded! Final size is ${size} bytes.`, 'ok')], 3, {
        marks: [{ type: 'artifactUploaded', key: name }],
        outputs: { 'artifact-id': String(1000 + (size % 900)) },
      });
    }
    case 'actions/download-artifact': {
      const name = w.name;
      if (!name) {
        const names = [...c.rs.artifacts.entries()].filter(([, a]) => a.t <= c.now).map(([n]) => n);
        return pass([out(`Downloading ${names.length} artifacts`)], 2, { marks: names.map((n) => ({ type: 'artifactDownloaded' as const, key: n })) });
      }
      const a = c.rs.artifacts.get(name);
      if (!a || a.t > c.now) {
        return fail([out(`Error: Unable to download artifact(s): Artifact not found for name: ${name}`, 'err')], why('artifactMissing', { name }));
      }
      return pass([out(`Found artifact '${name}'`), out(`Artifact download completed successfully.`, 'ok')], 2, { marks: [{ type: 'artifactDownloaded', key: name }] });
    }
    case 'actions/attest':
    case 'actions/attest-build-provenance': {
      if (c.perms['id-token'] !== 'write') {
        return fail([out('Error: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable', 'err')], why('idToken'));
      }
      if (c.perms.attestations !== 'write') {
        return fail([out('Error: Resource not accessible by integration', 'err')], why('permDenied', { scope: 'attestations' }));
      }
      const subject = w['subject-name'] || w['subject-path'] || 'artifact';
      return pass([out('Attestation signed using certificate from Sigstore', 'dim'), out(`Attestation created for ${subject}`, 'ok')], 4, {
        outputs: { 'attestation-id': fakeHex(subject, 8) },
      });
    }
    case 'docker/setup-buildx-action':
      c.js.builder = true;
      return pass([out('Creating a new builder instance'), out('Booting builder', 'dim')], 4);
    case 'docker/setup-qemu-action':
      c.js.qemu = true;
      return pass([out('Installing QEMU static binaries...')], 6);
    case 'docker/login-action': {
      const registry = w.registry || 'docker.io';
      if (!w.username || !w.password) {
        const raw = `${c.rawWith.username ?? ''} ${c.rawWith.password ?? ''}`;
        const secret = /secrets\.([A-Za-z_][A-Za-z0-9_]*)/.exec(raw)?.[1];
        const note = c.noSecrets && secret ? why('forkNoSecrets', { name: secret }) : why('secretMissing', { name: secret ?? 'password' });
        return fail([out('Error: Username and password required', 'err')], note, 1);
      }
      c.js.loggedIn[registry] = { viaToken: /GITHUB_TOKEN|github\.token/.test(c.rawWith.password ?? '') };
      return pass([out(`Logging into ${registry}...`), out('Login Succeeded!', 'ok')], 1);
    }
    case 'docker/metadata-action': {
      const images = list(w.images).map((i) => i.toLowerCase());
      const tags = metaTags(w.tags, c, w.flavor);
      const all = images.flatMap((img) => tags.map((t) => `${img}:${t}`));
      const log = [out('Docker tags', 'dim'), ...all.map((t) => out(`  ${t}`))];
      if (!all.length) log.push(out('  (no tags for this event)', 'dim'));
      return pass(log, 1, {
        outputs: { tags: all.join('\n'), version: tags[0] ?? '', labels: `org.opencontainers.image.revision=${c.sha}` },
      });
    }
    case 'docker/build-push-action':
      return buildPush(c);
    case 'aquasecurity/trivy-action':
      return trivy(c, w['image-ref'] || w['scan-ref'] || '.', w.severity, w['exit-code']);
    case 'hadolint/hadolint-action':
      return hadolint(c, w.dockerfile || 'Dockerfile', w['failure-threshold'] || 'info');
  }
  return pass([out(`Run ${uses}`, 'dim')], 3, { note: { key: 'conveyor.note.unknownAction', params: { uses } } });
}

/** docker/metadata-action tag rules (the common ones). */
function metaTags(spec: string | undefined, c: StepCtx, flavor?: string): string[] {
  const t = c.trigger;
  const isPr = c.eventName === 'pull_request' || c.eventName === 'pull_request_target';
  const branch = !isPr && !t.tag ? (t.branch ?? c.repo.defaultBranch) : null;
  const isDefault = branch === c.repo.defaultBranch;
  const rules = spec ? spec.split('\n').map((x) => x.trim()).filter(Boolean) : ['type=schedule', 'type=ref,event=branch', 'type=ref,event=tag', 'type=ref,event=pr'];
  const outTags: string[] = [];
  const semver = t.tag ? /^v?(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/.exec(t.tag) : null;
  const pre = semver?.[4] ?? '';
  // flavor latest=auto (the default): a pushed tag adds `latest` for type=ref,event=tag and
  // type=semver (not for a pre-release like v1.2.0-rc.1). latest=true: always; latest=false: never.
  const latestFlavor = /(?:^|[\n,])\s*latest=(\w+)/.exec(flavor ?? '')?.[1] ?? 'auto';
  let latest = latestFlavor === 'true';
  for (const rule of rules) {
    const attrs: Record<string, string> = {};
    for (const part of rule.split(/,(?![^{]*})/)) {
      const [k, ...v] = part.split('=');
      attrs[k!.trim()] = v.join('=').trim();
    }
    const enable = attrs.enable;
    if (enable === 'false' || (enable === '{{is_default_branch}}' && !isDefault)) continue;
    const prefix = attrs.prefix ?? '';
    switch (attrs.type) {
      case 'ref':
        if (attrs.event === 'branch' && branch) outTags.push(prefix + branch.replace(/[^\w.-]/g, '-'));
        if (attrs.event === 'tag' && t.tag) {
          outTags.push(prefix + t.tag);
          if (latestFlavor === 'auto' && !pre) latest = true;
        }
        if (attrs.event === 'pr' && isPr) outTags.push(`${prefix || 'pr-'}${t.number ?? 1}`);
        break;
      case 'semver':
        if (semver) {
          const [, major, minor, patch] = semver;
          const pattern = attrs.pattern ?? '{{version}}';
          // A pre-release only gets the full {{version}} tag.
          if (pre && !pattern.includes('{{version}}')) break;
          outTags.push(prefix + pattern.replace('{{version}}', `${major}.${minor}.${patch}${pre}`).replace('{{major}}', major!).replace('{{minor}}', minor!).replace('{{patch}}', patch!));
          if (latestFlavor === 'auto' && !pre) latest = true;
        }
        break;
      case 'sha':
        outTags.push(`${attrs.prefix ?? 'sha-'}${c.sha.slice(0, 7)}`);
        break;
      case 'raw':
        if (attrs.value) outTags.push(prefix + attrs.value);
        break;
      case 'edge':
        if (isDefault) outTags.push('edge');
        break;
      case 'schedule':
        if (c.eventName === 'schedule') outTags.push('nightly');
        break;
    }
  }
  if (latest && latestFlavor !== 'false') outTags.push('latest');
  return [...new Set(outTags)];
}

function buildPush(c: StepCtx): Outcome {
  const w = c.with;
  const tags = list(w.tags);
  const push = w.push === 'true';
  const log: LogLine[] = [out('#0 building with "builder" instance using docker-container driver', 'dim')];
  if (!c.js.builder) log[0] = out('#0 building with "default" instance using docker driver', 'dim');
  const marks: StepMark[] = [];
  if (w['cache-to'] && !c.js.builder) {
    return fail(
      [...log, out('ERROR: Cache export is not supported for the docker driver.', 'err'), out('Switch to a different driver, or turn on the containerd image store, and try again.', 'err')],
      why('cacheExportDocker'),
    );
  }
  if (push && tags.length === 0) return fail([...log, out('ERROR: tag is needed when pushing to registry', 'err')], why('tagNeeded'));
  let seconds = 90;
  // Multi-platform: each platform the runner's CPU can't run needs QEMU (docker/setup-qemu-action).
  const platforms = list(w.platforms);
  if (platforms.length) {
    const native = c.job.runsOn.some((l) => /-arm$|^arm64$/.test(l)) ? 'linux/arm64' : 'linux/amd64';
    const foreign = platforms.filter((p) => p !== native);
    log.push(...platforms.map((p) => out(`#4 [${p} internal] load metadata for docker.io/library/node:24-alpine`, 'dim')));
    if (foreign.length && !c.js.qemu) {
      return fail(
        [
          ...log,
          out(`#7 [${foreign[0]} build 3/5] RUN npm ci`),
          out('#7 0.274 exec /bin/sh: exec format error', 'err'),
          out('ERROR: failed to build: failed to solve: process "/bin/sh -c npm ci" did not complete successfully: exit code: 255', 'err'),
        ],
        why('noQemu', { platform: foreign[0]! }),
        20,
      );
    }
    seconds += 60 * foreign.length;
  }
  const fromCache = /type=(gha|registry)/.test(w['cache-from'] ?? '');
  if (fromCache) {
    if (c.world.cache?.layers) {
      seconds = 25;
      log.push(out('#6 [build 2/5] COPY package*.json ./', 'dim'), out('#6 CACHED', 'ok'), out('#7 [build 3/5] RUN npm ci', 'dim'), out('#7 CACHED', 'ok'));
      marks.push({ type: 'cacheHit', key: 'docker layers' });
    } else {
      log.push(out('#5 importing cache manifest from gha:', 'dim'), out('#5 ERROR: cache not found', 'dim'));
      marks.push({ type: 'cacheMiss', key: 'docker layers' });
    }
  }
  if (/type=gha/.test(w['cache-to'] ?? '')) c.js.layersSaved = true;
  if (c.world.fail?.build) {
    return fail(
      [
        ...log,
        out('#8 [build 4/5] RUN npm run build'),
        out('#8 ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1', 'err'),
        out('ERROR: failed to build: failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1', 'err'),
      ],
      why('buildFailed'),
      seconds,
      { marks },
    );
  }
  const digest = `sha256:${fakeHex(tags.join(',') + c.sha)}`;
  log.push(out(platforms.length > 1 ? `#9 exporting manifest list for ${platforms.join(', ')}` : '#9 exporting to image', 'dim'));
  if (push) {
    for (const tag of tags) {
      const registry = registryOf(tag);
      const login = c.js.loggedIn[registry];
      if (!login) {
        return fail([...log, out(`ERROR: failed to push ${tag}: unauthorized: authentication required`, 'err')], why('pushUnauthorized', { registry }), seconds, { marks });
      }
      if (registry === 'ghcr.io' && login.viaToken && c.perms.packages !== 'write') {
        return fail([...log, out(`ERROR: failed to push ${tag}: denied: permission_denied: write_package`, 'err')], why('packagesWrite'), seconds, { marks });
      }
    }
    for (const tag of tags) log.push(out(`#9 pushing ${tag}`, 'dim'));
    log.push(out(`#9 pushing manifest done`, 'ok'));
    seconds += 10;
  } else log.push(out('#9 writing image done', 'ok'));
  return pass(log, seconds, { marks, outputs: { digest, imageid: `sha256:${fakeHex(digest, 64)}`, metadata: '{}' } });
}

const SEVERITIES = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function trivy(c: StepCtx, target: string, severity: string | undefined, exitCode: string | undefined): Outcome {
  const wanted = list(severity ?? SEVERITIES.join(',')).map((s) => s.toUpperCase());
  const found = c.world.fail?.cve;
  const log: LogLine[] = [out(`Scanning ${target}`, 'dim')];
  const hit = found && wanted.includes(found);
  if (!hit) {
    log.push(out(`Total: 0 (${wanted.map((s) => `${s}: 0`).join(', ')})`, 'ok'));
    return pass(log, hangs(c, 'trivy') ? 99999 : 22);
  }
  log.push(out(`Total: 1 (${wanted.map((s) => `${s}: ${s === found ? 1 : 0}`).join(', ')})`, 'warn'));
  log.push(out(`libexample  CVE-2099-0001  ${found}  installed 1.2.3  fixed 1.2.4`, 'err'));
  const code = Number(exitCode ?? '0') || 0;
  if (code !== 0) return fail([...log, exitLine(code)], why('cveFound', { severity: found }), 22);
  return pass(log, 22, { note: { key: 'conveyor.note.scanNoExit' } });
}

function hadolint(_c: StepCtx, file: string, threshold: string): Outcome {
  if (!_c.world.fail?.hadolint) return pass([out(`hadolint ${file}`, 'dim'), out('No problems found', 'ok')], 3);
  const log = [out(`${file}:1 DL3007 warning: Using latest is prone to errors if the image will ever update. Pin the version explicitly to a release tag`, 'warn')];
  if (threshold === 'error' || threshold === 'ignore') return pass(log, 3);
  return fail([...log, exitLine(1)], why('hadolint'), 3);
}

// ---------- run: scripts ----------

/** Split a run script into commands (bash -e: stops at the first failure). */
export function scriptCommands(script: string): string[] {
  const joined = script.replace(/\\\r?\n/g, ' ');
  const cmds: string[] = [];
  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    for (const part of line.split(/\s*&&\s*/)) if (part.trim()) cmds.push(part.trim());
  }
  return cmds;
}

/** Expand $VAR and ${VAR} from the step's env. */
function expand(cmd: string, env: Record<string, string>): string {
  return cmd.replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a: string | undefined, b: string | undefined) => {
    const k = (a ?? b)!;
    if (k === 'GITHUB_OUTPUT' || k === 'GITHUB_ENV' || k === 'GITHUB_STEP_SUMMARY') return m;
    return env[k] ?? '';
  });
}

function unquote(s: string): string {
  return s.replace(/^(['"])([\s\S]*)\1$/, '$2');
}

export function runScript(script: string, c: StepCtx): Outcome {
  const log: LogLine[] = [];
  const outputs: Record<string, string> = {};
  const marks: StepMark[] = [];
  let seconds = 0;
  let note: Note | undefined;
  for (const raw of scriptCommands(script)) {
    const r = runCommand(raw, c, outputs);
    log.push(...r.log);
    seconds += r.seconds;
    if (r.marks) marks.push(...r.marks);
    if (r.note && !note) note = r.note;
    if (r.hang) return { ok: false, seconds: 99999, log, hang: true, outputs, marks };
    if (!r.ok) return { ok: false, seconds: Math.max(1, seconds), log, why: r.why, outputs, marks, ...(note ? { note } : {}) };
  }
  return { ok: true, seconds: Math.max(1, seconds), log, outputs, marks, ...(note ? { note } : {}) };
}

function runCommand(raw: string, c: StepCtx, outputs: Record<string, string>): Outcome {
  if (hangs(c, raw)) return { ok: false, seconds: 99999, log: [out(raw.split(' ')[0] ?? '', 'dim')], hang: true };
  // Pipes: `echo "$TOKEN" | docker login ... --password-stdin`; otherwise the last command decides.
  const pipe = raw.split(/\s\|\s/);
  if (pipe.length > 1) {
    const last = pipe[pipe.length - 1]!;
    if (/docker login/.test(last) && /--password-stdin/.test(last)) {
      const piped = unquote(expand(pipe[0]!.replace(/^echo\s+/, '').trim(), c.env));
      return dockerLogin(last, c, piped);
    }
    return runCommand(last, c, outputs);
  }
  const cmd = expand(raw, c.env);
  const words = cmd.split(/\s+/);
  const [w0, w1] = words;

  // echo, with $GITHUB_OUTPUT / $GITHUB_ENV
  if (w0 === 'echo' || w0 === 'printf') {
    const redirect = /^(?:echo|printf)\s+(.*?)\s*>>\s*"?\$\{?(GITHUB_OUTPUT|GITHUB_ENV|GITHUB_STEP_SUMMARY)\}?"?\s*$/.exec(cmd);
    if (redirect) {
      const text = unquote(redirect[1]!.trim());
      const eq = text.indexOf('=');
      if (eq > 0 && redirect[2] !== 'GITHUB_STEP_SUMMARY') {
        const k = text.slice(0, eq);
        const v = text.slice(eq + 1);
        if (redirect[2] === 'GITHUB_OUTPUT') outputs[k] = v;
        else c.js.env[k] = v;
      }
      return pass([], 0);
    }
    return pass([out(unquote(cmd.replace(/^(echo|printf)\s*/, '')))], 0);
  }
  if (w0 === 'exit') {
    const code = Number(w1 ?? '0') || 0;
    return code === 0 ? pass([], 0) : fail([exitLine(code)], why('exitCode', { code }), 0);
  }
  if (w0 === 'sleep') return pass([], Number(w1) || 1);
  if (['cd', 'ls', 'cat', 'mkdir', 'export', 'set', 'true', 'pwd', 'cp', 'mv', 'rm', 'node', 'npm', 'npx', 'docker', 'curl', 'gh', 'hadolint', 'trivy', 'actionlint', 'wrangler'].indexOf(w0 ?? '') === -1) {
    return pass([out(`(${w0})`, 'dim')], 2, { note: { key: 'conveyor.note.unknownCommand', params: { command: w0 ?? '' } } });
  }
  if (['cd', 'ls', 'cat', 'mkdir', 'export', 'set', 'true', 'pwd', 'cp', 'mv', 'rm'].includes(w0!)) return pass([], 0);
  if (w0 === 'node') return pass([out('v24')], 0);

  // npm
  if (w0 === 'npm' && (w1 === 'ci' || w1 === 'install' || w1 === 'i')) {
    if (!c.js.checkedOut) {
      return fail(
        [out('npm error code EUSAGE', 'err'), out('npm error The `npm ci` command can only install with an existing package-lock.json or', 'err'), out('npm error npm-shrinkwrap.json with lockfileVersion >= 1.', 'err'), exitLine(1)],
        why('npmNoLock'),
        2,
      );
    }
    c.js.deps = true;
    const s = c.js.npmCache === 'hit' ? 6 : c.js.npmCache === 'partial' ? 12 : 28;
    return pass([out(`added 412 packages, and audited 413 packages in ${s}s`), out('found 0 vulnerabilities', 'ok')], s);
  }
  const script = w0 === 'npm' ? (w1 === 'test' || w1 === 't' ? 'test' : w1 === 'run' ? (words[2] ?? '') : null) : w0 === 'npx' ? (w1 ?? '') : null;
  if (script !== null && script !== '') {
    // npx wrangler <command…> | npm run deploy[:name] [-- flags]
    if (/^(wrangler)$/.test(script)) return deploy(c, words.slice(2));
    if (/^deploy/.test(script)) return script === 'deploy' ? deploy(c, ['deploy', ...words.slice(3)]) : deploy(c, [], `> ${script}`);
    if (!c.js.deps && w0 === 'npm') {
      const bin = /^test/.test(script) ? 'vitest' : /^lint/.test(script) ? 'eslint' : /^build/.test(script) ? 'vite' : script;
      return fail([out(`> ${script}`, 'dim'), out(`sh: 1: ${bin}: not found`, 'err'), exitLine(127)], why('notInstalled'), 1);
    }
    if (/^(test|vitest|jest)/.test(script)) return npmTest(c, script);
    if (/^lint|^eslint/.test(script)) return npmLint(c);
    if (/^build/.test(script)) {
      if (c.world.fail?.build) return fail([out(`> ${script}`, 'dim'), out('error during build:', 'err'), out('src/app.js (12:4): Expected ";" but found "}"', 'err'), exitLine(1)], why('buildFailed'), 9);
      return pass([out(`> ${script}`, 'dim'), out('✓ built in 4.20s', 'ok')], 14);
    }
    return pass([out(`> ${script}`, 'dim')], 5);
  }
  if (w0 === 'wrangler') return deploy(c, words.slice(1));

  // docker
  if (w0 === 'docker') {
    if (w1 === 'login') return dockerLogin(cmd, c, null);
    if (w1 === 'build' || (w1 === 'buildx' && words[2] === 'build')) {
      if (c.world.fail?.build) {
        return fail([out('#8 [build 4/5] RUN npm run build'), out('ERROR: failed to build: failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1', 'err'), exitLine(1)], why('buildFailed'), 60);
      }
      const tag = /(?:-t|--tag)\s+(\S+)/.exec(cmd)?.[1];
      return pass([out('#0 building with "default" instance using docker driver', 'dim'), out(`#9 naming to ${tag ?? 'image'} done`, 'ok')], 60);
    }
    if (w1 === 'push') {
      const image = words[2] ?? '';
      const registry = registryOf(image);
      const login = c.js.loggedIn[registry];
      if (!login) {
        const line = registry === 'docker.io' ? 'denied: requested access to the resource is denied' : 'unauthorized: authentication required';
        return fail([out(`The push refers to repository [${image.split(':')[0]}]`, 'dim'), out(line, 'err'), exitLine(1)], why('pushUnauthorized', { registry }), 3);
      }
      if (registry === 'ghcr.io' && login.viaToken && c.perms.packages !== 'write') {
        return fail([out(`The push refers to repository [${image.split(':')[0]}]`, 'dim'), out('denied: permission_denied: write_package', 'err'), exitLine(1)], why('packagesWrite'), 3);
      }
      return pass([out(`The push refers to repository [${image.split(':')[0]}]`, 'dim'), out(`${image.split(':')[1] ?? 'latest'}: digest: sha256:${fakeHex(image)} size: 1784`, 'ok')], 10);
    }
    // Tests inside a container: the image already holds the packages. A Compose stack brings its own database.
    const inCompose = w1 === 'compose' && (words.includes('run') || words.includes('exec'));
    if ((w1 === 'run' || inCompose) && /\bnpm (test|t|run test)\b/.test(cmd)) {
      const r = npmTest(c, 'test', inCompose);
      return { ...r, seconds: r.seconds + 8 };
    }
    if (w1 === 'compose' || w1 === 'run' || w1 === 'pull' || w1 === 'tag' || w1 === 'image' || w1 === 'ps' || w1 === 'logs') return pass([], w1 === 'compose' || w1 === 'run' ? 8 : 1);
    return pass([], 1);
  }

  // curl smoke tests
  if (w0 === 'curl') {
    const url = words.find((x) => /^https?:\/\//.test(unquote(x))) ?? '';
    const strict = /(^|\s)(-[a-zA-Z]*f[a-zA-Z]*|--fail|--fail-with-body)(\s|$)/.test(cmd);
    if (c.world.fail?.smoke) {
      if (strict) return fail([out('curl: (22) The requested URL returned error: 500', 'err'), exitLine(22)], why('smokeFailed', { url: unquote(url) }), 1);
      return pass([out('<h1>500 Internal Server Error</h1>', 'warn')], 1, { note: { key: 'conveyor.note.curlNoFail' } });
    }
    return pass([out('{"status":"ok"}', 'ok')], 1);
  }

  // GitHub CLI
  if (w0 === 'gh') {
    if (!c.env.GH_TOKEN && !c.env.GITHUB_TOKEN) {
      return fail([out('gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable. Example:', 'err'), out('  env:', 'err'), out('    GH_TOKEN: ${{ github.token }}', 'err'), exitLine(4)], why('ghNoToken'), 1);
    }
    const area = w1 === 'release' ? { scope: 'contents', path: 'releases' } : w1 === 'pr' ? { scope: 'pull-requests', path: 'issues/7/comments' } : w1 === 'issue' ? { scope: 'issues', path: 'issues/1/comments' } : null;
    const write = /^(create|comment|edit|merge|close|delete|upload)$/.test(words[2] ?? '');
    if (area && write && c.perms[area.scope] !== 'write') {
      return fail([out(`HTTP 403: Resource not accessible by integration (https://api.github.com/repos/${c.repo.full}/${area.path})`, 'err'), exitLine(1)], why('permDenied', { scope: area.scope }), 1);
    }
    return pass([out(w1 === 'release' && words[2] === 'create' ? `https://github.com/${c.repo.full}/releases/tag/${words[3] ?? ''}` : 'Done', 'ok')], 2);
  }
  if (w0 === 'hadolint') return hadolint(c, words[1] ?? 'Dockerfile', /--failure-threshold\s+(\w+)/.exec(cmd)?.[1] ?? 'info');
  if (w0 === 'trivy') {
    const code = /--exit-code\s+(\d+)/.exec(cmd)?.[1];
    const sev = /--severity\s+(\S+)/.exec(cmd)?.[1];
    return trivy(c, words[words.length - 1] ?? '', sev, code);
  }
  if (w0 === 'actionlint') return pass([], 2);
  return pass([], 1);
}

function dockerLogin(cmd: string, c: StepCtx, piped: string | null): Outcome {
  const words = cmd.trim().split(/\s+/);
  const registry = words.find((w, i) => i > 1 && !w.startsWith('-') && !/^(-u|--username)$/.test(words[i - 1] ?? '')) ?? 'docker.io';
  const pw = piped ?? /(?:-p|--password)\s+(\S+)/.exec(cmd)?.[1] ?? '';
  if (!pw) {
    return fail([out('Error: Cannot perform an interactive login from a non TTY device', 'err'), exitLine(1)], c.noSecrets ? why('forkNoSecrets', { name: 'password' }) : why('secretMissing', { name: 'password' }), 1);
  }
  c.js.loggedIn[registry] = { viaToken: pw === TOKEN_VALUE };
  return pass([out('Login Succeeded', 'ok')], 1);
}

function npmTest(c: StepCtx, script: string, dbGiven = false): Outcome {
  const hasDb = dbGiven || Object.values(c.job.services).some((s) => /postgres/.test(s.image));
  if (c.world.fail?.db && !hasDb) {
    return fail([out(`> ${script}`, 'dim'), out(' FAIL  tests/orders.test.js', 'err'), out('Error: connect ECONNREFUSED 127.0.0.1:5432', 'err'), exitLine(1)], why('dbRefused'), 12);
  }
  const failing = testsFail(c);
  const total = 42;
  const extra = c.legIndex * 4;
  if (failing.length) {
    return fail(
      [
        out(`> ${script}`, 'dim'),
        ...failing.map((name) => out(` FAIL  ${name}`, 'err')),
        out(` Test Files  ${failing.length} failed | 3 passed (${failing.length + 3})`, 'err'),
        out(`      Tests  ${failing.length} failed | ${total - failing.length} passed (${total})`, 'err'),
        exitLine(1),
      ],
      why('testsFailed', { count: failing.length, first: failing[0]! }),
      15 + extra,
    );
  }
  return pass([out(`> ${script}`, 'dim'), out(' ✓ tests/cart.test.js (12 tests)', 'ok'), out(' Test Files  4 passed (4)', 'ok'), out(`      Tests  ${total} passed (${total})`, 'ok')], 18 + extra);
}

function npmLint(c: StepCtx): Outcome {
  const problems = c.world.fail?.lint ?? [];
  if (!problems.length) return pass([out('> lint', 'dim'), out('> eslint .', 'dim')], 9);
  return fail(
    [out('> lint', 'dim'), out('> eslint .', 'dim'), ...problems.map((p) => out(p, 'err')), out(`✖ ${problems.length} problem${problems.length === 1 ? '' : 's'}`, 'err'), exitLine(1)],
    why('lintFailed', { count: problems.length }),
    9,
  );
}

/**
 * Wrangler (directly, or through an npm deploy script). `args` are the words after `wrangler`:
 * `deploy [--env x]` prints the upload lines (named `<worker>-<env>` like Wrangler); other commands
 * (`versions …`, `preview`, `rollback`, an opaque `npm run deploy:canary`) only echo the command,
 * rather than invent output we can't check. Every one needs CLOUDFLARE_API_TOKEN.
 */
function deploy(c: StepCtx, args: string[], echo?: string): Outcome {
  if (!c.env.CLOUDFLARE_API_TOKEN) {
    return fail(
      [out("✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.", 'err'), exitLine(1)],
      c.noSecrets ? why('forkNoSecrets', { name: 'CLOUDFLARE_API_TOKEN' }) : why('secretMissing', { name: 'CLOUDFLARE_API_TOKEN' }),
      4,
    );
  }
  const command = args.find((a) => !a.startsWith('-'));
  if (echo !== undefined || (command !== undefined && command !== 'deploy')) {
    return pass([out(echo ?? `wrangler ${args.join(' ')}`, 'dim')], 8);
  }
  const i = args.findIndex((a) => a === '--env' || a === '-e' || a.startsWith('--env='));
  const env = i < 0 ? '' : args[i]!.startsWith('--env=') ? args[i]!.slice(6) : (args[i + 1] ?? '');
  const worker = env ? `${c.repo.name}-${unquote(env)}` : c.repo.name;
  return pass([out(`Uploaded ${worker}`, 'dim'), out(`Deployed ${worker} triggers`, 'ok'), out(`Current Version ID: ${fakeHex(c.sha, 8)}-${fakeHex(c.sha + 'v', 4)}`, 'dim')], 15);
}
