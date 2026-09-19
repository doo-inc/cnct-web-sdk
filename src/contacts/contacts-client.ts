import { CnctConfig, type CnctConfigInput } from '../config.js';
import { CnctOperatorToken } from '../credentials.js';
import { CnctError, CnctErrorCode } from '../errors.js';
import { CnctTransport, expectObject } from '../transport.js';
import type { CnctContact, CnctContactPage, CnctTag } from './types.js';

/**
 * Thrown when a contact cannot be created because one of its identities already belongs to somebody.
 *
 * The platform asks before it writes precisely so this can name who it collided with — a unique
 * violation carries the constraint, not the row. Offer to open `existingId` rather than sending
 * somebody to the search box to look for a person they were just told is there.
 */
export class CnctContactConflict extends CnctError {
  readonly existingId: string | null;
  readonly existingName: string | null;

  constructor(
    message: string,
    options: { existingId: string | null; existingName: string | null; details?: unknown },
  ) {
    super(message, CnctErrorCode.conflict, 409, options.details);
    this.existingId = options.existingId;
    this.existingName = options.existingName;
  }
}

/**
 * The account's contact directory.
 *
 * Needs a {@link CnctOperatorToken} — a person's console session. There is no contacts surface on the
 * API-key credential today, so an unattended integration cannot reach this: that is the platform's
 * boundary rather than this SDK's, and it is worth knowing before you design around it.
 *
 * ```js
 * const { session } = await cnct.auth.login({ email, password });
 * const contacts = cnct.contacts(session.credentials);
 *
 * let page = await contacts.list({ query: 'layla' });
 * while (page.nextCursor) {
 *   page = await contacts.list({ query: 'layla', cursor: page.nextCursor });
 * }
 * ```
 */
export class CnctContactsClient {
  readonly config: CnctConfig;
  private readonly transport: CnctTransport;
  private readonly headers: Record<string, string>;

  constructor(options: {
    config: CnctConfig | CnctConfigInput;
    credentials: CnctOperatorToken | string;
    transport?: CnctTransport;
  }) {
    this.config =
      options.config instanceof CnctConfig ? options.config : new CnctConfig(options.config);
    const credentials =
      options.credentials instanceof CnctOperatorToken
        ? options.credentials
        : new CnctOperatorToken(options.credentials);
    this.transport = options.transport ?? new CnctTransport(this.config);
    this.headers = credentials.headers;
  }

