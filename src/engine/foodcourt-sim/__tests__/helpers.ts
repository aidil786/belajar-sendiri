import { buildScenario, plain, run, settle, type KubeResult, type KubeScenario, type KubeState } from '../index';

export function sh(state: KubeState, cmd: string): { state: KubeState; out: string; r: KubeResult } {
  const r = run(state, cmd);
  return { state: r.state, out: plain(r.output), r };
}

/** Run commands in order (settling after each when `settleEach`), returning the last result. */
export function script(state: KubeState, cmds: string[], settleEach = false): { state: KubeState; out: string; r: KubeResult } {
  let s = state;
  let last: { state: KubeState; out: string; r: KubeResult } | null = null;
  for (const c of cmds) {
    last = sh(s, c);
    s = last.state;
    if (settleEach) {
      s = settle(s).state;
      last = { ...last, state: s };
    }
  }
  return last!;
}

export const SHOP: KubeScenario = {
  id: 'test-shop',
  files: {
    'shop.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
  labels:
    app: shop
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shop
  template:
    metadata:
      labels:
        app: shop
    spec:
      containers:
        - name: web
          image: nginx:1.29-alpine
          ports:
            - containerPort: 80
`,
  },
  steps: ['kubectl apply -f shop.yaml'],
};

export function shop(): KubeState {
  return buildScenario(SHOP);
}

/** Pod names (default namespace). */
export function podNames(state: KubeState, selector = 'app=shop'): string[] {
  return sh(state, `kubectl get pods -l ${selector} -o name`).out.split('\n').filter(Boolean).map((l) => l.slice(4));
}
