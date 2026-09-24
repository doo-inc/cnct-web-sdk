/**
 * The official CNCT SDK for browsers and Node.
 *
 * Three credentials, three doors, and nothing in here renders anything:
 *
 * | Credential           | Opens                   | Where it belongs                                |
 * | -------------------- | ----------------------- | ----------------------------------------------- |
 * | `CnctChatPublicKey`  | Live chat, as a visitor | In your bundle. It is already public.           |
 * | `CnctApiKey`         | Bookings and tickets    | On a server you control. Account-wide.          |
 * | `CnctOperatorToken`  | The contact directory   | A staff app, from a person's own login.         |
 *
 * Start with {@link Cnct}, or construct a client directly. Everything points at the host in
 * `CnctConfig.baseUrl`, and swapping that is the only change needed to move between environments.
 *
 * ```js
 * import { Cnct } from 'cnct-web-sdk';
 *
 * const cnct = new Cnct(); // CnctHosts.production, https://app.doo.ooo
 * const chat = cnct.chat('the-inbox-public-key');
 * chat.on('change', render);
 * await chat.boot();
 * await chat.start({ displayName: 'Layla' });
 * await chat.send('Do you open on Fridays?');
 * ```
 */
export { Cnct, createCnct, type CnctModule } from './cnct.js';
export {
  CnctConfig,
  CnctHosts,
  SDK_VERSION,
  normaliseBaseUrl,
  type CnctConfigInput,
  type CnctFetch,
  type CnctLogLevel,
  type CnctWebSocketFactory,
} from './config.js';
export {
  CnctApiKey,
  CnctChatPublicKey,
  CnctCredentials,
  CnctOperatorToken,
} from './credentials.js';
export { ChatError, CnctError, CnctErrorCode, type CnctErrorCodeValue } from './errors.js';
export { CnctTransport, type RequestOptions } from './transport.js';
export {
  asTokenStore,
  browserTokenStore,
  defaultTokenStore,
  delegateTokenStore,
  fromStorage,
  memoryTokenStore,
  type CnctTokenStore,
  type StorageLike,
} from './token-store.js';

export { CnctChatClient, type CnctChatClientOptions } from './chat/chat-client.js';
export type * from './chat/types.js';

export { CnctAgentClient, CnctBookings, CnctTickets } from './agent/agent-client.js';
export type * from './agent/types.js';

export { CnctContactConflict, CnctContactsClient } from './contacts/contacts-client.js';
export {
  CnctChooseOrganization,
  CnctOperatorAuth,
  type CnctOperatorSession,
} from './contacts/operator-auth.js';
export { displayNameOf } from './contacts/types.js';
export type * from './contacts/types.js';

import { CnctChatClient } from './chat/chat-client.js';
import type { CnctConfigInput } from './config.js';
import type { CnctTokenStore, StorageLike } from './token-store.js';

export interface CreateChatClientOptions {
  /** The inbox's public key. The whole tenant boundary lives on it. */
  publicKey: string;
  /**
   * The CNCT host. Defaults to production, `https://app.doo.ooo` — not to the page's own origin, as
   * the copy served from the CNCT host does. See the note on this function.
   */
  baseUrl?: string | URL;
  /** Anything with getItem/setItem/removeItem, or a `CnctTokenStore`. Defaults to `localStorage`. */
  storage?: CnctTokenStore | StorageLike;
  storageKey?: string;
  /** How long to wait for a send to be acknowledged before rejecting. Default 15000. */
  sendTimeoutMs?: number;
  /** For Node 18 and 20, which have no global WebSocket. */
  WebSocket?: CnctConfigInput['WebSocket'];
  fetch?: CnctConfigInput['fetch'];
}

/**
 * The chat client, under the name and shape the first version of this SDK had.
 *
 * Kept because every integration written against `/sdk/v1/cnct-chat.js` calls this, and renaming a
 * function is not worth an afternoon of somebody else's time.
 *
 * **One difference: what `baseUrl` defaults to.** The hosted copy at
 * `https://app.doo.ooo/sdk/v1/cnct-chat.js` defaults it to the origin it was served from, which is
 * right exactly because it was served from CNCT. Installed from npm and bundled into your own site,
 * that same default would point at *your* domain, where there is no CNCT — so the package defaults
 * to CNCT production instead. (Before 0.2.0 there was no production host and it was required.)
 */
export function createChatClient(options: CreateChatClientOptions): CnctChatClient {
  return new CnctChatClient({
    config: {
      baseUrl: options.baseUrl,
      ...(options.sendTimeoutMs !== undefined ? { sendTimeoutMs: options.sendTimeoutMs } : {}),
      ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
    credentials: options.publicKey,
    ...(options.storage ? { tokenStore: options.storage } : {}),
    ...(options.storageKey ? { storageKey: options.storageKey } : {}),
  });
}

export default createChatClient;
