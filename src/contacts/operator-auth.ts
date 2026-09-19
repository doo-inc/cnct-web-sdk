import { CnctConfig, type CnctConfigInput } from '../config.js';
import { CnctOperatorToken } from '../credentials.js';
import { CnctError, CnctErrorCode } from '../errors.js';
import { CnctTransport, expectObject } from '../transport.js';
import type { CnctMfaChallenge, CnctOrganizationChoice } from './types.js';

/** The platform issues eight-hour operator sessions. Recorded here rather than assumed in three files. */
const SESSION_HOURS = 8;

/**
 * Thrown when the person signing in belongs to more than one account and did not say which.
 *
 * Not a failure to recover from silently: put `organizations` in front of them and call `login` again
 * with the slug they chose.
 */
export class CnctChooseOrganization extends CnctError {
  readonly organizations: CnctOrganizationChoice[];

  constructor(message: string, organizations: CnctOrganizationChoice[], details?: unknown) {
    super(message, CnctErrorCode.conflict, 409, details);
    this.organizations = organizations;
  }
}

/** A finished login. */
export interface CnctOperatorSession {
  /** Pass this to `cnct.contacts(...)`. */
  credentials: CnctOperatorToken;
  userId: string;
  email: string;
  /**
   * Their role in this account. It decides what the rest of the API will let them do — this SDK does
   * not second-guess it, the server does.
   */
  role: string;
  organizationName: string;
  /** True when the platform wants a new password before real work. Honour it: the console does. */
  mustChangePassword: boolean;
}

/**
 * Signing an operator in.
 *
 * **This is a person's login, not an integration credential.** It lasts eight hours, it carries
 * whatever that person's role allows, and it is the right thing for a back-office app run by staff. It
 * is the wrong thing for anything a customer holds — for that see `CnctChatPublicKey`, and for
 * unattended software see `CnctApiKey`.
 */
export class CnctOperatorAuth {
  readonly config: CnctConfig;
  private readonly transport: CnctTransport;

  constructor(options: { config: CnctConfig | CnctConfigInput; transport?: CnctTransport }) {
    this.config =
      options.config instanceof CnctConfig ? options.config : new CnctConfig(options.config);
    this.transport = options.transport ?? new CnctTransport(this.config);
  }

  /**
   * Sign in.
   *
   * Resolves with `{ session }` on success and `{ challenge }` when a second factor is wanted — a
   * returned value rather than a thrown one, because a challenge is the ordinary path for an account
   * with MFA on and not an error to catch.
   *
   * Throws {@link CnctChooseOrganization} when the person has seats in more than one account. Throws
   * `unauthenticated` when the credentials are wrong; the server does not say which half was wrong and
   * neither does this.
   */
  async login(input: {
    email: string;
    password: string;
    organizationSlug?: string;
  }): Promise<{ session: CnctOperatorSession | null; challenge: CnctMfaChallenge | null }> {
    try {
      const data = expectObject(
        await this.transport.post('/api/auth/login', {
          body: {
            email: input.email,
            password: input.password,
            ...(input.organizationSlug ? { organizationSlug: input.organizationSlug } : {}),
          },
        }),
      );
      if (data.mfaRequired === true) {
        return {
          session: null,
          challenge: {
            mfaToken: text(data.mfaToken),
            method: text(data.mfaMethod) || 'TOTP',
          },
        };
      }
      return { session: this.toSession(data), challenge: null };
    } catch (error) {
      throw maybeChoice(error);
    }
  }

  /** Finish a login that wanted a second factor. */
  async verifyMfa(input: { mfaToken: string; code: string }): Promise<CnctOperatorSession> {
    const data = expectObject(
      await this.transport.post('/api/auth/mfa/verify', {
        body: { token: input.mfaToken, code: input.code },
      }),
    );
    return this.toSession(data);
  }

  /** Ask for the emailed code again, where the account's method is email. */
  async resendEmailCode(mfaToken: string): Promise<void> {
    await this.transport.post('/api/auth/mfa/email/resend', { body: { token: mfaToken } });
  }

  /**
   * Who a token belongs to, and which account. Also the cheapest way to check one is still good: an
   * expired or revoked token answers `unauthenticated` here.
   */
  async whoAmI(token: CnctOperatorToken | string): Promise<CnctOperatorSession> {
    const credentials = token instanceof CnctOperatorToken ? token : new CnctOperatorToken(token);
    const data = expectObject(
      await this.transport.get('/api/auth/me', { headers: credentials.headers }),
    );
    return { ...readSession(data), credentials };
  }

  private toSession(data: Record<string, unknown>): CnctOperatorSession {
    const token = data.token;
    if (typeof token !== 'string' || token === '') {
      throw new CnctError('The server did not return a session token.', CnctErrorCode.badResponse);
    }
    return {
      ...readSession(data),
      credentials: new CnctOperatorToken(token, {
        expiresAt: new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000),
      }),
    };
  }
}

function readSession(data: Record<string, unknown>): Omit<CnctOperatorSession, 'credentials'> {
  const user = isObject(data.user) ? data.user : {};
  const organization = isObject(data.organization) ? data.organization : {};
  return {
    userId: text(user.id),
    email: text(user.email),
    role: text(user.role),
    organizationName: text(organization.name),
    mustChangePassword: user.mustChangePassword === true,
  };
}

function maybeChoice(error: unknown): unknown {
  if (!(error instanceof CnctError) || error.status !== 409) return error;
  const details = error.details;
  const list = isObject(details) ? details.organizations : undefined;
  const organizations = (Array.isArray(list) ? list : []).filter(isObject).map((item) => ({
    slug: text(item.slug),
    name: text(item.name),
  }));
  return new CnctChooseOrganization(error.message, organizations, error.details);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
