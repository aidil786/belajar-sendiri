// Idle Bill (Level Up · AWS, A1 safety and A4 costs): one thing at a time. Does it keep costing money
// while it sits idle, or is it free? Each answer shows why, with the official AWS page. At the end the
// costly ones become your clean-up list. No prices: they change (the pricing pages are linked instead).
// Facts: src/lib/aws/idleCosts.ts (each with its source, checked 2026-11-01); words: i18n aws.idle.*.
import { useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { FREE_TIER_URL, idleItems, type IdleBucket, type IdleItem } from '~/lib/aws/idleCosts';
import { AwsIcon } from './awsShared';
import { Announce, Feedback, cx, pickPraise, seededShuffle, useCardEvents, useLearnerName, useT } from './shared';
import './aws-games.css';

export interface IdleBillProps {
  lang: Lang;
  /** Item ids from the knowledge set (default: 4 that cost + 4 that are free). */
  items?: string[];
  /** Keep the given order instead of a fixed shuffle. */
  ordered?: boolean;
  prompt?: string;
  success?: string;
}

export default function IdleBill({ lang, items: ids, ordered = false, prompt, success }: IdleBillProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const tries = useRef(0);
  const items = useMemo(() => {
    const list = idleItems(ids);
    return ordered ? list : seededShuffle(list, list.map((i) => i.id).join(','));
  }, [ids, ordered]);
  const [placed, setPlaced] = useState<IdleItem[]>([]);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const current = items[placed.length];
  const done = !current;

  const name = (it: IdleItem) => t(`aws.idle.item.${it.id}.name`);
  const why = (it: IdleItem) => t(`aws.idle.item.${it.id}.why`);

  const answer = (bucket: IdleBucket) => {
    if (!current) return;
    tries.current++;
    if (bucket !== current.bucket) {
      setMsg({ kind: 'almost', text: why(current) });
      setAnnounce(why(current));
      emit('fl:wrong', { item: current.id });
      return;
    }
    const next = [...placed, current];
    setPlaced(next);
    setAnnounce(t('aws.idle.placed', { name: name(current), where: t(`aws.idle.${bucket}`) }));
    if (next.length === items.length) {
      setMsg({ kind: 'right', text: success ?? `${pickPraise(t, learner, tries.current)} ${t('aws.idle.done')}` });
      emit('fl:done', { tries: tries.current });
    } else setMsg(null);
  };

  const column = (bucket: IdleBucket) => {
    const list = placed.filter((p) => p.bucket === bucket);
    return (
      <section className={cx('awg-col', `is-${bucket}`)} aria-labelledby={`${id}-${bucket}`}>
        <h3 className="awg-head" id={`${id}-${bucket}`}>
          <AwsIcon name={bucket === 'costs' ? 'bill' : 'shelf'} />
          {t(bucket === 'costs' ? 'aws.idle.billTitle' : 'aws.idle.freeTitle')}
        </h3>
        {list.length ? (
          <ul className="awg-sorted">
            {list.map((it) => (
              <li key={it.id} className="awg-sorted-item">
                <strong>{name(it)}</strong>
                <span>{why(it)}</span>
                <span className="awg-sources">
                  {it.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                      {t('aws.idle.source', { label: s.label })}
                    </a>
                  ))}
                  {it.pricing && (
                    <a href={it.pricing} target="_blank" rel="noopener noreferrer">
                      {t('aws.idle.pricing')}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="awg-note">{t('aws.idle.emptyCol')}</p>
        )}
      </section>
    );
  };

  const cleanup = placed.filter((p) => p.bucket === 'costs');

  return (
    <div className="awg awg-idle" ref={ref}>
      <p className="interactive-help">{prompt ?? t('aws.idle.help')}</p>

      {current && (
        <section className="awg-now" aria-labelledby={`${id}-now`}>
          <p className="awg-note" id={`${id}-count`}>
            {t('aws.idle.progress', { n: placed.length + 1, total: items.length })}
          </p>
          <h3 className="awg-now-name" id={`${id}-now`}>
            <AwsIcon name="unit" />
            {name(current)}
          </h3>
          <div className="awg-row" role="group" aria-labelledby={`${id}-now`} aria-describedby={`${id}-count`}>
            <button type="button" className="btn btn-ghost scene-btn awg-say is-costs" onClick={() => answer('costs')}>
              <AwsIcon name="bill" />
              {t('aws.idle.sayCosts')}
            </button>
            <button type="button" className="btn btn-ghost scene-btn awg-say is-free" onClick={() => answer('free')}>
              <AwsIcon name="shelf" />
              {t('aws.idle.sayFree')}
            </button>
          </div>
        </section>
      )}

      {msg && <Feedback kind={msg.kind}>{msg.kind === 'almost' ? `${t('feedback.almost')} ${msg.text}` : msg.text}</Feedback>}

      <div className="awg-cols">
        {column('costs')}
        {column('free')}
      </div>

      {done && (
        <section className="awg-cleanup" aria-labelledby={`${id}-clean`}>
          <h3 className="awg-head" id={`${id}-clean`}>
            <AwsIcon name="ok" />
            {t('aws.idle.cleanup')}
          </h3>
          <ol>
            {cleanup.map((it) => (
              <li key={it.id}>{name(it)}</li>
            ))}
          </ol>
          <p className="awg-note">{t('aws.idle.cleanupNote')}</p>
          <p className="awg-note">
            <a href={FREE_TIER_URL} target="_blank" rel="noopener noreferrer">
              {t('aws.idle.freeTier')}
            </a>
          </p>
        </section>
      )}
      <Announce text={announce} />
    </div>
  );
}
