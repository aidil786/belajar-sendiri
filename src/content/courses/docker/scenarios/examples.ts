// Example kitchen scenarios: models for lesson writers. Each `verify` list runs in the engine
// and on a real Docker daemon (`npm run verify:docker`). See docs/AUTHORING.md "Kitchen engine".
import type { KitchenScenario } from '~/engine/kitchen-sim';

const DIARY_DOCKERFILE = `FROM nginx:1.30-alpine
WORKDIR /usr/share/nginx/html
COPY index.html .
COPY style.css .
EXPOSE 80
`;

const API_SERVER = `const http = require('node:http');
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, shop: 'Kedai Kancil' }));
}).listen(port, () => console.log(\`API listening on port \${port}\`));
`;

const API_DOCKERFILE = `FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
`;

const SHOP_COMPOSE = `services:
  web:
    image: nginx:1.30-alpine
    ports:
      - "\${WEB_PORT}:80"
    volumes:
      - ./site:/usr/share/nginx/html:ro
    depends_on:
      - api
  api:
    build: ./api
    environment:
      PORT: 3000
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - dbdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 2s
      retries: 10
  cache:
    image: redis:8-alpine
    profiles: [cache]

volumes:
  dbdata:
`;

export const examples: KitchenScenario[] = [
  {
    // D1: a brand-new laptop. hello-world is not pulled yet.
    id: 'd1-hello',
    steps: [],
    verify: [['docker run hello-world', 'docker ps -a'], ['docker run --rm hello-world', 'docker ps -a']],
  },
  {
    // D1: nginx is in the freezer already; run it, open the hatch, read logs, clean up. Also the classic faults.
    id: 'd1-nginx',
    images: ['nginx:1.30-alpine', 'alpine:3.22'],
    steps: [],
    verify: [
      ['docker run -d --name web -p 8080:80 nginx:1.30-alpine', 'docker ps', 'curl -s localhost:8080', 'curl -sI localhost:8080', 'docker logs web', 'docker port web', 'docker stop web', 'docker ps -a', 'docker rm web', 'docker ps -a'],
      ['docker run -d --name web -p 8080:80 nginx:1.30-alpine', 'docker run -d --name web2 -p 8080:80 nginx:1.30-alpine', 'docker ps -a', 'docker rm web2', 'docker rm web', 'docker rm -f web'],
      ['docker run -d --name web nginx:1.30-alpine', 'curl localhost:8080', 'docker exec web ls /usr/share/nginx/html', 'docker exec web cat /etc/os-release', 'docker rm -f web'],
      ['docker run -d --name box alpine:3.22', 'docker ps -a', 'docker logs box', 'docker run --rm alpine:3.22 sh -c "exit 3"', 'docker run --rm -e NAME=Ali alpine:3.22 printenv NAME', 'docker rm box'],
      ['docker run --rm alpine:3.22 nope', 'docker run --rm alpine:3.22 cat /nope', 'docker stop nope', 'docker logs nope'],
      ['docker pull nginx:1.30-alpine', 'docker pull nginx:9.9', 'docker run --rm nginx:9.9'],
    ],
  },
  {
    // D2: the diary site becomes an image. Change one file: only its layer and the ones after it are rebuilt.
    id: 'd2-diary-dockerfile',
    cwd: '/home/you/diary',
    images: ['nginx:1.30-alpine'],
    steps: [
      { write: 'index.html', content: '<h1>My diary</h1>\n' },
      { write: 'style.css', content: 'body { color: teal; }\n' },
      { write: 'notes.txt', content: 'my secret notes\n' },
      { write: '.dockerignore', content: 'notes.txt\n' },
      { write: 'Dockerfile', content: DIARY_DOCKERFILE },
    ],
    verify: [
      ['docker build -t diary:1.0 .', 'docker images diary', 'docker run -d --name diary -p 8080:80 diary:1.0', 'curl -s localhost:8080', 'curl -s localhost:8080/notes.txt', 'docker rm -f diary'],
      ['docker build -t diary:1.0 .', 'docker build -t diary:1.0 .', 'echo "body { color: hotpink; }" > style.css', 'docker build -t diary:1.1 .', 'docker history --format "{{.CreatedBy}}" diary:1.1'],
      ['docker build -t diary:1.0 .', 'docker tag diary:1.0 diary:latest', 'docker rmi diary:latest', 'docker rmi diary:1.0', 'docker images diary'],
    ],
  },
  {
    // D3: Postgres keeps its data in a named volume (Postgres 18: mount /var/lib/postgresql), so it survives docker rm.
    id: 'd3-postgres-volume',
    images: ['postgres:18-alpine', 'alpine:3.22'],
    steps: [],
    settle: 2,
    verify: [
      ['docker run --name pg postgres:18-alpine', 'docker ps -a', 'docker rm pg'],
      [
        'docker volume create pgdata',
        'docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql postgres:18-alpine',
        'sleep 10',
        'docker exec db psql -U postgres -c "create table notes (id int, text text)"',
        `docker exec db psql -U postgres -c "insert into notes values (1, 'hi')"`,
        'docker rm -f db',
        'docker run -d --name db2 -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql postgres:18-alpine',
        'sleep 3',
        'docker exec db2 psql -U postgres -c "select * from notes"',
        'docker volume ls',
        'docker volume rm pgdata',
        'docker rm -f db2',
        'docker volume rm pgdata',
      ],
      ['docker run --rm -u 1000 -v data:/data alpine:3.22 sh -c "echo hi > /data/x"', 'docker run --rm -v data:/data alpine:3.22 sh -c "echo hi > /data/x"', 'docker run --rm -v data:/data alpine:3.22 cat /data/x', 'docker volume rm data'],
      ['docker network create shopnet', 'docker run -d --name api --network shopnet nginx:1.30-alpine', 'docker run --rm --network shopnet alpine:3.22 wget -qO- http://api', 'docker run --rm alpine:3.22 wget -qO- http://api', 'docker network rm shopnet', 'docker rm -f api', 'docker network rm shopnet'],
    ],
  },
  {
    // D4: a set meal: web + api (built here) + db with a health check; cache only with --profile cache.
    id: 'd4-compose-shop',
    cwd: '/home/you/shop',
    images: ['nginx:1.30-alpine', 'node:24-alpine', 'postgres:18-alpine', 'redis:8-alpine'],
    steps: [
      { write: 'site/index.html', content: '<h1>Kedai Kancil</h1>\n' },
      { write: 'api/server.js', content: API_SERVER },
      { write: 'api/package.json', content: '{\n  "name": "api",\n  "version": "1.0.0",\n  "private": true\n}\n' },
      { write: 'api/Dockerfile', content: API_DOCKERFILE },
      { write: '.env', content: 'WEB_PORT=8080\nDB_PASSWORD=secret\n' },
      { write: 'compose.yaml', content: SHOP_COMPOSE },
    ],
    settle: 2,
    verify: [
      ['docker compose config --services', 'docker compose up -d', 'docker compose ps', 'curl -s localhost:8080', 'docker compose exec -T web wget -qO- http://api:3000', 'docker compose logs api', 'docker compose down -v'],
      ['docker compose up -d', 'docker compose --profile cache up -d', 'docker compose --profile cache down', 'docker volume ls', 'docker compose down -v'],
    ],
  },
];
