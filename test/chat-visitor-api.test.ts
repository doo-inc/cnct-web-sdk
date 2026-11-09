import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  CNCT_WIDGET_DEFAULTS,
  Cnct,
  CnctAttachmentLimits,
  CnctChatClient,
  attachmentMimeType,
  attachmentProblem,
  memoryTokenStore,
  prepareAttachment,
  xhrUploader,
  type CnctImageTranscoder,
} from '../src/index.js';
import { SIGNED_IN_TOKEN, signUser, startMockCnct, type MockCnct } from './support/server.js';

/**
 * Everything 1.0 adds to the visitor's side of chat — the calls the hosted chat page already makes,
 * now in the SDK. Held against the same mock CNCT as the rest: a real multipart body parsed by the
 * platform's own rules, a real HMAC, real status codes.
 */

let cnct: MockCnct;

beforeEach(async () => {
  cnct = await startMockCnct();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await cnct.close();
});

const socketFactory = (url: string) => new WebSocket(url) as unknown as globalThis.WebSocket;

const clientFor = (
  server: MockCnct,
  options: { imageTranscoder?: CnctImageTranscoder | null; socket?: boolean } = {},
) =>
  new Cnct({
    baseUrl: server.baseUrl,
    ...(options.socket === false
      ? {
          WebSocket: () =>
            ({ addEventListener() {}, readyState: 3 }) as unknown as globalThis.WebSocket,
        }
      : { WebSocket: socketFactory }),
  }).chat('inbox-public-key', {
    tokenStore: memoryTokenStore(),
    imageTranscoder: options.imageTranscoder === undefined ? null : options.imageTranscoder,
  });

const connectedClient = async (server: MockCnct, options = {}) => {
  const chat = clientFor(server, options);
  const connected = new Promise<void>((resolve) => {
    const off = chat.on('connected', () => {
      off();
      resolve();
    });
  });
  await chat.start({ displayName: 'Layla' });
  await connected;
  // The handshake starts a transcript refetch; let it land before the test pushes anything.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return chat;
};

const file = (bytes: number, name: string, type: string) =>
  new File([new Uint8Array(bytes).fill(7)], name, { type });

const pushed = (
  chat: CnctChatClient,
  event: 'message' | 'messageUpdated' | 'read' | 'conversation',
) =>
  new Promise<void>((resolve) => {
    const off = chat.on(event, () => {
      off();
      resolve();
    });
  });

describe('the inbox', () => {
  it('carries widget, team and availability, the widget merged section by section over the defaults', async () => {
    const chat = clientFor(cnct);
    const inbox = await chat.boot();

    expect(inbox.widget.brand.color).toBe('#123456');
    expect(inbox.widget.brand.language).toBe('ar');
    // What the server did not send is the default, never undefined.
    expect(inbox.widget.brand.showBranding).toBe(CNCT_WIDGET_DEFAULTS.brand.showBranding);
    expect(inbox.widget.brand.appearance).toBe('light');
    expect(inbox.widget.chat.start).toBe('message');
    expect(inbox.widget.chat.allowAttachments).toBe(true);
    expect(inbox.widget.chat.askForRating).toBe(true);

    // An allowlist, not a pass-through: a field the model does not name is not published.
    expect(inbox.team).toEqual([{ kind: 'person', name: 'Sara', avatar: 'fox-clay' }]);
    expect(inbox.availability).toEqual({
      open: false,
      opensAt: '2026-09-20T05:00:00.000Z',
      assistant: true,
      replyMinutes: null,
    });
    chat.disconnect();
  });

  it('is whole even from a server that sends none of it', async () => {
    cnct.inbox = {};
    const chat = clientFor(cnct);
    const inbox = await chat.boot();
    expect(inbox.widget).toEqual(CNCT_WIDGET_DEFAULTS);
    expect(inbox.team).toEqual([]);
    expect(inbox.availability).toBeNull();
    chat.disconnect();
  });

  it('drops a widget value of the wrong type for the default rather than passing it on', async () => {
    cnct.inbox = { widget: { brand: { color: 7, appearance: 'dark' }, chat: 'nonsense' } };
    const chat = clientFor(cnct);
    const inbox = await chat.boot();
    expect(inbox.widget.brand.color).toBe(CNCT_WIDGET_DEFAULTS.brand.color);
    expect(inbox.widget.brand.appearance).toBe('dark');
    expect(inbox.widget.chat).toEqual(CNCT_WIDGET_DEFAULTS.chat);
    chat.disconnect();
  });
});

