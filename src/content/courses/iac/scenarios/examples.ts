// Model scenarios for the OpenTofu simulator (TofuSim / PlanReader), checked against real
// OpenTofu 1.13.5 by `npm run verify:tofu`. The story: Kedai Kancil's food court, built from a
// blueprint. "Stalls" are local files and random names, so everything runs on one laptop.
// In a verify list, a line right after a command that asks a question is the answer ("yes").
// Files under .next/ are the "next version" a list copies in with `cp` (hidden from the tabs).
import type { TofuScenario } from '~/engine/tofu-sim';

const PROVIDERS = `terraform {
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

const FIRST = `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Welcome to \${random_pet.stall.id}\\n"
}

output "stall_name" {
  value = random_pet.stall.id
}
`;

const MENU = `resource "random_pet" "stall" {
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

export const examples: TofuScenario[] = [
  {
    // T1: the whole loop — init, plan, apply (with the question), outputs, state, destroy.
    id: 't1-first-blueprint',
    files: { 'providers.tf': PROVIDERS, 'main.tf': FIRST },
    verify: [
      ['tofu init', 'tofu validate', 'tofu plan', 'tofu apply', 'yes', 'tofu output', 'tofu output -raw stall_name', 'tofu state list', 'tofu state show random_pet.stall', 'cat sign.txt', 'tofu plan'],
      ['tofu init', 'tofu apply -auto-approve', 'tofu show', 'cat terraform.tfstate', 'tofu destroy', 'yes', 'tofu state list', 'tofu output', 'ls'],
      ['tofu plan', 'tofu init', 'tofu apply', 'no', 'tofu state list', 'tofu version'],
    ],
  },
  {
    // T1 boss shape: a small food court of stalls, a table number and a bell.
    id: 't1-food-court',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 1
}

resource "random_integer" "table" {
  min = 100
  max = 999
}

resource "local_file" "board" {
  filename = "board.txt"
  content  = "Stall \${random_pet.stall.id} at table \${random_integer.table.result}\\n"
}

resource "terraform_data" "bell" {
  input = "ring"
}

resource "null_resource" "lamp" {
  triggers = {
    table = random_integer.table.result
  }
}
`,
    },
    verify: [
      ['tofu init', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'tofu state show null_resource.lamp', 'tofu destroy -auto-approve', 'ls'],
      ['tofu init', 'tofu init', 'tofu providers'],
    ],
  },
  {
    // T1: tofu fmt fixes the layout; -check and -diff show what would change.
    id: 't1-messy',
    files: {
      'main.tf': `resource "random_pet" "stall" {
length=2
    separator    = "_"
  prefix = "kedai"
}

resource "local_file"   "menu"  {
  filename = "menu.txt"
  content = "Nasi lemak\\n"
  file_permission="0644"
}

locals {
  prices = {nasi=5,mee=4}
  stalls = [ "nasi","mee" ]
  b = "b" # comment
}
`,
      'outputs.tf': `output "prices" {
     value =   local.prices
}
`,
    },
    verify: [['tofu fmt -check', 'tofu fmt -diff', 'cat main.tf', 'cat outputs.tf', 'tofu fmt -check', 'tofu fmt']],
  },
  {
    // T1: friendly errors — a typo in a reference, an argument the resource doesn't have, a missing one.
    id: 't1-typos',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 2
  colour = "red"
}

resource "local_file" "sign" {
  content = "Welcome to \${random_pet.stal.id}\\n"
}
`,
    },
    verify: [['tofu init', 'tofu validate'], ['tofu init', 'tofu plan']],
  },
  {
    // T2: variables (types, defaults, validation, sensitive), tfvars, locals, outputs, functions.
    id: 't2-inputs',
    files: {
      'variables.tf': `variable "shop" {
  type        = string
  description = "The name of the shop"
}

variable "stalls" {
  type    = list(string)
  default = ["nasi", "mee", "roti"]
}

variable "prices" {
  type = map(number)
  default = {
    nasi = 5
    mee  = 4
  }
}

variable "open" {
  type    = bool
  default = true
}

variable "tables" {
  type    = number
  default = 3
  validation {
    condition     = var.tables > 0 && var.tables <= 10
    error_message = "Tables must be between 1 and 10."
  }
}
`,
      'main.tf': `locals {
  sign   = upper(var.shop)
  banner = format("%s has %d stalls", var.shop, length(var.stalls))
}

resource "terraform_data" "door" {
  input = var.open ? "OPEN" : "CLOSED"
}
`,
      'outputs.tf': `output "banner" {
  value = local.banner
}

output "sign" {
  value = local.sign
}

output "menu" {
  value = join(", ", var.stalls)
}

output "doubled" {
  value = { for k, v in var.prices : upper(k) => v * 2 }
}

output "stall_set" {
  value = toset(var.stalls)
}

output "teh" {
  value = lookup(merge(var.prices, { teh = 2 }), "teh", 0)
}
`,
      'terraform.tfvars': `shop = "Kedai Kancil"
`,
    },
    verify: [
      ['tofu init', 'tofu validate', 'tofu plan', 'tofu apply -auto-approve', 'tofu output', 'tofu output -json', 'tofu output -raw sign'],
      ['tofu init', 'tofu plan -var tables=20'],
      ['tofu init', 'tofu apply -auto-approve', 'tofu plan -var open=false', "tofu plan -var 'stalls=[\"nasi\"]'"],
      ['tofu init', 'tofu plan -var-file=nope.tfvars', 'tofu plan -var colour=red'],
    ],
  },
  {
    // T2: a required variable with no value: OpenTofu asks for it.
    id: 't2-ask',
    files: {
      'main.tf': `variable "shop" {
  type        = string
  description = "The name of the shop"
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "\${var.shop}\\n"
}

output "sign" {
  value = local_file.sign.content
}
`,
    },
    verify: [
      ['tofu init', 'tofu plan', 'Kedai Kancil'],
      ['tofu init', 'tofu apply', 'Warung Ali', 'yes', 'tofu output', 'cat sign.txt'],
      ['tofu init', 'tofu plan -input=false'],
    ],
  },
  {
    // T2: count and for_each.
    id: 't2-many',
    files: {
      'main.tf': `variable "menu" {
  type = map(number)
  default = {
    nasi = 5
    mee  = 4
  }
}

resource "random_pet" "helper" {
  count  = 2
  length = 1
}

resource "local_file" "price" {
  for_each = var.menu
  filename = "prices/\${each.key}.txt"
  content  = "\${each.key} costs RM\${each.value}\\n"
}

output "files" {
  value = [for f in local_file.price : f.filename]
}

output "helpers" {
  value = random_pet.helper[*].id
}
`,
      '.next/main.tf': `variable "menu" {
  type = map(number)
  default = {
    nasi = 6
    teh  = 2
  }
}

resource "random_pet" "helper" {
  count  = 1
  length = 1
}

resource "local_file" "price" {
  for_each = var.menu
  filename = "prices/\${each.key}.txt"
  content  = "\${each.key} costs RM\${each.value}\\n"
}

output "files" {
  value = [for f in local_file.price : f.filename]
}

output "helpers" {
  value = random_pet.helper[*].id
}
`,
    },
    verify: [
      ['tofu init', 'tofu apply -auto-approve', 'tofu state list', 'tofu state show \'local_file.price["mee"]\'', 'tofu state show random_pet.helper[0]', 'ls prices'],
      ['tofu init', 'tofu apply -auto-approve', 'cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list'],
    ],
  },
  {
    // T2: a data source reads a file; depends_on; a change in the file replaces the copy.
    id: 't2-data',
    files: {
      'recipe.txt': 'Rice, coconut milk, pandan\n',
      'main.tf': `data "local_file" "recipe" {
  filename = "recipe.txt"
}

resource "random_pet" "chef" {
  length = 1
}

resource "local_file" "copy" {
  filename   = "copy.txt"
  content    = data.local_file.recipe.content
  depends_on = [random_pet.chef]
}

output "recipe" {
  value = data.local_file.recipe.content
}
`,
    },
    verify: [
      ['tofu init', 'tofu plan', 'tofu apply -auto-approve', "printf 'Rice, coconut milk\\nSambal\\n' > recipe.txt", 'tofu plan', 'tofu apply -auto-approve', 'cat copy.txt'],
      ['tofu init', 'tofu apply -auto-approve', 'rm recipe.txt', 'tofu plan'],
    ],
  },
  {
    // T3: drift — someone changed the real thing; plan, refresh-only; state list/show/mv/rm.
    id: 't3-drift',
    files: { 'main.tf': MENU },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['rm menu.txt', 'tofu plan', 'tofu plan -refresh-only', 'tofu apply -refresh-only -auto-approve', 'tofu state list', 'tofu apply -auto-approve'],
      ["printf 'hacked\\n' > menu.txt", 'tofu plan', 'tofu plan -target=random_pet.stall'],
      ['tofu plan -replace=random_pet.stall', 'tofu apply -replace=random_pet.stall -auto-approve', 'tofu output'],
      ['tofu state list', 'tofu state show local_file.menu', 'tofu state mv random_pet.stall random_pet.chef', 'tofu plan', 'tofu state rm local_file.menu', 'tofu state list', 'tofu state show local_file.menu', 'tofu plan'],
    ],
  },
  {
    // T3: refactoring with a moved block, and adopting an existing value with an import block.
    id: 't3-moved',
    files: { 'main.tf': MENU },
    steps: [
      'tofu init',
      'tofu apply -auto-approve',
      {
        write: 'main.tf',
        content: `resource "random_pet" "chef" {
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
`,
      },
    ],
    verify: [['tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'tofu plan']],
  },
  {
    id: 't3-import',
    files: {
      'main.tf': `resource "random_string" "code" {
  length  = 5
  special = false
}

import {
  to = random_string.code
  id = "KEDAI"
}

resource "random_integer" "table" {
  min = 1
  max = 100
}
`,
    },
    verify: [
      ['tofu init', 'tofu plan', 'tofu apply -auto-approve', 'tofu state show random_string.code'],
      ['tofu init', 'tofu import random_integer.table 42,1,100', 'tofu state show random_integer.table', 'tofu state list'],
    ],
  },
  {
    // T3: secrets end up in the state file, even when the screen hides them.
    id: 't3-secrets',
    files: {
      'main.tf': `resource "random_password" "pin" {
  length  = 8
  special = false
}

resource "local_sensitive_file" "safe" {
  filename = "safe.txt"
  content  = "pin=\${random_password.pin.result}\\n"
}

output "pin" {
  value     = random_password.pin.result
  sensitive = true
}
`,
    },
    verify: [['tofu init', 'tofu plan', 'tofu apply -auto-approve', 'tofu output', 'tofu output -raw pin', 'tofu state show random_password.pin', 'tofu show', 'cat terraform.tfstate']],
  },
  {
    // T3: lifecycle — prevent_destroy, create_before_destroy, ignore_changes; triggers_replace.
    id: 't3-lifecycle',
    files: {
      'main.tf': `resource "random_pet" "chef" {
  length = 1
  lifecycle {
    create_before_destroy = true
  }
}

resource "terraform_data" "board" {
  input = "today"
  lifecycle {
    ignore_changes = [input]
  }
}

resource "terraform_data" "bell" {
  triggers_replace = [random_pet.chef.id]
}

resource "random_integer" "safe" {
  min = 100
  max = 999
  lifecycle {
    prevent_destroy = true
  }
}
`,
      '.next/main.tf': `resource "random_pet" "chef" {
  length = 2
  lifecycle {
    create_before_destroy = true
  }
}

resource "terraform_data" "board" {
  input = "tomorrow"
  lifecycle {
    ignore_changes = [input]
  }
}

resource "terraform_data" "bell" {
  triggers_replace = [random_pet.chef.id]
}

resource "random_integer" "safe" {
  min = 100
  max = 999
  lifecycle {
    prevent_destroy = true
  }
}
`,
    },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list'],
      ['tofu destroy -auto-approve'],
      ['tofu destroy -exclude=random_integer.safe -auto-approve', 'tofu state list'],
    ],
  },
  {
    // T4: a local module with inputs and outputs.
    id: 't4-modules',
    files: {
      'main.tf': `module "kiosk" {
  source = "./modules/kiosk"
  name   = "teh-tarik"
}

module "stall" {
  source = "./modules/kiosk"
  name   = "nasi-lemak"
}

output "files" {
  value = [module.kiosk.file, module.stall.file]
}
`,
      'modules/kiosk/main.tf': `variable "name" {
  type = string
}

resource "local_file" "sign" {
  filename = "\${var.name}.txt"
  content  = "Kiosk: \${var.name}\\n"
}

output "file" {
  value = local_file.sign.filename
}
`,
    },
    verify: [
      // (`tofu providers` lists child modules in a random order, so it is checked in t1-food-court instead.)
      ['tofu plan', 'tofu init', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'tofu state list module.kiosk', 'tofu output'],
    ],
  },
  {
    // T1: a plan with every action for PlanReader — create, update in place, destroy, replace.
    id: 't1-plan-reader',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 1
}

resource "terraform_data" "board" {
  input = "Open 9am"
}

resource "local_file" "old_menu" {
  filename = "old-menu.txt"
  content  = "Teh tarik\\n"
}
`,
      '.next/main.tf': `resource "random_pet" "stall" {
  length = 2
}

resource "terraform_data" "board" {
  input = "Open 8am"
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Teh tarik\\nKopi\\n"
}
`,
    },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [['cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list']],
  },
  {
    // T1/T4: a saved plan applies exactly what was reviewed.
    id: 't1-plan-file',
    files: { 'main.tf': MENU },
    verify: [['tofu init', 'tofu plan -out tfplan', 'tofu show tfplan', 'tofu apply tfplan', 'tofu apply tfplan', 'tofu plan -destroy -out gone', 'tofu apply gone', 'tofu state list']],
  },
];
