// Night shift drills (Docker): something is broken in the kitchen; the learner fixes it.
// Drills are listed in src/content/courses/nightshift.ts. Every `verify` list runs in the
// engine and on a real Docker daemon (`npm run verify:docker`).
import type { KitchenScenario, KitchenStep } from '~/engine/kitchen-sim';
import { API_DOCKERFILE, API_PACKAGE, API_SERVER, WEB_DOCKERFILE } from './d4';

const NGINX = 'nginx:1.30-alpine';
const PG = 'postgres:18-alpine';

/** Kedai Kancil's repo after a `git pull`: the password now comes from .env, and the menu changed. */
const KEDAI = '/home/you/kedai-kancil';
const PULLED_COMPOSE = `services:
  web:
    build: ./web
    ports:
      - "8080:80"
  api:
    build: ./api
    environment:
      DB_HOST: db
  db:
    image: ${PG}
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD:?add DB_PASSWORD to .env}
    volumes:
      - db-data:/var/lib/postgresql

volumes:
  db-data:
`;
const KEDAI_FILES: KitchenStep[] = [
  { write: 'web/index.html', content: '<h1>Kedai Kancil</h1>\n' },
  { write: 'web/Dockerfile', content: WEB_DOCKERFILE },
  { write: 'api/server.js', content: API_SERVER },
  { write: 'api/package.json', content: API_PACKAGE },
  { write: 'api/Dockerfile', content: API_DOCKERFILE },
  { write: 'compose.yaml', content: PULLED_COMPOSE },
];

