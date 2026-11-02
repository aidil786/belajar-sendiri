// Images: pull, the image list, tag, rmi, history, push, login/logout.
import { catalogEntry, catalogRefs, imageFromCatalog, stockedTags } from './catalog';
import { ago, ellipsis, goTime, humanSize, table } from './format';
import { catalogKey, familiar, familiarRepo, fullName, parseRef, repoFull, type ImageRef } from './refs';
import { findImage, imageNames } from './state';
import type { KitchenEvent, KitchenState, LocalImage } from './types';

export interface PullResult {
  ok: boolean;
  lines: string[];
  events: KitchenEvent[];
  img?: LocalImage;
  /** Error text after "Error response from daemon: ". */
  error?: string;
  /** The freezer doesn't stock this official image (a kind note, not a Docker error). */
  notStocked?: { repo: string; tags: string[] };
  ref?: ImageRef;
}

/** Popular Docker Official Images that exist on Docker Hub but aren't in the practice freezer. */
const OFFICIAL = new Set([
  'ubuntu', 'debian', 'fedora', 'centos', 'rockylinux', 'almalinux', 'amazonlinux', 'archlinux', 'oraclelinux', 'mysql', 'mariadb',
  'mongo', 'httpd', 'caddy', 'traefik', 'haproxy', 'golang', 'rust', 'php', 'ruby', 'perl', 'openjdk', 'eclipse-temurin', 'gradle',
  'maven', 'gcc', 'bash', 'rabbitmq', 'memcached', 'wordpress', 'ghost', 'drupal', 'nextcloud', 'registry', 'elasticsearch', 'kibana',
  'logstash', 'influxdb', 'telegraf', 'cassandra', 'couchdb', 'neo4j', 'sonarqube', 'jenkins', 'tomcat', 'jetty', 'swift', 'dart',
  'elixir', 'erlang', 'julia', 'haskell', 'clojure', 'groovy', 'pypy', 'bun', 'deno', 'docker', 'vault', 'consul', 'mongo-express',
  'adminer', 'phpmyadmin', 'solr', 'zookeeper', 'nats', 'eclipse-mosquitto', 'odoo', 'joomla', 'matomo', 'postfixadmin', 'irssi',
]);

export function rateLimitError(r: ImageRef): string {
  return `unknown: failed to resolve reference "${fullName(r)}": unexpected status from HEAD request to https://registry-1.docker.io/v2/${r.path}/manifests/${r.tag}: 429 Too Many Requests`;
}

/** Find what the registry has for a reference. */
function remoteImage(state: KitchenState, r: ImageRef): LocalImage | null {
  if (r.digest) return remoteByDigest(state, r);
  const key = catalogKey(r);
  if (key && catalogEntry(key)) return imageFromCatalog(key);
  const repo = state.registry.repos[repoFull(r)];
  if (!repo) return null;
  if (repo.private && state.registry.auth[r.domain] !== repo.owner) return null;
  const img = repo.tags[r.tag];
  return img ? structuredClone({ ...img, source: 'pull' as const }) : null;
}

/**
 * A reference with @sha256:… : the digest wins and the tag is ignored, like real Docker.
 * The image with that digest (any tag of the repo), or nothing: a wrong digest is "not found".
 */
function remoteByDigest(state: KitchenState, r: ImageRef): LocalImage | null {
  const want = r.digest!.slice('sha256:'.length);
  const key = catalogKey(r);
  if (key) {
    const repo = key.split(':')[0]!;
    // The typed tag first, so `nginx:1.30-alpine@sha256:…` keeps its name.
    const tags = [r.tag, ...stockedTags(repo).filter((t) => t !== r.tag)];
    for (const t of tags) if (catalogEntry(`${repo}:${t}`)?.id === want) return { ...imageFromCatalog(`${repo}:${t}`), repoTags: [`docker.io/library/${repo}:${t}`] };
    return null;
  }
  const repo = state.registry.repos[repoFull(r)];
  if (!repo || (repo.private && state.registry.auth[r.domain] !== repo.owner)) return null;
  const img = repo.tags[r.tag]?.id === want ? repo.tags[r.tag] : Object.values(repo.tags).find((i) => i.id === want);
  return img ? structuredClone({ ...img, source: 'pull' as const }) : null;
}

/** Give `ref` to image `img` (moving the tag away from any other image). */
export function setTag(state: KitchenState, full: string, img: LocalImage): void {
  const old = state.tags[full];
  if (old && old !== img.id && state.images[old]) {
    state.images[old]!.repoTags = state.images[old]!.repoTags.filter((t) => t !== full);
  }
  state.tags[full] = img.id;
  if (!img.repoTags.includes(full)) img.repoTags.push(full);
}

