import { el } from './dom.js';

/**
 * A web address in a message: `http://`, `https://` or `www.`, in any case (a phone capitalises the
 * first word, which a pasted link often is). It ends before whitespace and before the punctuation a
 * sentence puts after it — a full stop, an Arabic comma or question mark, a closing bracket the
 * address did not open.
 */
const WEB =
  /(?:https?:\/\/|\bwww\.)(?:[^\s()<>"]|\([^\s()<>"]*\))*(?:[^\s()<>".,:;!?'’”»\]}*_~،؛؟…]|\([^\s()<>"]*\))/giu;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

/**
 * A phone number: an optional `+`, then at least seven digits, with the spaces, dashes, dots and
 * brackets people write between them. Matched so it can be kept left to right — in a right-to-left
 * sentence the spaces between its groups otherwise take the sentence's direction, and
 * `+973 3311 2233` is drawn as `2233 3311 +973`.
 */
const PHONE = /\+?\d(?:[\d\s().-]{5,}\d)/g;

type Part = { text: string; kind?: 'web' | 'email' | 'phone' };

/** A line as plain text and the pieces that must stay left to right, in order. */
export function partsOf(line: string): Part[] {
  const found: { start: number; end: number; kind: Part['kind'] }[] = [];
  const claim = (pattern: RegExp, kind: Part['kind'], digitsAtLeast = 0) => {
    for (const match of line.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (digitsAtLeast && match[0].replace(/\D/g, '').length < digitsAtLeast) continue;
      if (found.some((one) => start < one.end && end > one.start)) continue;
      found.push({ start, end, kind });
    }
  };
  claim(WEB, 'web');
  claim(EMAIL, 'email');
  claim(PHONE, 'phone', 7);
  found.sort((a, b) => a.start - b.start);

  const parts: Part[] = [];
  let cursor = 0;
  for (const one of found) {
    if (one.start > cursor) parts.push({ text: line.slice(cursor, one.start) });
    parts.push({ text: line.slice(one.start, one.end), kind: one.kind });
    cursor = one.end;
  }
  if (cursor < line.length) parts.push({ text: line.slice(cursor) });
  return parts;
}

/**
 * A message's words as nodes: one block per line, each taking its own direction from its first
 * strong character (an Arabic line in an English chat reads right to left, and the reverse), with
 * links that open and numbers, addresses and links kept left to right inside it.
 *
 * **The address shown is the address opened**, character for character, and only `http`/`https` is
 * ever produced, so a stranger's message cannot dress one place up as another.
 */
export function messageText(body: string): HTMLElement[] {
  return body.split('\n').map((line) => {
    const row = el('div', 'line');
    row.dir = 'auto';
    if (!line) {
      row.textContent = ' ';
      return row;
    }
    for (const part of partsOf(line)) {
      if (!part.kind) {
        row.append(part.text);
        continue;
      }
      if (part.kind === 'web') {
        const link = el('a', 'link', part.text);
        link.href = /^https?:\/\//i.test(part.text) ? part.text : `https://${part.text}`;
        // Out of the chat — which may be a panel on somebody else's page — never over it.
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.dir = 'ltr';
        row.append(link);
        continue;
      }
      const kept = el('bdi', 'ltr', part.text);
      kept.dir = 'ltr';
      row.append(kept);
    }
    return row;
  });
}
