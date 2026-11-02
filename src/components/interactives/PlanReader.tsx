// PlanReader: read a real plan (made by the OpenTofu simulator) and say what will happen to each
// resource — create, update in place, destroy or replace — then, for a replace, which argument
// forces it. Kind feedback, no time limit. Logic: src/lib/planReader.ts.
// MDX: <Interactive name="PlanReader" scenario="t3-lifecycle" commands={['cp .next/main.tf main.tf']} />
import { useMemo, useState } from 'react';
import type { TofuScenario } from '~/engine/tofu-sim';
import type { Lang } from '~/i18n';
import { buildReader, type ReaderAction } from '~/lib/planReader';
import { DangerIcon } from './AreaIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './tofu.css';

export interface PlanReaderProps {
  lang: Lang;
  scenario: TofuScenario;
  /** Commands run before planning (e.g. `cp .next/main.tf main.tf`). */
  commands?: string[];
  /** Extra plan flags, e.g. "-destroy". */
  flags?: string;
  /** Ask which argument forces each replacement (default true). */
  askWhy?: boolean;
  prompt?: string;
  success?: string;
}

const ACTIONS: ReaderAction[] = ['create', 'update', 'delete', 'replace'];
const NONE: string[] = [];
const SYM: Record<ReaderAction, string> = { create: '+', update: '~', delete: '-', replace: '-/+' };

function lineClass(l: string): string | undefined {
  const m = /^\s*(-\/\+|\+\/-|<=|[+~-])\s/.exec(l);
  if (!m) return undefined;
  if (m[1] === '+') return 'tofu-pl-add';
  if (m[1] === '-') return 'tofu-pl-del';
  if (m[1] === '~') return 'tofu-pl-upd';
  return 'tofu-pl-rep';
}

export default function PlanReader({ lang, scenario, commands = NONE, flags = '', askWhy = true, prompt, success }: PlanReaderProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const plan = useMemo(() => buildReader(scenario, commands, flags),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario.id, commands.join('\n'), flags]);
  const [answers, setAnswers] = useState<Record<string, ReaderAction>>({});
  const [whys, setWhys] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const [announce, setAnnounce] = useState('');

  const isDone = (addr: string) => {
    const it = plan.items.find((x) => x.addr === addr)!;
    if (answers[addr] !== it.action) return false;
    if (it.action === 'replace' && askWhy && it.forces.length) return Boolean(whys[addr] && it.forces.includes(whys[addr]!));
    return true;
  };
  const doneCount = plan.items.filter((it) => isDone(it.addr)).length;
  const allDone = plan.items.length > 0 && doneCount === plan.items.length;

  const finish = (nextAnswers: Record<string, ReaderAction>, nextWhys: Record<string, string>) => {
    const ok = plan.items.every((it) => nextAnswers[it.addr] === it.action && (it.action !== 'replace' || !askWhy || !it.forces.length || it.forces.includes(nextWhys[it.addr] ?? '')));
    if (ok) emit('fl:done');
  };

  const pick = (addr: string, a: ReaderAction) => {
    const it = plan.items.find((x) => x.addr === addr)!;
    if (isDone(addr)) return;
    if (a === it.action) {
      const next = { ...answers, [addr]: a };
      setAnswers(next);
      setMsg({ ...msg, [addr]: t(`tofu.reader.right.${a}`) });
      setAnnounce(t(`tofu.reader.right.${a}`));
      finish(next, whys);
    } else {
      setTries((n) => n + 1);
      const m = `${t('feedback.almost')} ${t(`tofu.reader.almost.${it.action}`)}`;
      setMsg({ ...msg, [addr]: m });
      setAnnounce(m);
      emit('fl:wrong');
    }
  };

  const pickWhy = (addr: string, attr: string) => {
    const it = plan.items.find((x) => x.addr === addr)!;
    if (it.forces.includes(attr)) {
      const next = { ...whys, [addr]: attr };
      setWhys(next);
      setMsg({ ...msg, [addr]: t('tofu.reader.whyRight', { attr }) });
      setAnnounce(t('tofu.reader.whyRight', { attr }));
      finish(answers, next);
    } else {
      setTries((n) => n + 1);
      const m = `${t('feedback.almost')} ${t('tofu.reader.whyAlmost')}`;
      setMsg({ ...msg, [addr]: m });
      setAnnounce(m);
      emit('fl:wrong');
    }
  };

  if (plan.error) return <p className="tofu-empty">{plan.error}</p>;

  return (
    <div className="tofu-reader" ref={ref}>
      <p className="interactive-help">{prompt ?? t('tofu.reader.help')}</p>
      <p className="tofu-legend" aria-label={t('tofu.reader.legend')}>
        {ACTIONS.map((a) => (
          <span key={a} className={cx('tofu-legend-item', `tofu-legend-${a}`)}>
            <code>{SYM[a]}</code> {t(`tofu.reader.action.${a}`)}
          </span>
        ))}
      </p>
      <p className="tofu-reader-count" aria-live="polite">
        {t('tofu.reader.count', { done: doneCount, total: plan.items.length })}
      </p>
      <ol className="tofu-reader-items">
        {plan.items.map((it) => {
          const done = isDone(it.addr);
          const needWhy = askWhy && it.action === 'replace' && answers[it.addr] === 'replace' && it.forces.length > 0 && !done;
          return (
            <li key={it.addr} className={cx('tofu-reader-item', done && 'is-done')}>
              <pre className="tofu-plan" tabIndex={0} aria-label={t('tofu.reader.planFor', { addr: it.addr })}>
                {it.lines.map((l, i) => (
                  <span key={i} className={lineClass(l)}>
                    {l}
                    {'\n'}
                  </span>
                ))}
              </pre>
              <div className="tofu-reader-q" role="group" aria-label={t('tofu.reader.question', { addr: it.addr })}>
                <p className="tofu-reader-ask">{t('tofu.reader.question', { addr: it.addr })}</p>
                <div className="tofu-reader-buttons">
                  {ACTIONS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={cx('btn', 'btn-ghost', 'tofu-reader-btn', answers[it.addr] === a && 'is-picked', a === 'delete' && 'is-danger')}
                      aria-pressed={answers[it.addr] === a}
                      disabled={done || answers[it.addr] === it.action}
                      onClick={() => pick(it.addr, a)}
                    >
                      {(a === 'delete' || a === 'replace') && <DangerIcon />}
                      <code aria-hidden="true">{SYM[a]}</code> {t(`tofu.reader.action.${a}`)}
                    </button>
                  ))}
                </div>
                {needWhy && (
                  <div className="tofu-reader-why" role="group" aria-label={t('tofu.reader.why')}>
                    <p className="tofu-reader-ask">{t('tofu.reader.why')}</p>
                    <div className="tofu-reader-buttons">
                      {it.choices.map((c) => (
                        <button key={c} type="button" className="btn btn-ghost tofu-reader-btn" onClick={() => pickWhy(it.addr, c)}>
                          <code>{c}</code>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {msg[it.addr] && (
                  <p className={cx('tofu-reader-msg', done ? 'is-right' : 'is-almost')}>
                    <span aria-hidden="true">{done ? '✓ ' : '↻ '}</span>
                    {msg[it.addr]}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {plan.summary && <p className="tofu-reader-summary">{allDone ? plan.summary : t('tofu.reader.summaryHidden')}</p>}
      {allDone && <Feedback kind="right">{success ?? pickPraise(t, name, tries)}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
