// K9 node shell: every node command, the node faults and the K9 goals. Expected text is the
// real output recorded in fixtures/cka.json (kind node image v1.37.0, etcd 3.7.0, kubectl 1.37.2).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../i18n/en.json';
import ms from '../../../i18n/ms.json';
import { buildScenario, checkGoal, CKA, injectFault, NODE_GRACE, settle, tick, type KubeGoal, type KubeState } from '../index';
import { allScenarios } from '../../../content/courses/kubernetes/scenarios/index';
import { ETCD_SAVE, ETCD_SAVE_KIND, ETCD_TLS } from '../../../content/courses/kubernetes/scenarios/k9';
import { humanBytes, humanSize3, shortHuman, systemdAgo, systemdSpan, tabwrite, unitsAgo } from '../node/fixtures';
import { manifestErrorLine } from '../node/os';
import { script, sh, shop, SHOP } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const exam = (): KubeState => buildScenario({ ...SHOP, id: 'k9-exam', clusters: [{ name: 'kind-dev', etcdTools: true }] });

describe('opening and leaving a node shell', () => {
  it('docker exec -it opens a root shell in /, exit prints exit', () => {
    const a = sh(shop(), 'docker exec -it dev-worker bash');
    expect(a.r.ok).toBe(true);
    expect(a.out).toBe('');
    expect(a.state.shell).toMatchObject({ node: 'dev-worker', cwd: '/', via: 'docker' });
    const b = sh(a.state, 'hostname');
    expect(b.out).toBe('dev-worker');
    const c = sh(b.state, 'exit');
    expect(c.out).toBe('exit');
    expect(c.state.shell).toBeUndefined();
  });

  it('ssh opens the same shell in ~ (with a kind note) and logout says the connection closed', () => {
    const a = sh(shop(), 'ssh dev-worker2');
    expect(a.out).toMatch(/^# kind nodes have no SSH server/);
    expect(a.r.output[0]![0]!.c).toBe('dim');
    expect(sh(a.state, 'pwd').out).toBe('/root');
    expect(sh(a.state, 'exit').out).toBe('logout\nConnection to dev-worker2 closed.');
  });

  it('unknown nodes fail like ssh and docker do', () => {
    const a = sh(shop(), 'ssh dev-worker9');
    expect(a.out).toBe('ssh: Could not resolve hostname dev-worker9: Name or service not known');
    expect(a.r.exitCode).toBe(255);
    const b = sh(shop(), 'docker exec -it nope bash');
    expect(b.out).toBe('Error response from daemon: No such container: nope');
  });

  it('docker exec NODE CMD runs one command and stays on the laptop', () => {
    const r = sh(shop(), 'docker exec dev-control-plane ls /etc/kubernetes/manifests');
    expect(r.out).toBe('etcd.yaml  kube-apiserver.yaml  kube-controller-manager.yaml  kube-scheduler.yaml');
    expect(r.state.shell).toBeUndefined();
  });

  it('tools a kind node does not have say command not found (exit 127)', () => {
    const s = sh(shop(), 'docker exec -it dev-worker bash').state;
    for (const cmd of ['vim', 'sudo', 'etcdctl', 'less']) {
      const r = sh(s, `${cmd} x`);
      expect(r.out).toBe(`bash: ${cmd}: command not found`);
      expect(r.r.exitCode).toBe(127);
    }
  });
});

describe('kubectl inside a node', () => {
  it('control-plane node: kind set KUBECONFIG=/etc/kubernetes/admin.conf, so kubectl works as the admin (kind-capture)', () => {
    const s = sh(shop(), 'docker exec -it dev-control-plane bash').state;
    expect(sh(s, 'echo $KUBECONFIG').out).toBe('/etc/kubernetes/admin.conf');
    const r = sh(s, 'kubectl get nodes');
    expect(r.r.ok).toBe(true);
    expect(r.out).toMatch(/^NAME {16}STATUS {3}ROLES {11}AGE +VERSION\ndev-control-plane +Ready +control-plane .* v1\.37\.0\ndev-worker +Ready +<none> /);
    // The node's own kubectl comes with the kind node image: v1.37.0, not the laptop's v1.37.2.
    expect(sh(s, 'kubectl version').out).toBe('Client Version: v1.37.0\nKustomize Version: v5.8.1\nServer Version: v1.37.0');
    expect(sh(s, 'kubectl version').state.kubectlVersion).toBe('v1.37.2');
    // One command without a shell, as capture-cka.sh ran it.
    expect(sh(shop(), 'docker exec dev-control-plane kubectl get nodes').out).toMatch(/^NAME\s+STATUS/);
    expect(sh(shop(), 'ssh dev-control-plane').state.shell?.env.KUBECONFIG).toBe('/etc/kubernetes/admin.conf');
  });

  it('worker: no KUBECONFIG, no admin.conf, so kubectl tries localhost:8080 (real kubectl v1.37.0 output)', () => {
    const s = sh(shop(), 'docker exec -it dev-worker bash').state;
    expect(sh(s, 'echo $KUBECONFIG').out).toBe('');
    const r = sh(s, 'kubectl get nodes');
    expect(r.r.ok).toBe(false);
    expect(r.r.explain).toMatchObject({ key: 'k9.err.kubectlInNode', params: { node: 'dev-control-plane' } });
    const lines = r.out.split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(/^E1031 \d\d:\d\d:\d\d\.\d{6} +\d+ memcache\.go:381\] "Couldn't get current server API group list" err="Get \\"http:\/\/localhost:8080\/api\?timeout=32s\\": dial tcp (?:127\.0\.0\.1|\[::1\]):8080: connect: connection refused"$/);
    expect(lines[5]).toBe('The connection to the server localhost:8080 was refused - did you specify the right host or port?');
    // client-go skips a KUBECONFIG file that is not there: the same lines.
    const env = sh(s, 'export KUBECONFIG=/etc/kubernetes/admin.conf').state;
    expect(sh(env, 'kubectl get pods -A').out.split('\n').at(-1)).toBe(lines[5]);
    // --kubeconfig must exist.
    const flag = sh(s, 'kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes');
    expect(flag.out).toBe('error: stat /etc/kubernetes/admin.conf: no such file or directory');
    expect(flag.r.ok).toBe(false);
    expect(sh(s, 'kubectl version').out).toBe('Client Version: v1.37.0\nKustomize Version: v5.8.1\nThe connection to the server localhost:8080 was refused - did you specify the right host or port?');
    // apply says other words with no server (not recorded): a grey note only.
    expect(sh(s, 'kubectl apply -f x.yaml').r.output.every((l) => l.every((x) => x.c === 'dim'))).toBe(true);
    // A kubeconfig that is not the admin's: the practice shell does not pretend.
    expect(sh(s, 'kubectl --kubeconfig /etc/kubernetes/kubelet.conf get nodes').r.output.every((l) => l.every((x) => x.c === 'dim'))).toBe(true);
  });
});

