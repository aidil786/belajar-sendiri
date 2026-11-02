// World K2 additions: READY/RESTARTS for native sidecars and init containers (kubectl's printPod),
// `kubectl set resources`, `kubectl create job --from=cronjob/…` and manual Jobs in CronJob status.
import { describe, expect, it, vi } from 'vitest';
import { buildScenario, listObjs, readyText, restartCount, tick, type KubeScenario } from '../index';
import { sh } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const SIDECAR: KubeScenario = {
  id: 'test-k2-sidecar',
  files: {
    'kedai.yaml': `apiVersion: v1
kind: Pod
metadata:
  name: kedai
spec:
  initContainers:
    - name: prep
      image: busybox:1.37
      command: ["sh", "-c", "echo prep; sleep 5"]
    - name: sweeper
      image: busybox:1.37
      restartPolicy: Always
      command: ["sleep", "3600"]
  containers:
    - name: web
      image: nginx:1.29-alpine
`,
    'noprep.yaml': `apiVersion: v1
kind: Pod
metadata:
  name: noprep
spec:
  initContainers:
    - name: prep
      image: busybox:1.37
      command: ["sh", "-c", "exit 1"]
  containers:
    - name: web
      image: nginx:1.29-alpine
`,
  },
};

const JOBS: KubeScenario = {
  id: 'test-k2-jobs',
  files: {
    'nightly.yaml': `apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly
spec:
  schedule: "30 23 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: count
              image: busybox:1.37
              command: ["sh", "-c", "echo 42 plates"]
`,
  },
};

describe('native sidecars and init containers in kubectl get pods', () => {
  it('counts a started sidecar in READY (2/2), like kubectl 1.37', () => {
    let s = buildScenario(SIDECAR);
    s = sh(s, 'kubectl apply -f kedai.yaml').state;
    s = sh(s, 'kubectl wait --for=condition=Ready pod/kedai --timeout=90s').state;
    const pod = listObjs(s.clusters['kind-dev']!, 'Pod').find((p) => p.metadata.name === 'kedai')!;
    expect(readyText(pod)).toBe('2/2');
    expect(sh(s, 'kubectl get pod kedai').out).toMatch(/^kedai\s+2\/2\s+Running\s+0\s/m);
  });

  it('shows init-container restarts while the pod is still initializing', () => {
    let s = buildScenario(SIDECAR);
    s = sh(s, 'kubectl apply -f noprep.yaml').state;
    s = tick(s, 20).state;
    const pod = listObjs(s.clusters['kind-dev']!, 'Pod').find((p) => p.metadata.name === 'noprep')!;
    expect(restartCount(pod)).toBeGreaterThan(0);
    expect(sh(s, 'kubectl get pod noprep').out).toMatch(/^noprep\s+0\/1\s+Init:(CrashLoopBackOff|Error)\s+[1-9]/m);
  });
});

describe('kubectl set resources and create job --from', () => {
  it('takes --requests and --limits values', () => {
    let s = buildScenario({ id: 'test-k2-res', steps: ['kubectl create deployment shop --image=nginx:1.29-alpine'] });
    const r = sh(s, 'kubectl set resources deployment shop --requests=cpu=100m,memory=64Mi --limits=memory=128Mi');
    expect(r.out).toBe('deployment.apps/shop resource requirements updated');
    s = r.state;
    expect(sh(s, 'kubectl get deployment shop -o jsonpath={.spec.template.spec.containers[0].resources}').out).toBe('{"limits":{"memory":"128Mi"},"requests":{"cpu":"100m","memory":"64Mi"}}');
  });

  it('runs a CronJob now, and keeps the manual Job out of the CronJob status', () => {
    let s = buildScenario(JOBS);
    s = sh(s, 'kubectl apply -f nightly.yaml').state;
    const r = sh(s, 'kubectl create job tally-now --from=cronjob/nightly');
    expect(r.out).toBe('job.batch/tally-now created');
    s = sh(r.state, 'kubectl wait --for=condition=complete job/tally-now --timeout=60s').state;
    expect(sh(s, 'kubectl logs job/tally-now').out).toBe('42 plates');
    expect(sh(s, 'kubectl get job tally-now -o jsonpath={.metadata.annotations}').out).toContain('"cronjob.kubernetes.io/instantiate":"manual"');
    expect(sh(s, 'kubectl get cronjob nightly').out).toMatch(/^nightly\s+30 23 \* \* \*\s+<none>\s+False\s+0\s+<none>/m);
    expect(sh(s, 'kubectl create job x --from=cronjob/nope').out).toBe('Error from server (NotFound): cronjobs.batch "nope" not found');
  });
});

describe('kubectl wait --for=jsonpath with a list index', () => {
  it('waits for the first liveness restart; no back-off has happened yet', () => {
    const sleepy = `apiVersion: v1
kind: Pod
metadata:
  name: sleepy
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
      livenessProbe:
        httpGet:
          path: /healthz
          port: 80
        periodSeconds: 5
        failureThreshold: 3
`;
    let s = buildScenario({ id: 't-sleepy', files: { 'sleepy.yaml': sleepy } } as KubeScenario);
    s = sh(s, 'kubectl apply -f sleepy.yaml').state;
    const w = sh(s, 'kubectl wait --for=jsonpath={.status.containerStatuses[0].restartCount}=1 pod/sleepy --timeout=90s');
    expect(w.out).toBe('pod/sleepy condition met');
    s = w.state;
    expect(sh(s, 'kubectl get events --field-selector reason=Killing -o jsonpath={.items[0].message}').out).toBe('Container web failed liveness probe, will be restarted');
    expect(sh(s, 'kubectl get events --field-selector reason=BackOff -o name').out).toBe('No resources found in default namespace.');
  });
});
