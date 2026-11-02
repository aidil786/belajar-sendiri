// Output a learner can reach by typing freely, where the engine once printed something else than
// real OpenTofu (1.12.4 and 1.13.5). Every expected text below was printed by the real CLI (random values
// aside); `npm run verify:tofu` (VERIFY_ONLY=fidelity) runs the same lists against the real binary.
import { describe, expect, it } from 'vitest';
import { buildTofuScenario, plain, run, type TofuState } from '../index';
import { scenarios } from '../../../content/courses/iac/scenarios/index';

const start = (id: string) => buildTofuScenario(scenarios[id]!);
function go(st: TofuState, ...lines: string[]): { st: TofuState; text: string; exit: number } {
  let text = '';
  let exit = 0;
  for (const line of lines) {
    const r = run(st, line, { noColor: true });
    text = plain(r.output).replace(/^\n+/, '');
    exit = r.exitCode;
    st = r.state;
  }
  return { st, text, exit };
}

describe('a -var that fails (gaps 1 and 2)', () => {
  it('a broken validation rule leaves out what uses the variable', () => {
    const { text, exit } = go(start('fidelity-var-checks'), 'tofu init', 'tofu plan -var tables=20');
    expect(exit).toBe(1);
    expect(text).toContain('OpenTofu planned the following actions, but then encountered a problem:');
    expect(text).toContain('  # random_pet.stall will be created');
    expect(text).not.toContain('local_file.sign');
    expect(text).toContain('Plan: 1 to add, 0 to change, 0 to destroy.\n\nChanges to Outputs:\n  + pet = (known after apply)\n\nError: Invalid value for variable');
  });

  it('with nothing else to change, the plan just failed', () => {
    const { text, exit, st } = go(start('fidelity-var-checks'), 'tofu init', 'tofu apply -auto-approve', 'tofu plan -var tables=20');
    expect(exit).toBe(1);
    // (Refreshing lines first, then:)
    expect(text).toContain('\n\nPlanning failed. OpenTofu encountered an error while generating this plan.\n\n\nError: Invalid value for variable\n');
    expect(text).not.toContain('OpenTofu planned the following actions');
    expect(text).not.toContain('will be destroyed');
    expect(st.files['terraform.tfstate']).toBeDefined();
  });

  it('a value of the wrong type names where it came from', () => {
    const cli = go(start('fidelity-var-checks'), 'tofu init', 'tofu plan -var tables=lots').text;
    expect(cli).toContain('Error: Invalid value for input variable\n\n  on main.tf line 1:\n   1: variable "tables" {\n\nUnsuitable value for var.tables set using -var="tables=...": a number is\nrequired.');
    const env = go(start('fidelity-var-checks'), 'tofu init', 'export TF_VAR_tables=lots', 'tofu plan').text;
    expect(env).toContain('Unsuitable value for var.tables set using the TF_VAR_tables environment\nvariable: a number is required.');
    const asked = go(start('fidelity-var-prompt'), 'tofu init', 'tofu plan', 'lots').text;
    expect(asked).toContain('Planning failed.');
    expect(asked).toContain('Unsuitable value for var.tables set using an interactive prompt: a number is\nrequired.');
    const file = go(start('fidelity-more'), 'tofu init', 'tofu plan -var-file=bad.tfvars').text;
    expect(file).toContain('  on main.tf line 19:\n  19: variable "tables" {\n\nThe given value is not suitable for var.tables declared at main.tf:19,1-18: a\nnumber is required.');
  });

  it('asks without a blank line when the variable has no description', () => {
    const r = run(go(start('fidelity-var-prompt'), 'tofu init').st, 'tofu plan', { noColor: true });
    expect(plain(r.output)).toBe('var.tables');
  });
});

describe('outputs (gaps 3, 4 and 5)', () => {
  it('pads every changed output to the longest output name in the plan', () => {
    const { text } = go(start('fidelity-outputs'), 'tofu init', 'tofu apply -auto-approve', 'cp .next/main.tf main.tf', 'tofu plan -var tables=5');
    expect(text).toContain('  ~ tables              = 4 -> 5');
  });

  it('hides unchanged list items like OpenTofu (one before a change, one after)', () => {
    const { text } = go(start('fidelity-outputs'), 'tofu init', 'tofu apply -auto-approve', 'cp .next/main.tf main.tf', 'tofu plan');
    expect(text).toContain(['  ~ days                = [', '        # (4 unchanged elements hidden)', '        "jumaat",', '      - "sabtu",', '      + "ahad",', '    ]', '  ~ menu                = [', '        # (1 unchanged element hidden)', '        "teh",', '      - "roti",', '      + "kopi",', '    ]'].join('\n'));
  });

  it('draws a map output like an object (bare keys, "attribute")', () => {
    const { text } = go(start('fidelity-outputs'), 'tofu init', 'tofu apply -auto-approve', 'tofu plan -var-file=prices.tfvars');
    expect(text).toContain(['  ~ prices              = {', '      + kopi = 3', '      ~ nasi = 5 -> 6', '        # (1 unchanged attribute hidden)', '    }'].join('\n'));
  });

  it('prints lists and maps with their type: tolist([…]), tomap({…})', () => {
    const st = go(start('fidelity-outputs'), 'tofu init', 'tofu apply -auto-approve').st;
    expect(go(st, 'tofu output dishes').text).toBe('tolist([\n  "nasi",\n  "teh",\n])');
    expect(go(st, 'tofu output prices').text).toBe('tomap({\n  "nasi" = 5\n  "teh" = 2\n})');
    expect(go(st, 'tofu output teh').text).toBe('{\n  "nasi" = 10\n  "teh" = 4\n}');
    // tofu show keeps the plain brackets.
    expect(go(st, 'tofu show').text).toContain('dishes = [\n    "nasi",\n    "teh",\n]');
  });
});

