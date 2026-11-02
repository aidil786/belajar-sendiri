// A real-looking terminal transcript, made by running the engine.
// Lines appear one by one when shown (static in calm mode). Colours can pulse once.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildScenario, prettyPath, run, type Line, type Scenario } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import { useMotionOK, useT } from './shared';
import './quiz.css';

export interface TermReplayProps {
  lang: Lang;
  scenario: Scenario;
  commands: string[];
  /** Pulse the red/green parts once (e.g. git status colours). */
  pulse?: boolean;
  /** Text alternative for screen readers. */
  label?: string;
  /** Hide the command lines, show output only. */
  outputOnly?: boolean;
  /** For authors: commands meant to fail (the lesson shows that error). `npm run check:mdx` allows them. */
  fails?: string[];
}

interface Row {
  kind: 'cmd' | 'out';
  prompt?: string;
  text?: string;
  line?: Line;
}

export default function TermReplay({ lang, scenario, commands, pulse, label, outputOnly }: TermReplayProps) {
  const t = useT(lang);
  const motionOK = useMotionOK();
  const rows = useMemo(() => {
    let s = buildScenario(scenario);
    const out: Row[] = [];
    for (const c of commands) {
      if (!outputOnly) out.push({ kind: 'cmd', prompt: prettyPath(s.cwd, s.home), text: c });
      const r = run(s, c);
      s = r.state;
      for (const l of r.output) out.push({ kind: 'out', line: l });
    }
    return out;
  }, [scenario, commands, outputOnly]);

  const [shown, setShown] = useState(motionOK ? 0 : rows.length);
  const [pulsing, setPulsing] = useState(false);
  const el = useRef<HTMLPreElement>(null);
  const started = useRef(false);

  const play = () => {
    setShown(0);
    setPulsing(false);
    let i = 0;
    const step = () => {
      i++;
      setShown(i);
      if (i < rows.length) window.setTimeout(step, rows[i]?.kind === 'cmd' ? 400 : 60);
      else if (pulse) window.setTimeout(() => setPulsing(true), 200);
    };
    window.setTimeout(step, 300);
  };

  useEffect(() => {
    if (!motionOK) {
      setShown(rows.length);
      return;
    }
    const node = el.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !started.current) {
        started.current = true;
        play();
      }
    });
    io.observe(node);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionOK, rows]);

  const plainText = rows.map((r) => (r.kind === 'cmd' ? `$ ${r.text}` : (r.line ?? []).map((s) => s.t).join(''))).join('\n');

  return (
    <figure className="replay-figure">
      <pre ref={el} className={`replay${pulsing ? ' is-pulse' : ''}`} aria-hidden="true">
        {rows.map((r, i) => (
          <span key={i} className={`replay-line${i >= shown ? ' replay-hidden' : ''}`}>
            {r.kind === 'cmd' ? (
              <>
                <span className="replay-prompt">{r.prompt} $</span> <span className="replay-cmd">{r.text}</span>
              </>
            ) : (
              (r.line ?? []).map((s, j) => (
                <span key={j} className={s.c ? `seg-${s.c}` : undefined}>
                  {s.t.replace(/\t/g, '        ')}
                </span>
              ))
            )}
          </span>
        ))}
      </pre>
      <figcaption className="visually-hidden">
        {label ? `${label} ` : ''}
        {t('term.output')}: {plainText}
      </figcaption>
      {motionOK && (
        <button type="button" className="btn btn-ghost scene-btn" onClick={play}>
          ↺ {t('anim.replay')}
        </button>
      )}
    </figure>
  );
}
