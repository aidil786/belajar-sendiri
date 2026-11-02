// Pure logic for GitOpsMirror: Git is the order board; an Argo CD-style controller keeps the
// cluster the same as Git.
//
// Follows Argo CD's automated sync policy (argo-cd.readthedocs.io, "Automated Sync Policy"):
//   - a new commit makes the app OutOfSync; automated sync then applies it (Syncing → Synced),
//     and the Deployment rolls out (Progressing → Healthy);
//   - a manual change in the cluster (drift) also shows as OutOfSync. Automated sync does NOT undo
//     it by itself; with selfHeal: true it syncs again after the self-heal timeout (5 s by default);
//     with selfHeal off it stays OutOfSync until someone presses Sync;
//   - Argo CD looks at Git every 3 minutes at most (timeout.reconciliation 120 s + up to 60 s jitter),
//     or at once when a webhook tells it.
// The clock is made of steps, so the game can play them, pause, or go one step at a time.
import { toYaml } from './k8sMessages';

export interface GitopsApp {
  /** The Argo CD Application name. */
  name: string;
  /** Namespace the app runs in. */
  namespace?: string;
  /** The Deployment name (default: the app name). */
  deployment?: string;
  replicas: number;
  image: string;
  repo?: string;
  path?: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  replicas: number;
  image: string;
}

export type SyncStatus = 'Synced' | 'OutOfSync';
export type Health = 'Healthy' | 'Progressing';
export type Step = 'detect' | 'selfHealWait' | 'sync' | 'rollout';

export interface LogEntry {
  key:
    | 'commit'
    | 'edit'
    | 'outOfSync'
    | 'autoSync'
    | 'selfHealArmed'
    | 'selfHealWait'
    | 'driftStays'
    | 'manualSync'
    | 'syncing'
    | 'synced'
    | 'same';
  params?: Record<string, string | number>;
}

export interface MirrorState {
  app: Required<Pick<GitopsApp, 'name' | 'namespace' | 'deployment' | 'repo' | 'path'>>;
  commits: GitCommit[];
  syncedSha: string;
  live: { replicas: number; image: string; ready: number };
  sync: SyncStatus;
  health: Health;
  op: 'idle' | 'syncing';
  selfHeal: boolean;
  queue: Step[];
  log: LogEntry[];
  /** A manual change is in the cluster and Git doesn't have it. */
  drifted: boolean;
  /** How many times drift was undone. */
  healed: number;
}

export type Change = { replicas?: number; image?: string };

function sha(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0).toString(16) + 'a3f9c1e').slice(0, 7);
}

export function initMirror(app: GitopsApp, selfHeal: boolean): MirrorState {
  const first: GitCommit = {
    sha: sha(`${app.name}-init`),
    message: `Add ${app.deployment ?? app.name}`,
    replicas: app.replicas,
    image: app.image,
  };
  return {
    app: {
      name: app.name,
      namespace: app.namespace ?? 'shop',
      deployment: app.deployment ?? app.name,
      repo: app.repo ?? 'https://github.com/kedai-kancil/gitops.git',
      path: app.path ?? `apps/${app.name}`,
    },
    commits: [first],
    syncedSha: first.sha,
    live: { replicas: app.replicas, image: app.image, ready: app.replicas },
    sync: 'Synced',
    health: 'Healthy',
    op: 'idle',
    selfHeal,
    queue: [],
    log: [],
    drifted: false,
    healed: 0,
  };
}

export const head = (s: MirrorState) => s.commits[s.commits.length - 1]!;
const differs = (s: MirrorState) =>
  head(s).replicas !== s.live.replicas || head(s).image !== s.live.image;

/** Commit a change to Git. */
export function commit(s: MirrorState, change: Change, message: string): MirrorState {
  const prev = head(s);
  const c: GitCommit = {
    sha: sha(`${message}-${s.commits.length}`),
    message,
    replicas: change.replicas ?? prev.replicas,
    image: change.image ?? prev.image,
  };
  return {
    ...s,
    commits: [...s.commits, c],
    queue: ['detect'],
    log: [...s.log, { key: 'commit', params: { sha: c.sha, message } }],
  };
}

/** A manual `kubectl` change in the cluster (drift). */
export function kubectlEdit(s: MirrorState, change: Change): MirrorState {
  const live = { ...s.live, ...change };
  live.ready = live.replicas;
  return {
    ...s,
    live,
    drifted: true,
    queue: ['detect'],
    log: [...s.log, { key: 'edit', params: { replicas: live.replicas, image: live.image } }],
  };
}

