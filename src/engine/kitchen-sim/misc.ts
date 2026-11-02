// docker volume / network / system (df, prune, info) / version, and the prune family.
import { formatRows, needArgs, unknownFlag } from './containers';
import { parseFlags } from './flags';
import { humanSize, table } from './format';
import { hexOf, nextId } from './ids';
import { containersUsing } from './images';
import { jsonLines, networkJson, volumeJson } from './inspect';
import { removeContainer, startContainer } from './lifecycle';
import { allocIp, COMPOSE_VERSION, DOCKER_VERSION, fail, findContainer, line, networkByName, nextSubnet, ok, out } from './state';
import { TemplateError } from './template';
import type { Container, KitchenEvent, KitchenResult, KitchenState, Line, Volume } from './types';

function volBytes(v: Volume): number {
  return Object.values(v.files).reduce((n, c) => n + new TextEncoder().encode(c).length, 0) + (v.pg ? 41_000_000 : 0);
}

function volumeInUse(state: KitchenState, name: string): Container[] {
  return Object.values(state.containers).filter((c) => c.mounts.some((m) => m.type === 'volume' && m.source === name));
}

// ---------------------------------------------------------------------------
// docker volume

export const volume = (state: KitchenState, args: string[]): KitchenResult => {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'create': {
      const f = parseFlags(rest, { values: [['-d', '--driver']], multi: [['--label'], ['-o', '--opt']] });
      if (f.unknown) return unknownFlag(state, 'volume create', f.unknown, 1);
      const s = structuredClone(state);
      const name = f.positional[0] ?? nextId(s, 'volume');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(name)) {
        return fail(state, out(`Error response from daemon: create ${name}: "${name}" includes invalid characters for a local volume name, only "[a-zA-Z0-9][a-zA-Z0-9_.-]" are allowed. If you intended to pass a host directory, use absolute path`), 'badVolumeName');
      }
      const labels: Record<string, string> = {};
      for (const l of f.multi.get('--label') ?? []) labels[l.split('=')[0]!] = l.split('=').slice(1).join('=');
      const events: KitchenEvent[] = [];
      if (!s.volumes[name]) {
        s.volumes[name] = { name, created: s.clock, labels, files: {}, dirs: [], owner: 0, anonymous: !f.positional[0], initialized: false };
        events.push({ type: 'volumeCreated', name });
      }
      return ok(s, [line(name)], events, { key: 'sim.docker.explain.volumeCreate', params: { name } });
    }
    case 'ls':
    case 'list': {
      const f = parseFlags(rest, { bools: [['-q', '--quiet']], values: [['--format']], multi: [['-f', '--filter']] });
      if (f.unknown) return unknownFlag(state, 'volume ls', f.unknown, 1);
      let list = Object.values(state.volumes).sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const flt of f.multi.get('--filter') ?? []) {
        const [k, v = ''] = flt.split('=');
        if (k === 'name') list = list.filter((x) => x.name.includes(v));
        else if (k === 'dangling') list = list.filter((x) => (volumeInUse(state, x.name).length === 0) === (v === 'true'));
        else if (k === 'label') list = list.filter((x) => (v.includes('=') ? x.labels[v.split('=')[0]!] === v.split('=')[1] : v in x.labels));
      }
      if (f.bools.has('--quiet')) return ok(state, list.map((v) => line(v.name)), [], { key: 'sim.docker.explain.volumeLs' });
      const fmt = f.values.get('--format');
      if (fmt) {
        try {
          return ok(state, formatRows(list.map((v) => ({ Name: v.name, Driver: 'local', Mountpoint: `/var/lib/docker/volumes/${v.name}/_data`, Scope: 'local', Labels: '' })), fmt, { Name: 'VOLUME NAME', Driver: 'DRIVER' }).map((l) => line(l)), []);
        } catch (e) {
          return fail(state, out(e instanceof TemplateError ? e.message : String(e)), 'badTemplate');
        }
      }
      return ok(state, table([['DRIVER', 'VOLUME NAME'], ...list.map((v) => ['local', v.name])]).map((l) => line(l)), [], { key: list.length ? 'sim.docker.explain.volumeLs' : 'sim.docker.explain.volumeLsEmpty', params: { n: String(list.length) } });
    }
    case 'rm':
    case 'remove': {
      const f = parseFlags(rest, { bools: [['-f', '--force']] });
      if (!f.positional.length) return needArgs(state, 'volume rm');
      const s = structuredClone(state);
      const lines: Line[] = [];
      const events: KitchenEvent[] = [];
      let err: string | null = null;
      for (const name of f.positional) {
        const v = s.volumes[name];
        if (!v) {
          if (!f.bools.has('--force')) {
            lines.push(line(`Error response from daemon: get ${name}: no such volume`));
            err ??= 'noSuchVolume';
          }
          continue;
        }
        const users = volumeInUse(s, name);
        if (users.length) {
          lines.push(line(`Error response from daemon: remove ${name}: volume is in use - [${users.map((c) => c.id).join(', ')}]`));
          err ??= 'volumeInUse';
          continue;
        }
        delete s.volumes[name];
        lines.push(line(name));
        events.push({ type: 'volumeRemoved', name });
      }
      if (err) {
        const res = fail(s, lines, err, { key: `sim.docker.err.${err}`, params: { name: f.positional.join(' ') } });
        res.events = [...events, ...res.events];
        return res;
      }
      return ok(s, lines, events, { key: 'sim.docker.explain.volumeRm', params: { name: f.positional.join(', ') } });
    }
    case 'inspect': {
      const f = parseFlags(rest, { values: [['-f', '--format']] });
      if (!f.positional.length) return needArgs(state, 'volume inspect');
      const items: unknown[] = [];
      for (const name of f.positional) {
        const v = state.volumes[name];
        if (!v) return fail(state, [line('[]'), line(`Error response from daemon: get ${name}: no such volume`)], 'noSuchVolume', { key: 'sim.docker.err.noSuchVolume', params: { name } });
        items.push(volumeJson(v));
      }
      return ok(state, jsonLines(items).map((l) => line(l)), [], { key: 'sim.docker.explain.volumeInspect', params: { name: f.positional[0]! } });
    }
    case 'prune':
      return prune(state, 'volume', rest);
    default:
      return mgmtUsage(state, 'volume', sub);
  }
};

