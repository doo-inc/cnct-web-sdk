# Moving off the copy in cnct-backend

This package is the SDK that used to live inside the platform repository at
`public/sdk/cnct-chat.js`, with the two credentialed surfaces a web page never had. The chat client is
the same code, and nothing about the protocol changed.

## If you load it from the CNCT host

Nothing to do. `https://your-cnct-host/sdk/v1/cnct-chat.js` is still there, still serves one
dependency-free ES module, still defaults `baseUrl` to the origin it came from, and still exports
`createChatClient` and `ChatError`. It is now built from this repository rather than edited in place —
which is invisible from a page.

## If you vendored the file

Install the package instead and **pass the host**, which is the one thing that changes:

```diff
- import { createChatClient } from './vendor/cnct-chat.js';
+ import { createChatClient } from 'cnct-web-sdk';

  const chat = createChatClient({
    publicKey: 'the-inbox-public-key',
+   baseUrl: 'https://your-cnct-host',
  });
```

Vendored, the old default resolved to _your_ origin, so anybody who vendored it was already passing
`baseUrl` — in which case this is a one-line import change and nothing else.

Everything else is unchanged: `boot`, `start`, `resume`, `send`, `retry`, `typing`, `end`, `connect`,
`disconnect`, `on`, `state`, `hasSession`, the event names, the error codes, and the shape of every
object. `ChatError` is still exported under that name.

## What is new

- **`Cnct`**, the entry point that holds the host once and hands out clients:
  `new Cnct({ baseUrl }).chat(publicKey)`. `createChatClient` still works and is not going anywhere.
- **Bookings, tickets and contacts**, on the other two credentials. See the
  [README](../README.md#three-credentials-three-doors).
- **Types**, generated from the source rather than hand-written beside it. `cnct-chat.d.ts` was a copy
  that could drift; these cannot.
- **`fetchAttachment`**, because a file an operator sent needs the session token on a header and
  therefore could never be an `<img src>`.
- **A token store**, so the visitor's session can live somewhere other than `localStorage`.
- **An injectable `WebSocket` and `fetch`**, for Node 18 and 20 and for tests.

## One behavioural note

`send()` is `async` now. It still puts the optimistic bubble in place synchronously — an async function
runs to its first `await`, and there is none before the patch when a session is already loaded — so a UI
that calls `chat.send(text)` and then reads `chat.state` in the same tick sees the pending bubble exactly
as before.

The one case that differs is a **custom async token store** on the very first send of a session, where
the client has to wait to learn whether it has a token at all. Await `chat.ready` once at startup if that
matters to you.
