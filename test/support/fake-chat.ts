import { CnctChatClient, memoryTokenStore, mergeWidget } from '../../src/index.js';
import type { CnctChatMessage, CnctUploader } from '../../src/index.js';

/**
 * A CNCT in memory, for the interface's tests: the real headless client over a scripted `fetch`, a
 * socket the test can push frames down, and an uploader that records what it was given.
 *
 * The HTTP-and-socket mock in `server.ts` is the right test of the client. For the interface, which
 * renders whatever the client holds, a fake the test can steer synchronously is the better tool.
 */
export interface FakeChat {
  client: CnctChatClient;
  requests: {
    method: string;
    path: string;
    body: Record<string, unknown> | null;
    token: string | null;
  }[];
  uploads: { filename: string; type: string; size: number }[];
  push(frame: unknown): void;
  /** Answer the next request to `METHOD /path` with this, once. */
  stub(key: string, status: number, body: unknown): void;
  messages: CnctChatMessage[];
  conversation: Record<string, unknown>;
}

export interface FakeChatOptions {
  inbox?: Record<string, unknown>;
  widget?: Record<string, unknown>;
  /** A stored token, so the client resumes a conversation. Default true. */
  stored?: boolean;
  messages?: CnctChatMessage[];
  conversation?: Record<string, unknown>;
  visitor?: Record<string, unknown>;
}

