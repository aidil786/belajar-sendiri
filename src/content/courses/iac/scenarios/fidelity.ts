// Fidelity scenarios: no lesson uses them. They pin down output a learner can reach by typing
// freely, where the engine once printed something else than real OpenTofu (found by the truth
// check on 2026-11-01). `npm run verify:tofu` (VERIFY_ONLY=fidelity) runs every list with the real
// OpenTofu. Unit tests: src/engine/tofu-sim/__tests__/fidelity.test.ts.
import type { TofuScenario } from '~/engine/tofu-sim';

const TABLES = `variable "tables" {
  type    = number
  default = 4
  validation {
    condition     = var.tables >= 1 && var.tables <= 10
    error_message = "Tables must be between 1 and 10."
  }
}

variable "open" {
  type    = bool
  default = true
}

resource "random_pet" "stall" {
  length = 1
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "\${var.tables} tables\\n"
}

output "pet" {
  value = random_pet.stall.id
}

output "sign_file" {
  value = local_file.sign.filename
}
`;

const OUTPUTS = (menu: string, days: string) => `variable "menu" {
  type    = list(string)
  default = ${menu}
}

variable "days" {
  type    = list(string)
  default = ${days}
}

variable "prices" {
  type = map(number)
  default = {
    nasi = 5
    teh  = 2
  }
}

variable "tables" {
  type    = number
  default = 4
}

output "menu" {
  value = var.menu
}

output "days" {
  value = var.days
}

output "dishes" {
  value = keys(var.prices)
}

output "tables" {
  value = var.tables
}

output "prices" {
  value = var.prices
}

output "teh" {
  value = { for k, v in var.prices : k => v * 2 }
}

output "longest_output_name" {
  value = "stays the same"
}
`;

const REPLACE = `resource "random_pet" "stall" {
  length = 1
}

resource "local_file" "menu" {
  filename = "menu.txt"
  content  = <<-EOT
    Stall \${random_pet.stall.id}
    Nasi lemak
  EOT
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Stall \${random_pet.stall.id}"
}

resource "random_pet" "helper" {
  keepers = {
    stall = random_pet.stall.id
  }
}

resource "terraform_data" "board" {
  input = [random_pet.stall.id, "Nasi lemak"]
}
`;

export const fidelity: TofuScenario[] = [
  {
    // Gaps 1 + 2: a -var that breaks a validation rule (real: "Planning failed." and no partial
    // plan), and a -var of the wrong type (real: "Unsuitable value for var.x set using -var=…").
    id: 'fidelity-var-checks',
    files: { 'main.tf': TABLES, '.next/main.tf': `${TABLES}
output "greeting" {
  value = "Selamat datang"
}
` },
    verify: [
      ['tofu init', 'tofu plan -var tables=20', 'tofu plan -var tables=lots', 'tofu plan -var open=maybe', 'tofu apply -var tables=0 -auto-approve'],
      ['tofu init', 'tofu apply -auto-approve', 'tofu plan -var tables=20', 'tofu apply -var tables=lots', 'cp .next/main.tf main.tf', 'tofu plan -var tables=11', 'export TF_VAR_tables=lots', 'tofu plan', 'tofu plan -var tables=2'],
    ],
  },
  {
    // A value typed at the question that has the wrong type.
    id: 'fidelity-var-prompt',
    files: {
      'main.tf': `variable "tables" {
  type = number
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "\${var.tables} tables\\n"
}
`,
    },
    verify: [['tofu init', 'tofu plan', 'lots']],
  },
  {
    // Gaps 3, 4, 5: changed outputs next to unchanged ones, list outputs with unchanged items,
    // keys() of a map variable.
    id: 'fidelity-outputs',
    files: {
      'main.tf': OUTPUTS('["nasi", "teh", "roti"]', '["isnin", "selasa", "rabu", "khamis", "jumaat", "sabtu"]'),
      '.next/main.tf': OUTPUTS('["nasi", "teh", "kopi"]', '["isnin", "selasa", "rabu", "khamis", "jumaat", "ahad"]'),
      'prices.tfvars': 'prices = {\n  nasi = 6\n  teh  = 2\n  kopi = 3\n}\n',
    },
    verify: [
      ['tofu init', 'tofu plan', 'tofu apply -auto-approve', 'tofu output', 'tofu output dishes', 'tofu show'],
      ['tofu init', 'tofu apply -auto-approve', 'cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve -var tables=5'],
      ['tofu init', 'tofu apply -auto-approve', 'tofu plan -var-file=prices.tfvars', 'tofu apply -auto-approve -var-file=prices.tfvars', 'tofu output prices', 'tofu output teh'],
    ],
  },
  {
    // Gaps 6 + 7: strings that become unknown when the pet they quote is replaced (a heredoc and
    // a one-line string, both forcing replacement).
    id: 'fidelity-unknown',
    files: { 'main.tf': REPLACE },
    verify: [['tofu init', 'tofu apply -auto-approve', 'tofu plan -replace=random_pet.stall']],
  },
  {
    // Gap 8: plan -destroy with nothing built, but outputs in the config.
    id: 'fidelity-destroy-empty',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 1
}

output "stall" {
  value = random_pet.stall.id
}

output "greeting" {
  value = "Selamat datang"
}
`,
      '.next/main.tf': `resource "random_pet" "stall" {
  length = 1
}

output "stall" {
  value = random_pet.stall.id
}

output "greeting" {
  value = "Jumpa lagi"
}

output "added_later" {
  value = "new"
}
`,
    },
    verify: [
      ['tofu init', 'tofu plan -destroy', 'tofu destroy -auto-approve'],
      ['tofu init', 'tofu apply -auto-approve', 'cp .next/main.tf main.tf', 'tofu plan -destroy'],
    ],
  },
  {
    // Gap 9: "Missing required argument" names the resource on the location line.
    id: 'fidelity-missing-arg',
    files: {
      'main.tf': `resource "local_file" "sign" {
  content = "Kedai Kancil"
}
`,
      '.next/main.tf': `resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Kedai Kancil"
}

