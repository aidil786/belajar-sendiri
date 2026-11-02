// World T2 "Inputs & Outputs" scenarios (lessons iac-t2-l01 … l08 and the boss), checked against
// real OpenTofu 1.13.5 by `npm run verify:tofu` (VERIFY_ONLY=t2). One blueprint, many buildings:
// variables, tfvars files, outputs, locals, count, for_each, data sources and functions.
// In a verify list, a line right after a command that asks a question is the answer ("yes", a value).
// Files under .next/ are the "next version" a list copies in with `cp` (hidden from the tabs).
import type { TofuScenario } from '~/engine/tofu-sim';

const VARS = `variable "shop" {
  type        = string
  description = "The shop's name"
}

variable "tables" {
  type    = number
  default = 4
  validation {
    condition     = var.tables >= 1 && var.tables <= 10
    error_message = "Tables must be between 1 and 10."
  }
}
`;

const SIGN = `resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "\${var.shop}: \${var.tables} tables\\n"
}
`;

const OUTPUTS = (more: string) => `output "stall_name" {
  value = random_pet.stall.id
}
${more}`;

const HOURS = (hours: string) => `locals {
  hours = "${hours}"
}

resource "local_file" "door" {
  filename = "door.txt"
  content  = "Open \${local.hours}\\n"
}

resource "local_file" "board" {
  filename = "board.txt"
  content  = "Kedai Kancil, \${local.hours}\\n"
}
`;

const COUNT = (helpers: number) => `resource "random_pet" "helper" {
  count  = ${helpers}
  length = 1
}

resource "local_file" "stall" {
  count    = length(var.stalls)
  filename = "stall-\${count.index}.txt"
  content  = "\${var.stalls[count.index]}\\n"
}
`;

const STALLS = (type: string, list: string) => `variable "stalls" {
  type    = ${type}
  default = ${list}
}
`;

const FOR_EACH = `resource "local_file" "stall" {
  for_each = var.stalls
  filename = "\${each.key}.txt"
  content  = "Stall: \${each.key}\\n"
}
`;

const PRICES = `variable "prices" {
  type = map(number)
  default = {
    nasi = 5
    teh  = 2
  }
}

resource "local_file" "price" {
  for_each = var.prices
  filename = "\${each.key}-price.txt"
  content  = "\${each.key}: RM\${each.value}\\n"
}
`;

const RECIPE = `data "local_file" "recipe" {
  filename = "recipe.txt"
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Today: \${data.local_file.recipe.content}"
}

output "recipe" {
  value = data.local_file.recipe.content
}
`;

const FUNCS = (sign: string) => `variable "shop" {
  type    = string
  default = "Kedai Kancil"
}

variable "stalls" {
  type    = list(string)
  default = ["nasi", "mee", "roti"]
}

variable "open" {
  type    = bool
  default = true
}

output "shop_sign" {
  value = ${sign}
}

output "menu" {
  value = join(", ", var.stalls)
}

output "banner" {
  value = format("%s has %d stalls", var.shop, length(var.stalls))
}

output "door" {
  value = var.open ? "OPEN" : "CLOSED"
}
`;

const BOSS_VARS = `variable "stalls" {
  type        = map(number)
  description = "Stall name => price of its best dish (RM)"
}
`;

const BOSS_MAIN = `resource "local_file" "stall" {
  for_each = var.stalls
  filename = "stalls/\${each.key}.txt"
  content  = "\${each.key}: RM\${each.value}\\n"
}
`;

const BOSS_OUT = `output "stall_files" {
  value = join(", ", [for s in local_file.stall : s.filename])
}
`;

const tfvars = (stalls: Record<string, number>) => `stalls = {
${Object.entries(stalls)
  .map(([k, v]) => `  ${k.padEnd(Math.max(...Object.keys(stalls).map((x) => x.length)))} = ${v}`)
  .join('\n')}
}
`;