// ---------------------------------------------------------------------------
// docker network

export const network = (state: KitchenState, args: string[]): KitchenResult => {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'create': {
      const f = parseFlags(rest, { bools: [['--internal'], ['--attachable'], ['--ipv6']], values: [['-d', '--driver'], ['--subnet'], ['--gateway']], multi: [['--label']] });
      if (f.unknown) return unknownFlag(state, 'network create', f.unknown, 1);
      const name = f.positional[0];
      if (!name) return needArgs(state, 'network create', 'exactly 1 argument');
      if (networkByName(state, name)?.name === name) return fail(state, out(`Error response from daemon: network with name ${name} already exists`), 'networkExists', { key: 'sim.docker.err.networkExists', params: { name } });
      const driver = f.values.get('--driver') ?? 'bridge';
      if (driver !== 'bridge') return fail(state, out(`Error response from daemon: plugin "${driver}" not found`), 'badDriver');
      const s = structuredClone(state);
      const id = nextId(s, 'network');
      const subnet = f.values.get('--subnet') ?? nextSubnet(s);
      const labels: Record<string, string> = {};
      for (const l of f.multi.get('--label') ?? []) labels[l.split('=')[0]!] = l.split('=').slice(1).join('=');
      s.networks[id] = { id, name, driver: 'bridge', created: s.clock, subnet, gateway: subnet.replace(/0\/\d+$/, '1'), labels, internal: f.bools.has('--internal'), builtin: false, nextIp: 2 };
      return ok(s, [line(id)], [{ type: 'networkCreated', name }], { key: 'sim.docker.explain.networkCreate', params: { name } });
    }
    case 'ls':
    case 'list': {
      const f = parseFlags(rest, { bools: [['-q', '--quiet'], ['--no-trunc']], values: [['--format']], multi: [['-f', '--filter']] });
      let list = Object.values(state.networks).sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const flt of f.multi.get('--filter') ?? []) {
        const [k, v = ''] = flt.split('=');
        if (k === 'name') list = list.filter((n) => n.name.includes(v));
        else if (k === 'driver') list = list.filter((n) => n.driver === v);
        else if (k === 'type') list = list.filter((n) => (v === 'custom' ? !n.builtin : n.builtin));
      }
      if (f.bools.has('--quiet')) return ok(state, list.map((n) => line(n.id.slice(0, 12))));
      return ok(state, table([['NETWORK ID', 'NAME', 'DRIVER', 'SCOPE'], ...list.map((n) => [n.id.slice(0, 12), n.name, n.driver, 'local'])]).map((l) => line(l)), [], { key: 'sim.docker.explain.networkLs' });
    }
    case 'rm':
    case 'remove': {
      if (!rest.length) return needArgs(state, 'network rm');
      const s = structuredClone(state);
      const lines: Line[] = [];
      const events: KitchenEvent[] = [];
      let err: string | null = null;
      for (const name of rest.filter((a) => !a.startsWith('-'))) {
        const n = networkByName(s, name);
        if (!n) {
          lines.push(line(`Error response from daemon: network ${name} not found`));
          err ??= 'noSuchNetwork';
          continue;
        }
        if (n.builtin) {
          lines.push(line(`Error response from daemon: ${n.name} is a pre-defined network and cannot be removed`));
          err ??= 'builtinNetwork';
          continue;
        }
        const users = Object.values(s.containers).filter((c) => n.name in c.networks && (c.status === 'running' || c.status === 'paused'));
        if (users.length) {
          const c = users[0]!;
          lines.push(line(`Error response from daemon: error while removing network: network ${n.name} has active endpoints (name:"${c.name}" id:"${c.networks[n.name]!.endpoint.slice(0, 12)}")`));
          err ??= 'networkInUse';
          continue;
        }
        for (const c of Object.values(s.containers)) delete c.networks[n.name];
        delete s.networks[n.id];
        lines.push(line(name));
        events.push({ type: 'networkRemoved', name: n.name });
      }
      if (err) {
        lines.push(line('exit status 1'));
        const res = fail(s, lines, err, { key: `sim.docker.err.${err}`, params: { name: rest.join(' ') } });
        res.events = [...events, ...res.events];
        return res;
      }
      return ok(s, lines, events, { key: 'sim.docker.explain.networkRm', params: { name: rest.join(', ') } });
    }
    case 'inspect': {
      const f = parseFlags(rest, { values: [['-f', '--format']] });
      if (!f.positional.length) return needArgs(state, 'network inspect');
      const items: unknown[] = [];
      for (const name of f.positional) {
        const n = networkByName(state, name);
        if (!n) return fail(state, [line('[]'), line(`Error response from daemon: network ${name} not found`)], 'noSuchNetwork', { key: 'sim.docker.err.noSuchNetwork', params: { name } });
        items.push(networkJson(state, n));
      }
      return ok(state, jsonLines(items).map((l) => line(l)), [], { key: 'sim.docker.explain.networkInspect', params: { name: f.positional[0]! } });
    }
    case 'connect':
    case 'disconnect': {
      const f = parseFlags(rest, { bools: [['-f', '--force']], multi: [['--alias']] });
      const [netName, ref] = f.positional;
      if (!netName || !ref) return needArgs(state, `network ${sub}`, 'exactly 2 arguments');
      const n = networkByName(state, netName);
      if (!n) return fail(state, out(`Error response from daemon: network ${netName} not found`), 'noSuchNetwork', { key: 'sim.docker.err.noSuchNetwork', params: { name: netName } });
      const c0 = findContainer(state, ref);
      if (!c0) return fail(state, out(`Error response from daemon: No such container: ${ref}`), 'noSuchContainer', { key: 'sim.docker.err.noSuchContainer', params: { name: ref } });
      const s = structuredClone(state);
      const c = s.containers[c0.id]!;
      const net = s.networks[n.id]!;
      if (sub === 'connect') {
        if (c.networks[n.name]) return fail(state, out(`Error response from daemon: endpoint with name ${c.name} already exists in network ${n.name}`), 'alreadyConnected');
        c.networks[n.name] = { ip: c.status === 'running' ? allocIp(net) : '', aliases: f.multi.get('--alias') ?? [], mac: hexOf(`${c.id}${n.id}mac`, 12).replace(/(..)(?=.)/g, '$1:'), endpoint: hexOf(`${c.id}:${n.name}:endpoint`) };
        return ok(s, [], [{ type: 'networkConnected', network: n.name, container: c.name }], { key: 'sim.docker.explain.networkConnect', params: { name: c.name, network: n.name } });
      }
      if (!c.networks[n.name]) return fail(state, out(`Error response from daemon: container ${c.id} is not connected to network ${n.name}`), 'notConnected');
      delete c.networks[n.name];
      return ok(s, [], [{ type: 'networkDisconnected', network: n.name, container: c.name }], { key: 'sim.docker.explain.networkDisconnect', params: { name: c.name, network: n.name } });
    }
    case 'prune':
      return prune(state, 'network', rest);
    default:
      return mgmtUsage(state, 'network', sub);
  }
};

