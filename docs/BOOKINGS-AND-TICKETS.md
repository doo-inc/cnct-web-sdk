# Bookings and tickets

On a `kaer_sk_` API key, which is account-wide. **Keep it on a server.** Everything here reads and
writes on behalf of the whole account, and the customer each call is about is named by phone number
rather than inferred from a session. A page that held this key could book for, and cancel for, anybody.

```js
import { Cnct, CnctApiKey } from 'cnct-web-sdk';

const agent = new Cnct({ baseUrl: process.env.CNCT_HOST }).agent(
  new CnctApiKey(process.env.CNCT_API_KEY),
);
```

## Start with the catalogue

```js
const { tools, rules } = await agent.catalogue();
```

Filtered per account — an account without ticketing is not shown ticket tools — so read it rather than
assuming. It is also the cheapest way to check a key works.

`rules` is the business's clock, its week, its services and what it will let a caller ask for. The hours
are the difference between an app that offers a time and one that offers a time the business will
accept. Everything the SDK does not model — `hours`, `locations`, `policy` — is on `rules.raw`, exposed
raw rather than pinned to a shape this SDK would have to break to widen.

## The calendar

```js
const day = await agent.bookings.checkAvailability({ date: '2026-09-20', partySize: 4 });
```

`date` is `YYYY-MM-DD` in the business's own timezone — the one `rules.timezone` names, which is not
necessarily the browser's. **Always call this before offering anybody a time.**

**Pass `startsAt` back exactly as the slot gave it.** It is the token `create` matches a slot on;
reformatting it, or rebuilding it from a parsed `Date`, is how a booking lands on a time that was never
offered.

```js
await agent.bookings.create({
  startsAt: day.free[0].startsAt,
  customerPhone: '+97312345678',
  name: 'Layla',
  nameIsTheCaller: false,
});
```

`nameIsTheCaller` is small and load-bearing. A booking's name and a customer's name are different facts
about different people: somebody booking a haircut for their daughter gives their daughter's name, and
filing it against the number would rename the contact permanently. It defaults to false.

| Method                           |                                                                           |
| -------------------------------- | ------------------------------------------------------------------------- |
| `services()`                     | What the business can be booked for. Empty means it books generically.    |
| `people()`                       | Who can be asked for by name. **Empty is an instruction** — see below.    |
| `checkAvailability({ date, … })` | The free times on a day.                                                  |
| `create({ startsAt, … })`        | Take one.                                                                 |
| `forCustomer(phone)`             | Their upcoming bookings. Call before changing anything — you need the id. |
| `reschedule({ bookingId, … })`   | Move it. Answers with the new time, in the business's words.              |
| `cancel({ bookingId, … })`       | Cancel it. Answers with the time it _was_ at.                             |

**An empty list is often an instruction rather than an absence.** A business with no bookable people has
switched named preference off deliberately — the reason accounts turn it off is that one popular stylist
absorbs every request while three others sit idle. An app must not offer a choice it has been told not
to offer. `listing.note` says which case you are in, and dropping that sentence loses the difference
between "the day is full" and "no table seats six".

## Tickets

```js
const types = await agent.tickets.types();
const detail = await agent.tickets.type(types.items[0].ticketTypeId);
```

`detail.askFor` is already only the questions worth asking — the platform subtracts what it knows about
this customer on the server. Ask for those and nothing else, and key `fields` exactly as `askFor` named
them. Never invent a key.

```js
const raised = await agent.tickets.create({
  ticketTypeId: detail.ticketTypeId,
  title: 'Refund not received',
  reasonUnresolved: 'Needs finance to confirm the original payment',
  customerPhone: '+97312345678',
  fields: { orderNumber: 'A-1042' },
  idempotencyKey: conversationId, // retry returns the same ticket rather than a second one
});
```

`idempotencyKey` is worth sending. Omit it and every call raises a new ticket.

## Refusals are not failures

A tool that declines answers `200` with an `error` sentence — the slot went, the number is not on file,
no ticket types are configured. The typed methods raise that as `tool_refused` so it cannot be ignored;
`agent.call(tool, args)` hands it back for you to read instead.

```js
await agent.call('check_availability', { date }); // → { error: 'We are closed that day.' }
await agent.callOrThrow('check_availability', { date }); // → throws, code 'tool_refused'
```

`call` is also the escape hatch, and a supported one: a tool added to the platform after this SDK was
published is reachable on the day it ships, without waiting for a release here.
