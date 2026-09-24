import { CnctError, CnctErrorCode } from './errors.js';

/**
 * A credential CNCT issued you, and the only thing that decides which parts of this SDK you can use.
 *
 * There are three, they are not interchangeable, and the difference between them is not convenience
 * — it is what happens when one leaks. Each class says what it opens and where it is safe to keep it.
 */
export abstract class CnctCredentials {
  /** Tells the three apart without `instanceof`, which does not survive a bundler boundary. */
  abstract readonly kind: 'chatPublicKey' | 'apiKey' | 'operatorToken';

  /**
   * The headers this credential travels on. Different for each, deliberately: see
   * {@link CnctChatPublicKey} for why the chat session token is not an `Authorization` header.
   */
  abstract get headers(): Record<string, string>;

  /** A redacted form, for logs and error messages. Never returns the secret. */
  abstract get redacted(): string;
}

/**
 * An inbox's public key — the credential a customer-facing page carries.
 *
 * **This one is meant to be in your bundle.** It identifies an inbox, not a person and not an
 * account: everything it opens is the visitor's own conversation, and a visitor is anonymous until
 * they volunteer a phone number. It is the same key that sits in the URL of the hosted chat page, so
 * it was already public.
 *
 * It grants chat and nothing else. It cannot read contacts, cannot list conversations, and cannot see
 * another visitor's thread.
 */
export class CnctChatPublicKey extends CnctCredentials {
  override readonly kind = 'chatPublicKey' as const;
  readonly publicKey: string;

  constructor(publicKey: string) {
    super();
    if (!publicKey || !publicKey.trim()) {
      throw new CnctError('A chat public key cannot be empty.', CnctErrorCode.invalid);
    }
    this.publicKey = publicKey.trim();
  }

  /**
   * The public key is part of the path rather than a header, so there is nothing to add here. The
   * per-visitor session token is added by the chat client itself, on `x-chat-token` — never on
   * `Authorization`, because the platform's rate limiter keys on `ip + authorization` and a visitor
   * who invents that header would be minting themselves a fresh budget.
   */
  override get headers(): Record<string, string> {
    return {};
  }

  override get redacted(): string {
    return `publicKey:${tail(this.publicKey)}`;
  }
}

/**
 * A server-to-server API key, minted in the CNCT console under **Settings → Developers**. Starts with
 * `kaer_sk_`.
 *
 * **There are two kinds, and the key says which.** `kaer_sk_test_…` is a **sandbox** key: it reads the
 * account as it really is — services, people, hours, ticket types, what is free — but nothing it books,
 * moves, cancels or raises is real. No customer is contacted and nothing appears in the business's
 * calendar or queue, and every answer carries `sandbox: true`. `kaer_sk_live_…` is **production**, and
 * so is every key minted before the two kinds existed (plain `kaer_sk_…`). Both go to the same host.
 *
 * **Do not ship this in a web page.** It is account-wide: it can read and write bookings and tickets
 * for every customer the account has, and a key in a bundle is a key every visitor has — View Source
 * is not an attack. It belongs on a server you control, with the browser calling that.
 *
 * The SDK will let you do it anyway — refusing outright would only push people to hand-roll the same
 * requests with less care — but {@link assertNotInBrowser} exists so the mistake can be loud.
 */
export class CnctApiKey extends CnctCredentials {
  override readonly kind = 'apiKey' as const;

  /**
   * Every key ever issued begins with this. Recognisable on sight in a log or a pull request, and
   * greppable by the secret scanners that look for exactly this shape.
   */
  static readonly prefix = 'kaer_sk_';
  /** A sandbox key: reads the real account, writes nothing real. */
  static readonly sandboxPrefix = 'kaer_sk_test_';
  /** A production key. Keys from before there were two kinds have neither segment, and are this. */
  static readonly productionPrefix = 'kaer_sk_live_';

  readonly key: string;
  /**
   * Which kind of key this is, read from its prefix. The platform decides from its own records and
   * this can only agree with it: a key is minted with its prefix and never changes kind.
   */
  readonly mode: 'sandbox' | 'production';

  constructor(key: string) {
    super();
    if (!key || !key.trim()) {
      throw new CnctError('An API key cannot be empty.', CnctErrorCode.invalid);
    }
    if (!key.startsWith(CnctApiKey.prefix)) {
      throw new CnctError(
        `A CNCT API key starts with "${CnctApiKey.prefix}". Check you have not pasted an inbox ` +
          'public key or a session token.',
        CnctErrorCode.invalid,
      );
    }
    this.key = key.trim();
    this.mode = this.key.startsWith(CnctApiKey.sandboxPrefix) ? 'sandbox' : 'production';
  }

  /** True for a `kaer_sk_test_` key, whose writes are kept apart and are not real. */
  get isSandbox(): boolean {
    return this.mode === 'sandbox';
  }

  override get headers(): Record<string, string> {
    return { authorization: `Bearer ${this.key}` };
  }

  override get redacted(): string {
    return `apiKey:${tail(this.key)}`;
  }

  /**
   * Throws when this key is running somewhere a visitor could read it. Call it at startup if you
   * want the mistake to be a crash in development rather than a leak in production.
   */
  assertNotInBrowser(): void {
    if (typeof document !== 'undefined') {
      throw new CnctError(
        'This API key is account-wide and must not run in a browser — anyone who opens the page ' +
          'can read it. Put it on a server and have the page call that.',
        CnctErrorCode.invalid,
      );
    }
  }
}

/**
 * An operator's console session — the credential behind contacts and the rest of the account surface.
 *
 * It is a person's login, eight hours long, and it carries whatever that person's role allows. Use it
 * for back-office tools, internal apps and integrations run by staff. It is the wrong credential for
 * anything a customer holds.
 *
 * Obtain one with `CnctOperatorAuth.login(...)`, or pass a token you already have.
 */
export class CnctOperatorToken extends CnctCredentials {
  override readonly kind = 'operatorToken' as const;
  readonly token: string;

  /**
   * When this stops working, where the caller knows. The server issues eight-hour tokens; this is
   * filled in by `CnctOperatorAuth.login` and left undefined for a token handed in from elsewhere.
   */
  readonly expiresAt?: Date;

  constructor(token: string, options: { expiresAt?: Date } = {}) {
    super();
    if (!token || !token.trim()) {
      throw new CnctError('An operator token cannot be empty.', CnctErrorCode.invalid);
    }
    this.token = token.trim();
    if (options.expiresAt) this.expiresAt = options.expiresAt;
  }

  /**
   * True once {@link expiresAt} has passed. An unknown expiry answers false — an unknown expiry is
   * not an expired one, and guessing would log people out of a session that still works.
   */
  get isExpired(): boolean {
    return this.expiresAt !== undefined && Date.now() > this.expiresAt.getTime();
  }

  override get headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }

  override get redacted(): string {
    return `operator:${tail(this.token)}`;
  }
}

/**
 * The last four characters, which is enough to tell two credentials apart in a log and not enough to
 * be one. The first characters are the same on every key ever issued, so they say nothing.
 */
function tail(secret: string): string {
  return secret.length <= 4 ? '****' : `…${secret.slice(-4)}`;
}
