# The chat UI, in detail

`cnct-web-sdk/ui` is a ready-made chat interface on top of the headless client: one framework-free
custom element, `<cnct-chat>`, in its own Shadow DOM. The [README](../README.md) has the short
version. This page has the rest.

It is built only on the public headless API. Anything it does, your own interface can do too, with
the same calls.

## Two ways in

```js
import { defineCnctChat, mountChat } from 'cnct-web-sdk/ui';

// 1. The element. Attributes cover a page with no JavaScript of its own.
defineCnctChat();
// <cnct-chat public-key="your-inbox-public-key" language="ar" appearance="system"></cnct-chat>

// 2. A function, for an app that mounts it into a container of its own.
const chat = mountChat(document.querySelector('#support'), {
  client: 'your-inbox-public-key',
  onClose: () => panel.hide(),
});
chat.update({ language: 'en' });
chat.destroy();
```

`mountChat` fills its container, so give the container a height. The element is `display: block;
height: 100%`, with a minimum of 320px.

**Importing the module touches nothing.** It does not touch `window`, `document`, `HTMLElement` or
`customElements`, so a page rendered on a server can import it at the top of a file.
`defineCnctChat()` does nothing where there is no `customElements`.

## Options

The same options, by the same names, as the iOS and Android SDKs.

| Option     | Type                                          | Default                                      |
| ---------- | --------------------------------------------- | -------------------------------------------- |
| `client`   | a `CnctChatClient`, or an inbox's public key  | required                                     |
| `theme`    | `CnctChatTheme` (below)                       | the inbox's settings, then the built-in ones |
| `language` | `'auto'` / `'en'` / `'ar'`                    | the inbox's language, then the visitor's     |
| `strings`  | `{ en?: { key: 'words' }, ar?: { … } }`       | none                                         |
| `identity` | `{ userId, userHash, name?, email?, phone? }` | none: the visitor is anonymous               |
| `onClose`  | `() => void`, for the header's close button   | none, and no close button is drawn           |
| `onEvent`  | `(event) => void`, for analytics              | none                                         |
| `baseUrl`  | the CNCT host, with a public key only         | `https://app.doo.ooo`                        |

On the element, `public-key`, `base-url`, `language` and `appearance` are attributes. Everything else
goes through the `options` property or `element.update(options)`.

Given a public key, the interface makes its own client and closes its socket when it is destroyed.
Given a client, it uses that client and leaves it open: the client is yours.

### Events

`onEvent` receives `{ type: 'opened' }`, `{ type: 'started' }`, `{ type: 'sent', message }`,
`{ type: 'attachmentSent', attachment }`, `{ type: 'ended' }` and `{ type: 'rated', score, comment? }`.
The element also dispatches each one as a `cnct-event` DOM event, with the same object as `detail`.

## Theming

**Precedence: what the app passes, then the inbox's widget settings in the CNCT console, then the
built-in defaults**, token by token. So a business can brand the chat from the console with no code,
or pin any part of it in code.

| Token                               | Meaning                                    | Default                                              |
| ----------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `primary`                           | brand colour: send button, links, the mark | the inbox's `brand.color`, else `#b52d93`            |
| `onPrimary`                         | text and icons on `primary`                | black or white, whichever is readable                |
| `background`                        | the screen                                 | light `#ffffff`, dark `#0f1115`                      |
| `surface`                           | header, composer, cards                    | light `#f6f7f9`, dark `#171a21`                      |
| `text`                              | main text                                  | light `#111418`, dark `#eef0f3`                      |
| `textMuted`                         | timestamps, hints                          | light `#5b6573`, dark `#9aa3af`                      |
| `border`                            | dividers, outlines                         | light `#e3e6ea`, dark `#2a2f38`                      |
| `visitorBubble` / `onVisitorBubble` | the visitor's own messages                 | `primary` / `onPrimary`                              |
| `agentBubble` / `onAgentBubble`     | the team's and the assistant's messages    | `surface` / `text`                                   |
| `cornerRadius`                      | bubbles and cards, in pixels               | 18                                                   |
| `font`                              | a CSS `font-family`                        | the system's                                         |
| `logo`                              | the header image's URL                     | the inbox's `brand.avatarUrl`, else the first letter |
| `title`                             | the header title                           | the business's name                                  |
| `appearance`                        | `'light'` / `'dark'` / `'system'`          | the inbox's appearance (`auto` is `system`)          |
| `showPoweredBy`                     | the "Powered by CNCT" line                 | the inbox's `brand.showBranding`                     |

Light and dark each have their own colours. A colour at the top level applies to both appearances;
`light: { … }` and `dark: { … }` set colours for one only.

