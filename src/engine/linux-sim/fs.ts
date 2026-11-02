// The file system: paths, symlinks, permission checks, users and groups.
import type { FsNode, Group, LinuxState, User } from './types';

export type Errno = 'ENOENT' | 'ENOTDIR' | 'EACCES' | 'EISDIR' | 'EEXIST' | 'ENOTEMPTY' | 'EPERM' | 'ELOOP' | 'EINVAL' | 'EBUSY';

export const ERRNO_TEXT: Record<Errno, string> = {
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EACCES: 'Permission denied',
  EISDIR: 'Is a directory',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  EPERM: 'Operation not permitted',
  ELOOP: 'Too many levels of symbolic links',
  EINVAL: 'Invalid argument',
  EBUSY: 'Device or resource busy',
};

// ---------------------------------------------------------------------------
// Paths

/** Collapse `//`, `.` and `..` (lexically). */
export function normPath(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

export function parentOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function baseName(p: string): string {
  if (p === '/') return '/';
  const t = p.replace(/\/+$/, '');
  return t.slice(t.lastIndexOf('/') + 1);
}

/**
 * Paths that came from a relative name, with the folder they started in. The kernel resolves a
 * relative path from the current folder, so it never checks the folders above it (a 755 folder
 * inside a 700 home is still reachable by its relative name). Cleared before every typed command.
 */
const relativeFrom = new Map<string, string>();

export function resetRelative() {
  relativeFrom.clear();
}

/** An absolute path for what the learner typed (relative to cwd; `~` is expanded earlier by the shell). */
export function absPath(cwd: string, p: string): string {
  if (p.startsWith('/')) return normPath(p);
  const out = normPath(`${cwd}/${p}`);
  if (out === cwd || out.startsWith(`${cwd === '/' ? '' : cwd}/`)) relativeFrom.set(out, cwd);
  return out;
}

// ---------------------------------------------------------------------------
// Users and groups

export function userByName(st: LinuxState, name: string): User | undefined {
  return st.users.find((u) => u.name === name);
}

export function userByUid(st: LinuxState, uid: number): User | undefined {
  return st.users.find((u) => u.uid === uid);
}

export function groupByName(st: LinuxState, name: string): Group | undefined {
  return st.groups.find((g) => g.name === name);
}

export function groupByGid(st: LinuxState, gid: number): Group | undefined {
  return st.groups.find((g) => g.gid === gid);
}

export function uidName(st: LinuxState, uid: number): string {
  return userByUid(st, uid)?.name ?? String(uid);
}

export function gidName(st: LinuxState, gid: number): string {
  return groupByGid(st, gid)?.name ?? String(gid);
}

/** gids of a user: the primary group first, then the others in /etc/group order. */
export function gidsOf(st: LinuxState, user: string): number[] {
  const u = userByName(st, user);
  if (!u) return [];
  const out = [u.gid];
  for (const g of st.groups) if (g.members.includes(user) && !out.includes(g.gid)) out.push(g.gid);
  return out;
}

// ---------------------------------------------------------------------------
// Permissions

export type Access = 'r' | 'w' | 'x';

export function can(st: LinuxState, user: string, node: FsNode, what: Access): boolean {
  const u = userByName(st, user);
  if (!u) return false;
  if (u.uid === 0) {
    if (what !== 'x') return true;
    return node.type === 'dir' || (node.mode & 0o111) !== 0;
  }
  const bit = what === 'r' ? 4 : what === 'w' ? 2 : 1;
  if (node.uid === u.uid) return ((node.mode >> 6) & bit) !== 0;
  if (gidsOf(st, user).includes(node.gid)) return ((node.mode >> 3) & bit) !== 0;
  return (node.mode & bit) !== 0;
}

export function isRoot(st: LinuxState, user: string): boolean {
  return userByName(st, user)?.uid === 0;
}

// ---------------------------------------------------------------------------
// Lookup

export type Found = { ok: true; path: string; node: FsNode } | { ok: false; err: Errno };

/**
 * Find a path like the kernel does: every folder on the way must exist, be a folder and be
 * searchable (x) by `user`; symlinks on the way are followed, the last one only when `follow`.
 */
export function lookup(st: LinuxState, user: string, path: string, follow = true, depth = 0): Found {
  if (depth > 20) return { ok: false, err: 'ELOOP' };
  const parts = normPath(path).split('/').filter(Boolean);
  const from = depth === 0 ? relativeFrom.get(normPath(path)) : undefined;
  let cur = '/';
  for (let i = 0; i < parts.length; i++) {
    const dir = st.fs[cur];
    if (!dir) return { ok: false, err: 'ENOENT' };
    if (dir.type !== 'dir') return { ok: false, err: 'ENOTDIR' };
    // Folders above the starting folder of a relative name are not searched.
    const above = from !== undefined && cur !== from && (cur === '/' || from.startsWith(`${cur}/`));
    if (!above && !can(st, user, dir, 'x')) return { ok: false, err: 'EACCES' };
    const next = joinPath(cur, parts[i]!);
    const node = st.fs[next];
    if (!node) return { ok: false, err: 'ENOENT' };
    const last = i === parts.length - 1;
    if (node.type === 'link' && (!last || follow)) {
      const target = node.target!.startsWith('/') ? node.target! : `${cur}/${node.target}`;
      const rest = parts.slice(i + 1).join('/');
      return lookup(st, user, rest ? `${target}/${rest}` : target, follow, depth + 1);
    }
    cur = next;
  }
  // A trailing slash on a file ("a.txt/") is ENOTDIR; callers pass clean paths.
  return { ok: true, path: cur, node: st.fs[cur]! };
}

/** The real folder a new entry `path` would go in, checked for search (x) on the way. */
export function lookupParent(st: LinuxState, user: string, path: string): { ok: true; dir: string; name: string; node: FsNode } | { ok: false; err: Errno } {
  const p = normPath(path);
  const found = lookup(st, user, parentOf(p));
  if (!found.ok) return found;
  if (found.node.type !== 'dir') return { ok: false, err: 'ENOTDIR' };
  return { ok: true, dir: found.path, name: baseName(p), node: found.node };
}

/** Names directly inside a folder, sorted by byte order. */
export function childNames(st: LinuxState, dir: string): string[] {
  const prefix = dir === '/' ? '/' : `${dir}/`;
  const out: string[] = [];
  for (const k of Object.keys(st.fs)) {
    if (k.length > prefix.length && k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) out.push(k.slice(prefix.length));
  }
  return out.sort();
}

/** Every path under a folder (deepest first is handy for removal). */
export function descendants(st: LinuxState, dir: string): string[] {
  const prefix = dir === '/' ? '/' : `${dir}/`;
  return Object.keys(st.fs).filter((k) => k.startsWith(prefix) && k !== dir);
}

export function fileSize(node: FsNode): number {
  if (node.type === 'dir') return 4096;
  if (node.type === 'link') return node.target!.length;
  return node.size ?? new TextEncoder().encode(node.content ?? '').length;
}

/** Blocks of 1 KiB used (`ls -s`, `total`, `du`): 4 KiB file system blocks. */
export function blocksOf(node: FsNode): number {
  if (node.type === 'link') return 0;
  const size = fileSize(node);
  return Math.ceil(size / 4096) * 4;
}

/** `drwxr-xr-x`, `-rwsr-xr-x`, `drwxrwxrwt`. */
export function modeString(node: FsNode): string {
  const t = node.type === 'dir' ? 'd' : node.type === 'link' ? 'l' : '-';
  const m = node.mode;
  const trip = (shift: number, special: boolean, ch: string) => {
    const r = m & (4 << shift) ? 'r' : '-';
    const w = m & (2 << shift) ? 'w' : '-';
    const xOn = (m & (1 << shift)) !== 0;
    const x = special ? (xOn ? ch : ch.toUpperCase()) : xOn ? 'x' : '-';
    return r + w + x;
  };
  return t + trip(6, (m & 0o4000) !== 0, 's') + trip(3, (m & 0o2000) !== 0, 's') + trip(0, (m & 0o1000) !== 0, 't');
}

/** Links count as `ls -l` shows it: folders 2 + their subfolders, others 1. */
export function linkCount(st: LinuxState, path: string, node: FsNode): number {
  if (node.type !== 'dir') return 1;
  return 2 + childNames(st, path).filter((n) => st.fs[joinPath(path, n)]?.type === 'dir').length;
}

export function octal(mode: number, width = 4): string {
  return (mode & 0o7777).toString(8).padStart(width, '0');
}
