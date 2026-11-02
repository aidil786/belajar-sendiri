// World T4 "Modules & Pipelines" scenarios (reusable stall designs, pins, the lock file).
// Checked against real OpenTofu 1.13.5 by `npm run verify:tofu` (VERIFY_ONLY=t4).
// In a verify list, a line right after a command that asks a question is the answer ("yes").
// Files under .next/ are the "next version" a list copies in with `cp` (hidden from the tabs).
import type { TofuScenario } from '~/engine/tofu-sim';

/** A reusable stall design: one input, one sign file, one output. */
const KIOSK = `variable "name" {
  type = string
}

resource "local_file" "sign" {
  filename = "\${var.name}.txt"
  content  = "Kiosk: \${var.name}\\n"
}

output "file" {
  value = local_file.sign.filename
}
`;

// (One plain output: a list output with unchanged items is a known engine gap, see AUTHORING.)
const TWO_KIOSKS = `module "teh" {
  source = "./modules/kiosk"
  name   = "teh-tarik"
}

module "nasi" {
  source = "./modules/kiosk"
  name   = "nasi-lemak"
}

output "teh_file" {
  value = module.teh.file
}
`;

const THREE_KIOSKS = `module "teh" {
  source = "./modules/kiosk"
  name   = "teh-tarik"
}

module "nasi" {
  source = "./modules/kiosk"
  name   = "nasi-lemak"
}

module "roti" {
  source = "./modules/kiosk"
  name   = "roti-canai"
}

output "teh_file" {
  value = module.teh.file
}
`;

/** Provider pins: the range each provider may come from. */
const PINS = `terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}
`;

const PINS_NULL = `terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}
`;

const SHOP = `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Nasi lemak\\nRoti canai\\n"
}
`;

const SHOP_BELL = `${SHOP}
resource "null_resource" "bell" {
  triggers = {
    stall = random_pet.stall.id
  }
}
`;

/** l07: a password that must never sit in a committed file. */
const DB = `variable "db_password" {
  type      = string
  sensitive = true
}

resource "local_sensitive_file" "db_conf" {
  filename = "db.conf"
  content  = "user=kedai\\npassword=\${var.db_password}\\n"
}
`;

/** l06: one stall becomes three, the oven gets bigger, the old fridge goes. */
const GROW = `resource "random_pet" "stall" {
  count  = 1
  length = 1
}

resource "terraform_data" "oven" {
  input = "small"
}

resource "terraform_data" "fridge" {
  input = "old"
}
`;

const GROW_NEXT = `resource "random_pet" "stall" {
  count  = 3
  length = 1
}

resource "terraform_data" "oven" {
  input = "large"
}
`;

/** Boss: two stalls written out by hand… */
const FLAT = `resource "local_file" "nasi" {
  filename = "nasi.txt"
  content  = "Stall: nasi\\n"
}

resource "local_file" "mee" {
  filename = "mee.txt"
  content  = "Stall: mee\\n"
}
`;

const STALL_MODULE = `variable "name" {
  type = string
}

resource "local_file" "sign" {
  filename = "\${var.name}.txt"
  content  = "Stall: \${var.name}\\n"
}
`;

/** …and Ben's refactor into modules, without moved blocks. */
const MODULES = `module "nasi" {
  source = "./modules/stall"
  name   = "nasi"
}

module "mee" {
  source = "./modules/stall"
  name   = "mee"
}
`;

const MODULES_MOVED = `${MODULES}
moved {
  from = local_file.nasi
  to   = module.nasi.local_file.sign
}

moved {
  from = local_file.mee
  to   = module.mee.local_file.sign
}
`;

export const t4: TofuScenario[] = [
  {
    // l01: a local module used twice; the learner adds a third stall.
    id: 't4-kiosk',
    files: { 'main.tf': TWO_KIOSKS, 'modules/kiosk/main.tf': KIOSK, '.next/main.tf': THREE_KIOSKS },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['tofu state list', 'tofu output'],
      ['cp .next/main.tf main.tf', 'tofu plan', 'tofu init', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'ls'],
    ],
  },
  {
    // l03: the lock file records the exact provider versions; a new provider needs init.
    id: 't4-lock',
    files: { 'providers.tf': PINS, 'main.tf': SHOP, '.next/providers.tf': PINS_NULL, '.next/main.tf': SHOP_BELL },
    steps: ['tofu init'],
    verify: [
      ['cat .terraform.lock.hcl', 'tofu init', 'tofu init -upgrade'],
      ['cp .next/main.tf main.tf', 'cp .next/providers.tf providers.tf', 'tofu plan', 'tofu init', 'cat .terraform.lock.hcl', 'tofu plan'],
    ],
  },
  {
    // l03 try: a new provider arrived in the blueprint; the lock file doesn't know it yet.
    id: 't4-lock-new',
    files: { 'providers.tf': PINS, 'main.tf': SHOP },
    steps: ['tofu init', { write: 'providers.tf', content: PINS_NULL }, { write: 'main.tf', content: SHOP_BELL }],
    verify: [['tofu plan', 'tofu init', 'tofu plan']],
  },
  {
    // l07: the password comes from an environment variable, never from a committed file.
    id: 't4-secret-env',
    files: { 'main.tf': DB },
    steps: ['tofu init'],
    verify: [
      ['tofu plan -input=false'],
      ['export TF_VAR_db_password=teh-tarik-42', 'tofu plan', 'tofu apply -auto-approve', 'tofu state show local_sensitive_file.db_conf'],
    ],
  },
  {
    // l06: a plan that grows the bill (more stalls, a bigger oven) and shrinks it (no fridge).
    id: 't4-grow',
    files: { 'main.tf': GROW, '.next/main.tf': GROW_NEXT },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [['cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list']],
  },
  {
    // Boss 1: Ben moved two stalls into a module. Without moved blocks both files are rebuilt.
    id: 't4-boss-module',
    files: { 'main.tf': FLAT, 'modules/stall/main.tf': STALL_MODULE, '.next/main.tf': MODULES_MOVED },
    steps: ['tofu init', 'tofu apply -auto-approve', { write: 'main.tf', content: MODULES }],
    verify: [
      ['tofu plan', 'tofu init', 'tofu plan'],
      ['tofu init', 'cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'tofu plan'],
    ],
  },
  {
    // Boss 2: Ben's change needs the null provider, but he forgot to update the lock file.
    id: 't4-boss-lock',
    files: { 'providers.tf': PINS, 'main.tf': SHOP },
    steps: ['tofu init', 'tofu apply -auto-approve', { write: 'providers.tf', content: PINS_NULL }, { write: 'main.tf', content: SHOP_BELL }],
    verify: [['tofu plan', 'tofu init', 'tofu plan', 'tofu apply -auto-approve']],
  },
];