describe('the kubelet service', () => {
  it('systemctl status shows the real kind unit (active), and is-active says active', () => {
    const s = sh(shop(), 'ssh dev-worker').state;
    const r = sh(s, 'systemctl status kubelet');
    expect(r.out).toMatch(/^● kubelet\.service - kubelet: The Kubernetes Node Agent\n {5}Loaded: loaded \(\/etc\/systemd\/system\/kubelet\.service; enabled; preset: enabled\)/);
    expect(r.out).toContain('└─10-kubeadm.conf, 11-kind.conf');
    expect(r.out).toMatch(/Active: active \(running\) since \w{3} 2026-10-31 \d\d:\d\d:\d\d UTC; \d+min ago/);
    expect(r.out).toContain('CGroup: /kubelet.slice/kubelet.service');
    expect(r.out).toMatch(/--node-ip=172\.18\.0\.3 --provider-id=kind:\/\/docker\/dev\/dev-worker/);
    expect(r.out).toContain('systemd[1]: Started kubelet.service - kubelet: The Kubernetes Node Agent.');
    expect(sh(s, 'systemctl is-active kubelet').out).toBe('active');
  });

  it('stop: inactive (dead), exit 3, the journal shows the real stop lines; start brings it back', () => {
    let s = sh(shop(), 'ssh dev-worker').state;
    s = sh(s, 'systemctl stop kubelet').state;
    const st = sh(s, 'systemctl status kubelet');
    expect(st.out).toMatch(/^○ kubelet\.service/);
    expect(st.out).toMatch(/Active: inactive \(dead\) since .*; \S+ ago\n {3}Duration: /);
    expect(st.r.exitCode).toBe(3);
    const ia = sh(s, 'systemctl is-active kubelet');
    expect(ia.out).toBe('inactive');
    expect(ia.r.exitCode).toBe(3);
    // kind-capture: systemd's Stopping…, the kubelet's own shutdown lines, then Deactivated… and
    // Stopped…. Which kubelet lines appear, and where Stopping… lands, vary from run to run.
    const j = sh(s, 'journalctl -u kubelet -n 8 --no-pager').out.split('\n');
    expect(j).toHaveLength(8);
    expect(j.filter((l) => /^Oct 31 \d\d:\d\d:\d\d dev-worker systemd\[1\]: Stopping kubelet\.service - kubelet: The Kubernetes Node Agent\.\.\.$/.test(l))).toHaveLength(1);
    expect(j.filter((l) => /^Oct 31 \d\d:\d\d:\d\d dev-worker kubelet\[\d+\]: I1031 [\d:.]+ +\d+ [\w.]+\.go:\d+\] "/.test(l)).length).toBeGreaterThanOrEqual(4);
    expect(j[6]).toMatch(/systemd\[1\]: kubelet\.service: Deactivated successfully\.$/);
    expect(j[7]).toMatch(/systemd\[1\]: Stopped kubelet\.service - kubelet: The Kubernetes Node Agent\.$/);
    // The recording's older line (a pod removed 9 s before the stop) is not part of the stop.
    expect(sh(s, 'journalctl -u kubelet --no-pager').out).not.toContain('Pod removed broadcasted');
    expect(sh(s, 'journalctl -u kubelet | grep Stopping').out.split('\n')).toHaveLength(1);
    s = sh(s, 'systemctl start kubelet').state;
    expect(sh(s, 'systemctl is-active kubelet').out).toBe('active');
    expect(sh(s, 'journalctl -u kubelet | grep "systemd.*Started kubelet"').out.split('\n')).toHaveLength(2);
  });

  it('a stopped kubelet makes the node NotReady after the grace period, with real conditions and taints', () => {
    let s = script(shop(), ['ssh dev-worker', 'systemctl stop kubelet', 'exit']).state;
    s = tick(s, NODE_GRACE - 5).state;
    expect(sh(s, 'kubectl get node dev-worker').out).toMatch(/dev-worker\s+Ready\s/);
    s = tick(s, 10).state;
    expect(sh(s, 'kubectl get node dev-worker').out).toMatch(/dev-worker\s+NotReady\s+<none>/);
    const d = sh(s, 'kubectl describe node dev-worker').out;
    expect(d).toContain('node.kubernetes.io/unreachable:NoSchedule');
    expect(d).toMatch(/Ready +Unknown .* NodeStatusUnknown +Kubelet stopped posting node status\./);
    expect(checkGoal(s, { nodeReady: { name: 'dev-worker' } }).ok).toBe(false);
    expect(checkGoal(s, { nodeReady: { name: 'dev-worker', ready: false } }).ok).toBe(true);
    s = script(s, ['ssh dev-worker', 'systemctl start kubelet', 'exit']).state;
    s = tick(s, 2).state;
    expect(checkGoal(s, { nodeReady: { name: 'dev-worker' } }).ok).toBe(true);
  });

  it('restart keeps the node Ready; unknown units fail like systemctl', () => {
    let s = sh(shop(), 'ssh dev-worker').state;
    s = sh(s, 'systemctl restart kubelet').state;
    expect(sh(s, 'systemctl is-active kubelet').out).toBe('active');
    const u = sh(s, 'systemctl status nginx');
    expect(u.out).toBe('Unit nginx.service could not be found.');
    expect(u.r.exitCode).toBe(4);
    expect(sh(s, 'systemctl restart nginx').out).toBe('Failed to restart nginx.service: Unit nginx.service not found.');
    expect(sh(s, 'journalctl -u nginx').out).toBe('-- No entries --');
  });

  it('the stopKubelet fault does the same as systemctl stop kubelet', () => {
    const r = injectFault(shop(), { type: 'stopKubelet', node: 'dev-worker2' });
    expect(r.explain?.key).toBe('k9.explain.fault.stopKubelet');
    const s = tick(r.state, 60).state;
    expect(checkGoal(s, { nodeReady: { name: 'dev-worker2', ready: false } }).ok).toBe(true);
    expect(sh(sh(s, 'ssh dev-worker2').state, 'systemctl is-active kubelet').out).toBe('inactive');
  });
});

describe('crictl', () => {
  it('ps and pods list the containers and sandboxes on this node in the recorded format', () => {
    const s = sh(shop(), 'docker exec -it dev-worker bash').state;
    const ps = sh(s, 'crictl ps').out.split('\n');
    expect(ps[0]).toMatch(/^CONTAINER {11}IMAGE {15}CREATED {13}STATE {15}NAME {16}ATTEMPT {13}POD ID {14}POD +NAMESPACE$/);
    expect(ps.some((l) => /^[0-9a-f]{13} +520212b8b0fcd +\d+ minutes ago +Running +coredns +0 +[0-9a-f]{13} +coredns-/.test(l))).toBe(true);
    expect(ps.some((l) => / web +0 .* shop-/.test(l))).toBe(true);
    const pods = sh(s, 'crictl pods').out.split('\n');
    expect(pods[0]).toMatch(/^POD ID {14}CREATED {13}STATE {15}NAME +NAMESPACE +ATTEMPT +RUNTIME$/);
    expect(pods.slice(1).every((l) => / Ready .*\(default\)$/.test(l))).toBe(true);
  });

  it('ps -a shows a crashed container; logs prints its last words; unknown ids fail like crictl', () => {
    let s = buildScenario(allScenarios.find((x) => x.id === 'k9-crictl')!);
    s = sh(s, 'docker exec -it dev-worker2 bash').state;
    const row = sh(s, 'crictl ps -a --name oven').out.split('\n')[1]!;
    expect(row).toMatch(/^[0-9a-f]{13} +[0-9a-f]{13} +.+ago +Exited +oven +\d+ /);
    const id = row.split(/\s+/)[0]!;
    expect(sh(s, `crictl logs ${id}`).out).toBe('oven: no gas, cannot heat');
    const miss = sh(s, 'crictl logs abc');
    expect(miss.r.ok).toBe(false);
    expect(miss.out).toMatch(/level=fatal msg="rpc error: code = NotFound desc = an error occurred when try to find container \\"abc\\": not found"$/);
    expect(sh(s, 'crictl images').out).toContain('registry.k8s.io/etcd                            3.7.0-0              270fbeb697171       22.3MB');
  });

  it('crictl still sees running containers when the kubelet is stopped', () => {
    const s = script(shop(), ['ssh dev-worker', 'systemctl stop kubelet']).state;
    expect(sh(s, 'crictl ps').out).toMatch(/Running +web/);
  });
});

describe('static pods', () => {
  it('the control plane runs as mirror pods owned by the Node, from the real kubeadm manifests', () => {
    const s = shop();
    expect(sh(s, 'kubectl get pod kube-scheduler-dev-control-plane -n kube-system -o jsonpath={.metadata.ownerReferences[0].kind}').out).toBe('Node');
    expect(sh(s, 'kubectl get pod etcd-dev-control-plane -n kube-system -o jsonpath={.spec.containers[0].image}').out).toBe('registry.k8s.io/etcd:3.7.0-0');
    const cp = sh(s, 'docker exec -it dev-control-plane bash').state;
    expect(sh(cp, 'ls -l /etc/kubernetes/manifests').out).toMatch(/^total 16\n-rw------- 1 root root 2602 Oct 31 \d\d:\d\d etcd\.yaml\n/);
    expect(sh(cp, 'grep image: /etc/kubernetes/manifests/kube-scheduler.yaml').out).toBe('    image: registry.k8s.io/kube-scheduler:v1.37.0');
    expect(sh(sh(shop(), 'docker exec -it dev-worker bash').state, 'ls /etc/kubernetes/manifests').out).toBe('');
  });

  it('a manifest moved away: the pod goes, new pods wait in Pending with no events; moving it back fixes it', () => {
    let s = script(shop(), ['ssh dev-control-plane', 'mv /etc/kubernetes/manifests/kube-scheduler.yaml /root/', 'exit']).state;
    s = tick(s, 5).state;
    expect(checkGoal(s, { staticPodRunning: { name: 'kube-scheduler' } }).ok).toBe(false);
    s = sh(s, 'kubectl run tray --image=nginx:1.29-alpine').state;
    s = tick(s, 10).state;
    expect(sh(s, 'kubectl get pod tray').out).toMatch(/tray\s+0\/1\s+Pending/);
    expect(sh(s, 'kubectl describe pod tray').out).toMatch(/Events:\s+<none>/);
    s = script(s, ['ssh dev-control-plane', 'mv /root/kube-scheduler.yaml /etc/kubernetes/manifests/', 'exit']).state;
    s = tick(s, 10).state;
    expect(checkGoal(s, { staticPodRunning: { name: 'kube-scheduler' }, podsReady: { selector: 'run=tray', count: 1 } }).ok).toBe(true);
  });

  it('a kubeconfig typo crashes the scheduler with the real kube-scheduler v1.37.0 error; sed -i fixes it', () => {
    let s = injectFault(shop(), { type: 'breakStaticPod', component: 'kube-scheduler', how: 'path' }).state;
    s = tick(s, 30).state;
    expect(sh(s, 'kubectl get pods -n kube-system -l component=kube-scheduler').out).toMatch(/kube-scheduler-dev-control-plane\s+0\/1\s+(CrashLoopBackOff|Error)/);
    const logs = sh(s, 'kubectl logs -n kube-system kube-scheduler-dev-control-plane').out.split('\n');
    expect(logs[1]).toMatch(/^E1031 \d\d:\d\d:\d\d\.\d{6} {7}1 run\.go:72\] "command failed" err="stat \/etc\/kubernetes\/schedulr\.conf: no such file or directory"$/);
    s = script(s, ['ssh dev-control-plane', "sed -i 's/schedulr.conf/scheduler.conf/' /etc/kubernetes/manifests/kube-scheduler.yaml", 'exit']).state;
    s = tick(s, 10).state;
    expect(checkGoal(s, { staticPodRunning: { name: 'kube-scheduler' } }).ok).toBe(true);
  });

  it('a misspelt flag ends with cobra\'s error; an image typo cannot be pulled; a YAML slip removes the pod', () => {
    let a = injectFault(shop(), { type: 'breakStaticPod', component: 'kube-scheduler', how: 'flag' }).state;
    a = tick(a, 20).state;
    expect(sh(a, 'kubectl logs -n kube-system kube-scheduler-dev-control-plane --tail=1').out).toBe('Error: unknown flag: --bind-adress');
    let b = injectFault(shop(), { type: 'breakStaticPod', component: 'kube-controller-manager', how: 'image' }).state;
    b = tick(b, 20).state;
    expect(sh(b, 'kubectl get pods -n kube-system -l component=kube-controller-manager').out).toMatch(/(ErrImagePull|ImagePullBackOff)/);
    let c = injectFault(shop(), { type: 'breakStaticPod', component: 'kube-scheduler', how: 'yaml' }).state;
    c = tick(c, 6).state;
    expect(sh(c, 'kubectl get pods -n kube-system -l component=kube-scheduler').out).toBe('No resources found in kube-system namespace.');
    // kind-capture: the kubelet's journal says which file and line it could not parse.
    const j = sh(sh(c, 'ssh dev-control-plane').state, 'journalctl -u kubelet | grep manifest').out.split('\n').filter((l) => /Could not process/.test(l));
    expect(j.at(-1)).toMatch(/^Oct 31 [\d:]+ dev-control-plane kubelet\[\d+\]: E1031 [\d:.]+ +\d+ file\.go:186\] "Could not process manifest file" err="\/etc\/kubernetes\/manifests\/kube-scheduler\.yaml: couldn't parse as pod\(yaml: line 11: mapping values are not allowed in this context\), please check config file" path="\/etc\/kubernetes\/manifests\/kube-scheduler\.yaml"$/);
  });

  it('the manifest error line follows the file (line number after the broken containers key), and other slips stay silent', () => {
    expect(manifestErrorLine('a\nb\nc\n  containers\n  - command:\n', '/etc/kubernetes/manifests/etcd.yaml')?.text).toMatch(/etcd\.yaml: couldn't parse as pod\(yaml: line 5: mapping values/);
    expect(manifestErrorLine('apiVersion: v1\nkind: Pod\nspec: [\n', '/etc/kubernetes/manifests/etcd.yaml')).toBeNull();
  });

  it('no kube-controller-manager: a scaled Deployment gets no new pods until it is back', () => {
    let s = script(shop(), ['ssh dev-control-plane', 'mv /etc/kubernetes/manifests/kube-controller-manager.yaml /tmp/', 'exit']).state;
    s = tick(s, 6).state;
    s = sh(s, 'kubectl scale deployment shop --replicas=5').state;
    s = tick(s, 15).state;
    expect(sh(s, 'kubectl get pods -l app=shop -o name').out.split('\n')).toHaveLength(3);
    s = script(s, ['ssh dev-control-plane', 'mv /tmp/kube-controller-manager.yaml /etc/kubernetes/manifests/', 'exit']).state;
    s = settle(s).state;
    expect(checkGoal(s, { podsReady: { selector: 'app=shop', count: 5 } }).ok).toBe(true);
  });

  it('no kube-apiserver: the laptop gets EOF through Docker; inside the node the port is refused', () => {
    let s = script(shop(), ['ssh dev-control-plane', 'mv /etc/kubernetes/manifests/kube-apiserver.yaml /tmp/', 'exit']).state;
    s = tick(s, 5).state;
    // kind-capture: kind publishes the API port through Docker, which takes the call and closes it.
    const r = sh(s, 'kubectl get nodes');
    expect(r.r.ok).toBe(false);
    expect(r.out).toBe('Unable to connect to the server: EOF');
    expect(r.r.explain).toMatchObject({ key: 'k9.err.apiDown', params: { server: expect.stringMatching(/^127\.0\.0\.1:\d+$/) } });
    expect(sh(s, 'kubectl describe node dev-worker').out).toBe('Unable to connect to the server: EOF');
    // kind-capture: `version` gets its own words for the /version call (the address is this cluster's).
    expect(sh(s, 'kubectl version').out).toMatch(/^Client Version: v1\.37\.2\nKustomize Version: v5\.8\.1\nerror: Get "https:\/\/127\.0\.0\.1:\d+\/version\?timeout=32s": read tcp 127\.0\.0\.1:\d+->127\.0\.0\.1:\d+: read: connection reset by peer - error from a previous attempt: EOF$/);
    expect(sh(s, 'kubectl version --client').out).toBe('Client Version: v1.37.2\nKustomize Version: v5.8.1');
    // apply prints other words (it cannot download the openapi schema): not recorded, so only a note.
    const apply = sh(s, 'kubectl apply -f shop.yaml');
    expect(apply.r.ok).toBe(false);
    expect(apply.r.output.every((l) => l.every((x) => x.c === 'dim'))).toBe(true);
    // Inside the control-plane node, kubectl goes straight to dev-control-plane:6443: nothing listens.
    const cp = sh(s, 'docker exec -it dev-control-plane bash').state;
    const lines = sh(cp, 'kubectl get nodes').out.split('\n');
    // kind-capture: one line, no klog lines before it.
    expect(lines).toEqual(['The connection to the server dev-control-plane:6443 was refused - did you specify the right host or port?']);
    expect(sh(cp, 'kubectl version').out).toBe('Client Version: v1.37.0\nKustomize Version: v5.8.1\nThe connection to the server dev-control-plane:6443 was refused - did you specify the right host or port?');
    s = script(s, ['ssh dev-control-plane', 'mv /tmp/kube-apiserver.yaml /etc/kubernetes/manifests/', 'exit']).state;
    s = tick(s, 5).state;
    expect(sh(s, 'kubectl get nodes').r.ok).toBe(true);
  });

  it('a deleted mirror pod comes back (the kubelet posts it again)', () => {
    let s = sh(shop(), 'kubectl delete pod kube-scheduler-dev-control-plane -n kube-system').state;
    s = tick(s, 3).state;
    expect(sh(s, 'kubectl get pods -n kube-system -l component=kube-scheduler').out).toMatch(/kube-scheduler-dev-control-plane\s+1\/1\s+Running/);
  });

  it('drain skips mirror pods on the control plane', () => {
    const r = sh(shop(), 'kubectl drain dev-control-plane --ignore-daemonsets');
    expect(r.out).not.toMatch(/evicting pod kube-system\/(etcd|kube-apiserver|kube-scheduler|kube-controller-manager)-/);
  });
});

