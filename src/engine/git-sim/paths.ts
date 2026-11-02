// POSIX-style path helpers for the fake filesystem.

export function normalize(path: string): string {
  const abs = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return (abs ? '/' : '') + parts.join('/');
}

/** Resolve `input` against `cwd`. Supports `~`, absolute and relative paths. */
export function resolve(cwd: string, input: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/')) return normalize(`${home}/${input.slice(2)}`);
  if (input.startsWith('/')) return normalize(input) || '/';
  return normalize(`${cwd}/${input}`) || '/';
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  if (i <= 0) return '/';
  return path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** True when `path` is `dir` itself or inside it. */
export function isInside(path: string, dir: string): boolean {
  if (dir === '/') return true;
  return path === dir || path.startsWith(`${dir}/`);
}

/** Path of `abs` relative to `dir` (no leading slash). */
export function relative(abs: string, dir: string): string {
  if (abs === dir) return '';
  if (dir === '/') return abs.slice(1);
  return abs.slice(dir.length + 1);
}

/** Show a path the way a shell prompt would (`~` for home). */
export function prettyPath(path: string, home: string): string {
  if (path === home) return '~';
  if (isInside(path, home)) return `~/${relative(path, home)}`;
  return path;
}

/** Path of a repo file as shown to someone standing in `cwd`. */
export function displayPath(repoRel: string, repoRoot: string, cwd: string): string {
  // Folders keep their trailing slash; the current folder shows as "./".
  if (repoRel.endsWith('/')) {
    const shown = displayPath(repoRel.slice(0, -1), repoRoot, cwd);
    return shown === '' ? './' : `${shown}/`;
  }
  const abs = `${repoRoot}/${repoRel}`;
  if (isInside(abs, cwd)) return relative(abs, cwd);
  // Walk up from cwd until we reach a common ancestor.
  let up = '';
  let dir = cwd;
  while (!isInside(abs, dir)) {
    up += '../';
    dir = dirname(dir);
  }
  return up + relative(abs, dir);
}
