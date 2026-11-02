// D5 "Ship & Shield" scenarios: the Kedai Kancil API packed as an image, shared through the
// practice registry (Docker Hub and ghcr.io), pinned, scanned and locked down.
// Scenarios with an `account`, `remoteImage` or `flag` step are engine-only (the fake registry);
// the others run their `verify` lists on a real daemon too (`npm run verify:docker`).
import type { KitchenScenario, KitchenStep } from '~/engine/kitchen-sim';

const NODE_DIGEST = 'sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85';

const PACKAGE_JSON = `{
  "name": "kedai-api",
  "version": "1.0.0",
  "private": true
}
`;

const SERVER_JS = `const http = require('node:http');
http.createServer((req, res) => res.end('Kedai Kancil API\\n')).listen(3000, () => console.log('API listening on port 3000'));
`;

/** The API recipe. `user` adds the USER line (non-root); `from` pins the base. */
function dockerfile({ user = true, from = 'node:24-alpine' } = {}): string {
  return [`FROM ${from}`, 'WORKDIR /app', 'COPY package.json server.js ./', ...(user ? ['USER node'] : []), 'EXPOSE 3000', 'CMD ["node", "server.js"]', ''].join('\n');
}

/** The API folder with its recipe. */
function apiFiles(opts: { user?: boolean; from?: string } = {}): KitchenStep[] {
  return [
    { write: 'Dockerfile', content: dockerfile(opts) },
    { write: 'package.json', content: PACKAGE_JSON },
    { write: 'server.js', content: SERVER_JS },
  ];
}

const ACCOUNT: KitchenStep = { account: { user: 'you', token: 'dckr_pat_PRACTICE_ONLY', password: 'rahsia123' } };
const GH_ACCOUNT: KitchenStep = { account: { user: 'you', token: 'ghp_PRACTICE_ONLY', password: 'rahsia123' } };

const LEAKY_DOCKERFILE = `FROM alpine:3.22
ARG SHOP_TOKEN
RUN echo "token=$SHOP_TOKEN" > /tmp/setup.conf && rm /tmp/setup.conf
ENV API_KEY=kk_live_8f2a
COPY menu.txt /app/menu.txt
CMD ["cat", "/app/menu.txt"]
`;

