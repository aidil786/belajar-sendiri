// RBAC, Pod Security, goals, kustomize, helm, scenarios and i18n keys.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../i18n/en.json';
import ms from '../../../i18n/ms.json';
import { buildScenario, checkGoal, GOAL_KEYS, settle } from '../index';
import { allScenarios } from '../../../content/courses/kubernetes/scenarios/index';
import { sh, shop } from './helpers';

// These run the cluster for minutes of simulated time: give them room on busy machines.
vi.setConfig({ testTimeout: 60_000 });

const RBAC = `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ci-bot
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ci-bot-deployer
subjects:
  - kind: ServiceAccount
    name: ci-bot
    namespace: default
roleRef:
  kind: Role
  name: deployer
  apiGroup: rbac.authorization.k8s.io
`;

describe('RBAC (messages from a real kube-apiserver 1.37)', () => {
  const s = buildScenario({ id: 'rbac', files: { 'rbac.yaml': RBAC }, steps: ['kubectl apply -f rbac.yaml'] });
  const as = '--as=system:serviceaccount:default:ci-bot';
  it('answers can-i like the API server', () => {
    expect(sh(s, `kubectl auth can-i list pods ${as}`).out).toBe('yes');
    const no = sh(s, `kubectl auth can-i delete pods ${as}`);
    expect(no.out).toBe('no');
    expect(no.r.exitCode).toBe(1);
    expect(no.r.stopped).toBe(true);
    expect(sh(s, `kubectl auth can-i patch deployments -n kube-system ${as}`).out).toBe('no');
    expect(sh(s, 'kubectl auth can-i "*" "*"').out).toBe('yes');
  });
  it('forbids with the real message', () => {
    expect(sh(s, `kubectl get secrets ${as}`).out).toBe(
      'Error from server (Forbidden): secrets is forbidden: User "system:serviceaccount:default:ci-bot" cannot list resource "secrets" in API group "" in the namespace "default"',
    );
    expect(sh(shop(), 'kubectl auth whoami').out).toBe('ATTRIBUTE   VALUE\nUsername    kubernetes-admin\nGroups      [kubeadm:cluster-admins system:authenticated]');
  });
});

