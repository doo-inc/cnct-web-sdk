# Changelog

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
