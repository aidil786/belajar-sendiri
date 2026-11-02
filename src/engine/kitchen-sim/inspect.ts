// `docker inspect` JSON: the same shape as Docker Engine 29 prints (a realistic subset).
import { hexOf, hostPid } from './ids';
import { iso } from './format';
import { familiarOf } from './refs';
import { networkByName } from './state';
import type { Container, KitchenState, LocalImage, Network, Volume } from './types';

const ZERO = '0001-01-01T00:00:00Z';

function nanos(seed: string): string {
  return String(parseInt(hexOf(seed, 8), 16) % 1000000000).padStart(9, '0');
}

export function containerJson(state: KitchenState, c: Container): Record<string, unknown> {
  const img = state.images[c.imageId];
  const running = c.status === 'running' || c.status === 'paused' || c.status === 'restarting';
  const portBindings: Record<string, { HostIp: string; HostPort: string }[]> = {};
  const ports: Record<string, { HostIp: string; HostPort: string }[] | null> = {};
  for (const p of c.ports) {
    const k = `${p.containerPort}/${p.proto}`;
    (portBindings[k] ??= []).push({ HostIp: p.hostIp === '0.0.0.0' && !c.publishAll ? '' : p.hostIp, HostPort: c.publishAll ? '' : String(p.hostPort) });
    if (running) {
      (ports[k] ??= []).push({ HostIp: p.hostIp, HostPort: String(p.hostPort) });
      if (state.host.ipv6 && p.hostIp === '0.0.0.0') ports[k]!.push({ HostIp: '::', HostPort: String(p.hostPort) });
    }
  }
  if (running) for (const e of c.exposed) if (!(e in ports)) ports[e] = null;
  const networks: Record<string, unknown> = {};
  for (const [name, ep] of Object.entries(c.networks)) {
    const net = networkByName(state, name);
    networks[name] = {
      IPAMConfig: null,
      Links: null,
      Aliases: name === 'bridge' ? null : ep.aliases.length ? ep.aliases : null,
      DriverOpts: null,
      GwPriority: 0,
      NetworkID: net?.id ?? '',
      EndpointID: running ? ep.endpoint : '',
      Gateway: running ? (net?.gateway ?? '') : '',
      IPAddress: running ? ep.ip : '',
      MacAddress: running ? ep.mac : '',
      IPPrefixLen: running ? 16 : 0,
      IPv6Gateway: '',
      GlobalIPv6Address: '',
      GlobalIPv6PrefixLen: 0,
      DNSNames: name === 'bridge' ? null : [c.name, ...ep.aliases, c.id.slice(0, 12)],
    };
  }
  const health = c.health
    ? {
        Status: c.health.status,
        FailingStreak: c.health.failing,
        Log: c.health.log.map((l) => ({ Start: iso(l.start, nanos(`${c.id}${l.start}a`)), End: iso(l.end, nanos(`${c.id}${l.end}b`)), ExitCode: l.code, Output: l.output })),
      }
    : undefined;
  const state_: Record<string, unknown> = {
    Status: c.status,
    Running: c.status === 'running' || c.status === 'paused',
    Paused: c.status === 'paused',
    Restarting: c.status === 'restarting',
    OOMKilled: c.oomKilled,
    Dead: c.status === 'dead',
    Pid: c.status === 'running' || c.status === 'paused' ? hostPid(c.id) : 0,
    ExitCode: c.exitCode,
    Error: c.error,
    StartedAt: c.startedAt !== null ? iso(c.startedAt, nanos(`${c.id}s`)) : ZERO,
    FinishedAt: c.finishedAt !== null ? iso(c.finishedAt, nanos(`${c.id}f`)) : ZERO,
  };
  if (health) state_.Health = health;
  const config: Record<string, unknown> = {
    Hostname: c.hostname,
    Domainname: '',
    User: c.user,
    AttachStdin: !c.interactive ? false : true,
    AttachStdout: c.interactive || c.tty,
    AttachStderr: c.interactive || c.tty,
  };
  if (c.exposed.length) config.ExposedPorts = Object.fromEntries(c.exposed.map((e) => [e, {}]));
  Object.assign(config, {
    Tty: c.tty,
    OpenStdin: c.interactive,
    StdinOnce: c.interactive,
    Env: c.env,
    Cmd: c.cmd.length ? c.cmd : null,
  });
  if (c.healthcheck) config.Healthcheck = { Test: c.healthcheck.Test, ...(c.healthcheck.Interval ? { Interval: c.healthcheck.Interval * 1e9 } : {}), ...(c.healthcheck.Retries ? { Retries: c.healthcheck.Retries } : {}) };
  Object.assign(config, {
    Image: c.image,
    Volumes: null,
    WorkingDir: c.workdir,
    Entrypoint: c.entrypoint.length ? c.entrypoint : null,
    Labels: c.labels,
  });
  if (img?.config.StopSignal) config.StopSignal = img.config.StopSignal;
  return {
    Id: c.id,
    Created: iso(c.created, nanos(c.id)),
    Path: (c.entrypoint.length ? c.entrypoint : c.cmd)[0] ?? '',
    Args: (c.entrypoint.length ? [...c.entrypoint.slice(1), ...c.cmd] : c.cmd.slice(1)),
    State: state_,
    Image: `sha256:${c.imageId}`,
    ResolvConfPath: `/var/lib/docker/containers/${c.id}/resolv.conf`,
    HostnamePath: `/var/lib/docker/containers/${c.id}/hostname`,
    HostsPath: `/var/lib/docker/containers/${c.id}/hosts`,
    LogPath: `/var/lib/docker/containers/${c.id}/${c.id}-json.log`,
    Name: `/${c.name}`,
    RestartCount: c.restartCount,
    Driver: 'overlayfs',
    Platform: 'linux',
    MountLabel: '',
    ProcessLabel: '',
    AppArmorProfile: '',
    ExecIDs: null,
    HostConfig: {
      Binds: c.mounts.filter((m) => m.type !== 'tmpfs' && !m.anonymous).map((m) => `${m.source}:${m.target}${m.readOnly ? ':ro' : ''}`),
      ContainerIDFile: '',
      LogConfig: { Type: 'json-file', Config: {} },
      NetworkMode: c.networkMode,
      PortBindings: portBindings,
      RestartPolicy: { Name: c.restartPolicy.name, MaximumRetryCount: c.restartPolicy.max },
      AutoRemove: c.autoRemove,
      VolumeDriver: '',
      VolumesFrom: null,
      CapAdd: c.capAdd.length ? c.capAdd : null,
      CapDrop: c.capDrop.length ? c.capDrop : null,
      Init: c.init || null,
      PublishAllPorts: c.publishAll,
      ReadonlyRootfs: c.readOnly,
      Tmpfs: c.mounts.some((m) => m.type === 'tmpfs') ? Object.fromEntries(c.mounts.filter((m) => m.type === 'tmpfs').map((m) => [m.target, ''])) : undefined,
      ShmSize: 67108864,
      Runtime: 'runc',
      Memory: c.limits?.memory ?? 0,
      MemorySwap: c.limits?.memory ? c.limits.memory * 2 : 0,
      NanoCpus: c.limits?.nanoCpus ?? 0,
      PidsLimit: c.limits?.pids ?? null,
    },
    Mounts: c.mounts
      .filter((m) => m.type !== 'tmpfs')
      .map((m) =>
        m.type === 'volume'
          ? { Type: 'volume', Name: m.source, Source: `/var/lib/docker/volumes/${m.source}/_data`, Destination: m.target, Driver: 'local', Mode: m.anonymous ? '' : 'z', RW: !m.readOnly, Propagation: '' }
          : { Type: 'bind', Source: m.source, Destination: m.target, Mode: '', RW: !m.readOnly, Propagation: 'rprivate' },
      ),
    Config: config,
    NetworkSettings: {
      SandboxID: running ? hexOf(`${c.id}:sandbox`) : '',
      SandboxKey: running ? `/var/run/docker/netns/${hexOf(`${c.id}:sandbox`).slice(0, 12)}` : '',
      Ports: ports,
      Networks: networks,
    },
  };
}

