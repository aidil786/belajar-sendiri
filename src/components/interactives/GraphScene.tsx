// Concept animation on the commit graph: run commands one by one and watch
// commits, branches and HEAD move. Replayable; calm mode shows before/after.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildScenario, run, type Scenario, type SimState } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import CommitGraph from './CommitGraph';
import { layoutGraph } from './graphLayout';
import { useMotionOK, useT } from './shared';
import './areas.css';

export interface GraphSceneProps {
  lang: Lang;
  scenario: Scenario;
  commands: string[];
  label: string;
  showLost?: boolean;
}

export default function GraphScene({ lang, scenario, commands, label, showLost }: GraphSceneProps) {
  const t = useT(lang);
  const motionOK = useMotionOK();
  const states = useMemo(() => {
    let s: SimState = buildScenario(scenario);
    const out: SimState[] = [s];
    for (const c of commands) {
      s = run(s, c).state;
      out.push(s);
    }
    return out;
  }, [scenario, commands]);
  const last = states.length - 1;
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState('');
  const timers = useRef<number[]>([]);
  const root = useRef<HTMLElement>(null);
  const played = useRef(false);

  const play = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setStep(0);
    setTyped('');
    let at = 500;
    commands.forEach((cmd, i) => {
      for (let k = 1; k <= cmd.length; k++) {
        timers.current.push(window.setTimeout(() => setTyped(cmd.slice(0, k)), at));
        at += 35;
      }
      at += 250;
      timers.current.push(window.setTimeout(() => setStep(i + 1), at));
      at += 1100;
    });
  }, [commands]);

  useEffect(() => {
    if (!motionOK) {
      setStep(last);
      setTyped(commands[commands.length - 1] ?? '');
      return;
    }
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !played.current) {
        played.current = true;
        play();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      timers.current.forEach((id) => window.clearTimeout(id));
    };
  }, [motionOK, play, last, commands]);

  const state = states[step] ?? states[0]!;
  return (
    <figure className="graph-scene" ref={root}>
      <figcaption className="visually-hidden">{label}</figcaption>
      <div className="scene-command" aria-hidden="true">
        <span className="scene-prompt">$</span> <code>{motionOK ? typed : commands.join('  ·  ')}</code>
      </div>
      {/* Not aria-hidden: the graph is a focusable scroll region, and its nodes have their own labels. */}
      <CommitGraph t={t} layout={layoutGraph(state, { showLost: Boolean(showLost) })} motionOK={motionOK} />
      <div className="scene-controls">
        {motionOK ? (
          <button type="button" className="btn btn-ghost scene-btn" onClick={play}>
            ↺ {t('anim.replay')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost scene-btn" aria-pressed={step === 0} onClick={() => setStep(step === 0 ? last : 0)}>
              {step === 0 ? t('anim.showAfter') : t('anim.showBefore')}
            </button>
            <span className="scene-state">{step === 0 ? t('anim.before') : t('anim.after')}</span>
          </>
        )}
      </div>
    </figure>
  );
}
