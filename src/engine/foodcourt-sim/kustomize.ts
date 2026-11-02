// A small Kustomize (built into kubectl as `kubectl kustomize` and `apply -k`):
// resources (files and other kustomizations), namespace, namePrefix/nameSuffix,
// labels/commonLabels, commonAnnotations, images, replicas, patches (strategic-merge files).
import type { KObject, KubeState } from './types';
import { clone, deepMerge } from './util';
import { parseManifests, toYaml } from './yaml';

/** Kustomize's "legacy" output order. */
const ORDER = [
  'Namespace', 'ResourceQuota', 'StorageClass', 'CustomResourceDefinition', 'ServiceAccount', 'PodSecurityPolicy', 'Role', 'ClusterRole',
  'RoleBinding', 'ClusterRoleBinding', 'ConfigMap', 'Secret', 'Endpoints', 'Service', 'LimitRange', 'PriorityClass', 'PersistentVolume',
  'PersistentVolumeClaim', 'Deployment', 'StatefulSet', 'CronJob', 'PodDisruptionBudget',
];
const LAST = ['MutatingWebhookConfiguration', 'ValidatingWebhookConfiguration'];

function rank(kind: string): number {
  const i = ORDER.indexOf(kind);
  if (i >= 0) return i;
  if (LAST.includes(kind)) return 1000 + LAST.indexOf(kind);
  return 500;
}

function join(dir: string, p: string): string {
  if (p.startsWith('/')) return p;
  const parts = `${dir}/${p}`.split('/');
  const out: string[] = [];
  for (const x of parts) {
    if (!x || x === '.') continue;
    if (x === '..') out.pop();
    else out.push(x);
  }
  return `/${out.join('/')}`;
}

function kustomizationFile(state: KubeState, dir: string): string | null {
  for (const n of ['kustomization.yaml', 'kustomization.yml', 'Kustomization']) if (state.files[`${dir}/${n}`] !== undefined) return `${dir}/${n}`;
  return null;
}

function podTemplateOf(o: KObject): any {
  if (o.kind === 'CronJob') return o.spec?.jobTemplate?.spec?.template;
  return o.spec?.template;
}

