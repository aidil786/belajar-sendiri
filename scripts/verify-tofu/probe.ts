// Author helper: run a few commands with the real OpenTofu and print what it says.
//   npx tsx scripts/verify-tofu/probe.ts <folder>
// The folder holds the project files plus `cmds.txt`: one command per line; a line starting with
// "< " is the answer typed into the command above it (e.g. "< yes" after `tofu apply`); a line
// starting with "show " prints that file at the end (e.g. "show terraform.tfstate").
// Commands get -no-color like in the truth check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { runReal } from './real';

const dir = process.argv[2]!;
const files: Record<string, string> = {};
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (relative(dir, p) !== 'cmds.txt') files[relative(dir, p)] = readFileSync(p, 'utf8');
  }
};
walk(dir);
const commands: string[] = [];
const answers: Record<number, string> = {};
const show: string[] = [];
for (const line of readFileSync(join(dir, 'cmds.txt'), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  if (line.startsWith('< ')) answers[commands.length - 1] = line.slice(2);
  else if (line.startsWith('show ')) show.push(line.slice(5).trim());
  else commands.push(line);
}
const cacheDir = process.env.VERIFY_TOFU_CACHE ?? join(tmpdir(), 'fl-tofu-plugin-cache');
const r = runReal(files, commands, { cacheDir, answers });
for (const s of r.steps) {
  if (!s) continue;
  console.log(`\n$ ${s.cmd}   [exit ${s.code}]\n${s.out}`);
}
for (const f of show) console.log(`\n=== ${f}\n${r.files[f] ?? '(missing)'}`);
if (r.error) console.log(`\n!! ${r.error}`);
