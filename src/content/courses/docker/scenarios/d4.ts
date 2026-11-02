// World D4 "Set Meals" (Compose) scenarios. All of them live in /home/you/kedai-kancil, the same
// layout as capstone missions 1 and 2: web/ (static page served by nginx), api/ (a small Node
// API), each with its own Dockerfile, and compose.yaml with web, api, db (and sometimes cache).
// Every `verify` list runs in the engine and on a real Docker daemon (`npm run verify:docker`).
import type { KitchenScenario, KitchenStep } from '~/engine/kitchen-sim';

const DIR = '/home/you/kedai-kancil';
const IMAGES = ['nginx:1.30-alpine', 'node:24-alpine', 'postgres:18-alpine', 'redis:8-alpine'];

export const WEB_DOCKERFILE = `FROM nginx:1.30-alpine
COPY index.html /usr/share/nginx/html/
`;

export const API_SERVER = `const http = require('node:http');
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, shop: 'Kedai Kancil' }));
}).listen(port, () => console.log(\`API listening on port \${port}\`));
`;

export const API_PACKAGE = `{
  "name": "kedai-api",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  }
}
`;

export const API_DOCKERFILE = `FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
`;

/** The shop's two folders: web/ and api/, each with its recipe. */
const SHOP_FILES: KitchenStep[] = [
  { write: 'web/index.html', content: '<h1>Kedai Kancil</h1>\n' },
  { write: 'web/Dockerfile', content: WEB_DOCKERFILE },
  { write: 'api/server.js', content: API_SERVER },
  { write: 'api/package.json', content: API_PACKAGE },
  { write: 'api/Dockerfile', content: API_DOCKERFILE },
];

/** l01–l03, l08: web + api + db, the plain set meal. */
const SHOP = `services:
  web:
    build: ./web
    ports:
      - "8080:80"
  api:
    build: ./api
    environment:
      DB_HOST: db
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: example
    volumes:
      - db-data:/var/lib/postgresql

volumes:
  db-data:
`;

/** l04: the API waits until the database says it is ready. */
const HEALTHY = `services:
  web:
    build: ./web
    ports:
      - "8080:80"
    depends_on:
      - api
  api:
    build: ./api
    environment:
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: example
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 2s
      retries: 10
    volumes:
      - db-data:/var/lib/postgresql

volumes:
  db-data:
`;

/** l04: the same, but someone forgot the database password. Postgres exits at once. */
const SICK_DB = HEALTHY.replace('    environment:\n      POSTGRES_PASSWORD: example\n', '');

/** l05: the hatch number and the password come from variables. */
const ENV = `services:
  web:
    build: ./web
    ports:
      - "\${WEB_PORT:-8080}:80"
  api:
    build: ./api
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD:?add DB_PASSWORD to .env}
    volumes:
      - db-data:/var/lib/postgresql

volumes:
  db-data:
`;

/** l06: the cache only joins when you ask for the "cache" profile. */
const PROFILES = `services:
  web:
    build: ./web
    ports:
      - "8080:80"
  api:
    build: ./api
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: example
    volumes:
      - db-data:/var/lib/postgresql
  cache:
    image: redis:8-alpine
    profiles: [cache]

volumes:
  db-data:
`;

/** l07: what every kitchen shares. Dev extras and prod changes sit in their own files. */
const BASE = `services:
  web:
    build: ./web
    ports:
      - "8080:80"
  api:
    build: ./api
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: example
    volumes:
      - db-data:/var/lib/postgresql

volumes:
  db-data:
`;

export const DEV_OVERRIDE = `services:
  web:
    volumes:
      - ./web:/usr/share/nginx/html:ro
`;

export const PROD = `services:
  web:
    restart: unless-stopped
  api:
    restart: unless-stopped
  db:
    restart: unless-stopped
`;

/** l09: the API has no hatch of its own, so it can run many times. The web hatch is fixed. */
const SCALE = `services:
  web:
    build: ./web
    ports:
      - "8080:80"
  api:
    build: ./api
`;

