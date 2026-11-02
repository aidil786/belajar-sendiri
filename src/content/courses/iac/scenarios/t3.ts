// World T3 "State & Teams" scenarios (Kedai Kancil's register: who built what, and what changed).
// Checked against real OpenTofu 1.13.5 by `npm run verify:tofu` (VERIFY_ONLY=t3).
// In a verify list, a line right after a command that asks a question is the answer ("yes").
// Files under .next/ are the "next version" a list copies in with `cp` (hidden from the tabs).
import type { TofuScenario } from '~/engine/tofu-sim';

/** The shop as built in T1/T2: a stall name, a menu file and an output. */
const SHOP = `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Nasi lemak\\nRoti canai\\n"
}

output "stall" {
  value = random_pet.stall.id
}
`;

/** The same shop, the stall renamed to chef, without a moved block. */
const RENAMED = `resource "random_pet" "chef" {
  length = 2
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Nasi lemak\\nRoti canai\\n"
}

output "stall" {
  value = random_pet.chef.id
}
`;

/** The rename, with the moved block that tells OpenTofu it is the same stall. */
const RENAMED_MOVED = `resource "random_pet" "chef" {
  length = 2
}

moved {
  from = random_pet.stall
  to   = random_pet.chef
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Nasi lemak\\nRoti canai\\n"
}

output "stall" {
  value = random_pet.chef.id
}
`;

/** A bigger building for the state commands: five things in the register. */
const BIG = `resource "random_pet" "stall" {
  length = 2
}

resource "random_integer" "table" {
  min = 100
  max = 999
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Nasi lemak\\nRoti canai\\n"
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Table \${random_integer.table.result}: \${random_pet.stall.id}\\n"
}

resource "terraform_data" "bell" {
  input = "ring"
}
`;

/** The door code someone set by hand: the blueprint has the resource, not yet the import. */
const DOOR = `resource "random_string" "door" {
  length = 6
}

output "door" {
  value = random_string.door.result
}
`;

const DOOR_IMPORT = `resource "random_string" "door" {
  length = 6
}

import {
  to = random_string.door
  id = "KANCIL"
}

output "door" {
  value = random_string.door.result
}
`;

/** A PIN for the shop's safe. The output forgets `sensitive = true`. */
const PIN = `resource "random_password" "pin" {
  length  = 6
  special = false
}

resource "local_sensitive_file" "safe" {
  filename = "safe.txt"
  content  = "pin=\${random_password.pin.result}\\n"
}

output "pin" {
  value = random_password.pin.result
}
`;

const PIN_FIXED = PIN.replace('  value = random_password.pin.result\n}', '  value     = random_password.pin.result\n  sensitive = true\n}');

/** One blueprint, named after the workspace it runs in. */
const WS = `resource "local_file" "sign" {
  filename = "\${terraform.workspace}-sign.txt"
  content  = "Kedai Kancil (\${terraform.workspace})\\n"
}

output "workspace" {
  value = terraform.workspace
}
`;

/**
 * Boss: the shop with a sign. (The sign doesn't use the stall's name, and the outputs are both
 * four letters long: two known engine gaps — a multi-line text that becomes unknown, and names
 * padded to the longest unchanged output — stay out of these plans. See AUTHORING, OpenTofu engine.)
 */
const BOSS = `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Nasi lemak\\nRoti canai\\n"
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Welcome to Kedai Kancil\\n"
}

output "name" {
  value = random_pet.stall.id
}
`;

const DOOR_BLOCK = `
resource "random_string" "door" {
  length = 6
}

output "door" {
  value = random_string.door.result
}
`;

const IMPORT_BLOCK = `
import {
  to = random_string.door
  id = "KANCIL"
}
`;

/** Boss stage 2: the door code is in the blueprint, not yet imported. */
const BOSS_DOOR = BOSS + DOOR_BLOCK;

/** Boss stage 3: the stall renamed to chef (sign follows), no moved block yet. */
const BOSS_CHEF = BOSS_DOOR.replace(/random_pet\.stall/g, 'random_pet.chef').replace('resource "random_pet" "stall"', 'resource "random_pet" "chef"');

const BOSS_CHEF_MOVED = BOSS_CHEF.replace(
  'resource "local_file" "menu"',
  `moved {
  from = random_pet.stall
  to   = random_pet.chef
}

resource "local_file" "menu"`,
);

