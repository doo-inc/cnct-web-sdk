import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CNCT_STRINGS,
  availabilityLine,
  fileSize,
  localeFor,
  pickLanguage,
  translator,
} from '../src/ui/index.js';
import { clockTime, endedLine } from '../src/ui/i18n.js';

/**
 * The words, and which language they are said in. The table is shared word for word with the iOS
 * and Android SDKs, so the first block holds this package's copy to the shared file exactly.
 */

const shared = JSON.parse(
  readFileSync(new URL('../docs/chat-ui/strings.json', import.meta.url), 'utf8'),
) as Record<'en' | 'ar', Record<string, string>>;

describe('the string tables', () => {
  it('are the shared table, word for word', () => {
    expect(CNCT_STRINGS).toEqual(shared);
  });

  it('have the same keys in English and Arabic, and no empty Arabic', () => {
    expect(Object.keys(CNCT_STRINGS.ar).sort()).toEqual(Object.keys(CNCT_STRINGS.en).sort());
    expect(Object.keys(CNCT_STRINGS.en)).toHaveLength(129);
    for (const [key, value] of Object.entries(CNCT_STRINGS.ar)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('use the same placeholders in both languages', () => {
    const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(CNCT_STRINGS.en) as (keyof typeof CNCT_STRINGS.en)[]) {
      expect(holes(CNCT_STRINGS.ar[key]), key).toEqual(holes(CNCT_STRINGS.en[key]));
    }
  });
});

describe('choosing a language', () => {
  it('takes a pinned language as it is', () => {
    expect(pickLanguage('ar', ['en-GB'])).toBe('ar');
    expect(pickLanguage('en', ['ar-BH'])).toBe('en');
  });

  it('takes the first of the device’s languages it speaks, on auto', () => {
    expect(pickLanguage('auto', ['ar-BH', 'en-US'])).toBe('ar');
    expect(pickLanguage('auto', ['fr-FR', 'ar_SA', 'en'])).toBe('ar');
    expect(pickLanguage('auto', ['de-DE', 'en-GB', 'ar'])).toBe('en');
    expect(pickLanguage(undefined, ['AR'])).toBe('ar');
  });

  it('falls back to English when the device speaks neither', () => {
    expect(pickLanguage('auto', ['fr-FR', 'de'])).toBe('en');
    expect(pickLanguage('auto', [])).toBe('en');
  });
});

describe('the words', () => {
  it('fill in their values', () => {
    const t = translator('en');
    expect(t('notTakingChats', { business: 'Harbour Café' })).toBe(
      'Harbour Café is not taking chats right now',
    );
    expect(translator('ar')('tooBig', { name: 'photo.jpg' })).toBe(
      'photo.jpg أكبر من 50 ميغابايت.',
    );
  });

  it('take an app’s overrides, per language', () => {
    const t = translator('ar', { ar: { send: 'أرسل الآن' }, en: { send: 'Go' } });
    expect(t('send')).toBe('أرسل الآن');
    expect(translator('en', { ar: { send: 'أرسل الآن' } })('send')).toBe('Send');
  });

  it('fall back to English for a missing or empty Arabic word, never to the key', () => {
    const t = translator('ar', { ar: { send: '' }, en: { send: 'Go' } });
    expect(t('send')).toBe('Go');
    const plain = translator('ar', { ar: { attach: '' } });
    expect(plain('attach')).toBe('Attach a file');
  });
});

describe('numbers, times and sizes', () => {
  it('writes Latin digits in Arabic', () => {
    expect(localeFor('ar')).toBe('ar-u-nu-latn');
    expect(localeFor('en', ['ar-BH', 'en-GB'])).toBe('en-GB');
    expect(localeFor('en', ['ar-BH'])).toBe('en');
    const time = clockTime(new Date(2026, 10, 9, 21, 5), 'ar');
    expect(time).toMatch(/9:05/);
    expect(time).not.toMatch(/[٠-٩]/);
    expect(clockTime(new Date(2026, 10, 9, 21, 5), 'en')).toBe('9:05 PM');
  });

  it('says sizes in the interface’s language', () => {
    expect(fileSize(1_200_000, 'en')).toBe('1.2 MB');
    expect(fileSize(220_000, 'en')).toBe('220 KB');
    expect(fileSize(512, 'en')).toBe('512 B');
    expect(fileSize(1_200_000, 'ar')).toBe('1.2 ميغابايت');
    expect(fileSize(220_000, 'ar')).toBe('220 كيلوبايت');
    expect(fileSize(null, 'en')).toBe('');
  });

  it('says when a conversation ended in words for today and yesterday', () => {
    const now = new Date(2026, 10, 9, 12);
    const t = translator('en');
    expect(endedLine(new Date(2026, 10, 9, 9), t, 'en', now)).toBe('Conversation ended today');
    expect(endedLine(new Date(2026, 10, 8, 9), t, 'en', now)).toBe('Conversation ended yesterday');
    expect(endedLine(new Date(2026, 9, 3, 9), t, 'en', now)).toMatch(
      /^Conversation ended on (3 October|October 3)$/,
    );
  });
});

describe('the availability line', () => {
  const t = translator('en');
  const now = new Date(2026, 10, 9, 18, 0);

  it('promises nothing it cannot keep', () => {
    expect(availabilityLine(null, t, 'en', now)).toBe(
      'The team will reply here as soon as they can',
    );
    expect(
      availabilityLine(
        { open: true, opensAt: null, assistant: false, replyMinutes: null },
        t,
        'en',
        now,
      ),
    ).toBe('The team will reply here as soon as they can');
  });

  it('says how fast replies really come', () => {
    const at = (replyMinutes: number, assistant = false) =>
      availabilityLine({ open: true, opensAt: null, assistant, replyMinutes }, t, 'en', now);
    expect(at(0.5)).toBe('Usually replies in under a minute');
    expect(at(0.5, true)).toBe('Our assistant replies straight away');
    expect(at(4)).toBe('Usually replies in a few minutes');
    expect(at(15)).toBe('Usually replies in under 20 minutes');
    expect(at(45)).toBe('Usually replies in under an hour');
    expect(at(200)).toBe('Usually replies in a few hours');
    expect(at(600)).toBe('Usually replies within a day');
  });

  it('says when a closed team is back, in the visitor’s clock, and whether the assistant helps meanwhile', () => {
    const tomorrow = new Date(2026, 10, 10, 9, 0).toISOString();
    expect(
      availabilityLine(
        { open: false, opensAt: tomorrow, assistant: false, replyMinutes: 5 },
        t,
        'en',
        now,
      ),
    ).toBe('The team is back tomorrow at 9:00 AM');
    expect(
      availabilityLine(
        { open: false, opensAt: tomorrow, assistant: true, replyMinutes: 5 },
        t,
        'en',
        now,
      ),
    ).toBe('The team is back tomorrow at 9:00 AM · our assistant can help now');
    const later = new Date(2026, 10, 12, 9, 0).toISOString();
    expect(
      availabilityLine(
        { open: false, opensAt: later, assistant: false, replyMinutes: 5 },
        t,
        'en',
        now,
      ),
    ).toBe('The team is back Thursday at 9:00 AM');
    expect(
      availabilityLine(
        { open: false, opensAt: tomorrow, assistant: false, replyMinutes: 5 },
        translator('ar'),
        'ar',
        now,
      ),
    ).toMatch(/^يعود الفريق غداً الساعة 9:00/);
  });
});
