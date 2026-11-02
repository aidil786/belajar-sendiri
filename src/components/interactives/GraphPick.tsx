// Click-the-graph: pick the right commit. Optionally run a command on it after.
import { useMemo, useState } from 'react';
import { buildScenario, run, toAnsi, type Line, type Scenario, type SimState } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import CommitGraph from './CommitGraph';
import { layoutGraph, type GraphNode } from './graphLayout';
import Inline from './Inline';
import { Feedback, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './quiz.css';
import './widgets.css';

export interface GraphPickProps {
  lang: Lang;
  scenario: Scenario;
  /** Regex for the right commit's message. */
  answer: string;
  prompt?: string;
  why?: string;
  /** Command to run after a right pick; {hash} = the picked short hash. */
  then?: string;
  showLost?: boolean;
}

export default function GraphPick({ lang, scenario, answer, prompt, why, then, showLost }: GraphPickProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const start = useMemo(() => buildScenario(scenario), [scenario]);
  const [state, setState] = useState<SimState>(start);
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<'right' | 'almost' | null>(null);
  const [output, setOutput] = useState<{ cmd: string; lines: Line[] } | null>(null);
  const [tries, setTries] = useState(0);
  const re = new RegExp(answer, 'i');

  const pick = (n: GraphNode) => {
    if (result === 'right') return;
    setPicked(n.id);
    setTries((x) => x + 1);
    if (re.test(n.message)) {
      setResult('right');
      emit('fl:done');
      if (then) {
        const cmd = then.replace('{hash}', n.short);
        const r = run(start, cmd);
        setState(r.state);
        setOutput({ cmd, lines: r.output });
      }
    } else {
      setResult('almost');
      emit('fl:wrong');
    }
  };

  return (
    <div className="graphpick" ref={ref}>
      <p className="interactive-help">{prompt ?? t('graph.tapCommit')}</p>
      <CommitGraph
        t={t}
        layout={layoutGraph(state, { showLost: Boolean(showLost) })}
        motionOK={motionOK}
        onPick={result === 'right' ? undefined : pick}
        picked={picked}
        highlight={picked && result ? { [picked]: result } : undefined}
      />
      {output && (
        <pre className="replay" aria-label={output.cmd}>
          <span className="replay-line">
            <span className="replay-prompt">$</span> {output.cmd}
          </span>
          {toAnsi(output.lines) &&
            output.lines.map((l, i) => (
              <span key={i} className="replay-line">
                {l.map((s, j) => (
                  <span key={j} className={s.c ? `seg-${s.c}` : undefined}>
                    {s.t}
                  </span>
                ))}
              </span>
            ))}
        </pre>
      )}
      {result === 'almost' && (
        <Feedback kind="almost">
          {t('feedback.almost')} {why ? <Inline text={why} /> : t('feedback.tryAgain')}
        </Feedback>
      )}
      {result === 'right' && (
        <Feedback kind="right">
          {pickPraise(t, name, tries)} {why && <Inline text={why} />}
        </Feedback>
      )}
    </div>
  );
}
