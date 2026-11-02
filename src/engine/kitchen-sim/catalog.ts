// The built-in registry ("the shop freezer"): official images measured on Docker Engine 29.9.2,
// plus what each one does when it runs. Sizes, ids, layers, config and history are real
// (catalog-data.ts); files and users below were read from the real images.
import { MEASURED } from './catalog-data';
import { parseIso, parseSize } from './format';
import type { CatalogEntry, FileMap, ImageKind, LocalImage } from './types';

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
Further configuration is required for the web server, reverse proxy, 
API gateway, load balancer, content cache, or other features.</p>

<p>For online documentation and support please refer to
<a href="https://nginx.org/">nginx.org</a>.<br/>
To engage with the community please visit
<a href="https://community.nginx.org/">community.nginx.org</a>.<br/>
For enterprise grade support, professional services, additional 
security features and capabilities please refer to
<a href="https://f5.com/nginx">f5.com/nginx</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

export const NGINX_50X = `<!DOCTYPE html>
<html>
<head>
<title>Error</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>An error occurred.</h1>
<p>Sorry, the page you are looking for is currently unavailable.<br/>
Please try again later.</p>
<p>If you are the system administrator of this resource then you should check
the error log for details.</p>
<p><em>Faithfully yours, nginx.</em></p>
</body>
</html>
`;

export const NGINX_DEFAULT_CONF = `server {
    listen       80;
    server_name  localhost;

    #access_log  /var/log/nginx/host.access.log  main;

    location / {
        root   /usr/share/nginx/html;
        index  index.html index.htm;
    }

    #error_page  404              /404.html;

    # redirect server error pages to the static page /50x.html
    #
    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
        root   /usr/share/nginx/html;
    }

    # proxy the PHP scripts to Apache listening on 127.0.0.1:80
    #
    #location ~ \\.php$ {
    #    proxy_pass   http://127.0.0.1;
    #}

    # pass the PHP scripts to FastCGI server listening on 127.0.0.1:9000
    #
    #location ~ \\.php$ {
    #    root           html;
    #    fastcgi_pass   127.0.0.1:9000;
    #    fastcgi_index  index.php;
    #    fastcgi_param  SCRIPT_FILENAME  /scripts$fastcgi_script_name;
    #    include        fastcgi_params;
    #}

    # deny access to .htaccess files, if Apache's document root
    # concurs with nginx's one
    #
    #location ~ /\\.ht {
    #    deny  all;
    #}
}
`;

const alpineRelease = (v: string) => `NAME="Alpine Linux"
ID=alpine
VERSION_ID=${v}
PRETTY_NAME="Alpine Linux v${v.split('.').slice(0, 2).join('.')}"
HOME_URL="https://alpinelinux.org/"
BUG_REPORT_URL="https://gitlab.alpinelinux.org/alpine/aports/-/issues"
`;

const DEBIAN_RELEASE = `PRETTY_NAME="Debian GNU/Linux 13 (trixie)"
NAME="Debian GNU/Linux"
VERSION_ID="13"
VERSION="13 (trixie)"
VERSION_CODENAME=trixie
DEBIAN_VERSION_FULL=13.7
ID=debian
HOME_URL="https://www.debian.org/"
SUPPORT_URL="https://www.debian.org/support"
BUG_REPORT_URL="https://bugs.debian.org/"
`;

const ALPINE_DIRS = ['/bin', '/dev', '/etc', '/home', '/lib', '/media', '/mnt', '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var'];
const DEBIAN_DIRS = ['/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/media', '/mnt', '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var'];
const BUSYBOX_DIRS = ['/bin', '/dev', '/etc', '/home', '/lib', '/lib64', '/proc', '/root', '/sys', '/tmp', '/usr', '/var'];

/** BusyBox applets the tiny container shell knows. */
export const BUSYBOX_BINS = [
  'sh', 'ash', 'echo', 'ls', 'cat', 'env', 'printenv', 'sleep', 'id', 'whoami', 'hostname', 'ps', 'pwd', 'wget',
  'mkdir', 'touch', 'rm', 'date', 'uname', 'chmod', 'chown', 'which', 'true', 'false', 'test', 'head', 'tail',
  'grep', 'wc', 'cp', 'mv', 'ping', 'nslookup', 'df', 'du', 'kill', 'top', 'exit', 'cd', 'export', 'nc', 'tar',
];
// Debian slim images: coreutils, no wget/ps/ping (checked with `which` in the real images).
const DEBIAN_BINS = BUSYBOX_BINS.filter((b) => !['wget', 'ping', 'nslookup', 'nc', 'ps', 'top'].includes(b)).concat(['bash', 'apt-get', 'apt']);

interface Traits {
  kind: ImageKind;
  dirs: string[];
  files: FileMap;
  users: Record<string, [number, number]>;
  bins: string[];
}

const ROOT: Record<string, [number, number]> = { root: [0, 0], nobody: [65534, 65534] };

