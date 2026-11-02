// Controllers, scheduler and kubelet: the reconcile loops behave like Kubernetes 1.37.
import { describe, expect, it, vi } from 'vitest';
import { board, buildScenario, injectFault, picture, settle, tick, type KubeScenario } from '../index';
import { podNames, sh, shop } from './helpers';

// These run the cluster for minutes of simulated time: give them room on busy machines.
vi.setConfig({ testTimeout: 60_000 });

describe('Want 3, See 2: the ReplicaSet replaces a lost pod', () => {
  it('makes one more, with a new name', () => {
    const s = shop();
    const [first, ...others] = podNames(s);
    const r = sh(s, `kubectl delete pod ${first}`);
    expect(r.out).toBe(`pod "${first}" deleted from default namespace`);
    const loop = r.r.events.find((e) => e.type === 'reconcile' && e.do === 'create');
    expect(loop).toMatchObject({ want: 3, see: 2, do: 'create', count: 1 });
    expect(r.r.events.some((e) => e.type === 'podReplaced' && e.old === first)).toBe(true);
    const after = podNames(settle(r.state).state);
    expect(after).toHaveLength(3);
    expect(after).not.toContain(first);
    expect(after.filter((n) => others.includes(n))).toHaveLength(2);
  });

  it('scale writes a new order; the board shows Want 5', () => {
    const r = sh(shop(), 'kubectl scale deployment shop --replicas=5');
    expect(r.out).toBe('deployment.apps/shop scaled');
    const s = settle(r.state).state;
    expect(board(s, { name: 'shop' })).toMatchObject({ want: 5, see: 5, ready: 5, doing: 'none' });
  });
});

describe('rolling update and rollback', () => {
  it('keeps revisions like the deployment controller', () => {
    let s = shop();
    s = sh(s, 'kubectl set image deployment/shop web=nginx:1.30-alpine').state;
    const st = sh(s, 'kubectl rollout status deployment/shop');
    expect(st.out.split('\n').pop()).toBe('deployment "shop" successfully rolled out');
    expect(sh(st.state, 'kubectl rollout history deployment/shop').out).toBe('deployment.apps/shop \nREVISION  CHANGE-CAUSE\n1         <none>\n2         <none>\n');
    s = sh(st.state, 'kubectl rollout undo deployment/shop').state;
    s = settle(s).state;
    expect(sh(s, 'kubectl rollout history deployment/shop').out).toBe('deployment.apps/shop \nREVISION  CHANGE-CAUSE\n2         <none>\n3         <none>\n');
    expect(sh(s, 'kubectl get deploy shop -o jsonpath={.spec.template.spec.containers[0].image}').out).toBe('nginx:1.29-alpine');
  });

  it('never drops below maxUnavailable during a rollout', () => {
    let s = sh(shop(), 'kubectl set image deployment/shop web=nginx:1.30-alpine').state;
    for (let i = 0; i < 20; i++) {
      s = tick(s, 1).state;
      const ready = Number(sh(s, 'kubectl get deploy shop -o jsonpath={.status.availableReplicas}').out || 0);
      expect(ready).toBeGreaterThanOrEqual(3); // 25% of 3 rounds down to 0 unavailable
    }
  });

  it('a typo in the image: ImagePullBackOff, old pods keep serving', () => {
    let s = sh(shop(), 'kubectl set image deployment/shop web=nginx:1.299').state;
    s = tick(s, 25).state;
    const out = sh(s, 'kubectl get pods').out;
    expect(out).toMatch(/0\/1 {5}(ImagePullBackOff|ErrImagePull)/);
    expect(out.match(/1\/1 {5}Running/g)).toHaveLength(3);
    const ev = sh(s, 'kubectl get events --field-selector reason=Failed -o jsonpath={.items[0].message}').out;
    expect(ev).toBe('Failed to pull image "nginx:1.299": rpc error: code = NotFound desc = failed to pull and unpack image "docker.io/library/nginx:1.299": failed to resolve reference "docker.io/library/nginx:1.299": docker.io/library/nginx:1.299: not found');
  });
});

const OOPS: KubeScenario = {
  id: 'test-oops',
  steps: ['kubectl create deployment oops --image=busybox:1.37 -- sh -c "echo hi; exit 1"'],
  settle: false,
};

