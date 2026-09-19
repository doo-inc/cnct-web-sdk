/**
 * One of the operations the account's credential may perform, as the platform advertises it.
 *
 * The catalogue is filtered per account — a client without ticketing is not shown four tools that
 * would refuse — so read it rather than assuming. A catalogue is a promise, and something that has
 * read one will try to keep it.
 */
export interface CnctTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

/** Something the business can be booked for. */
export interface CnctService {
  serviceId: string;
  name: string;
  /** How long it takes. Null where the business books generically. */
  minutes: number | null;
  description: string | null;
}

/**
 * A named person or table that can be asked for.
 *
 * An empty list is a real answer rather than a missing one: a business that assigns whoever is free
 * has switched named preference off deliberately, and an app must not offer a choice it has been told
 * not to offer.
 */
export interface CnctBookableResource {
  resourceId: string;
  name: string;
  /** `person`, `table`, `room`… lower-cased by the platform. */
  kind: string | null;
  seats: number | null;
}

/**
 * The booking rules this account works under: its clock, its week, its services and what it will let
 * a caller ask for.
 *
 * Worth fetching once at startup and showing: the hours are the difference between an app that offers
 * a time and one that offers a time the business will accept.
 */
export interface CnctBookingRules {
  /** The business's clock. Every human-readable time this API returns is already in it. */
  timezone: string;
  capacity: number;
  /** The step between offered start times. */
  slotMinutes: number;
  services: CnctService[];
  resources: CnctBookableResource[];
  /**
   * Everything, unmodelled — `hours`, `locations`, `policy`. Exposed raw rather than pinned to a shape
   * this SDK would have to break to widen: the fields above are the ones an app renders, and the rest
   * is here when you need it.
   */
  raw: Record<string, unknown>;
}

/** A free time. */
export interface CnctSlot {
  /** The label to show — already in the business's clock, e.g. "19:30". */
  time: string;
  /**
   * **Pass this back exactly as given.** It is the token `create` matches a slot on; reformatting it,
   * or rebuilding it from a parsed `Date`, is how a booking lands on a time that was never offered.
   */
  startsAt: string;
  /** Who or what is free then. Only present when a specific person or table was asked for. */
  resourceName: string | null;
}

/** What a day looks like. */
export interface CnctAvailability {
  date: string;
  /**
   * Empty means closed or full. {@link note} says which, and it is worth showing: "nothing is free"
   * and "no table seats six" send a customer to different places.
   */
  free: CnctSlot[];
  note: string | null;
}

/** A booking that now exists. */
export interface CnctBookingConfirmation {
  bookingId: string;
  /** In the business's clock and its words — "Tuesday 12 August at 19:30". Ready to read back. */
  when: string;
  /** The name the booking is under, which is not always the customer's. */
  name: string | null;
  partySize: number | null;
  /** The person or table allocated, where the business names them. */
  resourceName: string | null;
}

/** One of a customer's upcoming bookings. */
export interface CnctBookingSummary {
  bookingId: string;
  when: string;
  name: string | null;
  partySize: number | null;
}

/** A kind of work the business hands over. */
export interface CnctTicketType {
  ticketTypeId: string;
  name: string;
  description: string | null;
}

/** One field a ticket type still needs. */
export interface CnctTicketField {
  /** Use this exact key in `fields` when raising the ticket. Never invent one. */
  key: string;
  required: boolean;
  /** Already phrased as a question, so it can go straight on a form label. */
  question: string;
  /** When non-empty, the only accepted values. */
  mustBeOneOf: string[];
}

/** What one ticket type needs before it can be raised. */
export interface CnctTicketTypeDetail {
  ticketTypeId: string;
  name: string;
  /** What the platform already has for this customer. Do not ask for these again. */
  alreadyKnown: Record<string, unknown>;
  /**
   * What is still missing. The subtraction is done on the server, so this list is exactly the
   * questions worth putting in front of somebody.
   */
  askFor: CnctTicketField[];
}

/** A ticket that now exists. */
export interface CnctRaisedTicket {
  /** What a customer quotes back. */
  ticketNumber: number;
  note: string | null;
}

/** One of a customer's open tickets. */
export interface CnctTicketSummary {
  ticketNumber: number;
  title: string;
  status: string;
  /** The date it was raised, `YYYY-MM-DD`. */
  raised: string | null;
}

/**
 * A list, plus what the platform said about it.
 *
 * The note is not decoration: an empty list of people means "this business assigns whoever is free —
 * never offer a choice", and an empty list of times means the day is closed, or full, or that no table
 * seats six. Dropping the sentence loses the difference.
 */
export interface CnctListing<T> {
  items: T[];
  note: string | null;
  /**
   * Present when the platform refused rather than answered — no ticket types configured, say. The
   * list will be empty.
   */
  refusal: string | null;
}
