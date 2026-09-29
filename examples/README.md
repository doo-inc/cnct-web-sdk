# Examples

Three, each showing one credential.

|                                            |                                       |                    |
| ------------------------------------------ | ------------------------------------- | ------------------ |
| [`browser/index.html`](browser/index.html) | A whole chat interface, no build step | Inbox public key   |
| [`react/Chat.jsx`](react/Chat.jsx)         | The same thing as a component         | Inbox public key   |
| [`node/bookings.mjs`](node/bookings.mjs)   | Availability → booking, server-side   | `kaer_sk_` API key |
| [`node/contacts.mjs`](node/contacts.mjs)   | Sign in, page the directory           | Operator login     |

The browser example loads the SDK straight from the CNCT host, so it needs nothing installed — open it
with your host and inbox key in the URL:

```
examples/browser/index.html?host=https://app.doo.ooo&inbox=your-public-key
```

The Node ones take theirs from the environment. `CNCT_HOST` is optional — without it they go to
`https://app.doo.ooo` — and a sandbox key (`kaer_sk_test_…`, from **Settings → Developers**) is the one
to run the bookings example with: it books, cancels and texts nobody.

```bash
CNCT_API_KEY=kaer_sk_test_… node examples/node/bookings.mjs
```