  /**
   * One page of the directory, most recently touched first.
   *
   * Paged by cursor rather than by offset, and that is not a style choice: every inbound message
   * touches the contact it belongs to, so the order is being rewritten while somebody scrolls it.
   * Under an offset that is page two silently re-showing half of page one.
   *
   * `attributes` narrows by the account's own fields, as `key:value` pairs.
   */
  async list(
    options: {
      query?: string;
      tagIds?: string[];
      attributes?: string[];
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<CnctContactPage> {
    const body = expectObject(
      await this.transport.get('/api/contacts', {
        query: {
          ...(options.query ? { q: options.query } : {}),
          ...(options.tagIds?.length ? { tagId: options.tagIds.join(',') } : {}),
          ...(options.attributes?.length ? { attr: options.attributes } : {}),
          take: options.limit ?? 100,
          ...(options.cursor ? { cursor: options.cursor } : {}),
        },
        headers: this.headers,
      }),
    );
    return {
      contacts: asArray(body.contacts).map(toContact),
      total: numberOr(body.total, 0),
      nextCursor: optionalText(body.nextCursor),
    };
  }

  /**
   * Every page, as one async iterable. Stops when the platform stops issuing cursors.
   *
   * ```js
   * for await (const contact of contacts.listAll({ query: 'layla' })) { … }
   * ```
   *
   * Convenient, and worth being deliberate about: an account with twenty-five thousand contacts will
   * happily hand you all of them. Take what you need.
   */
  async *listAll(
    options: {
      query?: string;
      tagIds?: string[];
      attributes?: string[];
      pageSize?: number;
    } = {},
  ): AsyncGenerator<CnctContact> {
    let cursor: string | undefined;
    do {
      const page = await this.list({
        query: options.query,
        tagIds: options.tagIds,
        attributes: options.attributes,
        limit: options.pageSize ?? 100,
        cursor,
      });
      yield* page.contacts;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  /** One person, with the history the console shows beside them in `raw`. */
  async get(contactId: string): Promise<CnctContact> {
    return toContact(
      expectObject(
        await this.transport.get(`/api/contacts/${encodeURIComponent(contactId)}`, {
          headers: this.headers,
        }),
      ),
    );
  }

  /**
   * Add somebody by hand.
   *
   * **At least one of `phoneNumber`, `email` and `identifier` is required**, and the name is not one of
   * them. Two people called Ahmed are two people; a directory keyed on what somebody is called is a
   * directory that merges strangers.
   *
   * Throws {@link CnctContactConflict} when one of those identities is already somebody else's.
   */
  async create(input: {
    name?: string;
    phoneNumber?: string;
    email?: string;
    identifier?: string;
    company?: string;
    notes?: string;
    tagIds?: string[];
  }): Promise<CnctContact> {
    if (!input.phoneNumber?.trim() && !input.email?.trim() && !input.identifier?.trim()) {
      throw new CnctError(
        'A contact needs a phone number, an email address or an id to be found by.',
        CnctErrorCode.invalid,
      );
    }
    try {
      return toContact(
        expectObject(
          await this.transport.post('/api/contacts', {
            body: compact({
              name: input.name,
              phoneNumber: input.phoneNumber,
              email: input.email,
              identifier: input.identifier,
              company: input.company,
              notes: input.notes,
              tagIds: input.tagIds?.length ? input.tagIds : undefined,
            }),
            headers: this.headers,
          }),
        ),
      );
    } catch (error) {
      if (!(error instanceof CnctError) || error.status !== 409) throw error;
      const details = error.details as Record<string, unknown> | undefined;
      const existing = details && isObject(details.contact) ? details.contact : undefined;
      throw new CnctContactConflict(error.message, {
        existingId: existing ? optionalText(existing.id) : null,
        existingName: existing ? optionalText(existing.name) : null,
        details: error.details,
      });
    }
  }

  /**
   * Change what a person's record says.
   *
   * A partial update: omitted fields are left alone, and an empty string clears a field rather than
   * storing `""`. `customAttributes` is itself a patch — send only the keys that changed, and `null` to
   * clear one.
   *
   * The three identities are deliberately not editable here. Correcting somebody's number is a merge,
   * not an edit — see {@link merge}.
   */
  async update(
    contactId: string,
    changes: {
      name?: string;
      email?: string;
      company?: string;
      notes?: string;
      customAttributes?: Record<string, unknown>;
    },
  ): Promise<CnctContact> {
    return toContact(
      expectObject(
        await this.transport.patch(`/api/contacts/${encodeURIComponent(contactId)}`, {
          body: compact({
            name: changes.name,
            email: changes.email,
            company: changes.company,
            notes: changes.notes,
            customAttributes: changes.customAttributes,
          }),
          headers: this.headers,
        }),
      ),
    );
  }

  /**
   * Fold one record into another, keeping `into`.
   *
   * Never do this speculatively. Identity resolution refuses to merge on its own for a reason: a shared
   * household number is not proof that two histories belong to one person. This is the explicit
   * decision, made while looking at both records — and the duplicate is deleted.
   */
  async merge(input: { contactId: string; into: string }): Promise<CnctContact> {
    const body = expectObject(
      await this.transport.post(`/api/contacts/${encodeURIComponent(input.contactId)}/merge`, {
        body: { into: input.into },
        headers: this.headers,
      }),
    );
    return toContact(isObject(body.contact) ? body.contact : body);
  }

  /** Put a tag on somebody. Idempotent — the same tag twice is one assignment. */
  async addTag(input: { contactId: string; tagId: string }): Promise<CnctContact> {
    return toContact(
      expectObject(
        await this.transport.post(`/api/contacts/${encodeURIComponent(input.contactId)}/tags`, {
          body: { tagId: input.tagId },
          headers: this.headers,
        }),
      ),
    );
  }

  /** Take one off. */
  async removeTag(input: { contactId: string; tagId: string }): Promise<CnctContact> {
    return toContact(
      expectObject(
        await this.transport.delete(
          `/api/contacts/${encodeURIComponent(input.contactId)}/tags/${encodeURIComponent(input.tagId)}`,
          { headers: this.headers },
        ),
      ),
    );
  }

  /**
   * The account's tags, with how many people carry each. This is where a tag id comes from — the list
   * and the create call both take ids, never names.
   */
  async tags(): Promise<CnctTag[]> {
    const body = await this.transport.get('/api/tags', { headers: this.headers });
    if (!Array.isArray(body)) {
      throw new CnctError(
        `Expected a list of tags and got ${body === null ? 'null' : typeof body}.`,
        CnctErrorCode.badResponse,
      );
    }
    return body.filter(isObject).map(toTag);
  }
}

// ── Reading what the platform sent ───────────────────────────────────────────────────────────────

export function toContact(raw: Record<string, unknown>): CnctContact {
  return {
    id: text(raw.id),
    name: optionalText(raw.name),
    phoneNumber: optionalText(raw.phoneNumber),
    email: optionalText(raw.email),
    identifier: optionalText(raw.identifier),
    company: optionalText(raw.company),
    notes: optionalText(raw.notes),
    blocked: raw.blocked === true,
    optedOutAt: optionalText(raw.optedOutAt),
    // A tag arrives as an assignment wrapping the tag, or as the tag itself, depending on the route.
    tags: asArray(raw.tags).map((assignment) =>
      toTag(isObject(assignment.tag) ? assignment.tag : assignment),
    ),
    customAttributes: isObject(raw.customAttributes) ? raw.customAttributes : {},
    createdAt: optionalText(raw.createdAt),
    updatedAt: optionalText(raw.updatedAt),
    raw,
  };
}

function toTag(raw: Record<string, unknown>): CnctTag {
  return {
    id: text(raw.id),
    name: text(raw.name),
    colour: optionalText(raw.color) ?? optionalText(raw.colour),
    contactCount: optionalNumber(raw.contactCount),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
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

function compact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
