// UI strings. All visible UI text comes from en.json / ms.json.
import en from './en.json';
import ms from './ms.json';

export const LANGS = ['en', 'ms'] as const;
export type Lang = (typeof LANGS)[number];
export type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = { en, ms };

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ms';
}

export function otherLang(lang: Lang): Lang {
  return lang === 'en' ? 'ms' : 'en';
}

/** Fill {placeholders}. Unknown placeholders stay visible so they are easy to spot. */
export function format(text: string, params: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const text = DICTS[lang][key] ?? DICTS.en[key];
  if (text === undefined) {
    if (import.meta.env?.DEV) console.warn(`Missing i18n key: ${key}`);
    return key;
  }
  return format(text, params);
}

/** A translator bound to one language. */
export function useT(lang: Lang) {
  return (key: string, params?: Record<string, string | number>) => t(lang, key, params);
}

export function dict(lang: Lang): Dict {
  return DICTS[lang];
}

/** Bilingual text in content files: { en: '...', ms: '...' }. */
export type Bilingual = { en: string; ms: string };

export function pick(text: Bilingual | string | undefined, lang: Lang): string {
  if (text === undefined) return '';
  return typeof text === 'string' ? text : text[lang];
}

export const LANG_HTML: Record<Lang, string> = { en: 'en', ms: 'ms' };
