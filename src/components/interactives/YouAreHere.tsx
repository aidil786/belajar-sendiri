// The pink "you are here" bar (Ship It rule 17): which cluster and namespace the next
// kubectl command will touch. A production-like cluster also shows a red warning with an icon.
import type { Lang } from '~/i18n';
import { useT } from './shared';
import './kube.css';

export interface YouAreHereProps {
  lang: Lang;
  context: string;
  cluster?: string;
  namespace: string;
  /** Looks like production: red edge plus a warning icon and text. */
  prodLike?: boolean;
  /** Flash once (the context or namespace just changed). */
  changed?: boolean;
}

export function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5Zm0 6.3a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" fill="currentColor" />
    </svg>
  );
}

export function WarnIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M8 1.5 15 14H1L8 1.5Z" fill="currentColor" />
      <rect x="7.2" y="5.5" width="1.6" height="4.6" rx=".6" fill="var(--color-surface)" />
      <rect x="7.2" y="11.1" width="1.6" height="1.6" rx=".6" fill="var(--color-surface)" />
    </svg>
  );
}

export default function YouAreHere({ lang, context, cluster, namespace, prodLike, changed }: YouAreHereProps) {
  const t = useT(lang);
  return (
    <div className={`kube-here${prodLike ? ' kube-here-prod' : ''}${changed ? ' is-changed' : ''}`} role="status" aria-label={t('kube.here.label', { context, namespace })}>
      <span className="kube-here-pin">
        <PinIcon />
      </span>
      <span className="kube-here-text">
        <span className="kube-here-key">{t('kube.here.title')}</span>{' '}
        <span className="kube-here-item">
          <span className="kube-here-what">{t('kube.here.cluster')}</span> <code>{context}</code>
          {cluster && cluster !== context ? <span className="visually-hidden"> ({cluster})</span> : null}
        </span>{' '}
        <span className="kube-here-item">
          <span className="kube-here-what">{t('kube.here.namespace')}</span> <code>{namespace}</code>
        </span>
      </span>
      {prodLike && (
        <span className="kube-here-warn">
          <WarnIcon /> {t('kube.here.prod')}
        </span>
      )}
    </div>
  );
}
