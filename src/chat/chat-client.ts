import { CnctConfig, type CnctConfigInput } from '../config.js';
import { CnctChatPublicKey } from '../credentials.js';
import { CnctError, CnctErrorCode } from '../errors.js';
import { asTokenStore, type CnctTokenStore, type StorageLike } from '../token-store.js';
import type {
  CnctChatAttachment,
  CnctChatConversation,
  CnctChatEventName,
  CnctChatEvents,
  CnctChatInbox,
  CnctChatMessage,
  CnctChatSession,
  CnctChatState,
} from './types.js';

/**
 * Live chat with a CNCT inbox, as a visitor.
 *
 * **It is headless on purpose.** There is no DOM in this file, not one element and not one style
 * rule. A widget that renders is a widget that has opinions about somebody else's site, and the
 * reason a client reaches for this rather than the hosted page at `/chat/<publicKey>` is precisely
 * that they have their own. So this ships state and events, and the interface is theirs.
 *
 * Three properties are load-bearing and a custom interface gets them without having to know:
 *
 * **The socket is the transport, and a reconnect reloads.** Server-side pub/sub replays nothing after
 * a drop — a deliberate property of the fan-out, not an oversight — so this client refetches the
 * whole transcript every time it reconnects rather than stitching a gap it cannot see. A UI that
 * renders `messages` is always rendering the truth, never a hopeful splice.
 *
 * **A send is idempotent.** Every message carries a `clientKey` that is unique per conversation on
 * the server, so a frame replayed across a reconnect returns the row it already wrote instead of
 * writing a second one. Retrying is always safe, which is what lets `send()` reject on a timeout
 * without the caller having to wonder whether it half-happened.
 *
 * **It degrades rather than breaks.** The server announces what it accepts on the handshake. Sends go
 * over the socket where that is offered and fall back to HTTP POST where it is not, so a newer client
 * and an older server still work and neither has to guess about the other.
 */
export class CnctChatClient {
  readonly config: CnctConfig;
  readonly publicKey: string;
  readonly storageKey: string;

  /**
   * Resolves once a stored session token has been loaded.
   *
   * A synchronous store — `localStorage`, the default — is already loaded by the time the constructor
   * returns, so this is only worth awaiting when you passed an async store of your own.
   */
  readonly ready: Promise<void>;

  private _state: CnctChatState = {
    status: 'idle',
    inbox: null,
    conversation: null,
    visitor: null,
    messages: [],
    theyAreTyping: false,
    error: null,
  };

  private readonly store: CnctTokenStore;
  private readonly listeners = new Map<string, Set<(detail: never) => void>>();
  private readonly awaiting = new Map<
    string,
    {
      resolve: (message: CnctChatMessage) => void;
      reject: (error: CnctError) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private token: string | null = null;
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private typingClearTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTypingSentAt = 0;
  private socketSendSupported = false;
  private closedByUs = false;

  constructor(options: CnctChatClientOptions) {
    this.config =
      options.config instanceof CnctConfig ? options.config : new CnctConfig(options.config);
    const credentials =
      options.credentials instanceof CnctChatPublicKey
        ? options.credentials
        : new CnctChatPublicKey(options.credentials);
    this.publicKey = credentials.publicKey;
    this.storageKey = options.storageKey ?? `cnct_chat_${this.publicKey}`;
    this.store = asTokenStore(options.tokenStore ?? options.storage);

    const initial = this.store.read(this.storageKey);
    if (isThenable(initial)) {
      this.ready = initial.then((value) => {
        this.token = value ?? null;
      });
    } else {
      this.token = initial ?? null;
      this.ready = Promise.resolve();
    }
  }

  // ── What a UI reads ────────────────────────────────────────────────────────────────────────────

  /**
   * Everything a UI renders, in one object that is replaced rather than mutated — so a framework
   * comparing references sees a change, and a framework reading fields sees a consistent snapshot.
   */
  get state(): CnctChatState {
    return this._state;
  }

  get hasSession(): boolean {
    return Boolean(this.token);
  }

  /** True when there is a conversation to type into. */
  get canSend(): boolean {
    return (
      this.state.status !== 'idle' &&
      this.state.status !== 'ended' &&
      this.state.conversation?.status !== 'CLOSED'
    );
  }

  /** Subscribe. Returns the unsubscribe. */
  on<E extends CnctChatEventName>(
    event: E,
    handler: (detail: CnctChatEvents[E]) => void,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (detail: never) => void);
    return () => void this.listeners.get(event)?.delete(handler as (detail: never) => void);
  }

