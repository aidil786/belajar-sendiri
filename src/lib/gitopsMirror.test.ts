import { describe, expect, it } from 'vitest';
import { kubectlApply } from './k8sSchema';
import {
  applicationYaml,
  commit,
  deploymentYaml,
  editCommand,
  head,
  initMirror,
  kubectlEdit,
  manualSync,
  runAll,
  setSelfHeal,
  step,
  taskDone,
  type MirrorState,
} from './gitopsMirror';

const app = { name: 'shop', replicas: 3, image: 'ghcr.io/kedai-kancil/shop:1.4.0' };
const steps = (s: MirrorState) => {
  const seen: string[] = [];
  let x = s;
  while (x.queue.length) {
    seen.push(`${x.queue[0]}:${x.sync}/${x.health}`);
    x = step(x);
  }
  return { seen, end: x };
};

describe('Git drives the cluster', () => {
  it('a commit goes OutOfSync → Syncing → Synced/Healthy', () => {
    const s = commit(initMirror(app, true), { replicas: 5 }, 'Scale shop to 5');
    expect(s.sync).toBe('Synced'); // Argo CD hasn't looked yet
    const { seen, end } = steps(s);
    // Two new pods are starting during the sync, so the app is Progressing for a moment.
    expect(seen).toEqual([
      'detect:Synced/Healthy',
      'sync:OutOfSync/Healthy',
      'rollout:OutOfSync/Progressing',
    ]);
    expect(end).toMatchObject({
      sync: 'Synced',
      health: 'Healthy',
      op: 'idle',
      live: { replicas: 5, ready: 5 },
    });
    expect(end.log.map((l) => l.key)).toEqual([
      'commit',
      'outOfSync',
      'autoSync',
      'syncing',
      'synced',
    ]);
    expect(taskDone({ type: 'gitChange', field: 'replicas', to: 5 }, end)).toBe(true);
  });

  it('a new image rolls out (Progressing, then Healthy)', () => {
    let s = commit(
      initMirror(app, true),
      { image: 'ghcr.io/kedai-kancil/shop:1.5.0' },
      'Ship 1.5.0',
    );
    s = step(step(s));
    expect(s).toMatchObject({ op: 'syncing', health: 'Progressing' });
    s = step(s);
    expect(s).toMatchObject({
      health: 'Healthy',
      sync: 'Synced',
      live: { image: 'ghcr.io/kedai-kancil/shop:1.5.0' },
    });
    expect(
      taskDone({ type: 'gitChange', field: 'image', to: 'ghcr.io/kedai-kancil/shop:1.5.0' }, s),
    ).toBe(true);
  });
});

describe('drift', () => {
  it('self-heal on: a manual edit snaps back after the self-heal wait', () => {
    const s = kubectlEdit(initMirror(app, true), { replicas: 1 });
    expect(s.live.replicas).toBe(1);
    const { seen, end } = steps(s);
    expect(seen).toEqual([
      'detect:Synced/Healthy',
      'selfHealWait:OutOfSync/Healthy',
      'sync:OutOfSync/Healthy',
      'rollout:OutOfSync/Progressing',
    ]);
    expect(end).toMatchObject({ sync: 'Synced', live: { replicas: 3 }, healed: 1, drifted: false });
    expect(taskDone({ type: 'drift' }, end)).toBe(true);
  });

  it('self-heal off: it stays OutOfSync until Sync', () => {
    let s = runAll(kubectlEdit(initMirror(app, false), { replicas: 1 }));
    expect(s).toMatchObject({ sync: 'OutOfSync', live: { replicas: 1 }, drifted: true });
    expect(s.log.at(-1)!.key).toBe('driftStays');
    expect(taskDone({ type: 'drift' }, s)).toBe(false);
    s = runAll(manualSync(s));
    expect(s).toMatchObject({ sync: 'Synced', live: { replicas: 3 }, healed: 1 });
  });

  it('turning self-heal on later heals it', () => {
    let s = runAll(kubectlEdit(initMirror(app, false), { replicas: 1 }));
    s = runAll(setSelfHeal(s, true));
    expect(s).toMatchObject({ sync: 'Synced', live: { replicas: 3 } });
  });

  it('prints the kubectl commands', () => {
    const s = initMirror(app, true);
    expect(editCommand(s, { replicas: 1 })).toBe(
      'kubectl scale deployment shop --replicas=1 -n shop',
    );
    expect(editCommand(s, { image: 'nginx:1.29-alpine' })).toBe(
      'kubectl set image deployment/shop web=nginx:1.29-alpine -n shop',
    );
  });
});

describe('manifests', () => {
  it('the Deployment in Git applies', () => {
    const s = initMirror(app, true);
    expect(
      kubectlApply(deploymentYaml(s), 'shop.yaml', { namespaces: ['shop'] }).lines.map(
        (l) => l.text,
      ),
    ).toEqual(['deployment.apps/shop created']);
    expect(head(s).replicas).toBe(3);
  });
  it('the Application has the self-heal switch', () => {
    expect(applicationYaml(initMirror(app, true))).toContain(
      'syncPolicy:\n    automated:\n      selfHeal: true\n',
    );
    expect(applicationYaml(initMirror(app, false))).toContain('selfHeal: false');
  });
});