export function fakeChat(options: FakeChatOptions = {}): FakeChat {
  const requests: FakeChat['requests'] = [];
  const uploads: FakeChat['uploads'] = [];
  const stubs = new Map<string, { status: number; body: unknown }>();
  const sockets = new Set<FakeSocket>();
  const state = {
    messages: [...(options.messages ?? [])],
    conversation: {
      id: 'conv_1',
      status: 'OPEN',
      startedAt: '2026-11-09T09:00:00.000Z',
      withPerson: false,
      ...(options.conversation ?? {}),
    } as Record<string, unknown>,
    visitor: { displayName: 'Layla', anonymous: false, ...(options.visitor ?? {}) },
    token: options.stored === false ? null : 'tok',
  };

  const fetch = async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const headers = (init.headers ?? {}) as Record<string, string>;
    requests.push({ method, path: pathname, body, token: headers['x-chat-token'] ?? null });
    const reply = (status: number, value: unknown) =>
      new Response(status === 204 ? null : JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const stubbed = stubs.get(`${method} ${pathname}`);
    if (stubbed) {
      stubs.delete(`${method} ${pathname}`);
      return reply(stubbed.status, stubbed.body);
    }
    if (method === 'GET' && pathname === '/api/chat/public/k') {
      return reply(200, {
        business: 'Harbour Café',
        inbox: 'Website',
        isActive: true,
        greeting: 'Hello. How can we help?',
        requirePhone: false,
        widget: mergeWidget({
          chat: { start: 'message', allowAttachments: true, allowEndConversation: true },
          ...(options.widget ?? {}),
        }),
        team: [],
        availability: { open: true, opensAt: null, assistant: false, replyMinutes: 3 },
        ...(options.inbox ?? {}),
      });
    }
    if (method === 'GET' && pathname === '/api/chat/public/session') {
      if (!state.token) return reply(401, { error: 'Unauthenticated' });
      return reply(200, {
        visitor: state.visitor,
        conversation: state.conversation,
        messages: state.messages,
      });
    }
    if (method === 'POST' && pathname === '/api/chat/public/k/session') {
      state.token = 'tok';
      state.visitor = {
        ...state.visitor,
        ...(body?.displayName ? { displayName: String(body.displayName), anonymous: false } : {}),
      };
      if (state.conversation.status === 'CLOSED') {
        state.conversation = {
          ...state.conversation,
          id: 'conv_2',
          status: 'OPEN',
          closedAt: null,
          ratable: false,
          rating: null,
        };
        state.messages = [];
      }
      return reply(200, {
        token: 'tok',
        visitor: state.visitor,
        conversation: state.conversation,
        messages: state.messages,
      });
    }
    if (method === 'POST' && pathname === '/api/chat/public/k/identify') {
      state.token = 'signed';
      return reply(200, {
        token: 'signed',
        visitor: { displayName: 'Layla', anonymous: false, identified: true },
      });
    }
    if (method === 'POST' && pathname === '/api/chat/public/messages') {
      const message: CnctChatMessage = {
        id: `m${state.messages.length + 1}`,
        speaker: 'CALLER',
        sender: null,
        type: 'TEXT',
        body: String(body?.body ?? ''),
        createdAt: new Date().toISOString(),
        clientKey: (body?.clientKey as string) ?? null,
        ...(Array.isArray(body?.attachmentIds) && body.attachmentIds.length
          ? {
              attachments: (body.attachmentIds as string[]).map((id) => ({
                id,
                kind: 'FILE',
                mimeType: 'application/pdf',
                filename: `${id}.pdf`,
                bytes: 10,
              })),
            }
          : {}),
      };
      state.messages.push(message);
      return reply(200, message);
    }
    if (method === 'POST' && pathname === '/api/chat/public/close') {
      state.conversation = { ...state.conversation, status: 'CLOSED', ratable: true };
      return reply(200, { ok: true });
    }
    const one = /^\/api\/chat\/public\/conversations\/([^/]+)(\/read|\/rating)?$/.exec(pathname);
    if (one) {
      if (one[2] === '/read') return reply(204, null);
      if (one[2] === '/rating') {
        state.conversation = {
          ...state.conversation,
          rating: {
            score: body?.score,
            comment: body?.comment ?? null,
            ratedAt: new Date().toISOString(),
          },
        };
        return reply(200, { conversation: state.conversation });
      }
      return reply(200, { conversation: state.conversation, messages: state.messages });
    }
    if (method === 'POST' && pathname === '/api/chat/public/profile') {
      state.visitor = { displayName: String(body?.displayName), anonymous: false };
      return reply(200, { visitor: state.visitor });
    }
    if (method === 'GET' && pathname.startsWith('/api/chat/public/attachments/')) {
      return new Response(new Blob(['%PDF'], { type: 'application/pdf' }), { status: 200 });
    }
    return reply(404, { error: 'Not found' });
  };

  const uploader: CnctUploader = async (request) => {
    uploads.push({ filename: request.filename, type: request.file.type, size: request.file.size });
    request.onProgress?.(0.5);
    request.onProgress?.(1);
    return {
      status: 201,
      body: {
        attachment: {
          id: `att_${uploads.length}`,
          kind: request.file.type.startsWith('image/') ? 'IMAGE' : 'FILE',
          mimeType: request.file.type,
          filename: request.filename,
          bytes: request.file.size,
        },
      },
    };
  };

  const store = memoryTokenStore();
  if (state.token) void store.write('cnct_chat_k', state.token);
  const client = new CnctChatClient({
    config: {
      baseUrl: 'https://cnct.test',
      fetch,
      uploader,
      WebSocket: () => {
        const socket = new FakeSocket();
        sockets.add(socket);
        return socket as unknown as WebSocket;
      },
    },
    credentials: 'k',
    tokenStore: store,
    imageTranscoder: null,
  });

  return {
    client,
    requests,
    uploads,
    push: (frame) => sockets.forEach((socket) => socket.deliver(frame)),
    stub: (key, status, body) => void stubs.set(key, { status, body }),
    get messages() {
      return state.messages;
    },
    get conversation() {
      return state.conversation;
    },
  };
}

class FakeSocket {
  readyState = 0;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  constructor() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.fire('open', {});
    });
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  send(raw: string) {
    const frame = JSON.parse(raw) as { type: string };
    if (frame.type === 'auth') this.deliver({ type: 'authenticated', accepts: ['ping', 'typing'] });
  }
  close() {
    this.readyState = 3;
  }
  deliver(frame: unknown) {
    if (this.readyState === 1) this.fire('message', { data: JSON.stringify(frame) });
  }
  private fire(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** A message, as the server sends one. */
export function said(
  speaker: CnctChatMessage['speaker'],
  body: string,
  extra: Partial<CnctChatMessage> = {},
): CnctChatMessage {
  return {
    id: extra.id ?? `${speaker.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`,
    speaker,
    sender:
      speaker === 'OPERATOR'
        ? { kind: 'person', name: 'Sara Ahmed', avatar: null }
        : speaker === 'AI'
          ? { kind: 'ai', name: 'Assistant' }
          : null,
    type: 'TEXT',
    body,
    createdAt: extra.createdAt ?? new Date().toISOString(),
    clientKey: null,
    ...extra,
  };
}
