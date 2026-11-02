// A real-looking Docker transcript made by the kitchen engine, with the state picture.
// Lines appear one by one when shown (all at once in calm mode); the picture follows the transcript.
// MDX: <Interactive name="KitchenReplay" scenario="d1-nginx" commands={['docker run -d --name web -p 8080:80 nginx:1.30-alpine', 'docker ps']} label="..." />
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildKitchenScenario, kitchenPicture, promptOf, run, type KitchenScenario, type Line, type Picture } from '~/engine/kitchen-sim';
import type { Lang } from '~/i18n';
import KitchenBoard from './KitchenBoard';
import { useMotionOK, useT } from './shared';
import './quiz.css';
import './kitchen.css';

export interface KitchenReplayProps {
  lang: Lang;
  scenario: KitchenScenario;
  commands: string[];
  /** Text alternative for screen readers (what happens, in plain words). */
  label?: string;
  /** Hide the command lines, show output only. */
  outputOnly?: boolean;
  /** Show the state picture under the transcript (default true). */
  picture?: boolean;
  /** For authors: commands meant to fail (the lesson shows that error). `npm run check:mdx` allows them. */
  fails?: string[];
}

interface Row {
  kind: 'cmd' | 'out';
  prompt?: string;
  text?: string;
  line?: Line;
  /** Index of the command this row belongs to. */
  step: number;
}

export default function KitchenReplay({ lang, scenario, commands, label, outputOnly, picture = true }: KitchenReplayProps) {
  const t = useT(lang);
  const motionOK = useMotionOK();
  const { rows, pictures } = useMemo(() => {
    let s = buildKitchenScenario(scenario);
    const out: Row[] = [];
    const pics: Picture[] = [kitchenPicture(s)];
    commands.forEach((c, step) => {
      const p = promptOf(s);
      if (!outputOnly) out.push({ kind: 'cmd', prompt: p.custom ?? `${p.path} $`, text: p.custom === 'Password: ' ? '' : c, step });
      const r = run(s, c);
      s = r.state;
      for (const l of r.output) out.push({ kind: 'out', line: l, step });
      pics.push(kitchenPicture(s));
    });
    return { rows: out, pictures: pics };
  }, [scenario, commands, outputOnly]);

  const [shown, setShown] = useState(motionOK ? 0 : rows.length);
  const el = useRef<HTMLPreElement>(null);
  const started = useRef(false);

  const play = () => {
    setShown(0);
    let i = 0;
    const step = () => {
      i++;
      setShown(i);
      if (i < rows.length) window.setTimeout(step, rows[i]?.kind === 'cmd' ? 450 : 40);
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

  // The picture shows the kitchen after the last command whose output is fully shown.
  const lastRow = rows[Math.min(shown, rows.length) - 1];
  const nextRow = rows[shown];
  const doneStep = shown >= rows.length ? commands.length : lastRow ? (nextRow && nextRow.step === lastRow.step ? lastRow.step : lastRow.step + 1) : 0;
  const pic = pictures[Math.max(0, Math.min(doneStep, pictures.length - 1))]!;
  const plainText = rows.map((r) => (r.kind === 'cmd' ? `$ ${r.text}` : (r.line ?? []).map((s) => s.t).join(''))).join('\n');

  return (
    <figure className="replay-figure kreplay">
      <pre ref={el} className="replay" aria-hidden="true">
        {rows.map((r, i) => (
          <span key={i} className={`replay-line${i >= shown ? ' replay-hidden' : ''}`}>
            {r.kind === 'cmd' ? (
              <>
                <span className="replay-prompt">{r.prompt}</span> <span className="replay-cmd">{r.text}</span>
              </>
            ) : (
              (r.line ?? []).map((s, j) => (
                <span key={j} className={s.c ? `seg-${s.c}` : undefined}>
                  {s.t}
                </span>
              ))
            )}
          </span>
        ))}
      </pre>
      <figcaption className="visually-hidden">
        {label ? `${label} ` : ''}
        {t('kitchen.transcript')}: {plainText}
      </figcaption>
      {picture && (
        <div className="kreplay-state">
          <KitchenBoard t={t} picture={pic} motionOK={motionOK} />
        </div>
      )}
      {motionOK && (
        <button type="button" className="btn btn-ghost scene-btn" onClick={play}>
          ↺ {t('anim.replay')}
        </button>
      )}
    </figure>
  );
}