describe('the session', () => {
  it("sends the device's time zone when it starts, and when it resumes", async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    const started = cnct.requests.find((r) => r.path.endsWith('/session') && r.method === 'POST');
    expect((started?.body as { timezone?: string }).timezone).toBe(zone);

    await chat.resume();
    const resumed = cnct.requests.find((r) => r.method === 'GET' && r.path.includes('/session?'));
    expect(new URL(resumed!.path, 'http://x').searchParams.get('timezone')).toBe(zone);
    chat.disconnect();
  });

  it('takes a time zone it is given over the device one', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla', timezone: 'Asia/Bahrain' });
    const started = cnct.requests.find((r) => r.path.endsWith('/session') && r.method === 'POST');
    expect((started?.body as { timezone?: string }).timezone).toBe('Asia/Bahrain');
    chat.disconnect();
  });

  it('starts once when a message and a file both need a conversation in the same moment', async () => {
    const chat = clientFor(cnct);
    await Promise.all([chat.ensureSession(), chat.ensureSession(), chat.ensureSession()]);
    expect(
      cnct.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/session')),
    ).toHaveLength(1);
    await chat.ensureSession();
    expect(
      cnct.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/session')),
    ).toHaveLength(1);
    chat.disconnect();
  });

  it('starts a new conversation after one ended, without the old transcript above it', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    await chat.send('The first conversation');
    expect(chat.state.conversation?.id).toBe('conv_1');
    await chat.end();
    expect(chat.state.status).toBe('ended');

    await chat.ensureSession();
    expect(chat.state.conversation?.id).toBe('conv_2');
    expect(chat.state.messages).toEqual([]);
    expect(chat.canSend).toBe(true);
    chat.disconnect();
  });
});