output "nothing" {
}
`,
    },
    verify: [['tofu init', 'tofu validate', 'tofu plan', 'cp .next/main.tf main.tf', 'tofu validate']],
  },
  {
    // Probes: map keys line up on the longest key (changed or not), a one-line string that becomes
    // two lines, "$${" in strings, a wrong type from a -var-file, two questions in a row.
    id: 'fidelity-more',
    files: {
      'main.tf': `variable "menu_prices" {
  type = map(number)
  default = {
    nasi      = 5
    teh_tarik = 2
  }
}

variable "a" {
  type    = string
  default = "x"
}

variable "note" {
  type    = string
  default = "one line"
}

variable "tables" {
  type    = number
  default = 4
}

resource "random_pet" "helper" {
  keepers = {
    a               = var.a
    much_longer_key = "x"
  }
}

resource "local_file" "note" {
  filename = "note.txt"
  content  = var.note
}

output "menu_prices" {
  value = var.menu_prices
}

output "tmpl" {
  value = "Harga: $\${harga}"
}

output "tables" {
  value = var.tables
}
`,
      'more.tfvars': 'menu_prices = {\n  nasi      = 6\n  teh_tarik = 2\n}\na    = "y"\nnote = "two\\nlines\\n"\n',
      'bad.tfvars': 'tables = "lots"\n',
    },
    verify: [
      ['tofu init', 'tofu apply -auto-approve', 'tofu output', 'tofu plan -var-file=more.tfvars', 'tofu plan -var-file=bad.tfvars'],
    ],
  },
  {
    // A CLI `tofu import` saves the outputs it can work out (real OpenTofu writes them to the state).
    id: 'fidelity-cli-import',
    files: {
      'main.tf': `resource "random_string" "door" {
  length = 6
}

resource "random_pet" "stall" {
  length = 1
}

output "door" {
  value = random_string.door.result
}

output "greeting" {
  value = "Selamat datang"
}

output "stall" {
  value = random_pet.stall.id
}
`,
    },
    verify: [['tofu init', 'tofu import random_string.door KANCIL', 'tofu output', 'tofu plan', 'tofu apply -auto-approve', 'tofu output']],
  },
  {
    // "No changes" in OpenTofu 1.13: no explanation paragraph after a plan or apply; a note with
    // -target (not with -exclude); destroy and refresh-only keep theirs. Backups (terraform.tfstate
    // .backup and the timestamped ones from state rm) use the state file's indented layout.
    // (Both versions: a destroy with -target or -exclude shows no output changes and keeps the
    // saved outputs.)
    id: 'fidelity-no-changes',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 1
}

resource "terraform_data" "board" {
  input = "Kedai Kancil"
}

output "stall" {
  value = random_pet.stall.id
}
`,
    },
    verify: [
      ['tofu init', 'tofu apply -auto-approve', 'tofu plan', 'tofu apply', 'tofu plan -exclude=terraform_data.board', 'tofu plan -target=terraform_data.board', 'tofu apply -auto-approve -target=terraform_data.board', 'tofu plan -replace=terraform_data.board -target=terraform_data.board -out=tfplan'],
      ['tofu init', 'tofu apply -auto-approve', 'tofu plan -refresh-only', 'tofu destroy -auto-approve -target=terraform_data.board', 'tofu output', 'tofu destroy -auto-approve -target=terraform_data.board', 'tofu plan -destroy -exclude=terraform_data.board', 'tofu state rm random_pet.stall', 'cat terraform.tfstate.backup'],
    ],
  },
  {
    id: 'fidelity-two-questions',
    files: {
      'main.tf': `variable "shop" {
  type = string
}

variable "tables" {
  type = number
}

output "sign" {
  value = "\${var.shop}: \${var.tables}"
}
`,
    },
    verify: [['tofu init', 'tofu plan', 'Kedai', '4']],
  },
  {
    // Gap 10: tofu output with a name that isn't there (line wrapping of the error).
    id: 'fidelity-output-missing',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 1
}

output "stall_name" {
  value = random_pet.stall.id
}
`,
    },
    verify: [['tofu output nope', 'tofu init', 'tofu apply -auto-approve', 'tofu output nope', 'tofu output -raw a_much_longer_name_that_is_missing', 'tofu output -json nope']],
  },
];
