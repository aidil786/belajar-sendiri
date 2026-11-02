// kubectl output checked against real kubectl v1.37.2 / kube-apiserver v1.37.2 output.
import { describe, expect, it, vi } from 'vitest';
import { buildScenario, emptyState, addCluster, run } from '../index';
import { sh, shop } from './helpers';

// These run the cluster for minutes of simulated time: give them room on busy machines.
vi.setConfig({ testTimeout: 60_000 });

function fresh() {
  const s = emptyState('t');
  addCluster(s, { name: 'kind-dev' });
  return s;
}

describe('kubectl create --dry-run=client -o yaml (client-side objects)', () => {
  it('prints a Deployment exactly like kubectl 1.37', () => {
    const { out } = sh(fresh(), 'kubectl create deployment shop --image=nginx:1.29-alpine --replicas=3 --dry-run=client -o yaml');
    expect(out).toBe(`apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: shop
  name: shop
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shop
  strategy: {}
  template:
    metadata:
      labels:
        app: shop
    spec:
      containers:
      - image: nginx:1.29-alpine
        name: nginx
        resources: {}
status: {}`);
  });

  it('prints a Service, ConfigMap and Secret like kubectl', () => {
    expect(sh(fresh(), 'kubectl create service clusterip shop --tcp=80:80 --dry-run=client -o yaml').out).toBe(`apiVersion: v1
kind: Service
metadata:
  labels:
    app: shop
  name: shop
spec:
  ports:
  - name: 80-80
    port: 80
    protocol: TCP
    targetPort: 80
  selector:
    app: shop
  type: ClusterIP
status:
  loadBalancer: {}`);
    expect(sh(fresh(), 'kubectl create configmap menu --from-literal=colour=green --from-literal=size=big --dry-run=client -o yaml').out).toBe(
      'apiVersion: v1\ndata:\n  colour: green\n  size: big\nkind: ConfigMap\nmetadata:\n  name: menu',
    );
    expect(sh(fresh(), 'kubectl create secret generic spice --from-literal=password=s3cret --dry-run=client -o yaml').out).toBe(
      'apiVersion: v1\ndata:\n  password: czNjcmV0\nkind: Secret\nmetadata:\n  name: spice',
    );
  });
});

