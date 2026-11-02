// Lesson MDX sanity check (fast, no full build):
// - only known components; every <Interactive name="..."> is known and has its required props
// - scenario ids and glossary term ids exist
// - demo commands (TermReplay, GraphScene, SpotLines) succeed in the engine
// - simulator goals are not already met before the learner starts
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { buildScenario, checkGoal, findRepo, objectStore, plain, run, type Goal } from '../../src/engine/git-sim/index';
import { allScenarios } from '../../src/content/courses/git/scenarios/index';
import { scenariosByCourse } from '../../src/content/courses/scenarios';
import { lessonFiles, ROOT_COURSE } from '../lib/lessons';
import { checkBranchInteractive } from './branch-interactives';
import { checkKubeInteractive, KUBE_REQUIRED } from './kube-interactives';
import { checkDeepInteractive, checkNewInteractive } from './interactives';
import { checkKitchenInteractive } from './kitchen';
import { checkK8sInteractive, K8S_REQUIRED } from './k8s-games';
import { checkDockerGame, DOCKER_REQUIRED } from './docker-games';
import { checkCourierProps, courierGoalMet, runAction, type CourierGoal } from '../../src/lib/courier';
import { checkConveyorInteractive, CONVEYOR_INTERACTIVES } from './conveyor-interactives';
import { checkPlaygroundProps } from '../../src/lib/yamlPlayground';
import { checkPromqlInteractive, PROMQL_REQUIRED } from './promql-interactives';
import { checkTofuInteractive, TOFU_REQUIRED } from './tofu-interactives';
import { checkLinuxInteractive, LINUX_REQUIRED } from './linux';
// Level Up: AWS games
import { AWS_REQUIRED, checkAwsGame } from './aws-games';

const REQUIRED: Record<string, string[]> = {
  AreasScene: ['frames', 'label'],
  DragToArea: ['items'],
  Sim: ['scenario'],
  Choice: ['options'],
  TermReplay: ['scenario', 'commands'],
  GraphScene: ['scenario', 'commands', 'label'],
  SortCards: ['buckets', 'items'],
  OrderList: ['items'],
  SwipeJudge: ['cards'],
  TimeMachine: ['scenario', 'file'],
  SpotLines: [],
  CommandBuilder: ['pieces'],
  ResetLab: ['scenario'],
  GraphPick: ['scenario', 'answer'],
  HunkPicker: ['file', 'hunks'],
  Hotspots: ['picture', 'spots'],
  TimelineTap: ['events'],
  OsPicker: ['id', 'options'],
  Mission: ['id', 'steps'],
  Placement: ['questions'],
  Challenge: ['stages'],
  LogCheck: ['min'],
  Transcript: ['lines', 'label'],
  PracticeRepo: ['repo'],
  MarkdownPlayground: [],
  YamlBuilder: ['blocks', 'goal', 'workflow'],
  MissionCheck: ['checks'],
  UniverseSplitter: ['scenario', 'task'],
  ConflictResolver: ['scenario'],
  RebaseDeck: ['scenario', 'upstream'],
  Courier: ['scenario'],
  ObjectXray: ['scenario'],
  BisectDetective: ['scenario', 'test'],
  // Ship It: the kitchen engine (Docker)
  KitchenSim: ['scenario'],
  KitchenReplay: ['scenario', 'commands'],
  ...K8S_REQUIRED,
  // Ship It part 2 (CI/CD): scenarios come from the cicd course (course="cicd").
  ConveyorBelt: ['scenario'],
  SpotTheHole: [],
  TrafficDial: [],
  ...DOCKER_REQUIRED,
  ...KUBE_REQUIRED,
  // Docker D0: YAML basics
  YamlPlayground: ['initial'],
  // Level Up · Observability: the PromQL engine (observability scenarios, from any course)
  ...PROMQL_REQUIRED,
  // Level Up · Terraform & OpenTofu
  ...TOFU_REQUIRED,
  // Level Up · Linux: the practice server (scenarios from the linux course)
  ...LINUX_REQUIRED,
  // Level Up: AWS games
  ...AWS_REQUIRED,
};
const COMPONENTS = new Set(['Card', 'Interactive', 'Hint', 'Term']);
const GOAL_KEYS = new Set([
  'staged', 'notStaged', 'modified', 'untracked', 'clean', 'noUntracked', 'commits', 'minCommits', 'lastMessage', 'messages',
  'cleanMessages', 'headDetached', 'headAtMessage', 'lastIsRevert', 'filesExist', 'filesMissing', 'fileContains',
  'fileNotContains', 'lastCommitFiles', 'lastCommitHas', 'lastCommitLacks', 'cwd', 'dirsExist', 'repoAt', 'config',
  'configSet', 'typed', 'lastTyped', 'stagedContains', 'stagedNotContains',
  // Worlds 3–4: branches, merging, remotes.
  'currentBranch', 'branches', 'branchesMissing', 'branchAt', 'mergeCommit', 'linearHistory', 'inMerge', 'inRebase',
  'conflicts', 'noConflicts', 'stashCount', 'tags', 'remotes', 'upstream', 'pushed', 'serverHas', 'aheadBehind',
  // World 10
  'bisectFound', 'bisectActive', 'aliases', 'worktrees', 'objectsWritten', 'packedRefs',
]);