/** Pull an image into the local store. `forRun` leaves out the final full-name line. */
export function pullImage(state: KitchenState, text: string, opts: { forRun?: boolean; quiet?: boolean; platform?: string } = {}): PullResult {
  const p = parseRef(text);
  if (!p.ok) return { ok: false, lines: [], events: [], error: p.error };
  let r = p.ref;
  if (state.registry.rateLimited && r.domain === 'docker.io' && !state.registry.auth['docker.io']) {
    return { ok: false, lines: [], events: [{ type: 'error', code: 'rateLimited' }], error: rateLimitError(r), ref: r };
  }
  const remote = remoteImage(state, r);
  if (r.digest) {
    const key = catalogKey(r);
    const repoKnown = key ? stockedTags(key.split(':')[0]!).length > 0 : Boolean(state.registry.repos[repoFull(r)]);
    if (!remote && repoKnown) {
      // The repo exists, the digest doesn't (checked on Docker 29: the tag is dropped from the name).
      const name = `${repoFull(r)}@${r.digest}`;
      return { ok: false, lines: [], events: [{ type: 'error', code: 'manifestUnknown' }], error: `failed to resolve reference "${name}": ${name}: not found`, ref: r };
    }
    // The digest names one image: use the tag it carries.
    const named = remote?.repoTags[0] ? parseRef(remote.repoTags[0]) : null;
    if (named?.ok) r = { ...r, tag: named.ref.tag };
  }
  if (!remote) {
    const key = catalogKey(r);
    if (key) {
      const repo = key.split(':')[0]!;
      const tags = stockedTags(repo);
      if (tags.length) {
        return { ok: false, lines: [], events: [{ type: 'error', code: 'manifestUnknown' }], error: `failed to resolve reference "${fullName(r)}": ${fullName(r)}: not found`, ref: r };
      }
      // A real official image the practice freezer doesn't stock: say so kindly (it does exist).
      if (OFFICIAL.has(repo)) return { ok: false, lines: [], events: [], notStocked: { repo, tags: catalogRefs() }, ref: r };
      return { ok: false, lines: [], events: [{ type: 'error', code: 'pullDenied' }], error: `pull access denied for ${repo}, repository does not exist or may require 'docker login'`, ref: r };
    }
    if (r.domain === 'docker.io') {
      return { ok: false, lines: [], events: [{ type: 'error', code: 'pullDenied' }], error: `pull access denied for ${familiarRepo(r)}, repository does not exist or may require 'docker login'`, ref: r };
    }
    return { ok: false, lines: [], events: [{ type: 'error', code: 'manifestUnknown' }], error: `failed to resolve reference "${fullName(r)}": ${fullName(r)}: not found`, ref: r };
  }
  const lines: string[] = [];
  if (!r.tagged && !opts.quiet && !opts.forRun) lines.push('Using default tag: latest');
  const full = fullName(r);
  const have = state.images[remote.id];
  const platform = opts.platform ?? state.host.platform;
  const repoPath = r.domain === 'docker.io' ? r.path : r.path;
  if (have && state.tags[full] === remote.id && (have.platform === platform || opts.platform === undefined)) {
    if (!opts.quiet) {
      lines.push(`${r.tag}: Pulling from ${repoPath}`, `Digest: sha256:${remote.id}`, `Status: Image is up to date for ${familiar(r)}`);
    }
    if (!opts.forRun) lines.push(full);
    return { ok: true, lines, events: [], img: have, ref: r };
  }
  const knownBlobs = new Set(Object.values(state.images).flatMap((i) => i.blobs));
  if (!opts.quiet) {
    lines.push(`${r.tag}: Pulling from ${repoPath}`);
    for (const b of remote.blobs) lines.push(`${b.slice(0, 12)}: ${knownBlobs.has(b) ? 'Already exists' : 'Pull complete'}`);
    lines.push(`Digest: sha256:${remote.id}`, `Status: Downloaded newer image for ${familiar(r)}`);
  }
  if (!opts.forRun) lines.push(full);
  const cached = remote.blobs.filter((b) => knownBlobs.has(b)).length;
  const img = have ?? remote;
  img.platform = platform;
  img.repoTags = img.repoTags.filter((t) => t !== full);
  if (r.domain === 'docker.io' && r.path.startsWith('library/')) img.repoDigests = [`${familiarRepo(r)}@sha256:${img.id}`];
  else img.repoDigests = [`${familiarRepo(r)}@sha256:${img.id}`];
  state.images[img.id] = img;
  setTag(state, full, img);
  return { ok: true, lines, events: [{ type: 'imagePulled', ref: familiar(r), id: img.id, layers: remote.blobs.length, cached }], img, ref: r };
}

/** Is any container (running or not) made from this image? */
export function containersUsing(state: KitchenState, img: LocalImage) {
  return Object.values(state.containers).filter((c) => c.imageId === img.id);
}

export function sizesOf(img: LocalImage): { disk: string; content: string } {
  return { disk: img.diskText ?? humanSize(img.diskSize), content: img.contentText ?? humanSize(img.contentSize) };
}