describe('kubeadm', () => {
  it('upgrade plan: the recorded plan on the kind control plane only (kind-capture); a note elsewhere', () => {
    const cp = sh(shop(), 'docker exec -it dev-control-plane bash').state;
    const r = sh(cp, 'kubeadm upgrade plan');
    expect(r.r.ok).toBe(true);
    expect(r.out).toContain('[upgrade/versions] Cluster version: 1.37.0');
    expect(r.out).toContain('kubeadm upgrade apply v1.37.2');
    expect(r.r.explain).toMatchObject({ key: 'k9.explain.kubeadmUpgradePlan' });
    const w = sh(sh(shop(), 'docker exec -it dev-worker bash').state, 'kubeadm upgrade plan');
    expect(w.r.ok).toBe(false);
    expect(w.out).toMatch(/^# kubeadm upgrade plan:/);
    expect(sh(cp, 'kubeadm upgrade apply v1.37.2').out).toMatch(/^# kubeadm upgrade apply:/);
  });

  it('certs check-expiration: one year for leaf certificates, ten for the CAs (real layout)', () => {
    const s = sh(shop(), 'docker exec -it dev-control-plane bash').state;
    const out = sh(s, 'kubeadm certs check-expiration').out.split('\n');
    expect(out[0]).toBe('[check-expiration] Reading configuration from the "kubeadm-config" ConfigMap in namespace "kube-system"...');
    expect(out[3]).toBe('CERTIFICATE                EXPIRES                  RESIDUAL TIME   CERTIFICATE AUTHORITY   EXTERNALLY MANAGED');
    // kubeadm's tabwriter pads the last column too: kind-capture keeps the trailing spaces.
    expect(out[4]).toBe('admin.conf                 Oct 31, 2027 00:54 UTC   364d            ca                      no      ');
    expect(out[14]).toMatch(/^super-admin\.conf/);
    expect(out.at(-3)).toBe('ca                      Oct 28, 2036 00:54 UTC   9y              no      ');
  });

  it('renew one certificate: it prints the real line and the date moves', () => {
    // A day later (the clock moves straight there: nothing else matters for certificates).
    const s = structuredClone(sh(shop(), 'docker exec -it dev-control-plane bash').state);
    s.clock += 86400;
    const r = sh(s, 'kubeadm certs renew apiserver');
    expect(r.out.split('\n').at(-1)).toBe('certificate for serving the Kubernetes API renewed');
    const out = sh(r.state, 'kubeadm certs check-expiration').out;
    expect(out).toMatch(/^apiserver {18}Nov 01, 2027 01:00 UTC {3}364d/m);
    expect(out).toMatch(/^admin\.conf {17}Oct 31, 2027 00:54 UTC {3}363d/m);
  });

  it('on a worker, or for upgrade plan, it only explains (no invented output)', () => {
    const s = sh(shop(), 'docker exec -it dev-worker bash').state;
    expect(sh(s, 'kubeadm certs check-expiration').r.output.every((l) => l.every((x) => x.c === 'dim'))).toBe(true);
    expect(sh(s, 'kubeadm upgrade plan').r.output.every((l) => l.every((x) => x.c === 'dim'))).toBe(true);
    expect(sh(s, 'kubeadm version -o short').out).toBe('v1.37.0');
  });
});

describe('etcd', () => {
  it('snapshot save needs the etcd CA and a client certificate: without them it waits forever', () => {
    const s = sh(exam(), 'ssh dev-control-plane').state;
    const hang = sh(s, 'etcdctl snapshot save /opt/a.db');
    expect(hang.r.exitCode).toBe(130);
    expect(hang.out).toMatch(/^\{"level":"info","ts":"2026-10-31T[\d:.]+Z","caller":"snapshot\/v3_snapshot\.go:83","msg":"created temporary db file","path":"\/opt\/a\.db\.part"\}\n\^C\n# /);
    expect(sh(s, `etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save /opt/a.db`).r.exitCode).toBe(130);
    const open = sh(s, 'etcdctl --cacert=/etc/kubernetes/pki/etcd/nope.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save /opt/a.db');
    expect(open.out).toBe('Error: open /etc/kubernetes/pki/etcd/nope.crt: no such file or directory');
    expect(sh(s, `etcdctl ${ETCD_TLS} snapshot save /nope/a.db`).out).toBe('Error: could not open /nope/a.db.part (open /nope/a.db.part: no such file or directory)');
  });

  it('save, then etcdutl status (table, simple, json); etcdctl 3.7 has no snapshot status', () => {
    let s = sh(exam(), 'ssh dev-control-plane').state;
    const save = sh(s, ETCD_SAVE);
    expect(save.r.ok).toBe(true);
    // Typed on the node, one terminal: every JSON log line first (the last says "saved"), then stdout.
    const saved = save.out.split('\n');
    expect(saved).toHaveLength(8);
    expect(saved[5]).toMatch(/^\{"level":"info","ts":"2026-10-31T[\d:.]+Z","caller":"snapshot\/v3_snapshot\.go:121","msg":"saved","path":"\/opt\/backup\.db"\}$/);
    expect(saved.slice(-2)).toEqual(['Snapshot saved at /opt/backup.db', 'Server version 3.7.0']);
    s = save.state;
    expect(checkGoal(s, { snapshotTaken: { path: '/opt/backup.db' } }).ok).toBe(true);
    const table = sh(s, 'etcdutl --write-out=table snapshot status /opt/backup.db').out.split('\n');
    expect(table[1]).toBe('│   HASH   │ REVISION │ TOTAL KEYS │ TOTAL SIZE │ VERSION │');
    expect(table[3]).toMatch(/^│ [0-9a-f]{8} │ +\d+ │ +\d+ │ +[\d.]+ MB │ {3}3\.7\.0 │$/);
    expect(table[3]!.length).toBe(table[1]!.length);
    expect(sh(s, 'etcdutl snapshot status /opt/backup.db').out).toMatch(/^[0-9a-f]{8}, \d+, \d+, [\d.]+ MB, 3\.7\.0$/);
    expect(JSON.parse(sh(s, 'etcdutl -w json snapshot status /opt/backup.db').out)).toMatchObject({ version: '3.7.0' });
    expect(sh(s, 'etcdctl snapshot status /opt/backup.db').out).toMatch(/^Manages etcd node snapshots\n\nUsage:\n {2}etcdctl snapshot \[command\]/);
    expect(sh(s, 'etcdctl --data-dir /x snapshot restore /opt/backup.db').out).toMatch(/^Error: unknown flag: --data-dir\n/);
    expect(sh(s, 'etcdutl snapshot status /opt/nope.db').out).toBe('Error: stat /opt/nope.db: no such file or directory');
  });

  it('restore + point etcd at the new folder: the deleted Deployment comes back', () => {
    let s = buildScenario(allScenarios.find((x) => x.id === 'k9-etcd-restore')!);
    const goal: KubeGoal = { deploymentRestored: { name: 'shop' } };
    expect(checkGoal(s, goal).ok).toBe(false);
    s = sh(s, 'ssh dev-control-plane').state;
    const r = sh(s, 'etcdutl --data-dir /var/lib/etcd-restore snapshot restore /opt/backup.db');
    expect(r.out.split('\n')).toHaveLength(10);
    expect(r.out.split('\n')[0]).toMatch(/^2026-10-31T[\d:]+Z\tinfo\tsnapshot\/v3_snapshot\.go:306\trestoring snapshot\t\{"path": "\/opt\/backup\.db", "wal-dir": "\/var\/lib\/etcd-restore\/member\/wal"/);
    s = r.state;
    expect(sh(s, 'etcdutl --data-dir /var/lib/etcd-restore snapshot restore /opt/backup.db').out).toBe('Error: data-dir "/var/lib/etcd-restore" not empty or could not be read');
    s = script(s, ["sed -i 's#/var/lib/etcd$#/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml", 'exit']).state;
    s = tick(s, 4).state;
    expect(sh(s, 'kubectl get deployments').r.ok).toBe(false); // etcd restarting: the API is down for a moment
    s = tick(s, 30).state;
    expect(sh(s, 'kubectl get deployment shop').out).toMatch(/shop\s+3\/3\s+3\s+3/);
    expect(checkGoal(s, goal).ok).toBe(true);
  });

  it('a re-applied Deployment is not a restore', () => {
    let s = buildScenario(allScenarios.find((x) => x.id === 'k9-etcd-restore')!);
    s = settle(sh(s, 'kubectl apply -f shop.yaml').state).state;
    expect(checkGoal(s, { deploymentRestored: { name: 'shop' } }).ok).toBe(false);
  });

  it('on kind: etcdctl and etcdutl through kubectl exec into the etcd pod', () => {
    const s = shop();
    const r = sh(s, ETCD_SAVE_KIND);
    expect(r.r.ok).toBe(true);
    // kind-capture: kubectl exec brings stdout and stderr back as two streams, so the lines mix
    // and the JSON "saved" log comes last.
    // The order of the stdout and stderr lines changes from run to run (two kind captures differ).
    const lines = r.out.split('\n');
    expect(lines).toHaveLength(8);
    expect(lines).toContain('Snapshot saved at /var/lib/etcd/backup.db');
    expect(lines.filter((l) => /^\{"level":"info","ts":"[\d:.TZ-]+","caller":"snapshot\/v3_snapshot\.go:121","msg":"saved","path":"\/var\/lib\/etcd\/backup\.db"\}$/.test(l))).toHaveLength(1);
    expect(lines.some((l) => /"msg":"fetched snapshot","endpoint":"https:\/\/127\.0\.0\.1:2379","size":"[\d.]+ MB"/.test(l))).toBe(true);
    expect(checkGoal(r.state, { snapshotTaken: {} }).ok).toBe(true);
    const bad = sh(s, 'kubectl -n kube-system exec etcd-dev-control-plane -- etcdctl --cacert=/etc/kubernetes/pki/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save /var/lib/etcd/x.db');
    expect(bad.out.split('\n')[0]).toBe('Error: open /etc/kubernetes/pki/ca.crt: no such file or directory');
    expect(bad.out.split('\n')[1]).toBe('command terminated with exit code 128');
    // The snapshot on the node's /var/lib/etcd is the same file.
    expect(sh(sh(r.state, 'docker exec -it dev-control-plane bash').state, 'ls /var/lib/etcd').out).toBe('backup.db  member');
  });
});

describe('files and pipes on a node', () => {
  it('sed without -i prints; cat of a missing file fails like cat; | grep and | tail filter', () => {
    const s = sh(shop(), 'docker exec -it dev-control-plane bash').state;
    expect(sh(s, "sed 's/v1.37.0/v1.37.1/' /etc/kubernetes/manifests/kube-scheduler.yaml | grep image:").out).toBe('    image: registry.k8s.io/kube-scheduler:v1.37.1');
    expect(sh(s, 'grep image: /etc/kubernetes/manifests/kube-scheduler.yaml').out).toContain('v1.37.0');
    expect(sh(s, 'cat /etc/kubernetes/manifests/nope.yaml').out).toBe('cat: /etc/kubernetes/manifests/nope.yaml: No such file or directory');
    expect(sh(s, 'cat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf | tail -n 1').out).toBe('ExecStart=/usr/bin/kubelet $KUBELET_KUBECONFIG_ARGS $KUBELET_CONFIG_ARGS $KUBELET_KUBEADM_ARGS $KUBELET_EXTRA_ARGS');
    expect(sh(s, 'sed -i s/a/b/ /nope').out).toBe("sed: can't read /nope: No such file or directory");
    expect(sh(s, 'kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes').out).toMatch(/^NAME\s+STATUS/);
  });
});

describe('formats', () => {
  it('go-units, go-humanize, systemd and apimachinery durations', () => {
    expect(unitsAgo(0.5)).toBe('Less than a second ago');
    expect(unitsAgo(75)).toBe('About a minute ago');
    expect(unitsAgo(420)).toBe('7 minutes ago');
    expect(unitsAgo(17 * 3600)).toBe('17 hours ago');
    expect(humanBytes(29_000)).toBe('29 kB');
    expect(humanBytes(2_100_000)).toBe('2.1 MB');
    expect(humanSize3(39_700_000)).toBe('39.7MB');
    expect(humanSize3(320_000)).toBe('320kB');
    expect(systemdAgo(77)).toBe('1min 17s ago');
    expect(systemdAgo(3)).toBe('3s ago');
    expect(systemdSpan(77)).toBe('1min 17s');
    expect(shortHuman(364 * 86400 + 100)).toBe('364d');
    expect(shortHuman(9.9 * 365 * 86400)).toBe('9y');
    expect(shortHuman(-100)).toBe('<invalid>');
    expect(tabwrite([['A', 'B'], ['long-name-here-x', 'y']])).toEqual(['A                   B', 'long-name-here-x    y']);
  });

  it('every fixture names its source and has text', () => {
    for (const [k, o] of Object.entries(CKA.outputs)) {
      expect(['node-image', 'etcd-image', 'kubectl-client', 'component-image', 'docs', 'kind-capture'], k).toContain(o.source);
      expect(o.text.length, k).toBeGreaterThan(0);
    }
  });
});

/** Each K9 scenario: the lesson's goal, not met at the start, met after the solution. */
const SOLUTIONS: { id: string; goal: KubeGoal; solve: string[]; wait?: number }[] = [
  { id: 'k9-notready', goal: { nodeReady: { name: 'dev-worker' } }, solve: ['ssh dev-worker', 'systemctl start kubelet', 'exit'], wait: 5 },
  { id: 'k9-scheduler-down', goal: { staticPodRunning: { name: 'kube-scheduler' }, podsReady: { selector: 'run=tray', count: 1 } }, solve: ['ssh dev-control-plane', 'mv /root/kube-scheduler.yaml /etc/kubernetes/manifests/', 'exit'], wait: 15 },
  { id: 'k9-scheduler-crash', goal: { staticPodRunning: { name: 'kube-scheduler' } }, solve: ['ssh dev-control-plane', "sed -i 's/schedulr.conf/scheduler.conf/' /etc/kubernetes/manifests/kube-scheduler.yaml", 'exit'], wait: 10 },
  { id: 'k9-crictl', goal: { typed: '^crictl logs [0-9a-f]+' }, solve: ['docker exec -it dev-worker2 bash', 'crictl ps -a --name oven'] },
  { id: 'k9-drain', goal: { nodeCordoned: { name: 'dev-worker', cordoned: true }, podsReady: { selector: 'app=shop', count: 3 } }, solve: ['kubectl drain dev-worker --ignore-daemonsets'], wait: 10 },
  { id: 'k9-etcd-backup', goal: { snapshotTaken: { path: '/opt/backup.db' } }, solve: ['ssh dev-control-plane', ETCD_SAVE, 'exit'] },
  { id: 'k9-etcd-restore', goal: { deploymentRestored: { name: 'shop' } }, solve: ['ssh dev-control-plane', 'etcdutl --data-dir /var/lib/etcd-restore snapshot restore /opt/backup.db', "sed -i 's#/var/lib/etcd$#/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml", 'exit'], wait: 40 },
  { id: 'k9-etcd-kind', goal: { snapshotTaken: {} }, solve: [ETCD_SAVE_KIND] },
  {
    id: 'k9-boss',
    goal: { nodeReady: { name: 'dev-worker2' }, deploymentRestored: { name: 'shop' } },
    solve: ['ssh dev-worker2', 'systemctl start kubelet', 'exit', 'ssh dev-control-plane', 'etcdutl --data-dir /var/lib/etcd-restore snapshot restore /opt/backup.db', "sed -i 's#/var/lib/etcd$#/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml", 'exit'],
    wait: 40,
  },
];

describe('K9 scenarios', () => {
  for (const x of SOLUTIONS) {
    it(`${x.id}: goal unmet at the start, met after the solution`, () => {
      const sc = allScenarios.find((s) => s.id === x.id);
      expect(sc, x.id).toBeDefined();
      let s = buildScenario(sc!);
      expect(checkGoal(s, x.goal, []).ok).toBe(false);
      const typed: string[] = [];
      for (const c of x.solve) {
        const r = sh(s, c);
        expect(r.r.ok || r.r.stopped, `${x.id}: ${c}\n${r.out}`).toBeTruthy();
        s = r.state;
        typed.push(c);
      }
      if (x.id === 'k9-crictl') {
        const id = sh(s, 'crictl ps -a -q --name oven').out.split('\n')[0]!;
        const r = sh(s, `crictl logs ${id}`);
        s = r.state;
        typed.push(`crictl logs ${id}`);
      }
      if (x.wait) s = tick(s, x.wait).state;
      expect(checkGoal(s, x.goal, typed)).toEqual({ ok: true, failed: [] });
    });
  }

  it('every K9 scenario is listed, builds, and only k9-static-pods is compared on a real cluster', () => {
    const k9 = allScenarios.filter((s) => s.id.startsWith('k9-'));
    expect(k9.length).toBeGreaterThanOrEqual(8);
    for (const sc of k9) {
      expect(() => buildScenario(sc), sc.id).not.toThrow();
      const nodeCmds = (sc.verify ?? []).flat().some((c) => !/^(kubectl|sleep)\b/.test(c));
      if (nodeCmds || (sc.steps ?? []).some((st) => typeof st === 'object' && 'fault' in st)) expect(sc.engineOnly, sc.id).toBeTruthy();
    }
    expect(allScenarios.find((s) => s.id === 'k9-static-pods')!.engineOnly).toBeUndefined();
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('i18n', () => {
  it('every k9.* key the engine and UI use exists in both languages (same keys)', () => {
    const files = [...walk('src/engine/foodcourt-sim'), 'src/components/interactives/KubeSim.tsx'].filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'));
    const keys = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/'(k9\.[A-Za-z0-9.]+[A-Za-z0-9])'/g)) keys.add(m[1]!);
    for (const f of ['stopKubelet', 'startKubelet', 'breakStaticPod']) keys.add(`k9.explain.fault.${f}`).add(`k9.fault.note.${f}`);
    keys.add('k9.fault.stopKubelet');
    const missing = [...keys].filter((k) => !(k in en) || !(k in ms));
    expect(missing).toEqual([]);
    const enK9 = Object.keys(en).filter((k) => k.startsWith('k9.'));
    const msK9 = Object.keys(ms).filter((k) => k.startsWith('k9.'));
    expect(msK9).toEqual(enK9);
  });
});
