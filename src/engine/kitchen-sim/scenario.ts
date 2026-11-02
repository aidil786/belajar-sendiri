// Kitchen scenarios: a starting state built by replaying simple steps. The same steps (and the
// `verify` lists) run on a real Docker daemon in scripts/verify-docker, so both stay in sync.
import { resolve as resolvePath } from '../git-sim/paths';
import { imageFromCatalog } from './catalog';
import { pullImage } from './images';
import { tick } from './lifecycle';
import { run } from './run';
import { createKitchenState, ensureDir } from './state';
import type { KitchenState, LocalImage } from './types';

export type KitchenStep =
  /** A command typed in the terminal, e.g. 'docker run -d --name web -p 8080:80 nginx:1.30-alpine'. */
  | string
  /** A file on the laptop (path relative to the current folder). `mode: '755'` makes it runnable. */
  | { write: string; content: string; mode?: string }
  | { delete: string }
  /** Let seconds pass on the fake clock (containers age, health checks run, `sleep 5` ends). */
  | { wait: number }
  /** Another program on the laptop already uses this port (for "address already in use"). */
  | { busyPort: number }
  /** A Docker Hub account that exists (log in with its token). */
  | { account: { user: string; token: string; password?: string } }
  /** An image someone pushed to the fake registry: `ref` like "aisyah/shop-api:1.0", copied from a catalog image. */
  | { remoteImage: { ref: string; from: string; platform?: string; private?: boolean } }
  /** Scenario switches: Docker Hub says 429, the daemon is stopped, the laptop has IPv6. */
  | { flag: 'rateLimited' | 'dockerDown' | 'ipv6' };

export interface KitchenScenario {
  id: string;
  /** Folder to start in. Default: /home/you */
  cwd?: string;
  /** Catalog images already pulled before the steps (they show in `docker images`). */
  images?: string[];
  steps: KitchenStep[];
  /**
   * Command lists the lesson teaches. `npm run verify:docker` runs each one after the steps,
   * in the engine and on a real Docker daemon, and compares the results.
   */
  verify?: string[][];
  /** Seconds to wait on the real daemon after each verify command (default 1). Health checks need more. */
  settle?: number;
}

/** Apply one step. Throws if a command step fails (scenarios must start clean). */
export function kitchenStep(state: KitchenState, step: KitchenStep, id = 'scenario'): KitchenState {
  if (typeof step === 'string') {
    const r = run(state, step);
    if (!r.ok && !r.stopped) {
      throw new Error(`Scenario ${id}: step failed: ${step}\n${r.output.map((l) => l.map((x) => x.t).join('')).join('\n')}`);
    }
    // A scenario never leaves a program waiting for input.
    return { ...r.state, session: null };
  }
  const s = structuredClone(state);
  if ('write' in step) {
    const abs = resolvePath(s.cwd, step.write, s.home);
    ensureDir(s, abs.slice(0, abs.lastIndexOf('/')) || '/');
    s.fs.files[abs] = step.content;
    if (step.mode) s.fs.modes[abs] = step.mode === '755' ? '-rwxr-xr-x' : step.mode === '700' ? '-rwx------' : '-rw-r--r--';
  } else if ('delete' in step) {
    delete s.fs.files[resolvePath(s.cwd, step.delete, s.home)];
  } else if ('wait' in step) {
    tick(s, step.wait);
  } else if ('busyPort' in step) {
    s.host.busyPorts.push(step.busyPort);
  } else if ('account' in step) {
    s.registry.users[step.account.user] = { token: step.account.token, password: step.account.password };
  } else if ('remoteImage' in step) {
    const base: LocalImage = imageFromCatalog(step.remoteImage.from);
    const [path, tag = 'latest'] = step.remoteImage.ref.split(':');
    const full = `docker.io/${path!.includes('/') ? path : `library/${path}`}`;
    const img = { ...base, id: base.id.split('').reverse().join(''), source: 'pull' as const, platform: step.remoteImage.platform ?? 'linux/amd64', repoTags: [`${full}:${tag}`] };
    s.registry.repos[full] ??= { tags: {}, owner: path!.split('/')[0]!, private: step.remoteImage.private };
    s.registry.repos[full]!.tags[tag] = img;
  } else if ('flag' in step) {
    if (step.flag === 'rateLimited') s.registry.rateLimited = true;
    if (step.flag === 'dockerDown') s.host.dockerUp = false;
    if (step.flag === 'ipv6') s.host.ipv6 = true;
  }
  return s;
}

/** The state before any step (cwd and pre-pulled images). */
export function kitchenStart(sc: KitchenScenario): KitchenState {
  const s = createKitchenState({ seed: sc.id });
  if (sc.cwd) {
    ensureDir(s, sc.cwd);
    s.cwd = sc.cwd;
  }
  for (const ref of sc.images ?? []) {
    const r = pullImage(s, ref, { quiet: true });
    if (!r.ok) throw new Error(`Scenario ${sc.id}: image ${ref} is not in the catalog`);
  }
  // Pre-pulled images were pulled a little while ago.
  return s;
}

export function buildKitchenScenario(sc: KitchenScenario): KitchenState {
  let s = kitchenStart(sc);
  for (const step of sc.steps) s = kitchenStep(s, step, sc.id);
  return s;
}
