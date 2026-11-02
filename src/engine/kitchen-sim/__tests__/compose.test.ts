import { describe, expect, it } from 'vitest';
import { buildKitchenScenario, run } from '../index';
import { scenarios } from '~/content/courses/docker/scenarios';
import { runs, text, write } from './helpers';

const shop = () => buildKitchenScenario(scenarios['d4-compose-shop']!);

describe('docker compose', () => {
  it('up -d builds, pulls, waits for a healthy db, and starts the set meal', () => {
    const r = run(shop(), 'docker compose up -d');
    expect(r.ok).toBe(true);
    const out = text(r);
    expect(out).toContain(' => [internal] load local bake definitions');
    expect(out).toMatch(/\[\+\] up \d+\/\d+/);
    expect(out).toMatch(/ ✔ Container shop-db-1\s+Healthy/);
    expect(out).toMatch(/ ✔ Container shop-web-1\s+Started/);
    const ps = text(run(r.state, 'docker compose ps')).split('\n');
    expect(ps[0]).toMatch(/^NAME\s+IMAGE\s+COMMAND\s+SERVICE\s+CREATED\s+STATUS\s+PORTS$/);
    expect(ps.find((l) => l.startsWith('shop-db-1'))).toContain('(healthy)');
    expect(ps.find((l) => l.startsWith('shop-api-1'))).toMatch(/shop-api\s+"docker-entrypoint\.s…"\s+api/);
    expect(text(run(r.state, 'curl localhost:8080'))).toBe('<h1>Kedai Kancil</h1>');
    expect(text(run(r.state, 'docker compose exec web wget -qO- http://api:3000'))).toBe('{"ok":true,"shop":"Kedai Kancil"}');
    expect(text(run(r.state, 'docker compose logs api'))).toBe('api-1  | API listening on port 3000');
  });

  it('profiles, scale, down keeps lockers, down -v removes them', () => {
    const s = runs(shop(), 'docker compose up -d', 'docker compose --profile cache up -d', 'docker compose up -d --scale api=2').state;
    const names = Object.values(s.containers).map((c) => c.name).sort();
    expect(names).toEqual(['shop-api-1', 'shop-api-2', 'shop-cache-1', 'shop-db-1', 'shop-web-1']);
    const down = runs(s, 'docker compose --profile cache down', 'docker volume ls');
    expect(text(down.last)).toContain('shop_dbdata');
    expect(text(down.all[0]!)).toMatch(/ ✔ Network shop_default\s+Removed/);
    const gone = runs(down.state, 'docker compose down -v', 'docker volume ls');
    expect(text(gone.last)).toBe('DRIVER    VOLUME NAME');
  });

  it('config shows the canonical model; unset variables warn', () => {
    let s = shop();
    expect(text(run(s, 'docker compose config --services'))).toBe('db\napi\nweb');
    const cfg = text(run(s, 'docker compose config'));
    expect(cfg).toContain('name: shop');
    expect(cfg).toContain('      PORT: "3000"');
    expect(cfg).toContain('        published: "8080"');
    s = write(s, '.env', 'WEB_PORT=8080\n');
    const warn = text(run(s, 'docker compose config'));
    expect(warn).toContain('WARN[0000] The "DB_PASSWORD" variable is not set. Defaulting to a blank string.');
    s = write(s, 'compose.yaml', 'version: "3.9"\nservices:\n  web:\n    imag: nginx\n');
    expect(text(run(s, 'docker compose up -d'))).toContain("validating /home/you/shop/compose.yaml: services.web additional properties 'imag' not allowed");
  });

  it('no compose file here', () => {
    const s = runs(shop(), 'cd ..').state;
    expect(text(run(s, 'docker compose up -d'))).toBe('no configuration file provided: not found');
  });

  it('a db that never gets healthy stops the services that wait for it', () => {
    let s = shop();
    s = write(s, '.env', 'WEB_PORT=8080\nDB_PASSWORD=\n');
    const r = run(s, 'docker compose up -d');
    expect(r.ok).toBe(false);
    expect(text(r)).toContain('dependency failed to start: container shop-db-1 exited (1)');
    // Like Compose v5.6.1: the services still to come are created (not started), and the row names the dependency.
    expect(text(r)).toMatch(/ ✘ Container shop-db-1\s+Error dependency db failed to start/);
    expect(text(r)).toMatch(/ ✔ Container shop-api-1\s+Created/);
    expect(r.state.containers[Object.keys(r.state.containers).find((id) => r.state.containers[id]!.name === 'shop-web-1')!]!.status).toBe('created');
  });

  it('a missing required variable names where it is (Compose v5.6.1 words)', () => {
    const s = write(shop(), 'compose.yaml', 'services:\n  db:\n    image: postgres:18-alpine\n    environment:\n      POSTGRES_PASSWORD: ${PW:?set PW}\n    ports:\n      - "${PORT:?no port}:5432"\n');
    expect(text(run(s, 'docker compose up -d'))).toBe(
      'error while interpolating services.db.environment.POSTGRES_PASSWORD: required variable PW is missing a value: set PW\nerror while interpolating services.db.ports.[]: required variable PORT is missing a value: no port',
    );
  });
});
