// What the simulator knows about actions, runner labels and stations.
// Majors match this repo's own .github/workflows/ci.yml (checkout v7, setup-node v7,
// upload-artifact v7) and each action's README (checked 2026-10-31).
// `npm run verify:workflows` refuses scenarios that use another major.

export type StationKind = 'prep' | 'lint' | 'test' | 'build' | 'scan' | 'publish' | 'deploy' | 'other';

export interface KnownAction {
  /** The version this course teaches (a major tag, or an exact tag for 0.x actions). */
  version: string;
  kind: StationKind;
  docs: string;
  /** Known inputs. Omitted: inputs are not checked. */
  inputs?: string[];
}

export const KNOWN_ACTIONS: Record<string, KnownAction> = {
  'actions/checkout': {
    version: 'v7',
    kind: 'prep',
    docs: 'https://github.com/actions/checkout',
    inputs: ['repository', 'ref', 'token', 'ssh-key', 'ssh-known-hosts', 'ssh-strict', 'ssh-user', 'persist-credentials', 'path', 'clean', 'filter', 'sparse-checkout', 'sparse-checkout-cone-mode', 'fetch-depth', 'fetch-tags', 'show-progress', 'lfs', 'submodules', 'set-safe-directory', 'github-server-url'],
  },
  'actions/setup-node': {
    version: 'v7',
    kind: 'prep',
    docs: 'https://github.com/actions/setup-node',
    inputs: ['node-version', 'node-version-file', 'architecture', 'check-latest', 'registry-url', 'scope', 'token', 'cache', 'package-manager-cache', 'cache-dependency-path', 'mirror', 'mirror-token', 'always-auth'],
  },
  'actions/cache': {
    version: 'v6',
    kind: 'prep',
    docs: 'https://github.com/actions/cache',
    inputs: ['path', 'key', 'restore-keys', 'upload-chunk-size', 'enableCrossOsArchive', 'fail-on-cache-miss', 'lookup-only', 'save-always'],
  },
  'actions/upload-artifact': {
    version: 'v7',
    kind: 'other',
    docs: 'https://github.com/actions/upload-artifact',
    inputs: ['name', 'path', 'if-no-files-found', 'retention-days', 'compression-level', 'overwrite', 'include-hidden-files', 'archive'],
  },
  'actions/download-artifact': {
    version: 'v8',
    kind: 'prep',
    docs: 'https://github.com/actions/download-artifact',
    inputs: ['name', 'artifact-ids', 'path', 'pattern', 'merge-multiple', 'github-token', 'repository', 'run-id', 'skip-decompress', 'digest-mismatch'],
  },
  'actions/attest': {
    version: 'v4',
    kind: 'publish',
    docs: 'https://github.com/actions/attest',
  },
  'actions/attest-build-provenance': {
    version: 'v4',
    kind: 'publish',
    docs: 'https://github.com/actions/attest-build-provenance',
  },
  'docker/setup-buildx-action': {
    version: 'v4',
    kind: 'prep',
    docs: 'https://github.com/docker/setup-buildx-action',
    inputs: ['version', 'driver', 'driver-opts', 'buildkitd-flags', 'buildkitd-config', 'buildkitd-config-inline', 'install', 'use', 'name', 'endpoint', 'platforms', 'append', 'keep-state', 'cache-binary', 'cleanup'],
  },
  'docker/setup-qemu-action': {
    version: 'v4',
    kind: 'prep',
    docs: 'https://github.com/docker/setup-qemu-action',
    inputs: ['image', 'platforms', 'cache-image'],
  },
  'docker/login-action': {
    version: 'v4',
    kind: 'publish',
    docs: 'https://github.com/docker/login-action',
    inputs: ['registry', 'username', 'password', 'ecr', 'logout', 'scope', 'registry-auth'],
  },
  'docker/metadata-action': {
    version: 'v6',
    kind: 'prep',
    docs: 'https://github.com/docker/metadata-action',
    inputs: ['context', 'images', 'tags', 'flavor', 'labels', 'annotations', 'sep-tags', 'sep-labels', 'sep-annotations', 'bake-target', 'github-token'],
  },
  'docker/build-push-action': {
    version: 'v7',
    kind: 'build',
    docs: 'https://github.com/docker/build-push-action',
    inputs: ['add-hosts', 'allow', 'annotations', 'attests', 'build-args', 'build-contexts', 'builder', 'cache-from', 'cache-to', 'call', 'cgroup-parent', 'context', 'file', 'labels', 'load', 'network', 'no-cache', 'no-cache-filters', 'outputs', 'platforms', 'provenance', 'pull', 'push', 'sbom', 'secrets', 'secret-envs', 'secret-files', 'shm-size', 'ssh', 'tags', 'target', 'ulimit', 'github-token'],
  },
  'aquasecurity/trivy-action': {
    version: 'v0.36.0',
    kind: 'scan',
    docs: 'https://github.com/aquasecurity/trivy-action',
  },
  'hadolint/hadolint-action': {
    version: 'v3.1.0',
    kind: 'lint',
    docs: 'https://github.com/hadolint/hadolint-action',
  },
};

