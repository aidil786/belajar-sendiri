// One night shift drill: the simulator (Docker, CI/CD or Kubernetes), the help path, and exam mode.
// Rendered with client:only on /<lang>/ship-it/night-shift/<id>/ so the saved settings (exam mode)
// and the separate night-shift store are read before the first paint: no hydration mismatch.
// Only the engine this drill needs is downloaded (lazy imports).
// Levels (docs/LEVEL-UP-PLAN.md §3): 1 hints show after mistakes; 2 hints are folded (one at a time,
// or "show the choices" on a belt); 3 is an incident: no hints, then a root-cause question, then
// the fixed note and the confetti. The Rescue Center link stays on every level.
import { useStore } from '@nanostores/react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ConveyorScenario, EventPreset } from '~/engine/conveyor-sim';
import type { KubeGoal, KubeScenario } from '~/engine/foodcourt-sim';
import type { KitchenGoal, KitchenScenario } from '~/engine/kitchen-sim';
import type { Lang } from '~/i18n';
import { celebrate } from '~/lib/celebrate';
import { clockText, DRILL_SECONDS, loadNightShift, markDrillDone } from '~/lib/nightShift';
import { $progress, dayKey } from '~/stores/progress';
import Choice from '../interactives/Choice';
import { useT } from '../interactives/shared';
import LoadGuard from './LoadGuard';
import './night-shift.css';

const KitchenSim = lazy(() => import('../interactives/KitchenSim'));
const KubeSim = lazy(() => import('../interactives/KubeSim'));
const ConveyorBelt = lazy(() => import('../interactives/ConveyorBelt'));

/** A drill with its text already in the page's language and its scenario looked up. */
export type DrillView =
  | { kind: 'kitchen'; scenario: KitchenScenario; goal: KitchenGoal; hints: string[] }
  | { kind: 'kube'; scenario: KubeScenario; goal: KubeGoal; hints: string[] }
  | { kind: 'conveyor'; scenario: ConveyorScenario; event?: EventPreset; fixes: { label: string; text: string; why?: string; correct?: boolean }[]; forbid?: string[] };

/** The root-cause question of an incident, in the page's language. */
export interface RootCauseView {
  question: string;
  options: string[];
  answer: number;
  why: string;
}

export interface NightShiftDrillProps {
  lang: Lang;
  id: string;
  drill: DrillView;
  /** 1 ★ hints open, 2 ★★ hints folded, 3 ★★★ incident (no hints, root-cause question). */
  level: 1 | 2 | 3;
  /** Level 3: asked after the fix. */
  rootCause?: RootCauseView;
  /** Level 3: the faults, shown after the fix ("What you fixed"). */
  problems?: string[];
  success: string;
  /** Rescue Center link and the flow's title (null: the flow isn't there yet; link the Rescue Center). */
  rescue: { href: string; title: string | null };
  docs: { label: string; url: string }[];
  /** Sites exam mode allows. */
  examDocs: readonly string[];
  /** The list of drills (for "Try another drill"). */
  listHref: string;
}

