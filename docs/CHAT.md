# Chat, in detail

The [README](../README.md) covers what a chat interface needs. This is the rest: what each card
carries, what is deliberately not in it, and the HTTP and socket contract underneath — which you can
hold directly if you would rather not use the SDK at all.

## Cards

Every message carries a `type`. It is `TEXT` for ordinary words, and the name of a card for the few
things a customer is meant to read as something other than a sentence.

### `TICKET_UPDATE`

Written when a ticket is raised out of the conversation — by an operator, by an automation rule, or by
the assistant's own tool. All three go through one place, so none of them can forget.

**Off unless the inbox asks for it**, on the inbox's settings panel under Basics — "Tell the customer
when a ticket is raised". The default is the decision rather than caution: a business that files a
ticket for every awkward question has not thereby agreed to tell the customer a case was opened, and a
card announcing one invites "what is happening with #1042" from somebody who never asked for a case
number. A business running a real support desk wants the opposite. It is per inbox, so the hosted page
and your own interface can be answered differently.

`data` is exactly four fields, and the list is an allowlist rather than a filter:

|                |                                                   |
| -------------- | ------------------------------------------------- |
| `ticketNumber` | What a customer quotes back to you                |
| `title`        | One line, usually their own words                 |
| `status`       | `OPEN`, `RESOLVED`, and the rest of the lifecycle |
| `raisedAt`     | ISO 8601                                          |

What is deliberately **not** there: the assigned team or operator, the priority, the SLA clock, the
ticket type's internal name, and every internal id. Those are how a business triages its own work, and
one of them is a colleague's name.

### `BOOKING_UPDATE`

Written when a booking is taken, moved or cancelled in the conversation. Switched on in the inbox's
settings panel — "Tell the customer about their booking" — and off by default.

**All three moments, not just the first.** A card that announces an appointment and then goes quiet when
it moves is worse than no card: it leaves a stale time on a screen the customer has every reason to
trust.

|                |                                                                   |
| -------------- | ----------------------------------------------------------------- |
| `title`        | The service, or the booking's own title where there is no service |
| `startsAt`     | ISO 8601 — render it in the customer's locale, not the business's |
| `endsAt`       | ISO 8601                                                          |
| `status`       | `CONFIRMED`, `CANCELLED`, and the rest of the lifecycle           |
| `locationName` | Where to go. Null where the business has one location             |
| `partySize`    | Null unless the booking took one                                  |

A booking carries more than a ticket does, and deliberately: this is the customer's own appointment
rather than a note about them, and there is no part of when and where they are expected that they are
not entitled to. What stays behind is the machinery — which resource was allocated, whether an operator
forced it over a conflict, and any note written about them rather than by them.

### Both switches are web-only, and that is about money

Neither toggle appears on a WhatsApp, SMS, Messenger, Instagram or email inbox, and the route refuses
the field outright there.

A card is an ordinary public message. On a channel that has an outside, the server _sends_ those — so
the row that appears quietly in a chat window would be a real, billed WhatsApp message or SMS. On SMS it
would arrive beside the booking confirmation text the platform already sends, telling somebody the same
thing twice; on WhatsApp it would additionally be subject to the 24-hour window and simply fail outside
it. The web page has no outside, which is what makes a card there free.

### A card publishes named keys, never the row

`contentAttributes` is not passed through. It carries `actorId`, `assignedOperatorId`, `assignedTeamId`
and `mentions` on other kinds of row, and those rows are internal — but the allowlist is what makes a
card safe rather than the visibility flag, so a future writer's mistake cannot become a customer-visible
leak of who works for you.

## If you would rather not use the SDK

The SDK is a convenience over a contract you can hold directly.

```
GET  /api/chat/public/:publicKey               → the inbox, with widget, team, availability. No credential.
POST /api/chat/public/:publicKey/session       → { displayName?, phone?, timezone? } → { token, messages, … }
GET  /api/chat/public/session?timezone=…       → resume
POST /api/chat/public/:publicKey/identify      → { userId, userHash, name?, email?, phone? } → { token, visitor }
POST /api/chat/public/messages                 → { body, clientKey?, attachmentIds?, replyId? }
POST /api/chat/public/attachments              → multipart, one part named `file` → 201 { attachment }
GET  /api/chat/public/attachments/:id          → the bytes of a file, either way
GET  /api/chat/public/conversations            → { visitor, conversations } — up to 50, newest first
GET  /api/chat/public/conversations/:id        → { visitor, conversation, messages }
POST /api/chat/public/conversations/:id/read   → 204
POST /api/chat/public/conversations/:id/rating → { score, comment? } → { conversation }
POST /api/chat/public/profile                  → { displayName, phone? } → { visitor }
POST /api/chat/public/close
```