/** GitHub-hosted runner labels (and the self-hosted defaults). */
export const RUNNER_LABELS = new Set([
  'ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-24.04-arm', 'ubuntu-22.04-arm', 'ubuntu-slim',
  'windows-latest', 'windows-2025', 'windows-2022', 'windows-11-arm',
  'macos-latest', 'macos-26', 'macos-15', 'macos-14', 'macos-15-intel', 'macos-latest-large', 'macos-latest-xlarge',
  'self-hosted', 'linux', 'windows', 'macos', 'x64', 'arm64', 'arm',
]);

/** Split `owner/repo/path@ref` into its parts. */
export function parseUses(uses: string): { name: string; ref: string; local: boolean; docker: boolean; reusable: boolean } {
  if (uses.startsWith('./')) return { name: uses, ref: '', local: true, docker: false, reusable: /\.ya?ml$/.test(uses) };
  if (uses.startsWith('docker://')) return { name: uses, ref: '', local: false, docker: true, reusable: false };
  const at = uses.lastIndexOf('@');
  const path = at === -1 ? uses : uses.slice(0, at);
  const ref = at === -1 ? '' : uses.slice(at + 1);
  const parts = path.split('/');
  return { name: parts.slice(0, 2).join('/').toLowerCase(), ref, local: false, docker: false, reusable: /\.github\/workflows\/.+\.ya?ml$/.test(path) };
}

export function isFullSha(ref: string): boolean {
  return /^[0-9a-f]{40}$/.test(ref);
}

/** Owners whose actions are made by GitHub itself. */
export const GITHUB_OWNERS = new Set(['actions', 'github']);

const RULES: [StationKind, RegExp][] = [
  ['deploy', /\b(deploy|release to|wrangler|rollout|rollback|roll back|promote|canary|production|staging)\b/i],
  ['scan', /\b(scan|trivy|audit|codeql|grype|snyk|cve|sbom)\b/i],
  ['publish', /\b(publish|push|login|attest|provenance|release|ghcr)\b/i],
  ['lint', /\b(lint|hadolint|actionlint|eslint|prettier|format)\b/i],
  ['test', /\b(test|tests|vitest|jest|e2e|smoke|integration)\b/i],
  ['build', /\b(build|compile|bundle|docker build|image)\b/i],
  ['prep', /\b(checkout|check out|set ?up|install|npm ci|cache|download|metadata|prepare|buildx|qemu|get ready)\b/i],
];

/** Guess the station kind from a name, an action or a command. */
export function kindOf(text: string): StationKind {
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return 'other';
}

/** Kind of one step: known actions first, then its name and command. */
export function stepKind(step: { uses?: string; run?: string; name?: string }): StationKind {
  if (step.uses) {
    const known = KNOWN_ACTIONS[parseUses(step.uses).name];
    if (known) {
      if (parseUses(step.uses).name === 'docker/build-push-action') return 'build';
      return known.kind;
    }
  }
  const run = step.run ?? '';
  if (/^\s*npm (ci|install)\b/m.test(run) && !/\bnpm (test|run)\b/.test(run)) return 'prep';
  return kindOf(`${step.name ?? ''} ${run} ${step.uses ?? ''}`);
}
