import { CnctAttachmentLimits } from '../chat/attachments.js';
import { CnctChatClient } from '../chat/chat-client.js';
import type {
  CnctChatAttachment,
  CnctChatFlowChoice,
  CnctChatIdentity,
  CnctChatMessage,
  CnctChatSender,
  CnctChatState,
} from '../chat/types.js';
import { CnctError, CnctErrorCode } from '../errors.js';
import { button, el, icon, progressRing, ratingFace, setRing, srOnly, userText } from './dom.js';
import {
  availabilityLine,
  clockTime,
  dayLabel,
  endedLine,
  fileSize,
  pickLanguage,
  translator,
  type CnctChatLanguage,
  type CnctChatStrings,
  type Translate,
} from './i18n.js';
import { CNCT_CHAT_CSS } from './styles.js';
import { messageText } from './text.js';
import {
  resolveTheme,
  themeVariables,
  type CnctChatTheme,
  type CnctResolvedTheme,
} from './theme.js';

/** What every entry point takes — the same options, by the same names, on every CNCT platform. */
export interface CnctChatOptions {
  /** The headless chat client, or an inbox's public key (the interface then makes and owns one). */
  client: CnctChatClient | string;
  /** Only with a public key: the CNCT host. Defaults to production, `https://app.doo.ooo`. */
  baseUrl?: string;
  /** How it looks. App first, then the inbox's settings, then the defaults. */
  theme?: CnctChatTheme;
  /** Default: the inbox's language, then the visitor's own. */
  language?: 'auto' | 'en' | 'ar';
  /** Per-language overrides of any of the interface's words, by key. */
  strings?: CnctChatStrings;
  /** A signed-in user of your site. Applied before anything else; a failure is logged, not shown. */
  identity?: CnctChatIdentity | null;
  /** Called by the header's close button. The button is not drawn without it. */
  onClose?: () => void;
  /** For analytics: opened, started, sent, attachment sent, ended, rated. */
  onEvent?: (event: CnctChatEvent) => void;
}

/** What the interface reports to `onEvent`, and as a `cnct-event` DOM event on the element. */
export type CnctChatEvent =
  | { type: 'opened' }
  | { type: 'started' }
  | { type: 'sent'; message: CnctChatMessage }
  | { type: 'attachmentSent'; attachment: CnctChatAttachment }
  | { type: 'ended' }
  | { type: 'rated'; score: number; comment?: string };

type Screen = 'loading' | 'invalid' | 'unavailable' | 'off' | 'details' | 'chat';

interface Picked {
  key: string;
  file: File;
  name: string;
  image: boolean;
  url: string | null;
  progress: number;
  status: 'uploading' | 'done' | 'failed';
  attachment: CnctChatAttachment | null;
  controller: AbortController;
  node?: HTMLElement;
  ring?: SVGSVGElement;
}

/** The kind of keyboard, and the words in the box, for each answer a flow can ask for. */
const ANSWER = {
  name: ['text', 'answerName'],
  number: ['decimal', 'answerNumber'],
  email: ['email', 'answerEmail'],
  phone: ['tel', 'answerPhone'],
  date: ['text', 'answerDate'],
} as const;

const ACCEPT = [
  ...CnctAttachmentLimits.types,
  'image/heic',
  'image/heif',
  '.heic',
  '.heif',
  '.doc',
  '.docx',
  '.xlsx',
  '.csv',
  '.txt',
  '.pdf',
].join(',');

const isTeam = (m: CnctChatMessage) => m.speaker === 'OPERATOR' || m.speaker === 'AI';
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';
const initial = (name: string) => (name || '?').trim().charAt(0).toLocaleUpperCase() || '?';
const keyOf = (m: CnctChatMessage) => m.clientKey || m.id;

/**
 * The conversation screen, drawn into a shadow root, over nothing but the public headless client.
 *
 * It renders from `client.state` on every change — the transcript is always the client's, never a
 * copy kept here — and holds only what is the interface's own: which screen is showing, the files
 * picked and on their way up, what is half-typed into a card, and which photo is open.
 */
export class CnctChatView {
  private options: CnctChatOptions;
  private client!: CnctChatClient;
  private ownsClient = false;
  private clientSource: unknown;
  private offClient: (() => void)[] = [];
  private readonly offDom: (() => void)[] = [];

  private screen: Screen = 'loading';
  /** A new conversation with nothing sent yet: the greeting and a composer, and no session. */
  private fresh = false;
  /** The words of a first message, shown while the session it starts is being made. */
  private starting: { text: string; at: string } | null = null;
  private confirming = false;
  private notice = '';
  private introBusy = false;
  private introError = '';
  private picked: Picked[] = [];
  private justNamed = '';
  private details = { name: '', phone: '', busy: false, error: '' };
  private rating: {
    stage: 'faces' | 'comment' | 'done';
    score: number;
    comment: string;
    busy: boolean;
    error: string;
  } = {
    stage: 'faces',
    score: 0,
    comment: '',
    busy: false,
    error: '',
  };
  private dragDepth = 0;
  private opened = false;
  private endedReported: string | null = null;
  private generation = 0;
  private identityKey = '';

  /** Each file's blob URL, made once — the thread is redrawn on every message. */
  private readonly urls = new Map<string, string>();
  /** Each attachment's node, built once, so a redraw never reloads a photo. */
  private readonly fileNodes = new Map<string, HTMLElement>();
  /** Thread rows, keyed, so a redraw only touches what changed and a screen reader hears only that. */
  private rows = new Map<string, { sig: string; node: HTMLElement }>();
  private cardsSig = '';
  private introSig = '';
  private pinned = true;
  private paintQueued = false;
  private observer: IntersectionObserver | null = null;
  private watchedReply: Element | null = null;
  private viewerReturn: HTMLElement | null = null;
  private dark: MediaQueryList | null = null;
  private language: CnctChatLanguage = 'en';
  private t: Translate = translator('en');
  private theme!: CnctResolvedTheme;

