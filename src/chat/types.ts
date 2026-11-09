import type { CnctError } from '../errors.js';

/**
 * Who said it, as a role. `sender` on a message says which person or assistant it was; this says
 * which side of the conversation it came from.
 */
export type CnctSpeaker = 'CALLER' | 'AI' | 'OPERATOR' | 'SYSTEM';

export type CnctConversationStatus = 'OPEN' | 'PENDING' | 'SNOOZED' | 'CLOSED';

/**
 * What to render a message as.
 *
 * `TEXT` covers anything a UI has no special case for — **including card types added after the UI was
 * written**, which is why `body` always reads correctly on its own. The string union is open on
 * purpose: a newer server may send a type this package has never heard of, and that is a normal
 * Tuesday rather than a parse error.
 */
export type CnctMessageType = 'TEXT' | 'TICKET_UPDATE' | 'BOOKING_UPDATE' | (string & {});

/** Where the chat client is. */
export type CnctChatStatus =
  /** No session. `boot()` may have run; nobody has started a conversation. */
  | 'idle'
  /** A session exists and the socket is being opened. */
  | 'connecting'
  /** Connected. Messages arrive as they are written. */
  | 'live'
  /**
   * The socket dropped and is being retried. **Not an error state** — the transcript is still true,
   * sends still work over HTTP, and the client is already backing off towards a reconnect.
   */
  | 'offline'
  /** The conversation is closed. It cannot be reopened; `start()` a new one. */
  | 'ended';

// ── The inbox ──────────────────────────────────────────────────────────────────────────────────

/**
 * How the inbox's chat is set up in the CNCT console — colour, language, what the visitor may do.
 *
 * `boot()` always hands this back **merged section by section over {@link CNCT_WIDGET_DEFAULTS}**,
 * exactly as the server merges it, so a response from a deployment that predates a field never
 * leaves a UI reading `undefined`. A UI that brands itself from here gets the console's settings with
 * no code; one that passes its own theme wins over them.
 */
export interface CnctChatWidget {
  brand: {
    /** `#rrggbb`. The default primary colour. */
    color: string;
    /** `auto` follows the visitor's system. */
    appearance: 'light' | 'dark' | 'auto';
    /** Already collapsed into `CnctChatInbox.business`; here for completeness. */
    businessName: string | null;
    /** The logo. Null means "the business's first letter on its colour". */
    avatarUrl: string | null;
    /** `auto` follows the visitor's own languages. */
    language: 'auto' | 'en' | 'ar';
    /** Whether to show the "Powered by CNCT" line. */
    showBranding: boolean;
  };
  /** The hosted widget's launcher. Read by `widget/cnct-widget.js`; the SDK UI has no launcher. */
  launcher: {
    side: 'left' | 'right';
    shape: string;
    size: string;
    label: string;
    offset: number;
    hideOnMobile: boolean;
    showReplyPreview: boolean;
  };
  /** The hosted widget's home screen. The SDK UI is a conversation view and does not draw one. */
  home: {
    enabled: boolean;
    heading: string;
    tagline: string;
    questions: string[];
    showTeam: boolean;
  };
  chat: {
    /** Whether the visitor may send files. */
    allowAttachments: boolean;
    /** Whether the hosted page offers its emoji tray. */
    allowEmoji: boolean;
    /** Whether the visitor may end the conversation themselves. */
    allowEndConversation: boolean;
    /** `details` asks for a name before the first message; `message` lets them type first. */
    start: 'details' | 'message';
    /** Whether a closed conversation asks how it went. */
    askForRating: boolean;
  };
}

/** One of the people who answer, as the inbox shows them: a first name and a face, never more. */
export interface CnctChatPerson {
  kind: 'person';
  name: string | null;
  /** A key into CNCT's own face set, or null for "their first letter". */
  avatar: string | null;
}

/** The inbox's assistant, as it signs its replies. */
export interface CnctChatAssistant {
  kind: 'ai';
  name: string | null;
  /** A key into CNCT's own mascot set. */
  mascot?: string | null;
  colour?: string | null;
}

/** Who wrote a message, for the face and the name beside it. */
export type CnctChatSender = CnctChatPerson | CnctChatAssistant;

/**
 * Whether the team is in, and what a visitor can honestly expect.
 *
 * `open` is null where the inbox has no opening hours to be in or out of. `replyMinutes` is how fast
 * replies have really come lately, or null where there is no measurement — in which case a UI should
 * promise nothing.
 */
export interface CnctChatAvailability {
  open: boolean | null;
  /** ISO 8601. When a closed team is back. */
  opensAt: string | null;
  /** True when the assistant answers now, whatever the hours. */
  assistant: boolean;
  replyMinutes: number | null;
}

