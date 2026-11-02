// The OpenTofu practice card: the project's files in tabs (a small editor with line numbers),
// the practice terminal, and the "blueprint vs built" picture after every command.
// MDX: <Interactive name="TofuSim" scenario="t1-first-blueprint" goal={{ resourceInState: ['random_pet.stall'] }} hints={[...]} />
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DANGER,
  SHELL_COMMANDS,
  TOFU_COMMANDS,
  buildTofuScenarioCached,
  checkTofuGoal,
  promptOf,
  run,
  toAnsi,
  tofuPicture,
  type TofuGoal,
  type TofuResult,
  type TofuScenario,
  type TofuState,
} from '~/engine/tofu-sim';
import type { Lang } from '~/i18n';
import { DangerIcon } from './AreaIcons';
import TofuBoard from './TofuBoard';
import Terminal, { type TerminalHandle } from './Terminal';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './terminal.css';
import './tofu.css';

export interface TofuSimProps {
  lang: Lang;
  scenario: TofuScenario;
  goal?: TofuGoal;
  hints?: string[];
  success?: string;
  prefill?: string;
  /** Commands that run (and show) before the learner types. */
  intro?: string[];
  /** Show the file tabs and editor (default true). */
  files?: boolean;
  /** Let the learner edit the files (default true). */
  editable?: boolean;
  /** The file tab open at the start (default: main.tf, else the first). */
  open?: string;
  /** Show the "blueprint vs built" picture (default true). */
  picture?: boolean;
  /** Phone key row (default: the tofu keys). */
  keys?: string[];
  onState?: (state: TofuState, result: TofuResult | null) => void;
  quiet?: boolean;
}

export const TOFU_KEYS = ['tofu', 'init', 'plan', 'apply', '-auto-approve', 'Tab', '↑'];
const NONE: string[] = [];

/** Files the learner sees in tabs: configuration and variable files (folders starting with "." stay hidden). */
export function visibleFiles(st: TofuState): string[] {
  return Object.keys(st.files)
    .filter((f) => /\.(tf|tfvars)$/.test(f) && !f.split('/').some((p) => p.startsWith('.')))
    .sort((a, b) => {
      const depth = (x: string) => x.split('/').length;
      if (depth(a) !== depth(b)) return depth(a) - depth(b);
      if (a === 'main.tf') return -1;
      if (b === 'main.tf') return 1;
      return a < b ? -1 : 1;
    });
}

