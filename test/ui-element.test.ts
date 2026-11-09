// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatFixture } from '../src/ui/fixture.js';
import {
  defineCnctChat,
  mountChat,
  type CnctChatEvent,
  type CnctChatHandle,
} from '../src/ui/index.js';
import { fakeChat, said } from './support/fake-chat.js';

/**
 * The interface, mounted in a DOM and driven the way a visitor drives it. What it shows comes from
 * the real headless client, over the fixture or a scripted fake CNCT.
 */

let mounted: CnctChatHandle[] = [];
let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '600px';
  document.body.replaceChildren(host);
  // A thread in view, always: happy-dom lays nothing out, so nothing would ever intersect.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() =>
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as never,
          ),
        );
      }
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(async () => {
  for (const one of mounted) one.destroy();
  mounted = [];
  await tick(5);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(
  read: () => T,
  what = 'the condition',
  timeout = 3000,
): Promise<NonNullable<T>> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (value) return value as NonNullable<T>;
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${what}`);
    await tick(10);
  }
}

function mount(options: Parameters<typeof mountChat>[1]): CnctChatHandle {
  const handle = mountChat(host, options);
  mounted.push(handle);
  return handle;
}

const root = (handle: CnctChatHandle) => handle.element.shadowRoot!;
const $ = <E extends Element = HTMLElement>(handle: CnctChatHandle, selector: string) =>
  root(handle).querySelector<E>(selector);
const $$ = (handle: CnctChatHandle, selector: string) => [
  ...root(handle).querySelectorAll<HTMLElement>(selector),
];
const texts = (handle: CnctChatHandle, selector: string) =>
  $$(handle, selector).map((n) => n.textContent ?? '');
const opened = (handle: CnctChatHandle) =>
  until(
    () =>
      !$(handle, '.chat')?.classList.contains('hidden') &&
      handle.element.shadowRoot?.querySelector('.foot'),
    'the chat',
  );

function type(handle: CnctChatHandle, words: string): void {
  const box = $<HTMLTextAreaElement>(handle, 'textarea')!;
  box.value = words;
  box.dispatchEvent(new Event('input'));
}

function submit(handle: CnctChatHandle): void {
  $<HTMLFormElement>(handle, 'form.row')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('the fixture conversation', () => {
  it('renders every part of it', async () => {
    const chat = mount({ client: await createChatFixture({ still: true }), language: 'en' });
    await until(() => $(chat, '.msg.failed') && $(chat, '.typing'), 'the whole fixture');

    expect($(chat, '.title')?.textContent).toBe('Harbour Café');
    expect($(chat, '.status')?.textContent).toBe('Usually replies in a few minutes');
    expect(texts(chat, '.system')).toEqual(['Hello. How can we help?']);
    const words = texts(chat, '.msg .line');
    expect(words).toEqual([
      'Do you open on Fridays?',
      'Yes, from 2pm to 10pm. Would you like to book a visit?',
      'Thanks, here is your invoice.',
      'Call me on +973 3311 2233 please',
      'Can I pay by card?',
    ]);
    // The flow draws its words, not the numbered body, and its two buttons under them.
    expect(texts(chat, '.choice')).toEqual(['Book a visit', 'Talk to a person']);
    // The photo, and the invoice as a card with its name and size.
    expect($(chat, '.photo')?.getAttribute('aria-label')).toBe('Photo, 1.2 MB');
    expect($(chat, '.card .fname')?.textContent).toBe('invoice.pdf');
    expect($(chat, '.card .size')?.textContent).toBe('220 KB');
    // Faces and first names on the team's side; an AI tag on the assistant.
    expect(texts(chat, '.byline .name')).toEqual(['Assistant', 'Sara']);
    expect(texts(chat, '.byline .chip')).toEqual(['AI']);
    // The failed message, marked, with its retry; the team typing.
    expect($(chat, '.msg.failed')?.textContent).toContain('Can I pay by card?');
    expect($(chat, '.retry')?.textContent).toBe('Not sent — tap to try again');
    expect($(chat, '.typing')).not.toBeNull();
  });

  it('labels every message for a screen reader with who said it', async () => {
    const chat = mount({ client: await createChatFixture({ still: true }), language: 'en' });
    await until(() => $(chat, '.msg.failed'), 'the fixture');
    expect(texts(chat, '.msg .sr')).toEqual(['You: ', 'Assistant: ', 'You: ', 'Sara: ', 'You: ']);
    expect($(chat, '.thread')?.getAttribute('role')).toBe('log');
    expect($(chat, '.retry')?.tagName).toBe('BUTTON');
    for (const control of $$(chat, 'button')) {
      const named = control.getAttribute('aria-label') || control.textContent?.trim();
      expect(named, control.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });

  it('retries the failed message, which then goes', async () => {
    const chat = mount({ client: await createChatFixture({ still: true }), language: 'en' });
    const retry = await until(() => $(chat, '.retry'), 'the retry');
    retry.click();
    await until(() => !$(chat, '.msg.failed'), 'the retried message to be stored');
    expect(texts(chat, '.msg .line')).toContain('Can I pay by card?');
  });
});

describe('Arabic and right to left', () => {
  it('mirrors the whole interface, and lets every piece of user text take its own direction', async () => {
    const chat = mount({
      client: await createChatFixture({ language: 'ar', still: true }),
      language: 'ar',
    });
    await until(() => $(chat, '.msg.failed'), 'the fixture');
    const wrap = $(chat, '.cnct')!;
    expect(wrap.dir).toBe('rtl');
    expect(wrap.lang).toBe('ar');
    for (const line of $$(chat, '.msg .line, .system .line')) expect(line.dir).toBe('auto');
    for (const name of $$(chat, '.byline .name, .card .fname, .choice span span'))
      expect(name.dir).toBe('auto');
    expect($(chat, '.title')?.dir).toBe('auto');
    expect($(chat, 'textarea')?.dir).toBe('auto');
    expect($(chat, '.retry')?.textContent).toBe('لم تُرسل، اضغط للمحاولة مجدداً');
    expect($(chat, '.photo')?.getAttribute('aria-label')).toBe('صورة، 1.2 ميغابايت');
  });

  it('keeps a phone number left to right inside an Arabic sentence', async () => {
    const chat = mount({
      client: await createChatFixture({ language: 'ar', still: true }),
      language: 'ar',
    });
    await until(() => $(chat, '.msg.failed'), 'the fixture');
    const kept = $$(chat, 'bdi.ltr');
    expect(kept.map((n) => [n.textContent, n.dir])).toEqual([['+973 3311 2233', 'ltr']]);
  });

  it('writes times in Latin digits', async () => {
    const chat = mount({
      client: await createChatFixture({ language: 'ar', still: true }),
      language: 'ar',
    });
    await until(() => $(chat, '.msg.failed'), 'the fixture');
    const times = texts(chat, '.byline > span:last-child');
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(time).not.toMatch(/[٠-٩]/);
    expect(times.some((time) => /\d{1,2}:\d{2}/.test(time))).toBe(true);
  });

  it('takes the inbox’s language when the app sets none, and the app’s over it', async () => {
    const server = fakeChat({ widget: { brand: { language: 'ar' } } });
    const chat = mount({ client: server.client });
    await opened(chat);
    expect($(chat, '.cnct')?.dir).toBe('rtl');
    chat.update({ language: 'en' });
    expect($(chat, '.cnct')?.dir).toBe('ltr');
  });
});

describe('the theme', () => {
  it('is the app’s, then the inbox’s, then the defaults', async () => {
    const server = fakeChat({
      widget: { brand: { color: '#123456', avatarUrl: 'https://cdn.example.com/l.png' } },
    });
    const chat = mount({ client: server.client, theme: { cornerRadius: 8 } });
    await opened(chat);
    const style = $(chat, '.cnct')!.style;
    expect(style.getPropertyValue('--_d-primary')).toBe('#123456');
    expect(style.getPropertyValue('--_d-on-primary')).toBe('#ffffff');
    expect(style.getPropertyValue('--_d-corner-radius')).toBe('8px');
    expect($<HTMLImageElement>(chat, '.logo img')?.src).toBe('https://cdn.example.com/l.png');

    chat.update({
      theme: {
        primary: '#D7262E',
        appearance: 'dark',
        title: 'Help',
        logo: 'https://x.test/a.svg',
      },
    });
    expect(style.getPropertyValue('--_d-primary')).toBe('#D7262E');
    expect(style.getPropertyValue('--_d-background')).toBe('#0f1115');
    expect($(chat, '.cnct')?.dataset.appearance).toBe('dark');
    expect($(chat, '.title')?.textContent).toBe('Help');
    expect($<HTMLImageElement>(chat, '.logo img')?.src).toBe('https://x.test/a.svg');
  });

  it('puts the business’s first letter in the logo where there is no image', async () => {
    const chat = mount({ client: fakeChat().client });
    await opened(chat);
    expect($(chat, '.logo')?.textContent).toBe('H');
  });

  it('hides the Powered by line when the inbox or the app says so', async () => {
    const chat = mount({ client: fakeChat({ widget: { brand: { showBranding: false } } }).client });
    await opened(chat);
    expect($(chat, '.powered')?.classList.contains('hidden')).toBe(true);
    chat.update({ theme: { showPoweredBy: true } });
    expect($(chat, '.powered')?.classList.contains('hidden')).toBe(false);
  });
});

describe('opening', () => {
  it('says the link is not valid for an inbox that does not exist', async () => {
    const server = fakeChat();
    server.stub('GET /api/chat/public/k', 404, { error: 'No such inbox.' });
    const chat = mount({ client: server.client, language: 'en' });
    await until(() => $(chat, '.center h2'), 'the refusal');
    expect($(chat, '.center h2')?.textContent).toBe('This chat link is not valid');
  });

  it('says the business is not taking chats for an inbox switched off', async () => {
    const chat = mount({ client: fakeChat({ inbox: { isActive: false } }).client, language: 'en' });
    await until(() => $(chat, '.center h2'), 'the refusal');
    expect($(chat, '.center h2')?.textContent).toBe('Harbour Café is not taking chats right now');
  });

  it('asks for a name first when the inbox starts with details, then starts with it', async () => {
    const events: CnctChatEvent[] = [];
    const server = fakeChat({ stored: false, widget: { chat: { start: 'details' } } });
    const chat = mount({
      client: server.client,
      language: 'en',
      onEvent: (event) => events.push(event),
    });
    const name = await until(
      () => $<HTMLInputElement>(chat, '.intro input[name=name]'),
      'the name field',
    );
    expect($(chat, '.intro button[type=submit]')?.textContent).toBe('Start chatting');
    name.value = 'Layla';
    $<HTMLFormElement>(chat, '.intro form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await until(() => !$(chat, '.chat')?.classList.contains('hidden'), 'the chat');
    const started = server.requests.find((r) => r.method === 'POST' && r.path.endsWith('/session'));
    expect(started?.body).toMatchObject({ displayName: 'Layla' });
    expect(events.map((e) => e.type)).toEqual(['opened', 'started']);
  });

  it('lets a visitor type first when the inbox starts with a message, starting on the first send', async () => {
    const server = fakeChat({ stored: false });
    const chat = mount({ client: server.client, language: 'en' });
    await until(() => $(chat, '.system'), 'the greeting');
    expect(texts(chat, '.system')).toEqual(['Hello. How can we help?']);
    type(chat, 'Do you open on Fridays?');
    submit(chat);
    await until(() => server.messages.length === 1, 'the message');
    const order = server.requests.filter((r) => r.method === 'POST').map((r) => r.path);
    expect(order).toEqual(['/api/chat/public/k/session', '/api/chat/public/messages']);
  });

  it('signs a visitor in before it reads any history', async () => {
    const server = fakeChat();
    const chat = mount({ client: server.client, identity: { userId: 'u1', userHash: 'hash' } });
    await opened(chat);
    const paths = server.requests.map((r) => `${r.method} ${r.path}`);
    expect(paths.indexOf('POST /api/chat/public/k/identify')).toBeLessThan(
      paths.indexOf('GET /api/chat/public/session'),
    );
    const resumed = server.requests.find((r) => r.path === '/api/chat/public/session');
    expect(resumed?.token).toBe('signed');
  });

  it('logs a sign-in that fails, and chats anonymously anyway', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = fakeChat();
    server.stub('POST /api/chat/public/k/identify', 401, {
      error: 'That signature did not verify.',
    });
    const chat = mount({ client: server.client, identity: { userId: 'u1', userHash: 'wrong' } });
    await opened(chat);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('That signature did not verify.'));
    expect($(chat, '.chat')?.classList.contains('hidden')).toBe(false);
  });
});

describe('the header', () => {
  it('draws a close button only for an app that handles it', async () => {
    const onClose = vi.fn();
    const chat = mount({ client: fakeChat().client, language: 'en' });
    await opened(chat);
    expect($(chat, '.close')?.classList.contains('hidden')).toBe(true);
    chat.update({ onClose });
    const close = $(chat, '.close')!;
    expect(close.classList.contains('hidden')).toBe(false);
    expect(close.getAttribute('aria-label')).toBe('Close chat');
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers to end the conversation only where the inbox allows it', async () => {
    const chat = mount({
      client: fakeChat({ widget: { chat: { allowEndConversation: false } } }).client,
    });
    await opened(chat);
    expect($(chat, '.ghost')?.classList.contains('hidden')).toBe(true);
  });
});

describe('sending', () => {
  it('sends what was typed, clears the box, and reports it', async () => {
    const events: CnctChatEvent[] = [];
    const server = fakeChat();
    const chat = mount({ client: server.client, onEvent: (event) => events.push(event) });
    await opened(chat);
    const send = $<HTMLButtonElement>(chat, '.send')!;
    expect(send.disabled).toBe(true);
    type(chat, 'Hello there');
    expect(send.disabled).toBe(false);
    submit(chat);
    await until(() => server.messages.length, 'the message');
    expect($<HTMLTextAreaElement>(chat, 'textarea')?.value).toBe('');
    await until(() => events.some((e) => e.type === 'sent'), 'the sent event');
    expect(texts(chat, '.msg .line')).toContain('Hello there');
  });

  it('sends a tapped flow choice as its title with its id, and asks for the right kind of answer', async () => {
    const flow = said('AI', '1. Book\n2. Person', {
      flow: {
        text: 'What would you like?',
        layout: 'buttons',
        choices: [{ id: 'book', title: 'Book a visit' }],
      },
    });
    const server = fakeChat({ messages: [flow] });
    const chat = mount({ client: server.client, language: 'en' });
    await opened(chat);
    expect($<HTMLTextAreaElement>(chat, 'textarea')?.placeholder).toBe('Choose one, or type…');
    const choice = await until(
      () => $<HTMLButtonElement>(chat, '.choice:not([disabled])'),
      'an active choice',
    );
    choice.click();
    await until(() => server.messages.length === 2, 'the choice');
    expect(server.requests.find((r) => r.path === '/api/chat/public/messages')?.body).toMatchObject(
      {
        body: 'Book a visit',
        replyId: 'book',
      },
    );
    // Answered, so the buttons stay as a record and can no longer be tapped.
    await until(() => !$(chat, '.choice:not([disabled])'), 'the choices to settle');
  });

  it('picks the keyboard a flow’s question expects', async () => {
    const ask = said('AI', 'What is your email?', {
      flow: { text: 'What is your email?', layout: 'buttons', choices: [], expects: 'email' },
    });
    const chat = mount({ client: fakeChat({ messages: [ask] }).client, language: 'en' });
    await opened(chat);
    const box = $<HTMLTextAreaElement>(chat, 'textarea')!;
    expect(box.placeholder).toBe('Type your email address…');
    expect(box.inputMode).toBe('email');
  });

  it('offers the assistant’s suggestions as chips that send', async () => {
    const answer = said('AI', 'Anything else?', { suggestions: ['Opening hours', 'Prices'] });
    const server = fakeChat({ messages: [answer] });
    const chat = mount({ client: server.client });
    await opened(chat);
    expect(texts(chat, '.suggestions .choice')).toEqual(['Opening hours', 'Prices']);
    $(chat, '.suggestions .choice')!.click();
    await until(() => server.messages.length === 2, 'the suggestion');
    expect(server.messages[1]?.body).toBe('Opening hours');
  });

  it('makes links open, out of the chat, and only ever http or https', async () => {
    const chat = mount({
      client: fakeChat({
        messages: [said('OPERATOR', 'Pay at https://pay.example.com/x. Or javascript:alert(1)')],
      }).client,
    });
    await opened(chat);
    const links = $$(chat, '.msg a.link') as HTMLAnchorElement[];
    expect(links.map((a) => [a.textContent, a.href, a.target, a.rel])).toEqual([
      ['https://pay.example.com/x', 'https://pay.example.com/x', '_blank', 'noopener noreferrer'],
    ]);
  });
});

describe('files', () => {
  const pdf = (name = 'a.pdf', size = 10) =>
    new File([new Uint8Array(size)], name, { type: 'application/pdf' });

  it('uploads a picked file with progress, then sends it with the message', async () => {
    const events: CnctChatEvent[] = [];
    const server = fakeChat();
    const chat = mount({ client: server.client, onEvent: (event) => events.push(event) });
    await opened(chat);
    chat.element.addFiles([pdf('menu.pdf')]);
    await until(() => $(chat, '.upload[aria-busy=false]'), 'the upload');
    expect($(chat, '.upload .fname')?.textContent).toBe('menu.pdf');
    expect($(chat, '.remove')?.getAttribute('aria-label')).toBe('Remove menu.pdf');
    expect($<HTMLButtonElement>(chat, '.send')?.disabled).toBe(false);
    submit(chat);
    await until(() => server.messages.length, 'the message');
    expect(server.requests.find((r) => r.path === '/api/chat/public/messages')?.body).toMatchObject(
      {
        body: '',
        attachmentIds: ['att_1'],
      },
    );
    expect($$(chat, '.upload')).toHaveLength(0);
    await until(() => events.some((e) => e.type === 'attachmentSent'), 'attachmentSent');
  });

  it('refuses before uploading — the eleventh, one over 50 MB, a kind it does not take — in a sentence', async () => {
    const server = fakeChat();
    const chat = mount({ client: server.client, language: 'en' });
    await opened(chat);
    const huge = { name: 'film.mp4', size: 51 * 1024 * 1024, type: 'video/mp4' } as File;
    chat.element.addFiles([huge]);
    expect($(chat, '.foot .error')?.textContent).toBe('film.mp4 is over 50 MB.');
    chat.element.addFiles([new File(['x'], 'setup.exe', { type: 'application/x-msdownload' })]);
    expect($(chat, '.foot .error')?.textContent).toBe('setup.exe could not be sent.');
    chat.element.addFiles(Array.from({ length: 11 }, (_, i) => pdf(`f${i}.pdf`)));
    expect($(chat, '.foot .error')?.textContent).toBe('Up to 10 files at a time.');
    expect($$(chat, '.upload')).toHaveLength(10);
    expect(
      server.uploads.every((u) => u.filename !== 'film.mp4' && u.filename !== 'setup.exe'),
    ).toBe(true);
  });

  it('holds the send while a file is still going up', async () => {
    const server = fakeChat();
    let release!: () => void;
    const original = server.client.config.uploader!;
    (server.client.config as { uploader: typeof original }).uploader = (request) =>
      new Promise((resolve) => {
        release = () => void original(request).then(resolve);
      });
    const chat = mount({ client: server.client });
    await opened(chat);
    chat.element.addFiles([pdf()]);
    type(chat, 'with a file');
    await until(() => release, 'the upload to start');
    expect($<HTMLButtonElement>(chat, '.send')?.disabled).toBe(true);
    submit(chat);
    await tick(20);
    expect(server.messages).toHaveLength(0);
    release();
    await until(() => !$<HTMLButtonElement>(chat, '.send')?.disabled, 'the upload to finish');
  });

  it('downloads a file with its original name', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('فاتورة.pdf');
      expect(this.href).toMatch(/^blob:/);
    });
    const message = said('OPERATOR', 'Here', {
      attachments: [
        {
          id: 'f1',
          kind: 'FILE',
          mimeType: 'application/pdf',
          filename: 'فاتورة.pdf',
          bytes: 220_000,
        },
      ],
    });
    const chat = mount({ client: fakeChat({ messages: [message] }).client });
    await opened(chat);
    $(chat, '.card')!.click();
    await until(() => click.mock.calls.length, 'the download');
  });

  it('opens a photo full screen, and closes it on Escape', async () => {
    const chat = mount({ client: await createChatFixture({ still: true }), language: 'en' });
    const photo = await until(() => $(chat, '.photo img[src]') && $(chat, '.photo'), 'the photo');
    photo.click();
    const viewer = await until(() => $(chat, '.viewer'), 'the viewer');
    expect(viewer.getAttribute('role')).toBe('dialog');
    viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect($(chat, '.viewer')).toBeNull();
  });
});

describe('what the socket says', () => {
  it('posts read once for a team reply on screen', async () => {
    const server = fakeChat({ messages: [said('OPERATOR', 'Hello Layla', { id: 'op1' })] });
    const chat = mount({ client: server.client });
    await opened(chat);
    await until(() => server.requests.some((r) => r.path.endsWith('/read')), 'the read');
    chat.update({ language: 'ar' });
    await tick(30);
    expect(server.requests.filter((r) => r.path.endsWith('/read'))).toHaveLength(1);
  });

  it('replaces an updated message in place', async () => {
    const original = said('OPERATOR', 'We open at 9', { id: 'op1' });
    const server = fakeChat({ messages: [original] });
    const chat = mount({ client: server.client });
    await opened(chat);
    await until(() => server.client.state.status === 'live', 'the socket');
    server.push({
      type: 'chat.message.updated',
      payload: { message: { ...original, body: 'We open at 10' } },
    });
    await until(() => texts(chat, '.msg .line').includes('We open at 10'), 'the edit');
    expect(texts(chat, '.msg .line')).toEqual(['We open at 10']);
  });

  it('says Seen under the visitor’s last words once the team has read them', async () => {
    const mine = said('CALLER', 'Any news?', { id: 'c1', createdAt: '2026-11-09T09:00:00.000Z' });
    const server = fakeChat({ messages: [mine] });
    const chat = mount({ client: server.client, language: 'en' });
    await opened(chat);
    await until(() => server.client.state.status === 'live', 'the socket');
    server.push({ type: 'chat.read', payload: { at: '2026-11-09T09:01:00.000Z' } });
    await until(() => $(chat, '.byline')?.textContent?.includes('Seen'), 'Seen');
  });

  it('shows the team typing, and says it is reconnecting while the socket is down', async () => {
    const server = fakeChat();
    const chat = mount({ client: server.client, language: 'en' });
    await opened(chat);
    await until(() => server.client.state.status === 'live', 'the socket');
    server.push({ type: 'chat.typing' });
    await until(() => $(chat, '.typing'), 'the typing dots');
    expect($(chat, '.banner')?.classList.contains('hidden')).toBe(true);
    // As the client sees a socket drop.
    (server.client as unknown as { patch(next: object): void }).patch({ status: 'offline' });
    await until(() => !$(chat, '.banner')?.classList.contains('hidden'), 'the banner');
    expect($(chat, '.banner')?.textContent).toBe('Connecting…');
  });
});

describe('the end of a conversation', () => {
  it('confirms, ends, asks how it went, takes a comment, and starts again', async () => {
    const events: CnctChatEvent[] = [];
    const server = fakeChat();
    const chat = mount({
      client: server.client,
      language: 'en',
      onEvent: (event) => events.push(event),
    });
    await opened(chat);
    $(chat, '.ghost')!.click();
    expect($(chat, '.confirm span')?.textContent).toBe(
      'End this chat? You can always start a new one.',
    );
    $(chat, '.confirm .primary')!.click();
    await until(() => $(chat, '.ended'), 'the end');
    expect($(chat, '.ended')?.textContent).toBe('This conversation has ended');
    expect($(chat, '.status')?.textContent).toBe('Conversation ended today');
    await until(
      () => $$(chat, '.rate').length === 5 && !$<HTMLButtonElement>(chat, '.rate')?.disabled,
      'the faces',
    );
    expect($$(chat, '.rate').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Terrible',
      'Bad',
      'OK',
      'Good',
      'Great',
    ]);

    $$(chat, '.rate')[3]!.click();
    const box = await until(
      () => $<HTMLTextAreaElement>(chat, '.panel textarea'),
      'the comment box',
    );
    expect(server.requests.find((r) => r.path.endsWith('/rating'))?.body).toEqual({ score: 4 });
    box.value = 'Quick, thanks';
    box.dispatchEvent(new Event('input'));
    $<HTMLFormElement>(chat, '.panel form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await until(
      () => server.requests.filter((r) => r.path.endsWith('/rating')).length === 2,
      'the comment',
    );
    expect(server.requests.filter((r) => r.path.endsWith('/rating'))[1]?.body).toEqual({
      score: 4,
      comment: 'Quick, thanks',
    });
    await until(
      () => $(chat, '.panel strong')?.textContent === 'Thank you — that goes straight to the team.',
      'thanks',
    );

    const again = $(chat, '.closed .primary')!;
    expect(again.textContent).toBe('Start a new conversation');
    again.click();
    await until(() => $(chat, '.system'), 'the greeting');
    type(chat, 'Me again');
    submit(chat);
    await until(
      () => server.conversation.id === 'conv_2' && server.messages.length === 1,
      'a new conversation',
    );
    expect(events.map((e) => e.type)).toEqual([
      'opened',
      'ended',
      'rated',
      'rated',
      'started',
      'sent',
    ]);
  });

  it('asks an anonymous visitor who has spoken for a name, and thanks them', async () => {
    const server = fakeChat({
      visitor: { anonymous: true },
      messages: [said('CALLER', 'Hi', { id: 'c1' })],
    });
    const chat = mount({ client: server.client, language: 'en' });
    const name = await until(() => $<HTMLInputElement>(chat, '.panel input'), 'the name card');
    expect($(chat, '.panel strong')?.textContent).toBe('Who are we talking to?');
    name.value = 'Layla';
    name.dispatchEvent(new Event('input'));
    $<HTMLFormElement>(chat, '.panel')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => $(chat, '.thanks'), 'the thanks');
    expect($(chat, '.thanks')?.textContent).toBe('Thanks, Layla — the team will see your name.');
    expect(server.requests.find((r) => r.path === '/api/chat/public/profile')?.body).toEqual({
      displayName: 'Layla',
    });
  });
});

describe('the words', () => {
  it('takes the app’s own wording over the table’s', async () => {
    const chat = mount({
      client: fakeChat().client,
      language: 'en',
      strings: { en: { writeMessage: 'Ask us anything…' }, ar: { writeMessage: 'اسألنا…' } },
    });
    await opened(chat);
    expect($<HTMLTextAreaElement>(chat, 'textarea')?.placeholder).toBe('Ask us anything…');
    chat.update({ language: 'ar' });
    expect($<HTMLTextAreaElement>(chat, 'textarea')?.placeholder).toBe('اسألنا…');
  });
});

describe('the element', () => {
  it('takes options set before it was defined', async () => {
    const server = fakeChat();
    const element = document.createElement('cnct-chat-early') as HTMLElement & { options: unknown };
    element.options = { client: server.client };
    host.append(element);
    defineCnctChat('cnct-chat-early');
    await until(
      () =>
        element.shadowRoot?.querySelector('.foot') &&
        !element.shadowRoot.querySelector('.chat.hidden'),
      'the chat',
    );
    element.remove();
  });

  it('goes quietly: a client it made is disconnected, one it was handed is left alone', async () => {
    const server = fakeChat();
    const disconnect = vi.spyOn(server.client, 'disconnect');
    const chat = mountChat(host, { client: server.client });
    await opened(chat);
    chat.destroy();
    await tick(5);
    expect(host.querySelector('cnct-chat')).toBeNull();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('dispatches each analytics event on the element too', async () => {
    const seen: string[] = [];
    const chat = mount({ client: fakeChat().client });
    chat.element.addEventListener('cnct-event', (event) =>
      seen.push((event as CustomEvent<CnctChatEvent>).detail.type),
    );
    await until(() => seen.includes('opened'), 'opened');
  });
});
