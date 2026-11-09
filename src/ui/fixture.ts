/**
 * `cnct-web-sdk/ui/fixture` — the scripted conversation every CNCT platform renders for its tests
 * and its screenshots, through a **fake transport and a fake socket**: no network, no key.
 *
 * It is the real headless client underneath — `boot`, `resume`, `send`, `upload` and the socket all
 * run their own code — with a `fetch`, a `WebSocket` and an `uploader` that answer from a script
 * instead of from CNCT. So what renders is exactly what a visitor would see, not a drawing of it.
 *
 * ```js
 * import { mountChat } from 'cnct-web-sdk/ui';
 * import { createChatFixture } from 'cnct-web-sdk/ui/fixture';
 *
 * mountChat(element, { client: await createChatFixture({ language: 'ar' }), language: 'ar' });
 * ```
 */
import { CnctChatClient } from '../chat/chat-client.js';
import type { CnctUploader } from '../chat/attachments.js';
import type { CnctChatMessage } from '../chat/types.js';
import { memoryTokenStore } from '../token-store.js';
import { FIXTURE_PHOTO_JPEG_BASE64 } from './fixture-photo.js';

export interface CnctChatFixtureOptions {
  /** The language of the conversation's own words. Default `en`. */
  language?: 'en' | 'ar';
  /**
   * Hold the conversation still, as the screenshots need it: the team keeps typing, a picture being
   * uploaded stops at 40% while anything else finishes, and nothing replies. Off by default, where
   * uploads run to the end in about a second and a message sent gets an answer.
   */
  still?: boolean;
  /** When the conversation is happening. Default: now. */
  now?: Date;
  /**
   * Which moment to open on. `conversation` (the default) is the scripted conversation in full;
   * `ended` is the same conversation closed, waiting to be rated; `new` is a visitor who has never
   * chatted, on an inbox that asks for a name (and a number) first.
   */
  state?: 'conversation' | 'ended' | 'new';
}

const WORDS = {
  en: {
    business: 'Harbour Café',
    greeting: 'Hello. How can we help?',
    fridays: 'Do you open on Fridays?',
    hours: 'Yes, from 2pm to 10pm. Would you like to book a visit?',
    book: 'Book a visit',
    person: 'Talk to a person',
    sara: 'Sara',
    invoice: 'Thanks, here is your invoice.',
    call: 'Call me on +973 3311 2233 please',
    card: 'Can I pay by card?',
    demo: 'This is a demonstration: nothing you send here leaves this page.',
  },
  ar: {
    business: 'مقهى المرفأ',
    greeting: 'مرحبًا. كيف يمكننا مساعدتك؟',
    fridays: 'هل تفتحون يوم الجمعة؟',
    hours: 'نعم، من الساعة 2 ظهرًا حتى 10 مساءً. هل تود حجز زيارة؟',
    book: 'احجز زيارة',
    person: 'تحدث مع موظف',
    sara: 'سارة',
    invoice: 'شكرًا، هذه فاتورتك.',
    call: 'اتصلوا بي على +973 3311 2233 من فضلك',
    card: 'هل يمكنني الدفع بالبطاقة؟',
    demo: 'هذه محادثة تجريبية: لا يغادر ما ترسله هذه الصفحة.',
  },
} as const;

/** The fixture's own key and host. `.invalid` is reserved: nothing could ever answer there. */
export const FIXTURE_PUBLIC_KEY = 'fixture';
export const FIXTURE_BASE_URL = 'https://fixture.cnct.invalid';

/** The photo the visitor sent, as bytes. */
export function fixturePhoto(name = 'photo.jpg'): File {
  const binary = atob(FIXTURE_PHOTO_JPEG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type: 'image/jpeg' });
}

/** A one-page PDF, for the invoice and for a picked document. */
export function fixturePdf(name = 'invoice.pdf'): File {
  const pdf =
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
  // Padded to the size of a real one-page document, so its chip reads like one.
  const padding = `%${' '.repeat(98)}\n`.repeat(860);
  return new File([pdf, padding], name, { type: 'application/pdf' });
}

/** The two files the screenshots show in the composer: a photo on its way up, and a PDF that is done. */
export function fixtureFiles(): File[] {
  return [fixturePhoto('harbour.jpg'), fixturePdf('menu.pdf')];
}