describe('uploading a file', () => {
  it('sends one multipart part named file, with the token on the header and the name and type intact', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    const attachment = await chat.upload(file(2048, 'invoice.pdf', 'application/pdf'));

    expect(attachment).toEqual({
      id: 'att_1',
      kind: 'FILE',
      mimeType: 'application/pdf',
      filename: 'invoice.pdf',
      bytes: 2048,
    });
    expect(cnct.uploads[0]).toMatchObject({
      field: 'file',
      filename: 'invoice.pdf',
      type: 'application/pdf',
    });
    expect(cnct.uploads[0]?.bytes.length).toBe(2048);
    const asked = cnct.requests.find((r) => r.path === '/api/chat/public/attachments');
    expect(asked?.headers['x-chat-token']).toBe('visitor-token-abc');
    expect(asked?.headers.authorization).toBeUndefined();
    expect(asked?.path).not.toContain('token');
    chat.disconnect();
  });

  it('keeps an Arabic file name as it was written', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    await chat.upload(file(10, 'فاتورة.pdf', 'application/pdf'));
    expect(cnct.uploads[0]?.filename).toBe('فاتورة.pdf');
    chat.disconnect();
  });

  it('reports progress from 0 to 1 as it goes up', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    const seen: number[] = [];
    await chat.upload(file(300 * 1024, 'photo.png', 'image/png'), {
      onProgress: (f) => seen.push(f),
    });

    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    // In between, more than one step, and never backwards.
    expect(seen.filter((f) => f > 0 && f < 1).length).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    chat.disconnect();
  });

  it('refuses before uploading: the eleventh file, one over 50 MB, a type the chat does not take', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });

    expect(chat.checkAttachment(file(1, 'a.png', 'image/png'), 10)?.code).toBe('too_many_files');
    const huge = { size: CnctAttachmentLimits.maxBytes + 1, type: 'video/mp4', name: 'film.mp4' };
    expect(chat.checkAttachment(huge)?.code).toBe('file_too_large');
    expect(chat.checkAttachment(huge)?.message).toBe('film.mp4 is over 50 MB.');
    await expect(
      chat.upload(file(10, 'setup.exe', 'application/x-msdownload')),
    ).rejects.toMatchObject({
      code: 'unsupported_file_type',
    });
    expect(
      chat.checkAttachment({ size: CnctAttachmentLimits.maxBytes, type: 'video/mp4' }),
    ).toBeNull();

    expect(cnct.requests.some((r) => r.path === '/api/chat/public/attachments')).toBe(false);
    chat.disconnect();
  });

  it('needs a conversation first', async () => {
    const chat = clientFor(cnct);
    await expect(chat.upload(file(1, 'a.png', 'image/png'))).rejects.toMatchObject({
      code: 'no_session',
    });
    chat.disconnect();
  });

  it.each([
    [403, 'This inbox does not take files.', 'invalid'],
    [409, 'This conversation has ended.', 'conversation_closed'],
    [413, 'That file is too big.', 'too_large'],
    [422, 'That kind of file is not accepted.', 'invalid'],
    [503, 'This deployment keeps no files.', 'server_error'],
    [401, 'Unauthenticated', 'unauthenticated'],
  ])(
    'maps a %i refusal to a stable code and keeps the sentence',
    async (status, sentence, code) => {
      const chat = clientFor(cnct);
      await chat.start({ displayName: 'Layla' });
      cnct.stub('POST /api/chat/public/attachments', { status, body: { error: sentence } });
      await expect(chat.upload(file(10, 'a.pdf', 'application/pdf'))).rejects.toMatchObject({
        code,
        status,
        message: sentence,
      });
      // A refused file is not a refused session: the token is still held.
      expect(chat.hasSession).toBe(true);
      chat.disconnect();
    },
  );
});

