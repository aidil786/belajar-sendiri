// KubeReplay: a scripted kubectl transcript made by the food-court engine, with the
// food-court picture after each command (rule 16). Lines appear one by one once
// (all at once in calm mode); Replay button. `{pod:app=shop}` in a command is the first
// matching pod's real (generated) name. `sleep 10` lets 10 simulated seconds pass.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildScenarioCached, picture as pictureOf, promptParts, run, whereAmI, type KubeScenario, type Line, type Picture } from '~/engine/foodcourt-sim';
import type { Lang } from '~/i18n';
import FoodCourt from './FoodCourt';
import { useMotionOK, useT } from './shared';
import YouAreHere from './YouAreHere';
import './kube.css';
import './quiz.css';

export interface KubeReplayProps {
  lang: Lang;
  scenario: KubeScenario;
  commands: string[];
  /** Text alternative for screen readers. */
  label?: string;
  /** Show the food-court picture (default true). */
  picture?: boolean;
  /** Hide the command lines, show output only. */
  outputOnly?: boolean;
  /** For authors: commands meant to fail (the lesson shows that error). */
  fails?: string[];
  /** Picture namespace ('all' for every namespace). */
  namespace?: string;
}

interface Row {
  kind: 'cmd' | 'out';
  prompt?: string;
  text?: string;
  line?: Line;
  /** Index of the command this row belongs to. */
  step: number;
}

/** Replace `{pod:app=shop}` with the first matching pod name (by name, not being deleted). */
export function resolvePlaceholders(state: Parameters<typeof run>[0], cmd: string): string {
  return cmd.replace(/\{pod:([^}]+)\}/g, (_m, sel: string) => {
    const r = run(state, `kubectl get pods -l ${sel} -o name`);
    const names = r.output.map((l) => l.map((s) => s.t).join('')).filter((l) => l.startsWith('pod/')).map((l) => l.slice(4)).sort();
    return names[0] ?? 'pod-not-found';
  });
}

export default function KubeReplay({ lang, scenario, commands, label, picture = true, outputOnly, namespace }: KubeReplayProps) {
  const t = useT(lang);
  const motionOK = useMotionOK();
  const { rows, pictures, here } = useMemo(() => {
    let s = buildScenarioCached(scenario);
    const out: Row[] = [];
    const pics: (Picture | null)[] = [];
    commands.forEach((raw, i) => {
      const c = resolvePlaceholders(s, raw);
      const pp = promptParts(s);
      if (!outputOnly) out.push({ kind: 'cmd', prompt: pp.custom ? pp.custom.trimEnd() : `${pp.path} $`, text: c, step: i });
      const r = run(s, c);
      s = r.state;
      for (const l of r.output) out.push({ kind: 'out', line: l, step: i });
      pics.push(picture ? pictureOf(s, namespace ? { namespace } : {}) : null);
    });
    return { rows: out, pictures: pics, here: whereAmI(s) };
  }, [scenario, commands, outputOnly, picture, namespace]);

  const [shown, setShown] = useState(motionOK ? 0 : rows.length);
  const el = useRef<HTMLPreElement>(null);
  const started = useRef(false);
  const timers = useRef<number[]>([]);

  const play = () => {
    timers.current.forEach((x) => window.clearTimeout(x));
    timers.current = [];
    setShown(0);
    let i = 0;
    const step = () => {
      i++;
      setShown(i);
      if (i < rows.length) timers.current.push(window.setTimeout(step, rows[i]?.kind === 'cmd' ? 600 : 60));
    };
    timers.current.push(window.setTimeout(step, 300));
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
    return () => {
      io.disconnect();
      timers.current.forEach((x) => window.clearTimeout(x));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionOK, rows]);

  const lastStep = shown === 0 ? -1 : (rows[Math.min(shown, rows.length) - 1]?.step ?? -1);
  const pic = lastStep >= 0 ? pictures[lastStep] : null;
  const plainText = rows.map((r) => (r.kind === 'cmd' ? `$ ${r.text}` : (r.line ?? []).map((s) => s.t).join(''))).join('\n');

  return (
    <figure className="replay-figure kube-replay">
      <YouAreHere lang={lang} context={here.context} cluster={here.cluster} namespace={here.namespace} prodLike={here.prodLike} />
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
                  {s.t.replace(/\t/g, '        ')}
                </span>
              ))
            )}
          </span>
        ))}
      </pre>
      {picture && pic && <FoodCourt t={t} picture={pic} motionOK={motionOK} compact />}
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