  // ── The public surface ─────────────────────────────────────────────────────────────────────────

  /**
   * What this inbox says before anybody has typed. Readable without a session — it is the front door,
   * and it is what tells you whether to draw a composer at all.
   */
  async boot(): Promise<CnctChatInbox> {
    const inbox = (await this.request(
      `/api/chat/public/${encodeURIComponent(this.publicKey)}`,
    )) as CnctChatInbox;
    this.patch({ inbox, error: null });
    return inbox;
  }

  /**
   * Begin, or resume as the same person. Sending the stored token reuses that visitor rather than
   * minting a stranger, so somebody who chatted a week ago is still attached to their contact.
   */
  async start(input: { displayName?: string; phone?: string } = {}): Promise<CnctChatSession> {
    await this.ready;
    const data = (await this.request(
      `/api/chat/public/${encodeURIComponent(this.publicKey)}/session`,
      {
        method: 'POST',
        body: JSON.stringify({
          displayName: input.displayName,
          ...(input.phone ? { phone: input.phone } : {}),
        }),
      },
    )) as CnctChatSession;
    this.adoptSession(data);
    this.connect();
    return data;
  }

  /** Pick up where a reload left off. Resolves to null when there is no session to pick up. */
  async resume(): Promise<CnctChatSession | null> {
    await this.ready;
    if (!this.token) return null;
    try {
      const data = (await this.request('/api/chat/public/session')) as CnctChatSession;
      this.adoptSession(data);
      if (data.conversation?.status === 'CLOSED') this.patch({ status: 'ended' });
      else this.connect();
      return data;
    } catch (error) {
      if (error instanceof CnctError && error.code === CnctErrorCode.unauthenticated) {
        this.forgetSession();
        this.patch({ status: 'idle', messages: [], conversation: null, visitor: null });
        return null;
      }
      throw error;
    }
  }

  /**
   * Say something. Resolves to the stored message once the server has it.
   *
   * The optimistic bubble goes in immediately and is replaced in place when the real row arrives —
   * matched on `clientKey`, which is also the frame id and also the server's idempotency key, so the
   * three can never disagree about which message this is.
   */
  async send(body: string, options: { clientKey?: string } = {}): Promise<CnctChatMessage> {
    /**
     * Awaited only when there is nothing loaded yet, and that is load-bearing rather than a
     * micro-optimisation. An async function runs synchronously up to its first `await`, so skipping
     * this one is what puts the optimistic bubble on screen in the same tick the person pressed
     * send. Await it unconditionally and every UI gains a frame of blank composer.
     */
    if (!this.token) await this.ready;
    const clientKey = options.clientKey ?? uid();
    if (!this.token) throw new CnctError('Start a conversation first.', CnctErrorCode.noSession);
    const text = String(body ?? '').trim();
    if (!text) throw new CnctError('Nothing to send.', CnctErrorCode.empty);

    const already = this.state.messages.find((m) => m.clientKey === clientKey);
    this.patch({
      messages: already
        ? this.state.messages.map((m) =>
            m.clientKey === clientKey ? { ...m, failed: false, pending: true } : m,
          )
        : [
            ...this.state.messages,
            {
              id: `pending_${clientKey}`,
              speaker: 'CALLER',
              // Stamped even on the optimistic copy, so a UI may switch on `type` without ever
              // meeting an undefined — the server sends it on every message it returns.
              type: 'TEXT',
              body: text,
              createdAt: new Date().toISOString(),
              clientKey,
              pending: true,
            } satisfies CnctChatMessage,
          ],
    });

    try {
      if (this.socket?.readyState === 1 && this.socketSendSupported) {
        return await this.sendOverSocket({ type: 'send', id: clientKey, body: text, clientKey });
      }
      /**
       * The fallback, and it is a real path rather than a formality: it runs against a server that
       * predates socket sends, and it runs whenever the socket happens to be between connections.
       * Same endpoint the hosted page uses, same idempotency key.
       */
      const message = (await this.request('/api/chat/public/messages', {
        method: 'POST',
        body: JSON.stringify({ body: text, clientKey }),
      })) as CnctChatMessage;
      this.absorb(message);
      return message;
    } catch (error) {
      this.markFailed(clientKey);
      this.setError(error);
      throw error;
    }
  }

  /** Retry a message that failed. The same `clientKey`, so the server cannot write it twice. */
  retry(clientKey: string): Promise<CnctChatMessage> {
    const message = this.state.messages.find((m) => m.clientKey === clientKey);
    if (!message) throw new CnctError('No such message.', CnctErrorCode.notFound);
    return this.send(message.body, { clientKey });
  }