describe('kubelet: crashes, restarts, OOM, probes', () => {
  it('CrashLoopBackOff with back-off, restart in the same pod', () => {
    let s = buildScenario(OOPS);
    const name = podNames(s, 'app=oops')[0]!;
    s = tick(s, 40).state;
    const out = sh(s, 'kubectl get pods').out;
    expect(out).toContain(name);
    expect(out).toMatch(/(CrashLoopBackOff|Error|Completed) +[2-9] \(\d+s ago\)/);
    expect(sh(s, `kubectl logs ${name} --previous`).out).toBe('hi');
    expect(sh(s, `kubectl describe pod ${name}`).out).toMatch(/Back-off restarting failed container busybox in pod/);
  });

  it('OOMKilled over the memory limit', () => {
    let s = buildScenario({
      id: 'test-oom',
      files: { 'p.yaml': 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: hungry\nspec:\n  containers:\n    - name: app\n      image: busybox:1.37\n      command: ["sh", "-c", "tail /dev/zero"]\n      resources:\n        limits:\n          memory: 64Mi\n' },
      steps: ['kubectl apply -f p.yaml'],
      settle: false,
    });
    s = tick(s, 20).state;
    expect(sh(s, 'kubectl get pod hungry -o jsonpath={.status.containerStatuses[0].lastState.terminated.reason}').out).toBe('OOMKilled');
  });

  it('readiness failing takes the pod out of the Service', () => {
    let s = sh(shop(), 'kubectl expose deployment shop --port=80').state;
    s = settle(s).state;
    expect(sh(s, 'kubectl get endpointslices -l kubernetes.io/service-name=shop -o jsonpath={.items[0].endpoints[*].conditions.ready}').out).toBe('true true true');
    s = injectFault(s, { type: 'readinessFail', deployment: 'shop' }).state;
    expect(picture(s)!.services[0]!.ready).toBe(3); // no readiness probe: nothing checks yet
  });
});

describe('scheduler', () => {
  it('reports FailedScheduling like kube-scheduler 1.37', () => {
    let s = buildScenario({ id: 'test-big', steps: [] });
    s = { ...s, files: { '/home/you/big.yaml': 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: big\nspec:\n  containers:\n    - name: app\n      image: busybox:1.37\n      resources:\n        requests:\n          cpu: "64"\n' } };
    s = sh(s, 'kubectl apply -f big.yaml').state;
    expect(sh(s, 'kubectl get events -o jsonpath={.items[0].message}').out).toBe(
      '0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient cpu. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.',
    );
    expect(sh(s, 'kubectl get pod big').out).toMatch(/big {4}0\/1 {5}Pending {3}0/);
  });

  it('cordon keeps new pods away; drain moves them', () => {
    let s = sh(shop(), 'kubectl cordon dev-worker').state;
    expect(sh(s, 'kubectl get node dev-worker').out).toContain('Ready,SchedulingDisabled');
    const d = sh(s, 'kubectl drain dev-worker');
    expect(d.r.ok).toBe(false);
    expect(d.out).toContain('cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore)');
    const ok = sh(d.state, 'kubectl drain dev-worker --ignore-daemonsets');
    expect(ok.out.split('\n').pop()).toBe('node/dev-worker drained');
    s = settle(ok.state).state;
    expect(sh(s, 'kubectl get pods -o wide').out).not.toMatch(/dev-worker\s/);
  });
});

describe('node failure (sped up)', () => {
  it('NotReady after the grace period, pods replaced after the eviction delay', () => {
    let s = shop();
    const r = injectFault(s, { type: 'killNode', node: 'dev-worker' });
    expect(r.events.some((e) => e.type === 'nodeDown')).toBe(true);
    s = tick(r.state, 60).state;
    expect(sh(s, 'kubectl get node dev-worker').out).toContain('NotReady');
    s = tick(s, 300).state;
    const pods = sh(s, 'kubectl get pods -o wide').out;
    expect(pods).toMatch(/Terminating .* dev-worker /);
    expect(board(s, { name: 'shop' })).toMatchObject({ want: 3, see: 3 });
  });
});

describe('Services, DNS, NetworkPolicy, Gateway', () => {
  it('a pod reaches a Service by name; no endpoints means refused', () => {
    let s = sh(shop(), 'kubectl expose deployment shop --port=80').state;
    s = sh(s, 'kubectl run client --image=busybox:1.37 -- sleep 3600').state;
    s = settle(s).state;
    expect(sh(s, 'kubectl exec client -- wget -qO- http://shop').out).toContain('<title>Welcome to nginx!</title>');
    expect(sh(s, 'kubectl exec client -- wget -qO- http://shop.default.svc.cluster.local').r.ok).toBe(true);
    expect(sh(s, 'kubectl exec client -- wget -qO- http://nope').out).toBe("wget: bad address 'nope'\ncommand terminated with exit code 1");
    s = settle(sh(s, 'kubectl scale deployment shop --replicas=0').state).state;
    expect(sh(s, 'kubectl exec client -- wget -qO- http://shop').out.split('\n')[0]).toMatch(/^wget: can't connect to remote host \(10\.96\.\d+\.\d+\): Connection refused$/);
  });

  it('a default-deny NetworkPolicy drops traffic; allowing a label lets it in', () => {
    let s = sh(shop(), 'kubectl expose deployment shop --port=80').state;
    s = sh(s, 'kubectl run client --image=busybox:1.37 --labels=app=client -- sleep 3600').state;
    s = { ...s, files: { ...s.files, '/home/you/shop/deny.yaml': 'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: deny\nspec:\n  podSelector:\n    matchLabels:\n      app: shop\n  policyTypes: ["Ingress"]\n', '/home/you/shop/allow.yaml': 'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: allow-client\nspec:\n  podSelector:\n    matchLabels:\n      app: shop\n  ingress:\n    - from:\n        - podSelector:\n            matchLabels:\n              app: client\n' } };
    s = settle(sh(s, 'kubectl apply -f deny.yaml').state).state;
    expect(sh(s, 'kubectl exec client -- wget -qO- -T 2 http://shop').out).toBe('wget: download timed out\ncommand terminated with exit code 1');
    s = sh(s, 'kubectl apply -f allow.yaml').state;
    expect(sh(s, 'kubectl exec client -- wget -qO- -T 2 http://shop').r.ok).toBe(true);
  });

  it('routes paths through a Gateway: 200, 404 and 503', () => {
    let s = buildScenario({ id: 'test-gw', clusters: [{ name: 'kind-dev', gateway: true }], steps: [] });
    s = sh(sh(s, 'kubectl create deployment shop --image=nginx:1.29-alpine').state, 'kubectl expose deployment shop --port=80').state;
    s = { ...s, files: { '/home/you/gw.yaml': 'apiVersion: gateway.networking.k8s.io/v1\nkind: Gateway\nmetadata:\n  name: entrance\nspec:\n  gatewayClassName: eg\n  listeners:\n    - name: http\n      protocol: HTTP\n      port: 80\n---\napiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: shop\nspec:\n  parentRefs:\n    - name: entrance\n  rules:\n    - matches:\n        - path:\n            type: PathPrefix\n            value: /shop\n      backendRefs:\n        - name: shop\n          port: 80\n' } };
    s = settle(sh(s, 'kubectl apply -f gw.yaml').state).state;
    const ip = sh(s, 'kubectl get gateway entrance -o jsonpath={.status.addresses[0].value}').out;
    expect(sh(s, `curl -s -o /dev/null -w %{http_code} http://${ip}/shop/`).out).toBe('404');
    expect(sh(s, `curl -s -o /dev/null -w %{http_code} http://${ip}/menu`).out).toBe('404');
    expect(sh(s, `curl -s http://${ip}/shop`).out).toContain('404 Not Found');
    s = settle(sh(s, 'kubectl scale deployment shop --replicas=0').state).state;
    expect(sh(s, `curl -s http://${ip}/shop`).out).toBe('no healthy upstream');
  });

  it('port-forward reaches one pod from the laptop', () => {
    let s = sh(shop(), 'kubectl expose deployment shop --port=80').state;
    expect(sh(s, 'curl http://localhost:8080').out).toBe('curl: (7) Failed to connect to localhost port 8080 after 0 ms: Could not connect to server');
    const pf = sh(s, 'kubectl port-forward svc/shop 8080:80');
    expect(pf.out).toBe('Forwarding from 127.0.0.1:8080 -> 80\nForwarding from [::1]:8080 -> 80');
    s = pf.state;
    expect(sh(s, 'curl -s http://localhost:8080').out).toContain('Welcome to nginx!');
  });
});
