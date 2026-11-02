// docker images / pull / push / tag / rmi / history / login / logout / inspect.
import { formatRows, needArgs, unknownFlag } from './containers';
import { parseFlags } from './flags';
import { ago, ellipsis, humanSize, iso } from './format';
import { classicImageTable, historyLines, imageListLines, imageRows, pullImage, removeImage, setTag } from './images';
import { containerJson, imageJson, jsonLines, networkJson, volumeJson } from './inspect';
import { familiar, familiarRepo, fullName, parseRef } from './refs';
import { fail, findContainer, findImage, line, networkByName, ok, out } from './state';
import { render, TemplateError } from './template';
import type { Ctx, KitchenEvent, KitchenResult, KitchenState, Line } from './types';

const IMAGE_HEADERS: Record<string, string> = {
  Repository: 'REPOSITORY',
  Tag: 'TAG',
  ID: 'IMAGE ID',
  CreatedSince: 'CREATED',
  CreatedAt: 'CREATED AT',
  Size: 'SIZE',
  Containers: 'CONTAINERS',
  Digest: 'DIGEST',
};

export const images = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['-a', '--all'], ['-q', '--quiet'], ['--no-trunc'], ['--digests'], ['--tree']], values: [['--format']], multi: [['-f', '--filter']] });
  if (f.unknown) return unknownFlag(state, 'images', f.unknown);
  const filters = f.multi.get('--filter') ?? [];
  const dangling = filters.includes('dangling=true') ? true : filters.includes('dangling=false') ? false : undefined;
  const repo = f.positional[0] ?? filters.find((x) => x.startsWith('reference='))?.slice(10);
  if (f.bools.has('--quiet')) {
    const ids = [...new Set(Object.values(state.images).filter((i) => (dangling ? !i.repoTags.length : true)).sort((a, b) => b.created - a.created).map((i) => i.id.slice(0, 12)))];
    return ok(state, ids.map((id) => line(id)), [], { key: 'sim.docker.explain.imagesQuiet' });
  }
  const fmt = f.values.get('--format');
  if (fmt === 'table') return ok(state, classicImageTable(state).map((l) => line(l)), [], { key: 'sim.docker.explain.images' });
  if (fmt) {
    try {
      return ok(state, formatRows(imageRows(state), fmt, IMAGE_HEADERS).map((l) => line(l)), [], { key: 'sim.docker.explain.images' });
    } catch (e) {
      return fail(state, out(e instanceof TemplateError ? e.message : String(e)), 'badTemplate');
    }
  }
  const lines = imageListLines(state, { repo, dangling });
  const count = lines.length - 2;
  const outLines: Line[] = [[{ t: lines[0]!, c: 'dim' }], ...lines.slice(1).map((l) => line(l))];
  return ok(state, outLines, [], { key: count ? 'sim.docker.explain.images' : 'sim.docker.explain.imagesEmpty', params: { n: String(count) } });
};

export const pull = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['-q', '--quiet'], ['-a', '--all-tags']], values: [['--platform']] });
  if (f.unknown) return unknownFlag(state, 'pull', f.unknown, 1);
  const ref = f.positional[0];
  if (!ref || f.positional.length > 1) return needArgs(state, 'pull', 'exactly 1 argument');
  const s = structuredClone(state);
  const r = pullImage(s, ref, { quiet: f.bools.has('--quiet'), platform: f.values.get('--platform') });
  if (r.notStocked) {
    return { ...fail(state, [], 'notStocked', { key: 'sim.docker.explain.notStocked', params: { repo: r.notStocked.repo, list: r.notStocked.tags.join(', ') } }), stopped: true };
  }
  if (!r.ok) {
    const code = state.registry.rateLimited && r.error?.includes('429') ? 'rateLimited' : r.error?.includes('pull access denied') ? 'pullDenied' : r.error?.startsWith('invalid reference') ? 'badRef' : 'manifestUnknown';
    return fail(state, out(code === 'badRef' ? r.error! : `Error response from daemon: ${r.error}`), code, { key: `sim.docker.err.${code}`, params: { ref } });
  }
  return ok(s, r.lines.map((l) => line(l)), r.events, { key: r.events.length ? 'sim.docker.explain.pull' : 'sim.docker.explain.pullUpToDate', params: { ref: familiar(r.ref!) } });
};

