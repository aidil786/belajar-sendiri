// `kubectl …`: parse, pick the cluster (current context or --context), run one command.
import { closest, line } from '../../git-sim/output';
import { apiDownText, apiDownVersionText, controlPlane, unreachableText } from '../node/os';
import { klogStamp } from '../node/fixtures';
import { currentNamespace } from '../store';
import type { KubeResult, KubeState } from '../types';
import { clone } from '../util';
import { bool, findCommand, flag, parseArgs } from './args';
import { err, identityFor, type Kx, type Ret } from './ctx';
import { apiResources, auth, clusterInfo, config, describeCmd, events, explain, get, logs, top, version } from './read';
import { apply, autoscale, cordon, create, debug, del, diff, drain, exec, expose, kustomize, labelCmd, patch, portForward, rollout, runCmd, scale, set, taint, wait } from './write';

export const KUBECTL_COMMANDS = [
  'get', 'describe', 'apply', 'create', 'delete', 'scale', 'set', 'rollout', 'logs', 'exec', 'port-forward', 'expose', 'run', 'label',
  'annotate', 'edit', 'explain', 'config', 'auth', 'top', 'cordon', 'uncordon', 'drain', 'taint', 'diff', 'debug', 'kustomize', 'version',
  'cluster-info', 'api-resources', 'wait', 'autoscale', 'patch', 'replace', 'events',
];

/** Real kubectl commands this practice terminal doesn't run (a kind note, never fake output). */
export const KUBECTL_EXPLAIN_ONLY = ['edit', 'attach', 'cp', 'proxy', 'certificate', 'plugin', 'completion', 'alpha', 'api-versions', 'convert'];

