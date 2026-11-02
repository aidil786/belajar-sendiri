// Spot the hole: a workflow with security holes. Tap a risky line: it turns red
// (with an icon) and shows the attack in plain words, then the fix. Safe lines get a
// kind "Almost!" and, after two misses, a hint. Done when every hole is found;
// then the fixed workflow can be shown. Nothing moves, so calm mode looks the same.
import { useMemo, useState } from 'react';
import { auditWorkflow, type ConveyorScenario, type HoleKind } from '~/engine/conveyor-sim';
import type { Lang } from '~/i18n';
import { holeLines, type HoleLine, type HoleSpec } from '~/lib/spotTheHole';
import { highlightYaml } from '~/lib/yamlBuilder';
import { DangerIcon } from './AreaIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './conveyor.css';

export interface SpotTheHoleProps {
  lang: Lang;
  /** The workflow, one entry per line. A string is a safe line; `{ text, hole }` is a hole. */
  workflow?: (string | { text: string; hole?: HoleSpec })[];
  /** Or a cicd scenario (course="cicd"): its workflow, holes found by the engine's audit. */
  scenario?: ConveyorScenario;
  /** Scenario mode: words for a hole, by line number (attack, fix, fixCode). */
  notes?: Record<number, HoleSpec>;
  /** File name shown above the code. */
  file?: string;
  prompt?: string;
  success?: string;
}

export default function SpotTheHole({ lang, workflow, scenario, notes, file, prompt, success }: SpotTheHoleProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const { ref, emit } = useCardEvents();
  const lines: HoleLine[] = useMemo(() => {
    if (workflow) return holeLines(workflow);
    if (!scenario) return [];
    const holes = auditWorkflow(scenario.workflow, { publicRepo: !scenario.repo?.private });
    const extra = new Map((scenario.holes ?? []).map((h) => [h.line, h]));
    return scenario.workflow
      .replace(/\n$/, '')
      .split('\n')
      .map((text, i) => {
        const n = i + 1;
        const h = holes.find((x) => x.line === n);
        if (!h) return { n, text };
        const spec: HoleSpec = { kind: h.kind, ...(extra.get(n)?.fix !== undefined ? { fixCode: extra.get(n)!.fix } : {}), ...notes?.[n] };
        return { n, text, hole: spec };
      });
  }, [workflow, scenario, notes]);
  const holes = lines.filter((l) => l.hole);
  const [found, setFound] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [miss, setMiss] = useState<{ n: number; count: number } | null>(null);
  const [showFixed, setShowFixed] = useState(false);
  const [announce, setAnnounce] = useState('');
  const misses = miss?.count ?? 0;
  const done = holes.length > 0 && found.length === holes.length;

  const tap = (l: HoleLine) => {
    if (l.hole) {
      setMiss(null);
      if (found.includes(l.n)) {
        setOpen(open === l.n ? null : l.n);
        return;
      }
      setOpen(l.n);
      const next = [...found, l.n];
      setFound(next);
      setAnnounce(t('holes.found', { n: next.length, total: holes.length }));
      if (next.length === holes.length) emit('fl:done', { tries: misses + next.length });
      return;
    }
    setMiss({ n: l.n, count: misses + 1 });
    emit('fl:wrong');
  };

  const kindOf = (h: HoleSpec): HoleKind | 'other' => h.kind ?? 'other';
  const hint = () => {
    const left = holes.find((l) => !found.includes(l.n));
    return left ? t(`holes.hint.${kindOf(left.hole!)}`) : '';
  };
  const fixed = scenario?.fixed;

  return (
    <div className="sth" ref={ref}>
      <p className="interactive-help">{prompt ?? t('holes.instructions')}</p>
      <p className="sth-count" aria-hidden="true">
        {t('holes.found', { n: found.length, total: holes.length })}
      </p>
      <p className="cv-head">
        {t('conveyor.file')} <code className="cv-path">{file ?? scenario?.file ?? '.github/workflows/ci.yml'}</code>
      </p>
      <ol className="sth-code" aria-label={t('holes.codeLabel')}>
        {lines.map((l) => {
          const isFound = found.includes(l.n);
          const indent = /^ */.exec(l.text)![0].length;
          const guides = Math.floor(indent / 2);
          return (
            <li key={l.n} className={cx('sth-line', isFound && 'is-found', miss?.n === l.n && 'is-miss')}>
              <button type="button" className="sth-btn" aria-expanded={l.hole && isFound ? open === l.n : undefined} disabled={done && !l.hole} onClick={() => tap(l)}>
                <span className="cv-ln" aria-hidden="true">
                  {l.n}
                </span>
                <span className="visually-hidden">{t('conveyor.line', { n: l.n })}: </span>
                <span className="cv-code">
                  {Array.from({ length: guides }, (_, g) => (
                    <span key={g} className="cv-guide" aria-hidden="true">
                      {'  '}
                    </span>
                  ))}
                  {highlightYaml(l.text.slice(guides * 2)).map((tok, j) => (
                    <span key={j} className={tok.c ? `ybt-${tok.c}` : undefined}>
                      {tok.t}
                    </span>
                  ))}
                  {l.text.trim() === '' ? ' ' : ''}
                </span>
                {isFound && (
                  <span className="sth-flag">
                    <DangerIcon size={14} /> {t(`holes.kind.${kindOf(l.hole!)}`)}
                  </span>
                )}
              </button>
              {isFound && open === l.n && (
                <div className="sth-reveal">
                  <p>
                    <strong>{t('holes.attack')}</strong> {l.hole!.attack ?? t(`holes.attackText.${kindOf(l.hole!)}`)}
                  </p>
                  <p>
                    <strong>{t('holes.fix')}</strong> {l.hole!.fix ?? t(`holes.fixText.${kindOf(l.hole!)}`)}
                  </p>
                  {l.hole!.fixCode !== undefined && (
                    <pre className="sth-fixcode">{l.hole!.fixCode === '' ? t('holes.deleteLine') : l.hole!.fixCode}</pre>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {miss && !done && (
        <Feedback kind="almost">
          {t('feedback.almost')} {t('holes.safe', { n: miss.n })} {misses >= 2 ? hint() : ''}
        </Feedback>
      )}
      {done && (
        <>
          <Feedback kind="right">{success ?? `${pickPraise(t, learner, misses)} ${t('holes.done', { total: holes.length })}`}</Feedback>
          {fixed && (
            <div className="sth-fixed">
              <button type="button" className="btn btn-ghost" aria-expanded={showFixed} onClick={() => setShowFixed((x) => !x)}>
                {showFixed ? t('holes.hideFixed') : t('holes.showFixed')}
              </button>
              {showFixed && (
                <pre className="cv-yaml sth-fixed-code" tabIndex={0} aria-label={t('holes.fixedLabel')}>
                  {fixed
                    .replace(/\n$/, '')
                    .split('\n')
                    .map((line, i) => (
                      <span key={i} className="cv-line">
                        <span className="cv-ln" aria-hidden="true">
                          {i + 1}
                        </span>
                        <span className="cv-code">
                          {highlightYaml(line).map((tok, j) => (
                            <span key={j} className={tok.c ? `ybt-${tok.c}` : undefined}>
                              {tok.t}
                            </span>
                          ))}
                        </span>
                        {'\n'}
                      </span>
                    ))}
                </pre>
              )}
            </div>
          )}
        </>
      )}
      <Announce text={announce} />
    </div>
  );
}
