// The CLI over a virtual project folder. Expected texts are the real OpenTofu 1.12.4 output
// (random names aside); `npm run verify:tofu` checks whole command lists against the real binary.
import { describe, expect, it } from 'vitest';
import { initialState, plain, run, runAll, parseState, type TofuState } from '../index';

const MAIN = `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Nasi lemak\\n"
}

output "stall" {
  value = random_pet.stall.id
}
`;

const go = (st: TofuState, ...lines: string[]) => runAll(st, lines, { noColor: true });
const out = (st: TofuState, line: string) => plain(run(st, line, { noColor: true }).output);
const fresh = (files: Record<string, string> = { 'main.tf': MAIN }) => go(initialState(files), 'tofu init').state;

describe('tofu init', () => {
  it('installs the providers and writes the lock file', () => {
    const r = run(initialState({ 'main.tf': MAIN }), 'tofu init', { noColor: true });
    const text = plain(r.output);
    expect(text).toContain('- Finding latest version of hashicorp/local...');
    expect(text).toContain('- Installed hashicorp/random v3.9.1 (signed, key ID 0C0AF313E5FD9F80)');
    expect(text).toContain('OpenTofu has created a lock file .terraform.lock.hcl');
    expect(r.state.files['.terraform.lock.hcl']).toContain('provider "registry.opentofu.org/hashicorp/random" {\n  version = "3.9.1"\n  hashes = [');
    expect(r.state.init?.providers).toEqual({ local: '2.9.1', random: '3.9.1' });
  });

  it('plan before init explains the lock file', () => {
    const text = out(initialState({ 'main.tf': MAIN }), 'tofu plan');
    expect(text).toContain('Error: Inconsistent dependency lock file');
    expect(text).toContain('  tofu init');
  });
});

