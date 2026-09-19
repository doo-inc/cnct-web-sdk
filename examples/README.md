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
examples/browser/index.html?host=https://your-cnct-host&inbox=your-public-key
```

The Node ones take theirs from the environment:

```bash
CNCT_HOST=https://your-cnct-host CNCT_API_KEY=kaer_sk_… node examples/node/bookings.mjs
```
