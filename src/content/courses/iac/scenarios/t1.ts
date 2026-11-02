// World T1 "Blueprints" scenarios (lessons iac-t1-l01 … l08 and the boss), checked against real
// OpenTofu 1.13.5 by `npm run verify:tofu` (VERIFY_ONLY=t1). The story: Kedai Kancil's architect
// draws a blueprint (.tf files); OpenTofu builds exactly that (local files and random names).
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

// One stall name and its sign (lessons 3, 5, 6).
const STALL = `resource "random_pet" "stall" {
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

const HOURS = (hours: string) => `resource "random_pet" "stall" {
  length = 2
}

resource "terraform_data" "hours" {
  input = "${hours}"
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Welcome to \${random_pet.stall.id}\\n"
}
`;

const COURT = (o: { length: number; bell: string; lamp: boolean; menu: boolean }) => `resource "random_pet" "stall" {
  length = ${o.length}
}

resource "random_integer" "table" {
  min = 100
  max = 999
}

resource "local_file" "board" {
  filename = "board.txt"
  content  = "Table \${random_integer.table.result}"
}

resource "terraform_data" "bell" {
  input = "${o.bell}"
}
${o.lamp ? `
resource "null_resource" "lamp" {
  triggers = {
    table = random_integer.table.result
  }
}
` : ''}${o.menu ? `
resource "local_file" "menu" {
  filename = "menu.txt"
  content  = "Nasi lemak\\nTeh tarik\\n"
}
` : ''}`;

const COURT_1 = COURT({ length: 1, bell: 'ring', lamp: true, menu: false });
const COURT_2 = COURT({ length: 2, bell: 'ding dong', lamp: false, menu: true });

export const t1: TofuScenario[] = [
  {
    // l01: one sign from a blueprint. The card runs init; the learner types tofu apply, then yes.
    id: 't1-sign',
    files: {
      'main.tf': `resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Kedai Kancil. Open 8am to 10pm.\\n"
}
`,
    },
    verify: [['tofu init', 'tofu apply', 'yes', 'cat sign.txt', 'tofu plan', 'ls']],
  },
  {
    // l02: blocks and references. The learner changes the sign's words, then applies.
    id: 't1-blocks',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Welcome to \${random_pet.stall.id}\\n"
}
`,
      '.next/main.tf': `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "sign" {
  filename = "sign.txt"
  content  = "Selamat datang ke \${random_pet.stall.id}\\n"
}
`,
    },
    steps: ['tofu init'],
    verify: [
      ['tofu apply', 'yes', 'cat sign.txt'],
      ['cp .next/main.tf main.tf', 'tofu apply', 'yes', 'cat sign.txt'],
      ['tofu apply -auto-approve', 'cp .next/main.tf main.tf', 'tofu plan'],
    ],
  },
  {
    // l05: the blueprint is ready (init done); nothing is built yet.
    id: 't1-ready',
    files: { 'providers.tf': PROVIDERS, 'main.tf': STALL },
    steps: ['tofu init'],
    verify: [
      ['tofu apply', 'yes', 'tofu state list', 'tofu destroy', 'yes', 'tofu state list', 'ls'],
      ['tofu apply', 'y', 'tofu state list'],
      ['tofu version'],
    ],
  },
  {
    // l05, l06: built. Destroy it, read the state, or delete the sign by hand (drift).
    id: 't1-built',
    files: { 'providers.tf': PROVIDERS, 'main.tf': STALL },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [
      ['tofu destroy', 'yes', 'tofu state list', 'ls'],
      ['tofu destroy', 'y', 'tofu state list'],
      ['tofu state list', 'tofu state show random_pet.stall', 'tofu state show local_file.sign', 'tofu show'],
      ['rm sign.txt', 'tofu plan', 'tofu apply', 'yes', 'cat sign.txt'],
      ['ls', 'tofu plan', 'tofu output', 'tofu plan -destroy'],
    ],
  },
  {
    // l04: a built stall with opening hours: change the hours to see ~ (update in place).
    id: 't1-hours',
    files: { 'main.tf': HOURS('8am to 10pm'), '.next/main.tf': HOURS('7am to 11pm') },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [['cp .next/main.tf main.tf', 'tofu plan', 'tofu apply -auto-approve', 'tofu state show terraform_data.hours']],
  },
  {
    // l07: two mistakes for validate: an argument random_pet doesn't have, and a misspelt reference.
    id: 't1-fix-me',
    files: {
      'main.tf': `resource "random_pet" "stall" {
  length = 2
  colour = "red"
}

resource "local_file" "sign" {
  content  = "Welcome to \${random_pet.stal.id}\\n"
  filename = "sign.txt"
}
`,
      '.next/main.tf': `resource "random_pet" "stall" {
  length = 2
}

resource "local_file" "sign" {
  content  = "Welcome to \${random_pet.stall.id}\\n"
  filename = "sign.txt"
}
`,
    },
    steps: ['tofu init'],
    verify: [
      ['tofu validate', 'cp .next/main.tf main.tf', 'tofu validate', 'tofu apply', 'yes'],
      ['tofu plan', 'tofu apply'],
    ],
  },
  {
    // Boss: a tiny food court (stall name, table number, board, bell, lamp). A fresh copy: no init yet.
    id: 't1-boss',
    files: { 'main.tf': COURT_1, '.next/main.tf': COURT_2 },
    verify: [
      ['tofu plan', 'tofu init', 'tofu plan', 'tofu apply', 'yes', 'tofu state list', 'cat board.txt'],
      ['tofu init', 'tofu apply -auto-approve', 'cp .next/main.tf main.tf', 'tofu plan', 'tofu apply', 'yes', 'tofu state list', 'tofu destroy', 'yes', 'tofu state list', 'ls'],
    ],
  },
  {
    // Boss: built, and the next version of the blueprint is in place (PlanReader, then apply).
    id: 't1-boss-next',
    files: { 'main.tf': COURT_1, '.next/main.tf': COURT_2 },
    steps: ['tofu init', 'tofu apply -auto-approve', 'cp .next/main.tf main.tf'],
    verify: [['tofu plan', 'tofu apply', 'yes', 'tofu state list', 'cat menu.txt']],
  },
  {
    // Boss: the fair is over. Tear the new version down.
    id: 't1-boss-done',
    files: { 'main.tf': COURT_2 },
    steps: ['tofu init', 'tofu apply -auto-approve'],
    verify: [['tofu destroy', 'yes', 'tofu state list', 'ls']],
  },
];
