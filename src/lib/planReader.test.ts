import { describe, expect, it } from 'vitest';
import { scenarios } from '~/content/courses/iac/scenarios';
import { buildReader, checkReaderProps } from './planReader';
import en from '~/i18n/en.json';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('PlanReader logic', () => {
  it('turns a plan into one card per change, with the action words hidden', () => {
    const p = buildReader(scenarios['t1-plan-reader']!, ['cp .next/main.tf main.tf']);
    expect(p.error).toBeUndefined();
    expect(p.items.map((i) => [i.addr, i.action, i.symbol])).toEqual([
      ['local_file.menu', 'create', '+'],
      ['local_file.old_menu', 'delete', '-'],
      ['random_pet.stall', 'replace', '-/+'],
      ['terraform_data.board', 'update', '~'],
    ]);
    const stall = p.items.find((i) => i.addr === 'random_pet.stall')!;
    expect(stall.lines[0]).toBe('  # random_pet.stall');
    expect(stall.lines.join('\n')).toContain('# forces replacement');
    expect(stall.forces).toEqual(['length']);
    expect(stall.choices).toContain('length');
    expect(p.items.every((i) => !i.lines.join('\n').match(/will be|must be|because/))).toBe(true);
    expect(p.summary).toBe('Plan: 2 to add, 1 to change, 2 to destroy.');
  });

  it('a create_before_destroy replace is +/-, and triggers_replace is the reason for terraform_data', () => {
    const p = buildReader(scenarios['t3-lifecycle']!, ['cp .next/main.tf main.tf']);
    const chef = p.items.find((i) => i.addr === 'random_pet.chef')!;
    expect(chef.symbol).toBe('+/-');
    const bell = p.items.find((i) => i.addr === 'terraform_data.bell')!;
    expect(bell.forces).toEqual(['triggers_replace']);
  });

  it('check:mdx props', () => {
    expect(checkReaderProps(scenarios['t1-plan-reader'], { commands: ['cp .next/main.tf main.tf'] })).toEqual([]);
    expect(checkReaderProps(undefined, {})).toEqual(['needs an iac scenario']);
    expect(checkReaderProps(scenarios['t1-plan-reader'], {})[0]).toMatch(/no resource changes/);
  });
});

describe('tofu i18n keys', () => {
  it('every key the engine and the components use exists', () => {
    const dir = 'src/engine/tofu-sim';
    const files = [...readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f)), 'src/components/interactives/TofuSim.tsx', 'src/components/interactives/TofuBoard.tsx', 'src/components/interactives/PlanReader.tsx'];
    const keys = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/'(tofu\.[A-Za-z.]+[A-Za-z])'/g)) keys.add(m[1]!);
    for (const a of ['create', 'update', 'delete', 'replace']) for (const k of ['action', 'right', 'almost']) keys.add(`tofu.reader.${k}.${a}`);
    for (const m of ['create', 'update', 'delete', 'replace', 'cbd']) keys.add(`tofu.mark.${m}`);
    const missing = [...keys].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });
});
