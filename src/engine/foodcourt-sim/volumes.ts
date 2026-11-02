// Data written inside containers (`kubectl exec … -- touch / echo … > file`), kept where
// Kubernetes keeps it: an emptyDir lives as long as its pod (all its containers share it),
// a PVC-backed volume lives as long as the claim (a new pod on the same claim sees it),
// and anything else sits in the container's own layer (gone when the container restarts).
// ConfigMap and Secret mounts are read-only.
import type { Cluster, ContainerRuntime, KObject } from './types';

export type VolumeSpot =
  | { where: 'volume'; key: string; rel: string; mount: string }
  | { where: 'readonly'; mount: string }
  | { where: 'container' };

/** Which volume (if any) holds `path` inside this container. */
export function spotOf(pod: KObject, ctr: any, path: string): VolumeSpot {
  let best: { m: any; vol: any } | null = null;
  for (const m of ctr?.volumeMounts ?? []) {
    const mp = String(m.mountPath).replace(/\/$/, '');
    if (path !== mp && !path.startsWith(`${mp}/`)) continue;
    if (best && String(best.m.mountPath).length >= mp.length) continue;
    const vol = (pod.spec.volumes ?? []).find((v: any) => v.name === m.name);
    if (vol) best = { m, vol };
  }
  if (!best) return { where: 'container' };
  const mount = String(best.m.mountPath).replace(/\/$/, '');
  const rel = path === mount ? '' : path.slice(mount.length + 1);
  const { vol } = best;
  if (vol.emptyDir) return { where: 'volume', key: `emptyDir/${pod.metadata.uid}/${vol.name}`, rel, mount };
  if (vol.persistentVolumeClaim) return { where: 'volume', key: `pvc/${pod.metadata.namespace}/${vol.persistentVolumeClaim.claimName}`, rel, mount };
  if (vol.configMap || vol.secret || vol.projected || vol.downwardAPI) return { where: 'readonly', mount };
  return { where: 'container' };
}

function store(c: Cluster, key: string): Record<string, string> {
  c.volumeData = c.volumeData ?? {};
  c.volumeData[key] = c.volumeData[key] ?? {};
  return c.volumeData[key]!;
}

/** Write (or append to) a file. Returns an error line like busybox prints it, or null. */
export function writeFile(c: Cluster, pod: KObject, ctr: any, rt: ContainerRuntime | undefined, path: string, text: string, mode: 'touch' | 'write' | 'append', tool: string): string | null {
  const spot = spotOf(pod, ctr, path);
  if (spot.where === 'readonly') return tool === 'touch' ? `touch: ${path}: Read-only file system` : `sh: can't create ${path}: Read-only file system`;
  let files: Record<string, string>;
  let rel = path;
  if (spot.where === 'volume') {
    if (!spot.rel) return tool === 'touch' ? null : `sh: can't create ${path}: Is a directory`;
    files = store(c, spot.key);
    rel = spot.rel;
  } else {
    if (!rt) return `sh: can't create ${path}: No such file or directory`;
    rt.written = rt.written ?? {};
    files = rt.written;
  }
  if (mode === 'touch') files[rel] = files[rel] ?? '';
  else if (mode === 'write') files[rel] = text;
  else files[rel] = (files[rel] ?? '') + text;
  return null;
}

/** A written file's content, or undefined. */
export function readFile(c: Cluster, pod: KObject, ctr: any, rt: ContainerRuntime | undefined, path: string): string | undefined {
  const spot = spotOf(pod, ctr, path);
  if (spot.where === 'volume') return c.volumeData?.[spot.key]?.[spot.rel];
  if (spot.where === 'container') return rt?.written?.[path];
  return undefined;
}

/** Names directly inside `dir` from written data, plus whether `dir` is a mount point. */
export function listDir(c: Cluster, pod: KObject, ctr: any, rt: ContainerRuntime | undefined, dir: string): { names: string[]; mounted: boolean } {
  const names = new Set<string>();
  const spot = spotOf(pod, ctr, dir);
  const mounted = (ctr?.volumeMounts ?? []).some((m: any) => String(m.mountPath).replace(/\/$/, '') === dir);
  const add = (files: Record<string, string> | undefined, base: string) => {
    for (const f of Object.keys(files ?? {})) {
      const full = base ? `${base}/${f}` : f;
      if (full.startsWith(`${dir}/`)) names.add(full.slice(dir.length + 1).split('/')[0]!);
    }
  };
  if (spot.where === 'volume') add(c.volumeData?.[spot.key], spot.mount);
  add(rt?.written, '');
  return { names: [...names], mounted };
}

/** Forget data whose owner is gone: a pod's emptyDirs, or a deleted claim's volume. */
export function forgetVolumes(c: Cluster, obj: KObject): void {
  if (!c.volumeData) return;
  if (obj.kind === 'Pod') for (const k of Object.keys(c.volumeData)) if (k.startsWith(`emptyDir/${obj.metadata.uid}/`)) delete c.volumeData[k];
  if (obj.kind === 'PersistentVolumeClaim') delete c.volumeData[`pvc/${obj.metadata.namespace}/${obj.metadata.name}`];
}
