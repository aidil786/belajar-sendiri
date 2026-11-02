// Direct file edits from the file panel (clicking "Edit" instead of typing).
import { resolve, relative, dirname } from './paths';
import { clone, findRepo, writeFile } from './state';
import type { CommandResult, SimState } from './types';

/** Write `content` to `path` (relative to cwd or absolute). Pure: returns a new state. */
export function edit(state: SimState, path: string, content: string): CommandResult {
  const abs = resolve(state.cwd, path, state.home);
  const next = clone(state);
  const existed = abs in state.fs.files;
  writeFile(next, abs, content);
  const repo = findRepo(next, dirname(abs));
  const shown = repo ? relative(abs, repo.root) : abs;
  return {
    state: next,
    output: [],
    events: [{ type: existed ? 'fileChanged' : 'fileCreated', path: shown }],
    ok: true,
    explain: { key: 'term.edited', params: { file: shown } },
  };
}