/** `docker images` in Docker 29's default view. */
export function imageListLines(state: KitchenState, filter: { repo?: string; dangling?: boolean } = {}): string[] {
  const rows: { name: string; img: LocalImage }[] = [];
  for (const img of Object.values(state.images)) {
    const names = imageNames(img);
    if (!names.length) {
      if (filter.dangling !== false && !filter.repo) rows.push({ name: '<untagged>', img });
      continue;
    }
    if (filter.dangling) continue;
    for (const n of names) {
      if (filter.repo) {
        const want = parseRef(filter.repo);
        if (!want.ok) continue;
        const repoOnly = !filter.repo.includes(':');
        const got = parseRef(n);
        if (!got.ok) continue;
        if (repoOnly ? repoFull(got.ref) !== repoFull(want.ref) : fullName(got.ref) !== fullName(want.ref)) continue;
      }
      rows.push({ name: n, img });
    }
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const w = Math.max(5, ...rows.map((r) => [...r.name].length));
  const header = `${'IMAGE'.padEnd(w)}   ID             DISK USAGE   CONTENT SIZE   EXTRA`;
  const out = [header];
  for (const { name, img } of rows) {
    const s = sizesOf(img);
    const used = containersUsing(state, img).length > 0;
    out.push(`${name.padEnd(w)}   ${img.id.slice(0, 12)}   ${s.disk.padStart(10)}   ${s.content.padStart(12)}   ${used ? ' U   ' : '     '}`);
  }
  const legend = 'i Info →   U  In Use';
  return [legend.padStart(Math.max(header.length, 40)), ...out];
}

/** Rows for `--format` and the classic `--format table` view. */
export function imageRows(state: KitchenState): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const now = state.clock;
  const list = Object.values(state.images).sort((a, b) => b.created - a.created);
  for (const img of list) {
    const names = imageNames(img);
    const s = sizesOf(img);
    const base = {
      ID: img.id.slice(0, 12),
      CreatedSince: ago(now, img.created),
      CreatedAt: goTime(img.created),
      Size: s.disk,
      Containers: String(containersUsing(state, img).length),
      Digest: '<none>',
    };
    if (!names.length) rows.push({ ...base, Repository: '<none>', Tag: '<none>' });
    for (const n of names) {
      const i = n.lastIndexOf(':');
      rows.push({ ...base, Repository: n.slice(0, i), Tag: n.slice(i + 1) });
    }
  }
  return rows;
}

export function classicImageTable(state: KitchenState): string[] {
  const rows = imageRows(state);
  return table([['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE'], ...rows.map((r) => [r.Repository!, r.Tag!, r.ID!, r.CreatedSince!, r.Size!])]);
}

/** `docker history` rows. */
export function historyLines(state: KitchenState, img: LocalImage, noTrunc: boolean, quiet: boolean): string[] {
  const rows = img.history.map((h, i) => [
    i === 0 ? (noTrunc ? `sha256:${img.id}` : img.id.slice(0, 12)) : '<missing>',
    ago(state.clock, h.created),
    noTrunc ? h.createdBy : ellipsis(h.createdBy, 45),
    h.sizeText ?? humanSize(h.size),
    h.comment,
  ]);
  if (quiet) return rows.map((r) => r[0]!);
  return table([['IMAGE', 'CREATED', 'CREATED BY', 'SIZE', 'COMMENT'], ...rows]);
}

/** Remove one tag (and the image when it was the last one). */
export function removeImage(state: KitchenState, text: string, force: boolean): { ok: boolean; lines: string[]; error?: string; events: KitchenEvent[] } {
  const img = findImage(state, text);
  if (!img) {
    const p = parseRef(text);
    return { ok: false, lines: [], error: `No such image: ${p.ok && !/^[0-9a-f]{4,64}$/.test(text) ? familiar(p.ref) : text}`, events: [] };
  }
  const p = parseRef(text);
  const byId = /^(sha256:)?[0-9a-f]{4,64}$/.test(text) && img.id.startsWith(text.replace(/^sha256:/, ''));
  const users = containersUsing(state, img);
  const events: KitchenEvent[] = [];
  if (byId && img.repoTags.length > 1 && !force) {
    return { ok: false, lines: [], error: `conflict: unable to delete ${img.id.slice(0, 12)} (must be forced) - image is referenced in multiple repositories`, events };
  }
  const lastTag = byId || img.repoTags.length <= 1;
  if (lastTag && users.length && !force) {
    return { ok: false, lines: [], error: `conflict: unable to delete ${byId ? img.id.slice(0, 12) : familiar(p.ok ? p.ref : (parseRef(img.repoTags[0]!) as { ok: true; ref: ImageRef }).ref)} (must be forced) - container ${users[0]!.id.slice(0, 12)} is using its referenced image ${img.id.slice(0, 12)}`, events };
  }
  const lines: string[] = [];
  const untag = byId ? [...img.repoTags] : p.ok ? [fullName(p.ref)] : [];
  for (const t of untag) {
    lines.push(`Untagged: ${familiar((parseRef(t) as { ok: true; ref: ImageRef }).ref)}`);
    delete state.tags[t];
    img.repoTags = img.repoTags.filter((x) => x !== t);
    events.push({ type: 'imageRemoved', ref: familiar((parseRef(t) as { ok: true; ref: ImageRef }).ref), id: img.id, deleted: false });
  }
  if (!img.repoTags.length && !users.length) {
    lines.push(`Deleted: sha256:${img.id}`);
    delete state.images[img.id];
    events.push({ type: 'imageRemoved', ref: '', id: img.id, deleted: true });
  }
  return { ok: true, lines, events };
}