/**
 * The conversation in the spec, as the server would answer it:
 *
 * 1. the greeting; 2. the visitor asks about Fridays; 3. the assistant answers, with two flow
 * buttons; 4. the visitor sends a photo; 5. Sara sends an invoice; 6. a line mixing a phone number
 * into the visitor's words — and then, once loaded, 7. a message that fails to send, and 8. the
 * team typing.
 */
export function fixtureTranscript(
  language: 'en' | 'ar' = 'en',
  now = new Date(),
): CnctChatMessage[] {
  const w = WORDS[language];
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const assistant = { kind: 'ai' as const, name: 'Assistant' };
  const sara = { kind: 'person' as const, name: w.sara, avatar: null };
  return [
    {
      id: 'fx-1',
      speaker: 'SYSTEM',
      sender: null,
      type: 'TEXT',
      body: w.greeting,
      createdAt: at(9),
      clientKey: null,
    },
    {
      id: 'fx-2',
      speaker: 'CALLER',
      sender: null,
      type: 'TEXT',
      body: w.fridays,
      createdAt: at(8),
      clientKey: 'fx-k2',
    },
    {
      id: 'fx-3',
      speaker: 'AI',
      sender: assistant,
      type: 'TEXT',
      body: `${w.hours}\n1. ${w.book}\n2. ${w.person}`,
      createdAt: at(8),
      clientKey: null,
      flow: {
        text: w.hours,
        layout: 'buttons',
        choices: [
          { id: 'book', title: w.book },
          { id: 'person', title: w.person },
        ],
      },
    },
    {
      id: 'fx-4',
      speaker: 'CALLER',
      sender: null,
      type: 'TEXT',
      body: '',
      createdAt: at(6),
      clientKey: 'fx-k4',
      attachments: [
        {
          id: 'fx-photo',
          kind: 'IMAGE',
          mimeType: 'image/jpeg',
          filename: 'photo.jpg',
          bytes: 1_200_000,
        },
      ],
    },
    {
      id: 'fx-5',
      speaker: 'OPERATOR',
      sender: sara,
      type: 'TEXT',
      body: w.invoice,
      createdAt: at(4),
      clientKey: null,
      attachments: [
        {
          id: 'fx-invoice',
          kind: 'FILE',
          mimeType: 'application/pdf',
          filename: 'invoice.pdf',
          bytes: 220_000,
        },
      ],
    },
    {
      id: 'fx-6',
      speaker: 'CALLER',
      sender: null,
      type: 'TEXT',
      body: w.call,
      createdAt: at(2),
      clientKey: 'fx-k6',
    },
  ];
}

/**
 * A chat client wired to the fixture, already holding the conversation — including the message that
 * failed — so the interface it is handed renders all of it on its first paint.
 */
export async function createChatFixture(
  options: CnctChatFixtureOptions = {},
): Promise<CnctChatClient> {
  const language = options.language ?? 'en';
  const w = WORDS[language];
  const state = options.state ?? 'conversation';
  const server = new FixtureServer(
    language,
    options.now ?? new Date(),
    Boolean(options.still),
    state,
  );
  const store = memoryTokenStore();
  if (state !== 'new') await store.write(`cnct_chat_${FIXTURE_PUBLIC_KEY}`, 'fixture-token');
  const client = new CnctChatClient({
    config: {
      baseUrl: FIXTURE_BASE_URL,
      fetch: (url, init) => server.fetch(url, init),
      WebSocket: () => server.socket(),
      uploader: server.uploader,
    },
    credentials: FIXTURE_PUBLIC_KEY,
    tokenStore: store,
    imageTranscoder: null,
  });
  server.client = client;
  await client.boot();
  if (state !== 'conversation') return client;
  await client.resume();
  // 7: the message that did not go, with its retry.
  await client.send(w.card, { clientKey: 'fx-card' }).catch(() => {});
  return client;
}

class FixtureServer {
  client: CnctChatClient | null = null;
  private messages: CnctChatMessage[];
  private closed = false;
  private rating: { score: number; comment: string | null; ratedAt: string } | null = null;
  private refuseCard = true;
  private sockets = new Set<FixtureSocket>();
  private readonly files = new Map<string, Blob>();
  private uploads = 0;

