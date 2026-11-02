// The Linux practice server card: a terminal on "kedai" (Debian 13) + the state picture after every
// command (the folder you are in with owners and modes, who you are, services as lights, busy
// programs and, when asked, the network).
// MDX: <Interactive name="LinuxSim" scenario="linux-perms" goal={{ fileMode: { '~/shop/open.sh': 'x' } }} hints={[...]} />
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  LINUX_COMMANDS,
  buildLinuxScenarioCached,
  checkLinuxGoal,
  linuxPicture,
  promptOf,
  run,
  toAnsi,
  type LinuxGoal,
  type LinuxPicture,
  type LinuxResult,
  type LinuxScenario,
  type LinuxState,
} from '~/engine/linux-sim';
import { childNames, lookup } from '~/engine/linux-sim/fs';
import { celebrate } from '~/lib/celebrate';
import type { Lang } from '~/i18n';
import { DangerIcon } from './AreaIcons';
import Terminal, { type TerminalHandle } from './Terminal';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, type T, useT } from './shared';
import './terminal.css';
import './linux.css';

export interface LinuxSimProps {
  lang: Lang;
  scenario: LinuxScenario;
  goal?: LinuxGoal;
  hints?: string[];
  success?: string;
  prefill?: string;
  /** Commands that run (and show) before the learner types. */
  intro?: string[];
  /** Show the state picture (default true). */
  picture?: boolean;
  /** Show the network panel (default: the scenario's `network`). */
  network?: boolean;
  /** Phone key row (default: ls, cd, sudo, -l, ~/, |, Tab, ↑). */
  keys?: string[];
  /** Commands that reach the goal. Never shown: `npm run check:mdx` runs them to prove the task is possible. */
  solution?: string[];
  onState?: (state: LinuxState, result: LinuxResult | null) => void;
  onGoal?: () => void;
  quiet?: boolean;
}

export const LINUX_KEYS = ['ls', 'cd', 'sudo', '-l', '~/', '|', 'Tab', '↑'];
const NONE: string[] = [];

/** The coloured prompt Debian's .bashrc gives: green user@host, blue folder. */
function promptAnsi(st: LinuxState): string {
  const p = promptOf(st);
  return `\x1b[1;32m${p.user}@${p.host}\x1b[0m:\x1b[1;34m${p.path}\x1b[0m${p.sigil} `;
}