/** l10: an old file with the obsolete version line. */
const OLD = `version: "3.8"
services:
  web:
    build: ./web
    ports:
      - "8080:80"
  api:
    build: ./api
`;

/** Boss: the whole shop, four services on two phone lines. The password must come from .env. */
const BOSS = `services:
  web:
    build: ./web
    ports:
      - "8080:80"
    networks: [front]
    depends_on:
      - api
  api:
    build: ./api
    environment:
      DB_HOST: db
    networks: [front, back]
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_healthy
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD:?add DB_PASSWORD to .env}
    networks: [back]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 2s
      retries: 10
    volumes:
      - db-data:/var/lib/postgresql
  cache:
    image: redis:8-alpine
    networks: [back]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      retries: 10

networks:
  front:
  back:

volumes:
  db-data:
`;

/** Capstone mission 1: the compose.yaml learners make with ComposeCanvas (dev password with a default). */
export const MISSION = `services:
  web:
    build: ./web
    ports:
      - "8080:80"
  api:
    build: ./api
    environment:
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD:-devpass}
    volumes:
      - db-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 5s
      retries: 10
volumes:
  db-data: {}
`;

/** Images already baked, so `docker compose up` doesn't print two builds (names = what Compose calls them). */
const BUILT: KitchenStep[] = ['docker build -t kedai-kancil-web ./web', 'docker build -t kedai-kancil-api ./api'];

const shop = (id: string, compose: string | null, extra: KitchenStep[] = [], rest: Partial<KitchenScenario> & { built?: boolean } = {}): KitchenScenario => {
  const { built = true, ...more } = rest;
  return {
    id,
    cwd: DIR,
    images: IMAGES,
    steps: [...SHOP_FILES, ...(compose ? [{ write: 'compose.yaml', content: compose }] : []), ...extra, ...(built && compose ? BUILT : [])],
    settle: 2,
    ...more,
  };
};

