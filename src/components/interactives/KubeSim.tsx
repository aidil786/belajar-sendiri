// FoodCourtSim (alias KubeSim): the kubectl practice terminal + the food-court picture +
// the pink "you are here" bar, on a slow, pausable clock. Optional Manager's board and
// fault buttons (delete a tray, close a stall …). All state comes from the pure engine.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  boardEvents,
  board as boardOf,
  buildScenarioCached,
  checkGoal,
  injectFault,
  KUBECTL_COMMANDS,
  NODE_COMMANDS,
  picture as pictureOf,
  promptParts,
  run,
  signature,
  tick,
  toAnsi,
  whereAmI,
  type Fault,
  type KubeEvent,
  type KubeGoal,
  type KubeResult,
  type KubeScenario,
  type KubeState,
  type Tray,
} from '~/engine/foodcourt-sim';
import type { Lang } from '~/i18n';
import FoodCourt from './FoodCourt';
import { BoardView, type Loop } from './ManagersBoard';
import Terminal, { type TerminalHandle } from './Terminal';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import { useSimClock } from './useSimClock';
import YouAreHere, { WarnIcon } from './YouAreHere';
import './kube.css';
import './terminal.css';

export type FaultButton = 'deletePod' | 'killNode' | 'badImage' | 'memoryLeak' | 'readinessFail' | 'crash' | 'traffic' | 'stopKubelet';

/** K9 faults use their own i18n block (k9.fault.*). */
const K9_FAULTS = ['stopKubelet', 'startKubelet', 'breakStaticPod'];
const faultNs = (type: string) => (K9_FAULTS.includes(type) ? 'k9' : 'kube');

export interface KubeSimProps {
  lang: Lang;
  scenario: KubeScenario;
  goal?: KubeGoal;
  hints?: string[];
  success?: string;
  prefill?: string;
  /** Commands that run (and show) before the learner types. */
  intro?: string[];
  /** Fault buttons this card allows. deletePod and killNode also make trays / stalls clickable. */
  faults?: FaultButton[];
  /** Show the Manager's board for this Deployment. */
  board?: string;
  /** Which namespace the picture shows ('all' = every namespace). Default: the current one. */
  namespace?: string;
  showSystem?: boolean;
  /** Start with the clock paused. */
  paused?: boolean;
  /** Hide the picture (terminal only). */
  picture?: boolean;
  /** Phone key row. */
  keys?: string[];
}

const KUBE_KEYS = ['kubectl', 'get', '-n', '-f', '-o', 'yaml', 'Tab', '↑'];
const NO_LIST: string[] = [];
const DANGER = /^(kubectl|k)\s.*\b(delete|drain)\b|--force\b|--grace-period=0/;
/** Inside a node: commands that stop or change the cluster's own machinery. */
const NODE_DANGER = /^(sudo\s+)?(systemctl\s+(stop|restart)\b|rm\b|mv\s+\S*manifests|sed\s+-i\S*\s.*manifests|kubeadm\s+(certs\s+renew|reset|upgrade\s+apply)|etcdutl\b.*\brestore\b)/;
const NODE_KEYS = ['systemctl', 'journalctl', 'crictl', '-n', '/', 'Tab', '↑', 'exit'];
const SYSTEMCTL_VERBS = ['status', 'start', 'stop', 'restart', 'is-active', 'daemon-reload'];
const TYPES = ['pods', 'deployments', 'replicasets', 'services', 'nodes', 'namespaces', 'configmaps', 'secrets', 'events', 'endpointslices', 'gateways', 'httproutes', 'jobs', 'cronjobs', 'statefulsets', 'daemonsets', 'hpa', 'pvc'];

/** The prompt as the terminal echoes it: green path + "$" on the laptop, purple "root@node:/#" inside a node. */
function promptAnsi(s: KubeState): string {
  const p = promptParts(s);
  return p.custom ? `\x1b[35m${p.custom}\x1b[0m` : `\x1b[32m${p.path}\x1b[0m $ `;
}