// Git scenarios run in the Git engine. Other courses only need their scenario ids to exist
// (their own engines and checks come with them).
const scenarioById = new Map(allScenarios.map((s) => [s.id, s]));
// Every course's registry (src/content/courses/scenarios.ts), so a new course needs no change here.
const otherScenarios: Record<string, Record<string, unknown>> = scenariosByCourse;
const scenarioIdsOf = (course: string) => (course === ROOT_COURSE ? new Set(scenarioById.keys()) : new Set(Object.keys(otherScenarios[course] ?? {})));
// Each course has its own glossary (<Term id="x" course="git"> reaches another course's word).
const termIdsOf = (() => {
  const cache = new Map<string, Set<string>>();
  return (course: string) => {
    if (!cache.has(course)) {
      const path = `src/content/glossary/${course}.yaml`;
      const terms = existsSync(path) ? ((parseYaml(readFileSync(path, 'utf8')) as { terms?: { id: string }[] }).terms ?? []) : [];
      cache.set(course, new Set(terms.map((t) => t.id)));
    }
    return cache.get(course)!;
  };
})();

interface Tag {
  name: string;
  attrs: Record<string, unknown>;
  line: number;
}

/** Parse JSX-ish attributes: a="x", a={expr}, bare flags. Evaluates expressions (trusted repo content). */
function parseTag(src: string, start: number): { tag: Tag; end: number } {
  let i = start + 1;
  let name = '';
  while (/[\w.]/.test(src[i]!)) name += src[i++];
  const attrs: Record<string, unknown> = {};
  const line = src.slice(0, start).split('\n').length;
  for (;;) {
    while (/\s/.test(src[i]!)) i++;
    if (src.startsWith('/>', i)) return { tag: { name, attrs, line }, end: i + 2 };
    if (src[i] === '>') return { tag: { name, attrs, line }, end: i + 1 };
    let key = '';
    while (/[\w-]/.test(src[i]!)) key += src[i++];
    if (!key) throw new Error(`line ${line}: cannot read attributes of <${name}>`);
    if (src[i] !== '=') {
      attrs[key] = true;
      continue;
    }
    i++;
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i]!;
      const close = src.indexOf(q, i + 1);
      attrs[key] = src.slice(i + 1, close);
      i = close + 1;
    } else if (src[i] === '{') {
      let depth = 0;
      let j = i;
      let quote: string | null = null;
      for (; j < src.length; j++) {
        const ch = src[j]!;
        if (quote) {
          if (ch === '\\') j++;
          else if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) break;
      }
      const expr = src.slice(i + 1, j);
      try {
        attrs[key] = new Function(`return (${expr});`)();
      } catch (e) {
        throw new Error(`line ${line}: bad expression in ${name}.${key}: ${(e as Error).message}`, { cause: e });
      }
      i = j + 1;
    } else throw new Error(`line ${line}: unexpected value for ${name}.${key}`);
  }
}

function tags(src: string): Tag[] {
  const out: Tag[] = [];
  const body = src.replace(/^---\n[\s\S]*?\n---/, (m) => m.replace(/[^\n]/g, ' '));
  // Skip inline code so `<file>` in text isn't read as a tag.
  const masked = body.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '<' && /[A-Z]/.test(masked[i + 1] ?? '')) {
      const { tag, end } = parseTag(masked, i);
      out.push(tag);
      i = end - 1;
    }
  }
  return out;
}

