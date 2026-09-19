import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Cnct,
  CnctChooseOrganization,
  CnctContactConflict,
  CnctOperatorToken,
  displayNameOf,
} from '../src/index.js';
import { startMockCnct, type MockCnct } from './support/server.js';

let cnct: MockCnct;

beforeEach(async () => {
  cnct = await startMockCnct();
});

afterEach(async () => {
  await cnct.close();
});

const sdk = () => new Cnct({ baseUrl: cnct.baseUrl });
const contactsFor = () => sdk().contacts(new CnctOperatorToken('op-token'));

describe('signing an operator in', () => {
  it('hands back a session with the token the directory needs', async () => {
    const { session, challenge } = await sdk().auth.login({
      email: 'operator@example.com',
      password: 'correct',
    });
    expect(challenge).toBeNull();
    expect(session?.role).toBe('OWNER');
    expect(session?.organizationName).toBe('DOO');
    expect(session?.credentials.token).toBe('op-token');
    // Eight hours is what the platform issues, and the caller should be able to see it coming.
    expect(session?.credentials.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 7 * 3600_000);
    expect(session?.credentials.isExpired).toBe(false);
  });

  it('returns a challenge rather than throwing, because MFA is the ordinary path', async () => {
    const { session, challenge } = await sdk().auth.login({
      email: 'mfa@example.com',
      password: 'correct',
    });
    expect(session).toBeNull();
    expect(challenge).toEqual({ mfaToken: 'mfa-token', method: 'EMAIL' });

    const finished = await sdk().auth.verifyMfa({ mfaToken: 'mfa-token', code: '123456' });
    expect(finished.credentials.token).toBe('op-token');
  });

  it('names the accounts to choose from when somebody has a seat in more than one', async () => {
    await expect(
      sdk().auth.login({ email: 'two@example.com', password: 'correct' }),
    ).rejects.toBeInstanceOf(CnctChooseOrganization);

    try {
      await sdk().auth.login({ email: 'two@example.com', password: 'correct' });
    } catch (error) {
      expect((error as CnctChooseOrganization).organizations).toEqual([
        { slug: 'doo', name: 'DOO' },
        { slug: 'qimam', name: 'Qimam' },
      ]);
    }

    const { session } = await sdk().auth.login({
      email: 'two@example.com',
      password: 'correct',
      organizationSlug: 'doo',
    });
    expect(session?.credentials.token).toBe('op-token');
  });

  it('says unauthenticated, without saying which half was wrong', async () => {
    await expect(
      sdk().auth.login({ email: 'operator@example.com', password: 'nope' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('checks a token it was handed', async () => {
    const who = await sdk().auth.whoAmI('op-token');
    expect(who.email).toBe('operator@example.com');
    await expect(sdk().auth.whoAmI('stale')).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('the directory', () => {
  it('reads a page, with the total behind the filters rather than behind the page', async () => {
    const page = await contactsFor().list({ query: 'layla' });
    expect(page.contacts).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.nextCursor).toBe('page2');
    expect(cnct.requests[0]?.path).toContain('q=layla');
    expect(cnct.requests[0]?.path).toContain('take=100');
  });

  it('walks every page and stops when the platform stops issuing cursors', async () => {
    const seen: string[] = [];
    for await (const contact of contactsFor().listAll()) seen.push(contact.id);
    expect(seen).toEqual(['c_1', 'c_2']);
  });

  it('flattens a tag whether it arrives wrapped in an assignment or on its own', async () => {
    const page = await contactsFor().list();
    expect(page.contacts[0]?.tags).toEqual([
      { id: 'tag_1', name: 'VIP', colour: '#b52d93', contactCount: null },
    ]);
  });

  it('keeps the whole record for the columns this version does not model', async () => {
    const contact = await contactsFor().get('c_1');
    expect(contact.customAttributes).toEqual({ plan: 'gold' });
    expect(contact.raw.updatedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('has something to put on a row for somebody who has only ever rung', () => {
    expect(displayNameOf({ name: null, phoneNumber: '+97312345678' } as never)).toBe(
      '+97312345678',
    );
    expect(displayNameOf({ name: '  Layla ' } as never)).toBe('Layla');
    expect(displayNameOf({} as never)).toBe('Unknown');
  });

  it("narrows by the account's own fields, repeated rather than joined", async () => {
    await contactsFor().list({ attributes: ['plan:gold', 'tier:2'], tagIds: ['tag_1'] });
    expect(cnct.requests[0]?.path).toContain('attr=plan%3Agold&attr=tier%3A2');
    expect(cnct.requests[0]?.path).toContain('tagId=tag_1');
  });
});

describe('adding somebody', () => {
  it('refuses a contact that could never be found again, before a request is made', async () => {
    await expect(contactsFor().create({ name: 'Ahmed' })).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(cnct.requests).toHaveLength(0);
  });

  it('names who it collided with, rather than sending you to the search box', async () => {
    await expect(
      contactsFor().create({ name: 'Layla', phoneNumber: '+97300000000' }),
    ).rejects.toBeInstanceOf(CnctContactConflict);

    try {
      await contactsFor().create({ name: 'Layla', phoneNumber: '+97300000000' });
    } catch (error) {
      const conflict = error as CnctContactConflict;
      expect(conflict.existingId).toBe('c_9');
      expect(conflict.existingName).toBe('Existing Person');
      expect(conflict.code).toBe('conflict');
    }
  });

  it('creates one on any single identity', async () => {
    const created = await contactsFor().create({ identifier: 'crm-42' });
    expect(created.id).toBe('c_new');
  });
});

describe('changing a record', () => {
  it('sends only what changed, so an omitted field is left alone', async () => {
    await contactsFor().update('c_1', { company: 'Qimam' });
    expect(cnct.requests.at(-1)?.body).toEqual({ company: 'Qimam' });
  });

  it('passes an empty string through, because clearing a field is not the same as omitting it', async () => {
    await contactsFor().update('c_1', { notes: '' });
    expect(cnct.requests.at(-1)?.body).toEqual({ notes: '' });
  });

  it('merges, and answers with the record that survived', async () => {
    const kept = await contactsFor().merge({ contactId: 'c_2', into: 'c_1' });
    expect(kept.id).toBe('c_1');
    expect(cnct.requests.at(-1)?.body).toEqual({ into: 'c_1' });
  });

  it('adds and removes a tag by id', async () => {
    await contactsFor().addTag({ contactId: 'c_1', tagId: 'tag_1' });
    expect(cnct.requests.at(-1)?.method).toBe('POST');
    await contactsFor().removeTag({ contactId: 'c_1', tagId: 'tag_1' });
    expect(cnct.requests.at(-1)?.method).toBe('DELETE');
  });

  it('lists the tags a tag id could come from', async () => {
    const tags = await contactsFor().tags();
    expect(tags).toEqual([{ id: 'tag_1', name: 'VIP', colour: '#b52d93', contactCount: 3 }]);
  });
});