/** A small server box: you are inside a node. */
function NodeIcon() {
  return (
    <svg className="kube-node-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="2" y="2.5" width="12" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="9" width="12" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="4.75" r="0.9" fill="currentColor" />
      <circle cx="5" cy="11.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

export default function KubeSim({
  lang,
  scenario,
  goal,
  hints = NO_LIST,
  success,
  prefill,
  intro = NO_LIST,
  faults = [],
  board,
  namespace,
  showSystem,
  paused,
  picture = true,
  keys = KUBE_KEYS,
}: KubeSimProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const term = useRef<TerminalHandle>(null);

  const initial = useMemo(() => {
    let s = buildScenarioCached(scenario);
    const intros: (KubeResult & { before: KubeState })[] = [];
    for (const line of intro) {
      const r = run(s, line);
      intros.push({ ...r, before: s });
      s = r.state;
    }
    return { state: s, intros };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, intro.join('\n')]);

  const [state, setState] = useState<KubeState>(initial.state);
  const [typed, setTyped] = useState<string[]>([]);
  const [explain, setExplain] = useState<{ text: string; err: boolean } | null>(null);
  const [fails, setFails] = useState(0);
  const [done, setDone] = useState(false);
  const [playing, setPlaying] = useState(!paused);
  const [idle, setIdle] = useState(0);
  const [loop, setLoop] = useState<Loop | null>(null);
  const [healed, setHealed] = useState(0);
  const [glow, setGlow] = useState<string[]>([]);
  const [danger, setDanger] = useState<string | null>(null);
  const [hereChanged, setHereChanged] = useState(false);
  const [down, setDown] = useState<string[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSig = useRef(signature(initial.state));
  const loopTimer = useRef<number | undefined>(undefined);
  const start = initial.state.clock;

  const boot = () => {
    term.current?.clear();
    term.current?.write(`\x1b[2m# ${t('kube.term.safe')}\x1b[0m\r\n`);
    initial.intros.forEach((r, i) => {
      term.current?.write(`${promptAnsi(r.before)}${intro[i]}\r\n`);
      if (r.output.length) term.current?.write(`${toAnsi(r.output)}\r\n`);
    });
    if (prefill) term.current?.setInput(prefill);
  };

  useEffect(() => {
    setState(initial.state);
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => () => window.clearTimeout(loopTimer.current), []);

  const absorb = (events: KubeEvent[]) => {
    const l = boardEvents(events).pop();
    if (l) {
      setLoop({ want: l.want, see: l.see, do: l.do, count: l.count });
      window.clearTimeout(loopTimer.current);
      loopTimer.current = window.setTimeout(() => setLoop(null), motionOK ? 2200 : 1200);
    }
    const replaced = events.filter((e) => e.type === 'podReplaced').length;
    if (replaced) setHealed((h) => h + replaced);
    const fresh = events.filter((e): e is Extract<KubeEvent, { type: 'podCreated' }> => e.type === 'podCreated').map((e) => e.pod);
    if (fresh.length) setGlow(fresh);
    if (events.some((e) => e.type === 'contextSwitched' || e.type === 'namespaceSwitched')) {
      setHereChanged(true);
      window.setTimeout(() => setHereChanged(false), 1200);
    }
  };

  const check = (s: KubeState, list: string[]) => {
    if (goal && !done && checkGoal(s, goal, list).ok) {
      setDone(true);
      emit('fl:done');
    }
  };

  // The slow clock: one simulated second per beat while playing. It rests when nothing changes for 20 s.
  useSimClock(ref, playing && idle < 20, motionOK ? 700 : 300, () => {
    const r = tick(stateRef.current, 1);
    const sig = signature(r.state);
    setIdle((n) => (sig === lastSig.current ? n + 1 : 0));
    lastSig.current = sig;
    setState(r.state);
    absorb(r.events);
    check(r.state, typed);
  });

  const handle = (line: string) => {
    const before = state;
    term.current?.write(`${promptAnsi(before)}${line}\r\n`);
    const r = run(before, line);
    if (r.events.some((e) => e.type === 'cleared')) term.current?.clear();
    if (r.output.length) term.current?.write(`${toAnsi(r.output)}\r\n`);
    setState(r.state);
    setIdle(0);
    const nextTyped = line.trim() ? [...typed, line.trim()] : typed;
    setTyped(nextTyped);
    const text = r.explain ? t(r.explain.key, r.explain.params) : '';
    const mistake = !r.ok && !r.stopped;
    setExplain(text ? { text, err: mistake } : null);
    setDanger(
      before.shell
        ? NODE_DANGER.test(line.trim()) && r.ok
          ? t('k9.danger.node', { node: before.shell.node })
          : null
        : DANGER.test(line.trim()) && r.ok
          ? whereAmI(r.state).prodLike
            ? t('kube.danger.prod')
            : t('kube.danger.delete')
          : null,
    );
    absorb(r.events);
    if (mistake) {
      setFails((f) => f + 1);
      emit('fl:wrong');
    }
    check(r.state, nextTyped);
  };

  const fault = (f: Fault) => {
    const r = injectFault(state, f);
    if (!r.ok) {
      setExplain({ text: t(r.explain?.key ?? 'kube.err.faultNoPod'), err: false });
      return;
    }
    term.current?.write(`\x1b[2m# ${t(`${faultNs(f.type)}.fault.note.${f.type}`)}\x1b[0m\r\n`);
    setState(r.state);
    setIdle(0);
    setPlaying(true);
    setExplain({ text: t(r.explain!.key), err: false });
    absorb(r.events);
  };

  const reset = () => {
    setState(initial.state);
    setTyped([]);
    setExplain(null);
    setFails(0);
    setDone(false);
    setIdle(0);
    setHealed(0);
    setDanger(null);
    setDown([]);
    setPlaying(!paused);
    boot();
  };

  const complete = (line: string): string => {
    const parts = line.split(' ');
    const last = parts[parts.length - 1] ?? '';
    let options: string[];
    const sh = state.shell;
    const nodeOs = sh ? state.clusters[sh.cluster]?.nodes[sh.node]?.os : undefined;
    if (sh && parts.length === 1) options = NODE_COMMANDS;
    else if (sh && parts.length === 2 && parts[0] === 'systemctl') options = SYSTEMCTL_VERBS;
    else if (sh && parts.length === 2 && parts[0] === 'crictl') options = ['ps', 'pods', 'logs', 'images'];
    else if (sh && nodeOs) {
      const dir = last.includes('/') ? last.slice(0, last.lastIndexOf('/') + 1) : `${sh.cwd.replace(/\/$/, '')}/`;
      const abs = dir.startsWith('/') ? dir : `${sh.cwd.replace(/\/$/, '')}/${dir}`;
      const names = new Set<string>();
      for (const p of [...Object.keys(nodeOs.files), ...nodeOs.dirs]) if (p.startsWith(abs) && p.length > abs.length) names.add(p.slice(abs.length).split('/')[0]!);
      options = [...names].map((n) => (last.includes('/') ? `${dir}${n}` : n));
    } else if (parts.length === 2 && (parts[0] === 'kubectl' || parts[0] === 'k')) options = KUBECTL_COMMANDS;
    else if (parts.length === 3 && /^(get|describe|delete|edit|label|explain)$/.test(parts[1] ?? '')) options = TYPES;
    else if (parts[parts.length - 2] === '-f' || parts[0] === 'cat') options = Object.keys(state.files).filter((f) => f.startsWith(`${state.cwd}/`)).map((f) => f.slice(state.cwd.length + 1));
    else {
      const pic = pictureOf(state, { namespace: 'all', showSystem: false });
      options = [...(pic?.stalls.flatMap((s) => s.trays.map((x) => x.name)) ?? []), ...(pic?.waiting.map((x) => x.name) ?? []), ...(pic?.stalls.map((s) => s.name) ?? [])];
    }
    const hits = options.filter((o) => o.startsWith(last));
    if (hits.length !== 1) return line;
    parts[parts.length - 1] = hits[0]!;
    return `${parts.join(' ')} `;
  };

  const stuck = Math.max(fails, typed.length >= 4 ? Math.floor(typed.length / 2) : 0);
  const hint = goal && stuck >= 2 && hints.length ? hints[Math.min(hints.length - 1, Math.floor((stuck - 2) / 2))] : null;
  const here = whereAmI(state);
  const here2 = promptParts(state);
  const pic = picture ? pictureOf(state, { ...(namespace ? { namespace } : {}), ...(showSystem ? { showSystem } : {}) }) : null;
  const b = board ? boardOf(state, { name: board }) : null;
  const seconds = state.clock - start;
  const settled = idle >= 20;

  const deleteTray = faults.includes('deletePod') ? (tray: Tray) => fault({ type: 'deletePod', pod: tray.name, namespace: tray.namespace }) : undefined;
  const toggleStall = faults.includes('killNode')
    ? (stall: { name: string }) => {
        if (down.includes(stall.name)) {
          setDown(down.filter((n) => n !== stall.name));
          fault({ type: 'restoreNode', node: stall.name });
        } else {
          setDown([...down, stall.name]);
          fault({ type: 'killNode', node: stall.name });
        }
      }
    : undefined;
  const extraFaults = faults.filter((f) => f !== 'deletePod' && f !== 'killNode');
  const firstDeploy = b?.name ?? Object.values(state.clusters[state.contexts[state.currentContext]?.cluster ?? '']?.objects ?? {}).find((o) => o.kind === 'Deployment' && o.metadata.namespace === here.namespace)?.metadata.name;
  const firstService = pic?.services[0]?.name;

  return (
    <div className="kube-sim" ref={ref}>
      <YouAreHere lang={lang} context={here.context} cluster={here.cluster} namespace={here.namespace} prodLike={here.prodLike} changed={hereChanged && motionOK} />
      {b && <BoardView t={t} board={b} loop={loop} healed={healed} motionOK={motionOK} compact />}
      {pic && <FoodCourt t={t} picture={pic} motionOK={motionOK} onDeleteTray={deleteTray} onToggleStall={toggleStall} downStalls={down} glow={glow} />}
      <div className="kube-clock" role="group" aria-label={t('kube.clock.label')}>
        <button type="button" className="btn btn-quiet" aria-pressed={playing} onClick={() => { setPlaying(!playing); setIdle(0); }}>
          {playing ? `❚❚ ${t('kube.clock.pause')}` : `▶ ${t('kube.clock.play')}`}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => { const r = tick(state, 1); setState(r.state); absorb(r.events); check(r.state, typed); }}>
          +1s {t('kube.clock.step')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => { const r = tick(state, 30); setState(r.state); absorb(r.events); check(r.state, typed); setIdle(0); }}>
          +30s {t('kube.clock.skip')}
        </button>
        <span className="kube-clock-time" aria-live="off">
          {t('kube.clock.time', { s: String(seconds) })}
          {settled && playing ? ` · ${t('kube.clock.settled')}` : ''}
        </span>
      </div>
      {extraFaults.length > 0 && (
        <div className="kube-actions" role="group" aria-label={t('kube.actions')}>
          {extraFaults.map((f) => (
            <button
              key={f}
              type="button"
              className="btn kube-danger-btn"
              onClick={() =>
                fault(
                  f === 'stopKubelet'
                    ? { type: 'stopKubelet' }
                    : f === 'badImage'
                    ? { type: 'badImage', deployment: firstDeploy ?? '' }
                    : f === 'traffic'
                      ? { type: 'traffic', service: firstService ?? '', rps: 200 }
                      : f === 'memoryLeak' || f === 'readinessFail'
                        ? { type: f, ...(firstDeploy ? { deployment: firstDeploy } : {}) }
                        : { type: 'crash', ...(firstDeploy ? { selector: `app=${firstDeploy}` } : {}) },
                )
              }
            >
              <WarnIcon /> {t(`${faultNs(f)}.fault.${f}`)}
            </button>
          ))}
        </div>
      )}
      {state.shell && (
        <p className="kube-node-shell" role="status">
          <NodeIcon /> {t('k9.shell.inside', { node: state.shell.node })}
        </p>
      )}
      <Terminal ref={term} t={t} prompt={here2.custom ? '' : here2.path} customPrompt={here2.custom} onRun={handle} complete={complete} history={typed} keys={state.shell ? NODE_KEYS : keys} />
      {danger && (
        <p className="kube-danger-badge">
          <WarnIcon /> {danger}
        </p>
      )}
      <p className={cx('sim-explain', explain?.err && 'sim-explain-err')} aria-live="polite">
        {explain?.text ?? ''}
      </p>
      {hint && !done && (
        <Feedback kind="almost">
          {t('feedback.almost')} {hint}
        </Feedback>
      )}
      {done && <Feedback kind="right">{success ?? pickPraise(t, name, typed.length)}</Feedback>}
      <div className="sim-toolbar">
        <button type="button" className="btn btn-quiet" onClick={reset}>
          ↺ {t('term.reset')}
        </button>
      </div>
    </div>
  );
}