describe('Pod Security admission', () => {
  it('restricted refuses a plain pod and lists every reason', () => {
    let s = buildScenario({ id: 'psa', steps: ['kubectl create namespace guard', 'kubectl label ns guard pod-security.kubernetes.io/enforce=restricted'] });
    const r = sh(s, 'kubectl -n guard run plain --image=nginx:1.29-alpine');
    expect(r.out).toBe(
      'Error from server (Forbidden): pods "plain" is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false (container "plain" must set securityContext.allowPrivilegeEscalation=false), unrestricted capabilities (container "plain" must set securityContext.capabilities.drop=["ALL"]), runAsNonRoot != true (pod or container "plain" must set securityContext.runAsNonRoot=true), seccompProfile (pod or container "plain" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")',
    );
    s = sh(s, 'kubectl label ns guard pod-security.kubernetes.io/enforce=baseline pod-security.kubernetes.io/warn=restricted --overwrite').state;
    const w = sh(s, 'kubectl -n guard create deployment shop --image=nginx:1.29-alpine');
    expect(w.out.split('\n')[0]).toMatch(/^Warning: would violate PodSecurity "restricted:latest": allowPrivilegeEscalation != false \(container "nginx"/);
    expect(w.out.split('\n')[1]).toBe('deployment.apps/shop created');
  });
});

describe('goals', () => {
  it('passes and fails the documented keys', () => {
    const s = shop();
    expect(checkGoal(s, { podsReady: { selector: 'app=shop', count: 3 }, replicas: { name: 'shop', count: 3 }, rolloutComplete: { name: 'shop', revision: 1 } }).ok).toBe(true);
    expect(checkGoal(s, { replicas: { name: 'shop', count: 5 } }).failed).toEqual(['replicas']);
    expect(checkGoal(s, { contextIs: 'kind-dev', namespaceIs: 'default', objectExists: ['deployment/shop'], objectMissing: ['service/shop'] }).ok).toBe(true);
    expect(checkGoal(s, { canI: [{ verb: 'delete', resource: 'pods', allowed: true }] }).ok).toBe(true);
    expect(checkGoal(s, { typed: 'scale', lastTyped: '^kubectl' }, ['kubectl scale deployment shop --replicas=3']).ok).toBe(true);
    const exposed = settle(sh(s, 'kubectl expose deployment shop --port=80').state).state;
    expect(checkGoal(exposed, { serviceEndpoints: { name: 'shop', count: 3 }, reachable: { url: 'http://shop', from: 'app=shop', contains: 'nginx' } }).ok).toBe(true);
    expect(GOAL_KEYS).toContain('hpaReplicas');
  });
});

describe('kustomize and helm template', () => {
  it('builds an overlay', () => {
    const s = buildScenario({
      id: 'kz',
      dir: '/home/you/app',
      files: {
        'base/kustomization.yaml': 'resources:\n  - deploy.yaml\n',
        'base/deploy.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
        'prod/kustomization.yaml': 'resources:\n  - ../base\nnamePrefix: prod-\nreplicas:\n  - name: shop\n    count: 3\nimages:\n  - name: nginx\n    newTag: 1.30-alpine\n',
      },
    });
    const out = sh(s, 'kubectl kustomize prod').out;
    expect(out).toContain('  name: prod-shop');
    expect(out).toContain('  replicas: 3');
    expect(out).toContain('image: nginx:1.30-alpine');
    expect(sh(s, 'kubectl apply -k prod').out).toBe('deployment.apps/prod-shop created');
  });

  it('helm template renders the practice chart; install is explain-only', () => {
    const s = shop();
    const t = sh(s, 'helm template shop ./kedai --set replicaCount=3');
    expect(t.out.split('\n').slice(0, 2)).toEqual(['---', '# Source: kedai/templates/service.yaml']);
    expect(t.out).toContain('  replicas: 3');
    const i = sh(s, 'helm install shop ./kedai');
    expect(i.r.ok).toBe(false);
    expect(i.r.stopped).toBe(true);
    expect(i.r.explain?.key).toBe('kube.explain.helmOnly');
  });
});

describe('scenarios', () => {
  it('every Kubernetes scenario builds and has verify lists', { timeout: 120_000 }, () => {
    for (const sc of allScenarios) {
      expect(() => buildScenario(sc), sc.id).not.toThrow();
      expect(sc.verify?.length, sc.id).toBeGreaterThan(0);
    }
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('i18n', () => {
  it('every kube.* / board.* key the engine and UI use exists in both languages', () => {
    const files = [...walk('src/engine/foodcourt-sim'), ...['KubeSim', 'KubeReplay', 'ManagersBoard', 'FoodCourt', 'YouAreHere'].map((n) => `src/components/interactives/${n}.tsx`)].filter(
      (f) => /\.tsx?$/.test(f) && !f.includes('__tests__'),
    );
    const keys = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/'((?:kube|board)\.[A-Za-z0-9.]+[A-Za-z0-9])'/g)) keys.add(m[1]!);
    for (const f of ['killNode', 'restoreNode', 'deletePod', 'badImage', 'memoryLeak', 'readinessFail', 'crash', 'traffic']) keys.add(`kube.explain.fault.${f}`).add(`kube.fault.note.${f}`);
    for (const f of ['badImage', 'memoryLeak', 'readinessFail', 'crash', 'traffic']) keys.add(`kube.fault.${f}`);
    for (const r of ['ready', 'notReady', 'unknown']) keys.add(`kube.stall.${r}`);
    keys.add('kube.explain.helmOnly');
    const missing = [...keys].filter((k) => !(k in en) || !(k in ms));
    expect(missing).toEqual([]);
  });
});