export const d5: KitchenScenario[] = [
  {
    // L01 hook: Mei's laptop. Nothing is in the freezer yet, so your image can't reach her.
    id: 'd5-mei-empty',
    steps: [],
  },
  {
    // L01 check: you pushed you/kedai-api:1.0; Mei pulls it.
    id: 'd5-mei',
    steps: [{ remoteImage: { ref: 'you/kedai-api:1.0', from: 'node:24-alpine' } }],
  },
  {
    // L01 try: the API is built and you are logged in to Docker Hub. Tag it with your name, push it.
    id: 'd5-freezer',
    cwd: '/home/you/kedai-api',
    images: ['node:24-alpine'],
    steps: [...apiFiles(), 'docker build -t kedai-api:1.0 .', ACCOUNT, 'export DOCKER_TOKEN=dckr_pat_PRACTICE_ONLY', 'echo $DOCKER_TOKEN | docker login -u you --password-stdin'],
    verify: [['docker push kedai-api:1.0', 'docker tag kedai-api:1.0 you/kedai-api:1.0', 'docker push you/kedai-api:1.0', 'docker images']],
  },
  {
    // L02: an account with a password and a token; the token waits in $DOCKER_TOKEN. Not logged in.
    id: 'd5-login',
    cwd: '/home/you/kedai-api',
    images: ['node:24-alpine'],
    steps: [...apiFiles(), 'docker build -t kedai-api:1.0 .', ACCOUNT, 'export DOCKER_TOKEN=dckr_pat_PRACTICE_ONLY'],
    verify: [['docker login -u you -p rahsia123', 'docker logout', 'echo $DOCKER_TOKEN | docker login -u you --password-stdin', 'docker tag kedai-api:1.0 you/kedai-api:1.0', 'docker push you/kedai-api:1.0']],
  },
  {
    // L03: kedai-api:latest is built. Build again after a change: latest moves.
    id: 'd5-tags',
    cwd: '/home/you/kedai-api',
    images: ['node:24-alpine'],
    steps: [...apiFiles(), 'docker build -t kedai-api:latest .'],
    verify: [
      ['echo "// v2" >> server.js', 'docker build -t kedai-api:latest .', 'docker run --rm kedai-api:latest whoami'],
      ['docker build -t kedai-api:1.4.2 -t kedai-api:sha-3f9c2e1 .', 'docker run --rm kedai-api:1.4.2 whoami', 'docker run --rm kedai-api:sha-3f9c2e1 cat /app/package.json'],
    ],
  },
  {
    // L04 see: a fresh laptop; pulling node:24-alpine prints its digest.
    id: 'd5-digest-pull',
    steps: [],
  },
  {
    // L04 try: the recipe pins its base by digest; the digest also waits in $PIN.
    id: 'd5-digest',
    cwd: '/home/you/kedai-api',
    images: ['node:24-alpine'],
    steps: [...apiFiles({ from: `node:24-alpine@${NODE_DIGEST}` }), `export PIN=${NODE_DIGEST}`],
    // (The real side runs each line in its own shell, so $PIN is spelled out here.)
    verify: [['cat Dockerfile', 'docker build -t kedai-api:1.0 .', 'docker run --rm kedai-api:1.0 whoami', `docker run --rm node:24-alpine@${NODE_DIGEST} node --version`]],
  },
  {
    // L05: Docker Hub says 429 to strangers. Logging in with the token lifts it.
    id: 'd5-pull-limit',
    steps: [{ flag: 'rateLimited' }, ACCOUNT, 'export DOCKER_TOKEN=dckr_pat_PRACTICE_ONLY'],
    verify: [['docker pull redis:8-alpine', 'echo $DOCKER_TOKEN | docker login -u you --password-stdin', 'docker pull redis:8-alpine']],
  },
  {
    // L08: the non-root API image is built; alpine is here for quick tests.
    id: 'd5-shield',
    cwd: '/home/you/kedai-api',
    images: ['alpine:3.22', 'node:24-alpine'],
    steps: [...apiFiles(), 'docker build -t kedai-api:1.0 .'],
    verify: [
      ['docker run --rm alpine:3.22 id', 'docker run --rm --user 1000 alpine:3.22 id', 'docker run --rm --read-only alpine:3.22 touch /hello', 'docker run --rm --cap-drop ALL alpine:3.22 chown nobody /tmp'],
      ['docker run -d --name api --read-only --cap-drop ALL -p 3000:3000 kedai-api:1.0', 'curl -s localhost:3000', 'docker exec api id', 'docker exec api touch /app/x', 'docker inspect -f "{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}" api', 'docker rm -f api'],
      // nginx starts as root and writes its cache: the shields need care (L08 check card).
      ['docker run --rm --read-only nginx:1.30-alpine', 'docker run --rm --read-only --tmpfs /var/cache/nginx nginx:1.30-alpine', 'docker run --rm --cap-drop ALL nginx:1.30-alpine', 'docker run -d --name web --read-only --tmpfs /var/cache/nginx --tmpfs /run -p 8080:80 nginx:1.30-alpine', 'curl -sI localhost:8080', 'docker ps -a'],
    ],
  },
  {
    // L09: a recipe that leaks a build arg and an ENV value into the image.
    id: 'd5-leaky',
    cwd: '/home/you/kedai',
    images: ['alpine:3.22'],
    steps: [{ write: 'Dockerfile', content: LEAKY_DOCKERFILE }, { write: 'menu.txt', content: 'nasi lemak\n' }, 'docker build --build-arg SHOP_TOKEN=tk_9b7c -t menu:1.0 .'],
    verify: [['docker history --no-trunc --format "{{.CreatedBy}}" menu:1.0', 'docker inspect -f "{{.Config.Env}}" menu:1.0', 'docker run --rm menu:1.0 printenv API_KEY', 'docker run --rm menu:1.0 ls /tmp']],
  },
  {
    // Boss room 1: the API image runs as root. Add USER node and build again.
    id: 'd5-boss-root',
    cwd: '/home/you/kedai-api',
    images: ['node:24-alpine'],
    steps: [...apiFiles({ user: false }), 'docker build -t kedai-api:1.0 .'],
    verify: [['docker run --rm kedai-api:1.0 whoami', 'echo "USER node" >> Dockerfile', 'docker build -t kedai-api:1.0 .', 'docker run --rm kedai-api:1.0 whoami', 'docker inspect -f "{{.Config.User}}" kedai-api:1.0']],
  },
  {
    // Boss room 3: the non-root image is built; a GitHub token (classic) waits in $CR_PAT.
    id: 'd5-boss-push',
    cwd: '/home/you/kedai-api',
    images: ['node:24-alpine'],
    steps: [...apiFiles(), 'docker build -t kedai-api:1.0 .', GH_ACCOUNT, 'export CR_PAT=ghp_PRACTICE_ONLY'],
    verify: [['echo $CR_PAT | docker login ghcr.io -u you --password-stdin', 'docker tag kedai-api:1.0 ghcr.io/you/kedai-api:1.0', 'docker push ghcr.io/you/kedai-api:1.0']],
  },
];