export const d4: KitchenScenario[] = [
  // l01: the long way (one docker run per dish), before Compose.
  shop('d4-many-runs', null, ['docker build -t kedai-web ./web', 'docker build -t kedai-api ./api'], {
    verify: [
      [
        'docker network create kedai-net',
        'docker run -d --name db --network kedai-net -e POSTGRES_PASSWORD=example -v db-data:/var/lib/postgresql postgres:18-alpine',
        'docker run -d --name api --network kedai-net -e DB_HOST=db kedai-api',
        'docker run -d --name web --network kedai-net -p 8080:80 kedai-web',
        'docker ps',
        'curl -s localhost:8080',
        'docker rm -f web api db',
        'docker network rm kedai-net',
        'docker volume rm db-data',
      ],
    ],
  }),
  // l01–l03, l08: the plain set meal.
  shop('d4-shop', SHOP, [], {
    verify: [
      ['docker compose up -d', 'docker compose ps', 'curl -s localhost:8080', 'docker compose logs api', 'docker compose exec -T web ls /usr/share/nginx/html', 'docker compose exec -T web wget -qO- http://api:3000', 'docker compose down', 'docker volume ls', 'docker compose down -v'],
      ['docker compose config --services', 'docker compose up -d', 'docker compose down', 'docker compose ps -a', 'docker compose up -d', 'docker compose ps', 'docker compose down -v', 'docker volume ls'],
      ['docker compose up -d', 'echo "<h1>Kedai Kancil: open!</h1>" > web/index.html', 'curl -s localhost:8080', 'docker compose restart web', 'curl -s localhost:8080', 'docker compose up -d --build', 'curl -s localhost:8080', 'docker compose down -v'],
    ],
  }),
  // l04: wait until the database is healthy.
  shop('d4-healthy', HEALTHY, [], {
    verify: [['docker compose up -d', 'docker compose ps', 'curl -s localhost:8080', 'docker compose down -v']],
  }),
  shop('d4-sick-db', SICK_DB, [], {
    verify: [['docker compose up -d', 'docker compose ps -a', 'docker compose logs db', 'docker compose down -v']],
  }),
  // l05: .env and ${VARIABLES}.
  shop('d4-env', ENV, [], {
    verify: [
      ['docker compose up -d', 'echo "DB_PASSWORD=devpass" > .env', 'docker compose config --services'],
      ['echo "DB_PASSWORD=devpass" > .env', 'echo "WEB_PORT=8080" >> .env', 'docker compose up -d', 'docker compose ps', 'curl -s localhost:8080', 'docker compose down -v'],
    ],
  }),
  // l06: profiles.
  shop('d4-profiles', PROFILES, [], {
    verify: [
      ['docker compose config --services', 'docker compose --profile cache config --services', 'docker compose up -d', 'docker compose ps', 'docker compose --profile cache up -d', 'docker compose ps', 'docker compose --profile cache down -v'],
      ['docker compose up -d cache', 'docker compose ps', 'docker compose exec -T cache redis-cli ping', 'docker compose --profile cache down -v'],
      // (down -v at the end: a Postgres locker that psql never touched isn't compared file by file.)
      ['docker compose --profile cache up -d', 'docker compose down', 'docker compose ps -a', 'docker compose --profile cache down -v', 'docker compose ps -a'],
    ],
  }),
  // l07: compose.override.yaml loads by itself; prod needs -f.
  shop('d4-override', BASE, [{ write: 'compose.override.yaml', content: DEV_OVERRIDE }, { write: 'compose.prod.yaml', content: PROD }], {
    verify: [
      ['docker compose up -d', 'curl -s localhost:8080', 'echo "<h1>Kedai Kancil: new menu</h1>" > web/index.html', 'curl -s localhost:8080', 'docker compose down -v'],
      ['docker compose -f compose.yaml -f compose.prod.yaml up -d', 'docker compose ps', 'echo "<h1>Kedai Kancil: new menu</h1>" > web/index.html', 'curl -s localhost:8080', 'docker compose -f compose.yaml -f compose.prod.yaml down -v'],
    ],
  }),
  // l09: many API containers, one web hatch.
  shop('d4-scale', SCALE, [], {
    verify: [
      ['docker compose up -d --scale api=3', 'docker compose ps', 'docker compose exec -T web wget -qO- http://api:3000', 'docker compose up -d --scale api=1', 'docker compose ps', 'docker compose down'],
      ['docker compose up -d', 'docker compose up -d --scale web=2', 'docker compose ps -a', 'docker compose down'],
    ],
  }),
  // l10: the old version line is ignored, with a warning.
  shop('d4-version', OLD, [], {
    verify: [['docker compose version', 'docker compose up -d', 'curl -s localhost:8080', 'docker compose down']],
  }),
  // Boss: one command, whole shop (after the password goes into .env).
  shop('d4-boss', BOSS, [], {
    verify: [
      ['docker compose up -d', 'echo "DB_PASSWORD=devpass" > .env', 'docker compose up -d', 'docker compose ps', 'curl -s localhost:8080', 'docker compose exec -T web wget -qO- http://api:3000', 'docker compose logs api', 'docker compose down', 'docker volume ls', 'docker compose down -v'],
    ],
  }),
  // Capstone mission 1: the learner's own repo (built from scratch, like a fresh machine).
  shop('d4-mission', MISSION, [], {
    built: false,
    verify: [
      ['docker compose config --services', 'docker compose up -d --build', 'docker compose ps', 'curl -s localhost:8080', 'docker compose exec -T web wget -qO- http://api:3000', 'docker compose down -v'],
      ['docker build -t web-check ./web', 'docker run -d --name webcheck -p 8080:80 web-check', 'curl -s localhost:8080', 'docker rm -f webcheck', 'docker build -t api-check ./api', 'docker run -d --name apicheck -p 3000:3000 api-check', 'curl -s localhost:3000', 'docker rm -f apicheck'],
    ],
  }),
];
