/**
 * Availability → booking → cancellation, server-side.
 *
 * The credential here is account-wide, which is why this is a Node script and not a page: a key in a
 * bundle is a key every visitor has. The shape this demonstrates is the one to copy — your page calls
 * your server, your server holds the key.
 *
 *   CNCT_HOST=https://your-cnct-host CNCT_API_KEY=kaer_sk_… node examples/node/bookings.mjs
 */
import { Cnct, CnctApiKey, CnctError } from 'cnct-web-sdk';

const host = process.env.CNCT_HOST;
const key = process.env.CNCT_API_KEY;
if (!host || !key) {
  console.error('Set CNCT_HOST and CNCT_API_KEY.');
  process.exit(64);
}

const agent = new Cnct({ baseUrl: host }).agent(new CnctApiKey(key));

// Crash here rather than in production if this ever gets bundled into something with a DOM.
new CnctApiKey(key).assertNotInBrowser?.();

const { tools, rules } = await agent.catalogue();
console.log(`${tools.length} tools, ${rules.timezone}, ${rules.slotMinutes}-minute slots`);
for (const service of rules.services)
  console.log(`  · ${service.name} (${service.minutes ?? '—'} min)`);

// The business's own date, in the business's own timezone — not the server's.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: rules.timezone }).format(new Date());

const day = await agent.bookings.checkAvailability({ date: today, partySize: 2 });
if (!day.free.length) {
  console.log(day.note ?? 'Nothing free today.');
  process.exit(0);
}

console.log(`Free today: ${day.free.map((slot) => slot.time).join(', ')}`);

try {
  const booking = await agent.bookings.create({
    // Exactly as the slot gave it. Rebuilding this from a Date is how a booking lands on a time nobody
    // offered.
    startsAt: day.free[0].startsAt,
    customerPhone: '+97312345678',
    partySize: 2,
    name: 'Layla',
    nameIsTheCaller: true,
  });
  console.log(`Booked ${booking.bookingId} — ${booking.when}`);

  const was = await agent.bookings.cancel({
    bookingId: booking.bookingId,
    customerPhone: '+97312345678',
  });
  console.log(`Cancelled. It was ${was}.`);
} catch (error) {
  // A tool that declines answers in a sentence rather than a status code.
  if (error instanceof CnctError && error.code === 'tool_refused')
    console.log(`Refused: ${error.message}`);
  else throw error;
}
