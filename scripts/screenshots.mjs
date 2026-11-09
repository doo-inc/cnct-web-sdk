/**
 * Screenshots of the chat UI rendering the fixture conversation, for a reviewer to approve the
 * release by: `{en,ar} × {light,dark}` with the default theme and `{en,ar}` with a custom one
 * (`chat-<lang>-<appearance>.png`, `chat-<lang>-custom.png`), plus the end of a conversation and the
 * name-first start (`chat-<lang>-ended.png`, `chat-<lang>-start.png`) — ten images, in `screenshots/`.
 *
 * They are the real component on the example page, through the fixture's fake transport and
 * socket, in Chromium. Each is also checked before it is taken: the direction, that nothing scrolls
 * sideways, that the phone number in the mixed line stays left to right, and that the theme asked
 * for is the theme applied. A check that fails fails the run.
 *
 *   npm run build && node scripts/screenshots.mjs
 */
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'screenshots');
await mkdir(out, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.json': 'application/json',
};
const server = createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname));
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(root)) return response.writeHead(403).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const SHOTS = [
  { name: 'chat-en-light', lang: 'en', appearance: 'light' },
  { name: 'chat-en-dark', lang: 'en', appearance: 'dark' },
  { name: 'chat-ar-light', lang: 'ar', appearance: 'light' },
  { name: 'chat-ar-dark', lang: 'ar', appearance: 'dark' },
  { name: 'chat-en-custom', lang: 'en', appearance: 'light', custom: true },
  { name: 'chat-ar-custom', lang: 'ar', appearance: 'light', custom: true },
  // Two moments the conversation above cannot show: the end, with the rating card, and the start
  // of an inbox that asks for a name first.
  { name: 'chat-en-ended', lang: 'en', appearance: 'light', state: 'ended' },
  { name: 'chat-ar-ended', lang: 'ar', appearance: 'dark', state: 'ended' },
  { name: 'chat-en-start', lang: 'en', appearance: 'light', state: 'new' },
  { name: 'chat-ar-start', lang: 'ar', appearance: 'light', state: 'new' },
];
// Phone-width, and tall enough that the whole fixture conversation is on screen at once.
const viewport = {
  width: Number(process.env.SHOT_WIDTH ?? 420),
  height: Number(process.env.SHOT_HEIGHT ?? 1000),
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const problems = [];
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const state = shot.state ?? 'conversation';
    const query = new URLSearchParams({
      shot: '1',
      lang: shot.lang,
      appearance: shot.appearance,
      state,
    });
    if (state === 'conversation') query.set('files', '1');
    if (shot.custom) query.set('theme', 'custom');
    await page.goto(`${origin}/examples/ui/index.html?${query}`);

    // Everything the state shows, settled: for the conversation, the failed message, the typing
    // dots, both picked files, the photo decoded; for the end, the rating card ready; for the start,
    // the form.
    await page.waitForFunction(
      (state) => {
        const root = document.querySelector('cnct-chat')?.shadowRoot;
        if (!root) return false;
        const photo = root.querySelector('.photo img');
        const photoReady = Boolean(photo?.complete && photo.naturalWidth > 0);
        if (state === 'new') return Boolean(root.querySelector('.intro input[name=phone]'));
        if (state === 'ended') {
          const faces = [...root.querySelectorAll('.rate')];
          return (
            photoReady &&
            faces.length === 5 &&
            faces.every((face) => !face.disabled) &&
            root.querySelector('.closed .primary')
          );
        }
        const chips = [...root.querySelectorAll('.upload')];
        return (
          photoReady &&
          root.querySelector('.msg.failed') &&
          root.querySelector('.typing') &&
          root.querySelector('.card') &&
          chips.length === 2 &&
          chips.filter((chip) => chip.getAttribute('aria-busy') === 'true').length === 1
        );
      },
      state,
      { timeout: 15000 },
    );
    await page.evaluate(() => document.fonts.ready);
    if (shot.custom) {
      await page.waitForFunction(
        () =>
          document.fonts.check('16px "Cairo"') &&
          [...document.querySelector('cnct-chat').shadowRoot.querySelectorAll('.logo img')].every(
            (img) => img.complete && img.naturalWidth,
          ),
        null,
        { timeout: 15000 },
      );
    }
    await page.waitForTimeout(300);

    const facts = await page.evaluate(() => {
      const root = document.querySelector('cnct-chat').shadowRoot;
      const wrap = root.querySelector('.cnct');
      const thread = root.querySelector('.thread');
      const style = getComputedStyle(wrap);
      const phone = [...root.querySelectorAll('bdi.ltr')].map((node) => node.textContent);
      const you = root.querySelector('.group.you .msg');
      const sent = you?.getBoundingClientRect() ?? { left: 0, right: 0 };
      const box = thread.getBoundingClientRect();
      return {
        dir: wrap.dir,
        appearance: wrap.dataset.appearance,
        primary: style.getPropertyValue('--_primary').trim(),
        radius: style.getPropertyValue('--_radius').trim(),
        font: style.fontFamily,
        logo: Boolean(root.querySelector('.logo img')),
        phone,
        sideways: thread.scrollWidth - thread.clientWidth,
        pageSideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipped: thread.scrollHeight - thread.clientHeight,
        // The visitor's own messages sit on the trailing side: the right in English, the left in Arabic.
        visitorSide: sent.left - box.left < box.right - sent.right ? 'left' : 'right',
        autoDirs: [...root.querySelectorAll('.msg .line')].every((line) => line.dir === 'auto'),
        // Every control a finger can reach is at least 44 × 44 CSS pixels.
        small: [...root.querySelectorAll('button, textarea')]
          .filter((node) => node.getClientRects().length)
          .map((node) => [node.className, node.getBoundingClientRect()])
          .filter(([, r]) => r.width < 43.5 || r.height < 43.5)
          .map(([name, r]) => `${name} ${Math.round(r.width)}x${Math.round(r.height)}`),
      };
    });

    const expect = (ok, what) => {
      if (!ok) problems.push(`${shot.name}: ${what} (${JSON.stringify(facts)})`);
    };
    expect(facts.dir === (shot.lang === 'ar' ? 'rtl' : 'ltr'), 'the direction is wrong');
    expect(facts.appearance === shot.appearance, 'the appearance is wrong');
    expect(facts.sideways <= 0 && facts.pageSideways <= 0, 'something scrolls sideways');
    if (state !== 'new') {
      expect(facts.clipped <= 2, 'the conversation does not fit; raise SHOT_HEIGHT');
      expect(facts.phone.includes('+973 3311 2233'), 'the phone number is not kept left to right');
      expect(
        facts.visitorSide === (shot.lang === 'ar' ? 'left' : 'right'),
        "the visitor's messages are on the wrong side",
      );
      expect(facts.autoDirs, 'a line of a message does not take its own direction');
    }
    expect(errors.length === 0, `the page threw: ${errors.join(' | ')}`);
    expect(facts.small.length === 0, `controls under 44px: ${facts.small.join(', ')}`);
    if (shot.custom) {
      expect(facts.primary.toLowerCase() === '#d7262e', 'the custom primary is not applied');
      expect(facts.radius === '8px', 'the custom corner radius is not applied');
      expect(facts.font.includes('Cairo'), 'the custom font is not applied');
      expect(facts.logo, 'the custom logo is not shown');
    } else {
      expect(facts.primary.toLowerCase() === '#b52d93', 'the default primary is not applied');
    }

    await page.screenshot({ path: join(out, `${shot.name}.png`) });
    console.log(`screenshots/${shot.name}.png`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error(`\n${problems.length} check(s) failed:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`\n${SHOTS.length} screenshots, every check passed.`);
