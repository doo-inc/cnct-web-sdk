import { CnctConfig, type CnctConfigInput } from '../config.js';
import { CnctApiKey } from '../credentials.js';
import { CnctError, CnctErrorCode } from '../errors.js';
import { CnctTransport, expectObject } from '../transport.js';
import type {
  CnctAvailability,
  CnctBookableResource,
  CnctBookingConfirmation,
  CnctBookingRules,
  CnctBookingSummary,
  CnctListing,
  CnctRaisedTicket,
  CnctService,
  CnctSlot,
  CnctTicketSummary,
  CnctTicketType,
  CnctTicketTypeDetail,
  CnctTool,
} from './types.js';

/**
 * The account's own operations — bookings and tickets — against the API key CNCT issued you.
 *
 * **This credential is account-wide. Keep it on a server.** Everything here reads and writes on behalf
 * of the whole account, and the customer each call is about is named by phone number rather than
 * inferred from a session. A page that held this key could book for, and cancel for, anybody. The
 * intended shape is: your page talks to your backend, your backend holds the key and uses this.
 *
 * ```js
 * const agent = cnct.agent(new CnctApiKey(process.env.CNCT_API_KEY));
 * const day = await agent.bookings.checkAvailability({ date: '2026-09-12', partySize: 4 });
 * if (day.free.length) {
 *   await agent.bookings.create({
 *     startsAt: day.free[0].startsAt,   // exactly as given
 *     customerPhone: '+97312345678',
 *     name: 'Layla',
 *   });
 * }
 * ```
 */
export class CnctAgentClient {
  readonly config: CnctConfig;
  /** `sandbox` for a `kaer_sk_test_` key — see {@link CnctApiKey}. */
  readonly mode: 'sandbox' | 'production';
  /** The calendar. */
  readonly bookings: CnctBookings;
  /** Tickets — the work a business hands to a colleague. */
  readonly tickets: CnctTickets;

  private readonly transport: CnctTransport;
  private readonly headers: Record<string, string>;

  constructor(options: {
    config: CnctConfig | CnctConfigInput;
    credentials: CnctApiKey | string;
    transport?: CnctTransport;
  }) {
    this.config =
      options.config instanceof CnctConfig ? options.config : new CnctConfig(options.config);
    const credentials =
      options.credentials instanceof CnctApiKey
        ? options.credentials
        : new CnctApiKey(options.credentials);
    this.transport = options.transport ?? new CnctTransport(this.config);
    this.headers = credentials.headers;
    this.mode = credentials.mode;
    this.bookings = new CnctBookings(this);
    this.tickets = new CnctTickets(this);
  }

  /**
   * What this account's credential may actually do, and the rules it must do it within.
   *
   * Filtered per account: an account without ticketing is not shown ticket tools. Read this rather
   * than assuming — it is also the cheapest way to check a key works, and `sandbox` is the platform
   * saying which kind of key it took this for.
   */
  async catalogue(): Promise<{ tools: CnctTool[]; rules: CnctBookingRules; sandbox: boolean }> {
    const body = expectObject(
      await this.transport.get('/api/booking-tools', { headers: this.headers }),
    );
    return {
      tools: asArray(body.tools).map(toTool),
      rules: toRules(isObject(body.rules) ? body.rules : {}),
      sandbox: body.sandbox === true,
    };
  }

  /**
   * Call any tool by name, and get back exactly what the platform sent.
   *
   * The escape hatch, and a supported one: a tool added to the platform after this SDK was published
   * is reachable here on the day it ships, without waiting for a release. **It does not throw on a
   * refusal** — a tool that declines answers `200` with an `error` sentence, and this hands that back
   * for you to read. Use {@link callOrThrow} for the other behaviour.
   */
  async call(tool: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return expectObject(
      await this.transport.post(`/api/booking-tools/${encodeURIComponent(tool)}`, {
        body: args,
        headers: this.headers,
      }),
    );
  }

  /** {@link call}, but a refusal becomes a `CnctError` with the code `tool_refused`. */
  async callOrThrow(
    tool: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const result = await this.call(tool, args);
    if (typeof result.error === 'string') {
      throw new CnctError(result.error, CnctErrorCode.toolRefused, undefined, result);
    }
    return result;
  }
}

/**
 * The calendar, as an account's software sees it.
 *
 * Every method that is about a particular person takes `customerPhone` in full international form.
 * That is not a convenience parameter — it *is* the authorization boundary. There is no ambient
 * identity out here, so the number is what decides whose booking may be read and changed, and the
 * platform resolves it itself rather than trusting an id a caller could have guessed.
 */
export class CnctBookings {
  constructor(private readonly client: CnctAgentClient) {}

  /** What the business can be booked for. An empty list means it books generically. */
  async services(): Promise<CnctListing<CnctService>> {
    const result = await this.client.call('list_services');
    return listing(result, 'services', toService);
  }

