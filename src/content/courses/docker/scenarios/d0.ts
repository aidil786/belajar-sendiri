// World D0 "Start Here": the learner's laptop before Docker lessons begin. Each `verify` list runs
// in the engine and on a real Docker daemon (`npm run verify:docker`). See docs/AUTHORING.md
// "Kitchen engine (Docker)". Outputs that depend on the machine (kernel, os-release) stay out of
// the verify lists; lessons show them through the engine only.
import type { KitchenScenario } from '~/engine/kitchen-sim';

const SHOP_INDEX = '<h1>Kedai Kancil</h1>\n';
const SHOP_MENU = '<h1>Menu</h1>\n<p>Nasi lemak: RM5</p>\n';

export const d0: KitchenScenario[] = [
  {
    // L05 + boss: a brand-new laptop with Docker installed and running. Nothing pulled yet.
    id: 'd0-hello',
    steps: [],
    verify: [['docker version', 'docker run hello-world', 'echo $?', 'docker ps -a']],
  },
  {
    // L01 + L02: two small images already in the freezer, so rooms start at once.
    id: 'd0-rooms',
    images: ['alpine:3.22', 'nginx:1.30-alpine'],
    steps: [],
    verify: [
      ['docker run --rm alpine:3.22 echo hi', 'docker ps -a'],
      ['docker run -d --name shop -p 8080:80 nginx:1.30-alpine', 'docker ps', 'curl -sI localhost:8080', 'docker rm -f shop'],
    ],
  },
  {
    // L04 + L05: Docker is installed, but the engine (the daemon) is not running yet.
    // Engine-only (the truth check skips the dockerDown flag); the message is Docker 29's own.
    id: 'd0-down',
    steps: [{ flag: 'dockerDown' }],
    verify: [['docker version', 'docker ps']],
  },
  {
    // L06 Linux crash course: a kitchen folder with a menu, a script that can't run yet, a recipe folder.
    id: 'd0-linux',
    cwd: '/home/you/kitchen',
    images: ['nginx:1.30-alpine'],
    steps: [
      { write: 'menu.txt', content: 'nasi lemak\nlaksa\nsatay\n' },
      { write: 'cook.sh', content: 'echo Nasi lemak is ready\n' },
      { write: 'recipes/sambal.txt', content: 'chilli, onion, belacan\n' },
    ],
    verify: [
      ['pwd', 'ls', 'ls -l', 'cat menu.txt', './cook.sh', 'echo $?', 'chmod +x cook.sh', 'ls -l cook.sh', './cook.sh', 'echo $?'],
      ['export CHEF=Kancil', 'echo $CHEF', 'env', 'cat nope.txt', 'echo $?'],
      ['docker run -d --name stall nginx:1.30-alpine', 'ps aux', 'docker rm -f stall'],
    ],
  },
  {
    // L07 networking + boss puzzles: the shop is already open on hatch 8080 (nginx serving ./site).
    id: 'd0-net',
    cwd: '/home/you/shop',
    images: ['nginx:1.30-alpine'],
    steps: [
      { write: 'site/index.html', content: SHOP_INDEX },
      { write: 'site/menu.html', content: SHOP_MENU },
      'docker run -d --name shop -p 8080:80 -v /home/you/shop/site:/usr/share/nginx/html:ro nginx:1.30-alpine',
      { wait: 3 },
    ],
    // `curl -sS` in the lists: a piped curl prints its progress meter on the same line as the error.
    verify: [
      ['curl localhost:8080', 'curl 127.0.0.1:8080', 'curl -s localhost:8080/menu.html', 'curl -sI localhost:8080/sambal.html', 'curl localhost:9090', 'echo $?'],
      ['cat /etc/hosts', 'curl -sS http://kedai-kancil:8080', 'curl localhost:8080', 'curl -s localhost:8080/sambal.html'],
    ],
  },
];
