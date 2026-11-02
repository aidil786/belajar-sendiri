// The image catalog: which images exist (so typos fail like a real pull) and what their
// programs do. Only real public images, with behaviour checked against the real ones
// (nginx:1.29-alpine logs and pages were captured from Docker 29).
import type { Behavior } from './types';

export interface ImageInfo {
  /** Full reference, e.g. docker.io/library/nginx:1.29-alpine */
  ref: string;
  repo: string;
  tag: string;
  /** Compressed size in bytes (for the "Pulled" event). */
  size: number;
  /** Seconds a pull takes in the sim. */
  pull: number;
  /** Builds the program for a container. */
  program: (argv: string[] | null, env: Record<string, string>, files: Record<string, string>, podName: string) => Behavior;
}

const NGINX_VERSIONS: Record<string, string> = { '1.28': '1.28.0', '1.29': '1.29.8', '1.30': '1.30.6' };

function nginxVersion(tag: string): string {
  const m = /^(\d+\.\d+)(\.\d+)?/.exec(tag);
  if (m) return m[2] ? `${m[1]}${m[2]}` : (NGINX_VERSIONS[m[1]!] ?? `${m[1]}.0`);
  return tag.startsWith('stable') ? NGINX_VERSIONS['1.30']! : NGINX_VERSIONS['1.29']!;
}

export const NGINX_WELCOME = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, nginx is successfully installed and working.
Further configuration is required for the web server, reverse proxy,\x20
API gateway, load balancer, content cache, or other features.</p>

<p>For online documentation and support please refer to
<a href="https://nginx.org/">nginx.org</a>.<br/>
To engage with the community please visit
<a href="https://community.nginx.org/">community.nginx.org</a>.<br/>
For enterprise grade support, professional services, additional\x20
security features and capabilities please refer to
<a href="https://f5.com/nginx">f5.com/nginx</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

function nginx404(version: string): string {
  return `<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx/${version}</center>\r\n</body>\r\n</html>\r\n`;
}

const BASE: Omit<Behavior, 'process'> = {
  warmup: 0,
  ports: [],
  logs: [],
  memory: () => 1,
  cpu: 0,
  ignoresTerm: false,
  files: {},
  fileOps: [],
  tools: ['sh', 'cat', 'env', 'ls', 'echo', 'date', 'sleep', 'wget', 'nslookup', 'printenv', 'hostname'],
};

function nginxProgram(tag: string, files: Record<string, string>): Behavior {
  const version = nginxVersion(tag);
  const html = (p: string) => files[`/usr/share/nginx/html${p}`];
  const t = 0;
  return {
    ...BASE,
    warmup: 1,
    ports: [80],
    tools: [...BASE.tools, 'curl', 'nginx'],
    process: 'nginx -g daemon off;',
    memory: () => 3,
    cpu: 1,
    files,
    http: (path) => {
      const p = path.split('?')[0] || '/';
      const file = p.endsWith('/') ? `${p}index.html` : p;
      const custom = html(file);
      if (custom !== undefined) return { status: 200, body: custom };
      if (file === '/index.html' && !Object.keys(files).some((f) => f.startsWith('/usr/share/nginx/html/'))) return { status: 200, body: NGINX_WELCOME };
      return { status: 404, body: nginx404(version) };
    },
    logs: [
      '/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration',
      '/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/',
      '/docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh',
      '10-listen-on-ipv6-by-default.sh: info: Getting the checksum of /etc/nginx/conf.d/default.conf',
      '10-listen-on-ipv6-by-default.sh: info: Enabled listen on IPv6 in /etc/nginx/conf.d/default.conf',
      '/docker-entrypoint.sh: Sourcing /docker-entrypoint.d/15-local-resolvers.envsh',
      '/docker-entrypoint.sh: Launching /docker-entrypoint.d/20-envsubst-on-templates.sh',
      '/docker-entrypoint.sh: Launching /docker-entrypoint.d/30-tune-worker-processes.sh',
      '/docker-entrypoint.sh: Configuration complete; ready for start up',
      '@TIME [notice] 1#1: using the "epoll" event method',
      `@TIME [notice] 1#1: nginx/${version}`,
      '@TIME [notice] 1#1: start worker processes',
    ].map((text) => ({ at: t, text })),
  };
}

