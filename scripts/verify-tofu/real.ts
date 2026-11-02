// Runs a list of commands with the real OpenTofu (official container image, pinned below) in a
// fresh temp folder, in ONE container per list: a small sh script runs each command and prints a
// marker line between them, so the outputs can be split again. Provider downloads go to a shared
// plugin cache (mounted into the container), so only the first list in a run downloads anything.
//
// Locally (this sandbox), provider downloads go through the agent proxy: when HTTPS_PROXY is set
// the container joins the host network, gets the proxy variables and the proxy's CA bundle.
// In GitHub Actions there is no proxy and the same image works as it is.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

/**
 * The real OpenTofu the engine copies: the one place its version lives for the truth check (the
 * engine's own TOFU_VERSION in src/engine/tofu-sim/state.ts must match). VERIFY_TOFU_IMAGE tries
 * another image (e.g. a newer release) without changing the course.
 */
export const REAL_TOFU_VERSION = '1.13.5';
export const TOFU_IMAGE = process.env.VERIFY_TOFU_IMAGE ?? `ghcr.io/opentofu/opentofu:${REAL_TOFU_VERSION}`;
const CA_BUNDLE = process.env.VERIFY_TOFU_CA ?? '/root/.ccr/ca-bundle.crt';

export interface RealStep {
  cmd: string;
  out: string;
  code: number;
  /** terraform.tfstate right after the command ('' when there is none). */
  state: string;
}

export interface RealRun {
  steps: RealStep[];
  /** Every file in the folder afterwards (except .terraform/), path → content. */
  files: Record<string, string>;
  error?: string;
}

/** Tofu subcommands that take -no-color (the engine prints plain text in the comparison). */
const NO_COLOR = new Set(['init', 'validate', 'plan', 'apply', 'destroy', 'show', 'output', 'import', 'refresh', 'console', 'fmt', 'test']);

/** `tofu plan -out p` → `tofu plan -no-color -out p`. `state`, `providers` and `version` print no colour codes. */
export function withNoColor(cmd: string): string {
  const m = /^tofu\s+(\S+)(.*)$/.exec(cmd.trim());
  if (!m || !NO_COLOR.has(m[1]!) || /(^|\s)-no-color\b/.test(m[2]!)) return cmd;
  return `tofu ${m[1]} -no-color${m[2]}`;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function listFiles(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(base, p);
    if (rel === '.terraform' || rel === 'run.sh' || rel.startsWith('.fl-')) continue;
    const st = statSync(p);
    if (st.isDirectory()) listFiles(p, base, out);
    else out[rel] = readFileSync(p, 'utf8');
  }
  return out;
}

export interface RunOptions {
  /** Shared plugin cache folder on the host (created if missing). */
  cacheDir: string;
  /** Lines fed to the command's stdin, per command index (e.g. "yes" for an interactive apply). */
  answers?: Record<number, string>;
  /** Extra environment for tofu (TF_VAR_x …). */
  env?: Record<string, string>;
  keep?: boolean;
}

/** Run `commands` (tofu or plain shell) in a fresh folder holding `files`. */
export function runReal(files: Record<string, string>, commands: string[], opts: RunOptions): RealRun {
  const dir = mkdtempSync(join(tmpdir(), 'fl-tofu-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    mkdirSync(opts.cacheDir, { recursive: true });
    const lines = ['#!/bin/sh', 'cd /w'];
    commands.forEach((c, i) => {
      lines.push(`echo "@@FL-CMD ${i}"`);
      const cmd = c.startsWith('tofu ') ? withNoColor(c) : c;
      const answer = opts.answers?.[i];
      // Several answers arrive one by one, like someone typing (OpenTofu reads all piped input at the first question).
      if (answer !== undefined) lines.push(`{ ${answer.split('\n').map((a) => `printf '%s\\n' ${shq(a)}`).join('; sleep 2; ')}; } | ${cmd} 2>&1`);
      else lines.push(`{ ${cmd}\n} < /dev/null 2>&1`);
      // A newline first: `tofu output -raw` prints no newline at the end.
      lines.push(`printf '\\n@@FL-EXIT %s\\n' "$?"`);
      lines.push(`echo "@@FL-STATE"; cat terraform.tfstate 2>/dev/null; echo "@@FL-END"`);
    });
    writeFileSync(join(dir, '.fl-run.sh'), `${lines.join('\n')}\n`);
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
    const args = ['run', '--rm', '--user', `${uid}:${gid}`, '-e', 'HOME=/tmp', '-e', 'TF_PLUGIN_CACHE_DIR=/plugin-cache'];
    if (process.env.HTTPS_PROXY) {
      args.push('--network', 'host', '-e', 'HTTPS_PROXY', '-e', 'HTTP_PROXY', '-e', 'NO_PROXY');
      if (existsSync(CA_BUNDLE)) args.push('-e', 'SSL_CERT_FILE=/fl-ca.crt', '-v', `${CA_BUNDLE}:/fl-ca.crt:ro`);
    }
    for (const [k, v] of Object.entries(opts.env ?? {})) args.push('-e', `${k}=${v}`);
    args.push('-v', `${opts.cacheDir}:/plugin-cache`, '-v', `${dir}:/w`, '-w', '/w', '--entrypoint', '/bin/sh', TOFU_IMAGE, '/w/.fl-run.sh');
    const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 600_000 });
    const text = `${r.stdout ?? ''}`;
    const steps: RealStep[] = [];
    const parts = text.split(/^@@FL-CMD (\d+)\n/m);
    for (let i = 1; i < parts.length; i += 2) {
      const idx = Number(parts[i]);
      const body = parts[i + 1] ?? '';
      const st = /@@FL-STATE\n([\s\S]*?)@@FL-END\n?$/.exec(body);
      const rest = st ? body.slice(0, st.index) : body;
      const m = /\n@@FL-EXIT (\d+)\n?$/.exec(rest);
      steps[idx] = { cmd: commands[idx]!, out: m ? rest.slice(0, m.index) : rest, code: m ? Number(m[1]) : -1, state: st ? st[1]! : '' };
    }
    const run: RealRun = { steps, files: listFiles(dir) };
    if (r.status !== 0 || steps.length !== commands.length) run.error = `docker exited ${r.status}: ${(r.stderr ?? '').slice(0, 2000)}`;
    return run;
  } finally {
    if (!opts.keep) rmSync(dir, { recursive: true, force: true });
  }
}
