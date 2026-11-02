// Image references: "nginx" → docker.io/library/nginx:latest, like the distribution/reference package.

export interface ImageRef {
  domain: string;
  /** Path inside the registry, e.g. "library/nginx" or "you/diary". */
  path: string;
  tag: string;
  digest: string | null;
  /** Did the learner type a tag? (`docker pull nginx` prints "Using default tag: latest"). */
  tagged: boolean;
}

export type RefResult = { ok: true; ref: ImageRef } | { ok: false; error: string };

export function parseRef(input: string): RefResult {
  let rest = input.trim();
  if (!rest || /\s/.test(rest)) return { ok: false, error: 'invalid reference format' };
  let digest: string | null = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) return { ok: false, error: 'invalid reference format' };
  }
  let tag = '';
  const lastSlash = rest.lastIndexOf('/');
  const colon = rest.lastIndexOf(':');
  if (colon > lastSlash) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
    if (!/^[\w][\w.-]{0,127}$/.test(tag)) return { ok: false, error: 'invalid reference format' };
  }
  const parts = rest.split('/');
  let domain = 'docker.io';
  if (parts.length > 1 && (parts[0]!.includes('.') || parts[0]!.includes(':') || parts[0] === 'localhost')) {
    domain = parts.shift()!;
  }
  if (domain === 'index.docker.io') domain = 'docker.io';
  let path = parts.join('/');
  if (domain === 'docker.io' && !path.includes('/')) path = `library/${path}`;
  if (/[A-Z]/.test(path)) return { ok: false, error: `invalid reference format: repository name (${path}) must be lowercase` };
  if (!/^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/.test(path)) {
    return { ok: false, error: 'invalid reference format' };
  }
  return { ok: true, ref: { domain, path, tag: tag || 'latest', digest, tagged: Boolean(tag) || Boolean(digest) } };
}

/** "docker.io/library/nginx:1.30-alpine" */
export function fullName(r: ImageRef): string {
  return `${r.domain}/${r.path}:${r.tag}`;
}

/** "docker.io/library/nginx" */
export function repoFull(r: ImageRef): string {
  return `${r.domain}/${r.path}`;
}

/** The short name Docker prints: "nginx", "you/diary", "ghcr.io/you/diary". */
export function familiarRepo(r: ImageRef): string {
  if (r.domain === 'docker.io') return r.path.startsWith('library/') ? r.path.slice(8) : r.path;
  return `${r.domain}/${r.path}`;
}

/** "nginx:1.30-alpine" */
export function familiar(r: ImageRef): string {
  return `${familiarRepo(r)}:${r.tag}`;
}

/** Turn a stored full ref back into the short form. */
export function familiarOf(full: string): string {
  const p = parseRef(full);
  return p.ok ? familiar(p.ref) : full;
}

/** The catalog key ("nginx:1.30-alpine") for an official Docker Hub image, if it is one. */
export function catalogKey(r: ImageRef): string | null {
  if (r.domain !== 'docker.io' || !r.path.startsWith('library/')) return null;
  return `${r.path.slice(8)}:${r.tag}`;
}