  /**
   * The people and tables that can be asked for by name.
   *
   * **An empty list is an instruction, not an absence.** A business that has switched named preference
   * off is telling you not to offer a choice of person — the reason accounts turn it off is that one
   * popular stylist absorbs every request while three others sit idle. `note` says which case you are
   * in.
   */
  async people(): Promise<CnctListing<CnctBookableResource>> {
    const result = await this.client.call('list_people');
    return listing(result, 'people', toResource);
  }

  /**
   * The free times on a date. **Always call this before offering anybody a time.**
   *
   * `date` is `YYYY-MM-DD` in the business's own timezone — the one `CnctBookingRules.timezone` names,
   * which is not necessarily the browser's.
   */
  async checkAvailability(input: {
    date: string;
    serviceId?: string;
    resourceId?: string;
    partySize?: number;
    locationId?: string;
  }): Promise<CnctAvailability> {
    const result = await this.client.callOrThrow(
      'check_availability',
      compact({
        date: input.date,
        serviceId: input.serviceId,
        resourceId: input.resourceId,
        partySize: input.partySize,
        locationId: input.locationId,
      }),
    );
    return {
      date: text(result.date),
      free: asArray(result.free).map(toSlot),
      note: optionalText(result.note),
    };
  }

  /**
   * Take a booking at a time {@link checkAvailability} reported free.
   *
   * Pass `startsAt` exactly as the slot gave it. Rebuilding it from a parsed `Date` is how a booking
   * lands on a time nobody offered.
   *
   * `nameIsTheCaller` is small and load-bearing. A booking's name and a customer's name are different
   * facts about different people: somebody booking a haircut for their daughter gives their daughter's
   * name, and filing it against the number would rename the contact permanently. Leave it false unless
   * the name given is the phone number's own owner.
   */
  async create(input: {
    startsAt: string;
    customerPhone: string;
    serviceId?: string;
    resourceId?: string;
    partySize?: number;
    name?: string;
    nameIsTheCaller?: boolean;
    notes?: string;
    locationId?: string;
  }): Promise<CnctBookingConfirmation> {
    const result = await this.client.callOrThrow('create_booking', {
      ...compact({
        startsAt: input.startsAt,
        customerPhone: input.customerPhone,
        serviceId: input.serviceId,
        resourceId: input.resourceId,
        partySize: input.partySize,
        name: input.name,
        notes: input.notes,
        locationId: input.locationId,
      }),
      nameIsTheCaller: input.nameIsTheCaller ?? false,
    });
    return {
      bookingId: text(result.bookingId),
      when: text(result.when),
      name: optionalText(result.name),
      partySize: optionalNumber(result.partySize),
      resourceName: optionalText(result.with),
      sandbox: result.sandbox === true,
    };
  }

  /**
   * One customer's upcoming bookings. Call this before changing anything — you need the id, and the
   * lookup is also what proves the booking is theirs.
   */
  async forCustomer(customerPhone: string): Promise<CnctListing<CnctBookingSummary>> {
    const result = await this.client.call('find_my_booking', { customerPhone });
    return listing(result, 'bookings', toBookingSummary);
  }

  /** Move one of that customer's bookings to a different free time. */
  async reschedule(input: {
    bookingId: string;
    startsAt: string;
    customerPhone: string;
  }): Promise<string> {
    const result = await this.client.callOrThrow('reschedule_booking', { ...input });
    return text(result.when);
  }

  /**
   * Cancel one of that customer's bookings. Returns the time it *was* at, for the sentence you say
   * back to them.
   */
  async cancel(input: { bookingId: string; customerPhone: string }): Promise<string> {
    const result = await this.client.callOrThrow('cancel_booking', { ...input });
    return text(result.was);
  }
}

/** Tickets: the work a business could not finish in the moment and hands to a colleague. */
export class CnctTickets {
  constructor(private readonly client: CnctAgentClient) {}

  /**
   * The kinds of work this business hands over. Start here — the type decides what facts are needed.
   *
   * An empty list with a `refusal` means no ticket types are configured yet, which is an account setup
   * step rather than a failure of this call.
   */
  async types(): Promise<CnctListing<CnctTicketType>> {
    const result = await this.client.call('list_ticket_types');
    return listing(result, 'types', toTicketType);
  }

  /**
   * What one type still needs before it can be raised.
   *
   * The subtraction happens on the server: `askFor` is already only the questions worth asking, with
   * what the platform knows about this customer removed. Ask for those and nothing else.
   */
  async type(ticketTypeId: string): Promise<CnctTicketTypeDetail> {
    const result = await this.client.callOrThrow('get_ticket_type', { ticketTypeId });
    return {
      ticketTypeId: text(result.ticketTypeId),
      name: text(result.name),
      alreadyKnown: isObject(result.alreadyKnown) ? result.alreadyKnown : {},
      askFor: asArray(result.askFor).map(toTicketField),
    };
  }

