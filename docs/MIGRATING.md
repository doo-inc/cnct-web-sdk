# Moving off the copy in cnct-backend

This package is the SDK that used to live inside the platform repository at
`public/sdk/cnct-chat.js`, with the two credentialed surfaces a web page never had. The chat client is
the same code, and nothing about the protocol changed.

## If you load it from the CNCT host

Nothing to do. `https://app.doo.ooo/sdk/v1/cnct-chat.js` is still there, still serves one
dependency-free ES module, still defaults `baseUrl` to the origin it came from, and still exports
`createChatClient` and `ChatError`. It is now built from this repository rather than edited in place —
which is invisible from a page.

## If you vendored the file

Install the package instead. The one thing that changes is what `baseUrl` defaults to: the package
goes to CNCT production, `https://app.doo.ooo`, rather than to the origin it was loaded from.

```diff
- import { createChatClient } from './vendor/cnct-chat.js';
+ import { createChatClient } from 'cnct-web-sdk';

  const chat = createChatClient({
    publicKey: 'the-inbox-public-key',
  });
```

Vendored, the old default resolved to _your_ origin, so anybody who vendored it was already passing
`baseUrl` — keep passing it if it names something other than `app.doo.ooo`, or drop it. Either way
this is a one-line import change and nothing else. (0.1.x required `baseUrl`; 0.2.0 defaults it.)

Everything else is unchanged: `boot`, `start`, `resume`, `send`, `retry`, `typing`, `end`, `connect`,
`disconnect`, `on`, `state`, `hasSession`, the event names, the error codes, and the shape of every
object. `ChatError` is still exported under that name.

## What is new

- **`Cnct`**, the entry point that holds the host once and hands out clients:
  `new Cnct().chat(publicKey)`. `createChatClient` still works and is not going anywhere.
- **Bookings and tickets**, on an API key. See the [README](../README.md#two-credentials-two-doors).
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

---

# From 0.1.x to 0.2.0

## The operator token and contacts are gone

`CnctOperatorToken`, `CnctContactsClient`, `CnctOperatorAuth`, `cnct.contacts(…)`, `cnct.auth`,
`displayNameOf` and the contact types are removed. They signed a staff member in with their own
password and used that eight-hour session as an integration credential — which put a person's login
into somebody's server config, carrying whatever that person's role allowed, and ending the day they
left. An integration's credential should belong to the integration.

What replaces them depends on what you used them for:

- **Looking up a customer's bookings or tickets** — an API key already does this, by phone number:
  `agent.bookings.forCustomer(phone)`, `agent.tickets.forCustomer(phone)` and `agent.tickets.get(…)`.
- **Anything else in the contact directory** — there is no key-based surface for it yet. Tell us what
  you need, rather than keeping a staff login in a config file.

`Cnct.modulesFor` no longer answers `'contacts'`, and `CnctModule` no longer includes it.

## `/api/tools` instead of `/api/booking-tools`

`CnctAgentClient` now calls `/api/tools`. CNCT serves both addresses, so nothing changes for you
unless you run CNCT yourself on a build from before 2026-09-29 — in that case, upgrade it first.

## New

- `agent.tickets.get(phone, ticketNumber)` and `agent.tickets.addTo({ … })`. See
  [BOOKINGS-AND-TICKETS.md](BOOKINGS-AND-TICKETS.md#when-the-customer-comes-back).
- `agent.tickets.forCustomer(phone, { q, ticketNumber, includeResolved })` — the options the platform
  always took and 0.1.x never passed.