export const t2: TofuScenario[] = [
  {
    // l01: a required variable (asked for) and a number with a validation rule.
    id: 't2-vars',
    files: { 'variables.tf': VARS, 'main.tf': SIGN },
    steps: ['tofu init'],
    verify: [
      ['tofu apply', 'Kedai Kancil', 'yes', 'cat sign.txt'],
      ['tofu plan -var shop=Kedai -var tables=6'],
    ],
  },
  {
    // l02: terraform.tfvars is read by itself; penang.tfvars only with -var-file; -var wins last.
    id: 't2-tfvars',
    files: {
      'variables.tf': VARS,
      'main.tf': SIGN,
      'terraform.tfvars': 'shop = "Kedai Kancil"\n',
      'penang.tfvars': 'shop   = "Kedai Kancil Penang"\ntables = 8\n',
    },
    steps: ['tofu init'],
    verify: [
      ['tofu plan', 'tofu apply -var-file=penang.tfvars', 'yes', 'cat sign.txt'],
      ['tofu plan -var-file=penang.tfvars -var tables=2'],
      ['tofu plan -var tables=2 -var-file=penang.tfvars'],
      ['rm terraform.tfvars', 'tofu plan -input=false'],
    ],
  },
  {
    // l03: outputs: read them, add one, -raw and -json.
    id: 't2-outputs',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Welcome to \${random_pet.stall.id}\\n"
}
`,
      'outputs.tf': OUTPUTS(''),
      '.next/outputs.tf': OUTPUTS(`
output "sign_filename" {
  value = local_file.sign.filename
}
`),
    },
    steps: ['tofu init'],
    verify: [
      ['tofu output', 'tofu apply', 'yes', 'tofu output', 'tofu output -raw stall_name', 'tofu output -json'],
      ['tofu apply -auto-approve', 'cp .next/outputs.tf outputs.tf', 'tofu plan', 'tofu apply', 'yes', 'tofu output sign_filename'],
    ],
  },
  {
    // l04: one local value used twice; change it once, both files follow.
    id: 't2-locals',
    files: { 'main.tf': HOURS('8am to 10pm'), '.next/main.tf': HOURS('7am to 11pm') },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [['cat door.txt', 'cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'cat door.txt', 'cat board.txt']],
  },
  {
    // l05: count — numbered copies; removing an item from the middle shifts the numbers.
    id: 't2-count',
    files: {
      'variables.tf': STALLS('list(string)', '["nasi", "mee", "roti"]'),
      'main.tf': COUNT(2),
      '.next/main.tf': COUNT(3),
      '.next/variables.tf': STALLS('list(string)', '["nasi", "roti"]'),
    },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['tofu state list', 'cat stall-1.txt', 'tofu state show random_pet.helper[0]'],
      ['cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list'],
      ['cp .next/variables.tf variables.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'ls', 'cat stall-1.txt'],
    ],
  },
  {
    // l06: for_each — one per item, by name; removing one touches only that one.
    id: 't2-for-each',
    files: {
      'variables.tf': STALLS('set(string)', '["nasi", "mee", "roti"]'),
      'main.tf': FOR_EACH,
      '.next/variables.tf': STALLS('set(string)', '["nasi", "roti"]'),
    },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['tofu state list', 'tofu state show \'local_file.stall["mee"]\'', 'cp .next/variables.tf variables.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'ls'],
    ],
  },
  {
    // l06: for_each over a map — each.key and each.value.
    id: 't2-prices',
    files: { 'main.tf': PRICES },
    steps: ['tofu init'],
    verify: [['tofu plan', 'tofu apply -auto-approve', 'tofu state list', 'cat nasi-price.txt']],
  },
  {
    // l07: a data source reads a file that already exists; a new recipe replaces the menu.
    id: 't2-recipe',
    files: { 'recipe.txt': 'Nasi lemak with sambal\n', 'main.tf': RECIPE },
    steps: ['tofu init'],
    verify: [
      ['tofu plan', 'tofu apply', 'yes', 'cat menu.txt', 'tofu output'],
      ['tofu apply -auto-approve', 'echo "Roti canai with dhal" > recipe.txt', 'tofu plan', 'tofu apply', 'yes', 'cat menu.txt'],
      ['rm recipe.txt', 'tofu plan'],
    ],
  },
  {
    // l07: the menu is built from today's recipe; the chef changes the recipe by hand.
    id: 't2-recipe-built',
    files: { 'recipe.txt': 'Nasi lemak with sambal\n', 'main.tf': RECIPE },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['echo "Roti canai with dhal" > recipe.txt', 'tofu apply', 'yes', 'cat menu.txt'],
      ['rm recipe.txt', 'tofu plan'],
    ],
  },
  {
    // l08: functions and a conditional, shown as outputs. The learner makes the sign shout.
    id: 't2-functions',
    files: { 'main.tf': FUNCS('var.shop'), '.next/main.tf': FUNCS('upper(var.shop)') },
    steps: ['tofu init'],
    verify: [
      ['tofu apply -auto-approve', 'tofu output', 'cp .next/main.tf main.tf', 'tofu apply -auto-approve', 'tofu output -raw shop_sign'],
      ['tofu apply -var open=false -auto-approve', 'tofu output -raw door'],
      ["tofu plan -var 'stalls=[\"nasi\"]'"],
    ],
  },
  {
    // Boss: three stalls from one map in terraform.tfvars, then one closes.
    id: 't2-boss',
    files: {
      'variables.tf': BOSS_VARS,
      'main.tf': BOSS_MAIN,
      'outputs.tf': BOSS_OUT,
      'terraform.tfvars': tfvars({ nasi: 5 }),
      '.next/terraform.tfvars': tfvars({ nasi: 5, mee: 4, roti: 2 }),
      '.next/closed.tfvars': tfvars({ nasi: 5, roti: 2 }),
    },
    steps: ['tofu init'],
    verify: [
      ['tofu apply', 'yes', 'cp .next/terraform.tfvars terraform.tfvars', 'tofu plan', 'tofu apply', 'yes', 'tofu output', 'tofu state list'],
      ['cp .next/terraform.tfvars terraform.tfvars', 'tofu apply -auto-approve', 'cp .next/closed.tfvars terraform.tfvars', 'tofu plan', 'tofu apply -auto-approve', 'tofu output -json', 'ls stalls'],
    ],
  },
  {
    // Boss, later stages: the three stalls are built.
    id: 't2-boss-built',
    files: {
      'variables.tf': BOSS_VARS,
      'main.tf': BOSS_MAIN,
      'outputs.tf': BOSS_OUT,
      'terraform.tfvars': tfvars({ nasi: 5, mee: 4, roti: 2 }),
      '.next/closed.tfvars': tfvars({ nasi: 5, roti: 2 }),
      '.next/outputs.tf': `${BOSS_OUT}
output "stall_names" {
  value = join(", ", keys(var.stalls))
}
`,
    },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['tofu output', 'tofu state list', 'ls stalls', 'cp .next/closed.tfvars terraform.tfvars', 'tofu plan'],
      ['cp .next/outputs.tf outputs.tf', 'tofu apply', 'yes', 'tofu output stall_names'],
    ],
  },
];
