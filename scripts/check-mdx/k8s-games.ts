// Author checks for the Kubernetes games (Ship It): the props make sense, the task is possible,
// and it isn't already done before the learner starts. Returns readable errors.
import { kubectlApply } from '../../src/lib/k8sSchema';
import { parseQuantity } from '../../src/lib/k8sQuantity';
import { isDone as labelsDone, parseLabel, type LmTask } from '../../src/lib/labelMatchmaker';
import {
  allAnswered,
  parseSubject,
  subjectId,
  type CanIQuestion,
  type RbacBinding,
  type RbacRole,
  type RbacSubject,
} from '../../src/lib/rbacSwitchboard';
import {
  applyBreaks,
  BREAKS,
  taskDone as traceDone,
  trace,
  type BreakId,
  type TraceConfig,
  type TraceTask,
} from '../../src/lib/requestTracer';
import {
  checkBoard,
  solve,
  type TetrisNode,
  type TetrisPod,
  type TetrisTask,
  type Toleration,
} from '../../src/lib/schedulerTetris';

export const K8S_REQUIRED: Record<string, string[]> = {
  SchedulerTetris: ['nodes', 'pods'],
  LabelMatchmaker: ['pods', 'labels', 'selector', 'task'],
  RequestTracer: ['route'],
  YamlDoctor: ['manifest'],
  RbacSwitchboard: ['subjects', 'roles', 'questions'],
  GitOpsMirror: ['app'],
};

