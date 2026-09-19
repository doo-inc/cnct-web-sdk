import { CnctError, CnctErrorCode } from './errors.js';

/** The version this SDK reports in its `User-Agent`. Kept in step with `package.json`. */
export const SDK_VERSION = '0.1.0';

/**
 * The CNCT hosts this SDK knows about by name.
 *
 * **There is one today, and it is a dev box.** Naming it here rather than defaulting to it means
 * swapping to a production hostname later is one line in one file for an integrator, and — more to
 * the point — means nobody ships to production against a development host by *forgetting* to set
 * something. {@link CnctConfig.baseUrl} is required for exactly that reason.
 */
export const CnctHosts = {
  /**
   * The current CNCT deployment. Expected to be replaced by a stable hostname; when that happens
   * this constant changes and no call site does.
   */
  development: 'https://44-216-80-220.sslip.io',
} as const;

export type CnctLogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Anything shaped like the `fetch` this SDK needs. Injectable so a test can answer without a network. */
export type CnctFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Anything shaped like a `WebSocket` constructor. See {@link CnctConfigInput.WebSocket}. */
export type CnctWebSocketFactory = (url: string) => WebSocket;

export interface CnctConfigInput {
  /**
   * The CNCT host, with an optional path prefix. **Required, with no default.**
   *
   * A prefix is honoured rather than stripped: a client fronting CNCT at
   * `https://theirdomain.com/support` is a legitimate arrangement, and every path this SDK builds is
   * appended to whatever is here. Accepts a string or a `URL`.
   */
  baseUrl: string | URL;
  /** How long to wait for an HTTP response before giving up with `timeout`. Default 20000. */
  connectTimeoutMs?: number;
  /**
   * How long to wait for a chat message to be acknowledged before rejecting it. Default 15000.
   * Rejecting is safe: every message carries an idempotency key, so a retry cannot double-post.
   */
  sendTimeoutMs?: number;
  /**
   * Sent on every request. For a proxy that wants its own header, a tracing id, or a tenant selector
   * in front of CNCT. Never put a CNCT credential here — the clients set those themselves, on the
   * header each one actually uses.
   */
  headers?: Record<string, string>;
  /**
   * Identifies this SDK in the platform's request logs. Worth overriding with your own app's name
   * and version: when a client asks why their integration is being rate-limited, this is the field
   * that answers it.
   *
   * Ignored in a browser, where the user agent is the browser's to set and `fetch` refuses to
   * change it.
   */
  userAgent?: string;
  /**
   * Where this SDK says what it is doing. Undefined is silence, which is the default — an SDK that
   * prints to a customer's console uninvited is a bug report.
   */
  logger?: (level: CnctLogLevel, message: string, error?: unknown) => void;
  /**
   * The `fetch` to use. Defaults to the global one. Pass your own for a test, for a runtime without
   * one, or to put a retry or a trace header in front of every call this SDK makes.
   */
  fetch?: CnctFetch;
  /**
   * How to open a WebSocket. Defaults to the global `WebSocket` — which browsers have always had and
   * Node has had since 22. **On Node 18 and 20 there is no global**, so chat needs one here:
   *
   * ```js
   * import WebSocket from 'ws';
   * const cnct = new Cnct({ baseUrl: host, WebSocket: (url) => new WebSocket(url) });
   * ```
   */
  WebSocket?: CnctWebSocketFactory;
}

/**
 * Where this SDK points and how it behaves on the wire.
 *
 * One object, passed to every client, and the only thing that has to change to move an app between
 * a developer's laptop, a staging host and production. {@link CnctConfig.copyWith} exists so that
 * swap can happen at runtime — an environment picker in a debug menu, a remote config value, a build
 * flag — without rebuilding anything else.
 *
 * ```js
 * const staging = new CnctConfig({ baseUrl: 'https://staging.example.com' });
 * const live = staging.copyWith({ baseUrl: 'https://api.example.com' });
 * ```
 */