export const tag = (state: KitchenState, args: string[]): KitchenResult => {
  if (args.length !== 2) return needArgs(state, 'tag', 'exactly 2 arguments');
  const [src, dst] = args as [string, string];
  const img = findImage(state, src);
  if (!img) return fail(state, out(`Error response from daemon: No such image: ${src}`), 'noSuchImage', { key: 'sim.docker.err.noSuchImage', params: { ref: src } });
  const p = parseRef(dst);
  if (!p.ok) return fail(state, out(`Error parsing reference: "${dst}" is not a valid repository/tag: ${p.error}`), 'badRef', { key: 'sim.docker.err.badRef', params: { ref: dst } });
  const s = structuredClone(state);
  setTag(s, fullName(p.ref), s.images[img.id]!);
  return ok(s, [], [{ type: 'imageTagged', ref: familiar(p.ref), id: img.id }], { key: 'sim.docker.explain.tag', params: { src, dst: familiar(p.ref) } });
};

export const rmi = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['-f', '--force'], ['--no-prune']] });
  if (f.unknown) return unknownFlag(state, 'rmi', f.unknown, 1);
  if (!f.positional.length) return needArgs(state, 'rmi');
  const s = structuredClone(state);
  const lines: Line[] = [];
  const events: KitchenEvent[] = [];
  let error: string | null = null;
  for (const ref of f.positional) {
    const r = removeImage(s, ref, f.bools.has('--force'));
    lines.push(...r.lines.map((l) => line(l)));
    events.push(...r.events);
    if (!r.ok) {
      lines.push(...out(`Error response from daemon: ${r.error}`));
      error ??= r.error!;
    }
  }
  if (error) {
    const code = error.startsWith('No such image') ? 'noSuchImage' : 'imageInUse';
    const res = fail(s, lines, code, { key: `sim.docker.err.${code}`, params: { ref: f.positional.join(' ') } });
    res.events = [...events, ...res.events];
    return res;
  }
  return ok(s, lines, events, { key: 'sim.docker.explain.rmi', params: { ref: f.positional.join(', ') } });
};

export const history = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['--no-trunc'], ['-q', '--quiet'], ['-H', '--human']], values: [['--format']] });
  if (f.unknown) return unknownFlag(state, 'history', f.unknown, 1);
  const ref = f.positional[0];
  if (!ref) return needArgs(state, 'history', 'exactly 1 argument');
  const img = findImage(state, ref);
  if (!img) {
    const p = parseRef(ref);
    return fail(state, out(`Error response from daemon: No such image: ${p.ok ? familiar(p.ref) : ref}`), 'noSuchImage', { key: 'sim.docker.err.noSuchImage', params: { ref } });
  }
  const fmt = f.values.get('--format');
  if (fmt) {
    const noTrunc = f.bools.has('--no-trunc');
    const rows = img.history.map((h, i) => ({
      ID: i === 0 ? img.id.slice(0, 12) : '<missing>',
      CreatedSince: ago(state.clock, h.created),
      CreatedAt: iso(h.created).replace('Z', '+00:00'),
      CreatedBy: noTrunc ? h.createdBy : ellipsis(h.createdBy, 45),
      Size: h.sizeText ?? humanSize(h.size),
      Comment: h.comment,
    }));
    try {
      return ok(state, formatRows(rows, fmt, { ID: 'IMAGE', CreatedSince: 'CREATED', CreatedAt: 'CREATED AT', CreatedBy: 'CREATED BY', Size: 'SIZE', Comment: 'COMMENT' }).map((l) => line(l)), [], { key: 'sim.docker.explain.history', params: { ref, n: String(img.history.length) } });
    } catch (e) {
      return fail(state, out(e instanceof TemplateError ? e.message : String(e)), 'badTemplate');
    }
  }
  return ok(state, historyLines(state, img, f.bools.has('--no-trunc'), f.bools.has('--quiet')).map((l) => line(l)), [], { key: 'sim.docker.explain.history', params: { ref, n: String(img.history.length) } });
};

// ---------------------------------------------------------------------------
// Registry: login / logout / push

function registryHost(arg: string | undefined): string {
  if (!arg) return 'docker.io';
  return arg.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^index\.docker\.io$|^registry-1\.docker\.io$/, 'docker.io');
}

function credentialsOk(state: KitchenState, user: string, secret: string): boolean {
  const u = state.registry.users[user];
  return Boolean(u && (u.token === secret || (u.password !== undefined && u.password === secret)));
}