/** Every demo command must work, except the ones listed in `fails` (the lesson shows that error on purpose). */
function runAllOk(scenarioId: string, commands: string[], where: string, errors: string[], fails: string[] = []) {
  const sc = scenarioById.get(scenarioId);
  if (!sc) return;
  let state = buildScenario(sc);
  for (const c of commands) {
    const r = run(state, c);
    if (fails.includes(c)) {
      if (r.ok) errors.push(`${where}: "${c}" is listed in fails, but it works in scenario ${scenarioId}`);
    } else if (!r.ok && !r.stopped) {
      // (A merge or rebase that stops on a conflict is Git waiting for you, not a broken demo.)
      errors.push(`${where}: demo command fails in scenario ${scenarioId}: "${c}"\n    ${plain(r.output).split('\n').join('\n    ')}`);
      return;
    }
    state = r.state;
  }
}

/** Every hex word (4+ chars, with a digit and a letter) must start some object id in the scenario. */
function checkHashes(scenarioId: string, texts: string[], where: string, errors: string[]) {
  const sc = scenarioById.get(scenarioId);
  if (!sc) return;
  const repo = findRepo(buildScenario(sc));
  if (!repo) return;
  const ids = [...objectStore(repo).keys()];
  for (const text of texts) {
    for (const word of text.match(/\b[0-9a-f]{4,40}\b/g) ?? []) {
      if (!/\d/.test(word) || !/[a-f]/.test(word)) continue;
      if (!ids.some((id) => id.startsWith(word))) errors.push(`${where}: hash "${word}" is not in scenario ${scenarioId} (ids are real SHA-1s: run git log --oneline in the scenario)`);
    }
  }
}

function checkGoalShape(goal: unknown, where: string, scenarioId: string | undefined, errors: string[]) {
  if (!goal || typeof goal !== 'object') {
    errors.push(`${where}: goal must be an object`);
    return;
  }
  for (const k of Object.keys(goal)) if (!GOAL_KEYS.has(k)) errors.push(`${where}: unknown goal key "${k}"`);
  const sc = scenarioId ? scenarioById.get(scenarioId) : undefined;
  if (sc && checkGoal(buildScenario(sc), goal as Goal).ok) errors.push(`${where}: goal is already met before the learner starts`);
}

/** Courier: props make sense, demo steps run, goal keys exist and the goal isn't met at the start. */
function checkCourier(a: Record<string, unknown>, where: string, scenarioId: string | undefined): string[] {
  const out = checkCourierProps(a).map((e) => `${where}: Courier ${e}`);
  const sc = scenarioId ? scenarioById.get(scenarioId) : undefined;
  if (!sc) return out;
  const opts = { mine: a.mine as never, teammate: a.teammate as never };
  if (Array.isArray(a.commands)) {
    let state = buildScenario(sc);
    let c = { mineUsed: 0, teamUsed: 0 };
    for (const step of a.commands as string[]) {
      const r = runAction(state, step, opts, c);
      // A refused push is a fine demo (the courier bounces); only broken steps are errors.
      if (!r.ok && !r.trip?.bounced && !r.stopped && r.explain?.key !== 'sim.err.pullDivergent') {
        out.push(`${where}: Courier demo step fails in scenario ${scenarioId}: "${step}" (${r.explain?.key ?? 'no explanation'})`);
        break;
      }
      state = r.state;
      c = { mineUsed: r.mineUsed, teamUsed: r.teamUsed };
    }
  }
  const goal = a.goal as CourierGoal | undefined;
  if (goal) {
    for (const k of Object.keys(goal)) if (!GOAL_KEYS.has(k) && k !== 'serverTags') out.push(`${where}: Courier unknown goal key "${k}"`);
    if (courierGoalMet(buildScenario(sc), goal, [], a.url as string | undefined)) out.push(`${where}: Courier goal is already met before the learner starts`);
  }
  return out;
}