The credential is the `token` from session start, sent as `x-chat-token`. **Never as `Authorization`:**
the rate limiter keys on `ip + authorization`, so a visitor who never sends that header falls through to
their IP and cannot mint themselves a fresh budget by inventing one. Never in a URL either: a query
string ends up in referrers, logs and the address bar.

A POST with no body sends no `content-type`. The server refuses a request that says JSON and sends
nothing, which is what `close` and `read` are.

### Messages

A message as the visitor sees it carries, beside `id`, `speaker`, `body`, `createdAt` and `clientKey`:

|               |                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `sender`      | `{ kind: 'person', name, avatar }` for an operator, `{ kind: 'ai', name, … }` for the assistant; null for the visitor and system lines |
| `type`/`data` | `TEXT`, or a card and its allowlisted fields — see above. An unknown `type` renders as its `body`                                      |
| `flow`        | An assistant's question: `{ text, layout, choices: [{ id, title, description? }], footer?, listButton?, media?, expects? }`            |
| `suggestions` | Up to three short replies the assistant offers                                                                                         |
| `replyTo`     | `{ messageId, mine, excerpt, attachmentKind? }` — the message this one quotes                                                          |
| `attachments` | `[{ id, kind, mimeType, filename, bytes }]` — only files that are stored                                                               |

`body` is words, files, or both — never neither. A flow choice the visitor taps is sent as its `title`,
with its `id` as `replyId`, so the flow follows the button rather than reading the title as typing.

### Files

Two steps, each file on its own: upload it to `/api/chat/public/attachments` (multipart, one part named
`file`), then send the message with the ids in `attachmentIds`. Up to ten files a message, 50 MB each, of
the types listed in `CnctAttachmentLimits.types`. **HEIC is not among them**: `upload()` converts it to
JPEG first where the runtime can decode it, and downscales a JPEG photo over 2560 px on its long side.

Refusals: `403` the inbox takes no files (`attachments_disabled`), `409` the conversation has ended
(`conversation_closed`), `413` too big (`too_large`), `415`/`422` the wrong type (`unsupported_type`),
`503` the deployment keeps no files (`attachments_disabled`). A `code` in the body wins over all of
these, and the body's `error` is a sentence for a person.

### Signed-in users

`userHash` is `HMAC-SHA256(userId, the inbox's identity secret)` in lowercase hex, **computed on your
server**. Send the current `x-chat-token` with the call, so a conversation started before sign-in moves
across, and keep the token it answers with instead. `409` means identity is not set up for the inbox;
`401` means the hash did not verify — in which case the anonymous session is still good.

### The socket

The socket is `wss://app.doo.ooo/ws/chat`. Send `{"type":"auth","token":"…"}` within five seconds or
it closes. It answers `{"type":"authenticated","accepts":["ping","typing","send"]}` — read `accepts`
rather than assuming.

Inbound frames: `ping`, `typing`, and `send` as `{ type, id, body, clientKey, attachmentIds?, replyId? }`
— the same body the POST takes. Outbound: `pong`, `ack` / `error` (both echoing your `id`), and the
events:

|                             |                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `chat.message`              | `{ message }` — a new one                                                              |
| `chat.message.updated`      | `{ message }` — edited, deleted, or a file finished storing. Replace it by `id`        |
| `chat.typing`               | The other side is typing. A start, never a stop: clear it yourself after a few seconds |
| `chat.read`                 | `{ at }` — the team has read the visitor's messages up to then: a "Seen"               |
| `chat.conversation.updated` | What changed — `status`, `withPerson`, `assignee` — merged over what you had           |
| `chat.closed`               | The conversation ended                                                                 |

Anything else is a newer server talking. Ignore it.

A close code of `1008` means the token did not resolve. Do not reconnect on it — the SDK clears the
stored token and emits `unauthenticated` instead, because retrying a credential that will never work is
a loop rather than a recovery.

Error codes are stable and worth branching on: `invalid`, `rate_limited`, `too_large`,
`conversation_closed`, `conversation_changed`, `conflict`, `unauthenticated`, `server_error` from the
server; and about files — before anything is uploaded, or from the attachments endpoint —
`too_many`, `too_large`, `unsupported_type` and `attachments_disabled`, the same on every CNCT SDK.
