import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cnct, CnctApiKey, CnctError } from '../src/index.js';
import { startMockCnct, type MockCnct } from './support/server.js';

let cnct: MockCnct;

beforeEach(async () => {
  cnct = await startMockCnct();
});

afterEach(async () => {
  await cnct.close();
});

const agentFor = (server: MockCnct) =>
  new Cnct({ baseUrl: server.baseUrl }).agent(new CnctApiKey('kaer_sk_test'));

describe('the credential', () => {
  it('refuses anything that is not shaped like a CNCT key, before a request is made', () => {
    expect(() => new CnctApiKey('inbox-public-key')).toThrow(/starts with "kaer_sk_"/);
    expect(() => new CnctApiKey('')).toThrow(/cannot be empty/);
  });

  it('travels as a bearer token', async () => {
    await agentFor(cnct).catalogue();
    expect(cnct.requests[0]?.headers.authorization).toBe('Bearer kaer_sk_test');
  });

  it('redacts itself for a log', () => {
    expect(new CnctApiKey('kaer_sk_abcdefgh').redacted).toBe('apiKey:…efgh');
  });

  /**
   * Keys minted before there were two kinds have neither segment and are production — the platform
   * says so, and this has to agree or an old key would read as something it is not.
   */
  it('reads which kind it is from its prefix', () => {
    expect(new CnctApiKey('kaer_sk_test_abc').mode).toBe('sandbox');
    expect(new CnctApiKey('kaer_sk_test_abc').isSandbox).toBe(true);
    expect(new CnctApiKey('kaer_sk_live_abc').mode).toBe('production');
    expect(new CnctApiKey('kaer_sk_mintedbeforemodes').mode).toBe('production');
  });
});

describe('a sandbox key', () => {
  const sandboxFor = (server: MockCnct) =>
    new Cnct({ baseUrl: server.baseUrl }).agent(new CnctApiKey('kaer_sk_test_sandbox'));

  it('says so on the agent, in the catalogue, and on everything it makes', async () => {
    const agent = sandboxFor(cnct);
    expect(agent.mode).toBe('sandbox');
    expect((await agent.catalogue()).sandbox).toBe(true);
    const booking = await agent.bookings.create({
      startsAt: '2026-09-20T16:30:00.000Z',
      customerPhone: '+97312345678',
    });
    expect(booking.sandbox).toBe(true);
    const ticket = await agent.tickets.create({
      ticketTypeId: 'tt_1',
      title: 'Leaking tap',
      reasonUnresolved: 'Needs a plumber',
    });
    expect(ticket.sandbox).toBe(true);
  });

  it('is not what a production key gets back', async () => {
    const agent = agentFor(cnct);
    expect(agent.mode).toBe('production');
    expect((await agent.catalogue()).sandbox).toBe(false);
    const booking = await agent.bookings.create({
      startsAt: '2026-09-20T16:30:00.000Z',
      customerPhone: '+97312345678',
    });
    expect(booking.sandbox).toBe(false);
  });
});

describe('the catalogue', () => {
  it('carries the rules beside the tools, so one request answers both questions', async () => {
    const { tools, rules } = await agentFor(cnct).catalogue();
    expect(tools[0]?.name).toBe('check_availability');
    expect(rules.timezone).toBe('Asia/Bahrain');
    expect(rules.slotMinutes).toBe(30);
    expect(rules.services[0]).toMatchObject({ serviceId: 'svc_1', name: 'Haircut', minutes: 45 });
    expect(rules.resources[0]).toMatchObject({ resourceId: 'res_1', kind: 'person' });
  });

  it('keeps everything it does not model, rather than dropping the hours on the floor', async () => {
    const { rules } = await agentFor(cnct).catalogue();
    expect(rules.raw.hours).toEqual({ mon: '09:00-18:00' });
  });
});

