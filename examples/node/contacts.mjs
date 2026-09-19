/**
 * Sign an operator in and page the directory.
 *
 *   CNCT_HOST=… CNCT_EMAIL=… CNCT_PASSWORD=… node examples/node/contacts.mjs [search]
 */
import { createInterface } from 'node:readline/promises';
import { Cnct, CnctChooseOrganization, displayNameOf } from 'cnct-web-sdk';

const host = process.env.CNCT_HOST;
const email = process.env.CNCT_EMAIL;
const password = process.env.CNCT_PASSWORD;
if (!host || !email || !password) {
  console.error('Set CNCT_HOST, CNCT_EMAIL and CNCT_PASSWORD.');
  process.exit(64);
}

const cnct = new Cnct({ baseUrl: host });
const ask = createInterface({ input: process.stdin, output: process.stdout });

let result;
try {
  result = await cnct.auth.login({ email, password });
} catch (error) {
  // Somebody with a seat in more than one account has to say which. Not a failure — a question.
  if (!(error instanceof CnctChooseOrganization)) throw error;
  console.log('You have a seat in more than one account:');
  for (const org of error.organizations) console.log(`  · ${org.name} (${org.slug})`);
  const slug = await ask.question('Which slug? ');
  result = await cnct.auth.login({ email, password, organizationSlug: slug });
}

// MFA is the ordinary path for an account that has it on, which is why it arrives as a value.
if (result.challenge) {
  const where = result.challenge.method === 'EMAIL' ? 'your email' : 'your authenticator app';
  const code = await ask.question(`Code from ${where}: `);
  result.session = await cnct.auth.verifyMfa({ mfaToken: result.challenge.mfaToken, code });
}
ask.close();

const { session } = result;
console.log(`Signed in as ${session.email} (${session.role}) — ${session.organizationName}`);
if (session.mustChangePassword)
  console.log('⚠ The platform wants a new password before real work.');

const contacts = cnct.contacts(session.credentials);
const query = process.argv[2];

let seen = 0;
for await (const contact of contacts.listAll({ query, pageSize: 100 })) {
  console.log(`${displayNameOf(contact).padEnd(28)} ${contact.tags.map((t) => t.name).join(', ')}`);
  // An account with twenty-five thousand contacts will happily hand you all of them.
  if (++seen >= 50) break;
}
console.log(`\n${seen} shown.`);