describe('values that become unknown (gaps 6 and 7)', () => {
  const plan = () => go(start('fidelity-unknown'), 'tofu init', 'tofu apply -auto-approve', 'tofu plan -replace=random_pet.stall').text;

  it('a multi-line string is a heredoc, with "# forces replacement" on both ends', () => {
    expect(plan()).toMatch(/ {6}~ content {14}= <<-EOT # forces replacement\n {12}Stall \S+\n {12}Nasi lemak\n {8}EOT -> \(known after apply\) # forces replacement\n/);
  });

  it('a one-line string gets "# forces replacement" twice', () => {
    expect(plan()).toMatch(/ {6}~ content {14}= "Stall \S+" # forces replacement -> \(known after apply\) # forces replacement\n/);
  });

  it('a list that becomes unknown shows its old items as removed', () => {
    expect(plan()).toMatch(/ {6}~ output = \[\n {10}- "\S+",\n {10}- "Nasi lemak",\n {8}\] -> \(known after apply\)\n/);
  });
});

describe('plan -destroy with nothing built (gap 8)', () => {
  it('says there is nothing to destroy, even with outputs in the blueprint', () => {
    const { text } = go(start('fidelity-destroy-empty'), 'tofu init', 'tofu plan -destroy');
    expect(text).toBe('No changes. No objects need to be destroyed.\n\nEither you have not created any objects yet or the existing objects were\nalready deleted outside of OpenTofu.');
  });
});

describe('diagnostics (gaps 9 and 10)', () => {
  it('"Missing required argument" names the block it is in', () => {
    const { text } = go(start('fidelity-missing-arg'), 'tofu init', 'tofu validate');
    expect(text).toContain('Error: Missing required argument\n\n  on main.tf line 1, in resource "local_file" "sign":\n   1: resource "local_file" "sign" {\n\nThe argument "filename" is required, but no definition was found.');
  });

  it('an unknown output name wraps like every other diagnostic', () => {
    const { text, exit } = go(start('fidelity-output-missing'), 'tofu init', 'tofu apply -auto-approve', 'tofu output nope');
    expect(exit).toBe(1);
    expect(text).toBe('Error: Output "nope" not found\n\nThe output variable requested could not be found in the state file. If you\nrecently added this to your configuration, be sure to run `tofu apply`, since\nthe state won\'t be updated with new output variables until that command is\nrun.');
  });
});

describe('OpenTofu 1.13: no changes', () => {
  const built = () => go(start('fidelity-no-changes'), 'tofu init', 'tofu apply -auto-approve').st;

  it('a plan with no changes is one line (no paragraph after it)', () => {
    expect(go(built(), 'tofu plan').text).toMatch(/\n\nNo changes\. Your infrastructure matches the configuration\.$/);
    expect(go(built(), 'tofu apply -auto-approve').text).toMatch(/\n\nNo changes\. Your infrastructure matches the configuration\.\n\nApply complete! Resources: 0 added, 0 changed, 0 destroyed\.\n\nOutputs:/);
  });

  it('-target adds a note, -exclude does not', () => {
    expect(go(built(), 'tofu plan -target=terraform_data.board').text).toContain('No changes. Your infrastructure matches the configuration.\n\nNote: You used the -target option, so OpenTofu only checked resources\nmatching those targets and may have skipped others. If you expected changes\nto appear, verify that the addresses passed to -target are correct.\n\nWarning: Resource targeting is in effect');
    expect(go(built(), 'tofu plan -exclude=terraform_data.board').text).toContain('No changes. Your infrastructure matches the configuration.\n\nWarning: Resource targeting is in effect');
  });

  it('a targeted destroy leaves the outputs alone', () => {
    const r = go(built(), 'tofu destroy -auto-approve -target=terraform_data.board');
    expect(r.text).not.toContain('Changes to Outputs');
    expect(go(r.st, 'tofu output').text).toMatch(/^stall = "\S+"$/);
  });

  it('state rm saves an indented backup', () => {
    const st = go(built(), 'tofu state rm random_pet.stall').st;
    const backups = Object.keys(st.files).filter((f) => /^terraform\.tfstate\.\d+\.backup$/.test(f));
    expect(backups).toHaveLength(1);
    expect(st.files[backups[0]!]).toMatch(/^\{\n {2}"version": 4,/);
  });
});

describe('a CLI import saves the outputs', () => {
  it('works out what it can; the rest is saved as a typed null', () => {
    const { st, text } = go(start('fidelity-cli-import'), 'tofu init', 'tofu import random_string.door KANCIL', 'tofu output');
    expect(text).toBe('door = "KANCIL"\ngreeting = "Selamat datang"\nstall = tostring(null)');
    expect(JSON.parse(st.files['terraform.tfstate']!).outputs.stall).toEqual({ value: null, type: 'string' });
  });
});
