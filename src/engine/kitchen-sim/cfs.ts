// A container's view of files: tmpfs, then mounts (volumes and bind mounts), then the
// container's own writable layer, then the image. Writes go to the mount or the writable layer.
import { basename, dirname, isInside, normalize } from '../git-sim/paths';
import { ensureDir, writeFile as hostWrite } from './state';
import type { Container, KitchenState, LocalImage, Mount, Volume } from './types';

export function imageOf(state: KitchenState, c: Container): LocalImage | null {
  return state.images[c.imageId] ?? null;
}

/** The mount that holds `path` (longest target wins). */
export function mountFor(c: Container, path: string): { mount: Mount; rel: string } | null {
  let best: Mount | null = null;
  for (const m of c.mounts) {
    if (isInside(path, m.target) && (!best || m.target.length > best.target.length)) best = m;
  }
  if (!best) return null;
  const rel = path === best.target ? '' : path.slice(best.target === '/' ? 1 : best.target.length + 1);
  return { mount: best, rel };
}

function volFiles(v: Volume, rel: string): string | undefined {
  return v.files[rel];
}

type Entry = { name: string; isDir: boolean };

/** Read a file inside the container. null = missing, 'dir' = a folder. */
export function readC(state: KitchenState, c: Container, path: string): string | null | 'dir' {
  const p = normalize(path) || '/';
  if (isDirC(state, c, p)) return 'dir';
  const m = mountFor(c, p);
  if (m) {
    if (m.mount.type === 'tmpfs') return c.tmp[p] ?? null;
    if (m.mount.type === 'volume') {
      const v = state.volumes[m.mount.source];
      return v ? (volFiles(v, m.rel) ?? null) : null;
    }
    return state.fs.files[m.mount.source + (m.rel ? `/${m.rel}` : '')] ?? null;
  }
  if (Object.hasOwn(c.files, p)) return c.files[p]!;
  if (c.deleted.includes(p)) return null;
  const img = imageOf(state, c);
  if (p === '/etc/hostname') return `${c.hostname}\n`;
  return img?.files[p] ?? null;
}

export function isDirC(state: KitchenState, c: Container, path: string): boolean {
  const p = normalize(path) || '/';
  if (p === '/') return true;
  if (c.mounts.some((m) => m.target === p || isInside(m.target, p))) return true;
  const m = mountFor(c, p);
  if (m) {
    if (m.mount.type === 'tmpfs') return Object.keys(c.tmp).some((f) => isInside(f, p) && f !== p);
    if (m.mount.type === 'volume') {
      const v = state.volumes[m.mount.source];
      if (!v) return false;
      return v.dirs.includes(m.rel) || Object.keys(v.files).some((f) => f.startsWith(`${m.rel}/`));
    }
    const hp = m.mount.source + (m.rel ? `/${m.rel}` : '');
    return state.fs.dirs.includes(hp);
  }
  if (c.dirs.includes(p) || Object.keys(c.files).some((f) => f.startsWith(`${p}/`))) return true;
  if (c.deleted.includes(p)) return false;
  const img = imageOf(state, c);
  if (!img) return false;
  return img.dirs.includes(p) || img.dirs.some((d) => d.startsWith(`${p}/`)) || Object.keys(img.files).some((f) => f.startsWith(`${p}/`));
}