describe('server defaults (kubectl apply, then get -o yaml)', () => {
  it('fills in what the API server fills in', () => {
    const s = shop();
    const { out } = sh(s, 'kubectl get deployment shop -o yaml');
    for (const line of [
      '  progressDeadlineSeconds: 600',
      '  revisionHistoryLimit: 10',
      '      maxSurge: 25%',
      '      maxUnavailable: 25%',
      '    type: RollingUpdate',
      '        imagePullPolicy: IfNotPresent',
      '        - containerPort: 80',
      '          protocol: TCP',
      '        terminationMessagePath: /dev/termination-log',
      '      dnsPolicy: ClusterFirst',
      '      schedulerName: default-scheduler',
      '      terminationGracePeriodSeconds: 30',
      '    deployment.kubernetes.io/revision: "1"',
    ]) expect(out).toContain(line);
    expect(out).toMatch(/kubectl\.kubernetes\.io\/last-applied-configuration: \|\n {6}\{"apiVersion":"apps\/v1","kind":"Deployment","metadata":\{"annotations":\{\},"labels":\{"app":"shop"\},"name":"shop","namespace":"default"\}/);
    const pod = sh(s, 'kubectl get pods -o yaml').out;
    expect(pod).toContain('    - effect: NoExecute\n      key: node.kubernetes.io/not-ready\n      operator: Exists\n      tolerationSeconds: 300');
    expect(pod).toContain('    serviceAccountName: default');
    expect(pod).toContain('    qosClass: BestEffort');
  });

  it('refuses unknown fields (strict validation)', () => {
    let s = fresh();
    s = { ...s, files: { '/home/you/typo.yaml': 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: typo\nspec:\n  containers:\n    - name: tool\n      image: busybox:1.37\n      comand: ["sleep", "10"]\n' } };
    const { out, r } = sh(s, 'kubectl apply -f typo.yaml');
    expect(r.ok).toBe(false);
    expect(out).toBe('Error from server (BadRequest): error when creating "typo.yaml": Pod in version "v1" cannot be handled as a Pod: strict decoding error: unknown field "spec.containers[0].comand"');
  });
});

describe('tables', () => {
  it('lists nodes of the kind cluster', () => {
    const out = sh(fresh(), 'kubectl get nodes').out;
    expect(out.split('\n')).toEqual([
      'NAME                STATUS   ROLES           AGE   VERSION',
      'dev-control-plane   Ready    control-plane   5m    v1.37.0',
      'dev-worker          Ready    <none>          5m    v1.37.0',
      'dev-worker2         Ready    <none>          5m    v1.37.0',
    ]);
  });

  it('says when nothing is there', () => {
    expect(sh(fresh(), 'kubectl get pods').out).toBe('No resources found in default namespace.');
    expect(sh(fresh(), 'kubectl get deploy -n nowhere').out).toBe('No resources found in nowhere namespace.');
  });

  it('prefixes names when several kinds are listed', () => {
    const out = sh(shop(), 'kubectl get deploy,svc').out;
    expect(out).toMatch(/^NAME {19}READY {3}UP-TO-DATE {3}AVAILABLE {3}AGE\ndeployment\.apps\/shop {3}3\/3 {5}3 {12}3 {11}\d+s\n\nNAME {17}TYPE/);
  });

  it('-o name, jsonpath and custom-columns', () => {
    const s = shop();
    expect(sh(s, 'kubectl get deploy -o name').out).toBe('deployment.apps/shop');
    expect(sh(s, 'kubectl get deploy shop -o jsonpath={.spec.replicas}').out).toBe('3');
    expect(sh(s, 'kubectl get pods -o jsonpath={.items[*].status.phase}').out).toBe('Running Running Running');
    expect(sh(s, 'kubectl get deploy -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image').out).toBe('NAME   IMAGE\nshop   nginx:1.29-alpine');
  });

  it('errors look like kubectl', () => {
    const s = fresh();
    expect(sh(s, 'kubectl get pizza').out).toBe('error: the server doesn\'t have a resource type "pizza"');
    expect(sh(s, 'kubectl get pod nope').out).toBe('Error from server (NotFound): pods "nope" not found');
    expect(sh(s, 'kubectl gett pods').out).toContain('error: unknown command "gett" for "kubectl"\n\nDid you mean this?\n\tget');
  });
});

describe('contexts (the pink bar)', () => {
  it('switches cluster and namespace', () => {
    let s = buildScenario({ id: 'ctx', clusters: [{ name: 'kind-dev' }, { name: 'prod-like' }] });
    expect(sh(s, 'kubectl config current-context').out).toBe('kind-dev');
    let r = sh(s, 'kubectl config use-context prod-like');
    expect(r.out).toBe('Switched to context "prod-like".');
    s = r.state;
    expect(sh(s, 'kubectl get nodes -o name').out).toContain('node/prod-like-pool-a1');
    r = sh(s, 'kubectl config set-context --current --namespace=shop');
    expect(r.out).toBe('Context "prod-like" modified.');
    expect(sh(r.state, 'kubectl config get-contexts').out.split('\n')[2]).toMatch(/^\*\s+prod-like\s+prod-like\s+admin@prod-like\s+shop$/);
    expect(sh(s, 'kubectl config use-context prod').out).toBe('error: no context exists with the name: "prod"');
  });
});

describe('purity', () => {
  it('never changes the state it is given', () => {
    const s = shop();
    const before = JSON.stringify(s);
    run(s, 'kubectl delete deployment shop');
    run(s, 'kubectl scale deployment shop --replicas=9');
    expect(JSON.stringify(s)).toBe(before);
  });
});
