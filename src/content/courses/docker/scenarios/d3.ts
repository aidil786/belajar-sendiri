// World D3 "Lockers & Phone Lines": where data lives (writable layer, volumes, bind mounts, tmpfs,
// backups) and how containers talk (networks, names, publish vs expose, env files, secrets).
// Every `verify` list runs in the engine and on a real Docker daemon (`npm run verify:docker`).
// Postgres needs real time to start: lists that talk to it sleep first.
// A Postgres container without -v gets a nameless volume; verify lists remove those with `rm -fv`.
import type { KitchenScenario } from '~/engine/kitchen-sim';

const ALL = ['alpine:3.22', 'nginx:1.30-alpine', 'postgres:18-alpine'];
const PG_RUN = 'docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql postgres:18-alpine';
const PG_NET = 'docker run -d --name db --network shopnet -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql postgres:18-alpine';
const SQL_TABLE = 'docker exec db psql -U postgres -c "create table orders (id int, dish text)"';
const SQL_ROW = `docker exec db psql -U postgres -c "insert into orders values (1, 'nasi lemak')"`;
const SQL_SELECT = 'docker exec db psql -U postgres -c "select * from orders"';

const SITE_DOCKERFILE = `FROM nginx:1.30-alpine
COPY site/ /usr/share/nginx/html/
`;

const LEAKY_DOCKERFILE = `FROM nginx:1.30-alpine
ENV DB_PASSWORD=kancil123
COPY site/ /usr/share/nginx/html/
`;

const SHOP_ENV = `# Kedai Kancil settings
SHOP_NAME=Kedai Kancil
TZ=Asia/Kuala_Lumpur
CURRENCY=MYR

OPEN_HOUR=8
`;

