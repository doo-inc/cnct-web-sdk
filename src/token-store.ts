/**
 * Where a visitor's chat session token is kept between page loads.
 *
 * The token is a thirty-day bearer secret scoped to one conversation. Held, the same person comes
 * back to the same thread with their history intact; lost, they are a stranger who has to start again
 * — which is not a failure, just a worse experience.
 *
 * The default in a browser is `localStorage`, falling back to memory wherever it is blocked. Outside
 * a browser the default is memory, because an SDK that decided where a server keeps its state would
 * be wrong about it.
 */
export interface CnctTokenStore {
  read(key: string): string | null | Promise<string | null>;
  write(key: string, value: string): void | Promise<void>;
  clear(key: string): void | Promise<void>;
}

/**
 * The `localStorage`-shaped object the first version of this SDK took. Still accepted everywhere a
 * store is, because every integration written against that SDK passes one.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Keeps nothing across a reload. Correct for a test, a one-shot script and a kiosk; wrong for
 * anything a person comes back to.
 */
export function memoryTokenStore(): CnctTokenStore {
  const held = new Map<string, string>();
  return {
    read: (key) => held.get(key) ?? null,
    write: (key, value) => void held.set(key, value),
    clear: (key) => void held.delete(key),
  };
}

/**
 * `localStorage`, or memory where it is blocked.
 *
 * Private mode, a blocked third-party context, or no DOM at all: a chat that forgets who you are is
 * worse than one that never claimed to remember, so this is a downgrade rather than a failure. The
 * probe is a write, because Safari's private mode only throws on the write.
 */
export function browserTokenStore(): CnctTokenStore {
  try {
    const probe = '__cnct_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return fromStorage(globalThis.localStorage);
  } catch {
    return memoryTokenStore();
  }
}

/** Wrap anything with `getItem` / `setItem` / `removeItem`. */
export function fromStorage(storage: StorageLike): CnctTokenStore {
  return {
    read: (key) => storage.getItem(key),
    write: (key, value) => storage.setItem(key, value),
    clear: (key) => storage.removeItem(key),
  };
}

/**
 * Persistence in three callbacks, so any storage fits without this package depending on one.
 *
 * ```js
 * const store = delegateTokenStore({
 *   read: (key) => cookies.get(key) ?? null,
 *   write: (key, value) => cookies.set(key, value, { maxAge: 60 * 60 * 24 * 30 }),
 *   clear: (key) => cookies.remove(key),
 * });
 * ```
 */
export function delegateTokenStore(delegate: CnctTokenStore): CnctTokenStore {
  return delegate;
}

/** The default for wherever this is running. */
export function defaultTokenStore(): CnctTokenStore {
  return typeof globalThis.localStorage === 'undefined' ? memoryTokenStore() : browserTokenStore();
}

/** Accept either shape at the edge, so the two spellings never reach the rest of the SDK. */
export function asTokenStore(store: CnctTokenStore | StorageLike | undefined): CnctTokenStore {
  if (!store) return defaultTokenStore();
  if ('getItem' in store) return fromStorage(store);
  return store;
}