export default function TofuSim({ lang, scenario, goal, hints = NONE, success, prefill, intro = NONE, files = true, editable = true, open, picture = true, keys = TOFU_KEYS, onState, quiet = false }: TofuSimProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const id = useId();
  const { ref, emit } = useCardEvents();
  const term = useRef<TerminalHandle>(null);
  const back = useRef<HTMLDivElement>(null);

  const initial = useMemo(() => {
    let s = buildTofuScenarioCached(scenario);
    const intros: { line: string; result: TofuResult; prompt: string }[] = [];
    for (const line of intro) {
      const p = promptOf(s);
      const r = run(s, line);
      intros.push({ line, result: r, prompt: p.custom ?? `${p.path} $ ` });
      s = r.state;
    }
    return { state: s, intros };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, intro.join('\n')]);

  const [state, setState] = useState<TofuState>(initial.state);
  const [typed, setTyped] = useState<string[]>([]);
  const [explain, setExplain] = useState<{ text: string; err: boolean } | null>(null);
  const [danger, setDanger] = useState(false);
  const [fails, setFails] = useState(0);
  const [done, setDone] = useState(false);
  const tabs = visibleFiles(state);
  const [tab, setTab] = useState<string>(() => (open && tabs.includes(open) ? open : (tabs[0] ?? '')));
  const current = tabs.includes(tab) ? tab : (tabs[0] ?? '');

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

  const check = (st: TofuState, history: string[]) => {
    if (goal && !done && checkTofuGoal(st, goal, history).ok) {
      setDone(true);
      if (!quiet) emit('fl:done');
    }
  };

  const handle = (line: string) => {
    const before = state;
    const p = promptOf(before);
    term.current?.write(p.custom ? `\x1b[1m${p.custom}\x1b[0m${line}\r\n` : `\x1b[32m${p.path}\x1b[0m $ ${line}\r\n`);
    const r = run(before, line);
    if (r.events.some((e) => e.type === 'cleared')) term.current?.clear();
    if (r.output.length) term.current?.write(`${toAnsi(r.output)}\r\n`);
    if (r.state.pending && !before.pending) term.current?.write('\r\n');
    setState(r.state);
    const nextTyped = line.trim() && !before.pending ? [...typed, line.trim()] : typed;
    setTyped(nextTyped);
    const text = r.explain ? t(r.explain.key, r.explain.params) : '';
    const mistake = !r.ok && !r.stopped;
    setExplain(text ? { text, err: mistake } : null);
    setDanger(!before.pending && DANGER.test(line.trim()));
    onState?.(r.state, r);
    if (mistake) {
      setFails((f) => f + 1);
      if (!quiet) emit('fl:wrong');
    }
    check(r.state, nextTyped);
  };

  const edit = (path: string, text: string) => {
    const next = { ...state, files: { ...state.files, [path]: text } };
    setState(next);
    onState?.(next, null);
    check(next, typed);
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
    let options: string[];
    if (parts.length === 1) options = ['tofu', ...SHELL_COMMANDS.filter((c) => c !== 'terraform')];
    else if (parts.length === 2 && parts[0] === 'tofu') options = TOFU_COMMANDS;
    else if (parts[0] === 'tofu' && parts[1] === 'state' && parts.length === 3) options = ['list', 'show', 'mv', 'rm'];
    else options = Object.keys(state.files);
    const hits = options.filter((o) => o.startsWith(last));
    if (hits.length !== 1) return line;
    parts[parts.length - 1] = hits[0]!;
    return `${parts.join(' ')} `;
  };

  const stuck = Math.max(fails, typed.length >= 4 ? Math.floor(typed.length / 2) : 0);
  const hint = goal && stuck >= 2 && hints.length ? hints[Math.min(hints.length - 1, Math.floor((stuck - 2) / 2))] : null;
  const prompt = promptOf(state);
  const pic = useMemo(() => tofuPicture(state), [state]);
  const text = state.files[current] ?? '';
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  return (
    <div className="sim tofu-sim" ref={ref}>
      {picture && <TofuBoard t={t} picture={pic} />}
      {files && tabs.length > 0 && (
        <div className="tofu-files">
          <div className="tofu-tabs" role="tablist" aria-label={t('tofu.files')}>
            {tabs.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                id={`${id}-tab-${f}`}
                aria-selected={f === current}
                aria-controls={`${id}-panel`}
                className={cx('tofu-tab', f === current && 'is-current')}
                onClick={() => setTab(f)}
              >
                <span aria-hidden="true">📄 </span>
                {f}
              </button>
            ))}
          </div>
          <div className="tofu-editor" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${current}`}>
            <div className="tofu-editor-back" ref={back} aria-hidden="true">
              {lines.map((_, i) => (
                <div key={i} className="tofu-eline">
                  <span className="tofu-enum">{i + 1}</span>
                </div>
              ))}
            </div>
            <label className="visually-hidden" htmlFor={`${id}-text`}>
              {t('tofu.editor', { file: current })}
            </label>
            <textarea
              id={`${id}-text`}
              className="tofu-editor-input"
              value={text}
              readOnly={!editable}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              wrap="off"
              rows={Math.min(16, Math.max(5, lines.length))}
              onScroll={(e) => {
                if (back.current) back.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onChange={(e) => edit(current, e.target.value)}
            />
          </div>
          {editable && <p className="tofu-editor-note">{t('tofu.editNote')}</p>}
        </div>
      )}
      <Terminal ref={term} t={t} prompt={prompt.custom ? '' : prompt.path} customPrompt={prompt.custom} onRun={handle} complete={complete} history={typed} keys={keys} />
      {danger && (
        <p className="tofu-danger">
          <DangerIcon /> {t('tofu.danger')}
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
