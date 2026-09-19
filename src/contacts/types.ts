/**
 * A tag on a contact — the business's own vocabulary for the people in its directory.
 *
 * Distinct from a label, which describes a conversation. The two pools were split deliberately, so a
 * tag id is never a label id.
 */
export interface CnctTag {
  id: string;
  name: string;
  /** As the console stores it, usually a hex string. Null where the account never set one. */
  colour: string | null;
  /** How many contacts carry it. Only present on the tag list. */
  contactCount: number | null;
}

/**
 * A person in the account's directory.
 *
 * **Three identities, any one of which is enough to be a person here**: a phone number, an email
 * address, and `identifier` — the client's own id for somebody. Each is unique per account and each is
 * optional; a contact with a name and nothing else could never be found again, so the platform refuses
 * to create one.
 */
export interface CnctContact {
  id: string;
  name: string | null;
  /** In full international form, as the platform normalises it. */
  phoneNumber: string | null;
  email: string | null;
  /**
   * The client's own id for this person. The one identity a business controls, and therefore the only
   * one that cannot be a coincidence.
   */
  identifier: string | null;
  company: string | null;
  notes: string | null;
  /**
   * True when this person's inbound messages are being dropped. Their history stays readable — being
   * blocked changes what happens next, not what already happened.
   */
  blocked: boolean;
  /** When they said stop, ISO 8601. Campaigns skip anybody with this set, and so should you. */
  optedOutAt: string | null;
  tags: CnctTag[];
  /** The fields this account invented, keyed by the custom attribute's key. */
  customAttributes: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * The record as it arrived, for the columns this SDK version does not model. Reading a field from
   * here is always safe; relying on one is a bet that the platform keeps it.
   */
  raw: Record<string, unknown>;
}

/** One page of the directory. */
export interface CnctContactPage {
  contacts: CnctContact[];
  /** Everything the filters match, not just this page — so a pager can say where in it you are. */
  total: number;
  /**
   * Pass to the next call. **Null is the end**, and it is the only reliable one: a short page never
   * issues a cursor, so a list cannot spin on a final request that returns nothing.
   */
  nextCursor: string | null;
}

/** One of the accounts a person has a seat in. Returned when a login has to be told which. */
export interface CnctOrganizationChoice {
  slug: string;
  name: string;
}

/**
 * A login that is one step from finished: the password was right, and a second factor is wanted.
 *
 * Hold `mfaToken` — it is a five-minute credential and the only thing that ties the code to this
 * attempt — and call `verifyMfa` with the code the person gives you.
 */
export interface CnctMfaChallenge {
  /** `TOTP` or `EMAIL`. Decides what to say: an authenticator app, or "check your email". */
  method: string;
  /** Five minutes, and scoped to this attempt. */
  mfaToken: string;
}

/**
 * What to put on a row when the name is missing, which for a person who has only ever rung is the
 * ordinary case.
 */
export function displayNameOf(contact: CnctContact): string {
  const name = contact.name?.trim();
  return name || contact.phoneNumber || contact.email || contact.identifier || 'Unknown';
}