function mgmtUsage(state: KitchenState, group: string, sub: string | undefined): KitchenResult {
  if (!sub) {
    return fail(state, out(`\nUsage:  docker ${group} COMMAND\n\nManage ${group}s\n\nRun 'docker ${group} COMMAND --help' for more information on a command.`), 'usage', { key: 'sim.docker.err.needsSub', params: { cmd: `docker ${group}` } });
  }
  return fail(state, out(`docker: unknown command: docker ${group} ${sub}\n\nRun 'docker ${group} --help' for more information`), 'unknownCommand', { key: 'sim.docker.err.unknownCommand', params: { cmd: `docker ${group} ${sub}` } });
}

// ---------------------------------------------------------------------------
// Sizes for system df and prunes

function containerSize(c: Container): number {
  return Object.values(c.files).reduce((n, x) => n + 4096 + new TextEncoder().encode(x).length, 0);
}

function imageUnique(img: { diskSize: number }): number {
  return img.diskSize;
}

const WARN: Record<string, string> = {
  container: 'WARNING! This will remove all stopped containers.',
  image: 'WARNING! This will remove all dangling images.',
  'image-a': 'WARNING! This will remove all images without at least one container associated to them.',
  volume: 'WARNING! This will remove anonymous local volumes not used by at least one container.',
  'volume-a': 'WARNING! This will remove all local volumes not used by at least one container.',
  network: 'WARNING! This will remove all custom networks not used by at least one container.',
  builder: 'WARNING! This will remove all dangling build cache.',
};

