import { createKitchenState, plain, run, type KitchenResult, type KitchenState } from '../index';
import { pullImage } from '../images';

/** A fresh laptop, optionally with some catalog images pulled already. */
export function kitchen(images: string[] = []): KitchenState {
  const s = createKitchenState({ seed: 'test' });
  for (const ref of images) pullImage(s, ref, { quiet: true });
  return s;
}

/** Run commands in order; returns the last result and every result. */
export function runs(state: KitchenState, ...cmds: string[]): { state: KitchenState; last: KitchenResult; all: KitchenResult[] } {
  let s = state;
  const all: KitchenResult[] = [];
  for (const c of cmds) {
    const r = run(s, c);
    all.push(r);
    s = r.state;
  }
  return { state: s, last: all[all.length - 1]!, all };
}

export function text(r: KitchenResult): string {
  return plain(r.output);
}

/** Write a file on the laptop (relative to the current folder). */
export function write(state: KitchenState, path: string, content: string): KitchenState {
  const s = structuredClone(state);
  const abs = path.startsWith('/') ? path : `${s.cwd}/${path}`;
  const dir = abs.slice(0, abs.lastIndexOf('/'));
  let d = dir;
  const add: string[] = [];
  while (d && !s.fs.dirs.includes(d)) {
    add.push(d);
    d = d.slice(0, d.lastIndexOf('/')) || '/';
  }
  s.fs.dirs.push(...add);
  s.fs.files[abs] = content;
  return s;
}