/** List a folder inside the container (sorted), or null if it is not a folder. */
export function listC(state: KitchenState, c: Container, path: string): Entry[] | null {
  const p = normalize(path) || '/';
  if (!isDirC(state, c, p)) return null;
  const seen = new Map<string, boolean>();
  const addChild = (abs: string, isDir: boolean) => {
    if (!isInside(abs, p) || abs === p) return;
    const rel = p === '/' ? abs.slice(1) : abs.slice(p.length + 1);
    const first = rel.split('/')[0]!;
    const deeper = rel.includes('/');
    seen.set(first, (seen.get(first) ?? false) || deeper || isDir);
  };
  const m = mountFor(c, p);
  if (m && m.mount.type !== 'tmpfs') {
    if (m.mount.type === 'volume') {
      const v = state.volumes[m.mount.source];
      const base = m.mount.target;
      for (const f of Object.keys(v?.files ?? {})) addChild(`${base}/${f}`, false);
      for (const d of v?.dirs ?? []) if (d) addChild(`${base}/${d}`, true);
    } else {
      for (const f of Object.keys(state.fs.files)) {
        if (isInside(f, m.mount.source)) addChild(m.mount.target + f.slice(m.mount.source.length), false);
      }
      for (const d of state.fs.dirs) {
        if (isInside(d, m.mount.source) && d !== m.mount.source) addChild(m.mount.target + d.slice(m.mount.source.length), true);
      }
    }
  } else if (m && m.mount.type === 'tmpfs') {
    for (const f of Object.keys(c.tmp)) addChild(f, false);
  } else {
    const img = imageOf(state, c);
    for (const f of Object.keys(img?.files ?? {})) if (!c.deleted.includes(f)) addChild(f, false);
    for (const d of img?.dirs ?? []) if (!c.deleted.includes(d)) addChild(d, true);
    for (const f of Object.keys(c.files)) addChild(f, false);
    for (const d of c.dirs) addChild(d, true);
  }
  // Mount points inside this folder.
  for (const mm of c.mounts) if (mm.target !== p) addChild(mm.target, true);
  return [...seen.entries()].map(([name, isDir]) => ({ name, isDir })).sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** uid of a user name or number inside the container's image. */
export function uidOf(state: KitchenState, c: Container, user: string): number | null {
  if (!user || user === 'root') return 0;
  const name = user.split(':')[0]!;
  if (/^\d+$/.test(name)) return Number(name);
  const img = imageOf(state, c);
  const u = img?.users[name];
  return u ? u[0] : null;
}

export function ownerOf(state: KitchenState, c: Container, path: string): number {
  const img = imageOf(state, c);
  let p = path;
  for (;;) {
    if (c.owners[p] !== undefined) return c.owners[p]!;
    if (img?.owners?.[p] !== undefined) return img.owners[p]!;
    if (p === '/') return 0;
    p = dirname(p);
  }
}

/** Write a file as `uid`. Returns an error word (like the shell would print) or null. */
export function writeC(state: KitchenState, c: Container, path: string, content: string, uid: number): string | null {
  const p = normalize(path) || '/';
  const dir = dirname(p);
  if (!isDirC(state, c, dir)) return 'No such file or directory';
  if (isDirC(state, c, p)) return 'Is a directory';
  const m = mountFor(c, p);
  if (m) {
    if (m.mount.readOnly) return 'Read-only file system';
    if (m.mount.type === 'tmpfs') {
      c.tmp[p] = content;
      return null;
    }
    if (m.mount.type === 'volume') {
      const v = state.volumes[m.mount.source];
      if (!v) return 'No such file or directory';
      if (uid !== 0 && uid !== v.owner) return 'Permission denied';
      v.files[m.rel] = content;
      return null;
    }
    if (uid !== 0 && uid !== 1000) return 'Permission denied';
    hostWrite(state, m.mount.source + (m.rel ? `/${m.rel}` : ''), content);
    return null;
  }
  if (c.readOnly) return 'Read-only file system';
  if (uid !== 0 && !isInside(dir, '/tmp')) {
    const owner = ownerOf(state, c, readC(state, c, p) !== null ? p : dir);
    if (owner !== uid) return 'Permission denied';
  }
  c.files[p] = content;
  c.deleted = c.deleted.filter((d) => d !== p);
  if (uid !== 0) c.owners[p] = uid;
  return null;
}

/** Write a file, making missing parent folders first (initdb, npm install, docker cp). */
export function writeDeep(state: KitchenState, c: Container, path: string, content: string, uid: number): string | null {
  const dir = dirname(normalize(path));
  if (!isDirC(state, c, dir)) {
    const err = mkdirC(state, c, dir, uid, true);
    if (err) return err;
  }
  return writeC(state, c, path, content, uid);
}

/** Make a folder (with parents when `parents`). */
export function mkdirC(state: KitchenState, c: Container, path: string, uid: number, parents: boolean): string | null {
  const p = normalize(path) || '/';
  if (isDirC(state, c, p)) return parents ? null : 'File exists';
  if (!isDirC(state, c, dirname(p))) {
    if (!parents) return 'No such file or directory';
    const err = mkdirC(state, c, dirname(p), uid, true);
    if (err) return err;
  }
  const m = mountFor(c, p);
  if (m) {
    if (m.mount.readOnly) return 'Read-only file system';
    if (m.mount.type === 'volume') {
      const v = state.volumes[m.mount.source];
      if (!v) return 'No such file or directory';
      if (uid !== 0 && uid !== v.owner) return 'Permission denied';
      v.dirs.push(m.rel);
      return null;
    }
    if (m.mount.type === 'bind') {
      ensureDir(state, m.mount.source + (m.rel ? `/${m.rel}` : ''));
      return null;
    }
    return null;
  }
  if (c.readOnly) return 'Read-only file system';
  if (uid !== 0 && ownerOf(state, c, dirname(p)) !== uid && !isInside(p, '/tmp')) return 'Permission denied';
  c.dirs.push(p);
  if (uid !== 0) c.owners[p] = uid;
  return null;
}

/** Remove a file. */
export function rmC(state: KitchenState, c: Container, path: string, uid: number): string | null {
  const p = normalize(path);
  const cur = readC(state, c, p);
  if (cur === null) return 'No such file or directory';
  const m = mountFor(c, p);
  if (m) {
    if (m.mount.readOnly) return 'Read-only file system';
    if (m.mount.type === 'volume') {
      const v = state.volumes[m.mount.source]!;
      if (uid !== 0 && uid !== v.owner) return 'Permission denied';
      delete v.files[m.rel];
      return null;
    }
    if (m.mount.type === 'tmpfs') {
      delete c.tmp[p];
      return null;
    }
    delete state.fs.files[m.mount.source + (m.rel ? `/${m.rel}` : '')];
    return null;
  }
  if (c.readOnly) return 'Read-only file system';
  delete c.files[p];
  if (!c.deleted.includes(p)) c.deleted.push(p);
  return null;
}

/** Every file under a container folder (absolute paths → content). */
export function walkC(state: KitchenState, c: Container, path: string): Record<string, string> {
  const outFiles: Record<string, string> = {};
  const visit = (dir: string) => {
    for (const e of listC(state, c, dir) ?? []) {
      const abs = dir === '/' ? `/${e.name}` : `${dir}/${e.name}`;
      if (e.isDir) visit(abs);
      else {
        const v = readC(state, c, abs);
        if (typeof v === 'string') outFiles[abs] = v;
      }
    }
  };
  if (isDirC(state, c, path)) visit(normalize(path) || '/');
  else {
    const v = readC(state, c, path);
    if (typeof v === 'string') outFiles[normalize(path)] = v;
  }
  return outFiles;
}

export { basename, dirname };