/** Build a kustomization folder. Returns the objects, or an error like kustomize prints it. */
export function kustomizeBuild(state: KubeState, dir: string, depth = 0): { objs: KObject[]; error?: string } {
  if (depth > 10) return { objs: [], error: 'error: cycle detected in kustomization' };
  const file = kustomizationFile(state, dir);
  if (!file) return { objs: [], error: `error: unable to find one of 'kustomization.yaml', 'kustomization.yml' or 'Kustomization' in directory '${dir}'` };
  const parsed = parseManifests(state.files[file]!);
  if (parsed.error || !parsed.docs[0]) return { objs: [], error: `error: invalid Kustomization: ${parsed.error ?? 'empty file'}` };
  const k: any = parsed.docs[0];
  let objs: KObject[] = [];
  for (const res of [...(k.resources ?? []), ...(k.bases ?? [])] as string[]) {
    const p = join(dir, res);
    if (state.files[p] !== undefined) {
      const d = parseManifests(state.files[p]!);
      if (d.error) return { objs: [], error: `error: map[string]interface {}(nil): yaml: ${d.error}` };
      objs.push(...d.docs.map((x) => clone(x)));
    } else if (kustomizationFile(state, p)) {
      const sub = kustomizeBuild(state, p, depth + 1);
      if (sub.error) return sub;
      objs.push(...sub.objs);
    } else return { objs: [], error: `error: accumulating resources: accumulation err='accumulating resources from '${res}': open ${p}: no such file or directory'` };
  }
  // Patches (strategic merge by kind + name).
  const patchFiles: { path?: string; patch?: string; target?: any }[] = [
    ...(k.patches ?? []),
    ...(k.patchesStrategicMerge ?? []).map((path: string) => ({ path })),
  ];
  for (const pf of patchFiles) {
    const text = pf.path ? state.files[join(dir, pf.path)] : pf.patch;
    if (text === undefined) return { objs: [], error: `error: trouble configuring builtin PatchTransformer with config: \`\npath: ${pf.path}\n\`: failed to get the patch file from path(${pf.path}): open ${join(dir, pf.path ?? '')}: no such file or directory` };
    for (const patch of parseManifests(text).docs) {
      const name = pf.target?.name ?? patch.metadata?.name;
      const kind = pf.target?.kind ?? patch.kind;
      objs = objs.map((o) => (o.kind === kind && o.metadata.name === name ? deepMerge(o, { ...patch, apiVersion: o.apiVersion, kind: o.kind, metadata: { ...patch.metadata, name: o.metadata.name } }) : o));
    }
  }
  // Names, namespace, labels, annotations.
  const labels: Record<string, string> = { ...(k.commonLabels ?? {}) };
  const labelsWithSelectors = { ...(k.commonLabels ?? {}) };
  const plainLabels: Record<string, string> = {};
  for (const l of k.labels ?? []) {
    if (l.includeSelectors) Object.assign(labelsWithSelectors, l.pairs ?? {});
    else Object.assign(plainLabels, l.pairs ?? {});
    Object.assign(labels, l.pairs ?? {});
  }
  const rename = new Map<string, string>();
  for (const o of objs) {
    o.metadata = o.metadata ?? ({} as any);
    const newName = `${k.namePrefix ?? ''}${o.metadata.name}${k.nameSuffix ?? ''}`;
    if (o.kind !== 'Namespace' && newName !== o.metadata.name) {
      rename.set(`${o.kind}/${o.metadata.name}`, newName);
      o.metadata.name = newName;
    }
    if (k.namespace && !['Namespace', 'ClusterRole', 'ClusterRoleBinding', 'StorageClass', 'PersistentVolume', 'Node'].includes(o.kind)) o.metadata.namespace = k.namespace;
    if (Object.keys(labels).length) o.metadata.labels = { ...(o.metadata.labels ?? {}), ...labels };
    if (k.commonAnnotations) o.metadata.annotations = { ...(o.metadata.annotations ?? {}), ...k.commonAnnotations };
    const tmpl = podTemplateOf(o);
    if (tmpl && Object.keys(labelsWithSelectors).length) {
      tmpl.metadata = tmpl.metadata ?? {};
      tmpl.metadata.labels = { ...(tmpl.metadata.labels ?? {}), ...labelsWithSelectors };
      if (o.spec.selector) o.spec.selector.matchLabels = { ...(o.spec.selector.matchLabels ?? {}), ...labelsWithSelectors };
    }
    if (tmpl && k.commonAnnotations) tmpl.metadata = { ...(tmpl.metadata ?? {}), annotations: { ...(tmpl.metadata?.annotations ?? {}), ...k.commonAnnotations } };
    if (o.kind === 'Service' && Object.keys(labelsWithSelectors).length) o.spec.selector = { ...(o.spec.selector ?? {}), ...labelsWithSelectors };
  }
  // References follow renamed objects (ConfigMaps, Secrets, Services in routes).
  for (const o of objs) {
    const tmpl = podTemplateOf(o);
    const spec = tmpl?.spec ?? (o.kind === 'Pod' ? o.spec : null);
    if (spec) {
      for (const v of spec.volumes ?? []) {
        if (v.configMap) v.configMap.name = rename.get(`ConfigMap/${v.configMap.name}`) ?? v.configMap.name;
        if (v.secret) v.secret.secretName = rename.get(`Secret/${v.secret.secretName}`) ?? v.secret.secretName;
      }
      for (const ctr of spec.containers ?? []) {
        for (const ef of ctr.envFrom ?? []) {
          if (ef.configMapRef) ef.configMapRef.name = rename.get(`ConfigMap/${ef.configMapRef.name}`) ?? ef.configMapRef.name;
          if (ef.secretRef) ef.secretRef.name = rename.get(`Secret/${ef.secretRef.name}`) ?? ef.secretRef.name;
        }
      }
    }
    if (o.kind === 'HTTPRoute') for (const rule of o.spec?.rules ?? []) for (const b of rule.backendRefs ?? []) b.name = rename.get(`Service/${b.name}`) ?? b.name;
    if (o.kind === 'HorizontalPodAutoscaler' && o.spec?.scaleTargetRef) o.spec.scaleTargetRef.name = rename.get(`${o.spec.scaleTargetRef.kind}/${o.spec.scaleTargetRef.name}`) ?? o.spec.scaleTargetRef.name;
  }
  // Images and replicas.
  for (const img of k.images ?? []) {
    for (const o of objs) {
      const spec = podTemplateOf(o)?.spec ?? (o.kind === 'Pod' ? o.spec : null);
      for (const ctr of [...(spec?.containers ?? []), ...(spec?.initContainers ?? [])]) {
        const [name, tag] = String(ctr.image).split(/:(?=[^/]*$)/);
        if (name !== img.name) continue;
        ctr.image = `${img.newName ?? name}${img.digest ? `@${img.digest}` : `:${img.newTag ?? tag ?? 'latest'}`}`;
      }
    }
  }
  for (const r of k.replicas ?? []) {
    for (const o of objs) if (o.metadata.name === (rename.get(`Deployment/${r.name}`) ?? r.name) || o.metadata.name === r.name) if (o.spec && 'replicas' in o.spec || ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(o.kind)) o.spec.replicas = r.count;
  }
  objs.sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind) || a.metadata.name.localeCompare(b.metadata.name));
  return { objs };
}

/** `kubectl kustomize` output: documents joined by `---`. */
export function kustomizeText(objs: KObject[]): string {
  return objs.map((o) => toYaml(o)).join('---\n');
}