export class CnctConfig {
  /** Normalised: absolute, no trailing slash, no query or fragment, path prefix preserved. */
  readonly baseUrl: string;
  readonly connectTimeoutMs: number;
  readonly sendTimeoutMs: number;
  readonly headers: Record<string, string>;
  readonly userAgent: string;
  readonly logger?: (level: CnctLogLevel, message: string, error?: unknown) => void;
  readonly fetch: CnctFetch;
  readonly webSocketFactory?: CnctWebSocketFactory;

  constructor(input: CnctConfigInput) {
    this.baseUrl = normaliseBaseUrl(input?.baseUrl);
    this.connectTimeoutMs = input.connectTimeoutMs ?? 20000;
    this.sendTimeoutMs = input.sendTimeoutMs ?? 15000;
    this.headers = { ...(input.headers ?? {}) };
    this.userAgent = input.userAgent ?? `cnct-web-sdk/${SDK_VERSION}`;
    if (input.logger) this.logger = input.logger;
    const globalFetch = globalThis.fetch;
    if (!input.fetch && typeof globalFetch !== 'function') {
      throw new CnctError(
        'This runtime has no global fetch. Pass one as `fetch` in the config.',
        CnctErrorCode.invalid,
      );
    }
    this.fetch = input.fetch ?? ((url, init) => globalFetch(url, init));
    if (input.WebSocket) this.webSocketFactory = input.WebSocket;
  }

  /**
   * The WebSocket origin, derived rather than configured.
   *
   * Two URLs to keep in step is one URL that gets forgotten, and the forgotten one is always the
   * socket — it fails later, in a way that looks like a network problem rather than a
   * misconfiguration. `https` becomes `wss`, `http` becomes `ws`, and the path prefix travels.
   */
  get socketBaseUrl(): string {
    return this.baseUrl.replace(/^http/, 'ws');
  }

  /** A copy with some things changed. This is how you swap hosts at runtime. */
  copyWith(changes: Partial<CnctConfigInput>): CnctConfig {
    return new CnctConfig({
      baseUrl: changes.baseUrl ?? this.baseUrl,
      connectTimeoutMs: changes.connectTimeoutMs ?? this.connectTimeoutMs,
      sendTimeoutMs: changes.sendTimeoutMs ?? this.sendTimeoutMs,
      headers: changes.headers ?? this.headers,
      userAgent: changes.userAgent ?? this.userAgent,
      logger: changes.logger ?? this.logger,
      fetch: changes.fetch ?? this.fetch,
      WebSocket: changes.WebSocket ?? this.webSocketFactory,
    });
  }

  /** Build a request URL under {@link baseUrl}, preserving any path prefix it carries. */
  resolve(path: string, query?: Record<string, unknown>): string {
    const url = new URL(this.baseUrl);
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          const text = String(item);
          if (text) url.searchParams.append(key, text);
        }
        continue;
      }
      const text = String(value);
      if (text) url.searchParams.append(key, text);
    }
    return url.toString();
  }

  /** The socket URL for a path, under the same prefix. */
  resolveSocket(path: string): string {
    return this.resolve(path).replace(/^http/, 'ws');
  }

  toString(): string {
    return `CnctConfig(baseUrl: ${this.baseUrl})`;
  }
}

/**
 * Trailing slashes are stripped once, here, so that every path built from this is built the same way
 * and a host written with one behaves identically to a host written without.
 */
export function normaliseBaseUrl(value: string | URL | undefined | null): string {
  if (value === undefined || value === null || value === '') {
    throw new CnctError(
      'A CNCT host is required — there is no default. Pass baseUrl, e.g. ' +
        `new Cnct({ baseUrl: CnctHosts.development }) or your own '${'https://cnct.example.com'}'.`,
      CnctErrorCode.invalid,
    );
  }
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(String(value).trim());
  } catch {
    throw new CnctError(
      `baseUrl must be an absolute http(s) URL — got "${String(value)}".`,
      CnctErrorCode.invalid,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CnctError(
      `baseUrl must be an absolute http(s) URL — got "${String(value)}".`,
      CnctErrorCode.invalid,
    );
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}
