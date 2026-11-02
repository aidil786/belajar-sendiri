// Read what is inside a real volume (with a tiny alpine container), for the truth check.
import { spawnSync } from 'node:child_process';

/** Files in a volume, relative to its root. A Postgres data volume is summarised as "pg". */
export function readCatalogFiles(volume: string): string[] {
  const r = spawnSync('docker', ['run', '--rm', '-v', `${volume}:/v:ro`, 'alpine:3.22', 'find', '/v', '-type', 'f'], { encoding: 'utf8' });
  const files = (r.stdout ?? '').split('\n').filter(Boolean).map((f) => f.replace(/^\/v\//, ''));
  if (files.some((f) => f.endsWith('18/docker/PG_VERSION'))) return ['pg'];
  return files.sort();
}