  /**
   * Raise one.
   *
   * `fields` is keyed exactly as {@link type} named them — never invent a key. `idempotencyKey` is
   * worth sending: retry with the same value and you get the same ticket back rather than a second one.
   * Omit it and every call raises a new ticket.
   */
  async create(input: {
    ticketTypeId: string;
    title: string;
    reasonUnresolved: string;
    customerPhone?: string;
    customerRequest?: string;
    desiredOutcome?: string;
    actionsTaken?: string;
    recommendedNextAction?: string;
    priority?: string;
    fields?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<CnctRaisedTicket> {
    const result = await this.client.callOrThrow(
      'create_ticket',
      compact({
        ticketTypeId: input.ticketTypeId,
        title: input.title,
        reasonUnresolved: input.reasonUnresolved,
        customerPhone: input.customerPhone,
        customerRequest: input.customerRequest,
        desiredOutcome: input.desiredOutcome,
        actionsTaken: input.actionsTaken,
        recommendedNextAction: input.recommendedNextAction,
        priority: input.priority,
        fields: input.fields && Object.keys(input.fields).length ? input.fields : undefined,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    return {
      ticketNumber: numberOr(result.ticketNumber, 0),
      note: optionalText(result.note),
      sandbox: result.sandbox === true,
    };
  }

  /**
   * One customer's open tickets, found by their number. Never describe a ticket to anybody but the
   * person it belongs to.
   */
  async forCustomer(customerPhone: string): Promise<CnctListing<CnctTicketSummary>> {
    const result = await this.client.call('find_my_tickets', { customerPhone });
    return listing(result, 'tickets', toTicketSummary);
  }
}

// ── Reading what the platform sent ───────────────────────────────────────────────────────────────

function listing<T>(
  result: Record<string, unknown>,
  key: string,
  parse: (raw: Record<string, unknown>) => T,
): CnctListing<T> {
  return {
    items: asArray(result[key]).map(parse),
    note: optionalText(result.note),
    refusal: optionalText(result.error),
  };
}

function toTool(raw: Record<string, unknown>): CnctTool {
  const parameters = isObject(raw.parameters)
    ? raw.parameters
    : isObject(raw.inputSchema)
      ? raw.inputSchema
      : {};
  return { name: text(raw.name), description: text(raw.description), parameters };
}

function toRules(raw: Record<string, unknown>): CnctBookingRules {
  return {
    timezone: text(raw.timezone) || 'UTC',
    capacity: numberOr(raw.capacity, 0),
    slotMinutes: numberOr(raw.slotMinutes, 0),
    services: asArray(raw.services).map(toServiceFromRules),
    resources: asArray(raw.resources).map(toResourceFromRules),
    raw,
  };
}

function toService(raw: Record<string, unknown>): CnctService {
  return {
    serviceId: text(raw.serviceId),
    name: text(raw.name),
    minutes: optionalNumber(raw.minutes),
    description: optionalText(raw.description),
  };
}

/** The same thing under the keys `GET /api/booking-tools` uses for it. */
function toServiceFromRules(raw: Record<string, unknown>): CnctService {
  return {
    serviceId: text(raw.id) || text(raw.serviceId),
    name: text(raw.name),
    minutes: optionalNumber(raw.durationMinutes) ?? optionalNumber(raw.minutes),
    description: optionalText(raw.description),
  };
}

function toResource(raw: Record<string, unknown>): CnctBookableResource {
  return {
    resourceId: text(raw.resourceId),
    name: text(raw.name),
    kind: optionalText(raw.kind),
    seats: optionalNumber(raw.seats),
  };
}

function toResourceFromRules(raw: Record<string, unknown>): CnctBookableResource {
  const kind = optionalText(raw.kind);
  return {
    resourceId: text(raw.id) || text(raw.resourceId),
    name: text(raw.name),
    kind: kind ? kind.toLowerCase() : null,
    seats: optionalNumber(raw.seats),
  };
}

function toSlot(raw: Record<string, unknown>): CnctSlot {
  return {
    time: text(raw.time),
    startsAt: text(raw.startsAt),
    resourceName: optionalText(raw.with),
  };
}

function toBookingSummary(raw: Record<string, unknown>): CnctBookingSummary {
  return {
    bookingId: text(raw.bookingId),
    when: text(raw.when),
    name: optionalText(raw.name),
    partySize: optionalNumber(raw.partySize),
  };
}

function toTicketType(raw: Record<string, unknown>): CnctTicketType {
  return {
    ticketTypeId: text(raw.ticketTypeId),
    name: text(raw.name),
    description: optionalText(raw.description),
  };
}

function toTicketField(raw: Record<string, unknown>) {
  return {
    key: text(raw.key),
    required: raw.required === true,
    question: text(raw.question),
    mustBeOneOf: asUnknownArray(raw.mustBeOneOf).map((item) => String(item)),
  };
}

function toTicketSummary(raw: Record<string, unknown>): CnctTicketSummary {
  return {
    ticketNumber: numberOr(raw.ticketNumber, 0),
    title: text(raw.title),
    status: text(raw.status),
    raised: optionalText(raw.raised),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function numberOr(value: unknown, fallback: number): number {
  return optionalNumber(value) ?? fallback;
}

/** Drop the keys that were not given, so an omitted option is absent rather than `null` on the wire. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}
