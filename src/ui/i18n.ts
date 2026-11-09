import type { CnctChatAvailability } from '../chat/types.js';
import { CNCT_STRINGS, type CnctStringKey } from './strings.js';

/** The two languages the interface speaks. */
export type CnctChatLanguage = 'en' | 'ar';

/** Per-language overrides of any of the interface's words, by key. */
export type CnctChatStrings = Partial<
  Record<CnctChatLanguage, Partial<Record<CnctStringKey, string>>>
>;

/**
 * `auto` takes the first of the visitor's own languages the interface speaks — so one install
 * serves an Arabic phone in Arabic and an English laptop in English — and English when none is.
 * A language that is pinned, by the app or by the inbox's settings, is simply that language.
 */
export function pickLanguage(
  setting: string | null | undefined,
  preferred: readonly string[] = deviceLanguages(),
): CnctChatLanguage {
  if (setting === 'en' || setting === 'ar') return setting;
  for (const tag of preferred) {
    const base = String(tag || '')
      .toLowerCase()
      .split(/[-_]/)[0];
    if (base === 'ar' || base === 'en') return base;
  }
  return 'en';
}

/** The browser's preferred languages, or none where there is no browser. */
export function deviceLanguages(): string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } })
    .navigator;
  if (nav?.languages?.length) return [...nav.languages];
  return nav?.language ? [nav.language] : [];
}

/**
 * **Latin digits in Arabic**, as Gulf apps write them — `9:41 ص`, not `٩:٤١ ص` — and the chosen
 * language's own formats otherwise. Times and dates follow the interface's language rather than the
 * device's, so an English chat on an Arabic phone reads as English throughout; in English, the
 * device's own English (`en-GB` writes "3 October", `en-US` "October 3") where it has one.
 */
export function localeFor(
  language: CnctChatLanguage,
  preferred: readonly string[] = deviceLanguages(),
): string {
  if (language === 'ar') return 'ar-u-nu-latn';
  const english = preferred.find((tag) => /^en(?:[-_]|$)/i.test(tag));
  try {
    return english ? (Intl.getCanonicalLocales(english.replace('_', '-'))[0] ?? 'en') : 'en';
  } catch {
    return 'en';
  }
}

export type Translate = (key: CnctStringKey, vars?: Record<string, string | number>) => string;

/**
 * The words in one language, with the app's overrides on top.
 *
 * **A missing word falls back to English, never to its key** — an app that overrides one English
 * word and not its Arabic one gets the Arabic, and a translation that has not caught up says the
 * English rather than `notTakingChats` to a customer.
 */
export function translator(language: CnctChatLanguage, overrides: CnctChatStrings = {}): Translate {
  const pick = (key: CnctStringKey): string => {
    const own =
      overrides[language]?.[key] ?? (CNCT_STRINGS[language] as Record<string, string>)[key];
    if (own) return own;
    return overrides.en?.[key] ?? CNCT_STRINGS.en[key] ?? '';
  };
  return (key, vars = {}) => {
    let text = pick(key);
    for (const [name, value] of Object.entries(vars))
      text = text.split(`{${name}}`).join(String(value));
    return text;
  };
}

// ── Time ───────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

export function clockTime(value: string | Date, language: CnctChatLanguage): string {
  return new Date(value).toLocaleTimeString(localeFor(language), {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Today", "Yesterday", or the date — the stamp between days in a thread. */
export function dayLabel(
  value: string | Date,
  t: Translate,
  language: CnctChatLanguage,
  now = new Date(),
): string {
  const date = new Date(value);
  if (date.toDateString() === now.toDateString()) return t('today');
  if (date.toDateString() === new Date(now.getTime() - DAY).toDateString()) return t('yesterday');
  return date.toLocaleDateString(localeFor(language), { day: 'numeric', month: 'long' });
}

/** "Conversation ended today", "…yesterday", "…on 3 October". */
export function endedLine(
  value: string | Date,
  t: Translate,
  language: CnctChatLanguage,
  now = new Date(),
): string {
  const label = dayLabel(value, t, language, now);
  const when =
    label === t('today')
      ? t('endedToday')
      : label === t('yesterday')
        ? t('endedYesterday')
        : t('endedOn', { date: label });
  return t('ended', { when });
}

// ── Sizes ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Units are words, and the shared table has none, so they are spelled here rather than left to
 * `Intl` — whose short Arabic megabyte differs between engines (`م.ب` in one, `ميغابايت` in another).
 * These are the words the table's own "over 50 MB" sentence uses.
 */
const UNITS: Record<CnctChatLanguage, [string, string, string]> = {
  en: ['B', 'KB', 'MB'],
  ar: ['بايت', 'كيلوبايت', 'ميغابايت'],
};

/** "1.2 MB", "220 KB" — or "1.2 ميغابايت", in Latin digits, in Arabic. */
export function fileSize(bytes: number | null | undefined, language: CnctChatLanguage): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '';
  const [b, kb, mb] = UNITS[language];
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: digits }).format(value);
  if (bytes < 1000) return `${format(bytes, 0)} ${b}`;
  if (bytes < 1000 * 1000) return `${format(Math.round(bytes / 1000), 0)} ${kb}`;
  return `${format(Math.round(bytes / 100_000) / 10, 1)} ${mb}`;
}

// ── Availability ───────────────────────────────────────────────────────────────────────────────

/**
 * **What the visitor can expect, said honestly** — the sentence the hosted widget builds from the
 * inbox's `availability`. Closed: when the team is back, in the visitor's clock and language, and
 * whether the assistant can help meanwhile. Open: how fast replies have really come lately. Without
 * a measurement it promises nothing.
 */
export function availabilityLine(
  availability: CnctChatAvailability | null | undefined,
  t: Translate,
  language: CnctChatLanguage,
  now = new Date(),
): string {
  if (!availability) return t('replyUnknown');
  if (availability.open === false && availability.opensAt) {
    const back = backAt(new Date(availability.opensAt), t, language, now);
    return availability.assistant ? t('backAssistant', { back }) : back;
  }
  const minutes = availability.replyMinutes;
  if (minutes === null || minutes === undefined) {
    return availability.assistant ? t('assistantNow') : t('replyUnknown');
  }
  if (minutes < 1) return availability.assistant ? t('assistantNow') : t('replyUnder1');
  if (minutes <= 5) return t('replyFew');
  if (minutes <= 20) return t('reply20');
  if (minutes <= 60) return t('replyHour');
  if (minutes <= 240) return t('replyHours');
  return t('replyDay');
}

/** "The team is back today at 9:00", "…tomorrow at 9:00", "…Sunday at 9:00". */
function backAt(when: Date, t: Translate, language: CnctChatLanguage, now: Date): string {
  const time = clockTime(when, language);
  if (when.toDateString() === now.toDateString()) return t('backToday', { time });
  if (when.toDateString() === new Date(now.getTime() + DAY).toDateString()) {
    return t('backTomorrow', { time });
  }
  const day = when.toLocaleDateString(localeFor(language), { weekday: 'long' });
  return t('backOn', { day, time });
}
