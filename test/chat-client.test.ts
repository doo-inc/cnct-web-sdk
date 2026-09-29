import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  Cnct,
  CnctChatClient,
  CnctError,
  createChatClient,
  memoryTokenStore,
} from '../src/index.js';
import { startMockCnct, type MockCnct } from './support/server.js';

let cnct: MockCnct;

beforeEach(async () => {
  cnct = await startMockCnct();
});

afterEach(async () => {
  await cnct.close();
});

/**
 * Node only grew a global `WebSocket` in 22, so the suite supplies one — which is not a workaround
 * but the documented arrangement for 18 and 20, exercised here on every run rather than in a single
 * test that would pass on a laptop and prove nothing about the version half of CI is on.
 */
const socketFactory = (url: string) => new WebSocket(url) as unknown as globalThis.WebSocket;

const sdkFor = (server: MockCnct) =>
  new Cnct({ baseUrl: server.baseUrl, WebSocket: socketFactory });

const clientFor = (server: MockCnct, options: { storageKey?: string } = {}) =>
  sdkFor(server).chat('inbox-public-key', {
    tokenStore: memoryTokenStore(),
    ...options,
  });

const once = (
  chat: CnctChatClient,
  event: 'connected' | 'message' | 'closed' | 'unauthenticated',
) =>
  new Promise<void>((resolve) => {
    const off = chat.on(event, () => {
      off();
      resolve();
    });
  });

describe('the front door', () => {
  it('reads the inbox without a session', async () => {
    const chat = clientFor(cnct);
    const inbox = await chat.boot();
    expect(inbox.business).toBe('Qimam Elevators');
    expect(inbox.isActive).toBe(true);
    expect(chat.state.inbox).toEqual(inbox);
    expect(chat.hasSession).toBe(false);
    chat.disconnect();
  });

  it('sends no credential on the way in', async () => {
    const chat = clientFor(cnct);
    await chat.boot();
    expect(cnct.requests[0]?.headers['x-chat-token']).toBeUndefined();
    expect(cnct.requests[0]?.headers.authorization).toBeUndefined();
    chat.disconnect();
  });
});

describe('a conversation', () => {
  it('starts, connects, and lands in live', async () => {
    const chat = clientFor(cnct);
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;
    expect(chat.state.status).toBe('live');
    expect(chat.state.visitor?.displayName).toBe('Layla');
    expect(chat.hasSession).toBe(true);
    chat.disconnect();
  });

  it('carries the session token on x-chat-token and never on authorization', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    await chat.send('Hello');
    const sent = cnct.requests.filter((r) => r.path === '/api/chat/public/messages');
    expect(sent[0]?.headers['x-chat-token']).toBe('visitor-token-abc');
    expect(sent[0]?.headers.authorization).toBeUndefined();
    chat.disconnect();
  });

  it('draws the bubble before the server has it, then replaces it in place', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });

    const pending = chat.send('Do you open on Fridays?');
    expect(chat.state.messages).toHaveLength(1);
    expect(chat.state.messages[0]?.pending).toBe(true);
    expect(chat.state.messages[0]?.id).toMatch(/^pending_/);

    const stored = await pending;
    expect(chat.state.messages).toHaveLength(1);
    expect(chat.state.messages[0]?.id).toBe(stored.id);
    expect(chat.state.messages[0]?.pending).toBeUndefined();
    chat.disconnect();
  });

  it('refetches the whole transcript on connect rather than splicing a gap it cannot measure', async () => {
    const chat = clientFor(cnct);
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cnct.requests.some((r) => r.path === '/api/chat/public/session')).toBe(true);
    chat.disconnect();
  });

  it('takes a message pushed from the other side', async () => {
    const chat = clientFor(cnct);
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;

    const arrived = once(chat, 'message');
    cnct.push({
      type: 'chat.message',
      payload: {
        message: {
          id: 'msg_op',
          speaker: 'OPERATOR',
          type: 'TEXT',
          body: 'We open at nine.',
          createdAt: new Date().toISOString(),
          clientKey: null,
        },
      },
    });
    await arrived;
    expect(chat.state.messages.at(-1)?.body).toBe('We open at nine.');
    chat.disconnect();
  });

  it('clears the typing indicator itself, because the server sends a start and never a stop', async () => {
    const chat = clientFor(cnct);
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;

    cnct.push({ type: 'chat.typing' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chat.state.theyAreTyping).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 4100));
    expect(chat.state.theyAreTyping).toBe(false);
    chat.disconnect();
  }, 10000);

  it('ends, and says so', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    await chat.end();
    expect(chat.state.status).toBe('ended');
    expect(chat.canSend).toBe(false);
  });
});