export function loginWith(state: KitchenState, host: string, user: string, secret: string, warn: boolean): KitchenResult {
  const lines: Line[] = warn ? [line('WARNING! Using --password via the CLI is insecure. Use --password-stdin.')] : [];
  if (!secret) return fail(state, [...lines, line('password is empty')], 'emptyPassword', { key: 'sim.docker.err.emptyPassword' });
  if (!credentialsOk(state, user, secret)) {
    const url = host === 'docker.io' ? 'https://registry-1.docker.io/v2/' : `https://${host}/v2/`;
    return fail(state, [...lines, line(`Error response from daemon: Get "${url}": unauthorized: incorrect username or password`)], 'badLogin', { key: 'sim.docker.err.badLogin', params: { user } });
  }
  const s = structuredClone(state);
  s.registry.auth[host] = user;
  const usedPassword = s.registry.users[user]!.password === secret && s.registry.users[user]!.token !== secret;
  return ok(s, [...lines, line('Login Succeeded')], [{ type: 'loggedIn', registry: host, user }], { key: usedPassword ? 'sim.docker.explain.loginPassword' : 'sim.docker.explain.login', params: { user, registry: host } });
}

export const login = (state: KitchenState, args: string[], ctx: Ctx): KitchenResult => {
  const f = parseFlags(args, { bools: [['--password-stdin']], values: [['-u', '--username'], ['-p', '--password']] });
  if (f.unknown) return unknownFlag(state, 'login', f.unknown, 1);
  const host = registryHost(f.positional[0]);
  const user = f.values.get('--username');
  if (f.bools.has('--password-stdin')) {
    if (!user) return fail(state, out('Must provide --username with --password-stdin'), 'needUser', { key: 'sim.docker.err.needUser' });
    return loginWith(state, host, user, (ctx.stdin ?? '').trim(), false);
  }
  if (f.values.has('--password')) {
    if (!user) return fail(state, out('Must provide --username with --password'), 'needUser');
    return loginWith(state, host, user, f.values.get('--password')!, true);
  }
  if (!user) {
    return {
      ...fail(state, out(`\nUSING WEB-BASED LOGIN\n\ni Info → To sign in with credentials on the command line, use 'docker login -u <username>'\n`), 'webLogin', { key: 'sim.docker.explain.webLogin' }),
      stopped: true,
    };
  }
  const s = structuredClone(state);
  s.session = { kind: 'password', user, registry: host };
  return { ...ok(s, [], [], { key: 'sim.docker.explain.passwordPrompt', params: { user } }), prompt: 'Password: ' };
};

export const logout = (state: KitchenState, args: string[]): KitchenResult => {
  const host = registryHost(args[0]);
  const s = structuredClone(state);
  const was = s.registry.auth[host];
  delete s.registry.auth[host];
  const shown = host === 'docker.io' ? 'https://index.docker.io/v1/' : host;
  if (!was) return ok(s, [line(`Not logged in to ${shown}`)], [], { key: 'sim.docker.explain.logoutNone' });
  return ok(s, [line(`Removing login credentials for ${shown}`)], [{ type: 'loggedOut', registry: host }], { key: 'sim.docker.explain.logout', params: { registry: host } });
};