const TRAITS: Record<string, Traits> = {
  'hello-world:latest': { kind: 'hello', dirs: ['/'], files: { '/hello': '' }, users: {}, bins: ['hello'] },
  'alpine:3.22': {
    kind: 'alpine',
    dirs: ALPINE_DIRS,
    files: { '/etc/os-release': alpineRelease('3.22.7') },
    users: { ...ROOT, guest: [405, 100] },
    bins: [...BUSYBOX_BINS, 'apk'],
  },
  'busybox:1.37': { kind: 'busybox', dirs: BUSYBOX_DIRS, files: {}, users: { ...ROOT }, bins: BUSYBOX_BINS.filter((b) => b !== 'apk') },
  'nginx:1.30-alpine': {
    kind: 'nginx',
    dirs: [...ALPINE_DIRS, '/usr/share/nginx/html', '/etc/nginx', '/etc/nginx/conf.d', '/docker-entrypoint.d', '/var/log/nginx'],
    files: {
      '/etc/os-release': alpineRelease('3.24.3'),
      '/usr/share/nginx/html/index.html': NGINX_WELCOME,
      '/usr/share/nginx/html/50x.html': NGINX_50X,
      '/etc/nginx/conf.d/default.conf': NGINX_DEFAULT_CONF,
    },
    users: { ...ROOT, nginx: [101, 101] },
    bins: [...BUSYBOX_BINS, 'apk', 'curl', 'nginx'],
  },
  'nginx:latest': {
    kind: 'nginx',
    dirs: [...DEBIAN_DIRS, '/usr/share/nginx/html', '/etc/nginx', '/etc/nginx/conf.d', '/docker-entrypoint.d', '/var/log/nginx'],
    files: {
      '/etc/os-release': DEBIAN_RELEASE,
      '/usr/share/nginx/html/index.html': NGINX_WELCOME,
      '/usr/share/nginx/html/50x.html': NGINX_50X,
      '/etc/nginx/conf.d/default.conf': NGINX_DEFAULT_CONF,
    },
    users: { ...ROOT, nginx: [101, 101] },
    bins: [...DEBIAN_BINS, 'curl', 'nginx'],
  },
  'node:24-alpine': {
    kind: 'node',
    dirs: [...ALPINE_DIRS, '/home/node'],
    files: { '/etc/os-release': alpineRelease('3.24.3') },
    users: { ...ROOT, node: [1000, 1000] },
    bins: [...BUSYBOX_BINS, 'apk', 'node', 'npm', 'npx', 'yarn'],
  },
  'python:3.13-slim': {
    kind: 'python',
    dirs: DEBIAN_DIRS,
    files: { '/etc/os-release': DEBIAN_RELEASE },
    users: { ...ROOT },
    bins: [...DEBIAN_BINS, 'python', 'python3', 'pip', 'pip3'],
  },
  'postgres:18-alpine': {
    kind: 'postgres',
    dirs: [...ALPINE_DIRS, '/var/lib/postgresql', '/docker-entrypoint-initdb.d'],
    files: { '/etc/os-release': alpineRelease('3.24.3') },
    users: { ...ROOT, postgres: [70, 70] },
    bins: [...BUSYBOX_BINS, 'apk', 'postgres', 'psql', 'pg_isready', 'initdb', 'pg_dump'],
  },
  'redis:8-alpine': {
    kind: 'redis',
    dirs: [...ALPINE_DIRS, '/data'],
    files: { '/etc/os-release': alpineRelease('3.23.7') },
    users: { ...ROOT, redis: [999, 1000] },
    bins: [...BUSYBOX_BINS, 'apk', 'redis-server', 'redis-cli'],
  },
};

/** Exact version strings the images print. */
export const VERSIONS = {
  nginx: { '1.30-alpine': '1.30.6', latest: '1.31.8' } as Record<string, string>,
  node: 'v24.22.2',
  npm: '11.19.1',
  python: '3.13.18',
  postgres: '18.6',
  redis: '8.10.3',
};

export const CATALOG: Record<string, CatalogEntry> = Object.fromEntries(MEASURED.map((e) => [e.ref, e]));

/** Repos (docker.io/library/<name>) and the tags the freezer stocks. */
export function stockedTags(repo: string): string[] {
  return MEASURED.filter((e) => e.ref.split(':')[0] === repo).map((e) => e.ref.split(':')[1]!);
}

export function catalogRefs(): string[] {
  return MEASURED.map((e) => e.ref);
}

/** Build a local image record from a catalog entry (what `docker pull` stores). */
export function imageFromCatalog(ref: string): LocalImage {
  const e = CATALOG[ref];
  const t = TRAITS[ref];
  if (!e || !t) throw new Error(`Not in the catalog: ${ref}`);
  const created = parseIso(e.created);
  const [repo, tag] = ref.split(':');
  return {
    id: e.id,
    repoTags: [`docker.io/library/${repo}:${tag}`],
    repoDigests: [`${repo}@sha256:${e.id}`],
    created,
    config: structuredClone(e.config),
    history: e.history.map(([createdBy, size, comment, at]) => ({ createdBy, size: parseSize(size), sizeText: size, comment, created: parseIso(at) })),
    layers: [...e.diffIds],
    blobs: e.layers.map(([d]) => d),
    diskSize: parseSize(e.disk),
    contentSize: parseSize(e.content),
    diskText: e.disk,
    contentText: e.content,
    size: e.size,
    platform: 'linux/amd64',
    kind: t.kind,
    files: { ...t.files },
    dirs: [...t.dirs],
    users: { ...t.users },
    bins: [...t.bins],
    source: 'catalog',
    catalogRef: ref,
  };
}

export function catalogEntry(ref: string): CatalogEntry | undefined {
  return CATALOG[ref];
}