/** The prune family. Without -f it asks first (a y/N prompt), like Docker. */
export function prune(state: KitchenState, what: 'container' | 'image' | 'volume' | 'network' | 'builder' | 'system', args: string[]): KitchenResult {
  const f = parseFlags(args, { bools: [['-f', '--force'], ['-a', '--all'], ['--volumes']], multi: [['--filter']] });
  if (f.unknown) return unknownFlag(state, what === 'system' ? 'system prune' : `${what} prune`, f.unknown, 1);
  const all = f.bools.has('--all');
  if (!f.bools.has('--force')) {
    const s = structuredClone(state);
    const cmd = what === 'system' ? 'system prune' : `${what} prune`;
    s.session = { kind: 'confirm', command: `docker ${cmd} ${args.join(' ')} -f`.replace(/\s+/g, ' ').trim() };
    let warn: string[];
    if (what === 'system') {
      warn = ['WARNING! This will remove:', '  - all stopped containers', '  - all networks not used by at least one container'];
      if (f.bools.has('--volumes')) warn.push('  - all anonymous volumes not used by at least one container');
      warn.push(all ? '  - all images without at least one container associated to them' : '  - all dangling images', all ? '  - all build cache' : '  - unused build cache', '');
    } else warn = [WARN[all && (what === 'image' || what === 'volume') ? `${what}-a` : what]!];
    if (what === 'builder') return { ...ok(s, [], [], { key: 'sim.docker.explain.pruneAsk', params: { cmd: `docker ${cmd}` } }), prompt: `${warn[0]} Are you sure you want to continue? [y/N] ` };
    return { ...ok(s, warn.map((l) => line(l)), [], { key: 'sim.docker.explain.pruneAsk', params: { cmd: `docker ${cmd}` } }), prompt: 'Are you sure you want to continue? [y/N] ' };
  }
  const s = structuredClone(state);
  const lines: string[] = [];
  const events: KitchenEvent[] = [];
  let reclaimed = 0;
  const doContainers = () => {
    const gone = Object.values(s.containers).filter((c) => c.status === 'exited' || c.status === 'created' || c.status === 'dead');
    if (gone.length) {
      lines.push('Deleted Containers:', ...gone.map((c) => c.id), '');
      for (const c of gone) {
        reclaimed += containerSize(c);
        events.push(...removeContainer(s, c, false));
      }
    }
  };
  const doNetworks = () => {
    const gone = Object.values(s.networks).filter((n) => !n.builtin && !Object.values(s.containers).some((c) => n.name in c.networks));
    if (gone.length) {
      lines.push('Deleted Networks:', ...gone.map((n) => n.name), '');
      for (const n of gone) {
        delete s.networks[n.id];
        events.push({ type: 'networkRemoved', name: n.name });
      }
    }
  };
  const doVolumes = (allVolumes: boolean) => {
    const gone = Object.values(s.volumes).filter((v) => (allVolumes || v.anonymous) && volumeInUse(s, v.name).length === 0);
    if (gone.length) {
      lines.push('Deleted Volumes:', ...gone.map((v) => v.name), '');
      for (const v of gone) {
        reclaimed += volBytes(v);
        delete s.volumes[v.name];
        events.push({ type: 'volumeRemoved', name: v.name });
      }
    }
  };
  const doImages = (allImages: boolean) => {
    const gone = Object.values(s.images).filter((i) => (allImages || i.repoTags.length === 0) && containersUsing(s, i).length === 0);
    if (gone.length) {
      lines.push('Deleted Images:');
      for (const img of gone) {
        for (const t of img.repoTags) {
          lines.push(`untagged: ${t.replace(/^docker\.io\/library\//, '').replace(/^docker\.io\//, '')}`);
          delete s.tags[t];
        }
        lines.push(`deleted: sha256:${img.id}`);
        reclaimed += imageUnique(img);
        delete s.images[img.id];
        events.push({ type: 'imageRemoved', ref: '', id: img.id, deleted: true });
      }
      lines.push('');
    }
  };
  const doCache = (allCache: boolean) => {
    const gone = s.buildCache.filter((r) => allCache || !r.inUse);
    if (gone.length) {
      lines.push('Deleted build cache objects:', ...gone.map((r) => r.key), '');
      for (const r of gone) reclaimed += r.size;
      s.buildCache = s.buildCache.filter((r) => !gone.includes(r));
    }
  };
  switch (what) {
    case 'container':
      doContainers();
      break;
    case 'network':
      doNetworks();
      if (lines.length) lines.pop();
      return ok(s, lines.map((l) => line(l)), events, { key: 'sim.docker.explain.prune', params: { what } });
    case 'volume':
      doVolumes(all);
      break;
    case 'image':
      doImages(all);
      break;
    case 'builder': {
      const gone = s.buildCache.filter((r) => all || !r.inUse);
      const rows = gone.map((r) => [r.key, 'true', humanSize(r.size, 4), 'Less than a second ago']);
      const total = gone.reduce((n, r) => n + r.size, 0);
      s.buildCache = s.buildCache.filter((r) => !gone.includes(r));
      const outLines = gone.length ? [...table([['ID', 'RECLAIMABLE', 'SIZE', 'LAST ACCESSED'], ...rows], 16, 0)] : [];
      outLines.push(`Total:\t${humanSize(total, 4)}`);
      return ok(s, outLines.map((l) => line(l)), events, { key: 'sim.docker.explain.prune', params: { what } });
    }
    case 'system':
      doContainers();
      doNetworks();
      if (f.bools.has('--volumes')) doVolumes(false);
      doImages(all);
      doCache(all);
      break;
  }
  lines.push(`Total reclaimed space: ${humanSize(reclaimed, 4)}`);
  return ok(s, lines.map((l) => line(l)), events, { key: 'sim.docker.explain.prune', params: { what } });
}

