/**
 * `cnct-web-sdk/ui` — a ready-made chat interface a business can brand, on the headless client.
 *
 * Two entry points, one interface:
 *
 * ```js
 * import { defineCnctChat, mountChat } from 'cnct-web-sdk/ui';
 *
 * defineCnctChat();                        // <cnct-chat public-key="…"></cnct-chat>
 * const chat = mountChat(document.querySelector('#support'), { client: 'the-inbox-public-key' });
 * chat.update({ language: 'ar' });
 * chat.destroy();
 * ```
 *
 * No framework and no runtime dependencies. **Importing this module touches nothing**: no `window`,
 * no `document`, no `HTMLElement`, no `customElements` — so a page rendered on a server can import it
 * at the top of a file, and the element class is only made when `defineCnctChat()` runs in a browser.
 */
import type { CnctChatClient } from '../chat/chat-client.js';
import { CnctError, CnctErrorCode } from '../errors.js';
import { CnctChatView, type CnctChatOptions } from './view.js';

export { CnctChatView, type CnctChatEvent, type CnctChatOptions } from './view.js';
export {
  CNCT_BASE_COLORS,
  CNCT_DEFAULT_PRIMARY,
  CNCT_DEFAULT_RADIUS,
  CNCT_SYSTEM_FONT,
  CNCT_THEME_VARIABLES,
  cssVariableName,
  readableInk,
  resolveAppearance,
  resolveTheme,
  themeVariables,
  type CnctChatColors,
  type CnctChatTheme,
  type CnctResolvedTheme,
} from './theme.js';
export {
  availabilityLine,
  fileSize,
  localeFor,
  pickLanguage,
  translator,
  type CnctChatLanguage,
  type CnctChatStrings,
  type Translate,
} from './i18n.js';
export { CNCT_STRINGS, type CnctStringKey } from './strings.js';

/** What `mountChat` hands back. */
export interface CnctChatHandle {
  /** Change any of the options. A different client or public key starts the interface again. */
  update(options: Partial<CnctChatOptions>): void;
  /** Take it off the page: the socket is closed if the interface made the client, and nothing is left behind. */
  destroy(): void;
  /** The element itself. */
  readonly element: CnctChatElement;
}

/** The `<cnct-chat>` element's own API, beyond `HTMLElement`'s. */
export interface CnctChatElement extends HTMLElement {
  options: CnctChatOptions | null;
  update(options: Partial<CnctChatOptions>): void;
  /** Put files in the tray, as a pick, a drop or a paste does. */
  addFiles(files: Iterable<File> | ArrayLike<File>): void;
}

const ATTRIBUTES = ['public-key', 'base-url', 'language', 'appearance'] as const;

/**
 * Registers `<cnct-chat>` (or the tag you name). Safe to call more than once, and a no-op where there
 * is no `customElements` — on a server, or in a test without a DOM — so it can sit in shared code.
 *
 * Attributes cover a page with no JavaScript of its own: `public-key`, `base-url`, `language`
 * (`auto` / `en` / `ar`) and `appearance` (`light` / `dark` / `system`). Everything else — a client
 * you built, the theme, your words, a signed-in user, the callbacks — is the `options` property, or
 * `element.update(options)`. Colours also come from CSS: `cnct-chat { --cnct-primary: #D7262E }`.
 */
export function defineCnctChat(tag = 'cnct-chat'): void {
  const registry = (globalThis as { customElements?: CustomElementRegistry }).customElements;
  if (!registry || registry.get(tag)) return;
  const Base = (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement;

  class Element extends Base implements CnctChatElement {
    static get observedAttributes(): readonly string[] {
      return ATTRIBUTES;
    }

    private view: CnctChatView | null = null;
    private given: CnctChatOptions | null = null;
    private teardown: ReturnType<typeof setTimeout> | null = null;

    constructor() {
      super();
      /**
       * `options` set on the element before `defineCnctChat()` ran is an own property that hides
       * the accessor — the usual custom-element upgrade trap. Taken back through the setter.
       */
      if (Object.prototype.hasOwnProperty.call(this, 'options')) {
        const early = (this as unknown as { options: CnctChatOptions | null }).options;
        delete (this as unknown as { options?: unknown }).options;
        this.given = early ? { ...early } : null;
      }
    }

    get options(): CnctChatOptions | null {
      return this.given;
    }

    set options(value: CnctChatOptions | null) {
      this.given = value ? { ...value } : null;
      this.refresh();
    }

    update(options: Partial<CnctChatOptions>): void {
      this.given = { ...(this.given ?? ({} as CnctChatOptions)), ...options };
      this.refresh();
    }

    addFiles(files: Iterable<File> | ArrayLike<File>): void {
      this.view?.addFiles(files);
    }

    connectedCallback(): void {
      // Moved rather than removed — a framework re-parenting it — keeps the conversation going.
      if (this.teardown) clearTimeout(this.teardown);
      this.teardown = null;
      this.refresh();
    }

    disconnectedCallback(): void {
      this.teardown = setTimeout(() => {
        this.view?.destroy();
        this.view = null;
      }, 0);
    }

    attributeChangedCallback(): void {
      if (this.isConnected) this.refresh();
    }

    /** The options as given, with the attributes filling what they did not say. */
    private resolved(): CnctChatOptions | null {
      const given = this.given;
      const client = given?.client ?? this.getAttribute('public-key') ?? '';
      if (!client) return null;
      const baseUrl = given?.baseUrl ?? this.getAttribute('base-url') ?? undefined;
      const language =
        given?.language ??
        (this.getAttribute('language') as CnctChatOptions['language']) ??
        undefined;
      const appearance = this.getAttribute('appearance') as 'light' | 'dark' | 'system' | null;
      const theme =
        appearance && !given?.theme?.appearance
          ? { ...(given?.theme ?? {}), appearance }
          : given?.theme;
      return {
        ...(given ?? {}),
        client: client as CnctChatClient | string,
        ...(baseUrl ? { baseUrl } : {}),
        ...(language ? { language } : {}),
        ...(theme ? { theme } : {}),
      };
    }

    private refresh(): void {
      if (!this.isConnected) return;
      const options = this.resolved();
      if (!options) return;
      if (this.view) return this.view.update(options);
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      this.view = new CnctChatView(this, shadow, options);
    }
  }

  registry.define(tag, Element);
}

/**
 * The interface inside `container`, which it fills — give the container a height. Returns a handle
 * to change its options and to take it away again.
 */
export function mountChat(container: HTMLElement, options: CnctChatOptions): CnctChatHandle {
  if (!container || typeof (container as HTMLElement).append !== 'function') {
    throw new CnctError('mountChat needs an element to mount into.', CnctErrorCode.invalid);
  }
  defineCnctChat();
  const element = document.createElement('cnct-chat') as CnctChatElement;
  element.style.height = '100%';
  element.options = options;
  container.append(element);
  return {
    element,
    update: (next) => element.update(next),
    destroy: () => element.remove(),
  };
}