  constructor(
    private readonly language: 'en' | 'ar',
    now: Date,
    private readonly still: boolean,
    private readonly state: 'conversation' | 'ended' | 'new',
  ) {
    this.messages = state === 'new' ? [] : fixtureTranscript(language, now);
    this.closed = state === 'ended';
    this.files.set('fx-photo', fixturePhoto());
    this.files.set('fx-invoice', fixturePdf());
  }

  private conversation() {
    return {
      id: 'fx-conversation',
      status: this.closed ? 'CLOSED' : 'OPEN',
      startedAt: this.messages[0]?.createdAt ?? new Date().toISOString(),
      closedAt: this.closed ? new Date().toISOString() : null,
      withPerson: true,
      assignee: null,
      rating: this.rating,
      ratable: this.closed,
      seenAt: null,
    };
  }

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const { pathname } = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const w = WORDS[this.language];
    const json = (status: number, value: unknown) =>
      new Response(status === 204 ? null : JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    await pause(40);

    if (method === 'GET' && pathname === `/api/chat/public/${FIXTURE_PUBLIC_KEY}`) {
      return json(200, {
        business: w.business,
        inbox: 'Website',
        isActive: true,
        greeting: w.greeting,
        requirePhone: this.state === 'new',
        widget: {
          brand: { color: '#b52d93', appearance: 'light', language: 'auto', showBranding: true },
          chat: {
            allowAttachments: true,
            allowEndConversation: true,
            start: this.state === 'new' ? 'details' : 'message',
            askForRating: true,
          },
        },
        team: [{ kind: 'person', name: w.sara, avatar: null }],
        availability: { open: true, opensAt: null, assistant: true, replyMinutes: 4 },
      });
    }
    if (method === 'GET' && pathname === '/api/chat/public/session') {
      return json(200, {
        visitor: { displayName: 'Layla', anonymous: false },
        conversation: this.conversation(),
        messages: this.messages,
      });
    }
    if (method === 'POST' && pathname === `/api/chat/public/${FIXTURE_PUBLIC_KEY}/session`) {
      if (this.closed) {
        this.closed = false;
        this.rating = null;
        this.messages = [];
      }
      // A new conversation opens with the business saying hello, as the server writes it.
      if (!this.messages.length) {
        this.messages = [
          {
            id: `fx-${Date.now()}`,
            speaker: 'SYSTEM',
            sender: null,
            type: 'TEXT',
            body: w.greeting,
            createdAt: new Date().toISOString(),
            clientKey: null,
          },
        ];
      }
      return json(200, {
        token: 'fixture-token',
        visitor: { displayName: String(body.displayName ?? 'Layla'), anonymous: false },
        conversation: this.conversation(),
        messages: this.messages,
      });
    }
    if (method === 'POST' && pathname === '/api/chat/public/messages') {
      // The card question fails once — that is item 7 — and goes through on retry.
      if (body.body === w.card && this.refuseCard) {
        this.refuseCard = false;
        return json(503, { error: 'The fixture refuses this one, so its retry can be seen.' });
      }
      const ids = Array.isArray(body.attachmentIds) ? (body.attachmentIds as string[]) : [];
      const stored: CnctChatMessage = {
        id: `fx-${Date.now()}-${this.messages.length}`,
        speaker: 'CALLER',
        sender: null,
        type: 'TEXT',
        body: String(body.body ?? ''),
        createdAt: new Date().toISOString(),
        clientKey: typeof body.clientKey === 'string' ? body.clientKey : null,
        ...(ids.length ? { attachments: ids.map((id) => this.describe(id)) } : {}),
      };
      this.messages.push(stored);
      this.replyLater();
      return json(200, stored);
    }
    if (method === 'POST' && pathname === '/api/chat/public/close') {
      this.closed = true;
      return json(200, { ok: true });
    }
    const one = /^\/api\/chat\/public\/conversations\/([^/]+)(\/read|\/rating)?$/.exec(pathname);
    if (one) {
      if (one[2] === '/read') return json(204, null);
      if (one[2] === '/rating') {
        this.rating = {
          score: Number(body.score),
          comment: typeof body.comment === 'string' ? body.comment : (this.rating?.comment ?? null),
          ratedAt: new Date().toISOString(),
        };
        return json(200, { conversation: this.conversation() });
      }
      return json(200, { conversation: this.conversation(), messages: this.messages });
    }
    if (method === 'GET' && pathname === '/api/chat/public/conversations') {
      return json(200, {
        conversations: [{ ...this.conversation(), preview: this.messages.at(-1) }],
      });
    }
    if (method === 'POST' && pathname === '/api/chat/public/profile') {
      return json(200, { visitor: { displayName: String(body.displayName), anonymous: false } });
    }
    if (method === 'POST' && pathname.endsWith('/identify')) {
      return json(200, {
        token: 'fixture-token',
        visitor: { displayName: 'Layla', anonymous: false, identified: true },
      });
    }
    const file = /^\/api\/chat\/public\/attachments\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && file) {
      const blob = this.files.get(decodeURIComponent(file[1]!));
      return blob
        ? new Response(blob, { status: 200, headers: { 'content-type': blob.type } })
        : json(404, { error: 'No such file.' });
    }
    return json(404, { error: 'The fixture has no answer for that.' });
  }

  private describe(id: string) {
    const blob = this.files.get(id) as File | undefined;
    return {
      id,
      kind: blob?.type.startsWith('image/') ? 'IMAGE' : 'FILE',
      mimeType: blob?.type ?? 'application/octet-stream',
      filename: blob?.name ?? null,
      bytes: blob?.size ?? null,
    };
  }

  /** A reply, so the fixture answers something sent in the example: typing, then a line. */
  private replyLater(): void {
    if (this.still) return;
    setTimeout(() => this.push({ type: 'chat.typing' }), 400);
    setTimeout(() => {
      const reply: CnctChatMessage = {
        id: `fx-reply-${Date.now()}`,
        speaker: 'OPERATOR',
        sender: { kind: 'person', name: WORDS[this.language].sara, avatar: null },
        type: 'TEXT',
        body: WORDS[this.language].demo,
        createdAt: new Date().toISOString(),
        clientKey: null,
      };
      this.messages.push(reply);
      this.push({ type: 'chat.message', payload: { message: reply } });
    }, 1600);
  }

  readonly uploader: CnctUploader = (request) =>
    new Promise((resolve, reject) => {
      const id = `fx-upload-${(this.uploads += 1)}`;
      const image = request.file.type.startsWith('image/');
      const finish = () => {
        this.files.set(id, new File([request.file], request.filename, { type: request.file.type }));
        request.onProgress?.(1);
        resolve({ status: 201, body: { attachment: this.describe(id) } });
      };
      request.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })),
      );
      request.onProgress?.(0);
      if (this.still) {
        // Item "mid-upload": the photo stops at 40% and stays there; the document is done.
        if (image) return setTimeout(() => request.onProgress?.(0.4), 30);
        return setTimeout(finish, 30);
      }
      let progress = 0;
      const step = () => {
        progress = Math.min(1, progress + 0.2);
        if (progress >= 1) return finish();
        request.onProgress?.(progress);
        setTimeout(step, 180);
      };
      setTimeout(step, 180);
    });

  socket(): WebSocket {
    const socket = new FixtureSocket(this);
    this.sockets.add(socket);
    return socket as unknown as WebSocket;
  }

  drop(socket: FixtureSocket): void {
    this.sockets.delete(socket);
  }

  push(frame: unknown): void {
    for (const socket of this.sockets) socket.deliver(frame);
  }

  /** 8: the team typing, said again before the client's four-second timeout clears it. */
  keepTyping(socket: FixtureSocket): void {
    if (this.closed || !this.still) return;
    socket.deliver({ type: 'chat.typing' });
    socket.timer = setTimeout(() => this.keepTyping(socket), 3000);
  }
}

/** A socket that answers the handshake and then says what the fixture tells it to. */
class FixtureSocket {
  readyState = 0;
  timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(private readonly server: FixtureServer) {
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.fire('open', {});
    }, 10);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as { type?: string };
    if (frame.type === 'auth') {
      // No `send` among what it accepts, so messages take the POST path the fixture scripts.
      this.deliver({ type: 'authenticated', accepts: ['ping', 'typing'] });
      this.server.keepTyping(this);
    }
    if (frame.type === 'ping') this.deliver({ type: 'pong' });
  }

  close(code = 1000): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    if (this.timer) clearTimeout(this.timer);
    this.server.drop(this);
    setTimeout(() => this.fire('close', { code }), 0);
  }

  deliver(frame: unknown): void {
    if (this.readyState !== 1) return;
    setTimeout(() => this.fire('message', { data: JSON.stringify(frame) }), 0);
  }

  private fire(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