export const nightshift: KitchenScenario[] = [
  {
    // "Wrong hatch": web's hatch leads to port 8080 inside, but nginx listens on 80.
    id: 'ns-docker-wrong-hatch',
    images: [NGINX],
    steps: [`docker run -d --name web -p 8080:8080 ${NGINX}`],
    verify: [['docker ps', 'curl localhost:8080', 'docker port web', 'docker rm -f web', `docker run -d --name web -p 8080:80 ${NGINX}`, 'curl -sI localhost:8080']],
  },
  {
    // "Busy hatch": yesterday's old-web still holds hatch 8080. A run on 8080 fails and leaves web
    // behind as Created: remove it and run again. (Docker 29.9.2: a plain `docker start` of that
    // failed box comes up without its published port, so the drill teaches rm + run, like the rescue flow.)
    id: 'ns-docker-busy-hatch',
    images: [NGINX],
    steps: [`docker run -d --name old-web -p 8080:80 ${NGINX}`],
    verify: [['docker ps', `docker run -d --name web -p 8080:80 ${NGINX}`, 'docker ps -a', 'docker rm web', 'docker stop old-web', `docker run -d --name web -p 8080:80 ${NGINX}`, 'curl -sI localhost:8080']],
  },
  {
    // "No phone line": api and menu sit on the default bridge, where names don't resolve.
    id: 'ns-docker-no-name',
    images: [NGINX, 'alpine:3.22'],
    steps: [`docker run -d --name menu ${NGINX}`, 'docker run -d --name api alpine:3.22 sleep 3600'],
    verify: [['docker exec api wget -qO- menu', 'docker network create kedai-net', 'docker network connect kedai-net menu', 'docker network connect kedai-net api', 'docker exec api wget -qO- menu']],
  },
  {
    // "Box quits at once": a typo in timer's command (sleeep). Ends with a wait: the real
    // daemon needs a moment before the box shows Exited.
    id: 'ns-docker-quits',
    images: ['alpine:3.22'],
    steps: ['docker run -d --name timer alpine:3.22 sh -c "echo Timer on; sleeep 3600"', { wait: 3 }],
    verify: [['docker ps -a', 'docker logs timer', 'docker rm timer', 'docker run -d --name timer alpine:3.22 sleep 3600', 'docker ps']],
  },
  {
    // ★★★ incident "Kitchen blackout": after a restart, someone started the boxes again from memory.
    // web's hatch leads to port 8080 inside (nginx listens on 80), and api and web share no network.
    id: 'ns-docker-incident-restart',
    images: [NGINX, 'alpine:3.22'],
    steps: [`docker run -d --name web -p 8080:8080 ${NGINX}`, 'docker run -d --name api alpine:3.22 sleep 3600'],
    verify: [
      [
        'curl localhost:8080',
        'docker exec api wget -qO- web',
        'docker rm -f web',
        `docker run -d --name web -p 8080:80 ${NGINX}`,
        'docker network create kedai-net',
        'docker network connect kedai-net web',
        'docker network connect kedai-net api',
        'docker exec api wget -qO- web',
        'curl -sI localhost:8080',
      ],
    ],
  },

  // ---------------------------------------------------------------- Level Up drills (2026-11-01)
  {
    // ★ "No password": db was started without POSTGRES_PASSWORD, so Postgres exits 1 at once.
    id: 'ns-docker-no-password',
    images: [PG],
    steps: [`docker run -d --name db -v pgdata:/var/lib/postgresql ${PG}`, { wait: 3 }],
    verify: [['docker ps -a', 'docker logs db', 'docker rm db', `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`, 'sleep 10', 'docker exec db psql -U postgres -c "select 1"']],
  },
  {
    // ★★ "Old locker path": Postgres 18 with the old /var/lib/postgresql/data mount exits 1.
    // The fix mounts the volume at /var/lib/postgresql (18 keeps its data in 18/docker under it).
    id: 'ns-docker-pg18-path',
    images: [PG],
    steps: [`docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql/data ${PG}`, { wait: 3 }],
    verify: [['docker ps -a', 'docker logs db', 'docker rm db', `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`, 'sleep 10', 'docker exec db psql -U postgres -c "select 1"']],
  },
  {
    // ★★ "Read-only kitchen": nginx under --read-only can't make its cache folder and stops.
    // The fix keeps --read-only and gives nginx two small scratch folders (tmpfs).
    id: 'ns-docker-read-only',
    images: [NGINX],
    steps: [`docker run -d --name web --read-only -p 8080:80 ${NGINX}`, { wait: 3 }],
    verify: [['docker ps -a', 'docker logs web', 'docker rm web', `docker run -d --name web --read-only --tmpfs /var/cache/nginx --tmpfs /run -p 8080:80 ${NGINX}`, 'curl -sI localhost:8080']],
  },
  {
    // ★★ "Spaces in the env file": `NAME = value` is refused by --env-file. Nothing is created.
    id: 'ns-docker-env-file',
    images: [PG],
    steps: [{ write: 'db.env', content: 'POSTGRES_PASSWORD = devpass\n' }],
    verify: [
      [
        `docker run -d --name db --env-file db.env -v pgdata:/var/lib/postgresql ${PG}`,
        'echo "POSTGRES_PASSWORD=devpass" > db.env',
        `docker run -d --name db --env-file db.env -v pgdata:/var/lib/postgresql ${PG}`,
        'sleep 10',
        'docker exec db psql -U postgres -c "select 1"',
      ],
    ],
  },
  {
    // ★★★ incident "The 2 a.m. script": a new night script was never tried. It started db without
    // a password, and it never stopped yesterday's web-test box, which still holds hatch 8080.
    id: 'ns-docker-incident-night-script',
    images: [NGINX, PG],
    steps: [`docker run -d --name web-test -p 8080:80 ${NGINX}`, `docker run -d --name db -v pgdata:/var/lib/postgresql ${PG}`, { wait: 3 }],
    verify: [
      [
        'docker ps -a',
        `docker run -d --name web -p 8080:80 ${NGINX}`,
        'docker rm web',
        'docker stop web-test',
        `docker run -d --name web -p 8080:80 ${NGINX}`,
        'docker logs db',
        'docker rm db',
        `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`,
        'sleep 10',
        'docker exec db psql -U postgres -c "select 1"',
        'curl -sI localhost:8080',
      ],
    ],
  },
  {
    // ★★★ incident "Old menu after the pull": a git pull moved the db password to .env (there is
    // none on this laptop) and changed the menu page. `docker compose up -d` reuses the images it
    // built before, so the page stays old until a rebuild (--build).
    id: 'ns-docker-incident-pull',
    cwd: KEDAI,
    images: [NGINX, 'node:24-alpine', PG],
    steps: [...KEDAI_FILES, 'docker build -t kedai-kancil-web ./web', 'docker build -t kedai-kancil-api ./api', { write: 'web/index.html', content: '<h1>Kedai Kancil: new menu</h1>\n' }],
    settle: 2,
    verify: [['docker compose up -d', 'echo "DB_PASSWORD=devpass" > .env', 'docker compose up -d', 'curl -s localhost:8080', 'docker compose up -d --build', 'curl -s localhost:8080', 'docker compose down -v']],
  },
  {
    // ★★★ incident "Hardening night": both boxes were locked down at once, with no test run.
    // web: --read-only, so nginx can't make its cache folder. menu: --cap-drop ALL, so nginx can't
    // chown its cache folder or switch to its worker user. Keep the locks; add only what nginx needs.
    id: 'ns-docker-incident-hardening',
    images: [NGINX],
    steps: [`docker run -d --name web --read-only -p 8080:80 ${NGINX}`, `docker run -d --name menu --cap-drop ALL -p 8081:80 ${NGINX}`, { wait: 3 }],
    verify: [
      [
        'docker ps -a',
        'docker logs menu',
        'docker rm web',
        `docker run -d --name web --read-only --tmpfs /var/cache/nginx --tmpfs /run -p 8080:80 ${NGINX}`,
        'docker rm menu',
        `docker run -d --name menu --cap-drop ALL --cap-add CHOWN --cap-add SETGID --cap-add SETUID -p 8081:80 ${NGINX}`,
        'docker ps',
        'curl -sI localhost:8080',
        'curl -sI localhost:8081',
      ],
    ],
  },
  {
    // ★★★ incident "New laptop" (three faults): the shop moved, and its compose.yaml stayed behind.
    // Everything was typed again: web's hatch leads to 8080 inside (nginx listens on 80), db has no
    // password, and api and db share no network.
    id: 'ns-docker-incident-new-laptop',
    images: [NGINX, 'alpine:3.22', PG],
    steps: [`docker run -d --name web -p 8080:8080 ${NGINX}`, `docker run -d --name db -v pgdata:/var/lib/postgresql ${PG}`, 'docker run -d --name api alpine:3.22 sleep 3600', { wait: 3 }],
    verify: [
      [
        'docker exec api ping -c 1 db',
        'curl localhost:8080',
        'docker rm -f web',
        `docker run -d --name web -p 8080:80 ${NGINX}`,
        'docker rm db',
        `docker run -d --name db -e POSTGRES_PASSWORD=devpass -v pgdata:/var/lib/postgresql ${PG}`,
        'docker network create kedai-net',
        'docker network connect kedai-net db',
        'docker network connect kedai-net api',
        'sleep 10',
        'docker exec db psql -U postgres -c "select 1"',
        'curl -sI localhost:8080',
      ],
    ],
  },
];