describe('a send that fails', () => {
  it('marks the bubble rather than making the words disappear', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    cnct.stub('POST /api/chat/public/messages', {
      status: 429,
      body: { error: 'Slow down.', code: 'rate_limited' },
    });

    await expect(chat.send('Hello')).rejects.toThrow(CnctError);
    expect(chat.state.messages[0]?.failed).toBe(true);
    expect(chat.state.messages[0]?.body).toBe('Hello');
    expect(chat.state.error?.code).toBe('rate_limited');
    chat.disconnect();
  });

  it('retries on the same clientKey, so the server cannot write it twice', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    cnct.stub('POST /api/chat/public/messages', { status: 500, body: { error: 'Broke.' } });
    await expect(chat.send('Hello', { clientKey: 'key-1' })).rejects.toThrow();

    await chat.retry('key-1');
    await chat.retry('key-1');
    expect(chat.state.messages).toHaveLength(1);
    // The stored row replaced the optimistic one, and a stored row carries no `failed` at all.
    expect(chat.state.messages[0]?.failed).toBeFalsy();
    chat.disconnect();
  });

  it('refuses an empty body before it reaches the wire', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    await expect(chat.send('   ')).rejects.toMatchObject({ code: 'empty' });
    chat.disconnect();
  });

  it('refuses to send at all without a session', async () => {
    const chat = clientFor(cnct);
    await expect(chat.send('Hello')).rejects.toMatchObject({ code: 'no_session' });
    chat.disconnect();
  });
});

describe('the transport it happens to be using', () => {
  it('sends over the socket when the handshake offers it', async () => {
    const chat = clientFor(cnct);
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;

    await chat.send('Over the socket');
    expect(cnct.requests.filter((r) => r.path === '/api/chat/public/messages')).toHaveLength(0);
    chat.disconnect();
  });

  it('falls back to HTTP against a server whose handshake does not offer sends', async () => {
    cnct.accepts = ['ping', 'typing'];
    const chat = clientFor(cnct);
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;

    const stored = await chat.send('Over HTTP');
    expect(stored.body).toBe('Over HTTP');
    expect(cnct.requests.filter((r) => r.path === '/api/chat/public/messages')).toHaveLength(1);
    chat.disconnect();
  });
});

describe('a session that stops working', () => {
  it('forgets the token and says so, rather than looping against a credential that will never work', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    expect(chat.hasSession).toBe(true);

    cnct.acceptToken = false;
    const gone = once(chat, 'unauthenticated');
    chat.disconnect();
    chat.connect();
    await gone;

    expect(chat.hasSession).toBe(false);
    expect(chat.state.status).toBe('idle');
    chat.disconnect();
  });

  it('resolves resume() to null rather than throwing when the stored token is stale', async () => {
    const store = memoryTokenStore();
    await store.write('cnct_chat_inbox-public-key', 'a-stale-token');
    const chat = new Cnct({ baseUrl: cnct.baseUrl }).chat('inbox-public-key', {
      tokenStore: store,
    });
    await expect(chat.resume()).resolves.toBeNull();
    expect(chat.hasSession).toBe(false);
    chat.disconnect();
  });

  it('resolves resume() to null when there was never a session at all', async () => {
    const chat = clientFor(cnct);
    await expect(chat.resume()).resolves.toBeNull();
    chat.disconnect();
  });
});