describe('preparing a photo', () => {
  const fakeJpeg = (bytes = 100) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

  it('converts HEIC to JPEG, renaming it, before it goes up', async () => {
    const transcoder = vi.fn<CnctImageTranscoder>(async () => fakeJpeg(321));
    const chat = clientFor(cnct, { imageTranscoder: transcoder });
    await chat.start({ displayName: 'Layla' });
    const attachment = await chat.upload(file(5000, 'IMG_0042.HEIC', 'image/heic'));

    expect(transcoder).toHaveBeenCalledWith(expect.any(Blob), {
      maxSide: 2560,
      quality: 0.85,
      force: true,
    });
    expect(attachment).toMatchObject({
      filename: 'IMG_0042.jpg',
      mimeType: 'image/jpeg',
      bytes: 321,
    });
    expect(cnct.uploads[0]?.type).toBe('image/jpeg');
    chat.disconnect();
  });

  it('knows a HEIC by its name where the picker reported no type', async () => {
    expect(attachmentMimeType({ size: 1, type: '', name: 'photo.heic' })).toBe('image/heic');
    const prepared = await prepareAttachment(new File([new Uint8Array(4)], 'photo.heic'), {
      transcoder: async () => fakeJpeg(),
    });
    expect(prepared.mimeType).toBe('image/jpeg');
    expect(prepared.filename).toBe('photo.jpg');
  });

  it('refuses HEIC in a sentence where nothing here can convert it, and uploads nothing', async () => {
    const chat = clientFor(cnct, { imageTranscoder: null });
    await chat.start({ displayName: 'Layla' });
    expect(chat.checkAttachment({ size: 10, type: 'image/heic', name: 'a.heic' })?.code).toBe(
      'unsupported_file_type',
    );
    await expect(chat.upload(file(10, 'a.heic', 'image/heic'))).rejects.toMatchObject({
      code: 'unsupported_file_type',
    });
    expect(cnct.uploads).toHaveLength(0);
    chat.disconnect();
  });

  it('refuses a HEIC the converter cannot decode rather than sending it', async () => {
    await expect(
      prepareAttachment(file(10, 'a.heic', 'image/heic'), {
        transcoder: async () => {
          throw new Error('cannot decode');
        },
      }),
    ).rejects.toMatchObject({ code: 'unsupported_file_type' });
  });

  it('downscales a large JPEG and sends a small one untouched', async () => {
    const original = file(900, 'big.jpg', 'image/jpeg');
    const smaller = await prepareAttachment(original, { transcoder: async () => fakeJpeg(200) });
    expect(smaller.blob.size).toBe(200);
    expect(smaller.filename).toBe('big.jpg');

    const asked = vi.fn<CnctImageTranscoder>(async () => null);
    const untouched = await prepareAttachment(original, { transcoder: asked });
    expect(asked).toHaveBeenCalledWith(expect.any(Blob), {
      maxSide: 2560,
      quality: 0.85,
      force: false,
    });
    expect(untouched.blob.size).toBe(900);
  });

  it('leaves everything that is not a photo alone — a PNG keeps its transparency, a PDF its bytes', async () => {
    const transcoder = vi.fn<CnctImageTranscoder>(async () => fakeJpeg());
    for (const one of [file(50, 'shot.png', 'image/png'), file(50, 'a.pdf', 'application/pdf')]) {
      const prepared = await prepareAttachment(one, { transcoder });
      expect(prepared.blob.size).toBe(50);
      expect(prepared.mimeType).toBe(one.type);
    }
    expect(transcoder).not.toHaveBeenCalled();
  });

  it('tells the server the right type where a platform mislabels it', () => {
    expect(
      attachmentMimeType({ size: 1, type: 'application/vnd.ms-excel', name: 'rows.csv' }),
    ).toBe('text/csv');
    expect(attachmentMimeType({ size: 1, type: 'audio/x-m4a', name: 'memo.m4a' })).toBe(
      'audio/mp4',
    );
    expect(attachmentMimeType({ size: 1, type: 'image/jpg', name: 'x' })).toBe('image/jpeg');
    expect(
      attachmentProblem({ size: 1, type: 'application/vnd.ms-excel', name: 'rows.csv' }),
    ).toBeNull();
  });
});