  /** Tell the other side somebody is typing. Throttled here as well as on the server. */
  typing(): void {
    const now = Date.now();
    if (now - this.lastTypingSentAt < 3000) return;
    if (this.socket?.readyState !== 1) return;
    this.lastTypingSentAt = now;
    this.socket.send(JSON.stringify({ type: 'typing' }));
  }

  /** The visitor ends it. Their own conversation, so there is no id to pass. */
  async end(): Promise<void> {
    await this.ready;
    if (!this.token) return;
    await this.request('/api/chat/public/close', { method: 'POST' });
    this.closedByUs = true;
    this.patch({ status: 'ended' });
    this.disconnect();
  }

  /**
   * The URL of a file an operator sent.
   *
   * **A browser cannot use this in an `<img src>` or an `<a href>`.** The route is authenticated by
   * the `x-chat-token` header, which a plain navigation does not send — deliberately, because a
   * credential in a query string ends up in referrers, logs and the address bar. Use
   * {@link fetchAttachment} in a page; this is for a server holding the token itself.
   */
  attachmentUrl(attachment: CnctChatAttachment | string): string {
    const id = typeof attachment === 'string' ? attachment : attachment.id;
    return this.config.resolve(`/api/chat/public/attachments/${encodeURIComponent(id)}`);
  }

  /**
   * The bytes of a file an operator sent, as a `Blob` — which is what a page actually needs:
   *
   * ```js
   * const blob = await chat.fetchAttachment(attachment);
   * img.src = URL.createObjectURL(blob);   // revoke it when the bubble unmounts
   * ```
   */
  async fetchAttachment(attachment: CnctChatAttachment | string): Promise<Blob> {
    await this.ready;
    if (!this.token) throw new CnctError('Start a conversation first.', CnctErrorCode.noSession);
    const response = await this.config.fetch(this.attachmentUrl(attachment), {
      headers: { 'x-chat-token': this.token },
    });
    if (!response.ok) {
      throw new CnctError(
        response.status === 404 ? 'No such file.' : 'That file could not be fetched.',
        response.status === 401 ? CnctErrorCode.unauthenticated : CnctErrorCode.requestFailed,
        response.status,
      );
    }
    return response.blob();
  }

  // ── The socket ─────────────────────────────────────────────────────────────────────────────────