/** What the inbox says before anybody has typed. */
export interface CnctChatInbox {
  business: string;
  inbox: string;
  isActive: boolean;
  greeting: string;
  requirePhone: boolean;
  /** The console's chat settings, merged over the defaults. Never partial. */
  widget: CnctChatWidget;
  /** A few of the people who will answer. Empty where the inbox shows nobody. */
  team: CnctChatPerson[];
  /** Null from a server that does not say. */
  availability: CnctChatAvailability | null;
}

// ── The conversation ───────────────────────────────────────────────────────────────────────────

/** How a closed conversation was rated. */
export interface CnctChatRating {
  /** 1 (terrible) to 5 (great). */
  score: number;
  comment: string | null;
  /** ISO 8601. */
  ratedAt: string;
}

export interface CnctChatConversation {
  /**
   * The conversation's id, which the per-conversation calls (`read`, `rate`, `getConversation`)
   * take. Present on every server that has those calls; a public id, not the internal row's.
   */
  id?: string;
  status: CnctConversationStatus;
  startedAt: string;
  /** ISO 8601, once it is closed. */
  closedAt?: string | null;
  /** True when somebody — an operator or the assistant — is on this thread. */
  withPerson: boolean;
  /** The person on it, as the visitor may see them. Null while nobody has taken it. */
  assignee?: CnctChatPerson | null;
  /** How it was rated, once it was. */
  rating?: CnctChatRating | null;
  /** True while a closed conversation can still be rated. */
  ratable?: boolean;
  /** ISO 8601. The team has read the visitor's messages up to here — the "Seen" under them. */
  seenAt?: string | null;
}

/** A row of `listConversations()`: the conversation, with what was said last. */
export interface CnctChatConversationSummary extends CnctChatConversation {
  id: string;
  /** The newest message, for a one-line preview. */
  preview?: CnctChatMessage | null;
  lastMessageAt?: string | null;
}

/** Who the visitor is to the inbox. */
export interface CnctChatVisitor {
  displayName: string;
  /** True until they give a name. A UI asks for one once they have said something. */
  anonymous?: boolean;
  /** True when this visitor was signed in with `identify()`. */
  identified?: boolean;
}

/**
 * A signed-in user of the business's own site or app, for `identify()`.
 *
 * `userHash` is `HMAC-SHA256(userId, the inbox's identity secret)` in lowercase hex, **computed on
 * the business's own server**. The secret never goes in an app or a page: whoever holds it can sign
 * in as any of the business's customers and read their conversations.
 */
export interface CnctChatIdentity {
  userId: string;
  userHash: string;
  name?: string;
  email?: string;
  phone?: string;
}

// ── A message ──────────────────────────────────────────────────────────────────────────────────

/** A ticket raised out of this conversation, where the inbox publishes them. */
export interface CnctTicketCard {
  ticketNumber: number;
  title: string;
  status: string;
  /** ISO 8601. */
  raisedAt: string;
}

/** A booking taken, moved or cancelled in this conversation, where the inbox publishes them. */
export interface CnctBookingCard {
  title: string;
  /** ISO 8601. Render in the customer's own locale rather than the business's. */
  startsAt: string;
  endsAt: string;
  status: string;
  locationName: string | null;
  partySize: number | null;
}

/**
 * A file sent with a message, either way. Only files the platform actually holds are published, so
 * anything in this list can be fetched with `fetchAttachment`.
 */
export interface CnctChatAttachment {
  id: string;
  kind: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE' | (string & {});
  mimeType: string;
  filename: string | null;
  /** Size in bytes, where the platform recorded one. */
  bytes: number | null;
}

/** One of the answers a flow offers. Tapping it sends `title` as the body and `id` as `replyId`. */
export interface CnctChatFlowChoice {
  id: string;
  title: string;
  description?: string | null;
}

/** The kind of answer a flow's question is waiting for, which decides the keyboard. */
export type CnctChatFlowExpects = 'name' | 'number' | 'email' | 'phone' | 'date';

/**
 * An assistant's structured question: its words, its choices, and how to draw them.
 *
 * `body` on the same message is the numbered-text version ("1. Book a visit … reply with the
 * number"), so an interface that knows nothing of flows still reads right. One that does draws
 * `text`, `media` and `footer`, and puts `choices` under the thread as buttons or a list.
 */
export interface CnctChatFlow {
  /** The words, without the numbered choices. Null on a message stored before servers sent it. */
  text: string | null;
  layout: 'buttons' | 'list';
  choices: CnctChatFlowChoice[];
  footer?: string | null;
  /** The label of the button that opens a `list`. */
  listButton?: string | null;
  /** A picture, film or document above the words, on a public URL. */
  media?: {
    kind: 'image' | 'video' | 'document' | (string & {});
    url: string;
    filename?: string | null;
  } | null;
  expects?: CnctChatFlowExpects | null;
}