describe('bookings', () => {
  it('reads a day', async () => {
    const day = await agentFor(cnct).bookings.checkAvailability({ date: '2026-09-20' });
    expect(day.date).toBe('2026-09-20');
    expect(day.free).toHaveLength(2);
    expect(day.free[0]).toMatchObject({ time: '19:30', resourceName: 'Layla' });
    expect(day.free[1]?.resourceName).toBeNull();
  });

  it('raises a refusal rather than handing back an empty day that means something else', async () => {
    await expect(
      agentFor(cnct).bookings.checkAvailability({ date: '2026-12-25' }),
    ).rejects.toMatchObject({ code: 'tool_refused', message: 'We are closed that day.' });
  });

  it('sends startsAt through untouched, because it is the token the slot is matched on', async () => {
    const agent = agentFor(cnct);
    const day = await agent.bookings.checkAvailability({ date: '2026-09-20' });
    await agent.bookings.create({
      startsAt: day.free[0]!.startsAt,
      customerPhone: '+97312345678',
      name: 'Layla',
    });
    const sent = cnct.requests.at(-1)?.body as Record<string, unknown>;
    expect(sent.startsAt).toBe('2026-09-20T16:30:00.000Z');
  });

  it('defaults nameIsTheCaller to false, so a booking never renames a contact by accident', async () => {
    await agentFor(cnct).bookings.create({
      startsAt: 'x',
      customerPhone: '+973',
      name: 'Her daughter',
    });
    expect((cnct.requests.at(-1)?.body as Record<string, unknown>).nameIsTheCaller).toBe(false);
  });

  it('omits what was never given rather than sending nulls', async () => {
    await agentFor(cnct).bookings.checkAvailability({ date: '2026-09-20' });
    expect(Object.keys(cnct.requests.at(-1)?.body as object)).toEqual(['date']);
  });

  it('keeps the sentence that says why a list is empty', async () => {
    const people = await agentFor(cnct).bookings.people();
    expect(people.items).toHaveLength(0);
    expect(people.note).toBe('This business assigns whoever is free.');
  });

  it('answers a cancel with the time it was at, for the sentence you say back', async () => {
    const was = await agentFor(cnct).bookings.cancel({ bookingId: 'bk_1', customerPhone: '+973' });
    expect(was).toBe('Sunday 20 September at 19:30');
  });
});

describe('tickets', () => {
  it('asks only for what the platform has not already got', async () => {
    const detail = await agentFor(cnct).tickets.type('tt_1');
    expect(detail.alreadyKnown).toEqual({ customerPhone: '+97312345678' });
    expect(detail.askFor).toEqual([
      {
        key: 'orderNumber',
        required: true,
        question: 'What is the order number?',
        mustBeOneOf: [],
      },
    ]);
  });

  it('raises one and hands back the number a customer quotes', async () => {
    const raised = await agentFor(cnct).tickets.create({
      ticketTypeId: 'tt_1',
      title: 'Refund not received',
      reasonUnresolved: 'Needs finance',
      fields: { orderNumber: 'A-1' },
      idempotencyKey: 'once',
    });
    expect(raised.ticketNumber).toBe(1042);
    const sent = cnct.requests.at(-1)?.body as Record<string, unknown>;
    expect(sent.fields).toEqual({ orderNumber: 'A-1' });
    expect(sent.idempotencyKey).toBe('once');
  });

  it('drops an empty fields object rather than sending one', async () => {
    await agentFor(cnct).tickets.create({
      ticketTypeId: 'tt_1',
      title: 't',
      reasonUnresolved: 'r',
    });
    expect((cnct.requests.at(-1)?.body as Record<string, unknown>).fields).toBeUndefined();
  });
});

describe('the escape hatch', () => {
  it('reaches a tool this SDK has never heard of', async () => {
    cnct.stub('POST /api/booking-tools/some_future_tool', { status: 200, body: { ok: true } });
    await expect(agentFor(cnct).call('some_future_tool', { a: 1 })).resolves.toEqual({ ok: true });
  });

  it('hands a refusal back rather than throwing, which is the difference from callOrThrow', async () => {
    await expect(
      agentFor(cnct).call('check_availability', { date: '2026-12-25' }),
    ).resolves.toEqual({
      error: 'We are closed that day.',
    });
    await expect(
      agentFor(cnct).callOrThrow('check_availability', { date: '2026-12-25' }),
    ).rejects.toBeInstanceOf(CnctError);
  });
});

describe('a key the platform does not know', () => {
  it('comes back as unauthenticated rather than as a generic failure', async () => {
    const agent = new Cnct({ baseUrl: cnct.baseUrl }).agent(new CnctApiKey('kaer_sk_wrong'));
    await expect(agent.catalogue()).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  });
});
