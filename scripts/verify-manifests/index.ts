// npm run verify:manifests — check every Kubernetes manifest the games ship with kubeconform
// (official image, pinned), using the Kubernetes 1.37 JSON schemas and the CRD catalog for
// Gateway API and Argo CD. Needs Docker. Schemas are downloaded on the first run and cached in
// node_modules/.cache/kubeconform.
//
// What is checked:
//   - every YamlDoctor fixture's `fixed` manifest is valid (src/lib/k8sFixtures.ts);
//   - every fixture's `broken` manifest that breaks the schema (YAML, apiVersion/kind, unknown
//     field, wrong type) is invalid too, so kubeconform agrees with our checker;
//   - the YAML the games show for the dev-page demos (src/lib/k8sDemos.ts) is valid.
// Mistakes only the API server catches (a selector that doesn't match, requests above limits, a
// bad cron line…) are not in the JSON schemas, so those `broken` files may pass kubeconform.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { K8S_FIXTURES } from '../../src/lib/k8sFixtures';
import { kubectlApply } from '../../src/lib/k8sSchema';
import {
  labelsDemo,
  mirrorApp,
  rbacDemo,
  rbacPredictDemo,
  schedDemo,
  templateDemo,
  traceDemo,
} from '../../src/lib/k8sDemos';
import { deploymentYaml as lmDeployment, serviceYaml } from '../../src/lib/labelMatchmaker';
import { applyBreaks, manifests } from '../../src/lib/requestTracer';
import { bindingYaml, makeBinding, roleYaml } from '../../src/lib/rbacSwitchboard';
import { podYaml } from '../../src/lib/schedulerTetris';
import {
  applicationYaml,
  deploymentYaml as gitDeployment,
  initMirror,
} from '../../src/lib/gitopsMirror';
import { k6Manifests } from '../../src/content/courses/kubernetes/scenarios/k6';
import { k4Scenarios } from '../../src/content/courses/kubernetes/scenarios/k4';
import { buildScenario, plain, run as kubeRun } from '../../src/engine/foodcourt-sim/index';

export const KUBECONFORM_IMAGE =
  'ghcr.io/yannh/kubeconform:v0.8.0@sha256:faffaf43f95aa6425306e1ab8d6fcad72acb9049158f38e574c085ea1ec0f64e';
export const KUBERNETES_VERSION = '1.37.2';
const CRD_CATALOG =
  'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json';
// Issue codes that a JSON schema can see.
const SCHEMA_CODES = /^(yaml\.|apiVersionMissing|kindMissing|noMatch|unknownField|typeMismatch)/;

type Expect = 'valid' | 'invalid';
const files: { name: string; text: string; expect: Expect }[] = [];
const add = (name: string, text: string, expect: Expect = 'valid') =>
  files.push({ name: `${String(files.length + 1).padStart(2, '0')}-${name}.yaml`, text, expect });

for (const f of K8S_FIXTURES) {
  add(`fixture-${f.id}-fixed`, f.fixed);
  const code = kubectlApply(f.broken, f.file, { namespaces: ['shop'] }).issues[0]?.code ?? '';
  if (SCHEMA_CODES.test(code)) add(`fixture-${f.id}-broken`, f.broken, 'invalid');
}
for (const p of schedDemo.pods) add(`sched-${p.name}`, podYaml(p, schedDemo.keys));
add('labels-service', serviceYaml('shop', labelsDemo.selector, 80, 8080));
add('labels-deployment', lmDeployment('shop', templateDemo.selector, { app: 'shop' }));
add('trace', manifests(traceDemo));
add('trace-locked', manifests(applyBreaks(traceDemo, ['policy'])));
for (const r of rbacDemo.roles) add(`rbac-role-${r.name}`, roleYaml(r));
for (const b of [...rbacDemo.bindings, ...rbacPredictDemo.bindings])
  add(`rbac-binding-${b.name}`, bindingYaml(b));
add('rbac-solution', bindingYaml(makeBinding(rbacDemo.subjects[0]!, rbacDemo.roles[0]!, 'shop')));
for (const heal of [true, false]) {
  const s = initMirror(mirrorApp, heal);
  add(`mirror-deployment-${heal}`, gitDeployment(s));
  add(`mirror-application-${heal}`, applicationYaml(s));
}
// World K6 lessons: scenario files and the YAML the lessons show (all valid).
for (const m of k6Manifests) add(m.name, m.text);