const errors: string[] = [];
let count = 0;
for (const f of lessonFiles()) {
  let list: Tag[];
  try {
    list = tags(f.text);
  } catch (e) {
    errors.push(`${f.path}: ${(e as Error).message}`);
    continue;
  }
  const opens = (f.text.match(/<Card\s/g) ?? []).length;
  const closes = (f.text.match(/<\/Card>/g) ?? []).length;
  if (opens !== closes) errors.push(`${f.path}: ${opens} <Card> but ${closes} </Card>`);
  // Lessons of the first course also run their demos and goals in the Git engine.
  const inGit = f.course === ROOT_COURSE;
  const scenarioIds = scenarioIdsOf(f.course);
  for (const tag of list) {
    const where = `${f.path}:${tag.line}`;
    if (!COMPONENTS.has(tag.name)) {
      errors.push(`${where}: unknown component <${tag.name}>`);
      continue;
    }
    if (tag.name === 'Term' && !termIdsOf(String(tag.attrs.course ?? f.course)).has(String(tag.attrs.id))) {
      errors.push(`${where}: unknown glossary term "${String(tag.attrs.id)}"`);
    }
    if (tag.name !== 'Interactive') continue;
    count++;
    const name = String(tag.attrs.name);
    const req = REQUIRED[name];
    if (!req) {
      errors.push(`${where}: unknown interactive "${name}"`);
      continue;
    }
    for (const r of req) if (tag.attrs[r] === undefined) errors.push(`${where}: ${name} needs "${r}"`);
    const sc = tag.attrs.scenario as string | undefined;
    if (sc !== undefined && !scenarioIds.has(sc) && !CONVEYOR_INTERACTIVES.has(name) && !(name in KUBE_REQUIRED) && !(name in LINUX_REQUIRED) && !(name in PROMQL_REQUIRED) && !(name in TOFU_REQUIRED)) errors.push(`${where}: unknown scenario "${sc}"`);
    const a = tag.attrs;
    if (name === 'Choice') {
      const opts = a.options as { correct?: boolean; why?: string }[];
      if (!Array.isArray(opts) || opts.length < 2) errors.push(`${where}: Choice needs 2+ options`);
      else if (opts.filter((o) => o.correct).length !== 1) errors.push(`${where}: Choice needs exactly one correct option`);
    }
    if (inGit && (name === 'TermReplay' || name === 'GraphScene') && sc) runAllOk(sc, a.commands as string[], where, errors, a.fails as string[] | undefined);
    if (name === 'SpotLines') {
      if (!a.lines && !(a.scenario && a.commands && a.targets)) errors.push(`${where}: SpotLines needs lines, or scenario + commands + targets`);
      if (inGit && sc && a.commands) runAllOk(sc, a.commands as string[], where, errors, a.fails as string[] | undefined);
    }
    if (inGit && name === 'Sim' && a.goal) checkGoalShape(a.goal, where, sc, errors);
    if (inGit && name === 'Courier') errors.push(...checkCourier(a, where, sc));
    // Commit ids are real SHA-1s: a hash written in a goal or hint must exist in the scenario.
    if (inGit && name === 'Sim' && sc) {
      const goal = (a.goal ?? {}) as { typed?: string; lastTyped?: string };
      const texts = [goal.typed, goal.lastTyped, ...((a.hints as string[] | undefined) ?? [])].filter((x): x is string => typeof x === 'string');
      checkHashes(sc, texts, where, errors);
    }
    if (inGit && (name === 'ObjectXray' || name === 'BisectDetective')) {
      const scen = sc ? scenarioById.get(sc) : undefined;
      if (scen) errors.push(...checkDeepInteractive(name, a, buildScenario(scen), where));
    }
    if (name === 'Challenge') {
      for (const [i, st] of (a.stages as { scenario: string; goal: unknown; title?: string }[]).entries()) {
        if (!scenarioIds.has(st.scenario)) errors.push(`${where}: stage ${i + 1} unknown scenario "${st.scenario}"`);
        else if (inGit) checkGoalShape(st.goal, `${where} stage ${i + 1}`, st.scenario, errors);
      }
    }
    errors.push(...checkNewInteractive(name, a, where));
    if (f.course === 'docker') errors.push(...checkKitchenInteractive(name, a, where));
    errors.push(...checkK8sInteractive(name, a, where));
    errors.push(...checkBranchInteractive(name, a, where));
    errors.push(...checkConveyorInteractive(name, a, where, f.course));
    if (name in DOCKER_REQUIRED) errors.push(...checkDockerGame(name, a, where));
    errors.push(...checkKubeInteractive(name, a, where));
    errors.push(...checkLinuxInteractive(name, a, where));
    if (name === 'YamlPlayground') errors.push(...checkPlaygroundProps(a).map((e) => `${where}: ${e}`));
    errors.push(...checkPromqlInteractive(name, a, where));
    errors.push(...checkTofuInteractive(name, a, where));
    if (name in AWS_REQUIRED) errors.push(...checkAwsGame(name, a, where));
    if (inGit && name === 'RebaseDeck' && a.goal) checkGoalShape(a.goal, where, sc, errors);
    if (name === 'SortCards') {
      const ids = new Set((a.buckets as { id: string }[]).map((b) => b.id));
      for (const it of a.items as { label: string; bucket: string }[]) {
        if (!ids.has(it.bucket)) errors.push(`${where}: SortCards item "${it.label}" has unknown bucket "${it.bucket}"`);
      }
    }
  }
}

if (errors.length) {
  console.error(`✗ MDX check failed (${errors.length}):\n${errors.map((e) => `- ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ MDX OK: ${count} interactives checked.`);
