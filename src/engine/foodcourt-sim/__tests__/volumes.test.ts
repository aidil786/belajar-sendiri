// Notes and lockers (World K4): env vars are read at start, emptyDir lives with its pod,
// a PVC-backed volume outlives it, and a container's own files go when it restarts.
import { describe, expect, it, vi } from 'vitest';
import { buildScenario, settle, type KubeScenario } from '../index';
import { script, sh } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const CM = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\ndata:\n  GREETING: Selamat datang\n  SPICY: "3"\n';
const CM2 = CM.replace('Selamat datang', 'Jemput makan');
const SHOP = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
spec:
  replicas: 1
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
          envFrom:
            - configMapRef:
                name: settings
          volumeMounts:
            - name: notes
              mountPath: /etc/notes
      volumes:
        - name: notes
          configMap:
            name: settings
`;

const PREP = `apiVersion: v1
kind: Pod
metadata:
  name: prep
spec:
  containers:
    - name: cook
      image: busybox:1.37
      command: ["sleep", "3600"]
      volumeMounts:
        - name: table
          mountPath: /table
    - name: helper
      image: busybox:1.37
      command: ["sleep", "3600"]
      volumeMounts:
        - name: table
          mountPath: /table
  volumes:
    - name: table
      emptyDir: {}
`;

const CLAIM = 'apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: orders\nspec:\n  accessModes:\n    - ReadWriteOnce\n  resources:\n    requests:\n      storage: 1Gi\n';
const CASHIER = `apiVersion: v1
kind: Pod
metadata:
  name: cashier
spec:
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
      volumeMounts:
        - name: orders
          mountPath: /data
  volumes:
    - name: orders
      persistentVolumeClaim:
        claimName: orders
`;

const sc = (files: Record<string, string>, steps: string[]): KubeScenario => ({ id: 'test-volumes', files, steps });

describe('ConfigMap notes: env vars vs files', () => {
  it('env is read at start; the file follows the ConfigMap; a restart picks up the new env', () => {
    const s = buildScenario(sc({ 'settings.yaml': CM, 'v2.yaml': CM2, 'shop.yaml': SHOP }, ['kubectl apply -f settings.yaml', 'kubectl apply -f shop.yaml']));
    expect(sh(s, 'kubectl exec deploy/shop -- printenv GREETING').out).toBe('Selamat datang');
    expect(sh(s, 'kubectl exec deploy/shop -- ls /etc/notes').out).toBe('GREETING\nSPICY');
    const changed = script(s, ['kubectl apply -f v2.yaml', 'sleep 120']).state;
    expect(sh(changed, 'kubectl exec deploy/shop -- cat /etc/notes/GREETING').out).toBe('Jemput makan');
    expect(sh(changed, 'kubectl exec deploy/shop -- printenv GREETING').out).toBe('Selamat datang');
    const restarted = settle(sh(changed, 'kubectl rollout restart deployment/shop').state).state;
    expect(sh(restarted, 'kubectl exec deploy/shop -- printenv GREETING').out).toBe('Jemput makan');
  });

  it('ConfigMap mounts are read-only', () => {
    const s = buildScenario(sc({ 'settings.yaml': CM, 'shop.yaml': SHOP }, ['kubectl apply -f settings.yaml', 'kubectl apply -f shop.yaml']));
    const r = sh(s, 'kubectl exec deploy/shop -- touch /etc/notes/NEW');
    expect(r.r.ok).toBe(false);
    expect(r.out).toContain('Read-only file system');
  });
});

describe('emptyDir: one table per tray', () => {
  it('both containers see it; it is empty again in a new pod', () => {
    const s = buildScenario(sc({ 'prep.yaml': PREP }, ['kubectl apply -f prep.yaml']));
    expect(sh(s, 'kubectl exec prep -c helper -- ls /table').out).toBe('');
    const w = sh(s, 'kubectl exec prep -c cook -- touch /table/onions.txt').state;
    expect(sh(w, 'kubectl exec prep -c helper -- ls /table').out).toBe('onions.txt');
    const again = settle(script(w, ['kubectl delete pod prep', 'kubectl apply -f prep.yaml']).state).state;
    expect(sh(again, 'kubectl exec prep -c helper -- ls /table').out).toBe('');
    expect(Object.keys(again.clusters['kind-dev']!.volumeData ?? {}).length).toBe(0);
  });
});

describe('PVC: the locker outlives the pod', () => {
  it('a new pod on the same claim reads the old data; deleting the claim forgets it', () => {
    const s = buildScenario(sc({ 'claim.yaml': CLAIM, 'cashier.yaml': CASHIER }, ['kubectl apply -f claim.yaml', 'kubectl apply -f cashier.yaml']));
    let w = sh(s, "kubectl exec cashier -- sh -c 'echo nasi lemak x2 >> /data/orders.txt'").state;
    w = sh(w, "kubectl exec cashier -- sh -c 'echo teh tarik >> /data/orders.txt'").state;
    w = settle(script(w, ['kubectl delete pod cashier', 'kubectl apply -f cashier.yaml']).state).state;
    expect(sh(w, 'kubectl exec cashier -- cat /data/orders.txt').out).toBe('nasi lemak x2\nteh tarik');
    const gone = script(w, ['kubectl delete pod cashier', 'kubectl delete pvc orders']).state;
    expect(gone.clusters['kind-dev']!.volumeData?.['pvc/default/orders']).toBeUndefined();
  });

  it('a file outside any volume is gone after the pod is replaced', () => {
    const s = buildScenario(sc({ 'claim.yaml': CLAIM, 'cashier.yaml': CASHIER }, ['kubectl apply -f claim.yaml', 'kubectl apply -f cashier.yaml']));
    const w = sh(s, 'kubectl exec cashier -- touch /tmp/note.txt').state;
    expect(sh(w, 'kubectl exec cashier -- ls /tmp').out).toBe('note.txt');
    const again = settle(script(w, ['kubectl delete pod cashier', 'kubectl apply -f cashier.yaml']).state).state;
    expect(sh(again, 'kubectl exec cashier -- cat /tmp/note.txt').r.ok).toBe(false);
  });
});