describe('the browser upload path', () => {
  /**
   * `XMLHttpRequest` is the one browser request that reports upload progress, so it is what a page
   * uses. There is none in Node, so this stands one in and checks what the uploader asks of it.
   */
  it('posts a FormData with one file part, the token on a header, and forwards progress', async () => {
    const seen: {
      method?: string;
      url?: string;
      headers: Record<string, string>;
      body?: FormData;
    } = {
      headers: {},
    };
    class FakeXhr {
      status = 0;
      responseText = '';
      private listeners: Record<string, (event?: unknown) => void> = {};
      upload = {
        listeners: {} as Record<string, (event: unknown) => void>,
        addEventListener(type: string, listener: (event: unknown) => void) {
          this.listeners[type] = listener;
        },
      };
      open(method: string, url: string) {
        seen.method = method;
        seen.url = url;
      }
      setRequestHeader(name: string, value: string) {
        seen.headers[name] = value;
      }
      addEventListener(type: string, listener: (event?: unknown) => void) {
        this.listeners[type] = listener;
      }
      abort() {}
      send(body: FormData) {
        seen.body = body;
        this.upload.listeners.progress?.({ lengthComputable: true, loaded: 40, total: 100 });
        this.status = 201;
        this.responseText = JSON.stringify({ attachment: { id: 'att_x', kind: 'IMAGE' } });
        this.listeners.load?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const progress: number[] = [];
    const answer = await xhrUploader({
      url: 'https://cnct.example.com/api/chat/public/attachments',
      headers: { 'x-chat-token': 'tok' },
      file: new Blob(['hello'], { type: 'image/png' }),
      filename: 'photo.png',
      onProgress: (f) => progress.push(f),
    });

    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('https://cnct.example.com/api/chat/public/attachments');
    expect(seen.headers).toEqual({ 'x-chat-token': 'tok' });
    const part = seen.body?.get('file') as File;
    expect(part.name).toBe('photo.png');
    expect(part.type).toBe('image/png');
    expect(progress).toEqual([0, 0.4, 1]);
    expect(answer).toEqual({ status: 201, body: { attachment: { id: 'att_x', kind: 'IMAGE' } } });
  });

  it('is what a client in a browser uses by default', async () => {
    let used = false;
    class Stand {
      upload = { addEventListener() {} };
      open() {
        used = true;
      }
      setRequestHeader() {}
      addEventListener(type: string, listener: () => void) {
        if (type === 'load') queueMicrotask(listener);
      }
      send() {}
      status = 201;
      responseText = JSON.stringify({ attachment: { id: 'att_b' } });
    }
    vi.stubGlobal('XMLHttpRequest', Stand);
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    await expect(chat.upload(file(3, 'a.txt', 'text/plain'))).resolves.toMatchObject({
      id: 'att_b',
    });
    expect(used).toBe(true);
    chat.disconnect();
  });
});

describe('sending files and choices', () => {
  it('sends attachmentIds over HTTP, and draws the files on the optimistic bubble at once', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    const attachment = await chat.upload(file(64, 'photo.jpg', 'image/jpeg'));

    const sending = chat.send('', { attachments: [attachment] });
    expect(chat.state.messages[0]).toMatchObject({
      pending: true,
      body: '',
      attachments: [attachment],
    });
    const stored = await sending;

    const posted = cnct.requests.find((r) => r.path === '/api/chat/public/messages');
    expect(posted?.body).toMatchObject({ body: '', attachmentIds: ['att_1'] });
    expect(stored.attachments?.[0]?.id).toBe('att_1');
    expect(chat.state.messages).toHaveLength(1);
    chat.disconnect();
  });

  it('sends attachmentIds and replyId on the socket frame too', async () => {
    const chat = await connectedClient(cnct);
    const attachment = await chat.upload(file(64, 'invoice.pdf', 'application/pdf'));
    const frames: Record<string, unknown>[] = [];
    cnct.sockets[0]?.on('message', (data) => frames.push(JSON.parse(String(data))));

    const stored = await chat.send('Here it is', {
      attachmentIds: [attachment.id],
      replyId: 'choice_9',
    });
    expect(frames.find((f) => f.type === 'send')).toMatchObject({
      body: 'Here it is',
      attachmentIds: ['att_1'],
      replyId: 'choice_9',
    });
    expect(stored.attachments?.[0]?.filename).toBe('invoice.pdf');
    chat.disconnect();
  });

  it('sends a tapped choice as its title, with its id as replyId', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    await chat.choose({ id: 'book', title: 'Book a visit' });
    const posted = cnct.requests.find((r) => r.path === '/api/chat/public/messages');
    expect(posted?.body).toMatchObject({ body: 'Book a visit', replyId: 'book' });
    chat.disconnect();
  });

  it('refuses neither words nor files, too many files, and too many words — before the wire', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    await expect(chat.send('  ', { attachmentIds: [] })).rejects.toMatchObject({ code: 'empty' });
    const eleven = Array.from({ length: 11 }, (_, i) => `att_${i}`);
    await expect(chat.send('hi', { attachmentIds: eleven })).rejects.toMatchObject({
      code: 'too_many_files',
    });
    await expect(chat.send('x'.repeat(4001))).rejects.toMatchObject({ code: 'too_large' });
    expect(cnct.requests.some((r) => r.path === '/api/chat/public/messages')).toBe(false);
    chat.disconnect();
  });

  it('retries a failed message with the same files and the same choice', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    cnct.stub('POST /api/chat/public/messages', { status: 503, body: { error: 'Down.' } });
    await expect(
      chat.send('Book a visit', { clientKey: 'k1', attachmentIds: ['att_7'], replyId: 'book' }),
    ).rejects.toThrow();
    expect(chat.state.messages[0]?.failed).toBe(true);

    await chat.retry('k1');
    const posts = cnct.requests.filter((r) => r.path === '/api/chat/public/messages');
    expect(posts[1]?.body).toEqual({
      body: 'Book a visit',
      clientKey: 'k1',
      attachmentIds: ['att_7'],
      replyId: 'book',
    });
    expect(chat.state.messages[0]?.failed).toBeFalsy();
    chat.disconnect();
  });

  it('calls a 409 on send conversation_closed', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    cnct.stub('POST /api/chat/public/messages', { status: 409, body: { error: 'It ended.' } });
    await expect(chat.send('Hello?')).rejects.toMatchObject({ code: 'conversation_closed' });
    chat.disconnect();
  });
});

