/**
 * The few DOM helpers the interface is built from.
 *
 * **Nothing is ever written as HTML.** Every message in a chat came from a stranger or from somebody
 * typing quickly, so every piece of text lands through `textContent` and every element is made with
 * `createElement`. There is no `innerHTML` in this package, so there is no sanitiser to get wrong.
 *
 * Nothing here runs at import time: a page rendered on a server imports this module and never
 * touches `document`.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Text a person wrote: its direction from its own first strong character, whatever the interface's. */
export function userText<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = el(tag, className, text);
  node.dir = 'auto';
  return node;
}

export function button(className: string, label?: string, text?: string): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

/** Read by a screen reader, invisible on screen: "You:", "Sara:" before what they said. */
export function srOnly(text: string): HTMLSpanElement {
  return el('span', 'sr', text);
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * The icons, as path data: lucide's shapes (ISC), drawn at 24 × 24 with a 2px stroke. Those that
 * point somewhere — send, the progress ring — are mirrored by the stylesheet in right-to-left.
 */
const PATHS = {
  send: [
    'M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z',
    'M6 12h16',
  ],
  paperclip: [
    'm16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551',
  ],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  seen: ['M18 6 7 17l-5-5', 'm22 10-7.5 7.5L13 16'],
  file: [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M10 13h4',
    'M10 17h4',
  ],
  audio: [
    'M9 18V5l12-2v13',
    'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    'M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  ],
  video: [
    'm16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5',
    'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  ],
  chat: [
    'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
  ],
  sparkle: [
    'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
  ],
  chevron: ['m9 18 6-6-6-6'],
  offline: [
    'M12 20h.01',
    'M8.5 16.429a5 5 0 0 1 7 0',
    'M5 12.859a10 10 0 0 1 5.17-2.69',
    'M19 12.859a10 10 0 0 0-2.007-1.523',
    'M2 8.82a15 15 0 0 1 4.177-2.643',
    'M22 8.82a15 15 0 0 0-11.288-3.764',
    'm2 2 20 20',
  ],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * A rating face, worst (1) to best (5): one circle, two eyes, and a mouth that turns from a frown
 * to a smile. Drawn here rather than borrowed from the phone's emoji, so every visitor sees the
 * same five faces whatever their device — and with the words beside them, because a face is read
 * differently across cultures and a screen reader reads none of them well.
 */
export function ratingFace(score: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('class', `face-${score}`);
  svg.setAttribute('aria-hidden', 'true');
  const shape = (tag: string, attributes: Record<string, string>) => {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
  };
  shape('circle', { cx: '18', cy: '18', r: '16', class: 'skin' });
  shape('circle', { cx: '12.5', cy: '14.5', r: '2', class: 'ink' });
  shape('circle', { cx: '23.5', cy: '14.5', r: '2', class: 'ink' });
  // The mouth's middle sits above its ends for a frown and below them for a smile.
  const bend = [-5, -2.5, 0, 3, 5.5][Math.min(4, Math.max(0, score - 1))]!;
  shape('path', {
    d: `M11 ${24 - bend / 2} Q18 ${24 + bend} 25 ${24 - bend / 2}`,
    class: 'mouth',
  });
  return svg;
}

/** The progress ring on an upload chip. `fraction` is 0 to 1; the stylesheet mirrors it in RTL. */
export function progressRing(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('aria-hidden', 'true');
  for (const name of ['track', 'bar']) {
    const circle = document.createElementNS(SVG, 'circle');
    circle.setAttribute('cx', '18');
    circle.setAttribute('cy', '18');
    circle.setAttribute('r', '15');
    circle.setAttribute('class', name);
    circle.setAttribute('pathLength', '100');
    svg.append(circle);
  }
  return svg;
}

export function setRing(svg: SVGSVGElement, fraction: number): void {
  const bar = svg.querySelector('.bar');
  const shown = Math.max(0.04, Math.min(1, fraction));
  bar?.setAttribute('stroke-dasharray', `${(shown * 100).toFixed(1)} 100`);
}
