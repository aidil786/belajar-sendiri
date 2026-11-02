// World D1 "First Containers": starting kitchens for the lessons and the Night shift boss.
// Every `verify` list runs in the engine and on a real Docker daemon (`npm run verify:docker`).
// Lesson 1 uses the example `d1-hello` (a laptop with an empty freezer).
import type { KitchenScenario } from '~/engine/kitchen-sim';

const NGINX = 'nginx:1.30-alpine';
const WEB = `docker run -d --name web -p 8080:80 ${NGINX}`;

// The night shift: three lunchboxes the day cook left broken. Scenarios with a box that stops at
// once end with { wait: 3 }: the real daemon needs a moment before that box shows Exited.
const WEB_WRONG_PORT = `docker run -d --name web -p 8080:8080 ${NGINX}`;
const TIMER_TYPO = 'docker run -d --name timer alpine:3.22 sh -c "echo Timer on; sleeep 3600"';
const TIMER_FIXED = 'docker run -d --name timer alpine:3.22 sleep 3600';
const DB_NO_PASSWORD = 'docker run -d --name db postgres:18-alpine';
const DB_FIXED = 'docker run -d --name db -e POSTGRES_PASSWORD=secret postgres:18-alpine';

export const d1: KitchenScenario[] = [
  {
    // L02, L03, L07, L08, L09: nginx and alpine are in the freezer. Nothing runs yet.
    id: 'd1-kitchen',
    images: [NGINX, 'alpine:3.22'],
    steps: [],
    verify: [
      // L02: one meal pack, two lunchboxes; a change inside one box stays in that box.
      ['docker images', `docker run -d --name lunch1 ${NGINX}`, `docker run -d --name lunch2 ${NGINX}`, 'docker ps', 'docker exec lunch1 rm /usr/share/nginx/html/index.html', 'docker exec lunch1 ls /usr/share/nginx/html', 'docker exec lunch2 ls /usr/share/nginx/html', 'docker rm -f lunch1 lunch2'],
      ['docker run alpine:3.22 echo hi', 'docker run alpine:3.22 echo hi', 'docker ps -a', 'docker images'],
      // L03: -d, --name, --rm, and a name that is already taken.
      [`docker run -d ${NGINX}`, `docker run -d --name web ${NGINX}`, 'docker ps', `docker run -d --name web ${NGINX}`, 'docker run --rm alpine:3.22 echo hi', 'docker ps -a'],
      // L07: the order hatch, and a hatch that is already taken.
      [WEB, 'docker port web', 'curl -sI localhost:8080', 'curl -s localhost:8080 | grep title', `docker run -d --name api -p 8080:80 ${NGINX}`, 'docker ps -a', 'docker rm api', `docker run -d --name api -p 8081:80 ${NGINX}`, 'docker ps', 'curl -s localhost:8081 | grep title', 'docker rm -f web api'],
      // L08: -e hands the box a setting.
      ['docker run --rm -e NAME=Aina alpine:3.22 printenv NAME', 'docker run --rm alpine:3.22 printenv NAME', 'docker run --rm --env NAME=Ben alpine:3.22 printenv NAME'],
      // L09: no tag means :latest; a tag that does not exist.
      ['docker pull nginx', 'docker images', 'docker pull nginx:9.9', WEB, 'curl -sI localhost:8080 | grep Server', 'docker rm -f web'],
    ],
  },
  {
    // L04: web runs; job printed one line and finished.
    id: 'd1-states',
    images: [NGINX, 'alpine:3.22'],
    steps: [`docker run -d --name web ${NGINX}`, 'docker run --name job alpine:3.22 echo "Lunch is ready"'],
    verify: [
      ['docker ps', 'docker ps -a', "docker inspect -f '{{.State.Status}}' web", "docker inspect -f '{{.State.ExitCode}}' job", 'docker logs job'],
      ['docker stop web', 'docker ps -a', 'docker start web', 'docker pause web', 'docker ps', 'docker unpause web', 'docker ps --filter status=exited', "docker inspect -f '{{.State.Status}}' web"],
    ],
  },
  {
    // L05: web serves on hatch 8080; timer stopped at once (a typo in its command).
    id: 'd1-logs',
    images: [NGINX, 'alpine:3.22'],
    steps: [WEB, TIMER_TYPO, { wait: 3 }],
    verify: [['docker ps -a', 'docker logs timer', 'docker logs -f timer', 'curl -s localhost:8080 | grep title', 'docker logs --tail 1 web']],
  },
  {
    // L06 (exec) and L07 (a busy hatch): web serves on hatch 8080.
    id: 'd1-web',
    images: [NGINX, 'alpine:3.22'],
    steps: [WEB],
    verify: [
      ['docker exec web ls /usr/share/nginx/html', 'docker exec web cat /etc/os-release', 'docker exec web cat /usr/share/nginx/html/50x.html', 'docker stop web', 'docker exec web ls'],
      [`docker run -d --name api -p 8080:80 ${NGINX}`, 'docker ps -a'],
    ],
  },
  {
    // L07 hook: web runs, but with no hatch to the laptop.
    id: 'd1-no-hatch',
    images: [NGINX],
    steps: [`docker run -d --name web ${NGINX}`],
    verify: [['docker ps', 'curl localhost:8080', 'docker port web', 'docker rm -f web', WEB, 'docker port web', 'curl -s localhost:8080 | grep title']],
  },
  {
    // L08 hook: Postgres in the freezer, nothing running.
    id: 'd1-pg',
    images: ['postgres:18-alpine', 'alpine:3.22'],
    steps: [],
    verify: [[DB_NO_PASSWORD, 'sleep 2', 'docker ps -a', 'docker logs db', 'docker rm db', DB_FIXED, 'docker ps', 'docker rm -f db']],
  },
  {
    // L08 try cards: db stopped at once because it has no password.
    id: 'd1-env',
    images: ['postgres:18-alpine', 'alpine:3.22'],
    steps: [DB_NO_PASSWORD, { wait: 3 }],
    verify: [['docker ps -a', 'docker logs db', 'docker rm db', DB_FIXED, 'docker ps']],
  },
  {
    // L10: an empty freezer. Pull from Docker Hub; a pack that doesn't exist.
    id: 'd1-hub',
    steps: [],
    verify: [['docker pull redis:8-alpine', 'docker images', 'docker pull nginx', 'docker pull kancil-practice/no-such-pack:1.0']],
  },
  {
    // L11: web runs; two old boxes finished; redis was pulled and never used.
    id: 'd1-messy',
    images: [NGINX, 'alpine:3.22', 'hello-world:latest', 'redis:8-alpine'],
    steps: [`docker run -d --name web ${NGINX}`, 'docker run --name old1 alpine:3.22 echo "Lunch is ready"', 'docker run --name old2 hello-world', { wait: 3 }],
    verify: [['docker ps -a', 'docker system df', 'docker rm web', 'docker rm old1', 'docker rmi hello-world', 'docker tag alpine:3.22 leftovers:1.0', 'docker rmi leftovers:1.0', 'docker ps -a']],
  },
  {
    // Boss, box 1 of 3: all three are broken. web's hatch leads to port 8080 inside, but nginx listens on 80.
    id: 'd1-night-1',
    images: [NGINX, 'alpine:3.22', 'postgres:18-alpine'],
    steps: [WEB_WRONG_PORT, TIMER_TYPO, DB_NO_PASSWORD, { wait: 3 }],
    verify: [['docker ps -a', 'curl localhost:8080', 'docker port web', 'docker rm -f web', WEB, 'curl -sI localhost:8080', 'docker ps']],
  },
  {
    // Boss, box 2: web is fixed. timer stops at once: a typo in its command.
    id: 'd1-night-2',
    images: [NGINX, 'alpine:3.22', 'postgres:18-alpine'],
    steps: [WEB, TIMER_TYPO, DB_NO_PASSWORD, { wait: 3 }],
    verify: [['docker ps -a', 'docker logs timer', 'docker rm timer', TIMER_FIXED, 'docker ps']],
  },
  {
    // Boss, box 3: web and timer are fixed. db stops at once: no password setting.
    id: 'd1-night-3',
    images: [NGINX, 'alpine:3.22', 'postgres:18-alpine'],
    steps: [WEB, TIMER_FIXED, DB_NO_PASSWORD, { wait: 3 }],
    verify: [['docker ps -a', 'docker logs db', 'docker rm db', DB_FIXED, 'docker ps']],
  },
  {
    // Boss, morning: all three run.
    id: 'd1-night-done',
    images: [NGINX, 'alpine:3.22', 'postgres:18-alpine'],
    steps: [WEB, TIMER_FIXED, DB_FIXED],
    verify: [['docker ps', 'curl -sI localhost:8080']],
  },
];
