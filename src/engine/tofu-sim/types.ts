// Core types for the OpenTofu simulator (OpenTofu 1.13 on one laptop, providers random, local,
// null and the built-in terraform_data). Pure TypeScript: no DOM, no React, no i18n strings.
// The state is plain data, so structuredClone copies it and lessons can save it.
import type { Line } from '../git-sim/types';
import type { Val } from './values';

export type { Color, Line, Seg } from '../git-sim/types';

/** What `tofu init` set up in .terraform/. */
export interface InitInfo {
  /** Installed providers ("hashicorp/random" → "3.9.1"). */
  providers: Record<string, string>;
  /** Installed local modules: key ("kiosk", "kiosk.inner") → folder ("modules/kiosk"). */
  modules: Record<string, string>;
}

export type ActionKind = 'create' | 'update' | 'delete' | 'replace' | 'noop' | 'read';

/** One resource instance change in a plan. Values are object values (may hold unknowns). */
export interface Change {
  addr: string;
  module: string;
  mode: 'managed' | 'data';
  type: string;
  name: string;
  key?: string | number;
  action: ActionKind;
  /** For replace: "-/+" (destroy first) or "+/-" (create_before_destroy). */
  cbd?: boolean;
  before: Val | null;
  after: Val | null;
  /** Attribute names that force the replacement. */
  forces: string[];
  /** Why a delete happens ("not in configuration", count/each key gone). */
  reason?: 'gone' | 'countIndex' | 'eachKey' | 'noModule';
  /** Why a data source waits for apply. */
  readReason?: 'unknown' | 'pending';
  movedFrom?: string;
  importId?: string;
  /** Replaced because the plan said -replace=ADDR. */
  requested?: boolean;
  provider: string;
  /** Resources this one depends on (for the state file and apply order). */
  deps: string[];
  /** Dependencies only used for ordering (depends_on chains included). */
  sensitive?: string[];
}

export interface OutputChange {
  name: string;
  before: Val | null;
  after: Val | null;
  sensitive: boolean;
}

/** A finished plan. Also what `tofu plan -out` saves. */
export interface Plan {
  kind: 'normal' | 'destroy' | 'refresh';
  changes: Change[];
  /** Changes made outside OpenTofu, found while refreshing. */
  drift: Change[];
  outputs: OutputChange[];
  /** -target or -exclude was used. */
  targeted: boolean;
  /** -target was used (a plan with no changes then says so). */
  usedTarget?: boolean;
  /** The refreshed state the plan was made against (JSON text). */
  prior: string;
  /** Lineage + serial of the state when planned (a saved plan goes stale when they change). */
  lineage: string;
  serial: number;
  /** Variable values used, for apply. */
  vars: Record<string, unknown>;
  /** Check results to store in the state (variable validations). */
  checks: CheckResult[];
}

export interface CheckResult {
  object_kind: string;
  config_addr: string;
  status: 'pass' | 'fail' | 'unknown';
  objects: { object_addr: string; status: string }[];
}

/** Waiting for the learner to type something. */
export type Pending =
  | { kind: 'approve'; command: 'apply' | 'destroy'; plan: Plan; line: string; flags: Record<string, unknown> }
  | { kind: 'var'; line: string; names: string[]; values: Record<string, string> };

export interface TofuState {
  /** Project files, relative to the project folder (main.tf, terraform.tfstate, menu.txt …). */
  files: Record<string, string>;
  /** Folders that exist besides the ones files imply (relative). */
  dirs: string[];
  /** .terraform/ contents after `tofu init`; null before. */
  init: InitInfo | null;
  /** Saved plan files by name (the file itself is also listed in `files`). */
  plans: Record<string, Plan>;
  pending: Pending | null;
  /** Exported shell variables (TF_VAR_name …). */
  env: Record<string, string>;
  /** Random generator state (seeded, so every scenario replays the same way). */
  seed: number;
  /** Fake clock (unix seconds). */
  clock: number;
  /** The project folder's name ("kedai" → prompt ~/kedai). */
  dir: string;
  /** The last plan's actions per address (drawn on the "blueprint vs built" picture). */
  lastPlan: Record<string, string> | null;
}

export interface Explain {
  key: string;
  params?: Record<string, string | number>;
}

export type TofuEvent =
  | { type: 'initDone'; providers: string[]; modules: string[] }
  | { type: 'planned'; add: number; change: number; destroy: number; import: number; actions: Record<string, string> }
  | { type: 'applied'; add: number; change: number; destroy: number; import: number }
  | { type: 'stateChanged' }
  | { type: 'fileWritten'; path: string }
  | { type: 'fileRemoved'; path: string }
  | { type: 'formatted'; files: string[] }
  | { type: 'validated'; ok: boolean }
  | { type: 'waiting'; for: 'approve' | 'var' }
  | { type: 'cancelled' }
  | { type: 'cleared' }
  | { type: 'error'; code: string };

export interface TofuResult {
  state: TofuState;
  output: Line[];
  events: TofuEvent[];
  ok: boolean;
  exitCode: number;
  /** The friendly line under the terminal (i18n key under tofu.explain.* / tofu.err.*). */
  explain?: Explain;
  /** True when the command stopped on purpose (a question, `fmt -check` finding files) — not a mistake. */
  stopped?: boolean;
}

export interface TofuScenario {
  id: string;
  /** Project folder name under /home/you (default "kedai"). */
  dir?: string;
  /** Starting files (relative paths). */
  files: Record<string, string>;
  /** Commands run before the learner starts (each must succeed), or file edits. */
  steps?: (string | { write: string; content: string } | { delete: string })[];
  /** Command lists checked against real OpenTofu by `npm run verify:tofu`. "yes" answers a question. */
  verify?: string[][];
  /** Seed for random_* values (default 1). */
  seed?: number;
  /** Why this scenario can only run in the engine (skips the truth check). */
  engineOnly?: string;
}