// ---------------------------------------------------------------------------
// docker system df / info / version

export function systemDf(state: KitchenState, verbose: boolean): string[] {
  const imgs = Object.values(state.images);
  const activeImgs = imgs.filter((i) => containersUsing(state, i).length > 0);
  const imgSize = imgs.reduce((n, i) => n + i.diskSize, 0);
  const imgReclaim = imgs.filter((i) => !activeImgs.includes(i)).reduce((n, i) => n + i.diskSize, 0);
  const cs = Object.values(state.containers);
  const csSize = cs.reduce((n, c) => n + containerSize(c), 0);
  const csReclaim = cs.filter((c) => c.status !== 'running' && c.status !== 'paused').reduce((n, c) => n + containerSize(c), 0);
  const vols = Object.values(state.volumes);
  const volActive = vols.filter((v) => volumeInUse(state, v.name).length > 0);
  const volSize = vols.reduce((n, v) => n + volBytes(v), 0);
  const volReclaim = vols.filter((v) => !volActive.includes(v)).reduce((n, v) => n + volBytes(v), 0);
  const cache = state.buildCache;
  const cacheSize = cache.reduce((n, r) => n + r.size, 0);
  const cacheReclaim = cache.filter((r) => !r.inUse).reduce((n, r) => n + r.size, 0);
  const pct = (part: number, whole: number) => (whole > 0 ? `${humanSize(part, 4)} (${Math.round((part / whole) * 100)}%)` : humanSize(part, 4));
  const rows = [
    ['TYPE', 'TOTAL', 'ACTIVE', 'SIZE', 'RECLAIMABLE'],
    ['Images', String(imgs.length), String(activeImgs.length), humanSize(imgSize, 4), pct(imgReclaim, imgSize)],
    ['Containers', String(cs.length), String(cs.filter((c) => c.status === 'running' || c.status === 'paused').length), humanSize(csSize, 4), pct(csReclaim, csSize)],
    ['Local Volumes', String(vols.length), String(volActive.length), humanSize(volSize, 4), pct(volReclaim, volSize)],
    ['Build Cache', String(cache.length), String(cache.filter((r) => r.inUse).length), humanSize(cacheSize, 4), humanSize(cacheReclaim, 4)],
  ];
  const lines = table(rows);
  if (!verbose) return lines;
  return [
    'Images space usage:',
    '',
    ...table([['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE', 'SHARED SIZE', 'UNIQUE SIZE', 'CONTAINERS'], ...imgs.flatMap((i) => (i.repoTags.length ? i.repoTags : ['<none>:<none>']).map((t) => {
      const short = t.replace(/^docker\.io\/library\//, '').replace(/^docker\.io\//, '');
      const k = short.lastIndexOf(':');
      return [short.slice(0, k), short.slice(k + 1), i.id.slice(0, 12), `${Math.max(0, Math.round((state.clock - i.created) / 86400))} days ago`, i.diskText ?? humanSize(i.diskSize), '0B', humanSize(i.diskSize, 4), String(containersUsing(state, i).length)];
    }))]),
    '',
    'Containers space usage:',
    '',
    ...table([['CONTAINER ID', 'IMAGE', 'COMMAND', 'LOCAL VOLUMES', 'SIZE', 'CREATED', 'STATUS', 'NAMES'], ...cs.map((c) => [c.id.slice(0, 12), c.image, `"${[...c.entrypoint, ...c.cmd].join(' ').slice(0, 19)}…"`, String(c.mounts.filter((m) => m.type === 'volume').length), humanSize(containerSize(c)), '', c.status, c.name])]),
    '',
    'Local Volumes space usage:',
    '',
    ...table([['VOLUME NAME', 'LINKS', 'SIZE'], ...vols.map((v) => [v.name, String(volumeInUse(state, v.name).length), humanSize(volBytes(v))])]),
    '',
    `Build cache usage: ${humanSize(cacheSize, 4)}`,
    '',
    ...table([['CACHE ID', 'CACHE TYPE', 'SIZE', 'CREATED', 'LAST USED', 'USAGE', 'SHARED'], ...cache.map((r) => [r.key.slice(0, 12), 'regular', humanSize(r.size), 'Less than a second ago', 'Less than a second ago', '1', 'false'])]),
  ];
}

export const system = (state: KitchenState, args: string[]): KitchenResult => {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'df': {
      const verbose = rest.includes('-v') || rest.includes('--verbose');
      return ok(state, systemDf(state, verbose).map((l) => line(l)), [], { key: 'sim.docker.explain.systemDf' });
    }
    case 'prune':
      return prune(state, 'system', rest);
    case 'info':
      return info(state);
    default:
      return mgmtUsage(state, 'system', sub);
  }
};

