import { describe, expect, it } from 'vitest';
import { formatSource, unifiedDiff } from '../fmt';

// Input and expected output measured with `tofu fmt` (OpenTofu 1.12.4).
const MESSY = `resource "random_pet" "stall" {
length=2
    separator    = "_"
  prefix = "kedai"
}

resource "local_file"   "menu"  {
  filename = "menu.txt"
  content = "Nasi lemak\\n"
  file_permission="0644"


  directory_permission = "0755"
}

locals {
  prices = {nasi=5,mee=4}
  list = [ 1,2 ,3 ]
  long_name_here = "a"
  b = "b" # comment
}

output "x" {
     value =   local.prices
}
`;

const TIDY = `resource "random_pet" "stall" {
  length    = 2
  separator = "_"
  prefix    = "kedai"
}

resource "local_file" "menu" {
  filename        = "menu.txt"
  content         = "Nasi lemak\\n"
  file_permission = "0644"


  directory_permission = "0755"
}

locals {
  prices         = { nasi = 5, mee = 4 }
  list           = [1, 2, 3]
  long_name_here = "a"
  b              = "b" # comment
}

output "x" {
  value = local.prices
}
`;

describe('tofu fmt', () => {
  it('formats like OpenTofu (indent, spacing, = alignment broken by blank lines)', () => {
    expect(formatSource(MESSY, 'main.tf')).toBe(TIDY);
  });

  it('leaves tidy files alone and keeps heredocs as written', () => {
    expect(formatSource(TIDY, 'main.tf')).toBe(TIDY);
    const h = 'resource "local_file" "m" {\n  filename = "m.txt"\n  content  = <<-EOT\n      any   spacing\n  EOT\n}\n';
    expect(formatSource(h, 'main.tf')).toBe(h);
  });

  it('does not align a multi-line value with the lines around it', () => {
    const src = 'resource "random_integer" "t" {\n  min = 1\n  max = 9\n  keepers = {\n    day = "monday"\n  }\n}\n';
    expect(formatSource(src, 'main.tf')).toBe(src);
  });

  it('-diff prints a unified diff with removed lines first', () => {
    const d = unifiedDiff('variable "shop" {\n  type = string\n  default = "Kedai"\n}\n', 'variable "shop" {\n  type    = string\n  default = "Kedai"\n}\n', 'variables.tf');
    expect(d).toBe(['--- old/variables.tf', '+++ new/variables.tf', '@@ -1,4 +1,4 @@', ' variable "shop" {', '-  type = string', '+  type    = string', '   default = "Kedai"', ' }'].join('\n'));
  });
});