```js
mountChat(element, {
  client: 'your-inbox-public-key',
  theme: {
    primary: '#D7262E',
    cornerRadius: 8,
    font: '"Cairo", system-ui, sans-serif',
    logo: '/logo.svg',
    dark: { background: '#121212' },
  },
});
```

**The ink is worked out for you.** A `primary` set without an `onPrimary` gets black or white text,
whichever is readable. The rule is the same sRGB luminance rule the CNCT server and the hosted widget
use: luminance over 0.55 takes near-black, anything darker takes white.

### From a stylesheet

Every token is also a CSS custom property on the element: `--cnct-primary`, `--cnct-on-primary`,
`--cnct-background`, `--cnct-surface`, `--cnct-text`, `--cnct-text-muted`, `--cnct-border`,
`--cnct-visitor-bubble`, `--cnct-on-visitor-bubble`, `--cnct-agent-bubble`, `--cnct-on-agent-bubble`,
`--cnct-corner-radius` (a length) and `--cnct-font`.

```css
cnct-chat {
  --cnct-primary: #d7262e;
  --cnct-corner-radius: 8px;
  --cnct-font: 'Cairo', system-ui, sans-serif;
}
```

The stylesheet is the app's word too, so it wins over the inbox's settings. A stylesheet that sets only
`--cnct-primary` recolours the visitor's bubbles with it, and the ink on it is worked out from it.

## Arabic and right to left

- **Every word of the interface** is in English and Arabic. The table is `CNCT_STRINGS`, the same 129
  keys as `docs/chat-ui/strings.json`, which the iOS and Android SDKs share word for word. An app
  overrides any word, per language, with `strings`. A missing Arabic word falls back to English, never
  to its key.
- **`auto`** takes the first of the browser's languages that is Arabic or English, else English.
- **Arabic mirrors everything** by `dir="rtl"` on the interface's root. The stylesheet uses logical
  properties throughout, so nothing is hand-swapped. The visitor's own messages sit on the trailing
  side in both directions. Icons that point (send, the progress ring) flip.
- **Every piece of user text takes its own direction** with `dir="auto"`: message lines, names, the
  greeting, choice titles, file names and quotes. An Arabic message in an English chat reads right to
  left, and the reverse.
- **Phone numbers, email addresses and links stay left to right** inside Arabic text. Each is isolated
  in a `<bdi dir="ltr">`, so `+973 3311 2233` is never drawn as `2233 3311 +973`.
- **Digits are Latin in Arabic** (`ar-u-nu-latn`), as Gulf apps write them. Times and dates follow the
  interface's language.
- **The business's own words**, such as the greeting and flow text, are shown as written in either
  language.

## Attachments

The paperclip opens the system's own picker, with several files at once. On a phone that picker also
offers the camera and the photo library. Files can also be dragged onto the conversation or pasted
into the box. Each one shows as a chip above the composer: a thumbnail or the file's extension, its
name and size, a progress ring while it uploads, and a remove button. Send waits for uploads to finish.

The interface refuses, in a sentence and before anything is uploaded:

- an eleventh file;
- a file over 50 MB;
- a type the chat does not take.

HEIC photos are converted to JPEG where the browser can decode them, which Safari, where they come
from, can. Photos over 2560 px on the long side are downscaled. See
[CHAT.md](CHAT.md#files) for the limits and the accepted types.

In the thread, images show inline at their own aspect ratio, and a tap opens them full screen.
Escape, a tap outside or a swipe down closes them. Other files are cards: an icon by kind, the
file's name and size. A tap downloads the file with the visitor's token and saves it under its
original name.

## Accessibility

- Every control has a label in the chosen language, and every control is at least 44 × 44 pixels.
- Each message is introduced to a screen reader by who said it ("You:", "Sara:").
- Photos are announced as "Photo, 1.2 MB".
- The thread is a polite live region. It is redrawn by keyed reconciliation, so a new message is the
  only thing announced.
- Sizes are in `em`, so the interface follows the browser's font size.
- The default colours read at 4.5:1 or better in both appearances. A test holds them to it.

## The fixture

`cnct-web-sdk/ui/fixture` is the scripted conversation every CNCT platform renders for its tests and
screenshots. It runs through a fake transport, a fake socket and a fake uploader: no network, no key.
The client underneath is the real one, so what renders is what a visitor would see.

```js
import { mountChat } from 'cnct-web-sdk/ui';
import { createChatFixture } from 'cnct-web-sdk/ui/fixture';

mountChat(element, { client: await createChatFixture({ language: 'ar' }), language: 'ar' });
```

`state: 'ended'` opens the same conversation closed and waiting to be rated. `state: 'new'` opens on a
newcomer to an inbox that asks for a name first. `still: true` holds everything still, the way the
screenshots need it.