export function imageJson(state: KitchenState, img: LocalImage): Record<string, unknown> {
  const cfg = img.config;
  const config: Record<string, unknown> = {};
  if (cfg.User) config.User = cfg.User;
  if (cfg.ExposedPorts) config.ExposedPorts = cfg.ExposedPorts;
  config.Env = cfg.Env ?? [];
  if (cfg.Entrypoint) config.Entrypoint = cfg.Entrypoint;
  if (cfg.Cmd) config.Cmd = cfg.Cmd;
  if (cfg.Healthcheck) config.Healthcheck = { Test: cfg.Healthcheck.Test, ...(cfg.Healthcheck.Interval ? { Interval: cfg.Healthcheck.Interval * 1e9 } : {}) };
  if (cfg.Volumes) config.Volumes = cfg.Volumes;
  if (cfg.WorkingDir) config.WorkingDir = cfg.WorkingDir;
  if (cfg.Labels) config.Labels = cfg.Labels;
  if (cfg.StopSignal) config.StopSignal = cfg.StopSignal;
  return {
    Id: `sha256:${img.id}`,
    RepoTags: img.repoTags.map(familiarOf),
    RepoDigests: img.repoDigests,
    Comment: 'buildkit.dockerfile.v0',
    Created: iso(img.created, nanos(img.id)),
    Config: config,
    Architecture: img.platform.split('/')[1] ?? 'amd64',
    ...(img.platform.split('/')[2] ? { Variant: img.platform.split('/')[2] } : {}),
    Os: 'linux',
    Size: img.size,
    RootFS: { Type: 'layers', Layers: img.layers.map((l) => `sha256:${l}`) },
    Metadata: { LastTagTime: iso(state.clock, nanos(`${img.id}tag`)) },
    Descriptor: { mediaType: 'application/vnd.oci.image.index.v1+json', digest: `sha256:${img.id}`, size: 9218 },
  };
}

