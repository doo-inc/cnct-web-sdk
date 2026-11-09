# Changelog

## 1.0.0

The first release with a chat interface of its own, released together with the iOS and Android SDKs
from one shared spec (`docs/chat-ui/SPEC.md`). All three have the same options, the same theme tokens
and the same words in English and Arabic.

### A ready-made chat UI: `cnct-web-sdk/ui`

- **`<cnct-chat>`**, a framework-free custom element in its own Shadow DOM, registered by
  `defineCnctChat()`, and **`mountChat(element, options)`**, which returns `{ update, destroy }`. The
  options are `client` (a chat client or a public key), `theme`, `language`, `strings`, `identity`,
  `onClose` and `onEvent`. It has no runtime dependencies, and importing it touches no browser
  global, so it is safe where pages are rendered on a server.
- **Brandable.** The theme has these tokens: `primary`, `onPrimary`, `background`, `surface`, `text`,
  `textMuted`, `border`, the two bubble pairs, `cornerRadius`, `font`, `logo`, `title`, `appearance`
  and `showPoweredBy`.
  - Light and dark each have their own colours.
  - Precedence: what the app passes, then the inbox's widget settings in the CNCT console, then the
    defaults.
  - Every token is also a `--cnct-*` CSS custom property on the element.
- **English and Arabic**, every word of the interface, from the table the three SDKs share.
  - Arabic mirrors the whole screen.
  - Each piece of user text takes its own direction.
  - Phone numbers, emails and links stay left to right.
  - Digits are Latin.
- **Attachments both ways.**
  - In: by picker, drag and drop, or paste, as chips with a progress ring. Count, size and type are
    checked before anything is uploaded.
  - Out: images inline with a full-screen viewer; other files as cards that download under their
    original name.
- **The conversation view of CNCT's hosted chat page:**
  - Grouped messages, with faces and first names.
  - Flow choices and the assistant's suggestions.
  - Typing, pending, failed and retry; the offline banner; Seen.
  - Read receipts, the name card, ending, and the rating card.
- **`cnct-web-sdk/ui/fixture`**, the scripted conversation every platform renders for its tests and
  screenshots, through a fake transport and socket.

### The rest of the visitor API, in the headless client

- `boot()` returns the inbox's `widget` settings, merged over `CNCT_WIDGET_DEFAULTS`, its `team` and
  its `availability`.
- **Files:**
  - `upload(file, { onProgress, signal })` checks the file, converts HEIC to JPEG, downscales photos
    over 2560 px, and reports progress: `XMLHttpRequest` in a browser, a streamed `fetch` in Node.
  - `send(body, { attachments, attachmentIds })` sends words, files or both.
  - `checkAttachment`, `CnctAttachmentLimits`, `prepareAttachment`, and `uploader` and
    `imageTranscoder` to replace the defaults.
- **`replyId`**, and `choose(choice)` for a tapped flow choice. `retry()` resends the same files and
  choice.
- **`identify({ userId, userHash, … })`** for signed-in users. The anonymous conversation moves
  across.
- **More calls:** `listConversations()`, `getConversation(id)`, `read()` (once per reply), `rate()`,
  `updateProfile()` and `ensureSession()`.
- **Frames:** `chat.message.updated` replaces a message in place (`messageUpdated`); `chat.read` sets
  `conversation.seenAt` (`read`). A partial `chat.conversation.updated` is merged.
- **`timezone`** goes with session start and resume.
- **The full message model:** `sender`, `flow`, `suggestions` and `replyTo`; and on conversations
  `id`, `assignee`, `rating`, `ratable`, `closedAt` and `seenAt`.
- **Ending:** `end()` and a `chat.closed` frame mark the conversation `CLOSED` at once, then read back
  whether it can be rated.
- **Fixes:**
  - A failed message no longer vanishes, with its retry, when the socket reconnects and the
    transcript is read back.
  - A `429` with no code from the server is `rate_limited`.
- **New client error codes**, raised before anything is sent: `too_many_files`, `file_too_large`,
  `unsupported_file_type`, and `cancelled` for an aborted upload.

### Unchanged

- `dist/hosted/cnct-chat.js`, served at `/sdk/v1/cnct-chat.js`, builds as before and exports what it
  always did. It carries the new client methods, and is 27.3 kB minified (9.2 kB gzipped), up from
  13.8 kB.
- Nothing in 0.2.0's API was removed or renamed. See [docs/MIGRATING.md](docs/MIGRATING.md).

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
- **Following up on a ticket.** `agent.tickets.get(phone, ticketNumber)` reads one of a customer's
  tickets as they may see it — status, whether it waits on them, their request, its fields and a plain
  history, with no names and no staff notes. `agent.tickets.addTo({ customerPhone, ticketNumber, note })`
  passes their follow-up on to the open ticket instead of raising a second one, and starts a ticket that
  was waiting on them moving again. Both need a CNCT host from 2026-09-29 on.
- `agent.tickets.forCustomer(phone, { q, ticketNumber, includeResolved })` passes the options the
  platform always accepted.
- **The agent client calls `/api/tools`.** CNCT still answers the old `/api/booking-tools`.
- **Breaking: the operator token and contacts are removed** — `CnctOperatorToken`,
  `CnctContactsClient`, `CnctOperatorAuth`, `cnct.contacts`, `cnct.auth`, `displayNameOf` and the
  contact types. A staff member's login is not an integration credential. See
  [docs/MIGRATING.md](docs/MIGRATING.md#from-01x-to-020).

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