const PG_NO_PASSWORD = `Error: Database is uninitialized and superuser password is not specified.
       You must specify POSTGRES_PASSWORD to a non-empty value for the
       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".

       You may also use "POSTGRES_HOST_AUTH_METHOD=trust" to allow all
       connections without a password. This is *not* recommended.

       See PostgreSQL documentation about "trust":
       https://www.postgresql.org/docs/current/auth-trust.html`;

/** Run a small shell script (busybox sh): echo, sleep, exit, touch, rm, cat, env, date, httpd, loops. */
export function shellProgram(argv: string[], env: Record<string, string>, files: Record<string, string>, podName: string, tools: string[]): Behavior {
  const b: Behavior = { ...BASE, tools, files, process: argv.join(' '), logs: [], fileOps: [], ports: [], memory: () => 1 };
  let script: string;
  if (/^(\/bin\/)?(sh|ash|bash)$/.test(argv[0] ?? '') && argv[1] === '-c') script = argv.slice(2, 3).join(' ');
  else if (/^(\/bin\/)?(sh|ash|bash)$/.test(argv[0] ?? '') && argv.length === 1) {
    // A shell with no terminal reads nothing and exits at once.
    return { ...b, exitAfter: 0, exitCode: 0 };
  } else script = argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  const expand = (s: string) =>
    s.replace(/\$\{?(\w+)\}?/g, (_m, v: string) => (v === 'HOSTNAME' ? podName : (env[v] ?? '')));
  const unquote = (s: string) => s.replace(/^["']|["']$/g, '');
  let t = 0;
  let code = 0;
  let forever = false;
  const loop = /while\s+(true|:)\s*;\s*do\s+(.+?);?\s*done/.exec(script);
  if (loop) {
    const body = loop[2]!.split(/\s*(?:;|&&)\s*/);
    const echo = body.find((s) => s.startsWith('echo '));
    const sleep = body.map((s) => /^sleep\s+(\d+)/.exec(s)).find(Boolean);
    const before = script.slice(0, loop.index).replace(/;\s*$/, '');
    script = before;
    b.repeat = { every: sleep ? Number(sleep[1]) : 1, text: echo ? unquote(expand(echo.slice(5).trim())) : '' };
    forever = true;
  }
  const statements = script.split(/\s*(?:;|&&|\n)\s*/).filter(Boolean);
  for (const st of statements) {
    if (forever && !loop) break;
    const words = st.trim().split(/\s+/);
    const cmd = words[0]!;
    const rest = st.trim().slice(cmd.length).trim();
    code = 0;
    if (cmd === 'echo') b.logs.push({ at: t, text: unquote(expand(rest)) });
    else if (cmd === 'sleep') {
      if (/^(infinity|inf)$/.test(rest) || Number(rest) >= 86400) {
        forever = true;
        break;
      }
      t += Number(rest) || 0;
    } else if (cmd === 'exit') {
      code = Number(rest) || 0;
      return { ...b, exitAfter: t, exitCode: code, ignoresTerm: true };
    } else if (cmd === 'touch') b.fileOps.push({ at: t, op: 'touch', path: rest });
    else if (cmd === 'rm') b.fileOps.push({ at: t, op: 'rm', path: rest.replace(/^-\w+\s+/, '') });
    else if (cmd === 'cat') {
      const content = files[rest];
      if (content === undefined) {
        b.logs.push({ at: t, text: `cat: can't open '${rest}': No such file or directory` });
        code = 1;
      } else for (const l of content.replace(/\n$/, '').split('\n')) b.logs.push({ at: t, text: l });
    } else if (cmd === 'env' || (cmd === 'printenv' && !rest)) {
      for (const [k, v] of Object.entries({ HOSTNAME: podName, ...env })) b.logs.push({ at: t, text: `${k}=${v}` });
    } else if (cmd === 'printenv') {
      if (env[rest] !== undefined) b.logs.push({ at: t, text: env[rest]! });
      else code = 1;
    } else if (cmd === 'date') b.logs.push({ at: t, text: '@DATE' });
    else if (cmd === 'true' || cmd === ':') code = 0;
    else if (cmd === 'false') code = 1;
    else if (cmd === 'httpd') {
      const port = Number(/-p\s+(\d+)/.exec(rest)?.[1] ?? 80);
      b.ports = [port];
      b.http = () => ({ status: 404, body: '<HTML><HEAD><TITLE>404 Not Found</TITLE></HEAD>\n<BODY><H1>404 Not Found</H1>\nThe requested URL was not found\n</BODY></HTML>\n' });
      forever = true;
      break;
    } else if (cmd === 'nc' && /-l/.test(rest)) {
      b.ports = [Number(/-p\s+(\d+)/.exec(rest)?.[1] ?? 8080)];
      forever = true;
      break;
    } else if (cmd === 'tail' && /\/dev\/zero/.test(rest)) {
      // Reads endless zeroes looking for a line end: memory grows until the limit.
      const start = t;
      b.memory = (x) => 1 + Math.max(0, x - start) * 40;
      forever = true;
      break;
    } else if (cmd === 'tail' && /-f/.test(rest)) {
      forever = true;
      break;
    } else if (cmd === 'stress') {
      const bytes = /--vm-bytes\s+(\d+)([MG])/.exec(rest);
      const mb = bytes ? Number(bytes[1]) * (bytes[2] === 'G' ? 1000 : 1) : 256;
      b.logs.push({ at: t, text: 'stress: info: [1] dispatching hogs: 0 cpu, 0 io, 1 vm, 0 hdd' });
      const start = t;
      b.memory = (x) => (x >= start ? 1 + mb * 0.954 : 1);
      forever = true;
      break;
    } else {
      b.logs.push({ at: t, text: `sh: ${cmd}: not found` });
      code = 127;
    }
  }
  if (forever || loop) return { ...b, ignoresTerm: true };
  return { ...b, exitAfter: t, exitCode: code, ignoresTerm: true };
}

function daemon(process: string, memory: number, cpu: number, ports: number[] = []): Behavior {
  return { ...BASE, tools: [], process, memory: () => memory, cpu, ports, warmup: 1 };
}

interface RepoInfo {
  tags: RegExp;
  size: number;
  pull: number;
  program: ImageInfo['program'];
}

/** Kubernetes release tags that exist (a typo such as v1.37.00 fails to pull, like on a real node). */
const K8S_TAGS = /^v1\.3[0-7]\.(0|[1-9]\d?)$/;

const BUSYBOX_TOOLS = [...BASE.tools, 'httpd', 'nc', 'ping', 'top', 'ps'];

const REPOS: Record<string, RepoInfo> = {
  'docker.io/library/nginx': {
    tags: /^(1\.(2[4-9]|30)(\.\d+)?(-alpine(-slim)?|-bookworm|-perl|-trixie)?|alpine|alpine-slim|latest|mainline|mainline-alpine|stable|stable-alpine)$/,
    size: 22_400_000,
    pull: 3,
    program: (argv, env, files, pod) => (argv ? shellProgram(argv, env, files, pod, [...BASE.tools, 'curl']) : nginxProgram('1.29', files)),
  },
  'docker.io/library/busybox': {
    tags: /^(1\.3[4-7](\.\d+)?(-(musl|glibc|uclibc))?|latest|stable|musl|glibc|uclibc)$/,
    size: 2_150_000,
    pull: 1,
    program: (argv, env, files, pod) => shellProgram(argv ?? ['sh'], env, files, pod, BUSYBOX_TOOLS),
  },
  'docker.io/library/alpine': {
    tags: /^(3\.(1[89]|2[0-3])(\.\d+)?|latest|edge)$/,
    size: 3_800_000,
    pull: 1,
    program: (argv, env, files, pod) => shellProgram(argv ?? ['/bin/sh'], env, files, pod, BUSYBOX_TOOLS),
  },
  'registry.k8s.io/pause': {
    tags: /^3\.(9|10|10\.1)$/,
    size: 320_000,
    pull: 1,
    program: () => ({ ...BASE, tools: [], process: '/pause', memory: () => 0.2 }),
  },
  'docker.io/library/postgres': {
    tags: /^(1[5-8](\.\d+)?(-alpine(3\.\d+)?|-bookworm|-trixie)?|alpine|latest)$/,
    size: 110_000_000,
    pull: 6,
    program: (argv, env, files, pod) => {
      if (argv) return shellProgram(argv, env, files, pod, BASE.tools);
      if (!env.POSTGRES_PASSWORD && env.POSTGRES_HOST_AUTH_METHOD !== 'trust') {
        return { ...BASE, process: 'postgres', exitAfter: 0, exitCode: 1, logs: PG_NO_PASSWORD.split('\n').map((text) => ({ at: 0, text })) };
      }
      return {
        ...BASE,
        process: 'postgres',
        warmup: 3,
        ports: [5432],
        memory: () => 30,
        cpu: 2,
        logs: [{ at: 3, text: '@TIME UTC [1] LOG:  database system is ready to accept connections' }],
      };
    },
  },
  'docker.io/library/redis': {
    tags: /^([78](\.\d+)*(-alpine)?|alpine|latest)$/,
    size: 17_000_000,
    pull: 2,
    program: (argv, env, files, pod) =>
      argv
        ? shellProgram(argv, env, files, pod, BASE.tools)
        : { ...BASE, process: 'redis-server', warmup: 1, ports: [6379], memory: () => 4, cpu: 2, logs: [{ at: 0, text: '1:M @TIME * Ready to accept connections tcp' }] },
  },
  'docker.io/hashicorp/http-echo': {
    tags: /^(1\.0(\.\d+)?|latest)$/,
    size: 3_500_000,
    pull: 1,
    program: (argv) => {
      const args = argv ?? [];
      const text = args.map((a) => /^-text=(.*)$/.exec(a)?.[1]).find((x) => x !== undefined) ?? 'hello-world';
      const port = Number(args.map((a) => /^-listen=:?(\d+)$/.exec(a)?.[1]).find(Boolean) ?? 5678);
      return {
        ...BASE,
        tools: [],
        process: `/http-echo ${args.join(' ')}`.trim(),
        ports: [port],
        memory: () => 2,
        http: () => ({ status: 200, body: `${text}\n` }),
        logs: [{ at: 0, text: `@TIME [INFO] server is listening on :${port}` }],
      };
    },
  },
  // System components every cluster runs (already on the nodes).
  'registry.k8s.io/coredns/coredns': { tags: /.*/, size: 22_000_000, pull: 1, program: () => daemon('/coredns -conf /etc/coredns/Corefile', 18, 3, [53, 8080, 8181]) },
  'registry.k8s.io/kube-proxy': { tags: K8S_TAGS, size: 30_000_000, pull: 1, program: () => daemon('/usr/local/bin/kube-proxy', 20, 1) },
  'docker.io/kindest/kindnetd': { tags: /.*/, size: 15_000_000, pull: 1, program: () => daemon('/bin/kindnetd', 12, 1) },
  'registry.k8s.io/etcd': { tags: /^3\.[5-7]\.(0|[1-9]\d?)-0$/, size: 60_000_000, pull: 1, program: () => daemon('etcd', 45, 20, [2379]) },
  'registry.k8s.io/kube-apiserver': { tags: K8S_TAGS, size: 30_000_000, pull: 1, program: () => daemon('kube-apiserver', 260, 45, [6443]) },
  'registry.k8s.io/kube-controller-manager': { tags: K8S_TAGS, size: 28_000_000, pull: 1, program: () => daemon('kube-controller-manager', 55, 15) },
  'registry.k8s.io/kube-scheduler': { tags: K8S_TAGS, size: 20_000_000, pull: 1, program: () => daemon('kube-scheduler', 22, 4) },
  'registry.k8s.io/metrics-server/metrics-server': { tags: /.*/, size: 20_000_000, pull: 1, program: () => daemon('/metrics-server', 20, 4, [10250]) },
  'docker.io/kindest/local-path-provisioner': { tags: /.*/, size: 18_000_000, pull: 1, program: () => daemon('local-path-provisioner', 8, 1) },
  'docker.io/polinux/stress': {
    tags: /^(latest|1\.0\.4)$/,
    size: 4_000_000,
    pull: 1,
    program: (argv, env, files, pod) => shellProgram(argv ?? ['stress'], env, files, pod, BASE.tools),
  },
};

/** docker.io/library/nginx:1.29-alpine from "nginx:1.29-alpine". Tag defaults to latest. */
export function normalizeImage(image: string): { ref: string; repo: string; tag: string } {
  let name = image;
  let tag = 'latest';
  const at = name.indexOf('@');
  if (at >= 0) {
    tag = name.slice(at + 1);
    name = name.slice(0, at);
  } else {
    const colon = name.lastIndexOf(':');
    if (colon > name.lastIndexOf('/')) {
      tag = name.slice(colon + 1);
      name = name.slice(0, colon);
    }
  }
  const first = name.split('/')[0]!;
  const hasRegistry = name.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost');
  let repo = hasRegistry ? name : `docker.io/${name.includes('/') ? name : `library/${name}`}`;
  repo = repo.toLowerCase();
  return { ref: `${repo}:${tag}`, repo, tag };
}

/** The image if it exists in the catalog, or why a pull fails. */
export function lookupImage(image: string): { info: ImageInfo } | { error: 'notFound' | 'denied'; ref: string } {
  const { ref, repo, tag } = normalizeImage(image);
  const r = REPOS[repo];
  if (!r) return { error: 'denied', ref };
  if (tag.startsWith('sha256:') || !r.tags.test(tag)) return { error: 'notFound', ref };
  return { info: { ref, repo, tag, size: r.size, pull: r.pull, program: r.program } };
}

/** The message containerd gives when a pull fails (kind uses containerd). */
export function pullError(image: string): string {
  const res = lookupImage(image);
  const ref = 'ref' in res ? res.ref : normalizeImage(image).ref;
  const why =
    'error' in res && res.error === 'denied'
      ? 'pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed'
      : `${ref}: not found`;
  return `rpc error: code = ${'error' in res && res.error === 'denied' ? 'Unknown' : 'NotFound'} desc = failed to pull and unpack image "${ref}": failed to resolve reference "${ref}": ${why}`;
}

/** Build the program for a container spec (`command` replaces the entrypoint, `args` the default command). */
export function programFor(container: any, env: Record<string, string>, files: Record<string, string>, podName: string): Behavior | null {
  const found = lookupImage(String(container.image ?? ''));
  if (!('info' in found)) return null;
  const command: string[] | undefined = container.command?.map(String);
  const args: string[] | undefined = container.args?.map(String);
  let argv: string[] | null = null;
  if (command) argv = [...command, ...(args ?? [])];
  else if (args && !/\/(postgres|redis)$/.test(found.info.repo)) argv = args;
  return found.info.program(argv, env, files, podName);
}