describe('signed-in users', () => {
  it('signs in with the current token on the call, then holds the token it is given instead', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });

    const visitor = await chat.identify({
      userId: 'user_42',
      userHash: signUser('user_42'),
      email: 'l@example.com',
    });
    expect(visitor).toEqual({ displayName: 'Layla Signed', anonymous: false, identified: true });
    const asked = cnct.requests.find((r) => r.path.endsWith('/identify'));
    // The anonymous chat started before sign-in moves across because its token goes with the call.
    expect(asked?.headers['x-chat-token']).toBe('visitor-token-abc');
    expect(asked?.body).toEqual({
      userId: 'user_42',
      userHash: signUser('user_42'),
      email: 'l@example.com',
    });

    await chat.send('Signed in now');
    const sent = cnct.requests.find((r) => r.path === '/api/chat/public/messages');
    expect(sent?.headers['x-chat-token']).toBe(SIGNED_IN_TOKEN);
    expect(chat.state.visitor?.identified).toBe(true);
    chat.disconnect();
  });

  it('persists the new token, so a reload comes back signed in', async () => {
    const store = memoryTokenStore();
    const chat = new Cnct({ baseUrl: cnct.baseUrl }).chat('inbox-public-key', {
      tokenStore: store,
    });
    await chat.identify({ userId: 'u', userHash: signUser('u') });
    expect(await store.read('cnct_chat_inbox-public-key')).toBe(SIGNED_IN_TOKEN);
    chat.disconnect();
  });

  it('keeps the anonymous chat working when the hash does not verify', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    await expect(chat.identify({ userId: 'u', userHash: 'not-the-hash' })).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
    });
    expect(chat.hasSession).toBe(true);
    await expect(chat.send('Still here')).resolves.toMatchObject({ body: 'Still here' });
    chat.disconnect();
  });

  it('says identity is not set up on a 409', async () => {
    const chat = clientFor(cnct);
    cnct.stub('POST /api/chat/public/inbox-public-key/identify', {
      status: 409,
      body: { error: 'Identity is not set up for this inbox.' },
    });
    await expect(chat.identify({ userId: 'u', userHash: 'h' })).rejects.toMatchObject({
      code: 'conflict',
    });
    chat.disconnect();
  });

  it('refuses an identity with no hash rather than sending it', async () => {
    const chat = clientFor(cnct);
    await expect(chat.identify({ userId: 'u', userHash: '' })).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(cnct.requests).toHaveLength(0);
    chat.disconnect();
  });
});

