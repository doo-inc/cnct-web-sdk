# Changelog

## 0.2.0

- **The host defaults to production, `https://app.doo.ooo`.** `baseUrl` is optional on `Cnct`,
  `CnctConfig` and `createChatClient`; `new Cnct()` is enough. It was required in 0.1.x because the only
  deployment was a development box. Passing a `baseUrl` works exactly as before, and an empty string is
  still refused — it is a variable somebody meant to set.
- **`CnctHosts.production`**. `CnctHosts.development` is deprecated: the box it named no longer answers,
  and it now points at production so code that used it still compiles and still works.
- **Sandbox keys.** A `kaer_sk_test_…` key reads the account as it really is and writes nothing real —
  see the README's _Sandbox and production_. `CnctApiKey` has `mode` and `isSandbox`,
  `CnctAgentClient` has `mode`, and `catalogue()`, a booking confirmation and a raised ticket each carry
  `sandbox`. Production keys are `kaer_sk_live_…`; keys minted before are plain `kaer_sk_…` and are
  production. All three still start `kaer_sk_`, so 0.1.x accepts the new keys unchanged.
- Keys are minted by the account's owner or an admin in the CNCT console, under **Settings →
  Developers**.

## 0.1.1

- **A disconnect during the handshake no longer throws in Node.** `ws` raises an 'error' event where
  a browser fires one nobody has to catch, and an unhandled one on an EventEmitter is a throw — so a
  server-side integration that started a chat and shut down a moment later took the process with it.
  There is a listener now, and `disconnect()` closes a connecting socket on 'open' rather than
  mid-handshake. A socket abandoned that way also no longer authenticates and holds a keep-alive
  open.
- The test suite supplies a socket the way Node 18 and 20 must, so both that path and the global one
  are covered rather than whichever the machine happens to have.

## 0.1.0

First release as a package of its own. The chat client is the one that shipped inside the platform at
`public/sdk/cnct-chat.js`; the other two surfaces are new to the web.

- **Chat** on an inbox public key: `boot`, `start`, `resume`, `send`, `retry`, `typing`, `end`, with the
  socket, the reconnect-and-refetch, the idempotent send and the HTTP fallback it always had. Ticket and
  booking cards are typed; an unrecognised card degrades to its own body. Attachments are modelled, and
  `fetchAttachment` exists because the route is header-authenticated and could never be an `<img src>`.
- **Bookings and tickets** on a `kaer_sk_` API key: availability, create, reschedule, cancel, ticket
  types and raises, plus `call()` as an escape hatch onto any tool the platform adds later.
- **Contacts** on an operator session: list with cursor paging, get, create, update, merge, tags, and a
  login that handles MFA and a person with seats in more than one account.
- **`baseUrl` is required and swappable at runtime** with `copyWith` / `Cnct.withBaseUrl`. The WebSocket
  origin is derived from it, so there is no second URL to keep in step. The build CNCT serves at
  `/sdk/v1/cnct-chat.js` keeps defaulting it to the origin it was served from, so no site that already
  pasted the snippet has to change anything.
- Written in TypeScript, so the types are generated rather than a hand-kept copy beside the source.
- No runtime dependencies. Runs in a browser, in Node 18+, and in a worker; `fetch` and `WebSocket` are
  injectable for the runtimes that lack one.