export default function LinuxSim({ lang, scenario, goal, hints = NONE, success, prefill, intro = NONE, picture = true, network, keys, onState, onGoal, quiet = false }: LinuxSimProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const term = useRef<TerminalHandle>(null);
  const uid = useId().replace(/[^\w-]/g, '');

  const initial = useMemo(() => {
    let s = buildLinuxScenarioCached(scenario);
    const intros: { line: string; result: LinuxResult; prompt: string }[] = [];
    for (const line of intro) {
      const p = promptAnsi(s);
      const r = run(s, line);
      intros.push({ line, result: r, prompt: p });
      s = r.state;
    }
    return { state: s, intros };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, intro.join('\n')]);

  const [state, setState] = useState<LinuxState>(initial.state);
  const [typed, setTyped] = useState<string[]>([]);
  const [explain, setExplain] = useState<{ text: string; err: boolean } | null>(null);
  const [danger, setDanger] = useState(false);
  const [fails, setFails] = useState(0);
  const [done, setDone] = useState(false);

  const boot = () => {
    term.current?.clear();
    term.current?.write(`\x1b[2m# ${t('term.safe')}\x1b[0m\r\n`);
    for (const i of initial.intros) {
      term.current?.write(`${i.prompt}${i.line}\r\n`);
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
    if (!quiet) {
      emit('fl:done');
      if (ref.current) celebrate(ref.current);
    }
  };

  const handle = (line: string) => {
    const before = state;
    const busy = before.fg !== null;
    // A program asked a question (rm -i …): the answer goes on the question's line, like a terminal.
    const asking = before.ask ?? null;
    if (asking) term.current?.write(`${asking.prompt}${asking.secret ? '' : line}\r\n`);
    else if (busy) term.current?.write(`${line}\r\n`);
    else term.current?.write(`${promptAnsi(before)}${line}\r\n`);
    const r = run(before, line);
    if (r.events.some((e) => e.type === 'cleared')) term.current?.clear();
    if (r.output.length) term.current?.write(`${toAnsi(r.output)}\r\n`);
    setState(r.state);
    const clean = line.trim();
    const nextTyped = clean && !asking && !/^\^[CZ]$/.test(clean) ? [...typed, clean] : typed;
    setTyped(nextTyped);
    const text = r.explain ? t(r.explain.key, r.explain.params) : '';
    const mistake = !r.ok && !r.stopped;
    setExplain(text ? { text, err: mistake } : null);
    setDanger(!!r.danger);
    onState?.(r.state, r);
    if (mistake) {
      setFails((f) => f + 1);
      if (!quiet) emit('fl:wrong');
    }
    if (goal && !done && checkLinuxGoal(r.state, goal, nextTyped).ok) reachGoal();
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

  /** Tab: command names first, then names in the folder you point at. */
  const complete = (line: string): string => {
    const parts = line.split(' ');
    const last = parts[parts.length - 1] ?? '';
    let options: string[];
    let prefix = '';
    if (parts.length === 1) options = LINUX_COMMANDS;
    else {
      const slash = last.lastIndexOf('/');
      prefix = slash >= 0 ? last.slice(0, slash + 1) : '';
      const sh = state.shells[state.shells.length - 1]!;
      const dirPart = prefix.replace(/^~(?=\/)/, sh.vars.HOME ?? '~') || '.';
      const dir = dirPart.startsWith('/') ? dirPart : `${sh.cwd}/${dirPart}`;
      const f = lookup(state, sh.user, dir);
      options = f.ok && f.node.type === 'dir' ? childNames(state, f.path).map((n) => `${prefix}${n}${state.fs[`${f.path === '/' ? '' : f.path}/${n}`]?.type === 'dir' ? '/' : ''}`) : [];
    }
    const hits = options.filter((o) => o.startsWith(last));
    if (hits.length !== 1) return line;
    parts[parts.length - 1] = hits[0]!;
    return hits[0]!.endsWith('/') ? parts.join(' ') : `${parts.join(' ')} `;
  };

  const stuck = Math.max(fails, typed.length >= 4 ? Math.floor(typed.length / 2) : 0);
  const hint = goal && stuck >= 2 && hints.length ? hints[Math.min(hints.length - 1, Math.floor((stuck - 2) / 2))] : null;
  const p = promptOf(state);
  const pic = useMemo(() => linuxPicture(state), [state]);
  const fgProc = state.fg ? state.procs[state.fg.pid] : undefined;
  const showNet = network ?? scenario.network ?? false;

  return (
    <div className="sim lsim" ref={ref}>
      {picture && <LinuxBoard t={t} pic={pic} network={showNet} />}
      <Terminal ref={term} t={t} prompt={`lsim-${uid}`} customPrompt={state.ask ? state.ask.prompt.trimEnd() || '…' : state.fg ? `(${state.fg.cmd})` : p.text.trimEnd()} onRun={handle} complete={complete} history={typed} keys={keys ?? LINUX_KEYS} />
      {state.fg && (
        <div className="lsim-busy" role="group" aria-label={t('linux.busyNote', { cmd: state.fg.cmd })}>
          <p className="lsim-busy-note">{t('linux.busyNote', { cmd: state.fg.cmd })}</p>
          <button type="button" className="btn btn-quiet" onClick={() => handle('^C')}>
            {t('linux.ctrlC')}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => handle('^Z')}>
            {t('linux.ctrlZ')}
          </button>
          {fgProc?.kind === 'top' && (
            <button type="button" className="btn btn-quiet" onClick={() => handle('q')}>
              {t('linux.quit')}
            </button>
          )}
        </div>
      )}
      {danger && (
        <p className="lsim-danger">
          <DangerIcon /> {t('linux.danger')}
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

// ---------------------------------------------------------------------------
// The state picture

function KindIcon({ kind }: { kind: 'dir' | 'file' | 'link' }) {
  if (kind === 'dir')
    return (
      <svg className="lb-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M3 6h7l2 2h9v11H3z" />
      </svg>
    );
  if (kind === 'link')
    return (
      <svg className="lb-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <path d="M10 14l4-4" />
        <path d="M8 11l-2 2a3 3 0 0 0 4 4l2-2" />
        <path d="M16 13l2-2a3 3 0 0 0-4-4l-2 2" />
      </svg>
    );
  return (
    <svg className="lb-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

function Light({ state }: { state: 'active' | 'inactive' | 'failed' }) {
  if (state === 'failed') return <DangerIcon size={14} />;
  return <span className={cx('lb-light', state === 'active' && 'lb-light-on')} aria-hidden="true" />;
}

export function LinuxBoard({ t, pic, network }: { t: T; pic: LinuxPicture; network: boolean }) {
  const services = pic.services.map((s) => `${s.name} ${t(`linux.svc.${s.active}`)}`).join(', ');
  return (
    <section className="lboard" aria-label={t('linux.board')}>
      <p className="visually-hidden">{t('linux.summary', { user: pic.user, path: pic.cwd, n: pic.entries.length, services })}</p>
      <div className={cx('lb-here', pic.root && 'lb-here-root')}>
        <span className="lb-here-label">{t('linux.here')}</span>
        <code className="lb-here-where">
          {pic.user}@{pic.host}:{pic.cwdShort}
          {pic.root ? '#' : '$'}
        </code>
        {pic.root && (
          <span className="lb-root">
            <DangerIcon size={14} /> {t('linux.rootBadge')}
          </span>
        )}
      </div>
      <div className="lb-grid">
        <div className="lb-zone lb-folder">
          <h3 className="lb-head">
            {t('linux.folder')} <code className="lb-cwd">{pic.cwdShort}</code>
          </h3>
          {!pic.canRead ? (
            <p className="lb-empty">{t('linux.noRead')}</p>
          ) : pic.entries.length === 0 ? (
            <p className="lb-empty">{t('linux.empty')}</p>
          ) : (
            <ul className="lb-list">
              {pic.entries.map((e) => (
                <li key={e.path} className={cx('lb-entry', `lb-${e.kind}`, !e.mine && 'lb-notmine')} title={`${e.mode} ${e.owner}:${e.group}`}>
                  <KindIcon kind={e.kind} />
                  <span className="lb-name">
                    {e.name}
                    {e.kind === 'dir' ? '/' : ''}
                    <span className="visually-hidden"> ({t(`linux.kind.${e.kind}`)})</span>
                  </span>
                  <code className="lb-mode" aria-label={`${e.mode}, ${t('linux.owner', { owner: e.owner, group: e.group })}`}>
                    {e.mode}
                  </code>
                  <span className="lb-owner" aria-hidden="true">
                    {e.owner}:{e.group}
                  </span>
                  {e.kind === 'file' && e.exec && <span className="lb-tag lb-tag-run">{t('linux.canRun')}</span>}
                  {!e.mine && <span className="lb-tag">{t('linux.notMine')}</span>}
                  {e.children && e.children.length > 0 && (
                    <span className="lb-kids">
                      {e.children.join('  ')}
                      {e.more ? `  ${t('linux.more', { n: e.more })}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pic.hidden > 0 && pic.canRead && <p className="lb-note">{t('linux.hidden', { n: pic.hidden })}</p>}
        </div>
        <div className="lb-zone lb-services">
          <h3 className="lb-head">{t('linux.services')}</h3>
          <ul className="lb-list">
            {pic.services.map((s) => (
              <li key={s.name} className={cx('lb-svc', `lb-svc-${s.active}`)}>
                <Light state={s.active} />
                <code>{s.name}</code>
                <span>{t(`linux.svc.${s.active}`)}</span>
                <span className="lb-sub">{t(s.enabled ? 'linux.svc.enabled' : 'linux.svc.disabled')}</span>
              </li>
            ))}
          </ul>
          {pic.procs.length > 0 && (
            <>
              <h3 className="lb-head lb-head-gap">{t('linux.procs')}</h3>
              <ul className="lb-list">
                {pic.procs.map((pr) => (
                  <li key={pr.pid} className={cx('lb-proc', `lb-proc-${pr.state}`)}>
                    <code className="lb-pid">{pr.pid}</code>
                    <code className="lb-args">{pr.args}</code>
                    <span className="lb-sub">
                      {t(`linux.proc.${pr.state}`)}
                      {pr.fg ? ` · ${t('linux.proc.fg')}` : ''}
                      {pr.job !== undefined ? ` · ${t('linux.proc.job', { n: pr.job })}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {network && (
          <div className="lb-zone lb-net">
            <h3 className="lb-head">
              {t('linux.network')} <code className="lb-cwd">{t('linux.ip', { ip: pic.ip })}</code>
            </h3>
            <p className="lb-sub">{t('linux.ports')}</p>
            {pic.ports.length === 0 ? (
              <p className="lb-empty">{t('linux.noPorts')}</p>
            ) : (
              <ul className="lb-list lb-ports">
                {pic.ports.map((po) => (
                  <li key={`${po.addr}:${po.port}`} className="lb-port">
                    <code>:{po.port}</code> {po.prog}
                    {po.addr.startsWith('127.') ? <span className="lb-sub"> ({t('linux.localOnly')})</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
