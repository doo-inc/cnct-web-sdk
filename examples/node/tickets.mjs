/**
 * Raise a ticket, then answer the customer who comes back about it — server-side.
 *
 *   CNCT_API_KEY=kaer_sk_test_… node examples/node/tickets.mjs
 *
 * The account needs ticketing and at least one ticket type. Run it with a sandbox key
 * (`kaer_sk_test_…`) and the ticket is kept in the sandbox: nobody works it, and the business never
 * sees it. `CNCT_HOST` is optional; without it this goes to https://app.doo.ooo.
 */
import { Cnct, CnctApiKey, CnctError } from 'cnct-web-sdk';

const key = process.env.CNCT_API_KEY;
if (!key) {
  console.error('Set CNCT_API_KEY — a sandbox key (kaer_sk_test_…) from Settings → Developers.');
  process.exit(64);
}

const agent = new Cnct({ baseUrl: process.env.CNCT_HOST || undefined }).agent(new CnctApiKey(key));
const phone = '+97312345678';

try {
  // 1. What kinds of work this business hands over, and what the first one needs.
  const types = await agent.tickets.types();
  if (!types.items.length) {
    console.log(types.refusal ?? 'No ticket types are set up on this account.');
    process.exit(0);
  }
  const type = await agent.tickets.type(types.items[0].ticketTypeId);
  const fields = Object.fromEntries(
    type.askFor
      .filter((field) => field.required)
      .map((field) => [field.key, field.mustBeOneOf[0] ?? 'example']),
  );

  // 2. Raise one. The idempotency key makes a retry return this ticket rather than a second.
  const raised = await agent.tickets.create({
    ticketTypeId: type.ticketTypeId,
    title: 'Example from the SDK',
    reasonUnresolved: 'Needs somebody on site',
    customerPhone: phone,
    fields,
    idempotencyKey: `sdk-example-${new Date().toISOString().slice(0, 10)}`,
  });
  console.log(`Raised #${raised.ticketNumber}${raised.sandbox ? ' (sandbox)' : ''}`);

  // 3. Later: "any news?" Find it by their number, then read it as they may see it.
  const open = await agent.tickets.forCustomer(phone);
  console.log(`They have ${open.items.length} open.`);
  const ticket = await agent.tickets.get(phone, raised.ticketNumber);
  console.log(`#${ticket.ticketNumber} is ${ticket.status}`);
  for (const line of ticket.history) console.log(`  ${line.on}  ${line.what}`);

  // 4. They add something. It goes on the ticket, not into a second one.
  const added = await agent.tickets.addTo({
    customerPhone: phone,
    ticketNumber: ticket.ticketNumber,
    note: 'It is worse this morning',
  });
  console.log(added.resumed ? 'Passed on, and it is moving again.' : 'Passed on.');
} catch (error) {
  // A tool that declines answers in a sentence rather than a status code.
  if (error instanceof CnctError && error.code === 'tool_refused')
    console.log(`Refused: ${error.message}`);
  else throw error;
}
