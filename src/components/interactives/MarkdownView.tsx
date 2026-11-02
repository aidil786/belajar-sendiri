// Shows Markdown with the safe renderer (src/lib/markdown.ts). Used by
// MarkdownPlayground and PracticeRepo. Relative links never leave the lesson:
// they call onRelativeLink instead (PracticeRepo opens the file).
import { useMemo, type MouseEvent } from 'react';
import { t as translate, type Lang } from '~/i18n';
import { renderMarkdown, type MarkdownLabels } from '~/lib/markdown';
import { cx, type T } from './shared';
import './markdown.css';

export function mdLabels(t: T): MarkdownLabels {
  return {
    alerts: { NOTE: t('md.note'), TIP: t('md.tip'), IMPORTANT: t('md.important'), WARNING: t('md.warning'), CAUTION: t('md.caution') },
    image: t('md.image'),
    mermaid: t('md.mermaid'),
    taskDone: t('md.taskDone'),
    taskTodo: t('md.taskTodo'),
    newTab: t('md.newTab'),
  };
}

export interface MarkdownViewProps {
  lang: Lang;
  source: string;
  /** Single line breaks become <br> (comments). */
  breaks?: boolean;
  className?: string;
  onRelativeLink?: (href: string) => void;
  id?: string;
}

export default function MarkdownView({ lang, source, breaks, className, onRelativeLink, id }: MarkdownViewProps) {
  const labels = useMemo(() => mdLabels((key) => translate(lang, key)), [lang]);
  // The renderer escapes every character of the source and only emits its own tags.
  const html = useMemo(() => renderMarkdown(source, { labels, breaks, headingOffset: 2 }), [source, labels, breaks]);
  const click = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a[data-md-relative]');
    if (!a) return;
    e.preventDefault();
    onRelativeLink?.(a.getAttribute('href') ?? '');
  };
  return <div id={id} className={cx('md-body', className)} onClick={click} dangerouslySetInnerHTML={{ __html: html }} />;
}