describe('conversations', () => {
  it('lists them, and reads one, without moving the live state', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    await chat.send('Hello');

    const list = await chat.listConversations();
    expect(list[0]).toMatchObject({ id: 'conv_1', status: 'OPEN', preview: { body: 'Hello' } });

    const one = await chat.getConversation('conv_1');
    expect(one.conversation.id).toBe('conv_1');
    expect(one.messages.map((m) => m.body)).toEqual(['Hello']);
    expect(cnct.requests.at(-1)?.path).toBe('/api/chat/public/conversations/conv_1');
    chat.disconnect();
  });

  it('lists nothing for a stranger rather than asking', async () => {
    const chat = clientFor(cnct);
    await expect(chat.listConversations()).resolves.toEqual([]);
    expect(cnct.requests).toHaveLength(0);
    chat.disconnect();
  });
});

describe('read', () => {
  const reply = (id: string) => ({
    type: 'chat.message',
    payload: {
      message: {
        id,
        speaker: 'OPERATOR',
        sender: { kind: 'person', name: 'Sara', avatar: null },
        type: 'TEXT',
        body: 'Here you go.',
        createdAt: new Date().toISOString(),
        clientKey: null,
      },
    },
  });
  const readPosts = () => cnct.requests.filter((r) => r.path.endsWith('/read'));

  it('is posted once per reply, and again only for a newer one', async () => {
    const chat = await connectedClient(cnct);
    expect(await chat.read()).toBe(false); // nothing from the team yet

    let arrived = pushed(chat, 'message');
    cnct.push(reply('msg_op_1'));
    await arrived;
    expect(await chat.read()).toBe(true);
    expect(await chat.read()).toBe(false);
    expect(await chat.read()).toBe(false);
    expect(readPosts()).toHaveLength(1);
    expect(readPosts()[0]?.path).toBe('/api/chat/public/conversations/conv_1/read');
    expect(readPosts()[0]?.headers['content-type']).toBeUndefined();

    arrived = pushed(chat, 'message');
    cnct.push(reply('msg_op_2'));
    await arrived;
    expect(await chat.read()).toBe(true);
    expect(readPosts()).toHaveLength(2);
    chat.disconnect();
  });

  it('forgets a report that failed, so the next look tries again', async () => {
    const chat = await connectedClient(cnct);
    const arrived = pushed(chat, 'message');
    cnct.push(reply('msg_op_1'));
    await arrived;
    cnct.stub('POST /api/chat/public/conversations/conv_1/read', { status: 500, body: {} });
    await expect(chat.read()).rejects.toThrow();
    expect(await chat.read()).toBe(true);
    chat.disconnect();
  });
});

describe('a conversation that ends', () => {
  it('is marked closed at once, then learns from the server whether it can be rated', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    await chat.end();
    expect(chat.state.conversation).toMatchObject({ id: 'conv_1', status: 'CLOSED' });
    expect(chat.state.conversation?.closedAt).toEqual(expect.any(String));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chat.state.conversation?.ratable).toBe(true);
    chat.disconnect();
  });

  it('does the same when the business closes it', async () => {
    const chat = await connectedClient(cnct);
    const closed = new Promise<void>((resolve) => chat.on('closed', () => resolve()));
    cnct.push({ type: 'chat.closed' });
    await closed;
    expect(chat.state.status).toBe('ended');
    expect(chat.state.conversation?.status).toBe('CLOSED');
    expect(chat.canSend).toBe(false);
    chat.disconnect();
  });
});

