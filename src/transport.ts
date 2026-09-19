import type { CnctConfig } from './config.js';
import { CnctError, CnctErrorCode } from './errors.js';

/**
 * The one place this SDK talks HTTP.
 *
 * Every module goes through it, so the error vocabulary, the timeout, the headers and the JSON
 * handling are decided once. A module that built its own request would be a module that maps a 429 to
 * something slightly different, and an integrator branching on {@link CnctErrorCode} would be right
 * about one of them.
 */
export class CnctTransport {
  constructor(readonly config: CnctConfig) {}

  get(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.send('GET', path, options);
  }

  post(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.send('POST', path, options);
  }

  patch(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.send('PATCH', path, options);
  }

  delete(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.send('DELETE', path, options);
  }

  /**
   * The raw bytes of something — an attachment, an export. Same auth and same error mapping as the
   * JSON paths, because a 401 on a file download is the same event as a 401 anywhere else.
   */
  async bytes(path: string, options: RequestOptions = {}): Promise<ArrayBuffer> {
    const response = await this.run('GET', this.config.resolve(path, options.query), {
      headers: this.buildHeaders(options.headers),
    });
    if (!response.ok) throw await failureFrom(response);
    return response.arrayBuffer();
  }

  private async send(method: string, path: string, options: RequestOptions): Promise<unknown> {
    const url = this.config.resolve(path, options.query);
    const headers = this.buildHeaders(options.headers);
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const response = await this.run(method, url, init);
    this.config.logger?.('debug', `${method} ${path} → ${response.status}`);

    const raw = await response.text();
    if (response.status === 204 || raw === '') {
      if (!response.ok)
        throw new CnctError(
          `Request failed with ${response.status}.`,
          codeFor(response.status),
          response.status,
        );
      return null;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      if (!response.ok) {
        throw new CnctError(raw, codeFor(response.status), response.status);
      }
      throw new CnctError(
        'The server answered with something that is not JSON. Check that baseUrl points at a CNCT ' +
          'host and not at a login page or a proxy error.',
        CnctErrorCode.badResponse,
        response.status,
      );
    }

    if (!response.ok) throw failure(response.status, raw, decoded);
    return decoded;
  }

  private async run(method: string, url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.connectTimeoutMs);
    try {
      return await this.config.fetch(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new CnctError(
          `The request timed out after ${Math.round(this.config.connectTimeoutMs / 1000)}s.`,
          CnctErrorCode.timeout,
        );
      }
      // A dead network, a refused connection, DNS. Distinct from an answer, because a UI should
      // retry one and not the other.
      throw new CnctError(
        `Could not reach ${hostOf(this.config.baseUrl)}: ${messageOf(cause)}`,
        CnctErrorCode.offline,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    // `User-Agent` is a forbidden header name in a browser — set it and the browser drops it. Only
    // sent where it will actually arrive, so the platform's logs never carry a half-truth.
    if (typeof document === 'undefined') headers['user-agent'] = this.config.userAgent;
    return { ...headers, ...this.config.headers, ...(extra ?? {}) };
  }
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Turn a failed response into an exception with a code worth branching on.
 *
 * The platform answers in three shapes and all three are handled here rather than at the call sites:
 * `{error: "a sentence"}`, `{error: {fieldErrors, formErrors}}` from a validation refusal, and
 * `application/problem+json` with its own `code`. Where the body names a code, that code wins — the
 * server is more specific about its own failures than a status line can be.
 */
export function failure(status: number, raw: string, decoded?: unknown): CnctError {
  let message = raw === '' ? `Request failed with ${status}.` : raw;
  let details: unknown;
  let serverCode: string | undefined;

  if (decoded !== null && typeof decoded === 'object') {
    // The whole body, always. A refusal often carries more than a sentence — the contact you
    // collided with, the accounts you have a seat in, the fields that failed validation — and a
    // transport that keeps only the message throws that away at the one moment it is useful.
    details = decoded;
    const body = decoded as Record<string, unknown>;
    if (typeof body.error === 'string') message = body.error;
    else if (body.error !== undefined && body.error !== null) message = 'That request was refused.';
    if (typeof body.title === 'string') message = body.title;
    if (typeof body.code === 'string') serverCode = body.code;
  }

  return new CnctError(message, serverCode ?? codeFor(status), status, details);
}

async function failureFrom(response: Response): Promise<CnctError> {
  const raw = await response.text().catch(() => '');
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    decoded = undefined;
  }
  return failure(response.status, raw, decoded);
}

function codeFor(status: number): string {
  if (status === 400) return CnctErrorCode.invalid;
  if (status === 401 || status === 403) return CnctErrorCode.unauthenticated;
  if (status === 404) return CnctErrorCode.notFound;
  if (status === 409) return CnctErrorCode.conflict;
  if (status === 413) return CnctErrorCode.tooLarge;
  if (status === 429) return CnctErrorCode.rateLimited;
  if (status >= 500) return CnctErrorCode.serverError;
  return CnctErrorCode.requestFailed;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Every module needs the same "the server should have sent an object" check. */
export function expectObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new CnctError(
    `Expected an object from the server and got ${value === null ? 'null' : typeof value}.`,
    CnctErrorCode.badResponse,
  );
}