// World K4 lesson files: every manifest a K4 scenario ships (old-shop.yaml uses a retired API on
// purpose), and what `kubectl kustomize` builds from each overlay (the engine's output, which
// matches kubectl 1.37.2's built-in Kustomize v5.8.1).
const seen = new Set<string>();
for (const sc of k4Scenarios) {
  for (const [path, text] of Object.entries(sc.files ?? {})) {
    if (/(^|\/)kustomization\.ya?ml$/.test(path) || seen.has(text)) continue;
    seen.add(text);
    add(`k4-${sc.id}-${path.replace(/[/.]/g, '-')}`, text, path === 'old-shop.yaml' ? 'invalid' : 'valid');
  }
  const overlays = Object.keys(sc.files ?? {})
    .map((p) => /^(overlays\/[^/]+)\/kustomization\.yaml$/.exec(p)?.[1])
    .filter((p): p is string => Boolean(p));
  for (const folder of overlays) {
    const r = kubeRun(buildScenario({ ...sc, steps: [], verify: [] }), `kubectl kustomize ${folder}`);
    if (!r.ok) throw new Error(`${sc.id}: kubectl kustomize ${folder} failed in the engine`);
    add(`k4-${sc.id}-${folder.replace(/\//g, '-')}-built`, `${plain(r.output)}\n`);
  }
}

// Write them where the Docker daemon can read them.
const dir = resolve('node_modules/.cache/verify-manifests');
const cache = resolve('node_modules/.cache/kubeconform');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
mkdirSync(cache, { recursive: true });
for (const f of files) writeFileSync(join(dir, f.name), f.text);

try {
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
} catch {
  console.error('✗ verify:manifests needs Docker (it runs the official kubeconform image).');
  process.exit(1);
}

// Behind an HTTPS proxy with its own CA (some dev machines), pass both into the container.
const proxyArgs: string[] = [];
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) proxyArgs.push('--network', 'host', '-e', `HTTPS_PROXY=${proxy}`);
const ca = process.env.SSL_CERT_FILE;
if (ca && existsSync(ca))
  proxyArgs.push('-v', `${ca}:/etc/verify-ca.crt:ro`, '-e', 'SSL_CERT_FILE=/etc/verify-ca.crt');

const args = [
  'run',
  '--rm',
  '--user',
  `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
  ...proxyArgs,
  '-v',
  `${dir}:/manifests:ro`,
  '-v',
  `${cache}:/cache`,
  KUBECONFORM_IMAGE,
  '-strict',
  '-verbose',
  '-output',
  'json',
  '-cache',
  '/cache',
  '-kubernetes-version',
  KUBERNETES_VERSION,
  '-schema-location',
  'default',
  '-schema-location',
  CRD_CATALOG,
  '/manifests',
];
const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
let report: {
  resources?: { filename: string; kind?: string; name?: string; status: string; msg?: string }[];
};
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error(`✗ kubeconform did not run:\n${run.stdout}\n${run.stderr}`);
  process.exit(1);
}

const byFile = new Map<string, { status: string; msg?: string; kind?: string }[]>();
for (const r of report.resources ?? []) {
  const name = r.filename.replace(/^\/manifests\//, '');
  byFile.set(name, [...(byFile.get(name) ?? []), r]);
}
const problems: string[] = [];
let valid = 0;
let invalid = 0;
for (const f of files) {
  const rs = byFile.get(f.name) ?? [];
  const download = rs.find(
    (r) =>
      r.status === 'statusError' &&
      /failed downloading schema|no such host|TLS|certificate|timeout/i.test(r.msg ?? ''),
  );
  if (download) {
    problems.push(`${f.name}: could not download a schema: ${download.msg}`);
    continue;
  }
  const ok = rs.length > 0 && rs.every((r) => r.status === 'statusValid');
  if (f.expect === 'valid' && !ok)
    problems.push(
      `${f.name}: expected valid, got ${rs.map((r) => `${r.status} ${r.msg ?? ''}`).join('; ') || 'no result'}`,
    );
  else if (f.expect === 'invalid' && ok)
    problems.push(`${f.name}: expected kubeconform to reject it, but it passed`);
  else if (ok) valid++;
  else invalid++;
}
if (problems.length) {
  console.error(
    `✗ verify:manifests (${problems.length}):\n${problems.map((p) => `- ${p}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(
  `✓ kubeconform (Kubernetes ${KUBERNETES_VERSION}, strict): ${valid} manifests valid, ${invalid} broken fixtures rejected as expected.`,
);