export function versionLines(): string[] {
  return [
    'Client: Docker Engine - Community',
    ` Version:           ${DOCKER_VERSION}`,
    ' API version:       1.56',
    ' Go version:        go1.26.10',
    ' Git commit:        a82e528',
    ' Built:             Tue Oct 20 18:44:40 2026',
    ' OS/Arch:           linux/amd64',
    ' Context:           default',
    '',
    'Server: Docker Engine - Community',
    ' Engine:',
    `  Version:          ${DOCKER_VERSION}`,
    '  API version:      1.56 (minimum version 1.40)',
    '  Go version:       go1.26.10',
    '  Git commit:       0367cbe',
    '  Built:            Tue Oct 20 18:44:40 2026',
    '  OS/Arch:          linux/amd64',
    '  Experimental:     false',
    ' containerd:',
    '  Version:          v2.4.2',
    '  GitCommit:        b7a25261e029d68978bbf290df0a62fc819b3c51',
    ' runc:',
    '  Version:          1.5.2',
    '  GitCommit:        v1.5.2-0-g29dd3dc2',
    ' docker-init:',
    '  Version:          0.19.0',
    '  GitCommit:        de40ad0',
  ];
}

export const version = (state: KitchenState, args: string[]): KitchenResult => {
  const f = parseFlags(args, { values: [['-f', '--format']] });
  const fmt = f.values.get('--format');
  if (fmt) {
    if (/\.Server\.Version/.test(fmt)) return ok(state, [line(DOCKER_VERSION)]);
    if (/\.Client\.Version/.test(fmt)) return ok(state, [line(DOCKER_VERSION)]);
  }
  if (!state.host.dockerUp) {
    return fail(state, out([...versionLines().slice(0, 8), 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'].join('\n')), 'daemonDown', { key: 'sim.docker.err.daemonDown' });
  }
  return ok(state, versionLines().map((l) => line(l)), [], { key: 'sim.docker.explain.version' });
};

export function info(state: KitchenState): KitchenResult {
  const cs = Object.values(state.containers);
  const lines = [
    'Client: Docker Engine - Community',
    ` Version:    ${DOCKER_VERSION}`,
    ' Context:    default',
    ' Debug Mode: false',
    ' Plugins:',
    '  buildx: Docker Buildx (Docker Inc.)',
    '    Version:  v0.38.1',
    '    Path:     /usr/libexec/docker/cli-plugins/docker-buildx',
    '  compose: Docker Compose (Docker Inc.)',
    `    Version:  ${COMPOSE_VERSION}`,
    '    Path:     /usr/libexec/docker/cli-plugins/docker-compose',
    '',
    'Server:',
    ` Containers: ${cs.length}`,
    `  Running: ${cs.filter((c) => c.status === 'running').length}`,
    `  Paused: ${cs.filter((c) => c.status === 'paused').length}`,
    `  Stopped: ${cs.filter((c) => c.status !== 'running' && c.status !== 'paused').length}`,
    ` Images: ${Object.keys(state.images).length}`,
    ` Server Version: ${DOCKER_VERSION}`,
    ' Storage Driver: overlayfs',
    '  driver-type: io.containerd.snapshotter.v1',
    ' Logging Driver: json-file',
    ' Cgroup Driver: systemd',
    ' Cgroup Version: 2',
    // Docker 29.9.2 on Ubuntu 24.04 (runc and containerd versions as measured on that engine).
    ' Runtimes: io.containerd.runc.v2 runc',
    ' Default Runtime: runc',
    ' Init Binary: docker-init',
    ' containerd version: b7a25261e029d68978bbf290df0a62fc819b3c51',
    ' runc version: v1.5.2-0-g29dd3dc2',
    ' init version: de40ad0',
    ' Security Options:',
    '  apparmor',
    '  seccomp',
    '   Profile: builtin',
    '  cgroupns',
    ` Kernel Version: ${state.host.kernel}`,
    ` Operating System: ${state.host.os}`,
    ' OSType: linux',
    ' Architecture: x86_64',
    ` CPUs: ${state.host.cpus}`,
    ` Total Memory: 15.71GiB`,
    ` Name: ${state.host.name}`,
    ' Docker Root Dir: /var/lib/docker',
  ];
  if (!state.host.dockerUp) {
    return fail(state, out([...lines.slice(0, 12), 'Server:', 'ERROR: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?', 'errors pretty printing info'].join('\n')), 'daemonDown', { key: 'sim.docker.err.daemonDown' });
  }
  return ok(state, lines.map((l) => line(l)), [], { key: 'sim.docker.explain.info' });
}

export { startContainer };
