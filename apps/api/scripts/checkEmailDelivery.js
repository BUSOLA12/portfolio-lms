// One-off manual check: does mail actually leave through Resend?
//
// NOT part of `npm test`, and deliberately not discoverable by the runner —
// `test/setup.js` forces every automated suite onto a transport that cannot
// deliver, which is exactly right for tests and exactly wrong for confirming
// that delivery works at all. This is the other half: a real registration,
// through the real provider, to a real inbox.
//
// It needs live credentials. Those live in Railway, not in the local .env, so
// run it through Railway's environment:
//
//   railway run --service api node apps/api/scripts/checkEmailDelivery.js
//
// From a developer machine that also needs the database, Railway injects the
// private host `postgres.railway.internal`, which only resolves inside their
// network. Override it with the public proxy URL from the local .env:
//
//   export DB_PUBLIC="$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2-)"
//   railway run --service api sh -c \
//     'DATABASE_URL="$DB_PUBLIC" node apps/api/scripts/checkEmailDelivery.js'
//
// It creates two accounts, sends two emails, prints what Resend returned and
// what landed in email_log, then deletes everything it created.

import { prisma } from '../src/db/client.js';
import { registerLearner } from '../src/services/registrationService.js';
import { getEmailProvider } from '../src/services/providers/emailProvider.js';

// The guardian address is the real inbox under test. The learner uses a plus
// tag on the same mailbox, so both messages arrive in one place and neither is
// posted to an address that would bounce and cost sending reputation.
const GUARDIAN_EMAIL = 'iyiolaolubusola1999@gmail.com';
const LEARNER_EMAIL = 'iyiolaolubusola1999+learner@gmail.com';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\n${name} is not set.`);
    console.error('Run this through Railway so it sees the service variables:');
    console.error(
      '  railway run --service api node apps/api/scripts/checkEmailDelivery.js\n',
    );
    process.exit(1);
  }
  return value;
}

// Wraps the real transport so the provider's own response — or its refusal —
// can be printed. registerLearner logs send failures and carries on, by design,
// so without this the interesting part would be swallowed.
function observing(provider) {
  return {
    name: `observing:${provider.name}`,
    results: [],
    async send(message) {
      try {
        const response = await provider.send(message);
        this.results.push({ to: message.to, subject: message.subject, response });
        return response;
      } catch (error) {
        this.results.push({ to: message.to, subject: message.subject, error });
        throw error;
      }
    },
  };
}

async function main() {
  requireEnv('DATABASE_URL');
  requireEnv('EMAIL_API_KEY');
  const from = requireEnv('EMAIL_FROM');
  const webOrigin = requireEnv('WEB_ORIGIN');

  // Forced rather than read: the whole point is to exercise Resend.
  process.env.EMAIL_PROVIDER = 'resend';
  const provider = observing(getEmailProvider('resend'));

  console.log('Sending through Resend');
  console.log(`  from        ${from}`);
  console.log(`  learner     ${LEARNER_EMAIL}`);
  console.log(`  guardian    ${GUARDIAN_EMAIL}`);
  console.log(`  links to    ${webOrigin}\n`);

  const createdUserIds = [];

  try {
    const { user } = await registerLearner(
      {
        relationship: 'guardian',
        fullName: 'Delivery Check',
        email: LEARNER_EMAIL,
        password: 'a correct password for the check',
        guardian: {
          fullName: 'Delivery Check Guardian',
          email: GUARDIAN_EMAIL,
          phone: '08000000000',
          relationship: 'parent',
        },
      },
      { emailProvider: provider },
    );

    createdUserIds.push(user.id);

    const guardian = await prisma.user.findUnique({ where: { email: GUARDIAN_EMAIL } });
    if (guardian) createdUserIds.push(guardian.id);

    console.log('Resend responses');
    if (provider.results.length === 0) {
      console.log('  none — nothing was attempted');
    }
    for (const result of provider.results) {
      console.log(`  to        ${result.to}`);
      console.log(`  subject   ${result.subject}`);
      if (result.error) {
        console.log(`  REFUSED   ${result.error.message}`);
      } else {
        console.log(`  accepted  ${JSON.stringify(result.response)}`);
      }
      console.log('');
    }

    const rows = await prisma.emailLog.findMany({
      where: { userId: { in: createdUserIds } },
      orderBy: { sentAt: 'asc' },
    });

    console.log(`email_log rows: ${rows.length}`);
    for (const row of rows) {
      console.log(
        `  ${row.type.padEnd(20)} user=${row.userId} entity=${row.entityRef ?? 'null'} sent=${row.sentAt.toISOString()}`,
      );
    }
    if (rows.length === 0) {
      console.log('  none — every send failed, so the guard stays open for a retry');
    }
  } finally {
    if (createdUserIds.length > 0) {
      // Cascades to email_log, one_time_tokens and guardianships.
      const { count } = await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      console.log(`\nCleaned up ${count} user rows and everything cascading from them.`);
    }
    await prisma.$disconnect();
  }
}

await main();