describe('keeping the visitor', () => {
  it('comes back to the same thread through a store that outlives the client', async () => {
    const store = memoryTokenStore();
    const first = sdkFor(cnct).chat('inbox-public-key', { tokenStore: store });
    await first.start({ displayName: 'Layla' });
    await first.send('Before the reload');
    first.disconnect();

    const second = sdkFor(cnct).chat('inbox-public-key', { tokenStore: store });
    expect(second.hasSession).toBe(true);
    const resumed = await second.resume();
    expect(resumed?.messages?.[0]?.body).toBe('Before the reload');
    second.disconnect();
  });

  it('takes an async store without the client having to know it is async', async () => {
    const held = new Map<string, string>();
    const slow = {
      read: async (key: string) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return held.get(key) ?? null;
      },
      write: async (key: string, value: string) => void held.set(key, value),
      clear: async (key: string) => void held.delete(key),
    };
    const chat = sdkFor(cnct).chat('inbox-public-key', { tokenStore: slow });
    await chat.ready;
    await chat.start({ displayName: 'Layla' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(held.get('cnct_chat_inbox-public-key')).toBe('visitor-token-abc');
    chat.disconnect();
  });
});

describe('attachments', () => {
  it('fetches the bytes with the header, because a plain img src cannot', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    const blob = await chat.fetchAttachment('att_1');
    expect(blob.size).toBe(4);
    const asked = cnct.requests.find((r) => r.path.includes('/attachments/'));
    expect(asked?.headers['x-chat-token']).toBe('visitor-token-abc');
    chat.disconnect();
  });

  it('builds the URL under the configured host', async () => {
    const chat = clientFor(cnct);
    expect(chat.attachmentUrl('att_1')).toBe(`${cnct.baseUrl}/api/chat/public/attachments/att_1`);
    chat.disconnect();
  });
});

describe('the compatibility factory', () => {
  it('still takes the options the first version of this SDK took', async () => {
    const chat = createChatClient({
      publicKey: 'inbox-public-key',
      baseUrl: cnct.baseUrl,
      storage: memoryTokenStore(),
      sendTimeoutMs: 5000,
    });
    await chat.boot();
    expect(chat.state.inbox?.inbox).toBe('Website');
    expect(chat.config.sendTimeoutMs).toBe(5000);
    chat.disconnect();
  });

  /**
   * The one thing that differs from the hosted copy: without a host it goes to CNCT production, not
   * to the page's own origin, which in a bundled site is somebody else's domain.
   */
  it('goes to production without a host, never to the page it is running on', () => {
    const chat = createChatClient({ publicKey: 'inbox-public-key' });
    expect(chat.config.baseUrl).toBe('https://app.doo.ooo');
  });
});

