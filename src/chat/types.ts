import type { CnctError } from '../errors.js';

/** Who said it. There is no operator name anywhere in the public surface — only that it was one. */
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

/** What the inbox says before anybody has typed. */
export interface CnctChatInbox {
  business: string;
  inbox: string;
  isActive: boolean;
  greeting: string;
  requirePhone: boolean;
}

export interface CnctChatConversation {
  status: CnctConversationStatus;
  startedAt: string;
  /** True when somebody — an operator or the assistant — is on this thread. Never who. */
  withPerson: boolean;
}

export interface CnctChatVisitor {
  displayName: string;
}

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
 * A file sent with a message. Only files the platform actually holds are published, so anything in
 * this list can be fetched — see `CnctChatClient.attachmentUrl`.
 */
export interface CnctChatAttachment {
  id: string;
  kind: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE' | (string & {});
  mimeType: string;
  filename: string | null;
  /** Size in bytes, where the platform recorded one. */
  bytes: number | null;
}

export interface CnctChatMessage {
  id: string;
  speaker: CnctSpeaker;
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