export const push = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { bools: [['-q', '--quiet'], ['-a', '--all-tags']], values: [['--platform']] });
  if (f.unknown) return unknownFlag(state, 'push', f.unknown, 1);
  const text = f.positional[0];
  if (!text) return needArgs(state, 'push', 'exactly 1 argument');
  const p = parseRef(text);
  if (!p.ok) return fail(state, out(p.error), 'badRef');
  const r = p.ref;
  const repo = `${r.domain === 'docker.io' ? 'docker.io' : r.domain}/${r.path}`;
  const head = `The push refers to repository [${repo}]`;
  const img = findImage(state, text.includes(':') || text.includes('@') ? text : `${text}:latest`);
  if (!img) return fail(state, [line(head), line(`tag does not exist: ${familiar(r)}`)], 'noSuchImage', { key: 'sim.docker.err.pushNoTag', params: { ref: familiar(r) } });
  const user = state.registry.auth[r.domain];
  const owner = r.path.split('/')[0]!;
  const layers = [...img.blobs].reverse();
  if (!user || r.path.startsWith('library/') || owner !== user) {
    return fail(
      state,
      [line(head), ...layers.map((b) => line(`${b.slice(0, 12)}: Unavailable`)), line('push access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed')],
      'pushDenied',
      { key: user ? 'sim.docker.err.pushNotYours' : 'sim.docker.err.pushNotLoggedIn', params: { ref: familiar(r), user: user ?? '', owner } },
    );
  }
  const s = structuredClone(state);
  const existing = s.registry.repos[repo];
  const stored = existing ?? { tags: {}, owner };
  const already = new Set(Object.values(stored.tags).flatMap((i) => i.blobs));
  const base = img.catalogRef ? familiarRepo((parseRef(img.catalogRef) as { ok: true; ref: typeof r }).ref) : null;
  const catalogBlobs = new Set(img.source === 'build' ? (s.images[Object.values(s.tags).find((id) => s.images[id]?.catalogRef === img.catalogRef && s.images[id]?.source === 'catalog') ?? '']?.blobs ?? []) : []);
  const lines: Line[] = [line(head)];
  for (const b of layers) {
    if (already.has(b)) lines.push(line(`${b.slice(0, 12)}: Layer already exists`));
    else if (catalogBlobs.has(b) && base) lines.push(line(`${b.slice(0, 12)}: Mounted from library/${base}`));
    else lines.push(line(`${b.slice(0, 12)}: Pushed`));
  }
  lines.push(line(`${r.tag}: digest: sha256:${img.id} size: ${856 + img.blobs.length * 61}`));
  stored.tags[r.tag] = structuredClone({ ...img, repoTags: [fullName(r)] });
  s.registry.repos[repo] = stored;
  return ok(s, lines, [{ type: 'imagePushed', ref: familiar(r) }], { key: 'sim.docker.explain.push', params: { ref: familiar(r) } });
};

// ---------------------------------------------------------------------------
// inspect

export const inspect = (state: KitchenState, args: string[], kind?: 'container' | 'image' | 'volume' | 'network'): KitchenResult => {
  const f = parseFlags(args, { bools: [['-s', '--size']], values: [['-f', '--format'], ['--type']] });
  if (f.unknown) return unknownFlag(state, 'inspect', f.unknown, 1);
  if (!f.positional.length) return needArgs(state, 'inspect');
  const type = kind ?? (f.values.get('--type') as typeof kind);
  const items: unknown[] = [];
  for (const ref of f.positional) {
    let obj: unknown = null;
    if (!type || type === 'container') {
      const c = findContainer(state, ref);
      if (c) obj = containerJson(state, c);
    }
    if (!obj && (!type || type === 'image')) {
      const img = findImage(state, ref);
      if (img) obj = imageJson(state, img);
    }
    if (!obj && (!type || type === 'volume')) {
      const v = state.volumes[ref];
      if (v) obj = volumeJson(v);
    }
    if (!obj && (!type || type === 'network')) {
      const n = networkByName(state, ref);
      if (n) obj = networkJson(state, n);
    }
    if (!obj) {
      const msg =
        type === 'image'
          ? `Error response from daemon: No such image: ${(() => {
              const p = parseRef(ref);
              return p.ok ? familiar(p.ref) : ref;
            })()}`
          : type === 'volume'
            ? `Error response from daemon: get ${ref}: no such volume`
            : type === 'network'
              ? `Error response from daemon: network ${ref} not found`
              : type === 'container'
                ? `Error response from daemon: No such container: ${ref}`
                : `error: no such object: ${ref}`;
      return fail(state, [line('[]'), ...out(msg)], 'noSuchObject', { key: 'sim.docker.err.noSuchObject', params: { name: ref } });
    }
    items.push(obj);
  }
  const fmt = f.values.get('--format');
  if (fmt) {
    try {
      const lines = items.flatMap((it) => render(fmt, it).split('\n'));
      return ok(state, lines.map((l) => line(l)), [], { key: 'sim.docker.explain.inspectFormat' });
    } catch (e) {
      return fail(state, [line(''), ...out(e instanceof TemplateError ? e.message : String(e))], 'badTemplate', { key: 'sim.docker.err.badTemplate' });
    }
  }
  return ok(state, jsonLines(items).map((l) => line(l)), [], { key: 'sim.docker.explain.inspect', params: { name: f.positional.join(', ') } });
};
