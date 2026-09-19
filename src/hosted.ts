/**
 * The build that CNCT itself serves, at `https://<your-cnct-host>/sdk/v1/cnct-chat.js`.
 *
 * It is the package, bundled into one dependency-free ES module a browser can load from a `<script
 * type="module">` with no build step of its own — and with **one** difference from the package:
 * `baseUrl` defaults to the origin this file was served from.
 *
 * That default is right here and wrong everywhere else, which is the whole reason for a separate
 * entry point. A file fetched from `https://cnct.example.com/sdk/v1/cnct-chat.js` is, by definition,
 * sitting on the CNCT host, so an integrator cannot get the host wrong and does not have to be told
 * it. The same default in a bundled copy would resolve to the customer's own domain, where there is
 * no CNCT to answer — so the package makes `baseUrl` required and this entry fills it in.
 *
 * Overridable anyway, because a proxy in front of us is a legitimate arrangement.
 */
import { CnctChatClient } from './chat/chat-client.js';
import type { CnctConfigInput } from './config.js';
import type { CnctTokenStore, StorageLike } from './token-store.js';

export { ChatError, CnctError, CnctErrorCode } from './errors.js';
export { CnctChatClient } from './chat/chat-client.js';
export type * from './chat/types.js';

/** Where this file was served from, which is by definition the CNCT host. */
function servedFrom(): string {
  try {
    return new URL(import.meta.url).origin;
  } catch {
    return '';
  }
}

export interface HostedChatClientOptions {
  /** The inbox's public key. The whole tenant boundary lives on it. */
  publicKey: string;
  /** Defaults to wherever this module was served from. */
  baseUrl?: string | URL;
  /** Anything with getItem/setItem/removeItem. Defaults to `localStorage`, or memory where blocked. */
  storage?: CnctTokenStore | StorageLike;
  storageKey?: string;
  /** How long to wait for a send to be acknowledged before rejecting. Default 15000. */
  sendTimeoutMs?: number;
  fetch?: CnctConfigInput['fetch'];
}

export function createChatClient(options: HostedChatClientOptions): CnctChatClient {
  return new CnctChatClient({
    config: {
      baseUrl: options?.baseUrl ?? servedFrom(),
      ...(options?.sendTimeoutMs !== undefined ? { sendTimeoutMs: options.sendTimeoutMs } : {}),
      ...(options?.fetch ? { fetch: options.fetch } : {}),
    },
    credentials: options?.publicKey,
    ...(options?.storage ? { tokenStore: options.storage } : {}),
    ...(options?.storageKey ? { storageKey: options.storageKey } : {}),
  });
}

export default createChatClient;