export default function NightShiftDrill({ lang, id, drill, level, rootCause, problems = [], success, rescue, docs, examDocs, listHref }: NightShiftDrillProps) {
  const t = useT(lang);
  const settings = useStore($progress).settings;
  const [left, setLeft] = useState(false);
  const exam = settings.examMode && !left;
  const [doneBefore] = useState(() => Boolean(loadNightShift().done[id]));
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);
  const leaveBtn = useRef<HTMLButtonElement>(null);
  const backNote = useRef<HTMLParagraphElement>(null);
  const rootWrap = useRef<HTMLDivElement>(null);
  const fixedNote = useRef<HTMLDivElement>(null);
  // Level 2: how many folded hints the learner opened; on a belt, whether they asked for the choices.
  const [hintsShown, setHintsShown] = useState(0);
  const [choices, setChoices] = useState(false);
  const [rootSolved, setRootSolved] = useState(false);

  // Exam timer: counts up from when the drill opens. It never stops or fails the learner.
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const calm = settings.calm;
  useEffect(() => {
    if (!exam || finishedAt !== null) return;
    const timer = window.setInterval(() => setNow(Date.now()), calm ? 15_000 : 1_000);
    return () => window.clearInterval(timer);
  }, [exam, finishedAt, calm]);
  const elapsed = ((finishedAt ?? now) - start) / 1000;

  // The simulator says "fl:done" (a bubbling DOM event) when the goal is met.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onDone = (e: Event) => {
      // A small burst where the fix landed (skipped in calm mode and with reduced motion).
      // An incident celebrates after its root-cause question instead.
      if (e.target instanceof Element && !rootCause) celebrate(e.target, 22);
      setDone(true);
      setFinishedAt((f) => f ?? Date.now());
      setSaved(markDrillDone(id, dayKey()));
    };
    el.addEventListener('fl:done', onDone);
    return () => el.removeEventListener('fl:done', onDone);
  }, [id, rootCause]);

  // The root-cause question says "fl:done" when the right cause is picked.
  useEffect(() => {
    const el = rootWrap.current;
    if (!el) return;
    const onRoot = () => setRootSolved(true);
    el.addEventListener('fl:done', onRoot);
    return () => el.removeEventListener('fl:done', onRoot);
  }, [done]);
  useEffect(() => {
    if (rootSolved && fixedNote.current) celebrate(fixedNote.current, 30);
  }, [rootSolved]);

  const leave = () => {
    setLeft(true);
    // The button disappears: move focus to the note that replaces it.
    window.setTimeout(() => backNote.current?.focus(), 0);
  };

  // Hints: level 1 in the simulator (after mistakes); level 2 folded below; level 3 and exam mode: none.
  const simHints = drill.kind !== 'conveyor' && level === 1 && !exam ? drill.hints : [];
  const foldedHints = drill.kind !== 'conveyor' && level === 2 && !exam ? drill.hints : [];
  // Belts: level 1 shows the choices; level 2 a text box until the learner asks; level 3 and exam mode a text box.
  const beltChoices = drill.kind === 'conveyor' && !exam && (level === 1 || (level === 2 && choices));
  const showFixed = done && (!rootCause || rootSolved);
  const timeText = calm ? t('exam.timerMin', { n: clockText(elapsed, true) }) : clockText(elapsed);
  const finishedText = calm ? t('exam.timerMin', { n: clockText(elapsed, true) }) : clockText(elapsed);

  return (
    <div className="ns-drill" data-exam={exam ? 'on' : 'off'} data-level={level} data-drill-done={done ? 'true' : 'false'}>
      {exam && (
        <section className="ns-exam" aria-labelledby="ns-exam-h" data-exam-card>
          <h2 id="ns-exam-h">{t('exam.rulesTitle')}</h2>
          <ul>
            <li>
              {t('exam.rulesDocs')}{' '}
              {examDocs.map((d, i) => (
                <span key={d}>
                  <a href={`https://${d}/`} rel="noopener">
                    {d}
                  </a>
                  {i < examDocs.length - 1 ? ', ' : ''}
                </span>
              ))}
            </li>
            <li>{t('exam.rulesHints')}</li>
            <li>{t('exam.rulesKind')}</li>
          </ul>
          <div className="ns-timer">
            <span id="ns-timer-label">{t('exam.timer')}</span>{' '}
            <span className="ns-clock" role="timer" aria-live="off" aria-labelledby="ns-timer-label" data-timer>
              {timeText}
            </span>{' '}
            <span className="ns-target">· {t('exam.target')}</span>
          </div>
          {elapsed >= DRILL_SECONDS && !done && <p className="ns-timeup">{t('exam.timeUp')}</p>}
          <button type="button" className="btn btn-ghost" ref={leaveBtn} onClick={leave} data-exam-leave>
            {t('exam.leave')}
          </button>
        </section>
      )}
      {left && settings.examMode && (
        <p className="ns-left" tabIndex={-1} ref={backNote} role="status">
          {t('exam.left')}
        </p>
      )}

      {level === 3 && !exam && (
        <p className="ns-incident-note" data-incident-note>
          {t('nightshift.level.noHints')}
        </p>
      )}
      {(foldedHints.length > 0 || (drill.kind === 'conveyor' && level === 2 && !exam)) && !done && (
        <details className="ns-help ns-hints" data-hints-fold>
          <summary>{t('nightshift.level.hints')}</summary>
          {drill.kind === 'conveyor' ? (
            choices ? (
              <p>{t('nightshift.level.choicesShown')}</p>
            ) : (
              <p>
                <button type="button" className="btn btn-ghost" onClick={() => setChoices(true)} data-show-choices>
                  {t('nightshift.level.choices')}
                </button>
              </p>
            )
          ) : (
            <>
              {hintsShown > 0 && (
                <ol className="ns-hint-list" aria-live="polite">
                  {foldedHints.slice(0, hintsShown).map((h, i) => (
                    <li key={i} data-hint-item>
                      {h}
                    </li>
                  ))}
                </ol>
              )}
              {hintsShown < foldedHints.length ? (
                <p>
                  <button type="button" className="btn btn-ghost" onClick={() => setHintsShown((n) => n + 1)} data-hint-next>
                    {t(hintsShown === 0 ? 'nightshift.level.hintShow' : 'nightshift.level.hintNext')}
                  </button>
                </p>
              ) : (
                <p className="ns-hints-all">{t('nightshift.level.hintsAll')}</p>
              )}
            </>
          )}
        </details>
      )}

      <div className="ns-sim" ref={wrap}>
        <LoadGuard
          fallback={
            <div className="feedback feedback-almost ns-load-failed" role="status">
              <p>{t('nightshift.loadFailed')}</p>
              <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
                {t('nightshift.reload')}
              </button>
            </div>
          }
        >
          <Suspense fallback={<p className="ns-loading">{t('nightshift.loading')}</p>}>
          {drill.kind === 'kitchen' && <KitchenSim lang={lang} scenario={drill.scenario} goal={drill.goal} hints={simHints} success={success} />}
          {drill.kind === 'kube' && <KubeSim lang={lang} scenario={drill.scenario} goal={drill.goal} hints={simHints} success={success} />}
          {drill.kind === 'conveyor' &&
            (!beltChoices ? (
              <ConveyorBelt key="exam" lang={lang} scenario={drill.scenario} {...(drill.event ? { event: drill.event } : {})} editable task={{ type: 'green', ...(drill.forbid ? { forbid: drill.forbid } : {}) }} success={success} />
            ) : (
              <ConveyorBelt key="help" lang={lang} scenario={drill.scenario} {...(drill.event ? { event: drill.event } : {})} fixes={drill.fixes} task={{ type: 'green' }} success={success} />
            ))}
          </Suspense>
        </LoadGuard>
      </div>

      {done && rootCause && (
        <section className="ns-root" aria-labelledby="ns-root-h" data-root-cause>
          <p className="ns-root-lead" role="status">
            {t('nightshift.level.rootLead')}
          </p>
          <h2 id="ns-root-h">{rootCause.question}</h2>
          <div ref={rootWrap}>
            <Choice lang={lang} options={rootCause.options.map((label, i) => ({ label, ...(i === rootCause.answer ? { correct: true, why: rootCause.why } : { why: t('nightshift.level.rootNudge') }) }))} />
          </div>
        </section>
      )}

      {showFixed && (
        <div className="feedback feedback-right ns-fixed" role="status" data-drill-fixed ref={fixedNote}>
          <p>
            {saved ? t('nightshift.fixed') : success}
            {finishedAt !== null && settings.examMode && !left ? ` ${t('exam.finished', { time: finishedText })}` : ''}
          </p>
          {problems.length > 0 && (
            <>
              <p className="ns-problems-h">{t('nightshift.level.fixedList')}</p>
              <ul className="ns-problems" data-problems>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          <a href={listHref}>{t('nightshift.another')} →</a>
        </div>
      )}
      {!done && doneBefore && <p className="ns-before" data-done-before>{t('nightshift.fixedBefore')}</p>}

      {!exam && (
        <details className="ns-help" data-help>
          <summary>{t('nightshift.help')}</summary>
          <p>
            <a href={rescue.href} data-rescue-link>
              {rescue.title ? t('nightshift.helpRescue', { title: rescue.title }) : t('nightshift.helpRescueAll')} →
            </a>
          </p>
          <p className="ns-docs-h">{t('nightshift.helpDocs')}</p>
          <ul className="ns-docs">
            {docs.map((d) => (
              <li key={d.url}>
                <a href={d.url} rel="noopener">
                  {d.label}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