describe('plan, apply, destroy', () => {
  it('plans a create with "(known after apply)" and the summary', () => {
    const text = out(fresh(), 'tofu plan');
    expect(text).toContain(`  # random_pet.stall will be created
  + resource "random_pet" "stall" {
      + id        = (known after apply)
      + length    = 2
      + separator = "-"
    }`);
    expect(text).toContain('Plan: 2 to add, 0 to change, 0 to destroy.');
    expect(text).toContain('Changes to Outputs:\n  + stall = (known after apply)');
    expect(text).toContain("Note: You didn't use the -out option to save this plan");
  });

  it('apply asks first; "yes" builds and writes the state', () => {
    const asked = run(fresh(), 'tofu apply', { noColor: true });
    expect(asked.state.pending?.kind).toBe('approve');
    expect(plain(asked.output)).toContain("Only 'yes' will be accepted to approve.");
    expect(asked.state.files['terraform.tfstate']).toBeUndefined();
    const done = run(asked.state, 'yes', { noColor: true });
    const text = plain(done.output);
    expect(text).toMatch(/random_pet\.stall: Creation complete after 0s \[id=[a-z]+-[a-z]+\]/);
    expect(text).toContain('Apply complete! Resources: 2 added, 0 changed, 0 destroyed.');
    expect(text).toContain('Outputs:\n\nstall = "');
    expect(done.state.files['menu.txt']).toBe('Nasi lemak\n');
    const st = parseState(done.state.files['terraform.tfstate'])!;
    expect(st.serial).toBe(1);
    expect(st.resources.map((r) => r.type)).toEqual(['local_file', 'random_pet']);
  });

  it('anything but yes cancels', () => {
    const asked = run(fresh(), 'tofu apply', { noColor: true });
    const no = run(asked.state, 'no', { noColor: true });
    expect(plain(no.output)).toBe('\nApply cancelled.');
    expect(no.state.files['terraform.tfstate']).toBeUndefined();
  });

  it('a second plan finds nothing to do', () => {
    const st = go(fresh(), 'tofu apply -auto-approve').state;
    const text = out(st, 'tofu plan');
    expect(text).toContain('random_pet.stall: Refreshing state... [id=');
    expect(text).toContain('No changes. Your infrastructure matches the configuration.');
  });

  it('replace shows -/+ and "# forces replacement"; update shows ~', () => {
    let st = go(fresh({ 'main.tf': `${MAIN}\nresource "terraform_data" "board" {\n  input = "9am"\n}\n` }), 'tofu apply -auto-approve').state;
    st = { ...st, files: { ...st.files, 'main.tf': `${MAIN.replace('length = 2', 'length = 3')}\nresource "terraform_data" "board" {\n  input = "8am"\n}\n` } };
    const text = out(st, 'tofu plan');
    expect(text).toContain('  ~ update in-place (current -> planned)\n-/+ destroy and then create replacement');
    expect(text).toMatch(/-\/\+ resource "random_pet" "stall" \{\n {6}~ id {8}= "[a-z-]+" -> \(known after apply\)\n {6}~ length {4}= 2 -> 3 # forces replacement\n {8}# \(1 unchanged attribute hidden\)\n {4}\}/);
    expect(text).toMatch(/ {2}~ resource "terraform_data" "board" \{\n {8}id {5}= "[0-9a-f-]+"\n {6}~ input {2}= "9am" -> "8am"\n {6}~ output = "9am" -> \(known after apply\)\n {4}\}/);
    expect(text).toContain('Plan: 1 to add, 1 to change, 1 to destroy.');
  });

  it('drift: a deleted local_file is planned again; -refresh-only reports it', () => {
    const st = go(fresh(), 'tofu apply -auto-approve', 'rm menu.txt').state;
    expect(out(st, 'tofu plan')).toContain('  # local_file.menu will be created');
    const ro = out(st, 'tofu plan -refresh-only');
    expect(ro).toContain('Note: Objects have changed outside of OpenTofu');
    expect(ro).toContain('  # local_file.menu has been deleted');
  });

  it('destroy asks with its own warning and empties the state', () => {
    const asked = run(go(fresh(), 'tofu apply -auto-approve').state, 'tofu destroy', { noColor: true });
    expect(plain(asked.output)).toContain('There is no undo.');
    const done = run(asked.state, 'yes', { noColor: true });
    expect(plain(done.output)).toContain('Destroy complete! Resources: 2 destroyed.');
    expect(parseState(done.state.files['terraform.tfstate'])!.resources).toEqual([]);
    expect(done.state.files['menu.txt']).toBeUndefined();
    // OpenTofu 1.13 writes the backup in the state file's indented layout.
    expect(done.state.files['terraform.tfstate.backup']).toMatch(/^\{\n {2}"version": 4,\n {2}"terraform_version": "1\.13\.5",/);
  });

  it('a saved plan applies once; then it is stale', () => {
    const st = go(fresh(), 'tofu plan -out tfplan').state;
    expect(st.files.tfplan).toBeDefined();
    const applied = run(st, 'tofu apply tfplan', { noColor: true });
    expect(plain(applied.output)).toContain('Apply complete! Resources: 2 added');
    expect(plain(run(applied.state, 'tofu apply tfplan', { noColor: true }).output)).toContain('Error: Saved plan is stale');
  });
});

describe('errors', () => {
  it('validate: undeclared references, unknown arguments, missing ones', () => {
    const st = fresh({ 'main.tf': 'resource "random_pet" "stall" {\n  colour = "red"\n}\n\nresource "local_file" "sign" {\n  filename = "a"\n  content = random_pet.stal.id\n}\n' });
    const text = out(st, 'tofu validate');
    expect(text).toContain('Error: Unsupported argument\n\n  on main.tf line 2, in resource "random_pet" "stall":\n   2:   colour = "red"\n\nAn argument named "colour" is not expected here.');
    expect(text).toContain('There is no managed resource "random_pet" "stal" definition in the root\nmodule.');
  });

  it('colour mode draws the gutter', () => {
    const r = run(fresh({ 'main.tf': 'output "x" {\n  value = var.nope\n}\n' }), 'tofu validate');
    const text = plain(r.output);
    expect(text.split('\n')[0]).toBe('╷');
    expect(text).toContain('│ Error: Reference to undeclared input variable');
    expect(text).toContain('╵');
  });

  it('a sensitive value in a plain output is refused', () => {
    const st = fresh({ 'main.tf': 'variable "pin" {\n  default   = "1234"\n  sensitive = true\n}\n\noutput "pin" {\n  value = var.pin\n}\n' });
    expect(out(st, 'tofu plan')).toContain('Error: Output refers to sensitive values');
  });

  it('prevent_destroy stops a destroy plan', () => {
    const files = { 'main.tf': 'resource "random_integer" "safe" {\n  min = 100\n  max = 999\n  lifecycle {\n    prevent_destroy = true\n  }\n}\n' };
    const st = go(fresh(files), 'tofu apply -auto-approve').state;
    const r = run(st, 'tofu destroy -auto-approve', { noColor: true });
    expect(r.exitCode).toBe(1);
    expect(plain(r.output)).toContain('Error: Resource instance cannot be destroyed');
  });

  it('variable validation shows the value and the rule', () => {
    const files = { 'main.tf': 'variable "tables" {\n  type    = number\n  default = 3\n  validation {\n    condition     = var.tables <= 10\n    error_message = "Too many tables."\n  }\n}\n\nresource "terraform_data" "t" {\n  input = var.tables\n}\n' };
    const text = out(fresh(files), 'tofu plan -var tables=20');
    // The only resource uses var.tables, so nothing is planned (real OpenTofu 1.12.4).
    expect(text).toContain('Planning failed. OpenTofu encountered an error while generating this plan.');
    expect(text).not.toContain('terraform_data.t');
    expect(text).toContain('    │ var.tables is 20\n\nToo many tables.\n\nThis was checked by the validation rule at main.tf:4,3-13.');
  });

  it('unknown commands and terraform get a kind answer', () => {
    const st = initialState({});
    expect(run(st, 'tofu frobnicate').explain?.key).toBe('tofu.err.unknownCommand');
    expect(run(st, 'terraform plan').explain?.key).toBe('tofu.err.terraform');
  });
});

describe('variables, count, for_each, modules', () => {
  it('asks for a required variable, then plans with the answer', () => {
    const st = fresh({ 'main.tf': 'variable "shop" {\n  type        = string\n  description = "The name of the shop"\n}\n\nresource "local_file" "sign" {\n  filename = "sign.txt"\n  content  = var.shop\n}\n' });
    const q = run(st, 'tofu plan', { noColor: true });
    expect(plain(q.output)).toBe('var.shop\n  The name of the shop');
    expect(q.state.pending?.kind).toBe('var');
    const a = run(q.state, 'Kedai Kancil', { noColor: true });
    expect(plain(a.output)).toContain('+ content              = "Kedai Kancil"');
  });

  it('count and for_each give indexed addresses', () => {
    const files = { 'main.tf': 'resource "random_pet" "p" {\n  count = 2\n}\n\nresource "local_file" "f" {\n  for_each = toset(["mee", "nasi"])\n  filename = "${each.key}.txt"\n  content  = each.value\n}\n' };
    const st = go(fresh(files), 'tofu apply -auto-approve').state;
    expect(out(st, 'tofu state list')).toBe('local_file.f["mee"]\nlocal_file.f["nasi"]\nrandom_pet.p[0]\nrandom_pet.p[1]');
    expect(st.files['mee.txt']).toBe('mee');
  });

  it('local modules need init, then work with inputs and outputs', () => {
    const files = { 'main.tf': 'module "kiosk" {\n  source = "./modules/kiosk"\n  name   = "teh"\n}\n\noutput "file" {\n  value = module.kiosk.file\n}\n', 'modules/kiosk/main.tf': 'variable "name" {\n  type = string\n}\n\nresource "local_file" "sign" {\n  filename = "${var.name}.txt"\n  content  = var.name\n}\n\noutput "file" {\n  value = local_file.sign.filename\n}\n' };
    const before = out(initialState(files), 'tofu plan');
    expect(before).toContain('Error: Module not installed');
    const init = run(initialState(files), 'tofu init', { noColor: true });
    expect(plain(init.output)).toContain('Initializing modules...\n- kiosk in modules/kiosk');
    const st = go(init.state, 'tofu apply -auto-approve').state;
    expect(out(st, 'tofu state list')).toBe('module.kiosk.local_file.sign');
    expect(out(st, 'tofu output -raw file')).toBe('teh.txt');
  });
});

describe('state commands, moved and import', () => {
  it('state mv / rm print what they did and keep a timestamped backup', () => {
    const st = go(fresh(), 'tofu apply -auto-approve').state;
    const mv = run(st, 'tofu state mv random_pet.stall random_pet.chef', { noColor: true });
    expect(plain(mv.output)).toBe('Move "random_pet.stall" to "random_pet.chef"\nSuccessfully moved 1 object(s).');
    expect(Object.keys(mv.state.files).some((f) => /^terraform\.tfstate\.\d+\.backup$/.test(f))).toBe(true);
    const rm = run(mv.state, 'tofu state rm local_file.menu', { noColor: true });
    expect(plain(rm.output)).toBe('Removed local_file.menu\nSuccessfully removed 1 resource instance(s).');
    expect(out(rm.state, 'tofu state list')).toBe('random_pet.chef');
  });

  it('a moved block renames without destroying', () => {
    let st = go(fresh(), 'tofu apply -auto-approve').state;
    st = { ...st, files: { ...st.files, 'main.tf': MAIN.replace('"stall"', '"chef"').replace('random_pet.stall.id', 'random_pet.chef.id') + '\nmoved {\n  from = random_pet.stall\n  to   = random_pet.chef\n}\n' } };
    const text = out(st, 'tofu plan');
    expect(text).toContain('  # random_pet.stall has moved to random_pet.chef');
    expect(text).toContain('Plan: 0 to add, 0 to change, 0 to destroy.');
  });

  it('an import block adopts an existing value', () => {
    const st = fresh({ 'main.tf': 'resource "random_string" "code" {\n  length = 5\n}\n\nimport {\n  to = random_string.code\n  id = "KEDAI"\n}\n' });
    const text = out(st, 'tofu plan');
    expect(text).toContain('random_string.code: Preparing import... [id=KEDAI]');
    expect(text).toContain('Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.');
  });
});

describe('shell and outputs', () => {
  it('output -json and -raw', () => {
    const st = go(fresh(), 'tofu apply -auto-approve').state;
    const j = JSON.parse(out(st, 'tofu output -json')) as { stall: { sensitive: boolean; type: string } };
    expect(j.stall).toMatchObject({ sensitive: false, type: 'string' });
    expect(out(st, 'tofu output -raw stall')).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it('echo and printf write files; cat reads them; ls lists', () => {
    const st = go(initialState({ 'main.tf': MAIN }), 'echo hi > note.txt', "printf 'a\\nb\\n' >> note.txt").state;
    expect(st.files['note.txt']).toBe('hi\na\nb\n');
    expect(out(st, 'cat note.txt')).toBe('hi\na\nb');
    expect(out(st, 'ls')).toBe('main.tf\nnote.txt');
  });

  it('is deterministic: the same steps give the same random names', () => {
    const a = go(fresh(), 'tofu apply -auto-approve').state;
    const b = go(fresh(), 'tofu apply -auto-approve').state;
    expect(a.files['terraform.tfstate']).toBe(b.files['terraform.tfstate']);
  });

  it('never changes the state it was given', () => {
    const st = fresh();
    const copy = structuredClone(st);
    run(st, 'tofu apply -auto-approve');
    expect(st).toEqual(copy);
  });
});