export function volumeJson(v: Volume): Record<string, unknown> {
  return {
    CreatedAt: iso(v.created),
    Driver: 'local',
    Labels: Object.keys(v.labels).length ? v.labels : null,
    Mountpoint: `/var/lib/docker/volumes/${v.name}/_data`,
    Name: v.name,
    Options: null,
    Scope: 'local',
  };
}

export function networkJson(state: KitchenState, n: Network): Record<string, unknown> {
  const containers: Record<string, unknown> = {};
  for (const c of Object.values(state.containers)) {
    const ep = c.networks[n.name];
    if (!ep || (c.status !== 'running' && c.status !== 'paused')) continue;
    containers[c.id] = { Name: c.name, EndpointID: ep.endpoint, MacAddress: ep.mac, IPv4Address: `${ep.ip}/16`, IPv6Address: '' };
  }
  return {
    Name: n.name,
    Id: n.id,
    Created: iso(n.created, nanos(n.id)),
    Scope: 'local',
    Driver: n.driver,
    EnableIPv4: n.driver === 'bridge',
    EnableIPv6: false,
    IPAM: { Driver: 'default', Options: n.builtin ? null : {}, Config: n.subnet ? [{ Subnet: n.subnet, Gateway: n.gateway }] : [] },
    Internal: n.internal,
    Attachable: false,
    Ingress: false,
    ConfigFrom: { Network: '' },
    ConfigOnly: false,
    Options: n.builtin && n.name === 'bridge' ? { 'com.docker.network.bridge.default_bridge': 'true', 'com.docker.network.bridge.name': 'docker0' } : {},
    Labels: n.labels,
    Containers: containers,
  };
}

/** Docker prints JSON with 4-space indents and no HTML escaping. */
export function jsonLines(value: unknown): string[] {
  return JSON.stringify(value, null, 4).split('\n');
}
