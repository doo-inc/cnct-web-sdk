import { CnctAgentClient } from './agent/agent-client.js';
import { CnctChatClient, type CnctChatClientOptions } from './chat/chat-client.js';
import { CnctConfig, type CnctConfigInput } from './config.js';
import { CnctContactsClient } from './contacts/contacts-client.js';
import { CnctOperatorAuth } from './contacts/operator-auth.js';
import {
  CnctApiKey,
  CnctChatPublicKey,
  type CnctCredentials,
  CnctOperatorToken,
} from './credentials.js';
import { CnctError, CnctErrorCode } from './errors.js';

/**
 * A part of CNCT a credential can open.
 *
 * Not decoration: the three credentials are genuinely different keys to different doors, and an app
 * that asks {@link Cnct.modulesFor} what it holds can hide the tabs it cannot serve instead of finding
 * out with a 401 in front of a customer.
 */
export type CnctModule = 'chat' | 'bookings' | 'tickets' | 'contacts';

/**
 * The entry point. Holds the {@link CnctConfig} and hands out the clients a credential opens.
 *
 * You do not have to use it — every client can be constructed directly — but it is the shortest path
 * from "here is our host and here is our key" to something working, and it is the one place the host
 * lives.
 *
 * ```js
 * const cnct = new Cnct(); // https://app.doo.ooo
 * const chat = cnct.chat('inbox-public-key');
 * ```
 *
 * **Swapping hosts** is {@link withBaseUrl}. Clients already made keep the host they were made with —
 * they hold open sockets and in-flight requests, and silently re-pointing those mid-conversation would
 * be worse than making a new client and saying so.
 *
 * ```js
 * const staging = cnct.withBaseUrl('https://staging.example.com');
 * ```
 */
export class Cnct {
  readonly config: CnctConfig;

  constructor(input: CnctConfigInput | CnctConfig = {}) {
    this.config = input instanceof CnctConfig ? input : new CnctConfig(input);
  }

  /** The short form, for the common case of a host and nothing else. */
  static host(baseUrl: string | URL): Cnct {
    return new Cnct({ baseUrl });
  }

  /** The same SDK pointed somewhere else. Everything but the host is carried over. */
  withBaseUrl(baseUrl: string | URL): Cnct {
    return new Cnct(this.config.copyWith({ baseUrl }));
  }

  /**
   * What a credential opens.
   *
   * Contacts are absent from every list but the operator's, and that is the platform's boundary rather
   * than this SDK's: there is no contacts surface on an API key today.
   */
  static modulesFor(credentials: CnctCredentials): CnctModule[] {
    switch (credentials.kind) {
      case 'chatPublicKey':
        return ['chat'];
      case 'apiKey':
        return ['bookings', 'tickets'];
      case 'operatorToken':
        return ['contacts'];
      default:
        return [];
    }
  }

  /**
   * Live chat, as a visitor. The credential is an inbox's public key — the one credential in this SDK
   * that is meant to be in your bundle.
   *
   * Pass a `tokenStore` to keep the visitor's session somewhere other than `localStorage`.
   */
  chat(
    credentials: CnctChatPublicKey | string,
    options: Omit<CnctChatClientOptions, 'config' | 'credentials'> = {},
  ): CnctChatClient {
    return new CnctChatClient({ config: this.config, credentials, ...options });
  }

  /** Bookings and tickets, on an account-wide API key. **Server-side only** — see {@link CnctApiKey}. */
  agent(credentials: CnctApiKey | string): CnctAgentClient {
    return new CnctAgentClient({ config: this.config, credentials });
  }

  /** The contact directory, on an operator's console session. */
  contacts(credentials: CnctOperatorToken | string): CnctContactsClient {
    return new CnctContactsClient({ config: this.config, credentials });
  }

  /** Signing an operator in, to get the token {@link contacts} needs. */
  get auth(): CnctOperatorAuth {
    return new CnctOperatorAuth({ config: this.config });
  }

  /**
   * The client for a credential, whatever kind it is.
   *
   * For an app that is handed one of the three and has to work out what it can do — a settings screen
   * where somebody pastes whatever CNCT gave them, say.
   */
  clientFor(credentials: CnctCredentials): CnctChatClient | CnctAgentClient | CnctContactsClient {
    if (credentials instanceof CnctChatPublicKey) return this.chat(credentials);
    if (credentials instanceof CnctApiKey) return this.agent(credentials);
    if (credentials instanceof CnctOperatorToken) return this.contacts(credentials);
    throw new CnctError(
      'That is not a CNCT credential. Wrap it in CnctChatPublicKey, CnctApiKey or CnctOperatorToken.',
      CnctErrorCode.missingCredential,
    );
  }
}

/** `new Cnct(...)`, for codebases that prefer a function. */
export function createCnct(input: CnctConfigInput | CnctConfig): Cnct {
  return new Cnct(input);
}