/** The kubectl command for a drift change. */
export function editCommand(s: MirrorState, change: Change): string {
  if (change.replicas !== undefined)
    return `kubectl scale deployment ${s.app.deployment} --replicas=${change.replicas} -n ${s.app.namespace}`;
  return `kubectl set image deployment/${s.app.deployment} web=${change.image} -n ${s.app.namespace}`;
}

export function manualSync(s: MirrorState): MirrorState {
  return { ...s, queue: ['sync'], log: [...s.log, { key: 'manualSync' }] };
}

export function setSelfHeal(s: MirrorState, on: boolean): MirrorState {
  const next = { ...s, selfHeal: on };
  // Turning self-heal on while drifted: the next reconcile heals it.
  if (on && s.drifted && s.sync === 'OutOfSync' && !s.queue.length) next.queue = ['detect'];
  return next;
}

/** Do the next step on the clock. */
export function step(s: MirrorState): MirrorState {
  const [now, ...rest] = s.queue;
  if (!now) return s;
  const log = [...s.log];
  switch (now) {
    case 'detect': {
      if (!differs(s)) return { ...s, queue: rest, sync: 'Synced', log: [...log, { key: 'same' }] };
      log.push({ key: 'outOfSync', params: { git: head(s).replicas, live: s.live.replicas } });
      const fromGit = head(s).sha !== s.syncedSha;
      if (fromGit)
        return {
          ...s,
          sync: 'OutOfSync',
          queue: ['sync', ...rest],
          log: [...log, { key: 'autoSync', params: { sha: head(s).sha } }],
        };
      if (s.selfHeal)
        return {
          ...s,
          sync: 'OutOfSync',
          queue: ['selfHealWait', 'sync', ...rest],
          log: [...log, { key: 'selfHealArmed' }],
        };
      return { ...s, sync: 'OutOfSync', queue: rest, log: [...log, { key: 'driftStays' }] };
    }
    case 'selfHealWait':
      return { ...s, queue: rest, log: [...log, { key: 'selfHealWait' }] };
    case 'sync': {
      const h = head(s);
      const live = {
        replicas: h.replicas,
        image: h.image,
        ready: Math.min(s.live.ready, h.replicas),
      };
      const rolling = h.image !== s.live.image || live.ready < h.replicas;
      return {
        ...s,
        op: 'syncing',
        live,
        health: rolling ? 'Progressing' : 'Healthy',
        queue: ['rollout', ...rest],
        log: [...log, { key: 'syncing', params: { sha: h.sha } }],
      };
    }
    case 'rollout':
      return {
        ...s,
        op: 'idle',
        live: { ...s.live, ready: s.live.replicas },
        health: 'Healthy',
        sync: 'Synced',
        syncedSha: head(s).sha,
        drifted: false,
        healed: s.drifted ? s.healed + 1 : s.healed,
        queue: rest,
        log: [...log, { key: 'synced', params: { sha: head(s).sha } }],
      };
  }
}

/** Run every queued step (calm mode, or "skip to the end"). */
export function runAll(s: MirrorState): MirrorState {
  let x = s;
  for (let i = 0; i < 20 && x.queue.length; i++) x = step(x);
  return x;
}

export type GitopsTask =
  /** Change one field in Git and watch the cluster follow. */
  | { type: 'gitChange'; field: 'replicas' | 'image'; to: number | string }
  /** Make a manual change in the cluster, then get it undone (self-heal or Sync). */
  | { type: 'drift' };

export function taskDone(task: GitopsTask, s: MirrorState): boolean {
  const settled =
    s.sync === 'Synced' && s.health === 'Healthy' && s.op === 'idle' && !s.queue.length;
  if (task.type === 'drift') return s.healed > 0 && settled;
  const want = String(task.to);
  return settled && String(head(s)[task.field]) === want && String(s.live[task.field]) === want;
}

/** The Deployment file in Git. */
export function deploymentYaml(s: MirrorState, c: GitCommit = head(s)): string {
  const d = s.app.deployment;
  return `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${d}\n  namespace: ${s.app.namespace}\nspec:\n  replicas: ${c.replicas}\n  selector:\n    matchLabels:\n      app: ${d}\n  template:\n    metadata:\n      labels:\n        app: ${d}\n    spec:\n      containers:\n        - name: web\n          image: ${c.image}\n`;
}

/** The Argo CD Application (argoproj.io/v1alpha1). */
export function applicationYaml(s: MirrorState): string {
  return toYaml({
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: { name: s.app.name, namespace: 'argocd' },
    spec: {
      project: 'default',
      source: { repoURL: s.app.repo, path: s.app.path, targetRevision: 'main' },
      destination: { server: 'https://kubernetes.default.svc', namespace: s.app.namespace },
      syncPolicy: { automated: { selfHeal: s.selfHeal } },
    },
  });
}
