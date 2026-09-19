# CNCT for the web

The official CNCT SDK for browsers and Node. Live chat, the contact directory, the calendar and
tickets — against a CNCT workspace, using the credentials CNCT issues you.

**It is headless, and that is the whole point.** There is no DOM in this package, not one element and
not one style rule. A business building their own site has a design system already; shipping them a
chat bubble to restyle answers a question they did not ask. So this ships state and events, and the
interface is yours. [`examples/`](examples) has a working one in about a hundred lines you own and
can delete.

It has no runtime dependencies and no framework, so the same package runs in a browser, in Node, in a
service worker and in a one-file script.

> **Just want a chat bubble on your site?** You do not need any of this. In the CNCT console, open
> the inbox, go to Widget, and paste the one line it gives you — see [the widget](#the-drop-in-widget).

---

## Install

```bash
npm install github:doo-inc/cnct-web-sdk#v0.1.0
```

Pin a tag rather than `main`. What you ship is what your users run, and an SDK that moves under a
released site is a bug report nobody can reproduce.

For a page with no build step, the CNCT host serves a bundled copy of exactly this package:

```html
<script type="module">
  import { createChatClient } from 'https://your-cnct-host/sdk/v1/cnct-chat.js';
</script>
```

The two are the same code. The difference is one default, and it is the next section.

---

## Point it at your host

One value decides where everything goes — HTTP and the WebSocket alike, because the socket origin is
derived from it rather than configured separately. There is nothing else to keep in step.

```js
import { Cnct, CnctHosts } from 'cnct-web-sdk';

const cnct = new Cnct({ baseUrl: 'https://your-cnct-host' });
```

It is **required, with no default**. There is one CNCT deployment today and it is a development box;
defaulting to it would mean shipping to production by forgetting to set something. It is named as a
constant so that swapping it later is one line:

```js
const cnct = new Cnct({ baseUrl: CnctHosts.development }); // today
const cnct = new Cnct({ baseUrl: 'https://api.cnct.example' }); // when there is a production hostname
```

Swapping at runtime — an environment picker in a debug menu, a remote config value, a `VITE_` variable
— is `withBaseUrl`, and everything else in the config comes with it:

```js
const staging = cnct.withBaseUrl('https://staging.example.com');
```

A base URL may carry a path, so fronting CNCT on your own domain works without a fork:
`https://theirdomain.com/support` puts every request — and the socket — under `/support`.

Clients already built keep the host they were built with. They hold open sockets and in-flight
requests, and silently re-pointing those mid-conversation would be worse than making a new one.

### The one exception

The copy CNCT serves at `https://your-cnct-host/sdk/v1/cnct-chat.js` defaults `baseUrl` to the origin
it was fetched from — which is right there, precisely because it _was_ fetched from CNCT, and an
integrator cannot get it wrong or even has to be told it.

Installed from npm and bundled into your own site, that same default resolves to **your** domain,
where there is no CNCT to answer. So the package requires the host and the hosted file fills it in.
Nothing else differs between them.

---

## Three credentials, three doors

Which parts of this SDK you can use is decided entirely by what CNCT gave you. They are not
interchangeable, and the difference is not convenience — it is what happens when one leaks.

| Credential                | Opens                   | Where it belongs                                                                                                               |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CnctChatPublicKey('…')`  | Live chat, as a visitor | **In your bundle.** It identifies an inbox, not a person, and it is already public — it is in the URL of the hosted chat page. |
| `CnctApiKey('kaer_sk_…')` | Bookings and tickets    | **On a server you control.** It is account-wide: it can book for, and cancel for, anybody. Never in a page.                    |
| `CnctOperatorToken('…')`  | The contact directory   | A staff app, from a person's own login. Eight hours, carrying that person's role.                                              |

The SDK will tell you what it holds, which is useful for an app that hides the tabs it cannot serve
rather than discovering the answer with a 401 in front of a customer:

```js
Cnct.modulesFor(credentials); // ['chat'] | ['bookings', 'tickets'] | ['contacts']
```

`CnctApiKey` has `assertNotInBrowser()` for the mistake that matters: call it at startup and a key
that has found its way into a bundle crashes in development rather than leaking in production.

---

## Chat

```js
const chat = cnct.chat('the-inbox-public-key');

chat.on('change', (state) => render(state)); // every change, as a new snapshot

const inbox = await chat.boot(); // greeting, whether it is open, whether it wants a number
if (inbox.isActive) {
  await chat.start({ displayName: 'Layla' });
  await chat.send('Do you open on Fridays?');
}
```

`boot()` is readable without a session — it is the front door, and it is what tells you whether to
draw a composer at all. `start()` mints a visitor, or reuses the one behind a stored token, and opens
the socket. From there, `chat.state` is everything a UI renders.

### The state

`chat.state` is replaced rather than mutated on every change, so a framework comparing references sees
it and a framework reading fields sees a consistent snapshot.

| Field           | What it is                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------- |
| `status`        | `idle` before a session, then `connecting` / `live` / `offline`, and `ended` once closed     |
| `inbox`         | What `boot()` returned                                                                       |
| `conversation`  | `{ status, startedAt, withPerson }` — `withPerson` says somebody is on the thread, never who |
| `messages`      | Oldest first, with `pending` and `failed` on the visitor's own                               |
| `theyAreTyping` | True while the other side is typing; clears itself                                           |
| `error`         | The last failure, or null                                                                    |

`speaker` is `CALLER` (them), `AI`, `OPERATOR` or `SYSTEM`. There is no conversation id and no operator
name anywhere in it — the public surface is an explicit allowlist, not a stripped copy of the internal
one, and it stays that way whatever gets added to the database later.

`chat.canSend` is the one derived thing worth having: false before a session and once a conversation is
closed.

### The methods

|                                 |                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `boot()`                        | The inbox's greeting and whether it is open. No session needed.              |
| `start({ displayName, phone })` | Begin, or resume as the same person. Opens the socket.                       |
| `resume()`                      | Pick up after a reload. Resolves to `null` when there is nothing to pick up. |
| `send(body, { clientKey })`     | Say something. Resolves with the stored message.                             |
| `retry(clientKey)`              | Re-send a failed message. Safe — see idempotency below.                      |
| `typing()`                      | Tell the other side. Throttled here and again on the server.                 |
| `end()`                         | The visitor closes it.                                                       |
| `fetchAttachment(attachment)`   | The bytes of a file an operator sent, as a `Blob`.                           |
| `on(event, handler)`            | Returns the unsubscribe.                                                     |

Events: `change`, `message`, `typing`, `conversation`, `closed`, `connected`, `disconnected`,
`unauthenticated`, `error`.

### Cards: rendering more than words

Every message carries a `type`. It is `TEXT` for ordinary words, and the name of a card for the few
things a customer is meant to read as something other than a sentence. A card also carries `data`.

```js
for (const message of chat.state.messages) {
  switch (message.type) {
    case 'TICKET_UPDATE':
      renderTicket(message.data); // { ticketNumber, title, status, raisedAt }
      break;
    case 'BOOKING_UPDATE':
      renderBooking(message.data); // { title, startsAt, endsAt, status, locationName, partySize }
      break;
    default:
      renderText(message.body);
  }
}
```

**`body` always reads correctly on its own.** A card's body is a complete sentence — "We have opened
ticket #1042 for this: Refund not received" — so an interface written before a card type existed still
shows something true rather than an empty bubble. That is what makes adding a card type a non-breaking
change, and it is why the `default` branch above is the whole of what an older client needs.

Both card types are **off unless the inbox asks for them**, on the inbox's own settings panel. The
defaults are decisions rather than caution: a business that files a ticket for every awkward question
has not thereby agreed to tell the customer a case was opened. See [docs/CHAT.md](docs/CHAT.md) for
what each card carries and what is deliberately not in it.

### Attachments

A message may carry `attachments`. Fetching one needs the session token on a header, so **a plain
`<img src>` will not work** — that is deliberate, because a credential in a query string ends up in
referrers, logs and the address bar:

```js
const blob = await chat.fetchAttachment(attachment);
img.src = URL.createObjectURL(blob); // revoke it when the bubble unmounts
```

### Three things it does for you

**A reconnect reloads.** The server's fan-out is pub/sub and replays nothing after a drop — that is
deliberate, and it is survivable only because nothing treats the event stream as authoritative. So this
client refetches the whole transcript every time it reconnects rather than splicing a gap it cannot
measure. A UI that renders `messages` is always rendering the truth.

**A send is idempotent.** Every message carries a `clientKey`, unique per conversation in the database.
A frame replayed across a reconnect returns the row it already wrote instead of writing a second one.
That is what makes `send()` safe to reject on a timeout: retrying cannot double-post, so a failed
bubble can offer a retry button rather than making somebody wonder whether their message half-arrived.

**It degrades rather than breaks.** The server announces what it accepts on the handshake. Sends go over
the socket where `send` is offered and fall back to `POST /api/chat/public/messages` where it is not —
which covers both an older server and the ordinary case of the socket being between connections.
Nothing in your code changes either way.

### Keeping the visitor

The session token is a thirty-day bearer secret scoped to one conversation. Held, the same person comes
back to the same thread with their history intact; lost, they are a stranger who has to start again.

The default is `localStorage`, falling back to memory wherever it is blocked — private mode, a
sandboxed frame, a browser with site data off. Pass your own store for anything else:

```js
import { delegateTokenStore } from 'cnct-web-sdk';

const chat = cnct.chat(publicKey, {
  tokenStore: delegateTokenStore({
    read: (key) => cookies.get(key) ?? null,
    write: (key, value) => cookies.set(key, value, { maxAge: 60 * 60 * 24 * 30 }),
    clear: (key) => cookies.remove(key),
  }),
});
```

A store may be async. `chat.ready` resolves once it has loaded; a synchronous store is already loaded by
the time the constructor returns, so it is only worth awaiting if yours is not.

### Identity

**A visitor is anonymous until they volunteer a phone number.** There is no signed identity yet — no
`setUser` with an HMAC — so a customer already logged in to your own site still arrives as a stranger,
and only joins their existing contact record if they type a number or give one in the pre-chat step.
This is the honest weak spot of the channel; until it closes, a site with a logged-in audience gets
better identity resolution by passing the number it already knows to `start({ phone })`.

### React, roughly

```jsx
const chat = useMemo(() => cnct.chat(publicKey), [publicKey]);
const state = useSyncExternalStore(
  (onChange) => chat.on('change', onChange),
  () => chat.state,
);

useEffect(() => {
  chat.resume();
  return () => chat.disconnect();
}, [chat]);
```

Then render `state.messages`, call `chat.send(text)` on submit and `chat.typing()` on keystroke. A
message with `pending` is in flight; one with `failed` wants a retry button wired to
`chat.retry(message.clientKey)`. A fuller version is in [`examples/react`](examples/react).

---

## Bookings and tickets

**Server-side only.** The credential is account-wide: it can read and write bookings and tickets for
every customer the account has. The intended shape is your page talking to your backend, and your
backend holding the key.

```js
import { Cnct, CnctApiKey } from 'cnct-web-sdk';

const agent = new Cnct({ baseUrl: process.env.CNCT_HOST }).agent(
  new CnctApiKey(process.env.CNCT_API_KEY),
);

const day = await agent.bookings.checkAvailability({ date: '2026-09-20', partySize: 4 });
if (day.free.length) {
  await agent.bookings.create({
    startsAt: day.free[0].startsAt, // exactly as given
    customerPhone: '+97312345678',
    name: 'Layla',
  });
}
```

Every method that is about a particular person takes `customerPhone` in full international form. That
is not a convenience parameter — it _is_ the authorization boundary. There is no ambient identity out
here, so the number is what decides whose booking may be read and changed.

Three things worth knowing before you build on it, all covered in
[docs/BOOKINGS-AND-TICKETS.md](docs/BOOKINGS-AND-TICKETS.md):

- **Pass `startsAt` back exactly as the slot gave it.** Rebuilding it from a parsed `Date` is how a
  booking lands on a time nobody offered.
- **An empty list is often an instruction rather than an absence.** No people means "this business
  assigns whoever is free — do not offer a choice". The `note` says which case you are in.
- **`agent.call(tool, args)` reaches any tool the platform adds later**, on the day it ships, without
  waiting for a release here.

## Contacts

The account's contact directory, on an operator's console session. There is no contacts surface on the
API-key credential today — that is the platform's boundary rather than this SDK's, and it is worth
knowing before you design around it.

```js
const { session, challenge } = await cnct.auth.login({ email, password });
if (challenge) {
  // MFA is the ordinary path, not an error: show a code field and call verifyMfa.
}
const contacts = cnct.contacts(session.credentials);

for await (const contact of contacts.listAll({ query: 'layla' })) {
  console.log(displayNameOf(contact), contact.phoneNumber);
}
```

Paged by cursor rather than by offset, and that is not a style choice: every inbound message touches the
contact it belongs to, so the order is being rewritten while somebody scrolls it. Under an offset that
is page two silently re-showing half of page one. See [docs/CONTACTS.md](docs/CONTACTS.md).

---

## Errors

Everything that can fail throws a `CnctError`. The `code` is the part worth branching on — it is stable
across versions and, where the failure came from the server, it is the server's own code verbatim, so a
support answer is portable between this SDK and the Flutter one.

```js
try {
  await chat.send(text);
} catch (error) {
  if (error.code === 'rate_limited') showSlowDown();
  else if (error.isRetryable) offerRetry();
  else if (error.isUnauthenticated) startAgain();
}
```

`invalid`, `rate_limited`, `too_large`, `conversation_closed`, `conversation_changed`,
`unauthenticated`, `conflict` and `server_error` come from the platform. `offline`, `timeout`,
`no_session`, `empty`, `not_found`, `bad_response`, `missing_credential`, `request_failed` and
`tool_refused` are this client's. A refusal keeps the server's whole body on `error.details` — a
rejected contact carries the record it collided with, a validation failure carries the fields.

---

## Limits, and one platform note

**Thirty messages a minute per visitor**, five session starts a minute per IP, four thousand characters
a message. The socket counts the same thirty the POST path does, so moving between them buys nothing.

**Any origin may boot any inbox it has the public key for.** `/api/chat/public/*` and `/sdk/*` are open
to every origin. It is a smaller opening than it sounds: those paths carry no cookie and no
`Authorization`, so a browser sends nothing of its own, and the public key already reached this data
through the hosted chat page. Everything else on the domain stays pinned to the platform's
`CORS_ORIGIN`.

**A session token is a thirty-day bearer secret in the visitor's own storage.** Treat it as one. It is
scoped to a single conversation, grants no read of anything else, and is revoked by the visitor closing
the chat or by the server refusing it — at which point this client clears it and emits
`unauthenticated`.

---

## The drop-in widget

For a site that wants a bubble rather than an interface, [`widget/cnct-widget.js`](widget/cnct-widget.js)
is the whole thing in one classic script:

```html
<script src="https://your-cnct-host/widget/v1/cnct-widget.js" data-inbox="…" async></script>
```

`data-position="left"` moves it, `data-color="#123456"` recolours the launcher, and
`window.CnctChat.open()` opens it from your own button. Everything a customer sees lives in an iframe —
not for tidiness, for containment: it runs on a stranger's page next to their CSS and their framework,
and an iframe is the only boundary the platform actually enforces.

---

## Working on the SDK

```bash
npm install     # also builds, via `prepare`
npm test        # against a mock CNCT — a real socket upgrade, real status codes
npm run build   # dist/ for the package, dist/hosted/ for the file CNCT serves
```

The tests run against a small mock platform in [`test/support/server.ts`](test/support/server.ts)
rather than a stubbed `fetch`. Every bug this SDK has had lived in the seam between the socket, the
headers and the status codes, and a stubbed `fetch` is exactly the seam a stub cannot fail at.

## Versioning

`/sdk/v1/cnct-chat.js` is a promise, not decoration. That file runs on other people's websites and we
cannot deploy to it — whatever is at that URL is what their page loads on its next reload. A change to
the shape of `createChatClient` becomes `/sdk/v2/` and leaves v1 where it is; only fixes land on v1.

The package is tagged, and a tag is what you should install. `main` moves.

## Licence

BSD 3-Clause. See [LICENSE](LICENSE).