describe('rating and the profile', () => {
  it('rates the conversation and takes the server’s answer into the state', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    const rated = await chat.rate(4, { comment: 'Quick, thank you' });
    const posted = cnct.requests.find((r) => r.path.endsWith('/rating'));
    expect(posted?.path).toBe('/api/chat/public/conversations/conv_1/rating');
    expect(posted?.body).toEqual({ score: 4, comment: 'Quick, thank you' });
    expect(rated.rating).toMatchObject({ score: 4, comment: 'Quick, thank you' });
    expect(chat.state.conversation?.rating?.score).toBe(4);
    chat.disconnect();
  });

  it('refuses a score outside 1 to 5, and calls a 409 conflict', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    await expect(chat.rate(6)).rejects.toMatchObject({ code: 'invalid' });
    await expect(chat.rate(2.5)).rejects.toMatchObject({ code: 'invalid' });
    cnct.stub('POST /api/chat/public/conversations/conv_1/rating', {
      status: 409,
      body: { error: 'This can no longer be rated.' },
    });
    await expect(chat.rate(5)).rejects.toMatchObject({ code: 'conflict' });
    chat.disconnect();
  });

  it('saves a name for an anonymous visitor', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({});
    const visitor = await chat.updateProfile({ displayName: '  Layla  ', phone: '+97333112233' });
    expect(cnct.requests.at(-1)?.body).toEqual({ displayName: 'Layla', phone: '+97333112233' });
    expect(visitor).toEqual({ displayName: 'Layla', anonymous: false });
    expect(chat.state.visitor?.anonymous).toBe(false);
    chat.disconnect();
  });
});

describe('the socket frames 1.0 adds', () => {
  it('replaces an updated message in place, by id, keeping its position', async () => {
    const chat = await connectedClient(cnct);
    await chat.send('One');
    await chat.send('Two');
    const target = chat.state.messages[0]!;

    const updated = pushed(chat, 'messageUpdated');
    cnct.push({
      type: 'chat.message.updated',
      payload: { message: { ...target, body: 'One, edited', attachments: [] } },
    });
    await updated;
    expect(chat.state.messages.map((m) => m.body)).toEqual(['One, edited', 'Two']);
    expect(chat.state.messages[0]?.id).toBe(target.id);
    chat.disconnect();
  });

  it('does not invent a message from an update about one it never had', async () => {
    const chat = await connectedClient(cnct);
    const seen: unknown[] = [];
    chat.on('messageUpdated', (m) => seen.push(m));
    cnct.push({
      type: 'chat.message.updated',
      payload: {
        message: {
          id: 'nope',
          speaker: 'OPERATOR',
          body: 'x',
          type: 'TEXT',
          createdAt: '',
          clientKey: null,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chat.state.messages).toHaveLength(0);
    expect(seen).toHaveLength(0);
    chat.disconnect();
  });

  it('takes chat.read as the moment the team saw the visitor’s messages', async () => {
    const chat = await connectedClient(cnct);
    const read = new Promise<string>((resolve) => chat.on('read', resolve));
    cnct.push({ type: 'chat.read', payload: { at: '2026-09-19T08:05:00.000Z' } });
    expect(await read).toBe('2026-09-19T08:05:00.000Z');
    expect(chat.state.conversation?.seenAt).toBe('2026-09-19T08:05:00.000Z');
    chat.disconnect();
  });

  it('merges a partial conversation update rather than replacing what it knew', async () => {
    const chat = await connectedClient(cnct);
    const changed = pushed(chat, 'conversation');
    cnct.push({
      type: 'chat.conversation.updated',
      payload: { withPerson: true, assignee: { kind: 'person', name: 'Sara', avatar: null } },
    });
    await changed;
    expect(chat.state.conversation).toMatchObject({
      id: 'conv_1',
      status: 'OPEN',
      withPerson: true,
      assignee: { name: 'Sara' },
    });
    chat.disconnect();
  });
});

describe('fetching a file', () => {
  it('fetches each one once, however many times a thread is redrawn', async () => {
    const chat = clientFor(cnct, { socket: false });
    await chat.start({ displayName: 'Layla' });
    const [a, b] = await Promise.all([
      chat.fetchAttachment('att_1'),
      chat.fetchAttachment('att_1'),
    ]);
    await chat.fetchAttachment({
      id: 'att_1',
      kind: 'IMAGE',
      mimeType: 'image/png',
      filename: null,
      bytes: 4,
    });
    expect(a).toBe(b);
    expect(cnct.requests.filter((r) => r.path.includes('/attachments/att_1'))).toHaveLength(1);
    chat.disconnect();
  });
});