/** The earlier message this one quotes, as the server snapshotted it. */
export interface CnctChatReplyTo {
  /** Null when the quoted message is not one the visitor can see. */
  messageId: string | null;
  /** True when the quoted message was the visitor's own. */
  mine: boolean;
  excerpt: string | null;
  /** Set when the quoted message was a file rather than words. */
  attachmentKind?: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'STICKER' | 'DOCUMENT' | (string & {}) | null;
}

export interface CnctChatMessage {
  id: string;
  speaker: CnctSpeaker;
  /**
   * Who wrote it: an operator as `{ kind: 'person', name, avatar }`, the assistant as
   * `{ kind: 'ai', name, … }`. Null for the visitor's own messages and for system lines.
   */
  sender?: CnctChatSender | null;
  type: CnctMessageType;
  /** Present only on a card. Narrow it with `type`. */
  data?: CnctTicketCard | CnctBookingCard | Record<string, unknown>;
  /**
   * Always reads correctly on its own, card or not — "We have opened ticket #1042 for this: Refund
   * not received". That is what makes adding a card type a non-breaking change.
   */
  body: string;
  /** ISO 8601. */
  createdAt: string;
  clientKey: string | null;
  attachments?: CnctChatAttachment[];
  /** An assistant's structured question. See {@link CnctChatFlow}. */
  flow?: CnctChatFlow | null;
  /** Up to three short replies the assistant offers. Tapping one sends it as the visitor's words. */
  suggestions?: string[];
  /** The earlier message this one replies to. */
  replyTo?: CnctChatReplyTo | null;
  /** Set by this client on an optimistic bubble, cleared when the stored row replaces it. */
  pending?: boolean;
  /** Set when a send failed. `retry(clientKey)` is safe — the key makes a second attempt a no-op. */
  failed?: boolean;
}

/**
 * Everything a UI renders, in one object that is replaced rather than mutated — so a framework
 * comparing references sees a change, and a framework reading fields sees a consistent snapshot.
 */
export interface CnctChatState {
  status: CnctChatStatus;
  inbox: CnctChatInbox | null;
  conversation: CnctChatConversation | null;
  visitor: CnctChatVisitor | null;
  /** Oldest first. */
  messages: CnctChatMessage[];
  /**
   * True while the other side is typing. Clears itself after four seconds — the platform sends a
   * start, never a stop, because a stop that goes missing leaves an indicator on screen for ever.
   */
  theyAreTyping: boolean;
  /** The last failure, or null. Cleared by the next success. */
  error: { code: string; message: string } | null;
}

/** What a session call returns — `start()` and `resume()` both answer in this shape. */
export interface CnctChatSession {
  token?: string;
  visitor?: CnctChatVisitor;
  conversation?: CnctChatConversation;
  messages?: CnctChatMessage[];
}

/** What `getConversation(id)` answers: one conversation and its whole transcript. */
export interface CnctChatTranscript {
  conversation: CnctChatConversation;
  messages: CnctChatMessage[];
}

/**
 * The things a UI *does* rather than shows.
 *
 * `state` is enough to render the whole interface; these are for playing a sound on a new message,
 * scrolling to the bottom, and sending the visitor back to a start screen when their session is
 * refused.
 */
export interface CnctChatEvents {
  /** Any change at all. The payload is the new state. */
  change: CnctChatState;
  /** A message arrived. Already in `state.messages` by the time this fires. */
  message: CnctChatMessage | undefined;
  /**
   * A message changed after it arrived — edited, deleted, or a file on it finished storing. Already
   * replaced in `state.messages`, in place, by the time this fires.
   */
  messageUpdated: CnctChatMessage;
  /**
   * The team read the visitor's messages up to this moment (ISO 8601). Also in
   * `state.conversation.seenAt`, which is what a "Seen" under the visitor's last message reads.
   */
  read: string;
  /** The other side is typing. */
  typing: boolean;
  /** The conversation changed — assigned to somebody, snoozed, reopened. */
  conversation: CnctChatConversation | undefined;
  /** The conversation was closed, by the visitor or by the business. */
  closed: undefined;
  /** The socket is up and the transcript has been refetched. */
  connected: undefined;
  /** The socket dropped. A reconnect is already scheduled; nothing is required of you. */
  disconnected: undefined;
  /**
   * The session token was refused and has been cleared. The visitor is a stranger again — show
   * whatever you show before a conversation starts.
   */
  unauthenticated: undefined;
  /** Something failed. Also in `state.error`. */
  error: CnctError;
}

export type CnctChatEventName = keyof CnctChatEvents;
