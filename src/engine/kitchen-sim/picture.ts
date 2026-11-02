// The state picture: what exists right now, as plain data for the UI (rule 16: show the state).
import { sizesOf } from './images';
import { familiarOf } from './refs';
import { imageNames } from './state';
import type { KitchenState } from './types';

export type BoxState = 'running' | 'paused' | 'created' | 'exited' | 'failed' | 'restarting';

export interface PictureContainer {
  id: string;
  name: string;
  image: string;
  state: BoxState;
  exitCode: number;
  health: 'starting' | 'healthy' | 'unhealthy' | null;
  /** host:container port pairs ("8080→80"). */
  ports: { host: number; container: number }[];
  networks: string[];
  volumes: { name: string; target: string; anonymous: boolean; bind: boolean }[];
  project: string | null;
  user: string;
}

export interface PictureImage {
  ref: string;
  id: string;
  layers: number;
  size: string;
  /** Only in the registry (not pulled yet). */
  remote: boolean;
  used: boolean;
}

export interface Picture {
  laptop: { cwd: string; ports: { host: number; container: string; containerPort: number }[] };
  containers: PictureContainer[];
  images: PictureImage[];
  volumes: { name: string; files: number; anonymous: boolean; usedBy: string[] }[];
  networks: { name: string; containers: string[]; builtin: boolean }[];
  registry: { ref: string }[];
  loggedIn: string | null;
}

export function kitchenPicture(state: KitchenState): Picture {
  const containers = Object.values(state.containers).sort((a, b) => a.created - b.created || (a.name < b.name ? -1 : 1));
  const up = (s: string) => s === 'running' || s === 'paused';
  const pc: PictureContainer[] = containers.map((c) => ({
    id: c.id.slice(0, 12),
    name: c.name,
    image: c.image,
    state: c.status === 'exited' && c.exitCode !== 0 ? 'failed' : c.status === 'dead' ? 'failed' : c.status,
    exitCode: c.exitCode,
    health: c.health?.status ?? null,
    ports: up(c.status) ? c.ports.map((p) => ({ host: p.hostPort, container: p.containerPort })) : [],
    networks: Object.keys(c.networks),
    volumes: c.mounts.filter((m) => m.type !== 'tmpfs').map((m) => ({ name: m.type === 'bind' ? m.source : m.source, target: m.target, anonymous: Boolean(m.anonymous), bind: m.type === 'bind' })),
    project: c.labels['com.docker.compose.project'] ?? null,
    user: c.user || state.images[c.imageId]?.config.User || 'root',
  }));
  const images: PictureImage[] = [];
  for (const img of Object.values(state.images)) {
    const names = imageNames(img);
    const used = containers.some((c) => c.imageId === img.id);
    for (const n of names.length ? names : ['<untagged>']) images.push({ ref: n, id: img.id.slice(0, 12), layers: img.layers.length, size: sizesOf(img).disk, remote: false, used });
  }
  images.sort((a, b) => (a.ref < b.ref ? -1 : 1));
  const registry: { ref: string }[] = [];
  for (const [repo, r] of Object.entries(state.registry.repos)) for (const tag of Object.keys(r.tags)) registry.push({ ref: familiarOf(`${repo}:${tag}`) });
  return {
    laptop: {
      cwd: state.cwd,
      ports: containers.filter((c) => up(c.status)).flatMap((c) => c.ports.map((p) => ({ host: p.hostPort, container: c.name, containerPort: p.containerPort }))),
    },
    containers: pc,
    images,
    volumes: Object.values(state.volumes).map((v) => ({
      name: v.name,
      files: Object.keys(v.files).length,
      anonymous: v.anonymous,
      usedBy: containers.filter((c) => c.mounts.some((m) => m.source === v.name)).map((c) => c.name),
    })),
    networks: Object.values(state.networks)
      .filter((n) => n.name !== 'host' && n.name !== 'none')
      .map((n) => ({ name: n.name, builtin: n.builtin, containers: containers.filter((c) => up(c.status) && n.name in c.networks).map((c) => c.name) })),
    registry,
    loggedIn: state.registry.auth['docker.io'] ?? null,
  };
}