export const d3: KitchenScenario[] = [
  {
    // L01: Aina keeps today's orders inside her nginx container (the writable layer).
    id: 'd3-kedai',
    images: ['nginx:1.30-alpine', 'alpine:3.22'],
    steps: ['docker run -d --name kedai nginx:1.30-alpine', 'docker exec kedai sh -c "echo nasi lemak > /orders.txt"'],
    verify: [
      ['docker exec kedai cat /orders.txt', 'docker restart kedai', 'docker exec kedai cat /orders.txt', 'docker ps'],
      ['docker rm -f kedai', 'docker run -d --name kedai nginx:1.30-alpine', 'docker exec kedai cat /orders.txt', 'docker exec kedai ls /orders.txt', 'docker ps -a'],
      ['docker exec kedai sh -c "echo teh tarik >> /orders.txt"', 'docker stop kedai', 'docker start kedai', 'docker exec kedai cat /orders.txt'],
    ],
  },
  {
    // An empty kitchen with the D3 images in the freezer: volumes, networks, Postgres from scratch.
    id: 'd3-fresh',
    images: ALL,
    steps: [],
    settle: 2,
    verify: [
      ['docker volume create pgdata', 'docker volume ls', 'docker volume inspect -f "{{.Name}} {{.Driver}}" pgdata', PG_RUN, 'sleep 10', SQL_TABLE, SQL_ROW, SQL_SELECT, 'docker volume rm pgdata', 'docker rm -f db', 'docker volume rm pgdata', 'docker volume ls'],
      ['docker network create shopnet', 'docker run -d --name menu --network shopnet nginx:1.30-alpine', 'docker run --rm --network shopnet alpine:3.22 wget -qO- http://menu', 'docker run --rm --network shopnet alpine:3.22 wget -qO- http://localhost', 'docker rm -f menu', 'docker network rm shopnet'],
      ['docker network create shopnet', 'docker volume create pgdata', PG_NET, 'docker run -d --name web --network shopnet -p 8080:80 nginx:1.30-alpine', 'sleep 10', SQL_TABLE, SQL_ROW, 'docker exec web wget -qO- http://localhost', 'curl -s localhost:8080', 'docker ps'],
      ['docker run -d --name app --tmpfs /tmp/cache alpine:3.22 sleep 3600', 'docker exec app sh -c "echo hot > /tmp/cache/menu.txt"', 'docker exec app cat /tmp/cache/menu.txt', 'docker restart app', 'docker exec app cat /tmp/cache/menu.txt', 'docker exec app ls /tmp/cache/menu.txt', 'docker rm -f app'],
      ['docker run --rm --network none alpine:3.22 ping -c 1 8.8.8.8', 'docker run --rm --network none alpine:3.22 wget -qO- http://example.com'],
    ],
  },
  {
    // L02 hook + boss hook: Postgres WITHOUT a volume, holding an orders table. A new container loses it.
    id: 'd3-pg-novolume',
    images: ['postgres:18-alpine'],
    steps: ['docker run -d --name db -e POSTGRES_PASSWORD=secret postgres:18-alpine', 'sleep 10', SQL_TABLE, SQL_ROW],
    settle: 2,
    verify: [
      ['docker exec db psql -U postgres -c "select * from orders;"', 'docker rm -fv db', 'docker run -d --name db -e POSTGRES_PASSWORD=secret postgres:18-alpine', 'sleep 10', SQL_SELECT, 'docker rm -fv db'],
    ],
  },
  {
    // L02 try + boss room 4: Postgres WITH the pgdata volume, holding an orders table.
    id: 'd3-pg-orders',
    images: ['postgres:18-alpine', 'alpine:3.22'],
    steps: ['docker volume create pgdata', PG_RUN, 'sleep 10', SQL_TABLE, SQL_ROW],
    settle: 2,
    verify: [
      ['docker rm -f db', 'docker volume ls', PG_RUN, 'sleep 5', SQL_SELECT, 'docker ps'],
      ['docker volume rm pgdata', 'docker rm -f db', 'docker volume rm pgdata', 'docker volume ls'],
      ['docker run --rm -v pgdata:/var/lib/postgresql alpine:3.22 ls /var/lib/postgresql/18/docker/PG_VERSION'],
    ],
  },
  {
    // L02 deeper: the old Postgres mount path. Postgres 18 refuses to start (exit 1, a real message).
    id: 'd3-pg-oldpath',
    images: ['postgres:18-alpine'],
    steps: [],
    settle: 3,
    verify: [['docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:18-alpine', 'sleep 3', 'docker ps -a', 'docker rm -fv db', 'docker volume rm pgdata']],
  },
  {
    // L03: the shop site on your laptop. Baked into an image it goes stale; a bind mount shows edits at once.
    id: 'd3-site',
    cwd: '/home/you/shop',
    images: ['nginx:1.30-alpine', 'alpine:3.22'],
    steps: [
      { write: 'site/index.html', content: '<h1>Kedai Kancil</h1>\n' },
      { write: 'Dockerfile', content: SITE_DOCKERFILE },
    ],
    verify: [
      ['docker build -t shop-site:1.0 .', 'docker run -d --name site -p 8080:80 shop-site:1.0', 'curl -s localhost:8080', 'echo "<h1>Kedai Kancil: open today</h1>" > site/index.html', 'curl -s localhost:8080', 'docker rm -f site'],
      ['docker run -d --name site -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx:1.30-alpine', 'curl -s localhost:8080', 'echo "<h1>Kedai Kancil: open today</h1>" > site/index.html', 'curl -s localhost:8080', 'docker exec site sh -c "echo hi > /usr/share/nginx/html/x.html"', 'docker rm -f site', 'cat site/index.html'],
      ['docker run -d --name site -p 8080:80 --mount type=bind,src=./site,dst=/usr/share/nginx/html,readonly nginx:1.30-alpine', 'curl -s localhost:8080', 'docker run --rm --mount type=bind,src=./nope,dst=/data alpine:3.22 ls /data', 'docker rm -f site'],
    ],
  },
  {
    // L03 hook: the same site baked into an image and running. Editing the laptop file changes nothing.
    id: 'd3-site-baked',
    cwd: '/home/you/shop',
    images: ['nginx:1.30-alpine'],
    steps: [
      { write: 'site/index.html', content: '<h1>Kedai Kancil</h1>\n' },
      { write: 'Dockerfile', content: SITE_DOCKERFILE },
      'docker build -t shop-site:1.0 .',
      'docker run -d --name site -p 8080:80 shop-site:1.0',
      'sleep 2', // a real nginx needs a moment before its first answer
    ],
    verify: [['curl -s localhost:8080', 'echo "<h1>Kedai Kancil: open today</h1>" > site/index.html', 'cat site/index.html', 'curl -s localhost:8080', 'docker ps']],
  },
  {
    // L04: the kedai-data locker holds the orders and the menu. Back it up into a bag on your laptop.
    id: 'd3-backup',
    images: ['alpine:3.22'],
    steps: ['docker run --rm -v kedai-data:/data alpine:3.22 sh -c "echo nasi lemak > /data/orders.txt; mkdir /data/menu; echo teh tarik > /data/menu/drinks.txt"'],
    verify: [
      ['docker volume inspect -f "{{.Mountpoint}}" kedai-data', 'docker run --rm -v kedai-data:/from -v "$PWD":/to alpine:3.22 tar czf /to/backup.tar.gz -C /from .', 'docker run --rm -v "$PWD":/backup alpine:3.22 tar tzf /backup/backup.tar.gz'],
      ['docker run --rm -v kedai-data:/from -v "$PWD":/to alpine:3.22 tar czvf /to/backup.tar.gz -C /from .', 'docker run --rm -v kedai-copy:/to -v "$PWD":/from alpine:3.22 tar xzvf /from/backup.tar.gz -C /to', 'docker run --rm -v kedai-copy:/data alpine:3.22 cat /data/orders.txt /data/menu/drinks.txt', 'docker volume ls'],
      ['docker run --rm -v kedai-data:/data -v "$PWD":/backup alpine:3.22 tar czf /backup/b.tgz /data', 'docker run --rm -v "$PWD":/from alpine:3.22 tar xzf /from/nope.tgz -C /tmp'],
    ],
  },
  {
    // L04 try: the locker is gone (laptop died, new machine); only backup.tar.gz is left. Restore it.
    id: 'd3-restore',
    images: ['alpine:3.22'],
    steps: [
      'docker run --rm -v kedai-data:/data alpine:3.22 sh -c "echo nasi lemak > /data/orders.txt; mkdir /data/menu; echo teh tarik > /data/menu/drinks.txt"',
      'docker run --rm -v kedai-data:/from -v "$PWD":/to alpine:3.22 tar czf /to/backup.tar.gz -C /from .',
      'docker volume rm kedai-data',
    ],
    verify: [
      ['docker volume ls', 'docker run --rm -v kedai-data:/to -v "$PWD":/from alpine:3.22 tar xzf /from/backup.tar.gz -C /to', 'docker run --rm -v kedai-data:/data alpine:3.22 cat /data/orders.txt', 'docker volume ls'],
      ['docker volume create kedai-data', 'docker run --rm -v kedai-data:/to -v "$PWD":/from alpine:3.22 tar xzvf /from/backup.tar.gz -C /to', 'docker run --rm -v kedai-data:/data alpine:3.22 ls /data'],
    ],
  },
  {
    // L05 hook: web and db on the default bridge. Names don't work there.
    id: 'd3-bridge',
    images: ALL,
    steps: ['docker run -d --name web nginx:1.30-alpine', 'docker run -d --name db -e POSTGRES_PASSWORD=secret postgres:18-alpine'],
    verify: [
      ['docker exec web ping -c 1 db', 'docker exec web wget -qO- http://db:5432', 'docker exec web wget -qO- http://db', 'docker rm -fv db'],
      ['docker network create shopnet', 'docker network connect shopnet web', 'docker network connect shopnet db', 'docker exec web sh -c "ping -c 1 db > /dev/null && echo found db"', 'docker rm -fv db', 'docker rm -f web', 'docker network rm shopnet'],
    ],
  },
  {
    // L05 check + L06: the shopnet line with the menu server on it; cache is off the line.
    id: 'd3-shopnet',
    images: ['alpine:3.22', 'nginx:1.30-alpine'],
    steps: ['docker network create shopnet', 'docker run -d --name menu --network shopnet nginx:1.30-alpine', 'docker run -d --name cache alpine:3.22 sleep 3600'],
    verify: [
      ['docker exec cache wget -qO- http://menu', 'docker network connect shopnet cache', 'docker exec cache sh -c "wget -qO- http://menu | grep title"', 'docker exec cache wget -qO- http://menu', 'docker network disconnect shopnet cache', 'docker exec cache wget -qO- http://menu'],
      ['docker run --rm --network shopnet alpine:3.22 wget -qO- http://localhost', 'docker run --rm --network shopnet alpine:3.22 wget -qO- http://menu', 'docker run --rm --network shopnet alpine:3.22 wget -qO- http://menu:8080', 'docker run --rm alpine:3.22 wget -qO- http://menu', 'docker rm -f menu', 'docker run --rm --network shopnet alpine:3.22 wget -qO- http://menu'],
    ],
  },
  {
    // L07: web runs with EXPOSE 80 but no published port. Publishing needs a new container.
    id: 'd3-expose',
    images: ['nginx:1.30-alpine', 'alpine:3.22'],
    steps: ['docker run -d --name web nginx:1.30-alpine'],
    verify: [
      ['docker ps', 'curl localhost:8080', 'docker port web', 'docker rm -f web', 'docker run -d --name web -p 8080:80 nginx:1.30-alpine', 'docker ps', 'docker port web', 'curl -s localhost:8080'],
      ['docker run -d --name api --expose 3000 alpine:3.22 sleep 3600', 'docker ps', 'docker rm -f api'],
      ['docker run -d --name hostbox --network host -p 8082:80 alpine:3.22 sleep 300', 'docker port hostbox', 'docker run --rm --network none alpine:3.22 ping -c 1 8.8.8.8', 'docker rm -f hostbox'],
      ['docker run -d --name web2 -p 127.0.0.1:8081:80 nginx:1.30-alpine', 'docker port web2', 'curl -s localhost:8081', 'docker rm -f web2'],
    ],
  },
  {
    // L08: shop settings on an env file card (and two cards with classic mistakes).
    id: 'd3-envfile',
    cwd: '/home/you/shop',
    images: ['alpine:3.22'],
    steps: [
      { write: 'shop.env', content: SHOP_ENV },
      { write: 'quoted.env', content: 'SHOP_NAME="Kedai Kancil"\n' },
      { write: 'spaces.env', content: 'SHOP_NAME = Kedai Kancil\n' },
    ],
    verify: [
      ['docker run --rm -e SHOP_NAME=Kedai -e TZ=Asia/Kuala_Lumpur -e CURRENCY=MYR -e OPEN_HOUR=8 alpine:3.22 env', 'docker run --rm --env-file shop.env alpine:3.22 env'],
      ['docker run -d --name app --env-file shop.env alpine:3.22 sleep 3600', 'docker exec app printenv SHOP_NAME', 'docker rm -f app'],
      ['docker run --rm --env-file quoted.env alpine:3.22 printenv SHOP_NAME', 'cat spaces.env', 'docker run --rm --env-file spaces.env alpine:3.22 env', 'docker run --rm --env-file nope.env alpine:3.22 env'],
    ],
  },
  {
    // L09 hook: a recipe with the password stirred in. docker history and inspect show it to anyone.
    id: 'd3-secret-baked',
    cwd: '/home/you/shop',
    images: ['nginx:1.30-alpine'],
    steps: [
      { write: 'site/index.html', content: '<h1>Kedai Kancil</h1>\n' },
      { write: 'Dockerfile', content: LEAKY_DOCKERFILE },
    ],
    verify: [
      ['cat Dockerfile', 'docker build -t shop:1.0 .', 'docker history --format "{{.CreatedBy}}" shop:1.0', 'docker run --rm shop:1.0 printenv DB_PASSWORD', 'docker inspect -f "{{.Config.Env}}" shop:1.0'],
    ],
  },
  {
    // L09 try: the password lives in db.env on the laptop, handed over at run time.
    id: 'd3-secret-runtime',
    cwd: '/home/you/shop',
    images: ['postgres:18-alpine'],
    steps: [{ write: 'db.env', content: 'POSTGRES_PASSWORD=kancil123\n' }],
    settle: 2,
    verify: [
      ['docker run -d --name db --env-file db.env -v pgdata:/var/lib/postgresql postgres:18-alpine', 'sleep 10', 'docker exec db psql -U postgres -c "select 1"', 'docker inspect -f "{{.Config.Env}}" postgres:18-alpine', 'docker rm -f db', 'docker volume rm pgdata'],
    ],
  },
  {
    // Boss room 2: the locker and the phone line are ready. Start Postgres on them and save an order.
    id: 'd3-boss-locker',
    images: ALL,
    steps: ['docker volume create pgdata', 'docker network create shopnet'],
    settle: 2,
    verify: [[PG_NET, 'sleep 10', SQL_TABLE, SQL_ROW, 'docker ps', 'docker volume ls']],
  },
  {
    // Boss room 3: db is up with the orders. Add the shop web on the same line, hatch 8080.
    id: 'd3-boss-db',
    images: ALL,
    steps: ['docker volume create pgdata', 'docker network create shopnet', PG_NET, 'sleep 10', SQL_TABLE, SQL_ROW],
    settle: 2,
    verify: [['docker run -d --name web --network shopnet -p 8080:80 nginx:1.30-alpine', 'curl -s localhost:8080', 'docker ps']],
  },
  {
    // Boss final room: the whole shop runs. Throw db away, start it again, the orders are still there.
    id: 'd3-boss-ready',
    images: ALL,
    steps: ['docker volume create pgdata', 'docker network create shopnet', PG_NET, 'docker run -d --name web --network shopnet -p 8080:80 nginx:1.30-alpine', 'sleep 10', SQL_TABLE, SQL_ROW],
    settle: 2,
    verify: [['docker rm -f db', 'docker ps -a', PG_NET, 'sleep 5', SQL_SELECT, 'docker ps', 'curl -s localhost:8080']],
  },
];