function badRegex(src: unknown): string | null {
  try {
    new RegExp(String(src), 'm');
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function checkK8sInteractive(
  name: string,
  a: Record<string, unknown>,
  where: string,
): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`${where}: ${name} ${m}`);

  if (name === 'SchedulerTetris') {
    const nodes = (a.nodes ?? []) as TetrisNode[];
    const pods = (a.pods ?? []) as TetrisPod[];
    const keys = (a.keys ?? []) as Toleration[];
    const task = (a.task ?? { type: 'placeAll' }) as TetrisTask;
    for (const x of [...nodes, ...pods]) {
      for (const q of [x.cpu, x.memory])
        if ('error' in parseQuantity(q)) err(`"${x.name}" has a bad quantity "${String(q)}"`);
    }
    for (const p of task.pending ?? [])
      if (!pods.some((x) => x.name === p)) err(`task.pending names unknown pod "${p}"`);
    for (const p of pods)
      if (p.node && !nodes.some((n) => n.name === p.node))
        err(`pod "${p.name}" starts on unknown node "${p.node}"`);
    if (!errors.length) {
      const start = Object.fromEntries(pods.map((p) => [p.name, p.node ?? null]));
      if (checkBoard(task, nodes, pods, start).done)
        err('task is already done before the learner starts');
      // Possible with no keys, or with every key handed to every tray that wants one.
      const allKeys = Object.fromEntries(pods.map((p) => [p.name, keys]));
      if (!solve(task, nodes, pods) && !solve(task, nodes, pods, allKeys))
        err('has no solution (check sizes, locks, signs and task.pending)');
    }
  }

  if (name === 'LabelMatchmaker') {
    const labels = (a.labels ?? []) as string[];
    const selector = (a.selector ?? {}) as Record<string, string>;
    const pods = (a.pods ?? []) as { name: string; labels: Record<string, string> }[];
    const task = a.task as LmTask;
    for (const l of labels) if (!parseLabel(l)) err(`label "${l}" is not key=value`);
    if (!Object.keys(selector).length) err('needs a selector with at least one key');
    if (task?.type === 'select') {
      for (const p of task.pods)
        if (!pods.some((x) => x.name === p)) err(`task names unknown pod "${p}"`);
      if (labelsDone(task, selector, pods)) err('task is already done before the learner starts');
      const have = new Set([
        ...labels,
        ...pods.flatMap((p) => Object.entries(p.labels).map(([k, v]) => `${k}=${v}`)),
      ]);
      for (const [k, v] of Object.entries(selector))
        if (!have.has(`${k}=${v}`))
          err(`selector pair ${k}=${v} is not in labels (the learner can't add it)`);
    } else if (task?.type === 'template') {
      if (labelsDone(task, selector, pods, (a.templateLabels ?? {}) as Record<string, string>))
        err('template labels already match the selector');
      for (const [k, v] of Object.entries(selector))
        if (!labels.includes(`${k}=${v}`)) err(`selector pair ${k}=${v} is not in labels`);
    } else err('task.type must be select or template');
  }

  if (name === 'RequestTracer') {
    const route = a.route as TraceConfig;
    const breaks = (a.breaks ?? []) as BreakId[];
    const broken = (a.broken ?? []) as BreakId[];
    const task = (a.task ?? { type: 'trace' }) as TraceTask;
    for (const b of [...breaks, ...broken]) if (!BREAKS.includes(b)) err(`unknown break "${b}"`);
    if (
      !route?.gateway ||
      !route.route?.rules?.length ||
      !route.services?.length ||
      !route.request?.path
    )
      err('route needs gateway, route.rules, services and request.path');
    else {
      if (trace(route).outcome !== '200') err('route must work (200 OK) before any break');
      if (task.type === 'deliver' && !broken.length)
        err('a deliver task needs `broken` breaks to start with');
      if (task.type === 'deliver' && broken.some((b) => !breaks.includes(b)))
        err('every `broken` break must also be in `breaks`, so the learner can undo it');
      if (task.type === 'outcome') {
        if (traceDone(task, trace(applyBreaks(route, broken))))
          err('task is already done before the learner starts');
        if (!breaks.some((b) => traceDone(task, trace(applyBreaks(route, [...broken, b])))))
          err(`no single break gives "${task.want}"`);
      }
    }
  }

  if (name === 'YamlDoctor') {
    const manifest = String(a.manifest ?? '');
    const file = String(a.file ?? 'manifest.yaml');
    const ns = (a.namespaces ?? []) as string[];
    const keep = (a.keep ?? []) as string[];
    if (manifest.trimEnd().split('\n').length > 17)
      err('manifest is longer than ~15 lines (rule 18)');
    if (kubectlApply(manifest, file, { namespaces: ns }).ok)
      err('manifest already applies; break it in one place');
    for (const k of keep) {
      const bad = badRegex(k);
      if (bad) err(`keep regex ${JSON.stringify(k)} is not valid: ${bad}`);
    }
    if (a.solution !== undefined) {
      const sol = String(a.solution);
      const r = kubectlApply(sol, file, { namespaces: ns });
      if (!r.ok) err(`solution does not apply: ${r.lines.map((l) => l.text).join(' / ')}`);
      for (const k of keep)
        if (!badRegex(k) && !new RegExp(k, 'm').test(sol))
          err(`solution does not match keep ${JSON.stringify(k)}`);
    }
  }

  if (name === 'RbacSwitchboard') {
    const subjects = (a.subjects ?? []) as RbacSubject[];
    const roles = (a.roles ?? []) as RbacRole[];
    const bindings = (a.bindings ?? []) as RbacBinding[];
    const questions = (a.questions ?? []) as CanIQuestion[];
    const ids = new Set(subjects.map(subjectId));
    for (const r of roles)
      if (r.kind === 'Role' && !r.namespace) err(`Role "${r.name}" needs a namespace`);
    for (const b of bindings) {
      if (!roles.some((r) => r.kind === b.roleRef.kind && r.name === b.roleRef.name))
        err(`binding "${b.name}" refers to unknown ${b.roleRef.kind} "${b.roleRef.name}"`);
      if (b.kind === 'RoleBinding' && !b.namespace)
        err(`RoleBinding "${b.name}" needs a namespace`);
    }
    for (const q of questions)
      if (!ids.has(subjectId(parseSubject(q.as))))
        err(`question asks as unknown subject "${q.as}"`);
    const task = (a.task ?? { type: 'wire' }) as { type: string };
    if (task.type === 'wire') {
      if (!questions.some((q) => q.expect !== undefined))
        err('a wire task needs questions with `expect`');
      else if (allAnswered({ roles, bindings }, questions))
        err('task is already done before the learner starts');
    }
  }

  if (name === 'GitOpsMirror') {
    const app = a.app as { name?: string; replicas?: number; image?: string };
    if (!app?.name || typeof app.replicas !== 'number' || !app.image)
      err('app needs name, replicas and image');
    const task = a.task as { type: string; field?: 'replicas' | 'image'; to?: unknown } | undefined;
    if (task?.type === 'gitChange' && app) {
      if (String(task.to) === String(app[task.field!]))
        err('task is already done before the learner starts');
      if (task.field === 'replicas' && (typeof task.to !== 'number' || task.to < 0 || task.to > 9))
        err('replicas target must be 0–9');
      if (
        task.field === 'image' &&
        !((a.images as string[] | undefined) ?? []).includes(String(task.to))
      )
        err('image target must be one of `images`');
    }
  }
  return errors;
}
