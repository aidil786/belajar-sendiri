// World D2 "Recipes": Dockerfile scenarios. Every `verify` list runs in the engine and on a real
// Docker daemon (`npm run verify:docker`, VERIFY_ONLY=d2). Projects live in /home/you/<name>.
import type { KitchenScenario } from '~/engine/kitchen-sim';

const DIARY_HTML = '<h1>My diary</h1>\n<p>Day 1: I packed my site.</p>\n';
const DIARY_CSS = 'body { color: teal; }\n';

const API_SERVER = `const http = require('node:http');
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.end('Kedai Kancil API: menu ready\\n');
}).listen(port, () => console.log(\`API listening on port \${port}\`));
`;

const pkg = (name: string, scripts?: Record<string, string>) =>
  `${JSON.stringify({ name, version: '1.0.0', private: true, ...(scripts ? { scripts } : {}) }, null, 2)}\n`;
const lock = (name: string) =>
  `${JSON.stringify({ name, version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name, version: '1.0.0' } } }, null, 2)}\n`;

export const d2: KitchenScenario[] = [
  {
    // L01: the smallest recipe. FROM a base, COPY one file in, CMD says what to run.
    id: 'd2-l01',
    cwd: '/home/you/hello',
    images: ['node:24-alpine'],
    steps: [
      { write: 'hello.js', content: "console.log('Hello from Kedai Kancil!');\n" },
      { write: 'Dockerfile', content: 'FROM node:24-alpine\nCOPY hello.js /hello.js\nCMD ["node", "/hello.js"]\n' },
    ],
    verify: [
      ['docker build -t hello:1.0 .', 'docker images hello', 'docker run --rm hello:1.0', 'docker run --name hi hello:1.0', 'docker ps -a', 'docker rm hi'],
      ['docker build -t hello:1.0 .', "echo \"console.log('Hai lagi!');\" > hello.js", 'docker run --rm hello:1.0', 'docker build -t hello:1.1 .', 'docker run --rm hello:1.1'],
    ],
  },
  {
    // L02: WORKDIR, RUN, ENV and EXPOSE. EXPOSE is only a note: the hatch opens with -p.
    id: 'd2-l02',
    cwd: '/home/you/api',
    images: ['node:24-alpine'],
    steps: [
      { write: 'server.js', content: API_SERVER },
      { write: 'package.json', content: pkg('api') },
      { write: 'package-lock.json', content: lock('api') },
      {
        write: 'Dockerfile',
        content:
          'FROM node:24-alpine\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev\nCOPY server.js .\nENV PORT=3000\nEXPOSE 3000\nCMD ["node", "server.js"]\n',
      },
    ],
    verify: [
      ['docker build -t api:1.0 .', 'docker run --rm api:1.0 pwd', 'docker run --rm api:1.0 ls', 'docker run --rm api:1.0 printenv PORT'],
      ['docker build -t api:1.0 .', 'docker run -d --name api api:1.0', 'curl localhost:3000', 'docker run -d --name api2 -p 3000:3000 api:1.0', 'curl -s localhost:3000', 'docker logs api2', 'docker rm -f api api2'],
      ['docker build -t api:1.0 .', 'docker run -d --name api -e PORT=4000 -p 4000:4000 api:1.0', 'curl -s localhost:4000', 'docker logs api', 'docker rm -f api'],
    ],
  },
  {
    // L03: CMD is the default you can swap; ENTRYPOINT stays and gets your words added.
    id: 'd2-l03',
    cwd: '/home/you',
    images: ['alpine:3.22'],
    steps: [
      { write: 'sayer/Dockerfile', content: 'FROM alpine:3.22\nCMD ["echo", "Selamat datang!"]\n' },
      { write: 'greeter/Dockerfile', content: 'FROM alpine:3.22\nENTRYPOINT ["echo", "Selamat datang ke"]\nCMD ["Kedai Kancil"]\n' },
      { write: 'shouter/Dockerfile', content: 'FROM alpine:3.22\nCMD echo "Selamat datang!"\n' },
      'docker build -t say:1.0 sayer',
      'docker build -t greet:1.0 greeter',
    ],
    verify: [
      ['docker run --rm say:1.0', 'docker run --rm say:1.0 echo Hai'],
      ['docker run --rm greet:1.0', 'docker run --rm greet:1.0 Pasar Seni', 'docker run --rm --entrypoint whoami greet:1.0'],
      ['docker build -t shout:1.0 shouter', 'docker run --rm shout:1.0'],
    ],
  },
  {
    // L04: ARG lives only while baking; ENV stays in the pack.
    id: 'd2-l04',
    cwd: '/home/you/menu',
    images: ['alpine:3.22'],
    steps: [
      {
        write: 'Dockerfile',
        content: 'FROM alpine:3.22\nARG SHOP=kancil\nENV GREETING="Selamat datang"\nRUN echo "Menu for $SHOP" > /menu.txt\nCMD ["cat", "/menu.txt"]\n',
      },
    ],
    verify: [
      ['docker build -t menu:1.0 .', 'docker run --rm menu:1.0', 'docker run --rm menu:1.0 printenv GREETING', 'docker run --rm menu:1.0 printenv SHOP'],
      ['docker build --build-arg SHOP=pasar -t menu:pasar .', 'docker run --rm menu:pasar', 'docker run --rm -e GREETING=Hai menu:pasar printenv GREETING'],
    ],
  },
  {
    // L05: the build context is the whole folder. .dockerignore leaves notes at home.
    id: 'd2-l05',
    cwd: '/home/you/diary',
    images: ['nginx:1.30-alpine'],
    steps: [
      { write: 'index.html', content: DIARY_HTML },
      { write: 'style.css', content: DIARY_CSS },
      { write: 'notes.txt', content: 'My secret notes: crush on Amir.\n' },
      { write: 'Dockerfile', content: 'FROM nginx:1.30-alpine\nCOPY . /usr/share/nginx/html/\n' },
    ],
    verify: [
      ['docker build -t diary:1.0 .', 'docker run -d --name web -p 8080:80 diary:1.0', 'curl -s localhost:8080', 'curl -s localhost:8080/notes.txt', 'docker rm -f web'],
      ['echo "notes.txt" > .dockerignore', 'docker build -t diary:1.1 .', 'docker run -d --name web -p 8080:80 diary:1.1', 'curl -s localhost:8080/notes.txt', 'curl -s localhost:8080/style.css', 'docker rm -f web'],
    ],
  },
  {
    // L06: kek lapis. Package files and npm ci first, code last: a code change bakes one layer.
    id: 'd2-l06',
    cwd: '/home/you/api',
    images: ['node:24-alpine'],
    steps: [
      { write: 'server.js', content: API_SERVER },
      { write: 'package.json', content: pkg('api') },
      { write: 'package-lock.json', content: lock('api') },
      { write: '.dockerignore', content: 'node_modules\n' },
      {
        write: 'Dockerfile',
        content: 'FROM node:24-alpine\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev\nCOPY . .\nCMD ["node", "server.js"]\n',
      },
      'docker build -t api:1.0 .',
    ],
    verify: [
      ['docker build -t api:1.0 .', 'echo "// v2" >> server.js', 'docker build -t api:1.1 .', 'docker run -d --name api -p 3000:3000 api:1.1', 'curl -s localhost:3000', 'docker rm -f api'],
    ],
  },
  {
    // L07: one image, many names. SemVer for people, the Git SHA for machines. Labels for facts.
    id: 'd2-l07',
    cwd: '/home/you/diary',
    images: ['nginx:1.30-alpine'],
    steps: [
      { write: 'index.html', content: DIARY_HTML },
      { write: 'style.css', content: DIARY_CSS },
      { write: 'Dockerfile', content: 'FROM nginx:1.30-alpine\nLABEL org.opencontainers.image.title="My diary"\nCOPY index.html style.css /usr/share/nginx/html/\n' },
    ],
    verify: [
      ['docker build -t diary:1.2.0 -t diary:sha-3f2a9c1 .', 'docker images diary', 'docker tag diary:1.2.0 diary:1.2', 'docker images diary', 'docker inspect --format "{{json .Config.Labels}}" diary:1.2.0'],
      ['docker build --label org.opencontainers.image.version=1.2.0 -t diary:1.2.0 .', 'docker inspect --format "{{json .Config.Labels}}" diary:1.2.0', 'docker rmi diary:1.2.0', 'docker images diary'],
    ],
  },
  {
    // L08: multi-stage. The build stage has Node and npm; the served image has only nginx and dist/.
    id: 'd2-l08',
    cwd: '/home/you/kedai',
    images: ['node:24-alpine', 'nginx:1.30-alpine'],
    steps: [
      { write: 'index.html', content: '<h1>Kedai Kancil</h1>\n<p>Nasi lemak RM5</p>\n' },
      { write: 'package.json', content: pkg('kedai', { build: 'mkdir -p dist && cp index.html dist/' }) },
      { write: 'package-lock.json', content: lock('kedai') },
      { write: '.dockerignore', content: 'node_modules\ndist\n' },
      {
        write: 'Dockerfile',
        content:
          'FROM node:24-alpine AS build\nWORKDIR /src\nCOPY package.json package-lock.json ./\nRUN npm ci\nCOPY index.html .\nRUN npm run build\n\nFROM nginx:1.30-alpine\nCOPY --from=build /src/dist/ /usr/share/nginx/html/\n',
      },
    ],
    verify: [
      ['docker build -t kedai:1.0 .', 'docker images kedai', 'docker run -d --name web -p 8080:80 kedai:1.0', 'curl -s localhost:8080', 'docker run --rm kedai:1.0 which npm', 'docker rm -f web'],
      ['docker build --target build -t kedai:build .', 'docker build -t kedai:1.0 .', 'docker images kedai', 'docker run --rm kedai:build which npm'],
    ],
  },
  {
    // L09: same app, different bases. Debian nginx vs Alpine nginx.
    id: 'd2-l09',
    cwd: '/home/you/diary',
    images: ['nginx:latest', 'nginx:1.30-alpine'],
    steps: [
      { write: 'index.html', content: DIARY_HTML },
      { write: 'Dockerfile', content: 'ARG BASE=nginx:latest\nFROM ${BASE}\nCOPY index.html /usr/share/nginx/html/\n' },
    ],
    verify: [
      ['docker build -t diary:debian .', 'docker build --build-arg BASE=nginx:1.30-alpine -t diary:alpine .', 'docker images diary'],
    ],
  },
  {
    // L10: who runs the app? root, until USER says otherwise.
    id: 'd2-l10',
    cwd: '/home/you/api',
    images: ['node:24-alpine'],
    steps: [
      { write: 'server.js', content: API_SERVER },
      { write: 'Dockerfile', content: 'FROM node:24-alpine\nWORKDIR /app\nCOPY server.js .\nEXPOSE 3000\nCMD ["node", "server.js"]\n' },
      { write: 'oops/Dockerfile', content: 'FROM node:24-alpine\nUSER node\nRUN apk add --no-cache curl\n' },
      'docker build -t api:1.0 .',
    ],
    verify: [
      ['docker run --rm api:1.0 whoami', 'echo "USER node" >> Dockerfile', 'docker build -t api:1.1 .', 'docker run --rm api:1.1 whoami', 'docker run -d --name api -p 3000:3000 api:1.1', 'curl -s localhost:3000', 'docker rm -f api'],
      ['docker build -t api:oops oops'],
    ],
  },
  {
    // L11: HEALTHCHECK. A box can be "Up" and still broken; the check says healthy or unhealthy.
    id: 'd2-l11',
    cwd: '/home/you/diary',
    images: ['nginx:1.30-alpine'],
    settle: 2,
    steps: [
      { write: 'index.html', content: DIARY_HTML },
      { write: 'Dockerfile', content: 'FROM nginx:1.30-alpine\nCOPY index.html /usr/share/nginx/html/\nHEALTHCHECK --interval=5s --timeout=3s \\\n  CMD curl -fs http://localhost/ || exit 1\n' },
      { write: 'broken/index.html', content: DIARY_HTML },
      { write: 'broken/Dockerfile', content: 'FROM nginx:1.30-alpine\nCOPY index.html /usr/share/nginx/html/\nHEALTHCHECK --interval=5s --timeout=3s \\\n  CMD curl -fs http://localhost/health || exit 1\n' },
    ],
    verify: [
      ['docker build -t diary:1.0 .', 'docker run -d --name web -p 8080:80 diary:1.0', 'sleep 8', 'docker inspect --format "{{.State.Health.Status}}" web', 'docker rm -f web'],
      ['docker build -t diary:broken broken', 'docker run -d --name web diary:broken', 'sleep 20', 'docker inspect --format "{{.State.Health.Status}}" web', 'docker rm -f web'],
    ],
  },
  {
    // L12: build secrets never land in a layer. ARG does: docker history shows it.
    id: 'd2-l12',
    cwd: '/home/you/api',
    images: ['node:24-alpine'],
    steps: [
      { write: 'package.json', content: pkg('api') },
      { write: 'package-lock.json', content: lock('api') },
      { write: '.npmrc', content: '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' },
      { write: 'token.txt', content: 'test-token-123\n' },
      { write: '.dockerignore', content: 'token.txt\nnode_modules\n' },
      {
        write: 'Dockerfile',
        content:
          'FROM node:24-alpine\nWORKDIR /app\nCOPY package.json package-lock.json .npmrc ./\nRUN --mount=type=secret,id=npm_token,env=NPM_TOKEN,required=true npm ci\n',
      },
      { write: 'leak/package.json', content: pkg('api') },
      { write: 'leak/package-lock.json', content: lock('api') },
      { write: 'leak/.npmrc', content: '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' },
      { write: 'leak/Dockerfile', content: 'FROM node:24-alpine\nARG NPM_TOKEN\nWORKDIR /app\nCOPY package.json package-lock.json .npmrc ./\nRUN npm ci\n' },
      { write: 'cache/package.json', content: pkg('api') },
      { write: 'cache/package-lock.json', content: lock('api') },
      { write: 'cache/Dockerfile', content: 'FROM node:24-alpine\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN --mount=type=cache,target=/root/.npm npm ci\n' },
    ],
    verify: [
      ['docker build --build-arg NPM_TOKEN=test-token-123 -t leaky:1.0 leak', 'docker history --format "{{.CreatedBy}}" leaky:1.0'],
      // The failing build gets its own list: whether BuildKit caches WORKDIR/COPY before the RUN fails is a race.
      ['docker build -t api:1.0 .'],
      ['docker build --secret id=npm_token,src=token.txt -t api:1.0 .', 'docker build --secret id=npm_token,src=token.txt -t api:1.0 .', 'docker history --format "{{.CreatedBy}}" api:1.0'],
      ['docker build -t api:cache cache', 'docker history --format "{{.CreatedBy}}" api:cache'],
    ],
  },
  {
    // L13: one tag, two CPU types. The laptop is amd64 (engine-only: an arm64 build here needs QEMU on the real side).
    id: 'd2-l13',
    cwd: '/home/you/hello',
    images: ['alpine:3.22'],
    steps: [
      { write: 'hello.txt', content: 'Hello from Kedai Kancil!\n' },
      { write: 'Dockerfile', content: 'FROM alpine:3.22\nCOPY hello.txt /hello.txt\nCMD ["cat", "/hello.txt"]\n' },
    ],
    verify: [['docker build --platform linux/amd64 -t hello:amd64 .', 'docker run --rm hello:amd64', 'docker inspect --format "{{.Architecture}}" hello:amd64']],
  },
  {
    // Boss 1: pack the diary site on the big Debian nginx. It works, but it is heavy.
    id: 'd2-boss-pack',
    cwd: '/home/you/diary',
    images: ['nginx:latest', 'nginx:1.30-alpine'],
    // The Debian nginx can take a few seconds to answer on a busy daemon (hence the sleep below).
    settle: 2,
    steps: [
      { write: 'index.html', content: DIARY_HTML },
      { write: 'style.css', content: DIARY_CSS },
      { write: 'notes.txt', content: 'My secret notes: crush on Amir.\n' },
      { write: 'Dockerfile', content: 'ARG BASE=nginx:latest\nFROM ${BASE}\nCOPY . /usr/share/nginx/html/\n' },
    ],
    verify: [
      ['docker build -t diary:1.0 .', 'docker run -d --name web -p 8080:80 diary:1.0', 'sleep 3', 'curl -s localhost:8080', 'docker images diary', 'docker rm -f web'],
      ['echo "notes.txt" > .dockerignore', 'docker build --build-arg BASE=nginx:1.30-alpine -t diary:2.0 .', 'docker images diary', 'docker run -d --name web -p 8080:80 diary:2.0', 'curl -s localhost:8080/notes.txt', 'docker rm -f web'],
    ],
  },
  {
    // Boss 2: small and non-root. nginx may write its cache and pid file; USER nginx is the last step.
    id: 'd2-boss-nonroot',
    cwd: '/home/you/diary',
    images: ['nginx:1.30-alpine'],
    steps: [
      { write: 'index.html', content: DIARY_HTML },
      { write: 'style.css', content: DIARY_CSS },
      { write: 'notes.txt', content: 'My secret notes: crush on Amir.\n' },
      { write: '.dockerignore', content: 'notes.txt\nDockerfile\n.dockerignore\n' },
      {
        write: 'Dockerfile',
        content:
          'FROM nginx:1.30-alpine\nCOPY . /usr/share/nginx/html/\n# nginx needs to write here as a normal user\nRUN chown -R nginx:nginx /var/cache/nginx \\\n && touch /run/nginx.pid && chown nginx:nginx /run/nginx.pid\n',
      },
      { write: 'quick/Dockerfile', content: 'FROM nginx:1.30-alpine\nUSER nginx\n' },
    ],
    verify: [
      ['docker build -t diary:3.0 .', 'docker run --rm diary:3.0 whoami', 'echo "USER nginx" >> Dockerfile', 'docker build -t diary:3.1 .', 'docker run -d --name web -p 8080:80 diary:3.1', 'curl -s localhost:8080', 'docker exec web whoami', 'docker logs web', 'docker rm -f web'],
      ['docker build -t diary:quick quick', 'docker run -d --name web diary:quick', 'docker ps -a', 'docker logs web', 'docker rm -f web'],
    ],
  },
];