describe('tearing down', () => {
  /**
   * **This crashed a Node process, and only a Node one.** `disconnect()` closed whatever socket it
   * held, including one still shaking hands — legal in a browser, which just aborts the handshake,
   * and an `error` event under `ws`, which throws when nothing is listening for one. A server-side
   * integration that started a chat and shut down a moment later took the process with it.
   *
   * Vitest fails a run on an unhandled error, so doing it is the assertion.
   */
  it('survives a disconnect while the handshake is still in flight', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const chat = clientFor(cnct);
      const started = chat.start({ displayName: 'Layla' });
      // No await on the connection: this is the tick where the socket is CONNECTING.
      chat.disconnect();
      await started;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(true).toBe(true);
  });

  it('does not authenticate a socket nobody is reading any more', async () => {
    const chat = clientFor(cnct);
    await chat.start({ displayName: 'Layla' });
    chat.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));
    // The abandoned socket closed itself rather than authenticating and holding a keep-alive open.
    expect(cnct.sockets.length).toBe(0);
    expect(chat.state.status).not.toBe('live');
  });

  /**
   * **The half of this that is not about throwing.** A socket abandoned by `disconnect` closes a few
   * milliseconds later — by which time `connect` may have opened its replacement, and that late
   * close must not stop the replacement's keep-alive, forget it, or announce the client offline
   * while it is live.
   *
   * React's strict mode does exactly this to the documented effect: resume, disconnect, resume,
   * inside a tick or two. A client that reported itself gone there would look like a reconnect loop
   * in development and nowhere else.
   */
  it('lets a replaced socket close late without reporting its successor gone', async () => {
    const chat = clientFor(cnct);
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;

    const seen: string[] = [];
    chat.on('disconnected', () => seen.push('disconnected'));
    chat.on('change', (state) => seen.push(state.status));
    const reconnected = once(chat, 'connected');

    chat.disconnect();
    chat.connect();
    await reconnected;
    // The abandoned socket's close frame comes back behind the replacement's handshake.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(seen).not.toContain('disconnected');
    expect(seen).not.toContain('offline');
    expect(chat.state.status).toBe('live');
    chat.disconnect();
  });

  it('stays quiet when a connection is refused outright', async () => {
    const chat = new Cnct({
      // Nothing is listening here. Under `ws` this is an 'error' event and then a close.
      baseUrl: 'http://127.0.0.1:1',
      WebSocket: socketFactory,
    }).chat('inbox-public-key', { tokenStore: memoryTokenStore() });
    await expect(chat.boot()).rejects.toMatchObject({ code: 'offline' });
    chat.disconnect();
  });
});

describe('which WebSocket it opens', () => {
  /**
   * Node gained a global `WebSocket` in 22. Both paths are real deployments — a browser and Node 22
   * have one, Node 18 and 20 do not — so both are tested rather than whichever one the machine
   * running this happens to be.
   */
  it.skipIf(typeof globalThis.WebSocket === 'undefined')(
    'uses the global where the runtime has one',
    async () => {
      const chat = new Cnct({ baseUrl: cnct.baseUrl }).chat('inbox-public-key', {
        tokenStore: memoryTokenStore(),
      });
      const connected = once(chat, 'connected');
      await chat.start({ displayName: 'Layla' });
      await connected;
      expect(chat.state.status).toBe('live');
      chat.disconnect();
    },
  );

  it('takes one from the config where it does not', async () => {
    const chat = sdkFor(cnct).chat('inbox-public-key', { tokenStore: memoryTokenStore() });
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;
    expect(chat.state.status).toBe('live');
    chat.disconnect();
  });

  it('says which of the two you are missing, rather than failing like a dead network', async () => {
    const globalWebSocket = globalThis.WebSocket;
    // @ts-expect-error — standing in for Node 18 and 20, where this is simply absent.
    delete globalThis.WebSocket;
    try {
      const chat = new Cnct({ baseUrl: cnct.baseUrl }).chat('inbox-public-key', {
        tokenStore: memoryTokenStore(),
      });
      await expect(chat.start({ displayName: 'Layla' })).rejects.toThrow(/has no WebSocket/);
      chat.disconnect();
    } finally {
      if (globalWebSocket) globalThis.WebSocket = globalWebSocket;
    }
  });
});

describe('a CNCT behind a path prefix', () => {
  it('puts every request, and the socket, under it', async () => {
    const proxied = await startMockCnct({ prefix: '/support' });
    const chat = sdkFor(proxied).chat('inbox-public-key', { tokenStore: memoryTokenStore() });
    const connected = once(chat, 'connected');
    await chat.start({ displayName: 'Layla' });
    await connected;
    expect(proxied.requests.every((r) => r.path.startsWith('/support'))).toBe(true);
    expect(chat.state.status).toBe('live');
    chat.disconnect();
    await proxied.close();
  });
});