  connect(): void {
    if (!this.token) return;
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
    this.closedByUs = false;
    this.patch({ status: this.state.status === 'live' ? 'live' : 'connecting' });

    let opened: WebSocket;
    try {
      opened = this.openSocket();
    } catch (error) {
      if (error instanceof CnctError && error.code === CnctErrorCode.missingCredential) throw error;
      this.scheduleReconnect();
      return;
    }
    this.socket = opened;

    opened.addEventListener('open', () => {
      /**
       * A socket we have since disconnected from or replaced. Close it now rather than
       * authenticating and starting a keep-alive on a connection nobody is reading — and note that
       * closing it *here* is the only safe moment: `ws` raises on a close during the handshake,
       * where a browser simply aborts it.
       */
      if (this.socket !== opened) return void opened.close(1000, 'Client closed');
      opened.send(JSON.stringify({ type: 'auth', token: this.token }));
      this.stopKeepAlive();
      // Quiet connections get closed by proxies long before they get closed by anybody's intent.
      this.keepAliveTimer = setInterval(() => {
        if (opened.readyState === 1) opened.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    });

    opened.addEventListener('message', (event: MessageEvent) => {
      if (this.socket !== opened) return;
      let frame: Record<string, any>;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.handleFrame(frame);
    });

    /**
     * **A browser fires this and expects nothing of you; `ws` treats an unhandled 'error' as a
     * throw.** So on Node — which is exactly where this SDK tells you to pass `ws`, because there
     * is no global WebSocket before 22 — an abandoned handshake or a refused connection became an
     * uncaught exception in somebody else's process.
     *
     * Nothing to do here but say so quietly. `close` always follows, and that is what moves the
     * status and schedules the reconnect; raising it twice would only put a failure in front of a
     * customer that the client is already recovering from.
     */
    opened.addEventListener('error', () => {
      this.config.logger?.('debug', 'the chat socket errored; a close and a retry follow');
    });

    opened.addEventListener('close', (event: CloseEvent) => {
      // Abandoned by `disconnect` or replaced by a later connect: it has already done this work.
      if (this.socket !== opened) return;
      this.stopKeepAlive();
      this.socket = null;
      this.socketSendSupported = false;
      this.rejectAllAwaiting(
        new CnctError('The connection dropped before that was sent.', CnctErrorCode.offline),
      );
      /**
       * 1008 is what the server closes with when the token did not resolve. Reconnecting would loop
       * against a credential that will never work, so this is the one close that ends things rather
       * than backing off.
       */
      if (event.code === 1008) {
        this.forgetSession();
        this.patch({ status: 'idle' });
        this.emit('unauthenticated', undefined);
        return;
      }
      if (this.state.status !== 'ended') this.patch({ status: 'offline' });
      this.emit('disconnected', undefined);
      this.scheduleReconnect();
    });
  }

  disconnect(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopKeepAlive();
    this.rejectAllAwaiting(new CnctError('Disconnected.', CnctErrorCode.offline));
    const socket = this.socket;
    // Cleared first: it is what the handlers above read to tell a live socket from an abandoned one.
    this.socket = null;
    // `readyState` 0 is a handshake still in flight, and closing one raises under `ws`. The `open`
    // handler closes it instead, on the tick where doing so is legal everywhere.
    if (socket && socket.readyState === 1) socket.close(1000, 'Client closed');
  }

  private openSocket(): WebSocket {
    const url = this.config.resolveSocket('/ws/chat');
    if (this.config.webSocketFactory) return this.config.webSocketFactory(url);
    const Native = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket;
    if (!Native) {
      throw new CnctError(
        'This runtime has no WebSocket. Node gained one in 22; on 18 and 20 pass one in the config: ' +
          "new Cnct({ baseUrl, WebSocket: (url) => new (require('ws'))(url) }).",
        CnctErrorCode.missingCredential,
      );
    }
    return new Native(url);
  }

  private handleFrame(frame: Record<string, any>): void {
    switch (frame.type) {
      case 'authenticated': {
        this.reconnectAttempt = 0;
        this.socketSendSupported = Array.isArray(frame.accepts) && frame.accepts.includes('send');
        this.patch({ status: 'live', error: null });
        /**
         * **The reload that makes this client safe to render directly.** Pub/sub replays nothing, so
         * anything said while this socket was down is missing — and there is no way to know how much.
         * Refetching the transcript is the only answer that cannot be subtly wrong.
         */
        void this.resume().catch(() => {});
        this.emit('connected', undefined);
        return;
      }
      case 'pong':
        return;
      case 'ack': {
        const pending = frame.id ? this.awaiting.get(frame.id) : undefined;
        if (pending) {
          clearTimeout(pending.timer);
          this.awaiting.delete(frame.id);
          pending.resolve(frame.message);
        }
        if (frame.message) this.absorb(frame.message);
        return;
      }
      case 'error': {
        const error = new CnctError(frame.error ?? 'That did not work.', frame.code);
        const pending = frame.id ? this.awaiting.get(frame.id) : undefined;
        if (pending) {
          clearTimeout(pending.timer);
          this.awaiting.delete(frame.id);
          // Leave the optimistic bubble in place but mark it, so a UI can offer a retry rather than
          // making the words the person typed disappear.
          this.markFailed(frame.id);
          pending.reject(error);
        }
        this.setError(error);
        this.emit('error', error);
        return;
      }
      case 'chat.message':
        if (frame.payload?.message) this.absorb(frame.payload.message);
        this.emit('message', frame.payload?.message);
        return;
      case 'chat.typing': {
        this.patch({ theyAreTyping: true });
        if (this.typingClearTimer) clearTimeout(this.typingClearTimer);
        this.typingClearTimer = setTimeout(() => this.patch({ theyAreTyping: false }), 4000);
        this.emit('typing', true);
        return;
      }
      case 'chat.conversation.updated':
        if (frame.payload?.conversation) this.patch({ conversation: frame.payload.conversation });
        this.emit('conversation', frame.payload?.conversation);
        return;
      case 'chat.closed':
        this.closedByUs = true;
        this.patch({
          status: 'ended',
          conversation: {
            ...(this.state.conversation ?? ({} as CnctChatConversation)),
            status: 'CLOSED',
          },
        });
        this.emit('closed', undefined);
        return;
      default:
        // An unknown frame is a newer server talking, not an error. Ignored on purpose.
        return;
    }
  }

  private sendOverSocket(frame: {
    type: string;
    id: string;
    body: string;
    clientKey: string;
  }): Promise<CnctChatMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.awaiting.delete(frame.id);
        this.markFailed(frame.id);
        // Safe to say "retry": the clientKey means a second attempt cannot double-post.
        reject(new CnctError('That message has not been acknowledged yet.', CnctErrorCode.timeout));
      }, this.config.sendTimeoutMs);
      this.awaiting.set(frame.id, { resolve, reject, timer });
      this.socket?.send(JSON.stringify(frame));
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByUs || this.reconnectTimer) return;
    // Exponential with a ceiling and jitter — a hundred tabs recovering from the same blip should not
    // arrive in the same millisecond.
    const wait = Math.min(30000, 500 * 2 ** this.reconnectAttempt) * (0.7 + Math.random() * 0.6);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  private rejectAllAwaiting(error: CnctError): void {
    for (const [, pending] of this.awaiting) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.awaiting.clear();
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────────────────────────

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.connectTimeoutMs);
    try {
      response = await this.config.fetch(this.config.resolve(path), {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(this.token ? { 'x-chat-token': this.token } : {}),
          ...this.config.headers,
          ...((init.headers as Record<string, string>) ?? {}),
        },
      });
    } catch {
      // A network failure, not an answer. Distinguished from a 4xx because a UI should retry one and
      // not the other.
      if (controller.signal.aborted) {
        throw new CnctError('That request timed out.', CnctErrorCode.timeout);
      }
      throw new CnctError('Could not reach the chat service.', CnctErrorCode.offline);
    } finally {
      clearTimeout(timer);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof data.error === 'string' ? data.error : 'Something went wrong.';
      throw new CnctError(
        message,
        typeof data.code === 'string'
          ? data.code
          : response.status === 401
            ? CnctErrorCode.unauthenticated
            : CnctErrorCode.requestFailed,
        response.status,
        data,
      );
    }
    return data;
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────────────

  /** Merge a server message in, replacing the optimistic one it answers. */
  private absorb(message: CnctChatMessage): void {
    const messages = this.state.messages.slice();
    const at = message.clientKey
      ? messages.findIndex((m) => m.clientKey === message.clientKey)
      : messages.findIndex((m) => m.id === message.id);
    if (at >= 0) messages[at] = message;
    else if (!messages.some((m) => m.id === message.id)) messages.push(message);
    messages.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    this.patch({ messages });
  }

  private adoptSession(data: CnctChatSession): void {
    if (data.token) {
      this.token = data.token;
      this.persist(data.token);
    }
    this.patch({
      visitor: data.visitor ?? this.state.visitor,
      conversation: data.conversation ?? this.state.conversation,
      messages: data.messages ?? this.state.messages,
      error: null,
    });
  }

  private forgetSession(): void {
    this.token = null;
    // A store that fails to forget is not a reason to fail the call it happened during.
    void Promise.resolve(this.store.clear(this.storageKey)).catch(() => {});
  }

  private persist(token: string): void {
    void Promise.resolve(this.store.write(this.storageKey, token)).catch(() => {});
  }

  private markFailed(clientKey: string): void {
    this.patch({
      messages: this.state.messages.map((m) =>
        m.clientKey === clientKey ? { ...m, pending: false, failed: true } : m,
      ),
    });
  }

  private setError(error: unknown): void {
    const cnct = error instanceof CnctError ? error : null;
    this.patch({
      error: cnct
        ? { code: cnct.code, message: cnct.message }
        : error
          ? { code: 'error', message: String((error as Error).message ?? error) }
          : null,
    });
  }

  private patch(next: Partial<CnctChatState>): void {
    this._state = { ...this._state, ...next };
    this.emit('change', this._state);
  }

  private emit<E extends CnctChatEventName>(event: E, detail: CnctChatEvents[E]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      try {
        (handler as (value: CnctChatEvents[E]) => void)(detail);
      } catch (error) {
        // A subscriber that throws is that subscriber's problem, never the socket's.
        this.config.logger?.('error', 'a chat listener threw', error);
      }
    }
  }
}

export interface CnctChatClientOptions {
  config: CnctConfig | CnctConfigInput;
  credentials: CnctChatPublicKey | string;
  /** Where the visitor's session token lives. Defaults to `localStorage`, or memory where blocked. */
  tokenStore?: CnctTokenStore | StorageLike;
  /** The name the first version of this SDK used for {@link tokenStore}. */
  storage?: CnctTokenStore | StorageLike;
  storageKey?: string;
}

function isThenable<T>(value: unknown): value is Promise<T> {
  return (
    value !== null && typeof value === 'object' && typeof (value as Promise<T>).then === 'function'
  );
}

function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  );
}
