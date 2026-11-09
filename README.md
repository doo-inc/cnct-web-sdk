# CNCT for the web

The official CNCT SDK for browsers and Node: live chat, the calendar and tickets, against a CNCT
workspace, using the credentials CNCT issues you.

It comes in two layers, and you can stop at either:

- **`cnct-web-sdk/ui`** is a ready-made chat screen a business can brand: colours, font, corners,
  logo, light and dark, and its own wording. It speaks English and Arabic and sends files both ways.
  It is one framework-free custom element in its own Shadow DOM, so it drops into React, Vue, Svelte,
  a server-rendered page or none of those.
- **`cnct-web-sdk`** is the headless client the screen is built on: state and events, and no DOM at
  all. A business with a design system of its own builds its own interface on it. The UI uses only
  this client's public API, so anything the UI does, your interface can do too.

There are no runtime dependencies and no framework. The headless client runs in a browser, in Node, in
a service worker and in a one-file script.

> **Just want a chat bubble on your site?** You do not need any of this. In the CNCT console, open
> the inbox, go to Widget, and paste the one line it gives you — see [the widget](#the-drop-in-widget).

---

## Chat UI in 10 lines

```js
import { mountChat } from 'cnct-web-sdk/ui';

mountChat(document.querySelector('#support'), {
  client: 'your-inbox-public-key', // the inbox's public key, from the CNCT console
  theme: { primary: '#D7262E', cornerRadius: 8, logo: '/logo.svg' },
  language: 'auto', // or 'en' / 'ar'
  identity: await fetch('/cnct-identity').then((r) => r.json()), // optional: a signed-in user
  onClose: () => supportPanel.hide(), // optional: draws a close button in the header
  onEvent: (event) => analytics.track(`chat ${event.type}`), // optional
});
```

Give `#support` a height; the chat fills it. Or use the element, with no script of your own beyond
registering it:

```html
<cnct-chat public-key="your-inbox-public-key" language="ar" style="height: 600px"></cnct-chat>
<script type="module">
  import { defineCnctChat } from 'cnct-web-sdk/ui';
  defineCnctChat();
</script>
```

Without a theme, the screen takes the colour, logo, language and light or dark from the inbox's Widget
settings in the CNCT console. So a business can brand it there with no code, and change it later
without a release.

To see it without an account, run [`examples/ui`](examples/ui). It runs a scripted conversation with
no key and no network, and has switches for language, appearance and a custom theme.

[docs/UI.md](docs/UI.md) has everything below in more depth.

---

## Install

```bash
npm install github:doo-inc/cnct-web-sdk#v1.0.0
```

Pin a tag rather than `main` — [the latest is here](https://github.com/doo-inc/cnct-web-sdk/releases/latest).
What you ship is what your users run, and an SDK that moves under a released site is a bug report
nobody can reproduce.

Where there is no `git` — an Alpine container, most CI images — npm cannot resolve a `github:`
dependency at all. Every release attaches a packed tarball for exactly that case:

```bash
npm install https://github.com/doo-inc/cnct-web-sdk/releases/download/v1.0.0/cnct-web-sdk-1.0.0.tgz
```

For a page with no build step, the CNCT host serves a bundled copy of the headless chat client:

```html
<script type="module">
  import { createChatClient } from 'https://app.doo.ooo/sdk/v1/cnct-chat.js';
</script>
```

The two are the same code. The difference is one default, and it is [the host](#the-host).

`cnct-web-sdk/ui` adds 23 kB gzipped to a page, or 32 kB with the headless chat client it brings. An
app that imports only `cnct-web-sdk` pays nothing for it.

---

## Theming

**Precedence: what the app passes, then the inbox's Widget settings in the CNCT console, then the
built-in defaults**, token by token. An app that sets only `primary` still gets the console's logo.

| Token                               | What it colours or sets                   | Default                                            |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| `primary`                           | the send button, links, the header's mark | the inbox's brand colour, else `#b52d93`           |
| `onPrimary`                         | text and icons on `primary`               | black or white, whichever is readable              |
| `background`                        | the screen                                | light `#ffffff`, dark `#0f1115`                    |
| `surface`                           | the header, the composer, cards           | light `#f6f7f9`, dark `#171a21`                    |
| `text`                              | main text                                 | light `#111418`, dark `#eef0f3`                    |
| `textMuted`                         | timestamps, hints                         | light `#5b6573`, dark `#9aa3af`                    |
| `border`                            | dividers, outlines                        | light `#e3e6ea`, dark `#2a2f38`                    |
| `visitorBubble` / `onVisitorBubble` | the visitor's own messages                | `primary` / `onPrimary`                            |
| `agentBubble` / `onAgentBubble`     | the team's and the assistant's messages   | `surface` / `text`                                 |
| `cornerRadius`                      | bubbles and cards, in pixels              | 18                                                 |
| `font`                              | a CSS `font-family`                       | the system's                                       |
| `logo`                              | the header image                          | the inbox's logo, else the business's first letter |
| `title`                             | the header title                          | the business's name                                |
| `appearance`                        | `light`, `dark` or `system`               | the inbox's appearance                             |
| `showPoweredBy`                     | the "Powered by CNCT" line                | the inbox's setting                                |

Light and dark each have their own colours. A colour at the top level applies to both appearances;
`light: { … }` and `dark: { … }` set colours for one only:

```js
theme: { primary: '#D7262E', dark: { primary: '#FF6B6B', background: '#121212' } }
```

The same tokens are CSS custom properties on the element, kebab case, so a stylesheet can theme it
without JavaScript:

```css
cnct-chat {
  --cnct-primary: #d7262e;
  --cnct-corner-radius: 8px;
  --cnct-font: 'Cairo', system-ui, sans-serif;
}
```

Every word is yours to change too, per language, by its key in
[the shared string table](docs/chat-ui/strings.json):

```js
strings: { en: { writeMessage: 'Ask us anything…' }, ar: { writeMessage: 'اسألنا عن أي شيء…' } }
```

---

## Arabic and right to left

- **Every word of the interface is in English and Arabic.** The table has 129 keys, shared word for
  word with the iOS and Android SDKs. A missing Arabic word falls back to English, never to its key.
- **`language: 'auto'`** takes the first of the browser's languages that is Arabic or English, else
  English. Without a `language`, the inbox's own setting decides first.
- **Arabic mirrors the whole screen**: the header, the composer, which side bubbles sit on, the send
  icon, the progress ring. The visitor's own messages sit on the trailing side in both directions. It
  is done by `dir="rtl"` on the screen's root and logical CSS throughout, not by swapped margins.
- **Each piece of user text takes its own direction** (`dir="auto"`), whatever the interface's
  language: messages, names, the greeting, choices, file names. An Arabic message in an English chat
  reads right to left, and the reverse.
- **Phone numbers, email addresses and links stay left to right** inside Arabic, so
  `+973 3311 2233` is never drawn as `2233 3311 +973`.
- **Digits are Latin in Arabic**, as Gulf apps write them: `9:41 ص`. Times and dates follow the
  chosen language.
- **The business's own words are shown as written.** Choosing a language never translates the
  greeting or a flow's text.

---

## Attachments

Customers send photos and files, and see what the team sends back.

**The limits, which the server enforces and the SDK checks before uploading:**

- up to **10 files** a message, **50 MB** each;
- photos: JPEG, PNG, WebP and GIF;
- audio: AAC, MP3, Ogg, M4A and AMR;
- video: MP4, 3GP and QuickTime;
- documents: PDF, Word (`.doc`, `.docx`), Excel (`.xlsx`), plain text and CSV.

**HEIC is not accepted.** iPhones take photos in HEIC, so the SDK converts them to JPEG before upload,
where the browser can decode them (Safari, where HEIC photos come from). It also downscales any photo
over 2560 px on its long side, at JPEG quality 0.85, and never upscales. Other files go up untouched.

In the UI, the paperclip opens the system's own picker, and files can also be dragged in or pasted.
Each one shows as a chip with a progress ring. The eleventh file, a file over 50 MB, or a type not on
the list is refused in a sentence, before anything is sent. Photos in the thread open full screen;
other files download under their original name.

Headless, it is two steps: upload each file, then send the message with them.

```js
const problem = chat.checkAttachment(file, alreadyPicked); // null, or a CnctError to show
const attachment = await chat.upload(file, { onProgress: (fraction) => bar.set(fraction) });
await chat.send('Here is the receipt', { attachments: [attachment] });
```

---

## Signed-in users

A visitor is anonymous until they give a name or a number. If your site or app has its own sign-in,
tell CNCT who they are instead. Their conversations then follow them between devices and land on
their customer record.

Signing a user in takes a hash of their id, made with **the inbox's identity secret**. **The secret
lives on your server and nowhere else.** It is not a public key. Whoever holds it can sign in as any of
your customers and read their conversations, so it never goes in a page, an app, a bundle or a
repository.

On your server, for a user who is signed in to your site:

```js
import { createHmac } from 'node:crypto';

// GET /cnct-identity — behind your own login.
app.get('/cnct-identity', requireLogin, (req, res) => {
  const userId = String(req.user.id);
  const userHash = createHmac('sha256', process.env.CNCT_IDENTITY_SECRET)
    .update(userId)
    .digest('hex'); // lowercase hex
  res.json({ userId, userHash, name: req.user.name, email: req.user.email });
});
```

In the page, pass what it returns as `identity` to the UI, or to `chat.identify(identity)` headless.
The call carries the visitor's current session, so a conversation they started before signing in
comes with them. If the hash does not verify, or identity is not set up for the inbox, the failure is
logged for you and the customer still gets a working anonymous chat.

---

## The host

CNCT runs at **`https://app.doo.ooo`**, and that is where this SDK points unless you say otherwise.
One value decides where everything goes — HTTP and the WebSocket alike, because the socket origin is
derived from it rather than configured separately. There is nothing else to keep in step.

```js
import { Cnct } from 'cnct-web-sdk';

const cnct = new Cnct(); // https://app.doo.ooo — the same as CnctHosts.production
```

Pass `baseUrl` for anything else — CNCT behind your own domain, or a CNCT running on your laptop:

```js
const cnct = new Cnct({ baseUrl: 'http://localhost:3001' });
```

**Testing is not a different host.** What decides whether a booking is real is the key — a
[sandbox key](#sandbox-and-production) talks to the same `app.doo.ooo` and writes nothing real — so
there is no staging URL to remember to swap before you ship.

Before 0.2.0 the host was required and had no default, because the only CNCT deployment was a
development box and a default would have meant shipping to it by accident. `CnctHosts.development`
still compiles, and now points at production.

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

The copy CNCT serves at `https://app.doo.ooo/sdk/v1/cnct-chat.js` defaults `baseUrl` to the origin it
was fetched from — which is right there, precisely because it _was_ fetched from CNCT, and an
integrator cannot get it wrong or even has to be told it.

Installed from npm and bundled into your own site, "the origin I came from" would be **your** domain,
where there is no CNCT to answer. So the package defaults to CNCT production instead, and the hosted
file to its own origin. Nothing else differs between them.

---

## Two credentials, two doors

Which parts of this SDK you can use is decided entirely by what CNCT gave you. They are not
interchangeable, and the difference is not convenience — it is what happens when one leaks.

| Credential                | Opens                   | Where it belongs                                                                                                                                                          |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CnctChatPublicKey('…')`  | Live chat, as a visitor | **In your bundle.** It identifies an inbox, not a person, and it is already public — it is in the URL of the hosted chat page.                                            |
| `CnctApiKey('kaer_sk_…')` | Bookings and tickets    | **On a server you control.** It is account-wide: it can book for, and cancel for, anybody. Never in a page. Mint one in the CNCT console under **Settings → Developers**. |

The SDK will tell you what it holds, which is useful for an app that hides the tabs it cannot serve
rather than discovering the answer with a 401 in front of a customer:

```js
Cnct.modulesFor(credentials); // ['chat'] | ['bookings', 'tickets']
```

Tickets also need the account to hold ticketing. `agent.catalogue()` lists exactly the tools a
particular account offers, so read that rather than assuming.

`CnctApiKey` has `assertNotInBrowser()` for the mistake that matters: call it at startup and a key
that has found its way into a bundle crashes in development rather than leaking in production.

0.1.x had a third, `CnctOperatorToken`, for the contact directory on a staff member's own
login. It is gone — see [docs/MIGRATING.md](docs/MIGRATING.md).

---

## Sandbox and production

An API key comes in two kinds, and the key says which. The account's owner or an admin mints either
in the CNCT console, under **Settings → Developers**.

|                      | Sandbox — `kaer_sk_test_…`                             | Production — `kaer_sk_live_…`         |
| -------------------- | ------------------------------------------------------ | ------------------------------------- |
| Reads                | The real account: services, people, hours, what's free | The same                              |
| Book, move, cancel   | Kept in the account's sandbox, and findable again      | The real calendar                     |
| Raise a ticket       | Kept in the sandbox, numbered from 1                   | The real queue                        |
| Customers            | Never contacted, never looked up, never created        | Texted and filed as the account's own |
| Seen by the business | Never — not the calendar, the queue or the reports     | Everywhere                            |

Everything else is identical, and deliberately: a sandbox key runs **the same tools, the same
validation and the same refusals** as production — a time that is not free, a ticket field that does
not exist, a change inside the cancellation window are refused in production's own words. So an
integration that works in sandbox is an integration that works, and going live is swapping the key.

```js
const key = new CnctApiKey(process.env.CNCT_API_KEY);
key.mode; // 'sandbox' | 'production'
key.isSandbox; // true for kaer_sk_test_…

const agent = new Cnct().agent(key);
const booking = await agent.bookings.create({ startsAt, customerPhone: '+97312345678' });
booking.sandbox; // true — kept so you can find, move and cancel it, but nobody will ever see it
```

`catalogue()` returns `sandbox` too, which is the cheapest way to confirm which key a server is
running with. Keys minted before there were two kinds are plain `kaer_sk_…`, and are production.

Two things worth knowing:

- **A sandbox booking does not take its slot.** Availability is the real calendar's, so the same free
  time can be booked twice in sandbox. It is the one place sandbox is less faithful than production,
  and it is on purpose: taking the slot would block a real customer.
- **One sandbox per account**, shared by all its sandbox keys. Settings → Developers says what it holds
  and empties it.

Live chat has no sandbox mode — its credential is an inbox's public key, not an API key. To build a
chat interface without landing in the team's real queue, ask for a second web inbox and use its key.

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

| Field           | What it is                                                                               |
| --------------- | ---------------------------------------------------------------------------------------- |
| `status`        | `idle` before a session, then `connecting` / `live` / `offline`, and `ended` once closed |
| `inbox`         | What `boot()` returned                                                                   |
| `conversation`  | `{ id, status, startedAt, withPerson, assignee, rating, seenAt, … }`                     |
| `messages`      | Oldest first, with `pending` and `failed` on the visitor's own                           |
| `theyAreTyping` | True while the other side is typing; clears itself                                       |
| `error`         | The last failure, or null                                                                |

`speaker` is `CALLER` (them), `AI`, `OPERATOR` or `SYSTEM`; `sender` says which person or assistant,
by first name and face and nothing more. The public surface is an explicit allowlist, not a stripped
copy of the internal one, and it stays that way whatever gets added to the database later.

`chat.canSend` is the one derived thing worth having: false before a session and once a conversation is
closed.

### The methods

|                                  |                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `boot()`                         | The inbox's greeting and whether it is open. No session needed.                                        |
| `start({ displayName, phone })`  | Begin, or resume as the same person. Opens the socket.                                                 |
| `resume()`                       | Pick up after a reload. Resolves to `null` when there is nothing to pick up.                           |
| `send(body, { clientKey })`      | Say something. Resolves with the stored message.                                                       |
| `retry(clientKey)`               | Re-send a failed message. Safe — see idempotency below.                                                |
| `typing()`                       | Tell the other side. Throttled here and again on the server.                                           |
| `end()`                          | The visitor closes it.                                                                                 |
| `fetchAttachment(attachment)`    | The bytes of a file, either way, as a `Blob`. Cached by id.                                            |
| `upload(file, { onProgress })`   | Upload one file for `send(body, { attachments })` to carry. Checked, and HEIC made JPEG, first.        |
| `choose(choice)`                 | Send a flow choice the visitor tapped: its title, with its id as `replyId`.                            |
| `identify(identity)`             | Sign the visitor in as one of your users. The anonymous conversation moves across.                     |
| `listConversations()`            | Up to fifty of this visitor's conversations. `getConversation(id)` reads one.                          |
| `read()`                         | Tell the team their reply is on screen. Posts once per reply.                                          |
| `rate(score, { comment })`       | Rate a closed conversation, 1 to 5.                                                                    |
| `updateProfile({ displayName })` | Give a name, after starting anonymously.                                                               |
| `connect()` / `disconnect()`     | Open or drop the socket by hand. Safe at any moment — mid-handshake, and one straight after the other. |
| `on(event, handler)`             | Returns the unsubscribe.                                                                               |

Events: `change`, `message`, `messageUpdated`, `read`, `typing`, `conversation`, `closed`, `connected`,
`disconnected`, `unauthenticated`, `error`.

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

A message may carry `attachments`, either way; [Attachments](#attachments) above covers sending them.
Fetching one needs the session token on a header, so **a plain `<img src>` will not work** — that is
deliberate, because a credential in a query string ends up in referrers, logs and the address bar:

```js
const blob = await chat.fetchAttachment(attachment); // fetched once per id, however often you ask
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

A visitor is anonymous until they give a name — `updateProfile({ displayName })`, or `start()` with
one — or a number, or until your site signs them in with `identify()`. See
[Signed-in users](#signed-in-users).

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

**Strict mode is fine.** React runs that effect twice in development, so the client is asked to
`resume()`, `disconnect()` and `resume()` again within a tick or two — a socket abandoned before its
handshake finished, and a replacement opened before the first one's close comes back. Neither throws
and neither reports the live socket gone; the client tells its own socket from one it has walked away
from, and nothing else in your component has to know.

---

## Bookings and tickets

**Server-side only.** The credential is account-wide: it can read and write bookings and tickets for
every customer the account has. The intended shape is your page talking to your backend, and your
backend holding the key.

```js
import { Cnct, CnctApiKey } from 'cnct-web-sdk';

const agent = new Cnct().agent(new CnctApiKey(process.env.CNCT_API_KEY));

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

### Tickets, and following one up

A ticket is work the business could not finish in the moment and hands to a colleague. Raising one,
and then answering the customer who comes back asking about it:

```js
// "Any news on my refund?"
const [open] = (await agent.tickets.forCustomer(phone, { q: 'refund' })).items;
const ticket = await agent.tickets.get(phone, open.ticketNumber);
ticket.status; // 'WAITING'
ticket.waitingOnCustomer; // true — they are waiting on an answer from the customer
ticket.history; // [{ on: '2026-09-18', what: 'Raised' }, { on: '2026-09-19', what: 'Waiting on the customer' }]

// "The order number is 881"
const added = await agent.tickets.addTo({
  customerPhone: phone,
  ticketNumber: ticket.ticketNumber,
  note: 'The order number is 881',
});
added.resumed; // true — it was waiting on them, and is being worked on again
```

**`get` is safe to show the customer it belongs to** — it carries no names, no team and none of the
notes staff write for each other. **`addTo` is what a follow-up is for**: raising a second ticket about
the same thing splits the story in two. A finished ticket refuses it, and the refusal says to raise a
new one.

Four things worth knowing before you build on it, all covered in
[docs/BOOKINGS-AND-TICKETS.md](docs/BOOKINGS-AND-TICKETS.md):

- **Pass `startsAt` back exactly as the slot gave it.** Rebuilding it from a parsed `Date` is how a
  booking lands on a time nobody offered.
- **An empty list is often an instruction rather than an absence.** No people means "this business
  assigns whoever is free — do not offer a choice". The `note` says which case you are in.
- **`agent.call(tool, args)` reaches any tool the platform adds later**, on the day it ships, without
  waiting for a release here.
- **It talks to `/api/tools`.** CNCT serves that since 2026-09-29, and still answers the old
  `/api/booking-tools` that 0.1.x used.

### The same tools, for an AI agent

This SDK is the REST side. The same key opens the same tools over MCP, at
**`https://app.doo.ooo/api/mcp`** with the key as a bearer token — point Claude Desktop, an Agent SDK
tool runner or any other MCP client there and it discovers them on its own. MCP also carries one tool
REST does not: `request_operator`, for handing a live phone call to a person.

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
`tool_refused` are this client's, as are `too_many_files`, `file_too_large` and
`unsupported_file_type`, said about a file before anything is uploaded, and `cancelled` for an upload
you aborted. A refusal keeps the server's whole body on `error.details` — a refused tool call carries
everything the tool answered, a validation failure carries the fields.

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
<script src="https://app.doo.ooo/widget/v1/cnct-widget.js" data-inbox="…" async></script>
```

`data-position="left"` moves it, `data-color="#123456"` recolours the launcher, and
`window.CnctChat.open()` opens it from your own button. Everything a customer sees lives in an iframe —
not for tidiness, for containment: it runs on a stranger's page next to their CSS and their framework,
and an iframe is the only boundary the platform actually enforces.

---

## Working on the SDK

```bash
npm install              # also builds, via `prepare`
npm test                 # against a mock CNCT — a real socket upgrade, real status codes
npm run build            # dist/ for the package, dist/hosted/ for the file CNCT serves
npm run screenshots      # the UI on the fixture, in Chromium: screenshots/*.png
npm run size             # what cnct-web-sdk/ui costs a page, gzipped
```

The UI's tests run in happy-dom against the same headless client, over a scripted CNCT in memory.
CI also renders it in Chromium for ten screenshots: English and Arabic, light and dark, a custom
theme, the end of a conversation and the name-first start. They are uploaded as the `screenshots`
artifact of every run, and each run checks the direction, overflow, touch targets and the theme
before it shoots.

The tests run against a small mock platform in [`test/support/server.ts`](test/support/server.ts)
rather than a stubbed `fetch`. Every bug this SDK has had lived in the seam between the socket, the
headers and the status codes, and a stubbed `fetch` is exactly the seam a stub cannot fail at.

## Versioning

`/sdk/v1/cnct-chat.js` is a promise, not decoration. That file runs on other people's websites and we
cannot deploy to it — whatever is at that URL is what their page loads on its next reload. A change to
the shape of `createChatClient` becomes `/sdk/v2/` and leaves v1 where it is; only fixes land on v1.

The package is tagged, and a tag is what you should install. `main` moves. 1.0.0 is the first release
with the UI, and it shipped together with the iOS and Android SDKs from one spec,
[`docs/chat-ui/SPEC.md`](docs/chat-ui/SPEC.md).

## Licence

BSD 3-Clause. See [LICENSE](LICENSE).