export const t3: TofuScenario[] = [
  {
    // l01: the register is a file on this laptop.
    id: 't3-register',
    files: { 'main.tf': SHOP },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [['ls', 'tofu state list', 'cat terraform.tfstate']],
  },
  {
    // l03: someone added a dish to menu.txt by hand. OpenTofu sees its menu as gone.
    id: 't3-drift-menu',
    files: { 'main.tf': SHOP },
    steps: ['tofu init', 'tofu apply -auto-approve', "printf 'Nasi lemak\\nRoti canai\\nMaggi goreng\\n' > menu.txt"],
    verify: [
      ['cat menu.txt', 'tofu plan', 'tofu apply -auto-approve', 'cat menu.txt', 'tofu plan'],
      ['tofu plan -refresh-only', 'tofu apply -refresh-only -auto-approve', 'tofu state list', 'cat menu.txt'],
      ['tofu plan -detailed-exitcode'],
    ],
  },
  {
    // l04: adopt the door code KANCIL that someone set by hand, with an import block.
    id: 't3-import-door',
    files: { 'main.tf': DOOR, '.next/main.tf': DOOR_IMPORT },
    steps: ['tofu init'],
    // (The CLI `tofu import` is checked in examples.ts `t3-import`: a project without outputs.
    // A CLI import also saves the outputs it can work out: see fidelity.ts `fidelity-cli-import`.)
    verify: [['tofu plan', 'cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state show random_string.door', 'tofu output', 'tofu plan']],
  },
  {
    // l05: the stall was renamed in the blueprint. Without a moved block: destroy + create.
    id: 't3-rename',
    files: { 'main.tf': SHOP, '.next/main.tf': RENAMED_MOVED },
    steps: ['tofu init', 'tofu apply -auto-approve', { write: 'main.tf', content: RENAMED }],
    verify: [['tofu plan'], ['cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'tofu plan']],
  },
  {
    // l06: list, show and (carefully) rm.
    id: 't3-register-big',
    files: { 'main.tf': BIG },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['tofu state list', 'tofu state show local_file.sign', 'tofu state show random_integer.table', 'tofu state show local_file.price'],
      ['tofu state rm local_file.sign', 'tofu state list', 'ls', 'tofu plan'],
    ],
  },
  {
    // l07: the PIN hides on screen but sits in the state file as plain text.
    id: 't3-secret-pin',
    files: { 'main.tf': PIN, '.next/main.tf': PIN_FIXED },
    steps: ['tofu init'],
    verify: [
      ['tofu plan', 'cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu output', 'tofu output -raw pin', 'tofu state show random_password.pin', 'cat terraform.tfstate'],
    ],
  },
  {
    // l07: the same shop, built: anyone who can read the register can read the PIN.
    id: 't3-secret-built',
    files: { 'main.tf': PIN_FIXED },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [['tofu output', 'tofu output -raw pin', 'tofu state show local_sensitive_file.safe', 'cat terraform.tfstate']],
  },
  {
    // l08: terraform.workspace is "default" unless you switch workspaces.
    id: 't3-workspace',
    files: { 'main.tf': WS },
    steps: ['tofu init'],
    verify: [['tofu plan', 'tofu apply -auto-approve', 'ls', 'cat default-sign.txt', 'tofu output']],
  },
  {
    // Boss 1: overnight, someone changed the menu by hand and deleted the sign.
    id: 't3-boss-drift',
    files: { 'main.tf': BOSS },
    steps: ['tofu init', 'tofu apply -auto-approve', "printf 'Nasi lemak\\nMee goreng\\n' > menu.txt", 'rm sign.txt'],
    verify: [
      ['tofu plan -refresh-only', 'tofu plan', 'tofu apply -auto-approve', 'cat menu.txt', 'ls', 'tofu plan'],
    ],
  },
  {
    // Boss 2: a door code KANCIL was set by hand. The blueprint has it; the import block is missing.
    id: 't3-boss-door',
    files: { 'main.tf': BOSS, '.next/main.tf': BOSS_DOOR + IMPORT_BLOCK },
    steps: ['tofu init', 'tofu apply -auto-approve', { write: 'main.tf', content: BOSS_DOOR }],
    verify: [['tofu plan'], ['cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu output door', 'tofu plan']],
  },
  {
    // Boss 3: the stall was renamed to chef. Without a moved block the sign is rebuilt too.
    id: 't3-boss-rename',
    files: { 'main.tf': BOSS_DOOR + IMPORT_BLOCK, '.next/main.tf': BOSS_CHEF_MOVED },
    steps: ['tofu init', 'tofu apply -auto-approve', { write: 'main.tf', content: BOSS_CHEF }],
    verify: [['tofu plan'], ['cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu output', 'tofu plan']],
  },
];
