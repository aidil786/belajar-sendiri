// The Git simulator card: terminal + live boards, all driven by the pure engine.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GIT_COMMANDS,
  buildScenario,
  checkGoal,
  edit,
  findRepo,
  listDirNames,
  prettyPath,
  run,
  toAnsi,
  type CommandResult,
  type Goal,
  type Scenario,
  type SimState,
} from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import AreasBoard from './AreasBoard';
import CommitGraph from './CommitGraph';
import FilePanel from './FilePanel';
import { layoutGraph } from './graphLayout';
import Terminal, { type TerminalHandle } from './Terminal';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './terminal.css';

export type Panel = 'areas' | 'graph' | 'files';

export interface SimProps {
  lang: Lang;
  scenario: Scenario;
  goal?: Goal;
  panels?: Panel[];
  hints?: string[];
  success?: string;
  prefill?: string;
  showLost?: boolean;
  /** Commands that run (and show) before the learner types. */
  intro?: string[];
  onState?: (state: SimState, result: CommandResult | null) => void;
  /** Called once when the goal is reached. */
  onGoal?: () => void;
  /** Don't tell the lesson card (used inside Challenge, which reports at the end). */
  quiet?: boolean;
}

const NO_INTRO: string[] = [];
const AREAS_ONLY: Panel[] = ['areas'];
const NO_HINTS: string[] = [];

function slug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'you';
}

export default function Sim({
  lang,
  scenario,
  goal,
  panels = AREAS_ONLY,
  hints = NO_HINTS,
  success,
  prefill,
  showLost,
  intro = NO_INTRO,
  onState,
  onGoal,
  quiet = false,
}: SimProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const term = useRef<TerminalHandle>(null);

  const initial = useMemo(() => {
    // Commits show the learner's name, unless the lesson starts without an identity (they set it).
    const hasIdentity = !scenario.config || 'user.name' in scenario.config;
    const overrides: Record<string, string> = name && hasIdentity ? { 'user.name': name, 'user.email': `${slug(name)}@example.com` } : {};
    let s = buildScenario(scenario, overrides);
    const intros: CommandResult[] = [];
    for (const line of intro) {
      const r = run(s, line);
      intros.push(r);
      s = r.state;
    }
    return { state: s, intros };
    // Rebuild only when the scenario, the learner's name or the intro really change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, name, intro.join('\n')]);

  const [state, setState] = useState<SimState>(initial.state);
  const [typed, setTyped] = useState<string[]>([]);
  const [explain, setExplain] = useState<{ text: string; err: boolean } | null>(null);
  const [fails, setFails] = useState(0);
  const [done, setDone] = useState(false);
  const [customPrompt, setCustomPrompt] = useState<string | undefined>(undefined);

  const promptFor = (s: SimState) => prettyPath(s.cwd, s.home);

  const boot = () => {
    term.current?.clear();
    term.current?.write(`\x1b[2m# ${t('term.safe')}\x1b[0m\r\n`);
    initial.intros.forEach((r, i) => {
      term.current?.write(`\x1b[32m${promptFor(initial.state)}\x1b[0m $ ${intro[i]}\r\n`);
      if (r.output.length) term.current?.write(`${toAnsi(r.output)}\r\n`);
    });
    if (prefill) term.current?.setInput(prefill);
  };

  // Write the welcome line once; the terminal buffers until xterm is ready.
  useEffect(() => {
    setState(initial.state);
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const explainText = (r: CommandResult) => (r.explain ? t(r.explain.key, r.explain.params) : '');

  const handle = (line: string) => {
    const before = state;
    const shownPrompt = customPrompt ?? `\x1b[32m${promptFor(before)}\x1b[0m $ `;
    term.current?.write(`${customPrompt ? `\x1b[34m${customPrompt}\x1b[0m` : shownPrompt}${line}\r\n`);
    const r = run(before, line);
    if (r.events.some((e) => e.type === 'cleared')) term.current?.clear();
    if (r.output.length) term.current?.write(`${toAnsi(r.output)}\r\n`);
    setCustomPrompt(r.prompt);
    setState(r.state);
    const nextTyped = line.trim() ? [...typed, line.trim()] : typed;
    setTyped(nextTyped);
    const text = explainText(r);
    // "Stopped" (e.g. a merge conflict) is Git waiting for you, not a mistake.
    const mistake = !r.ok && !r.stopped;
    setExplain(text ? { text, err: mistake } : null);
    onState?.(r.state, r);
    if (mistake) {
      setFails((f) => f + 1);
      if (!quiet) emit('fl:wrong');
    }
    if (goal && !done && checkGoal(r.state, goal, nextTyped).ok) reachGoal();
  };

  function reachGoal() {
    setDone(true);
    onGoal?.();
    if (!quiet) emit('fl:done');
  }

  const save = (abs: string, content: string) => {
    const r = edit(state, abs, content);
    term.current?.write(`\x1b[2m# ${t('term.edited', { file: abs.split('/').pop() ?? abs })}\x1b[0m\r\n`);
    setState(r.state);
    setExplain({ text: explainText(r), err: false });
    onState?.(r.state, r);
    if (goal && !done && checkGoal(r.state, goal, typed).ok) reachGoal();
  };

  const reset = () => {
    setState(initial.state);
    setTyped([]);
    setExplain(null);
    setFails(0);
    setDone(false);
    setCustomPrompt(undefined);
    boot();
    onState?.(initial.state, null);
  };

  const complete = (line: string): string => {
    const parts = line.split(' ');
    const lastWord = parts[parts.length - 1] ?? '';
    let options: string[];
    if (parts.length === 2 && parts[0] === 'git') options = Object.keys(GIT_COMMANDS);
    else options = listDirNames(state, lastWord);
    const base = lastWord.includes('/') ? lastWord.slice(0, lastWord.lastIndexOf('/') + 1) : '';
    const partial = lastWord.slice(base.length);
    const hits = options.filter((o) => o.startsWith(partial));
    if (hits.length !== 1) return line;
    parts[parts.length - 1] = base + hits[0];
    return parts.join(' ') + (hits[0]!.endsWith('/') ? '' : ' ');
  };

  // Hints after 2 failed commands, or after 4 commands that didn't reach the goal.
  const stuck = Math.max(fails, typed.length >= 4 ? Math.floor(typed.length / 2) : 0);
  const hint = goal && stuck >= 2 && hints.length ? hints[Math.min(hints.length - 1, Math.floor((stuck - 2) / 2))] : null;
  const hasRepo = Boolean(findRepo(state));

  return (
    <div className="sim" ref={ref}>
      {(panels.includes('areas') || panels.includes('graph')) && hasRepo && (
        <div className="sim-panels">
          {panels.includes('areas') && <AreasBoard t={t} state={state} motionOK={motionOK} onCommand={(c) => term.current?.setInput(c)} />}
          {panels.includes('graph') && <CommitGraph t={t} layout={layoutGraph(state, { showLost: Boolean(showLost) })} motionOK={motionOK} />}
        </div>
      )}
      <Terminal ref={term} t={t} prompt={promptFor(state)} customPrompt={customPrompt} onRun={handle} complete={complete} history={typed} />
      <p className={cx('sim-explain', explain?.err && 'sim-explain-err')} aria-live="polite">
        {explain?.text ?? ''}
      </p>
      {panels.includes('files') && <FilePanel t={t} state={state} onSave={save} />}
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
