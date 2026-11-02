// Sample Kedai Kancil stack for ComposeCanvas: the dev demo page, the unit tests and
// scripts/docker-games/verify-compose.ts all use it. Lessons pass their own `palette`.
import type { CanvasService, ComposeGoal, PaletteService } from './composeCanvas';

export const KEDAI_PALETTE: PaletteService[] = [
  { id: 'web', image: 'nginx:1.29-alpine', ports: ['8080:80'], means: 'Serves the shop pages.' },
  { id: 'api', build: './api', environment: { DATABASE_URL: 'postgres://kedai:example@db:5432/kedai' }, means: 'Takes the orders.' },
  {
    id: 'db',
    image: 'postgres:18-alpine',
    environment: { POSTGRES_USER: 'kedai', POSTGRES_PASSWORD: 'example', POSTGRES_DB: 'kedai' },
    // Postgres 18 images keep data under /var/lib/postgresql (PGDATA=/var/lib/postgresql/18/docker).
    volumeTarget: '/var/lib/postgresql',
    healthcheck: { test: ['CMD-SHELL', 'pg_isready -U kedai -d kedai'], interval: '5s', timeout: '3s', retries: 5 },
    means: 'Keeps the orders.',
  },
  { id: 'cache', image: 'redis:8-alpine', healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '5s' }, volumeTarget: '/data', means: 'Remembers hot menu items.' },
];

export const KEDAI_GOAL: ComposeGoal = {
  services: ['web', 'api', 'db'],
  volumes: { db: 'db-data' },
  networks: { web: ['front'], api: ['front', 'back'], db: ['back'] },
  dependsOn: { api: { db: 'service_healthy' } },
};

/** The finished stack (meets KEDAI_GOAL), plus the cache. */
export const KEDAI_DONE: CanvasService[] = [
  { id: 'web', networks: ['front'], volume: null, dependsOn: { api: 'service_started' } },
  { id: 'api', networks: ['front', 'back'], volume: null, dependsOn: { db: 'service_healthy', cache: 'service_healthy' } },
  { id: 'db', networks: ['back'], volume: 'db-data', dependsOn: {} },
  { id: 'cache', networks: ['back'], volume: 'cache-data', dependsOn: {} },
];