export function kubectl(state: KubeState, words: string[], raw: string): KubeResult {
  const s = clone(state);
  const { cmd, index } = findCommand(words);
  const rest = index >= 0 ? [...words.slice(0, index), ...words.slice(index + 1)] : words;
  const p = parseArgs(rest, { followShortF: cmd === 'logs' });
  const ctxName = flag(p, 'context') ?? s.currentContext;
  const ctx = s.contexts[ctxName];
  const out: KubeResult['output'] = [];
  const ev: KubeResult['events'] = [];
  const done = (r: Ret): KubeResult => ({
    state: r.ok || r.stopped || r.changed || s.clock !== state.clock ? s : state,
    output: out,
    events: ev,
    ok: r.ok,
    ...(r.explain ? { explain: r.explain } : {}),
    ...(r.stopped ? { stopped: true } : {}),
    ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
    ...(r.changed ? { changed: true } : {}),
  });
  const failEarly = (text: string, key: string, params: Record<string, string> = {}): KubeResult => {
    out.push(...text.split('\n').map((t) => line(t)));
    ev.push({ type: 'error', code: key });
    return { state, output: out, events: ev, ok: false, explain: { key, params } };
  };
  if (!cmd) {
    if (bool(p, 'help') || !words.length) return failEarly('kubectl controls the Kubernetes cluster manager.\n\n Find more information at: https://kubernetes.io/docs/reference/kubectl/', 'kube.explain.kubectlHelp');
    return failEarly(`error: unknown flag: ${words[0]}`, 'kube.err.unknownFlag', { flag: words[0] ?? '' });
  }
  if (KUBECTL_EXPLAIN_ONLY.includes(cmd)) {
    out.push(line(`# kubectl ${cmd}: the lesson shows what it does`, 'dim'));
    return { state, output: out, events: ev, ok: false, stopped: true, explain: { key: `kube.explain.notInSim`, params: { cmd: `kubectl ${cmd}` } } };
  }
  if (!KUBECTL_COMMANDS.includes(cmd)) {
    const near = closest(cmd, KUBECTL_COMMANDS);
    return failEarly(`error: unknown command "${cmd}" for "kubectl"${near ? `\n\nDid you mean this?\n\t${near}\n` : ''}`, near ? 'kube.err.unknownDidYouMean' : 'kube.err.unknown', { cmd, suggestion: near ?? '' });
  }
  if (p.unknown.length) return failEarly(`error: unknown flag: ${p.unknown[0]}\nSee 'kubectl ${cmd} --help' for usage.`, 'kube.err.unknownFlag', { flag: p.unknown[0]! });
  if (cmd === 'config') {
    const kx = { state: s, out, ev, p, raw } as unknown as Kx;
    return done(config(kx, p.words));
  }
  if (!ctx) return failEarly(`error: context "${ctxName}" does not exist`, 'kube.err.noContext', { context: ctxName });
  const c = s.clusters[ctx.cluster];
  if (!c) return failEarly('The connection to the server localhost:8080 was refused - did you specify the right host or port?', 'kube.err.noCluster');
  // K9: the API server (or the etcd under it) is down: kubectl finds nobody at the API port.
  if (!(cmd === 'version' && bool(p, 'client')) && !controlPlane(c).api) {
    const server = c.server.replace(/^https?:\/\//, '');
    const client = { kubectl: s.kubectlVersion, kustomize: s.kustomizeVersion };
    const text = cmd === 'version' ? apiDownVersionText(c, client) : unreachableText(cmd, klogStamp(apiDownText(c), s.clock), client);
    if (text !== null) return failEarly(text, 'k9.err.apiDown', { server });
    out.push(line(`# kubectl ${cmd} cannot reach the API server at ${server} either. Its own error words are not recorded here.`, 'dim'));
    return { state, output: out, events: ev, ok: false, stopped: true, explain: { key: 'k9.err.apiDown', params: { server } } };
  }
  const nsFlag = flag(p, 'namespace');
  const dryText = flag(p, 'dry-run');
  if (dryText !== undefined && !['client', 'server', 'none'].includes(dryText)) {
    return failEarly(`error: Invalid dry-run value (${dryText}). Must be "none", "server", or "client".`, 'kube.err.dryRun');
  }
  const kx: Kx = {
    state: s,
    c,
    ctxName,
    ns: nsFlag ?? (ctxName === s.currentContext ? currentNamespace(s) : (ctx.namespace ?? 'default')),
    nsGiven: nsFlag !== undefined,
    allNs: bool(p, 'all-namespaces'),
    who: identityFor(s, ctxName, p),
    ev,
    out,
    p,
    raw,
    dry: (dryText as Kx['dry']) ?? 'none',
  };
  const w = p.words;
  let r: Ret;
  switch (cmd) {
    case 'get':
      r = get(kx, w);
      break;
    case 'describe':
      r = describeCmd(kx, w);
      break;
    case 'apply':
      r = w[0] === 'view-last-applied' || w[0] === 'set-last-applied' || w[0] === 'edit-last-applied' ? err(kx, `error: this practice terminal runs plain kubectl apply only`, 'kube.err.applyUsage') : apply(kx, 'apply');
      break;
    case 'replace':
      r = apply(kx, 'replace');
      break;
    case 'create':
      r = create(kx, w);
      break;
    case 'delete':
      r = del(kx, w);
      break;
    case 'scale':
      r = scale(kx, w);
      break;
    case 'set':
      r = set(kx, w);
      break;
    case 'patch':
      r = patch(kx, w);
      break;
    case 'rollout':
      r = rollout(kx, w);
      break;
    case 'logs':
      r = logs(kx, w);
      break;
    case 'exec':
      r = exec(kx, w);
      break;
    case 'port-forward':
      r = portForward(kx, w);
      break;
    case 'expose':
      r = expose(kx, w);
      break;
    case 'run':
      r = runCmd(kx, w);
      break;
    case 'label':
      r = labelCmd(kx, w, 'label');
      break;
    case 'annotate':
      r = labelCmd(kx, w, 'annotate');
      break;
    case 'explain':
      r = explain(kx, w);
      break;
    case 'auth':
      r = auth(kx, w);
      break;
    case 'top':
      r = top(kx, w);
      break;
    case 'cordon':
      r = cordon(kx, w, true);
      break;
    case 'uncordon':
      r = cordon(kx, w, false);
      break;
    case 'drain':
      r = drain(kx, w);
      break;
    case 'taint':
      r = taint(kx, w);
      break;
    case 'diff':
      r = diff(kx);
      break;
    case 'debug':
      r = debug(kx, w);
      break;
    case 'kustomize':
      r = kustomize(kx, w);
      break;
    case 'version':
      r = version(kx);
      break;
    case 'cluster-info':
      r = clusterInfo(kx);
      break;
    case 'api-resources':
      r = apiResources(kx);
      break;
    case 'wait':
      r = wait(kx, w);
      break;
    case 'autoscale':
      r = autoscale(kx, w);
      break;
    case 'events':
      r = events(kx, w);
      break;
    default:
      r = err(kx, `error: unknown command "${cmd}" for "kubectl"`, 'kube.err.unknown', { cmd });
  }
  return done(r);
}
