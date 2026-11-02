// Rescue flowchart: answer 2–3 questions, get the exact safe commands.
// Flows sit in sections (commits, branches, …) with a filter-as-you-type box.
// Without JavaScript every problem is still listed.
import { useEffect, useId, useState } from 'react';
import type { Lang } from '~/i18n';
import { groupFlows, matchesFlow, type RescueGroup } from '~/lib/rescue';
import { DangerIcon } from './AreaIcons';
import { useT } from './shared';
import './widgets.css';

type Bi = { en: string; ms: string };
interface Step {
  id: string;
  question?: Bi | undefined;
  answers?: { label: Bi; next: string }[] | undefined;
  result?: { text: Bi; commands: { command: string; en: string; ms: string }[]; danger: 'safe' | 'careful' | 'lose'; lesson?: string | undefined } | undefined;
}

type Flow = { id: string; title: Bi; group?: RescueGroup | undefined; start: string; steps: Step[] };

export interface RescueFlowProps {
  lang: Lang;
  flows: Flow[];
  lessons: Record<string, { url: string; title: string }>;
  /**
   * Own sections instead of the Git ones (Ship It: one per part). Each lists flow ids, in order.
   * Every flow should be in exactly one section.
   */
  sections?: { id: string; title: string; flows: string[] }[] | undefined;
  /** Example words under the filter box (default: the Git ones). */
  filterHint?: string | undefined;
}

export default function RescueFlow({ lang, flows, lessons, sections, filterHint }: RescueFlowProps) {
  const t = useT(lang);
  const uid = useId();
  const [flowId, setFlowId] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [enhanced, setEnhanced] = useState(false);
  const flow = flows.find((f) => f.id === flowId);
  const step = flow?.steps.find((s) => s.id === path[path.length - 1]);
  const groups: { id: string; title: string; flows: Flow[] }[] = sections
    ? sections
        .map((s) => ({ ...s, flows: s.flows.map((id) => flows.find((f) => f.id === id)).filter((f): f is Flow => Boolean(f)) }))
        .filter((g) => g.flows.length > 0)
    : groupFlows(flows).map((g) => ({ ...g, title: t(`rescue.group.${g.id}`) }));
  const sectionOf = (id: string) => groups.find((g) => g.flows.some((f) => f.id === id))?.id;
  const visible = new Set(flows.filter((f) => matchesFlow(f, query)).map((f) => f.id));

  const start = (id: string) => {
    const f = flows.find((x) => x.id === id);
    if (!f) return;
    setFlowId(id);
    setPath([f.start]);
  };

  // The filter box only appears once it works. A link like /en/rescue/#bad-message opens that flow.
  useEffect(() => {
    setEnhanced(true);
    const id = decodeURIComponent(location.hash.slice(1));
    if (flows.some((f) => f.id === id)) start(id);
    // Run once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panel = step && (
    <div className="rescue-step" aria-live="polite" data-rescue-step>
      {step.question && (
        <>
          <p className="rescue-q">{step.question[lang]}</p>
          <div className="rescue-answers">
            {step.answers?.map((a) => (
              <button key={a.next + a.label.en} type="button" className="btn btn-ghost" onClick={() => setPath([...path, a.next])}>
                {a.label[lang]}
              </button>
            ))}
          </div>
        </>
      )}
      {step.result && (
        <div className={`rescue-result danger-${step.result.danger}`}>
          <p className="rescue-answer-title">{t('rescue.answer')}</p>
          <p>
            {step.result.danger !== 'safe' && (
              <span className="rescue-danger">
                <DangerIcon /> {t(`commands.danger.${step.result.danger}`)} ·{' '}
              </span>
            )}
            {step.result.text[lang]}
          </p>
          <ol className="rescue-cmds">
            {step.result.commands.map((c) => (
              <li key={c.command}>
                <code>{c.command}</code>
                <span>{c[lang]}</span>
              </li>
            ))}
          </ol>
          {step.result.lesson && lessons[step.result.lesson] && (
            <p>
              {t('commands.learnedIn')}: <a href={lessons[step.result.lesson]!.url}>{lessons[step.result.lesson]!.title}</a>
            </p>
          )}
        </div>
      )}
      <div className="rescue-nav">
        {path.length > 1 && (
          <button type="button" className="btn btn-quiet" onClick={() => setPath(path.slice(0, -1))}>
            ← {t('rescue.back')}
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => flow && setPath([flow.start])}>
          ↺ {t('rescue.restart')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="rescue">
      {enhanced && (
        <div className="rescue-filter">
          <label htmlFor={`${uid}-q`}>{t('rescue.filter')}</label>
          <input
            id={`${uid}-q`}
            type="search"
            autoComplete="off"
            aria-describedby={`${uid}-hint ${uid}-count`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-rescue-filter
          />
          <p className="rescue-filter-hint" id={`${uid}-hint`}>
            {filterHint ?? t('rescue.filterHint')}
          </p>
          <p className="rescue-filter-count" id={`${uid}-count`} aria-live="polite" data-rescue-count>
            {query.trim() ? t('rescue.filterCount', { n: visible.size, total: flows.length }) : ''}
          </p>
        </div>
      )}
      <h2 className="rescue-pick-title">{t('rescue.pick')}</h2>
      {groups.map((g) => {
        const shown = g.flows.filter((f) => visible.has(f.id));
        return (
          <section key={g.id} className="rescue-group" aria-labelledby={`${uid}-${g.id}`} hidden={shown.length === 0} data-rescue-group={g.id}>
            <h3 className="rescue-group-title" id={`${uid}-${g.id}`}>
              {g.title}
            </h3>
            <div className="rescue-flows">
              {g.flows.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`btn ${flowId === f.id ? '' : 'btn-ghost'}`}
                  aria-pressed={flowId === f.id}
                  hidden={!visible.has(f.id)}
                  onClick={() => start(f.id)}
                  data-rescue-flow={f.id}
                >
                  {f.title[lang]}
                </button>
              ))}
            </div>
            {flow && sectionOf(flow.id) === g.id && visible.has(flow.id) && panel}
          </section>
        );
      })}
      {visible.size === 0 && (
        <p className="rescue-none" role="status">
          {t('rescue.filterNone')}{' '}
          <button type="button" className="btn btn-quiet" onClick={() => setQuery('')}>
            {t('rescue.filterClear')}
          </button>
        </p>
      )}
    </div>
  );
}
