/**
 * Everything in this SDK that can fail, fails with one of these.
 *
 * The `code` is the part worth branching on. It is stable across versions and, where the failure
 * came from the server, it is the server's own code verbatim — the same string a Dart integrator
 * sees for the same event, because two SDKs inventing two vocabularies for one error is how a
 * support answer stops being portable between them.
 */
export class CnctError extends Error {
  override readonly name = 'CnctError';

  /** Stable. See {@link CnctErrorCode} for the ones this SDK promises to keep. */
  readonly code: string;

  /** The HTTP status, when the failure arrived as a response rather than a socket frame. */
  readonly status?: number;

  /**
   * The server's whole error body, where it answered with one.
   *
   * Worth reading: a refused contact carries the record it collided with, a login that needs an
   * account carries the list to choose from, and a validation refusal carries the fields under
   * `error` as `{ fieldErrors, formErrors }`.
   */
  readonly details?: unknown;

  constructor(message: string, code = 'error', status?: number, details?: unknown) {
    super(message);
    this.code = code;
    if (status !== undefined) this.status = status;
    if (details !== undefined) this.details = details;
  }

  /**
   * True when retrying later is reasonable: the network was down, the socket dropped mid-send, or
   * the server asked us to slow down. A 4xx that is not a rate limit is not in here — retrying a
   * request the server understood and refused just refuses again.
   */
  get isRetryable(): boolean {
    return (
      this.code === CnctErrorCode.offline ||
      this.code === CnctErrorCode.timeout ||
      this.code === CnctErrorCode.rateLimited ||
      this.code === CnctErrorCode.serverError
    );
  }

  /**
   * True when the credential is the problem: it expired, it was revoked, or it never resolved. The
   * chat client clears its stored session token when it sees this; anything else should ask for a
   * fresh credential rather than retrying.
   */
  get isUnauthenticated(): boolean {
    return this.code === CnctErrorCode.unauthenticated;
  }
}

/**
 * The name this error had before the SDK grew past chat.
 *
 * Kept as an alias rather than a deprecation warning: it is what `public/sdk/cnct-chat.js` threw,
 * every `catch` written against that SDK names it, and there is nothing to gain from breaking those
 * files to rename a class.
 */
export { CnctError as ChatError };

/**
 * The codes this SDK will not rename.
 *
 * The first block is the server's — `src/routes/chat-public.ts` and the visitor socket send these
 * by name and they are documented as stable. The second block is this client's, for the failures
 * that never reach a server.
 */
export const CnctErrorCode = {
  // ── The server's ─────────────────────────────────────────────────────────────────────────────
  /** The request was malformed or failed validation. `details` carries the fields. */
  invalid: 'invalid',
  /** Too many requests. Slow down; the limits are in the README. */
  rateLimited: 'rate_limited',
  /** The message body was over the four-thousand-character limit. */
  tooLarge: 'too_large',
  /** The conversation has ended. Start a new one; it cannot be reopened from this side. */
  conversationClosed: 'conversation_closed',
  /**
   * The request collided with something that already exists or has already moved on: a contact with
   * that number, a slot somebody else took, an operator with seats in more than one account. Never a
   * reason to retry unchanged — the answer will be the same.
   */
  conflict: 'conflict',
  /** The session token now points at a different conversation than the one being written to. */
  conversationChanged: 'conversation_changed',
  /** The credential did not resolve, or no longer does. */
  unauthenticated: 'unauthenticated',
  /** Something broke on the far side. */
  serverError: 'server_error',

  // ── This client's ────────────────────────────────────────────────────────────────────────────
  /**
   * The network could not be reached at all, or a socket dropped before a frame was acknowledged.
   * Distinct from a 4xx on purpose: one is worth retrying and the other is not.
   */
  offline: 'offline',
  /** A send was not acknowledged inside the configured window. Retrying is safe — see `retry`. */
  timeout: 'timeout',
  /** A method that needs a live session was called before `start()` or `resume()`. */
  noSession: 'no_session',
  /** Nothing to send: the body was empty or whitespace. */
  empty: 'empty',
  /** A local lookup found nothing — a `clientKey` with no message behind it, say. */
  notFound: 'not_found',
  /** The server answered, and answered with an error this SDK has no more specific name for. */
  requestFailed: 'request_failed',
  /**
   * The response was not the shape this SDK expects. Almost always a host pointing at something
   * that is not a CNCT deployment.
   */
  badResponse: 'bad_response',
  /** A module was used without the credential it needs. */
  missingCredential: 'missing_credential',
  /**
   * A tool declined, in a sentence rather than a status code. The account's operations surface
   * answers `200` with an `error` key when it will not do something — the slot went, the number is
   * not on file, no ticket types are configured — and this is that, raised.
   */
  toolRefused: 'tool_refused',
} as const;

export type CnctErrorCodeValue = (typeof CnctErrorCode)[keyof typeof CnctErrorCode];
