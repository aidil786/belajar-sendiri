// The kitchen simulator card: a practice terminal for Docker + the state picture after every command.
// MDX: <Interactive name="KitchenSim" scenario="d1-nginx" goal={{ running: ['web'] }} hints={[...]} />
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DOCKER_COMMANDS,
  HOST_COMMANDS,
  buildKitchenScenario,
  checkKitchenGoal,
  kitchenPicture,
  promptOf,
  run,
  toAnsi,
  type KitchenGoal,
  type KitchenResult,
  type KitchenScenario,
  type KitchenState,
} from '~/engine/kitchen-sim';
import type { Lang } from '~/i18n';
import { DangerIcon } from './AreaIcons';
import KitchenBoard from './KitchenBoard';
import Terminal, { KEY_SETS, type TerminalHandle } from './Terminal';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './terminal.css';
import './kitchen.css';

export interface KitchenSimProps {
  lang: Lang;
  scenario: KitchenScenario;
  goal?: KitchenGoal;
  hints?: string[];
  success?: string;
  prefill?: string;
  /** Commands that run (and show) before the learner types. */
  intro?: string[];
  /** Show the state picture (default true). */
  picture?: boolean;
  /** Phone key row: 'docker' (default), 'compose', or your own list. */
  keys?: 'docker' | 'compose' | string[];
  onState?: (state: KitchenState, result: KitchenResult | null) => void;
  onGoal?: () => void;
  quiet?: boolean;
}

const NONE: string[] = [];
const RISKY = /^docker\s+(system prune|(container|image|volume|network|builder) prune|rm\s+.*-f|rm\s+-\w*f|volume rm|rmi\s+-f|compose\s+down\s+.*-v)/;

export default function KitchenSim({ lang, scenario, goal, hints = NONE, success, prefill, intro = NONE, picture = true, keys = 'docker', onState, onGoal, quiet = false }: KitchenSimProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const term = useRef<TerminalHandle>(null);

  const initial = useMemo(() => {
    let s = buildKitchenScenario(scenario);
    const intros: { line: string; result: KitchenResult; prompt: string }[] = [];
    for (const line of intro) {
      const p = promptOf(s);
      const r = run(s, line);
      intros.push({ line, result: r, prompt: p.custom ?? `${p.path} $ ` });
      s = r.state;
    }
    return { state: s, intros };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, intro.join('\n')]);

  const [state, setState] = useState<KitchenState>(initial.state);
  const [typed, setTyped] = useState<string[]>([]);
  const [explain, setExplain] = useState<{ text: string; err: boolean } | null>(null);
  const [danger, setDanger] = useState(false);
  const [fails, setFails] = useState(0);
  const [done, setDone] = useState(false);

  const boot = () => {
    term.current?.clear();
    term.current?.write(`\x1b[2m# ${t('term.safe')}\x1b[0m\r\n`);
    for (const i of initial.intros) {
      term.current?.write(`\x1b[32m${i.prompt}\x1b[0m${i.line}\r\n`);
      if (i.result.output.length) term.current?.write(`${toAnsi(i.result.output)}\r\n`);
    }
    if (prefill) term.current?.setInput(prefill);
  };

  useEffect(() => {
    setState(initial.state);
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const reachGoal = () => {
    setDone(true);
    onGoal?.();
    if (!quiet) emit('fl:done');
  };

  const handle = (line: string) => {
    const before = state;
    const p = promptOf(before);
    const hidden = p.custom === 'Password: ';
    term.current?.write(p.custom ? `\x1b[34m${p.custom}\x1b[0m${hidden ? '' : line}\r\n` : `\x1b[32m${p.path}\x1b[0m $ ${line}\r\n`);
    const r = run(before, line);
    if (r.events.some((e) => e.type === 'cleared')) term.current?.clear();
    if (r.output.length) term.current?.write(`${toAnsi(r.output)}\r\n`);
    setState(r.state);
    const nextTyped = line.trim() && !hidden ? [...typed, line.trim()] : typed;
    setTyped(nextTyped);
    const text = r.explain ? t(r.explain.key, r.explain.params) : '';
    const mistake = !r.ok && !r.stopped;
    setExplain(text ? { text, err: mistake } : null);
    setDanger(!before.session && RISKY.test(line.trim()));
    onState?.(r.state, r);
    if (mistake) {
      setFails((f) => f + 1);
      if (!quiet) emit('fl:wrong');
    }
    if (goal && !done && checkKitchenGoal(r.state, goal, nextTyped).ok) reachGoal();
  };

  const reset = () => {
    setState(initial.state);
    setTyped([]);
    setExplain(null);
    setDanger(false);
    setFails(0);
    setDone(false);
    boot();
    onState?.(initial.state, null);
  };

  const complete = (line: string): string => {
    const parts = line.split(' ');
    const last = parts[parts.length - 1] ?? '';
    let options: string[] = [];
    if (parts.length === 1) options = [...Object.keys(HOST_COMMANDS), 'docker', 'echo'];
    else if (parts.length === 2 && parts[0] === 'docker') options = [...Object.keys(DOCKER_COMMANDS), 'container', 'image'];
    else if (parts[0] === 'docker') options = [...Object.values(state.containers).map((c) => c.name), ...Object.keys(state.volumes).filter((v) => v.length < 40)];
    const hits = options.filter((o) => o.startsWith(last));
    if (hits.length !== 1) return line;
    parts[parts.length - 1] = hits[0]!;
    return `${parts.join(' ')} `;
  };

  const stuck = Math.max(fails, typed.length >= 4 ? Math.floor(typed.length / 2) : 0);
  const hint = goal && stuck >= 2 && hints.length ? hints[Math.min(hints.length - 1, Math.floor((stuck - 2) / 2))] : null;
  const prompt = promptOf(state);
  const pic = useMemo(() => kitchenPicture(state), [state]);
  const keyRow = Array.isArray(keys) ? keys : KEY_SETS[keys];

  return (
    <div className="sim ksim" ref={ref}>
      {picture && <KitchenBoard t={t} picture={pic} motionOK={motionOK} />}
      <Terminal ref={term} t={t} prompt={prompt.custom ? '' : prompt.path} customPrompt={prompt.custom} onRun={handle} complete={complete} history={typed} keys={keyRow} />
      {state.session?.kind === 'attached' && (
        <button type="button" className="btn btn-quiet ksim-ctrlc" onClick={() => handle('^C')}>
          {t('kitchen.ctrlC')}
        </button>
      )}
      {danger && (
        <p className="ksim-danger">
          <DangerIcon /> {t('kitchen.danger')}
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
