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
GET  /api/chat/public/:publicKey            → the inbox. No credential.
POST /api/chat/public/:publicKey/session    → { displayName, phone? } → { token, messages, … }
GET  /api/chat/public/session               → resume
POST /api/chat/public/messages              → { body, clientKey? }
POST /api/chat/public/close
GET  /api/chat/public/attachments/:id       → the bytes of a file an operator sent
```

The credential is the `token` from session start, sent as `x-chat-token`. **Never as `Authorization`:**
the rate limiter keys on `ip + authorization`, so a visitor who never sends that header falls through to
their IP and cannot mint themselves a fresh budget by inventing one.

The socket is `wss://app.doo.ooo/ws/chat`. Send `{"type":"auth","token":"…"}` within five seconds or
it closes. It answers `{"type":"authenticated","accepts":["ping","typing","send"]}` — read `accepts`
rather than assuming.

Inbound frames: `ping`, `typing`, and `send` as `{ type, id, body, clientKey }`. Outbound: `pong`,
`ack` / `error` (both echoing your `id`), and the events `chat.message`, `chat.typing`,
`chat.conversation.updated`, `chat.closed`.

A close code of `1008` means the token did not resolve. Do not reconnect on it — the SDK clears the
stored token and emits `unauthenticated` instead, because retrying a credential that will never work is
a loop rather than a recovery.

Error codes are stable and worth branching on: `invalid`, `rate_limited`, `too_large`,
`conversation_closed`, `conversation_changed`, `unauthenticated`, `server_error`.