  // The skeleton, built once.
  private readonly wrap: HTMLDivElement;
  private readonly logo = el('div', 'logo');
  private readonly title = userText('div', 'title', '');
  private readonly status = el('div', 'status');
  private readonly endButton = button('ghost');
  private readonly closeButton = button('close');
  private readonly banner = el('div', 'banner hidden');
  private readonly body = el('div', 'body');
  private readonly center = el('div', 'center');
  private readonly intro = el('div', 'intro');
  private readonly chat = el('section', 'chat');
  private readonly thread = el('div', 'thread');
  private readonly messages = el('div', 'messages');
  private readonly cards = el('div', 'cards');
  private readonly foot = el('div', 'foot');
  private readonly error = el('p', 'error hidden');
  private readonly tray = el('div', 'uploads hidden');
  private readonly composer = el('form', 'row');
  private readonly attach = button('tool');
  private readonly fileInput = el('input', 'sr');
  private readonly text = el('textarea', 'text');
  private readonly send = el('button', 'send');
  private readonly confirmBar = el('div', 'confirm hidden');
  private readonly closedBar = el('div', 'closed hidden');
  private readonly powered = el('div', 'powered');
  private readonly drop = el('div', 'drop hidden');
  private viewer: HTMLDivElement | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly shadow: ShadowRoot,
    options: CnctChatOptions,
  ) {
    this.options = { ...options };
    const style = el('style');
    style.textContent = CNCT_CHAT_CSS;
    this.wrap = el('div', 'cnct');
    this.shadow.replaceChildren(style, this.wrap);
    this.build();
    this.watchSystemAppearance();
    this.useClient();
    void this.boot();
  }

  // ── The outside ──────────────────────────────────────────────────────────────────────────────

  update(options: Partial<CnctChatOptions>): void {
    const before = this.options;
    this.options = { ...before, ...options };
    const source = this.options.client;
    if (source !== this.clientSource || this.options.baseUrl !== before.baseUrl) {
      this.resetForNewClient();
      this.useClient();
      void this.boot();
      return;
    }
    if (identityKeyOf(this.options.identity) !== this.identityKey && this.screen !== 'loading') {
      void this.applyIdentity().then(() => this.landAfterIdentity());
    }
    this.paint();
  }

  destroy(): void {
    this.generation += 1;
    this.releaseClient();
    for (const off of this.offDom) off();
    this.offDom.length = 0;
    this.observer?.disconnect();
    for (const one of this.picked) one.controller.abort();
    this.revokeAll();
    this.shadow.replaceChildren();
  }

  /** Put files in the tray, as a pick, a drop or a paste does. */
  addFiles(files: Iterable<File> | ArrayLike<File>): void {
    const list = Array.from(files as ArrayLike<File>);
    if (!list.length || !this.canAttach()) return;
    this.notice = '';
    for (const file of list) {
      const name = file.name || this.t('attachment');
      const problem = this.client.checkAttachment(file, this.picked.length);
      if (problem?.code === CnctErrorCode.tooMany) {
        this.notice = this.t('tooMany');
        break;
      }
      if (problem) {
        this.notice =
          problem.code === CnctErrorCode.tooLarge
            ? this.t('tooBig', { name })
            : this.t('uploadFailed', { name });
        continue;
      }
      const image = (file.type || '').startsWith('image/');
      const one: Picked = {
        key: uid(),
        file,
        name,
        image,
        url: image && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null,
        progress: 0,
        status: 'uploading',
        attachment: null,
        controller: new AbortController(),
      };
      this.picked.push(one);
      void this.uploadOne(one);
    }
    this.paintUploads();
    this.paintNotice();
    this.text.focus({ preventScroll: true });
  }

  // ── The client ───────────────────────────────────────────────────────────────────────────────

  private useClient(): void {
    const source = this.options.client;
    this.clientSource = source;
    if (source instanceof CnctChatClient) {
      this.client = source;
      this.ownsClient = false;
    } else if (typeof source === 'string' && source.trim()) {
      // The chat client alone: `Cnct` would bring the bookings and tickets client along with it.
      this.client = new CnctChatClient({
        config: this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {},
        credentials: source,
      });
      this.ownsClient = true;
    } else {
      throw new CnctError(
        'Pass `client`: a chat client, or an inbox public key.',
        CnctErrorCode.missingCredential,
      );
    }
    this.offClient = [
      this.client.on('change', () => this.render()),
      this.client.on('closed', () => this.reportEnded()),
      this.client.on('unauthenticated', () => {
        this.fresh = true;
        this.screen = this.wantsDetails() ? 'details' : 'chat';
        this.render();
      }),
    ];
  }

  private releaseClient(): void {
    for (const off of this.offClient) off();
    this.offClient = [];
    if (this.ownsClient) this.client?.disconnect();
  }

  private resetForNewClient(): void {
    this.generation += 1;
    this.releaseClient();
    for (const one of this.picked) one.controller.abort();
    this.picked = [];
    this.revokeAll();
    this.rows.clear();
    this.cardsSig = '';
    this.screen = 'loading';
    this.fresh = false;
    this.opened = false;
  }

  private emit(event: CnctChatEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch (error) {
      console.error('[cnct] onEvent threw', error);
    }
    this.host.dispatchEvent(
      new CustomEvent('cnct-event', { detail: event, bubbles: true, composed: true }),
    );
  }

  /**
   * Opening: the inbox, then whether it is taking chats, then — before any history is read — who
   * the visitor is, then their conversation if a stored token has one.
   */
  private async boot(): Promise<void> {
    const generation = ++this.generation;
    const stale = () => generation !== this.generation;
    this.screen = 'loading';
    this.paint();
    let inbox;
    try {
      inbox = await this.client.boot();
    } catch (error) {
      if (stale()) return;
      this.screen = (error as CnctError)?.status === 404 ? 'invalid' : 'unavailable';
      return this.paint();
    }
    if (stale()) return;
    if (!inbox.isActive) {
      this.screen = 'off';
      return this.paint();
    }
    await this.applyIdentity();
    if (stale()) return;
    let resumed = null;
    try {
      resumed = await this.client.resume();
    } catch {
      // A conversation that cannot be read back right now is not a reason to refuse a new one.
    }
    if (stale()) return;
    this.fresh = !resumed?.conversation;
    this.screen = this.fresh && this.wantsDetails() ? 'details' : 'chat';
    this.paint();
    if (!this.opened) {
      this.opened = true;
      this.emit({ type: 'opened' });
    }
  }

  /** A failed sign-in is said in the console for the site's developer; the visitor chats anonymously. */
  private async applyIdentity(): Promise<void> {
    const identity = this.options.identity;
    this.identityKey = identityKeyOf(identity);
    if (!identity) return;
    try {
      await this.client.identify(identity);
    } catch (error) {
      console.warn(`[cnct] Could not sign this visitor in: ${(error as Error)?.message ?? error}`);
    }
  }

  private async landAfterIdentity(): Promise<void> {
    const resumed = await this.client.resume().catch(() => null);
    this.fresh = !resumed?.conversation;
    this.screen = this.fresh && this.wantsDetails() ? 'details' : 'chat';
    this.paint();
  }

  private wantsDetails(): boolean {
    const visitor = this.client.state.visitor;
    const named = Boolean(visitor && visitor.anonymous === false);
    return this.client.state.inbox?.widget.chat.start === 'details' && !named;
  }

  // ── Doing things ─────────────────────────────────────────────────────────────────────────────

  private get state(): CnctChatState {
    return this.client.state;
  }

  private get live(): boolean {
    if (this.fresh) return true;
    return this.state.status !== 'ended' && this.state.conversation?.status !== 'CLOSED';
  }

  /** The conversation exists on the server, started now if this is the first thing they do. */
  private async ensureSession(
    details: { displayName?: string; phone?: string } = {},
  ): Promise<void> {
    if (!this.fresh && this.client.hasSession && this.client.canSend) return;
    await this.client.ensureSession(details);
    if (this.fresh) {
      this.fresh = false;
      this.resetConversationUi();
      this.emit({ type: 'started' });
    }
  }

  private resetConversationUi(): void {
    this.rating = { stage: 'faces', score: 0, comment: '', busy: false, error: '' };
    this.endedReported = null;
    this.confirming = false;
    this.cardsSig = '';
  }

  private async submit(): Promise<void> {
    if (!this.live) return;
    if (this.picked.some((one) => one.status === 'uploading')) return;
    const body = this.text.value.trim();
    const files = this.picked.filter((one) => one.status === 'done' && one.attachment);
    if (!body && !files.length) return;
    const attachments = files.map((one) => one.attachment!) as CnctChatAttachment[];
    // Sent, so out of the tray — but the pictures stay, as the bubble's, from this device.
    for (const one of files)
      if (one.url && one.attachment) this.urls.set(one.attachment.id, one.url);
    this.picked = this.picked.filter((one) => !files.includes(one));
    this.text.value = '';
    this.grow();
    this.notice = '';
    this.pinned = true;
    this.paintUploads();

    if (this.fresh || !this.client.hasSession) {
      this.starting = { text: body, at: new Date().toISOString() };
      this.paint();
      try {
        await this.ensureSession();
      } catch (error) {
        this.starting = null;
        this.text.value = body;
        this.notice =
          (error as CnctError)?.code === CnctErrorCode.rateLimited
            ? this.t('tooManyChats')
            : this.t('genericError');
        return this.paint();
      }
      this.starting = null;
    }
    try {
      const message = await this.client.send(body, { attachments });
      this.reportSent(message, attachments);
    } catch (error) {
      this.afterSendFailure(error);
    }
  }

  private async choose(choice: CnctChatFlowChoice): Promise<void> {
    if (!this.live) return;
    this.pinned = true;
    try {
      this.reportSent(await this.client.choose(choice), []);
    } catch (error) {
      this.afterSendFailure(error);
    }
  }

  private async say(words: string): Promise<void> {
    this.pinned = true;
    try {
      this.reportSent(await this.client.send(words), []);
    } catch (error) {
      this.afterSendFailure(error);
    }
  }

  private async retry(clientKey: string): Promise<void> {
    try {
      this.reportSent(await this.client.retry(clientKey), []);
    } catch (error) {
      this.afterSendFailure(error);
    }
  }

  private reportSent(message: CnctChatMessage, attachments: CnctChatAttachment[]): void {
    this.emit({ type: 'sent', message });
    for (const attachment of attachments) this.emit({ type: 'attachmentSent', attachment });
  }

  private afterSendFailure(error: unknown): void {
    const code = (error as CnctError)?.code;
    // The bubble already says it was not sent; only a rate limit needs a sentence of its own.
    if (code === CnctErrorCode.rateLimited) this.notice = this.t('slowDown');
    if (code === CnctErrorCode.conversationClosed) void this.client.resume().catch(() => {});
    this.paint();
  }

  private async uploadOne(one: Picked): Promise<void> {
    try {
      await this.ensureSession();
    } catch (error) {
      return this.failUpload(
        one,
        (error as CnctError)?.code === CnctErrorCode.rateLimited
          ? this.t('tooManyChats')
          : this.t('genericError'),
      );
    }
    if (!this.picked.includes(one)) return;
    try {
      one.attachment = await this.client.upload(one.file, {
        filename: one.name,
        signal: one.controller.signal,
        onProgress: (fraction) => {
          one.progress = fraction;
          this.paintChip(one);
        },
      });
      one.status = 'done';
      one.progress = 1;
      // The server's copy, when it comes back on the message, is drawn from the file on this device.
      if (one.url) this.urls.set(one.attachment.id, one.url);
      this.paintUploads();
    } catch (error) {
      const code = (error as CnctError)?.code;
      if (code === CnctErrorCode.cancelled || !this.picked.includes(one)) return;
      if (code === CnctErrorCode.conversationClosed) void this.client.resume().catch(() => {});
      this.failUpload(
        one,
        code === CnctErrorCode.tooLarge
          ? this.t('tooBig', { name: one.name })
          : this.t('uploadFailed', { name: one.name }),
      );
    }
  }

  private failUpload(one: Picked, message: string): void {
    if (!this.picked.includes(one)) return;
    one.status = 'failed';
    this.notice = message;
    this.paintUploads();
    this.paintNotice();
  }

  private removeUpload(one: Picked): void {
    one.controller.abort();
    if (one.url && !(one.attachment && this.urls.get(one.attachment.id) === one.url))
      URL.revokeObjectURL(one.url);
    this.picked = this.picked.filter((other) => other !== one);
    this.paintUploads();
    this.text.focus({ preventScroll: true });
  }

  private canAttach(): boolean {
    return (
      this.screen === 'chat' &&
      this.live &&
      !this.confirming &&
      Boolean(this.state.inbox?.widget.chat.allowAttachments)
    );
  }

  private async endConversation(): Promise<void> {
    this.confirming = false;
    try {
      await this.client.end();
    } catch {
      // Ending is the visitor's way out; it should never be the thing that fails.
    }
    this.reportEnded();
    this.paint();
  }

  private reportEnded(): void {
    const id = this.state.conversation?.id ?? 'current';
    if (this.endedReported === id) return;
    this.endedReported = id;
    for (const one of this.picked) one.controller.abort();
    this.picked = [];
    this.paintUploads();
    this.emit({ type: 'ended' });
  }

  private startNew(): void {
    this.fresh = true;
    this.resetConversationUi();
    this.justNamed = '';
    this.notice = '';
    this.screen = this.wantsDetails() ? 'details' : 'chat';
    this.paint();
    if (this.screen === 'chat') this.text.focus({ preventScroll: true });
  }

  private async submitIntro(name: string, phone: string): Promise<void> {
    if (!name.trim() || this.introBusy) return;
    this.introBusy = true;
    this.introError = '';
    this.paint();
    try {
      await this.ensureSession({
        displayName: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      this.screen = 'chat';
    } catch (error) {
      this.introError =
        (error as CnctError)?.code === CnctErrorCode.rateLimited
          ? this.t('tooManyChats')
          : this.t('genericError');
    } finally {
      this.introBusy = false;
    }
    this.paint();
    if (this.screen === 'chat') this.text.focus({ preventScroll: true });
  }

  private async saveName(): Promise<void> {
    const displayName = this.details.name.trim();
    if (!displayName || this.details.busy) return;
    this.details.busy = true;
    this.details.error = '';
    this.paintCards(true);
    try {
      await this.client.updateProfile({
        displayName,
        ...(this.details.phone.trim() ? { phone: this.details.phone } : {}),
      });
      this.justNamed = displayName;
      this.details = { name: '', phone: '', busy: false, error: '' };
    } catch {
      this.details.busy = false;
      this.details.error = this.t('genericError');
    }
    this.paintCards(true);
  }

  /**
   * Tapping a face saves it at once — the face is the answer, and a visitor who taps and leaves has
   * still said how it went — then offers a box for more, sent as a second answer to the same question.
   */
  private async rate(score: number, comment?: string): Promise<void> {
    const before = { ...this.rating };
    this.rating = {
      ...this.rating,
      score,
      stage: comment === undefined ? 'comment' : 'done',
      busy: true,
      error: '',
    };
    this.paintCards(true);
    try {
      await this.client.rate(score, comment === undefined ? {} : { comment });
      this.rating.busy = false;
      this.emit({ type: 'rated', score, ...(comment ? { comment } : {}) });
    } catch {
      this.rating = { ...before, busy: false, error: this.t('genericError') };
    }
    this.paintCards(true);
  }

  // ── Painting ─────────────────────────────────────────────────────────────────────────────────

  /** Coalesced: a burst of state changes paints once. */
  private render(): void {
    if (this.paintQueued) return;
    this.paintQueued = true;
    queueMicrotask(() => {
      this.paintQueued = false;
      this.paint();
    });
  }

  private paint(): void {
    if (!this.shadow.contains(this.wrap)) return;
    const state = this.state;
    const inbox = state.inbox;
    this.language = pickLanguage(
      this.options.language && this.options.language !== 'auto'
        ? this.options.language
        : (inbox?.widget.brand.language ?? 'auto'),
    );
    this.t = translator(this.language, this.options.strings);
    this.theme = resolveTheme({
      theme: this.options.theme ?? null,
      widget: inbox?.widget ?? null,
      business: inbox?.business ?? '',
      systemPrefersDark: Boolean(this.dark?.matches),
    });

    const wrap = this.wrap;
    wrap.dir = this.language === 'ar' ? 'rtl' : 'ltr';
    wrap.lang = this.language;
    wrap.dataset.appearance = this.theme.appearance;
    const cssPrimary =
      getComputedStyle(this.host).getPropertyValue('--cnct-primary').trim() || null;
    for (const [name, value] of Object.entries(
      themeVariables(this.theme, this.options.theme, cssPrimary),
    )) {
      wrap.style.setProperty(name, value);
    }

    this.paintHeader();
    const offline = this.screen === 'chat' && !this.fresh && state.status === 'offline';
    this.banner.classList.toggle('hidden', !offline);
    if (offline) this.banner.replaceChildren(icon('offline'), el('span', '', this.t('connecting')));

    this.center.classList.toggle('hidden', this.screen === 'chat' || this.screen === 'details');
    this.intro.classList.toggle('hidden', this.screen !== 'details');
    this.chat.classList.toggle('hidden', this.screen !== 'chat');
    if (this.screen === 'details') this.paintIntro();
    else if (this.screen !== 'chat') this.paintCenter();
    else {
      this.paintThread();
      this.paintCards();
      this.paintFoot();
    }
    this.powered.classList.toggle('hidden', !this.theme.showPoweredBy || this.screen === 'loading');
    this.powered.replaceChildren(`${this.t('poweredBy')} `, el('b', '', 'CNCT'));
    this.drop.replaceChildren(icon('paperclip'), el('span', '', this.t('dropHere')));
    this.watchReplies();
  }

  private paintHeader(): void {
    const inbox = this.state.inbox;
    const title = this.theme.title || inbox?.business || '';
    const known = Boolean(inbox) && this.screen !== 'invalid';
    this.logo.classList.toggle('hidden', !known);
    this.title.textContent = known ? title : '';
    this.paintLogo(this.logo, title);

    const line: Node[] = [];
    if (known && this.screen !== 'off' && this.screen !== 'unavailable') {
      const conversation = this.state.conversation;
      if (!this.live && conversation) {
        line.push(
          el(
            'span',
            'line',
            endedLine(conversation.closedAt ?? conversation.startedAt, this.t, this.language),
          ),
        );
      } else {
        const availability = inbox?.availability;
        if (availability && availability.open !== null) {
          line.push(el('i', `dot${availability.open ? '' : ' away'}`));
        }
        line.push(el('span', 'line', availabilityLine(availability, this.t, this.language)));
      }
    }
    this.status.replaceChildren(...line);
    this.status.classList.toggle('hidden', line.length === 0);

    const canEnd =
      this.screen === 'chat' &&
      !this.fresh &&
      this.live &&
      !this.confirming &&
      Boolean(this.state.conversation) &&
      Boolean(inbox?.widget.chat.allowEndConversation);
    this.endButton.classList.toggle('hidden', !canEnd);
    this.endButton.textContent = this.t('endChat');
    this.closeButton.classList.toggle('hidden', !this.options.onClose);
    this.closeButton.setAttribute('aria-label', this.t('closeChat'));
    this.closeButton.title = this.t('closeChat');
  }

  /** The business's logo, or its first letter on its colour. Never an empty disc or a broken image. */
  private paintLogo(holder: HTMLElement, name: string): void {
    const url = this.theme.logo;
    const current = holder.querySelector('img');
    if (url && current?.getAttribute('src') === url) return;
    if (!url) {
      holder.textContent = initial(name);
      return;
    }
    const image = el('img');
    image.alt = '';
    image.src = url;
    image.addEventListener('error', () => {
      holder.textContent = initial(name);
    });
    holder.replaceChildren(image);
  }

  private paintCenter(): void {
    const t = this.t;
    const business = this.state.inbox?.business ?? '';
    if (this.screen === 'loading') {
      this.center.replaceChildren(el('div', 'spinner'), el('p', '', t('connecting')));
      this.center.setAttribute('aria-busy', 'true');
      return;
    }
    this.center.removeAttribute('aria-busy');
    const [heading, body] =
      this.screen === 'invalid'
        ? [t('linkInvalid'), t('linkInvalidBody')]
        : this.screen === 'off'
          ? [t('notTakingChats', { business }), t('notTakingChatsBody')]
          : [t('chatUnavailable'), t('tryAgainSoon')];
    const glyph = el('div', 'glyph');
    glyph.append(icon('chat'));
    const h = el('h2', '', heading);
    h.dir = 'auto';
    this.center.replaceChildren(glyph, h, el('p', '', body));
  }

  private paintIntro(): void {
    const t = this.t;
    const inbox = this.state.inbox;
    // A form rebuilt under somebody's fingers loses their caret: only when what it shows changed.
    const sig = JSON.stringify([
      this.language,
      this.introBusy,
      this.introError,
      inbox?.requirePhone,
      inbox?.business,
      inbox?.greeting,
    ]);
    if (sig === this.introSig) return;
    this.introSig = sig;
    const existing = this.intro.querySelector('form');
    const nameValue =
      (existing?.querySelector('[name=name]') as HTMLInputElement | null)?.value ?? '';
    const phoneValue =
      (existing?.querySelector('[name=phone]') as HTMLInputElement | null)?.value ?? '';
    const focused = this.shadow.activeElement as HTMLInputElement | null;
    const focusName = focused?.name;

    const form = el('form', 'form');
    form.noValidate = true;
    const nameField = el('label', 'field');
    const name = el('input', 'input');
    name.name = 'name';
    name.autocomplete = 'given-name';
    name.maxLength = 60;
    name.required = true;
    name.dir = 'auto';
    name.placeholder = t('namePlaceholder');
    name.value = nameValue;
    nameField.append(el('span', '', t('yourName')), name);
    form.append(nameField);
    let phone: HTMLInputElement | null = null;
    if (inbox?.requirePhone) {
      const field = el('label', 'field');
      const label = el('span', '', `${t('phoneNumber')} `);
      label.append(el('em', '', t('optional')));
      phone = el('input', 'input');
      phone.name = 'phone';
      phone.type = 'tel';
      phone.autocomplete = 'tel';
      phone.maxLength = 32;
      phone.dir = 'ltr';
      phone.value = phoneValue;
      field.append(label, phone, el('small', '', t('phoneHint')));
      form.append(field);
    }
    const start = el('button', 'primary', this.introBusy ? t('starting') : t('startChatting'));
    start.type = 'submit';
    start.disabled = this.introBusy;
    form.append(start, el('p', 'legal', t('legal')));
    if (this.introError) {
      const error = el('p', 'error', this.introError);
      error.setAttribute('role', 'alert');
      form.append(error);
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submitIntro(name.value, phone?.value ?? '');
    });

    // The business is already named in the header; what it says to a newcomer is the heading here.
    const greeting = inbox?.greeting ? [userText('h2', '', inbox.greeting)] : [];
    this.intro.replaceChildren(...greeting, el('p', 'greet', t('detailsBody')), form);
    const again = focusName
      ? (form.querySelector(`[name=${focusName}]`) as HTMLInputElement | null)
      : null;
    const target = again ?? (this.introBusy ? null : name);
    target?.focus({ preventScroll: true });
  }

  // ── The thread ───────────────────────────────────────────────────────────────────────────────

  private visibleMessages(): CnctChatMessage[] {
    if (this.fresh) {
      const shown: CnctChatMessage[] = [];
      const greeting = this.state.inbox?.greeting;
      const at = this.starting?.at ?? new Date().toISOString();
      if (greeting) {
        shown.push({
          id: 'greeting',
          speaker: 'SYSTEM',
          type: 'TEXT',
          body: greeting,
          createdAt: at,
          clientKey: null,
        });
      }
      if (this.starting) {
        shown.push({
          id: 'starting',
          speaker: 'CALLER',
          type: 'TEXT',
          body: this.starting.text,
          createdAt: at,
          clientKey: 'starting',
          pending: true,
        });
      }
      return shown;
    }
    return this.state.messages;
  }

  private paintThread(): void {
    const t = this.t;
    const all = this.visibleMessages();
    const live = this.live;
    const conversation = this.fresh ? null : this.state.conversation;
    const scroller = this.thread;
    const wasPinned =
      this.pinned || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;

    const last = all[all.length - 1];
    const awaiting =
      live && last && last.speaker === 'AI' && !last.pending && last.flow?.choices?.length
        ? last.id
        : null;
    const seenAt = conversation?.seenAt ? Date.parse(conversation.seenAt) : NaN;
    const seenKey =
      last &&
      last.speaker === 'CALLER' &&
      !last.pending &&
      !last.failed &&
      seenAt >= Date.parse(last.createdAt)
        ? keyOf(last)
        : null;

    const wanted: { key: string; sig: string; make: () => HTMLElement }[] = [];
    let lastDay = '';
    let group: CnctChatMessage[] = [];
    let groupSigner = '';
    const flush = () => {
      if (!group.length) return;
      const members = group;
      const seen = seenKey !== null && members.some((m) => keyOf(m) === seenKey);
      const sig = JSON.stringify([
        this.language,
        seen,
        awaiting,
        members.map((m) => [
          m.id,
          m.body,
          m.pending,
          m.failed,
          m.flow?.text,
          m.attachments?.map((a) => a.id),
          m.replyTo?.excerpt,
        ]),
      ]);
      wanted.push({
        key: `g:${keyOf(members[0]!)}`,
        sig,
        make: () => this.drawGroup(members, awaiting, seen),
      });
      group = [];
    };
    for (const message of all) {
      const day = dayLabel(message.createdAt, t, this.language);
      if (day !== lastDay) {
        flush();
        wanted.push({ key: `d:${day}`, sig: day, make: () => el('div', 'stamp', day) });
        lastDay = day;
      }
      if (message.speaker === 'SYSTEM') {
        flush();
        wanted.push({
          key: `s:${message.id}`,
          sig: message.body,
          make: () => {
            const line = el('div', 'system');
            line.append(...messageText(message.body));
            return line;
          },
        });
        continue;
      }
      const signer =
        message.speaker === 'CALLER' ? 'you' : signerOf(message.sender, message.speaker);
      if (signer !== groupSigner) flush();
      groupSigner = signer;
      group.push(message);
    }
    flush();

    // Replies the assistant offered with its last answer, while nobody has spoken since.
    let offered: string[] = [];
    if (live && !awaiting) {
      for (let index = all.length - 1; index >= 0 && all[index]!.speaker === 'AI'; index -= 1) {
        if (all[index]!.suggestions?.length) {
          offered = all[index]!.suggestions!.filter(
            (one) => typeof one === 'string' && one.trim(),
          ).slice(0, 3);
          break;
        }
      }
    }
    if (offered.length) {
      wanted.push({
        key: 'suggestions',
        sig: JSON.stringify(offered),
        make: () => {
          const chips = el('div', 'suggestions');
          for (const words of offered) {
            const chip = button('choice');
            chip.append(userText('span', '', words));
            chip.addEventListener('click', () => void this.say(words));
            chips.append(chip);
          }
          return chips;
        },
      });
    }
    if (live && !this.fresh && this.state.theyAreTyping) {
      wanted.push({
        key: 'typing',
        sig: '',
        make: () => {
          const holder = el('div', 'group them');
          const dots = el('div', 'typing');
          dots.append(el('i'), el('i'), el('i'));
          holder.append(dots);
          return holder;
        },
      });
    }

    const next = new Map<string, { sig: string; node: HTMLElement }>();
    const nodes = wanted.map((row) => {
      const known = this.rows.get(row.key);
      const node = known && known.sig === row.sig ? known.node : row.make();
      next.set(row.key, { sig: row.sig, node });
      return node;
    });
    this.rows = next;
    reconcile(this.messages, nodes);

    this.text.placeholder = this.placeholderFor(awaiting ? all[all.length - 1]! : null, all);
    if (wasPinned) this.toBottom();
  }

  private placeholderFor(awaiting: CnctChatMessage | null, all: CnctChatMessage[]): string {
    const last = all[all.length - 1];
    const expects = this.live && last?.speaker === 'AI' ? last.flow?.expects : null;
    const answer = expects ? ANSWER[expects] : null;
    this.text.inputMode = answer?.[0] ?? 'text';
    if (answer) return this.t(answer[1]);
    return awaiting ? this.t('chooseOrWrite') : this.t('writeMessage');
  }

  private drawGroup(
    members: CnctChatMessage[],
    awaiting: string | null,
    seen: boolean,
  ): HTMLElement {
    const t = this.t;
    const first = members[0]!;
    const final = members[members.length - 1]!;
    const side = first.speaker === 'CALLER' ? 'you' : 'them';
    const node = el('div', `group ${side}`);
    const who =
      side === 'you' ? t('you') : firstName(first.sender?.name) || this.state.inbox?.business || '';
    members.forEach((message, index) => {
      const bubble = this.bubble(message, index === 0);
      if (index === 0) bubble.prepend(srOnly(`${who}: `));
      node.append(bubble);
      if (message.flow?.choices?.length)
        node.append(this.choices(message, awaiting === message.id));
      if (message.failed && message.clientKey) {
        const retry = button('retry', undefined, t('notSent'));
        retry.addEventListener('click', () => void this.retry(message.clientKey!));
        node.append(retry);
      }
    });
    if (final.failed) return node;
    const byline = el('div', 'byline');
    if (side === 'them') {
      byline.append(this.face(first.sender ?? null), userText('span', 'name', who));
      if (first.speaker === 'AI') byline.append(el('span', 'chip', 'AI'));
      byline.append(el('span', '', '·'));
    }
    byline.append(
      el('span', '', final.pending ? t('sending') : clockTime(final.createdAt, this.language)),
    );
    if (seen) byline.append(el('span', '', '·'), icon('seen'), el('span', '', t('seen')));
    node.append(byline);
    return node;
  }

  private bubble(message: CnctChatMessage, head: boolean): HTMLElement {
    const flow = message.flow && typeof message.flow.text === 'string' ? message.flow : null;
    const words = flow ? (flow.text ?? '') : String(message.body ?? '');
    const files = message.attachments ?? [];
    // Files and nothing else: the photo or the card is the message, with no bubble around it.
    const bare = files.length > 0 && !words.trim() && !message.replyTo && !flow?.media;
    const classes = [
      'msg',
      head ? 'first' : '',
      message.pending ? 'pending' : '',
      message.failed ? 'failed' : '',
      files.length ? 'files' : '',
      bare ? 'bare' : '',
    ];
    const node = el('div', classes.filter(Boolean).join(' '));
    node.dataset.id = message.id;
    if (message.replyTo) node.append(this.quote(message.replyTo));
    if (flow?.media && /^https?:\/\//i.test(flow.media.url ?? ''))
      node.append(this.flowMedia(flow.media));
    if (words.trim()) node.append(...messageText(words));
    if (flow?.footer) node.append(userText('div', 'footer', flow.footer));
    for (const attachment of files) node.append(this.attachmentNode(attachment));
    return node;
  }

  /** The message this one replies to, above its words: whose it was, and its first words. */
  private quote(quote: NonNullable<CnctChatMessage['replyTo']>): HTMLElement {
    const t = this.t;
    const node = quote.messageId ? button('quote', t('showQuoted')) : el('div', 'quote');
    if (quote.mine) node.append(el('b', '', t('quoteYou')));
    const kind = quote.attachmentKind ? (`quote${quote.attachmentKind}` as const) : null;
    const words =
      quote.excerpt ||
      (kind &&
      kind in { quoteIMAGE: 1, quoteVIDEO: 1, quoteAUDIO: 1, quoteSTICKER: 1, quoteDOCUMENT: 1 }
        ? t(kind as 'quoteIMAGE')
        : t('quoteEarlier'));
    node.append(userText('span', '', words));
    if (quote.messageId) {
      node.addEventListener('click', () => {
        const target = this.messages.querySelector(`[data-id="${CSS.escape(quote.messageId!)}"]`);
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
    return node;
  }

  private flowMedia(
    media: NonNullable<NonNullable<CnctChatMessage['flow']>['media']>,
  ): HTMLElement {
    const wrap = el('div', 'media');
    if (media.kind === 'image') {
      const image = el('img');
      image.src = media.url;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      wrap.append(image);
    } else if (media.kind === 'video') {
      const video = el('video');
      video.src = media.url;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      wrap.append(video);
    } else {
      const name = media.filename || this.t('attachment');
      const link = el('a', 'card');
      link.href = media.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', this.t('openDocument', { name }));
      const kind = el('span', 'kind');
      kind.append(icon('file'));
      const meta = el('span', 'meta');
      meta.append(userText('span', 'fname', name));
      link.append(kind, meta);
      wrap.append(link);
    }
    return wrap;
  }

  /**
   * A flow's choices, under the message that offered them: buttons for short ones, rows for ones
   * with descriptions or a list. Tappable while the flow is waiting for an answer; once anything
   * else is said they stay, dimmed, as the record of what was offered.
   */
  private choices(message: CnctChatMessage, active: boolean): HTMLElement {
    const flow = message.flow!;
    const rows = flow.layout === 'list' || flow.choices.some((one) => one.description);
    const wrap = el('div', `choices${rows ? ' rows' : ''}`);
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', flow.listButton || this.t('choices'));
    for (const choice of flow.choices) {
      if (!choice || typeof choice.id !== 'string' || typeof choice.title !== 'string') continue;
      const tap = button('choice');
      tap.disabled = !active;
      const words = el('span');
      words.append(userText('span', '', choice.title));
      if (rows && choice.description) words.append(userText('small', '', choice.description));
      tap.append(words);
      if (rows) tap.append(icon('chevron', 'icon flip'));
      tap.addEventListener('click', () => void this.choose(choice));
      wrap.append(tap);
    }
    return wrap;
  }

  /** A face for whoever signed a group: the assistant's mark, a person's first letter, the business's logo. */
  private face(sender: CnctChatSender | null): HTMLElement {
    const node = el('span', 'face');
    node.setAttribute('aria-hidden', 'true');
    if (sender?.kind === 'ai') {
      node.classList.add('ai');
      node.append(icon('sparkle'));
      return node;
    }
    if (sender?.kind === 'person') {
      node.textContent = initial(sender.name ?? this.state.inbox?.business ?? '');
      return node;
    }
    this.paintLogo(node, this.state.inbox?.business ?? '');
    return node;
  }

  private attachmentNode(attachment: CnctChatAttachment): HTMLElement {
    const cached = this.fileNodes.get(attachment.id);
    if (cached) return cached;
    const t = this.t;
    const name = attachment.filename || t('attachment');
    const size = fileSize(attachment.bytes, this.language);
    const image = attachment.kind === 'IMAGE' || (attachment.mimeType || '').startsWith('image/');
    let node: HTMLElement;
    if (image) {
      const label = [t('quoteIMAGE'), size].filter(Boolean).join(t('listSeparator'));
      const holder = button('att photo loading', label);
      const picture = el('img');
      picture.alt = '';
      picture.addEventListener('load', () => {
        holder.classList.remove('loading');
        if (this.pinned) this.toBottom();
      });
      holder.append(picture);
      holder.addEventListener('click', () => {
        if (picture.src) this.openViewer(picture.src, label, holder);
      });
      void this.urlFor(attachment)
        .then((url) => {
          picture.src = url;
        })
        .catch(() => holder.replaceChildren(el('span', 'missing', t('couldNotLoad', { name }))));
      node = holder;
    } else {
      const card = button(
        'att card',
        [t('openDocument', { name }), size].filter(Boolean).join(t('listSeparator')),
      );
      const kind = el('span', 'kind');
      const mime = attachment.mimeType || '';
      kind.append(
        icon(
          attachment.kind === 'AUDIO' || mime.startsWith('audio/')
            ? 'audio'
            : attachment.kind === 'VIDEO' || mime.startsWith('video/')
              ? 'video'
              : 'file',
        ),
      );
      const meta = el('span', 'meta');
      meta.append(userText('span', 'fname', name));
      if (size) meta.append(el('span', 'size', size));
      card.append(kind, meta);
      card.addEventListener('click', () => void this.download(attachment, card));
      node = card;
    }
    this.fileNodes.set(attachment.id, node);
    return node;
  }

  private async urlFor(attachment: CnctChatAttachment): Promise<string> {
    const known = this.urls.get(attachment.id);
    if (known) return known;
    const blob = await this.client.fetchAttachment(attachment);
    const url = URL.createObjectURL(blob);
    this.urls.set(attachment.id, url);
    return url;
  }

  /** A download with the token, saved under the file's original name. */
  private async download(attachment: CnctChatAttachment, card: HTMLElement): Promise<void> {
    try {
      const link = el('a');
      link.href = await this.urlFor(attachment);
      link.download = attachment.filename || this.t('attachment');
      link.rel = 'noopener';
      this.shadow.append(link);
      link.click();
      link.remove();
    } catch {
      card.replaceChildren(
        el(
          'span',
          'missing',
          this.t('couldNotLoad', { name: attachment.filename || this.t('attachment') }),
        ),
      );
      this.fileNodes.delete(attachment.id);
    }
  }

  private openViewer(url: string, label: string, from: HTMLElement): void {
    this.closeViewer();
    this.viewerReturn = from;
    const viewer = el('div', 'viewer');
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', label);
    const picture = el('img');
    picture.src = url;
    picture.alt = label;
    const close = button('close', this.t('back'));
    close.append(icon('x'));
    close.addEventListener('click', () => this.closeViewer());
    viewer.addEventListener('click', (event) => {
      if (event.target === viewer) this.closeViewer();
    });
    // A swipe down closes it, as a phone's own photo viewer does.
    let startY: number | null = null;
    viewer.addEventListener('pointerdown', (event) => (startY = event.clientY));
    viewer.addEventListener('pointerup', (event) => {
      if (startY !== null && event.clientY - startY > 80) this.closeViewer();
      startY = null;
    });
    viewer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.closeViewer();
      }
    });
    viewer.append(picture, close);
    this.wrap.append(viewer);
    this.viewer = viewer;
    close.focus();
  }

  private closeViewer(): void {
    if (!this.viewer) return;
    this.viewer.remove();
    this.viewer = null;
    this.viewerReturn?.focus({ preventScroll: true });
    this.viewerReturn = null;
  }

  // ── Under the thread ─────────────────────────────────────────────────────────────────────────

  /**
   * The cards — the name card and the rating — are forms, so they are rebuilt only when what they
   * show changes. A card rebuilt under somebody's fingers loses what they were typing.
   */
  private paintCards(force = false): void {
    const conversation = this.fresh ? null : this.state.conversation;
    const widget = this.state.inbox?.widget;
    const spoke = this.state.messages.some((m) => m.speaker === 'CALLER' && !m.pending);
    const askName =
      !this.justNamed &&
      Boolean(conversation) &&
      this.live &&
      spoke &&
      this.state.visitor?.anonymous === true;
    const ended = Boolean(conversation) && !this.live;
    const askRating =
      ended &&
      Boolean(widget?.chat.askForRating) &&
      Boolean(conversation?.ratable || conversation?.rating);
    const sig = JSON.stringify([
      this.language,
      this.justNamed,
      askName,
      ended,
      askRating,
      conversation?.ratable,
      conversation?.rating?.score,
      this.rating,
      this.details.busy,
      this.details.error,
      this.state.inbox?.requirePhone,
    ]);
    if (!force && sig === this.cardsSig) return;
    this.cardsSig = sig;
    const pinned = this.pinned;
    const nodes: HTMLElement[] = [];
    if (this.justNamed && this.live) {
      const thanks = el('div', 'panel thanks');
      thanks.append(
        icon('seen'),
        userText('span', '', this.t('detailsThanks', { name: this.justNamed })),
      );
      nodes.push(thanks);
    } else if (askName) {
      nodes.push(this.detailsCard());
    }
    if (ended) nodes.push(el('div', 'ended', this.t('endedDivider')));
    if (askRating) nodes.push(this.ratingCard(conversation?.rating?.score ?? 0));
    const active = this.shadow.activeElement as HTMLElement | null;
    const field = active && this.cards.contains(active) ? active.dataset.field : undefined;
    this.cards.replaceChildren(...nodes);
    if (field)
      (this.cards.querySelector(`[data-field="${field}"]`) as HTMLElement | null)?.focus({
        preventScroll: true,
      });
    if (pinned) this.toBottom();
  }

  private detailsCard(): HTMLElement {
    const t = this.t;
    const card = el('form', 'panel');
    card.noValidate = true;
    card.append(el('strong', '', t('detailsTitle')), el('p', '', t('detailsBody')));
    const name = el('input', 'input');
    name.placeholder = t('yourName');
    name.setAttribute('aria-label', t('yourName'));
    name.maxLength = 60;
    name.autocomplete = 'given-name';
    name.dir = 'auto';
    name.value = this.details.name;
    name.dataset.field = 'name';
    name.addEventListener('input', () => (this.details.name = name.value));
    card.append(name);
    if (this.state.inbox?.requirePhone) {
      const phone = el('input', 'input');
      phone.type = 'tel';
      phone.placeholder = t('detailsPhone');
      phone.setAttribute('aria-label', t('detailsPhone'));
      phone.autocomplete = 'tel';
      phone.maxLength = 32;
      phone.dir = 'ltr';
      phone.value = this.details.phone;
      phone.dataset.field = 'phone';
      phone.addEventListener('input', () => (this.details.phone = phone.value));
      card.append(phone);
    }
    const save = el('button', 'primary small', t('detailsSave'));
    save.type = 'submit';
    save.disabled = this.details.busy;
    const actions = el('div', 'actions');
    actions.append(save);
    card.append(actions);
    if (this.details.error) card.append(el('p', 'error', this.details.error));
    card.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.saveName();
    });
    return card;
  }

  private ratingCard(stored: number): HTMLElement {
    const t = this.t;
    const conversation = this.state.conversation;
    if (stored && this.rating.stage === 'faces' && !this.rating.busy)
      this.rating = { ...this.rating, stage: 'done', score: stored };
    const score = this.rating.score || stored;
    const card = el('div', 'panel');
    card.append(el('strong', '', this.rating.stage === 'faces' ? t('ratePrompt') : t('rated')));
    const row = el('div', 'faces');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', t('ratePrompt'));
    for (const value of [1, 2, 3, 4, 5]) {
      const word = t(`rating${value}` as 'rating1');
      const face = button('rate', word);
      face.title = word;
      face.setAttribute('aria-pressed', String(score === value));
      if (score && score !== value) face.classList.add('chosen-other');
      face.disabled = !conversation?.ratable || this.rating.busy;
      face.append(ratingFace(value), el('span', '', word));
      face.addEventListener('click', () => void this.rate(value));
      row.append(face);
    }
    card.append(row);
    if (this.rating.stage === 'comment') {
      const form = el('form', 'form');
      const box = el('textarea', 'input');
      box.rows = 2;
      box.maxLength = 1000;
      box.placeholder = t('tellUsMore');
      box.setAttribute('aria-label', t('tellUsMore'));
      box.dir = 'auto';
      box.value = this.rating.comment;
      box.dataset.field = 'comment';
      box.addEventListener('input', () => (this.rating.comment = box.value));
      const actions = el('div', 'actions');
      const skip = button('quiet', undefined, t('skip'));
      skip.addEventListener('click', () => {
        this.rating.stage = 'done';
        this.paintCards(true);
      });
      const sendIt = el('button', 'primary small', t('send'));
      sendIt.type = 'submit';
      sendIt.disabled = this.rating.busy;
      actions.append(skip, sendIt);
      form.append(box, actions);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void this.rate(score, this.rating.comment.trim());
      });
      card.append(form);
    } else if (conversation?.rating?.comment) {
      card.append(userText('p', '', conversation.rating.comment));
    }
    if (this.rating.error) card.append(el('p', 'error', this.rating.error));
    return card;
  }

  // ── The composer ─────────────────────────────────────────────────────────────────────────────

  private paintFoot(): void {
    const t = this.t;
    const live = this.live;
    const ended = !live;
    this.composer.classList.toggle('hidden', ended || this.confirming);
    this.confirmBar.classList.toggle('hidden', !this.confirming || ended);
    this.closedBar.classList.toggle('hidden', !ended);
    if (this.confirming && !ended) {
      const keep = button('ghost', undefined, t('keepChatting'));
      keep.addEventListener('click', () => {
        this.confirming = false;
        this.paint();
        this.text.focus({ preventScroll: true });
      });
      const yes = button('primary small', undefined, t('endChat'));
      yes.addEventListener('click', () => void this.endConversation());
      this.confirmBar.replaceChildren(el('span', '', t('endConfirm')), keep, yes);
      this.confirmBar.setAttribute('aria-label', t('endChat'));
    }
    if (ended) {
      const again = button('primary', undefined, t('startNew'));
      again.append(icon('send', 'icon flip'));
      again.addEventListener('click', () => this.startNew());
      this.closedBar.replaceChildren(again);
    }
    const allowFiles = Boolean(this.state.inbox?.widget.chat.allowAttachments);
    this.attach.classList.toggle('hidden', !allowFiles);
    this.attach.setAttribute('aria-label', t('attach'));
    this.attach.title = t('attach');
    this.text.setAttribute('aria-label', t('message'));
    this.paintNotice();
    this.paintUploads();
  }

  private paintNotice(): void {
    this.error.textContent = this.notice;
    this.error.classList.toggle('hidden', !this.notice);
  }

  private paintUploads(): void {
    this.tray.replaceChildren(...this.picked.map((one) => this.chip(one)));
    this.tray.classList.toggle('hidden', this.picked.length === 0);
    this.paintSend();
  }

  private paintSend(): void {
    const busy = this.picked.some((one) => one.status === 'uploading');
    const ready = this.picked.some((one) => one.status === 'done');
    this.send.disabled = busy || (!this.text.value.trim() && !ready);
    this.send.setAttribute('aria-label', busy ? this.t('uploading') : this.t('send'));
    this.send.title = this.send.getAttribute('aria-label')!;
  }

  /** Built once per file and then only updated — progress arrives many times a second. */
  private chip(one: Picked): HTMLElement {
    if (!one.node) {
      const t = this.t;
      const node = el('div', 'upload');
      node.setAttribute('role', 'listitem');
      const thumb = el('span', 'thumb');
      if (one.url) {
        const picture = el('img');
        picture.alt = '';
        picture.src = one.url;
        thumb.append(picture);
      } else {
        thumb.textContent = one.name.includes('.')
          ? (one.name.split('.').pop() ?? '').slice(0, 4)
          : '';
        if (!thumb.textContent) thumb.append(icon('file'));
      }
      one.ring = progressRing();
      thumb.append(one.ring);
      const meta = el('span', 'meta');
      const name = userText('span', 'fname', one.name);
      name.title = one.name;
      meta.append(name, el('span', 'size', fileSize(one.file.size, this.language)));
      const remove = button('remove', t('removeFile', { name: one.name }));
      remove.append(icon('x'));
      remove.addEventListener('click', () => this.removeUpload(one));
      node.append(thumb, meta, remove);
      one.node = node;
    }
    this.paintChip(one);
    return one.node;
  }

  private paintChip(one: Picked): void {
    if (!one.node || !one.ring) return;
    const uploading = one.status === 'uploading';
    one.node.classList.toggle('failed', one.status === 'failed');
    one.node.setAttribute('aria-busy', String(uploading));
    one.ring.classList.toggle('hidden', !uploading);
    setRing(one.ring, one.progress);
    if (!uploading) this.paintSend();
  }

  private grow(): void {
    this.text.style.height = 'auto';
    if (this.text.scrollHeight)
      this.text.style.height = `${Math.min(this.text.scrollHeight + 2, 140)}px`;
  }

  private toBottom(): void {
    const scroller = this.thread;
    scroller.scrollTop = scroller.scrollHeight;
    this.pinned = true;
  }

  // ── Read ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Tells the team their reply was read once it is actually on screen — in view in the thread, with
   * the page in the foreground. The client posts once per reply however often this asks.
   */
  private watchReplies(): void {
    if (this.screen !== 'chat' || this.fresh) return;
    const replies = this.state.messages.filter((m) => isTeam(m) && !m.pending);
    const newest = replies[replies.length - 1];
    const node = newest ? this.messages.querySelector(`[data-id="${cssEscape(newest.id)}"]`) : null;
    if (!node) return;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const report = () => {
      if (visible()) void this.client.read().catch(() => {});
    };
    if (typeof IntersectionObserver !== 'function') {
      if (this.pinned) report();
      return;
    }
    if (this.watchedReply === node) return;
    this.observer ??= new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) report();
      },
      { root: this.thread, threshold: 0.5 },
    );
    this.observer.disconnect();
    this.observer.observe(node);
    this.watchedReply = node;
  }

  // ── The skeleton, once ───────────────────────────────────────────────────────────────────────

  private build(): void {
    const head = el('header', 'head');
    const who = el('div', 'who');
    who.append(this.title, this.status);
    this.logo.setAttribute('aria-hidden', 'true');
    this.closeButton.append(icon('x'));
    head.append(this.logo, who, this.endButton, this.closeButton);
    this.endButton.addEventListener('click', () => {
      this.confirming = true;
      this.paint();
      (this.confirmBar.querySelector('.primary') as HTMLElement | null)?.focus();
    });
    this.closeButton.addEventListener('click', () => this.options.onClose?.());
    this.banner.setAttribute('role', 'status');

    this.thread.setAttribute('role', 'log');
    this.thread.setAttribute('aria-live', 'polite');
    this.thread.tabIndex = 0;
    this.thread.append(this.messages, this.cards);
    this.thread.addEventListener('scroll', () => {
      const scroller = this.thread;
      this.pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    });

    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.accept = ACCEPT;
    this.fileInput.tabIndex = -1;
    this.fileInput.setAttribute('aria-hidden', 'true');
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files) this.addFiles(this.fileInput.files);
      // Cleared, so picking the same file again is still a change.
      this.fileInput.value = '';
    });
    this.attach.append(icon('paperclip'));
    this.attach.addEventListener('click', () => {
      if (this.canAttach()) this.fileInput.click();
    });
    this.text.rows = 1;
    this.text.maxLength = 4000;
    this.text.dir = 'auto';
    this.text.setAttribute('enterkeyhint', 'send');
    this.text.addEventListener('input', () => {
      this.grow();
      this.paintSend();
      if (this.client.hasSession && !this.fresh) this.client.typing();
    });
    this.text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && hasKeyboard()) {
        event.preventDefault();
        void this.submit();
      }
    });
    // A screenshot pasted into the box is a file; text that came with a picture of itself is text.
    this.text.addEventListener('paste', (event) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length || !this.canAttach() || event.clipboardData?.getData('text/plain')) return;
      event.preventDefault();
      this.addFiles(files);
    });
    this.send.type = 'submit';
    this.send.append(icon('send', 'icon flip'));
    this.composer.append(this.attach, this.fileInput, this.text, this.send);
    this.composer.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.tray.setAttribute('role', 'list');
    this.error.setAttribute('role', 'alert');
    this.foot.append(this.error, this.tray, this.composer, this.confirmBar, this.closedBar);
    this.chat.append(this.thread, this.foot, this.drop);

    // Dropped anywhere on the conversation, counted in and out: `dragleave` fires for every child.
    const dragging = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    this.chat.addEventListener('dragenter', (event) => {
      if (!dragging(event) || !this.canAttach()) return;
      event.preventDefault();
      this.dragDepth += 1;
      this.drop.classList.remove('hidden');
    });
    this.chat.addEventListener('dragover', (event) => {
      if (!dragging(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = this.canAttach() ? 'copy' : 'none';
    });
    this.chat.addEventListener('dragleave', (event) => {
      if (!dragging(event)) return;
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (!this.dragDepth) this.drop.classList.add('hidden');
    });
    this.chat.addEventListener('drop', (event) => {
      if (!dragging(event)) return;
      event.preventDefault();
      this.dragDepth = 0;
      this.drop.classList.add('hidden');
      if (event.dataTransfer?.files) this.addFiles(event.dataTransfer.files);
    });
    this.drop.setAttribute('aria-hidden', 'true');

    this.body.append(this.center, this.intro, this.chat);
    this.wrap.append(head, this.banner, this.body, this.powered);

    // The keyboard opening on a phone shrinks the viewport: keep the newest message in sight.
    const viewport = (globalThis as { visualViewport?: VisualViewport }).visualViewport;
    if (viewport) {
      const keep = () => {
        if (this.pinned) this.toBottom();
      };
      viewport.addEventListener('resize', keep);
      this.offDom.push(() => viewport.removeEventListener('resize', keep));
    }
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          this.watchedReply = null;
          this.watchReplies();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      this.offDom.push(() => document.removeEventListener('visibilitychange', onVisible));
    }
  }

  private watchSystemAppearance(): void {
    if (typeof matchMedia !== 'function') return;
    this.dark = matchMedia('(prefers-color-scheme: dark)');
    const change = () => this.paint();
    this.dark.addEventListener?.('change', change);
    this.offDom.push(() => this.dark?.removeEventListener?.('change', change));
  }

  private revokeAll(): void {
    if (typeof URL.revokeObjectURL === 'function')
      for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.fileNodes.clear();
  }
}

/** Who a message is from, as one comparable string: what decides where a group starts. */
function signerOf(sender: CnctChatSender | null | undefined, speaker: string): string {
  if (!sender) return speaker === 'AI' ? 'ai:' : 'business';
  return `${sender.kind}:${sender.name ?? ''}`;
}

function identityKeyOf(identity: CnctChatIdentity | null | undefined): string {
  return identity ? `${identity.userId}:${identity.userHash}` : '';
}

/**
 * Puts `nodes` in `parent` in order, moving only what moved and removing only what went — so a
 * thread with a hundred messages that gains one changes by one node, not by a hundred.
 */
function reconcile(parent: Element, nodes: Node[]): void {
  let cursor = parent.firstChild;
  for (const node of nodes) {
    if (cursor === node) {
      cursor = cursor.nextSibling;
      continue;
    }
    parent.insertBefore(node, cursor);
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}

/**
 * Enter sends — on a device with a real keyboard. On a phone the on-screen keyboard's return key is
 * the only way to write a second line, so there it does what it says and the send button sends.
 */
function hasKeyboard(): boolean {
  try {
    return !matchMedia('(pointer: coarse)').matches;
  } catch {
    return true;
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
}

function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `u${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  );
}
